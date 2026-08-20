// Fall #82: "Editor-Modus: Originalkarte laesst sich nicht zurueckschalten."
//
// 🔴 DER GEMELDETE FEHLER (Tigersprung, 19.08.2026): wer im Editor einmal auf die Ansicht
// "Original" geschaltet hatte, sass fuer den Rest der Sitzung auf der alten Basiskarte. Die
// UEBERLAGERUNGEN schalteten weiter brav mit (Politisch, Landschaften) -- nur der Kachel-Grund
// nicht. Genau dieser Unterschied ist die Fundstelle: die Ueberlagerungen haengen an den
// sync*-Aufrufen, die Basiskarte an setMapStyle.
//
// 💣 URSACHE: setSelectedMapLayerMode SCHRIEB die Basis beim Betreten ("old"), aber der Zweig, der
// sie zurueckgibt, hing an `!IS_EDIT_MODE`. Im Editor gab es also einen Hin- und keinen Rueckweg.
// Der Kommentar daneben begruendete das mit "im Edit-Modus bleibt eine manuell gewaehlte Basis
// unangetastet" -- ein Schutz, den das Betreten selbst gar nicht einhielt: es ueberschrieb die
// manuelle Wahl unbedingt. Halb geschuetzt ist nicht geschuetzt, es ist eine Einbahnstrasse.
//
// ⚠️ DESHALB PRUEFT DIESER TEST BEIDE RICHTUNGEN UND BEIDE WELTEN. Ein Test, der nur "Original
// setzt old" behauptet, war die ganze Zeit gruen. Und einer, der nur das Frontend faehrt, auch:
// dort lief der Rueckweg seit jeher.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/original-basiskarte-zurueck.test.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-display-mode.js"), "utf8");

let fehler = 0;
function pruefe(bedingung, text) {
	if (!bedingung) {
		console.error("FAIL: " + text);
		fehler += 1;
	}
}

// Eine frische Welt je Fall. `startBasis` ist die Basiskarte VOR dem ersten Ansichtswechsel -- im
// Editor ist das die von Hand gewaehlte bzw. die aus dem localStorage wiederhergestellte.
function welt({ editor = false, startBasis = "stylized" } = {}) {
	const werte = {
		"#togglePaths": true,
		"#toggleRivers": false,
		"#toggleSeaPaths": false,
		"#toggleMapLabels": false,
		"#toggleTerritoryBorders": false,
		"#toggleNodix": false,
		"#mapLayerModeSelect": "deregraphic",
	};
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

	const stilRufe = [];
	const context = {
		console,
		window: {},
		document: { body: null, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) },
		$,
		IS_EDIT_MODE: editor,
		DEFAULT_PLANNER_STATE: { mapLayerMode: "deregraphic" },
		MAP_LABEL_MODES: ["deregraphic", "ecosystem"],
		BOUNDARY_OVERLAY_MODES: ["political", "deregraphic"],
		LOCATION_TYPE_VISIBILITY_ORDER: ["metropole"],
		getLocationToggleButton: () => ({ toggleClass() { return this; }, hasClass() { return false; } }),
		syncLocationToggleButtons: () => {},
		syncLocationMarkerVisibility: () => {},
		syncTransportControl: () => {},
		syncRegionVisibility: () => {},
		syncEcosystemVisibility: () => {},
		syncLabelVisibility: () => {},
		syncPowerlineVisibility: () => {},
		syncPlannerStateToUrl: () => {},
		activeMapStyle: startBasis,
		// Attrappe von setMapStyle (js/app/bootstrap.js) -- MIT seinem No-op-Riegel, weil genau der
		// die Begruendung des alten Kommentars trug ("daher unbedingt sicher"). Sie schreibt
		// `activeMapStyle` fort, denn das ist die Groesse, die der Rueckweg liest.
		setMapStyle(stil) {
			stilRufe.push(stil);
			if (stil === context.activeMapStyle) { return; }
			context.activeMapStyle = stil;
		},
		pathRiverLabelsOverridden: false,
		pathRiverLabelsVisible: true,
		pathLayers: [],
		pathData: [],
		map: {
			getZoom: () => 3,
			getBounds: () => ({ pad: () => ({ intersects: () => true }) }),
			getContainer: () => ({ style: {} }),
			hasLayer: () => false,
			addLayer: () => {},
			removeLayer: () => {},
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);

	return {
		context,
		stilRufe,
		wechsleZu(modus) { context.setSelectedMapLayerMode(modus); },
		// Das Gegenstueck zum Anzeige-Menue: der Editor waehlt die Basis VON HAND
		// ($("#mapStyleSelect").on("change") in js/map-features/map-features.js).
		waehleBasisVonHand(stil) {
			if (typeof context.vergissBasisVorOriginal === "function") {
				context.vergissBasisVorOriginal();
			}
			context.setMapStyle(stil);
		},
		basis() { return context.activeMapStyle; },
	};
}

