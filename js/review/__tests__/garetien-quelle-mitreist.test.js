// Die mitgereiste Quelle steht sofort in der Infobox -- ohne vollstaendiges Neuladen.
//
// Owner-Meldung 31.08.2026, woertlich: „ich hab ein moor importiert, aber es fehlt die 'quelle, die
// mitreist', erst wenn ich die seite komplett neulade stehts glaub dran".
//
// 🔴 WARUM DER KARTENSTEMPEL DAS NICHT HEILT -- der Kern der ganzen Aufgabe. Die Uebernahme hebt
// `map_revision`, aber die GELADENE Seite fragt die Kartendaten danach nicht noch einmal ab.
// `window.__sourceCatalog` und `window.__featureSourceRefs` sind eine EINMALIGE Aufnahme vom
// Seitenstart, und die Infobox liest synchron aus ihnen (AGENTS.md §11: „rendered synchronously --
// no lazy per-popup fetch"). Ein frisch importiertes Objekt steht darin gar nicht.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/garetien-quelle-mitreist.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");
// 🪤 Kommentare weg, bevor irgendetwas im Quelltext gesucht wird. Eine Quelltextpruefung, die an
// der ERKLAERUNG anschlaegt, ist gruen und prueft nichts -- und der naechste Leser loescht den
// Kommentar und macht sie rot.
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

// =================================================================================================
// 1. 💣 DER ABGLEICH IST GETEILT, NICHT NACHGEBAUT -- zur LAUFZEIT gemessen, nicht am Text
// =================================================================================================
// Ein `require` im Quelltext belegt nur, dass die Datei eingebunden IST. Hier wird die geteilte
// Fassung durch einen Spion ERSETZT und geprueft, dass der Importer wirklich sie ruft: eine eigene
// Kopie im Importer waere die zweite Wahrheit, gegen die dieser ganze Abschnitt gebaut ist.
const quellenModul = require(path.resolve(__dirname, "..", "review-feature-sources.js"));
wahr(typeof quellenModul.syncFeatureSourcesToClientCache === "function",
	"review-feature-sources.js gibt syncFeatureSourcesToClientCache heraus");

const echt = quellenModul.syncFeatureSourcesToClientCache;
const gerufen = [];
quellenModul.syncFeatureSourcesToClientCache = function (typ, id, quellen) {
	gerufen.push({ typ, id, anzahl: (quellen || []).length });
};

const importer = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienQuellenNachtragen } = importer;
wahr(typeof garetienQuellenNachtragen === "function", "garetienQuellenNachtragen fehlt im Export");

const antwort = {
	ok: true, done: true, applied: 2,
	quellen_neu: [
		{ entity_type: "region", public_id: "aa-11", sources: [{ source_id: 5 }, { source_id: 9 }] },
		{ entity_type: "path", public_id: "bb-22", sources: [{ source_id: 5 }] },
	],
};
gleich(garetienQuellenNachtragen(antwort), 2, "beide beruehrten Objekte werden nachgetragen");
assert.deepStrictEqual(gerufen, [
	{ typ: "region", id: "aa-11", anzahl: 2 },
	{ typ: "path", id: "bb-22", anzahl: 1 },
], "und zwar ueber die GETEILTE Funktion, mit Typ, id und der vollen Liste");
checks++;

// ⚠️ Faellt die Antwort ohne das Feld aus (ein alter Server, ein Lauf ohne Quelle), passiert nichts
// -- und es wirft nichts.
gerufen.length = 0;
gleich(garetienQuellenNachtragen({ ok: true, done: true }), 0, "ohne quellen_neu passiert nichts");
gleich(garetienQuellenNachtragen(null), 0, "und ohne Antwort ebenso");
gleich(garetienQuellenNachtragen({ quellen_neu: "kein-array" }), 0, "ein Nicht-Array wird verworfen, nicht geraten");
// 💣 Eine Zeile ohne Typ oder id wuerde im Browser unter dem Schluessel „undefined:undefined"
// landen und dort eine fremde Quellenliste ueberschreiben.
gleich(garetienQuellenNachtragen({ quellen_neu: [{ sources: [] }, { entity_type: "path" }] }), 0,
	"eine Zeile ohne Typ oder id wird uebersprungen, nie unter einem Platzhalter-Schluessel abgelegt");
gleich(gerufen.length, 0, "und der Abgleich wird dabei gar nicht erst gerufen");

quellenModul.syncFeatureSourcesToClientCache = echt;

