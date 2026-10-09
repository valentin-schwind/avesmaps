// „Mit anderer vereinigen und andere beibehalten" -- die Geste, die die andere Fläche als SCHABLONE
// benutzt statt sie zu fressen. Die Rechnung dahinter prüft ecosystem-boolean.test.js; hier steht
// alles, was in der IIFE von map-features-ecosystem-geometry-ops.js liegt und deshalb nur über den
// Quelltext erreichbar ist.
//
// 🔴 DIE EBENEN-REGEL HAT SICH AM 09.10.2026 GEDREHT. Bis dahin war „Mit anderer vereinigen" über
// Ebenengrenzen GESPERRT und nur die behaltende Fassung frei (Owner 25.08.2026). Seither entscheidet die
// ANSICHT, welche Flächen Ziel sein können -- nur die der sichtbaren Ebene(n) --, und dann dürfen ALLE
// fünf Gesten mit ihnen arbeiten (Owner: „bei der auswahl immer in der ebene bleiben, die man gerade
// betreibt. ein wechsel auf vegetation oder alles zeigt alles an und erlaubt dann vereinigungen
// damit"). Den Ablauf selbst fährt js/map-features/__tests__/ecosystem-zielwahl.test.js; hier steht,
// was am Quelltext hängt.
//
// 💣 UND DER HINWEIS BEIM START verspricht nur, was die Zielwahl hält: er nennt die gelbe Markierung
// und das Umschalten, nicht mehr „auch auf einer anderen Ebene" -- das tat er bis zum 25.08.2026 bei
// „Mit anderer vereinigen", und der Riegel nahm es eine Sekunde später zurück.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");

const ops = lies("js/map-features/map-features-ecosystem-geometry-ops.js");
const css = lies("css/components/map-context-menu.css");
const englisch = lies("js/app/i18n-en.js");

// ---- der Menüeintrag ----------------------------------------------------------------------------
//
// Die Liste trägt Beschriftung, Verdrahtung und die Überschrift im „Änderungen"-Fenster zugleich --
// es gibt keine zweite Stelle, an der der Eintrag entstehen könnte.
const liste = ops.slice(ops.indexOf("const TARGET_OPERATIONS"), ops.indexOf("];", ops.indexOf("const TARGET_OPERATIONS")));
const aktionen = [...liste.matchAll(/action:\s*"([^"]+)"/g)].map((treffer) => treffer[1]);

assert.deepStrictEqual(
	aktionen,
	["union", "union-keep-target", "difference", "difference-keep-target", "intersection"],
	"TARGET_OPERATIONS weicht ab. Jede behaltende Fassung steht DIREKT unter ihrem Original -- so"
	+ " findet der Editor sie da, wo er sie sucht."
);

assert.ok(
	liste.includes('label: "Mit anderer vereinigen und andere beibehalten"'),
	"Der Wortlaut ist der des Ausschneide-Zwillings, nur mit „vereinigen\" -- zwei Formulierungen für"
	+ " dieselbe Zusage („und andere beibehalten\") wären genau die Divergenz, gegen die die Liste steht."
);

// ---- die Ebenen-Regel ---------------------------------------------------------------------------
//
// 💣 Kommentare gelesen wie Code wären hier die häufigste Art eines grünen Tests, der nichts hält: die
// Prosa nennt die alte Sperre ausdrücklich. Gezählt wird deshalb im Quelltext OHNE Kommentare.
const opsCode = ops.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

assert.ok(
	!/operationMayCrossKinds/.test(opsCode),
	"Die alte Ebenen-Sperre (operationMayCrossKinds) ist zurück. Seit dem 09.10.2026 entscheidet die"
	+ " Ansicht, welche Ebenen Ziele anbieten -- eine zweite Regel daneben lehnte wieder ab, was die"
	+ " Zielwahl gerade angeboten hat."
);
assert.ok(
	!/Vereinigen geht nur innerhalb einer Ebene/.test(opsCode),
	"Die Absage „Vereinigen geht nur innerhalb einer Ebene\" ist zurück -- genau die Meldung, die der"
	+ " Owner am 09.10.2026 bei den Windhagbergen bekam, obwohl er die Windhagberge angeklickt hatte."
);

// Die EINE Frage, welche Ebenen Ziele anbieten -- und sie fragt dieselbe Funktion wie die Pane-Klassen.
const sichtbar = opsCode.slice(opsCode.indexOf("function zielEbeneSichtbar"),
	opsCode.indexOf("function isTargetOperation"));
assert.ok(sichtbar.includes("isEcosystemKindVisible"),
	"zielEbeneSichtbar fragt nicht isEcosystemKindVisible -- dann böte die Zielwahl andere Ebenen an,"
	+ " als die Karte zeigt.");
assert.ok(/"klima"/.test(sichtbar),
	"zielEbeneSichtbar nimmt Klima nicht aus. Ein Klimaband ist abgeleitet und kann nie Ziel sein"
	+ " (avesmapsClimateAssertNotDerived).");

// 🪤 Der Hinweis beim Start: EIN Text für alle fünf, und er sagt, was die Zielwahl wirklich tut.
const toast = opsCode.slice(opsCode.indexOf("TARGET_OPERATIONS.forEach"));
assert.ok(
	/gelb markiert/.test(toast) && /umschalten/.test(toast),
	"Der Hinweis beim Start nennt die gelbe Markierung oder das Umschalten der Ebene nicht mehr -- beides"
	+ " ist die Bedienung der Zielwahl seit dem 09.10.2026."
);

// ---- Glyphe und Übersetzung ---------------------------------------------------------------------
//
// 💣 Die Glyphe ist Pflicht, nicht Zierde: ohne `content` entsteht das ::before gar nicht, und die
// Beschriftung rutscht als erstes Rasterelement von 41 auf 12 px (map-context-menu.css sagt es
// dreimal). Ein Eintrag ohne Glyphe steht sichtbar aus der Reihe.
const glyphenBlock = css.slice(css.indexOf('[data-ecosystem-area-action="union-keep-target"]'));
assert.ok(
	glyphenBlock.startsWith('[data-ecosystem-area-action="union-keep-target"]')
	&& /content:\s*"[^"]+"/.test(glyphenBlock.slice(0, 160)),
	"Der neue Eintrag hat keine Glyphe im CSS -- seine Beschriftung beginnt dann 29 px weiter links"
	+ " als die der vier Nachbarn."
);

// 💣 Der Schlüssel entsteht aus der AKTION (`ecosystem.ctxmenu.${action}`). Fehlt die Zeile, fällt
// der Eintrag unter ?lang=en auf seinen deutschen Wortlaut zurück -- lautlos, mitten im englischen
// Menü.
assert.ok(
	englisch.includes('"ecosystem.ctxmenu.union-keep-target"'),
	"Die englische Beschriftung fehlt. Der Eintrag steht dann als einziger deutsch im Menü, ohne dass"
	+ " irgendetwas bricht."
);

console.log("ok - ecosystem-vereinigen-behalten");
