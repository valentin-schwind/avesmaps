// Aufgabe 12 des Garetien Importers -- der Filtertrichter (sechs Abschnitte, Auftrag §5.2).
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-12-brief.md
// Mockup:  docs/garetien-importer-mockup.html §4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-filtertrichter.test.js
//
// 🔴 .type-filter ist die Hausform (css/features/review-panel.css), verdrahtet ueber den
// geteilten js/ui/filter-menu.js (avmFilterMenuAttach) -- DIESELBE Datei, die auch den
// "Vorkommen"-Trichter bedient (review-wiki-sync.js). Das braucht ein DOM und wird deshalb im
// Browser abgenommen (siehe Bericht); hier wird die PURE Haelfte geprueft: das statische Skelett
// (welche Abschnitte STEHEN im Markup) und die reinen Bausteine (Facetten -> Optionen, Chips,
// "ist ein Filter aktiv").

"use strict";

const path = require("path");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}

// ---- Alle sechs Abschnitte sind im Markup ------------------------------------------------------
//
// Fuenf davon leben in der aufklappbaren .type-filter__menu (Ebene, Objekttyp, Urteil, Wiki, Nur
// zeigen) -- jeder mit .type-filter__section-title. Der sechste ("Freitext auf den Namen") ist
// das immer sichtbare Suchfeld .gi-search daneben, KEIN Abschnitt IN der Klappflaeche (es gibt
// dort keine Optionsliste zu zaehlen) -- es steht bereits aus Aufgabe 11 im Skelett.

wahr(typeof mod.garetienListeSkelettMarkup === "function", "garetienListeSkelettMarkup fehlt im Export");
const skelett = mod.garetienListeSkelettMarkup();

wahr(skelett.includes('id="garetien-search"'), "Abschnitt 6 (Freitext auf den Namen) fehlt");
["garetien-filter-ebene-menu", "garetien-filter-typ-menu", "garetien-filter-urteil-menu",
	"garetien-filter-wiki-menu", "garetien-filter-nur-menu"].forEach((id) => {
	wahr(skelett.includes('id="' + id + '"'), `Abschnitts-Container ${id} fehlt`);
});
gleich((skelett.match(/type-filter__section-title/g) || []).length, 5,
	"genau fuenf Abschnitte in der Klappflaeche tragen .type-filter__section-title");
wahr(skelett.includes(">Ebene<") || skelett.includes(">Ebene "), "Abschnitt Ebene fehlt");
wahr(skelett.includes(">Objekttyp<"), "Abschnitt Objekttyp fehlt");
wahr(skelett.includes(">Urteil<"), "Abschnitt Urteil fehlt");
wahr(skelett.includes(">Wiki<"), "Abschnitt Wiki fehlt");
wahr(skelett.includes(">Nur zeigen<"), "Abschnitt Nur zeigen fehlt");
wahr(skelett.includes('class="type-filter__toggle"'), "der Umschalt-Knopf muss die Hausklasse tragen");
wahr(skelett.includes('class="type-filter__menu"'), "die Klappflaeche muss die Hausklasse tragen");
wahr(skelett.includes("hidden"), "die Klappflaeche startet zu -- ihr `hidden` ist der GANZE Zustand");

// ---- Facetten -> Optionen: die Zahl kommt aus `facetten`, nicht aus einer eigenen Rechnung -----

wahr(typeof mod.garetienFacettenOptionen === "function", "garetienFacettenOptionen fehlt im Export");
const facetten = { ebene: { Gewaesser: 289 }, typ: { Bach: 143, See: 96, Fluss: 30 }, urteil: { neu: 199, ergaenzung: 25 }, wiki: { ggp: 246, kosch: 43 } };

const typOptionen = mod.garetienFacettenOptionen(facetten, "typ");
gleich(typOptionen.length, 3, "alle drei Typen muessen als Optionen erscheinen");
const bach = typOptionen.find((o) => o.value === "Bach");
wahr(bach && bach.count === 143, "die Zahl neben einer Option muss aus facetten kommen");

