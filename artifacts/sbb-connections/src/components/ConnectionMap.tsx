import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { format, parseISO } from "date-fns";
import type { Connection, Checkpoint } from "@workspace/api-client-react/src/generated/api.schemas";

// Fix leaflet default icon paths broken by Vite bundling
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});

// Custom marker icons
function makeIcon(color: string, size = 14) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

const departureIcon = makeIcon("#16a34a", 18);
const arrivalIcon = makeIcon("#dc2626", 18);
const transferIcon = makeIcon("#d97706", 16);
const passingIcon = makeIcon("#94a3b8", 10);
const walkIcon = makeIcon("#f59e0b", 12);

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

function FitBounds({ stops }: { stops: StopPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length === 0) return;
    if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 13);
      return;
    }
    const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [stops, map]);
  return null;
}

interface ConnectionMapProps {
  connection: Connection;
  className?: string;
}

export function ConnectionMap({ connection, className = "" }: ConnectionMapProps) {
  const stops = extractStops(connection);
  const walks = extractWalkSegments(connection);
  const routePoints: [number, number][] = stops.map((s) => [s.lat, s.lng]);

  const center: [number, number] =
    stops.length > 0
      ? [stops[Math.floor(stops.length / 2)].lat, stops[Math.floor(stops.length / 2)].lng]
      : [46.8, 8.2];

  function iconFor(type: StopPoint["type"]) {
    if (type === "departure") return departureIcon;
    if (type === "arrival") return arrivalIcon;
    if (type === "transfer") return transferIcon;
    if (type === "walk-start" || type === "walk-end") return walkIcon;
    return passingIcon;
  }

  return (
    <div className={`rounded-lg overflow-hidden border border-border ${className}`} style={{ height: 320 }}>
      <MapContainer
        center={center}
        zoom={10}
        style={{ height: "100%", width: "100%" }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        {/* Swiss federal mapping tiles (swisstopo) — same source as map.sbb.ch */}
              <TileLayer
        url="https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg"
        attribution='&copy; <a href="https://www.swisstopo.admin.ch/" target="_blank">swisstopo</a>'
        maxZoom={19}
      />

        {/* Route polyline for transit */}
        {routePoints.length > 1 && (
          <Polyline
            positions={routePoints}
            pathOptions={{ color: "#dc2626", weight: 3, opacity: 0.85, dashArray: undefined }}
          />
        )}

        {/* Walking route polylines */}
        {walks.map((walk, i) => (
          <Polyline
            key={`walk-${i}`}
            positions={[walk.start, walk.end]}
            pathOptions={{ 
              color: "#f59e0b", 
              weight: 3, 
              opacity: 0.85, 
              dashArray: "5, 5",
              lineCap: "round",
              lineJoin: "round"
            }}
          />
        ))}

        {/* Stop markers */}
        {stops.map((stop, i) => (
          <Marker key={i} position={[stop.lat, stop.lng]} icon={iconFor(stop.type)}>
            <Popup>
              <div className="text-sm font-medium leading-snug">
                <div className="font-bold text-base">{stop.name}</div>
                {stop.time && (
                  <div className="text-gray-600">
                    {stop.type === "arrival" ? "Arr." : "Dep."} {stop.time}
                    {stop.delay && stop.delay > 0 && (
                      <span className="text-red-600 ml-1">+{stop.delay}'</span>
                    )}
                  </div>
                )}
                {stop.platform && <div className="text-gray-500 text-xs">Platform {stop.platform}</div>}
                <div className="text-xs text-gray-400 mt-0.5 capitalize">{stop.type}</div>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBounds stops={stops} />
      </MapContainer>
    </div>
  );
}
