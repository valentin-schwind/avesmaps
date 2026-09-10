// Das Anzeigeprofil der Landschaften (Owner 09.09.2026).
//
// 🔴 EIN PROFIL FUER ALLE FUENF EBENEN. Owner: „auch die sollen in allen landschaftsansichten default
// aktiviert und sichtbar sein." Bis dahin stand hier die Ordnung vom 23.08.2026: „Alle" war die volle
// Karte ohne Kacheln, die vier uebrigen Ebenen waren die „ruhige Zeichenflaeche" (Orte, Wege und
// Grenzen ausdruecklich aus, Untergrund 25 %). Der Unterschied ist aufgehoben -- und mit ihm sind die
// drei Tabellen gefallen, die ihn trugen (ECOSYSTEM_FRONTEND_PROFILES, …_PROFILE_RUHIG,
// ECOSYSTEM_RIVER_KINDS). Was bleibt, prueft diese Datei.
//
// 🔴 NUR DER BESUCHER. Der Editor behaelt in JEDER Ebene seine Haken und seinen Untergrund-Regler --
// dort ist die Ansicht ein Arbeitsplatz. Diese Unterscheidung ist die Begruendung des ganzen Profils
// und bleibt.
// ⚠️ Die FLUESSE stehen seit dem 09.09.2026 MIT im Profil, ihre Reichweite ist aber unveraendert: den
// Haken setzt syncEcosystemRiverVisibility weiterhin fuer BEIDE Rollen (Owner-Entscheid 23.08.2026).
// Was der Umbau geaendert hat, ist der WERT, nicht der Geltungsbereich -- gemessen in
// js/map-features/__tests__/ecosystem-fluesse.test.js.
// ⚠️ Dass die WAHL des Besuchers dieses Profil schlaegt, misst
// js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"), "utf8");

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

