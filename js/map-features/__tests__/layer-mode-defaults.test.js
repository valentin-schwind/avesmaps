// Was zeigt ein Kartenmodus VON SICH AUS? Die Antwort muss unabhaengig davon sein, aus welchem Modus
// man kommt -- und genau das war sie nicht.
//
// 🔴 DER GEMELDETE FEHLER (Owner 2026-08-05): „Standard → Landschaften" zeigte Strassen, „Nur Karte →
// Landschaften" nicht. Ursache war keine Landschaften-Eigenheit, sondern eine Luecke in der Weiche von
// applyFrontendLayerModeDefaults: sie kannte nur none/original/deregraphic/powerlines und stieg fuer
// „ecosystem" und „political" aus, ohne einen einzigen Schalter zu setzen. Beide erbten damit die
// Schalterlage ihres Vorgaengers.
//
// 💣 DESHALB PRUEFT DIESER TEST JEDEN MODUS AUS ZWEI VERSCHIEDENEN VORLAGEN. Ein Test, der nur „in
// Landschaften sind die Wege aus" behauptet, waere aus der Standardansicht heraus gruen gewesen und
// haette den Fehler nicht gesehen -- er zeigte sich ja nur im Unterschied zwischen zwei Wegen zum
// selben Ziel. Wer hier einen Modus ergaenzt, traegt ihn in ERWARTUNG ein; fehlt er, faellt er wieder
// durch die Weiche und erbt.
//
// js/map-features/ wird als blankes <script> geladen; deshalb dieselbe vm-Bauart wie die Nachbartests.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-display-mode.js"), "utf8");

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

// Eine frische Welt je Fall. `vorlage` ist die Schalterlage VOR dem Wechsel -- also der Modus, aus dem
// der Nutzer kommt.
function welt({ editor = false, wege = false, fluesse = false, flussnamen = false, orte = false } = {}) {
	const werte = {
		"#togglePaths": wege,
		"#toggleRivers": fluesse,
		"#toggleSeaPaths": false,
		"#toggleMapLabels": false,
		"#toggleTerritoryBorders": false,
		"#toggleNodix": false,
		"#mapLayerModeSelect": "deregraphic",
	};
	const ortsklassen = {};
	ORTSKLASSEN.forEach((typ) => { ortsklassen[typ] = orte; });
	// Merkt sich, OB jemand die Ortsklassen angefasst hat -- nicht nur, welchen Wert sie danach haben.
	// Fuer Kraftlinien und Landschaften ist genau das die Frage: sie duerfen sie nicht anfassen.
	let ortsklassenGeschrieben = false;

	const $ = (selektor) => ({
		prop(name, wert) {
			if (wert === undefined) { return werte[selektor]; }
			werte[selektor] = !!wert;
			return this;
		},
		is() { return !!werte[selektor]; },
		val(wert) {
			if (wert === undefined) { return werte[selektor]; }
			werte[selektor] = String(wert);
			return this;
		},
	});
	$.each = (liste, rueckruf) => { (liste || []).forEach((eintrag, index) => rueckruf(index, eintrag)); };

	const context = {
		console,
		window: {},
		document: { body: null, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) },
		$,
		IS_EDIT_MODE: editor,
		DEFAULT_PLANNER_STATE: { mapLayerMode: "deregraphic" },
		MAP_LABEL_MODES: ["deregraphic", "ecosystem"],
		BOUNDARY_OVERLAY_MODES: ["political", "deregraphic"],
		LOCATION_TYPE_VISIBILITY_ORDER: ORTSKLASSEN,
		getLocationToggleButton: (typ) => ({
			toggleClass(klasse, an) { ortsklassenGeschrieben = true; ortsklassen[typ] = !!an; return this; },
			hasClass() { return !!ortsklassen[typ]; },
		}),
		syncLocationToggleButtons: () => {},
		syncLocationMarkerVisibility: () => {},
		syncTransportControl: () => {},
		setMapStyle: () => {},
		syncRegionVisibility: () => {},
		syncEcosystemVisibility: () => {},
		syncLabelVisibility: () => {},
		syncPowerlineVisibility: () => {},
		syncPlannerStateToUrl: () => {},
		// Die Fluss-/Seeweg-Beschriftungen haengen an diesem Paar (map-features-path-labels.js). Es steht
		// hier im Kontext, weil die zu pruefende Zuweisung sonst hinter `typeof … !== "undefined"` still
		// uebersprungen wuerde -- der Test haette dann nie gemessen, was er zu messen vorgibt.
		pathRiverLabelsOverridden: false,
		pathRiverLabelsVisible: flussnamen,
		pathLayers: [],
		pathData: [],
		map: {
			getZoom: () => 3,
			getBounds: () => ({ pad: () => ({ intersects: () => true }) }),
			getContainer: () => null,
			hasLayer: () => false,
			addLayer: () => {},
			removeLayer: () => {},
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);

	return {
		context,
		wechsleZu(modus) {
			// Genau die Reihenfolge des change-Handlers in map-features.js: erst den Modus setzen, dann
			// die Vorgaben des ZIELmodus -- die Vorgaben haben das letzte Wort.
			context.setSelectedMapLayerMode(modus);
			context.applyFrontendLayerModeDefaults(modus);
		},
		lage() {
			return {
				modus: werte["#mapLayerModeSelect"],
				wege: !!werte["#togglePaths"],
				fluesse: !!werte["#toggleRivers"],
				flussnamen: !!context.pathRiverLabelsVisible,
				orte: ORTSKLASSEN.filter((typ) => ortsklassen[typ]).length,
				ortsklassenGeschrieben,
			};
		},
	};
}

