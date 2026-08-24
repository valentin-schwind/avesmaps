/**
 * „Rechnen ▾" im Landschaften-Editor — das Menüband nach Entwurf C (24.08.2026).
 *
 * Die vier Batch-Läufe (Zugehörigkeit, Höhenraster, Wegprofile, Kurven) stehen in EINEM Sammelmenü
 * statt als vier Kacheln. Owner-Entscheid; Mockup docs/landschaften-menueband-mockup.html.
 *
 * 🔴 Zwei Zusicherungen sind hier die tragenden, nicht die Zählung:
 *    · der NOTAUS bleibt draußen (Teil 4),
 *    · die Unterzeile sagt, was läuft (Teil 5) — sonst nimmt ein zugeklapptes Menü dem Editor die
 *      Rückmeldung eines 20-Sekunden-Laufs.
 */

"use strict";

const fs = require("fs");
const path = require("path");

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

const WURZEL = path.join(__dirname, "..", "..", "..");
const HTML = fs.readFileSync(path.join(WURZEL, "html", "landschaften-editor.html"), "utf8");
const CSS = fs.readFileSync(path.join(WURZEL, "css", "components", "editor-page.css"), "utf8");

// Das Menüband ohne Kommentare -- sonst schlägt jede Suche auf der Erklärung an, warum etwas weg
// ist. (Genau diese Falle hat der Wappen-Test schon einmal gehabt, und beim Bau dieses Umbaus
// meldete eine Prüfung auf "ribbon-menu.js" Vollzug, weil sie den frischen KOMMENTAR fand.)
const bandVon = HTML.indexOf('<div class="avm-ribbon">');
const bandBis = HTML.indexOf("<!-- Statuszeile");
pruefe(bandVon > -1 && bandBis > bandVon, "das Menüband ist auffindbar");
const BAND = HTML.slice(bandVon, bandBis).replace(/<!--[\s\S]*?-->/g, "");