function welt({ editor = false, gemerktAlle = "0", ebene = "vegetation", modus = "ecosystem",
	wegeVorher = false, labelsVorher = false, grenzenVorher = false, orteVorher = true,
	kachelnDa = true } = {}) {
	const geschehen = [];
	const haken = {};
	["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers"].forEach((id) => {
		haken[id] = { id, checked: false, listener: [],
			addEventListener(typ, fn) { if (typ === "change") { this.listener.push(fn); } },
			dispatchEvent(ereignis) { this.listener.forEach((fn) => fn(ereignis)); geschehen.push("change:" + id); return true; } };
	});
	haken.togglePaths.checked = wegeVorher;
	haken.toggleMapLabels.checked = labelsVorher;
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
const DAS_PROFIL = { orte: true, wege: true, labels: true, grenzen: true, fluesse: true, untergrund: 0 };

const besucherAlle = welt({ gemerktAlle: "1" });
assert.deepStrictEqual({ ...besucherAlle.context.ecosystemFrontendProfile() }, DAS_PROFIL,
	'🔴 „Alle" im Frontend: alles an, Untergrund auf 0');

const besucherVegetation = welt({ gemerktAlle: "0", ebene: "vegetation" });
assert.deepStrictEqual({ ...besucherVegetation.context.ecosystemFrontendProfile() }, DAS_PROFIL,
	"🔴 und die frueher ruhigen Ebenen bekommen seit dem 09.09.2026 GENAU DASSELBE -- der Unterschied"
	+ " ist aufgehoben, nicht bloss angeglichen (es gibt nur noch ein Profil)");

["derographisch", "topographie", "klima"].forEach((ebene) => {
	assert.strictEqual(welt({ ebene }).context.ecosystemFrontendProfile().orte, true,
		`Ebene ${ebene} zeigt ihre Ortsklassen`);
});

const imEditor = welt({ editor: true, gemerktAlle: "1" });
assert.strictEqual(imEditor.context.ecosystemFrontendProfile(), null,
	'🔴 der EDITOR bekommt kein Profil -- auch nicht in „Alle". Seine Haken und sein Regler bleiben seine');

const woanders = welt({ modus: "deregraphic", gemerktAlle: "1" });
assert.strictEqual(woanders.context.ecosystemFrontendProfile(), null,
	"💣 ausserhalb des Landschaftsmodus gibt es kein Profil -- sonst griffe es in fremde Ansichten");

// ---- 2. Strassen, Beschriftungen und Grenzen ---------------------------------------------------

const anschalten = welt({ gemerktAlle: "1", wegeVorher: false, labelsVorher: false, grenzenVorher: false });
anschalten.context.syncEcosystemFrontendFeatures();
assert.strictEqual(anschalten.haken.togglePaths.checked, true, '„Alle" schaltet die Strassen an');
assert.strictEqual(anschalten.haken.toggleMapLabels.checked, true,
	"🔴 und die Beschriftungen -- der Haken, der bis zum 09.09.2026 gar nicht im Profil stand");
assert.strictEqual(anschalten.haken.toggleTerritoryBorders.checked, true, "und die Grenzen");
assert.ok(anschalten.geschehen.includes("change:togglePaths"),
	"💣 als `change` gemeldet -- ein gesetztes `checked` feuert von selbst keines, und daran haengen "
		+ "die Zeichner (syncPathVisibility, die Grenz-Leinwand)");
assert.ok(anschalten.geschehen.includes("change:toggleMapLabels"), "dito fuer die Beschriftungen");
assert.ok(anschalten.geschehen.includes("change:toggleTerritoryBorders"), "dito fuer die Grenzen");

// 🔴 Und zwar auch in einer der vier Ebenen, die bis zum 09.09.2026 die „ruhige Zeichenflaeche" waren.
// Bis dahin stand hier die Gegenprobe: `ruhig` nahm die Strassen WEG.
const ehemalsRuhig = welt({ gemerktAlle: "0", ebene: "vegetation", wegeVorher: false, grenzenVorher: false });
ehemalsRuhig.context.syncEcosystemFrontendFeatures();
assert.strictEqual(ehemalsRuhig.haken.togglePaths.checked, true,
	"🔴 auch die Vegetationsebene schaltet die Strassen AN -- die ruhige Zeichenflaeche ist gefallen");
assert.strictEqual(ehemalsRuhig.haken.toggleTerritoryBorders.checked, true, "und die Grenzen");

const editorUnberuehrt = welt({ editor: true, gemerktAlle: "1", wegeVorher: false, grenzenVorher: false });
editorUnberuehrt.context.syncEcosystemFrontendFeatures();
assert.strictEqual(editorUnberuehrt.haken.togglePaths.checked, false,
	"🔴 beim Editor wird nichts angefasst");
assert.deepStrictEqual(editorUnberuehrt.geschehen, [], "und auch nichts gemeldet");

// ⚠️ Stimmt die Lage schon, passiert nichts -- diese Funktion laeuft bei jedem Ebenenwechsel, und ein
// blindes Setzen zeichnete jedes Mal ~6000 Wege neu.
const schonRichtig = welt({ gemerktAlle: "1", wegeVorher: true, labelsVorher: true, grenzenVorher: true });
schonRichtig.context.syncEcosystemFrontendFeatures();
assert.deepStrictEqual(schonRichtig.geschehen, [],
	"⚠️ eine Lage, die schon stimmt, loest kein Neuzeichnen aus");

// ---- 3. Die Ortsklassen ------------------------------------------------------------------------
//
// Sie werden seit dem 2026-08-04 GELIEHEN (syncEcosystemSettlementVisibility) und beim Verlassen
// zurueckgegeben. 🔴 Seit dem 09.09.2026 werden sie zusaetzlich aktiv EINGESCHALTET, statt bloss „nicht
// weggenommen" -- fuer „default aktiviert und sichtbar" (Owner) reicht das Nichtstun nicht.

const orteInAlle = welt({ gemerktAlle: "1", orteVorher: true });
orteInAlle.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => orteInAlle.ortsKnoepfe[art].istAn()),
	'🔴 in „Alle" bleiben die Ortsklassen an');

const orteInVegetation = welt({ gemerktAlle: "0", ebene: "vegetation", orteVorher: false });
orteInVegetation.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => orteInVegetation.ortsKnoepfe[art].istAn()),
	"🔴 und in der Vegetationsebene werden sie EINGESCHALTET -- vor dem 09.09.2026 traten sie hier"
	+ " zurueck, und ein blosses „nicht wegnehmen\" haette sie hier gar nicht erst gezeigt");
orteInVegetation.context.syncEcosystemSettlementVisibility(false);
assert.ok(ORTSKLASSEN.every((art) => !orteInVegetation.ortsKnoepfe[art].istAn()),
	"💣 und beim Verlassen steht wieder da, was VORHER war -- das ist die Erinnerung von 2026-08-04,"
	+ " und sie ist von der Wahl in den Landschaften unberuehrt");

const orteImEditor = welt({ editor: true, gemerktAlle: "1", orteVorher: true });
orteImEditor.context.syncEcosystemSettlementVisibility(true);
assert.ok(ORTSKLASSEN.every((art) => !orteImEditor.ortsKnoepfe[art].istAn()),
	'🔴 der Editor bekommt auch in „Alle" die ruhige Zeichenflaeche -- der Zweig, den der Umbau vom'
	+ " 09.09.2026 beinahe verloren haette (kein Profil heisst fuer ihn WEITER „zuruecktreten\","
	+ " nicht „zurueckgeben\")");

