import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { ArrowRightLeft, Search, Calendar, Clock, Timer, ChevronDown, Loader2 } from "lucide-react";
import { searchConnections } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { LocationSearch, type EnrichedLocation } from "@/components/LocationSearch";
import { ConnectionCard } from "@/components/ConnectionCard";
import { ConnectionMap } from "@/components/ConnectionMap";
import { JourneyTimeline } from "@/components/JourneyTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Connection } from "@workspace/api-client-react/src/generated/api.schemas";

type ExpandedView = "details" | "map" | "both";

type SearchParams = {
  from: string;
  to: string;
  date: string;
  time: string;
  fromDbId?: string;
  toDbId?: string;
};

function getMs(isoOrNull: string | null | undefined, tsOrNull: number | null | undefined): number | null {
  if (tsOrNull != null) return tsOrNull * 1000;
  if (isoOrNull) { try { return new Date(isoOrNull).getTime(); } catch { return null; } }
  return null;
}

/** Extract the departure time of the last connection as HH:MM and its date */
function getLastDepartureDateTime(connections: Connection[]): { date: string; time: string } | null {
  if (connections.length === 0) return null;
  const last = connections[connections.length - 1];
  const sections = last.sections ?? [];
  const dep = sections[0]?.departure;
  const ts = getMs(dep?.departure, dep?.departureTimestamp);
  if (!ts) return null;
  const d = new Date(ts + 60_000); // add 1 minute to avoid duplicate
  return {
    date: format(d, "yyyy-MM-dd"),
    time: format(d, "HH:mm"),
  };
}

