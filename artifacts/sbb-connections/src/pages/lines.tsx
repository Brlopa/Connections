import { useState } from "react";
import { Search } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineCard } from "@/components/LineCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { LineDetails, Line } from "@workspace/api-client-react/src/generated/api.schemas";

// Mock data for demonstration
const MOCK_LINES: Line[] = [
  {
    id: "1",
    number: "S10",
    category: "S",
    operator: "SBB",
    from: "Thun",
    to: "Frick",
    stops: 28,
  },
  {
    id: "2",
    number: "ICE1060",
    category: "ICE",
    operator: "SBB",
    from: "Basel SBB",
    to: "Zurich HB",
    stops: 8,
  },
  {
    id: "3",
    number: "13",
    category: "TRAM",
    operator: "VBZ",
    from: "Stauffacher",
    to: "Albisgütli",
    stops: 19,
  },
  {
    id: "4",
    number: "105",
    category: "BUS",
    operator: "ZVV",
    from: "Wiedikon",
    to: "Triemli",
    stops: 12,
  },
];

// Mock line details
const MOCK_LINE_DETAILS: Record<string, LineDetails> = {
  "1": {
    id: "1",
    number: "S10",
    category: "S",
    categoryCode: 4,
    operator: "SBB",
    from: {
      id: "8500120",
      name: "Thun",
      type: "station",
      coordinate: { type: "WGS84", x: 46.757, y: 7.627 },
    },
    to: {
      id: "8500168",
      name: "Frick",
      type: "station",
      coordinate: { type: "WGS84", x: 47.527, y: 8.094 },
    },
    passList: [
      {
        station: { id: "8500120", name: "Thun", type: "station", coordinate: { type: "WGS84", x: 46.757, y: 7.627 } },
        departure: "2024-04-19T08:00:00Z",
        departureTimestamp: 1713607200,
      },
      {
        station: { id: "8500109", name: "Interlaken West", type: "station", coordinate: { type: "WGS84", x: 46.682, y: 7.863 } },
        arrival: "2024-04-19T08:15:00Z",
        departure: "2024-04-19T08:16:00Z",
        arrivalTimestamp: 1713608100,
        departureTimestamp: 1713608160,
      },
      {
        station: { id: "8500500", name: "Meiringen", type: "station", coordinate: { type: "WGS84", x: 46.735, y: 8.307 } },
        arrival: "2024-04-19T08:35:00Z",
        departure: "2024-04-19T08:36:00Z",
        arrivalTimestamp: 1713609300,
        departureTimestamp: 1713609360,
      },
      {
        station: { id: "8500380", name: "Wilnsdorf", type: "station", coordinate: { type: "WGS84", x: 46.882, y: 8.034 } },
        arrival: "2024-04-19T09:02:00Z",
        departure: "2024-04-19T09:03:00Z",
        arrivalTimestamp: 1713611100,
        departureTimestamp: 1713611160,
      },
      {
        station: { id: "8500165", name: "Brugg AG", type: "station", coordinate: { type: "WGS84", x: 47.481, y: 8.208 } },
        arrival: "2024-04-19T09:22:00Z",
        departure: "2024-04-19T09:23:00Z",
        arrivalTimestamp: 1713612120,
        departureTimestamp: 1713612180,
      },
      {
        station: { id: "8500168", name: "Frick", type: "station", coordinate: { type: "WGS84", x: 47.527, y: 8.094 } },
        arrival: "2024-04-19T09:35:00Z",
        arrivalTimestamp: 1713612900,
      },
    ],
  },
};

type ExpandedView = "details" | "map" | "both";

export default function LinesPage() {
  const [query, setQuery] = useState("");
  const [expandedView, setExpandedView] = useState<ExpandedView>("both");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filteredLines, setFilteredLines] = useState<Line[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setHasSearched(true);

    // Simulate API call
    setTimeout(() => {
      const results = MOCK_LINES.filter(
        (line) =>
          line.number?.includes(query) ||
          line.operator?.includes(query) ||
          line.from?.includes(query) ||
          line.to?.includes(query)
      );
      setFilteredLines(results);
      setSelectedLineId(null);
      setIsLoading(false);
    }, 500);
  };

  const getLineDetails = (lineId: string): LineDetails | null => {
    return MOCK_LINE_DETAILS[lineId] || null;
  };

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
              />
              <Button type="submit" disabled={!query.trim() || isLoading}>
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </div>

          {/* View Options - Only show when we have search results */}
          {hasSearched && filteredLines.length > 0 && (
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
          {isLoading && (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          )}

          {!isLoading && hasSearched && filteredLines.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                No lines found matching "{query}". Try a different search term.
              </p>
            </div>
          )}

          {!isLoading &&
            filteredLines.map((line) => {
              const lineDetails = getLineDetails(line.id);
              const isExpanded = selectedLineId === line.id;

              return lineDetails ? (
                <LineCard
                  key={line.id}
                  line={lineDetails}
                  isExpanded={isExpanded}
                  onToggle={() => setSelectedLineId(isExpanded ? null : line.id)}
                  expandedView={expandedView}
                  onViewChange={setExpandedView}
                />
              ) : null;
            })}
        </div>

        {/* Initial state - show tips */}
        {!hasSearched && (
          <div className="bg-muted/50 rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Enter a line number, operator name, or destination to get started.
            </p>
            <p className="text-xs text-muted-foreground">
              Try searching for: <code className="bg-background px-2 py-1 rounded">S10</code>,{" "}
              <code className="bg-background px-2 py-1 rounded">ICE1060</code>, or{" "}
              <code className="bg-background px-2 py-1 rounded">SBB</code>
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
