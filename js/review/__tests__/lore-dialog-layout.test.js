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
// 🔴 Der Statuskreis-Bauer ZUERST, aus seiner echten Datei -- genau wie index.html ihn laedt.
// Kein Stub: die Zeile ruft ihn ohne Vorbehalt auf, und ein Fake wuerde verstecken, ob die
// Verdrahtung ueberhaupt haelt (das war der Kraftlinien-Fehler vom 18.08.2026).
vm.runInContext(fs.readFileSync("js/ui/listen-statuskreis.js", "utf8"), context);
vm.runInContext(js, context);

const eintrag = {
	wiki_key: "wiki:braeubier", name: "Bräubier", kind: "ware", typ: "[[Bier]]",
	places: ["Weiden", "Kosch"], place_count: 2, origin: "wiki", wiki_url: "",
};
const inAlle = context.avesmapsLoreListRowHtml(eintrag, true, "tree");
const inWaren = context.avesmapsLoreListRowHtml(eintrag, false, "tree");
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

// ---- 5b. Zwei FORMEN, ein Inhalt -------------------------------------------------------------
// Der Reiter zeigt die Panel-Zeile (flach, Trennlinie), das Fenster die Editor-Zeile (schwebend,
// gerundet) -- weil das Fenster neben Karten-, Literatur- und Ortseditor steht und nicht neben
// dem Reiter (Owner 2026-08-15: „angleichen"). Welche Form gilt, entscheidet die ANSICHT.
assert.strictEqual(context.AVESMAPS_LORE_VIEWS.panel.rowForm, "tree",
	"der Reiter zeigt die Panel-Zeile wie seine sieben Nachbarlisten");
assert.strictEqual(context.AVESMAPS_LORE_VIEWS.dialog.rowForm, "avm",
	"das Fenster zeigt die Editor-Zeile wie die uebrigen Editorfenster");

