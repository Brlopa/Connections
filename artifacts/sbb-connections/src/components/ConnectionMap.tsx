import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ConnectionMap.css";
import type { Connection, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

// Custom marker colors
const MARKER_COLORS = {
  departure: "#16a34a",
  arrival: "#dc2626",
  transfer: "#d97706",
  passing: "#94a3b8",
  walk: "#f59e0b",
};

const MARKER_SIZES = {
  departure: 18,
  arrival: 18,
  transfer: 16,
  passing: 10,
  walk: 12,
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
  time?: string | null;
  platform?: string | null;
  delay?: number | null;
  type: "departure" | "arrival" | "transfer" | "passing" | "walk-start" | "walk-end";
}

interface WalkSegment {
  start: [number, number];
  end: [number, number];
  duration: number | null;
  distance: number | null;
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return null;
  try { return format(parseISO(iso), "HH:mm"); } catch { return null; }
}

function hasCoords(cp: Checkpoint | null | undefined): cp is Checkpoint & { station: { coordinate: { x: number; y: number } } } {
  return !!(cp?.station?.coordinate?.x && cp?.station?.coordinate?.y);
}

function extractStops(connection: Connection): StopPoint[] {
  const stops: StopPoint[] = [];

  // Departure
  if (hasCoords(connection.from)) {
    stops.push({
      lat: connection.from.station.coordinate.x!,
      lng: connection.from.station.coordinate.y!,
      name: connection.from.station.name || "Departure",
      time: formatTime(connection.from.departure),
      platform: connection.from.platform,
      delay: connection.from.delay,
      type: "departure",
    });
  }

  // Walk through sections
  for (let i = 0; i < connection.sections.length; i++) {
    const section = connection.sections[i];
    const journey = section.journey;

    if (journey?.passList) {
      for (let j = 0; j < journey.passList.length; j++) {
        const cp = journey.passList[j];
        if (!hasCoords(cp)) continue;
        const lat = cp.station.coordinate.x!;
        const lng = cp.station.coordinate.y!;
        // Skip if this is already the departure or last stop
        const isFirst = j === 0 && i === 0;
        const isLast = j === journey.passList.length - 1 && i === connection.sections.length - 1;
        if (isFirst || isLast) continue;
        // Check if this is a transfer (last stop of this section AND not last section)
        const isTransferPoint = j === journey.passList.length - 1 && i < connection.sections.length - 1;
        stops.push({
          lat,
          lng,
          name: cp.station.name || "Stop",
          time: formatTime(cp.departure || cp.arrival),
          platform: cp.platform,
          delay: cp.delay,
          type: isTransferPoint ? "transfer" : "passing",
        });
      }
    }
  }

  // Arrival
  if (hasCoords(connection.to)) {
    stops.push({
      lat: connection.to.station.coordinate.x!,
      lng: connection.to.station.coordinate.y!,
      name: connection.to.station.name || "Arrival",
      time: formatTime(connection.to.arrival),
      platform: connection.to.platform,
      delay: connection.to.delay,
      type: "arrival",
    });
  }

  return stops;
}

function extractWalkSegments(connection: Connection): WalkSegment[] {
  const walks: WalkSegment[] = [];

  for (const section of connection.sections) {
    if (section.walk && !section.journey && hasCoords(section.departure) && hasCoords(section.arrival)) {
      walks.push({
        start: [section.departure.station.coordinate.x!, section.departure.station.coordinate.y!],
        end: [section.arrival.station.coordinate.x!, section.arrival.station.coordinate.y!],
        duration: section.walk.duration || null,
        distance: section.walk.distance || null,
      });
    }
  }

  return walks;
}

function FitBounds({ map, stops }: { map: MapLibreMap | null; stops: StopPoint[] }) {
  useEffect(() => {
    if (!map || stops.length === 0) return;

    if (stops.length === 1) {
      map.flyTo({
        center: [stops[0].lng, stops[0].lat],
        zoom: 13,
        duration: 1000,
      });
      return;
    }

    const coordinates = stops.map((s) => [s.lng, s.lat]) as [number, number][];
    const bounds = coordinates.reduce(
      (bounds, coord) => {
        return bounds.extend(coord);
      },
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );

    map.fitBounds(bounds, { padding: 32, duration: 1000 });
  }, [map, stops]);

  return null;
}

interface ConnectionMapProps {
  connection: Connection;
  className?: string;
}

export function ConnectionMap({ connection, className = "" }: ConnectionMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const stops = extractStops(connection);
  const walks = extractWalkSegments(connection);

  // Initialize map
  u// Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    // Calculate center vector: use median stop or default to central Europe
    const center: [number, number] =
      stops.length > 0
        ? [stops[Math.floor(stops.length / 2)].lng, stops[Math.floor(stops.length / 2)].lat]
        : [10.0, 51.0];

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/bright",
      center,
      zoom: stops.length > 0 ? 10 : 4,
      attributionControl: true,
    });

    // Add Fullscreen Control to the top-right corner
    map.current.addControl(new maplibregl.FullscreenControl(), "top-right");

    map.current.on("load", () => {
      setMapReady(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [stops.length]);

  // Add markers and polylines when map is ready
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Remove existing source and layers if they exist
    if (map.current.getSource("route-source")) {
      map.current.removeLayer("route-line");
      map.current.removeSource("route-source");
    }
    if (map.current.getSource("walks-source")) {
      map.current.removeLayer("walks-line");
      map.current.removeSource("walks-source");
    }

    // Add transit route polyline
    if (stops.length > 1) {
      const routeCoordinates = stops.map((s) => [s.lng, s.lat]) as [number, number][];

      map.current.addSource("route-source", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: routeCoordinates,
          },
        },
      });

      map.current.addLayer({
        id: "route-line",
        type: "line",
        source: "route-source",
        paint: {
          "line-color": "#dc2626",
          "line-width": 3,
          "line-opacity": 0.85,
        },
      });
    }

    // Add walking routes
    if (walks.length > 0) {
      const walkFeatures = walks.map((walk) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [walk.start, walk.end],
        },
      }));

      map.current.addSource("walks-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: walkFeatures,
        },
      });

      map.current.addLayer({
        id: "walks-line",
        type: "line",
        source: "walks-source",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3,
          "line-opacity": 0.85,
          "line-dasharray": [1, 1],
        },
      });
    }

    // Add stop markers
    stops.forEach((stop) => {
      const type = stop.type === "walk-start" || stop.type === "walk-end" ? "walk" : stop.type;
      const color = MARKER_COLORS[type as keyof typeof MARKER_COLORS] || MARKER_COLORS.passing;
      const size = MARKER_SIZES[type as keyof typeof MARKER_SIZES] || 14;

      const markerElement = createMarkerElement(color, size);

      const popupContent = document.createElement("div");
      popupContent.className = "text-sm font-medium leading-snug";
      popupContent.innerHTML = `
        <div class="font-bold text-base">${stop.name}</div>
        ${
          stop.time
            ? `<div class="text-gray-600">
            ${stop.type === "arrival" ? "Arr." : "Dep."} ${stop.time}
            ${stop.delay && stop.delay > 0 ? `<span class="text-red-600 ml-1">+${stop.delay}'</span>` : ""}
          </div>`
            : ""
        }
        ${stop.platform ? `<div class="text-gray-500 text-xs">Platform ${stop.platform}</div>` : ""}
        <div class="text-xs text-gray-400 mt-0.5 capitalize">${stop.type}</div>
      `;

      const popup = new maplibregl.Popup({ offset: 25 }).setDOMContent(popupContent);

      const marker = new maplibregl.Marker({ element: markerElement })
        .setLngLat([stop.lng, stop.lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [mapReady, stops, walks]);

  // Fit bounds
  useEffect(() => {
    if (!map.current) return;
    if (stops.length === 0) return;

    if (stops.length === 1) {
      map.current.flyTo({
        center: [stops[0].lng, stops[0].lat],
        zoom: 13,
        duration: 1000,
      });
      return;
    }

    const coordinates = stops.map((s) => [s.lng, s.lat]) as [number, number][];
    const bounds = coordinates.reduce(
      (bounds, coord) => {
        return bounds.extend(coord);
      },
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );

    map.current.fitBounds(bounds, { padding: 32, duration: 1000 });
  }, [stops]);

  return (
    <div className={`rounded-lg overflow-hidden border border-border ${className}`} style={{ height: 320 }}>
      <div ref={mapContainer} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
