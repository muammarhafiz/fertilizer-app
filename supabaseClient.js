import "react-native-url-polyfill/auto"; // polyfills URL/crypto in RN
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extras = Constants.expoConfig?.extra ?? {};
const url = extras.SUPABASE_URL;
const anon = extras.SUPABASE_ANON_KEY;

console.log("Supabase URL:", url); // should log your https://...supabase.co

if (!url || !/^https?:\/\//.test(url)) {
  console.error("❌ Invalid or missing SUPABASE_URL. Check app.config.js.");
}
if (!anon) {
  console.error("❌ Missing SUPABASE_ANON_KEY. Check app.config.js.");
}

export const supabase = createClient(url, anon);
