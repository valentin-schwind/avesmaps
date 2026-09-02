// Ist „Freie Labels markieren" WIRKLICH angeschlossen?
//
// 💣 DER TEST NEBENAN PRUEFT DIE REGEL, DIESER DIE LEITUNG. freie-label-markierung.test.js kann
// tadellos gruen sein, waehrend auf der Karte kein Kasten erscheint -- eine Regel, die niemand
// ruft, ist eine Funktion mit Testabdeckung und ohne Wirkung.
//
// ⭐ SOWEIT ES GEHT, WIRD AUSGEFUEHRT statt gelesen: das Schalter-Modul braucht nur `document`,
// `getComputedStyle` und ein paar Globale -- die stellt dieser Test hin und faehrt es wirklich.
// Ein `includes("avesmapsFreieLabelMarke(label)")` traefe sonst auch die DEFINITIONSZEILE mit und
// waere Vakuum. Nur die zwei Zeichner haengen an Leaflet und `map`; dort wird der QUELLTEXT
// gemessen -- ohne seine Kommentare.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/freie-label-markierung-verdrahtung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

// 💣 KOMMENTARE RAUS, BEVOR IRGENDETWAS GEMESSEN WIRD -- sonst bestaetigt sich der Test an der
// Begruendung, die ueber der Regel steht. In DIESEM Vorhaben besonders heikel: die Kommentare
// nennen `map-label--markiert` und `avesmapsFreieLabelMarke` mehrfach beim Namen.
function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((zeile) => zeile.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}
const lies = (...teile) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...teile), "utf8"));
const roh = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");

// ================================================================================================
// A. Das Schalter-Modul wirklich fahren
// ================================================================================================

// Ein <select> im Kleinen: nur das, was das Modul anfasst.
function macheFeld() {
	const feld = {
		id: "freeLabelMarkSelect",
		value: "",
		kinder: [],
		set textContent(_wert) { this.kinder = []; },
		get textContent() { return ""; },
		appendChild(kind) { this.kinder.push(kind); },
	};
	return feld;
}

const feld = macheFeld();
global.document = {
	documentElement: {},
	querySelector: (sel) => (sel === "#freeLabelMarkSelect" ? feld : null),
	createElement: () => ({ value: "", textContent: "" }),
};
global.getComputedStyle = () => ({ getPropertyValue: () => " #abcdef " });
global.window = global;
global.IS_EDIT_MODE = true;
global.map = { dummy: true };
global.labelData = [
	{ labelType: "fluss", text: "Inoscha" },
	{ labelType: "wald", text: "Hexenwald" },
	{ labelType: "wald", text: "Jammerwald" },
];
global.avesmapsLabelArtName = require(path.join(wurzel, "js", "ui", "label-arten.js")).avesmapsLabelArtName;
Object.assign(global, require(path.join(wurzel, "js", "map-features", "freie-label-markierung.js")));
require(path.join(wurzel, "js", "map-features", "map-features-freie-label-markierung-check.js"));

pruefe(typeof global.avesmapsFreieLabelMarke === "function", "das Modul meldet avesmapsFreieLabelMarke an");
pruefe(typeof global.avesmapsSyncFreieLabelMarkierung === "function", "und den Nachzieher");
pruefe(typeof global.avesmapsFreieLabelMarkierungFeldFuellen === "function", "und den Feldfueller");

// --- das Feld ---------------------------------------------------------------------------------
global.avesmapsFreieLabelMarkierungFeldFuellen();
ist(feld.kinder.map((k) => k.value).join("|"), "|*|fluss|wald", "Keine, Alle, dann die Arten alphabetisch");
ist(feld.kinder[1].textContent, "Alle (3)", "„Alle“ nennt den ganzen Bestand");
ist(feld.kinder[2].textContent, "Fluss (1)", "und jede Art ihre eigene Anzahl");
ist(feld.kinder[3].textContent, "Wald (2)", "auch die mit mehreren");

