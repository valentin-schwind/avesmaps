// Der Vorkommeneditor traegt dieselbe Form wie die vier anderen Editoren -- geprueft am Markup,
// am Stylesheet und an der einen reinen Funktion, die die Listenzeile baut.
//
// Warum als Test und nicht als Sichtpruefung: die Zusagen hier sind PAARE, und ein Paar laeuft
// still auseinander. Der Startwert avesmapsLoreListKind.dialog und der `is-active`-Reiter im
// Markup muessen dasselbe meinen; ein Spaltentitel im Scrollkasten sieht in einem Screenshot
// genauso aus wie einer davor, bis man scrollt. Entwurf:
// docs/superpowers/specs/2026-08-15-vorkommeneditor-dreispaltig-design.md
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/features/lore.css", "utf8");
const tokens = fs.readFileSync("css/base/tokens.css", "utf8");

// Nur der Fensterrumpf, nicht das ganze Dokument: index.html enthaelt ein zweites, aelteres
// Vorkommen-Markup im Reiter, und eine Suche ueber die ganze Datei traefe beide.
const dialogStart = html.indexOf('id="wiki-sync-lore-overlay"');
assert.ok(dialogStart > -1, "das Vorkommen-Fenster steht in index.html");
const dialog = html.slice(dialogStart, html.indexOf('id="wiki-sync-conflicts-overlay"'));
assert.ok(dialog.length > 500 && dialog.length < 20000, "der Ausschnitt umfasst genau ein Fenster");

// ---- 1. Drei Spalten, und alle drei stehen IM RUHEZUSTAND -------------------------------------
// 💣 Das war der sichtbarste Unterschied: die beiden rechten Spalten entstanden frueher erst im
// JS-Markup von renderLoreDetail. Bis zum ersten Klick sah das Fenster zweispaltig aus.
for (const titel of ["Vorkommen", "Stammdaten"]) {
	assert.ok(
		dialog.includes(`class="lore-dlg__coltitle">${titel}<`)
		|| dialog.includes(`class="lore-dlg__coltitle" id="lore-dlg-places-title">${titel}<`),
		`der Spaltentitel „${titel}“ steht statisch im Markup, nicht erst nach einem Klick`
	);
}
assert.strictEqual((dialog.match(/lore-dlg__coltitle/g) || []).length, 3,
	"genau DREI Spaltentitel -- mehr oder weniger heisst, es sind keine drei Spalten");
for (const id of ["lore-dlg-scroll", "lore-dlg-stamm", "lore-dlg-places"]) {
	assert.ok(dialog.includes(`id="${id}"`), `der Scrollkasten #${id} steht im Markup`);
}
assert.ok(/id="lore-dlg-detailhead"/.test(dialog),
	"die feste Kopfzeile ueber den beiden rechten Spalten steht im Markup");

// 💣 Kopfzeile und Spaltentitel muessen AUSSERHALB der Kaesten stehen. renderLoreDetail
// ueberschreibt die Kaesten bei JEDEM gespeicherten Feld -- ein Titel darin waere danach weg.
const kopfPos = dialog.indexOf('id="lore-dlg-detailhead"');
const panelsPos = dialog.indexOf('class="lore-dlg__panels"');
assert.ok(kopfPos > -1 && panelsPos > kopfPos,
	"die Kopfzeile steht VOR dem Spaltenpaar, nicht darin");
const stammSpalte = dialog.slice(dialog.indexOf("lore-dlg__col--stamm"), dialog.indexOf('id="lore-dlg-stamm"'));
assert.ok(stammSpalte.includes("lore-dlg__coltitle"),
	"der Titel „Stammdaten“ steht VOR seinem Scrollkasten, nicht darin");

// ---- 2. Der Rahmen sitzt um den scrollenden Inhalt, nicht um die Spalte -----------------------
const kastenRegel = css.match(/\.lore-dlg__scroll,\s*\n\.lore-dlg__panelscroll \{[^}]*\}/);
assert.ok(kastenRegel, "es gibt EINE gemeinsame Regel fuer die drei Scrollkaesten");
assert.ok(/overflow-y:\s*auto/.test(kastenRegel[0]), "der Kasten scrollt");
assert.ok(/border:\s*1px solid var\(--color-border\)/.test(kastenRegel[0]), "der Kasten ist gerahmt");
assert.ok(/background:\s*var\(--color-panel\)/.test(kastenRegel[0]), "der Kasten ist die helle Flaeche");
// 💣 6px ist der harte Vorbild-Wert aus Siedlungen/Territorien, nicht --radius-sm (5px).
assert.ok(/border-radius:\s*6px/.test(kastenRegel[0]),
	"6px -- der Vorbild-Wert, den Siedlungen und Territorien auf den Pixel tragen");

