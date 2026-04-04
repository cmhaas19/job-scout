"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { JobDetailPanel } from "@/components/job-detail-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { SortableHeader } from "@/components/ui/sortable-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FIT_COLORS, formatShortDate } from "@/lib/constants";
import { readSSEStream } from "@/lib/sse";
import { useToast } from "@/components/ui/toast";
import {
  LayoutDashboard,
  Search,
  Star,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Archive,
  ArchiveRestore,
  LinkIcon,
} from "lucide-react";

interface Job {
  id: string;
  position: string;
  company: string;
  location: string | null;
  salary: string | null;
  fit_category: string | null;
  total_score: number | null;
  ago_time: string | null;
  date_posted: string | null;
  user_rating: number | null;
  search_query: string | null;
  job_url: string;
  company_logo: string | null;
  skipped: boolean;
  archived: boolean;
  created_at: string;
  prompt_version: number | null;
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

const PAGE_SIZE = 100;

type ReEvalStatus = "idle" | "running" | "completed" | "error";

export default function JobsPage() {
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Initialize filters from URL params
  const [companyFilter, setCompanyFilter] = useState(searchParams.get("company") || "");
  const [locationFilter, setLocationFilter] = useState(searchParams.get("location") || "");
  const [searchQueryFilter, setSearchQueryFilter] = useState(searchParams.get("searchQuery") || "");
  const [promptVersionFilter, setPromptVersionFilter] = useState(searchParams.get("promptVersion") || "");
  const [postedWithinFilter, setPostedWithinFilter] = useState(searchParams.get("postedWithin") || "");
  const [fitCategoryFilter, setFitCategoryFilter] = useState(searchParams.get("fitCategory") || "");
  const [sortBy, setSortBy] = useState("total_score");
  const [sortOrder, setSortOrder] = useState("desc");
  const [showSkipped, setShowSkipped] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const hasUrlFilters = !!(searchParams.get("company") || searchParams.get("location") || searchParams.get("searchQuery") || searchParams.get("promptVersion") || searchParams.get("postedWithin") || searchParams.get("fitCategory"));
  const [showFilters, setShowFilters] = useState(hasUrlFilters);

  // Filter options
  const [filterOptions, setFilterOptions] = useState<{
    companies: string[];
    locations: string[];
    searches: string[];
    promptVersions: string[];
  }>({ companies: [], locations: [], searches: [], promptVersions: [] });

  // Selection for re-evaluation
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail panel
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  // Import job modal
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");

  // Re-evaluate modal
  const [reEvalStatus, setReEvalStatus] = useState<ReEvalStatus>("idle");
  const [reEvalLogs, setReEvalLogs] = useState<string[]>([]);
  const [showReEval, setShowReEval] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadFilters = useCallback(async () => {
    const res = await fetch("/api/jobs/filters");
    if (res.ok) {
      setFilterOptions(await res.json());
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    if (companyFilter) params.set("company", companyFilter);
    if (locationFilter) params.set("location", locationFilter);
    if (searchQueryFilter) params.set("searchQuery", searchQueryFilter);
    if (promptVersionFilter) params.set("promptVersion", promptVersionFilter);
    if (postedWithinFilter) params.set("postedWithin", postedWithinFilter);
    if (fitCategoryFilter) params.set("fitCategory", fitCategoryFilter);
    if (showSkipped) params.set("skipped", "true");
    if (showArchived) params.set("showArchived", "true");

    const res = await fetch(`/api/jobs?${params.toString()}`);
    const data = await res.json();
    setJobs(data.jobs || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setLoading(false);
  }, [page, companyFilter, locationFilter, searchQueryFilter, promptVersionFilter, postedWithinFilter, fitCategoryFilter, sortBy, sortOrder, showSkipped, showArchived]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    setPage(1);
  }, [companyFilter, locationFilter, searchQueryFilter, promptVersionFilter, postedWithinFilter, fitCategoryFilter, sortBy, sortOrder, showSkipped, showArchived]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [reEvalLogs]);

  function handleSort(field: string) {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === jobs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  }

  async function handleReEvaluate() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setReEvalLogs([]);
    setReEvalStatus("running");
    setShowReEval(true);

    try {
      const res = await fetch("/api/jobs/re-evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: ids }),
      });

      if (!res.ok) {
        const data = await res.json();
        setReEvalLogs([data.error || "Re-evaluation failed"]);
        setReEvalStatus("error");
        return;
      }

      const status = await readSSEStream(res, {
        onLog: (msg) => setReEvalLogs((prev) => [...prev, msg]),
        onComplete: () => setReEvalStatus("completed"),
        onError: (msg) => { setReEvalLogs((prev) => [...prev, msg]); setReEvalStatus("error"); },
      });

      setReEvalStatus(status);
    } catch (err: any) {
      setReEvalLogs((prev) => [...prev, `Error: ${err.message}`]);
      setReEvalStatus("error");
    }
  }

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImportLoading(true);
    setImportError("");
    try {
      const res = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error);
        setImportLoading(false);
        return;
      }
      setShowImport(false);
      setImportUrl("");
      setImportLoading(false);
      if (data.existing) {
        showToast("This job already exists in your list");
      } else {
        showToast("Job imported and evaluated");
        loadJobs();
      }
      setDetailJobId(data.jobId);
    } catch {
      setImportError("Something went wrong");
      setImportLoading(false);
    }
  }

  async function handleArchive(id: string, archived: boolean, e?: React.MouseEvent) {
    e?.stopPropagation();
    const job = jobs.find((j) => j.id === id);
    await fetch(`/api/jobs/${id}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    loadJobs();
    if (job && archived) {
      showToast(`${job.position} at ${job.company} was archived`, {
        label: "Undo",
        onClick: async () => {
          await fetch(`/api/jobs/${id}/archive`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: false }),
          });
          loadJobs();
        },
      });
    }
  }

  async function handleBulkArchive() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/jobs/${id}/archive`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        })
      )
    );
    const count = ids.length;
    setSelectedIds(new Set());
    loadJobs();
    showToast(`${count} job${count === 1 ? "" : "s"} archived`, {
      label: "Undo",
      onClick: async () => {
        await Promise.all(
          ids.map((id) =>
            fetch(`/api/jobs/${id}/archive`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ archived: false }),
            })
          )
        );
        loadJobs();
      },
    });
  }

  function closeReEval() {
    setShowReEval(false);
    setReEvalStatus("idle");
    setSelectedIds(new Set());
    loadJobs();
  }

  const activeFilterCount = [companyFilter, locationFilter, searchQueryFilter, promptVersionFilter, postedWithinFilter, fitCategoryFilter].filter(Boolean).length;

  function clearFilters() {
    setCompanyFilter("");
    setLocationFilter("");
    setSearchQueryFilter("");
    setPromptVersionFilter("");
    setPostedWithinFilter("");
    setFitCategoryFilter("");
  }

  const startRow = (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, total);
  const allSelected = jobs.length > 0 && selectedIds.size === jobs.length;

  return (
    <div className="flex flex-col h-screen lg:h-screen">
      {/* Header */}
      <div className="shrink-0 p-6 lg:p-8 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutDashboard className="h-6 w-6" />
              Jobs
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {total} job{total !== 1 ? "s" : ""} found
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkArchive}
                >
                  <Archive className="h-4 w-4 mr-2" />
                  Archive ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  onClick={handleReEvaluate}
                  disabled={reEvalStatus === "running"}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Re-evaluate ({selectedIds.size})
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowImport(true); setImportError(""); setImportUrl(""); }}
            >
              <LinkIcon className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">Filters</span>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-7 px-2">
                    Clear all
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Select
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">All Companies</option>
                  {filterOptions.companies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
                <Select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="">All Locations</option>
                  {filterOptions.locations.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </Select>
                <Select
                  value={searchQueryFilter}
                  onChange={(e) => setSearchQueryFilter(e.target.value)}
                >
                  <option value="">All Searches</option>
                  {filterOptions.searches.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
                <Select
                  value={promptVersionFilter}
                  onChange={(e) => setPromptVersionFilter(e.target.value)}
                >
                  <option value="">All Prompt Versions</option>
                  {filterOptions.promptVersions.map((v) => (
                    <option key={v} value={v}>v{v}</option>
                  ))}
                </Select>
                <Select
                  value={fitCategoryFilter}
                  onChange={(e) => setFitCategoryFilter(e.target.value)}
                >
                  <option value="">All Fit Categories</option>
                  <option value="STRONG FIT">Strong Fit</option>
                  <option value="GOOD FIT">Good Fit</option>
                  <option value="BORDERLINE">Borderline</option>
                  <option value="WEAK FIT">Weak Fit</option>
                </Select>
                <Select
                  value={postedWithinFilter}
                  onChange={(e) => setPostedWithinFilter(e.target.value)}
                >
                  <option value="">Anytime</option>
                  <option value="1d">1 day ago</option>
                  <option value="3d">3 days ago</option>
                  <option value="1w">1 week ago</option>
                  <option value="30d">30 days ago</option>
                </Select>
                <Button
                  variant={showSkipped ? "default" : "outline"}
                  size="sm"
                  className="whitespace-nowrap h-10"
                  onClick={() => setShowSkipped(!showSkipped)}
                >
                  {showSkipped ? "Showing Skipped" : "Show Skipped"}
                </Button>
                <Button
                  variant={showArchived ? "default" : "outline"}
                  size="sm"
                  className="whitespace-nowrap h-10"
                  onClick={() => setShowArchived(!showArchived)}
                >
                  {showArchived ? "Showing Archived" : "Show Archived"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Table area */}
      {loading ? (
        <div className="flex-1 px-6 lg:px-8">
          <div className="space-y-0">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-border">
                <div className="h-4 w-4 bg-muted animate-pulse rounded" />
                <div className="h-4 w-10 bg-muted animate-pulse rounded" />
                <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
                <div className="h-4 flex-1 bg-muted animate-pulse rounded max-w-[250px]" />
                <div className="h-4 w-28 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                <div className="h-4 w-8 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardContent className="py-16 text-center">
              <LayoutDashboard className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">No jobs yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Run a search to start finding jobs
              </p>
              <Link href="/setup/searches">
                <Button>
                  <Search className="h-4 w-4 mr-2" />
                  Go to Searches
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Scrollable table */}
          <div className="flex-1 overflow-auto px-6 lg:px-8">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr>
                  <th className="px-3 py-3 w-[40px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                    />
                  </th>
                  <SortableHeader label="Score" field="total_score" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[70px]" />
                  <SortableHeader label="Position" field="position" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                  <SortableHeader label="Company" field="company" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[180px]" />
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[160px]">Location</th>
                  <SortableHeader label="Posted" field="date_posted" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[100px]" />
                  <SortableHeader label="Rating" field="user_rating" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[90px]" />
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-[120px]">Search</th>
                  <SortableHeader label="Prompt" field="prompt_version" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[70px]" />
                  <th className="px-3 py-3 w-[50px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`hover:bg-muted/50 cursor-pointer ${selectedIds.has(job.id) ? "bg-primary/5" : ""} ${job.archived ? "opacity-50" : ""}`}
                    onClick={() => setDetailJobId(job.id)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.id)}
                        onChange={() => {}}
                        onClick={(e) => toggleSelect(job.id, e)}
                        className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                      />
                    </td>

                    {/* Score with fit color */}
                    <td className="px-3 py-2.5">
                      {job.total_score !== null ? (
                        <span
                          className={`inline-flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold ${
                            FIT_COLORS[job.fit_category || ""]
                              ? `${FIT_COLORS[job.fit_category!].bg} ${FIT_COLORS[job.fit_category!].text}`
                              : "bg-muted text-muted-foreground"
                          }`}
                          title={job.fit_category || undefined}
                        >
                          {Math.round(job.total_score)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Position */}
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium line-clamp-1">
                        {job.position}
                      </span>
                    </td>

                    {/* Company */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {job.company_logo && (
                          <img
                            src={job.company_logo}
                            alt=""
                            className="h-5 w-5 rounded object-cover shrink-0"
                          />
                        )}
                        <span className="text-sm text-muted-foreground line-clamp-1">
                          {job.company}
                        </span>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-3 py-2.5">
                      <span className="text-sm text-muted-foreground line-clamp-1">
                        {job.location || "—"}
                      </span>
                    </td>

                    {/* Posted */}
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(job.date_posted)}
                      </span>
                    </td>

                    {/* Rating */}
                    <td className="px-3 py-2.5">
                      <StarRating rating={job.user_rating} />
                    </td>

                    {/* Search */}
                    <td className="px-3 py-2.5">
                      {job.search_query ? (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {job.search_query}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Prompt version */}
                    <td className="px-3 py-2.5">
                      {job.prompt_version ? (
                        <span className="text-xs text-muted-foreground">
                          v{job.prompt_version}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Archive */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={(e) => handleArchive(job.id, !job.archived, e)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title={job.archived ? "Unarchive" : "Archive"}
                      >
                        {job.archived ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
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
              {selectedIds.size > 0 && (
                <span className="ml-2 text-primary font-medium">
                  ({selectedIds.size} selected)
                </span>
              )}
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

      {/* Re-evaluate progress modal */}
      <Dialog open={showReEval} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl" onClose={reEvalStatus !== "running" ? closeReEval : undefined}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              {reEvalStatus === "running" && (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              {reEvalStatus === "completed" && (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
              {reEvalStatus === "error" && (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <DialogTitle>
                {reEvalStatus === "running"
                  ? "Re-evaluating Jobs..."
                  : reEvalStatus === "completed"
                  ? "Re-evaluation Complete"
                  : reEvalStatus === "error"
                  ? "Re-evaluation Failed"
                  : "Re-evaluate"}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="bg-zinc-950 rounded-lg p-4 mt-2 max-h-[400px] overflow-y-auto font-mono text-xs">
            {reEvalLogs.length === 0 && reEvalStatus === "running" && (
              <span className="text-zinc-500">Starting re-evaluation...</span>
            )}
            {reEvalLogs.map((line, i) => {
              let color = "text-zinc-300";
              if (line.includes("✓")) color = "text-emerald-400";
              else if (line.includes("✗") || line.includes("Error")) color = "text-red-400";
              else if (line.includes("complete")) color = "text-emerald-400 font-semibold";

              return (
                <div key={i} className={`${color} leading-5`}>
                  {line}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>

          {reEvalStatus !== "running" && (
            <div className="flex justify-end mt-2">
              <Button onClick={closeReEval}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Import job modal */}
      <Dialog open={showImport} onOpenChange={(open) => { if (!open) setShowImport(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import LinkedIn Job</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">
            Paste a LinkedIn job posting URL to import and evaluate it.
          </p>
          <div className="mt-4">
            <Input
              placeholder="https://www.linkedin.com/jobs/view/..."
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
              disabled={importLoading}
              autoFocus
            />
            {importError && (
              <p className="text-sm text-destructive mt-2">{importError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setShowImport(false)} disabled={importLoading}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importLoading || !importUrl.trim()}>
              {importLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Job detail slide-out panel */}
      <JobDetailPanel
        jobId={detailJobId}
        onClose={() => setDetailJobId(null)}
        onArchiveChange={loadJobs}
      />
    </div>
  );
}