// ---- 1. Drei Kacheln im Band, nicht sieben ----------------------------------------------------
// Der Weg dahin, an einem Tag: SIEBEN (Syncen · Zugehörigkeit · Wiki zuweisen · Höhenraster ·
// Wegprofile · Geländeabhängiges Reisen · Kurven) → VIER, als die vier Läufe ins Sammelmenü zogen
// → DREI, als „Wiki zuweisen" fiel (Owner: „nicht mehr nötig" -- die Zuweisung sitzt seit dem
// 16.08.2026 im geteilten Bauteil je Objekt, der Massenlauf war die Erstbefüllung).
// Übrig: 🚨 Syncen · Rechnen ▾ · Geländeabhängiges Reisen.
// ⚠️ Gezählt werden die Kacheln des Bandes -- nicht die Knöpfe insgesamt, denn die vier „starten"
// IM Panel sind auch <button>.
{
	const kacheln = (BAND.match(/<button[^>]*class="avm-tile/g) || []).length;
	const imPanel = (BAND.match(/<button[^>]*class="rb-menu__sw"/g) || []).length;
	pruefe(kacheln === 3, `DER KERN VON TEIL 1: das Band trägt ${kacheln} Kacheln, erwartet 3`);
	pruefe(imPanel === 4, `DER KERN VON TEIL 1: im Menü stehen ${imPanel} Läufe, erwartet 4`);
	// 💣 Und die Kachel, die gefallen ist, bleibt gefallen -- restlos, nicht halb. Ein Zuhörer ohne
	// Kachel ist ein `addEventListener` auf null und nimmt beim Laden die ganze Seite mit.
	const ohneKommentare = HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
	for (const kennung of ["ecoAssignAll", "runAssignAll", "avesmapsWikiMassenlauf("]) {
		pruefe(!ohneKommentare.includes(kennung), `„${kennung}" ist wieder da -- „Wiki zuweisen" fiel am 24.08.2026`);
	}
}

// ---- 2. Die vier Läufe stehen NICHT mehr als eigene Kacheln -----------------------------------
// 💣 Die Prüfung muss die KACHEL treffen, nicht die Kennung: `ecoCurves` kommt weiterhin vor -- im
// Panel. Eine Suche nach der blossen ID wäre trivial wahr und würde einen Rückbau nie sehen.
for (const id of ["ecoRaycast", "ecoHeightmap", "ecoProfiles", "ecoCurves"]) {
	const alsKachel = new RegExp('<button[^>]*class="avm-tile"[^>]*id="' + id + '"').test(BAND)
		|| new RegExp('<button[^>]*id="' + id + '"[^>]*class="avm-tile"').test(BAND);
	pruefe(!alsKachel, `${id} steht wieder als eigene Kachel im Band`);
	pruefe(new RegExp('class="rb-menu__sw" id="' + id + '"').test(BAND),
		`${id} fehlt als Zeilenknopf im Menü`);
}

// ---- 3. Sammelknopf, Panel, Kennungen ---------------------------------------------------------
for (const id of ["ecoRunMenu", "ecoRunMenuPanel", "ecoRunMenuState"]) {
	pruefe(HTML.includes(`id="${id}"`), `${id} fehlt im Markup`);
}
pruefe(/id="ecoRunMenu"[^>]*aria-haspopup="true"/.test(HTML), "der Sammelknopf sagt aria-haspopup");
pruefe(/id="ecoRunMenuPanel"[^>]*hidden/.test(HTML), "das Panel startet zugeklappt");
// Die Info-Spans der vier reisen mit -- das Skript schreibt weiterhin in sie hinein.
for (const id of ["ecoRaycastInfo", "ecoHeightmapInfo", "ecoProfilesInfo", "ecoCurvesInfo"]) {
	pruefe(BAND.includes(`id="${id}"`), `${id} ist beim Umzug ins Menü verlorengegangen`);
}

// ---- 4. DER NOTAUS BLEIBT DRAUSSEN ------------------------------------------------------------
// 🔴 „Geländeabhängiges Reisen" schaltet `app_setting['terrain_travel_enabled']` und wirkt für ALLE
// Besucher. Er gehört thematisch zu Höhenraster und Wegprofilen -- und trotzdem nicht ins Menü: ein
// Notaus, dessen Stand man aufklappen muss, ist keiner. Dieselbe Regel, die beim Wappen-Menü die
// Unterzeile erzwingt.
{
	// 🪤 Der erste Anlauf prüfte das mit `panel[\s\S]*?notaus` -- das trifft über beliebige Distanz
	// und meldete den Notaus als „im Menü", obwohl er zwei Zeilen DAHINTER steht. Eine Suche, die
	// Verschachtelung behaupten will, muss sie zählen, nicht raten. Also: den Panelbereich exakt
	// ausschneiden, über die <div>-Bilanz ab dem Panel.
	const start = HTML.indexOf('<div class="rb-menu__panel');
	let tiefe = 0, ende = -1;
	for (const treffer of HTML.slice(start).matchAll(/<div\b|<\/div>/g)) {
		tiefe += treffer[0] === "</div>" ? -1 : 1;
		if (tiefe === 0) { ende = start + treffer.index + treffer[0].length; break; }
	}
	pruefe(start > -1 && ende > start, "der Panelbereich ist abgrenzbar");
	const PANEL = HTML.slice(start, ende);
	pruefe(!PANEL.includes('id="ecoTerrainTravel"'),
		"DER KERN VON TEIL 4: der Notaus ist ins Menü gewandert -- sein Stand wäre versteckt");
	// Gegenprobe, dass der Ausschnitt überhaupt etwas enthält -- sonst wäre die Zeile darüber
	// trivial wahr (die Falle aus AGENTS.md: eine Zusicherung, die ihr Subjekt nie sieht).
	pruefe(PANEL.includes('id="ecoCurves"') && PANEL.includes('id="ecoRaycast"'),
		"der Panelausschnitt ist leer -- die Notaus-Prüfung wäre wertlos");
	pruefe(/<button[^>]*class="avm-tile"[^>]*id="ecoTerrainTravel"/.test(BAND),
		"DER KERN VON TEIL 4: der Notaus steht nicht mehr als eigene Kachel im Band");
}

// ---- 5. Die Unterzeile sagt, WAS LÄUFT --------------------------------------------------------
// 💣 Drei der vier Läufe dauern lange (Kurven rund 20 s). Zugeklappt wäre die Rückmeldung weg --
// der Kommentar an `runCurveLabels` sagt selbst: „ohne diesen Satz sieht ein Editor eine tote
// Seite". Ohne diese Verdrahtung darf das Menü die Läufe nicht schlucken.
pruefe(/function zeigeRechnenStand/.test(HTML), "die Zustandsanzeige fehlt");
pruefe(/function verdrahteRechnenStand/.test(HTML), "die Verdrahtung der Zustandsanzeige fehlt");
pruefe((HTML.match(/verdrahteRechnenStand\(\)/g) || []).length >= 2,
	"verdrahteRechnenStand wird nie gerufen");
pruefe(/rechnet …/.test(HTML), "DER KERN VON TEIL 5: die Unterzeile nennt den laufenden Lauf nicht");
// ⭐ Gelesen wird `disabled` der Knöpfe -- die Wahrheit, die die Läufe ohnehin führen -- statt eines
// zweiten Zustands daneben, der im Fehlerpfad auseinanderliefe.
pruefe(/MutationObserver\(zeigeRechnenStand\)/.test(HTML),
	"der Stand wird nicht am disabled der Knöpfe beobachtet");
pruefe(/attributeFilter:\s*\[\s*"disabled"\s*\]/.test(HTML), "der Beobachter filtert nicht auf disabled");
for (const id of ["ecoRaycast", "ecoHeightmap", "ecoProfiles", "ecoCurves"]) {
	pruefe(new RegExp('\\["' + id + '",').test(HTML), `${id} fehlt in RECHNEN_LAEUFE`);
}

// ---- 6. Das Bauteil ist geladen, und zwar VOR seinem Aufruf -----------------------------------
// 💣 Ein `avesmapsRibbonMenuAttachById(...)` ohne das <script>-Tag ist ein ReferenceError beim
// Laden, der die GANZE Seite mitnimmt -- nicht nur das Menü.
pruefe(HTML.includes('<script src="/js/ui/ribbon-menu.js"></script>'),
	"das <script>-Tag für ribbon-menu.js fehlt");
{
	const tag = HTML.indexOf('<script src="/js/ui/ribbon-menu.js"></script>');
	const ruf = HTML.indexOf("avesmapsRibbonMenuAttachById(");
	pruefe(tag > -1 && ruf > tag, "der Aufruf steht VOR dem <script>-Tag -- Ladereihenfolge");
	pruefe((HTML.match(/avesmapsRibbonMenuAttachById\(/g) || []).length === 1,
		"der Anhänge-Aufruf steht mehrfach -- zwei Handlersätze heben sich auf");
}
// 🪤 Und `const` wird nicht gehoistet: steht die Liste hinter ihrem ersten Benutzer und läuft der
// zur Ladezeit, ist es ein ReferenceError. Hier läuft `wireRibbon()` erst weiter unten -- geprüft,
// damit ein Verschieben auffällt.
{
	const constBei = HTML.indexOf("const RECHNEN_LAEUFE");
	const rufBei = HTML.lastIndexOf("wireRibbon();");
	pruefe(constBei > -1 && rufBei > constBei,
		"wireRibbon() läuft vor `const RECHNEN_LAEUFE` -- ReferenceError (const wird nicht gehoistet)");
}

// ---- 7. Die vier behalten ihre eigene Verdrahtung ---------------------------------------------
for (const [id, fn] of [["ecoRaycast", "runRaycast"], ["ecoHeightmap", "runHeightmaps"],
	["ecoProfiles", "runTerrainProfiles"], ["ecoCurves", "runCurveLabels"]]) {
	pruefe(new RegExp('\\$\\("' + id + '"\\)\\.addEventListener').test(HTML),
		`${id} wird nicht mehr verdrahtet`);
	pruefe(HTML.includes(fn + "("), `${fn} wird nicht mehr gerufen`);
}

// ---- 8. Das CSS kennt die Kachelform dieses Editors -------------------------------------------
// 💣 `.rb-menu > .btn2` allein reicht NICHT: dieser Editor baut aus `.avm-tile`. Ohne die zweite
// Zeile schrumpft der Sammelknopf auf seine Textbreite und lässt den Rest der Gitterspalte leer --
// genau die Lücke, die der Owner am 23.08.2026 im Bild markieren musste.
pruefe(/\.rb-menu\s*>\s*\.avm-tile\s*\{[^}]*width:\s*100%/.test(CSS)
	|| /\.rb-menu\s*>\s*\.btn2,\s*\n?\s*\.rb-menu\s*>\s*\.avm-tile\s*\{[^}]*width:\s*100%/.test(CSS),
	"DER KERN VON TEIL 8: .rb-menu füllt seine Spalte nur für .btn2, nicht für .avm-tile");
pruefe(/\.rb-menu\s*>\s*\.avm-tile\[aria-haspopup\]/.test(CSS),
	"der Akzentrand des Sammelknopfs fehlt für .avm-tile");

if (fehler === 0) console.log("OK: rechnen-menue-verdrahtung -- alle Zusicherungen gehalten");
else { console.error(fehler + " Zusicherung(en) gebrochen"); process.exit(1); }