// Die Spalte selbst ist durchsichtig: kein Rahmen, kein eigener Grund, nur Polsterung.
const spaltenRegel = css.match(/\n\.lore-dlg__col \{[^}]*\}/);
assert.ok(spaltenRegel, ".lore-dlg__col existiert");
assert.ok(/padding:\s*var\(--avm-col-pad\)/.test(spaltenRegel[0]),
	"die Spalte traegt die GETEILTE Polsterung --avm-col-pad, keine eigene Zahl");
assert.ok(!/border:/.test(spaltenRegel[0]) && !/background:/.test(spaltenRegel[0]),
	"die Spalte selbst bleibt durchsichtig -- sonst haette man zwei Rahmen ineinander");

// 💣 Der Kasten ist nur auf dunklerem Grund als Flaeche lesbar. Steht das Fenster auf
// --color-panel wie die Kaesten, haengt ihr Rahmen im Nichts (Abenteuer-Editor, ab3a7f97).
const fensterRegel = css.match(/#wiki-sync-lore-dialog \{[^}]*\}/);
assert.ok(fensterRegel, "#wiki-sync-lore-dialog wird gestylt");
assert.ok(/background:\s*var\(--color-page-bg\)/.test(fensterRegel[0]),
	"der Fenstergrund ist --color-page-bg, nicht --color-panel");
assert.ok(/padding:\s*0/.test(fensterRegel[0]),
	"Polsterung 0 -- Menueband und Statuszeile laufen bis an die Fensterkante");

// ⚠️ Jede Aenderung an der geteilten Dialoghuelle ist ueber die ID gescopet. .location-report-
// dialog__header gehoert ALLEN Dialogen; global geaendert wanderte sie durchs halbe Produkt.
for (const treffer of css.matchAll(/^\.location-report-dialog__(header|close)/gm)) {
	assert.fail(`lore.css aendert .location-report-dialog__${treffer[1]} global -- das trifft `
		+ "Ortsmeldung, Konfliktzentrum und WikiSync-Fall mit. Ueber #wiki-sync-lore-dialog scopen.");
}

// ---- 3. Die Huellenmasse stehen an EINER Stelle -----------------------------------------------
// Der Vorkommeneditor ist der einzige der fuenf, der kein iframe ist und editor-page.css nicht
// laedt. Die Token muessen deshalb in tokens.css stehen, das beide Welten laden -- abschreiben
// waere die Wiederholung genau des Fehlers, den editor-page.css beendet hat.
for (const token of ["--avm-col-pad", "--avm-ribbon-pad", "--avm-status-pad", "--avm-control-h"]) {
	assert.ok(new RegExp(`\\t${token}:`).test(tokens),
		`${token} steht in css/base/tokens.css`);
}
const editorPage = fs.readFileSync("css/components/editor-page.css", "utf8");
assert.ok(!/^\t--avm-col-pad:/m.test(editorPage),
	"die --avm-*-Token stehen NICHT mehr zusaetzlich in editor-page.css -- ein Wert, eine Stelle");

// ---- 4. Der Reiter „Alle“ ---------------------------------------------------------------------
const reiter = [...dialog.matchAll(/data-lore-dlg-kind="([a-z]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(reiter, ["all", "fauna", "flora", "ware", "spezies"],
	"„Alle“ steht als ERSTER Reiter, die vier Arten folgen in ihrer bisherigen Ordnung");
assert.ok(dialog.includes('data-lore-dlg-count="all"'),
	"„Alle“ traegt einen Zaehler-Chip wie seine vier Nachbarn");
// 💣 Der markierte Reiter und der Startwert im Code muessen dasselbe meinen.
const aktiverReiter = dialog.match(/class="wiki-sync-panel__tab is-active" type="button" data-lore-dlg-kind="([a-z]+)"/);
assert.ok(aktiverReiter, "genau ein Reiter traegt is-active");
const js = fs.readFileSync("js/review/review-wiki-sync.js", "utf8");
const startwert = js.match(/var avesmapsLoreListKind = \{ panel: "([a-z]+)", dialog: "([a-z]+)" \}/);
assert.ok(startwert, "der Startwert je Ansicht steht als ein Literal da");
assert.strictEqual(startwert[2], aktiverReiter[1],
	"Startwert und markierter Reiter muessen uebereinstimmen -- sonst zeigt die Markierung "
	+ "auf „Alle“, waehrend die Liste Fauna laedt");

// ---- 5. Die Listenzeile nennt ihre Art NUR in „Alle“ ------------------------------------------
// Die echten Globals, keine Fakes: ein gestubbter Escaper wuerde genau die Fehler verstecken,
// um die es hier geht. Das document ist die duennste Attrappe, die die Datei beim Laden braucht --
// sie ruft beim Einlesen renderWikiSyncSubjectRail() auf. Ein leeres getElementById reicht: die
// hier geprueften Funktionen bauen Text aus Daten und fassen das DOM nicht an.
const leeresDom = {
	getElementById: () => null,
	querySelectorAll: () => [],
	querySelector: () => null,
	addEventListener: () => {},
	createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {} }),
};
const context = { window: {}, document: leeresDom, console, setTimeout, clearTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(js, context);

const eintrag = {
	wiki_key: "wiki:braeubier", name: "Bräubier", kind: "ware", typ: "[[Bier]]",
	places: ["Weiden", "Kosch"], place_count: 2, origin: "wiki", wiki_url: "",
};
const inAlle = context.avesmapsLoreListRowHtml(eintrag, true);
const inWaren = context.avesmapsLoreListRowHtml(eintrag, false);
assert.ok(inAlle.includes("Ware · Bier · Weiden, Kosch"),
	"in „Alle“ fuehrt die Art die Meta-Zeile an -- „Bräubier“ und „Bräuwurm“ sind sonst nicht "
	+ "zu unterscheiden. Ist: " + inAlle);
assert.ok(inWaren.includes("Bier · Weiden, Kosch") && !/>Ware · /.test(inWaren),
	"in „Waren“ steht die Art NICHT -- dasselbe Wort in jeder Zeile waere Laerm");
// 💣 Der Singular. wikiSyncSubjectViewTabs("lore") sagt „Waren“ (der REITER), ein einzelner
// Eintrag ist eine „Ware“. Genau bei dieser einen Art faellt der Unterschied auf.
assert.strictEqual(context.avesmapsLoreKindLabel("ware"), "Ware", "ein Eintrag ist eine „Ware“");
assert.strictEqual(context.avesmapsLoreKindLabel("fauna"), "Fauna", "Fauna bleibt Fauna");

// 💣 map() reicht den INDEX als zweites Argument durch. Stuende in renderLoreList noch
// `items.map(avesmapsLoreListRowHtml)`, landete er in showKind: Zeile 0 ohne Art, jede weitere
// mit -- ein Fehler, den man in einem Screenshot der ersten Zeile nie sieht.
// Kommentarzeilen raus: die Warnung davor steht als Kommentar im Code und wuerde sich selbst
// ausloesen -- eine Pruefung, die ihre eigene Begruendung als Verstoss liest, ist kaputt.
const jsCode = js.split("\n").filter((zeile) => !/^\s*(\/\/|\*|\/\*)/.test(zeile)).join("\n");
assert.ok(!/items\.map\(avesmapsLoreListRowHtml\)/.test(jsCode),
	"avesmapsLoreListRowHtml wird nie direkt an map() gereicht -- der Index landete in showKind");
assert.strictEqual((jsCode.match(/items\.map\(zeile\)/g) || []).length, 2,
	"BEIDE Zeichenwege (Erst-Laden und Nachladen) gehen ueber dieselbe Zeilen-Funktion -- sonst "
	+ "zeigt die nachgeladene Seite andere Zeilen als die erste");

// ---- 6. Die Leichen sind wirklich weg ---------------------------------------------------------
// Ein zurueckgebliebener Verweis auf die alte Struktur faellt nicht auf: er wirft nicht, er tut
// nur nichts. Genau so bliebe eine Spalte leer, ohne dass irgendwo ein Fehler stuende.
for (const leiche of ['getElementById("lore-detail")', 'getElementById("lore-dlg-edit")']) {
	assert.ok(!js.includes(leiche),
		`${leiche} ist weg -- die Maske steht seit 2026-08-15 direkt im Fensterrumpf`);
}
for (const leiche of [".lore-detail__cols {", ".lore-detail__col {", ".lore-dlg__edit {", ".lore-dlg__list {"]) {
	assert.ok(!css.includes(leiche), `die Regel ${leiche} ist weg -- ihr Markup gibt es nicht mehr`);
}

console.log("lore-dialog-layout: alle Zusagen des Entwurfs gehalten");
