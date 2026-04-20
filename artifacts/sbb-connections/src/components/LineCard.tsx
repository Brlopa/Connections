import { ChevronDown, ChevronUp, MapIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { LineDetails } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineTimeline } from "./LineTimeline";
import { LineMap } from "./LineMap";

interface LineCardProps {
  line: LineDetails;
  isExpanded: boolean;
  onToggle: () => void;
  expandedView: "details" | "map" | "both";
  onViewChange: (view: "details" | "map" | "both") => void;
}

function getVehicleColor(category: string | null | undefined): string {
  const cat = (category || "").toUpperCase();
  if (cat === "IC" || cat === "ICE" || cat === "EC" || cat === "IR") return "bg-red-600";
  if (cat === "S" || cat === "SN" || cat === "RE" || cat === "R" || cat === "RB") return "bg-green-600";
  if (cat === "T" || cat === "TRAM" || cat === "M") return "bg-blue-700";
  if (cat === "B" || cat === "BUS" || cat.startsWith("B ") || cat.includes("BUS")) return "bg-blue-900";
  if (cat.includes("BOAT") || cat === "BAT") return "bg-cyan-600";
  return "bg-gray-600";
}

export function LineCard({ line, isExpanded, onToggle, expandedView, onViewChange }: LineCardProps) {
  const vehicleColor = getVehicleColor(line.category);
  const stopCount = line.passList?.length ?? 0;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardHeader 
        className="cursor-pointer hover:bg-muted/50 transition-colors p-4" 
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`${vehicleColor} text-white rounded-md px-3 py-1.5 font-bold text-sm min-w-fit`}>
              {line.number || "LINE"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {line.from?.name}
                </span>
                <span className="text-xs text-muted-foreground">→</span>
                <span className="text-sm font-medium text-muted-foreground truncate">
                  {line.to?.name}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {line.operator && <span>{line.operator}</span>}
                {line.operator && stopCount > 0 && <span> • </span>}
                {stopCount > 0 && <span>{stopCount} stops</span>}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 pt-2 space-y-3">
          <div className="flex gap-2 border-t pt-3">
            <Button
              variant={expandedView === "details" || expandedView === "both" ? "default" : "outline"}
              size="sm"
              onClick={() => onViewChange(expandedView === "details" ? "both" : "details")}
            >
              Details
            </Button>
            <Button
              variant={expandedView === "map" || expandedView === "both" ? "default" : "outline"}
              size="sm"
              onClick={() => onViewChange(expandedView === "map" ? "both" : "map")}
            >
              <MapIcon className="h-3.5 w-3.5 mr-1.5" />
              Map
            </Button>
          </div>

          {(expandedView === "details" || expandedView === "both") && (
            <LineTimeline line={line} />
          )}

          {(expandedView === "map" || expandedView === "both") && (
            <div className="mt-3">
              <LineMap line={line} />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
