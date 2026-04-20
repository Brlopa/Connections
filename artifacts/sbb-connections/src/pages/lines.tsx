import { useState } from "react";
import { Search } from "lucide-react";
import { useSearchLines, getSearchLinesQueryKey, useGetLineDetails, getGetLineDetailsQueryKey, sanitizeSearchQuery, safeArray, safeString, LineDetails, Line } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineCard } from "@/components/LineCard";
import { Skeleton } from "@/components/ui/skeleton";

type ExpandedView = "details" | "map" | "both";

export default function LinesPage() {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<ExpandedView>("both");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Search for lines
  const { data: searchData, isLoading: isSearchLoading, isError: isSearchError } = useSearchLines(
    { query: searchQuery || "" },
    {
      query: {
        enabled: !!searchQuery,
        queryKey: getSearchLinesQueryKey({ query: searchQuery || "" }),
        retry: 1,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
      },
    }
  );

  // Get details for selected line
  const { data: lineDetails, isLoading: isDetailsLoading, isError: isDetailsError } = useGetLineDetails(
    { id: selectedLineId || "", date: new Date().toISOString().split("T")[0] },
    {
      query: {
        enabled: !!selectedLineId,
        queryKey: getGetLineDetailsQueryKey({ id: selectedLineId || "" }),
        retry: 1,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
      },
    }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitized = sanitizeSearchQuery(query);
      if (sanitized.length > 1) {
        setSearchQuery(sanitized);
        setSelectedLineId(null);
      }
    } catch (error) {
      console.error("Error initiating search:", error);
    }
  };

  const lines = safeArray<Line>(searchData?.lines) || [];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Public Transport Lines</h1>
          <p className="text-muted-foreground mt-2">
            Search for lines by number, operator, or destination to view complete routes
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search">Search Lines</Label>
            <div className="flex gap-2">
              <Input
                id="search"
                placeholder="Enter line number (e.g., S10, 13, 105) or operator..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
              />
              <Button type="submit" disabled={!query.trim() || isSearchLoading}>
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </div>

          {/* View Options - Only show when we have search results */}
          {searchQuery && lines.length > 0 && (
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant={expandedView === "details" || expandedView === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => setExpandedView(expandedView === "details" ? "both" : "details")}
              >
                Details
              </Button>
              <Button
                type="button"
                variant={expandedView === "map" || expandedView === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => setExpandedView(expandedView === "map" ? "both" : "map")}
              >
                Map
              </Button>
            </div>
          )}
        </form>

        {/* Results */}
        <div className="space-y-3">
          {isSearchLoading && (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          )}

          {isSearchError && !isSearchLoading && (
            <div className="text-center py-12 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 font-medium">
              Failed to search lines. Please try again.
            </div>
          )}

          {!isSearchLoading && !isSearchError && searchQuery && lines.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No lines found matching "{searchQuery}". Try a different search term.
              </p>
            </div>
          )}

          {!isSearchLoading &&
            !isSearchError &&
            lines.map((line) => {
              const isExpanded = selectedLineId === line.id;
              const isSelected = isExpanded;
              const details = isSelected && lineDetails ? lineDetails : null;

              return (
                <div key={line.id}>
                  {isDetailsLoading && isSelected && (
                    <Skeleton className="h-32" />
                  )}

                  {isDetailsError && isSelected && !isDetailsLoading && (
                    <div className="text-center py-6 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 text-sm font-medium">
                      Failed to load line details. Try again.
                    </div>
                  )}

                  {details ? (
                    <LineCard
                      line={details}
                      isExpanded={isExpanded}
                      onToggle={() => setSelectedLineId(isExpanded ? null : line.id)}
                      expandedView={expandedView}
                      onViewChange={setExpandedView}
                    />
                  ) : (
                    <LineCard
                      line={{
                        id: line.id,
                        number: safeString(line.number),
                        category: safeString(line.category),
                        operator: safeString(line.operator),
                        from: { id: "", name: safeString(line.from), type: "station", coordinate: { type: "WGS84" } },
                        to: { id: "", name: safeString(line.to), type: "station", coordinate: { type: "WGS84" } },
                        passList: [],
                      }}
                      isExpanded={isExpanded}
                      onToggle={() => setSelectedLineId(isExpanded ? null : line.id)}
                      expandedView={expandedView}
                      onViewChange={setExpandedView}
                    />
                  )}
                </div>
              );
            })}
        </div>

        {/* Initial state - show tips */}
        {!searchQuery && (
          <div className="bg-muted/50 rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Enter a line number, operator name, or destination to get started.
            </p>
            <p className="text-xs text-muted-foreground">
              Try searching for: <code className="bg-background px-2 py-1 rounded">S10</code>,{" "}
              <code className="bg-background px-2 py-1 rounded">ICE</code>, or{" "}
              <code className="bg-background px-2 py-1 rounded">SBB</code>
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