const alsEditorzeile = context.avesmapsLoreListRowHtml(eintrag, true, "avm");
assert.ok(/class="avm-row has-map-status"/.test(alsEditorzeile), "die Fensterzeile ist eine .avm-row");
assert.ok(/avm-row__name">Bräubier</.test(alsEditorzeile), "Name in .avm-row__name");
assert.ok(/avm-row__l2">Ware · Bier · Weiden, Kosch</.test(alsEditorzeile),
	"Meta-Zeile in .avm-row__l2, mit derselben Angabe wie im Reiter. Ist: " + alsEditorzeile);
assert.ok(!/tree-item/.test(alsEditorzeile), "keine Panel-Klassen in der Fensterzeile");
assert.ok(/tree-item-name">Bräubier</.test(inAlle) && !/avm-row/.test(inAlle),
	"und umgekehrt: die Reiterzeile bleibt .tree-item");

// 🔴 EIN Inhalt. Beide Formen muessen dieselben Angaben tragen -- wer eine nur in einen Zweig
// schreibt, hat die Listen auseinandergetrieben, und das sieht niemand, weil man sie nie
// nebeneinander sieht. Verglichen wird der reine Text ohne Huelle.
const nurText = (html) => html.replace(/<[^>]*>/g, "").trim();
assert.strictEqual(nurText(alsEditorzeile), nurText(inAlle),
	"Reiter- und Fensterzeile sagen nicht dasselbe:\n  Reiter:  " + nurText(inAlle)
	+ "\n  Fenster: " + nurText(alsEditorzeile));
for (const merkmal of ['data-lore-entry="wiki:braeubier"', 'title="Bräubier – klicken zum Bearbeiten"']) {
	assert.ok(alsEditorzeile.includes(merkmal) && inAlle.includes(merkmal),
		`beide Formen tragen ${merkmal} -- daran haengt der Klick-Handler`);
}

// ⭐ Der offene Eintrag ist im Fenster MARKIERT. Das leistet der transparente 1px-Rahmen der
// Klasse, der beim Auswaehlen nur die Farbe wechselt (deshalb springt die Zeile nicht).
context.avesmapsLoreDetailKey = "wiki:braeubier";
assert.ok(/class="avm-row has-map-status is-selected"/.test(context.avesmapsLoreListRowHtml(eintrag, true, "avm")),
	"der offene Eintrag traegt is-selected");
assert.ok(!/is-selected/.test(context.avesmapsLoreListRowHtml(
	Object.assign({}, eintrag, { wiki_key: "wiki:anderes" }), true, "avm")),
	"ein anderer Eintrag nicht");
// 💣 Leerer Schluessel darf NICHT jede Zeile markieren -- ein Eintrag ohne wiki_key waere sonst
// dauerhaft „offen", sobald nichts geoeffnet ist.
context.avesmapsLoreDetailKey = "";
assert.ok(!/is-selected/.test(context.avesmapsLoreListRowHtml(
	Object.assign({}, eintrag, { wiki_key: "" }), true, "avm")),
	"ohne offenen Eintrag ist keine Zeile markiert, auch keine ohne Schluessel");

// ---- 5c. ZWEI Zeilen, nicht eine ---------------------------------------------------------------
// 💣 Name und Meta klebten in JEDER Zeile des Fensters aneinander -- gerendert stand dort
// „1001 RauschWare · Parfüm · Belhanka" (Owner 18.08.2026). Grund: `.avm-row__text` ist als
// Flex-Kind ein Block, seine beiden `<span>`-Kinder sind aber inline und teilen sich damit EINE
// Zeilenbox. Den Umbruch macht allein `.avm-row__l1` -- `display:flex`, also ein Block-Kasten.
// 🔴 Deshalb wird hier BEIDES geprueft: dass das Markup die Huelle setzt UND dass sie im
// Stylesheet ein Block ist. Nur das Markup zu pruefen liesse den Fehler zurueckkommen, sobald
// jemand `.avm-row__l1` auf `display:inline` stellt -- die Zusicherung waere dann gruen und die
// Liste wieder einzeilig.
const fensterzeile = context.avesmapsLoreListRowHtml(eintrag, true, "avm");
assert.ok(/<span class="avm-row__l1"><span class="avm-row__name">Bräubier<\/span>/.test(fensterzeile),
	"der Name steht in `.avm-row__l1` wie in den fuenf Nachbarlisten -- ohne diese Huelle laufen "
	+ "Name und Meta-Zeile in EINE Zeile zusammen. Ist: " + fensterzeile);
// ⚠️ Und `__l1` und `__l2` sind GESCHWISTER, nicht ineinander verschachtelt: der Umbruch entsteht
// daraus, dass ein Block-Kasten neben einem Inline-Kasten steht. Steckt `__l2` in `__l1`, sieht das
// Markup fast gleich aus und die Zeile ist wieder einzeilig -- deshalb wird die ganze Form des
// Textblocks verglichen und nicht bloss die Anwesenheit einer Klasse.
const erwarteterTextblock = '<span class="avm-row__text">'
	+ '<span class="avm-row__l1"><span class="avm-row__name">Bräubier</span>'
	+ '<span class="tree-map-status tree-map-status--own-only" aria-hidden="true"></span></span>'
	+ '<span class="avm-row__l2">Ware · Bier · Weiden, Kosch</span>'
	+ "</span>";
assert.ok(fensterzeile.includes(erwarteterTextblock),
	"Der Textblock der Fensterzeile hat nicht mehr die Form der fuenf Nachbarlisten "
	+ "(`__l1` mit Name und Statuskreis, daneben `__l2`).\n  Erwartet: " + erwarteterTextblock
	+ "\n  Ist:      " + fensterzeile);
const editorRowCss = fs.readFileSync("css/components/editor-row.css", "utf8");
const l1Regel = editorRowCss.match(/\.avm-row__l1\s*\{[^}]*\}/);
assert.ok(l1Regel && /display:\s*flex/.test(l1Regel[0]),
	"`.avm-row__l1` muss ein BLOCK-Kasten sein (display:flex) -- daran haengt der Zeilenumbruch "
	+ "zwischen Name und Meta-Zeile, nicht an einem Rand oder einem <br>.");
// ⚠️ Dass die Panel-Zeile sich die Huelle NICHT abschaut, steht schon in Abschnitt 5b
// („keine Panel-Klassen in der Fensterzeile" und die Gegenprobe darunter) -- eine zweite
// Zusicherung dafuer waere tot: sie wuerde nie als erste ausloesen. Ihr Umbruch kommt ohnehin
// aus dem Raster (`.wikisync-itemlist .tree-item` ist `display:grid` mit zwei Reihen).

// ---- 5d. Der Statuskreis, und warum er NICHT aus `places` gezaehlt werden darf -----------------
// Die Regel selbst (voll = mindestens ein Fundort auf der Karte) steht in
// js/ui/__tests__/listen-statuskreis.test.js. Hier steht die FALLE dieser Liste: `places` traegt
// hoechstens 6 Titel (api/_internal/app/lore.php kappt sie), `place_count` und
// `place_mapped_count` zaehlen dagegen ALLE Ortszeilen.
// 💣 Ein Eintrag mit sieben Orten, dessen einziger verorteter der siebte ist, faerbte sich
// deshalb faelschlich halb, sobald jemand die Verortung aus der Titelliste rechnet.
const vieleOrte = Object.assign({}, eintrag, {
	places: ["Schiff", "Myranor", "Nordaventurien", "Mittelaventurien", "Schattenlande", "Uthuria"],
	place_count: 7,
	place_mapped_count: 1,
});
assert.ok(/tree-map-status--all/.test(context.avesmapsLoreListRowHtml(vieleOrte, true, "avm")),
	"Ein Eintrag mit sieben Orten, von denen genau EINER auf der Karte liegt, muss den VOLLEN "
	+ "Kreis tragen -- auch wenn keiner der sechs angezeigten Titel der verortete ist.");
