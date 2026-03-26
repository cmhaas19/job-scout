"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SearchFormProps {
  initialData?: {
    id?: string;
    name: string;
    keyword: string;
    location: string;
    date_since_posted: string;
    job_type: string;
    remote_filter: string;
    experience_level: string[];
    result_limit: number;
    sort_by: string;
    is_active: boolean;
  };
}

const EXPERIENCE_LEVELS = [
  "internship",
  "entry level",
  "associate",
  "senior",
  "director",
  "executive",
];

export function SearchForm({ initialData }: SearchFormProps) {
  const router = useRouter();
  const isEditing = !!initialData?.id;

  const [form, setForm] = useState({
    name: initialData?.name ?? "",
    keyword: initialData?.keyword ?? "",
    location: initialData?.location ?? "",
    date_since_posted: initialData?.date_since_posted ?? "past week",
    job_type: initialData?.job_type ?? "",
    remote_filter: initialData?.remote_filter ?? "",
    experience_level: initialData?.experience_level ?? [],
    result_limit: initialData?.result_limit ?? 100,
    sort_by: initialData?.sort_by ?? "relevant",
    is_active: initialData?.is_active !== false,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleExperience(level: string) {
    setForm((prev) => ({
      ...prev,
      experience_level: prev.experience_level.includes(level)
        ? prev.experience_level.filter((l) => l !== level)
        : [...prev.experience_level, level],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const url = isEditing
      ? `/api/searches/${initialData!.id}`
      : "/api/searches";
    const method = isEditing ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
      setLoading(false);
      return;
    }

    router.push("/setup/searches");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEditing ? "Edit Search" : "New Search"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Search Name *</Label>
              <Input
                id="name"
                placeholder="e.g. Remote VP Product"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="keyword">Keywords *</Label>
              <Input
                id="keyword"
                placeholder='e.g. "VP Product" OR "Head of Product"'
                value={form.keyword}
                onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="e.g. San Diego, California, United States"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date_since_posted">Date Posted *</Label>
              <Select
                id="date_since_posted"
                value={form.date_since_posted}
                onChange={(e) =>
                  setForm({ ...form, date_since_posted: e.target.value })
                }
              >
                <option value="24hr">Past 24 hours</option>
                <option value="past week">Past week</option>
                <option value="past month">Past month</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="job_type">Job Type</Label>
              <Select
                id="job_type"
                value={form.job_type}
                onChange={(e) => setForm({ ...form, job_type: e.target.value })}
              >
                <option value="">Any</option>
                <option value="full time">Full Time</option>
                <option value="part time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="temporary">Temporary</option>
                <option value="volunteer">Volunteer</option>
                <option value="internship">Internship</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="remote_filter">Work Type</Label>
              <Select
                id="remote_filter"
                value={form.remote_filter}
                onChange={(e) =>
                  setForm({ ...form, remote_filter: e.target.value })
                }
              >
                <option value="">Any</option>
                <option value="on site">On Site</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_by">Sort By</Label>
              <Select
                id="sort_by"
                value={form.sort_by}
                onChange={(e) => setForm({ ...form, sort_by: e.target.value })}
              >
                <option value="relevant">Most Relevant</option>
                <option value="recent">Most Recent</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="result_limit">Result Limit</Label>
              <Input
                id="result_limit"
                type="number"
                min={1}
                max={100}
                value={form.result_limit}
                onChange={(e) =>
                  setForm({ ...form, result_limit: parseInt(e.target.value) || 100 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Experience Level</Label>
            <div className="flex flex-wrap gap-2">
              {EXPERIENCE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleExperience(level)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                    form.experience_level.includes(level)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-input hover:bg-muted"
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/setup/searches")}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? "Saving..."
                : isEditing
                ? "Update Search"
                : "Create Search"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
