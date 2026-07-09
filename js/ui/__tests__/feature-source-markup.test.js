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

// Wiki-publication sources (Task 5): url-less source = plain text (no <a>), pages shown as "S. …",
// mention marked, official-first + *. (require lines from the brief snippet are already at the top.)
const html = buildSourceListMarkup("https://wiki/x", [
  { url:"https://f-shop/1", label:"Efferds Wogen", official:true, type:"regionalspielhilfe", pages:"54", reference_kind:"ausfuehrlich" },
  { url:"", label:"Im Bann des Diamanten", official:true, type:"regionalspielhilfe", pages:"40, 145", reference_kind:"ausfuehrlich" },
  { url:"https://x/2", label:"Historia Aventurica", official:false, type:"quellenband", pages:"176", reference_kind:"erwaehnung", note:"Zerstörung" },
], { wikiLabel:"Wiki Aventurica" });
assert.ok(html.includes("Efferds Wogen") && html.includes("S. 54"));
assert.ok(html.includes("Im Bann des Diamanten") && !/href="[^"]*Diamanten/.test(html)); // url-los = kein Link
assert.ok(html.includes("Wiki Aventurica"));
console.log("markup ok");

console.log("feature-source-markup tests passed");
