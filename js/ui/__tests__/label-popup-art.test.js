// Die ART im Kopf des Label-Menues -- und warum sie NICHT aus dem Formularfeld kommen darf.
//
// 💣 DER BEFUND (Owner 02.09.2026, „im floating menü steht n anderer regionstyp (Berggipfel) wie in
// der infobox"): das Label „Greifenhorn" traegt `feature_subtype = berggipfel` und keine
// Wiki-Zuweisung. Die Infobox sagte richtig „Berggipfel", das schwebende Menue daneben „Region".
//
// 🔴 DIE URSACHE IST GETEILTER FORMULARZUSTAND, keine zweite Tabelle. `labelPopupSubtitle` schlug
// die Bezeichnung im LIVE-DOM von `#label-edit-type` nach -- und das ist kein Vokabular, sondern das
// Auswahlfeld zweier Dialoge. `applyLabelTypeVocabulary` (js/review/review-labels.js) ersetzt seinen
// Inhalt durch das Vokabular der EBENE, an der das zuletzt geoeffnete Label bzw. die zuletzt
// geoeffnete Flaeche haengt. Live nachgestellt am 02.09.2026: vor dem ersten Dialog 36 Optionen und
// „Berggipfel", nach EINEM Vegetations-Dialog 7 Optionen und „Region" -- fuer Berggipfel, Vulkan,
// Kontinent und alle uebrigen Arten dieser Ebene gleichzeitig.
//
// 💣 UND GIPFEL TRIFFT ES IMMER: `berggipfel` und `vulkan` stehen in KEINER Ebene des Vokabulars
// (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED) -- sie sind Punkte, keine Flaechen, genau wie der Kommentar
// ueber `istGipfel` in popups.js es begruendet. Fuer sie gibt es kein Ebenen-Vokabular, in dem sie
// wieder auftauchen koennten.
//
// ⭐ Die geteilte Tabelle dafuer gibt es seit dem 28.08.2026: `avesmapsLabelArtName`
// (js/ui/label-arten.js). Ihr eigener Kopf nennt labelPopupSubtitle als Grund, warum sie das
// Auswahlfeld zeichengleich spiegelt -- umgestellt wurde die Funktion damals nur nicht. Infobox
// (map-features-labels.js), Spotlight (spotlight-search.js) und Garetien-Importer lasen die Tabelle
// bereits; dies war der letzte Leser des Live-DOM. Dieselbe Frage, vier Erzeuger, einer scherte aus.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/label-popup-art.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

// Nur die eine Funktion -- der Rest der Datei braucht Karte, Leaflet und das ganze Popup-Geruest.
// 💣 Ueber die KLAMMERN geschnitten, nicht bis zum naechsten „\n}": ein solcher Schnitt endet an der
// ersten Zeile, die mit einer schliessenden Klammer beginnt, und ein spaeter eingefuegter Block
// wuerde den halben Rumpf lautlos wegwerfen -- der Test bliebe gruen und pruefte nichts mehr.
// ⚠️ Damit ist er zugleich zeilenendenneutral: hier CRLF, im Deploy-Tor LF.
function schneideFunktion(quelle, name) {
	const anfang = quelle.indexOf("function " + name);
	assert.notStrictEqual(anfang, -1, name + " gibt es noch");
	let tiefe = 0;
	let gesehen = false;
	for (let i = quelle.indexOf("{", anfang); i < quelle.length; i += 1) {
		if (quelle[i] === "{") {
			tiefe += 1;
			gesehen = true;
		} else if (quelle[i] === "}") {
			tiefe -= 1;
		}
		if (gesehen && tiefe === 0) {
			return quelle.slice(anfang, i + 1);
		}
	}
	throw new Error(name + ": keine schliessende Klammer gefunden");
}

