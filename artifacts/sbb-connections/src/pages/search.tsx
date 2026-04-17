import React, { useState } from "react";
import { format } from "date-fns";
import { ArrowRightLeft, Search, Calendar, Clock } from "lucide-react";
import { useSearchConnections, getSearchConnectionsQueryKey } from "@workspace/api-client-react";
import type { Location } from "@workspace/api-client-react/src/generated/api.schemas";
import { Layout } from "@/components/layout";
import { LocationSearch } from "@/components/LocationSearch";
import { ConnectionCard } from "@/components/ConnectionCard";
import { ConnectionMap } from "@/components/ConnectionMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SearchPage() {
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromStation, setFromStation] = useState<Location | null>(null);
  const [toStation, setToStation] = useState<Location | null>(null);

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState(format(new Date(), "HH:mm"));

  const [searchParams, setSearchParams] = useState<{ from: string; to: string; date: string; time: string } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { data, isLoading, isError } = useSearchConnections(
    searchParams || { from: "", to: "" },
    {
      query: {
        enabled: !!searchParams?.from && !!searchParams?.to,
        queryKey: getSearchConnectionsQueryKey(searchParams || { from: "", to: "" }),
      },
    }
  );

  const handleSwap = () => {
    const tempQuery = fromQuery;
    const tempStation = fromStation;
    setFromQuery(toQuery);
    setFromStation(toStation);
    setToQuery(tempQuery);
    setToStation(tempStation);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromQuery && toQuery) {
      setSelectedIdx(null);
      setSearchParams({
        from: fromStation?.name || fromQuery,
        to: toStation?.name || toQuery,
        date,
        time,
      });
    }
  };

  const handleSelectConnection = (idx: number) => {
    setSelectedIdx((prev) => (prev === idx ? null : idx));
  };

  const selectedConnection = selectedIdx !== null && data?.connections ? data.connections[selectedIdx] : null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Search form */}
        <div className="bg-card border rounded-xl p-4 md:p-6 shadow-sm">
          <form onSubmit={handleSearch} className="space-y-6">
            <div className="flex flex-col md:flex-row items-end gap-4">
              <LocationSearch
                id="from-station"
                label="From"
                placeholder="Station or stop"
                value={fromQuery}
                onChange={(val, loc) => {
                  setFromQuery(val);
                  if (loc) setFromStation(loc);
                }}
              />

              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0 rounded-full h-10 w-10 mb-1"
                onClick={handleSwap}
                title="Swap stations"
                data-testid="button-swap"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>

              <LocationSearch
                id="to-station"
                label="To"
                placeholder="Station or stop"
                value={toQuery}
                onChange={(val, loc) => {
                  setToQuery(val);
                  if (loc) setToStation(loc);
                }}
              />
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="date" className="text-sm font-semibold text-muted-foreground">
                  Date
                </Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    id="date"
                    data-testid="input-date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="pl-10 h-12 bg-background font-medium"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="time" className="text-sm font-semibold text-muted-foreground">
                  Time
                </Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="time"
                    id="time"
                    data-testid="input-time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="pl-10 h-12 bg-background font-medium"
                  />
                </div>
              </div>
              <div className="flex-[0.5] flex items-end">
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-bold"
                  disabled={!fromQuery || !toQuery}
                  data-testid="button-search"
                >
                  <Search className="mr-2 h-5 w-5" />
                  Search
                </Button>
              </div>
            </div>
          </form>
        </div>

        {/* Results */}
        <div className="space-y-4 min-h-[400px]">
          {isLoading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-card/50 animate-pulse rounded-xl border border-border" />
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-12 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 font-medium">
              Could not fetch connections. Please try again.
            </div>
          )}

          {!isLoading && !isError && searchParams && data?.connections?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
              No connections found for this route.
            </div>
          )}

          {!isLoading && !isError && data?.connections && data.connections.length > 0 && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <h2 className="text-xl font-bold tracking-tight mb-4">
                Connections from {data.from?.name || searchParams?.from} to {data.to?.name || searchParams?.to}
              </h2>

              {data.connections.map((connection, idx) => (
                <div key={idx}>
                  <ConnectionCard
                    connection={connection}
                    selected={selectedIdx === idx}
                    onClick={() => handleSelectConnection(idx)}
                  />

                  {/* Map expands inline below the selected connection */}
                  {selectedIdx === idx && (
                    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="rounded-xl border border-primary/30 overflow-hidden shadow-md">
                        {/* Map legend */}
                        <div className="bg-card px-4 py-2 border-b border-border flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Route map</span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-3 h-3 rounded-full bg-green-600 border-2 border-white shadow" />
                            Departure
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow" />
                            Change here
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-3 h-3 rounded-full bg-red-600 border-2 border-white shadow" />
                            Arrival
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 border border-white shadow" />
                            Passing stop
                          </span>
                        </div>
                        <ConnectionMap connection={connection} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky map panel for selected connection (shown at bottom on mobile) */}
      {selectedConnection && (
        <div className="fixed bottom-4 right-4 z-40 hidden">
          {/* placeholder for future floating panel */}
        </div>
      )}
    </Layout>
  );
}
