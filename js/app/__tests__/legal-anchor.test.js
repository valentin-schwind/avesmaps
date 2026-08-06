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
	avesmapsHandleLegalButtonClick,
} = require(path.join(ROOT, "js", "app", "legal-anchor.js"));

// ---- Der Klick auf „Hinweise" ---------------------------------------------------------------------
//
// 💣 Seit dem 06.08.2026 ist #legal-button ein <a href="/html/impressum.html">: ohne JavaScript
// waeren Impressum und Datenschutzerklaerung sonst unerreichbar (§ 5 DDG, Art. 13 DSGVO). MIT
// JavaScript muss der Klick die Navigation ANHALTEN -- sonst oeffnet er das Fenster und verlaesst
// die Karte, mitsamt der gerade geplanten Route.
//
// 🔴 Gemessen an einem Ereignis, das MITZAEHLT, nicht am Quelltext. Genau hier liegt der
// Unterschied: `if (false) { event.preventDefault(); }` besteht jede Zusicherung, die nur nach der
// Zeichenkette sucht -- nachgestellt, und es war der Grund, diese Regel aus bootstrap.js
// herauszuloesen.
{
	const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
	const opened = [];
	const result = avesmapsHandleLegalButtonClick(event, (isOpen) => opened.push(isOpen));
	assert.strictEqual(event.prevented, 1, "die Navigation wird angehalten -- genau einmal");
	assert.deepStrictEqual(opened, [true], "und das Fenster geoeffnet");
	assert.strictEqual(result, true, "und es wird zurueckgemeldet");
}

// ⚠️ Ohne brauchbares Ereignis wird nichts angehalten -- und das MUSS gemeldet werden, statt still
// „ja" zu sagen. Der Rueckfall ist dann der Link selbst, und der ist ein gueltiger Weg.
{
	const opened = [];
	assert.strictEqual(avesmapsHandleLegalButtonClick(null, (isOpen) => opened.push(isOpen)), false, "kein Ereignis, kein Anhalten");
	assert.deepStrictEqual(opened, [true], "das Fenster geht trotzdem auf");
	assert.strictEqual(avesmapsHandleLegalButtonClick({}, () => {}), false, "ein Ereignis ohne preventDefault ebenso");
}

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

// 💣 UND JEDER ANKER MUSS AM RICHTIGEN ABSCHNITT SITZEN. Dass die acht ids DA sind und acht an der
// Zahl, sagt nichts darüber, WELCHER Abschnitt welche trägt -- zwei vertauschte Attribute, und
// `#datenschutz` öffnet den Haftungsausschluss. Acht ids von Hand nachzutragen ist genau die Geste,
// bei der eine verrutscht, und es ist die 🔴-Warnung dieses Moduls eine Ebene tiefer. Geprüft wird
// gegen den i18n-Schlüssel der Überschrift, denn der benennt den Abschnitt unabhängig vom Anker.
AVESMAPS_LEGAL_SECTION_ANCHORS.forEach((id) => {
	const key = id.replace(/^legal-/, "");
	const at = indexHtml.indexOf(`<details class="legal-section" id="${id}">`);
	const head = indexHtml.slice(at, at + 400);
	assert.ok(
		head.includes(`legal.group.${key}`),
		`der Anker ${id} sitzt am Abschnitt legal.group.${key}, nicht an einem anderen`
	);
});

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

// 💣 UND ES MUSS BEIM SEITENAUFBAU GERUFEN WERDEN. Die Zusicherung oben prüft nur den Rumpf der
// Wrapper-Funktion -- den Aufruf zu löschen liess sie grün, und das ist die gesamte Wirkung dieses
// Commits. Eine Funktion, die niemand ruft, ist kein Anker.
assert.ok(
	/\nopenLegalSectionFromHash\(\);/.test(bootstrapSource),
	"openLegalSectionFromHash wird beim Start aufgerufen, nicht nur definiert"
);
// 💣 Und der Aufruf darf nicht entschärft sein (`&& false`, ein `if (0)` davor).
assert.ok(
	!/openLegalSectionFromHash\(\)\s*&&/.test(bootstrapSource),
	"und der Aufruf ist nicht durch eine tote Bedingung entschaerft"
);

// 💣 Der hashchange-Handler muss die Funktion auch WIRKLICH rufen -- `() => {}` liess die alte
// Zusicherung durch, weil sie nur nach dem Ereignisnamen suchte.
assert.ok(
	/\$\(window\)\.on\("hashchange",\s*\(\)\s*=>\s*openLegalSectionFromHash\(\)\)/.test(bootstrapSource),
	"ein spaeter eingefuegter Link wirkt ebenfalls -- der Handler ruft die Funktion"
);

// 💣 „Nur lesen, nie schreiben" in ALLEN Schreibweisen. Die erste Fassung prüfte `location.hash =`
// und liess `location.hash +=`, `history.replaceState(…, "#…")` und `pushState` durch -- jede davon
// schreibt die Adresszeile genauso.
assert.ok(!/location\.hash\s*=/.test(bootstrapSource), "kein location.hash =");
assert.ok(!/location\.hash\s*\+=/.test(bootstrapSource), "kein location.hash +=");
assert.ok(
	!/(replaceState|pushState)\([^)]*#/.test(bootstrapSource),
	"und kein replaceState/pushState, das ein Fragment setzt"
);

// 💣 Faellt das Modul aus (404 waehrend eines Deploys, Parsefehler), darf der ungeschuetzte Aufruf
// nicht die restlichen ~420 Zeilen dieser Datei mitreissen -- vom Schliessen-Knopf ueber die
// Editor-Oeffner bis zum Escape-Riegel. `typeof` waere hier die falsche Wahl: eine halb geladene
// Datei kann ihre `const` in der Todeszone stehen lassen, und dann wirft schon die Pruefung.
assert.ok(
	/function openLegalSectionFromHash\(\) \{\s*\n\s*try \{/.test(bootstrapSource),
	"der Aufruf ist gegen ein fehlendes Modul abgesichert, und zwar mit try/catch statt typeof"
);

console.log("legal-anchor ok");
