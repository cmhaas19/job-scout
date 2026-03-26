import { SearchForm } from "@/components/search-form";

export default function NewSearchPage() {
  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto h-full overflow-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">New Search</h1>
        <p className="text-muted-foreground mt-1">
          Configure a new LinkedIn job search
        </p>
      </div>
      <SearchForm />
    </div>
  );
}
