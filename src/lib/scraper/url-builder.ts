interface SearchParams {
  keyword: string;
  location?: string | null;
  date_since_posted: string;
  job_type?: string | null;
  remote_filter?: string | null;
  experience_level?: string[];
  sort_by?: string;
  start?: number;
}

const TIME_FILTER_MAP: Record<string, string> = {
  "past month": "r2592000",
  "past week": "r604800",
  "24hr": "r86400",
};

const EXPERIENCE_MAP: Record<string, string> = {
  internship: "1",
  "entry level": "2",
  associate: "3",
  senior: "4",
  director: "5",
  executive: "6",
};

const REMOTE_MAP: Record<string, string> = {
  "on site": "1",
  remote: "2",
  hybrid: "3",
};

const JOB_TYPE_MAP: Record<string, string> = {
  "full time": "F",
  "part time": "P",
  contract: "C",
  temporary: "T",
  volunteer: "V",
  internship: "I",
};

const SORT_MAP: Record<string, string> = {
  recent: "DD",
  relevant: "R",
};

export function buildLinkedInSearchUrl(params: SearchParams): string {
  const url = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");

  url.searchParams.set("keywords", params.keyword);

  if (params.location) {
    url.searchParams.set("location", params.location);
  }

  if (params.date_since_posted && TIME_FILTER_MAP[params.date_since_posted]) {
    url.searchParams.set("f_TPR", TIME_FILTER_MAP[params.date_since_posted]);
  }

  if (params.experience_level && params.experience_level.length > 0) {
    const codes = params.experience_level
      .map((l) => EXPERIENCE_MAP[l])
      .filter(Boolean);
    if (codes.length > 0) {
      url.searchParams.set("f_E", codes.join(","));
    }
  }

  if (params.remote_filter && REMOTE_MAP[params.remote_filter]) {
    url.searchParams.set("f_WT", REMOTE_MAP[params.remote_filter]);
  }

  if (params.job_type && JOB_TYPE_MAP[params.job_type]) {
    url.searchParams.set("f_JT", JOB_TYPE_MAP[params.job_type]);
  }

  if (params.sort_by && SORT_MAP[params.sort_by]) {
    url.searchParams.set("sortBy", SORT_MAP[params.sort_by]);
  }

  url.searchParams.set("start", String(params.start ?? 0));

  return url.toString();
}

export function normalizeJobUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin + parsed.pathname;
  } catch {
    return rawUrl.split("?")[0];
  }
}

/**
 * Extracts the stable numeric LinkedIn job ID from a job URL.
 * LinkedIn paths embed a title slug before the ID, e.g.
 * `/jobs/view/senior-engineer-at-acme-4012345678` → `4012345678`.
 * Returns null for non-LinkedIn / imported URLs that have no such ID, so
 * callers can fall back to URL-based keying.
 */
export function extractJobId(rawUrl: string): string | null {
  const path = normalizeJobUrl(rawUrl);
  const match = path.match(/(\d{8,})\/?$/);
  return match ? match[1] : null;
}
