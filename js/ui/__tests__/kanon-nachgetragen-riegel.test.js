"use strict";

// DER RIEGEL: die Vorgabe "offiziell" gilt nicht fuer einen NACHGETRAGENEN Verweis.
//
// 🚩 Owner-Meldung 09.09.2026, mit Bild: die Landschaftsflaeche "Schwanenbruch" trug am Kopf
// OFFIZIELL, waehrend darunter ihre einzige Quelle als "INOFFIZIELL | Briefspiel" stand. Ursache war
// NICHT die Ableitung -- die war richtig, live in der Nutzlast nachgemessen --, sondern dass
// syncFeatureSourcesToClientCache die Verweise nachtraegt und die Kanon-Tafel nicht, und dass ein
// FEHLENDER Tafeleintrag hier "offiziell" bedeutet.
//
// 🔴 Dieser Test sichert die Eigenschaft, die den Fehler UNWIEDERHOLBAR macht: nachgetragene
// Verweise ohne ausdrueckliches Etikett ergeben KEIN Etikett. Er darf nicht "aufgeraeumt" werden,
// weil er scheinbar dasselbe prueft wie kanon-ohne-etikett.test.js -- jener prueft die NUTZLAST,
// dieser den NACHTRAG. Die Herkunft des Verweises ist der ganze Unterschied.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(REPO, "js", "ui", "popups.js"), "utf8");

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen += 1; };
// 🪤 Ein Objekt aus einem vm-Kontext traegt einen FREMDEN Object.prototype: `deepStrictEqual` gegen
// ein Host-Objekt faellt bei zeichengleichem Inhalt ("actual {kanon:'offiziell'}, expected
// {kanon:'offiziell'}"). Beim Bau dieses Tests einmal zugeschlagen -- flach umkopieren.
const alsHost = (x) => (x && typeof x === "object" ? Object.assign(Array.isArray(x) ? [] : {}, x) : x);
const gleich = (ist, soll, text) => { assert.deepStrictEqual(alsHost(ist), soll, text); pruefungen += 1; };

// 💣 Die Funktion wird AUSGESCHNITTEN UND AUSGEFUEHRT, nicht per Regex gelesen: ein Regex kennt
// keinen Geltungsbereich, und genau daran ist am 03.09.2026 eine Regression zwei Stunden live
// geblieben (AGENTS.md §11, "quellenSchluessel stand nur in der Datenbox-Funktion").
const start = quelle.indexOf("function resolveFeatureKanon");
pruefe(start > 0, "resolveFeatureKanon ist auffindbar");
// ⚠️ Zeilenendenneutral schneiden: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
const rumpf = quelle.slice(start);
const ende = rumpf.search(/\r?\n\}/);
pruefe(ende > 0, "das Funktionsende ist auffindbar");
const code = rumpf.slice(0, ende + 3);

function fahre(fensterZustand) {
	const kontext = { window: fensterZustand, module: { exports: {} } };
	vm.createContext(kontext);
	vm.runInContext(code + "\nmodule.exports = resolveFeatureKanon;", kontext);
	return kontext.module.exports;
}

const refs = { "ecosystem:eco-A": [{ source_id: 1 }] };
const kanon = { vorgabe: "offiziell", abweichungen: {} };

// ---- A: OHNE Marke gilt die Vorgabe weiter -- der Zustand der Kartennutzlast --------------------
let loeser = fahre({ __featureKanon: kanon, __featureSourceRefs: refs });
gleich(loeser("ecosystem", "eco-A"), { kanon: "offiziell" },
	"A: ein Verweis AUS DER NUTZLAST folgt weiter der Vorgabe -- daran haengen rund 5000 Objekte, "
	+ "die deshalb keinen eigenen Eintrag brauchen. Diesen Weg darf der Riegel nicht beruehren.");

// ---- B: MIT Marke und OHNE Eintrag gibt es KEIN Etikett ----------------------------------------
loeser = fahre({
	__featureKanon: kanon,
	__featureSourceRefs: refs,
	__featureSourceRefsNachgetragen: { "ecosystem:eco-A": true },
});
pruefe(loeser("ecosystem", "eco-A") === null,
	"B: DER RIEGEL -- ein nachgetragener Verweis ohne ausdrueckliches Etikett bekommt keins. "
	+ "Ein kuenftiger Nachtragsweg, der das Etikett vergisst, zeigt damit nichts statt etwas Falsches.");

