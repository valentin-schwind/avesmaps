// Fall #82: "Editor-Modus: Originalkarte laesst sich nicht zurueckschalten."
//
// 🔴 DER GEMELDETE FEHLER (Tigersprung, 19.08.2026): wer im Editor einmal auf die Ansicht
// "Original" geschaltet hatte, sass fuer den Rest der Sitzung auf der alten Basiskarte. Die
// UEBERLAGERUNGEN schalteten weiter brav mit (Politisch, Landschaften) -- nur der Kachel-Grund
// nicht. Genau dieser Unterschied ist die Fundstelle: die Ueberlagerungen haengen an den
// sync*-Aufrufen, die Basiskarte an setMapStyle.
//
// 🔴 SEIT 26.08.2026 heisst die alte Basis "original", nicht "old": es gibt jetzt DREI Kachelsaetze,
// und "old" ist der mit den aufgedruckten Namen. Die Ansicht zeigte immer die unbeschriftete --
// bis dahin gab es dafuer nur keinen eigenen Eintrag. Die Zusicherungen sind unveraendert.
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

// ---- 1. DIE ANSICHT FASST DEN UNTERGRUND NICHT MEHR AN -------------------------------------------
//
// 🔴 Fall #82 („die Originalkarte laesst sich nicht zurueckschalten") hat seinen Gegenstand
// verloren: der Untergrund ist seit dem 26.08.2026 ein EIGENER Zustand, den man direkt waehlt.
// Es gibt keinen Hin- und Rueckweg mehr, den eine Ansicht verwalten muesste.
// 💣 Was bleibt, ist die Zusicherung dagegen: hat jemand den Untergrund gewaehlt, darf KEIN
// Ansichtswechsel ihn ueberschreiben. Genau das tat der alte Code, und es war der Grund, warum
// ein geteiltes `?mapstyle=` beim Empfaenger nie ankam.
[false, true].forEach((editor) => {
	const wo = editor ? "Editor" : "Frontend";
	["deregraphic", "political", "powerlines", "ecosystem", "none"].forEach((ziel) => {
		const w = welt({ editor });
		w.waehleBasisVonHand("original");
		w.wechsleZu(ziel);
		pruefe(w.basis() === "original",
			`${wo}/${ziel}: ein selbst gewaehlter Untergrund ueberlebt den Ansichtswechsel`
			+ ` (ist "${w.basis()}")`);
	});
});

// ---- 2. OHNE Handwahl gilt im Frontend weiter die Vorgabe -----------------------------------------
//
// ⚠️ Die Gegenprobe zu 1. Ohne sie waere die Zusicherung oben auch dann erfuellt, wenn der Code den
// Untergrund GRUNDSAETZLICH nicht mehr anfasst -- und dann bekaeme ein Besucher, der nie etwas
// gewaehlt hat, irgendeinen Kachelsatz statt des vorgesehenen.
["deregraphic", "political", "none"].forEach((ziel) => {
	const w = welt({ editor: false, startBasis: "old" });
	w.wechsleZu(ziel);
	pruefe(w.basis() === "stylized",
		`Frontend/${ziel}: ohne eigene Wahl gilt die Vorgabe (ist "${w.basis()}")`);
});

// ---- 3. „original" wird UEBERSETZT, nicht verworfen ----------------------------------------------
//
// 💣 Alte geteilte Links tragen `?mapLayerMode=original`, und es gibt viele davon. Ohne die
// Uebersetzung fielen sie ueber die allowedModes-Liste auf die Standardansicht zurueck -- der
// Empfaenger saehe eine voellig andere Karte als der Absender, und niemand koennte sagen warum.
// 🔴 Ziel ist „Nur Karte" plus Untergrund „original": die Ansicht war nie etwas anderes als eine
// nackte Karte auf der alten Basis.
[false, true].forEach((editor) => {
	const w = welt({ editor });
	w.wechsleZu("original");
	pruefe(w.basis() === "original",
		`${editor ? "Editor" : "Frontend"}: "original" setzt den Untergrund (ist "${w.basis()}")`);
	pruefe(w.context.$("#mapLayerModeSelect").val() === "none",
		`${editor ? "Editor" : "Frontend"}: "original" landet in der Ansicht "Nur Karte"`);
});

// ---- 4. Die Handwahl ist verdrahtet ---------------------------------------------------------------
//
// 💣 `vergissBasisVorOriginal` ist der einzige Weg, auf dem eine Handwahl bekannt wird. Ohne den
// Ruf im change-Handler des #mapStyleSelect (js/map-features/map-features.js) waere jede Wahl beim
// naechsten Ansichtswechsel wieder weg.
const handler = fs.readFileSync(path.join(__dirname, "..", "map-features.js"), "utf8");
const start = handler.indexOf('$("#mapStyleSelect").on("change"');
const ende = handler.indexOf('$("#togglePaths")');
pruefe(start > 0 && ende > start, "der change-Handler des #mapStyleSelect ist auffindbar");
pruefe(handler.slice(start, ende).includes("vergissBasisVorOriginal"),
	"💣 der change-Handler meldet die Handwahl -- ohne diesen Ruf ueberschreibt der naechste"
	+ " Ansichtswechsel sie wieder");

if (fehler > 0) {
	console.error(`${fehler} Zusicherung(en) verletzt.`);
	process.exit(1);
}
console.log("original-basiskarte-zurueck: alle Zusicherungen erfuellt.");
