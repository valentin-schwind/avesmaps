// Ist der Pruefhaken „Doppelte Beschriftungen" WIRKLICH angeschlossen?
//
// 💣 DER TEST NEBENAN PRUEFT DIE REGEL, DIESER DIE LEITUNG. Ein Pruefer, den niemand ruft, ist eine
// Funktion mit Testabdeckung und ohne Wirkung.
//
// ⭐ Das Schalter-Modul wird WIRKLICH GEFAHREN, mit gefaelschtem jQuery und gefaelschten Bestaenden.
// Nur das Markup und die zwei Zeichner werden im Quelltext gemessen -- ohne ihre Kommentare.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/doppelte-beschriftung-verdrahtung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...t), "utf8"));
const roh = (...t) => fs.readFileSync(path.join(wurzel, ...t), "utf8");

// ================================================================================================
// A. Das Schalter-Modul wirklich fahren
// ================================================================================================
let hakenAn = true;
global.$ = (sel) => ({ is: (was) => (sel === "#toggleDuplicateLabels" && was === ":checked" ? hakenAn : false) });
global.window = global;
global.IS_EDIT_MODE = true;
global.map = { da: true };
global.document = { documentElement: {} };

// Der Bestand: „Inoscha" einmal als Label und einmal als Weg, „Hexenwald" zweimal als Label.
global.labelData = [
	{ text: "Inoscha" }, { text: "Hexenwald" }, { text: "Hexenwald" }, { text: "Gareth" },
];
// 💣 Der Weg traegt seinen MASCHINENnamen in `properties.name` -- genau die Falle, die den
// Wiki-Haken gekostet hat. Der echte Name kommt von getPathTitleName.
global.pathData = [
	{ properties: { name: "Flussweg-2191", original_name: "Inoscha" } },
	{ properties: { name: "Strasse-99", original_name: "" } },
];
global.getPathTitleName = (weg) => String(weg?.properties?.original_name || "").trim();

Object.assign(global, require(path.join(wurzel, "js", "map-features", "doppelte-beschriftung.js")));
require(path.join(wurzel, "js", "map-features", "map-features-doppelte-beschriftung-check.js"));

pruefe(typeof global.avesmapsDoppelteBeschriftungMarke === "function", "das Modul meldet die Marke an");
pruefe(typeof global.avesmapsSyncDoppelteBeschriftungCheck === "function", "und den Nachzieher");

// --- die Befunde ------------------------------------------------------------------------------
// 🔴 DER GEMELDETE FALL: „Inoscha" ist einmal Label und einmal Weg -- und genau den findet eine
// Regel nicht, die nur labelData gegen sich selbst haelt.
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Inoscha" }), true,
	"Label + gleichnamiger Weg ist ein Befund");
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Hexenwald" }), true,
	"zweimal als Label ebenso");
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Gareth" }), false, "ein einmaliger Name nicht");
// ⚠️ Kein Zaehler im Modul: die sieben Nachbarn in der Gruppe „Prüfen“ tragen auch keine Zahl in
// ihrer Zeile, und eine Funktion, die niemand anzeigt, waere toter Code mit Testabdeckung.
ist(labelData.filter((l) => global.avesmapsDoppelteBeschriftungMarke(l)).length, 3,
	"drei Beschriftungen tragen den Befund");

// 💣 Der Weg OHNE Menschennamen darf nichts ausloesen -- sonst wuerde jeder der 3798 automatisch
// benannten Wege mitzaehlen.
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Strasse-99" }), false,
	"ein Maschinenname am Weg zaehlt nicht");

// --- der Haken schaltet wirklich ----------------------------------------------------------------
hakenAn = false;
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Inoscha" }), false, "Haken aus -> kein Befund");
ist(global.avesmapsIstDoppelteBeschriftungCheckAktiv(), false, "und der Schalter meldet das");
hakenAn = true;
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Inoscha" }), true, "Haken an -> wieder Befund");

