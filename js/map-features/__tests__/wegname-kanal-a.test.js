"use strict";
// Kanal A (die Beschriftung der Wiki-Wege als Ganzes) nennt den Weg so, wie der EDITOR ihn nennt.
// 🔴 Seit 15.09.2026 gehoert der Wegname dem Editor (R1 umgekehrt, Kopf von api/_internal/wiki/path-naming.php; Owner: „der wegname
// lässt sich nicht ändern. wenn ich umbenenne, soll das beim speichern für alle abschnitte gelten"). Bis dahin gruppierte Kanal A je
// wiki_key und beschriftete mit `wiki_path.name` -- ein umbenannter Weg hiesse in der Infobox anders als auf der Karte.
// AUSGEFUEHRT: buildWayLabelGroups (map-features-way-labels.js) aus dem Quelltext geschnitten, dazu der ECHTE getPathTitleName samt
// shouldShowRoutePathDisplayName als Titel-Leser, wie ihn das Overlay reicht.
// Aus der Wurzel: node js/map-features/__tests__/wegname-kanal-a.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
function funktion(quelle, name) {
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start >= 0, "Funktion fehlt: " + name);
	let i = quelle.indexOf("{", start);
	let tiefe = 0;
	for (; i < quelle.length; i++) {
		if (quelle[i] === "{") { tiefe++; }
		else if (quelle[i] === "}" && --tiefe === 0) { return quelle.slice(start, i + 1); }
	}
	throw new Error("Klammern unausgeglichen: " + name);
}
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const WEGLABELS = lies("js/map-features/map-features-way-labels.js");
const k = { console, String, Array, Map, Set, RegExp, normalizePathSubtype: (wert) => String(wert || "Weg") };
vm.createContext(k);
vm.runInContext([
	funktion(lies("js/routing/route-node.js"), "getRoutePathDisplayName"),
	funktion(lies("js/routing/route-node.js"), "escapeRouteDisplayRegex"),
	funktion(lies("js/routing/route-node.js"), "shouldShowRoutePathDisplayName"),
	funktion(lies("js/map-features/map-features-path-domain.js"), "getPathTitleName"),
	funktion(WEGLABELS, "buildWayLabelGroups"),
	"var titelVon = function (p) { return getPathTitleName(p) || String(p.properties.display_name || ''); };",
].join("\n"), k);

const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://w/wiki/RS2" };
const weg = (id, extra) => ({ id, properties: Object.assign({ public_id: id, feature_subtype: "Reichsstrasse" }, extra) });
const gruppen = (wege, zulassen) => {
	k.wege = wege;
	k.zulassen = zulassen || (() => true);
	return vm.runInContext("buildWayLabelGroups(wege, zulassen, titelVon)", k);
};

// 1. Der Normalfall: alle Abschnitte eines Artikels heissen gleich -- EINE Gruppe wie bisher.
const einig = gruppen([weg("a", { display_name: "Reichsstraße 2", wiki_path: RS2 }), weg("b", { display_name: "Reichsstraße 2", wiki_path: RS2 })]);
assert.strictEqual(einig.size, 1, "gleich benannte Abschnitte eines Artikels zerfallen in mehrere Gruppen");
const eine = [...einig.values()][0];
assert.strictEqual(eine.name, "Reichsstraße 2");
assert.strictEqual(eine.wikiKey, "reichsstrasse-2", "der echte Artikel-Schluessel reist mit -- der Klick-Eintrag braucht ihn");
assert.strictEqual(eine.wikiUrl, "https://w/wiki/RS2");
assert.deepStrictEqual([...eine.pathsById.keys()], ["a", "b"]);

// 2. Umbenannt: der Editor-Name steht auf der Karte, nicht der Artikel -- und ein umbenannter Teil ist eine eigene Gruppe.
const umbenannt = gruppen([
	weg("a", { display_name: "Alte Reichsstraße", wiki_path: RS2 }),
	weg("b", { display_name: "Alte Reichsstraße", wiki_path: RS2 }),
	weg("c", { display_name: "Reichsstraße 2", wiki_path: RS2 }),
]);
const namen = [...umbenannt.values()].map((g) => g.name).sort();
assert.deepStrictEqual(namen, ["Alte Reichsstraße", "Reichsstraße 2"],
	"Kanal A beschriftet wieder mit wiki_path.name statt mit dem Namen, den der Editor gegeben hat");
assert.ok([...umbenannt.values()].every((g) => g.wikiKey === "reichsstrasse-2"), "beide Gruppen gehoeren weiter zum Artikel");

// 3. Ein Altsegment mit Maschinennamen faellt auf den Artikel zurueck -- und damit in die Gruppe seiner Nachbarn.
const alt = gruppen([weg("a", { display_name: "Reichsstraße 2", wiki_path: RS2 }), weg("x", { display_name: "Reichsstrasse-16", wiki_path: RS2 })]);
assert.strictEqual(alt.size, 1, "ein Maschinenname bildet eine eigene Beschriftung statt des Artikelnamens");

// 4. Das Tor gilt, und ohne Artikel macht keiner mit (das ist Kanal B).
const tor = gruppen([
	weg("a", { display_name: "Reichsstraße 2", wiki_path: RS2 }),
	weg("b", { display_name: "Reichsstraße 2", wiki_path: RS2 }),
	weg("frei", { display_name: "Goblinpfad" }),
	weg("leer", { display_name: "Goblinpfad", wiki_path: { wiki_key: "" } }),
], (p) => p.id !== "b");
assert.strictEqual(tor.size, 1);
assert.deepStrictEqual([...[...tor.values()][0].pathsById.keys()], ["a"], "das Tor (istZulaessig) wird uebergangen");

// 5. Das Overlay reicht den Titel-Leser und die Gruppen-Rechnung wirklich durch.
const overlay = ohneKommentare(lies("js/map-features/map-features-path-label-canvas-overlay.js"));
assert.ok(/buildWayLabelGroups\(pathData,/.test(overlay), "das Overlay baut seine Gruppen nicht ueber buildWayLabelGroups");
assert.ok(/const wegTitel = \(p\) => \(typeof getPathTitleName === "function" \? getPathTitleName\(p\) : ""\) \|\| getPathDisplayName\(p\);/.test(overlay),
	"das Overlay nimmt den Titel nicht aus getPathTitleName");
assert.ok(!/wiki_path\.name/.test(overlay), "das Overlay liest wieder wiki_path.name als Beschriftung");

console.log("wegname-kanal-a.test.js: ok");
