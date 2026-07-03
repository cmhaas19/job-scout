import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { getConfigString } from "@/lib/config";
import { FIT_CATEGORIES } from "@/lib/constants";
import { logger } from "@/lib/logger";

const APP_URL = "https://jobscout.oakworks.ai";

// Fit-tier styling: badge background/ink + section-header dot per category.
const TIER: Record<string, { badgeBg: string; badgeInk: string; dot: string }> = {
  "STRONG FIT": { badgeBg: "#E4F5EC", badgeInk: "#0E7A50", dot: "#12A366" },
  "GOOD FIT": { badgeBg: "#E7EEFB", badgeInk: "#2456C7", dot: "#3B7DE5" },
  BORDERLINE: { badgeBg: "#FBF1DE", badgeInk: "#9A6C15", dot: "#F5B546" },
  "WEAK FIT": { badgeBg: "#F1F0F4", badgeInk: "#585A6B", dot: "#B4BAC4" },
};

const DEFAULT_TIER = { badgeBg: "#F1F0F4", badgeInk: "#585A6B", dot: "#B4BAC4" };

function tierStyle(fit: string | null) {
  return TIER[fit ?? ""] ?? DEFAULT_TIER;
}

// Rank a fit category for descending sort (STRONG best → WEAK worst; unknown last).
function fitRank(fit: string | null): number {
  const i = FIT_CATEGORIES.indexOf((fit ?? "") as (typeof FIT_CATEGORIES)[number]);
  return i === -1 ? FIT_CATEGORIES.length : i;
}

// Deterministic per-search pill palettes (from the design mockup), assigned
// round-robin by the search name's position in a sorted, unique name list.
const PALETTES = [
  { pillBg: "#EDF1F7", pillInk: "#3B4A61", pillDot: "#5A78A6" }, // slate
  { pillBg: "#E4F5EC", pillInk: "#0E7A50", pillDot: "#12A366" }, // green
  { pillBg: "#F7EFE8", pillInk: "#8A5A2E", pillDot: "#C08A4E" }, // tan
  { pillBg: "#EAF1F9", pillInk: "#2F5B84", pillDot: "#5B8FC0" }, // blue
  { pillBg: "#F1F0F4", pillInk: "#585A6B", pillDot: "#8A8CA0" }, // gray
];

type Palette = (typeof PALETTES)[number];

interface SearchMeta {
  id: string;
  name: string | null;
  remote_filter: string | null;
}

interface DigestJob {
  id: string;
  position: string;
  company: string;
  location: string | null;
  salary: string | null;
  job_url: string;
  fit_category: string | null;
  total_score: number | null;
  search_id: string | null;
  search_query: string | null;
  eval_summary: string | null;
}

const JOB_COLUMNS =
  "id, position, company, location, salary, job_url, fit_category, total_score, search_id, search_query, eval_summary";

export async function sendDigestEmail(
  userId: string,
  runStartedAt: string,
  trigger: "scheduled" | "on_demand"
): Promise<void> {
  logger.info("email", "starting digest", { userId, trigger, runStartedAt });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("email", "RESEND_API_KEY not set, skipping digest", { userId });
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
    logger.error("email", "failed to load profile", { userId, error: profileError.message });
    return;
  }

  if (!profile) {
    logger.warn("email", "no profile found for user", { userId });
    return;
  }

  if (!profile.email_digest_enabled) {
    logger.info("email", "digest disabled for user", { email: profile.email });
    return;
  }

  logger.info("email", "sending digest", { email: profile.email });

  // New jobs from this run
  const { data: newJobs, error: newJobsError } = await supabase
    .from("job_evaluations")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("skipped", false)
    .eq("archived", false)
    .gte("created_at", runStartedAt)
    .order("total_score", { ascending: false });

  if (newJobsError) {
    logger.error("email", "failed to query new jobs", { userId, error: newJobsError.message });
  }

  const jobs: DigestJob[] = newJobs ?? [];
  logger.info("email", "new jobs from this run", { count: jobs.length });

  // On-demand: skip if no new jobs
  if (trigger === "on_demand" && jobs.length === 0) {
    logger.info("email", "on-demand with no new jobs, skipping digest", { userId });
    return;
  }

  // Top 10 from last 7 days
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: topJobs, error: topJobsError } = await supabase
    .from("job_evaluations")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("skipped", false)
    .eq("archived", false)
    .gte("created_at", sevenDaysAgo)
    .order("total_score", { ascending: false })
    .limit(10);

  if (topJobsError) {
    logger.error("email", "failed to query top jobs", { userId, error: topJobsError.message });
  }

  const top10: DigestJob[] = topJobs ?? [];
  logger.info("email", "top 10 this week", { count: top10.length });

  // Saved searches — drives remote detection (remote_filter) and stays cheap.
  const { data: searches, error: searchesError } = await supabase
    .from("saved_searches")
    .select("id, name, remote_filter")
    .eq("user_id", userId);

  if (searchesError) {
    logger.error("email", "failed to query saved searches", { userId, error: searchesError.message });
  }

  const searchMeta: SearchMeta[] = searches ?? [];

  const fromAddress = await getConfigString("email_from_address");
  const subject =
    jobs.length > 0
      ? `Job Scout: ${jobs.length} new job${jobs.length === 1 ? "" : "s"} found`
      : "Job Scout: Your weekly top jobs";

  logger.info("email", "sending", { from: fromAddress, to: profile.email, subject });

  const html = buildDigestHtml(profile.full_name, jobs, top10, searchMeta, {
    fromAddress,
    runStartedAt,
  });

  const resend = new Resend(apiKey);
  const { data: sendResult, error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: profile.email,
    subject,
    html,
  });

  if (sendError) {
    logger.error("email", "Resend API error", { error: sendError });
    throw sendError;
  }

  logger.info("email", "sent successfully", { id: sendResult?.id });
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isRemote(job: DigestJob, remoteBySearchId: Map<string, boolean>): boolean {
  if (job.location && /remote/i.test(job.location)) return true;
  if (job.search_id && remoteBySearchId.get(job.search_id)) return true;
  return false;
}

