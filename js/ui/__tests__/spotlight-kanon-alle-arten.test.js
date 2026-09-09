"use strict";

// DAS KANON-ETIKETT IM SPOTLIGHT GILT NICHT NUR SIEDLUNGEN.
//
// 🚩 Owner-Meldung 09.09.2026 mit drei Bildern: der Flussweg "Weissbwasser" traegt in seiner Infobox
// "INOFFIZIELL | Briefspiel", in der Suchliste aber nichts -- "nur siedlungen".
//
// 🔴 ZWEI GETRENNTE BEFUNDE, gemessen an der Live-Nutzlast vom 09.09.2026:
//   (a) WEGE fehlten mit BEGRUENDUNG: ein Treffer buendelt die Segmente eines Wegs, Quellen und
//       Kanon haengen je Segment, und ein Etikett aus dem erstbesten waere eine ungepruefte Aussage
//       ueber den ganzen Weg. Die Begruendung ist seit dem Wegquellen-Verteiler (08.09.2026)
//       ueberholt: von 350 mehrteiligen Wegen mit echtem Namen sind 346 EINIG, und die vier
//       "uneinigen" unterscheiden nur (leer) von (kein) -- sichtbar tragen beide nichts.
//       Kraftlinien: 32 mehrteilig, 0 uneinig. Die Pruefung bleibt trotzdem im Code: uneinig heisst
//       KEIN Etikett, dieselbe Regel wie bei avesmapsMapFeaturesWegGruppeErbtZuweisung.
//   (b) LANDSCHAFTEN lasen den FALSCHEN SCHLUESSEL. Seit Schritt 5 des Quellen-Umbaus (03.09.2026)
//       traegt die FLAECHE die Quellen einer gebundenen Beschriftung (`ecosystem:<region>`), nicht
//       mehr das Schild (`region:<label>`). Das Spotlight war damit die vierte Lesart neben
//       avesmapsLabelQuellenSchluessel -- und die falsche: 40 inoffizielle Landschaftsflaechen
//       blieben unsichtbar.
//
// Zahlen der Wirkung (Live-Nutzlast 09.09.2026, inoffizielle Objekte je Art):
//   settlement 434 (wurde gezeigt) | path 150 | ecosystem 40 | citymap 2 | powerline 0

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(REPO, "js", "ui", "spotlight-search.js"), "utf8");

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen += 1; };
// 🪤 Objekte aus einem vm-Kontext tragen einen fremden Object.prototype -- deepStrictEqual faellt
// bei zeichengleichem Inhalt. Flach umkopieren.
const alsHost = (x) => (x && typeof x === "object" ? Object.assign(Array.isArray(x) ? [] : {}, x) : x);
const gleich = (ist, soll, text) => { assert.deepStrictEqual(alsHost(ist), soll, text); pruefungen += 1; };

// Die beiden Funktionen ausschneiden und AUSFUEHREN -- ein Regex kennt keinen Geltungsbereich.
function schneide(name) {
	const ab = quelle.indexOf("function " + name + "(");
	assert.ok(ab > 0, name + " ist auffindbar");
	const rest = quelle.slice(ab);
	// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
	const ende = rest.search(/\r?\n\}/);
	assert.ok(ende > 0, "das Ende von " + name + " ist auffindbar");
	return rest.slice(0, ende + 3);
}

// Die echte Weiche der Beschriftungen -- kein Nachbau.
const weiche = fs.readFileSync(
	path.join(REPO, "js", "map-features", "label-quellen-schluessel.js"), "utf8");

function fahre(kanonTafel) {
	const kontext = {
		module: { exports: {} },
		window: {},
		// Der Aufloeser, wie ihn popups.js im Browser bereitstellt.
		resolveFeatureKanon: (typ, id) => kanonTafel[typ + ":" + id] || null,
	};
	vm.createContext(kontext);
	vm.runInContext(weiche, kontext);
	vm.runInContext(
		schneide("spotlightEntryKanonRef") + "\n" + schneide("spotlightEinigerKanonRef")
		+ "\nmodule.exports = spotlightEntryKanonRef;",
		kontext
	);
	return kontext.module.exports;
}

const LEER = {};

// ---- A: die Siedlung, wie bisher ----------------------------------------------------------------
let ref = fahre(LEER);
gleich(ref({ kind: "location", publicIds: ["ort-1"] }), ["settlement", "ort-1"],
	"A: die Siedlung bleibt unveraendert");

// ---- B: die GEBUNDENE Beschriftung liest ihre FLAECHE --------------------------------------------
gleich(
	ref({ kind: "label", publicIds: ["label-1"], labelEntry: { label: {
		publicId: "label-1", ecosystemRegionPublicId: "flaeche-1",
	} } }),
	["ecosystem", "flaeche-1"],
	"B: eine gebundene Beschriftung liest ihre FLAECHE -- seit Schritt 5 des Quellen-Umbaus traegt "
	+ "die Flaeche die Quellen, und das Spotlight war die vierte, falsche Lesart");

// ---- C: die FREIE Beschriftung bleibt bei ihrem eigenen Schluessel -------------------------------
gleich(
	ref({ kind: "label", publicIds: ["label-2"], labelEntry: { label: { publicId: "label-2" } } }),
	["region", "label-2"],
	"C: eine freie Beschriftung liest weiter sich selbst");