// ---- 1. Der gemeldete Handgriff: Original -> zurueck, in BEIDEN Welten ----------------------------
//
// 💣 Die fuenf Zielmodi einzeln, jeder aus einer frischen Welt. Gebuendelt ("einmal nach Original,
// dann durch alle fuenf") waere die erste Rueckkehr die einzige gepruefte -- die uebrigen liefen
// dann schon auf einer geheilten Basis und koennten gar nicht mehr scheitern.
[false, true].forEach((editor) => {
	const wo = editor ? "Editor" : "Frontend";
	["deregraphic", "political", "powerlines", "ecosystem", "none"].forEach((ziel) => {
		const w = welt({ editor });
		w.wechsleZu("original");
		pruefe(w.basis() === "old", `${wo}/${ziel}: "Original" zeigt die alte Basiskarte`);
		w.wechsleZu(ziel);
		pruefe(w.basis() === "stylized",
			`💣 ${wo}: "Original" -> "${ziel}" gibt die Basiskarte zurueck (war "${w.basis()}").`
			+ " Genau das war Fall #82: die Ueberlagerungen schalteten, der Kachel-Grund nicht.");
	});
});

// ---- 2. Und wieder hin: der Weg muss beliebig oft gehen -------------------------------------------
{
	const w = welt({ editor: true });
	for (let runde = 1; runde <= 3; runde += 1) {
		w.wechsleZu("original");
		pruefe(w.basis() === "old", `Editor: Runde ${runde} -- "Original" schaltet hin`);
		w.wechsleZu("deregraphic");
		pruefe(w.basis() === "stylized", `Editor: Runde ${runde} -- und wieder zurueck`);
	}
}

// ---- 3. Eine von Hand gewaehlte Basis bleibt unangetastet -----------------------------------------
//
// 🔴 Das ist die Zusicherung, die der alte Kommentar versprach und der alte Code nur zur Haelfte
// hielt. Sie gilt in DREI Lagen, und alle drei sind hier festgenagelt -- ein Rueckweg, der einfach
// "immer stylized" zurueckgibt, faellt an jeder einzelnen durch.
{
	// (a) Die Basis stand schon vor dem Ansichtswechsel auf "old" (der Editor hat sie im
	//     Anzeige-Menue selbst so gestellt). Dann gibt es nichts zurueckzugeben.
	const a = welt({ editor: true, startBasis: "old" });
	a.wechsleZu("original");
	a.wechsleZu("deregraphic");
	pruefe(a.basis() === "old",
		"💣 Editor: eine SCHON von Hand gewaehlte Originalbasis ueberlebt den Ausflug in die Ansicht"
		+ " \"Original\" -- die Ansicht hat sie nicht ueberschrieben, also gibt sie auch nichts zurueck");

	// (b) Die Basis wird waehrend der Ansicht "Original" von Hand umgestellt. Ab da ist die
	//     Handwahl die Wahrheit, die gemerkte Vorgaengerin ist Geschichte.
	const b = welt({ editor: true });
	b.wechsleZu("original");
	b.waehleBasisVonHand("old");
	b.wechsleZu("deregraphic");
	pruefe(b.basis() === "old",
		"💣 Editor: eine WAEHREND der Ansicht \"Original\" von Hand gewaehlte Basis ueberlebt das"
		+ " Verlassen -- sonst legt der Rueckweg die gemerkte Vorgaengerin darueber");

	// (b2) ZWEIMAL "Original" hintereinander. Das ist kein Kunstfall: `restorePlannerState`
	//      (map-features-layer-state.js) ruft den Setzer beim Laden, und ein geteilter Link mit
	//      ?mapLayerMode=original landet auf demselben Modus, auf dem die Sitzung schon steht.
	// 💣 Beim zweiten Betreten liegt "old" bereits -- wer dann blind merkt, merkt sich "old" und
	//    gibt beim Verlassen die Originalkarte "zurueck". Der Rueckweg waere gruen und wirkungslos:
	//    genau der Fehler von vorher, nur einen Aufruf tiefer versteckt.
	const b2 = welt({ editor: true });
	b2.wechsleZu("original");
	b2.wechsleZu("original");
	b2.wechsleZu("deregraphic");
	pruefe(b2.basis() === "stylized",
		"💣 Editor: zweimal \"Original\" hintereinander vergisst die gemerkte Basis NICHT -- gemerkt"
		+ " wird nur, was die Ansicht wirklich ueberschreibt, nicht was sie selbst hingelegt hat");

	// (c) Der leere Untergrund ("none", js/ui/route-planner-toggle.js). Er ist keine andere
	//     Kachelmenge, sondern gar keine -- und er muss genauso zurueckkommen.
	const c = welt({ editor: true, startBasis: "none" });
	c.wechsleZu("original");
	pruefe(c.basis() === "old", "Editor/none: \"Original\" schaltet auch von der leeren Basis aus hin");
	c.wechsleZu("deregraphic");
	pruefe(c.basis() === "none",
		"💣 Editor: der leere Untergrund kommt zurueck, nicht \"stylized\" -- ein Rueckweg, der die"
		+ " Basis erraet statt sie zu merken, macht hier aus \"None\" eine gemalte Karte");
}

