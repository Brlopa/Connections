const { XMLParser } = require("fast-xml-parser");

const OJP_API_URL = "https://api.opentransportdata.swiss/ojp20";
const ojpToken = process.env.OJP_TOKEN || "eyJvcmciOiI2NDA2NTFhNTIyYWM1NTAwMDE1NWQwMzgiLCJpZCI6IjBhZDIwOGZlMWRlNTRlMGNhMWJmZGZkMjRjZDI1MjIzIiwiaCI6Im11cm11cjEyOCJ9"; // Just a guess, actually I should check if there's a token in the environment or user can provide it

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
          <LocationName>Zürich HB</LocationName>
        </InitialInput>
        <Restrictions>
          <Type>stop</Type>
        </Restrictions>
      </OJPLocationInformationRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  const headers = { "Content-Type": "application/xml" };
  // I need the actual token from the .env file in the workspace
  require('dotenv').config({ path: '../../.env' });
  if (process.env.OJP_TOKEN || process.env.VITE_OJP_TOKEN) {
     headers["Authorization"] = `Bearer ${process.env.OJP_TOKEN || process.env.VITE_OJP_TOKEN}`;
  }

  const res = await fetch(OJP_API_URL, { method: "POST", headers, body: xml });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text.substring(0, 1000));
}

run().catch(console.error);