// 💣 Der Bearbeiten-Riegel: `?toggleDuplicateLabels=1` erreicht sonst auch einen Besucher.
global.IS_EDIT_MODE = false;
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Inoscha" }), false,
	"ohne Bearbeiten-Modus wirkt der Haken nicht");
global.IS_EDIT_MODE = true;

// --- die Ablage laeuft nicht davon --------------------------------------------------------------
// 💣 Sie haengt an den BESTANDSGROESSEN: eine geloeschte Beschriftung darf keine Dublette
// hinterlassen, die es nicht mehr gibt.
global.labelData = [{ text: "Inoscha" }, { text: "Hexenwald" }, { text: "Gareth" }];
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Hexenwald" }), false,
	"faellt eine der zwei Beschriftungen weg, ist es keine Dublette mehr");
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Inoscha" }), true,
	"der Weg-Fall bleibt aber bestehen");

// ⚠️ Bei GLEICHER Anzahl faengt die Groessenprobe nichts -- deshalb wirft der Sync sie ausdruecklich weg.
global.labelData = [{ text: "Inoscha" }, { text: "Gareth" }, { text: "Gareth" }];
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Gareth" }), false,
	"bei gleicher Anzahl haelt die Ablage noch den alten Stand");
global.avesmapsDoppelteBeschriftungAblageVerwerfen();
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Gareth" }), true,
	"nach dem Verwerfen stimmt sie wieder");

// --- das Nachziehen: DREI Dinge, und das erste ist neu -------------------------------------------
let sichtbarkeit = 0;
let icons = 0;
let kurven = 0;
global.syncLabelVisibility = () => { sichtbarkeit += 1; };
global.avesmapsLabelIconsNeuBauen = () => { icons += 1; };
global.avesmapsKurvenlabelAblageVerwerfen = () => { kurven += 1; };
global.avesmapsSyncDoppelteBeschriftungCheck();
// 💣 `syncLabelVisibility` ist der Unterschied zum Scheinwerfer-Nachbarn: ein markierter Name
// ueberspringt sein Zoomband, dieser Haken aendert also die SICHTBARKEIT und nicht nur das Bild.
ist(sichtbarkeit, 1, "die Sichtbarkeit wird nachgezogen");
ist(icons, 1, "die waagerechten Beschriftungen werden neu gebaut");
ist(kurven, 1, "und die Ablage der gebogenen verworfen");

// 💣 UND ER WIRFT SEINEN EIGENEN INDEX WEG. Die Groessenprobe faengt ein UMBENENNEN bei gleicher
// Anzahl nicht -- ohne das Verwerfen meldete der Haken nach einem Label-Speichern eine Dublette,
// die es nicht mehr gibt (oder uebersaehe eine neue). Gemessen statt gelesen: der Bestand wird bei
// GLEICHER Anzahl umbenannt, und danach muss der Sync die Wahrheit zeigen.
// ⚠️ Die Mutationsprobe hat diese Luecke gefunden -- der Test rief das Verwerfen vorher selbst auf
// und haette einen Sync ohne diesen Schritt nie bemerkt.
// ⚠️ ZUERST den Index aufbauen lassen -- der Sync oben hat ihn gerade verworfen, und eine leere
// Ablage baut beim naechsten Zugriff ohnehin neu. Ohne diese Frage misst der Test nichts.
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Gareth" }), true, "der Index steht (Gareth doppelt)");
global.labelData = [{ text: "Inoscha" }, { text: "Brabak" }, { text: "Brabak" }];
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Brabak" }), false,
	"vor dem Sync haelt die Ablage noch den alten Stand");
global.avesmapsSyncDoppelteBeschriftungCheck();
ist(global.avesmapsDoppelteBeschriftungMarke({ text: "Brabak" }), true,
	"der Sync wirft den Index weg -- ein umbenannter Bestand wird sofort richtig gemeldet");

