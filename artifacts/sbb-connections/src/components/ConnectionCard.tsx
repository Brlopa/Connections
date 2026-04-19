import React from "react";
import { format, parseISO } from "date-fns";
import { Clock, ArrowRight, TrainFront, Bus, ChevronRight, MapPin } from "lucide-react";
import type { Connection } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ConnectionCardProps {
  connection: Connection;
  selected?: boolean;
  onClick?: () => void;
}

export function ConnectionCard({ connection, selected, onClick }: ConnectionCardProps) {
  const fromTime = connection.from.departure ? parseISO(connection.from.departure) : null;
  const toTime = connection.to.arrival ? parseISO(connection.to.arrival) : null;

  const fromDelay = connection.from.delay;
  const platform = connection.from.platform;
  const sections = connection.sections ?? [];

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
    if (cat.includes("bus") || cat === "b") return <Bus className="h-4 w-4" />;
    return <TrainFront className="h-4 w-4" />;
  };

  const journeySections = sections.filter((s) => s.journey);

  return (
    <Card
      className={`overflow-hidden transition-all duration-200 cursor-pointer select-none
        ${selected
          ? "border-primary shadow-md ring-2 ring-primary/30"
          : "hover:shadow-md hover:border-primary/40 bg-card border-border"
        }`}
      onClick={onClick}
      data-testid="connection-card"
    >
      <div className="flex flex-col md:flex-row md:items-center p-5 gap-4 md:gap-8">
        {/* Times & Stations */}
        <div className="flex flex-1 justify-between items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl font-bold tracking-tight">
                {fromTime ? format(fromTime, "HH:mm") : "--:--"}
              </span>
              {fromDelay && fromDelay > 0 ? (
                <span className="text-xs font-semibold text-destructive">+{fromDelay}'</span>
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
          <div className="flex items-center gap-2 mb-3">
            <Badge
              variant="outline"
              className="font-semibold bg-accent border-accent-border"
            >
              {connection.transfers === 0
                ? "Direct"
                : `${connection.transfers} transfer${connection.transfers === 1 ? "" : "s"}`}
            </Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {selected ? "Details shown below" : "Click for details + map"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {journeySections.map((section, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <div className="flex items-center gap-1 font-medium px-2 py-1 bg-secondary rounded text-secondary-foreground">
                  {getTransportIcon(section.journey?.category)}
                  <span>
                    {section.journey?.category} {section.journey?.number}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
