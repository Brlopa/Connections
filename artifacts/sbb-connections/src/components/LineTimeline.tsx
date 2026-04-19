import { format, parseISO } from "date-fns";
import { Clock } from "lucide-react";
import type { LineDetails, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

interface LineTimelineProps {
  line: LineDetails;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  try {
    return format(parseISO(iso), "HH:mm");
  } catch {
    return "--:--";
  }
}

export function LineTimeline({ line }: LineTimelineProps) {
  const stops = line.passList ?? [];

  if (stops.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-muted-foreground">No stop information available</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {stops.map((stop, idx) => (
        <div key={idx} className="flex gap-3">
          {/* Timeline indicator */}
          <div className="flex flex-col items-center shrink-0">
            <div className={`h-3 w-3 rounded-full ${
              idx === 0 ? "bg-green-600" : idx === stops.length - 1 ? "bg-red-600" : "bg-amber-600"
            }`} />
            {idx < stops.length - 1 && (
              <div className="h-6 w-0.5 bg-muted my-1" />
            )}
          </div>

          {/* Stop details */}
          <div className="flex-1 min-w-0 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {stop.station?.name || "Unknown Station"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {stop.departure && (
                  <div className="text-right">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatTime(stop.departure)}
                    </span>
                    {stop.delay != null && stop.delay > 0 && (
                      <div className="flex items-center justify-end gap-0.5 mt-0.5">
                        <Clock className="h-3 w-3 text-red-600" />
                        <span className="text-xs font-semibold text-red-600">+{stop.delay}'</span>
                      </div>
                    )}
                  </div>
                )}
                {stop.arrival && !stop.departure && (
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatTime(stop.arrival)}
                  </span>
                )}
              </div>
            </div>

            {stop.platform && (
              <p className="text-xs text-muted-foreground mt-1">
                Platform: {stop.platform}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
