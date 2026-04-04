import * as cheerio from "cheerio";
import { normalizeJobUrl } from "./url-builder";

export interface JobCard {
  position: string;
  company: string;
  location: string;
  datePosted: string | null;
  salary: string;
  jobUrl: string;
  companyLogo: string | null;
  agoTime: string;
}

/**
 * Parse a relative time string like "2 days ago", "3 hours ago", "1 week ago"
 * into an ISO datetime string. Returns null if unparseable.
 */
function parseAgoTime(agoTime: string): string | null {
  if (!agoTime) return null;

  const match = agoTime.match(/(\d+)\s*(second|minute|hour|day|week|month)s?\s*ago/i);
  if (!match) return null;

  const amount = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  const now = new Date();
  switch (unit) {
    case "second":
      now.setSeconds(now.getSeconds() - amount);
      break;
    case "minute":
      now.setMinutes(now.getMinutes() - amount);
      break;
    case "hour":
      now.setHours(now.getHours() - amount);
      break;
    case "day":
      now.setDate(now.getDate() - amount);
      break;
    case "week":
      now.setDate(now.getDate() - amount * 7);
      break;
    case "month":
      now.setMonth(now.getMonth() - amount);
      break;
    default:
      return null;
  }

  return now.toISOString();
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function parseSearchResults(html: string): JobCard[] {
  const $ = cheerio.load(html);
  const jobs: JobCard[] = [];

  $("li").each((_, el) => {
    const $el = $(el);
    const position = $el.find(".base-search-card__title").text().trim();
    const company = $el.find(".base-search-card__subtitle").text().trim();

    if (!position && !company) return;

    const location = $el.find(".job-search-card__location").text().trim();
    const datePosted = $el.find("time[datetime]").attr("datetime") || null;
    const salaryRaw = $el.find(".job-search-card__salary-info").text().trim();
    const salary = salaryRaw
      ? salaryRaw.replace(/\s+/g, " ")
      : "Not specified";

    const rawUrl =
      $el.find("a.base-card__full-link").attr("href") ||
      $el.find("a[href*='/jobs/view/']").attr("href") ||
      "";

    const jobUrl = rawUrl ? normalizeJobUrl(rawUrl) : "";
    if (!jobUrl) return;

    const companyLogo =
      $el.find(".artdeco-entity-image").attr("data-delayed-url") ||
      $el.find("img").attr("data-delayed-url") ||
      $el.find("img").attr("src") ||
      null;

    const agoTime =
      $el.find(".job-search-card__listdate").text().trim() ||
      $el.find("time").text().trim() ||
      "";

    // Derive a more precise date from agoTime, fall back to datetime attribute
    const derivedDate = parseAgoTime(agoTime) || datePosted;

    jobs.push({
      position,
      company,
      location,
      datePosted: derivedDate,
      salary,
      jobUrl,
      companyLogo,
      agoTime,
    });
  });

  return jobs;
}

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (response.status === 429 || response.status === 999) {
    throw new Error(`Rate limited (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

// Sidebar markers to truncate after
const SIDEBAR_MARKERS = [
  "Set alert for similar jobs",
  "See how you compare",
  "More jobs",
];

function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  function walk(node: any): string {
    if (node.type === "text") {
      return node.data?.replace(/\s+/g, " ") || "";
    }

    if (node.type !== "tag") return "";

    const children = (node.children || []).map(walk).join("");
    const tag = node.name?.toLowerCase();

    switch (tag) {
      case "h1":
        return `\n# ${children.trim()}\n`;
      case "h2":
        return `\n## ${children.trim()}\n`;
      case "h3":
        return `\n### ${children.trim()}\n`;
      case "h4":
      case "h5":
      case "h6":
        return `\n#### ${children.trim()}\n`;
      case "strong":
      case "b":
        return `**${children.trim()}**`;
      case "em":
      case "i":
        return `_${children.trim()}_`;
      case "br":
        return "\n";
      case "p":
        return `\n${children.trim()}\n`;
      case "li": {
        const parent = node.parent?.name?.toLowerCase();
        if (parent === "ol") {
          const idx =
            (node.parent.children || []).filter(
              (c: any) => c.name === "li"
            ).indexOf(node) + 1;
          return `${idx}. ${children.trim()}\n`;
        }
        return `- ${children.trim()}\n`;
      }
      case "ul":
      case "ol":
        return `\n${children}`;
      default:
        return children;
    }
  }

  const body = $("body").length ? $("body")[0] : $.root()[0];
  let md = walk(body);

  // Collapse excessive newlines
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  // Truncate at sidebar markers
  for (const marker of SIDEBAR_MARKERS) {
    const idx = md.indexOf(marker);
    if (idx !== -1) {
      md = md.substring(0, idx).trim();
    }
  }

  return md;
}

