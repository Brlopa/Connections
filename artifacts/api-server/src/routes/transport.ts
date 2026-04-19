import { Router, type IRouter } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";
const DB_API_BASE = "https://v6.db.transport.rest";

// ── fetch helpers ──────────────────────────────────────────────

async function fetchTransport(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(`${TRANSPORT_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Swiss API ${res.status}`);
  return res.json();
}

async function fetchDb(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs = 4500,
): Promise<unknown> {
  const url = new URL(`${DB_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      headers: { "Accept-Encoding": "gzip" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DB API ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── normalizers ────────────────────────────────────────────────

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
  if (p === "subway") return "M";
  if (p === "tram") return "T";
  if (p === "ferry") return "BAT";
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

  const stopovers = (leg.stopovers as Array<Record<string, unknown>>) ?? [];
  const passList = stopovers.map((sv) => {
    const stop = (sv.stop ?? sv.station ?? {}) as Record<string, unknown>;
    const svDep = (sv.plannedDeparture ?? sv.departure) as string | null | undefined;
    const svArr = (sv.plannedArrival ?? sv.arrival) as string | null | undefined;
    return {
      station: normalizeDbLocation(stop),
      arrival: svArr ?? null,
      arrivalTimestamp: svArr ? Math.floor(new Date(svArr).getTime() / 1000) : null,
      departure: svDep ?? null,
      departureTimestamp: svDep ? Math.floor(new Date(svDep).getTime() / 1000) : null,
      delay: null,
      platform: sv.departurePlatform ?? null,
    };
  });

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
    walk: isWalk ? { duration: depTs && arrTs ? arrTs - depTs : null, distance: leg.distance ?? null } : null,
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
    passList,
  };
}

function normalizeDbJourney(journey: Record<string, unknown>): Record<string, unknown> {
  const legs = (journey.legs as Array<Record<string, unknown>>) ?? [];
  const sections = legs.map(normalizeDbLeg);
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];

  const depMs = firstLeg ? new Date(String(firstLeg.departure ?? "")).getTime() : NaN;
  const arrMs = lastLeg ? new Date(String(lastLeg.arrival ?? "")).getTime() : NaN;
  const durationMin = !isNaN(depMs) && !isNaN(arrMs) ? Math.round((arrMs - depMs) / 60000) : null;
  const durationStr = durationMin != null
    ? `${String(Math.floor(durationMin / 60)).padStart(2, "0")}d${String(durationMin % 60).padStart(2, "0")}:00`
    : null;

  const vehicleLegs = legs.filter((l) => l.line);
  return {
    from: firstLeg ? normalizeDbLocation((firstLeg.origin as Record<string, unknown>) ?? {}) : null,
    to: lastLeg ? normalizeDbLocation((lastLeg.destination as Record<string, unknown>) ?? {}) : null,
    duration: durationStr,
    transfers: Math.max(0, vehicleLegs.length - 1),
    sections,
  };
}

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  const parsed = SearchLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { query, type } = parsed.data;

  const [swissResult, dbResult] = await Promise.allSettled([
    fetchTransport("/locations", { query, type }),
    fetchDb("/locations", { query, results: 8, fuzzy: true }),
  ]);

  const swissStations: Record<string, unknown>[] =
    swissResult.status === "fulfilled"
      ? ((swissResult.value as Record<string, unknown>).stations as Record<string, unknown>[]) ?? []
      : [];

  const dbRaw: Record<string, unknown>[] =
    dbResult.status === "fulfilled" && Array.isArray(dbResult.value)
      ? (dbResult.value as Record<string, unknown>[]).filter((l) => l.type === "station")
      : [];

  // Build name → DB station map for ID enrichment
  const dbByName = new Map<string, Record<string, unknown>>();
  for (const dbStn of dbRaw) {
    const name = String(dbStn.name ?? "").toLowerCase();
    if (name) dbByName.set(name, dbStn);
  }

  // Enrich Swiss stations with DB ID when names match
  const enrichedSwiss = swissStations.map((s) => {
    const nameLower = String(s.name ?? "").toLowerCase();
    const dbMatch = dbByName.get(nameLower);
    if (dbMatch) {
      dbByName.delete(nameLower); // don't add as a separate DB-only entry
      return { ...s, dbId: dbMatch.id ?? null };
    }
    return s;
  });

  // Remaining DB-only stations
  const dbOnlyStations = Array.from(dbByName.values()).map(normalizeDbLocation);

  res.json({ stations: [...enrichedSwiss, ...dbOnlyStations] });
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  const parsed = SearchConnectionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { from, to, date, time, isArrivalTime, limit, fromDbId, toDbId } = parsed.data;

  const dateStr = date ?? new Date().toISOString().split("T")[0];
  const timeStr =
    time ??
    `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

  // Swiss query always runs (fast, parallel)
  const swissPromise = fetchTransport("/connections", {
    from,
    to,
    date,
    time,
    isArrivalTime,
    limit,
  }).catch(() => null);

  // DB query: use pre-resolved IDs if available, otherwise look them up (with timeout)
  const dbPromise = (async () => {
    try {
      let resolvedFromId = fromDbId;
      let resolvedToId = toDbId;

      if (!resolvedFromId || !resolvedToId) {
        // Only look up the IDs we don't have yet
        const lookups = await Promise.all([
          !resolvedFromId
            ? (fetchDb("/locations", { query: from, results: 1, fuzzy: true }, 3000) as Promise<Record<string, unknown>[]>).catch(() => null)
            : Promise.resolve(null),
          !resolvedToId
            ? (fetchDb("/locations", { query: to, results: 1, fuzzy: true }, 3000) as Promise<Record<string, unknown>[]>).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!resolvedFromId) resolvedFromId = (lookups[0]?.[0]?.id as string | undefined);
        if (!resolvedToId) resolvedToId = (lookups[1]?.[0]?.id as string | undefined);
      }

      if (!resolvedFromId || !resolvedToId) return null;

      const departure = `${dateStr}T${timeStr}:00`;
      return fetchDb(
        "/journeys",
        { from: resolvedFromId, to: resolvedToId, departure, results: limit ?? 5, stopovers: true },
        8000,
      ) as Promise<Record<string, unknown>>;
    } catch {
      return null;
    }
  })();

  const [swissData, dbData] = await Promise.all([swissPromise, dbPromise]);

  const swissConnections: Record<string, unknown>[] =
    (swissData as Record<string, unknown> | null)?.connections as Record<string, unknown>[] ?? [];

  const dbJourneys: Record<string, unknown>[] =
    (dbData as Record<string, unknown> | null)?.journeys as Record<string, unknown>[] ?? [];
  const dbConnections = dbJourneys.map(normalizeDbJourney);

  // Merge: Swiss first, add DB results not already covered (same dep+arr ±90s)
  const merged = [...swissConnections];
  for (const dbConn of dbConnections) {
    const dbSections = (dbConn.sections as Record<string, unknown>[]) ?? [];
    const dbDep = (dbSections[0]?.departure as Record<string, unknown>)?.departure as string | undefined;
    const dbArr = (dbSections[dbSections.length - 1]?.arrival as Record<string, unknown>)?.arrival as string | undefined;

    const isDupe = merged.some((c) => {
      const cSections = (c.sections as Record<string, unknown>[]) ?? [];
      const cDep = (cSections[0]?.departure as Record<string, unknown>)?.departure as string | undefined;
      const cArr = (cSections[cSections.length - 1]?.arrival as Record<string, unknown>)?.arrival as string | undefined;
      if (!dbDep || !cDep || !dbArr || !cArr) return false;
      return (
        Math.abs(new Date(dbDep).getTime() - new Date(cDep).getTime()) < 90_000 &&
        Math.abs(new Date(dbArr).getTime() - new Date(cArr).getTime()) < 90_000
      );
    });

    if (!isDupe) merged.push(dbConn);
  }

  // Sort by departure timestamp
  merged.sort((a, b) => {
    const aSections = (a.sections as Record<string, unknown>[]) ?? [];
    const bSections = (b.sections as Record<string, unknown>[]) ?? [];
    const aTs = (aSections[0]?.departure as Record<string, unknown>)?.departureTimestamp as number ?? 0;
    const bTs = (bSections[0]?.departure as Record<string, unknown>)?.departureTimestamp as number ?? 0;
    return aTs - bTs;
  });

  const fromLoc = (swissData as Record<string, unknown> | null)?.from ?? dbConnections[0]?.from ?? null;
  const toLoc = (swissData as Record<string, unknown> | null)?.to ?? dbConnections[0]?.to ?? null;

  res.json({ from: fromLoc, to: toLoc, connections: merged });
});

router.get("/transport/stationboard", async (req, res): Promise<void> => {
  const parsed = GetStationboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { station, limit, type } = parsed.data;
  const data = await fetchTransport("/stationboard", { station, limit, type });
  res.json(data);
});

router.get("/transport/lines", async (req, res): Promise<void> => {
  try {
    const query = (req.query.query as string)?.trim() ?? "";
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? 10)), 1), 100);

    if (!query || query.length < 1) {
      res.status(400).json({ error: "Query parameter required" });
      return;
    }

    // Search for lines using DB API - try to find journeys containing the query
    try {
      const stationsData = await fetchDb("/locations", { query, results: 5, fuzzy: true }, 3000) as Array<Record<string, unknown>>;
      
      if (!Array.isArray(stationsData) || stationsData.length === 0) {
        res.json({ lines: [] });
        return;
      }

      const lines: Record<string, Record<string, unknown>> = {};

      // Get stationboards from multiple stations to find lines matching the query
      for (const station of stationsData.slice(0, 3)) {
        try {
          const stationId = station.id as string;
          const stationName = station.name as string;
          
          const stationboardData = await fetchDb("/stops/" + stationId + "/departures", { results: 50, duration: 120 }, 3000) as Record<string, unknown>;
          const departures = (stationboardData.departures as Array<Record<string, unknown>>) ?? [];

          for (const dep of departures) {
            const journey = dep.line as Record<string, unknown> | undefined;
            if (!journey) continue;

            const lineId = String(journey.id ?? "");
            const lineNumber = String(journey.name ?? "");
            const lineProduct = String(journey.product ?? "");

            // Filter by query match
            const matchesQuery = 
              lineNumber.includes(query) || 
              String(journey.operator ?? "").includes(query) ||
              String(journey.direction ?? "").includes(query);

            if (!matchesQuery && !lineNumber.match(query)) continue;

            if (!lines[lineId]) {
              lines[lineId] = {
                id: lineId,
                number: lineNumber,
                category: dbProductToCategory(journey),
                operator: journey.operator ?? "SBB",
                from: stationName,
                to: journey.direction ?? "Unknown",
                stops: 0,
              };
            }
          }

          if (Object.keys(lines).length >= limit) break;
        } catch (e) {
          continue;
        }
      }

      const linesList = Object.values(lines).slice(0, limit);
      res.json({ lines: linesList });
    } catch (err) {
      // Fallback to Swiss API stationboard if DB fails
      try {
        const stationboardData = await fetchTransport("/stationboard", { station: query, limit: 50 }) as Record<string, unknown>;
        const journeys = (stationboardData.stationboard as Array<Record<string, unknown>>) ?? [];
        
        const lines: Record<string, Record<string, unknown>> = {};
        for (const journey of journeys) {
          const line = journey.number as string | undefined;
          const category = journey.category as string | undefined;
          const to = journey.to as string | undefined;
          const operator = journey.operator as string | undefined;

          if (line && (line.includes(query) || category?.includes(query))) {
            const lineId = `${category}-${line}`;
            if (!lines[lineId]) {
              lines[lineId] = {
                id: lineId,
                number: line,
                category: category ?? "N/A",
                operator: operator ?? "N/A",
                from: query,
                to: to ?? "Unknown",
                stops: 0,
              };
            }
          }
        }

        res.json({ lines: Object.values(lines).slice(0, limit) });
      } catch (fallbackErr) {
        res.json({ lines: [] });
      }
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to search lines" });
  }
});

