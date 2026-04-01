import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { getConfigString } from "@/lib/config";
import { FIT_CATEGORIES } from "@/lib/constants";

const FIT_HEX: Record<string, string> = {
  "STRONG FIT": "#059669",
  "GOOD FIT": "#2563eb",
  BORDERLINE: "#d97706",
  "WEAK FIT": "#dc2626",
};

interface DigestJob {
  id: string;
  position: string;
  company: string;
  location: string | null;
  salary: string | null;
  job_url: string;
  fit_category: string | null;
  total_score: number | null;
}

export async function sendDigestEmail(
  userId: string,
  runStartedAt: string,
  trigger: "scheduled" | "on_demand"
): Promise<void> {
  console.log(`[email] Starting digest for user=${userId} trigger=${trigger} runStartedAt=${runStartedAt}`);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set, skipping digest");
    return;
  }

  const supabase = await createServiceClient();

  // Check opt-out
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, full_name, email_digest_enabled")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error("[email] Failed to load profile:", profileError.message);
    return;
  }

  if (!profile) {
    console.warn("[email] No profile found for user:", userId);
    return;
  }

  if (!profile.email_digest_enabled) {
    console.log("[email] Digest disabled for user:", profile.email);
    return;
  }

  console.log(`[email] Sending digest to ${profile.email}`);

  // New jobs from this run
  const { data: newJobs, error: newJobsError } = await supabase
    .from("job_evaluations")
    .select(
      "id, position, company, location, salary, job_url, fit_category, total_score"
    )
    .eq("user_id", userId)
    .eq("skipped", false)
    .eq("archived", false)
    .gte("created_at", runStartedAt)
    .order("total_score", { ascending: false });

  if (newJobsError) {
    console.error("[email] Failed to query new jobs:", newJobsError.message);
  }

  const jobs: DigestJob[] = newJobs ?? [];
  console.log(`[email] New jobs from this run: ${jobs.length}`);

  // On-demand: skip if no new jobs
  if (trigger === "on_demand" && jobs.length === 0) {
    console.log("[email] On-demand with no new jobs, skipping digest");
    return;
  }

  // Top 10 from last 7 days
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: topJobs, error: topJobsError } = await supabase
    .from("job_evaluations")
    .select(
      "id, position, company, location, salary, job_url, fit_category, total_score"
    )
    .eq("user_id", userId)
    .eq("skipped", false)
    .eq("archived", false)
    .gte("created_at", sevenDaysAgo)
    .order("total_score", { ascending: false })
    .limit(10);

  if (topJobsError) {
    console.error("[email] Failed to query top jobs:", topJobsError.message);
  }

  const top10: DigestJob[] = topJobs ?? [];
  console.log(`[email] Top 10 this week: ${top10.length}`);

  const fromAddress = await getConfigString("email_from_address");
  const subject =
    jobs.length > 0
      ? `Job Scout: ${jobs.length} new job${jobs.length === 1 ? "" : "s"} found`
      : "Job Scout: Your weekly top jobs";

  console.log(`[email] Sending from="${fromAddress}" to="${profile.email}" subject="${subject}"`);

  const html = buildDigestHtml(profile.full_name, jobs, top10);

  const resend = new Resend(apiKey);
  const { data: sendResult, error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: profile.email,
    subject,
    html,
  });

  if (sendError) {
    console.error("[email] Resend API error:", sendError);
    throw sendError;
  }

  console.log(`[email] Sent successfully, id=${sendResult?.id}`);
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function scoreBadge(job: DigestJob): string {
  if (job.total_score == null) return "";
  const color = FIT_HEX[job.fit_category ?? ""] ?? "#6b7280";
  const score = Math.round(job.total_score);
  return `<span style="display:inline-block;width:36px;height:36px;line-height:36px;border-radius:50%;font-size:13px;font-weight:700;color:#fff;background:${color};text-align:center">${score}</span>`;
}

function jobRow(job: DigestJob, index?: number): string {
  const prefix = index != null ? `${index + 1}. ` : "";
  const location = job.location ? ` · ${job.location}` : "";
  const salary = job.salary ? ` · ${job.salary}` : "";

  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb">
        ${prefix}<a href="${job.job_url}" style="color:#4f46e5;text-decoration:none;font-weight:500">${job.position}</a>
        <br/>
        <span style="color:#6b7280;font-size:13px">${job.company}${location}${salary}</span>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:middle;white-space:nowrap">
        ${scoreBadge(job)}
      </td>
    </tr>`;
}

export function buildDigestHtml(
  name: string | null,
  newJobs: DigestJob[],
  top10: DigestJob[]
): string {
  const greeting = name ? `Hi ${name},` : "Hi,";

  // Group new jobs by fit category
  const grouped = new Map<string, DigestJob[]>();
  for (const cat of FIT_CATEGORIES) grouped.set(cat, []);
  for (const job of newJobs) {
    const cat = job.fit_category ?? "WEAK FIT";
    const list = grouped.get(cat);
    if (list) list.push(job);
  }

  // Summary counts
  const counts = FIT_CATEGORIES.map((cat) => {
    const n = grouped.get(cat)!.length;
    if (n === 0) return null;
    return `<span style="color:${FIT_HEX[cat]};font-weight:600">${n} ${cat}</span>`;
  })
    .filter(Boolean)
    .join(" &middot; ");

  // New jobs section
  let newJobsSection: string;
  if (newJobs.length === 0) {
    newJobsSection = `
      <p style="color:#6b7280;font-style:italic">No new jobs found in this run.</p>`;
  } else {
    let rows = "";
    for (const cat of FIT_CATEGORIES) {
      const list = grouped.get(cat)!;
      if (list.length === 0) continue;
      rows += `
        <tr>
          <td colspan="2" style="padding:20px 0 8px;font-weight:600;font-size:14px;color:${FIT_HEX[cat]}">${cat} (${list.length})</td>
        </tr>`;
      for (const job of list) rows += jobRow(job);
    }
    newJobsSection = `
      <p style="margin:0 0 8px">${counts}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}</table>`;
  }

  // Top 10 section
  let top10Section: string;
  if (top10.length === 0) {
    top10Section = `
      <p style="color:#6b7280;font-style:italic">No evaluated jobs in the last 7 days.</p>`;
  } else {
    let rows = "";
    top10.forEach((job, i) => {
      rows += jobRow(job, i);
    });
    top10Section = `
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}</table>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">
          <!-- Header -->
          <tr>
            <td style="background:#4f46e5;padding:24px 32px">
              <a href="https://jobscout.app" style="color:#ffffff;text-decoration:none"><h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700">Job Scout &mdash; Daily Digest</h1></a>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px">
              <p style="margin:0 0 16px;color:#374151">${greeting}</p>

              <h2 style="margin:0 0 12px;font-size:16px;color:#111827">New Jobs Found</h2>
              ${newJobsSection}

              <h2 style="margin:32px 0 12px;font-size:16px;color:#111827;border-top:2px solid #e5e7eb;padding-top:24px">Top 10 This Week</h2>
              ${top10Section}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
              <p style="margin:0;font-size:12px;color:#9ca3af">
                <a href="https://jobscout.app" style="color:#4f46e5;text-decoration:none">Open Job Scout</a> &middot; Manage your digest preferences in settings
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
