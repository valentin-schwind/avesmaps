"use strict";

// DER CLIENT-NACHTRAG SCHREIBT BEIDE TAFELN.
//
// 🚩 Owner-Meldung 09.09.2026, mit Bild: die Landschaftsflaeche „Schwanenbruch" trug am Kopf
// OFFIZIELL, waehrend darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel" stand.
// syncFeatureSourcesToClientCache schrieb die VERWEISE in den Kartenspeicher und liess die
// Kanon-Tafel unberuehrt; resolveFeatureKanon (js/ui/popups.js) liest „Verweise da + keine
// Abweichung" als Vorgabe „offiziell". Im Browser reproduziert: mit Tafeleintrag „Inoffiziell │
// Briefspiel", ohne ihn „Offiziell".
//
// 🔴 Es ist dieselbe Klasse wie Lizenz, Namensnennung und Korpusschluessel vor ihm: wer dem
// Kartenspeicher ein Feld gibt, gibt es diesem Nachtrag mit. Das vierte Mal in dieser Funktion.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..", "..");
const modul = require(path.join(REPO, "js", "review", "review-feature-sources.js"));
const sync = modul.syncFeatureSourcesToClientCache;
assert.strictEqual(typeof sync, "function", "der Nachtrag ist erreichbar");

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen += 1; };
const gleich = (ist, soll, text) => { assert.deepStrictEqual(ist, soll, text); pruefungen += 1; };

function frischesFenster() {
	return {
		__sourceCatalog: {},
		__sourceCorpora: {},
		__featureSourceRefs: {},
		__featureKanon: { vorgabe: "offiziell", abweichungen: {} },
	};
}
const QUELLE_INOFF = {
	source_id: 1, url: "https://www.garetien.de/index.php/Garetien:Schwanenbruch",
	label: "Schwanenbruch auf garetien.de", official: false, type: "briefspiel",
};
const QUELLE_OFF = {
	source_id: 2, url: "https://ulisses.de/geographia", label: "Geographia Aventurica",
	official: true, type: "regionalspielhilfe",
};

// ---- A: ein mitgeliefertes Etikett wird GESETZT ------------------------------------------------
let w = frischesFenster();
global.window = w;
sync("ecosystem", "eco-A", [QUELLE_INOFF], null,
	{ "eco-A": { kanon: "inoffiziell", bezeichner_type: "briefspiel" } });
