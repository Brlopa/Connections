
const OJP_URL = "https://api.opentransportdata.swiss/ojp20";
const OJP_API_KEY = process.env.OJP_API_KEY;

async function testOJP() {
  if (!OJP_API_KEY) {
    console.error("OJP_API_KEY not set");
    return;
  }

  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>Test</siri:RequestorRef>
      <OJPTripRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <Origin>
          <PlaceRef>8507000</PlaceRef>
          <DepArrTime>${now}</DepArrTime>
        </Origin>
        <Destination>
          <PlaceRef>8503000</PlaceRef>
        </Destination>
        <Params>
          <NumberOfResults>1</NumberOfResults>
        </Params>
      </OJPTripRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;

  console.log("Sending XML...");
  try {
    const res = await fetch(OJP_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/xml", 
        "Authorization": `Bearer ${OJP_API_KEY}` 
      },
      body: xml
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response (first 500 chars):", text.slice(0, 500));
  } catch (e) {
    console.error("Fetch error:", e);
  }
}

testOJP();
