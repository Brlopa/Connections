import { Router, type IRouter, type Request, type Response } from "express";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Legacy REST API – kept only for stationboard
const TRANSPORT_API_BASE = "https://transport.opendata.ch/v1";

const OJP_URL = "https://api.opentransportdata.swiss/ojp20";

async function getParser() {
  const { XMLParser } = await import("fast-xml-parser");
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    isArray: (n) => ["Leg","Position","TripResult","PlaceResult","LegIntermediate"].includes(n),
  });
}


function getOjpKey(): string | undefined {
  return process.env.OJP_API_KEY;
}

async function ojpPost(xml: string, timeoutMs = 15000): Promise<string> {
  const key = getOjpKey();
  if (!key) throw new Error("OJP_API_KEY not set");
  const res = await fetch(OJP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", "Authorization": `Bearer ${key}` },
    body: xml,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OJP ${res.status}`);
  return res.text();
}

function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
}

function isoToDuration(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0"), min = parseInt(m[2] ?? "0");
  const totalMin = h * 60 + min;
  const days = Math.floor(totalMin / 1440);
  const hh = Math.floor((totalMin % 1440) / 60);
  const mm = totalMin % 60;
  return `${String(days).padStart(2,"0")}d${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`;
}

function delayMin(timetabled: string | undefined, estimated: string | undefined): number | null {
  if (!timetabled || !estimated) return null;
  const diff = new Date(estimated).getTime() - new Date(timetabled).getTime();
  return isNaN(diff) ? null : Math.round(diff / 60000);
}

function placeToStation(place: any): Record<string, unknown> {
  const geo = place?.GeoPosition;
  return {
    id: place?.StopPlace?.StopPlaceRef ?? place?.StopPoint?.StopPointRef ?? null,
    name: place?.Name?.Text ?? place?.StopPlace?.StopPlaceName?.Text ?? null,
    type: "station",
    score: null,
    coordinate: geo
      ? { type: "WGS84", x: parseFloat(geo.Latitude ?? "NaN"), y: parseFloat(geo.Longitude ?? "NaN") }
      : null,
  };
}

function stopRefToStation(stopRef: string | undefined, name: string | undefined, placeCtx: Map<string, any>): Record<string, unknown> {
  const place = stopRef ? placeCtx.get(stopRef) : null;
  if (place) return placeToStation(place);
  return { id: stopRef ?? null, name: name ?? null, type: "station", score: null, coordinate: null };
}

function buildPlaceContext(parsed: any): Map<string, any> {
  const ctx = new Map<string, any>();
  const places: any[] = parsed?.OJP?.OJPResponse?.ServiceDelivery?.OJPTripDelivery?.TripResponseContext?.Places?.Place ?? [];
  const arr = Array.isArray(places) ? places : [places];
  for (const p of arr) {
    const ref = p?.StopPlace?.StopPlaceRef ?? p?.StopPoint?.StopPointRef;
    if (ref) ctx.set(String(ref), p);
  }
  return ctx;
}

function boardToCheckpoint(board: any, placeCtx: Map<string, any>, isArr: boolean): Record<string, unknown> {
  const ref = board?.StopPointRef;
  const name = board?.StopPointName?.Text;
  const svc = isArr ? board?.ServiceArrival : board?.ServiceDeparture;
  const tt: string | undefined = svc?.TimetabledTime;
  const est: string | undefined = svc?.EstimatedTime;
  const time = est ?? tt ?? null;
  const delay = delayMin(tt, est);
  const quay = board?.PlannedQuay?.Text ?? null;
  return {
    station: stopRefToStation(ref, name, placeCtx),
    arrival: isArr ? time : null,
    arrivalTimestamp: isArr ? ts(time) : null,
    departure: isArr ? null : time,
    departureTimestamp: isArr ? null : ts(time),
    delay,
    platform: quay,
    realtimeAvailability: null,
    prognosis: null,
  };
}

function legToSection(leg: any, placeCtx: Map<string, any>): Record<string, unknown> | null {
  if (leg?.TimedLeg) {
    const tl = leg.TimedLeg;
    const svc = tl.Service ?? {};
    const mode = svc.Mode ?? {};
    const ptMode: string = mode.PtMode ?? "";
    const lineNum: string = svc.PublishedServiceName?.Text ?? svc.TrainNumber ?? "";
    const category = ptMode === "rail" ? (lineNum.match(/^(IC|IR|RE|S|EC|RB|TGV|ICE)/i)?.[0] ?? "train") : ptMode;
    const intermediates: any[] = Array.isArray(tl.LegIntermediate) ? tl.LegIntermediate : tl.LegIntermediate ? [tl.LegIntermediate] : [];
    const passList = intermediates.map((im: any) => {
      const ref = im?.StopPointRef; const nm = im?.StopPointName?.Text;
      const sArr = im?.ServiceArrival; const sDep = im?.ServiceDeparture;
      const arrT = sArr?.EstimatedTime ?? sArr?.TimetabledTime ?? null;
      const depT = sDep?.EstimatedTime ?? sDep?.TimetabledTime ?? null;
      return {
        station: stopRefToStation(ref, nm, placeCtx),
        arrival: arrT, arrivalTimestamp: ts(arrT),
        departure: depT, departureTimestamp: ts(depT),
        delay: null, platform: null, realtimeAvailability: null, prognosis: null,
      };
    });
    return {
      journey: {
        name: lineNum,
        category,
        categoryCode: null,
        number: svc.JourneyRef ?? null,
        operator: svc.OperatorRef ?? null,
        to: svc.DestinationText?.Text ?? null,
        passList,
        capacity1st: null, capacity2nd: null,
      },
      walk: null,
      departure: boardToCheckpoint(tl.LegBoard, placeCtx, false),
      arrival: boardToCheckpoint(tl.LegAlight, placeCtx, true),
    };
  }
  const cl = leg?.ContinuousLeg ?? leg?.TransferLeg;
  if (cl) {
    const durIso: string | undefined = cl.Duration;
    const durSec = durIso ? (() => { const m = durIso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (parseInt(m[1]??"0")*3600+parseInt(m[2]??"0")*60+parseInt(m[3]??"0")) : null; })() : null;
    const startGeo = cl.LegStart?.GeoPosition;
    const endGeo = cl.LegEnd?.GeoPosition;
    const startRef = cl.LegStart?.StopPointRef ?? cl.LegStart?.StopPlaceRef;
    const endRef = cl.LegEnd?.StopPointRef ?? cl.LegEnd?.StopPlaceRef;
    const startName = cl.LegStart?.Name?.Text;
    const endName = cl.LegEnd?.Name?.Text;
    const mkStation = (ref: string | undefined, nm: string | undefined, geo: any) =>
      geo ? { id: ref??null, name: nm??null, type:"station", score:null, coordinate:{type:"WGS84",x:parseFloat(geo.Latitude??"NaN"),y:parseFloat(geo.Longitude??"NaN")} }
           : stopRefToStation(ref, nm, placeCtx);
    return {
      journey: null,
      walk: { duration: durSec, distance: cl.Length ?? null },
      departure: { station: mkStation(startRef, startName, startGeo), departure: null, departureTimestamp: null, arrival: null, arrivalTimestamp: null, delay: null, platform: null, realtimeAvailability: null, prognosis: null },
      arrival: { station: mkStation(endRef, endName, endGeo), departure: null, departureTimestamp: null, arrival: null, arrivalTimestamp: null, delay: null, platform: null, realtimeAvailability: null, prognosis: null },
    };
  }
  return null;
}

function ojpNow(): string { return new Date().toISOString(); }

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
    const now = ojpNow();
    let initialInput: string;

    if (req.query.x && req.query.y) {
      const lat = String(req.query.x);
      const lon = String(req.query.y);
      initialInput = `<GeoRestriction><Circle><Center><siri:Longitude>${lon}</siri:Longitude><siri:Latitude>${lat}</siri:Latitude></Center><Radius>1000</Radius></Circle></GeoRestriction>`;
    } else {
      const parsedQuery = SearchLocationsQueryParams.safeParse(req.query);
      if (!parsedQuery.success) { res.status(400).json({ error: parsedQuery.error.message }); return; }
      initialInput = `<Name>${parsedQuery.data.query}</Name>`;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <OJPRequest><siri:ServiceRequest>
    <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
    <siri:RequestorRef>Connections_prod</siri:RequestorRef>
    <OJPLocationInformationRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:MessageIdentifier>LIR-${Date.now()}</siri:MessageIdentifier>
      <InitialInput>${initialInput}</InitialInput>
      <Restrictions><Type>stop</Type><NumberOfResults>10</NumberOfResults><IncludePtModes>true</IncludePtModes></Restrictions>
    </OJPLocationInformationRequest>
  </siri:ServiceRequest></OJPRequest>
</OJP>`;

    const xmlText = await ojpPost(xml);
    const parser = await getParser();
    const parsedXml = parser.parse(xmlText);
    const delivery = parsedXml?.OJP?.OJPResponse?.ServiceDelivery?.OJPLocationInformationDelivery;
    
    if (!delivery) {
       console.log("OJP Location delivery missing. Full response:", JSON.stringify(parsedXml).slice(0, 500));
    }

    const rawResults: any[] = Array.isArray(delivery?.PlaceResult) ? delivery.PlaceResult : delivery?.PlaceResult ? [delivery.PlaceResult] : [];

    const stations = rawResults.map((pr: any) => {
      const place = pr?.Place ?? {};
      const geo = place?.GeoPosition;
      const stopRef = place?.StopPlace?.StopPlaceRef ?? place?.StopPoint?.StopPointRef ?? null;
      const name = place?.Name?.Text ?? place?.StopPlace?.StopPlaceName?.Text ?? null;
      
      let lat = parseFloat(geo?.Latitude);
      let lon = parseFloat(geo?.Longitude);
      if (isNaN(lat)) lat = 0; // Fallback to 0 if NaN to satisfy Zod
      if (isNaN(lon)) lon = 0;

      return {
        id: stopRef,
        name,
        type: "station",
        score: pr?.Probability ?? null,
        coordinate: geo ? { type: "WGS84", x: lat, y: lon } : null,
      };
    });

    res.json({ stations });
  } catch (error) {
    console.error("locations error details:", error);
    res.status(500).json({ error: "Failed to process location search request." });
  }
});


