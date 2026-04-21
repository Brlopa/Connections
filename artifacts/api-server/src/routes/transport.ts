import { Router, type IRouter } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";

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
        // The transport API requires array notation: via[]=City1&via[]=City2
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

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
    const parsed = SearchLocationsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { query, type } = parsed.data;

    const data = await fetchTransport("/locations", { query, type });
    const stations = (data as Record<string, unknown>)?.stations ?? [];

    res.json({ stations });
  } catch (error) {
    console.error("[Locations API Error]", error);
    res.status(500).json({ error: "Failed to process location search request." });
  }
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  try {
    // Normalize `via` to always be an array before Zod validation.
    // Express parses a single ?via=Bern as a string, but ?via=Bern&via=Zurich
    // as an array. The Zod schema expects an array in both cases.
    const rawQuery = { ...req.query };
    if (rawQuery.via !== undefined && !Array.isArray(rawQuery.via)) {
      rawQuery.via = [rawQuery.via as string];
    }

    const parsed = SearchConnectionsQueryParams.safeParse(rawQuery);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { from, to, via, date, time, isArrivalTime, limit } = parsed.data;

    // Filter out empty strings that may come from a cleared via input
    const viaFiltered = via?.filter((v) => v.trim() !== "");

    const data = await fetchTransport("/connections", {
      from,
      to,
      // Only pass via if there are actual values
      ...(viaFiltered && viaFiltered.length > 0 ? { via: viaFiltered } : {}),
      date,
      time,
      isArrivalTime,
      limit,
    });

    const connections = (data as Record<string, unknown>)?.connections ?? [];
    const fromLoc = (data as Record<string, unknown>)?.from ?? null;
    const toLoc = (data as Record<string, unknown>)?.to ?? null;

    res.json({ from: fromLoc, to: toLoc, connections });
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