// ---- 4. Der Untergrund und die Kacheln ---------------------------------------------------------

const ohneKacheln = welt({ gemerktAlle: "1" });
ohneKacheln.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(ohneKacheln.tilePane.style.opacity, "0", '„Alle" blendet den Untergrund ganz aus');
assert.strictEqual(ohneKacheln.kachelEbene.istAufKarte, false,
	"💣 und die Kachel-Ebene wird von der Karte GENOMMEN -- sonst holt der Browser Bilder, die niemand sieht");

// 🔴 Seit dem 09.09.2026 gilt das in ALLEN fuenf Ebenen; bis dahin behielten die vier ruhigen ihre 25 %
// und ihre Kacheln. ⭐ Nebenbei ein Wegfall von Kachelabrufen in vier von fuenf Ebenen.
const ehemals25 = welt({ gemerktAlle: "0", ebene: "vegetation" });
ehemals25.context.applyEcosystemUndergroundOpacity(true);
assert.strictEqual(ehemals25.tilePane.style.opacity, "0",
	"🔴 auch die Vegetationsebene blendet den Untergrund ganz aus");
assert.strictEqual(ehemals25.kachelEbene.istAufKarte, false, "und haengt ihre Kacheln ab");

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
// (syncEcosystemControlsVisibility) -- ein Wechsel der EBENE liess ihn stehen. Die Zusicherungen oben
// waren dabei alle gruen -- sie rufen die Funktion selbst auf. Deshalb geht dieser Fall durch
// syncEcosystemPaneStates, den einen Weg, den Eintreten, Ebenenwechsel und Verlassen gemeinsam nehmen.
//
// 🔴 Gemessen wird das seit dem 09.09.2026 an den SCHALTERN und nicht mehr am Untergrund: der ist in
// allen fuenf Ebenen 0 und kann einen Unterschied gar nicht mehr zeigen. Die Frage ist dieselbe --
// kommt beim Ebenenwechsel wirklich das ganze Profil an?

const wechsel = welt({ gemerktAlle: "1", wegeVorher: false, labelsVorher: false, grenzenVorher: false,
	orteVorher: false });
wechsel.context.syncEcosystemPaneStates();
assert.strictEqual(wechsel.tilePane.style.opacity, "0", 'Vorbedingung: „Alle" blendet den Untergrund aus');
assert.strictEqual(wechsel.kachelEbene.istAufKarte, false, "Vorbedingung: Kacheln abgehaengt");
assert.strictEqual(wechsel.haken.togglePaths.checked, true, "Vorbedingung: die Wege sind an");

// Jetzt auf eine ehemals ruhige Ebene -- so wie es die Ebenen-Kachel tut. Frueher nahm sie hier alles
// weg; heute bleibt alles stehen, und der Untergrund bleibt bei 0.
wechsel.context.setEcosystemShowAllLayers(false);
assert.strictEqual(wechsel.tilePane.style.opacity, "0",
	"🔴 der Ebenenwechsel laesst den Untergrund bei 0 -- alle fuenf Ebenen tragen denselben Wert");
assert.strictEqual(wechsel.kachelEbene.istAufKarte, false, "und die Kacheln bleiben abgehaengt");
assert.strictEqual(wechsel.haken.togglePaths.checked, true, "die Wege bleiben an");
assert.strictEqual(wechsel.haken.toggleMapLabels.checked, true, "die Beschriftungen auch");
assert.strictEqual(wechsel.haken.toggleTerritoryBorders.checked, true, "die Grenzen auch");
assert.strictEqual(wechsel.haken.toggleRivers.checked, true,
	"🔴 und die Fluesse -- in der Vegetationsebene, in der sie bis zum 09.09.2026 ausgeschaltet wurden");
assert.ok(ORTSKLASSEN.every((art) => wechsel.ortsKnoepfe[art].istAn()),
	"💣 und die sechs Ortsklassen kommen ueber DENSELBEN Trichter mit -- ohne ihn stuenden sie nach"
	+ " einem Ebenenwechsel auf dem Stand von vorher");

// Und wieder zurueck: derselbe Zustand, kein Flackern.
wechsel.context.setEcosystemShowAllLayers(true);
assert.strictEqual(wechsel.tilePane.style.opacity, "0", 'zurueck in „Alle": Untergrund weiter aus');
assert.strictEqual(wechsel.haken.togglePaths.checked, true, "und die Wege weiter an");

console.log("ok - ecosystem-frontend-profil");
