// Die Vorgabefarben des SVG-Exports -- die EINE Stelle, an der steht, in welcher Farbe ein
// Ding aus der Karte in die Datei geht.
//
// 💣 WARUM DIESE DATEI EXISTIERT. Bis zum 23.08.2026 stand diese Regel im Kitt
// (svg-export-page.js), eingesperrt in dessen IIFE. Solange nur der Browser exportierte, war
// das richtig. Seit der naechtliche Lauf (tools/svg-export/abzug-bauen.js) denselben Bauer
// unter Node fuettert, gaebe es zwei Faelle: der Browser lieste die Token, der Laeufer schriebe
// sie ab -- und ein neu eingefuehrter Gelaendetyp bekaeme im einen Abzug seine Farbe und im
// anderen das Grau des Rueckfalls, ohne dass es jemandem auffiele.
//
// 🔴 DIE DATEI KENNT KEIN DOM UND KEIN DATEISYSTEM. Sie bekommt das Nachschlagen der Token
// als Funktion gereicht (`token(name) -> string`): im Browser aus getComputedStyle, im
// Laeufer aus css/base/tokens.css. Dieselbe Trennung wie beim Bauer nebenan.
"use strict";

// 🔴 Die Vorgaben des Owners (15.08.2026), sie schlagen die Kartenfarbe. Alles, was hier
// NICHT steht, kommt weiter aus dem Programm -- Token für Flächen, SVGX_WAY_COLORS für
// Wege. Der Owner: „seen sind 82befe, flüsse 4c89c6, wege f5ffe9, wälder 589a64,
// gebirge acaea2, der rest wie aus dem programm."
// ⚠️ „wege" heißt hier die sechs LANDwege. Seeweg bleibt bei seinem Kartenton, weil er
// eine Schiffsroute ist und kein Landweg; der Flussweg hat seinen eigenen Wert bekommen.
// Falls das anders gemeint war: die Farbfelder auf der Seite ändern es in einem Klick.
const SVGX_COLOR_PRESETS = {
	"landschaften/topographie/see": "#82befe",
	"landschaften/vegetation/wald": "#589a64",
	"landschaften/topographie/gebirge": "#acaea2",
	"wege/Flussweg": "#4c89c6",
	"wege/Reichsstrasse": "#f5ffe9",
	"wege/Strasse": "#f5ffe9",
	"wege/Weg": "#f5ffe9",
	"wege/Pfad": "#f5ffe9",
	"wege/Gebirgspass": "#f5ffe9",
	"wege/Wuestenpfad": "#f5ffe9",
};

// 🔴 Die Farbe JEDER Landschaftsfläche, nach DERSELBEN Regel, mit der die Karte sie
// ableitet (map-features-ecosystem-rendering.js, ecosystemAreaColor): erst der Token des
// Geländetyps, sonst der Token der Art. Also keine Abschrift, sondern dieselbe Quelle --
// ein neu eingeführter Typ braucht auch hier nur seinen Token in tokens.css, und der
// Export folgt von selbst. Wald grün, Wüste gelb, See blau, Meer dunkelblau.
// 💣 Der Unterstrich wird zum Bindestrich:
//    suempfe_moore -> --color-ecosystem-vegetation-suempfe-moore
function svgxLandschaftsFarben(features, token) {
	const farben = {};
	(features || []).forEach((f) => {
		const p = f.properties || f;
		const typ = p.region_type || "ohne_typ";
		if (farben[typ]) { return; }
		const art = p.kind || "";
		farben[typ] = token(`--color-ecosystem-${art}-${typ.replace(/_/g, "-")}`)
			|| token(`--color-ecosystem-${art}`)
			|| "#dfd6bd";
	});
	return farben;
}

// Farbe eines Knotens, wenn niemand etwas eingestellt hat: erst die Vorgabe oben, dann
// das, was das Programm ohnehin zeichnen würde.
// ⚠️ `wegfarben` ist SVGX_WAY_COLORS aus dem Bauer und `ortsfarbe` dessen SVGX_PLACE_COLOR;
// beide werden hereingereicht, damit diese Datei den Bauer nicht laden muss (im Browser
// haengt er am window, unter Node an module.exports -- zwei verschiedene Wege).
function svgxFarbeVorgabe(pfad, token, wegfarben, ortsfarbe) {
	if (SVGX_COLOR_PRESETS[pfad]) { return SVGX_COLOR_PRESETS[pfad]; }
	const teile = pfad.split("/");

	if (teile[0] === "landschaften" && teile.length === 3) {
		return token(`--color-ecosystem-${teile[1]}-${teile[2].replace(/_/g, "-")}`)
			|| token(`--color-ecosystem-${teile[1]}`) || "#dfd6bd";
	}
	if (teile[0] === "wege" && teile.length === 2) {
		return (wegfarben || {})[teile[1]] || "#888888";
	}
	if (teile[0] === "kraftlinien") { return "#7a5ea8"; }
	if (teile[0] === "gebiete") { return "#8a6a3f"; }
	// 🔴 Orte in der Farbe der Kartenmarkierung (--color-marker-waypoint), nicht im
	// Braun der Schrift -- Owner 16.08.2026. Beschriftungen bleiben braun.
	if (teile[0] === "orte") {
		return token("--color-marker-waypoint") || ortsfarbe || "#e33b35";
	}
	return "#3b2a18";   // Beschriftungen
}

if (typeof window !== "undefined") {
	window.AvesmapsSvgExportFarben = {
		COLOR_PRESETS: SVGX_COLOR_PRESETS,
		vorgabe: svgxFarbeVorgabe,
		landschaftsFarben: svgxLandschaftsFarben,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SVGX_COLOR_PRESETS: SVGX_COLOR_PRESETS,
		svgxFarbeVorgabe: svgxFarbeVorgabe,
		svgxLandschaftsFarben: svgxLandschaftsFarben,
	};
}
