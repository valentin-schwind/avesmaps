// Der Signaturpoll des Grenz-Canvas laeuft je Sekunde, nicht fuenfmal, und schweigt in versteckten
// Tabs. Er baut je Tick einen String ueber alle regionData -- fuer JEDEN Besucher, in jeder Ansicht.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/grenz-canvas-signaturpoll.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-boundary-canvas-overlay.js"), "utf8").split("\r\n").join("\n");

const start = quelle.indexOf("let lastDerivedSignature = null;");
assert.notStrictEqual(start, -1, "der Signaturpoll steht noch in der Datei");
const block = quelle.slice(start, quelle.indexOf("}, 1000);", start) + 9);
assert.ok(block.includes("window.setInterval(function () {"), "der Poll ist ein setInterval");
assert.ok(block.endsWith("}, 1000);"), "und laeuft je Sekunde (war 200 ms)");
assert.ok(block.includes("if (document.hidden) { return; }"), "und schweigt in versteckten Tabs");
assert.ok(!/\}, 200\);/.test(quelle.slice(start, start + 1200)), "die 200 ms sind weg");

console.log("OK grenz-canvas-signaturpoll");