export default function SearchPage() {
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromStation, setFromStation] = useState<EnrichedLocation | null>(null);
  const [toStation, setToStation] = useState<EnrichedLocation | null>(null);

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [time, setTime] = useState(format(new Date(), "HH:mm"));
  const [minTransferTime, setMinTransferTime] = useState(0);

  const [searchParams, setSearchParams] = useState<SearchParams | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [fromLoc, setFromLoc] = useState<unknown>(null);
  const [toLoc, setToLoc] = useState<unknown>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isError, setIsError] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Track the "next page" time cursor
  const [nextPageDateTime, setNextPageDateTime] = useState<{ date: string; time: string } | null>(null);
  const [canLoadMore, setCanLoadMore] = useState(false);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [expandedView, setExpandedView] = useState<ExpandedView>("both");

  // Sentinel element for intersection observer
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreInProgress = useRef(false);

  // ── fetch helpers ──────────────────────────────────────────────

  const fetchConnections = useCallback(async (params: SearchParams, append = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setIsError(false);
    }

    try {
      const data = await searchConnections({
        from: params.from,
        to: params.to,
        date: params.date,
        time: params.time,
        limit: 5,
        fromDbId: params.fromDbId,
        toDbId: params.toDbId,
      });

      const newConns = data.connections ?? [];

      if (append) {
        setConnections(prev => {
          // Deduplicate by departure timestamp
          const existingTs = new Set(prev.map(c => {
            const sec = c.sections?.[0]?.departure;
            return getMs(sec?.departure, sec?.departureTimestamp);
          }));
          const deduped = newConns.filter(c => {
            const sec = c.sections?.[0]?.departure;
            const ts = getMs(sec?.departure, sec?.departureTimestamp);
            return ts === null || !existingTs.has(ts);
          });
          return [...prev, ...deduped];
        });
      } else {
        setConnections(newConns);
        setFromLoc(data.from ?? null);
        setToLoc(data.to ?? null);
        setSelectedIdx(null);
      }

      // Set up next page cursor
      if (newConns.length > 0) {
        const cursor = getLastDepartureDateTime(newConns);
        setNextPageDateTime(cursor);
        setCanLoadMore(newConns.length >= 3); // if we got results, more likely exist
      } else {
        setCanLoadMore(false);
      }
    } catch {
      if (!append) setIsError(true);
      setCanLoadMore(false);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      loadMoreInProgress.current = false;
    }
  }, []);

  // ── load more when sentinel is visible ────────────────────────

  const loadMore = useCallback(async () => {
    if (!searchParams || !nextPageDateTime || !canLoadMore || loadMoreInProgress.current) return;
    loadMoreInProgress.current = true;
    const nextParams: SearchParams = {
      ...searchParams,
      date: nextPageDateTime.date,
      time: nextPageDateTime.time,
    };
    await fetchConnections(nextParams, true);
  }, [searchParams, nextPageDateTime, canLoadMore, fetchConnections]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && canLoadMore && !isLoadingMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, isLoadingMore, isLoading, loadMore]);

  // ── search handler ─────────────────────────────────────────────

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
    if (!fromQuery || !toQuery) return;
    const params: SearchParams = {
      from: fromStation?.name || fromQuery,
      to: toStation?.name || toQuery,
      date,
      time,
      fromDbId: fromStation?.dbId ?? undefined,
      toDbId: toStation?.dbId ?? undefined,
    };
    setSearchParams(params);
    setHasSearched(true);
    setConnections([]);
    setCanLoadMore(false);
    setNextPageDateTime(null);
    fetchConnections(params, false);
  };

  // ── filtering ─────────────────────────────────────────────────

  const filteredConnections = connections.filter((conn) => {
    if (minTransferTime === 0) return true;
    const sections = conn.sections ?? [];
    const legs = sections.filter((s) => s.journey != null);
    for (let i = 0; i < legs.length - 1; i++) {
      const prevArr = legs[i].arrival;
      const nextDep = legs[i + 1].departure;
      const arrMs = getMs(prevArr?.arrival, prevArr?.arrivalTimestamp);
      const depMs = getMs(nextDep?.departure, nextDep?.departureTimestamp);
      if (arrMs != null && depMs != null) {
        const transferMins = (depMs - arrMs) / 60000;
        if (transferMins < minTransferTime) return false;
      }
    }
    return true;
  });

  const handleSelectConnection = (idx: number) => {
    if (selectedIdx === idx) {
      setSelectedIdx(null);
    } else {
      setSelectedIdx(idx);
      setExpandedView("both");
    }
  };

  // ── render ─────────────────────────────────────────────────────

  const fromLocTyped = fromLoc as { name?: string } | null;
  const toLocTyped = toLoc as { name?: string } | null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Search form */}
        <div className="bg-card border rounded-xl p-4 md:p-6 shadow-sm">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col md:flex-row items-end gap-4">
              <LocationSearch
                id="from-station"
                label="From"
                placeholder="Station or stop"
                value={fromQuery}
                onChange={(val, loc) => {
                  setFromQuery(val);
                  setFromStation(loc ?? null);
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
                  setToStation(loc ?? null);
                }}
              />
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="date" className="text-sm font-semibold text-muted-foreground">Date</Label>
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
                <Label htmlFor="time" className="text-sm font-semibold text-muted-foreground">Time</Label>
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
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="min-transfer" className="text-sm font-semibold text-muted-foreground">
                  Min. transfer time
                </Label>
                <div className="relative">
                  <Timer className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <select
                    id="min-transfer"
                    value={minTransferTime}
                    onChange={(e) => setMinTransferTime(Number(e.target.value))}
                    className="flex h-12 w-full rounded-md border border-input bg-background pl-10 pr-4 text-sm font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 appearance-none"
                  >
                    <option value={0}>Any</option>
                    <option value={2}>2 min</option>
                    <option value={3}>3 min</option>
                    <option value={4}>4 min</option>
                    <option value={5}>5 min</option>
                    <option value={6}>6 min</option>
                    <option value={8}>8 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                  </select>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-bold"
              disabled={!fromQuery || !toQuery || isLoading}
              data-testid="button-search"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Search className="mr-2 h-5 w-5" />
              )}
              Search
            </Button>
          </form>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {/* Initial loading skeletons */}
          {isLoading && connections.length === 0 && (
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

          {!isLoading && !isError && hasSearched && connections.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
              No connections found for this route.
            </div>
          )}

          {!isLoading && !isError && filteredConnections.length === 0 && connections.length > 0 && (
            <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
              No connections with at least {minTransferTime} min transfer time found. Try reducing the minimum.
            </div>
          )}

          {filteredConnections.length > 0 && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <h2 className="text-xl font-bold tracking-tight mb-4">
                Connections from {fromLocTyped?.name || searchParams?.from} to {toLocTyped?.name || searchParams?.to}
              </h2>

              {filteredConnections.map((connection, idx) => (
                <div key={`${idx}-${(connection.sections?.[0]?.departure?.departureTimestamp ?? idx)}`} className="space-y-2">
                  <ConnectionCard
                    connection={connection}
                    selected={selectedIdx === idx}
                    onClick={() => handleSelectConnection(idx)}
                  />

                  {selectedIdx === idx && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-2 pl-1">
                      <div className="flex items-center gap-1 text-xs">
                        {(["both", "details", "map"] as ExpandedView[]).map((view) => (
                          <button
                            key={view}
                            onClick={() => setExpandedView(view)}
                            className={`px-3 py-1.5 rounded-md font-medium transition-colors capitalize
                              ${expandedView === view
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                              }`}
                          >
                            {view === "both" ? "Details + Map" : view === "details" ? "Journey details" : "Map"}
                          </button>
                        ))}
                      </div>

                      {(expandedView === "details" || expandedView === "both") && (
                        <JourneyTimeline
                          connection={connection}
                          onShowMap={() => setExpandedView("map")}
                        />
                      )}

                      {(expandedView === "map" || expandedView === "both") && (
                        <div className="rounded-xl border border-border overflow-hidden shadow-sm">
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
                          </div>
                          <ConnectionMap connection={connection} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Sentinel for infinite scroll — invisible, sits below the last card */}
              <div ref={sentinelRef} className="h-4" aria-hidden="true" />

              {/* Loading more indicator */}
              {isLoadingMore && (
                <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium">Loading later connections…</span>
                </div>
              )}

              {/* Manual load more fallback (if intersection observer doesn't fire) */}
              {!isLoadingMore && canLoadMore && (
                <button
                  onClick={loadMore}
                  className="w-full py-4 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-dashed border-border rounded-xl hover:border-primary/40 hover:bg-accent/30 transition-colors"
                >
                  <ChevronDown className="h-4 w-4" />
                  Load later departures
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
