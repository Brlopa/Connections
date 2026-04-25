import { XMLParser } from "fast-xml-parser";
import { readFileSync } from 'fs';

const OJP_API_URL = "https://api.opentransportdata.swiss/ojp20";

async function run() {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPLocationInformationRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <InitialInput>
          <LocationName>Zürich</LocationName>
        </InitialInput>
        <Restrictions>
          <Type>stop</Type>
        </Restrictions>
      </OJPLocationInformationRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  const headers = { "Content-Type": "application/xml" };
  const envFile = readFileSync('./.env', 'utf8');
  let token = null;
  for (const line of envFile.split('\n')) {
      if (line.startsWith('OJP_TOKEN=')) {
          token = line.split('=')[1].trim();
      }
  }

  if (token) {
     headers["Authorization"] = `Bearer ${token}`;
  } else {
     console.error("NO TOKEN FOUND IN .env");
  }

  const res = await fetch(OJP_API_URL, { method: "POST", headers, body: xml });
  const text = await res.text();
  console.log("Status:", res.status);
  if (!res.ok) {
     console.log("Error body:", text);
     return;
  }
  
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

  const parsed = parser.parse(text);
  const locationResults = parsed?.OJP?.OJPResponse?.ServiceDelivery?.OJPLocationInformationDelivery?.LocationResult || [];
  
  console.log("Parsed keys:", Object.keys(parsed?.OJP?.OJPResponse?.ServiceDelivery || {}));
  if (parsed?.OJP?.OJPResponse?.ServiceDelivery?.OJPLocationInformationDelivery) {
     console.log("OJPLocationInformationDelivery keys:", Object.keys(parsed.OJP.OJPResponse.ServiceDelivery.OJPLocationInformationDelivery));
     console.log("First LocationResult keys:", Object.keys(locationResults[0] || {}));
     console.log("Example LocationResult:", JSON.stringify(locationResults[0], null, 2));
  } else {
     console.log("NO OJPLocationInformationDelivery in parsed response! Entire ResponseDelivery: ", JSON.stringify(parsed?.OJP?.OJPResponse?.ServiceDelivery, null, 2));
  }
}

run().catch(console.error);
