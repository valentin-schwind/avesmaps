// „Mit anderer vereinigen und andere beibehalten" -- die Geste, die die andere Fläche als SCHABLONE
// benutzt statt sie zu fressen. Die Rechnung dahinter prüft ecosystem-boolean.test.js; hier steht
// alles, was in der IIFE von map-features-ecosystem-geometry-ops.js liegt und deshalb nur über den
// Quelltext erreichbar ist.
//
// 💣 DIE EBENEN-REGEL IST DIE EIGENTLICHE ENTSCHEIDUNG DIESER GESTE, und sie sieht falsch aus. Neben
// ihr steht „Mit anderer vereinigen", das über Ebenengrenzen GESPERRT ist -- wer die neue Zeile
// später liest, zieht die Sperre aus Symmetrie nach und nimmt der Geste damit ihren Hauptfall. Der
// Unterschied ist begründet: die Vereinigung LÖSCHT ihr Ziel, das Ziel verlöre also seine Art; die
// behaltende Fassung lässt es stehen. Owner-Entscheid 25.08.2026.
//
// 💣 UND DIE ZWEITE STELLE. Die Ebenen-Regel wird zweimal gelesen -- vom Riegel, der die Operation
// abbricht, und vom Hinweis, der beim Start im Toast steht. Getrennt gepflegt verspricht der Toast
// eine Freiheit, die der Riegel gleich darauf zurücknimmt; genau so stand es bis zum 25.08.2026 bei
// „Mit anderer vereinigen" da.

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
assert.ok(
	/function operationMayCrossKinds\(operation\)\s*{\s*return operation !== "union";/.test(ops),
	"Die Ebenen-Regel steht nicht mehr als eigene Funktion da. Sie ist die Owner-Entscheidung dieser"
	+ " Geste: gebunden ist `union` ALLEIN, weil nur sie ihr Ziel löscht."
);

assert.strictEqual(
	(ops.match(/operationMayCrossKinds\(/g) || []).length,
	3,
	"Die Ebenen-Regel muss GENAU von ihrer Definition plus zwei Lesern getragen werden: dem Riegel in"
	+ " completeTargetOperation und dem Hinweis im Toast. Ein dritter Leser oder ein abgeschriebener"
	+ " Vergleich ist die Divergenz, die den Toast lügen lässt."
);

assert.ok(
	!/operation === "union" && String\(source\.kind\)/.test(ops),
	"Der Riegel vergleicht wieder von Hand gegen \"union\", statt operationMayCrossKinds zu fragen."
);

// 🪤 Der Toast darf „auch auf einer anderen Ebene" nicht mehr bedingungslos versprechen.
const toast = ops.slice(ops.indexOf("TARGET_OPERATIONS.forEach"));
assert.ok(
	toast.includes("operationMayCrossKinds(operation.action)"),
	"Der Hinweis beim Start fragt die Ebenen-Regel nicht. Dann verspricht er auch bei „Mit anderer"
	+ " vereinigen\" eine andere Ebene, und der Riegel nimmt es eine Sekunde später zurück."
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
