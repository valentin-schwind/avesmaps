// 🪤 Kein "use strict": in strict mode bekommt eval() seinen EIGENEN Variablenraum, die unten
// herausgeschnittene Funktion erreichte diese Datei nie und jede Pruefung staerbe an "not defined".
//
// Prueft die HAKEN des Besucher-Trackings (js/app/visitor-tracking.js) -- also die Frage, ob die
// Statistik ueberhaupt zaehlt. AUSGEFUEHRT, nicht gelesen: ein Quelltext-Grep haelt einen Haken auf
// einem umgezogenen Container fuer heil, und genau so ist die Anzeige-Statistik am 12.08.2026 still
// gestorben (der Kommentar darueber steht in der Datei selbst).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/besucher-tracking-haken.test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const src = read("js", "app", "visitor-tracking.js");
const indexHtml = read("index.html");
const trackPhp = read("api", "app", "track.php");
const analyticsPhp = read("api", "_internal", "analytics", "visitor-analytics.php");

function extract(name) {
	const match = src.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " nicht in js/app/visitor-tracking.js gefunden");
		process.exit(1);
	}
	return match[0];
}

let failed = 0;
const check = (label, ok) => {
	console.log((ok ? "  PASS  " : "  FAIL  ") + label);
	if (!ok) { failed++; }
};

// --- Das Geruest ------------------------------------------------------------------------------
// Nachgebaut wird nur die UMGEBUNG (jQuery, document, window), nie der Code selbst: eine nachgebaute
// Kopie der Haken bestuende, waehrend die ausgelieferte Datei nicht mehr zaehlt.

const ereignisse = [];          // was trackVisitorEvent() zu sehen bekam
const bindungen = [];           // was der Code an jQuery angemeldet hat
const tickWarteschlange = [];   // was per setTimeout(..., 0) nachgereicht wurde
let aktiverReiter = null;       // der Reiter, den document.querySelector finden soll

function visitorTrackingEnabled() {
	return true;
}
function trackVisitorEvent(metric, dimension = "") {
	ereignisse.push({ metric: metric, dimension: String(dimension || "") });
}

// 🔴 Was das Geruest NICHT kennt, wirft. Ein stiller leerer Treffer saehe aus wie „kein Reiter
// aktiv" -- also wie ein bestandener Test ueber nichts.
const ERWARTETER_REITER_SELEKTOR = "#ecosystem-layer-switch .ecosystem-layer-switch__tab.is-active";
global.document = {
	querySelector(selektor) {
		if (selektor !== ERWARTETER_REITER_SELEKTOR) {
			throw new Error("unerwarteter Selektor: " + selektor);
		}
		return aktiverReiter;
	},
};

function jqFabrik(zielOderSelektor) {
	if (typeof zielOderSelektor !== "string") {
		return { val: function () { return zielOderSelektor.value; } };
	}
	return {
		on: function (ereignisNamen, a, b) {
			const handler = typeof b === "function" ? b : a;
			const delegat = typeof b === "function" ? String(a) : "";
			String(ereignisNamen).trim().split(/\s+/).forEach((name) => {
				bindungen.push({ selektor: zielOderSelektor, ereignis: name, delegat: delegat, handler: handler });
			});
			return this;
		},
		val: function () { return ""; },
	};
}

global.window = {
	jQuery: jqFabrik,
	setTimeout: function (fn) { tickWarteschlange.push(fn); return 0; },
};
const tick = () => { tickWarteschlange.splice(0).forEach((fn) => fn()); };

// controlled: die Eingabe ist unsere eigene Repo-Datei, und das hier ist ein Wegwerf-Geruest
eval(extract("installVisitorTrackingHooks"));
installVisitorTrackingHooks();

const bindung = (selektor, ereignis) => bindungen.filter((b) => b.selektor === selektor && b.ereignis === ereignis)[0];

// ---------------------------------------------------------------------------------------------
// 1. Der Untergrund -- Modern / Original / Old.
//    Seit dem 26.08.2026 eine eigene Wahl NEBEN der Ansicht (AGENTS.md §11, „Der Kartenfaecher").
//    Bis dahin gab es ihn als Wahl nicht: „Original" war eine ANSICHT und kam ueber
//    #mapLayerModeSelect herein. Gezaehlt hat ihn nie jemand.
// ---------------------------------------------------------------------------------------------
const untergrund = bindung("#mapStyleSelect", "change");
check("der Untergrund haengt ueberhaupt an einem Haken", !!untergrund);
check("💣 und zwar an #mapStyleSelect -- der Selektor muss im Markup wirklich stehen",
	indexHtml.indexOf('id="mapStyleSelect"') !== -1);

