const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Trefferzeile fuer Objekte OHNE Kartenobjekt (siebte Suchquelle).
//
// Wie spotlight-versteckt-zeile.test.js werden die Funktionen per Namen aus der
// AUSGELIEFERTEN Datei gezogen -- der Test prueft die Quelle, keine Kopie davon.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/offmap-treffer.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return match[0];
};

// --- die Sektion ist eingetragen ----------------------------------------------------------------
// 🔴 Ihre Reihenfolge in SPOTLIGHT_SEARCH_SECTIONS muss der $sections-Liste im Server
// entsprechen (api/app/map-search.php): der Client rendert in genau dieser Folge.
const sectionBlock = source.match(/const SPOTLIGHT_SEARCH_SECTIONS = \[[\s\S]*?\n\];/);
assert.ok(sectionBlock, "SPOTLIGHT_SEARCH_SECTIONS nicht gefunden -- umbenannt?");
assert.ok(sectionBlock[0].includes('kind: "offmap"'), "die siebte Quelle fehlt in der Abschnittsliste");
assert.ok(sectionBlock[0].includes('totalField: "offmapTotal"'), "und ihr Zaehlerfeld");

const sectionKinds = [...sectionBlock[0].matchAll(/kind: "([a-z_]+)"/g)].map((m) => m[1]);
assert.strictEqual(
	sectionKinds[sectionKinds.length - 1],
	"offmap",
	"sie steht ZULETZT -- diese Position ist die Regel 'unter den Kartentreffern'",
);

// --- die Verdrahtung ----------------------------------------------------------------------------
// 💣 Ein gruener Test des Bauers beweist nicht, dass jemand ihn fuer diese Art aufruft.
assert.ok(
	/kind === "offmap"[\s\S]{0,120}buildPlaceBoundSpotlightEntry|buildPlaceBoundSpotlightEntry[\s\S]{0,120}kind === "offmap"/.test(source)
		|| /\|\|\s*kind === "offmap"\s*\)\)\s*\{\s*\n\s*entry = buildPlaceBoundSpotlightEntry/.test(source),
	"buildPlaceBoundSpotlightEntry wird fuer 'offmap' nicht aufgerufen -- nicht verdrahtet",
);

// 💣 ZWEITE Verdrahtung, und sie ist leicht zu vergessen: der KLICK. buildPlaceBoundSpotlightEntry
// ueberschreibt `kind`, also faellt ein Treffer ohne eigenen Zweig in selectSpotlightSearchEntry
// durch alle Faelle und tut gar nichts -- waehrend er in der Liste vollkommen richtig aussieht.
const focusSource = fs.readFileSync(path.join(__dirname, "..", "spotlight-search-focus.js"), "utf8");
assert.ok(
	/entry\.kind === "offmap"[\s\S]{0,80}focusSpotlightPlaceEntry|focusSpotlightPlaceEntry[\s\S]{0,200}entry\.kind === "offmap"/.test(focusSource)
		|| /entry\.kind === "offmap"\s*\)\s*\{\s*\n\s*focusSpotlightPlaceEntry/.test(focusSource),
	"der Klick auf einen offmap-Treffer ist nicht verdrahtet -- er wuerde nichts tun",
);