// Wiki: die WERTE sind ggp/kosch, die BESCHRIFTUNG ist garetien.de/koschwiki.de (Auftrag: "Wiki
// (ggp/kosch)"; die Beschriftung reist getrennt, sonst laese ein Editor einen Datenbank-Code).
const wikiOptionen = mod.garetienFacettenOptionen(facetten, "wiki", mod.garetienWikiLabel);
const ggp = wikiOptionen.find((o) => o.value === "ggp");
gleich(ggp.label, "garetien.de", "ggp muss als garetien.de beschriftet sein");
const kosch = wikiOptionen.find((o) => o.value === "kosch");
gleich(kosch.label, "koschwiki.de", "kosch muss als koschwiki.de beschriftet sein");

// Urteil: die Beschriftung des FILTERS ist die LANGE Form ("Ergänzung — sie wissen mehr", Mockup),
// nicht die kurze Zeilen-Beschriftung aus Aufgabe 11 ("Ergänzung").
const urteilOptionen = mod.garetienFacettenOptionen(facetten, "urteil", mod.garetienUrteilFilterLabel);
const ergaenzung = urteilOptionen.find((o) => o.value === "ergaenzung");
wahr(ergaenzung.label.includes("sie wissen mehr"), "Ergaenzung braucht im Filter die lange Erklaerung");

// 💣 Die Zahlen bewegen sich NICHT, wenn (irgendwo im Browser) ein Filter greift -- sie zaehlen
// den LAUF. Fuer eine PURE Funktion heisst das: zweimal derselbe Aufruf mit denselben Facetten
// ergibt dieselben Zahlen, unabhaengig davon, was zwischendurch an anderer Stelle ausgewaehlt war.
const vorher = mod.garetienFacettenOptionen(facetten, "typ");
mod.garetienFilterState.typ.add("Bach"); // simuliert eine Auswahl im Trichter
const nachher = mod.garetienFacettenOptionen(facetten, "typ");
gleich(JSON.stringify(vorher), JSON.stringify(nachher),
	"eine Auswahl darf die FACETTENZAHLEN nicht veraendern -- sonst faellt nach dem ersten Klick jeder andere Wert auf 0");
mod.garetienFilterState.typ.clear();

// ---- Chips: einer je aktivem Abschnitt, sein ✕ nimmt NUR ihn zurueck --------------------------

wahr(typeof mod.garetienChipsMarkup === "function", "garetienChipsMarkup fehlt im Export");

const leererZustand = { ebene: new Set(), typ: new Set(), urteil: new Set(), wiki: new Set(), nur: new Set() };
gleich(mod.garetienChipsMarkup(leererZustand), "", "ohne aktiven Filter gibt es keine Chips");

const zweiAktiv = {
	ebene: new Set(["Gewaesser"]), typ: new Set(),
	urteil: new Set(["neu", "ergaenzung"]), wiki: new Set(), nur: new Set(),
};
const chips = mod.garetienChipsMarkup(zweiAktiv);
gleich((chips.match(/gi-chip/g) || []).length, 2, "zwei aktive Abschnitte -> genau zwei Chips");
wahr(chips.includes("Ebene"), "der Ebene-Chip fehlt");
wahr(/neu.*Ergänzung|Ergänzung.*neu/.test(chips), "der Urteil-Chip muss beide gewaehlten Werte nennen");
wahr(chips.includes("✕") || chips.includes("&#10005;") || /aria-label="Filter entfernen"/.test(chips),
	"jeder Chip braucht ein ✕ zum Entfernen");
gleich((chips.match(/data-chip-feld="typ"/g) || []).length, 0, "typ ist nicht aktiv -- kein Chip dafuer");
wahr(chips.includes('data-chip-feld="urteil"'),
	"das ✕ muss sein eigenes Feld benennen -- nur SO nimmt es nur diesen einen Filter zurueck");

// ---- "Ist ueberhaupt ein Filter aktiv?" (fuer die is-active-Klasse am Umschalt-Knopf) ----------

