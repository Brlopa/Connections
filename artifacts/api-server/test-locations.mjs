import { XMLParser } from "fast-xml-parser";
import { readFileSync } from 'fs';

const OJP_API_URL = "https://api.opentransportdata.swiss/ojp20";
const envFile = readFileSync('./.env', 'utf8');
let token = null;
for (const line of envFile.split('\n')) {
    if (line.startsWith('OJP_TOKEN=')) token = line.split('=')[1].trim();
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  isArray: (name, jpath) => {
    const arrNames = ["PlaceResult", "Place", "StopEventResult", "TripResult", "Leg", "LegIntermediate"];
    return arrNames.includes(name);
  }
});

async function run() {
  const query = "Zurich HB";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPLocationInformationRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <InitialInput>
          <Name>${query}</Name>
        </InitialInput>
        <Restrictions>
          <Type>stop</Type>
        </Restrictions>
      </OJPLocationInformationRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  const headers = { "Content-Type": "application/xml", "Authorization": `Bearer ${token}` };
  const res = await fetch(OJP_API_URL, { method: "POST", headers, body: xml });
  const text = await res.text();
  
  const parsed = parser.parse(text);
  const locationResults = parsed?.OJP?.OJPResponse?.ServiceDelivery?.OJPLocationInformationDelivery?.PlaceResult || [];
  
  let locations = (Array.isArray(locationResults) ? locationResults : [locationResults]).map(lr => lr.Place).filter(Boolean).flat();

  function mapOjpLocation(loc) {
    if (!loc) return { id: null, name: null, type: "station", coordinate: null };
    
    const findGeo = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.Latitude && obj.Longitude) return obj;
      if (obj.GeoPosition && obj.GeoPosition.Latitude) return obj.GeoPosition;
      for (const key of Object.keys(obj)) {
        const res = findGeo(obj[key]);
        if (res) return res;
      }
      return null;
    };

    const findName = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      const extractText = (val) => typeof val === 'string' ? val : (val && val['#text'] ? val['#text'] : null);
      if (obj.StopPlaceName?.Text) return extractText(obj.StopPlaceName.Text);
      if (obj.StopPointName?.Text) return extractText(obj.StopPointName.Text);
      if (obj.LocationName?.Text) return extractText(obj.LocationName.Text);
      if (obj.Name?.Text) return extractText(obj.Name.Text);
      for (const key of Object.keys(obj)) {
        const res = findName(obj[key]);
        if (res) return res;
      }
      return null;
    };

    const findId = (obj) => {
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

  const stations = locations.map(l => mapOjpLocation(l));
  console.log("Stations found:", stations.length);
  console.log(stations.slice(0, 3));
}

run().catch(console.error);