global.IS_EDIT_MODE = false;
global.avesmapsSyncDoppelteBeschriftungCheck();
// (2, nicht 1: der Index-Test darueber hat den Sync ein zweites Mal gefahren.)
ist(sichtbarkeit, 2, "ohne Bearbeiten-Modus wird gar nichts nachgezogen");
global.IS_EDIT_MODE = true;

// ================================================================================================
// B. Markup und Verdrahtung
// ================================================================================================
const MARKUP = lies("index.html");
const BOOT = lies("js", "app", "bootstrap.js");
const KARTE = lies("js", "map-features", "map-features.js");
const ZUSTAND = lies("js", "map-features", "map-features-layer-state.js");
const VORGABE = lies("js", "config.js");
const TOKENS = fs.readFileSync(path.join(wurzel, "css", "base", "tokens.css"), "utf8");
const CSS = fs.readFileSync(path.join(wurzel, "css", "features", "map-labels.css"), "utf8");

pruefe(/id="toggleDuplicateLabelsControl"[^>]*hidden/.test(MARKUP), "die Zeile startet verborgen");
pruefe(MARKUP.includes('id="toggleDuplicateLabels"'), "der Haken steht im Markup");
pruefe(MARKUP.includes('data-i18n="display.check.duplicateLabels"'), "die Beschriftung ist uebersetzbar");

// 🔴 ER STEHT IN DER GRUPPE „Pruefen", nicht bei „Mapstil" -- er rechnet einen Befund aus.
const iChecks = MARKUP.indexOf('id="display-group-checks"');
const iMapstil = MARKUP.indexOf('id="display-group-mapstyle"');
const iHaken = MARKUP.indexOf('id="toggleDuplicateLabelsControl"');
pruefe(iChecks > -1 && iHaken > iChecks && iHaken < iMapstil,
	"der Haken steht in der Gruppe „Prüfen“, nicht bei „Mapstil“");

// 💣 Das Zeichen ist die Legende und traegt die Farbe FEST, nicht per currentColor.
const zeile = MARKUP.slice(iHaken, iHaken + 900);
pruefe(zeile.includes("var(--color-check-duplicate-label)"), "das Zeichen traegt den eigenen Token");
pruefe(!/stroke="currentColor"[^>]*>\s*<path d="M3\.5 4\.5/.test(zeile),
	"und nicht currentColor -- die Farbe ist die Aussage");

pruefe(BOOT.includes('document.getElementById("toggleDuplicateLabelsControl")?.removeAttribute("hidden")'),
	"bootstrap deckt die Zeile auf");
const iEdit = BOOT.indexOf("if (IS_EDIT_MODE) {");
pruefe(iEdit > -1 && BOOT.indexOf('"toggleDuplicateLabelsControl"') > iEdit, "und zwar im Bearbeiten-Zweig");
pruefe(BOOT.includes('document.getElementById("toggleDuplicateLabels")?.setAttribute("disabled", "disabled")'),
	"und sperrt ihn im Besucher-Zweig");

pruefe(/\$\("#toggleDuplicateLabels"\)\.change/.test(KARTE), "der Haken ist verdrahtet");
pruefe(KARTE.includes("avesmapsSyncDoppelteBeschriftungCheck()"), "und ruft den Nachzieher");
// ⚠️ Er reist im geteilten Link mit, anders als der Scheinwerfer: ein Editor zeigt einem anderen
// einen BEFUND, und dafuer sind die Pruefhaken da.
const iH = KARTE.indexOf('$("#toggleDuplicateLabels").change');
const iHEnde = KARTE.indexOf("\n});", iH);
pruefe(iH > -1 && iHEnde > iH, "der Handler laesst sich ausschneiden");
pruefe(KARTE.slice(iH, iHEnde).includes("syncPlannerStateToUrl"),
	"und schreibt seinen Zustand in die URL, wie seine sieben Nachbarn");
