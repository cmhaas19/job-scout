export const FIT_CATEGORIES = ["STRONG FIT", "GOOD FIT", "BORDERLINE", "WEAK FIT"] as const;
export type FitCategory = (typeof FIT_CATEGORIES)[number];

export const FIT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "STRONG FIT": { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" },
  "GOOD FIT": { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  BORDERLINE: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" },
  "WEAK FIT": { bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
};

export const FIT_SCORE_COLORS: Record<string, string> = {
  "STRONG FIT": "bg-emerald-500",
  "GOOD FIT": "bg-blue-500",
  BORDERLINE: "bg-amber-500",
  "WEAK FIT": "bg-red-500",
};

export const SCORE_LABELS: Record<string, { label: string; max: number }> = {
  required_skills: { label: "Required Skills", max: 30 },
  years_of_experience: { label: "Experience", max: 10 },
  role_level_alignment: { label: "Role Level", max: 20 },
  industry_domain_match: { label: "Industry Match", max: 30 },
  nice_to_have_skills: { label: "Nice-to-Have", max: 5 },
  education_certs: { label: "Education", max: 5 },
};

export function formatDuration(ms: number | null, fallback = "—"): string {
  if (!ms) return fallback;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
