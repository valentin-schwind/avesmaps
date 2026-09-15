// Owner 15.09.2026: „Bei dem Feld "Art" in Darstellung (unter Ort) wär es gut, wenn man was eintippen kann und
// er automatisch vorschläge macht … das feld braucht nicht erscheinen, wenn die Art keinen effekt hat".
//
// 🔴 DAS GETEILTE BAUTEIL (js/ui/place-kind-autocomplete.js), nicht eine zweite Liste -- und die Regel, wo die
// Art gilt, ist die des Dialogs „Ort bearbeiten" (LOCATION_EDIT_PLACE_KIND_SIZE).
//
// Ausführen: node js/review/__tests__/garetien-ortsart-vorschlaege.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter, macheElement } = require("./helfer/garetien-testumgebung.js");

const { api, ELEMENTE } = ladeImporter(["garetien-detailcol"]);
const WURZEL = path.join(__dirname, "..", "..", "..");
let n = 0;
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was + " -- ist: " + JSON.stringify(ist)); }
function pruefe(b, was) { n++; assert.ok(b, was); }

// --- 1. Die Regel ist die des Dialogs ------------------------------------------------------------------------------
const dialog = fs.readFileSync(path.join(WURZEL, "js", "review", "review-locations.js"), "utf8");
const konstante = dialog.match(/const LOCATION_EDIT_PLACE_KIND_SIZE = "([^"]+)";/);
pruefe(konstante !== null, "der Dialog trägt seine Konstante");
gleich(konstante[1], "gebaeude",
	"🔴 der Rückfall des Importers ist der Wert des Dialogs -- ändert sich einer, fällt dieser Test um");
pruefe(api.garetienOrtsartGilt("gebaeude") === true, "an „Besondere Bauwerke/Stätten“ gilt die Art");
["dorf", "kleinstadt", "stadt", "grossstadt", "metropole", "stadtviertel", ""].forEach(function (klasse) {
	pruefe(api.garetienOrtsartGilt(klasse) === false, "an „" + klasse + "“ gilt sie nicht");
});
global.LOCATION_EDIT_PLACE_KIND_SIZE = "stadtviertel";
pruefe(api.garetienOrtsartGilt("stadtviertel") === true && api.garetienOrtsartGilt("gebaeude") === false,
	"💣 im Browser liest er die KONSTANTE des Dialogs, nicht seinen Rückfall");
delete global.LOCATION_EDIT_PLACE_KIND_SIZE;

// --- 2. Das Feld steht nur, wo die Art gilt ----------------------------------------------------------------------
const bau = {
	key: "ggp:Bauwerke:Bruecke:Garetien:Steinbruecke", stand: "offen", urteil: "neu", name: "Steinbrücke",
	typ: "Brücke", ziel: "location", subtyp: "gebaeude", kind: "",
	items: [{ id: 31, change_type: "new", anlass: "", felder: ["quelle"] }],
};
const dorf = Object.assign({}, bau, { key: "ggp:Siedlungen:Dorf:Garetien:Tannweiler", name: "Tannweiler", typ: "Dorf", subtyp: "dorf" });
pruefe(api.garetienEingefuegtWirdOrtMarkup(bau, "gebaeude", false).includes('data-gi-feld="placeKind"'),
	"am Bauwerk steht das Feld „Art“");
const mDorf = api.garetienEingefuegtWirdOrtMarkup(dorf, "dorf", false);
pruefe(!mDorf.includes('data-gi-feld="placeKind"'), "🔴 am Dorf steht es nicht: " + mDorf);
pruefe(mDorf.includes('data-gi-feld="isRuined"'), "Zeuge: die übrigen Ort-Felder stehen weiter da");

// --- 3. Was reist --------------------------------------------------------------------------------------------------
api.garetienEingabenZustandZu(bau).placeKind = "Brücke";
api.garetienEingabenZustandZu(dorf).placeKind = "Brücke";
gleich(api.garetienEingabenFuerServer(bau).place_kind, "Brücke", "am Bauwerk reist die Art");
gleich(api.garetienEingabenFuerServer(dorf).place_kind, "", "⚠️ am Dorf reist eine liegengebliebene Art als „keine“");
api.garetienEingabenZustandZu(bau).placeKind = "";

