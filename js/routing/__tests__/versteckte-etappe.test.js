const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// „Still vorbei" (Owner 15.08.2026): liegt ein versteckter Ort an einer Strasse, faehrt die Reise
// hindurch -- sein Name faellt aus der Etappenliste. Die Strasse bleibt ganz, die Route bleibt
// gleich lang; es verschwindet nur der Name. Die Etappenliste waere sonst ein Verzeichnis aller
// versteckten Orte.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/routing/__tests__/versteckte-etappe.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "route-plan.js"), "utf8");
const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in route-plan.js gefunden -- umbenannt?`);
	return match[0];
};

let marker = {};
const context = {
	String, Boolean, Object,
	normalizeNodeName: (name) => (String(name || "").startsWith("Kreuzung") ? "Kreuzung" : String(name || "")),
	findLocationMarkerByName: (name) => marker[name] || null,
	// Der echte Zwilling steht in map-features-location-marker-rendering.js und beantwortet BEIDE
	// Haelften zugleich -- „ist versteckt" UND „ist noch nicht aufgedeckt". Hier als Stub, weil dieser
	// Test die Etappenliste prueft, nicht die Aufdeckungsmenge (die hat ihren eigenen Test).
	isHiddenLocation: (location) => Boolean(location && location.isHidden),
};
vm.runInNewContext(extract("isRoutePlanMarkerName"), context);
const { isRoutePlanMarkerName } = context;

marker = {
	Luring: { publicId: "loc-lur", location: { publicId: "loc-lur" } },
	Feenplatz: { publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true } },
};

// --- der Bestand bleibt, wie er ist ---------------------------------------------------------------
assert.strictEqual(isRoutePlanMarkerName("Kreuzung-7"), true, "eine Kreuzung ist weiterhin Laerm");
assert.strictEqual(isRoutePlanMarkerName("Markierung"), true, "eine Markierung auch");
assert.strictEqual(isRoutePlanMarkerName("Luring"), false, "ein gewoehnlicher Ort nicht");

// --- der versteckte Durchgangsort faellt heraus ----------------------------------------------------
assert.strictEqual(isRoutePlanMarkerName("Feenplatz"), true, "ein versteckter Ort ist Laerm");

// --- 🔴 der AUFGEDECKTE nicht ---------------------------------------------------------------------
// Wer ihn ausdruecklich als Wegpunkt gesetzt hat, hat ihn aufgedeckt -- und das eigene Reiseziel darf
// nicht aus dem Reiseplan verschwinden. isHiddenLocation beantwortet genau diese Frage schon (es
// prueft die Aufdeckungsmenge mit), deshalb steht hier keine zweite Menge.
marker.Feenplatz.location.isHidden = false;   // stellvertretend fuer „aufgedeckt"
assert.strictEqual(isRoutePlanMarkerName("Feenplatz"), false, "der aufgedeckte Ort bleibt in der Liste");

// --- ein unbekannter Name faellt NICHT heraus -------------------------------------------------------
// ⚠️ Ein Name ohne Marker ist kein versteckter Ort, sondern ein Knoten, den der Client (noch) nicht
// kennt. Ihn zu schlucken hiesse, eine Etappe stillschweigend zu verlieren.
assert.strictEqual(isRoutePlanMarkerName("Unbekannt"), false, "ein unbekannter Name bleibt stehen");
assert.strictEqual(isRoutePlanMarkerName(""), false, "und ein leerer Name auch");

console.log("versteckte-etappe: all asserts passed");