// 💣 Die Wahl ueberlebt ein Neuaufbauen -- prepareLabelData laeuft auch nach einem Live-Abgleich.
feld.value = "wald";
global.avesmapsFreieLabelMarkierungFeldFuellen();
ist(feld.value, "wald", "die gewaehlte Art ueberlebt das Neuaufbauen");

// ⚠️ ... aber nur, solange es sie noch gibt.
global.labelData = [{ labelType: "fluss", text: "Inoscha" }];
global.avesmapsFreieLabelMarkierungFeldFuellen();
ist(feld.value, "", "eine verschwundene Art faellt auf „Keine“ zurueck");

// --- die Marke --------------------------------------------------------------------------------
feld.value = "fluss";
ist(global.avesmapsFreieLabelMarke({ labelType: "fluss" }), true, "der Fluss traegt den Kasten");
ist(global.avesmapsFreieLabelMarke({ labelType: "wald" }), false, "der Wald nicht");
feld.value = "";
ist(global.avesmapsFreieLabelMarke({ labelType: "fluss" }), false, "und bei „Keine“ niemand");

// 💣 Der Riegel: ohne Bearbeiten-Modus ist das Feld wirkungslos, auch wenn jemand es von Hand setzt.
feld.value = "*";
global.IS_EDIT_MODE = false;
ist(global.avesmapsFreieLabelMarkierungWahl(), "", "ohne Bearbeiten-Modus ist nichts gewaehlt");
ist(global.avesmapsFreieLabelMarke({ labelType: "fluss" }), false, "und nichts markiert");
global.IS_EDIT_MODE = true;
ist(global.avesmapsFreieLabelMarke({ labelType: "fluss" }), true, "mit Bearbeiten-Modus wieder schon");

// --- die Farbe --------------------------------------------------------------------------------
ist(global.avesmapsFreieLabelFarbe(), "#abcdef", "der Token wird ausgelesen und getrimmt");

// --- das Nachziehen ---------------------------------------------------------------------------
// 💣 ZWEI Zeichenflaechen in EINEM Aufruf. Zoege nur eine nach, traegt der gerade Name derselben
// Landschaft den Kasten und der gebogene nicht -- das liest sich wie ein Befund.
let iconsNeu = 0;
let ablageWeg = 0;
global.avesmapsLabelIconsNeuBauen = () => { iconsNeu += 1; };
global.avesmapsKurvenlabelAblageVerwerfen = () => { ablageWeg += 1; };
global.avesmapsSyncFreieLabelMarkierung();
ist(iconsNeu, 1, "die waagerechten Beschriftungen werden neu gebaut");
ist(ablageWeg, 1, "und die Ablage der gebogenen verworfen");

global.IS_EDIT_MODE = false;
global.avesmapsSyncFreieLabelMarkierung();
ist(iconsNeu, 1, "ohne Bearbeiten-Modus wird gar nicht nachgezogen");
global.IS_EDIT_MODE = true;

// ================================================================================================
// B. Die zwei Zeichner -- Quelltext, weil sie an Leaflet und `map` haengen
// ================================================================================================

const LABEL = lies("js", "map-features", "map-features-labels.js");
const KURVE = lies("js", "map-features", "map-features-path-label-canvas-overlay.js");
const KARTE = lies("js", "map-features", "map-features.js");
const BOOT = lies("js", "app", "bootstrap.js");
const MARKUP = lies("index.html");
const CSS = fs.readFileSync(path.join(wurzel, "css", "features", "map-labels.css"), "utf8");
const TOKENS = fs.readFileSync(path.join(wurzel, "css", "base", "tokens.css"), "utf8");

// Der waagerechte Name: Klasse am divIcon.
pruefe(LABEL.includes('avesmapsFreieLabelMarke(label) ? " map-label--markiert" : ""'),
	"createLabelIcon haengt die Klasse an");
// Der gebogene Name: Kasten auf dem Canvas.
pruefe(KURVE.includes("zeichneMarkierungsrahmen(f.glyphs, f.fontSize, eintrag.markiert)"),
	"der Kurvenmaler zieht den Kasten");
