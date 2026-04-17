import { Router, type IRouter } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";

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

router.get("/transport/locations", async (req, res): Promise<void> => {
  const parsed = SearchLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, type } = parsed.data;

  const data = await fetchTransport("/locations", {
    query,
    type,
  });

  res.json(data);
});

router.get("/transport/connections", async (req, res): Promise<void> => {
  const parsed = SearchConnectionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { from, to, date, time, isArrivalTime, limit } = parsed.data;

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
