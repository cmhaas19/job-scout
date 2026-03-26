"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { JobDetailPanel } from "@/components/job-detail-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingUp,
  Briefcase,
  Building2,
  MapPin,
  ArrowRight,
} from "lucide-react";

interface LastRun {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  stats: any;
  error: string | null;
}

interface TopJob {
  id: string;
  position: string;
  company: string;
  location: string | null;
  total_score: number | null;
  fit_category: string | null;
  date_posted: string | null;
  company_logo: string | null;
  search_query: string | null;
  prompt_version: number | null;
}

interface DashboardData {
  lastRun: LastRun | null;
  weekTotal: number;
  fitCounts: Record<string, number>;
  topJobs: TopJob[];
}

const FIT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "STRONG FIT": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "GOOD FIT": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  BORDERLINE: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  "WEAK FIT": { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
};

function formatDuration(ms: number | null) {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardHomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-6 lg:p-8 h-full overflow-auto">
        <div className="mb-8">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-4 w-32 bg-muted animate-pulse rounded mt-2" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  const fitEntries = [
    { key: "STRONG FIT", label: "Strong Fit" },
    { key: "GOOD FIT", label: "Good Fit" },
    { key: "BORDERLINE", label: "Borderline" },
    { key: "WEAK FIT", label: "Weak Fit" },
  ];

  return (
    <div className="p-6 lg:p-8 h-full overflow-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6" />
          Dashboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your job search overview
        </p>
      </div>

      {/* Last Run */}
      {data?.lastRun && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {data.lastRun.status === "running" && (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                )}
                {data.lastRun.status === "completed" && (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                )}
                {data.lastRun.status === "failed" && (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    Last {data.lastRun.trigger_type === "scheduled" ? "scheduled" : "on-demand"} run
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo(data.lastRun.started_at)}
                    </span>
                    {data.lastRun.duration_ms && (
                      <span>({formatDuration(data.lastRun.duration_ms)})</span>
                    )}
                    <Badge
                      variant={
                        data.lastRun.status === "completed"
                          ? "strong"
                          : data.lastRun.status === "running"
                          ? "default"
                          : "destructive"
                      }
                      className="text-xs"
                    >
                      {data.lastRun.status}
                    </Badge>
                  </div>
                </div>
              </div>
              {data.lastRun.stats && (
                <div className="flex gap-6 text-sm">
                  {data.lastRun.stats.jobsFound !== undefined && (
                    <div className="text-center">
                      <div className="font-bold text-lg">{data.lastRun.stats.jobsFound}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                  )}
                  {data.lastRun.stats.jobsEvaluated !== undefined && (
                    <div className="text-center">
                      <div className="font-bold text-lg">{data.lastRun.stats.jobsEvaluated}</div>
                      <div className="text-xs text-muted-foreground">Evaluated</div>
                    </div>
                  )}
                  {data.lastRun.stats.jobsSkippedDuplicate !== undefined && (
                    <div className="text-center">
                      <div className="font-bold text-lg">{data.lastRun.stats.jobsSkippedDuplicate}</div>
                      <div className="text-xs text-muted-foreground">Duplicates</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {data.lastRun.error && (
              <p className="text-xs text-destructive mt-2">{data.lastRun.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Weekly stats */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Past 7 Days — {data?.weekTotal || 0} jobs found
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {fitEntries.map(({ key, label }) => {
            const count = data?.fitCounts[key] || 0;
            const colors = FIT_COLORS[key];
            return (
              <Link
                key={key}
                href={`/jobs?fitCategory=${encodeURIComponent(key)}&postedWithin=1w`}
              >
                <Card className={`hover:shadow-md transition-shadow cursor-pointer border ${colors.border}`}>
                  <CardContent className={`p-4 ${colors.bg}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-3xl font-bold ${colors.text}`}>{count}</p>
                        <p className={`text-sm font-medium ${colors.text} opacity-80`}>{label}</p>
                      </div>
                      <ArrowRight className={`h-4 w-4 ${colors.text} opacity-50`} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Top strong fit jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Strongest Matches — Last 30 Days
          </h2>
          <Link
            href="/jobs?fitCategory=STRONG+FIT&postedWithin=30d"
            className="text-xs text-primary hover:underline"
          >
            View all
          </Link>
        </div>

        {data?.topJobs && data.topJobs.length > 0 ? (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Score</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Position</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Company</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Posted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => setDetailJobId(job.id)}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold">
                        {job.total_score !== null ? Math.round(job.total_score) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">
                        {job.position}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {job.company_logo ? (
                          <img src={job.company_logo} alt="" className="h-5 w-5 rounded object-cover" />
                        ) : (
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm text-muted-foreground">{job.company}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted-foreground">
                        {job.location || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {job.date_posted
                          ? new Date(job.date_posted).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Briefcase className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No strong fit jobs found in the last 30 days.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Run your searches to start finding matches.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <JobDetailPanel
        jobId={detailJobId}
        onClose={() => setDetailJobId(null)}
      />
    </div>
  );
}
