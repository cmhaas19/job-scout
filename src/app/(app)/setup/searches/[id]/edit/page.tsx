"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { SearchForm } from "@/components/search-form";

export default function EditSearchPage() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/searches");
      const data = await res.json();
      const found = data.find((s: any) => s.id === id);
      setSearch(found || null);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto h-full overflow-auto">
        <div className="h-8 w-48 bg-muted animate-pulse rounded mb-8" />
        <div className="h-96 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  if (!search) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto h-full overflow-auto">
        <p className="text-muted-foreground">Search not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto h-full overflow-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Edit Search</h1>
        <p className="text-muted-foreground mt-1">
          Update your search configuration
        </p>
      </div>
      <SearchForm initialData={search} />
    </div>
  );
}
