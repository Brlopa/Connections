import { Router, type IRouter } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";
const DB_API_BASE = "https://v6.db.transport.rest";

async function fetchTransport(path: string, params: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const url = new URL(`${TRANSPORT_API_BASE}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transport API error ${response.status}: ${text}`);
  }
  return response.json();
}

async function fetchDb(path: string, params: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const url = new URL(`${DB_API_BASE}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  const response = await fetch(url.toString(), {
    headers: { "Accept-Encoding": "gzip" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DB API error ${response.status}: ${text}`);
  }
  return response.json();
}

function normalizeDbLocation(loc: Record<string, unknown>): Record<string, unknown> {
  const location = loc.location as Record<string, unknown> | null | undefined;
  return {
    id: loc.id ?? null,
    name: loc.name ?? null,
    type: "station",
    score: null,
    coordinate: location ? {
      type: "WGS84",
      x: location.latitude ?? null,
      y: location.longitude ?? null,
    } : null,
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
  const name = String(line.name ?? "");
  return name.split(" ")[0] ?? "";
}

function normalizeDbLeg(leg: Record<string, unknown>): Record<string, unknown> {
  const line = leg.line as Record<string, unknown> | null | undefined;
  const origin = leg.origin as Record<string, unknown> | undefined ?? {};
  const destination = leg.destination as Record<string, unknown> | undefined ?? {};

  const depStr = (leg.plannedDeparture ?? leg.departure) as string | null | undefined;
  const arrStr = (leg.plannedArrival ?? leg.arrival) as string | null | undefined;
  const depTs = depStr ? Math.floor(new Date(depStr).getTime() / 1000) : null;
  const arrTs = arrStr ? Math.floor(new Date(arrStr).getTime() / 1000) : null;

  const stopovers = leg.stopovers as Array<Record<string, unknown>> | undefined ?? [];
  const passList = stopovers.map((sv) => {
    const stop = (sv.stop ?? sv.station ?? {}) as Record<string, unknown>;
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
    journey: line ? {
      name: line.name ?? "",
      category: dbProductToCategory(line),
      number: line.id ?? "",
      to: leg.direction ?? "",
      passList: [],
    } : null,
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
    from: firstLeg ? normalizeDbLocation(firstLeg.origin as Record<string, unknown> ?? {}) : null,
    to: lastLeg ? normalizeDbLocation(lastLeg.destination as Record<string, unknown> ?? {}) : null,
    duration: durationStr,
    transfers: Math.max(0, vehicleLegs.length - 1),
    sections,
  };
}

router.get("/transport/locations", async (req, res): Promise<void> => {
  const parsed = SearchLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, type, network } = parsed.data;

  if (network === "europe") {
    const dbData = await fetchDb("/locations", {
      query,
      results: 8,
      fuzzy: true,
    }) as Array<Record<string, unknown>>;

    const stations = (Array.isArray(dbData) ? dbData : [])
      .filter((loc) => loc.type === "station")
      .map(normalizeDbLocation);

    res.json({ stations });
    return;
  }

  const data = await fetchTransport("/locations", { query, type });
  res.json(data);
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  const parsed = SearchConnectionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { from, to, date, time, isArrivalTime, limit, network } = parsed.data;

  if (network === "europe") {
    const dateStr = date ?? new Date().toISOString().split("T")[0];
    const timeStr = time ?? `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
    const departure = `${dateStr}T${timeStr}:00`;

    const dbData = await fetchDb("/journeys", {
      from,
      to,
      departure,
      results: limit ?? 5,
      stopovers: true,
    }) as Record<string, unknown>;

    const journeys = (dbData.journeys as Array<Record<string, unknown>>) ?? [];
    const connections = journeys.map(normalizeDbJourney);

    const firstConn = connections[0] as Record<string, unknown> | undefined;
    res.json({
      from: firstConn?.from ?? null,
      to: firstConn?.to ?? null,
      connections,
    });
    return;
  }

  const data = await fetchTransport("/connections", {
    from,
    to,
    date,
    time,
    isArrivalTime,
    limit,
  });

  res.json(data);
});

router.get("/transport/stationboard", async (req, res): Promise<void> => {
  const parsed = GetStationboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { station, limit, type } = parsed.data;

  const data = await fetchTransport("/stationboard", {
    station,
    limit,
    type,
  });

  res.json(data);
});

export default router;
