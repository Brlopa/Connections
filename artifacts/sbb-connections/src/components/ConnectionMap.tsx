import { useEffect, useRef, useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ConnectionMap.css";
import type { Connection, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

const MARKER_COLORS = {
  departure: "#16a34a",
  arrival: "#dc2626",
  transfer: "#d97706",
  passing: "#94a3b8",
  walk: "#0b26f5",
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
  _priority: number;
}

interface WalkSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  duration: number | null;
  distance: number | null;
}

interface TransitSegment {
  id: string;
  coordinates: [number, number][];
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return null;
  try { return format(parseISO(iso), "HH:mm"); } catch { return null; }
}

function hasCoords(cp: Checkpoint | null | undefined): cp is Checkpoint & { station: { coordinate: { x: number; y: number } } } {
  return !!(cp?.station?.coordinate?.x && cp?.station?.coordinate?.y);
}

// Extrahiert Marker-Knoten basierend auf Prioritätsgewichtung
function extractStops(connection: Connection): StopPoint[] {
  const stopsMap = new Map<string, StopPoint>();

  const addStop = (cp: Checkpoint | null | undefined, type: StopPoint["type"], priority: number) => {
    if (!hasCoords(cp)) return;
    const lat = cp.station.coordinate.x!;
    const lng = cp.station.coordinate.y!;
    const key = `${lat},${lng}`;
    
    const existing = stopsMap.get(key);
    if (!existing || priority > existing._priority) {
      stopsMap.set(key, {
        lat, lng,
        name: cp.station.name || "Stop",
        time: formatTime(cp.departure ?? cp.arrival),
        platform: cp.platform,
        delay: cp.delay,
        type,
        _priority: priority
      });
    }
  };

  // 1. Initialer Suchpunkt (Priorität 3)
  addStop(connection.from, "departure", 3);

  connection.sections.forEach((sec, i) => {
    const isLast = i === connection.sections.length - 1;

    // Abfahrtsstation des Teilabschnitts (Priorität 2)
    addStop(sec.departure, "transfer", 2);

    if (sec.journey?.passList) {
      sec.journey.passList.forEach((p, j) => {
        const isTransfer = j === sec.journey!.passList.length - 1 && !isLast;
        addStop(p, isTransfer ? "transfer" : "passing", isTransfer ? 2 : 1);
      });
    } else if (!isLast) {
      addStop(sec.arrival, "transfer", 2);
    }
    
    // Ankunftsstation des Teilabschnitts (Priorität 2)
    addStop(sec.arrival, "transfer", 2);
  });

  // 3. Finaler Zielpunkt (Priorität 3)
  addStop(connection.to, "arrival", 3);
  return Array.from(stopsMap.values());
}

// Extrahiert exklusiv Transit-Vektoren (S_transit)
function extractTransitSegments(connection: Connection): TransitSegment[] {
  const segments: TransitSegment[] = [];
  connection.sections.forEach((sec, i) => {
    if (sec.journey && hasCoords(sec.departure) && hasCoords(sec.arrival)) {
      const coords: [number, number][] = [];
      coords.push([sec.departure.station.coordinate.y!, sec.departure.station.coordinate.x!]);
      
      if (sec.journey.passList) {
        sec.journey.passList.forEach((cp) => {
          if (hasCoords(cp)) {
            coords.push([cp.station.coordinate.y!, cp.station.coordinate.x!]);
          }
        });
      }
      
      coords.push([sec.arrival.station.coordinate.y!, sec.arrival.station.coordinate.x!]);
      segments.push({ id: `transit-${i}`, coordinates: coords });
    }
  });
  return segments;
}

// Extrahiert Gehweg-Vektoren inkl. impliziter Erste- und Letzte-Meile Berechnungen
function extractWalkSegments(connection: Connection): WalkSegment[] {
  const walks: WalkSegment[] = [];

  // Berechnet das Delta zweier Vektoren, Schwellenwert: 0.0001° (~10m)
  const isSignificantGap = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    return Math.abs(lat1 - lat2) > 0.0001 || Math.abs(lon1 - lon2) > 0.0001;
  };

  // 1. Implizite Erste Meile: connection.from -> section[0].departure
  if (connection.sections.length > 0 && hasCoords(connection.from) && hasCoords(connection.sections[0].departure)) {
    const p1 = connection.from.station.coordinate;
    const p2 = connection.sections[0].departure.station.coordinate;
    if (isSignificantGap(p1.x!, p1.y!, p2.x!, p2.y!)) {
      walks.push({
        id: `walk-implicit-start`,
        start: [p1.x!, p1.y!],
        end: [p2.x!, p2.y!],
        duration: null,
        distance: null,
      });
    }
  }

  // 2. Explizite Segmente der API
  connection.sections.forEach((sec, i) => {
    if (!sec.journey && hasCoords(sec.departure) && hasCoords(sec.arrival)) {
      walks.push({
        id: `walk-${i}`,
        start: [sec.departure.station.coordinate.x!, sec.departure.station.coordinate.y!],
        end: [sec.arrival.station.coordinate.x!, sec.arrival.station.coordinate.y!],
        duration: sec.walk ? (sec.walk as any).duration : null,
        distance: sec.walk ? (sec.walk as any).distance : null,
      });
    }
  });

  // 3. Implizite Letzte Meile: section[last].arrival -> connection.to
  if (connection.sections.length > 0 && hasCoords(connection.to)) {
    const lastSec = connection.sections[connection.sections.length - 1];
    if (hasCoords(lastSec.arrival)) {
      const p1 = lastSec.arrival.station.coordinate;
      const p2 = connection.to.station.coordinate;
      if (isSignificantGap(p1.x!, p1.y!, p2.x!, p2.y!)) {
        walks.push({
          id: `walk-implicit-end`,
          start: [p1.x!, p1.y!],
          end: [p2.x!, p2.y!],
          duration: null,
          distance: null,
        });
      }
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
  
  const [walkGeometries, setWalkGeometries] = useState<Record<string, any>>({});

  const stops = useMemo(() => extractStops(connection), [connection]);
  const transitSegments = useMemo(() => extractTransitSegments(connection), [connection]);
  const walks = useMemo(() => extractWalkSegments(connection), [connection]);

  useEffect(() => {
    if (!mapContainer.current) return;

    const center: [number, number] = stops.length > 0
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let isMounted = true;
    const fetchWalkRoutes = async () => {
      const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY; 
      if (!apiKey || walks.length === 0) return;

      const resolvedGeometries: Record<string, any> = {};
      let hasNewGeometries = false;

      for (const walk of walks) {
        if (walk.start[0] === walk.end[0] && walk.start[1] === walk.end[1]) continue;

        setWalkGeometries((current) => {
          if (current[walk.id]) return current;
          return current;
        });

        const waypoints = `${walk.start[0]},${walk.start[1]}|${walk.end[0]},${walk.end[1]}`;
        const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=walk&apiKey=${apiKey}`;

        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            resolvedGeometries[walk.id] = data.features[0].geometry;
            hasNewGeometries = true;
          }
        } catch (error) {
          console.error(`Route calculation failed for ${walk.id}`, error);
        }
      }

      if (isMounted && hasNewGeometries) {
        setWalkGeometries((prev) => ({ ...prev, ...resolvedGeometries }));
      }
    };

    fetchWalkRoutes();

    return () => { isMounted = false; };
  }, [walks]);

  useEffect(() => {
    if (!map.current || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (map.current.getSource("transit-source")) {
      map.current.removeLayer("transit-line");
      map.current.removeSource("transit-source");
    }
    if (map.current.getSource("walks-source")) {
      map.current.removeLayer("walks-line");
      map.current.removeSource("walks-source");
    }

    if (transitSegments.length > 0) {
      const transitFeatures = transitSegments.map(seg => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: seg.coordinates,
        },
      }));

      map.current.addSource("transit-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: transitFeatures,
        },
      });

      map.current.addLayer({
        id: "transit-line",
        type: "line",
        source: "transit-source",
        paint: {
          "line-color": "#dc2626",
          "line-width": 3,
          "line-opacity": 0.85,
        },
      });
    }

    if (walks.length > 0) {
      const walkFeatures = walks.map((walk) => {
        const geom = walkGeometries[walk.id] || {
          type: "LineString",
          coordinates: [
            [walk.start[1], walk.start[0]],
            [walk.end[1], walk.end[0]],
          ],
        };

        return {
          type: "Feature" as const,
          properties: {},
          geometry: geom,
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
          "line-color": "#0b26f5",
          "line-width": 5,
          "line-opacity": 1,
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
  }, [mapReady, stops, transitSegments, walks, walkGeometries]);

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