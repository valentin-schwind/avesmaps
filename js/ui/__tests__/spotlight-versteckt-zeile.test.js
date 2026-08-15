const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die dritte Trefferzeile: „Ruine", „Verborgen", und beides zusammen.
//
// Wie spotlight-scoring.test.js werden die Funktionen per Namen aus der AUSGELIEFERTEN Datei
// gezogen und einzeln ausgewertet -- der Test prueft die Quelle, keine Kopie davon.
// Anker: die Deklarationen stehen auf Spalte 0, eine schliessende Klammer auf Spalte 0 beendet sie.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/spotlight-versteckt-zeile.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return match[0];
};

const context = {
	String, Boolean, Array, Object,
	// tr() gibt die deutsche Vorgabe zurueck -- die i18n-Tabelle ist nicht Gegenstand dieses Tests.
	tr: (key, fallback) => fallback,
	escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	SPOTLIGHT_SECTION_KINDS: new Set(["territory", "path", "region"]),
};
vm.runInNewContext(extract("spotlightLocationStateHint") + extract("spotlightResultMarkup"), context);
const { spotlightLocationStateHint, spotlightResultMarkup } = context;

// --- der Hinweistext ----------------------------------------------------------------------------
assert.strictEqual(spotlightLocationStateHint({}), "", "ein gewoehnlicher Ort traegt keine dritte Zeile");
assert.strictEqual(spotlightLocationStateHint(null), "", "und ein fehlendes Ortsobjekt auch nicht");
assert.strictEqual(spotlightLocationStateHint({ isRuined: true }), "Ruine");
assert.strictEqual(spotlightLocationStateHint({ isHidden: true }), "Verborgen");

// 💣 Beides zugleich ist EIN Hinweis mit Trenner, nicht zwei Zeilen: der Hinweis ist `nowrap` und
// haette sonst still abgeschnitten. Die Reihenfolge ist fest -- Ruine beschreibt den Ort, Verborgen
// beschreibt, wie die Karte mit ihm umgeht.
assert.strictEqual(spotlightLocationStateHint({ isRuined: true, isHidden: true }), "Ruine · Verborgen");

// --- das Markup ---------------------------------------------------------------------------------
const zhamorrah = spotlightResultMarkup(
	{ kind: "location", name: "Zhamorrah", typeLabel: "Besonderes Bauwerk / Stätte", stateHint: "Ruine" }, 0,
);
assert.ok(zhamorrah.includes(`class="spotlight-search__result-hint">Ruine<`), "der Hinweis steht im Markup");
assert.ok(zhamorrah.includes("spotlight-search__result--two-line"), "und die Zeile meldet sich als zweizeilig");

const gareth = spotlightResultMarkup({ kind: "location", name: "Gareth", typeLabel: "Metropole" }, 1);
assert.ok(!gareth.includes("spotlight-search__result-hint"), "ohne Hinweis kein Hinweis-Element");
assert.ok(!gareth.includes("--two-line"), "und keine Zweizeilen-Klasse");

// 🔴 --two-line und --not-on-map sind ZWEI Fragen. Ein Innerorts-Treffer ist beides; ein versteckter
// Ort ist nur zweizeilig, und genau daran scheiterte die alte Kopplung: die Verbreiterung auf 240px
// hing an --not-on-map, also haette die Ellipse bei einem versteckten Ort das Wort „Verborgen"
// gefressen -- die Zeile, die es zu lesen gibt.
const innerorts = spotlightResultMarkup(
	{ kind: "citymap", name: "Greifax-Palast", typeLabel: "Grundriss · Xorlosch", notOnMap: true }, 2,
);
assert.ok(innerorts.includes("spotlight-search__result--not-on-map"), "der Innerorts-Treffer behaelt seine Klasse");
assert.ok(innerorts.includes("spotlight-search__result--two-line"), "und ist ausserdem zweizeilig");

const versteckt = spotlightResultMarkup(
	{ kind: "location", name: "Feenplatz", typeLabel: "Besonderes Bauwerk / Stätte", stateHint: "Verborgen" }, 3,
);
assert.ok(!versteckt.includes("--not-on-map"), "ein versteckter Ort IST auf der Karte -- nur ungezeichnet");

// --- CSS: die Verbreiterung haengt an der Zweizeiligkeit, nicht am Woanders-Hinspringen ----------
const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "css", "components", "spotlight-search.css"), "utf8");
assert.ok(
	/\.spotlight-search__result--two-line\s+\.spotlight-search__result-type\s*\{[^}]*max-width:\s*240px/.test(css),
	"die 240px haengen an --two-line",
);
assert.ok(
	!/\.spotlight-search__result--not-on-map\s+\.spotlight-search__result-type\s*\{[^}]*max-width/.test(css),
	"und NICHT mehr an --not-on-map",
);

// 💣 11px ist die Untergrenze aus AGENTS.md §12. Der Hinweis stand auf 10px -- derselbe Wanderfehler,
// den §11 fuer .se-row-type/.se-row-l2 festhaelt.
const hint = css.match(/\.spotlight-search__result-hint\s*\{[^}]*\}/);
assert.ok(hint, ".spotlight-search__result-hint nicht gefunden");
const groesse = hint[0].match(/font-size:\s*(\d+)px/);
assert.ok(groesse && Number(groesse[1]) >= 11, `der Hinweis steht auf ${groesse ? groesse[1] : "?"}px, Untergrenze ist 11px`);

console.log("spotlight-versteckt-zeile: all asserts passed");
