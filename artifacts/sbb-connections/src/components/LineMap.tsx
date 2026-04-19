import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../components/ConnectionMap.css";
import type { LineDetails, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

// Custom marker colors
const MARKER_COLORS = {
  start: "#16a34a",
  end: "#dc2626",
  stop: "#d97706",
};

const MARKER_SIZES = {
  start: 18,
  end: 18,
  stop: 10,
};

function createMarkerElement(color: string, size: number): HTMLElement {
  const element = document.createElement("div");
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.borderRadius = "50%";
  element.style.backgroundColor = color;
  element.style.border = "2.5px solid #fff";
  element.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
  element.style.cursor = "pointer";
  return element;
}

interface StopPoint {
  lat: number;
  lng: number;
  name: string;
  type: "start" | "end" | "stop";
}

function hasCoords(cp: Checkpoint | null | undefined): cp is Checkpoint & { station: { coordinate: { x: number; y: number } } } {
  return !!(cp?.station?.coordinate?.x && cp?.station?.coordinate?.y);
}

function extractStops(line: LineDetails): StopPoint[] {
  const stops: StopPoint[] = [];

  if (!line.passList || line.passList.length === 0) return stops;

  // First stop (start)
  const firstStop = line.passList[0];
  if (hasCoords(firstStop)) {
    stops.push({
      lat: firstStop.station.coordinate.x!,
      lng: firstStop.station.coordinate.y!,
      name: firstStop.station.name || "Start",
      type: "start",
    });
  }

  // Middle stops
  for (let i = 1; i < line.passList.length - 1; i++) {
    const stop = line.passList[i];
    if (hasCoords(stop)) {
      stops.push({
        lat: stop.station.coordinate.x!,
        lng: stop.station.coordinate.y!,
        name: stop.station.name || "Stop",
        type: "stop",
      });
    }
  }

  // Last stop (end)
  if (line.passList.length > 1) {
    const lastStop = line.passList[line.passList.length - 1];
    if (hasCoords(lastStop)) {
      stops.push({
        lat: lastStop.station.coordinate.x!,
        lng: lastStop.station.coordinate.y!,
        name: lastStop.station.name || "End",
        type: "end",
      });
    }
  }

  return stops;
}

interface LineMapProps {
  line: LineDetails;
}

export function LineMap({ line }: LineMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const stops = extractStops(line);
    if (stops.length === 0) {
      setError("No coordinate data available for this line");
      return;
    }

    try {
      const map_ = new maplibregl.Map({
        container: mapContainer.current,
        style: "https://tile.openstreetmap.org/style.json",
        center: [stops[0].lng, stops[0].lat],
        zoom: 10,
        pitch: 0,
        bearing: 0,
      });

      map.current = map_;

      // Add markers
      stops.forEach((stop) => {
        const color = MARKER_COLORS[stop.type];
        const size = MARKER_SIZES[stop.type];
        const marker = new maplibregl.Marker({ element: createMarkerElement(color, size) })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map_);

        // Add popup on hover
        const popup = new maplibregl.Popup({ offset: [0, -size / 2 - 5] }).setText(stop.name);
        marker.getElement().addEventListener("mouseenter", () => popup.addTo(map_));
        marker.getElement().addEventListener("mouseleave", () => popup.remove());
      });

      // Calculate bounds
      const bounds = new maplibregl.LngLatBounds();
      stops.forEach((stop) => bounds.extend([stop.lng, stop.lat]));

      // Fit bounds with padding and animation
      map_.fitBounds(bounds, { padding: 60, duration: 1000 });

      return () => {
        map_.remove();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load map");
    }
  }, [line]);

  if (error) {
    return (
      <div className="w-full h-80 bg-muted rounded-lg flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return <div ref={mapContainer} className="w-full h-80 rounded-lg overflow-hidden" />;
}
