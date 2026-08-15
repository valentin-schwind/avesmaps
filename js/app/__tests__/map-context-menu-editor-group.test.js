// Die Editor-Gruppe im Kartenmenue (Rechtsklick): „Anlegen — nur Editoren", Trennlinie darunter.
// Entwurf/Mockup: docs/editor-kennzeichnung-mockup.html §4
//
// Owner 13.08.2026: die Gruppe BLEIBT oben, es kommen nur Trenner und Merkmal dazu. Genau daraus
// folgen die Fallen, die hier festgehalten werden -- sie haengen alle daran, WO die Ueberschrift
// steht und WORAN das Untermenue haengt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/map-context-menu-editor-group.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const indexHtml = read("index.html");
const css = read("css", "components", "map-context-menu.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Abgegrenzt am NAECHSTEN Menue statt an einer Einrueckung: die Datei hat CRLF, und eine
// Tab-Zaehlung im Muster ist genau die Art Annahme, die beim naechsten Umformatieren still bricht
// (der erste Entwurf dieses Tests las so nur die halbe Liste und behauptete trotzdem etwas).
const menue = indexHtml.match(/<div id="map-context-menu"[\s\S]*?(?=<div id="region-context-menu")/);
assert.ok(menue, "index.html traegt das Kartenmenue");
const inhalt = menue[0];
assert.ok(inhalt.includes('data-context-action="start-distance-measurement"'),
	"und der Ausschnitt reicht bis zum letzten Eintrag -- sonst prueft alles darunter nichts");

// ---- Die Ueberschrift steht VOR der Gruppe -- und AUSSERHALB ----------------------------------
//
// 💣 Die tragende Falle: `.map-context-submenu` ist mit `top: -5px` an der GRUPPE verankert
// (position: relative). Waere die Ueberschrift IN der Gruppe, begaenne die Gruppe an der
// Ueberschrift statt am Knopf -- und das Untermenue klappte um deren Hoehe zu weit oben auf,
// vorbei an dem Eintrag, zu dem es gehoert. Sichtbar nur, wenn man tatsaechlich hoveрt.
const titelAt = inhalt.indexOf('class="map-context-menu__title"');
const gruppeAt = inhalt.indexOf('class="map-context-menu__group map-context-menu__group--editor"');
assert.ok(titelAt > -1, "die Ueberschrift gibt es");
assert.ok(gruppeAt > -1, "die Editor-Gruppe gibt es");
assert.ok(titelAt < gruppeAt, "die Ueberschrift steht VOR der Gruppe");

const gruppe = inhalt.slice(gruppeAt).match(/[\s\S]*?<\/div>\s*<\/div>/);
assert.ok(gruppe, "die Gruppe laesst sich abgrenzen");
assert.ok(!gruppe[0].includes("map-context-menu__title"),
	"und sie steht NICHT in der Gruppe -- sonst verrutscht das Untermenue um ihre Hoehe");

// ---- Die Gruppe bleibt OBEN --------------------------------------------------------------------
//
// 🔴 Owner-Entscheid 13.08.2026. Ein Umzug nach unten braeuchte ein Untermenue, das nach oben
// ausweichen kann (es ist oben verankert und waere sonst aus dem Bildschirm gewachsen).
// ⚠️ Anker "what-is-here", NICHT "share-pin": der Eintrag "Stelle markieren und teilen" ist am
// 15.08.2026 ganz gefallen ("hat durch 'Was ist hier?' keine richtige Funktion und kann weg") --
// "was-ist-hier" ist seither der erste Besucher-Eintrag nach der Editor-Gruppe.
const erstesBesucherItem = inhalt.indexOf('data-context-action="what-is-here"');
assert.ok(erstesBesucherItem > gruppeAt,
	"die Editor-Gruppe steht vor den Besucher-Eintraegen (Owner: sie bleibt oben)");

// ---- EIN Zustand: das `hidden` der Gruppe ------------------------------------------------------
//
// 💣 bootstrap.js nimmt der GRUPPE ihr `hidden` (js/app/bootstrap.js). Bekaeme die Ueberschrift ein
// eigenes, gaebe es zwei Zustaende und genau einen Aufrufer -- beim naechsten Umbau stuende eine
// goldene Zeile ueber nichts, und zwar auf der oeffentlichen Karte.
const titelTag = inhalt.slice(titelAt - 40, titelAt + 200).match(/<p class="map-context-menu__title"[^>]*>/);
assert.ok(titelTag, "die Ueberschrift ist ein <p>");
assert.ok(!/\shidden(\s|>)/.test(titelTag[0]),
	"sie traegt KEIN eigenes hidden -- ihre Sichtbarkeit leitet sich per :has() ab");
assert.ok(/\.map-context-menu__title:has\(\+ \.map-context-menu__group\[hidden\]\)\s*\{[^}]*display:\s*none/.test(css),
	"und das CSS leitet sie tatsaechlich vom hidden der Gruppe ab");
assert.ok(/data-context-action="add-here"[^>]*\shidden/.test(gruppe[0]) || /\shidden[^>]*data-context-action="add-here"/.test(inhalt.slice(gruppeAt, gruppeAt + 300)),
	"die Gruppe selbst startet versteckt");

// ---- Die Haken, an denen JS haengt, sind unveraendert -------------------------------------------
//
// 💣 Drei Dateien greifen ueber genau diesen Selektor zu (bootstrap.js:375 nimmt das `hidden`,
// ecosystem-context-action.js und ecosystem-territory-import.js haengen Eintraege ins Untermenue).
// Keine davon wuerde einen Fehler werfen -- sie fänden schlicht nichts mehr.
assert.ok(/<div class="map-context-menu__group map-context-menu__group--editor" data-context-action="add-here"/.test(inhalt),
	"die Gruppe traegt weiterhin data-context-action=\"add-here\"");
assert.ok(gruppe[0].includes('class="map-context-submenu"'),
	"und das Untermenue liegt weiterhin IN der Gruppe (die drei Aufrufer suchen es als Nachfahren)");

// ---- Der Trenner steht UNTER der Gruppe ---------------------------------------------------------
//
// Oben waere er eine Linie am oberen Rand des Kastens und laese sich als Rahmen, nicht als Trennung.
const gruppenRegel = css.match(/\.map-context-menu__group--editor\s*\{[^}]*\}/);
assert.ok(gruppenRegel, "die Editor-Gruppe hat eine eigene Regel");
assert.ok(/border-bottom:\s*1px solid var\(--color-divider\)/.test(gruppenRegel[0]),
	"der Trenner steht UNTER der Gruppe und kommt aus dem Token");