assert.ok(/tree-map-status--own-only/.test(context.avesmapsLoreListRowHtml(
	Object.assign({}, vieleOrte, { place_mapped_count: 0 }), true, "avm")),
	"Und ohne einen einzigen verorteten Ort bleibt er halb.");
// ⚠️ Die Meta-Zeile zeigt weiterhin die gekappte Titelliste samt „+1" -- der Kreis rechnet
// anders als der Text, und genau das ist beabsichtigt.
assert.ok(/Uthuria \+1</.test(context.avesmapsLoreListRowHtml(vieleOrte, true, "avm")),
	"Die Meta-Zeile nennt weiter die sechs Titel und den Rest als Zahl.");

// ---- 5e. Eine REGEL ist ein Vorkommen ----------------------------------------------------------
// Owner 18.08.2026: „regeln (sofern vorhanden und mit verbreitung) sind gueltige vorkommen“.
// 🔴 Sie aendert NUR, was als Vorkommen zaehlt -- nicht die drei Stufen. Der Fall, der das
// beweist, steht live: „Alprute“ hat KEINE einzige Ortszeile und eine Regel ueber 119 Waelder.
const nurRegel = Object.assign({}, eintrag, {
	name: "Alprute", places: [], place_count: 0, place_mapped_count: 0,
	rule_count: 1, rule_mapped_count: 1,
});
assert.ok(/tree-map-status--all/.test(context.avesmapsLoreListRowHtml(nurRegel, true, "avm")),
	"Ein Eintrag OHNE Ortszeile, dessen Regel Flaechen trifft, muss den VOLLEN Kreis tragen. "
	+ "Ist: " + context.avesmapsLoreListRowHtml(nurRegel, true, "avm"));
// 💣 Und eine Regel, die (noch) nichts trifft, macht ihn HALB -- nie leer. „Vorhanden“ und
// „trifft etwas“ sind zwei Fragen; waehrend „Zugehoerigkeit rechnen“ laeuft, ist die zweite
// vorruebergehend nein.
assert.ok(/tree-map-status--own-only/.test(context.avesmapsLoreListRowHtml(
	Object.assign({}, nurRegel, { rule_mapped_count: 0 }), true, "avm")),
	"Eine Regel ohne Treffer ist HALB, nicht leer -- das Vorkommen ist da, es liegt nur nirgends.");
// ⚠️ Und ohne beides bleibt es leer.
assert.ok(!/tree-map-status--/.test(context.avesmapsLoreListRowHtml(
	Object.assign({}, nurRegel, { rule_count: 0, rule_mapped_count: 0 }), true, "avm")),
	"Ohne Ortszeile UND ohne Regel bleibt der Ring leer.");
// 💣 Die Meta-Zeile muss die Regel NENNEN, sonst widerspricht der Text dem Kreis: voller Kreis
// neben „ohne Ortsangabe“ liest sich wie ein Fehler.
const alpruteZeile = context.avesmapsLoreListRowHtml(nurRegel, true, "avm");
assert.ok(/1 Regel</.test(alpruteZeile) && !/ohne Ortsangabe/.test(alpruteZeile),
	"Ein Eintrag mit Regel und ohne Ortszeile sagt „1 Regel“, nicht „ohne Ortsangabe“. Ist: "
	+ alpruteZeile);
// ⚠️ `place_count` bleibt die Zahl der ORTSZEILEN -- der „+N“-Zaehler der Meta-Zeile haengt daran,
// und eine Regel ist dort kein Ortsname.
const ortUndRegel = Object.assign({}, eintrag, { rule_count: 2, rule_mapped_count: 0 });
assert.ok(/Weiden, Kosch · 2 Regeln</.test(context.avesmapsLoreListRowHtml(ortUndRegel, true, "avm")),
	"Orte und Regeln stehen nebeneinander in der Meta-Zeile, mit demselben Trenner.");

