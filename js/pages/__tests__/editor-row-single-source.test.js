// Die Listenzeile der Editorfenster steht genau EINMAL -- als .avm-row in
// css/components/editor-page.css.
//
// 🔴 DIESER TEST EXISTIERT WEGEN VIER ABSCHRIFTEN. Vor dem 14.08.2026 trug jeder Editor seine
// eigene, inline im HTML:
//   .se-row   im Ortseditor
//   .se-row   NOCH EINMAL wortgleich im Kraftlinien-Editor -- dort sogar mit dem Kommentar
//             "/* Listenzeilen (Referenz .se-row) */", also nachweislich abgeschrieben
//   .ae-item  im Literatur-Editor
//   .ce-item  als wortgleicher Zwilling im Karteneditor
// Der Ortseditor sagte in seinem eigenen Kommentar: "Abenteuer- und Kartensammlungs-Editor tragen
// dieselbe Zeilengeometrie". Man wusste es und schrieb sie trotzdem dreimal.
//
// 💣 Beim Abschreiben ging die Skala verloren: .se-row-type und .se-row-l2 setzten
// font-size:10px, waehrend das Original --font-size-caption (11px) benutzt. 11px ist die
// Untergrenze in docs/design-language.md, und der Fehler wurde von einer Abschrift in die
// naechste weitergereicht. Genau so wandert ein Fehler durch ein Projekt: nicht durch
// Nachlaessigkeit, sondern durch Kopieren.
//
// 🔴 Alle sechs Editoren laden css/components/editor-page.css bereits -- die Abschriften waren
// ersatzlos abloesbar, ohne ein neues Stylesheet.
//
// Run: node js/pages/__tests__/editor-row-single-source.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

const editoren = [
	"wiki-sync-settlement-editor.html",
	"wiki-sync-powerline-editor.html",
	"wiki-sync-monitor.html",
	"wege-editor.html",
	"landschaften-editor.html",
	"game-literature-editor.html",
	"citymap-editor.html",
];

let checks = 0;

for (const datei of editoren) {
	const html = lies("html", datei);

	assert.ok(/editor-page\.css/.test(html),
		`${datei} laedt css/components/editor-page.css nicht -- ohne sie gibt es kein .avm-row.`);
	checks++;

	for (const klasse of ["se-row", "ae-item", "ce-item"]) {
		assert.ok(!new RegExp("\\." + klasse + "\\s*\\{").test(html),
			`${datei} definiert wieder eine eigene ".${klasse}"-Regel inline. Die Listenzeile der `
			+ "Editoren heisst .avm-row und steht in css/components/editor-page.css. Eine Abschrift "
			+ "sieht am Tag ihrer Entstehung identisch aus und driftet danach -- viermal geschehen.");
		checks++;
	}

	// ⚠️ Die 11px-Untergrenze gilt jetzt der GANZEN Editorseite, nicht nur der Listenzeile.
	// Bis zum 14.08.2026 stand der Wert auch an Abzeichen (.dt-badge), Hinweisen (.pl-hint,
	// .dt-img-hint, #seTreeBypassHint), Bild-Beschriftungen (.dt-img-ord, .dt-wappen-edit) und
	// Pfeil-Glyphen (.tree-toggle, die ▲▼-Knoepfe) -- einer davon sogar auf 9px. Der Owner hat
	// sie am 14.08.2026 mitgenommen ("ja mach die 10px auch noch").
	// 🔴 Geprueft werden nur DEKLARATIONEN (mit Semikolon). Die Kommentare dieser Dateien
	// erzaehlen die Geschichte des Werts und schreiben ihn woertlich hin -- ein Test, der sie
	// mitliest, meldet die Begruendung als Verstoss. Genau das ist beim Panel-Wachtest zweimal
	// passiert (js/review/__tests__/wikisync-list-form.test.js).
	const zuKlein = html.match(/font-size:\s*(?:[0-9]|10|10\.5)px;/g) || [];
	assert.deepStrictEqual(zuKlein, [],
		`${datei} setzt eine Schriftgroesse unter 11px. Die Untergrenze ist `
		+ "var(--font-size-caption) (docs/design-language.md, das dort ausdruecklich die 'alten "
		+ "9-10,5px-Mikrogroessen' meint). Gefunden: " + zuKlein.join(" "));
	checks++;
}

