import { readFileSync } from 'fs';

const OJP_API_URL = "https://api.opentransportdata.swiss/ojp20";

async function testXML(xml) {
  const envFile = readFileSync('./.env', 'utf8');
  let token = null;
  for (const line of envFile.split('\n')) {
      if (line.startsWith('OJP_TOKEN=')) token = line.split('=')[1].trim();
  }
  const headers = { "Content-Type": "application/xml", "Authorization": `Bearer ${token}` };
  const res = await fetch(OJP_API_URL, { method: "POST", headers, body: xml });
  const text = await res.text();
  if (text.includes("TripResult")) {
      console.log("TRIP FOUND!");
      console.log(text.substring(0, 1000));
  } else {
      console.log("NO TRIP:", text.substring(0, 1000));
  }
}

const xml1 = `<?xml version="1.0" encoding="utf-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
      <siri:RequestorRef>API-Server</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
        <Origin>
          <PlaceRef>
            <StopPlaceRef>8503000</StopPlaceRef>
          </PlaceRef>
          <DepArrTime>2024-04-25T16:00:00</DepArrTime>
        </Origin>
        <Destination>
          <PlaceRef>
            <StopPlaceRef>8507000</StopPlaceRef>
          </PlaceRef>
        </Destination>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

await testXML(xml1);