pruefe(/markiert:\s*typeof avesmapsFreieLabelMarke === "function" && avesmapsFreieLabelMarke\(label\)/.test(KURVE),
	"und die Ablage merkt sich beim RECHNEN, ob markiert wird");
// 💣 Der Kasten muss NACH paintGlyphs kommen -- davor maelten die Buchstaben ihn zu.
const iPaint = KURVE.indexOf("paintGlyphs(f.glyphs, f.chars, eintrag.halo, eintrag.fill)");
const iRahmen = KURVE.indexOf("zeichneMarkierungsrahmen(f.glyphs");
pruefe(iPaint > -1 && iRahmen > iPaint, "der Kasten wird NACH den Buchstaben gemalt");

// Das Feld fuellt sich aus dem geladenen Bestand, und der Wechsel zieht nach.
pruefe(LABEL.includes("avesmapsFreieLabelMarkierungFeldFuellen()"),
	"prepareLabelData fuellt das Feld");
pruefe(/\$\("#freeLabelMarkSelect"\)\.change/.test(KARTE), "der Feldwechsel ist verdrahtet");
pruefe(KARTE.includes("avesmapsSyncFreieLabelMarkierung()"), "und ruft den Nachzieher");
// 🔴 UND ER SCHREIBT NICHT IN DIE URL. Ein Parameter, den niemand einliest, sieht wie ein Zustand
// aus -- ein geteilter Link truege dann eine Markierung, die beim Empfaenger nie erscheint.
// ⚠️ NUR der eine Handler, nicht 260 Zeichen ab seinem Anfang: der naechste Block darunter
// (#toggleNodix) ruft syncPlannerStateToUrl, und ein zu weites Fenster liest dessen Zeile als die
// eigene. Genau daran ist dieser Test beim Bau umgefallen.
// 💣 Zeilenendenneutral: `ohneKommentare` hat KARTE schon auf \n gebracht -- und
// ein Rueckfall ueber `||` auf ein indexOf waere hier die Falle aus AGENTS.md §9
// (`-1 + 3` ist truthy und sieht wie eine gueltige Stelle aus).
const iChange = KARTE.indexOf('$("#freeLabelMarkSelect").change');
const iChangeEnde = KARTE.indexOf("\n});", iChange);
pruefe(iChange > -1 && iChangeEnde > iChange, "der Handler laesst sich ausschneiden");
const changeBlock = KARTE.slice(iChange, iChangeEnde);
pruefe(!changeBlock.includes("syncPlannerStateToUrl"),
	"der Feldwechsel schreibt NICHT in die URL (kein Parameter, den niemand liest)");

// Die Gruppe wird nur fuer Editoren aufgedeckt.
pruefe(BOOT.includes('document.getElementById("display-group-free-labels")?.removeAttribute("hidden")'),
	"bootstrap deckt die Gruppe auf");
const iEdit = BOOT.indexOf("if (IS_EDIT_MODE) {");
const iGruppe = BOOT.indexOf('"display-group-free-labels"');
pruefe(iEdit > -1 && iGruppe > iEdit, "und zwar im Bearbeiten-Zweig");

// Das Markup steht da und traegt sein `hidden`.
pruefe(/id="display-group-free-labels"[^>]*hidden/.test(MARKUP), "die Gruppe startet verborgen");
pruefe(MARKUP.includes('id="freeLabelMarkSelect"'), "das Feld steht im Markup");
pruefe(MARKUP.includes('data-i18n="display.group.freeLabels"'), "die Ueberschrift ist uebersetzbar");
// 🔴 UNTER „Mapstil", nicht in der Gruppe „Prüfen" -- es ist eine Anzeige-Einstellung, kein Befund.
const iMapstil = MARKUP.indexOf('id="display-group-mapstyle"');
const iChecks = MARKUP.indexOf('id="display-group-checks"');
const iFrei = MARKUP.indexOf('id="display-group-free-labels"');
pruefe(iFrei > iMapstil && iMapstil > iChecks, "die Rubrik steht UNTER „Mapstil“, nicht in „Prüfen“");

