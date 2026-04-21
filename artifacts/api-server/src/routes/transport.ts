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
  timeoutMs = 10000,
): Promise<unknown> {
  const url = new URL(`${TRANSPORT_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
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
    return await res.json();
  } catch (err) {
    const e = err as any;
    const errName = e?.name || e?.cause?.name;
    const errCode = e?.code || e?.cause?.code;
    const errMsg = e?.message || String(err);

    if (
      errName === "AbortError" ||
      errName === "TimeoutError" ||
      errMsg.includes("aborted") ||
      errMsg.includes("fetch failed") ||
      errCode === "UND_ERR_CONNECT_TIMEOUT" ||
      errCode === "ECONNRESET" ||
      errCode === "ETIMEDOUT" ||
      errCode === "ECONNREFUSED"
    ) {
      return null;
    }
    throw err;
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
          passList,
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
  const legs = Array.isArray(journey.legs)
    ? (journey.legs as Array<Record<string, unknown>>)
    : [];
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

  // Build proper Checkpoint objects for from/to so that connection.from.station.name
  // works correctly in the frontend (previously was a bare Location without .station).
  const firstDepStr = firstLeg
    ? ((String((firstLeg.plannedDeparture ?? firstLeg.departure) ?? "")) || null)
    : null;
  const lastArrStr = lastLeg
    ? ((String((lastLeg.plannedArrival ?? lastLeg.arrival) ?? "")) || null)
    : null;
  const firstDepTs = firstDepStr ? Math.floor(new Date(firstDepStr).getTime() / 1000) : null;
  const lastArrTs = lastArrStr ? Math.floor(new Date(lastArrStr).getTime() / 1000) : null;
  const firstDepDelay = firstLeg?.departureDelay as number | null | undefined;
  const lastArrDelay = lastLeg?.arrivalDelay as number | null | undefined;

  return {
    from: firstLeg
      ? {
          station: normalizeDbLocation((firstLeg.origin as Record<string, unknown>) ?? {}),
          departure: firstDepStr,
          departureTimestamp: firstDepTs != null && !isNaN(firstDepTs) ? firstDepTs : null,
          delay: firstDepDelay != null ? Math.round(firstDepDelay / 60) : null,
          platform: firstLeg.departurePlatform ?? null,
        }
      : null,
    to: lastLeg
      ? {
          station: normalizeDbLocation((lastLeg.destination as Record<string, unknown>) ?? {}),
          arrival: lastArrStr,
          arrivalTimestamp: lastArrTs != null && !isNaN(lastArrTs) ? lastArrTs : null,
          delay: lastArrDelay != null ? Math.round(lastArrDelay / 60) : null,
          platform: lastLeg.arrivalPlatform ?? null,
        }
      : null,
    duration: durationStr,
    transfers: Math.max(0, vehicleLegs.length - 1),
    sections,
  };
}

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
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

    const dbByName = new Map<string, Record<string, unknown>>();
    for (const dbStn of dbRaw) {
      const name = String(dbStn.name ?? "").toLowerCase();
      if (name) dbByName.set(name, dbStn);
    }

    const enrichedSwiss = swissStations.map((s) => {
      const nameLower = String(s.name ?? "").toLowerCase();
      const dbMatch = dbByName.get(nameLower);
      if (dbMatch) {
        dbByName.delete(nameLower);
        return { ...s, dbId: dbMatch.id ?? null };
      }
      return s;
    });

    const dbOnlyStations = Array.from(dbByName.values()).map(normalizeDbLocation);

    res.json({ stations: [...enrichedSwiss, ...dbOnlyStations] });
  } catch (error) {
    console.error("[Locations API Error]", error);
    res.status(500).json({ error: "Failed to process location search request." });
  }
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  try {
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
        let resolvedFromId = fromDbId;
        let resolvedToId = toDbId;

        if (!resolvedFromId || !resolvedToId) {
          const [fromResult, toResult] = await Promise.all([
            !resolvedFromId
              ? fetchDb("/locations", { query: from, results: 1, fuzzy: true }, 3000).catch(() => null)
              : Promise.resolve(null),
            !resolvedToId
              ? fetchDb("/locations", { query: to, results: 1, fuzzy: true }, 3000).catch(() => null)
              : Promise.resolve(null),
          ]);

          if (!resolvedFromId) {
            const arr = fromResult as Record<string, unknown>[] | null;
            resolvedFromId = arr?.[0]?.id as string | undefined;
          }
          if (!resolvedToId) {
            const arr = toResult as Record<string, unknown>[] | null;
            resolvedToId = arr?.[0]?.id as string | undefined;
          }
        }

        if (!resolvedFromId || !resolvedToId) return null;

        const departure = `${dateStr}T${timeStr}:00`;
        const result = await fetchDb(
          "/journeys",
          { from: resolvedFromId, to: resolvedToId, departure, results: limit ?? 5, stopovers: true },
          8000,
        ).catch(() => null);

        return result;
      } catch {
        return null;
      }
    })();

    const [swissData, dbData] = await Promise.all([swissPromise, dbPromise]);

    const swissConnections: Record<string, unknown>[] =
      (swissData as Record<string, unknown> | null)?.connections as Record<string, unknown>[] ?? [];

    const rawDbJourneys = (dbData as Record<string, unknown> | null)?.journeys;
    const dbJourneys: Record<string, unknown>[] = Array.isArray(rawDbJourneys)
      ? (rawDbJourneys as Record<string, unknown>[])
      : [];

    // Normalize each DB journey with full error isolation so one bad journey
    // never takes down the whole response.
    const dbConnections: Record<string, unknown>[] = [];
    for (const j of dbJourneys) {
      try {
        dbConnections.push(normalizeDbJourney(j));
      } catch (err) {
        console.error("[DB journey normalize error]", err);
      }
    }

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
  } catch (error) {
    console.error("[Connections API Error]", error);
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
    console.error("[Stationboard API Error]", error);
    res.status(500).json({ error: "Failed to process stationboard request." });
  }
});

export default router;
