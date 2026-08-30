// Der Importer geht an die Editoren -- Owner 31.08.2026, vier Punkte in einer Nachricht:
//
//   1. "der button 'Garetien Importer' soll für alle Editoren-Nutzer sichtbar werden"
//   2. "Beim Drücken sollen sich die panels zur seite schieben (routerplaner nach links,
//      editor/info-panel nach rechts). damit der platz frei für dem importer ist"
//   3. "Die Breite des dialog fensters soll 745 px sein"
//   4. "'Holen & Rechnen' und 'Ebenen' dürfen von nicht-admins nicht gedrückt werden können"
//
// 🔴 PUNKT 1 UND PUNKT 4 SIND ZWEI FRAGEN, UND SIE MUESSEN ES BLEIBEN. Genau deshalb kostete die
// Freigabe eine Zeile: "darf ich das Fenster oeffnen" und "darf ich einen fremden Server abrufen
// bzw. den ganzen Bestand neu rechnen" wurden schon beim Bau getrennt. Waeren sie EINE Funktion,
// haette Punkt 1 den Punkt 4 stillschweigend mit aufgemacht -- ein Editor koennte dann den Abruf
// bei garetien.de ausloesen, und es faellt niemandem auf, weil beide Knoepfe danach einfach
// funktionieren. Dieser Test haelt die Trennung fest.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-freischalten.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { avesmapsGaretienDarfOeffnen, avesmapsGaretienDarfAdminHandlung, garetienPanelsBeiseite } = mod;

wahr(typeof garetienPanelsBeiseite === "function", "garetienPanelsBeiseite fehlt im Export");

// =================================================================================================
// 1. Wer darf das Fenster oeffnen -- Editoren JA, Admins JA, sonst niemand
// =================================================================================================
const sitzung = (rechte) => ({ capabilities: rechte });

gleich(avesmapsGaretienDarfOeffnen(sitzung({ edit: true })), true, "ein Editor darf oeffnen");
gleich(avesmapsGaretienDarfOeffnen(sitzung({ admin: true })), true, "ein Admin auch");
gleich(avesmapsGaretienDarfOeffnen(sitzung({ admin: true, edit: true })), true, "und beides zusammen");

// 🔴 FAELLT GESCHLOSSEN AUS. Nur echtes `true` zaehlt -- eine als JSON geparste Fehlerseite, eine 1
// statt true, ein "0" aus einem Proxy sind alle truthy und gaeben den Knopf sonst frei.
gleich(avesmapsGaretienDarfOeffnen(sitzung({ review: true })), false, "ein Reviewer darf NICHT");
gleich(avesmapsGaretienDarfOeffnen(sitzung({ edit: 1 })), false, "eine 1 ist kein true");
gleich(avesmapsGaretienDarfOeffnen(sitzung({ edit: "true" })), false, "eine Zeichenkette auch nicht");
gleich(avesmapsGaretienDarfOeffnen(sitzung({})), false, "ohne Faehigkeit gar nicht");
gleich(avesmapsGaretienDarfOeffnen({}), false, "ohne capabilities-Objekt ebenso");
gleich(avesmapsGaretienDarfOeffnen(null), false, "und ohne Sitzung -- der Zustand vor der Auskunft");

// =================================================================================================
// 2. 🔴 "Holen & Rechnen" und "Ebenen" bleiben ADMIN-ONLY -- die Freigabe oben oeffnet sie NICHT
// =================================================================================================
gleich(avesmapsGaretienDarfAdminHandlung(sitzung({ edit: true })), false,
	"ein Editor darf NICHT holen/rechnen, obwohl er das Fenster oeffnen darf");
gleich(avesmapsGaretienDarfAdminHandlung(sitzung({ admin: true })), true, "ein Admin schon");
gleich(avesmapsGaretienDarfAdminHandlung(sitzung({ admin: 1 })), false, "und auch hier zaehlt nur echtes true");

// ⚠️ Der Zeuge fuer die Trennung: fuer DIESELBE Sitzung sind die zwei Antworten verschieden. Ohne
// ihn belegten die Zeilen darueber nur, dass es zwei Funktionen gibt.
const editor = sitzung({ edit: true });
wahr(avesmapsGaretienDarfOeffnen(editor) !== avesmapsGaretienDarfAdminHandlung(editor),
	"dieselbe Sitzung darf oeffnen, aber nicht holen -- das ist der ganze Punkt");

