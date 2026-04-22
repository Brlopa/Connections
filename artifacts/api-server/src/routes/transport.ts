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
  timeoutMs = 6000,
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
    const res = await fetch(url.toString(), {
      headers: { "Accept-Encoding": "gzip" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DB API ${res.status}`);
    return await res.json();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── normalizers (Mapping DB Schema -> OpenData Schema) ──────────

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
    passList: [],
  };
}

function normalizeDbJourney(journey: Record<string, unknown>): Record<string, unknown> {
  const legs = (journey.legs as Array<Record<string, unknown>>) ?? [];
  const sections = legs.map(normalizeDbLeg);
  
  const depMs = legs[0] ? new Date(String(legs[0].departure ?? "")).getTime() : NaN;
  const arrMs = legs[legs.length - 1] ? new Date(String(legs[legs.length - 1].arrival ?? "")).getTime() : NaN;
  
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

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
    // Coordinate-based search (geolocation: x=latitude, y=longitude) — bypass text-search schema
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

    // Parallele Evaluierung beider Datenräume
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

    const dbByName = new Map<string, Record<string, unknown>>();
    for (const dbStn of dbRaw) {
      const name = String(dbStn.name ?? "").toLowerCase();
      if (name) dbByName.set(name, dbStn);
    }

    // Kreuzreferenzierung: Zuweisung der dbId an SBB Stationen für nachfolgende Graphen-Routings
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
    res.status(500).json({ error: "Failed to process location search request." });
  }
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  try {
    // Normalize via — Express parses a single query param as a string, but the schema expects array
    const rawQuery = { ...req.query };
    if (rawQuery.via !== undefined && !Array.isArray(rawQuery.via)) {
      rawQuery.via = [rawQuery.via as string];
    }

    // Extract DB station IDs separately — they are not part of the generated OpenAPI schema
    // and Zod will strip unknown fields, so we must read them from the raw query.
    const fromDbId = typeof req.query.fromDbId === "string" ? req.query.fromDbId : undefined;
    const toDbId = typeof req.query.toDbId === "string" ? req.query.toDbId : undefined;

    const parsed = SearchConnectionsQueryParams.safeParse(rawQuery);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { from, to, via, date, time, isArrivalTime, limit } = parsed.data;

    const dateStr = date ?? new Date().toISOString().split("T")[0];
    const timeStr = time ?? `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

    const swissPromise = fetchTransport("/connections", { from, to, via, date, time, isArrivalTime, limit }).catch(() => null);

    // Sekundäre Vektorberechnung (DB)
    const dbPromise = (async () => {
      try {
        let resolvedFromId = fromDbId;
        let resolvedToId = toDbId;

        // Wenn keine IDs übergeben wurden, Versuch einer iterativen Auflösung
        if (!resolvedFromId || !resolvedToId) {
          const [fromResult, toResult] = await Promise.all([
            !resolvedFromId ? fetchDb("/locations", { query: from, results: 1 }, 3000) : null,
            !resolvedToId ? fetchDb("/locations", { query: to, results: 1 }, 3000) : null,
          ]);
          if (!resolvedFromId) resolvedFromId = (fromResult as any[])?.[0]?.id;
          if (!resolvedToId) resolvedToId = (toResult as any[])?.[0]?.id;
        }

        if (!resolvedFromId || !resolvedToId) return null;

        const departure = `${dateStr}T${timeStr}:00`;

        // Build DB API params — include via if provided (look up first via station ID)
        const dbParams: Record<string, string | number | boolean | string[]> = {
          from: resolvedFromId,
          to: resolvedToId,
          departure,
          results: limit ?? 5,
          stopovers: false,
        };

        // Optionally resolve via station ID for DB API
        if (via && via.length > 0) {
          try {
            const viaResult = await fetchDb("/locations", { query: via[0], results: 1 }, 2000);
            const viaId = (viaResult as any[])?.[0]?.id;
            if (viaId) dbParams.via = viaId;
          } catch {
            // via lookup failed — proceed without it
          }
        }

        const result = await fetchDb("/journeys", dbParams, 6000);
        return result;
      } catch {
        return null;
      }
    })();

    const [swissData, dbData] = await Promise.all([swissPromise, dbPromise]);

    const swissConnections: Record<string, unknown>[] = (swissData as any)?.connections ?? [];
    const dbJourneys: Record<string, unknown>[] = (dbData as any)?.journeys ?? [];
    const dbConnections = dbJourneys.map(normalizeDbJourney);

    const merged = [...swissConnections];

    // Mengen-Subtraktion: Identifikation und Filterung des Schnittbereichs
    for (const dbConn of dbConnections) {
      const dbSections = (dbConn.sections as any[]) ?? [];
      const dbDep = dbSections[0]?.departure?.departure;
      const dbArr = dbSections[dbSections.length - 1]?.arrival?.arrival;

      const isDupe = merged.some((c) => {
        const cSections = (c.sections as any[]) ?? [];
        const cDep = cSections[0]?.departure?.departure;
        const cArr = cSections[cSections.length - 1]?.arrival?.arrival;
        if (!dbDep || !cDep || !dbArr || !cArr) return false;
        
        // Epsilon = 90000ms (90 Sekunden)
        return (
          Math.abs(new Date(dbDep).getTime() - new Date(cDep).getTime()) < 90_000 &&
          Math.abs(new Date(dbArr).getTime() - new Date(cArr).getTime()) < 90_000
        );
      });

      if (!isDupe) {
        merged.push(dbConn);
      }
    }

    // Sortierung der Vektoren nach der diskreten Abfahrtszeit
    merged.sort((a, b) => {
      const aTs = ((a.sections as any[])?.[0]?.departure?.departureTimestamp as number) ?? 0;
      const bTs = ((b.sections as any[])?.[0]?.departure?.departureTimestamp as number) ?? 0;
      return aTs - bTs;
    });

    const fromLoc = (swissData as any)?.from ?? dbConnections[0]?.from?.station ?? null;
    const toLoc = (swissData as any)?.to ?? dbConnections[0]?.to?.station ?? null;

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

export default router;
