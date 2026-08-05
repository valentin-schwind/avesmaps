// Die Adresse des Hinweise-Fensters (js/app/legal-anchor.js), Befund A24.
//
// 🔴 Geprüft wird die ECHTE Datei -- sie exportiert für Node, also braucht es weder vm-Sandbox noch
// eine abgeschriebene Kopie der Regeln. Das DOM ist winzig, aber es ANTWORTET: jede Wirkung wird an
// einer Aufzeichnung gemessen (wurde das Fenster geöffnet, wurde der richtige Abschnitt
// aufgeklappt), nicht am Quelltext. Wo ein Test die geprüfte Funktion wegstubbt, zertifiziert er die
// Notbremse statt der Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/legal-anchor.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const {
	AVESMAPS_LEGAL_SECTION_ANCHORS,
	avesmapsResolveLegalAnchor,
	avesmapsOpenLegalSectionFromHash,
} = require(path.join(ROOT, "js", "app", "legal-anchor.js"));

// ---- Welchen Abschnitt meint ein Hash? -----------------------------------------------------------

// 💣 Fängt: der Alias fällt weg oder zeigt woanders hin. „impressum" ist das Wort, das jemand
// eintippt -- niemand rät „legal-contact" --, und der Betreiber-Absatz steht seit dem 05.08.2026 in
// „Kontakt und Impressum", nicht mehr unter „Projekt und rechtlicher Status".
assert.strictEqual(avesmapsResolveLegalAnchor("#impressum"), "legal-contact", "impressum trifft den Kontakt-Abschnitt");
assert.strictEqual(avesmapsResolveLegalAnchor("#kontakt"), "legal-contact", "kontakt ebenso");
assert.strictEqual(avesmapsResolveLegalAnchor("#datenschutz"), "legal-privacy", "datenschutz trifft den Datenschutz-Abschnitt");
assert.strictEqual(avesmapsResolveLegalAnchor("#hinweise"), "legal-dialog", "hinweise oeffnet das Fenster als Ganzes");

// Der technische Anker tut es auch, und die Schreibweise ist egal.
assert.strictEqual(avesmapsResolveLegalAnchor("#legal-contact"), "legal-contact", "der technische Anker wirkt");
assert.strictEqual(avesmapsResolveLegalAnchor("#IMPRESSUM"), "legal-contact", "Grossschreibung aendert nichts");
assert.strictEqual(avesmapsResolveLegalAnchor("legal-privacy"), "legal-privacy", "auch ohne Doppelkreuz");
assert.strictEqual(avesmapsResolveLegalAnchor("  #impressum  "), "legal-contact", "Leerraum wird abgeschnitten");

// 💣 Fängt: jeder beliebige Hash oeffnet das Fenster. Diese Karte trägt Hashes von anderswo -- ein
// Dialog, der auf alles anspringt, geht bei jedem fremden Link auf.
assert.strictEqual(avesmapsResolveLegalAnchor(""), null, "kein Hash, kein Abschnitt");
assert.strictEqual(avesmapsResolveLegalAnchor("#"), null, "ein leeres Doppelkreuz ebenso");
assert.strictEqual(avesmapsResolveLegalAnchor("#karte"), null, "ein fremder Anker oeffnet nichts");
assert.strictEqual(avesmapsResolveLegalAnchor("#legal"), null, "ein Praefix ist kein Treffer");
assert.strictEqual(avesmapsResolveLegalAnchor(null), null, "null ist kein Hash");
assert.strictEqual(avesmapsResolveLegalAnchor(undefined), null, "undefined auch nicht");

// ---- Ein DOM, klein genug zum Lesen und echt genug zum Antworten ---------------------------------

function makeSection(id, tagName) {
	return { id, tagName, open: false, scrolled: 0, scrollIntoView() { this.scrolled += 1; } };
}

function makeDom(sections) {
	return { getElementById: (id) => sections[id] || null };
}

function run(hash, sections) {
	const opened = [];
	const handled = avesmapsOpenLegalSectionFromHash(makeDom(sections), hash, (isOpen) => opened.push(isOpen));

	return { handled, opened };
}

// Der Normalfall: Fenster auf, Abschnitt aufgeklappt, in den Blick gescrollt.
{
	const contact = makeSection("legal-contact", "DETAILS");
	const { handled, opened } = run("#impressum", { "legal-contact": contact });
	assert.ok(handled, "der Anker wird behandelt");
	assert.deepStrictEqual(opened, [true], "das Fenster wird genau einmal geoeffnet");
	assert.strictEqual(contact.open, true, "und der gemeinte Abschnitt aufgeklappt");
	assert.strictEqual(contact.scrolled, 1, "und in den Blick gescrollt");
}