// ---- 4. Das Frontend bleibt Zeile fuer Zeile, wie es war ------------------------------------------
//
// ⚠️ Die Reparatur ist EDITOR-ONLY. Im Frontend zwingt jeder Nicht-Original-Modus weiter unbedingt
// auf "stylized" -- auch aus einer Lage heraus, die der Editor-Zweig respektieren wuerde. Wer das
// zusammenlegt, aendert das Bild fuer jeden Besucher, und das sieht der Owner einzeln (§9).
{
	const f = welt({ editor: false, startBasis: "old" });
	f.wechsleZu("deregraphic");
	pruefe(f.basis() === "stylized",
		"Frontend: ein Nicht-Original-Modus zwingt weiter unbedingt auf \"stylized\" -- unveraendert");
	pruefe(f.stilRufe[0] === "stylized",
		"...und zwar ueber setMapStyle, nicht ueber eine gemerkte Basis");
}

// ---- 5. Der Wechsel fasst die Basis NUR wegen "Original" an ---------------------------------------
//
// 💣 Im Editor darf ein Wechsel zwischen zwei Nicht-Original-Ansichten die Basis gar nicht
// beruehren -- weder schreiben noch zurueckgeben. Sonst raeumt der erste Klick im Anzeige-Menue
// eine Sitzung auf, die nie in "Original" war.
{
	const w = welt({ editor: true, startBasis: "none" });
	w.wechsleZu("political");
	w.wechsleZu("ecosystem");
	w.wechsleZu("deregraphic");
	pruefe(w.stilRufe.length === 0,
		`Editor: ohne "Original" faellt kein einziger setMapStyle-Ruf (waren ${JSON.stringify(w.stilRufe)})`);
	pruefe(w.basis() === "none", "...und die Basis steht unveraendert da");
}

// ---- 6. Die VERDRAHTUNG der Handwahl -------------------------------------------------------------
//
// 💣 Fall 3(b) oben ruft `vergissBasisVorOriginal` SELBST -- er beweist damit, dass die Funktion
// tut, was sie soll, und kein Wort darueber, dass sie im Betrieb je gerufen wird. Genau so entsteht
// ein gruener Test ueber totem Code. Die eine Stelle, an der ein Editor die Basis von Hand waehlt,
// ist der change-Handler des #mapStyleSelect in map-features.js -- und sie wird hier gelesen.
{
	const handler = fs.readFileSync(path.join(__dirname, "..", "map-features.js"), "utf8");
	const start = handler.indexOf('$("#mapStyleSelect").on("change"');
	const ende = handler.indexOf('$("#togglePaths")', start);
	pruefe(start > 0 && ende > start, "der change-Handler des #mapStyleSelect ist auffindbar");
	const block = handler.slice(start, ende).replace(/^[ \t]*\/\/.*$/gm, "");
	pruefe(/vergissBasisVorOriginal\(\)/.test(block),
		"💣 der change-Handler des #mapStyleSelect vergisst die gemerkte Basis -- ohne diesen Ruf"
		+ " legt das Verlassen der Ansicht \"Original\" die alte Vorgaengerin ueber eine frische"
		+ " Handwahl, und Fall 3(b) oben waere ein Test ueber totem Code");
	pruefe(block.indexOf("vergissBasisVorOriginal") < block.indexOf("setMapStyle("),
		"...und zwar VOR dem setMapStyle -- danach loeschte er die Erinnerung, die der Ruf selbst"
		+ " gar nicht mehr setzt, waere also blosse Zierde");
	pruefe(/vergissBasisVorOriginal/.test(fs.readFileSync(path.join(__dirname, "..", "map-features-display-mode.js"), "utf8")),
		"...und die Funktion steht dort, wo die Erinnerung liegt");
}

if (fehler > 0) {
	console.error(`original-basiskarte-zurueck.test.js: ${fehler} Zusicherung(en) fehlgeschlagen`);
	process.exit(1);
}
console.log("original-basiskarte-zurueck.test.js: all assertions passed");
