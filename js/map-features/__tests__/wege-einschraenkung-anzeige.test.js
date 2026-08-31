/*
 * Die zwei Anzeigen der Weg-Einschränkung: kursiver Name auf der Karte, Zeile in der Infobox.
 *
 * 💣 DIE REGEL GILT DEM WEG, GEZEICHNET WERDEN ABSCHNITTE. Der Saljethweg liegt live in sieben
 * Stücken, von denen zwei kein Zeitfenster tragen; der Schattenbachpass in neun, von denen drei die
 * Sperre tragen. Ohne den Gruppen-Index stünde derselbe Weg auf einem Stück kursiv und auf dem
 * nächsten aufrecht -- das sieht nach Fehler aus, nicht nach Information.
 *
 * 💣 UND DIE SCHRIFT WIRD AN ZWEI STELLEN GEBAUT. Das Canvas-Overlay setzt `ctx.font` sowohl für
 * Wegenamen als auch für Flussnamen zusammen; beide lasen bis zum 01.09.2026 nur Größe, Gewicht und
 * Schriftart. Ein `fontStyle` im Stilobjekt wäre dort STILL verschluckt worden -- der SVG-Rückfall
 * hätte funktioniert, die echte Karte nicht. Deshalb gibt es genau EINEN Bauer für die Schriftzeile,
 * und dieser Test fährt ihn.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

// ---- Die echten Quellen laden ------------------------------------------------------------------
const ctx = {
	console,
	module: undefined,
	// Das Tuning-Panel von path-labels.js hängt an ?pathtune=1 und bleibt damit aus.
	window: { location: { search: "" }, matchMedia: null, devicePixelRatio: 1 },
	document: { body: null, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }) },
	map: { getZoom: () => 5 },
	pathData: [],
};
ctx.URLSearchParams = URLSearchParams;
vm.createContext(ctx);
const config = lies("js", "config.js");
const stueck = (marke) => {
	const rest = config.slice(config.indexOf(marke));
	const ende = rest.indexOf("\n};");
	return (ende >= 0 && ende < 4000) ? rest.slice(0, ende + 3) : rest.slice(0, rest.indexOf("\n"));
};
vm.runInContext(stueck("const PATH_SUBTYPE_KEYS"), ctx);
vm.runInContext(stueck("const TRANSPORT_DOMAIN_OPTIONS"), ctx);
vm.runInContext('const SYNTHETIC_ROUTE_TYPE = "Querfeldein";', ctx);
// ⚠️ BACH_LABEL_SIZE_DELTA deklariert path-labels.js selbst -- ein eigener const hier wäre eine
// doppelte Deklaration im selben Kontext und damit ein SyntaxError.
vm.runInContext(lies("js", "map-features", "map-features-path-domain.js"), ctx);
vm.runInContext(lies("js", "map-features", "path-einschraenkung.js"), ctx);
vm.runInContext(lies("js", "map-features", "map-features-path-labels.js"), ctx);

// Für die Infobox: der echte Markup-Bauer (map-features-path-rendering.js) wird geladen, nicht
// nachgebaut. Was er an Nachbarn braucht, steht hier als Attrappe -- bis auf routePlanMonthLabel,
// dessen Aufrufe wir zählen wollen.
ctx.escapeHtml = (wert) => String(wert)
	.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
ctx.getPathPublicId = () => "weg-1";
ctx.IS_EDIT_MODE = false;
ctx.L = {};
ctx.pathLayers = [];
ctx.gefragteMonate = [];
vm.runInContext("var routePlanMonthLabel = (key) => { gefragteMonate.push(key); return \"MONAT-\" + key; };", ctx);
vm.runInContext(lies("js", "map-features", "map-features-path-rendering.js"), ctx);

ctx.__arg = null;
ctx.__arg2 = null;
const rufe = (ausdruck, arg, arg2) => { ctx.__arg = arg; ctx.__arg2 = arg2; return vm.runInContext(ausdruck, ctx); };

const abschnitt = (subtype, extra) => ({
	properties: Object.assign({ feature_subtype: subtype, name: "Testweg" }, extra || {})
});
const FENSTER = { from_month: "peraine", from_day: 15, to_month: "efferd", to_day: 30 };

// =================================================================================================
// 1. Der Index -- alle Abschnitte EINES Weges bekommen dasselbe Urteil
// =================================================================================================
// Der Saljethweg: fünf Abschnitte mit Fenster, zwei ohne (Altbestand). Alle sieben sind derselbe Weg.
const saljethweg = [
	abschnitt("Pfad", { wiki_path: { wiki_key: "saljethweg" }, transport_seasons: { groupFoot: FENSTER } }),
	abschnitt("Pfad", { wiki_path: { wiki_key: "saljethweg" } }),
	abschnitt("Strasse", { wiki_path: { wiki_key: "saljethweg" } }),
];
// Eine gewöhnliche Straße daneben, die NICHT mitgerissen werden darf.
const fremd = abschnitt("Strasse", { wiki_path: { wiki_key: "reichsstrasse-2" } });

ctx.pathData = saljethweg.concat([fremd]);
vm.runInContext("avesmapsWegEinschraenkungNeuRechnen();", ctx);

saljethweg.forEach((seg, i) => {
	wahr(rufe("avesmapsWegEinschraenkungFuerPfad(__arg) !== null", seg),
		`Abschnitt ${i} des Saljethwegs muss eingeschränkt sein -- auch der ohne eigenes Fenster`);
});
gleich(rufe("avesmapsWegEinschraenkungFuerPfad(__arg)", fremd), null,
	"eine fremde Straße wird davon nicht angesteckt");

// =================================================================================================
// 2. Der kursive Name -- die ECHTE Stilregel der Karte
// =================================================================================================
gleich(rufe("getPathLabelStyle(__arg).fontStyle", saljethweg[1]), "italic",
	"der Name eines eingeschränkten Weges wird kursiv gesetzt -- auch auf dem Abschnitt ohne eigenes Fenster");
gleich(rufe("getPathLabelStyle(__arg).fontStyle", fremd), "normal",
	"ein gewöhnlicher Weg bleibt aufrecht");

// =================================================================================================
// 3. Die Schriftzeile des Canvas -- EIN Bauer, und er trägt den Stil wirklich
// =================================================================================================
// 💣 Ohne diesen einen Bauer stünde `fontStyle` zwar im Stilobjekt, käme aber auf der Karte nie an:
// die zwei ctx.font-Stellen im Overlay bauten ihre Zeile aus Gewicht/Größe/Familie zusammen.
const kursivZeile = rufe("avesmapsPathLabelFontString(getPathLabelStyle(__arg), 12)", saljethweg[0]);
wahr(/(^|\s)italic\s/.test(kursivZeile),
	`die Schriftzeile eines eingeschränkten Weges muss „italic" tragen, gebaut wurde: ${kursivZeile}`);
wahr(kursivZeile.indexOf("12px") !== -1,
	"und die übergebene Größe, nicht die aus dem Stilobjekt (das Overlay skaliert sie je Zoom)");

const gradeZeile = rufe("avesmapsPathLabelFontString(getPathLabelStyle(__arg), 12)", fremd);
wahr(!/(^|\s)italic\s/.test(gradeZeile),
	`ein gewöhnlicher Weg bekommt keine Kursivschrift, gebaut wurde: ${gradeZeile}`);

// Die Reihenfolge der CSS-Kurzschreibweise ist bindend: style, weight, size, family.
wahr(/^italic 400 12px /.test(kursivZeile),
	`die CSS-Kurzschreibweise verlangt style vor weight vor size vor family, gebaut wurde: ${kursivZeile}`);

// =================================================================================================
// 4. Beide Canvas-Stellen benutzen den Bauer -- keine baut ihre Zeile noch selbst zusammen
// =================================================================================================
// ⚠️ Quelltext-Test, aber ohne Kommentare: eine Warnung, die vor dem Muster warnt, darf nicht selbst
// anschlagen (die Falle aus [[quelltexttest-darf-kommentare-nicht-mitlesen]]).
const overlayRoh = lies("js", "map-features", "map-features-path-label-canvas-overlay.js");
const overlay = overlayRoh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const selbstgebaut = overlay.match(/ctx\.font\s*=\s*`\$\{style\./g) || [];
gleich(selbstgebaut.length, 0,
	`keine Stelle im Overlay darf ihre Schriftzeile selbst aus dem Stilobjekt zusammensetzen, gefunden: ${selbstgebaut.length}`);
const ueberDenBauer = overlay.match(/avesmapsPathLabelFontString\(/g) || [];
wahr(ueberDenBauer.length >= 2,
	`beide ctx.font-Stellen des Overlays müssen über den Bauer gehen, gefunden: ${ueberDenBauer.length}`);

// =================================================================================================
// 4b. Die Infobox -- der ECHTE Markup-Bauer, nicht nachgebaut
// =================================================================================================
const infobox = (pfad) => rufe("pathWikiInfoboxMarkup(__arg)", pfad);

const eingeschraenkt = infobox(saljethweg[1]);
wahr(eingeschraenkt.indexOf("<dt>Einschränkungen</dt>") !== -1,
	"die Infobox eines eingeschränkten Weges trägt die Zeile „Einschränkungen“ (Owner-Wort, Plural)");
wahr(eingeschraenkt.indexOf("Nur vom 15. MONAT-peraine bis zum 30. MONAT-efferd befahrbar, sonst gesperrt.") !== -1,
	`der Satz steht darin und holt die Monatsnamen über routePlanMonthLabel; gebaut wurde: ${eingeschraenkt}`);
wahr(ctx.gefragteMonate.indexOf("peraine") !== -1,
	"routePlanMonthLabel wurde wirklich gerufen -- die Infobox baut keine eigene Monatsliste");

const gewoehnlich = infobox(fremd);
gleich(gewoehnlich.indexOf("Einschränkungen"), -1,
	"ein gewöhnlicher Weg bekommt die Zeile NICHT -- sonst stünde sie an 6.000 Wegen leer herum");

// 🔴 Die Stelle in der Reihenfolge ist Absicht: nach den Stammdaten, vor „Führt durch" (das der
// Landschafts-Container nachträglich füllt). Eine Zeile ganz am Ende läse sich wie eine Fußnote.
wahr(eingeschraenkt.indexOf("<dt>Einschränkungen</dt>") < eingeschraenkt.indexOf("avesmaps-path-landscapes"),
	"die Zeile steht VOR dem Landschafts-Container, nicht dahinter");

// =================================================================================================
// 5. Der Index wird bei jeder Änderung an den Wegen verworfen
// =================================================================================================
// 💣 Sonst bliebe ein frisch gespeichertes Fenster unsichtbar, bis jemand neu lädt -- und der Editor
// hielte das für einen verlorenen Speichervorgang.
["map-features-path-lifecycle.js", "map-features-path-prepare.js"].forEach((datei) => {
	const rohtext = lies("js", "map-features", datei);
	const ohneKommentare = rohtext.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	wahr(ohneKommentare.indexOf("avesmapsWegEinschraenkungNeuRechnen()") !== -1,
		`${datei} ändert pathData und muss den Index verwerfen`);
});

console.log(`wege-einschraenkung-anzeige.test.js: ${checks} Zusicherungen bestanden`);
