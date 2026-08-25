// Der Wiki-Steckbrief der Landschaftsbeschriftung klappt zu (Owner 25.08.2026).
//
// 🔴 OPT-IN, und das ist die tragende Zusicherung: die Angabe steht im Feldregister EINER Objektart.
// Alle uebrigen zehn Oberflaechen zeigen ihren Steckbrief unveraendert offen -- das Bauteil bedient
// elf, und eine Kuerzung, die sie alle traefe, waere ein Umbau von zehn ungefragten Fenstern.
//
// 🔴 NATIV: `<details>/<summary>`. Nur damit findet Strg+F den Text einer zugeklappten Zeile und
// klappt sie selbst auf (AGENTS.md §11, dieselbe Begruendung wie beim Fenster „Hinweise").
//
// 💣 Getrennt wird am SCHLUESSEL, nie an der Beschriftung -- ein Wortlaut ist uebersetzbar.
//
// Run: node js/ui/__tests__/wiki-steckbrief-klappen.test.js
"use strict";

const assert = require("assert");
const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const {
	AVESMAPS_WIKI_ASSIGN_SKINS,
	avesmapsWikiAssignSkin,
	avesmapsWikiAssignModell,
	avesmapsWikiAssignMarkup,
} = require("../wiki-assign.js");

const huelle = avesmapsWikiAssignSkin("label-wiki");
const artikel = {
	wiki_url: "https://de.wiki-aventurica.de/wiki/Nord-Gratenfels",
	wiki_key: "nord-gratenfels",
	werte: {
		name: "Nord-Gratenfels",
		art: "Gebirge",
		region_parent: "Nordmarken",
		affiliation_staat: "Mittelreich: Herzogtum Nordmarken",
		continent: "Aventurien",
		einwohner: "9300 davon 200 Zwerge",
		verkehrswege: "Tommel",
	},
};
let checks = 0;

// ── A. Die Objektart sagt es, nicht die Oberflaeche ──────────────────────────────────────────
const label = AVESMAPS_WIKI_ASSIGN_REGISTRY.landschaftslabel;
assert.deepStrictEqual(label.steckbriefOffen, ["artikel", "art"],
	"das Register nennt die offenen Zeilen"); checks++;

// ── B. Genau EINE Objektart fuehrt die Angabe ────────────────────────────────────────────────
// 🪤 Wer sie „der Einheitlichkeit halber" ueberall setzt, klappt zehn Fenster zu, die niemand
// gefragt hat. Diese Zusicherung faellt um, sobald das passiert -- und das ist ihr Sinn.
const mitAngabe = Object.keys(AVESMAPS_WIKI_ASSIGN_REGISTRY)
	.filter((art) => Array.isArray(AVESMAPS_WIKI_ASSIGN_REGISTRY[art].steckbriefOffen));
assert.deepStrictEqual(mitAngabe, ["landschaftslabel"],
	"nur die Landschaftsbeschriftung klappt, gefunden: " + mitAngabe.join(",")); checks++;

// ── C. Jede Zeile traegt einen stabilen Schluessel ───────────────────────────────────────────
const modell = avesmapsWikiAssignModell(label, { artikel: artikel }, {});
const schluessel = modell.felder.map((z) => z.schluessel);
assert.ok(schluessel.every((s) => typeof s === "string" && s !== ""),
	"jede Zeile hat einen Schluessel, gefunden: " + JSON.stringify(schluessel)); checks++;
assert.strictEqual(schluessel[0], "artikel", "die Kopfzeile heisst `artikel`"); checks++;
assert.strictEqual(schluessel[1], "wiki_key", "die zweite heisst `wiki_key`"); checks++;

// ── D. Die Auszeichnung trennt in offen und Klappkasten ──────────────────────────────────────
const markup = avesmapsWikiAssignMarkup(modell, huelle);
assert.ok(markup.includes("<details"), "es gibt einen Klappkasten"); checks++;
assert.ok(markup.includes("<summary"), "und er hat einen Knopf"); checks++;
assert.ok(markup.includes(huelle.klapp) && markup.includes(huelle.klappTitel),
	"beide Klassen der Huelle stehen dran"); checks++;

const vorKasten = markup.slice(0, markup.indexOf("<details"));
const imKasten = markup.slice(markup.indexOf("<details"));
assert.ok(vorKasten.includes("nord-gratenfels") === false,
	"der Schluessel steht NICHT offen -- er ist die uninteressanteste Zeile"); checks++;
assert.ok(vorKasten.includes("Gebirge"), "die Art steht offen"); checks++;
assert.ok(vorKasten.includes("Nord-Gratenfels"), "der Artikellink steht offen"); checks++;
assert.ok(imKasten.includes("Aventurien") && imKasten.includes("Tommel"),
	"Kontinent und Verkehrswege liegen im Kasten"); checks++;

// ── E. Ohne die Angabe aendert sich NICHTS ───────────────────────────────────────────────────
// Die Gegenprobe an einer anderen Objektart, mit derselben Huelle: kein <details>, eine Liste.
const weg = AVESMAPS_WIKI_ASSIGN_REGISTRY.weg;
const wegModell = avesmapsWikiAssignModell(weg, { artikel: artikel }, {});
const wegMarkup = avesmapsWikiAssignMarkup(wegModell, huelle);
assert.ok(!wegMarkup.includes("<details"),
	"ohne `steckbriefOffen` gibt es keinen Klappkasten"); checks++;
assert.deepStrictEqual(wegModell.offen, [], "und das Modell fuehrt eine leere Liste"); checks++;

// ── F. Ein Kasten, der nichts verbirgt, entsteht gar nicht erst ──────────────────────────────
// 🪤 Ein Artikel, der NUR die offenen Felder traegt: der Klappknopf haette nichts zu zeigen und
// kostete trotzdem eine Zeile.
const duenn = avesmapsWikiAssignModell(label,
	{ artikel: { wiki_url: artikel.wiki_url, wiki_key: "", werte: { art: "Gebirge" } } }, {});
const duennMarkup = avesmapsWikiAssignMarkup(duenn, huelle);
assert.ok(!duennMarkup.includes("<details"),
	"nichts zu verbergen, also kein Kasten"); checks++;

// ── G. Beide Huellen kennen die Klassen ──────────────────────────────────────────────────────
// ⚠️ Eine Huelle ohne sie liefert `class=""` und der Kasten stuende ungestylt da, sobald jemand die
// Angabe bei einer Objektart des Editorfensters setzt.
for (const name of Object.keys(AVESMAPS_WIKI_ASSIGN_SKINS)) {
	const s = AVESMAPS_WIKI_ASSIGN_SKINS[name];
	assert.ok(typeof s.klapp === "string" && s.klapp !== "", name + ": klapp gesetzt");
	assert.ok(typeof s.klappTitel === "string" && s.klappTitel !== "", name + ": klappTitel gesetzt");
	checks += 2;
}

console.log("wiki-steckbrief-klappen: " + checks + " Zusicherungen gruen");
