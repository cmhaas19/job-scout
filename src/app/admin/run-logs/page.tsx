"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SortableHeader } from "@/components/ui/sortable-header";
import { formatDuration, formatShortDate, STALE_RUN_THRESHOLD_MS } from "@/lib/constants";
import {
  History,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Ban,
  RotateCw,
} from "lucide-react";

interface RunLog {
  id: string;
  user_id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  last_heartbeat_at: string | null;
  cancel_requested: boolean;
  stats: any;
  error: string | null;
  profiles: { email: string };
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "cancelled") return <Ban className="h-4 w-4 text-muted-foreground" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

// For a running row, returns how long it's been since the last heartbeat and
// whether that exceeds the stale threshold (i.e. the run is likely dead).
function staleness(log: RunLog): { stale: boolean; mins: number } {
  const last = log.last_heartbeat_at ?? log.started_at;
  const ms = Date.now() - new Date(last).getTime();
  return { stale: ms > STALE_RUN_THRESHOLD_MS, mins: Math.floor(ms / 60000) };
}

const PAGE_SIZE = 50;

export default function AdminRunLogsPage() {
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("started_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [actionId, setActionId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    const res = await fetch(`/api/admin/run-logs?page=${page}`);
    const data = await res.json();
    setLogs(data.logs || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setLoading(false);
  }, [page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Poll while any run is in progress so cancels / heartbeats / auto-heals show
  // up without a manual refresh.
  const hasRunning = logs.some((l) => l.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(loadLogs, 10000);
    return () => clearInterval(t);
  }, [hasRunning, loadLogs]);

  async function handleKill(id: string) {
    if (!confirm("Kill this run? A live run will stop at its next checkpoint; a stuck run is cleared immediately.")) return;
    setActionId(id);
    try {
      await fetch(`/api/admin/run-logs/${id}/cancel`, { method: "POST" });
      await loadLogs();
    } finally {
      setActionId(null);
    }
  }

  async function handleRerun(id: string) {
    setActionId(id);
    try {
      await fetch(`/api/admin/run-logs/${id}/rerun`, { method: "POST" });
      await loadLogs();
    } finally {
      setActionId(null);
    }
  }

  function handleSort(field: string) {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  }

  // Client-side sort within current page
  const sorted = [...logs].sort((a, b) => {
    let aVal: any;
    let bVal: any;
    switch (sortBy) {
      case "started_at": aVal = new Date(a.started_at).getTime(); bVal = new Date(b.started_at).getTime(); break;
      case "status": aVal = a.status; bVal = b.status; break;
      case "trigger_type": aVal = a.trigger_type; bVal = b.trigger_type; break;
      case "duration_ms": aVal = a.duration_ms ?? 0; bVal = b.duration_ms ?? 0; break;
      case "user": aVal = a.profiles?.email || ""; bVal = b.profiles?.email || ""; break;
      case "jobsFound": aVal = a.stats?.jobsFound ?? 0; bVal = b.stats?.jobsFound ?? 0; break;
      case "jobsEvaluated": aVal = a.stats?.jobsEvaluated ?? 0; bVal = b.stats?.jobsEvaluated ?? 0; break;
      default: aVal = 0; bVal = 0;
    }
    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const startRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-6 lg:p-8 pb-0">
        <div className="mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6" />
            System Run Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {total} run{total !== 1 ? "s" : ""} across all users
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 px-6 lg:px-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-border">
              <div className="h-4 w-4 bg-muted animate-pulse rounded-full" />
              <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-4 w-36 bg-muted animate-pulse rounded" />
              <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              <div className="h-4 w-12 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardContent className="py-16 text-center">
              <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">No runs yet</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto px-6 lg:px-8">
            <table className="w-full min-w-[800px]">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="px-3 py-3 w-[40px]"></th>
                  <SortableHeader label="Status" field="status" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[110px]" />
                  <SortableHeader label="User" field="user" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[200px]" />
                  <SortableHeader label="Type" field="trigger_type" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[110px]" />
                  <SortableHeader label="Started" field="started_at" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[160px]" />
                  <SortableHeader label="Duration" field="duration_ms" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[100px]" />
                  <SortableHeader label="Found" field="jobsFound" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[80px]" />
                  <SortableHeader label="Evaluated" field="jobsEvaluated" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[100px]" />
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Phase / Error</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider w-[140px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/50">
                    <td className="px-3 py-2.5">
                      <StatusIcon status={log.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={
                          log.status === "completed"
                            ? "strong"
                            : log.status === "running"
                            ? "default"
                            : log.status === "cancelled"
                            ? "secondary"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        {log.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground truncate">
                        {log.profiles?.email || log.user_id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground">
                        {log.trigger_type === "scheduled" ? "Scheduled" : "On-Demand"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(log.started_at)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground">
                        {formatDuration(log.duration_ms)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium">
                        {log.stats?.jobsFound ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium">
                        {log.stats?.jobsEvaluated ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {log.error ? (
                        <span className="text-xs text-destructive line-clamp-1">{log.error}</span>
                      ) : log.status === "running" ? (
                        (() => {
                          const { stale, mins } = staleness(log);
                          const phase = log.stats?.phase?.replace(/_/g, " ") || "running";
                          return (
                            <span className="text-xs whitespace-nowrap">
                              <span className="text-muted-foreground capitalize">{phase}</span>
                              <span className={stale ? "text-destructive font-medium" : "text-emerald-600"}>
                                {" · "}
                                {stale ? `stalled ${mins}m` : "active"}
                              </span>
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-xs text-muted-foreground capitalize whitespace-nowrap">
                          {log.stats?.phase?.replace(/_/g, " ") || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {log.status === "running" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            disabled={actionId === log.id}
                            onClick={() => handleKill(log.id)}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" />
                            Kill
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={actionId === log.id}
                          onClick={() => handleRerun(log.id)}
                        >
                          <RotateCw className="h-3.5 w-3.5 mr-1" />
                          Re-run
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fixed footer */}
          <div className="shrink-0 border-t bg-background px-6 lg:px-8 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {startRow}–{endRow} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
