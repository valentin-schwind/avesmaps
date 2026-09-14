// Nachbesserung Runde 1 (14.09.2026), W-a: ein übernommenes Objekt zeigt wieder, ALS WAS es
// übernommen wurde -- seit `garetienEingefuegtWirdMarkup` für „uebernommen" mit "" aussteigt
// (Aufgabe 11), fehlte diese Auskunft ganz.
//
// 🔴 Ruling (Koordinator, bindend): die Form kommt aus DEM, WAS WIRKLICH ANGELEGT WURDE
// (`objekt.ziel`/`objekt.subtyp`, DURCHGEREICHT aus dem angewendeten Item -- garetien-liste.php
// sagt es selbst: "DURCHGEREICHT, NICHT HERGELEITET"), NICHT aus der heutigen Stage-Vorbelegung
// (`garetienZielWahlZu`). Keine Eingabefelder, keine gesperrten Felder -- nur Anzeige.
// ⚠️ Kein Datum: der Client erhält keinen Zeitstempel der Übernahme (weder `apply_note` noch ein
// `applied_at`-Wert reisen mit) -- „was die Daten nicht tragen, wird nicht erfunden".
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-uebernommen-form.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

global.document = global.document || { documentElement: {}, getElementById() { return null; },
	addEventListener() {}, querySelectorAll() { return []; } };
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
["js/map-features/ecosystem-display.js", "js/map-features/location-zoom-bands.js"].forEach(function (datei) {
	vm.runInThisContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), { filename: datei });
});
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }

const QUELLE = { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
	license: "cc-by-nc-sa-3.0", source_type: "briefspiel" };

// ---- 1. Einzelobjekt, uebernommen, wirklich als Flaeche angelegt --------------------------------
const einzel = {
	key: "ggp:Waelder:Wald:Garetien:Silker-Heide!Silker-Heide", name: "Silker Heide", typ: "Heide",
	stand: "uebernommen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
	geometrie: [[1, 1], [2, 1], [2, 2]], quelle: QUELLE, abschnitte: [],
	items: [{ id: 101, change_type: "new", anlass: null, apply_state: "done" }],
};
const metaEinzel = api.garetienDetailMetaMarkup(einzel, []);
pruefe(metaEinzel.includes("als Fläche übernommen"), "🔴 die Metazeile nennt die Form: " + metaEinzel);
pruefe(!metaEinzel.includes("Verbund aus"), "…kein Verbund-Teil an einem Einzelobjekt: " + metaEinzel);

const spalteEinzel = api.garetienDetailMarkup(einzel, null, false);
const blockAEinzel = spalteEinzel.slice(0, spalteEinzel.indexOf('<span class="gi-block__zahl">F</span>'));
pruefe(blockAEinzel.includes("Wald"), "Block A nennt die Art (mindestens): " + blockAEinzel);
pruefe(!/data-gi-feld|<select|<input/.test(blockAEinzel),
	"🔴 keine Eingabefelder, keine gesperrten Felder -- nur Anzeige: " + blockAEinzel);

// ---- 2. Verbund, uebernommen: die Metazeile nennt Fragmente UND Form ----------------------------
function fragment(nr) {
	return {
		key: "ggp:Waelder:Wald:Garetien:Silker Hain " + nr + "!Silker Hain " + nr,
		name: "Silker Hain " + nr, typ: "Wald", stand: "uebernommen", urteil: "neu", wiki: "ggp",
		ziel: "region", subtyp: "wald", kind: "vegetation", verbund_stamm: "Silker Hain", verbund_n: 3,
		geometrie: [[1, 1], [2, 1], [2, 2]], quelle: QUELLE, abschnitte: [],
		items: [{ id: 200 + nr, change_type: "new", anlass: null, apply_state: "done" }],
	};
}
const f1 = fragment(1);
const f2 = fragment(2);
const f3 = fragment(3);
const objekteVerbund = [f1, f2, f3];
const metaVerbund = api.garetienDetailMetaMarkup(f1, objekteVerbund);
pruefe(metaVerbund.includes("Verbund aus 3 Fragmenten"), "🔴 nennt die Fragmentzahl: " + metaVerbund);
pruefe(metaVerbund.includes("als Fläche übernommen"), "…und die Form: " + metaVerbund);
pruefe(metaVerbund.indexOf("Verbund aus") < metaVerbund.indexOf("als Fläche übernommen"),
	"der Verbund-Teil steht VORN, vor der Form: " + metaVerbund);
