// Das Ansichtsprofil je Landschafts-Ebene (Owner 23.08.2026).
//
// 🔴 „Alle" IST IM FRONTEND DIE VOLLE KARTE OHNE KACHELN. Owner woertlich: „in ‚Alle' im frontend
// koennen siedlungen normal angezeigt werden, strassen normal angezeigt werden, grenzen normal
// angezeigt werden, die transparenz fuer den untergrund kann auf 0 -- sprich du brauchst auch keine
// tiles nachladen (aber nur im frontend modus)."
//
// 🔴 NUR DER BESUCHER. Der Editor behaelt in JEDER Ebene seine Haken und seinen Untergrund-Regler --
// dort ist die Ansicht ein Arbeitsplatz.
// ⚠️ Die FLUESSE gehoeren NICHT in dieses Profil: ihre Regel gilt fuer beide Rollen (Owner-Entscheid
// vom selben Tag, syncEcosystemRiverVisibility). Zwei Reichweiten in einer Tabelle waeren eine Zeile,
// die fuer die Haelfte der Leser falsch ist.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"), "utf8");

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

function welt({ editor = false, gemerktAlle = "0", ebene = "vegetation", modus = "ecosystem",
	wegeVorher = false, grenzenVorher = false, orteVorher = true, kachelnDa = true } = {}) {
	const geschehen = [];
	const haken = {};
	["togglePaths", "toggleTerritoryBorders", "toggleRivers"].forEach((id) => {
		haken[id] = { id, checked: false, listener: [],
			addEventListener(typ, fn) { if (typ === "change") { this.listener.push(fn); } },
			dispatchEvent() { this.listener.forEach((fn) => fn()); geschehen.push("change:" + id); return true; } };
	});
	haken.togglePaths.checked = wegeVorher;
	haken.toggleTerritoryBorders.checked = grenzenVorher;

	const ortsKnoepfe = {};
	ORTSKLASSEN.forEach((art) => {
		const aktiv = { an: orteVorher };
		ortsKnoepfe[art] = {
			hasClass: () => aktiv.an,
			removeClass: () => { aktiv.an = false; },
			toggleClass: (_k, an) => { aktiv.an = Boolean(an); },
			istAn: () => aktiv.an,
		};
	});

	const tilePane = { style: {} };
	const container = { style: {} };
	const kachelEbene = { istAufKarte: kachelnDa, bringToBack() { geschehen.push("kacheln-nach-hinten"); } };

	const context = {
		console,
		Map,
		Set,
		Array,
		Number,
		String,
		Boolean,
		Object,
		Math,
		Event: class { constructor(typ) { this.type = typ; } },
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: {
			documentElement: {},
			getElementById: (id) => haken[id] || null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getComputedStyle: () => ({ getPropertyValue: () => "#f0e6d2" }),
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: editor,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie", "klima"],
		ECOSYSTEM_KIND_PANES: {},
		LOCATION_TYPE_VISIBILITY_ORDER: ORTSKLASSEN,
		getLocationToggleButton: (art) => ortsKnoepfe[art],
		syncLocationMarkerVisibility: () => geschehen.push("marker-neu"),
		syncLocationToggleButtons: () => {},
		syncPathVisibility: () => geschehen.push("wege-neu"),
		baseTileLayer: kachelEbene,
		map: {
			getPane: (name) => (name === "tilePane" ? tilePane : null),
			getContainer: () => container,
			hasLayer: (l) => l === kachelEbene && kachelEbene.istAufKarte,
			removeLayer: (l) => { if (l === kachelEbene) { kachelEbene.istAufKarte = false; geschehen.push("kacheln-weg"); } },
			addLayer: (l) => { if (l === kachelEbene) { kachelEbene.istAufKarte = true; geschehen.push("kacheln-zurueck"); } },
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	return { context, haken, ortsKnoepfe, geschehen, kachelEbene, tilePane };
}

// ---- 1. Wer bekommt ueberhaupt ein Profil ------------------------------------------------------

// 🪤 Ausgebreitet verglichen: ein Objekt aus der vm-Sandkiste traegt deren Object.prototype, und
// deepStrictEqual vergleicht den mit. Gleiche Werte, fremder Prototyp -- der Fehler liest sich dann wie
// ein echter Unterschied (die beiden Seiten stehen identisch untereinander).
const besucherAlle = welt({ gemerktAlle: "1" });
assert.deepStrictEqual({ ...besucherAlle.context.ecosystemFrontendProfile() },
	{ orte: true, wege: true, grenzen: true, untergrund: 0 },
	'🔴 „Alle" im Frontend: Siedlungen, Strassen und Grenzen an, Untergrund auf 0');

const besucherVegetation = welt({ gemerktAlle: "0", ebene: "vegetation" });
assert.deepStrictEqual({ ...besucherVegetation.context.ecosystemFrontendProfile() },
	{ orte: false, wege: false, grenzen: false, untergrund: 25 },
	"die uebrigen Ebenen bleiben die ruhige Zeichenflaeche");

["derographisch", "topographie", "klima"].forEach((ebene) => {
	assert.strictEqual(welt({ ebene }).context.ecosystemFrontendProfile().orte, false,
		`Ebene ${ebene} zeigt keine Ortsklassen`);
});

const imEditor = welt({ editor: true, gemerktAlle: "1" });
assert.strictEqual(imEditor.context.ecosystemFrontendProfile(), null,
	'🔴 der EDITOR bekommt kein Profil -- auch nicht in „Alle". Seine Haken und sein Regler bleiben seine');

const woanders = welt({ modus: "deregraphic", gemerktAlle: "1" });
assert.strictEqual(woanders.context.ecosystemFrontendProfile(), null,
	"💣 ausserhalb des Landschaftsmodus gibt es kein Profil -- sonst griffe es in fremde Ansichten");

// ---- 2. Strassen und Grenzen -------------------------------------------------------------------

const anschalten = welt({ gemerktAlle: "1", wegeVorher: false, grenzenVorher: false });
anschalten.context.syncEcosystemFrontendFeatures();
assert.strictEqual(anschalten.haken.togglePaths.checked, true, '„Alle" schaltet die Strassen an');
assert.strictEqual(anschalten.haken.toggleTerritoryBorders.checked, true, "und die Grenzen");
assert.ok(anschalten.geschehen.includes("change:togglePaths"),
	"💣 als `change` gemeldet -- ein gesetztes `checked` feuert von selbst keines, und daran haengen "
		+ "die Zeichner (syncPathVisibility, die Grenz-Leinwand)");
assert.ok(anschalten.geschehen.includes("change:toggleTerritoryBorders"), "dito fuer die Grenzen");

const ruhig = welt({ gemerktAlle: "0", ebene: "vegetation", wegeVorher: true, grenzenVorher: true });
ruhig.context.syncEcosystemFrontendFeatures();
assert.strictEqual(ruhig.haken.togglePaths.checked, false, "eine ruhige Ebene nimmt die Strassen weg");
assert.strictEqual(ruhig.haken.toggleTerritoryBorders.checked, false, "und die Grenzen");

const editorUnberuehrt = welt({ editor: true, gemerktAlle: "1", wegeVorher: false, grenzenVorher: false });
editorUnberuehrt.context.syncEcosystemFrontendFeatures();
assert.strictEqual(editorUnberuehrt.haken.togglePaths.checked, false,
	"🔴 beim Editor wird nichts angefasst");
assert.deepStrictEqual(editorUnberuehrt.geschehen, [], "und auch nichts gemeldet");

// ⚠️ Stimmt die Lage schon, passiert nichts -- diese Funktion laeuft bei jedem Ebenenwechsel, und ein
// blindes Setzen zeichnete jedes Mal ~6000 Wege neu.
const schonRichtig = welt({ gemerktAlle: "1", wegeVorher: true, grenzenVorher: true });
schonRichtig.context.syncEcosystemFrontendFeatures();
assert.deepStrictEqual(schonRichtig.geschehen, [],
	"⚠️ eine Lage, die schon stimmt, loest kein Neuzeichnen aus");

// ---- 3. Die Ortsklassen ------------------------------------------------------------------------
//
// Sie werden seit dem 2026-08-04 GELIEHEN (syncEcosystemSettlementVisibility) und beim Verlassen
// zurueckgegeben. Neu ist nur: in „Alle" gibt die Ebene sie schon INNERHALB des Modus zurueck.

const orteInAlle = welt({ gemerktAlle: "1", orteVorher: true });
orteInAlle.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => orteInAlle.ortsKnoepfe[art].istAn()),
	'🔴 in „Alle" bleiben die Ortsklassen an');

const orteInVegetation = welt({ gemerktAlle: "0", ebene: "vegetation", orteVorher: true });
orteInVegetation.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => !orteInVegetation.ortsKnoepfe[art].istAn()),
	"in einer ruhigen Ebene treten sie zurueck");
