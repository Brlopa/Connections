import { Router, type IRouter } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";
const DB_API_BASE = "https://v6.db.transport.rest";

async function fetchTransport(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(`${TRANSPORT_API_BASE}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Swiss API ${response.status}`);
  return response.json();
}

async function fetchDb(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(`${DB_API_BASE}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  const response = await fetch(url.toString(), {
    headers: { "Accept-Encoding": "gzip" },
  });
  if (!response.ok) throw new Error(`DB API ${response.status}`);
  return response.json();
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

  const depStr = (leg.plannedDeparture ?? leg.departure) as string | null | undefined;
  const arrStr = (leg.plannedArrival ?? leg.arrival) as string | null | undefined;
  const depTs = depStr ? Math.floor(new Date(depStr).getTime() / 1000) : null;
  const arrTs = arrStr ? Math.floor(new Date(arrStr).getTime() / 1000) : null;

  const stopovers = (leg.stopovers as Array<Record<string, unknown>>) ?? [];
  const passList = stopovers.map((sv) => {
    const stop = ((sv.stop ?? sv.station ?? {}) as Record<string, unknown>);
    const svDep = (sv.plannedDeparture ?? sv.departure) as string | null | undefined;
    const svArr = (sv.plannedArrival ?? sv.arrival) as string | null | undefined;
    const delay = sv.departureDelay as number | null | undefined;
    return {
      station: normalizeDbLocation(stop),
      arrival: svArr ?? null,
      arrivalTimestamp: svArr ? Math.floor(new Date(svArr).getTime() / 1000) : null,
      departure: svDep ?? null,
      departureTimestamp: svDep ? Math.floor(new Date(svDep).getTime() / 1000) : null,
      delay: delay != null ? Math.round(delay / 60) : null,
      platform: sv.departurePlatform ?? null,
    };
  });

  const isWalk = leg.walking === true || !line;
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
    walk: isWalk ? {} : null,
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

  // Query both networks in parallel; don't fail if one errors
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
  const dbStations = dbRaw.map(normalizeDbLocation);

  // Merge: Swiss first, then DB stations not already present by name
  const swissNames = new Set(swissStations.map((s) => String(s.name ?? "").toLowerCase()));
  const uniqueDb = dbStations.filter((s) => !swissNames.has(String(s.name ?? "").toLowerCase()));

  res.json({ stations: [...swissStations, ...uniqueDb] });
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  const parsed = SearchConnectionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { from, to, date, time, isArrivalTime, limit } = parsed.data;

  const dateStr = date ?? new Date().toISOString().split("T")[0];
  const timeStr =
    time ??
    `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

  // Swiss and DB queries run in parallel
  const swissPromise = fetchTransport("/connections", {
    from,
    to,
    date,
    time,
    isArrivalTime,
    limit,
  }).catch(() => null);

  const dbPromise = (async () => {
    try {
      // Resolve station IDs from names first (parallel)
      const [fromLocs, toLocs] = await Promise.all([
        fetchDb("/locations", { query: from, results: 1, fuzzy: true }) as Promise<Record<string, unknown>[]>,
        fetchDb("/locations", { query: to, results: 1, fuzzy: true }) as Promise<Record<string, unknown>[]>,
      ]);
      const fromId = fromLocs?.[0]?.id as string | undefined;
      const toId = toLocs?.[0]?.id as string | undefined;
      if (!fromId || !toId) return null;

      const departure = `${dateStr}T${timeStr}:00`;
      return fetchDb("/journeys", {
        from: fromId,
        to: toId,
        departure,
        results: limit ?? 5,
        stopovers: true,
      }) as Promise<Record<string, unknown>>;
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

  // Merge: keep Swiss results, add DB results not already covered (same dep+arr time ±1 min)
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

export default router;
