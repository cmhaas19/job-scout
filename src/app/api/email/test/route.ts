import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { getConfigString } from "@/lib/config";
import { buildDigestHtml } from "@/lib/email";

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
  },
];

// GET: preview HTML in browser
// POST: send the test email via Resend
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode");
  const name = request.nextUrl.searchParams.get("name") ?? "Chris";
  const empty = request.nextUrl.searchParams.get("empty") === "true";

  const newJobs = empty ? [] : MOCK_JOBS;
  const top10 = empty ? [] : MOCK_TOP10;
  const html = buildDigestHtml(name, newJobs, top10);

  if (mode === "send") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
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
