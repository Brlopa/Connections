import { type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { PersonStanding, TrainFront, Train, Bus, Ship, Clock, Footprints } from "lucide-react";
import type { Connection, Section, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  try { return format(parseISO(iso), "HH:mm"); } catch { return "--:--"; }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getVehicleStyle(category: string | null | undefined): {
  bg: string; fg: string; icon: ReactNode; label: string;
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

// ── sub-components ─────────────────────────────────────────────

function TimeCell({ time, delay }: { time: string | null | undefined; delay?: number | null }) {
  return (
    <div className="w-14 shrink-0 text-right pr-3 pt-0.5">
      <span className="text-sm font-bold tabular-nums text-foreground">{formatTime(time)}</span>
      {delay != null && delay > 0 && (
        <div className="flex items-center justify-end gap-0.5 mt-0.5">
          <Clock className="h-3 w-3 text-destructive" />
          <span className="text-xs font-semibold text-destructive">+{delay}'</span>
        </div>
      )}
    </div>
  );
}

function DotFilled({ color = "bg-foreground" }: { color?: string }) {
  return (
    <div className="relative flex items-start justify-center w-5 shrink-0">
      <div className="absolute top-1.5 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-border" />
      <div className={`relative z-10 w-3 h-3 rounded-full ${color} border-2 border-white mt-0.5 shadow-sm`} />
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

function LineOnly({ dashed = false }: { dashed?: boolean }) {
  return (
    <div className="flex items-stretch justify-center w-5 shrink-0">
      <div className={`w-0.5 ${dashed ? "border-l-2 border-dashed border-muted-foreground/40" : "bg-border"}`} />
    </div>
  );
}

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
  const dotColor = isFirst
    ? "bg-green-600"
    : isLast
    ? "bg-red-600"
    : "bg-foreground";

  return (
    <div className="flex items-start gap-0">
      <TimeCell time={time} delay={delay} />
      <DotFilled color={dotColor} />
      <div className="flex-1 pl-3 pb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-bold text-foreground leading-tight">
            {checkpoint.station?.name ?? "–"}
          </span>
          {platform && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Pl. {platform}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LegInfo({ section }: { section: Section }) {
  const j = section.journey;
  if (!j) return null;
  const style = getVehicleStyle(j.category);
  return (
    <div className="flex items-start gap-0">
      <div className="w-14 shrink-0" />
      <LineOnly />
      <div className="flex-1 pl-3 pb-3">
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold mb-1"
          style={{ background: style.bg, color: style.fg }}
        >
          {style.icon}
          <span>{style.label} {j.number ?? ""}</span>
        </div>
        {j.to && <div className="text-xs text-muted-foreground">Direction {j.to}</div>}
      </div>
    </div>
  );
}

function WalkRow({ section }: { section: Section }) {
  const walkData = section.walk as Record<string, unknown> | null | undefined;
  const durationSec = walkData?.duration as number | null | undefined;
  const distanceM = walkData?.distance as number | null | undefined;
  const depTime = section.departure?.departure;
  const arrTime = section.arrival?.arrival;
  const arrStation = section.arrival?.station?.name;
  const depStation = section.departure?.station?.name;

  // Compute duration from timestamps if not directly available
  let displayDuration = durationSec ? formatDuration(durationSec) : "";
  if (!displayDuration && depTime && arrTime) {
    try {
      const diffSec = (new Date(arrTime).getTime() - new Date(depTime).getTime()) / 1000;
      if (diffSec > 0) displayDuration = formatDuration(diffSec);
    } catch { /* ignore */ }
  }

  const distanceStr = distanceM ? `${Math.round(distanceM)} m` : "";
  const detail = [displayDuration, distanceStr].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-0 py-2 bg-amber-50 dark:bg-amber-950/20 my-1 rounded-md border border-amber-200 dark:border-amber-800/40">
      <div className="w-14 shrink-0 text-right pr-3">
        {depTime && (
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{formatTime(depTime)}</span>
        )}
      </div>
      <LineOnly dashed />
      <div className="flex-1 pl-3 flex items-center gap-2">
        <Footprints className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-amber-800 dark:text-amber-300">Walk</span>
          {detail && (
            <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">{detail}</span>
          )}
          {arrStation && arrStation !== depStation && (
            <div className="text-xs text-muted-foreground truncate">to {arrStation}</div>
          )}
        </div>
        {arrTime && (
          <span className="text-xs font-mono text-muted-foreground tabular-nums pr-3">{formatTime(arrTime)}</span>
        )}
      </div>
    </div>
  );
}

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

// ── main component ─────────────────────────────────────────────

export function JourneyTimeline({
  connection,
  onShowMap,
}: {
  connection: Connection;
  onShowMap?: () => void;
}) {
  const sections = connection.sections ?? [];
  if (sections.length === 0) return null;

  // Find the indices of the first and last journey (vehicle) sections
  const journeyIndices = sections
    .map((s, i) => (s.journey ? i : -1))
    .filter((i) => i >= 0);

  if (journeyIndices.length === 0) return null;

  const firstJourneyIdx = journeyIndices[0];
  const lastJourneyIdx = journeyIndices[journeyIndices.length - 1];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Journey details</span>
      </div>

      <div className="px-2 py-3">
        {sections.map((section, idx) => {
          // Walk section
          if (section.walk && !section.journey) {
            return <WalkRow key={idx} section={section} />;
          }

          // Journey section
          if (section.journey) {
            const isFirstSection = idx === firstJourneyIdx;
            const isLastSection = idx === lastJourneyIdx;

            // Check if the previous non-walk section was also a journey (needs transfer row)
            const prevSection = idx > 0 ? sections[idx - 1] : null;
            const prevWasJourney = prevSection?.journey != null;
            const prevWasWalk = prevSection?.walk != null && !prevSection.journey;
            const needsTransferRow = prevWasJourney && !prevWasWalk;

            const passList = section.journey?.passList ?? [];
            const intermediateStops = passList.length > 2 ? passList.slice(1, passList.length - 1) : [];

            return (
              <div key={idx}>
                {needsTransferRow && <TransferRow onShowMap={onShowMap} />}

                <StopRow
                  checkpoint={section.departure}
                  isStart
                  isFirst={isFirstSection}
                />

                <LegInfo section={section} />

                {intermediateStops.map((stop, sIdx) => (
                  <div key={sIdx} className="flex items-start gap-0 opacity-60">
                    <TimeCell time={stop.departure ?? stop.arrival} delay={stop.delay} />
                    <DotOpen />
                    <div className="flex-1 pl-3 pb-2">
                      <span className="text-xs text-muted-foreground">{stop.station?.name ?? "–"}</span>
                      {stop.platform && (
                        <span className="text-xs text-muted-foreground ml-2">Pl. {stop.platform}</span>
                      )}
                    </div>
                  </div>
                ))}

                <StopRow
                  checkpoint={section.arrival}
                  isEnd
                  isLast={isLastSection}
                />
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
