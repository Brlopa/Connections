// artifacts/api-server/src/routes/transport.ts
import { Router, type IRouter, type Request, type Response } from "express";
import { XMLParser } from "fast-xml-parser";
import {
  SearchLocationsQueryParams,
  SearchConnectionsQueryParams,
  GetStationboardQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Replace with OJP endpoints
const OJP_API_URL = "https://api.opentransportdata.swiss/ojp20";

// Initialize fast-xml-parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  isArray: (name, jpath) => {
    const arrNames = ["LocationResult", "Location", "StopEventResult", "TripResult", "Leg", "LegIntermediate"];
    return arrNames.includes(name);
  }
});

async function fetchOjp(xmlPayload: string): Promise<any> {
  // Retrieve token at execution time to guarantee Replit secrets are fully hydrated into process.env
  const ojpToken = process.env.OJP_TOKEN || process.env.OPEN_DATA_TOKEN || process.env.VITE_OJP_TOKEN || "";

  if (!ojpToken) {
    console.warn("WARNING: Missing OJP_TOKEN. Requests to OpenTransportData will fail if the API requires authorization.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/xml",
  };
  if (ojpToken) {
    headers["Authorization"] = `Bearer ${ojpToken}`;
  }

  const res = await fetch(OJP_API_URL, {
    method: "POST",
    headers,
    body: xmlPayload
  });
  
  if (!res.ok) {
    throw new Error(`OJP API error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  
  const xmlResponse = await res.text();
  return parser.parse(xmlResponse);
}

// ── helpers ──────────────────────────────────────────────────

function buildPlaceRef(refOrName: string) {
  if (/^[0-9]{7,8}$/.test(refOrName) || refOrName.startsWith("ch:")) {
    return `<StopPlaceRef>${refOrName}</StopPlaceRef>`;
  }
  return `<Name><Text>${refOrName}</Text></Name>`;
}

function parseDurationToSeconds(durationStr: string | undefined): number | null {
  if (!durationStr) return null;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

function mapOjpLocation(loc: any): Record<string, unknown> {
  if (!loc) return { id: null, name: null, type: "station", coordinate: null };
  
  const findGeo = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.Latitude && obj.Longitude) return obj;
    if (obj.GeoPosition && obj.GeoPosition.Latitude) return obj.GeoPosition;
    for (const key of Object.keys(obj)) {
      const res = findGeo(obj[key]);
      if (res) return res;
    }
    return null;
  };

  const findName = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.StopPlaceName?.Text) return obj.StopPlaceName.Text;
    if (obj.StopPointName?.Text) return obj.StopPointName.Text;
    if (obj.LocationName?.Text) return obj.LocationName.Text;
    if (obj.Name?.Text) return obj.Name.Text;
    for (const key of Object.keys(obj)) {
      const res = findName(obj[key]);
      if (res) return res;
    }
    return null;
  };

  const findId = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.StopPlaceRef) return obj.StopPlaceRef;
    if (obj.StopPointRef) return obj.StopPointRef;
    for (const key of Object.keys(obj)) {
      const res = findId(obj[key]);
      if (res) return res;
    }
    return null;
  };

  const geo = findGeo(loc);
  const coordinate = (geo && geo.Latitude && geo.Longitude) 
    ? { type: "WGS84", x: parseFloat(geo.Latitude), y: parseFloat(geo.Longitude) } 
    : null;
  
  return {
    id: findId(loc),
    name: findName(loc) || null,
    type: "station",
    score: null,
    coordinate
  };
}

function mapOjpTrip(tripResult: any): Record<string, unknown> {
  const trip = tripResult.Trip;
  if (!trip) return {};
  
  const legs = Array.isArray(trip.Leg) ? trip.Leg : (trip.Leg ? [trip.Leg] : []);
  
  const sections = legs.map((leg: any) => {
    if (leg.TimedLeg) {
      const tl = leg.TimedLeg;
      const service = tl.Service || {};
      const mode = service.Mode || {};
      const cat = service.ProductCategory?.ShortName?.Text || service.PublishedServiceName?.Text || mode.Name?.Text || "Train";
      
      const passListNodes = tl.LegIntermediate || [];
      const passList = (Array.isArray(passListNodes) ? passListNodes : [passListNodes]).map((i: any) => ({
        station: mapOjpLocation(i),
        arrival: i.ServiceArrival?.EstimatedTime || i.ServiceArrival?.TimetabledTime || null,
        departure: i.ServiceDeparture?.EstimatedTime || i.ServiceDeparture?.TimetabledTime || null
      }));

      return {
        journey: {
          name: `${cat} ${service.TrainNumber || service.PublishedServiceName?.Text || ""}`.trim(),
          category: cat,
          number: service.TrainNumber || "",
          to: service.DestinationText?.Text || "",
          passList
        },
        walk: null,
        departure: {
          station: mapOjpLocation(tl.LegBoard),
          departure: tl.LegBoard?.ServiceDeparture?.TimetabledTime || null,
          departureTimestamp: tl.LegBoard?.ServiceDeparture?.TimetabledTime ? Math.floor(new Date(tl.LegBoard.ServiceDeparture.TimetabledTime).getTime() / 1000) : null,
          delay: null, 
          platform: tl.LegBoard?.EstimatedQuay?.Text || tl.LegBoard?.PlannedQuay?.Text || null
        },
        arrival: {
          station: mapOjpLocation(tl.LegAlight),
          arrival: tl.LegAlight?.ServiceArrival?.TimetabledTime || null,
          arrivalTimestamp: tl.LegAlight?.ServiceArrival?.TimetabledTime ? Math.floor(new Date(tl.LegAlight.ServiceArrival.TimetabledTime).getTime() / 1000) : null,
          delay: null,
          platform: tl.LegAlight?.EstimatedQuay?.Text || tl.LegAlight?.PlannedQuay?.Text || null
        }
      };
    } else if (leg.ContinuousLeg || leg.TransferLeg) {
      const cl = leg.ContinuousLeg || leg.TransferLeg;
      return {
        journey: null,
        walk: {
          duration: parseDurationToSeconds(cl.Duration), 
          distance: cl.Length ? parseInt(cl.Length, 10) : null
        },
        departure: {
          station: mapOjpLocation(cl.LegStart),
          departure: null, departureTimestamp: null, delay: null, platform: null
        },
        arrival: {
          station: mapOjpLocation(cl.LegEnd),
          arrival: null, arrivalTimestamp: null, delay: null, platform: null
        }
      };
    }
    return null;
  }).filter(Boolean);

  let durationStr = trip.Duration || "0d00:00:00"; 
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (match) {
    const h = parseInt(match[1] || "0");
    const m = parseInt(match[2] || "0");
    const s = parseInt(match[3] || "0");
    const d = Math.floor(h / 24);
    durationStr = `${String(d).padStart(2, "0")}d${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return {
    from: sections[0]?.departure || null,
    to: sections[sections.length - 1]?.arrival || null,
    duration: durationStr,
    transfers: Math.max(0, sections.filter((s: any) => s.journey).length - 1),
    sections
  };
}

function mapOjpStopEvent(event: any): Record<string, unknown> {
  const call = event.StopEvent?.ThisCall?.CallAtStop;
  const service = event.StopEvent?.Service || {};
  const mode = service.Mode || {};
  const cat = service.ProductCategory?.ShortName?.Text || service.PublishedServiceName?.Text || mode.Name?.Text || "Train";
  
  return {
    stop: {
      station: mapOjpLocation(call), 
      arrival: call?.ServiceArrival?.TimetabledTime || null,
      departure: call?.ServiceDeparture?.TimetabledTime || null,
      platform: call?.EstimatedQuay?.Text || call?.PlannedQuay?.Text || null
    },
    name: `${cat} ${service.TrainNumber || service.PublishedServiceName?.Text || ""}`.trim(),
    category: cat,
    number: service.TrainNumber || "",
    to: service.DestinationText?.Text || "",
    passList: []
  };
}

// ── routes ─────────────────────────────────────────────────────

router.get("/transport/locations", async (req, res): Promise<void> => {
  try {
    const query = String(req.query.query || "");
    if (!query && !req.query.x) {
      res.json({ stations: [] });
      return;
    }
    
    const inputXml = req.query.x && req.query.y 
      ? `<GeoPosition><Longitude>${req.query.y}</Longitude><Latitude>${req.query.x}</Latitude></GeoPosition>`
      : `<LocationName>${query}</LocationName>`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPLocationInformationRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <InitialInput>
          ${inputXml}
        </InitialInput>
        <Restrictions>
          <Type>stop</Type>
        </Restrictions>
      </OJPLocationInformationRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

    const data = await fetchOjp(xml);
    const locationResults = data?.OJP?.OJPResponse?.ServiceDelivery?.OJPLocationInformationDelivery?.LocationResult || [];
    
    // Extract the <Location> objects from the <LocationResult> wrappers
    let locations = (Array.isArray(locationResults) ? locationResults : [locationResults]).map((lr: any) => lr.Location).filter(Boolean);
    
    // Flatten if Location is somehow an array itself
    locations = locations.flat();

    // Debugging output to terminal if nothing was found
    if (locations.length === 0) {
       console.log("No locations found. Raw parsed OJP response:", JSON.stringify(data?.OJP?.OJPResponse, null, 2));
    }

    const stations = locations.map((l: any) => mapOjpLocation(l));
    res.json({ stations });
  } catch (error) {
    console.error(error);
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

    const { from, to, date, time, limit } = parsed.data;
    const dateStr = date ?? new Date().toISOString().split("T")[0];
    const timeStr = time ?? `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <Origin>
          <PlaceRef>
            ${buildPlaceRef(from)}
          </PlaceRef>
          <DepArrTime>${dateStr}T${timeStr}:00</DepArrTime>
        </Origin>
        <Destination>
          <PlaceRef>
            ${buildPlaceRef(to)}
          </PlaceRef>
        </Destination>
        <Params>
          <NumberOfResults>${limit ?? 5}</NumberOfResults>
          <IncludeTrackSections>true</IncludeTrackSections>
          <IncludeLegProjection>true</IncludeLegProjection>
          <IncludeTurnDescription>true</IncludeTurnDescription>
          <IncludeIntermediateStops>true</IncludeIntermediateStops>
          <UseRealtimeData>explanatory</UseRealtimeData>
        </Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

    const data = await fetchOjp(xml);
    const trips = data?.OJP?.OJPResponse?.ServiceDelivery?.OJPTripDelivery?.TripResult || [];
    const connections = (Array.isArray(trips) ? trips : [trips]).map(mapOjpTrip);

    // Derive display locations
    const fromLoc = (connections[0] as any)?.from?.station ?? null;
    const toLoc = (connections[0] as any)?.to?.station ?? null;

    res.json({ from: fromLoc, to: toLoc, connections });
  } catch (error) {
    console.error(error);
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
    
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPStopEventRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <Location>
          <PlaceRef>
            ${buildPlaceRef(station)}
          </PlaceRef>
          <DepArrTime>${new Date().toISOString()}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>${limit || 10}</NumberOfResults>
          <StopEventType>${type === "arrival" ? "arrival" : "departure"}</StopEventType>
          <IncludePreviousCalls>false</IncludePreviousCalls>
          <IncludeOnwardCalls>true</IncludeOnwardCalls>
          <IncludeRealtimeData>true</IncludeRealtimeData>
        </Params>
      </OJPStopEventRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

    const data = await fetchOjp(xml);
    const events = data?.OJP?.OJPResponse?.ServiceDelivery?.OJPStopEventDelivery?.StopEventResult || [];
    const stationboard = (Array.isArray(events) ? events : [events]).map(mapOjpStopEvent);
    
    res.json({ stationboard });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process stationboard request." });
  }
});

interface GeoCoordinate {
  lat: number;
  lon: number;
}

router.post('/transport/route', async (req: Request, res: Response): Promise<void> => {
  const { start, end } = req.body as { start: GeoCoordinate; end: GeoCoordinate };
  // Geoapify key is properly loaded inside the execution scope.
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
    
    const data = await response.json() as any;
    
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