orteInVegetation.context.syncEcosystemSettlementVisibility(false);
assert.ok(ORTSKLASSEN.every((art) => orteInVegetation.ortsKnoepfe[art].istAn()),
	"💣 und beim Verlassen kommen sie zurueck -- das ist die Erinnerung von 2026-08-04");

const orteImEditor = welt({ editor: true, gemerktAlle: "1", orteVorher: true });
orteImEditor.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => !orteImEditor.ortsKnoepfe[art].istAn()),
	'🔴 der Editor bekommt auch in „Alle" die ruhige Zeichenflaeche');

// ---- 4. Der Untergrund und die Kacheln ---------------------------------------------------------

const ohneKacheln = welt({ gemerktAlle: "1" });
ohneKacheln.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(ohneKacheln.tilePane.style.opacity, "0", '„Alle" blendet den Untergrund ganz aus');
assert.strictEqual(ohneKacheln.kachelEbene.istAufKarte, false,
	"💣 und die Kachel-Ebene wird von der Karte GENOMMEN -- sonst holt der Browser Bilder, die niemand sieht");

const mitKacheln = welt({ gemerktAlle: "0", ebene: "vegetation" });
mitKacheln.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(mitKacheln.tilePane.style.opacity, "0.25", "die ruhigen Ebenen behalten ihre 25 %");
assert.strictEqual(mitKacheln.kachelEbene.istAufKarte, true, "und ihre Kacheln");