wahr(typeof mod.garetienFilterIstAktiv === "function", "garetienFilterIstAktiv fehlt im Export");
gleich(mod.garetienFilterIstAktiv(leererZustand), false);
gleich(mod.garetienFilterIstAktiv(zweiAktiv), true);

// ---- Keine zweite Rechnung im Browser, kein zweiter Schreibweg (globale-vorgaben.md) -----------
//
// 🔴 Review I2 (28.08.2026): ein Quelltexttest darf Kommentare nicht mitlesen -- die Datei selbst
// erklaert an zwei Stellen in Prosa, dass es "eigene fetch()-Stellen" nicht geben darf, und genau
// dieser Erklaerungstext enthaelt das Wort "fetch(" drei weitere Male. Ungestrippt zaehlt ein
// simples \bfetch\(\b also 4 statt 1 und der Test waere von Anfang an rot gewesen (hier live
// aufgetreten und korrigiert, nicht nur befuerchtet). Kommentare deshalb ZUERST strippen, wie an
// jeder anderen Quelltextpruefstelle im Haus (AGENTS.md §9).

const fs = require("fs");
const quelleRoh = fs.readFileSync(path.resolve(__dirname, "..", "review-garetien-importer.js"), "utf8");
const quelle = quelleRoh
	.replace(/\/\*[\s\S]*?\*\//g, "")   // Blockkommentare
	.replace(/\/\/[^\n]*/g, "");        // Zeilenkommentare -- die Datei enthaelt kein "//" in einer
	                                    // Zeichenkette (kein http://-Literal), also ist das sicher.

assert.ok(!/Math\.sqrt|Math\.hypot/.test(quelle),
	"ein Abstand im Browser waere die zweite Rechnung, die der Auftrag verbietet");
checks++;

// Direkt zaehlen statt mustern: `fetch\(\s*["'][^"']*\.php` matcht in der echten Datei NICHTS,
// weil avesmapsGaretienRufe fetch(pfad, …) mit einer VARIABLEN ruft, nie einem Literal -- ein
// darauf gebauter forEach liefe null Mal und bestaetigte damit gar nichts.
const fetchAufrufe = (quelle.match(/\bfetch\(/g) || []).length;
assert.strictEqual(fetchAufrufe, 1, "Es gibt " + fetchAufrufe + " fetch-Aufrufe statt einem. "
	+ "Geschrieben wird NUR ueber avesmapsGaretienRufe.");
checks++;

// Die lesende Adresse (Aufgabe 11) muss als Zeichenkette vorkommen -- und JEDE ".php"-Adresse in
// der Datei muss eine der zwei erlaubten sein (die schreibende, sync-plan.php, kommt erst mit
// Aufgabe 15/16 als Literal dazu; bis dahin stand sie nur in den jetzt gestrippten Kommentaren).
assert.ok(quelle.includes('"/api/edit/map/garetien-import.php"'),
	"die lesende Adresse /api/edit/map/garetien-import.php fehlt als Zeichenkette");
checks++;
const phpAdressen = quelle.match(/["'][^"']*\.php["']/g) || [];
assert.ok(phpAdressen.length > 0, "die Gegenprobe fuer die .php-Adressen findet selbst gar nichts");
checks++;
phpAdressen.forEach((treffer) => {
	assert.ok(/sync-plan\.php|garetien-import\.php/.test(treffer), `Ein zweiter Schreibweg: ${treffer}`);
	checks++;
});

// ---- Keine Sortierung -- die Reihenfolge der HAUPTLISTE ist die der Quelle --------------------
// (Mockup §12: "Keine Sortierung. Die Reihenfolge ist die der Quelle ... Sortieren zerschnitte
// ihn." -- garetienZeileMarkup+Aufgabe 11 mappen objekte[] 1:1, ohne .sort()/.reverse().)
assert.ok(!/objekte\s*\.\s*sort\(|zustand\.objekte\s*\.\s*sort\(/.test(quelle),
	"die Hauptliste darf NICHT sortiert werden -- die Reihenfolge ist der Faden durch die Liste");
checks++;

console.log(`garetien-filtertrichter: ${checks} Pruefungen bestanden.`);
