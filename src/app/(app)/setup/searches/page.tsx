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
  MapPin,
  Clock,
  Briefcase,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
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

  // Auto-scroll log to bottom
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
    // Reset and open modal
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

      // Read SSE stream
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

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

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
              // ignore malformed events
            }
          }
        }
      }

      // If we exited the loop without a complete/error event
      if (runStatus === "running") {
        setRunStatus("completed");
      }
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
    <div className="p-6 lg:p-8 max-w-4xl mx-auto h-full overflow-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Saved Searches</h1>
          <p className="text-muted-foreground mt-1">
            Configure your LinkedIn job searches
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleRun()}
            disabled={runStatus === "running" || searches.filter((s) => s.is_active).length === 0}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Run All
          </Button>
          <Button onClick={() => router.push("/setup/searches/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Search
          </Button>
        </div>
      </div>

      {loading ? null : searches.length === 0 ? (
        <Card>
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
      ) : (
        <div className="space-y-3">
          {searches.map((search) => (
            <Card key={search.id} className={!search.is_active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">{search.name}</h3>
                      {search.is_active ? (
                        <Badge variant="strong" className="text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Paused</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2 truncate">
                      <Search className="h-3 w-3 inline mr-1" />
                      {search.keyword}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {search.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {search.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {search.date_since_posted}
                      </span>
                      {search.remote_filter && (
                        <Badge variant="secondary" className="text-xs">
                          {search.remote_filter}
                        </Badge>
                      )}
                      {search.job_type && (
                        <Badge variant="secondary" className="text-xs">
                          {search.job_type}
                        </Badge>
                      )}
                      {search.experience_level?.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {search.experience_level.join(", ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={search.is_active}
                      onCheckedChange={() => toggleActive(search)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRun(search.id)}
                      disabled={runStatus === "running"}
                      title="Run Now"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        router.push(`/setup/searches/${search.id}/edit`)
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(search.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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

          {/* Stats summary */}
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

          {/* Log output */}
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

          {/* Close button */}
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