router.get("/transport/line/:id", async (req, res): Promise<void> => {
  try {
    const lineId = (req.params.id as string)?.trim() ?? "";
    const date = (req.query.date as string) ?? new Date().toISOString().split("T")[0];

    if (!lineId) {
      res.status(400).json({ error: "Line ID required" });
      return;
    }

    // Parse the line ID (format: "CATEGORY-NUMBER" or just the ID from DB)
    const [, lineNumber] = lineId.includes("-") ? lineId.split("-", 2) : ["", lineId];
    const finalLineNumber = lineNumber || lineId;

    try {
      // Try to get line details from DB API
      const locationData = await fetchDb("/locations", { query: finalLineNumber, results: 1, fuzzy: true }, 3000) as Array<Record<string, unknown>>;
      
      if (!Array.isArray(locationData) || locationData.length === 0) {
        res.status(404).json({ error: "Line not found" });
        return;
      }

      const station = locationData[0];
      const stationId = station.id as string;

      const stationboardData = await fetchDb("/stops/" + stationId + "/departures", { results: 100, duration: 240 }, 3000) as Record<string, unknown>;
      const departures = (stationboardData.departures as Array<Record<string, unknown>>) ?? [];

      // Find the specific line
      let foundLine: Record<string, unknown> | null = null;
      const stops: Array<Record<string, unknown>> = [];

      for (const dep of departures) {
        const journey = dep.line as Record<string, unknown> | undefined;
        if (!journey) continue;

        const jLineNumber = String(journey.name ?? "");
        if (jLineNumber !== finalLineNumber) continue;

        foundLine = journey;

        // Get complete journey info
        const journeyId = dep.id as string | undefined;
        if (journeyId) {
          try {
            const journeyData = await fetchDb("/journeys/" + journeyId, {}, 3000) as Record<string, unknown>;
            const legs = (journeyData.legs as Array<Record<string, unknown>>) ?? [];
            
            for (const leg of legs) {
              const stopovers = (leg.stopovers as Array<Record<string, unknown>>) ?? [];
              for (const stopover of stopovers) {
                const stop = (stopover.stop ?? stopover.station) as Record<string, unknown> | undefined;
                if (!stop) continue;

                const stopData = {
                  station: normalizeDbLocation(stop),
                  arrival: (stopover.plannedArrival ?? stopover.arrival) as string | null ?? null,
                  arrivalTimestamp: (() => {
                    const arrStr = (stopover.plannedArrival ?? stopover.arrival) as string | undefined;
                    return arrStr ? Math.floor(new Date(arrStr).getTime() / 1000) : null;
                  })(),
                  departure: (stopover.plannedDeparture ?? stopover.departure) as string | null ?? null,
                  departureTimestamp: (() => {
                    const depStr = (stopover.plannedDeparture ?? stopover.departure) as string | undefined;
                    return depStr ? Math.floor(new Date(depStr).getTime() / 1000) : null;
                  })(),
                  delay: null,
                  platform: stopover.departurePlatform ?? null,
                };

                // Add if not already in stops
                if (!stops.some((s) => (s.station as Record<string, unknown>)?.name === (stopData.station as Record<string, unknown>)?.name)) {
                  stops.push(stopData);
                }
              }
            }
          } catch (e) {
            // Continue if journey fetch fails
          }
        }

        if (stops.length > 0) break;
      }

      if (!foundLine || stops.length === 0) {
        res.status(404).json({ error: "Line details not found" });
        return;
      }

      const firstStop = stops[0] as Record<string, unknown>;
      const lastStop = stops[stops.length - 1] as Record<string, unknown>;

      const result = {
        id: lineId,
        number: String(foundLine.name ?? ""),
        category: dbProductToCategory(foundLine),
        categoryCode: 0,
        operator: String(foundLine.operator ?? "SBB"),
        from: firstStop?.station ?? { name: "Unknown" },
        to: lastStop?.station ?? { name: "Unknown" },
        passList: stops,
      };

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch line details" });
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