// =================================================================================================
// 2. 💣 LIZENZ UND NAMENSNENNUNG LANDEN WIRKLICH IM KATALOG
// =================================================================================================
// Sie tun es nicht von selbst: `syncFeatureSourcesToClientCache` baut den Katalogeintrag Feld fuer
// Feld auf. Bis zum 31.08.2026 fehlten genau diese zwei -- die Quelle erschien, ihr Lizenzbaustein
// nicht. 🔴 Und die Lizenz traegt die Rechtsfolge (NOTICE.md): der Garetien-Import haengt
// `cc-by-nc-sa-3.0` / „VolkoV / garetien.de" an JEDES Objekt.
// ⚠️ Das Fehlen sah aus wie eine schlecht erfasste Quelle, nicht wie ein Anzeigefehler.
global.window.__sourceCatalog = {};
global.window.__featureSourceRefs = {};
echt("region", "moor-1", [{
	source_id: 42, url: "https://www.garetien.de/x", label: "Briefspiel (Garetien)",
	type: "briefspiel", official: false, pages: "S. 4", reference_kind: "ergaenzend",
	license: "cc-by-nc-sa-3.0", attribution: "VolkoV / garetien.de",
}]);
const katalog = global.window.__sourceCatalog[42];
gleich(katalog.license, "cc-by-nc-sa-3.0", "die Lizenz steht im Katalog");
gleich(katalog.attribution, "VolkoV / garetien.de", "die Namensnennung ebenso");
gleich(katalog.label, "Briefspiel (Garetien)", "und die Beschriftung wie bisher");
assert.deepStrictEqual(global.window.__featureSourceRefs["region:moor-1"],
	[{ source_id: 42, pages: "S. 4", reference_kind: "ergaenzend" }],
	"und der Verweis haengt unter <typ>:<public_id>");
checks++;

// 🔴 DER LESER DER INFOBOX LIEST GENAU DIESE ZWEI FELDER. Ohne diesen Zeugen belegten die Zeilen
// darueber nur, dass zwei Schluessel gesetzt werden -- nicht, dass sie irgendwo ankommen.
const markup = ohneKommentare(lies("js", "ui", "feature-source-markup.js"));
wahr(/s\.license/.test(markup) && /s\.attribution/.test(markup),
	"js/ui/feature-source-markup.js liest license und attribution aus dem Katalogeintrag");

// =================================================================================================
// 3. 💣 GERUFEN WIRD IM EINEN TRICHTER, nicht an den Klickverteilern
// =================================================================================================
// `apply` laeuft in Haeppchen und kann mehrfach antworten; an den zwei Aufrufstellen waere der
// Nachtrag beim naechsten Knopf vergessen. Gemessen am Quelltext, weil die Stelle in einem
// Netzaufruf sitzt.
const importerQuelle = ohneKommentare(lies("js", "review", "review-garetien-importer.js"));
wahr(/\["applied", "deleted", "stale", "skipped", "declined"\][\s\S]{0,200}garetienQuellenNachtragen\(antwort\);/
	.test(importerQuelle),
	"der Nachtrag haengt an der Stelle, an der JEDE apply-Antwort ausgewertet wird");
gleich((importerQuelle.match(/garetienQuellenNachtragen\(/g) || []).length, 2,
	"und er wird genau EINMAL gerufen (plus die Definition) -- keine zweite Aufrufstelle");

// =================================================================================================
// 4. 🔴 DIE EINE ZEILE AM GETEILTEN ENDPUNKT
// =================================================================================================
// `api/edit/wiki/sync-plan.php` bedient ACHT Objektarten. Das Feld ist generisch und bei sieben
// davon leer -- der Importer bekommt keine eigene Tuer (siehe die Abbau-Bedingung des Vorhabens).
const endpunkt = lies("api", "edit", "wiki", "sync-plan.php")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
wahr(/'quellen_neu' => is_array\(\$step\['quellen_neu'\] \?\? null\) \? \$step\['quellen_neu'\] : \[\],/
	.test(endpunkt),
	"die Antwort reicht quellen_neu generisch durch, mit leerer Liste als Rueckfall");
// ⚠️ Und der Importer-Zweig gibt es wirklich heraus -- sonst reichte der Endpunkt eine Zahl durch,
// die nie jemand fuellt.
const schritt = lies("api", "_internal", "import", "garetien-uebernahme.php")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
wahr(/'quellen_neu' => \$ergebnis\['quellen_neu'\] \?\? \[\],/.test(schritt),
	"avesmapsGaretienApplyStep reicht die Liste aus der Uebernahme hoch");

console.log(`garetien-quelle-mitreist: ${checks} Pruefungen bestanden.`);