// Das Auswahlfeld, wie es nach einem Vegetations-Dialog wirklich dasteht (live gemessen 02.09.2026).
// Es ist hier ein SPION: was die Funktion daraus liest, ist der Fehler -- und dass sie es ueberhaupt
// anfasst, ebenso.
function macheKontext({ sprache = null } = {}) {
	const eingedampft = new Map([
		["region", "— keine Vegetation —"],
		["wald", "Wald"],
		["urwald", "Urwald"],
		["suempfe_moore", "Sümpfe und Moore"],
	]);
	const spion = { abfragen: [] };
	const context = {
		console,
		document: {
			querySelector(selektor) {
				spion.abfragen.push(selektor);
				const treffer = String(selektor).match(/value="([^"]*)"/);
				const wert = treffer ? treffer[1] : "";
				return eingedampft.has(wert) ? { textContent: eingedampft.get(wert) } : null;
			},
		},
		// Wie im Haus: der Schluessel gewinnt, wenn es ihn gibt -- sonst der deutsche Rueckfall.
		tr: (schluessel, rueckfall) => (sprache && sprache[schluessel]) || rueckfall,
		countEcosystemRegionLabels: () => 1,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js", "ui", "label-arten.js"), context);
	vm.runInContext(schneideFunktion(lies("js", "ui", "popups.js"), "labelPopupSubtitle"), context);
	return { untertitel: context.labelPopupSubtitle, spion };
}

// ---- A) der gemeldete Fall ---------------------------------------------------------------------

{
	const { untertitel } = macheKontext();
	assert.strictEqual(untertitel({ labelType: "berggipfel" }, null), "Berggipfel",
		"💣 DER KERN: Greifenhorn ist ein Berggipfel -- auch nachdem ein Vegetations-Dialog das "
		+ "Auswahlfeld eingedampft hat");
	assert.strictEqual(untertitel({ labelType: "vulkan" }, null), "Vulkan",
		"derselbe Fall, zweiter Punkt-Subtyp: `vulkan` steht in keinem Ebenen-Vokabular");
	assert.strictEqual(untertitel({ labelType: "kontinent" }, null), "Kontinent",
		"⚠️ es traf nicht nur die Gipfel -- jede Art ausserhalb der geladenen Ebene fiel auf „Region“");
}

// ---- B) das Formularfeld wird gar nicht mehr gefragt --------------------------------------------
//
// 🔴 DIE EIGENTLICHE REGEL. Ein richtiges Ergebnis allein genuegt nicht: solange die Funktion das
// Auswahlfeld liest, haengt ihre Antwort am zuletzt geoeffneten Dialog, und der naechste
// Ebenen-Umbau bricht sie wieder. Gefragt wird die Tabelle, nicht das DOM.

{
	const { untertitel, spion } = macheKontext();
	untertitel({ labelType: "berggipfel" }, null);
	untertitel({ labelType: "wald" }, { public_id: "r1", area_count: 2 });
	assert.deepStrictEqual(spion.abfragen, [],
		"🔴 labelPopupSubtitle fasst `#label-edit-type` nicht mehr an -- ein Formularfeld ist kein Vokabular");
}

// ---- C) der Rueckfall bleibt --------------------------------------------------------------------
//
// ⚠️ Die geteilte Tabelle traegt NUR das Vokabular, nie die Rueckfall-Politik (so ihr eigener Kopf).
// Hier muss etwas dastehen: ein leerer Untertitel liest sich wie ein Fehler.

{
	const { untertitel } = macheKontext();
	assert.strictEqual(untertitel({ labelType: "eine_art_die_es_nicht_gibt" }, null), "Region",
		"eine unbekannte Art faellt weiterhin auf „Region“");
	assert.strictEqual(untertitel({ labelType: "" }, null), "Region", "und eine leere ebenso");
	assert.strictEqual(untertitel({}, null), "Region", "und eine fehlende ebenso");
}

// ---- D) „Region" ist die ART, nicht der Platzhalter ----------------------------------------------
//
// 💣 Der zweite Ausfluss desselben Fehlers: im Ebenen-Vokabular traegt der Wert `region` die
// Beschriftung „— keine Vegetation —" (labelEmptyTypeLabel). Aus dem Formularfeld gelesen stand die
// im Menuekopf -- eine Formularbeschriftung, die im Kopf eines Popups nichts zu suchen hat.

