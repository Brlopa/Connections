// artifacts/api-server/src/routes/transport.ts
import { Router, type IRouter, type Request, type Response } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";
const DB_API_BASE = "https://v6.db.transport.rest";

// ── routing decision ────────────────────────────────────────────
//
// DB/HAFAS station IDs use UIC country codes as prefix:
//   85xxxxxx → Switzerland
//   80xxxxxx → Germany
//   81xxxxxx → Austria
//   87xxxxxx → France
//   83xxxxxx → Italy
//   … etc.
//
// Rule: Only call the DB API when at least one endpoint is identified as
// non-Swiss. Swiss-only routes are served exclusively by the SBB API, which
// is more accurate for domestic connections.

function isSwissStationId(id: string): boolean {
  return /^85/.test(id);
}

function shouldUseDbApi(fromDbId?: string, toDbId?: string): boolean {
  // If we have no DB IDs at all (user typed a free-text Swiss name) → SBB only
  if (!fromDbId && !toDbId) return false;
  // Use DB API if either end-point is recognisably non-Swiss
  if (fromDbId && !isSwissStationId(fromDbId)) return true;
  if (toDbId && !isSwissStationId(toDbId)) return true;
  return false;
}

// ── fetch helpers ──────────────────────────────────────────────

async function fetchTransport(
  path: string,
  params: Record<string, string | number | boolean | undefined | string[]>,
  timeoutMs = 10000,
): Promise<unknown> {
  const url = new URL(`${TRANSPORT_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(`${k}[]`, String(val)));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`Swiss API ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDb(
  path: string,
  params: Record<string, string | number | boolean | undefined | string[]>,
  timeoutMs = 8000,
): Promise<unknown> {
  const url = new URL(`${DB_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, String(val)));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`DB API ${res.status}: ${await res.text().catch(() => "")}`);
    return await res.json();
  } catch (err) {
    // Swallow errors — DB API is a best-effort secondary source
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── geocoding helper ───────────────────────────────────────────

async function geocodeAddress(text: string): Promise<{ lat: number, lon: number } | null> {
  const GEOAPIFY_KEY = process.env.VITE_GEOAPIFY_API_KEY || process.env.GEOAPIFY_API_KEY;
  if (!GEOAPIFY_KEY) return null;
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&apiKey=${GEOAPIFY_KEY}&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.features && data.features.length > 0) {
      const coords = data.features[0].geometry.coordinates; // [lon, lat]
      return { lat: coords[1], lon: coords[0] };
    }
  } catch {
    return null;
  }
  return null;
}

function extractMissingCoords(loc: any, set: Set<string>) {
  if (loc && loc.station && loc.station.coordinate && loc.station.coordinate.x === null) {
    if (loc.station.name) {
      set.add(loc.station.name);
    }
  }
}

function applyCoords(loc: any, map: Map<string, { lat: number, lon: number }>) {
  if (loc && loc.station && loc.station.coordinate && loc.station.coordinate.x === null) {
    if (loc.station.name && map.has(loc.station.name)) {
      const coords = map.get(loc.station.name)!;
      loc.station.coordinate.x = coords.lat;
      loc.station.coordinate.y = coords.lon;
      if (loc.location && loc.location.coordinate) {
        loc.location.coordinate.x = coords.lat;
        loc.location.coordinate.y = coords.lon;
      }
    }
  }
}

// ── normalizers (DB schema → OpenData schema) ───────────────────

function normalizeDbLocation(loc: Record<string, unknown>): Record<string, unknown> {
  const location = loc.location as Record<string, unknown> | null | undefined;
  return {
    id: loc.id ?? null,
    name: loc.name ?? null,
    type: "station",
    score: null,
    coordinate: location
      ? { type: "WGS84", x: location.latitude ?? null, y: location.longitude ?? null }
      : null,
  };
}

function dbProductToCategory(line: Record<string, unknown>): string {
  const p = String(line.product ?? "");
  if (p === "nationalExpress") return "ICE";
  if (p === "national") return "IC";
  if (p === "regionalExpress") return "RE";
  if (p === "regional") return "R";
  if (p === "suburban") return "S";
  if (p === "bus") return "B";
  return String(line.name ?? "").split(" ")[0] ?? "";
}

function normalizeDbLeg(leg: Record<string, unknown>): Record<string, unknown> {
  const line = leg.line as Record<string, unknown> | null | undefined;
  const origin = (leg.origin as Record<string, unknown>) ?? {};
  const destination = (leg.destination as Record<string, unknown>) ?? {};
  const isWalk = leg.walking === true || !line;

  const depStr = (leg.plannedDeparture ?? leg.departure) as string | null | undefined;
  const arrStr = (leg.plannedArrival ?? leg.arrival) as string | null | undefined;
  const depTs = depStr ? Math.floor(new Date(depStr).getTime() / 1000) : null;
  const arrTs = arrStr ? Math.floor(new Date(arrStr).getTime() / 1000) : null;

  const depDelay = leg.departureDelay as number | null | undefined;
  const arrDelay = leg.arrivalDelay as number | null | undefined;

  return {
    journey: line
      ? {
          name: line.name ?? "",
          category: dbProductToCategory(line),
          number: line.id ?? "",
          to: leg.direction ?? "",
          passList: [],
        }
      : null,
    walk: isWalk
      ? { duration: depTs && arrTs ? arrTs - depTs : null, distance: leg.distance ?? null }
      : null,
    departure: {
      station: normalizeDbLocation(origin),
      departure: depStr ?? null,
      departureTimestamp: depTs,
      delay: depDelay != null ? Math.round(depDelay / 60) : null,
      platform: leg.departurePlatform ?? null,
    },
    arrival: {
      station: normalizeDbLocation(destination),
      arrival: arrStr ?? null,
      arrivalTimestamp: arrTs,
      delay: arrDelay != null ? Math.round(arrDelay / 60) : null,
      platform: leg.arrivalPlatform ?? null,
    },
    passList: [],
  };
}

function normalizeDbJourney(journey: Record<string, unknown>): Record<string, unknown> {
  const legs = (journey.legs as Array<Record<string, unknown>>) ?? [];
  const sections = legs.map(normalizeDbLeg);

  const depMs = legs[0] ? new Date(String(legs[0].plannedDeparture ?? legs[0].departure ?? "")).getTime() : NaN;
  const arrMs = legs[legs.length - 1]
    ? new Date(String(legs[legs.length - 1].plannedArrival ?? legs[legs.length - 1].arrival ?? "")).getTime()
    : NaN;

  let durationStr = null;
  if (!isNaN(depMs) && !isNaN(arrMs)) {
    const durationMin = Math.round((arrMs - depMs) / 60000);
    const days = Math.floor(durationMin / 1440);
    const hours = Math.floor((durationMin % 1440) / 60);
    const mins = durationMin % 60;
    durationStr = `${String(days).padStart(2, "0")}d${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
  }

  const vehicleLegs = legs.filter((l) => l.line);
  const firstSection = sections[0] as Record<string, unknown> | undefined;
  const lastSection = sections[sections.length - 1] as Record<string, unknown> | undefined;

  return {
    from: firstSection?.departure ?? null,
    to: lastSection?.arrival ?? null,
    duration: durationStr,
    transfers: Math.max(0, vehicleLegs.length - 1),
    sections,
  };
}

// ── helper: resolve DB station ID by name (only if not already known) ──

async function resolveDbStationId(
  name: string,
  knownId?: string,
  timeoutMs = 4000,
): Promise<string | undefined> {
  if (knownId) return knownId;
  const result = await fetchDb("/locations", { query: name, results: 1, fuzzy: true }, timeoutMs);
  return (result as any[])?.[0]?.id as string | undefined;
}

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
    // Coordinate-based search (geolocation: x=latitude, y=longitude)
    if (req.query.x && req.query.y) {
      const x = String(req.query.x);
      const y = String(req.query.y);
      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const data = await fetchTransport("/locations", { x, y, type }).catch(() => ({ stations: [] }));
      res.json(data);
      return;
    }

    const parsed = SearchLocationsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { query, type } = parsed.data;

    // Query both APIs in parallel
    const [swissResult, dbResult] = await Promise.allSettled([
      fetchTransport("/locations", { query, type }),
      fetchDb("/locations", { query, results: 8, fuzzy: true }),
    ]);

    const swissStations: Record<string, unknown>[] =
      swissResult.status === "fulfilled"
        ? ((swissResult.value as Record<string, unknown>)?.stations as Record<string, unknown>[]) ?? []
        : [];

    const dbRaw: Record<string, unknown>[] =
      dbResult.status === "fulfilled" && Array.isArray(dbResult.value)
        ? (dbResult.value as Record<string, unknown>[]).filter((l) => l.type === "station")
        : [];

    // Build DB name → station map for cross-referencing
    const dbByName = new Map<string, Record<string, unknown>>();
    for (const dbStn of dbRaw) {
      const name = String(dbStn.name ?? "").toLowerCase();
      if (name) dbByName.set(name, dbStn);
    }

    // Enrich Swiss stations with their DB IDs where names match
    const enrichedSwiss = swissStations.map((s) => {
      const nameLower = String(s.name ?? "").toLowerCase();
      const dbMatch = dbByName.get(nameLower);
      if (dbMatch) {
        dbByName.delete(nameLower);
        return { ...s, dbId: dbMatch.id ?? null };
      }
      return s;
    });

    // Append DB-only stations (not already in Swiss results)
    const dbOnlyStations = Array.from(dbByName.values()).map(normalizeDbLocation);
    const finalStations = [...enrichedSwiss, ...dbOnlyStations];

    // Geocode any addresses without coordinates
    const missingCoords = new Set<string>();
    finalStations.forEach((s: any) => {
      if (s.coordinate && s.coordinate.x === null && s.name) {
        missingCoords.add(s.name);
      }
    });

    if (missingCoords.size > 0) {
      const coordsMap = new Map<string, { lat: number, lon: number }>();
      await Promise.all(
        Array.from(missingCoords).map(async (name) => {
          const coords = await geocodeAddress(name);
          if (coords) coordsMap.set(name, coords);
        })
      );
      finalStations.forEach((s: any) => {
        if (s.coordinate && s.coordinate.x === null && s.name && coordsMap.has(s.name)) {
          const coords = coordsMap.get(s.name)!;
          s.coordinate.x = coords.lat;
          s.coordinate.y = coords.lon;
        }
      });
    }

    res.json({ stations: finalStations });
  } catch (error) {
    res.status(500).json({ error: "Failed to process location search request." });
  }
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  try {
    // --- Normalise query ---------------------------------------------------
    // Express parses a single ?via=X as a string; the schema expects string[].
    const rawQuery = { ...req.query };
    if (rawQuery.via !== undefined && !Array.isArray(rawQuery.via)) {
      rawQuery.via = [rawQuery.via as string];
    }

    // fromDbId / toDbId are not in the generated OpenAPI schema and get stripped
    // by Zod, so we read them directly from req.query before parsing.
    const fromDbId = typeof req.query.fromDbId === "string" ? req.query.fromDbId : undefined;
    const toDbId = typeof req.query.toDbId === "string" ? req.query.toDbId : undefined;

    const parsed = SearchConnectionsQueryParams.safeParse(rawQuery);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { from, to, via, date, time, isArrivalTime, limit } = parsed.data;

    // Default date / time used by the DB API (SBB API defaults on its own)
    const dateStr = date ?? new Date().toISOString().split("T")[0];
    const timeStr =
      time ??
      `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

    // --- Decide which APIs to call ----------------------------------------
    const useDb = shouldUseDbApi(fromDbId, toDbId);

    // Always call SBB (it handles Swiss domestic + many cross-border trains)
    const swissPromise = fetchTransport("/connections", {
      from,
      to,
      via,
      date,
      time,
      isArrivalTime,
      limit,
    }).catch(() => null);

    // Only call DB API when at least one station is non-Swiss
    const dbPromise: Promise<unknown> = useDb
      ? (async (): Promise<unknown> => {
          try {
            // Resolve station IDs — use the known DB IDs where available,
            // otherwise look them up by name (necessary for pure-text searches
            // and for the non-Swiss end of a cross-border route).
            const [resolvedFromId, resolvedToId] = await Promise.all([
              resolveDbStationId(from, fromDbId, 4000),
              resolveDbStationId(to, toDbId, 4000),
            ]);

            if (!resolvedFromId || !resolvedToId) {
              return null;
            }

            const departure = `${dateStr}T${timeStr}:00`;

            const dbParams: Record<string, string | number | string[]> = {
              from: resolvedFromId,
              to: resolvedToId,
              departure,
              results: limit ?? 5,
            };

            // Optionally resolve a via station ID
            if (via && via.length > 0) {
              try {
                const viaResult = await fetchDb(
                  "/locations",
                  { query: via[0], results: 1, fuzzy: true },
                  2000,
                );
                const viaId = (viaResult as any[])?.[0]?.id as string | undefined;
                if (viaId) dbParams.via = viaId;
              } catch {
                // via lookup failed — proceed without it
              }
            }

            return await fetchDb("/journeys", dbParams, 8000);
          } catch {
            return null;
          }
        })()
      : Promise.resolve(null);

    // --- Merge results ----------------------------------------------------
    const [swissData, dbData] = await Promise.all([swissPromise, dbPromise]);

    const swissConnections: Record<string, unknown>[] =
      (swissData as any)?.connections ?? [];
    const dbJourneys: Record<string, unknown>[] =
      (dbData as any)?.journeys ?? [];
    const dbConnections = dbJourneys.map(normalizeDbJourney);

    // Start with Swiss results, then append non-duplicate DB results
    const merged = [...swissConnections];

    for (const dbConn of dbConnections) {
      const dbSections = (dbConn.sections as any[]) ?? [];
      const dbDep = dbSections[0]?.departure?.departure;
      const dbArr = dbSections[dbSections.length - 1]?.arrival?.arrival;

      const isDupe = merged.some((c) => {
        const cSections = (c.sections as any[]) ?? [];
        const cDep = cSections[0]?.departure?.departure;
        const cArr = cSections[cSections.length - 1]?.arrival?.arrival;
        if (!dbDep || !cDep || !dbArr || !cArr) return false;
        // 90-second epsilon to catch same departure represented slightly differently
        return (
          Math.abs(new Date(dbDep).getTime() - new Date(cDep).getTime()) < 90_000 &&
          Math.abs(new Date(dbArr).getTime() - new Date(cArr).getTime()) < 90_000
        );
      });

      if (!isDupe) merged.push(dbConn);
    }

    // Sort chronologically by departure timestamp
    merged.sort((a, b) => {
      const aTs =
        ((a.sections as any[])?.[0]?.departure?.departureTimestamp as number) ?? 0;
      const bTs =
        ((b.sections as any[])?.[0]?.departure?.departureTimestamp as number) ?? 0;
      return aTs - bTs;
    });

    // Derive display locations: prefer SBB response, fall back to first DB connection
    const fromLoc =
      (swissData as any)?.from ??
      (dbConnections[0]?.from as any)?.station ??
      null;
    const toLoc =
      (swissData as any)?.to ??
      (dbConnections[0]?.to as any)?.station ??
      null;

    const missingCoords = new Set<string>();
    if (fromLoc?.coordinate && fromLoc.coordinate.x === null && fromLoc.name) missingCoords.add(fromLoc.name);
    if (toLoc?.coordinate && toLoc.coordinate.x === null && toLoc.name) missingCoords.add(toLoc.name);

    merged.forEach(conn => {
      extractMissingCoords(conn.from, missingCoords);
      extractMissingCoords(conn.to, missingCoords);
      (conn.sections as any[])?.forEach((sec: any) => {
        extractMissingCoords(sec.departure, missingCoords);
        extractMissingCoords(sec.arrival, missingCoords);
      });
    });

    if (missingCoords.size > 0) {
      const coordsMap = new Map<string, { lat: number, lon: number }>();
      await Promise.all(
        Array.from(missingCoords).map(async (name) => {
          const coords = await geocodeAddress(name);
          if (coords) coordsMap.set(name, coords);
        })
      );

      if (fromLoc?.coordinate && fromLoc.coordinate.x === null && fromLoc.name && coordsMap.has(fromLoc.name)) {
        const coords = coordsMap.get(fromLoc.name)!;
        fromLoc.coordinate.x = coords.lat;
        fromLoc.coordinate.y = coords.lon;
      }
      if (toLoc?.coordinate && toLoc.coordinate.x === null && toLoc.name && coordsMap.has(toLoc.name)) {
        const coords = coordsMap.get(toLoc.name)!;
        toLoc.coordinate.x = coords.lat;
        toLoc.coordinate.y = coords.lon;
      }

      merged.forEach(conn => {
        applyCoords(conn.from, coordsMap);
        applyCoords(conn.to, coordsMap);
        (conn.sections as any[])?.forEach((sec: any) => {
          applyCoords(sec.departure, coordsMap);
          applyCoords(sec.arrival, coordsMap);
        });
      });
    }

    res.json({ from: fromLoc, to: toLoc, connections: merged });
  } catch (error) {
    res.status(500).json({ error: "Failed to process connection search request." });
  }
});

router.get("/transport/stationboard", async (req, res): Promise<void> => {
  try {
    const parsed = GetStationboardQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { station, limit, type } = parsed.data;
    const data = await fetchTransport("/stationboard", { station, limit, type });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to process stationboard request." });
  }
});

interface GeoCoordinate {
  lat: number;
  lon: number;
}

router.post('/transport/route', async (req: Request, res: Response): Promise<void> => {
  const { start, end } = req.body as { start: GeoCoordinate; end: GeoCoordinate };
  const GEOAPIFY_KEY = process.env.VITE_GEOAPIFY_API_KEY || process.env.GEOAPIFY_API_KEY;

  if (!start || !end) {
    res.status(400).json({ error: 'Missing start or end coordinates' });
    return;
  }

  if (!GEOAPIFY_KEY) {
    res.status(500).json({ error: 'GEOAPIFY_API_KEY environment variable is not configured.' });
    return;
  }

  const waypoints = `${start.lat},${start.lon}|${end.lat},${end.lon}`;
  const requestUrl = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=walk&apiKey=${GEOAPIFY_KEY}`;

  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error(`Routing API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      res.status(404).json({ error: 'No valid path found' });
      return;
    }

    res.json(data.features[0]);
  } catch (error) {
    console.error('Route calculation error:', error);
    res.status(500).json({ error: 'Internal Server Error during routing' });
  }
});

export default router;
