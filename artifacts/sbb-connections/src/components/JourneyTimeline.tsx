import { type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { PersonStanding, TrainFront, Train, Bus, Ship, Clock } from "lucide-react";
import type { Connection, Section, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  try { return format(parseISO(iso), "HH:mm"); } catch { return "--:--"; }
}

// Derive vehicle color and icon from category
function getVehicleStyle(category: string | null | undefined): {
  bg: string;
  fg: string;
  icon: ReactNode;
  label: string;
} {
  const cat = (category || "").toUpperCase();

  if (cat === "IC" || cat === "ICE" || cat === "EC" || cat === "IR") {
    return { bg: "#dc2626", fg: "#fff", icon: <TrainFront className="h-3.5 w-3.5" />, label: cat };
  }
  if (cat === "S" || cat === "SN" || cat === "RE" || cat === "R" || cat === "RB") {
    return { bg: "#166534", fg: "#fff", icon: <TrainFront className="h-3.5 w-3.5" />, label: cat };
  }
  if (cat === "T" || cat === "TRAM" || cat === "M") {
    return { bg: "#1d4ed8", fg: "#fff", icon: <Train className="h-3.5 w-3.5" />, label: cat };
  }
  if (cat === "B" || cat === "BUS" || cat.startsWith("B ") || cat.includes("BUS")) {
    return { bg: "#1e3a8a", fg: "#fff", icon: <Bus className="h-3.5 w-3.5" />, label: "B" };
  }
  if (cat.includes("BOAT") || cat === "BAT") {
    return { bg: "#0369a1", fg: "#fff", icon: <Ship className="h-3.5 w-3.5" />, label: cat };
  }
  return { bg: "#374151", fg: "#fff", icon: <TrainFront className="h-3.5 w-3.5" />, label: cat };
}

// ------- sub-components -------

function TimeCell({ time, delay }: { time: string | null | undefined; delay?: number | null }) {
  const t = formatTime(time);
  return (
    <div className="w-14 shrink-0 text-right pr-3 pt-0.5">
      <span className="text-sm font-bold tabular-nums text-foreground">{t}</span>
      {delay != null && delay > 0 && (
        <div className="flex items-center justify-end gap-0.5 mt-0.5">
          <Clock className="h-3 w-3 text-destructive" />
          <span className="text-xs font-semibold text-destructive">ca +{delay}'</span>
        </div>
      )}
    </div>
  );
}

function DotFilled() {
  return (
    <div className="relative flex items-start justify-center w-5 shrink-0">
      <div className="absolute top-1.5 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-border" />
      <div className="relative z-10 w-3 h-3 rounded-full bg-foreground border-2 border-foreground mt-0.5" />
    </div>
  );
}

function DotOpen() {
  return (
    <div className="relative flex items-start justify-center w-5 shrink-0">
      <div className="absolute top-1.5 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-border" />
      <div className="relative z-10 w-3 h-3 rounded-full bg-background border-2 border-foreground mt-0.5" />
    </div>
  );
}

function LineOnly() {
  return (
    <div className="flex items-stretch justify-center w-5 shrink-0">
      <div className="w-0.5 bg-border" />
    </div>
  );
}

// A row showing a stop (start or end of a journey leg)
function StopRow({
  checkpoint,
  isStart,
  isEnd,
  isFirst,
  isLast,
}: {
  checkpoint: Checkpoint;
  isStart?: boolean;
  isEnd?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const time = isEnd ? checkpoint.arrival : checkpoint.departure;
  const delay = checkpoint.delay;
  const platform = checkpoint.platform;

  return (
    <div className="flex items-start gap-0">
      <TimeCell time={time} delay={delay} />
      {isFirst ? <DotFilled /> : isLast ? <DotFilled /> : isStart ? <DotFilled /> : isEnd ? <DotFilled /> : <DotOpen />}
      <div className="flex-1 pl-3 pb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-bold text-foreground leading-tight">
            {checkpoint.station?.name ?? "–"}
          </span>
          {platform && (
            <span className="text-xs text-muted-foreground">Pl. {platform}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// The middle part of a leg (vehicle badge + direction)
function LegInfo({ section }: { section: Section }) {
  const j = section.journey;
  if (!j) return null;

  const style = getVehicleStyle(j.category);
  const lineNumber = j.number ?? "";

  return (
    <div className="flex items-start gap-0">
      {/* empty time cell */}
      <div className="w-14 shrink-0" />
      <LineOnly />
      <div className="flex-1 pl-3 pb-3">
        {/* Vehicle badge */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold mb-1"
          style={{ background: style.bg, color: style.fg }}>
          {style.icon}
          <span>{style.label} {lineNumber}</span>
        </div>
        {j.to && (
          <div className="text-xs text-muted-foreground">Direction {j.to}</div>
        )}
      </div>
    </div>
  );
}

// Transfer row between legs
function TransferRow({ onShowMap }: { onShowMap?: () => void }) {
  return (
    <div className="flex items-center gap-0 py-2 bg-muted/40 my-1 rounded-md">
      <div className="w-14 shrink-0" />
      <div className="w-5 flex items-center justify-center shrink-0">
        <PersonStanding className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 pl-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground font-medium">Transfer</span>
        {onShowMap && (
          <button
            className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5 pr-3"
            onClick={onShowMap}
          >
            Show map &rsaquo;
          </button>
        )}
      </div>
    </div>
  );
}

// ------- main component -------

export function JourneyTimeline({
  connection,
  onShowMap,
}: {
  connection: Connection;
  onShowMap?: () => void;
}) {
  const sections = connection.sections;
  // only journey sections (not walk-only)
  const journeySections = sections.filter((s) => s.journey);

  if (journeySections.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Journey details</span>
      </div>

      <div className="px-2 py-3">
        {journeySections.map((section, idx) => {
          const isFirstSection = idx === 0;
          const isLastSection = idx === journeySections.length - 1;

          // Collect stops: departure + intermediate passList entries + arrival
          const passList = section.journey?.passList ?? [];
          // passList typically includes departure & arrival as first/last entries
          // If passList exists and has entries, use it; otherwise just dep/arr
          const intermediateStops =
            passList.length > 2
              ? passList.slice(1, passList.length - 1)
              : [];

          return (
            <div key={idx}>
              {/* Transfer between sections */}
              {idx > 0 && (
                <TransferRow onShowMap={onShowMap} />
              )}

              {/* Departure stop */}
              <StopRow
                checkpoint={section.departure}
                isStart
                isFirst={isFirstSection}
              />

              {/* Vehicle / line info */}
              <LegInfo section={section} />

              {/* Intermediate stops (collapsed by default, shown as small rows) */}
              {intermediateStops.map((stop, sIdx) => (
                <div key={sIdx} className="flex items-start gap-0 opacity-60">
                  <TimeCell
                    time={stop.departure ?? stop.arrival}
                    delay={stop.delay}
                  />
                  <DotOpen />
                  <div className="flex-1 pl-3 pb-2">
                    <span className="text-xs text-muted-foreground">
                      {stop.station?.name ?? "–"}
                    </span>
                    {stop.platform && (
                      <span className="text-xs text-muted-foreground ml-2">Pl. {stop.platform}</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Arrival stop */}
              <StopRow
                checkpoint={section.arrival}
                isEnd
                isLast={isLastSection}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
