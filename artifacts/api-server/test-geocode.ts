import dotenv from "dotenv";
dotenv.config();
const geocodeAddress = async (text: string) => {
  const GEOAPIFY_KEY = process.env.VITE_GEOAPIFY_API_KEY || process.env.GEOAPIFY_API_KEY;
  console.log("key:", GEOAPIFY_KEY ? "exists" : "missing");
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&apiKey=${GEOAPIFY_KEY}&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data.features[0].geometry.coordinates));
};
geocodeAddress("Zürich, Bahnhofstr. 1");
