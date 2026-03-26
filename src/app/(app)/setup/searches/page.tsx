"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Play,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface SavedSearch {
  id: string;
  name: string;
  keyword: string;
  location: string | null;
  date_since_posted: string;
  job_type: string | null;
  remote_filter: string | null;
  experience_level: string[];
  result_limit: number;
  sort_by: string;
  is_active: boolean;
  created_at: string;
}

type RunStatus = "idle" | "running" | "completed" | "error";

export default function SearchesPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Progress modal state
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runLogs, setRunLogs] = useState<string[]>([]);
  const [runStats, setRunStats] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadSearches = useCallback(async () => {
    const res = await fetch("/api/searches");
    const data = await res.json();
    setSearches(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSearches();
  }, [loadSearches]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runLogs]);

  async function toggleActive(search: SavedSearch) {
    await fetch(`/api/searches/${search.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...search, is_active: !search.is_active }),
    });
    loadSearches();
  }

  async function handleDelete() {
    if (!deleteId) return;
    await fetch(`/api/searches/${deleteId}`, { method: "DELETE" });
    setDeleteId(null);
    loadSearches();
  }

  async function handleRun(searchId?: string) {
    setRunLogs([]);
    setRunStats(null);
    setRunError(null);
    setRunStatus("running");
    setShowProgress(true);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchId ? { searchId } : {}),
      });

      if (!res.ok) {
        const data = await res.json();
        setRunError(data.error || "Scrape failed");
        setRunStatus("error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setRunError("No response stream");
        setRunStatus("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "log") {
                setRunLogs((prev) => [...prev, event.message]);
              } else if (event.type === "complete") {
                setRunStats(event.stats);
                setRunStatus("completed");
              } else if (event.type === "error") {
                setRunError(event.message);
                setRunStatus("error");
              }
            } catch {
              // ignore
            }
          }
        }
      }

      if (runStatus === "running") setRunStatus("completed");
    } catch (err: any) {
      setRunError(err.message);
      setRunStatus("error");
    }
  }

  function closeProgress() {
    setShowProgress(false);
    setRunStatus("idle");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-6 lg:p-8 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Saved Searches</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {searches.length} search{searches.length !== 1 ? "es" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRun()}
              disabled={runStatus === "running" || searches.filter((s) => s.is_active).length === 0}
            >
              <PlayCircle className="h-4 w-4 mr-2" />
              Run All
            </Button>
            <Button size="sm" onClick={() => router.push("/setup/searches/new")}>
              <Plus className="h-4 w-4 mr-2" />
              New Search
            </Button>
          </div>
        </div>
      </div>

      {/* Table area */}
      {loading ? (
        <div className="flex-1 px-6 lg:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-border">
              <div className="h-5 w-10 bg-muted animate-pulse rounded" />
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 flex-1 bg-muted animate-pulse rounded max-w-[200px]" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : searches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardContent className="py-16 text-center">
              <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">No saved searches</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Create your first search to start finding jobs
              </p>
              <Button onClick={() => router.push("/setup/searches/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Create Search
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto px-6 lg:px-8">
            <table className="w-full min-w-[700px]">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[60px]">Active</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Keywords</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[160px]">Location</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[100px]">Posted</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[100px]">Work Type</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[100px]">Job Type</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider w-[130px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {searches.map((search) => (
                  <tr
                    key={search.id}
                    className={`hover:bg-muted/50 ${!search.is_active ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <Switch
                        checked={search.is_active}
                        onCheckedChange={() => toggleActive(search)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium">{search.name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground line-clamp-1">{search.keyword}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground line-clamp-1">
                        {search.location || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {search.date_since_posted}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">
                        {search.remote_filter || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">
                        {search.job_type || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRun(search.id)}
                          disabled={runStatus === "running"}
                          title="Run Now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => router.push(`/setup/searches/${search.id}/edit`)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setDeleteId(search.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fixed footer */}
          <div className="shrink-0 border-t bg-background px-6 lg:px-8 py-3">
            <span className="text-sm text-muted-foreground">
              {searches.length} search{searches.length !== 1 ? "es" : ""} ({searches.filter((s) => s.is_active).length} active)
            </span>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent onClose={() => setDeleteId(null)}>
          <DialogHeader>
            <DialogTitle>Delete Search</DialogTitle>
            <DialogDescription>
              Are you sure? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Progress modal */}
      <Dialog open={showProgress} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl" onClose={runStatus !== "running" ? closeProgress : undefined}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              {runStatus === "running" && (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              {runStatus === "completed" && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
              {runStatus === "error" && (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <DialogTitle>
                {runStatus === "running"
                  ? "Pipeline Running..."
                  : runStatus === "completed"
                  ? "Pipeline Complete"
                  : runStatus === "error"
                  ? "Pipeline Failed"
                  : "Pipeline"}
              </DialogTitle>
            </div>
          </DialogHeader>

          {runStats && (
            <div className="grid grid-cols-4 gap-3 mt-2">
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="text-xl font-bold">{runStats.jobsFound}</div>
                <div className="text-xs text-muted-foreground">Found</div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="text-xl font-bold">{runStats.jobsFiltered}</div>
                <div className="text-xs text-muted-foreground">After Filters</div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="text-xl font-bold">{runStats.jobsEvaluated}</div>
                <div className="text-xs text-muted-foreground">Evaluated</div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className="text-xl font-bold">
                  {runStats.jobsSkippedDuplicate +
                    runStats.jobsSkippedPublisher +
                    runStats.jobsSkippedComp +
                    runStats.jobsSkippedLocationDup}
                </div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
            </div>
          )}

          {runError && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3 mt-2">
              {runError}
            </div>
          )}

          <div className="bg-zinc-950 rounded-lg p-4 mt-2 max-h-[400px] overflow-y-auto font-mono text-xs">
            {runLogs.length === 0 && runStatus === "running" && (
              <span className="text-zinc-500">Waiting for pipeline to start...</span>
            )}
            {runLogs.map((line, i) => {
              let color = "text-zinc-300";
              if (line.includes("✓")) color = "text-emerald-400";
              else if (line.includes("✗") || line.includes("ERROR")) color = "text-red-400";
              else if (line.includes("Blocked") || line.includes("Comp filter")) color = "text-amber-400";
              else if (line.includes("Pipeline complete")) color = "text-emerald-400 font-semibold";
              else if (line.includes("Pipeline FAILED")) color = "text-red-400 font-semibold";
              else if (line.startsWith("Scraping") || line.startsWith("Fetching") || line.startsWith("Evaluating")) color = "text-blue-400";

              return (
                <div key={i} className={`${color} leading-5`}>
                  {line}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>

          {runStatus !== "running" && (
            <div className="flex justify-end mt-2">
              {runStatus === "completed" ? (
                <Button onClick={() => { closeProgress(); router.push("/jobs"); }}>
                  View Jobs
                </Button>
              ) : (
                <Button variant="outline" onClick={closeProgress}>
                  Close
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