// Build a stable name -> palette map from all search names present in the digest.
function buildPaletteMap(names: string[]): Map<string, Palette> {
  const unique = Array.from(new Set(names.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const map = new Map<string, Palette>();
  unique.forEach((name, i) => map.set(name, PALETTES[i % PALETTES.length]));
  return map;
}

const FONT_STACK =
  "'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const MONO_STACK = "'Geist Mono','SF Mono',ui-monospace,monospace";

function searchPill(name: string | null, pal: Palette | undefined): string {
  if (!name) return "";
  const p = pal ?? PALETTES[PALETTES.length - 1];
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:${p.pillBg};padding:4px 9px 4px 8px;border-radius:8px;">
    <span style="width:6px;height:6px;border-radius:50%;background:${p.pillDot};"></span>
    <span style="font-size:11.5px;font-weight:600;color:${p.pillInk};">${esc(name)}</span>
  </span>`;
}

function remoteBadge(): string {
  return `<span style="display:inline-flex;align-items:center;gap:5px;background:#E4F5EC;padding:3px 8px;border-radius:999px;">
    <span style="width:5px;height:5px;border-radius:50%;background:#12A366;"></span>
    <span style="font-size:10.5px;font-weight:600;color:#0E7A50;letter-spacing:0.2px;">REMOTE</span>
  </span>`;
}

// Prominent card row used by the fit sections and Top-10.
function cardRow(
  job: DigestJob,
  opts: { remote: boolean; palette: Palette | undefined }
): string {
  const t = tierStyle(job.fit_category);
  const score = job.total_score == null ? "—" : String(Math.round(job.total_score));
  const location = job.location ? ` · ${esc(job.location)}` : "";
  const salary = job.salary
    ? `<span style="font-size:12px;color:#98A0AD;">${esc(job.salary)}</span>`
    : "";
  const reason = job.eval_summary
    ? `<div style="font-size:12.5px;color:#6B7280;margin-top:9px;line-height:1.5;">${esc(job.eval_summary)}</div>`
    : "";

  return `<a href="${esc(job.job_url)}" style="display:flex;gap:15px;text-decoration:none;padding:16px 12px;border-radius:14px;">
    <div style="flex:none;width:48px;height:48px;border-radius:13px;background:${t.badgeBg};display:flex;align-items:center;justify-content:center;">
      <span style="font-family:${MONO_STACK};font-weight:600;font-size:18px;color:${t.badgeInk};line-height:1;">${score}</span>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:15px;font-weight:600;color:#141821;letter-spacing:-0.1px;line-height:1.25;">${esc(job.position)}</span>
        ${opts.remote ? remoteBadge() : ""}
      </div>
      <div style="font-size:13px;color:#5C6472;margin-top:4px;">${esc(job.company)}${location}</div>
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:9px;">
        ${searchPill(job.search_query, opts.palette)}
        ${salary}
      </div>
      ${reason}
    </div>
  </a>`;
}

// Compact dense row used by the WEAK FIT list.
function compactRow(
  job: DigestJob,
  opts: { palette: Palette | undefined; first: boolean }
): string {
  const score = job.total_score == null ? "—" : String(Math.round(job.total_score));
  const p = opts.palette ?? PALETTES[PALETTES.length - 1];
  const border = opts.first ? "none" : "1px solid #EDEFF2";
  const searchTag = job.search_query
    ? `<span style="display:inline-flex;align-items:center;gap:5px;flex:none;">
        <span style="width:6px;height:6px;border-radius:50%;background:${p.pillDot};"></span>
        <span style="font-size:11px;color:#8A909C;">${esc(job.search_query)}</span>
      </span>`
    : "";
  return `<a href="${esc(job.job_url)}" style="display:flex;align-items:center;gap:13px;text-decoration:none;padding:11px 15px;border-top:${border};">
    <span style="flex:none;width:30px;font-family:${MONO_STACK};font-weight:600;font-size:14px;color:#9AA1AC;text-align:center;">${score}</span>
    <span style="flex:1;min-width:0;font-size:13px;font-weight:500;color:#565D69;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(job.position)}<span style="color:#A2A9B4;font-weight:400;"> · ${esc(job.company)}</span></span>
    ${searchTag}
  </a>`;
}

function sectionHeader(label: string, count: number, dot: string, muted = false): string {
  const labelColor = muted ? "#8A909C" : "#141821";
  const countColor = muted ? "#B0B6C0" : "#9098A5";
  return `<div style="padding:26px 30px 8px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:9px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${dot};"></span>
        <span style="font-size:13px;font-weight:700;letter-spacing:0.4px;color:${labelColor};text-transform:uppercase;">${esc(label)}</span>
      </div>
      <span style="font-size:12.5px;color:${countColor};font-family:${MONO_STACK};">${count}</span>
    </div>
  </div>`;
}

function formatDateLine(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  };
  // e.g. "Mon, Jun 29, 6:00 AM" -> "Mon, Jun 29 · 6:00 AM"
  const parts = new Intl.DateTimeFormat("en-US", opts).format(d);
  return parts.replace(/, (\d{1,2}:\d{2})/, " · $1");
}

export function buildDigestHtml(
  name: string | null,
  newJobs: DigestJob[],
  top10: DigestJob[],
  searchMeta: SearchMeta[] = [],
  meta: { fromAddress?: string; runStartedAt?: string } = {}
): string {
  const firstName = name ? name.split(" ")[0] : null;
  const greeting = firstName ? `Hi ${esc(firstName)}` : "Hi";
  const fromAddress = meta.fromAddress || "digest@jobscout.oakworks.ai";
  const dateLine = formatDateLine(meta.runStartedAt);

  const remoteBySearchId = new Map<string, boolean>();
  for (const s of searchMeta) {
    remoteBySearchId.set(s.id, (s.remote_filter ?? "").toLowerCase() === "remote");
  }

  // Palette map spans every search name appearing anywhere in the digest so a
  // search's color is consistent across cards, the compact list, and the legend.
  const paletteMap = buildPaletteMap(
    [...newJobs, ...top10]
      .map((j) => j.search_query)
      .filter((n): n is string => !!n)
  );
  const palOf = (job: DigestJob) =>
    job.search_query ? paletteMap.get(job.search_query) : undefined;

  // Group new jobs by fit category.
  const grouped = new Map<string, DigestJob[]>();
  for (const cat of FIT_CATEGORIES) grouped.set(cat, []);
  for (const job of newJobs) {
    const cat = job.fit_category ?? "WEAK FIT";
    (grouped.get(cat) ?? grouped.get("WEAK FIT")!).push(job);
  }
  const countOf = (cat: string) => grouped.get(cat)?.length ?? 0;

  // Priority: remote AND (STRONG FIT or GOOD FIT).
  const priority = newJobs.filter(
    (j) =>
      (j.fit_category === "STRONG FIT" || j.fit_category === "GOOD FIT") &&
      isRemote(j, remoteBySearchId)
  );

  const total = newJobs.length;
  const strongCount = countOf("STRONG FIT");
  const headline =
    total > 0
      ? `${total} new role${total === 1 ? "" : "s"} · ${strongCount} strong`
      : "Your weekly top matches";

  // --- Summary chips (one per non-empty category) ---
  const chips = FIT_CATEGORIES.filter((cat) => countOf(cat) > 0)
    .map((cat) => {
      const t = tierStyle(cat);
      const label = cat.replace(/ FIT$/, "").toLowerCase();
      return `<div style="display:flex;align-items:center;gap:7px;background:#1C1E2B;border:1px solid #2A2D3D;border-radius:10px;padding:8px 12px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${t.dot};"></span>
        <span style="font-size:13px;color:#E7E9F0;font-weight:500;">${countOf(cat)} ${label}</span>
      </div>`;
    })
    .join("");
  const chipsBlock = chips
    ? `<div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap;">${chips}</div>`
    : "";

  // --- Priority "Apply now" block ---
  let priorityBlock = "";
  if (priority.length > 0) {
    const rows = priority
      .map((job) => {
        const score =
          job.total_score == null ? "—" : String(Math.round(job.total_score));
        return `<a href="${esc(job.job_url)}" style="display:flex;align-items:center;gap:14px;text-decoration:none;background:#FFFFFF;border:1px solid #CDEBDC;border-radius:13px;padding:13px 15px;">
          <div style="flex:none;width:46px;height:46px;border-radius:12px;background:#E4F5EC;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <span style="font-family:${MONO_STACK};font-weight:600;font-size:17px;color:#0E7A50;line-height:1;">${score}</span>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14.5px;font-weight:600;color:#141821;line-height:1.3;">${esc(job.position)}</div>
            <div style="font-size:12.5px;color:#5C6472;margin-top:3px;">${esc(job.company)}${job.location ? ` · ${esc(job.location)}` : ""}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex:none;background:#E4F5EC;padding:5px 10px;border-radius:999px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#12A366;"></span>
            <span style="font-size:11.5px;font-weight:600;color:#0E7A50;">Remote</span>
          </div>
        </a>`;
      })
      .join("");
    priorityBlock = `<div style="padding:22px 30px 24px;background:#F1FAF5;border-bottom:1px solid #E4E7EC;">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#0E7A50;text-transform:uppercase;">Apply now</span>
        <span style="font-size:12.5px;color:#4F7A66;">Remote roles that scored high enough to act on</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">${rows}</div>
    </div>`;
  }

  // --- Fit sections (STRONG / GOOD / BORDERLINE as cards) ---
  const cardSections = (["STRONG FIT", "GOOD FIT", "BORDERLINE"] as const)
    .filter((cat) => countOf(cat) > 0)
    .map((cat) => {
      const t = tierStyle(cat);
      const label = cat.replace(/ FIT$/, "");
      const rows = grouped
        .get(cat)!
        .map(
          (job, i, arr) =>
            cardRow(job, {
              remote: isRemote(job, remoteBySearchId),
              palette: palOf(job),
            }) +
            (i < arr.length - 1
              ? `<div style="height:1px;background:#EEF0F3;margin:0 12px;"></div>`
              : "")
        )
        .join("");
      return (
        sectionHeader(label, countOf(cat), t.dot) +
        `<div style="padding:0 18px;">${rows}</div>`
      );
    })
    .join("");

  // --- WEAK FIT compact list ---
  let weakSection = "";
  if (countOf("WEAK FIT") > 0) {
    const rows = grouped
      .get("WEAK FIT")!
      .map((job, i) => compactRow(job, { palette: palOf(job), first: i === 0 }))
      .join("");
    weakSection = `<div style="padding:26px 30px 6px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:2px;">
          <div style="display:flex;align-items:center;gap:9px;">
            <span style="width:9px;height:9px;border-radius:50%;background:#B4BAC4;"></span>
            <span style="font-size:13px;font-weight:700;letter-spacing:0.4px;color:#8A909C;text-transform:uppercase;">Weak fit</span>
          </div>
          <span style="font-size:12.5px;color:#B0B6C0;font-family:${MONO_STACK};">${countOf("WEAK FIT")}</span>
        </div>
        <div style="font-size:12px;color:#A2A9B4;margin-top:2px;">Lower priority — scanning only.</div>
      </div>
      <div style="padding:12px 24px 4px;">
        <div style="background:#F7F8FA;border:1px solid #EDEFF2;border-radius:14px;overflow:hidden;">${rows}</div>
      </div>`;
  }

  // --- New-jobs block or empty state ---
  let newJobsBlock: string;
  if (newJobs.length === 0) {
    newJobsBlock = `<div style="padding:28px 30px 8px;">
      <div style="font-size:14px;color:#6B7280;line-height:1.6;">No new roles came back from this run — here are your strongest matches from the past week.</div>
    </div>`;
  } else {
    newJobsBlock = priorityBlock + cardSections + weakSection;
  }

  // --- Top 10 this week (sorted by fit descending, then score) ---
  let top10Section = "";
  if (top10.length > 0) {
    const top10Sorted = [...top10].sort(
      (a, b) =>
        fitRank(a.fit_category) - fitRank(b.fit_category) ||
        (b.total_score ?? 0) - (a.total_score ?? 0)
    );
    const rows = top10Sorted
      .map(
        (job, i, arr) =>
          cardRow(job, {
            remote: isRemote(job, remoteBySearchId),
            palette: palOf(job),
          }) +
          (i < arr.length - 1
            ? `<div style="height:1px;background:#EEF0F3;margin:0 12px;"></div>`
            : "")
      )
      .join("");
    top10Section =
      `<div style="padding:26px 30px 8px;border-top:1px solid #EEF0F3;margin-top:14px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:9px;">
            <span style="width:9px;height:9px;border-radius:50%;background:#5B57F5;"></span>
            <span style="font-size:13px;font-weight:700;letter-spacing:0.4px;color:#141821;text-transform:uppercase;">Top 10 this week</span>
          </div>
          <span style="font-size:12.5px;color:#9098A5;font-family:${MONO_STACK};">${top10.length}</span>
        </div>
      </div>
      <div style="padding:0 18px;">${rows}</div>`;
  }

  // --- Footer: saved-search legend (searches present in this digest) ---
  const legendCounts = new Map<string, number>();
  for (const job of [...newJobs, ...top10]) {
    if (job.search_query) {
      legendCounts.set(job.search_query, (legendCounts.get(job.search_query) ?? 0) + 1);
    }
  }
  const legendPills = Array.from(legendCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nm, count]) => {
      const p = paletteMap.get(nm) ?? PALETTES[PALETTES.length - 1];
      return `<div style="display:inline-flex;align-items:center;gap:7px;background:${p.pillBg};padding:6px 11px;border-radius:9px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${p.pillDot};"></span>
        <span style="font-size:12px;font-weight:600;color:${p.pillInk};">${esc(nm)}</span>
        <span style="font-size:11.5px;color:#9CA3AE;font-family:${MONO_STACK};">${count}</span>
      </div>`;
    })
    .join("");
  const legendBlock = legendPills
    ? `<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:#9098A5;text-transform:uppercase;margin-bottom:13px;">Your saved searches</div>
       <div style="display:flex;flex-wrap:wrap;gap:8px;">${legendPills}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#EDEFF3;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;color:#171A21;">
  <div style="min-height:100%;background:#EDEFF3;padding:40px 20px 64px;">
    <div style="max-width:680px;margin:0 auto;">

      <!-- sender context row -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 6px 14px;font-size:12.5px;color:#7A828E;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:600;color:#4A5160;">${esc(fromAddress)}</span>
          <span>to you</span>
        </div>
        <span>${esc(dateLine)}</span>
      </div>

      <div style="background:#FFFFFF;border:1px solid #E4E7EC;border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04),0 12px 32px -12px rgba(16,24,40,0.14);">

        <!-- header -->
        <div style="padding:26px 30px 24px;background:#12131C;color:#FFFFFF;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:11px;">
              <div style="width:30px;height:30px;border-radius:9px;background:#5B57F5;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;letter-spacing:-0.5px;">J</div>
              <div style="font-weight:600;font-size:16px;letter-spacing:-0.2px;">Job Scout</div>
            </div>
            <div style="font-size:12px;color:#8A90A6;font-weight:500;text-transform:uppercase;letter-spacing:1.2px;">Daily Digest</div>
          </div>
          <div style="margin-top:22px;font-size:26px;font-weight:600;letter-spacing:-0.6px;line-height:1.15;">${esc(headline)}</div>
          <div style="margin-top:8px;font-size:14px;color:#A6ACBE;line-height:1.5;">${greeting} — here's what came back from your saved searches.</div>
          ${chipsBlock}
        </div>

        ${newJobsBlock}
        ${top10Section}

        <!-- footer -->
        <div style="padding:24px 30px 28px;margin-top:12px;border-top:1px solid #EEF0F3;">
          ${legendBlock}
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:${legendBlock ? "22px" : "0"};padding-top:18px;border-top:1px solid #EEF0F3;">
            <span style="font-size:12px;color:#A2A9B4;">Scored against your resume by Job Scout AI.</span>
            <a href="${APP_URL}/setup/searches" style="font-size:12.5px;font-weight:600;color:#5B57F5;text-decoration:none;">Manage searches →</a>
          </div>
        </div>

      </div>
      <div style="text-align:center;margin-top:20px;font-size:11.5px;color:#A2A9B4;">You're receiving this because you set up Job Scout. <a href="${APP_URL}/setup" style="color:#8890A0;">Manage preferences</a></div>
    </div>
  </div>
</body>
</html>`;
}