// =================================================================================================
// 3. Beim Oeffnen weichen die zwei Panels zur Seite
// =================================================================================================
// 🔴 Gebaut mit den EINKLAPP-Mechanismen des Hauses, nicht mit einem eigenen Schieben: ein zweiter
// Zustand darueber, wo die Panels stehen, liefe mit der Lasche und ihrer Pfeilrichtung auseinander.
let planerEingeklappt = 0;
let infoEingeklappt = 0;
global.window.avesmapsCollapseRoutePlanner = () => { planerEingeklappt++; };
global.window.avesmapsInfopanelCollapse = () => { infoEingeklappt++; };
garetienPanelsBeiseite();
gleich(planerEingeklappt, 1, "der Routenplaner klappt nach links ein");
gleich(infoEingeklappt, 1, "und das Info-/Editorpanel nach rechts");

// ⚠️ Auf einer Seite OHNE Karte gibt es weder Planer noch Infopanel -- ein fehlender Aufruf darf
// das Fenster nicht aufhalten.
delete global.window.avesmapsCollapseRoutePlanner;
delete global.window.avesmapsInfopanelCollapse;
assert.doesNotThrow(() => garetienPanelsBeiseite(),
	"ohne die beiden Haus-Funktionen passiert nichts, und es wirft nichts");
checks++;

// 💣 UND DAS OEFFNEN RUFT ES WIRKLICH. Ohne diese Zeile koennte garetienPanelsBeiseite tadellos
// sein und von niemandem gerufen werden -- dieselbe Luecke, die an diesem Tag schon viermal
// aufgetreten ist (reine Funktion geprueft, Verdrahtung nicht).
// ⚠️ Kommentare vorher weg, sonst schlaegt der Test an der Erklaerung an.
const quelle = lies("js", "review", "review-garetien-importer.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
wahr(/function avesmapsGaretienFensterOeffnen\(\)[\s\S]{0,400}garetienPanelsBeiseite\(\);/.test(quelle),
	"avesmapsGaretienFensterOeffnen muss die Panels wirklich beiseiteschieben");

// =================================================================================================
// 4. Die Breite -- und der Platz, den das Einklappen freimacht
// =================================================================================================
const css = lies("css", "components", "garetien-importer.css");
const huelle = css.slice(css.indexOf(".gi-win {"), css.indexOf(".gi-win[hidden]"));
wahr(/width: min\(745px,/.test(huelle), "das Fenster ist 745px breit (Owner-Vorgabe)");
wahr(!/min\(800px/.test(css), "und die alten 800px stehen nirgends mehr");

// 🔴 Der freigewordene Platz wird auch BENUTZT -- sonst bliebe der Importer 380px vom Rand stehen
// und liesse eine leere Spalte, wo eben noch der Planer war.
// 💣 Die Weiche ist die Klasse, die auch die Lasche liest, nicht ein eigener Merker:
// `--avesmaps-planner-width` ist ein FESTER Token und aendert sich beim Einklappen nicht.
wahr(/html\.avesmaps-planner-collapsed \.gi-win \{/.test(css),
	"es braucht eine Regel fuer den eingeklappten Planer");
const eingeklappt = css.slice(css.indexOf("html.avesmaps-planner-collapsed .gi-win {"));
const eingeklapptRumpf = eingeklappt.slice(0, eingeklappt.indexOf("}") + 1);
wahr(!/--avesmaps-planner-width/.test(eingeklapptRumpf),
	"eingeklappt darf die Planerbreite NICHT mehr abgezogen werden: " + eingeklapptRumpf);
// ⚠️ Die Lasche bleibt sichtbar und rutscht auf left:0 -- ihre Breite muss weiter mitgerechnet
// werden, sonst liegt das Fenster auf dem einzigen Knopf, der den Planer zurueckholt.
wahr(/--avesmaps-tab-w/.test(eingeklapptRumpf),
	"aber die Lasche zaehlt weiter mit: " + eingeklapptRumpf);

console.log(`garetien-freischalten: ${checks} Pruefungen bestanden.`);
