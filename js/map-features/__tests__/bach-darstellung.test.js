// Der Bach ist ein HALBER FLUSS -- Owner 31.08.2026, woertlich: "bach is halb so breit wie n fluss,
// die schrift is 2px kleiner". Dazu zwei Erscheinungsstufen: die Linie ab Zoom 3, der Name ab Zoom 5.
//
// ⭐ Der Test ruft die Regeln WIRKLICH auf (vm.runInThisContext, Vorbild wegenamen-grundgroesse.test.js).
// Nur die Verdrahtung der beiden Breiten-Erzeuger und der Pfeile ist ein Quelltextvertrag -- jene
// Dateien ziehen Leaflet und das DOM nach sich.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/bach-darstellung.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");
const lade = (rel) => vm.runInThisContext(fs.readFileSync(path.join(repoRoot, rel), "utf8"), { filename: rel });
// 🪤 Ein Quelltexttest, der Kommentare mitliest, schlaegt an der WARNUNG an, die vor dem Muster warnt.
const ohneKommentare = (text) => text.split("\n").filter((zeile) => !zeile.trim().startsWith("//")).join("\n");

// --- Umgebung: nur so viel, dass js/config.js und die drei Pfad-Dateien laden --------------------
const knoten = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, setAttribute() {}, addEventListener() {}, dataset: {} });
global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), localStorage: { getItem: () => null, setItem() {} } };
global.document = { documentElement: knoten(), body: knoten(), head: knoten(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: knoten };
// navigator ist in Node 24 nur lesbar -- und js/config.js braucht es nicht.
global.localStorage = global.window.localStorage;

let aktuellerZoom = 5;
global.map = { getZoom: () => aktuellerZoom };
global.$ = () => ({ is: () => true }); // nur #togglePaths wird gefragt

lade("js/map-features/map-features-line-catmull.js"); // js/config.js liest AVESMAPS_CATMULL_DEFAULTS
lade("js/config.js");
lade("js/map-features/map-features-path-domain.js");
lade("js/map-features/map-features-path-labels.js");
lade("js/map-features/map-features-way-labels.js");

const bach = { properties: { feature_subtype: "Flussweg", is_bach: true, show_label: true, wiki_path: { wiki_key: "wiki:bach" } } };
const fluss = { properties: { feature_subtype: "Flussweg", show_label: true, wiki_path: { wiki_key: "wiki:fluss" } } };
const strasse = { properties: { feature_subtype: "Strasse", show_label: true, wiki_path: { wiki_key: "wiki:strasse" } } };
// 🔴 Ein Altweg OHNE feature_subtype -- er haengt am Namens-Rueckfall von normalizePathSubtype.
const altweg = { properties: { name: "Reichsstrasse-5" } };

// ---- 1. Die Breite: halb, und unter Zoom 3 gar nicht -------------------------------------------
assert.strictEqual(typeof pathBreitenFaktor, "function",
	"pathBreitenFaktor ist die EINE Stelle, die 'ein Bach ist halb so breit' kennt");

[0, 1, 2].forEach((z) => assert.strictEqual(pathBreitenFaktor(bach, z), 0,
	`z${z}: Faktor 0 -- pathShouldBeOnMap nimmt den Bach damit VON DER KARTE, nicht nur unsichtbar`));
[3, 4, 5, 6, 7].forEach((z) => assert.strictEqual(pathBreitenFaktor(bach, z), 0.5,
	`z${z}: der Bach ist halb so breit wie der Fluss`));

[0, 1, 2, 3, 4, 5, 6, 7].forEach((z) => assert.strictEqual(pathBreitenFaktor(fluss, z), 1,
	`z${z}: der Fluss bleibt unberuehrt -- Flussweg steht bewusst nicht in PATH_WIDTH_SCALE`));

// Die zwei Zahlen, die der Owner genannt hat -- aus den ECHTEN Grundbreiten gerechnet, nicht abgeschrieben.
assert.strictEqual(getDefaultPathOutlineWidth("Flussweg", 4) * pathBreitenFaktor(bach, 4), 2.5,
	"weisse Kontur 2,5 px");
assert.strictEqual(PATH_CENTER_WEIGHTS.Flussweg * pathBreitenFaktor(bach, 4), 1.5,
	"Fuellung 1,5 px");

// 💣 DIE FALLE: pathAnzeigeSubtyp liefert zwar "Bach", hat aber keinen Namens-Rueckfall. Wer ihn
// hier benutzt, laesst jeden Altweg ohne feature_subtype still auf Faktor 1 fallen.
assert.strictEqual(pathBreitenFaktor(altweg, 3), PATH_WIDTH_SCALE.Reichsstrasse[3],
	"ein Altweg ohne feature_subtype behaelt seinen Namens-Rueckfall");

// ---- 2. BEIDE Breiten-Erzeuger fragen denselben Helfer -----------------------------------------
// 💣 Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel (AGENTS.md, mehrfach bezahlt).
const displayMode = ohneKommentare(lies("js/map-features/map-features-display-mode.js"));
const mapFeatures = ohneKommentare(lies("js/map-features/map-features.js"));
assert.ok(/pathBreitenFaktor\(/.test(displayMode), "pathShouldBeOnMap fragt den gemeinsamen Faktor");
assert.ok(!/getPathWidthScale\(/.test(displayMode), "und nicht mehr getPathWidthScale mit dem Speicher-Subtyp");
assert.ok(/pathBreitenFaktor\(/.test(mapFeatures), "getPathStyleColors ebenso");
assert.ok(!/getPathWidthScale\(/.test(mapFeatures), "und ebenso wenig direkt");

// ---- 3. Die Schrift: 2 px kleiner als der Fluss ------------------------------------------------
const groesse = (p) => Number(String(getPathLabelStyle(p).fontSize).replace("px", ""));

aktuellerZoom = 5;
assert.strictEqual(groesse(bach), 15, "z5: 15 px");
assert.strictEqual(groesse(fluss), 17, "z5: der Fluss bleibt bei 17 px");
aktuellerZoom = 4;
assert.strictEqual(groesse(bach), 14, "z4: 14 px (Tafelwert -- gezeichnet wird er nie, siehe 4.)");
assert.strictEqual(groesse(fluss), 16, "z4: der Fluss bleibt bei 16 px");
assert.strictEqual(groesse(strasse), 14, "die Strasse ist unberuehrt");

// 🔴 Die REGEL, nicht die zwei Zahlen: auf JEDER Stufe genau 2 px weniger als der Fluss. Dreht
// jemand am Fluss, geht der Bach mit -- dass die Zahl heute mit dem Strassenwert zusammenfaellt,
// ist Zufall und darf nicht zur Regel werden.
[0, 1, 2, 3, 4, 5, 6, 7].forEach((z) => {
	aktuellerZoom = z;
	assert.strictEqual(groesse(fluss) - groesse(bach), 2, `z${z}: genau 2 px kleiner als der Fluss`);
});

// ---- 4. Die Erscheinungsstufe 5 -- in BEIDEN Label-Kanaelen ------------------------------------
assert.strictEqual(typeof pathLabelMinZoom, "function", "die Erscheinungsstufe ist eine Regel, keine Konstante");
assert.strictEqual(pathLabelMinZoom(bach), 5, "der Bach zeigt seinen Namen erst ab z5");
assert.strictEqual(pathLabelMinZoom(fluss), 4, "der Fluss weiter ab z4");
assert.strictEqual(pathLabelMinZoom(strasse), 4, "die Strasse ebenso");

pathRiverLabelsVisible = true; // sonst schweigt jeder Flussname, unabhaengig vom Zoom

// Kanal B (map-features-path-labels.js)
aktuellerZoom = 4;
assert.strictEqual(isPathLabelVisibleAtCurrentZoom(bach), false, "Kanal B: bei z4 schweigt der Bach");
assert.strictEqual(isPathLabelVisibleAtCurrentZoom(fluss), true, "Kanal B: der Fluss spricht bei z4");
aktuellerZoom = 5;
assert.strictEqual(isPathLabelVisibleAtCurrentZoom(bach), true, "Kanal B: ab z5 spricht auch der Bach");

// Kanal A (map-features-way-labels.js) -- 💣 er rechnet seine Zoomfrage EINMAL je Redraw. Bliebe das
// ein vorgerechnetes zoomOk, zeigte der wiki-zugewiesene Bach seinen Namen bei z4 und der ohne bei z5.
const ctxBei = (z) => { aktuellerZoom = z; return buildWayLabelEligibilityContext(); };
assert.strictEqual(isWayLabelEligible(bach, ctxBei(4)), false, "Kanal A: bei z4 schweigt der Bach");
assert.strictEqual(isWayLabelEligible(fluss, ctxBei(4)), true, "Kanal A: der Fluss spricht bei z4");
assert.strictEqual(isWayLabelEligible(bach, ctxBei(5)), true, "Kanal A: ab z5 spricht auch der Bach");

// ---- 5. Die Fliessrichtungs-Pfeile gehen mit ---------------------------------------------------
// ⭐ KEINE zweite Zahl: der Pfeil nimmt denselben Faktor wie die Linie. Unter z3 verschwindet er
// ohnehin von selbst, weil die Pfeile pruefen, ob die gezeichnete Linie auf der Karte liegt.
const pfeile = ohneKommentare(lies("js/map-features/map-features-river-flow-arrows.js"));
assert.ok(/pathBreitenFaktor\(/.test(pfeile), "die Pfeile lesen denselben Faktor wie die Linie");
assert.ok(/function drawArrow\([^)]*massstab/.test(pfeile), "und reichen ihn bis ins Zeichnen durch");
assert.ok(/moveTo\(8 \* massstab, 0\)/.test(pfeile), "die Pfeilspitze wird mitskaliert");
assert.ok(/lineWidth = 1\.5 \* massstab/.test(pfeile), "die Kontur des Pfeils ebenso");

console.log("bach-darstellung: alle Zusicherungen erfuellt");

// ---- 6. Der Bach behaelt seine EDITOR-Knoepfe --------------------------------------------------
// 🔴 DIE REGEL: der ANZEIGE-Typ regiert WORTE UND BILDER, der SPEICHER-Typ regiert FUNKTIONEN.
// `pathType` ist seit dem 30.08.2026 "Bach", sobald das Haekchen sitzt -- richtig fuer die Typzeile,
// den Titel eines unbenannten Weges und das Kopfbild. Der Kurzknopf „Stroemung umkehren" hing an
// derselben Weiche und verschwand damit am Bach (Owner 31.08.2026: „das haettest du nicht machen
// sollen"). Er MUSS bleiben: die Fliessrichtungs-Pfeile zeichnen fuer einen Bach weiter (sie fragen
// normalizePathSubtype, also den Speicher-Typ) -- ein Editor sah die Pfeile und hatte keinen Griff
// mehr, sie zu drehen.
const rendering = ohneKommentare(lies("js/map-features/map-features-path-rendering.js"));
assert.ok(/if \(speicherTyp === "Flussweg" && typeof pathFlowShortcutLabelFor === "function"\)/.test(rendering),
	"der Stroemungs-Knopf haengt am SPEICHER-Typ -- ein Bach ist ein Flussweg und behaelt ihn");
assert.ok(!/if \(pathType === "Flussweg"/.test(rendering),
	"und nicht am Anzeige-Typ, der bei einem Bach 'Bach' sagt");

// ---- 7. Der namenlose Wasserweg: „Fluss" oben, die Wegart darunter ----------------------------
// Owner 31.08.2026: „in der infobox 'Unbenannter Flussweg' in 'Unbenannter Fluss' benennen und
// drunter 'Flussweg' wie bei normalen flüssen (bei bach auch)".
// 🔴 Der Untertitel entfiel bei namenlosen Wegen bisher GANZ, weil „Unbenannte Straße" über
// „Straße" sich doppelt liest. Beim Wasser gilt das nicht mehr: der Titel sagt „Fluss", die Zeile
// darunter die Wegart „Flussweg". ⚠️ Beim Bach steht dasselbe Wort zweimal -- ausdruecklicher
// Owner-Entscheid vom 31.08.2026, keine Nachlaessigkeit.
assert.strictEqual(getUnnamedPathTitle("Flussweg"), "Unbenannter Fluss",
	"der Titel heisst 'Fluss', nicht 'Flussweg'");
assert.strictEqual(getUnnamedPathTitle("Bach"), "Unbenannter Bach", "der Bach heisst weiter Bach");
assert.strictEqual(getPathTypeLabel("Flussweg"), "Flussweg",
	"die WEGART heisst unveraendert 'Flussweg' -- sie steht jetzt darunter");
assert.strictEqual(getPathTypeLabel("Bach"), "Bach");
// 🔴 Die Landwege bleiben unberuehrt: dort stuende das Wort wirklich zweimal.
assert.strictEqual(getUnnamedPathTitle("Strasse"), "Unbenannte Straße");
assert.ok(/const istWasserweg = pathType === "Flussweg" \|\| pathType === "Bach";/.test(rendering),
	"die Weiche nennt genau die zwei Wasserwege");
assert.ok(/const subtitle = \(realName \|\| istWasserweg\) \? typeLabel : "";/.test(rendering),
	"der Untertitel kommt bei Wasser auch ohne Namen");

// Die englische Fassung zieht mit -- sonst liest ein Besucher unter ?lang=en weiter „river route",
// und der Bach fehlte dort seit dem 30.08.2026 ganz.
const i18n = lies("js/app/i18n-en.js");
assert.ok(/"path\.unnamed\.Flussweg": "Unnamed river"/.test(i18n), "EN: 'Unnamed river'");
assert.ok(/"path\.type\.Bach":/.test(i18n), "EN kennt die Wegart Bach");
assert.ok(/"path\.unnamed\.Bach":/.test(i18n), "EN kennt den namenlosen Bach");

console.log("bach-darstellung: Abschnitt 7 ebenfalls erfuellt");