// ---- C: MIT Marke UND Eintrag gilt der Eintrag ---------------------------------------------------
loeser = fahre({
	__featureKanon: {
		vorgabe: "offiziell",
		abweichungen: { "ecosystem:eco-A": { kanon: "inoffiziell", bezeichner_type: "briefspiel" } },
	},
	__featureSourceRefs: refs,
	__featureSourceRefsNachgetragen: { "ecosystem:eco-A": true },
});
gleich(loeser("ecosystem", "eco-A"), { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"C: der ausdrueckliche Eintrag schlaegt den Riegel -- sonst waere der Nachtrag wirkungslos");

// ---- D: ein nachgetragenes OFFIZIELLES Objekt behaelt sein Etikett ------------------------------
loeser = fahre({
	__featureKanon: { vorgabe: "offiziell", abweichungen: { "settlement:ort-D": { kanon: "offiziell" } } },
	__featureSourceRefs: { "settlement:ort-D": [{ source_id: 2 }] },
	__featureSourceRefsNachgetragen: { "settlement:ort-D": true },
});
gleich(loeser("settlement", "ort-D"), { kanon: "offiziell" },
	"D: 'offiziell' muss AUSDRUECKLICH mitreisen, sobald ein Schluessel markiert ist -- genau "
	+ "deshalb liefert der Server es mit, statt sich auf die Vorgabe zu verlassen");

// ---- E: ohne Verweise weiterhin kein Etikett ----------------------------------------------------
loeser = fahre({ __featureKanon: kanon, __featureSourceRefs: {}, __featureSourceRefsNachgetragen: {} });
pruefe(loeser("ecosystem", "eco-X") === null, "E: unbelegt bleibt unbeschriftet");

// ---- F: eine fehlende Marken-Tafel ist kein Fehler ----------------------------------------------
loeser = fahre({ __featureKanon: kanon, __featureSourceRefs: refs });
gleich(loeser("ecosystem", "eco-A"), { kanon: "offiziell" },
	"F: ohne Marken-Tafel verhaelt sich alles wie vorher -- der Riegel faellt OFFEN aus");

// ---- G: DER WAECHTER -- es gibt genau zwei Schreiber der Verweistafel ---------------------------
// 💣 Der Riegel wirkt nur, solange jeder Schreiber von __featureSourceRefs auch die Marke setzt.
// Ein dritter Schreiber anderswo umginge ihn lautlos -- und genau so ist der Fehler entstanden: ein
// neuer LESER (das Kanon-Etikett, 30ee4851d vom 01.09.2026) kam an eine Tafel, deren Schreiber
// niemand inventarisiert hatte. Wer eine dritte Stelle braucht, fuehrt sie durch
// syncFeatureSourcesToClientCache.
function ohneKommentare(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const schreiber = [];
(function suche(verzeichnis) {
	for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
		if (eintrag.name === "__tests__" || eintrag.name === "third-party" || eintrag.name === "node_modules") {
			continue;
		}
		const p = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			suche(p);
		} else if (eintrag.name.endsWith(".js")) {
			const text = ohneKommentare(fs.readFileSync(p, "utf8"));
			// Eine ZUWEISUNG in die Tafel, nicht ein Lesen daraus.
			if (/__featureSourceRefs\s*(\[[^\]]*\]\s*)?=[^=]/.test(text)) {
				schreiber.push(path.relative(REPO, p).replace(/\\/g, "/"));
			}
		}
	}
})(path.join(REPO, "js"));

gleich(schreiber.sort(), ["js/review/review-feature-sources.js", "js/routing/routing.js"],
	"G: genau ZWEI Schreiber -- routing.js legt die Tafel beim Laden der Nutzlast an (dort gilt die "
	+ "Vorgabe), review-feature-sources.js traegt nach und setzt dabei die Marke. Ein dritter "
	+ "umginge den Riegel. Gefunden: " + schreiber.join(", "));

// Und der Nachtrag setzt die Marke wirklich -- sonst waere der Riegel ein Stueck toter Code.
const nachtrag = ohneKommentare(
	fs.readFileSync(path.join(REPO, "js", "review", "review-feature-sources.js"), "utf8"));
pruefe(/__featureSourceRefsNachgetragen\[[^\]]*\]\s*=\s*true/.test(nachtrag),
	"G: der Nachtrag setzt die Marke, an der dieser Riegel haengt");

console.log(`kanon-nachgetragen-riegel.test.js: ${pruefungen} Pruefungen erfuellt`);