{
	const { untertitel } = macheKontext();
	const wort = untertitel({ labelType: "region" }, null);
	assert.strictEqual(wort, "Region", "der neutrale Subtyp heisst „Region“");
	assert.ok(!wort.includes("keine"),
		"💣 und nie „— keine Vegetation —“ -- das ist der Platzhalter des Formulars");
}

// ---- E) uebersetzt wird ueber DENSELBEN Schluessel wie Infobox und Spotlight ---------------------
//
// ⚠️ `spotlight.labelType.<art>` -- alle 36 Arten stehen in js/app/i18n-en.js. Zwei verschiedene
// Woerter fuer dieselbe Aussage waeren hier lautlos.

{
	const { untertitel } = macheKontext({ sprache: { "spotlight.labelType.berggipfel": "Peak" } });
	assert.strictEqual(untertitel({ labelType: "berggipfel" }, null), "Peak",
		"unter ?lang=en steht dasselbe Wort wie in der Infobox");
}

const i18n = lies("js", "app", "i18n-en.js");
["berggipfel", "vulkan", "region", "kontinent"].forEach((art) => {
	assert.ok(i18n.includes('"spotlight.labelType.' + art + '"'),
		"der i18n-Schluessel fuer " + art + " steht bereit -- sonst faellt die englische Fassung "
		+ "auf das deutsche Wort");
});

// ---- F) die Zaehlung bleibt unberuehrt -----------------------------------------------------------
//
// Regression gegen label-popup-flaechenzahl.test.js: die Kategorie ist nur der erste Teil der Zeile.

{
	const { untertitel } = macheKontext();
	assert.strictEqual(untertitel({ labelType: "berggipfel" }, { public_id: "r1", area_count: 1 }),
		"Berggipfel · 1 Fläche, 1 Label", "Kategorie und Zaehlung stehen zusammen");
	assert.strictEqual(untertitel({ labelType: "berggipfel" }, { public_id: "r1" }),
		"Berggipfel · 1 Label", "💣 „unbekannt ist nicht null“ gilt weiter");
}

// ---- G) dieselbe Frage, dieselbe Quelle wie die Infobox -------------------------------------------
//
// 🔴 Der Wachposten gegen die naechste Abschrift: beide lesen `avesmapsLabelArtName`. Fuer ein Label
// OHNE Wiki-Zuweisung -- der gemeldete Fall -- antworten sie damit zeichengleich. (MIT Wiki-Zuweisung
// duerfen sie auseinandergehen, und das ist gewollt: die Infobox nennt dort die feinere Wiki-Art.)

{
	const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	const labelsQuelle = ohneKommentare(lies("js", "map-features", "map-features-labels.js"));
	assert.ok(labelsQuelle.includes("avesmapsLabelArtName(label.labelType)"),
		"die Infobox liest die geteilte Tabelle");
	const popupsQuelle = ohneKommentare(lies("js", "ui", "popups.js"));
	assert.ok(popupsQuelle.includes("avesmapsLabelArtName("),
		"und das Label-Menue seit heute auch");
	assert.ok(!popupsQuelle.includes("#label-edit-type"),
		"🔴 und niemand in popups.js mehr das Auswahlfeld");

	// Die Ladereihenfolge ist die Zusage dahinter: label-arten.js VOR popups.js.
		// 💣 OHNE KOMMENTARE gelesen: ein Dateipfad in einem <!-- --> ist fuer `indexOf` ein
	// frueheres script-Tag. Das dreht eine Reihenfolgepruefung um (falsch ROT) und macht eine
	// Vorhandenseinspruefung falsch GRUEN. Am 02.09.2026 genau so passiert.
	const indexHtml = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	const artenAb = indexHtml.indexOf("js/ui/label-arten.js");
	const popupsAb = indexHtml.indexOf("js/ui/popups.js");
	assert.ok(artenAb !== -1 && popupsAb !== -1 && artenAb < popupsAb,
		"💣 label-arten.js laedt VOR popups.js -- sonst ist die Tabelle beim ersten Popup noch nicht da");
}

console.log("label-popup-art.test.js: OK");
