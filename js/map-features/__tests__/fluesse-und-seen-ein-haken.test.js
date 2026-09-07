// „Flüsse und Seen" an EINEM Haken (Owner 07.09.2026) -- die Regel, die Anwendung und die Leitung.
//
// Er prüft drei Dinge, und das dritte ist das wichtigste:
//   A. die reine Regel (welche Fläche hängt am Haken)
//   B. die Anwendung als Klasse am <path>, wirklich ausgeführt
//   C. die Leitung -- und dass die BESCHRIFTUNGEN ausdrücklich NICHT mitgehen
//
// 💣 Zu C: live gemessen am 07.09.2026 stehen 43 See-FLÄCHEN gegen 148 See-BESCHRIFTUNGEN, und in
// der Standardansicht ist `#toggleRivers` ab Werk aus (die Voreinstellung vom 26.07.2026). Nähme der
// Haken die Namen mit, verlöre jeder Besucher dort 148 Seenamen. Diese Entscheidung ist nur solange
// sicher, wie sie jemand festhält -- sonst „vervollständigt" sie der nächste Leser, und der Schaden
// wäre unsichtbar: ein Name, der fehlt, meldet sich nicht.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/fluesse-und-seen-ein-haken.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// 💣 Kommentare raus, bevor irgendetwas am Quelltext gemessen wird -- sonst bestätigt sich der Test
// an der Begründung, die vor genau diesem Fehler warnt. Zeilenendenneutral (CRLF hier, LF im Tor).
function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}
const liesRoh = (...t) => fs.readFileSync(path.join(wurzel, ...t), "utf8");
const lies = (...t) => ohneKommentare(liesRoh(...t));

const RENDERING = liesRoh("js", "map-features", "map-features-ecosystem-rendering.js");
const LOADER = lies("js", "map-features", "map-features-ecosystem-loader.js");
const KARTE = lies("js", "map-features", "map-features.js");
const LABELS = lies("js", "map-features", "map-features-labels.js");
const MARKUP = liesRoh("index.html");
const I18N = liesRoh("js", "app", "i18n-en.js");
const CSS = liesRoh("css", "features", "ecosystem-layer.css");

// ---- Die vier Funktionen ausschneiden und WIRKLICH ausführen ------------------------------------
// 🔴 Ausgeführt, nicht gelesen: ein Regex kennt keinen Geltungsbereich. Genau daran ist am
// 03.09.2026 zwei Stunden lang die Beschriftungsebene gestorben -- der Quelltext-Test war grün,
// während der Aufruf in einer anderen Funktion einen ReferenceError warf.
function schneide(name) {
	const start = RENDERING.indexOf("function " + name + "(");
	assert.ok(start !== -1, "Funktion nicht gefunden: " + name);
	// Bis zur schliessenden Klammer am Zeilenanfang -- zeilenendenneutral, weil hier CRLF liegt und
	// im Deploy-Tor LF (AGENTS.md §9).
	const norm = RENDERING.slice(start).replace(/\r\n/g, "\n");
	const ende = norm.indexOf("\n}");
	assert.ok(ende !== -1, "Funktionsende nicht gefunden: " + name);
	return norm.slice(0, ende + 2);
}

const quelle = ["avesmapsIstSeeFlaeche", "avesmapsSeeFlaechenSichtbar",
	"applyEcosystemGewaesserKlasse", "avesmapsSyncEcosystemGewaesserSicht"].map(schneide).join("\n\n");

let hakenAn = true;
let layerRegister = new Map();
// ⚠️ Attrappen ohne Proxy: ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau den
// ReferenceError, den dieser Test fangen soll (Lehre vom 03.09.2026).
const kontext = {
	document: { getElementById: (id) => (id === "toggleRivers" ? { get checked() { return hakenAn; } } : null) },
	get ecosystemLayers() { return layerRegister; },
	Map,
	console,
};
kontext.globalThis = kontext;
vm.createContext(kontext);
vm.runInContext(quelle, kontext);
const { avesmapsIstSeeFlaeche, applyEcosystemGewaesserKlasse,
	avesmapsSyncEcosystemGewaesserSicht, avesmapsSeeFlaechenSichtbar } = kontext;

// ---- A. Die reine Regel -------------------------------------------------------------------------
pruefe(avesmapsIstSeeFlaeche({ kind: "topographie", region_type: "see" }) === true,
	"eine topographische Seefläche hängt am Haken");
// 💣 BEIDE Felder: `insel` kommt in zwei Ebenen vor, eine Art allein ist hier kein Schlüssel.
pruefe(avesmapsIstSeeFlaeche({ kind: "vegetation", region_type: "see" }) === false,
	"die Art allein genügt nicht -- die EBENE muss stimmen");
pruefe(avesmapsIstSeeFlaeche({ kind: "topographie", region_type: "meer" }) === false,
	"das Meer hängt NICHT am Haken (Owner: nur Seen und Flüsse)");
pruefe(avesmapsIstSeeFlaeche({ kind: "topographie", region_type: "kueste" }) === false,
	"die Küste hängt NICHT am Haken");
pruefe(avesmapsIstSeeFlaeche({ kind: "topographie", region_type: "flussdelta" }) === false,
	"das Flussdelta hängt NICHT am Haken");
pruefe(avesmapsIstSeeFlaeche(null) === false && avesmapsIstSeeFlaeche(undefined) === false,
	"ohne Fläche keine Aussage, und kein Wurf");