pruefe(VORGABE.includes("toggleDuplicateLabels: false"), "die Vorgabe steht in config.js");
pruefe(ZUSTAND.includes('searchParams.get("toggleDuplicateLabels")'), "er wird aus der URL gelesen");
pruefe(ZUSTAND.includes('searchParams.set("toggleDuplicateLabels"'), "und in sie geschrieben");

// --- die Farbe: eigener Token, weit weg von allem, was auf derselben Karte liegt ----------------
function tonAus(name) {
	const t = TOKENS.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{6});"));
	return t ? t[1] : "";
}
function abstand(a, b) {
	const z = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const [A, B] = [z(a), z(b)];
	return Math.round(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 10) / 10;
}
// 💣 GEGEN ALLE, die gleichzeitig auf der Karte liegen koennen -- dieselbe Lehre wie beim
// Scheinwerfer, wo #e0342f vom Wegpunkt-Rot 9,7 entfernt war und der Test nur EINEN Nachbarn kannte.
const NACHBARN = {
	"--color-check-free-label": "der Kasten des Scheinwerfers -- an DERSELBEN Beschriftung moeglich",
	"--color-marker-settlement-site": "der Marker einer besonderen Staette",
	"--color-marker-unconnected-ring": "der Ring eines unverbundenen Ortes",
	"--color-check-no-wiki": "der Schein einer Beschriftung ohne Wiki-Zuweisung",
	"--color-path-open-end": "die Mitte eines offenen Wegendes",
	"--color-marker-waypoint": "der Reise-Wegpunkt",
	"--color-edit-handle": "der Griff einer Flaeche im Bearbeiten-Modus",
};
const MIN_ABSTAND = 40;
const eigen = tonAus("--color-check-duplicate-label");
pruefe(Boolean(eigen), "der eigene Ton ist lesbar");
Object.entries(NACHBARN).forEach(([name, was]) => {
	const ton = tonAus(name);
	pruefe(Boolean(ton), `${name} ist lesbar -- prueft der Test noch das Richtige?`);
	if (!ton || !eigen) { return; }
	const d = abstand(eigen, ton);
	pruefe(d >= MIN_ABSTAND,
		`${eigen} ist zu nah an ${name} (${ton}, Abstand ${d} < ${MIN_ABSTAND}) -- ${was}`);
});
// 💣 Und der Rueckfall im JS muss zeichengleich sein: er ist die Notbremse, nicht ein zweiter Wert.
const TRICHTER = roh("js", "map-features", "label-markierungen.js");
pruefe(TRICHTER.includes(`"${eigen}"`), "der JS-Rueckfall traegt denselben Wert wie der Token");

pruefe(CSS.includes(".map-label--doppelt"), "die CSS-Regel gibt es");
pruefe(CSS.includes("outline: 2px solid var(--color-check-duplicate-label)"),
	"und sie zieht eine outline, kein border");

// --- Ladereihenfolge ---------------------------------------------------------------------------
const REIHE = roh("index.html");
const iRegel = REIHE.indexOf('src="js/map-features/doppelte-beschriftung.js"');
const iTrichter = REIHE.indexOf('src="js/map-features/label-markierungen.js"');
const iLabels = REIHE.indexOf('src="js/map-features/map-features-labels.js"');
const iSchalter = REIHE.indexOf('src="js/map-features/map-features-doppelte-beschriftung-check.js"');
pruefe(iRegel > -1 && iTrichter > -1 && iSchalter > -1, "alle drei Skripte sind eingebunden");
pruefe(iRegel < iLabels && iTrichter < iLabels,
	"Regel und Trichter laden VOR map-features-labels.js (`const` wird nicht gehoistet)");
pruefe(iSchalter > iLabels, "der Schalter danach");

console.log(`doppelte-beschriftung-verdrahtung.test: OK (${pruefungen} Zusicherungen)`);