gleich(metaVerbund.indexOf('<p class="gi-detail__meta">Verbund aus'), 0,
	"…und ganz am Anfang der Metazeile, vor Wiki/LOD/Herkunft/Extra: " + metaVerbund);

// ---- 3. Abgelehnt/Offen unverändert -- keine "übernommen"-Auskunft --------------------------------
const abgelehnt = Object.assign({}, einzel, {
	key: "ggp:Waelder:Wald:Garetien:Abgewiesen!Abgewiesen", stand: "abgelehnt",
});
gleich(api.garetienDetailMetaMarkup(abgelehnt, []).includes("übernommen"), false,
	"eine abgelehnte Zeile nennt keine Übernahme-Form");
const offen = Object.assign({}, einzel, {
	key: "ggp:Waelder:Wald:Garetien:NochOffen!NochOffen", stand: "offen",
	items: [{ id: 301, change_type: "new", anlass: "" }],
});
gleich(api.garetienDetailMetaMarkup(offen, []).includes("übernommen"), false,
	"eine offene Zeile nennt keine Übernahme-Form");

// ---- 4. Ein rein AENDERNDES Objekt (Ergaenzung) hat nichts angelegt -------------------------------
const nurGeaendert = {
	key: "ggp:blutmoor", name: "Blutmoor", stand: "uebernommen", urteil: "ergaenzung",
	geometrie_typ: "Polygon", abschnitte: [],
	items: [{ id: 401, change_type: "changed", apply_state: "done", anlass: "geometrie",
		felder: ["geometrie"], selected: 0 }],
};
gleich(api.garetienDetailMetaMarkup(nurGeaendert, []).includes("übernommen"), false,
	"🔴 ohne 'new'-Item keine Formangabe -- es wurde nichts angelegt");
const spalteGeaendert = api.garetienDetailMarkup(nurGeaendert, null, false);
const blockAGeaendert = spalteGeaendert.slice(0, spalteGeaendert.indexOf('<span class="gi-block__zahl">F</span>'));
gleich(/Angelegt als/.test(blockAGeaendert), false,
	"…und Block A behauptet nichts Angelegtes: " + blockAGeaendert);

// ---- 5. 'new'-Item, aber KEIN `ziel` (alter Lauf) -- benennen, was fehlt, nichts erfinden --------
const alterLauf = {
	key: "ggp:Waelder:Wald:Garetien:AlterLauf!AlterLauf", name: "Alter Lauf", stand: "uebernommen",
	urteil: "neu", geometrie: [[1, 1], [2, 1], [2, 2]], abschnitte: [],
	items: [{ id: 501, change_type: "new", anlass: null, apply_state: "done" }],
	// kein `ziel`, kein `subtyp` -- ein Lauf von vor dem Nachzug
};
gleich(api.garetienDetailMetaMarkup(alterLauf, []).includes("übernommen"), false,
	"🔴 ohne `ziel` bleibt die Metazeile ohne erfundene Form");
const spalteAlterLauf = api.garetienDetailMarkup(alterLauf, null, false);
const blockAAlterLauf = spalteAlterLauf.slice(0, spalteAlterLauf.indexOf('<span class="gi-block__zahl">F</span>'));
pruefe(blockAAlterLauf.includes("nicht mehr bekannt"),
	"🔴 Block A benennt, was fehlt, statt zu schweigen oder zu erfinden: " + blockAAlterLauf);

console.log("OK -- garetien-uebernommen-form (" + n + " Zusicherungen)");
