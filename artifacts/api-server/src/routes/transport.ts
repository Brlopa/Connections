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

    // Search for Swiss stations using the official SBB API
    try {
      const locationsData = await fetchTransport("/locations", { query, type: "station" }) as Record<string, unknown>;
      const stations = (locationsData.stations as Array<Record<string, unknown>>) ?? [];

      if (stations.length === 0) {
        res.json({ lines: [] });
        return;
      }

      const lines: Record<string, Record<string, unknown>> = {};

      // Get stationboards from Swiss stations to find lines
      for (const station of stations.slice(0, 3)) {
        try {
          const stationName = station.name as string;
          
          // Get all departures from this station
          const stationboardData = await fetchTransport("/stationboard", { station: stationName, limit: 50 }) as Record<string, unknown>;
          const journeys = (stationboardData.stationboard as Array<Record<string, unknown>>) ?? [];

          for (const journey of journeys) {
            const lineNumber = journey.number as string | undefined;
            const category = journey.category as string | undefined;
            const operator = journey.operator as string | undefined;
            const destination = journey.to as string | undefined;

            if (!lineNumber) continue;

            // Filter by query match - check line number, category, operator, or destination
            const matchesQuery = 
              lineNumber.includes(query) || 
              category?.toUpperCase().includes(query.toUpperCase()) ||
              operator?.toUpperCase().includes(query.toUpperCase()) ||
              destination?.toUpperCase().includes(query.toUpperCase());

            if (!matchesQuery) continue;

            const lineId = `${category}-${lineNumber}`;
            if (!lines[lineId]) {
              lines[lineId] = {
                id: lineId,
                number: lineNumber,
                category: category ?? "N/A",
                operator: operator ?? "SBB",
                from: stationName,
                to: destination ?? "Unknown",
                stops: 0,
              };
            }
          }

          if (Object.keys(lines).length >= limit) break;
        } catch (e) {
          // Continue to next station if this one fails
          continue;
        }
      }

      const linesList = Object.values(lines).slice(0, limit);
      res.json({ lines: linesList });
    } catch (err) {
      res.status(500).json({ error: "Failed to search lines" });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to search lines" });
  }
});

router.get("/transport/line/:id", async (req, res): Promise<void> => {
  try {
    const lineId = (req.params.id as string)?.trim() ?? "";

    if (!lineId) {
      res.status(400).json({ error: "Line ID required" });
      return;
    }

    // Parse the line ID (format: "CATEGORY-NUMBER")
    const [category, lineNumber] = lineId.includes("-") ? lineId.split("-", 2) : ["", lineId];

    try {
      // Search for Swiss stations to get stationboards with this line
      const locationsData = await fetchTransport("/locations", { query: "", type: "station" }) as Record<string, unknown>;
      const stations = (locationsData.stations as Array<Record<string, unknown>>) ?? [];

      let foundLine: Record<string, unknown> | null = null;
      let foundJourney: Record<string, unknown> | null = null;
      let fromStation: Record<string, unknown> | null = null;
      let toStation: Record<string, unknown> | null = null;

      // Search through stations for this line
      for (const station of stations) {
        try {
          const stationName = station.name as string;
          
          const stationboardData = await fetchTransport("/stationboard", { station: stationName, limit: 50 }) as Record<string, unknown>;
          const journeys = (stationboardData.stationboard as Array<Record<string, unknown>>) ?? [];

          for (const journey of journeys) {
            const jLineNumber = journey.number as string | undefined;
            const jCategory = journey.category as string | undefined;

            if (jLineNumber === lineNumber && (!category || jCategory === category)) {
              foundJourney = journey;
              fromStation = {
                id: station.id ?? null,
                name: stationName,
                type: "station",
                score: null,
                coordinate: (station.coordinate as Record<string, unknown>) ?? null,
              };
              foundLine = {
                name: jLineNumber,
                category: jCategory,
                operator: journey.operator ?? "SBB",
              };
              break;
            }
          }

          if (foundJourney) break;
        } catch (e) {
          continue;
        }
      }

      if (!foundLine || !foundJourney) {
        res.status(404).json({ error: "Line not found" });
        return;
      }

      // Get the destination from the journey
      toStation = {
        id: null,
        name: (foundJourney.to as string) ?? "Unknown",
        type: "station",
        score: null,
        coordinate: null,
      };

      // Get passing list from the journey (if available)
      const passList = (foundJourney.passList as Array<Record<string, unknown>>) ?? [];

      const result = {
        id: lineId,
        number: String(foundLine.name ?? ""),
        category: String(foundLine.category ?? ""),
        categoryCode: 0,
        operator: String(foundLine.operator ?? "SBB"),
        from: fromStation,
        to: toStation,
        passList: passList.length > 0 ? passList : [
          {
            station: fromStation,
            departure: foundJourney.departure ?? null,
            departureTimestamp: foundJourney.departureTimestamp ?? null,
            delay: null,
            platform: foundJourney.departureMode?.platform ?? null,
          },
          {
            station: toStation,
            arrival: foundJourney.arrival ?? null,
            arrivalTimestamp: foundJourney.arrivalTimestamp ?? null,
            delay: null,
            platform: null,
          },
        ],
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
