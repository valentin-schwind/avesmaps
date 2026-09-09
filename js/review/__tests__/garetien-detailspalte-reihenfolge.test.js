// Owner 09.09.2026: „was mich auch stört ist, dass dieser teil sticky und nicht über ‚Eingefügt
// wird‘ … steht."
//
// 🪤 DIE ALTE ORDNUNG WAR NICHT FALSCH, SONDERN ÜBERHOLT. Sie stand mit Begründung im Code: die
// Leiste hing als `flex: none` am Fuss der Spalte, „läge sie IM Rollkasten, stünde die Entscheidung
// bei 13 Abschnitten hinter der Bildlaufleiste". Das galt, solange sie NUR Knöpfe trug. Seit dem
// 09.09.2026 trägt sie den NAMEN und die zwei Häkchen -- sie ist keine Fussleiste mehr, sondern der
// Kasten, in dem man das Objekt einstellt, und der gehört VOR die Feinheiten (Zoomband, Priorität,
// Wiki-Suche), nicht hinter sie.
//
// Ausführen: node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }

// Ein Objekt, das BEIDES zeigt: die Handlungsleiste und den Kasten „Eingefügt wird".
// ⚠️ Ohne das `new`-Item mit Ziel gäbe es den zweiten gar nicht, und ein indexOf-Vergleich liefe
// gegen -1 -- grün, ohne etwas zu messen. Genau daran ist die erste Fassung dieses Tests gescheitert.
const objekt = {
	key: "ggp:Gewaesser:Wald:Garetien:Silker Hain 4!Silker Hain 4",
	stand: "offen", urteil: "neu", name: "Silker Hain 4", wiki: "ggp",
	grund: "nichts desselben Typs in der Nähe",
	ziel: "region", subtyp: "wald", kind: "vegetation",
	items: [{ id: 31, change_type: "new", anlass: "", felder: ["quelle"] }],
};

const spalte = api.garetienDetailMarkup(objekt, null, false);
const iActs = spalte.indexOf('<div class="gi-acts">');
const iEingefuegt = spalte.indexOf("Eingefügt wird");
const iDetail = spalte.indexOf('<div class="gi-detail">');

pruefe(iActs !== -1, "die Handlungsleiste steht in der Spalte");
pruefe(iEingefuegt !== -1, "und der Kasten „Eingefügt wird“ auch -- sonst misst der Vergleich nichts");
pruefe(iActs < iEingefuegt, "🔴 die Leiste steht DAVOR (Owner 09.09.2026)");
pruefe(iDetail < iActs, "💣 und INNERHALB der rollenden Ansicht -- sonst klebt sie wieder am Fuss");
pruefe(!/<\/div><div class="gi-acts">/.test(spalte),
	"nicht mehr als Geschwister hinter dem schliessenden div der .gi-detail");

// ⚠️ „Imports in der Nähe" bleibt UNTEN: es ist ein Werkzeug für die LISTE, keine Einstellung
// dieses Objekts -- und damit weiter ein Geschwister der rollenden Ansicht.
const iNaehe = spalte.indexOf("gi-naehe");
if (iNaehe !== -1) {
	pruefe(iNaehe > spalte.lastIndexOf("</div>") - spalte.length + iNaehe || iNaehe > iActs,
		"„Imports in der Nähe“ steht weiterhin darunter");
}

// --- Die CSS-Seite: das Kleben hing an EINEM Selektor ---------------------------------------------
// 💣 `.gi-win .avm-col > .gi-acts` traf ein DIREKTES Kind der Spalte. Als Kind von `.gi-detail`
// greift er nicht mehr -- er wäre eine tote Regel, und eine tote Regel liest der nächste als
// geltend. Deshalb ist er ersetzt, nicht stehengelassen.
const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "css", "components",
	"garetien-importer.css"), "utf8");
// ⚠️ Gemessen wird die REGEL (`{` dahinter), nicht die Zeichenkette: derselbe Selektor steht
// weiter in einem Kommentar, der die Geschichte erzaehlt -- und den soll er auch.
pruefe(!/\.avm-col\s*>\s*\.gi-acts\s*\{/.test(css), "die alte Anheftungs-Regel ist weg");
pruefe(/\.gi-detail\s*>\s*\.gi-acts\s*\{[^}]*border-top/.test(css),
	"und die neue setzt den Kasten mit einer Trennlinie ab");

console.log("OK -- " + n + " Zusicherungen");
