const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Suchzeile eines von der Karte genommenen innerorts-Punkts (M5 der Gesamtpruefung zu Innerorts,
// Schritt 1; Entwurf docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §7):
// „Alter Hafen" / „Hafen in Gareth · nicht auf der Karte" -- in der Hausform der uebrigen
// Innerorts-Treffer (Bauer buildInSettlementSpotlightEntry, derselbe Sprung auf die Stadt), aber mit dem
// Hinweis „nicht auf der Karte" statt „Innerorts", und NICHT mit beidem.
//
// Wie offmap-treffer.test.js werden die Funktionen per Namen aus der AUSGELIEFERTEN Datei gezogen und
// ausgefuehrt -- der Test prueft die Quelle, keine Kopie davon.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/spotlight-innerorts-von-der-karte.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8").replace(/\r\n/g, "\n");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return match[0];
};

const stadtEintrag = { id: "location:pid-gareth", kind: "location", name: "Gareth", typeLabel: "Metropole", locationEntry: {} };
const context = {
	String, Boolean, Array, Object, Map,
	tr: (key, fallback) => fallback,
	escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	SPOTLIGHT_SECTION_KINDS: new Set(["citymap", "adventure", "lore", "offmap"]),
	getSpotlightSearchLookup: () => ({ byPublicId: new Map([["location:pid-gareth", stadtEintrag]]) }),
};
vm.runInNewContext(
	extract("buildInSettlementSpotlightEntry") + extract("spotlightLocationStateHint") + extract("spotlightResultMarkup"),
	context,
);
const { buildInSettlementSpotlightEntry, spotlightResultMarkup } = context;

// Die Serverform aus avesmapsBuildInnerortsVonDerKarteSearchEntries (api/_internal/app/innerorts-anschluss.php).
const genommen = buildInSettlementSpotlightEntry({
	kind: "in_settlement", public_id: "pid-gareth", settlement_public_id: "pid-gareth", name: "Alter Hafen",
	type_label: "Hafen in Gareth", settlement_name: "Gareth", wiki_url: "", von_der_karte: true,
});
assert.ok(genommen, "der Treffer wird gebaut");
assert.strictEqual(genommen.locationEntry, stadtEintrag.locationEntry, "er springt auf die Stadt (Hausform der Innerorts-Treffer)");
const zeileGenommen = spotlightResultMarkup(genommen, 0);
assert.ok(zeileGenommen.includes(">Alter Hafen<"), "der Name des Punkts");
assert.ok(zeileGenommen.includes("Hafen in Gareth"), "„Hafen in Gareth\"");
assert.ok(zeileGenommen.includes(">nicht auf der Karte<"), "der Hinweis „nicht auf der Karte\" steht da: " + zeileGenommen);
assert.ok(!zeileGenommen.includes("Innerorts"), "und NICHT zusaetzlich „Innerorts\": " + zeileGenommen);
assert.ok(zeileGenommen.includes("spotlight-search__result--not-on-map"), "gedaempft wie jeder Innerorts-Treffer");

// Die abgeleitete Staette (ohne `von_der_karte`) bleibt, wie sie war: „Innerorts".
const abgeleitet = buildInSettlementSpotlightEntry({
	kind: "in_settlement", public_id: "pid-gareth", settlement_public_id: "pid-gareth", name: "Palast der Winde",
	type_label: "Palast in Gareth", settlement_name: "Gareth", wiki_url: "",
});
const zeileAbgeleitet = spotlightResultMarkup(abgeleitet, 1);
assert.ok(zeileAbgeleitet.includes(">Innerorts<"), "die abgeleitete Staette sagt weiter „Innerorts\"");
assert.ok(!zeileAbgeleitet.includes("nicht auf der Karte"), "und nicht „nicht auf der Karte\"");

console.log("spotlight-innerorts-von-der-karte: alle Zusicherungen erfüllt");
