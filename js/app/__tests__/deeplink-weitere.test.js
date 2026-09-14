"use strict";
// „Anzeigen" und ?strasse=: auch die Abschnitte mit dem Artikel als weitere Zuweisung (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: node js/app/__tests__/deeplink-weitere.test.js
//
// 🪤 Arrays aus dem vm-Kontext tragen einen FREMDEN Array-Prototyp -- deepStrictEqual gegen ein Host-Array
// faellt bei zeichengleichem Inhalt. Deshalb werden sie vor dem Vergleich in den Testkontext kopiert (`[...x]`).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "wiki-deeplink.js"), "utf8").replace(/\r\n/g, "\n");
const schneide = (name) => {
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start >= 0, name + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1) + "\n";
	}
	throw new Error("offen: " + name);
};

const gezeigt = [];
const kontext = {
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	focusSpotlightPath: (eintrag) => gezeigt.push(eintrag),
	suppressPlannerUrlSyncForWikiDeeplink: () => {},
	getSpotlightPathGroupKeyForPath: (p) => "wiki:" + p.properties.wiki_path.wiki_key,
	pathData: [],
};
vm.createContext(kontext);
vm.runInContext(["normalizeWikiDeeplinkKey", "wikiUrlToDeeplinkKey", "spotlightEntryWikiKeys", "subtypeOfPath", "exactPathNameKey",
	"pathMatchesDeeplinkTarget", "deeplinkWeitererTreffer", "focusWholeWikiDeeplinkPath"].map(schneide).join(""), kontext);

const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
// wiki_key ausdruecklich, wie der Server ihn bildet (avesmapsPoliticalSlug faltet Umlaute zu „-": b-renpfad)
const weg = (id, subtype, hauptSeite, hauptKey, weitere = []) => ({ properties: { public_id: id, feature_subtype: subtype, display_name: hauptSeite,
	wiki_path: { wiki_key: hauptKey, wiki_url: url(hauptSeite) }, wiki_path_weitere: weitere } });
kontext.pathData = [
	weg("rs-7", "Reichsstrasse", "Reichsstraße_2", "reichsstrasse-2",
		[{ wiki_key: "b-renpfad", wiki_url: url("Bärenpfad") }, { wiki_key: "geronsgang", wiki_url: url("Geronsgang") }]),
	weg("rs-6", "Reichsstrasse", "Reichsstraße_2", "reichsstrasse-2"),
	weg("bp-1", "Pfad", "Bärenpfad", "b-renpfad"),
];
const schluessel = (seite) => vm.runInContext("wikiUrlToDeeplinkKey", kontext)(url(seite));
const zeige = (seite) => { gezeigt.length = 0; assert.ok(vm.runInContext("focusWholeWikiDeeplinkPath", kontext)(schluessel(seite))); return gezeigt[0]; };
const liste = (x) => [...x];

assert.deepStrictEqual(liste(zeige("Bärenpfad").paths.map((p) => p.properties.public_id)).sort(), ["bp-1", "rs-7"], "Baerenpfad samt Traeger");
assert.deepStrictEqual(liste(zeige("Reichsstraße_2").paths.map((p) => p.properties.public_id)).sort(), ["rs-6", "rs-7"], "die Reichsstrasse ohne den Baerenpfad");
const geron = zeige("Geronsgang");
assert.deepStrictEqual(liste(geron.paths.map((p) => p.properties.public_id)), ["rs-7"], "ein Artikel nur aus weiteren Zuweisungen");
assert.strictEqual(geron.id, "path:wiki:geronsgang", "und seine Auswahl heisst nach dem Artikel, nicht nach der Reichsstrasse");

// spotlightEntryWikiKeys: ein Wegeintrag nennt nur SEINEN Artikel -- ein ?strasse=Reichsstraße_2 darf nicht den Baerenpfad treffen
const keys = vm.runInContext("spotlightEntryWikiKeys", kontext)({ kind: "path", id: "path:wiki:b-renpfad", paths: [kontext.pathData[2], kontext.pathData[0]] });
assert.deepStrictEqual(liste(keys), [schluessel("Bärenpfad"), schluessel("Bärenpfad")]);

console.log("deeplink-weitere.test.js: ok");