// ---- 5f. Der Kreis geht mit, wenn etwas dazukommt ---------------------------------------------
// Owner 18.08.2026: „der gruene punkt soll sich aktualisieren, wenn was dazu kommt".
// 🔴 Geprueft wird HIER die reine Haelfte (welche Zeilenform baut der Auffrischer aus der
// Detail-Antwort) und die VERDRAHTUNG. Der Knotentausch selbst braucht ein echtes DOM; er ist im
// Browser gegen die echten Stylesheets gemessen (leer -> voll -> halb, in BEIDEN Listen) und wird
// hier NICHT behauptet -- eine Zusicherung gegen ein selbstgebautes document pruefte die Attrappe.
const ausDetail = context.avesmapsLoreRowItemFromDetail({
	wiki_key: "wiki:braeubier", kind: "ware", name: "Bräubier", typ: "[[Bier]]", origin: "wiki",
	places: [
		{ place_title: "Weiden", status: "active" },
		{ place_title: "Schiff", status: "suppressed" },
		{ place_title: "Kosch", status: "active" },
	],
	place_count: 2, place_mapped_count: 1, rule_count: 3, rule_mapped_count: 2,
});
// 💣 Ein GRABSTEIN ist kein Vorkommen mehr. Der Detail-Leser liefert ihn mit (der Editor muss
// seine eigenen Grabsteine sehen), der Katalog nie -- zaehlte er hier mit, nennte die Zeile einen
// Ort, den jemand gerade entfernt hat.
assert.deepStrictEqual(ausDetail.places, ["Weiden", "Kosch"],
	"Der Auffrischer nimmt nur AKTIVE Ortszeilen in die Meta-Zeile. Ist: " + JSON.stringify(ausDetail.places));
// ⚠️ Und alle vier Zahlen reisen durch -- faellt eine, faerbt die Zeile nach dem ersten Klick
// still anders als beim Laden.
assert.deepStrictEqual(
	[ausDetail.place_count, ausDetail.place_mapped_count, ausDetail.rule_count, ausDetail.rule_mapped_count],
	[2, 1, 3, 2],
	"Alle vier Zahlen des Statuskreises muessen aus der Detail-Antwort in die Zeile durchreichen.");
// 💣 Dieselbe Kappung auf 6 wie im Server: `place_count` zaehlt ALLE aktiven, die Zeile rechnet
// daraus ihr „+N". Kappte der Auffrischer anders, stimmte der Rest-Zaehler nach dem ersten Klick nicht.
const vieleTitel = context.avesmapsLoreRowItemFromDetail({
	wiki_key: "x", places: Array.from({ length: 9 }, (_, i) => ({ place_title: "Ort" + i, status: "active" })),
	place_count: 9,
});
assert.strictEqual(vieleTitel.places.length, 6,
	"Der Auffrischer kappt die Titelliste bei 6 -- genau wie avesmapsLoreReadCatalog.");

// ── VERDRAHTUNG ────────────────────────────────────────────────────────────────────────────────
// 🔴 EIN Trichter: alle vier Schreibwege des Kastens „Vorkommen" muenden in renderLoreDetail
// (add_place / remove_place / set_field direkt, save_rule / delete_rule ueber openLoreDetail).
// Haengte die Aktualisierung an den Aufrufstellen, waere sie beim naechsten Knopf vergessen.
const renderKoerper = js.slice(js.indexOf("function renderLoreDetail(entry) {"),
	js.indexOf("function avesmapsLoreListRowHtml") > js.indexOf("function renderLoreDetail(entry) {")
		? js.indexOf("function avesmapsLoreListRowHtml") : js.length);
assert.ok(/avesmapsLoreRefreshRowStatus\(entry\)/.test(renderKoerper.slice(0, 2000)),
	"renderLoreDetail frischt den Statuskreis der Listenzeile nicht auf. Dann steht der Kreis nach "
	+ "„+ Ort“ / „+ Regel“ auf dem Stand des letzten Ladens.");
// ⚠️ BEIDE Oberflaechen. Man sieht Reiter und Fenster nie gleichzeitig -- eine von beiden liefe
// sonst still veraltet weiter, und niemandem fiele es auf.
const auffrischer = js.slice(js.indexOf("function avesmapsLoreRefreshRowStatus(entry) {"));
assert.ok(/Object\.keys\(AVESMAPS_LORE_VIEWS\)\.forEach/.test(auffrischer.slice(0, 1200)),
	"Der Auffrischer laeuft nicht ueber BEIDE Ansichten (AVESMAPS_LORE_VIEWS) -- eine der zwei "
	+ "Listen behielte ihren alten Kreis.");
// 💣 Und er baut die Zeile mit DEMSELBEN Bauer wie beim Laden -- sonst haette die Liste nach dem
// ersten Klick eine zweite Zeilenform, und genau das ist die Divergenz, gegen die es nur zwei
// Rezepturen im Haus gibt.
assert.ok(/avesmapsLoreListRowHtml\(item, avesmapsLoreListKind\[view\] === "all", ids\.rowForm\)/.test(auffrischer.slice(0, 1600)),
	"Der Auffrischer baut die Zeile nicht mit avesmapsLoreListRowHtml und der Form der jeweiligen Ansicht.");

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
