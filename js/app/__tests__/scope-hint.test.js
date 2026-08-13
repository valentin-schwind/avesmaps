// Das Merkmal „nur Editoren" / „nur Admins" an einer Gruppenueberschrift.
// Entwurf/Mockup: docs/editor-kennzeichnung-mockup.html
//
// Es haengt an vier Stellen, die sich nicht kennen -- Anzeige-Menue, Kachelband der Infobox,
// Kartenmenue, Editor-Huelle. Geprueft wird deshalb genau das, was dabei lautlos kippt:
// eine zweite Definition der Regel, ein Verbraucher ohne das Blatt, und der textContent-Fresser.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/scope-hint.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der
 *  nichts haelt. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ---- EINE Definition, im gemeinsamen Blatt --------------------------------------------------
const hintCss = read("css", "components", "scope-hint.css");
assert.ok(/\.avesmaps-scope-hint\s*\{/.test(withoutComments(hintCss)),
	"css/components/scope-hint.css definiert .avesmaps-scope-hint");

// 💣 Faengt den Rueckfall: jemand schreibt die sieben Zeilen an seinem Bauteil noch einmal hin,
// weil sie dort „gebraucht" werden. Ab der zweiten Definition laufen die beiden auseinander,
// und niemand sieht es, weil beide fuer sich richtig aussehen.
const cssDir = path.join(ROOT, "css");
const alleCss = [];
(function sammle(dir) {
	fs.readdirSync(dir, { withFileTypes: true }).forEach((eintrag) => {
		const p = path.join(dir, eintrag.name);
		if (eintrag.isDirectory()) { sammle(p); return; }
		if (eintrag.name.endsWith(".css")) { alleCss.push(p); }
	});
})(cssDir);
const definierer = alleCss.filter((p) => /\.avesmaps-scope-hint\s*(,|\{)/.test(withoutComments(fs.readFileSync(p, "utf8"))));
assert.strictEqual(definierer.length, 1,
	`genau EIN Blatt definiert das Merkmal, gefunden: ${definierer.map((p) => path.relative(ROOT, p)).join(", ")}`);

// 💣 Und die abgeloeste Klasse ist WEG, nicht danebengelassen. Eine zurueckgelassene Regel
// wirkt weiter, solange irgendwo noch das alte Klassenwort steht -- das ist die zweite Wahrheit
// in ihrer haesslichsten Form: sie stimmt sogar, bis eine der beiden geaendert wird.
alleCss.concat([path.join(ROOT, "index.html")]).forEach((p) => {
	assert.ok(!withoutComments(fs.readFileSync(p, "utf8")).includes("map-display-menu__editor-hint"),
		`${path.relative(ROOT, p)} nennt die abgeloeste Klasse nicht mehr`);
});

// ---- Jeder Verbraucher laedt das Blatt auch --------------------------------------------------
//
// 💣 Faengt: das Merkmal wird auf einer Seite benutzt, die styles.css gar nicht laedt -- die
// Editor-Huelle ist so eine. Dort stuende dann unformatierter Text mitten in der Kopfzeile,
// und zwar nur dort, also genau da, wo man beim Prueft am seltensten hinsieht.
assert.ok(read("css", "styles.css").includes('@import url("components/scope-hint.css")'),
	"die Karte (styles.css) laedt das Blatt");
const editCss = read("css", "pages", "edit.css");
assert.ok(editCss.includes('@import url("../components/scope-hint.css")'),
	"die Editor-Huelle (edit.css) laedt es ebenfalls -- sie kennt styles.css nicht");

// 💣 Und eine Nachbarregel darf das Merkmal nicht ueberstimmen. `.edit-shell__bar span` traf mit
// (0,1,1) JEDES span der Kopfzeile -- auch das Merkmal (0,1,0) -- und faerbte es grau statt in
// seine Pillenfarbe. Unabhaengig von der Ladereihenfolge, also durch kein Umsortieren zu heilen:
// es sah fast richtig aus und war die falsche Farbe. Gemessen am 13.08.2026, nicht vermutet.
assert.ok(!/(^|[\s,>+~])\.edit-shell__bar\s+span\s*[,{]/m.test(withoutComments(editCss)),
	"kein pauschales `.edit-shell__bar span` -- das ueberstimmt das Merkmal in der Kopfzeile");

// ---- Die Sprachschluessel liegen auf Englisch vor ---------------------------------------------
//
// 💣 Faengt: eine deutsche Zeichenkette wird ins Markup geklebt und ist damit fuer ?lang=en
// nicht mehr erreichbar (AGENTS.md §8). Und: der alte Schluessel darf nicht danebenstehen
// bleiben -- zwei Schluessel fuer ein Wort ist dasselbe Uebel wie zwei CSS-Regeln dafuer.
const i18n = read("js", "app", "i18n-en.js");
assert.ok(/"ui\.editorOnly"\s*:/.test(i18n), "ui.editorOnly ist auf Englisch hinterlegt");
assert.ok(/"ui\.adminOnly"\s*:/.test(i18n), "ui.adminOnly ist auf Englisch hinterlegt");
assert.ok(!/"display\.editorOnly"\s*:/.test(i18n),
	"der abgeloeste Schluessel display.editorOnly ist raus, nicht danebengelassen");

// ---- Das Merkmal steht in einem EIGENEN <span> ------------------------------------------------
//
// 💣 Faengt den Fehler, der auf Deutsch unsichtbar ist: `data-i18n` setzt `textContent`
// (js/app/i18n.js) und loescht damit an einem Element mit Kindern die Kinder. Traegt die
// Ueberschrift den Schluessel selbst, ist das Merkmal beim ersten ?lang=en weg.
const indexHtml = read("index.html");
const traeger = indexHtml.match(/<[a-z]+[^>]*class="[^"]*avesmaps-scope-hint[^"]*"[^>]*>/g) || [];
assert.ok(traeger.length >= 2, `das Merkmal wird benutzt (gefunden: ${traeger.length})`);
traeger.forEach((tag) => {
	assert.ok(tag.startsWith("<span"), `das Merkmal haengt an einem <span>, nicht an: ${tag}`);
});
// Und die Ueberschrift, die eines TRAEGT, darf `data-i18n` nicht selbst tragen. Eine Ueberschrift
// OHNE Merkmal darf es sehr wohl -- sie hat keine Kinder, die verloren gehen koennten. Geprueft
// wird deshalb der umschliessende Block, nicht jede Ueberschrift der Seite.
const mitMerkmal = indexHtml.match(/<(p|h[1-6])\b[^>]*>(?:(?!<\/(?:p|h[1-6])>)[\s\S])*?avesmaps-scope-hint[\s\S]*?<\/(?:p|h[1-6])>/g) || [];
assert.strictEqual(mitMerkmal.length, traeger.length,
	"jedes Merkmal steckt in einer Ueberschrift (sonst haengt es frei im Markup)");
mitMerkmal.forEach((block) => {
	const oeffnend = block.slice(0, block.indexOf(">") + 1);
	assert.ok(!oeffnend.includes("data-i18n="),
		`die Ueberschrift MIT Merkmal traegt den Schluessel nicht selbst -- sonst frisst textContent das Merkmal: ${oeffnend}`);
	assert.ok(/<span[^>]*data-i18n=/.test(block),
		`ihr eigener Text steckt stattdessen in einem <span>: ${oeffnend}`);
});

console.log("scope-hint ok");