// Der Weg zurueck: erst weg, dann wieder da.
const zurueck = welt({ gemerktAlle: "1" });
zurueck.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(zurueck.kachelEbene.istAufKarte, false, "Vorbedingung: Kacheln weg");
zurueck.context.applyEcosystemUndergroundOpacity(false);
assert.strictEqual(zurueck.kachelEbene.istAufKarte, true,
	"🔴 beim Verlassen des Modus sind die Kacheln wieder da");
assert.ok(zurueck.geschehen.includes("kacheln-nach-hinten"),
	"⚠️ und wieder GANZ HINTEN -- sonst laegen sie ueber den Landschaftsflaechen");

// 💣 Was die Ebene nicht selbst weggenommen hat, holt sie auch nicht zurueck. Der Editor kann die
// Kacheln ueber `mapstyle=none` abschalten; die dabei entstehende Lage gehoert ihm, nicht uns.
const fremdAbgeschaltet = welt({ gemerktAlle: "0", ebene: "vegetation", kachelnDa: false });
fremdAbgeschaltet.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(fremdAbgeschaltet.kachelEbene.istAufKarte, false,
	"💣 fremd abgeschaltete Kacheln bleiben abgeschaltet");
fremdAbgeschaltet.context.applyEcosystemUndergroundOpacity(false);
assert.strictEqual(fremdAbgeschaltet.kachelEbene.istAufKarte, false,
	"💣 auch beim Verlassen -- zurueckgegeben wird nur, was diese Ebene selbst genommen hat");

// Der Editor behaelt seinen Regler und seine Kacheln.
const editorUntergrund = welt({ editor: true, gemerktAlle: "1" });
editorUntergrund.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(editorUntergrund.kachelEbene.istAufKarte, true,
	'🔴 dem Editor werden die Kacheln auch in „Alle" nicht genommen -- er zeichnet darauf');

// ---- 5. Und der EBENENWECHSEL zieht das alles nach ----------------------------------------------
//
// 💣 DIE VERDRAHTUNG, NICHT NUR DIE REGEL. Der Untergrund hing bis 23.08.2026 allein am MODUS-Wechsel
// (syncEcosystemControlsVisibility) -- ein Wechsel der EBENE liess ihn stehen. Im Browser gemessen:
// von „Alle" nach Vegetation blieb der Untergrund auf 0 und die Kacheln abgehaengt, obwohl das Profil
// dieser Ebene 25 % vorschreibt. Die Zusicherungen oben waren dabei alle gruen -- sie rufen die
// Funktion selbst auf. Deshalb geht dieser Fall durch syncEcosystemPaneStates, den einen Weg, den
// Eintreten, Ebenenwechsel und Verlassen gemeinsam nehmen.

const wechsel = welt({ gemerktAlle: "1" });
wechsel.context.syncEcosystemPaneStates();
assert.strictEqual(wechsel.tilePane.style.opacity, "0", 'Vorbedingung: „Alle" blendet den Untergrund aus');
assert.strictEqual(wechsel.kachelEbene.istAufKarte, false, "Vorbedingung: Kacheln abgehaengt");

// Jetzt auf eine ruhige Ebene -- so wie es die Ebenen-Kachel tut.
wechsel.context.setEcosystemShowAllLayers(false);
assert.strictEqual(wechsel.tilePane.style.opacity, "0.25",
	"💣 der Ebenenwechsel muss den Untergrund nachziehen -- sonst bleibt die ruhige Ebene ohne Grund leer");
assert.strictEqual(wechsel.kachelEbene.istAufKarte, true,
	"💣 und die Kacheln zurueckholen");

// Und wieder zurueck.
wechsel.context.setEcosystemShowAllLayers(true);
assert.strictEqual(wechsel.tilePane.style.opacity, "0", 'zurueck in „Alle": Untergrund wieder aus');
assert.strictEqual(wechsel.kachelEbene.istAufKarte, false, "und die Kacheln wieder abgehaengt");

console.log("ok - ecosystem-frontend-profil");