// --- 4. Das Einhängen ----------------------------------------------------------------------------------------------
const aufrufe = [];
let abgehaengt = 0;
global.window.attachPlaceKindAutocomplete = function (feld, opts) {
	aufrufe.push({ feld: feld, opts: opts });
	return function () { abgehaengt++; };
};
function feldAttrappe(gesperrt) {
	const feld = macheElement("placekind");
	feld.type = "text";
	feld.disabled = Boolean(gesperrt);
	feld.getAttribute = function (name) { return name === "data-gi-feld" ? "placeKind" : null; };
	feld.hasAttribute = function (name) { return name === "data-gi-feld"; };
	return feld;
}
function spalteMit(feld) {
	return { querySelector: function (sel) { return sel === 'input[data-gi-feld="placeKind"]' ? feld : null; } };
}
const f1 = feldAttrappe(false);
pruefe(api.garetienOrtsartVorschlaegeEinhaengen(spalteMit(f1), [bau]) === true, "das geteilte Bauteil wird eingehängt");
pruefe(aufrufe.length === 1 && aufrufe[0].feld === f1, "…an genau dieses Feld");
api.garetienOrtsartVorschlaegeEinhaengen(spalteMit(feldAttrappe(false)), [bau]);
gleich(abgehaengt, 1, "💣 vor dem zweiten Einhängen wird das erste abgehängt");
pruefe(api.garetienOrtsartVorschlaegeEinhaengen(spalteMit(null), [dorf]) === false && abgehaengt === 2,
	"…auch wenn danach gar kein Feld mehr dasteht (ein Dorf)");
pruefe(api.garetienOrtsartVorschlaegeEinhaengen(spalteMit(feldAttrappe(true)), [bau]) === false,
	"ein gesperrtes Feld bekommt keine Liste");
const bauteil = global.window.attachPlaceKindAutocomplete;
delete global.window.attachPlaceKindAutocomplete;
pruefe(api.garetienOrtsartVorschlaegeEinhaengen(spalteMit(feldAttrappe(false)), [bau]) === false,
	"ohne das Bauteil bleibt es ein Textfeld");
global.window.attachPlaceKindAutocomplete = bauteil;

// --- 5. Über die Einzelansicht: eingehängt nach dem Zeichnen, die Wahl liegt im Zustand ----------------------------
api.garetienZielWahlVergessen();
api.avesmapsGaretienStageLeeren();
api.avesmapsGaretienStageHinzufuegen([bau]);
const feldWahl = feldAttrappe(false);
ELEMENTE["garetien-detailcol"].querySelector = function (sel) {
	return sel === 'input[data-gi-feld="placeKind"]' ? feldWahl : null;
};
global.fetch = function () { return new Promise(function () {}); };
aufrufe.length = 0;
let fehler = null;
try { api.garetienDetailWaehlen(bau.key, [bau]); } catch (e) { fehler = e; }
pruefe(aufrufe.length === 1 && aufrufe[0].feld === feldWahl,
	"🔴 garetienDetailRendern hängt die Liste nach jedem Zeichnen ein: " + aufrufe.length + " " + (fehler && fehler.stack));
feldWahl.value = "Brücke";
aufrufe[0].opts.onPick({ kind: "Brücke", count: 3 });
gleich(api.garetienEingabenZustandZu(bau).placeKind, "Brücke", "🔴 eine gewählte Art liegt im Zustand");
gleich(api.garetienEingabenFuerServer(bau).place_kind, "Brücke", "…und reist an den Server");

// --- 6. Reihenfolge und Ladereihenfolge ------------------------------------------------------------------------------
const quelle = fs.readFileSync(path.join(WURZEL, "js", "review", "review-garetien-importer.js"), "utf8")
	.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const start = quelle.indexOf("function garetienDetailRendern(");
const rumpf = quelle.slice(start, quelle.indexOf("\n\t}\n", start));
const posMarkup = rumpf.indexOf("spalte.innerHTML = garetienDetailMarkup(");
const posEinhaengen = rumpf.indexOf("garetienOrtsartVorschlaegeEinhaengen(spalte, liste)");
pruefe(start !== -1 && posMarkup !== -1 && posEinhaengen > posMarkup,
	"💣 eingehängt wird NACH dem Einfügen des Markups -- vorher gäbe es das Feld noch nicht");
const html = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
const posBauteil = html.indexOf('<script src="js/ui/place-kind-autocomplete.js"></script>');
const posImporter = html.indexOf('<script src="js/review/review-garetien-importer.js"></script>');
pruefe(posBauteil !== -1 && posImporter !== -1 && posBauteil < posImporter,
	"das Bauteil ist geladen, bevor der Importer zeichnet");
const bauteilQuelle = fs.readFileSync(path.join(WURZEL, "js", "ui", "place-kind-autocomplete.js"), "utf8");
pruefe(bauteilQuelle.includes("window.attachPlaceKindAutocomplete = attachPlaceKindAutocomplete"),
	"…und hängt sich an `window`, wo der Importer es sucht");

api.avesmapsGaretienStageLeeren();
console.log("OK -- garetien-ortsart-vorschlaege: " + n + " Zusicherungen");