// ---- D: der Weg -- EINIGE Segmente ergeben ein Etikett -------------------------------------------
ref = fahre({
	"path:weg-a": { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"path:weg-b": { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"path:weg-c": { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
});
gleich(ref({ kind: "path", publicIds: ["weg-a", "weg-b", "weg-c"] }), ["path", "weg-a"],
	"D: sind alle Segmente einig, steht das Etikett fuer den ganzen Weg -- der gemeldete Fall "
	+ "(Weissbwasser, Flussweg, INOFFIZIELL | Briefspiel)");

// ---- E: UNEINIGE Segmente ergeben KEINS ----------------------------------------------------------
ref = fahre({
	"path:weg-a": { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"path:weg-b": { kanon: "offiziell" },
});
pruefe(ref({ kind: "path", publicIds: ["weg-a", "weg-b"] }) === null,
	"E: uneinige Segmente ergeben KEIN Etikett -- eine Aussage ueber den ganzen Weg, die niemand "
	+ "geprueft hat, waere schlimmer als keine (dieselbe Regel wie bei der Zuweisungs-Erbschaft)");

// Und der feinere Fall: gleicher Zustand, VERSCHIEDENER Bezeichner.
ref = fahre({
	"path:weg-a": { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
	"path:weg-b": { kanon: "inoffiziell", bezeichner_type: "regionalspielhilfe" },
});
pruefe(ref({ kind: "path", publicIds: ["weg-a", "weg-b"] }) === null,
	"E: auch ein verschiedener BEZEICHNER macht uneinig -- nicht nur der Zustand");

// ---- F: ein Segment MIT und eines OHNE Etikett ist uneinig ---------------------------------------
ref = fahre({ "path:weg-a": { kanon: "inoffiziell" } });
pruefe(ref({ kind: "path", publicIds: ["weg-a", "weg-b"] }) === null,
	"F: 'hat eins' gegen 'hat keins' ist auch uneinig");

// ---- G: gar kein Etikett an allen Segmenten -> der Schluessel darf trotzdem kommen ---------------
// Der Renderer entscheidet dann selbst, dass nichts zu zeigen ist; hier ist die Frage nur, WELCHER
// Schluessel gilt. Ein `null` waere zwar auch richtig, aber es verschoebe die Entscheidung.
ref = fahre(LEER);
gleich(ref({ kind: "path", publicIds: ["weg-a", "weg-b"] }), ["path", "weg-a"],
	"G: einig ohne Etikett ist einig -- der Renderer zeigt dann nichts");

// ---- H: die Kraftlinie folgt derselben Regel ------------------------------------------------------
ref = fahre({
	"powerline:kl-a": { kanon: "inoffiziell" },
	"powerline:kl-b": { kanon: "inoffiziell" },
});
gleich(ref({ kind: "powerline", publicIds: ["kl-a", "kl-b"] }), ["powerline", "kl-a"],
	"H: die Kraftlinie buendelt ebenso ihre Segmente und wird ebenso geprueft");

// ---- I: die Stadtkarte ----------------------------------------------------------------------------
ref = fahre(LEER);
gleich(ref({ kind: "citymap", publicIds: ["karte-1"] }), ["citymap", "karte-1"],
	"I: die Stadtkarte traegt ihren eigenen Schluessel");

// ---- J: das Herrschaftsgebiet nimmt die TERRITORIUMS-Id, nicht publicIds[0] ------------------------
gleich(
	ref({ kind: "region", publicIds: ["flaeche-x"], regionEntry: { territoryPublicId: "terr-1" } }),
	["territory", "terr-1"],
	"J: das Herrschaftsgebiet traegt ZWEI public_id -- die Quellen haengen an der des Territoriums");
pruefe(ref({ kind: "region", publicIds: ["flaeche-x"], regionEntry: {} }) === null,
	"J: ohne Territoriums-Id kein Schluessel");

// ---- K: die Arten OHNE Kanon-Leser bekommen weiterhin nichts --------------------------------------
// ⚠️ Literatur, Vorkommen und Off-Map-Treffer kennt AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE
// nicht; ein Schluessel fuer sie waere eine Aussage, die der Server nie beantwortet.
for (const art of ["adventure", "lore", "offmap"]) {
	pruefe(ref({ kind: art, publicIds: ["x-1"] }) === null,
		"K: '" + art + "' hat keinen Kanon-Leser und bekommt keinen Schluessel");
}

// ---- L: leere Eingaben werfen nicht ----------------------------------------------------------------
pruefe(ref({ kind: "path", publicIds: [] }) === null, "L: ein Weg ohne Segmente ergibt nichts");
pruefe(ref({ kind: "location", publicIds: [] }) === null, "L: eine Siedlung ohne Id ergibt nichts");
pruefe(ref({ kind: "label", publicIds: [], labelEntry: null }) === null,
	"L: eine Beschriftung ohne Daten ergibt nichts");

// ---- M: die Weiche wird WIRKLICH gerufen, nicht nachgebaut -----------------------------------------
// 💣 Ein Nachbau waere die fuenfte Lesart derselben Frage -- genau das, wogegen
// js/map-features/label-quellen-schluessel.js gebaut wurde.
const block = schneide("spotlightEntryKanonRef");
pruefe(block.includes("avesmapsLabelQuellenSchluessel"),
	"M: der label-Zweig ruft die EINE Weiche");
pruefe(!/ecosystemRegionPublicId|ecosystem_region_public_id/.test(block),
	"M: und baut sie nicht nach");

console.log(`spotlight-kanon-alle-arten.test.js: ${pruefungen} Pruefungen erfuellt`);