// 💣 Fängt: ein fremder Hash oeffnet trotzdem. Das Fenster darf NICHT angefasst werden.
{
	const contact = makeSection("legal-contact", "DETAILS");
	const { handled, opened } = run("#irgendwas", { "legal-contact": contact });
	assert.strictEqual(handled, false, "ein fremder Anker wird nicht behandelt");
	assert.deepStrictEqual(opened, [], "und das Fenster bleibt unberuehrt");
	assert.strictEqual(contact.open, false, "nichts wird aufgeklappt");
}

// 💣 Fängt: `open = true` blind auf alles. `legal-dialog` ist das Fenster selbst und hat kein `open`
// -- es zu setzen waere stiller Unsinn auf einem Element, das nichts damit anfangen kann.
{
	const dialog = makeSection("legal-dialog", "DIV");
	const { handled, opened } = run("#hinweise", { "legal-dialog": dialog });
	assert.ok(handled, "das Fenster als Ganzes ist ein gueltiges Ziel");
	assert.deepStrictEqual(opened, [true], "es wird geoeffnet");
	assert.strictEqual(dialog.open, false, "aber nichts wird an ihm aufgeklappt");
	assert.strictEqual(dialog.scrolled, 0, "und nichts gescrollt");
}

// Ein Anker, dessen Element (noch) fehlt: das Fenster geht trotzdem auf, statt gar nichts zu tun.
{
	const { handled, opened } = run("#legal-privacy", {});
	assert.ok(handled, "der Anker gilt auch ohne gefundenes Element");
	assert.deepStrictEqual(opened, [true], "und das Fenster oeffnet");
}

// ---- Die Anker müssen im Dokument wirklich existieren ---------------------------------------------
//
// 💣 Fängt: die ids verschwinden aus index.html. Der Auflöser bliebe grün und träfe ins Leere -- der
// Link öffnete das Fenster und zeigte auf einen zugeklappten Abschnitt.
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
AVESMAPS_LEGAL_SECTION_ANCHORS.forEach((id) => {
	assert.ok(
		indexHtml.includes(`<details class="legal-section" id="${id}">`),
		`index.html traegt den Abschnitt ${id}`
	);
});
assert.strictEqual(
	AVESMAPS_LEGAL_SECTION_ANCHORS.length,
	(indexHtml.match(/<details class="legal-section"/g) || []).length,
	"jeder Abschnitt des Fensters hat einen Anker -- und keiner zu viel"
);

// 💣 Fängt: die Ladereihenfolge kippt. index.html ist ein Vertrag; bootstrap.js ruft diese Funktion
// beim Start, also muss das Blattmodul davor stehen -- sonst „undefined function" beim Seitenaufbau.
const anchorAt = indexHtml.indexOf('<script src="js/app/legal-anchor.js"></script>');
const bootstrapAt = indexHtml.indexOf('<script src="js/app/bootstrap.js"');
assert.ok(anchorAt > -1, "index.html laedt legal-anchor.js");
assert.ok(bootstrapAt > -1, "und bootstrap.js");
assert.ok(anchorAt < bootstrapAt, "das Blattmodul laedt VOR bootstrap.js");

// 💣 Fängt: bootstrap.js schreibt den Hash. Ein Fenster, das beim Oeffnen die Adresszeile umschreibt,
// macht aus jedem Klick einen Eintrag in der Zurueck-Historie -- und die Adresse dieser Karte gehoert
// dem Kartenstand, nicht einem Dialog.
const bootstrapSource = fs.readFileSync(path.join(ROOT, "js", "app", "bootstrap.js"), "utf8");
assert.ok(
	bootstrapSource.includes("avesmapsOpenLegalSectionFromHash(document, window.location.hash, setLegalDialogOpen)"),
	"bootstrap.js reicht Dokument, Hash und Oeffner an das Modul"
);
assert.ok(
	!/location\.hash\s*=/.test(bootstrapSource),
	"und schreibt den Hash nirgends"
);
assert.ok(
	bootstrapSource.includes('$(window).on("hashchange"'),
	"ein spaeter eingefuegter Link wirkt ebenfalls"
);

console.log("legal-anchor ok");
