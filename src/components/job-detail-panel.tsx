"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FIT_COLORS, FIT_SCORE_COLORS, SCORE_LABELS, formatShortDate } from "@/lib/constants";
import {
  Building2,
  MapPin,
  ExternalLink,
  Star,
  Clock,
  Check,
  TrendingUp,
  TrendingDown,
  X,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface JobDetail {
  id: string;
  position: string;
  company: string;
  location: string | null;
  salary: string | null;
  fit_category: string | null;
  total_score: number | null;
  score_details: Record<string, number> | null;
  eval_summary: string | null;
  strengths: string[] | null;
  gaps: string[] | null;
  description: string | null;
  job_url: string;
  company_logo: string | null;
  ago_time: string | null;
  date_posted: string | null;
  user_rating: number | null;
  user_notes: string | null;
  search_query: string | null;
  prompt_version: number | null;
  skipped: boolean;
  skip_reason: string | null;
  archived: boolean;
}


interface JobDetailPanelProps {
  jobId: string | null;
  onClose: () => void;
  onArchiveChange?: () => void;
}

export function JobDetailPanel({ jobId, onClose, onArchiveChange }: JobDetailPanelProps) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setJob(null);
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setJob(data);
      setRating(data.user_rating);
      setNotes(data.user_notes || "");
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  // Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (jobId) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [jobId, onClose]);

  async function handleArchiveToggle() {
    if (!job) return;
    const res = await fetch(`/api/jobs/${job.id}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !job.archived }),
    });
    if (res.ok) {
      setJob({ ...job, archived: !job.archived });
      onArchiveChange?.();
    }
  }

  async function handleRate() {
    if (!jobId) return;
    setSaving(true);
    await fetch(`/api/jobs/${jobId}/rate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_rating: rating, user_notes: notes }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const isOpen = !!jobId;
  const barColor = FIT_SCORE_COLORS[job?.fit_category || ""] || "bg-primary";

  return (
    <>
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-full max-w-xl bg-background border-l shadow-2xl transform transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {isOpen && (
          <div className="flex flex-col h-full">
            {/* Panel header */}
            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-3 min-w-0">
                {job?.company_logo ? (
                  <img
                    src={job.company_logo}
                    alt=""
                    className="h-10 w-10 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="font-semibold text-sm truncate">
                    {job?.position || "Loading..."}
                  </h2>
                  <p className="text-xs text-muted-foreground truncate">
                    {job?.company}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {job && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleArchiveToggle}
                      title={job.archived ? "Unarchive" : "Archive"}
                    >
                      {job.archived ? (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />
                          Unarchive
                        </>
                      ) : (
                        <>
                          <Archive className="h-3.5 w-3.5 mr-1.5" />
                          Archive
                        </>
                      )}
                    </Button>
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        LinkedIn
                      </Button>
                    </a>
                  </>
                )}
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-6 space-y-4">
                  <div className="h-20 bg-muted animate-pulse rounded-lg" />
                  <div className="h-32 bg-muted animate-pulse rounded-lg" />
                  <div className="h-48 bg-muted animate-pulse rounded-lg" />
                </div>
              ) : job ? (
                <div className="p-6 space-y-6">
                  {/* Archived banner */}
                  {job.archived && (
                    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <Archive className="h-4 w-4" />
                      This job is archived
                    </div>
                  )}

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {job.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {job.location}
                      </span>
                    )}
                    {job.date_posted && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatShortDate(job.date_posted)}
                      </span>
                    )}
                    {job.search_query && (
                      <Badge variant="secondary" className="text-xs">
                        {job.search_query}
                      </Badge>
                    )}
                    {job.prompt_version && (
                      <span className="text-xs">Prompt v{job.prompt_version}</span>
                    )}
                  </div>

                  {/* Score + Fit */}
                  {job.total_score !== null && (
                    <div className={`rounded-lg border p-4 ${
                      FIT_COLORS[job.fit_category || ""]
                        ? `${FIT_COLORS[job.fit_category!].bg} ${FIT_COLORS[job.fit_category!].text} ${FIT_COLORS[job.fit_category!].border}`
                        : "bg-muted"
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold">
                            {Math.round(job.total_score)}
                          </span>
                          <span className="text-sm opacity-70">/100</span>
                        </div>
                        <span className="text-sm font-semibold">
                          {job.fit_category}
                        </span>
                      </div>

                      {/* Score breakdown */}
                      {job.score_details && (
                        <div className="space-y-2">
                          {Object.entries(SCORE_LABELS).map(
                            ([key, { label, max }]) => {
                              const score =
                                (job.score_details as Record<string, number>)?.[key] ?? 0;
                              const pct = (score / max) * 100;
                              return (
                                <div key={key}>
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <span>{label}</span>
                                    <span className="opacity-70">
                                      {score}/{max}
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-black/10 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${barColor}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Summary */}
                  {job.eval_summary && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                        AI Summary
                      </h3>
                      <p className="text-sm leading-relaxed">
                        {job.eval_summary}
                      </p>
                    </div>
                  )}

                  {/* Strengths & Gaps */}
                  {((job.strengths && job.strengths.length > 0) ||
                    (job.gaps && job.gaps.length > 0)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {job.strengths && job.strengths.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase text-emerald-600 mb-2 flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            Strengths
                          </h3>
                          <ul className="space-y-1.5">
                            {job.strengths.map((s, i) => (
                              <li
                                key={i}
                                className="text-xs flex items-start gap-1.5"
                              >
                                <Check className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {job.gaps && job.gaps.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase text-amber-600 mb-2 flex items-center gap-1">
                            <TrendingDown className="h-3 w-3" />
                            Gaps
                          </h3>
                          <ul className="space-y-1.5">
                            {job.gaps.map((g, i) => (
                              <li
                                key={i}
                                className="text-xs flex items-start gap-1.5 text-muted-foreground"
                              >
                                <span className="shrink-0 mt-0.5">-</span>
                                {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Rating */}
                  <div className="border-t pt-4">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                      Your Rating
                    </h3>
                    <div className="flex items-center gap-1 mb-3">
                      {[1, 2, 3, 4].map((i) => (
                        <button
                          key={i}
                          onClick={() => setRating(rating === i ? null : i)}
                          className="p-0.5 cursor-pointer"
                        >
                          <Star
                            className={`h-6 w-6 ${
                              rating && i <= rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/30 hover:text-amber-300"
                            }`}
                          />
                        </button>
                      ))}
                      {rating && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {rating === 4
                            ? "Excellent"
                            : rating === 3
                            ? "Good"
                            : rating === 2
                            ? "Poor"
                            : "Bad"}
                        </span>
                      )}
                    </div>
                    <Textarea
                      placeholder="Notes about this job (optional)..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="mb-2 text-sm"
                    />
                    <Button
                      onClick={handleRate}
                      disabled={saving}
                      size="sm"
                    >
                      {saving ? "Saving..." : saved ? "Saved!" : "Save Rating"}
                    </Button>
                  </div>

                  {/* Job Description */}
                  {job.description && (
                    <div className="border-t pt-4">
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                        Job Description
                      </h3>
                      <div className="prose prose-sm max-w-none prose-headings:font-bold prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-p:leading-relaxed prose-li:leading-relaxed text-sm">
                        <ReactMarkdown>{job.description}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center text-muted-foreground">
                  Job not found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
