import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireApiUser } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { getConfigString } from "@/lib/config";
import { buildDigestHtml } from "@/lib/email";

// Mock saved searches — ids referenced by search_id on the jobs below.
// One search (Remote · US) is remote_filter="remote" to exercise remote detection.
const MOCK_SEARCHES = [
  { id: "s-remote", name: "Remote · US", remote_filter: "remote" },
  { id: "s-sf", name: "SF Bay Area", remote_filter: null },
  { id: "s-nyc", name: "New York", remote_filter: null },
  { id: "s-atx", name: "Austin", remote_filter: null },
];

const MOCK_JOBS = [
  {
    id: "1",
    position: "Senior Software Engineer",
    company: "Stripe",
    location: "San Francisco, CA",
    salary: "$180k - $250k",
    job_url: "https://www.linkedin.com/jobs/view/1234567890",
    fit_category: "STRONG FIT",
    total_score: 92,
    search_id: "s-sf",
    search_query: "SF Bay Area",
    eval_summary:
      "Payments and API platform experience map directly to the role; slightly larger org than your last.",
  },
  {
    id: "2",
    position: "Staff Engineer, Platform",
    company: "Airbnb",
    location: "Remote",
    salary: "$200k - $280k",
    job_url: "https://www.linkedin.com/jobs/view/1234567891",
    fit_category: "STRONG FIT",
    total_score: 88,
    search_id: "s-remote",
    search_query: "Remote · US",
    eval_summary:
      "Fully remote, staff-level platform scope aligns with your infra background — strong immediate fit.",
  },
  {
    id: "3",
    position: "Full Stack Developer",
    company: "Vercel",
    location: "Remote",
    salary: "$160k - $220k",
    job_url: "https://www.linkedin.com/jobs/view/1234567892",
    fit_category: "GOOD FIT",
    total_score: 78,
    search_id: "s-remote",
    search_query: "Remote · US",
    eval_summary:
      "Remote and product-focused; frontend depth is a plus, backend expectations are lighter than your target.",
  },
  {
    id: "4",
    position: "Backend Engineer",
    company: "Datadog",
    location: "New York, NY",
    salary: "$170k - $230k",
    job_url: "https://www.linkedin.com/jobs/view/1234567893",
    fit_category: "GOOD FIT",
    total_score: 74,
    search_id: "s-nyc",
    search_query: "New York",
    eval_summary:
      "Observability domain is adjacent to your experience; on-site NYC may not match your location preference.",
  },
  {
    id: "5",
    position: "Software Engineer II",
    company: "Notion",
    location: "San Francisco, CA",
    salary: "$150k - $200k",
    job_url: "https://www.linkedin.com/jobs/view/1234567894",
    fit_category: "BORDERLINE",
    total_score: 63,
    search_id: "s-sf",
    search_query: "SF Bay Area",
    eval_summary:
      "Level is a step below your current scope; strong product but limited leadership surface.",
  },
  {
    id: "6",
    position: "Junior Developer",
    company: "Startup Co",
    location: "Austin, TX",
    salary: "$80k - $110k",
    job_url: "https://www.linkedin.com/jobs/view/1234567895",
    fit_category: "WEAK FIT",
    total_score: 41,
    search_id: "s-atx",
    search_query: "Austin",
    eval_summary: "Junior scope and comp well below your target band.",
  },
];

const MOCK_TOP10 = [
  MOCK_JOBS[0],
  MOCK_JOBS[1],
  {
    id: "7",
    position: "Principal Engineer",
    company: "Figma",
    location: "San Francisco, CA",
    salary: "$220k - $320k",
    job_url: "https://www.linkedin.com/jobs/view/1234567896",
    fit_category: "STRONG FIT",
    total_score: 95,
    search_id: "s-sf",
    search_query: "SF Bay Area",
    eval_summary:
      "Principal-level product and platform ownership — closest match to your ideal role this week.",
  },
  MOCK_JOBS[2],
  MOCK_JOBS[3],
  {
    id: "8",
    position: "Engineering Manager",
    company: "Linear",
    location: "Remote",
    salary: "$190k - $260k",
    job_url: "https://www.linkedin.com/jobs/view/1234567897",
    fit_category: "GOOD FIT",
    total_score: 76,
    search_id: "s-remote",
    search_query: "Remote · US",
    eval_summary: "Remote EM role; people-leadership scope fits, smaller team than your last.",
  },
  MOCK_JOBS[4],
  {
    id: "9",
    position: "DevOps Engineer",
    company: "HashiCorp",
    location: "Remote",
    salary: "$155k - $210k",
    job_url: "https://www.linkedin.com/jobs/view/1234567898",
    fit_category: "BORDERLINE",
    total_score: 65,
    search_id: "s-remote",
    search_query: "Remote · US",
    eval_summary: "Infra-heavy IC role; remote and solid comp, less product ownership than you want.",
  },
  {
    id: "10",
    position: "React Developer",
    company: "Shopify",
    location: "Remote",
    salary: "$140k - $190k",
    job_url: "https://www.linkedin.com/jobs/view/1234567899",
    fit_category: "GOOD FIT",
    total_score: 72,
    search_id: "s-remote",
    search_query: "Remote · US",
    eval_summary: "Remote frontend role at scale; comp is toward the lower end of your range.",
  },
  {
    id: "11",
    position: "Platform Engineer",
    company: "Cloudflare",
    location: "Austin, TX",
    salary: "$165k - $225k",
    job_url: "https://www.linkedin.com/jobs/view/1234567900",
    fit_category: "GOOD FIT",
    total_score: 71,
    search_id: "s-atx",
    search_query: "Austin",
    eval_summary: "Edge/platform scope is a good technical match; on-site Austin.",
  },
];

// GET: preview HTML in browser
// POST: send the test email via Resend
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode");
  const name = request.nextUrl.searchParams.get("name") ?? "Chris";
  const empty = request.nextUrl.searchParams.get("empty") === "true";

  // `empty` simulates a quiet-day scheduled run: no new roles, but the weekly
  // Top 10 fallback still renders.
  const newJobs = empty ? [] : MOCK_JOBS;
  const top10 = MOCK_TOP10;
  const html = buildDigestHtml(name, newJobs, top10, MOCK_SEARCHES, {
    fromAddress: "digest@jobscout.oakworks.ai",
    runStartedAt: new Date().toISOString(),
  });

  if (mode === "send") {
    const gate = await requireApiUser();
    if (gate instanceof Response) return gate;
    const { user } = gate;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return apiError("RESEND_API_KEY not set", 500);
    }

    const fromAddress = await getConfigString("email_from_address");
    const resend = new Resend(apiKey);
    const { data: result, error } = await resend.emails.send({
      from: fromAddress,
      to: user.email!,
      subject: "Job Scout: Test Digest (6 new jobs found)",
      html,
    });

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({ sent: true, id: result?.id, to: user.email });
  }

  // Default: preview HTML
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}
