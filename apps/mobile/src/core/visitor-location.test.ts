import { test } from "node:test";
import assert from "node:assert/strict";
import { visitorCountry, visitorLocation } from "./visitor-location.ts";
test("IP country is shown with English name and correct flag", () => {
  assert.deepEqual(visitorCountry("gb"), { code: "GB", name: "United Kingdom", flag: "🇬🇧" });
  assert.equal(visitorLocation({ country: "US", city: "New York" }), "New York · 🇺🇸 United States");
});
test("missing geolocation is never invented", () => {
  for (const value of [undefined, null, "XX", "ZZ", "en-US", "<script>"])
    assert.equal(visitorCountry(value), null);
  assert.equal(visitorLocation({}), "");
  assert.equal(visitorLocation({ country: "GB", city: null }), "🇬🇧 United Kingdom");
});