ereignisse.length = 0;
if (untergrund) { untergrund.handler.call({ value: "original" }); }
check("ein Wechsel auf „Original\" wird als map_style/original gezaehlt",
	ereignisse.length === 1 && ereignisse[0].metric === "map_style" && ereignisse[0].dimension === "original");

ereignisse.length = 0;
if (untergrund) { untergrund.handler.call({ value: "stylized" }); }
check("und ein Wechsel auf „Modern\" als map_style/stylized",
	ereignisse.length === 1 && ereignisse[0].dimension === "stylized");

// ---------------------------------------------------------------------------------------------
// 2. Die Landschaften-Ebene -- Alle / Derographie / Vegetation / Topographie / Klimazonen.
//    💣 Der Reiterbund kennt kein `change`; gelesen wird der RESULTIERENDE Zustand im naechsten
//    Tick, wie bei den Ortsklassen daneben.
// ---------------------------------------------------------------------------------------------
const ebeneKlick = bindung("#ecosystem-layer-switch", "click");
const ebeneTaste = bindung("#ecosystem-layer-switch", "keydown");
check("die Ebene haengt an einem Klick-Haken", !!ebeneKlick);
check("⚠️ und an einem Tasten-Haken -- der Bund ist ein Tablist mit Pfeiltasten-Navigation,"
	+ " ohne ihn zaehlte nur die Maus", !!ebeneTaste);
check("💣 der Selektor muss im Markup wirklich stehen",
	indexHtml.indexOf('id="ecosystem-layer-switch"') !== -1);

const reiter = (kind, alle) => ({ dataset: alle ? { ecosystemShowAll: "1" } : { ecosystemKind: kind } });

ereignisse.length = 0;
aktiverReiter = reiter("klima");
if (ebeneKlick) { ebeneKlick.handler.call({}); }
check("vor dem Tick ist noch nichts gezaehlt -- der Zustand steht erst danach fest",
	ereignisse.length === 0);
tick();
check("nach dem Tick steht der RESULTIERENDE Zustand als eco_kind/klima da",
	ereignisse.length === 1 && ereignisse[0].metric === "eco_kind" && ereignisse[0].dimension === "klima");

ereignisse.length = 0;
if (ebeneKlick) { ebeneKlick.handler.call({}); }
tick();
check("💣 ein zweiter Griff auf dieselbe Ebene zaehlt NICHT noch einmal -- sonst blaeht jeder"
	+ " Klick auf die aktive Kachel und jeder Pfeiltastendruck genau die Scheibe auf,"
	+ " die ohnehin vorne liegt", ereignisse.length === 0);

ereignisse.length = 0;
aktiverReiter = reiter("vegetation");
if (ebeneTaste) { ebeneTaste.handler.call({}); }
tick();
check("die Pfeiltaste zaehlt genauso wie die Maus",
	ereignisse.length === 1 && ereignisse[0].dimension === "vegetation");

ereignisse.length = 0;
aktiverReiter = reiter("", true);
if (ebeneKlick) { ebeneKlick.handler.call({}); }
tick();
check("💣 „Alle\" traegt bewusst kein data-ecosystem-kind und bekommt den Schluessel `alle`"
	+ " -- liesse man es weg, waeren die Prozente der uebrigen vier falsch",
	ereignisse.length === 1 && ereignisse[0].dimension === "alle");

ereignisse.length = 0;
aktiverReiter = null;
if (ebeneKlick) { ebeneKlick.handler.call({}); }
tick();
check("⚠️ ist gar kein Reiter aktiv, wird nichts gezaehlt statt ein leerer Schluessel",
	ereignisse.length === 0);

// ---------------------------------------------------------------------------------------------
// 3. Der Weg nach hinten. 💣 Ein Haken, den der Server wegwirft, ist kein Haken: track.php laesst
//    nur Merkmale aus seiner Liste durch, und ein nicht gelistetes verschwindet ohne Fehler.
// ---------------------------------------------------------------------------------------------
const allowed = trackPhp.match(/\$allowed\s*=\s*\[[^\]]*\]/);
check("track.php hat eine Merkmalsliste", !!allowed);
["map_style", "eco_kind"].forEach((metric) => {
	check("💣 „" + metric + "\" steht in der Liste von track.php -- sonst zaehlt der Haken ins Leere",
		!!allowed && allowed[0].indexOf("'" + metric + "'") !== -1);
	check("und wird von avesmapsVisitorMetrics auch wieder ausgelesen",
		new RegExp("'" + metric + "'\\s*=>\\s*\\$top\\(\\s*'" + metric + "'").test(analyticsPhp));
});

console.log(failed === 0 ? "\nOK -- alle Pruefungen bestanden" : "\n" + failed + " Pruefung(en) fehlgeschlagen");
process.exit(failed === 0 ? 0 : 1);