assert.ok(!/border-top:/.test(gruppenRegel[0]), "und nicht darueber");

// 💣 Und KEINE negativen Seitenraender. Die Gruppe ist der Positionsanker des Untermenues
// (`left: 100%`) UND der unsichtbaren Hover-Bruecke (`::after`, ebenfalls `left: 100%`). Ein
// negativer Rand schoebe beide um denselben Betrag nach rechts -- zwei Werte, die von da an fuer
// immer gemeinsam wandern muessten, ohne dass irgendwo steht, dass sie zusammengehoeren.
assert.ok(!/margin-left:\s*calc\(/.test(gruppenRegel[0]) && !/margin-right:\s*calc\(/.test(gruppenRegel[0]),
	"die Gruppe traegt keine negativen Seitenraender -- sie ist der Anker des Untermenues");

// ---- Das Merkmal ist das hausweite, in eigenem <span> --------------------------------------------
const titelBlock = inhalt.slice(titelAt - 40).match(/<p class="map-context-menu__title"[\s\S]*?<\/p>/);
assert.ok(titelBlock, "die Ueberschrift laesst sich abgrenzen");
assert.ok(/<span class="avesmaps-scope-hint" data-i18n="ui\.editorOnly">/.test(titelBlock[0]),
	"das Merkmal traegt die hausweite Klasse und den hausweiten Schluessel");
assert.ok(/<span data-i18n="ctxmenu\.groupAdd">/.test(titelBlock[0]),
	"und der eigene Text steckt in einem ZWEITEN span -- data-i18n am <p> loeschte das Merkmal mit");
assert.ok(/"ctxmenu\.groupAdd"\s*:/.test(read("js", "app", "i18n-en.js")),
	"ctxmenu.groupAdd ist auf Englisch hinterlegt");

console.log("map-context-menu-editor-group ok");