// 🔴 Und der Kartensammlungs-Dialog bleibt auf citymap gegated: ein Ort ohne Kartenobjekt hat
// nichts mit der Kartensammlung des Gebiets zu tun, in das er faellt.
assert.ok(
	/if \(entry\.kind === "citymap"\) \{\s*\n\s*openSpotlightCitymapsDialog/.test(focusSource),
	"openSpotlightCitymapsDialog haengt weiterhin allein an citymap",
);

// --- das Markup ---------------------------------------------------------------------------------
const markupContext = {
	String, Boolean, Array, Object,
	tr: (key, fallback) => fallback,
	escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	SPOTLIGHT_SECTION_KINDS: new Set(["citymap", "adventure", "lore", "offmap"]),
};
vm.runInNewContext(extract("spotlightLocationStateHint") + extract("spotlightResultMarkup"), markupContext);
const { spotlightResultMarkup } = markupContext;

const mitZiel = spotlightResultMarkup(
	{ kind: "offmap", name: "Rabenstein", typeLabel: "Burg · Weiden", notOnMap: true, placeHint: "nicht auf der Karte" }, 0,
);
assert.ok(mitZiel.includes("spotlight-search__result--not-on-map"), "gedaempft");
assert.ok(mitZiel.includes("spotlight-search__result--two-line"), "und breit genug fuer den Hinweis");
assert.ok(mitZiel.includes(">nicht auf der Karte<"), "der Hinweis steht da");

// 💣 Ohne Ziel der ANDERE Satz. Wer „nicht auf der Karte" liest und klickt, erwartet
// Bewegung; bleibt die Karte stehen, haelt er es fuer kaputt.
const ohneZiel = spotlightResultMarkup(
	{ kind: "offmap", name: "Steinerne Rinne", typeLabel: "Gebirgspass", notOnMap: true, unreachable: true }, 1,
);
assert.ok(ohneZiel.includes(">kein Ort auf der Karte<"), "ohne Ziel sagt die Zeile das auch");
assert.ok(!ohneZiel.includes(">nicht auf der Karte<"), "und nur einer der beiden Saetze");

// 🪤 „Innerorts" gehoert der dritten Quelle. Ein Abschnitts-Treffer darf es nie tragen --
// ein Weg oder ein Gebiet ist keine Siedlung, und das ist hier Fachsprache, keine Nuance.
assert.ok(!ohneZiel.includes("Innerorts"), "ein Abschnitts-Treffer sagt nie 'Innerorts'");

// --- der Eintragsbauer --------------------------------------------------------------------------
const zielEintrag = { kind: "region", bounds: [[1, 2], [3, 4]], publicIds: ["reg-weiden"], polygons: [] };
const bauerContext = {
	String, Boolean, Array, Object, Number,
	tr: (key, fallback) => fallback,
	getSpotlightSearchLookup: () => ({ byPublicId: new Map([["region:reg-weiden", zielEintrag]]) }),
};
vm.runInNewContext(extract("spotlightPlaceLookupKeys") + extract("buildPlaceBoundSpotlightEntry"), bauerContext);
const { buildPlaceBoundSpotlightEntry } = bauerContext;

const erreichbar = buildPlaceBoundSpotlightEntry(
	{ name: "Rabenstein", type_label: "Burg · Weiden", place_public_id: "reg-weiden",
	  place_kind: "region", place_name: "Weiden", unresolved: false, offmap_total: 3 },
	"offmap",
);
assert.strictEqual(erreichbar.unreachable, false, "das Ziel wurde gefunden");
assert.deepStrictEqual(erreichbar.bounds, zielEintrag.bounds, "und der Flug erbt dessen Ausdehnung");
assert.strictEqual(erreichbar.placeEntryKind, "region", "die Art des ZIELS bleibt erhalten");
assert.strictEqual(erreichbar.kind, "offmap", "waehrend der Treffer selbst seine eigene Art traegt");
assert.strictEqual(erreichbar.notOnMap, true);
assert.strictEqual(erreichbar.placeHint, "nicht auf der Karte", "der Hinweis kommt vom Bauer");
assert.strictEqual(erreichbar.offmapTotal, 3, "der Sektionszaehler reist mit");

// 💣 Die id MUSS eigen sein. Uebernaehme der Eintrag die id des Ziels, verrechnete
// seenEntryIds ihn gegen den echten Treffer -- einer der beiden verschwaende.
assert.ok(erreichbar.id.startsWith("offmap:"), "eigene id");
assert.notStrictEqual(erreichbar.id, "reg-weiden");

const unerreichbar = buildPlaceBoundSpotlightEntry(
	{ name: "Steinerne Rinne", type_label: "Gebirgspass", place_public_id: "",
	  place_kind: "unresolved", place_name: "", unresolved: true },
	"offmap",
);
assert.strictEqual(unerreichbar.unreachable, true, "kein Ziel, und die Zeile weiss es");
assert.strictEqual(unerreichbar.placeHint, "", "ohne Ziel kein 'nicht auf der Karte'");
assert.strictEqual(unerreichbar.placeEntryKind, "", "und keine geratene Zielart");

// Ein Treffer ohne Namen ist keiner.
assert.strictEqual(buildPlaceBoundSpotlightEntry({ name: "" }, "offmap"), null);

console.log("offmap-treffer.test.js: OK");