// Der Farbton: eigener Token, und NICHT derselbe Wert wie der Pruefhaken daneben.
pruefe(/--color-check-free-label:\s*#[0-9a-fA-F]{6};/.test(TOKENS), "der Token ist gesetzt");
pruefe(CSS.includes(".map-label--markiert"), "die CSS-Regel gibt es");
pruefe(CSS.includes("outline: 2px solid var(--color-check-free-label)"),
	"und sie zieht eine outline, kein border (border verschoebe das Bild um seine eigene Breite)");

// 💣 GEMESSEN GEGEN ALLE DREI ROTS DER KARTE, nicht nur gegen den einen Nachbarn.
// Hier stand zuerst nur `freiTon !== wikiTon`, und genau darin lag der Fehler: der Ton war
// #e0342f und damit von --color-marker-waypoint (#e33b35) nicht zu unterscheiden -- RGB-Abstand
// 9,7 bei unter 1 Grad Farbtondifferenz. Der Test war gruen, weil er die Frage stellte, die der
// Autor im Kopf hatte, statt die, die die Karte stellt. Gefunden hat es der usability-design-Agent.
// ⚠️ Die Schwelle ist bewusst grob (euklidisch im RGB, kein Lab): sie soll den offensichtlichen
// Fall fangen, nicht Farbwissenschaft betreiben. 40 liegt weit ueber den gemessenen 9,7 und weit
// unter den drei tatsaechlichen Abstaenden (73,5 · 64,8 · 73,2).
const KARTEN_ROTS = {
	"--color-check-no-wiki": "der rote Schein desselben Werkzeugs an DERSELBEN Beschriftung",
	"--color-path-open-end": "die rote Mitte eines offenen Wegendes",
	"--color-marker-waypoint": "der rote Reise-Wegpunkt",
};
const MIN_ABSTAND = 40;
function tonAus(name) {
	const t = TOKENS.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{6});"));
	return t ? t[1] : "";
}
function abstand(a, b) {
	const z = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const [A, B] = [z(a), z(b)];
	return Math.round(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 10) / 10;
}
const freiTon = tonAus("--color-check-free-label");
pruefe(Boolean(freiTon), "der eigene Ton ist lesbar");
Object.entries(KARTEN_ROTS).forEach(([name, was]) => {
	const ton = tonAus(name);
	pruefe(Boolean(ton), `${name} ist lesbar -- prueft der Test noch das Richtige?`);
	if (!ton || !freiTon) { return; }
	const d = abstand(freiTon, ton);
	pruefe(d >= MIN_ABSTAND,
		`${freiTon} ist zu nah an ${name} (${ton}, Abstand ${d} < ${MIN_ABSTAND}) -- ${was}, und beide `
		+ "liegen auf denselben immer-hellen Kartenkacheln");
});

// Die Ladereihenfolge: die reine Regel vor ihrem Leser, der Schalter dahinter.
const REIHE = roh("index.html");
const iRegel = REIHE.indexOf('src="js/map-features/freie-label-markierung.js"');
const iLabels = REIHE.indexOf('src="js/map-features/map-features-labels.js"');
const iSchalter = REIHE.indexOf('src="js/map-features/map-features-freie-label-markierung-check.js"');
pruefe(iRegel > -1 && iLabels > -1 && iSchalter > -1, "alle drei Skripte sind eingebunden");
pruefe(iRegel < iLabels, "die reine Regel laedt VOR map-features-labels.js (const wird nicht gehoistet)");
pruefe(iSchalter > iLabels, "der Schalter danach -- er ruft die Zeichner, sie ihn nur zur Laufzeit");

console.log(`freie-label-markierung-verdrahtung.test: OK (${pruefungen} Zusicherungen)`);