router.get("/transport/connections", async (req, res): Promise<void> => {
  try {
    const rawQuery = { ...req.query };
    if (rawQuery.via !== undefined && !Array.isArray(rawQuery.via)) rawQuery.via = [rawQuery.via as string];

    const parsed = SearchConnectionsQueryParams.safeParse(rawQuery);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const { from, to, via, date, time, isArrivalTime, limit } = parsed.data;
    const now = ojpNow();
    const dateStr = date ?? now.split("T")[0];
    const timeStr = time ?? `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`;
    const depArrTime = `${dateStr}T${timeStr}:00Z`;

    const isId = (s: string) => /^\d{7,}/.test(s);
    const mkPlace = (name: string) => isId(name)
      ? `<PlaceRef><StopPlaceRef>${name}</StopPlaceRef><Name><Text>${name}</Text></Name></PlaceRef>`
      : `<PlaceRef><Name><Text>${name}</Text></Name></PlaceRef>`;

    const viaXml = via?.length
      ? via.map(v => `<Via><ViaPoint>${mkPlace(v)}</ViaPoint></Via>`).join("")
      : "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <OJPRequest><siri:ServiceRequest>
    <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
    <siri:RequestorRef>Connections_prod</siri:RequestorRef>
    <OJPTripRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:MessageIdentifier>TR-${Date.now()}</siri:MessageIdentifier>
      <Origin>${mkPlace(from)}<DepArrTime>${depArrTime}</DepArrTime></Origin>
      <Destination>${mkPlace(to)}${isArrivalTime === "1" ? `<DepArrTime>${depArrTime}</DepArrTime>` : ""}</Destination>
      ${viaXml}
      <Params>
        <NumberOfResults>${limit ?? 5}</NumberOfResults>
        <IncludeTrackSections>true</IncludeTrackSections>
        <IncludeLegProjection>false</IncludeLegProjection>
        <IncludeIntermediateStops>true</IncludeIntermediateStops>
        <UseRealtimeData>explanatory</UseRealtimeData>
      </Params>
    </OJPTripRequest>
  </siri:ServiceRequest></OJPRequest>
</OJP>`;

    const xmlText = await ojpPost(xml);
    const parser = await getParser();
    const parsedXml = parser.parse(xmlText);
    const placeCtx = buildPlaceContext(parsedXml);
    const delivery = parsedXml?.OJP?.OJPResponse?.ServiceDelivery?.OJPTripDelivery;
    const tripResults: any[] = Array.isArray(delivery?.TripResult) ? delivery.TripResult : delivery?.TripResult ? [delivery.TripResult] : [];

    const connections = tripResults.map((tr: any) => {
      const trip = tr?.Trip ?? {};
      const legs: any[] = Array.isArray(trip?.Leg) ? trip.Leg : trip?.Leg ? [trip.Leg] : [];
      const sections = legs.map(l => legToSection(l, placeCtx)).filter(Boolean);
      const timedLegs = legs.filter(l => l?.TimedLeg);
      const firstSec = sections[0] as any;
      const lastSec = sections[sections.length - 1] as any;
      return {
        from: firstSec?.departure ?? null,
        to: lastSec?.arrival ?? null,
        duration: isoToDuration(trip.Duration),
        transfers: Math.max(0, timedLegs.length - 1),
        sections,
      };
    });

    // from/to location from first/last connection's first/last checkpoint
    const fromLoc = (connections[0] as any)?.from?.station ?? null;
    const toLoc = (connections[connections.length - 1] as any)?.to?.station ?? null;

    res.json({ from: fromLoc, to: toLoc, connections });
  } catch (error) {
    console.error("connections error:", error);
    res.status(500).json({ error: "Failed to process connection search request." });
  }
});

router.get("/transport/stationboard", async (req, res): Promise<void> => {
  try {
    const parsed = GetStationboardQueryParams.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const { station, limit, type } = parsed.data;
    const url = new URL(`${TRANSPORT_API_BASE}/stationboard`);
    if (station) url.searchParams.set("station", station);
    if (limit) url.searchParams.set("limit", String(limit));
    if (type) url.searchParams.set("type", type);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Stationboard ${r.status}`);
    res.json(await r.json());
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
  const OJP_KEY = process.env.OJP_API_KEY;

  if (!start || !end) {
    res.status(400).json({ error: 'Missing start or end coordinates' });
    return;
  }

  if (!OJP_KEY) {
    res.status(500).json({ error: 'OJP_API_KEY environment variable is not configured.' });
    return;
  }

  const now = new Date().toISOString();
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>Connections_prod</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <siri:MessageIdentifier>walk-route-${Date.now()}</siri:MessageIdentifier>
        <Origin>
          <PlaceRef>
            <GeoPosition>
              <siri:Longitude>${start.lon}</siri:Longitude>
              <siri:Latitude>${start.lat}</siri:Latitude>
            </GeoPosition>
          </PlaceRef>
          <DepArrTime>${now}</DepArrTime>
          <IndividualTransportOptions>
            <Mode>walk</Mode>
            <MaxDuration>PT2H</MaxDuration>
          </IndividualTransportOptions>
        </Origin>
        <Destination>
          <PlaceRef>
            <GeoPosition>
              <siri:Longitude>${end.lon}</siri:Longitude>
              <siri:Latitude>${end.lat}</siri:Latitude>
            </GeoPosition>
          </PlaceRef>
        </Destination>
        <Params>
          <NumberOfResults>1</NumberOfResults>
          <IncludeTrackSections>true</IncludeTrackSections>
          <IncludeLegProjection>true</IncludeLegProjection>
          <IncludeIntermediateStops>false</IncludeIntermediateStops>
        </Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  try {
    const response = await fetch('https://api.opentransportdata.swiss/ojp20', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${OJP_KEY}`,
      },
      body: xmlBody,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('OJP route API error', response.status, errText.slice(0, 300));
      throw new Error(`OJP API returned status ${response.status}`);
    }

    const xmlText = await response.text();
    const parser = await getParser();
    const parsed = parser.parse(xmlText);

    // Navigate to OJP response: OJP > OJPResponse > ServiceDelivery > OJPTripDelivery > TripResult[0] > Trip > Leg[*]
    const delivery =
      parsed?.OJP?.OJPResponse?.ServiceDelivery?.OJPTripDelivery ??
      parsed?.OJP?.OJPResponse?.ServiceDelivery?.['siri:OJPTripDelivery'] ?? null;

    const tripResults: any[] = Array.isArray(delivery?.TripResult)
      ? delivery.TripResult
      : delivery?.TripResult
        ? [delivery.TripResult]
        : [];

    if (tripResults.length === 0) {
      // No trip found — return straight-line fallback
      res.json({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [start.lon, start.lat],
            [end.lon, end.lat],
          ],
        },
      });
      return;
    }

    const trip = tripResults[0]?.Trip;
    const legs: any[] = Array.isArray(trip?.Leg) ? trip.Leg : trip?.Leg ? [trip.Leg] : [];

    // Collect all GeoJSON coordinates from LegProjection across all legs
    const allCoords: [number, number][] = [];

    for (const leg of legs) {
      const continuousLeg = leg?.ContinuousLeg ?? leg?.TransferLeg ?? null;
      const timedLeg = leg?.TimedLeg ?? null;
      const targetLeg = continuousLeg ?? timedLeg;
      if (!targetLeg) continue;

      const projection = targetLeg?.LegTrack?.TrackSection?.LinkProjection;
      if (!projection) continue;

      const positions: any[] = Array.isArray(projection.Position)
        ? projection.Position
        : projection.Position
          ? [projection.Position]
          : [];

      for (const pos of positions) {
        const lon = parseFloat(pos?.Longitude ?? pos?.['siri:Longitude'] ?? NaN);
        const lat = parseFloat(pos?.Latitude ?? pos?.['siri:Latitude'] ?? NaN);
        if (!isNaN(lon) && !isNaN(lat)) {
          allCoords.push([lon, lat]);
        }
      }
    }

    if (allCoords.length < 2) {
      // Projection not available — straight-line fallback
      res.json({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [start.lon, start.lat],
            [end.lon, end.lat],
          ],
        },
      });
      return;
    }

    res.json({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: allCoords,
      },
    });
  } catch (error) {
    console.error('OJP route calculation error:', error);
    // Graceful fallback: return straight line so map still renders something
    res.json({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [start.lon, start.lat],
          [end.lon, end.lat],
        ],
      },
    });
  }
});

export default router;