// ---- B. Der Haken fällt OFFEN aus ----------------------------------------------------------------
const echterLeser = kontext.document.getElementById;
kontext.document.getElementById = () => null;
pruefe(avesmapsSeeFlaechenSichtbar() === true,
	"ohne Bedienelement gilt sichtbar -- lieber ein See zu viel als eine unerreichbare Fläche");
kontext.document.getElementById = echterLeser;

// ---- C. Die Anwendung, wirklich ausgeführt ------------------------------------------------------
function machLayer(area) {
	const klassen = new Set();
	const el = { klassen, classList: { toggle: (n, an) => { if (an) klassen.add(n); else klassen.delete(n); } } };
	return { _ecosystemArea: area, getElement: () => el, __klassen: klassen };
}
const AUS = "ecosystem-area--gewaesser-aus";

const see = machLayer({ kind: "topographie", region_type: "see" });
const meer = machLayer({ kind: "topographie", region_type: "meer" });
const wald = machLayer({ kind: "vegetation", region_type: "wald" });
layerRegister = new Map([["a", see], ["b", meer], ["c", wald]]);

hakenAn = false;
avesmapsSyncEcosystemGewaesserSicht();
pruefe(see.__klassen.has(AUS), "Haken aus -> die Seefläche verschwindet");
pruefe(!meer.__klassen.has(AUS), "Haken aus -> das Meer bleibt");
pruefe(!wald.__klassen.has(AUS), "Haken aus -> der Wald bleibt");

hakenAn = true;
avesmapsSyncEcosystemGewaesserSicht();
pruefe(!see.__klassen.has(AUS), "Haken an -> die Seefläche kommt zurück");

// 💣 Ein Layer ohne <path> (vor addTo(map)) darf nicht werfen -- getElement() liefert dann null.
let warfNicht = true;
try {
	applyEcosystemGewaesserKlasse({ _ecosystemArea: { kind: "topographie", region_type: "see" }, getElement: () => null });
} catch (e) { warfNicht = false; }
pruefe(warfNicht, "ein Layer ohne <path> wirft nicht");

// ---- D. Die Leitung ------------------------------------------------------------------------------
// 💣 Der Haken muss BEIDE Gewerke in EINEM Zuhörer nachziehen -- getrennt registriert stünde nach
// einem Klick die eine Hälfte auf altem Stand, und das sieht wie ein verschluckter Klick aus.
const abHaken = KARTE.slice(KARTE.indexOf("$(\"#toggleRivers\").change"));
const zuhoerer = abHaken.slice(0, abHaken.indexOf("});") + 3);
pruefe(zuhoerer.includes("syncPathVisibility()"), "der Haken zieht die Flusswege nach");
pruefe(zuhoerer.includes("avesmapsSyncEcosystemGewaesserSicht()"), "der Haken zieht die Seeflächen nach");

// 💣 Und nach jedem (Neu-)Aufbau, sonst kommt eine ausgeblendete Fläche wortlos zurück.
pruefe(LOADER.includes("applyEcosystemGewaesserKlasse(layer)"),
	"ein neu gebauter Layer bekommt die Klasse zurück");
pruefe(LOADER.indexOf("applyEcosystemGewaesserKlasse(layer)") > LOADER.indexOf("layer.addTo(map)"),
	"und zwar NACH addTo(map) -- davor liefert getElement() null");

// ---- E. Die Beschriftung -------------------------------------------------------------------------
pruefe(MARKUP.includes("data-i18n=\"display.layer.rivers\">Flüsse und Seen<"),
	"der Schalter heißt „Flüsse und Seen\"");
pruefe(I18N.includes("\"display.layer.rivers\": \"Rivers and lakes\""),
	"und auf Englisch „Rivers and lakes\" -- eine halbe Umbenennung ist eine Divergenz");
// 🔴 Die KENNUNG wandert nicht mit (dieselbe Trennung wie „Neuigkeiten"/changelog).
pruefe(MARKUP.includes("id=\"toggleRivers\"") && MARKUP.includes("data-i18n=\"display.layer.rivers\""),
	"Kennung und i18n-Schlüssel bleiben unverändert -- nur die Beschriftung wandert");

// ---- F. DIE TRAGENDE ENTSCHEIDUNG: die NAMEN gehen NICHT mit --------------------------------------
// Wer das „vervollständigt", nimmt der Standardansicht 148 Seenamen -- der Haken ist dort ab Werk aus.
pruefe(!LABELS.includes("toggleRivers"),
	"die Label-Sichtbarkeit fragt den Fluss-Haken NICHT (sonst verschwänden 148 Seenamen in „Standard\")");
// ⚠️ Gemessen an den AUSGESCHNITTENEN Funktionen, nicht an der ganzen Datei -- die enthält an
// anderer Stelle sehr wohl Beschriftungscode, und ein Dateiweiter Test wäre hier ein Fehlalarm.
pruefe(!ohneKommentare(quelle).includes("label"),
	"und die Gewässer-Regel selbst fasst keine Beschriftung an");

// ---- G. Die CSS-Regel ----------------------------------------------------------------------------
// 💣 display:none, nicht fill-opacity:0 -- eine nur durchsichtige Fläche fängt weiter jeden Klick.
pruefe(/\.leaflet-pane\.ecosystem-pane > svg path\.leaflet-interactive\.ecosystem-area--gewaesser-aus\s*\{[^}]*display:\s*none/
	.test(CSS.replace(/\r\n/g, "\n")),
	"die Klasse blendet per display:none aus");

console.log("ok -- " + pruefungen + " Zusicherungen");
