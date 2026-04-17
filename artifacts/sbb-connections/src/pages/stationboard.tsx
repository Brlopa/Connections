import React, { useState } from "react";
import { format, parseISO } from "date-fns";
import { TrainFront, Bus, AlertTriangle, Search } from "lucide-react";
import { useGetStationboard, getGetStationboardQueryKey } from "@workspace/api-client-react";
import type { Location, StationboardEntry } from "@workspace/api-client-react/src/generated/api.schemas";
import { Layout } from "@/components/layout";
import { LocationSearch } from "@/components/LocationSearch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function StationboardPage() {
  const [stationQuery, setStationQuery] = useState("");
  const [station, setStation] = useState<Location | null>(null);
  
  const [searchParams, setSearchParams] = useState<{station: string} | null>(null);

  const { data, isLoading, isError } = useGetStationboard(
    searchParams || { station: "" },
    { 
      query: { 
        enabled: !!searchParams?.station,
        queryKey: getGetStationboardQueryKey(searchParams || { station: "" }),
        refetchInterval: 30000 // Refetch every 30 seconds for live departures
      } 
    }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (stationQuery) {
      setSearchParams({ station: station?.name || stationQuery });
    }
  };

  const getTransportIcon = (category: string | undefined | null) => {
    const cat = (category || "").toLowerCase();
    if (cat.includes("bus") || cat.includes("b")) return <Bus className="h-4 w-4" />;
    return <TrainFront className="h-4 w-4" />;
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-card border rounded-xl p-4 md:p-6 shadow-sm">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row items-end gap-4">
            <LocationSearch 
              id="station"
              label="Station" 
              placeholder="Enter a station name"
              value={stationQuery}
              onChange={(val, loc) => {
                setStationQuery(val);
                if (loc) {
                  setStation(loc);
                  setSearchParams({ station: loc.name || val }); // Auto search on select
                }
              }}
            />
            
            <button 
              type="submit" 
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 px-6 rounded-md font-bold flex items-center shrink-0 transition-colors disabled:opacity-50"
              disabled={!stationQuery}
            >
              <Search className="mr-2 h-5 w-5" />
              Show Departures
            </button>
          </form>
        </div>

        <div className="space-y-4 min-h-[400px]">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 bg-card/50 animate-pulse rounded-xl border border-border"></div>
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-12 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 font-medium">
              Could not fetch stationboard. Please try again.
            </div>
          )}

          {!isLoading && !isError && searchParams && data?.stationboard?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
              No departures found for this station.
            </div>
          )}

          {!isLoading && !isError && data?.stationboard && data.stationboard.length > 0 && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold tracking-tight">
                  Departures from {data.station?.name || searchParams.station}
                </h2>
                <div className="text-xs text-muted-foreground flex items-center">
                  <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
                  Live
                </div>
              </div>
              
              {data.stationboard.map((entry, idx) => {
                const departureTime = entry.stop.departure ? parseISO(entry.stop.departure) : null;
                const delay = entry.stop.delay;
                
                return (
                  <Card key={idx} className="overflow-hidden hover:shadow-sm transition-shadow duration-200 bg-card border-border">
                    <div className="flex items-center p-4 gap-4">
                      <div className="w-24 shrink-0">
                        <div className="text-xl font-bold tracking-tight">
                          {departureTime ? format(departureTime, "HH:mm") : "--:--"}
                        </div>
                        {delay && delay > 0 ? (
                          <div className="text-xs font-semibold text-destructive mt-0.5 flex items-center">
                            +{delay} min
                          </div>
                        ) : null}
                      </div>
                      
                      <div className="w-24 shrink-0 flex items-center">
                        <Badge variant="outline" className="font-bold flex items-center gap-1.5 px-2 py-1 border-border bg-accent/50 text-accent-foreground">
                          {getTransportIcon(entry.category)}
                          {entry.category} {entry.number}
                        </Badge>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-semibold truncate text-foreground">
                          {entry.to}
                        </div>
                      </div>
                      
                      <div className="w-16 shrink-0 text-right">
                        {entry.stop.platform && (
                          <>
                            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Plat</div>
                            <div className="font-bold text-lg">{entry.stop.platform}</div>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