export async function fetchJobDescription(
  jobUrl: string,
  retries = 2,
  baseDelay = 1500
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const html = await fetchPage(jobUrl);
      const $ = cheerio.load(html);

      // Try selectors in priority order
      let descEl =
        $(".show-more-less-html__markup").first() ||
        $(".description__text").first() ||
        $(".jobs-description__content").first();

      if (!descEl.length) {
        // Fallback: largest section by text length
        let maxLen = 0;
        $("section").each((_, el) => {
          const text = $(el).text().length;
          if (text > maxLen) {
            maxLen = text;
            descEl = $(el);
          }
        });
      }

      if (!descEl.length) return null;

      const descHtml = descEl.html();
      if (!descHtml) return null;

      return htmlToMarkdown(descHtml);
    } catch (err: any) {
      if (attempt < retries && err.message?.includes("Rate limited")) {
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt))
        );
        continue;
      }
      if (attempt < retries) {
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt))
        );
        continue;
      }
      return null;
    }
  }
  return null;
}

export interface JobPageData {
  position: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  companyLogo: string | null;
  agoTime: string;
  datePosted: string | null;
}

export async function fetchJobPage(
  jobUrl: string,
  retries = 2,
  baseDelay = 1500
): Promise<JobPageData | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const html = await fetchPage(jobUrl);
      const $ = cheerio.load(html);

      const position =
        $(".top-card-layout__title").text().trim() ||
        $("h1").first().text().trim() ||
        "";

      const company =
        $(".topcard__org-name-link").text().trim() ||
        $(".top-card-layout__second-subline a").first().text().trim() ||
        $("a[data-tracking-control-name='public_jobs_topcard-org-name']").text().trim() ||
        "";

      if (!position && !company) return null;

      const location =
        $(".topcard__flavor--bullet").text().trim() ||
        $(".top-card-layout__second-subline .topcard__flavor").last().text().trim() ||
        "";

      const salary =
        $(".salary-main-rail__data-body .compensation__salary").text().trim().replace(/\s+/g, " ") ||
        $(".compensation__salary").text().trim().replace(/\s+/g, " ") ||
        "Not specified";

      const companyLogo =
        $(".artdeco-entity-image").attr("data-delayed-url") ||
        $(".top-card-layout__entity-image img").attr("src") ||
        null;

      const agoTime =
        $(".posted-time-ago__text").text().trim() ||
        $("span.topcard__flavor--metadata").text().trim() ||
        "";

      const datePosted = parseAgoTime(agoTime) || null;

      // Extract description
      let descEl =
        $(".show-more-less-html__markup").first() ||
        $(".description__text").first() ||
        $(".jobs-description__content").first();

      if (!descEl.length) {
        let maxLen = 0;
        $("section").each((_, el) => {
          const text = $(el).text().length;
          if (text > maxLen) {
            maxLen = text;
            descEl = $(el);
          }
        });
      }

      const descHtml = descEl.length ? descEl.html() : null;
      const description = descHtml ? htmlToMarkdown(descHtml) : "";

      return {
        position,
        company,
        location,
        description,
        salary,
        companyLogo,
        agoTime,
        datePosted,
      };
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt))
        );
        continue;
      }
      return null;
    }
  }
  return null;
}

export { USER_AGENT };
