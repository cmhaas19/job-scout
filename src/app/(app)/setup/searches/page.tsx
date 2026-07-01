"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SearchForm, type SearchFormData } from "@/components/search-form";
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

type TriggerState = "idle" | "queuing" | "queued" | "error";

export default function SearchesPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Create/Edit modal state
  const [showForm, setShowForm] = useState(false);
  const [editingSearch, setEditingSearch] = useState<SearchFormData | null>(null);

  // Trigger (Inngest) modal state
  const [triggerState, setTriggerState] = useState<TriggerState>("idle");
  const [queuedCount, setQueuedCount] = useState(0);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [showTrigger, setShowTrigger] = useState(false);

  const loadSearches = useCallback(async () => {
    const res = await fetch("/api/searches");
    const data = await res.json();
    setSearches(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSearches();
  }, [loadSearches]);

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
    setTriggerError(null);
    setQueuedCount(0);
    setTriggerState("queuing");
    setShowTrigger(true);

    try {
      const res = await fetch("/api/scrape/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchId ? { searchId } : {}),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTriggerError(data.error || "Failed to queue scrape");
        setTriggerState("error");
        return;
      }

      setQueuedCount(data.count ?? 0);
      setTriggerState("queued");
    } catch (err: any) {
      setTriggerError(err.message);
      setTriggerState("error");
    }
  }

  function closeTrigger() {
    setShowTrigger(false);
    setTriggerState("idle");
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
              disabled={triggerState === "queuing" || searches.filter((s) => s.is_active).length === 0}
            >
              <PlayCircle className="h-4 w-4 mr-2" />
              Run All
            </Button>
            <Button size="sm" onClick={() => { setEditingSearch(null); setShowForm(true); }}>
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
              <Button onClick={() => { setEditingSearch(null); setShowForm(true); }}>
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
                          disabled={triggerState === "queuing"}
                          title="Run Now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => { setEditingSearch(search as SearchFormData); setShowForm(true); }}
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

      {/* Create/Edit modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onClose={() => setShowForm(false)}>
          <DialogHeader>
            <DialogTitle>
              {editingSearch ? "Edit Search" : "New Search"}
            </DialogTitle>
            <DialogDescription>
              {editingSearch
                ? "Update your search configuration"
                : "Configure a new LinkedIn job search"}
            </DialogDescription>
          </DialogHeader>
          <SearchForm
            initialData={editingSearch}
            onSave={() => {
              setShowForm(false);
              loadSearches();
            }}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

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

      {/* Queued confirmation modal */}
      <Dialog open={showTrigger} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" onClose={triggerState !== "queuing" ? closeTrigger : undefined}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              {triggerState === "queuing" && (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              {triggerState === "queued" && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
              {triggerState === "error" && (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <DialogTitle>
                {triggerState === "queuing"
                  ? "Queueing..."
                  : triggerState === "queued"
                  ? "Scrape Queued"
                  : "Couldn't Queue"}
              </DialogTitle>
            </div>
          </DialogHeader>

          {triggerState === "queued" && (
            <DialogDescription className="mt-1">
              {queuedCount} search{queuedCount !== 1 ? "es" : ""} queued. They run
              in the background — each search processes independently, and new
              matches appear in Jobs as they finish. Track live status in Run Logs.
            </DialogDescription>
          )}

          {triggerError && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3 mt-2">
              {triggerError}
            </div>
          )}

          {triggerState !== "queuing" && (
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={closeTrigger}>
                Close
              </Button>
              {triggerState === "queued" && (
                <Button onClick={() => { closeTrigger(); router.push("/admin/run-logs"); }}>
                  View Run Logs
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
