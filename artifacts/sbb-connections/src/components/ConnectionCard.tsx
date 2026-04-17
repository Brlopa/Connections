import React from "react";
import { format, parseISO } from "date-fns";
import { Clock, ArrowRight, TrainFront, Bus, AlertTriangle, ChevronRight } from "lucide-react";
import type { Connection, Section } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export function ConnectionCard({ connection }: { connection: Connection }) {
  const fromTime = connection.from.departure ? parseISO(connection.from.departure) : null;
  const toTime = connection.to.arrival ? parseISO(connection.to.arrival) : null;
  
  const fromDelay = connection.from.delay;
  const platform = connection.from.platform;

  // Format duration from "00d00:45:00" to "45 min"
  const formatDuration = (dur: string | undefined | null) => {
    if (!dur) return "";
    const match = dur.match(/\d+d(\d{2}):(\d{2}):\d{2}/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      if (hours > 0) return `${hours} h ${minutes} min`;
      return `${minutes} min`;
    }
    return dur;
  };

  const getTransportIcon = (category: string | undefined | null) => {
    const cat = (category || "").toLowerCase();
    if (cat.includes("bus") || cat.includes("b")) return <Bus className="h-4 w-4" />;
    return <TrainFront className="h-4 w-4" />;
  };

  // Filter sections that are actually transport legs (have a journey)
  const journeySections = connection.sections.filter(s => s.journey);

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow duration-200 bg-card border-border">
      <div className="flex flex-col md:flex-row md:items-center p-5 gap-4 md:gap-8">
        
        {/* Times & Stations */}
        <div className="flex flex-1 justify-between items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold tracking-tight">
                {fromTime ? format(fromTime, "HH:mm") : "--:--"}
              </span>
              {fromDelay && fromDelay > 0 ? (
                <span className="text-xs font-semibold text-destructive flex items-center">
                  +{fromDelay}'
                </span>
              ) : null}
            </div>
            <div className="text-sm font-medium text-foreground">{connection.from.station.name}</div>
            {platform && (
              <div className="text-xs text-muted-foreground mt-1">Pl. {platform}</div>
            )}
          </div>
          
          <div className="flex flex-col items-center justify-center text-muted-foreground px-4">
            <ArrowRight className="h-5 w-5 mb-1 text-primary/40" />
            <div className="text-xs font-medium whitespace-nowrap">{formatDuration(connection.duration)}</div>
          </div>
          
          <div className="flex-1 text-right">
            <div className="text-2xl font-bold tracking-tight mb-1">
              {toTime ? format(toTime, "HH:mm") : "--:--"}
            </div>
            <div className="text-sm font-medium text-foreground">{connection.to.station.name}</div>
          </div>
        </div>

        <div className="hidden md:block w-px h-16 bg-border mx-2"></div>
        <Separator className="md:hidden my-2" />

        {/* Legs / Transfers */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-3 text-sm text-muted-foreground">
            <Badge variant="outline" className="font-semibold bg-accent border-accent-border">
              {connection.transfers === 0 ? "Direct" : `${connection.transfers} transfer${connection.transfers === 1 ? '' : 's'}`}
            </Badge>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {journeySections.map((section, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <div className="flex items-center gap-1 font-medium px-2 py-1 bg-secondary rounded text-secondary-foreground">
                  {getTransportIcon(section.journey?.category)}
                  <span>{section.journey?.category} {section.journey?.number}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
