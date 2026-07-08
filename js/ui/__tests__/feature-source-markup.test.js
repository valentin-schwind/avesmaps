const assert = require("assert");
const { buildSourceListMarkup } = require("../feature-source-markup.js");

// wiki only
let out = buildSourceListMarkup("https://wiki/x", [], {});
assert.ok(out.includes(">Wiki") && out.includes("https://wiki/x"), "wiki only");

// order: official -> wiki -> rest; official gets a star
out = buildSourceListMarkup("https://wiki/x", [
  { url: "https://f-shop.de/a", label: "F-Shop", official: true, type: "sonstiges" },
  { url: "https://bp/x", label: "Briefspiel", official: false, type: "briefspiel" },
], {});
const iF = out.indexOf("F-Shop"), iW = out.indexOf(">Wiki"), iB = out.indexOf("Briefspiel");
assert.ok(iF < iW && iW < iB, "order official->wiki->rest");
assert.ok(out.includes("popup-source-official"), "official star");

// empty -> empty string
assert.strictEqual(buildSourceListMarkup("", [], {}), "", "empty");

console.log("feature-source-markup tests passed");