// ---- Und die Gegenrichtung: niemand darf eine tote Zeilenklasse mehr ABFRAGEN ------------------
// 💣 Aus dem CSS sind die Abschriften verschwunden, im JS standen ihre Namen weiter. Der
// Ortseditor schaltete die Auswahl-Hervorhebung seiner Liste ueber
// `list.querySelectorAll(".se-row")` um -- seit dem 14.08.2026 eine LEERE Liste, die Schleife
// darueber tat also gar nichts. Die Hervorhebung blieb beim Anklicken auf der zuvor gewaehlten
// Zeile stehen, bis Suche, Filter oder Reiter die Liste aus einem anderen Grund neu zeichneten;
// es sah nach einem Aussetzer aus, nicht nach einem Fehler. Gefunden am 17.08.2026.
//
// 🔴 Der Test oben konnte das nicht sehen: er prueft REGELN, und die Regel war ja korrekt
// entfernt. Eine Abschrift stirbt im CSS, ihr Name lebt im JS weiter -- und ein Selektor auf
// eine Klasse, die es nicht gibt, wirft nicht.
//
// 🔴 Geprueft wird nur die AUFRUFFORM, nicht das blosse Wort -- dieselbe Falle wie beim
// 11px-Test: die Kommentare dieser Dateien schreiben `.se-row` woertlich hin, und ein Test, der
// sie mitliest, meldet seine eigene Begruendung als Verstoss.
// ⚠️ .se-row-coat, .se-row-terr, .se-row-imgcount und .ce-item__thumb leben weiter: das sind die
// ortsgebundenen Teile, die .avm-row nicht kennt. Die Wortgrenze (?![\w-]) trennt sie ab.
const toteAbfrage = /(?:querySelector|querySelectorAll|closest|matches)\(\s*["'`][^"'`]*\.(se-row|ae-item|ce-item)(?![\w-])/g;
const jsQuellen = editoren.map((d) => ["html", d]).concat([["js", "pages", "wege-editor.js"]]);
for (const teile of jsQuellen) {
	const treffer = lies(...teile).match(toteAbfrage) || [];
	assert.deepStrictEqual(treffer, [],
		`${teile.join("/")} fragt eine Zeilenklasse ab, die keine Zeile mehr traegt. Die `
		+ "Listenzeile der Editoren heisst .avm-row (css/components/editor-row.css). So ein Selektor "
		+ "wirft nicht -- er liefert eine leere Liste, und die Schleife darueber tut lautlos gar "
		+ "nichts. Gefunden: " + treffer.join(" "));
	checks++;
}

// ---- Das Original traegt die Skala --------------------------------------------------------------
// 🔴 Es steht seit 2026-08-15 in css/components/editor-row.css, NICHT mehr in editor-page.css.
// Grund: der Vorkommeneditor ist der einzige der sieben, der kein iframe ist -- er lebt als Dialog
// in index.html und sieht editor-page.css nie, soll aber dieselbe Zeile zeigen wie die
// Nachbarfenster (Owner 2026-08-15: „angleichen"). Die Regel steht weiterhin GENAU EINMAL; nur die
// Datei erreichen jetzt beide Welten.
const editorRow = lies("css", "components", "editor-row.css");
assert.ok(/\.avm-row__l2\s*\{[\s\S]*?font-size:\s*var\(--font-size-caption\)/.test(editorRow),
	".avm-row__l2 muss auf var(--font-size-caption) stehen -- sonst hat die Vereinheitlichung "
	+ "den Fehler der Abschriften uebernommen statt ihn zu beheben.");
checks++;
assert.ok(/\.avm-row__kind\s*\{[\s\S]*?font-size:\s*var\(--font-size-caption\)/.test(editorRow),
	".avm-row__kind muss auf var(--font-size-caption) stehen.");
checks++;

// ---- Eine Datei, ZWEI Wege hinein ---------------------------------------------------------------
// 💣 Faellt einer der beiden Importe weg, verschwindet die Zeile in EINER Welt -- lautlos. In der
// App saehe die Vorkommen-Liste wieder aus wie eine Panel-Liste, in den Editorseiten haetten die
// Zeilen ueberhaupt keine Form mehr. Beides wirft nicht.
const editorPage = lies("css", "components", "editor-page.css");
assert.ok(/@import\s+url\("editor-row\.css"\)/.test(editorPage),
	"editor-page.css importiert editor-row.css nicht mehr -- damit haetten die sechs Editorseiten "
	+ "keine Listenzeile.");
checks++;
assert.ok(/@import\s+url\("components\/editor-row\.css"\)/.test(lies("css", "styles.css")),
	"css/styles.css importiert components/editor-row.css nicht mehr -- damit faellt die "
	+ "Auswahlliste im Vorkommen-Fenster auf die Panel-Form zurueck.");
checks++;
// ⚠️ Ein @import gilt nur VOR jeder Regel (nur Kommentare duerfen davor stehen). Steht er weiter
// unten, ignorieren ihn die Browser stillschweigend -- die Datei sieht dann korrekt aus und wirkt
// trotzdem nicht.
const vorImport = editorPage.slice(0, editorPage.indexOf('@import url("editor-row.css")'));
assert.ok(!/[^\s]\s*\{/.test(vorImport.replace(/\/\*[\s\S]*?\*\//g, "")),
	"In editor-page.css steht eine Regel VOR dem @import. Ein @import nach der ersten Regel wird "
	+ "ignoriert -- die Editorseiten haetten dann keine Listenzeile, ohne jede Fehlermeldung.");
checks++;

// ---- Keine Editor-Kurznamen in der geteilten Datei ----------------------------------------------
// 💣 --mut/--ok/--warn sind lokale Aliase aus editor-page.css und existieren in index.html NICHT.
// Eine ungueltige var() macht `color` zu `inherit`: die Meta-Zeile waere im Vorkommen-Fenster
// still nicht mehr gedaempft, und zwar genau dort, wo niemand danach sucht.
const kurznamen = editorRow.replace(/\/\*[\s\S]*?\*\//g, "").match(/var\(--(mut|ok|warn|bad|fg|line|soft|panel|bg|accent)\b/g) || [];
assert.deepStrictEqual(kurznamen, [],
	"editor-row.css benutzt einen Editor-Kurznamen. Die Datei wird auch von der App geladen, wo es "
	+ "die Aliase nicht gibt -- hier gehoert das echte Token hin. Gefunden: " + kurznamen.join(" "));
checks++;

// ---- Die Aufklapp-Spalte gehoert der LISTE, nicht der Zeile ------------------------------------
// 🔴 DIESELBE REGEL WIE BEI DEN ZIEHGRIFFEN IM PANEL, zweite Oberflaeche, zweiter Anlauf. Im
// Wege-Editor tragen mehrteilige Wege einen Aufklapp-Pfeil (12px + 8px Abstand), einteilige nicht.
// Ohne Platzhalter begann deren Name 20px weiter links -- der Owner hat es am 14.08.2026 gemeldet,
// wortgleich zu seiner frueheren Meldung ueber Adamantenland in der Regionenliste.
//
// 💣 Der erste Anlauf reservierte die Spalte nur fuer die OBERSTE Ebene. Dadurch stand der
// verschachtelte Abschnitt bei x=39, also LINKER als sein Gruppenkopf bei x=44 -- ein Kind linker
// als sein Elternteil. Die Einrueckung von .wp-segment kommt OBENDRAUF, nicht anstelle der Spalte.
// Gemessen nach der Korrektur: Gruppe und Einzelweg beide bei 44, Abschnitte bei 59.
const wege = lies("js", "pages", "wege-editor.js");
const platzhalter = wege.match(/var platzhalter = ([^;]+);/);
assert.ok(platzhalter, "js/pages/wege-editor.js baut keinen Platzhalter fuer die Aufklapp-Spalte mehr.");
checks++;
assert.ok(!/\?/.test(platzhalter[1]),
	"Der Platzhalter der Aufklapp-Spalte ist wieder an eine Bedingung geknuepft: "
	+ platzhalter[1].trim() + "\nEr gilt JEDER Zeile der Liste. Nur der obersten Ebene reicht "
	+ "nicht -- dann steht der verschachtelte Abschnitt linker als sein eigener Gruppenkopf.");
checks++;
assert.ok(/wp-group__twist/.test(platzhalter[1]),
	"Der Platzhalter benutzt nicht mehr .wp-group__twist und hat damit nicht mehr die Breite der "
	+ "echten Spalte.");
checks++;

// ---- Die Feldregeln .dt-* stehen ebenfalls genau EINMAL -----------------------------------------
// 🔴 ZWEITER ANLAUF DESSELBEN FEHLERS, EINEN KOMMENTAR TIEFER. Alles oben galt der Listenzeile.
// Die Feldregeln der dritten Spalte -- .dt-grp, .dt-grid, .dt-check, .dt-actions, .dt-msg,
// .dt-link -- standen am 16.08.2026 immer noch ein ZWEITES Mal inline: im Ortseditor (der
// Vorlage), im Kraftlinien-Editor und im Monitor. Der Monitor sagte es in seinem eigenen
// Kommentar sogar an ("Gehoert perspektivisch ganz nach editor-page.css -- dafuer muesste auch
// der Siedlungseditor angefasst werden") und wartete darauf ein Vierteljahr.
//
// 💣 Sie gewannen die Kaskade NICHT ueber die Spezifitaet, sondern ueber die REIHENFOLGE: der
// <style>-Block steht hinter dem <link>. Deshalb faellt so eine Abschrift nie auf -- sie wirkt
// sofort und sieht am Tag ihrer Entstehung richtig aus. Gemessen war sie laengst gedriftet:
// Feldtext 12px statt var(--font-size-body) (13px), Zeilenpolster 5px statt var(--space-2) (4px),
// .dt-actions margin-top:12px auf einem Wert, den ueberhaupt kein Token kennt.
//
// 🪤 Und die Lehre, die eine Messung gekostet hat: eine Abschrift ueberstimmt nur, was sie auch
// HINSCHREIBT. Im Ortseditor waren .dt-grp{display:flex} und .dt-link{text-decoration:none}
// vorhergesagte Aenderungen -- und blieben gleich, weil die lokale Fassung diese Eigenschaften
// gar nicht deklarierte und die geteilte Regel dort immer schon mitwirkte.
//
// ⚠️ VERBOTEN IST NUR DER EXAKTE REGELKOPF. Ortsgebundene Erweiterungen sind erlaubt und noetig:
//    .dt-grid.stack + .dt-grid textarea  (Kraftlinien-Beschreibung -- die geteilte Datei kleidet
//                                         input[type=text|url|number] und select ein, KEIN textarea)
//    .dt-grid input.dt-in + .dt-grid .k.ovr  (Bearbeiten-Modus des Monitors)
//    .dt-badge, .dt-empty                    (kein Gegenstueck in der geteilten Datei)
//
// 🔴 Geprueft wird NUR in <style>-Bloecken und NUR nach Abzug der Kommentare -- exakt die Falle,
// an der der 11px-Test oben zweimal haengengeblieben ist: die Begruendungen in diesen Dateien
// schreiben die verbotenen Selektoren woertlich hin.
const dtGeteilt = [
	".dt-grp", ".dt-grid", ".dt-grid .k", ".dt-grid > div:not(.k)",
	".dt-check", ".dt-check input", ".dt-actions", ".dt-msg", ".dt-link",
];
// Die beiden Erstlings-Varianten zusaetzlich: die geteilte Datei nimmt :first-child, die
// Abschriften nahmen :first-of-type. Beide gehoeren nicht mehr in eine Editorseite.
const dtVerboten = dtGeteilt.concat([".dt-grp:first-of-type", ".dt-grp:first-child", ".dt-msg.ok", ".dt-msg.bad"]);

const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const einzeilig = (s) => s.replace(/\s+/g, " ");
const kopf = (sel) => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " ?\\{");

for (const datei of editoren) {
	const html = lies("html", datei);
	const stile = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join("\n");
	const css = einzeilig(ohneKommentare(stile));
	for (const sel of dtVerboten) {
		assert.ok(!kopf(sel).test(css),
			`${datei} definiert wieder eine eigene "${sel}"-Regel inline. Die Feldregeln der `
			+ "Editorspalte stehen in css/components/editor-page.css und werden von dieser Seite "
			+ "bereits geladen. Ein inliner <style>-Block steht HINTER dem <link> und ueberstimmt sie "
			+ "lautlos -- genau so driftete der Feldtext auf 12px und das Zeilenpolster auf 5px. "
			+ "Eine ortsgebundene Erweiterung ist erlaubt, aber sie muss enger sein als der blosse "
			+ "Regelkopf (z. B. '.dt-grid textarea', nicht '.dt-grid').");
		checks++;
	}
}

// Und die Gegenrichtung: das Original muss dort auch wirklich stehen.
for (const sel of dtGeteilt) {
	assert.ok(kopf(sel).test(einzeilig(ohneKommentare(editorPage))),
		`css/components/editor-page.css hat keine "${sel}"-Regel mehr. Dann tragen die `
		+ "Editorfenster ihre Feldspalte ueberhaupt nicht mehr -- und weil die Abschriften am "
		+ "16.08.2026 entfernt wurden, faellt sie ersatzlos aus.");
	checks++;
}

console.log(`editor-row-single-source: ${checks} Pruefungen bestanden (${editoren.length} Editoren).`);
