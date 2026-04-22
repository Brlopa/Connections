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
  id: string;
  start: [number, number]; // [lat, lng]
  end: [number, number];   // [lat, lng]
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

  for (let i = 0; i < connection.sections.length; i++) {
    const section = connection.sections[i];
    const journey = section.journey;
    const isLastSection = i === connection.sections.length - 1;

    if (!journey) continue;

    const passList = journey.passList ?? [];

    if (passList.length > 0) {
      for (let j = 0; j < passList.length; j++) {
        const cp = passList[j];
        if (!hasCoords(cp)) continue;
        const lat = cp.station.coordinate.x!;
        const lng = cp.station.coordinate.y!;

        const isOverallDeparture = j === 0 && i === 0;
        const isOverallArrival = j === passList.length - 1 && isLastSection;
        if (isOverallDeparture || isOverallArrival) continue;

        const isTransferPoint = j === passList.length - 1 && !isLastSection;
        stops.push({
          lat,
          lng,
          name: cp.station.name || "Stop",
          time: formatTime(cp.departure ?? cp.arrival),
          platform: cp.platform,
          delay: cp.delay,
          type: isTransferPoint ? "transfer" : "passing",
        });
      }
    } else if (!isLastSection) {
      if (hasCoords(section.arrival)) {
        stops.push({
          lat: section.arrival.station.coordinate.x!,
          lng: section.arrival.station.coordinate.y!,
          name: section.arrival.station.name || "Transfer",
          time: formatTime(section.arrival.arrival),
          platform: section.arrival.platform,
          delay: section.arrival.delay,
          type: "transfer",
        });
      }
    }
  }

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

  for (let i = 0; i < connection.sections.length; i++) {
    const section = connection.sections[i];
    if (section.walk && !section.journey && hasCoords(section.departure) && hasCoords(section.arrival)) {
      const walkData = section.walk as unknown as Record<string, unknown> | null;
      walks.push({
        id: `walk-${i}`,
        start: [section.departure.station.coordinate.x!, section.departure.station.coordinate.y!],
        end: [section.arrival.station.coordinate.x!, section.arrival.station.coordinate.y!],
        duration: (walkData?.duration as number | null) ?? null,
        distance: (walkData?.distance as number | null) ?? null,
      });
    }
  }

  return walks;
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
  const [walkGeometries, setWalkGeometries] = useState<Record<string, [number, number][]>>({});

  const stops = extractStops(connection);
  const walks = extractWalkSegments(connection);

  useEffect(() => {
    if (!mapContainer.current) return;

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

    map.current.addControl(new maplibregl.FullscreenControl(), "top-right");

    map.current.on("load", () => {
      setMapReady(true);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch precise routing paths for walks asynchronously
  useEffect(() => {
    const fetchWalkRoutes = async () => {
      const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY; 
      if (!apiKey || walks.length === 0) return;

      const resolvedGeometries: Record<string, [number, number][]> = {};

      for (const walk of walks) {
        if (walkGeometries[walk.id]) continue;

        const waypoints = `${walk.start[0]},${walk.start[1]}|${walk.end[0]},${walk.end[1]}`;
        const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=walk&apiKey=${apiKey}`;

        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            // Geoapify natively returns coordinates as [lng, lat], compatible with MapLibre
            resolvedGeometries[walk.id] = data.features[0].geometry.coordinates[0];
          }
        } catch (error) {
          console.error(`Route calculation failed for segment ${walk.id}`, error);
        }
      }

      if (Object.keys(resolvedGeometries).length > 0) {
        setWalkGeometries((prev) => ({ ...prev, ...resolvedGeometries }));
      }
    };

    fetchWalkRoutes();
  }, [walks, walkGeometries]);

  useEffect(() => {
    if (!map.current || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (map.current.getSource("route-source")) {
      map.current.removeLayer("route-line");
      map.current.removeSource("route-source");
    }
    if (map.current.getSource("walks-source")) {
      map.current.removeLayer("walks-line");
      map.current.removeSource("walks-source");
    }

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

    if (walks.length > 0) {
      const walkFeatures = walks.map((walk) => {
        // Fallback to strict [lng, lat] coordinate translation if precise geometry is unavailable
        const coords = walkGeometries[walk.id] || [
          [walk.start[1], walk.start[0]],
          [walk.end[1], walk.end[0]],
        ];

        return {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: coords,
          },
        };
      });

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
  }, [mapReady, stops, walks, walkGeometries]);

  useEffect(() => {
    if (!map.current || stops.length === 0) return;

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
      (bounds, coord) => bounds.extend(coord),
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