gleich(w.__featureKanon.abweichungen["ecosystem:eco-A"], { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"A: das mitgelieferte Etikett steht in der Tafel -- der gemeldete Fall");
pruefe(w.__featureSourceRefs["ecosystem:eco-A"].length === 1, "A: der Verweis steht auch da");

// ---- B: `null` LOESCHT den Eintrag --------------------------------------------------------------
// Ein Objekt, dessen letzte kanonrelevante Quelle entfernt wurde, hat KEIN Etikett mehr. Bliebe der
// alte stehen, behauptete der Kopf eine Herkunft, die die Liste darunter nicht mehr deckt.
w = frischesFenster();
w.__featureKanon.abweichungen["settlement:ort-B"] = { kanon: "inoffiziell" };
global.window = w;
sync("settlement", "ort-B", [QUELLE_OFF], null, { "ort-B": null });
pruefe(!("settlement:ort-B" in w.__featureKanon.abweichungen),
	"B: `null` loescht den Eintrag, statt ihn stehenzulassen");

// ---- C: `[kanon: '']` ist etwas ANDERES als `null` und wird GESETZT -----------------------------
// „Nachgesehen, kein Etikett" (etwa: die einzige Quelle ist eine Publikation). Der Kopf zeigt nichts,
// aber die Auskunft ist ausdruecklich da -- so unterscheidet sie sich von „nicht gefragt".
w = frischesFenster();
global.window = w;
sync("settlement", "ort-C", [QUELLE_OFF], null, { "ort-C": { kanon: "" } });
gleich(w.__featureKanon.abweichungen["settlement:ort-C"], { kanon: "" },
	"C: der ausdrueckliche Leer-Eintrag wird gesetzt, nicht als Nichts behandelt");

// ---- D: ein FEHLENDER Schluessel laesst die Tafel in Ruhe ---------------------------------------
w = frischesFenster();
w.__featureKanon.abweichungen["settlement:ort-D"] = { kanon: "inoffiziell" };
global.window = w;
sync("settlement", "ort-D", [QUELLE_INOFF], null, { "ein-anderer": null });
gleich(w.__featureKanon.abweichungen["settlement:ort-D"], { kanon: "inoffiziell" },
	"D: was nicht genannt ist, wird nicht angefasst -- 'nicht gefragt' ist nicht 'kein Etikett'");

// ---- E: `by_entity` -- jede Kennung bekommt IHR Etikett und IHRE Verweise -----------------------
w = frischesFenster();
global.window = w;
sync("path", "weg-1", [QUELLE_INOFF],
	{ "weg-1": [{ source_id: 1 }], "weg-2": [{ source_id: 1 }] },
	{ "weg-1": { kanon: "inoffiziell" }, "weg-2": { kanon: "offiziell" } });
gleich(w.__featureKanon.abweichungen["path:weg-1"], { kanon: "inoffiziell" }, "E: weg-1 bekommt seins");
gleich(w.__featureKanon.abweichungen["path:weg-2"], { kanon: "offiziell" }, "E: weg-2 bekommt seins");
pruefe(Array.isArray(w.__featureSourceRefs["path:weg-2"]),
	"E: die by_entity-Weiche schreibt weiterhin JE Kennung -- nie die Vereinigung an alle "
	+ "(eine Quelle an 12 von 56 Abschnitten stuende sonst ploetzlich an allen 56)");
pruefe(!("path:weg-1" in w.__featureSourceRefs) || w.__featureSourceRefs["path:weg-1"].length === 1,
	"E: und der Anker bekommt nicht zusaetzlich die volle Liste");

// ---- F: DIE MARKE, an der der Riegel in popups.js haengt ----------------------------------------
w = frischesFenster();
global.window = w;
sync("ecosystem", "eco-F", [QUELLE_INOFF]);
pruefe(w.__featureSourceRefsNachgetragen["ecosystem:eco-F"] === true,
	"F: ein nachgetragener Schluessel ist markiert -- daran erkennt resolveFeatureKanon, dass die "
	+ "Vorgabe 'offiziell' fuer ihn nicht gilt");
pruefe(!("ecosystem:eco-F" in w.__featureKanon.abweichungen),
	"F: ohne mitgeliefertes Etikett wird NICHTS in die Kanon-Tafel geschrieben");

// Und sie wird auch auf dem by_entity-Weg gesetzt -- sonst umginge genau der den Riegel.
w = frischesFenster();
global.window = w;
sync("path", "weg-1", [QUELLE_INOFF], { "weg-1": [{ source_id: 1 }], "weg-2": [{ source_id: 1 }] });
pruefe(w.__featureSourceRefsNachgetragen["path:weg-1"] === true
	&& w.__featureSourceRefsNachgetragen["path:weg-2"] === true,
	"F: die Marke gilt BEIDEN Wegen -- der frueher hier stehende `return` der by_entity-Weiche "
	+ "haette den Tafel-Teil sonst uebersprungen");

// ---- G: ein Fenster ohne Kanon-Tafel bekommt eine, statt zu werfen -------------------------------
w = { __sourceCatalog: {}, __sourceCorpora: {}, __featureSourceRefs: {} };
global.window = w;
sync("ecosystem", "eco-G", [QUELLE_INOFF], null, { "eco-G": { kanon: "inoffiziell" } });
gleich(w.__featureKanon.abweichungen["ecosystem:eco-G"], { kanon: "inoffiziell" },
	"G: eine fehlende Tafel wird angelegt -- der Nachtrag laeuft auch vor dem ersten Kartenladen");

// ---- H: die Aufrufwege reichen das Woerterbuch wirklich durch ------------------------------------
// 🪤 Kommentare heraus, sonst schlaegt die Pruefung an der Warnung an, die vor dem Muster warnt.
function ohneKommentare(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const editorCode = ohneKommentare(
	fs.readFileSync(path.join(REPO, "js", "review", "review-feature-sources.js"), "utf8"));
const importerCode = ohneKommentare(
	fs.readFileSync(path.join(REPO, "js", "review", "review-garetien-importer.js"), "utf8"));

let geprueft = 0;
for (const treffer of editorCode.split("syncFeatureSourcesToClientCache(").slice(1)) {
	const args = treffer.slice(0, treffer.indexOf(")"));
	if (args.startsWith("entityType, entityPublicId, editorSources")) { continue; }  // die Definition
	if (args.trim() === "") { continue; }                                            // window.… = …
	pruefe(/kanon/i.test(args),
		"H: jeder Aufruf reicht das Kanon-Woerterbuch durch -- sonst faellt genau dieser Weg auf den "
		+ "Riegel zurueck und zeigt gar kein Etikett. Gefunden: " + args);
	geprueft += 1;
}
pruefe(geprueft === 2, "H: beide Aufrufwege des Editors sind geprueft (gefunden: " + geprueft + ")");

const importerAufruf = importerCode.slice(importerCode.indexOf("abgleich(eintrag"));
pruefe(/kanon/i.test(importerAufruf.slice(0, importerAufruf.indexOf(";"))),
	"H: die Garetien-Uebernahme reicht ihr `kanon` durch -- sie ist der Weg, ueber den der "
	+ "gemeldete Fall lief");

console.log(`kanon-nachtrag-tafel.test.js: ${pruefungen} Pruefungen erfuellt`);