// Die beiden Vorlagen sind bewusst maximal verschieden: „aus Standard" (alles an) gegen „aus Nur Karte"
// (alles aus). Was aus beiden gleich herauskommt, haengt nicht mehr am Vorgaenger.
const AUS_STANDARD = { wege: true, fluesse: false, flussnamen: true, orte: true };
const AUS_NUR_KARTE = { wege: false, fluesse: false, flussnamen: false, orte: false };

// `orte: null` heisst „dieser Modus fasst die Ortsklassen NICHT an":
//  - powerlines zeigt ohnehin nur Nodices (shouldShowLocationMarker), ein Eingriff waere folgenlos;
//  - ecosystem blendet sie ueber seine eigene Erinnerung aus (syncEcosystemSettlementVisibility) und
//    gibt sie beim Verlassen zurueck. Wer hier eingreift, vergiftet deren Schnappschuss.
const ERWARTUNG = {
	none:        { wege: false, flussnamen: false, orte: 0 },
	original:    { wege: false, flussnamen: false, orte: 0 },
	deregraphic: { wege: true,  flussnamen: true,  orte: 6 },
	// 🔴 Owner 2026-08-05: Strassen sind in „Politisch" fest AUS. Vorher erbten sie.
	political:   { wege: false, flussnamen: true,  orte: 0 },
	powerlines:  { wege: false, flussnamen: false, orte: null },
	// 🔴 Owner 2026-08-05: „in der Landschaften-Ansicht keine Strassen". Die Flussnamen bleiben auf
	// ausdrueckliche Entscheidung STEHEN -- aber fest, nicht geerbt.
	ecosystem:   { wege: false, flussnamen: true,  orte: null },
};

Object.keys(ERWARTUNG).forEach((modus) => {
	const erwartet = ERWARTUNG[modus];

	const vonStandard = welt(AUS_STANDARD);
	vonStandard.wechsleZu(modus);
	const a = vonStandard.lage();

	const vonNurKarte = welt(AUS_NUR_KARTE);
	vonNurKarte.wechsleZu(modus);
	const b = vonNurKarte.lage();

	assert(a.modus === modus && b.modus === modus, `${modus}: der Modus kommt ueberhaupt an`);

	// 💣 Der Kern: dasselbe Ziel, zwei Herkuenfte, EIN Bild.
	assert(a.wege === b.wege,
		`${modus}: Wege haengen nicht davon ab, woher man kommt (aus Standard ${a.wege}, aus Nur Karte ${b.wege})`);
	assert(a.flussnamen === b.flussnamen,
		`${modus}: Flussnamen haengen nicht davon ab, woher man kommt (aus Standard ${a.flussnamen}, aus Nur Karte ${b.flussnamen})`);
	// ⚠️ NUR fuer Modi, die die Ortsklassen selbst setzen. Wo sie bewusst unberuehrt bleiben (`orte: null`),
	// ist ein Unterschied zwischen den beiden Vorlagen kein Fehler, sondern die Bauart: powerlines zeigt
	// ohnehin nur Nodices, und in ecosystem blendet die Ebene sie selbst aus. Fuer die beiden ist
	// „nicht angefasst" weiter unten die schaerfere Zusicherung.
	if (erwartet.orte !== null) {
		assert(a.orte === b.orte,
			`${modus}: Ortsklassen haengen nicht davon ab, woher man kommt (aus Standard ${a.orte}, aus Nur Karte ${b.orte})`);
	}

	assert(a.wege === erwartet.wege, `${modus}: Wege sind ${erwartet.wege ? "an" : "aus"} (waren ${a.wege})`);
	assert(a.flussnamen === erwartet.flussnamen, `${modus}: Flussnamen sind ${erwartet.flussnamen ? "an" : "aus"} (waren ${a.flussnamen})`);
	// Die Fluss-PFADE sind im Frontend in jedem Modus aus -- der Haken ist dort nicht einmal sichtbar.
	assert(a.fluesse === false, `${modus}: Fluss-Pfade bleiben aus`);

	if (erwartet.orte === null) {
		assert(a.ortsklassenGeschrieben === false && b.ortsklassenGeschrieben === false,
			`${modus}: fasst die Ortsklassen NICHT an -- das erledigt die Ebene selbst`);
	} else {
		assert(a.orte === erwartet.orte, `${modus}: ${erwartet.orte} Ortsklassen sichtbar (waren ${a.orte})`);
	}
});

// ---- Editmodus: die Ortsklassen gehoeren dort dem Editor ---------------------------------------------
// 💣 setSelectedMapLayerMode raeumte beim Betreten von „Landschaften" die Ortsklassen selbst weg. Das sah
// richtig aus (die Ebene will eine leere Flaeche), zerstoerte aber den Schnappschuss von
// syncEcosystemSettlementVisibility: die Erinnerung schnappt DANACH zu und merkte sich „alles aus".
// Nach dem Verlassen blieben die Ortsklassen in JEDEM Zielmodus aus -- genau der Fall, vor dem der
// Kommentar in map-features-ecosystem-layer-switch.js warnt. Ausblenden ist Sache der Ebene, nicht des
// Moduswechsels.
const imEditor = welt({ editor: true, orte: true, wege: true });
imEditor.context.setSelectedMapLayerMode("ecosystem");
assert(imEditor.lage().ortsklassenGeschrieben === false,
	"💣 Editmodus/Landschaften: der Moduswechsel fasst die Ortsklassen NICHT an (sonst vergiftet er die Erinnerung der Ebene)");
assert(imEditor.lage().wege === false,
	"Editmodus/Landschaften: die Wege gehen aus -- das bleibt Sache des Moduswechsels");

if (failures > 0) {
	console.error(`layer-mode-defaults.test.js: ${failures} Zusicherung(en) fehlgeschlagen`);
	process.exit(1);
}
console.log("layer-mode-defaults.test.js: all assertions passed");
