// Das Drei-Strich-Menue in der Kopfzeile der Editor-Huelle (edit/index.php).
// Entwurf: docs/hauptleiste-menue-mockup.html
//
// Geprueft wird, was beim Bau tatsaechlich danebenging oder danebenzugehen drohte -- nicht,
// dass die Datei existiert. Vier Kaskadenfallen, ein Riegel und die Selbst-Stempelung.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/pages/__tests__/hauptleisten-menue.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der
 *  nichts haelt (vgl. quelltextpruefung-trifft-den-kommentar). */
function ohneKommentare(quelle) {
	return quelle
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

const shellPhp = ohneKommentare(read("edit", "index.php"));
const editCss = ohneKommentare(read("css", "pages", "edit.css"));
const menueJs = ohneKommentare(read("js", "pages", "edit-shell-menu.js"));

// ---- Die fuenf Eintraege, und wer sie sehen darf ---------------------------------------------
const menueMarkup = shellPhp.slice(shellPhp.indexOf('<details class="edit-shell__menu"'),
	shellPhp.indexOf("</details>"));
assert.ok(menueMarkup.length > 0, "das Menue steht als <details> in der Huelle");

[
	["Handbuch", "/html/editor-handbuch.html"],
	["Datenbank-Backup", "/edit/backup.php"],
	["Karte als SVG", "/edit/svg-export.php"],
	["Admin", "/admin/"],
].forEach(([beschriftung, ziel]) => {
	assert.ok(menueMarkup.includes(">" + beschriftung + "</a>"), beschriftung + " steht im Menue");
	assert.ok(menueMarkup.includes('href="' + ziel + '"'), beschriftung + " zeigt auf " + ziel);
});
assert.ok(/<button type="submit" class="edit-shell__menu-item">Abmelden<\/button>/.test(menueMarkup),
	"Abmelden ist der Absende-Knopf seines Formulars, kein Verweis");

// 💣 Der Riegel. Die drei Admin-Zeilen muessen INNERHALB der Fallunterscheidung stehen -- ein
// Editor darf sie nicht einmal im Quelltext finden. Gemessen wird der Abstand zwischen dem
// `if` und dem `endif`, nicht die blosse Anwesenheit beider.
const adminBlock = menueMarkup.slice(
	menueMarkup.indexOf("avesmapsUserCan($currentUser, 'admin')"),
	menueMarkup.indexOf("<?php endif; ?>"));
assert.ok(adminBlock.length > 0, "es gibt einen admin-gegateten Abschnitt im Menue");
["/edit/backup.php", "/admin/"].forEach((ziel) => {
	assert.ok(adminBlock.includes(ziel), ziel + " liegt im Admin-Block, nicht davor oder danach");
});
// 🔴 Und die Kehrseite, seit 23.08.2026: der SVG-Export liegt AUSSERHALB. Er stand bis dahin
// zwischen den beiden darueber, obwohl er nur oeffentliche api/app/-Endpunkte liest -- der Riegel
// gilt dem, was der Block wirklich schuetzt (Passwort-Hashes, Benutzerverwaltung). Ueber dieselbe
// Seite laufen seither die Original-Kartenarchive, die JEDER Editor braucht.
[
	["/html/editor-handbuch.html", "das Handbuch"],
	["/edit/svg-export.php", "der SVG-Export"],
].forEach(([ziel, name]) => {
	assert.ok(!adminBlock.includes(ziel),
		name + " liegt AUSSERHALB des Riegels -- jeder Editor braucht ihn");
	assert.ok(menueMarkup.includes('href="' + ziel + '"'),
		name + " steht trotzdem im Menue (nicht versehentlich mit entfernt)");
});

// 💣 Abmelden steht als LETZTE Gruppe. Ganz oben laege es unter dem Zeiger, der eben den Knopf
// gedrueckt hat; die Reihenfolge ist eine Entscheidung des Entwurfs, keine Zufaelligkeit des
// Markups.
assert.ok(menueMarkup.lastIndexOf("Abmelden") > menueMarkup.lastIndexOf("Handbuch"),
	"Abmelden steht unter dem Handbuch");

// ---- Vier Kaskadenfallen ----------------------------------------------------------------------
//
// 💣 (1) `.edit-shell__bar button` faerbt JEDEN Knopf der Leiste gefuellt-braun ein (0,1,1).
// Eine blanke `.edit-shell__menu-item`-Regel (0,1,0) verliert dagegen, und Abmelden saesse als
// brauner Klotz zwischen drei Textzeilen. Die Menuezeile muss die Leiste im Selektor haben.
assert.ok(/\.edit-shell__bar\s+\.edit-shell__menu-item\s*\{/.test(editCss),
	"die Menuezeile ist ueber `.edit-shell__bar .edit-shell__menu-item` adressiert (0,2,1)");
// ⚠️ Der Anker ist der ZEILENANFANG: ein Selektor, der mit der Klasse beginnt, hat die Leiste
// nicht vor sich und ist damit der Fall, der verliert. Ohne den Anker traefe das Muster auch die
// richtige Regel -- ein Test, der immer rot ist, wird abgeschaltet statt gelesen.
assert.ok(!/^\s*\.edit-shell__menu-item\s*[,{:]/m.test(editCss),
	"keine blanke `.edit-shell__menu-item`-Regel -- die verliert gegen `.edit-shell__bar button`");

// 💣 (1b) UND DIE ZWEI ZEILEN, DIE NACH NICHTS AUSSEHEN. Ein zugeklapptes <details> versteckt
// seine Kinder selbst -- aber nur die im FLUSS. `position: absolute` hebt die Liste heraus, und
// sie stand daraufhin dauerhaft offen ueber der Karte. Am 23.08.2026 im Browser gemessen:
// `details.open === false` und trotzdem ein Kasten von 232x230 px. ⚠️ Kein DOM-Test findet das,
// die Elemente existieren ja -- es brauchte den Blick auf das Bild. Der Test haelt seither die
// Regel, nicht den Befund.
assert.ok(/\.edit-shell__menu:not\(\[open\]\)\s+\.edit-shell__menu-list\s*\{[^}]*display:\s*none/.test(editCss),
	"die zugeklappte Liste ist ausdruecklich `display: none` -- <details> allein schafft das bei "
	+ "`position: absolute` nicht");

// 💣 (2) Dieselbe Falle eine Ebene groesser: `.edit-shell__bar div` traf JEDES div der Leiste.
// Das Menue enthaelt deshalb kein einziges div -- und die Regel selbst ist auf den Titelblock
// geschaerft, damit der naechste Einbau nicht wieder darauf tritt.
assert.ok(!/(^|[\s,>+~])\.edit-shell__bar\s+div\s*[,{]/m.test(editCss),
	"kein pauschales `.edit-shell__bar div` -- das stellte Liste und Gruppen auf flex/baseline");
assert.ok(!/<div/.test(menueMarkup), "das Menue-Markup enthaelt kein div");

// 💣 (3) Und die Kehrseite davon: `.edit-shell__actions` (Unterseiten backup.php/svg-export.php)
// holte sein `display: flex` bis dahin von genau der pauschalen Regel. Ohne eigene Deklaration
// waere die Zeile dort lautlos kein Flexcontainer mehr -- eine Aenderung an einer Seite, die
// eine andere trifft.
const aktionsRegel = editCss.slice(editCss.indexOf(".edit-shell__bar .edit-shell__actions"));
assert.ok(/^\.edit-shell__bar \.edit-shell__actions\s*\{[^}]*display:\s*flex/.test(aktionsRegel),
	"`.edit-shell__actions` bringt sein `display: flex` selbst mit");
["edit/backup.php", "edit/svg-export.php"].forEach((datei) => {
	assert.ok(read(...datei.split("/")).includes("edit-shell__actions"),
		datei + " benutzt die Gruppe weiterhin -- deshalb darf sie nicht wegfallen");
});

// 💣 (4) Der Standard-Marker des <summary> braucht ZWEI Regeln, nicht eine: `list-style` fuer
// Firefox, die Pseudoklasse fuer WebKit. Mit nur einer traegt der Knopf auf der Haelfte der
// Browser ein Dreieck neben den drei Strichen.
const knopfRegel = editCss.slice(editCss.indexOf(".edit-shell__menu-button {"));
assert.ok(/list-style:\s*none/.test(knopfRegel.slice(0, knopfRegel.indexOf("}"))),
	"der Knopf setzt `list-style: none` (Firefox)");
assert.ok(/\.edit-shell__menu-button::-webkit-details-marker\s*\{[^}]*display:\s*none/.test(editCss),
	"und `::-webkit-details-marker { display: none }` (WebKit)");

// 💣 (5) DER RHYTHMUS. Die Ueberschrift muss dasselbe Innenmass tragen wie eine Zeile, sonst
// sitzt sie schief: mit blossem `margin` stand sie 10,6 px unter ihrer Trennlinie, waehrend
// Abmelden 16,7 px unter seiner stand -- und der negative Seitenrand fehlte, also ruecke ihr
// Text 8 px gegen die Zeilen darunter ein. Der Owner sah beides im Bild, gemessen wurde es
// danach (23.08.2026). Die Zusicherung haelt beide Werte an DIESELBE Quelle wie die Zeile.
const titelRegel = editCss.slice(editCss.indexOf(".edit-shell__menu-title {"));
const titelRumpf = titelRegel.slice(0, titelRegel.indexOf("}"));
const zeilenRegel = editCss.slice(editCss.indexOf(".edit-shell__bar .edit-shell__menu-item {"));
const zeilenRumpf = zeilenRegel.slice(0, zeilenRegel.indexOf("}"));
["padding", "margin"].forEach((eigenschaft) => {
	const ausTitel = new RegExp("\\n\\s*" + eigenschaft + ":\\s*([^;]+);").exec(titelRumpf);
	const ausZeile = new RegExp("\\n\\s*" + eigenschaft + ":\\s*([^;]+);").exec(zeilenRumpf);
	assert.ok(ausTitel && ausZeile, "Ueberschrift und Zeile setzen beide `" + eigenschaft + "`");
	assert.strictEqual(ausTitel[1].trim(), ausZeile[1].trim(),
		"Ueberschrift und Zeile tragen dasselbe `" + eigenschaft + "` -- sonst sitzt die "
		+ "Ueberschrift naeher an ihrer Trennlinie als jede andere Zeile");
});

// 💣 (6) UND DIE SEITLICHE SYMMETRIE. Die naheliegende Bauform -- volle Polsterung an der Liste,
// negativer Seitenrand an der Zeile -- war am 23.08.2026 live und falsch: `width: 100%` rechnet
// mit `box-sizing: border-box` die CONTENT-Breite der Liste aus, der negative Rand VERSCHIEBT die
// Flaeche nur und verbreitert sie nicht. Gemessen: links 2,7 px vom Rand, rechts 18,7 px; der
// Owner sah die schiefe Hover-Flaeche im Bild. Die Zeilen fuellen jetzt von Kante zu Kante, weil
// die Liste seitlich fast nichts polstert -- kein negativer Rand, keine gekoppelte Breite.
assert.ok(!/margin:\s*0\s+-\d/.test(titelRumpf + zeilenRumpf),
	"weder Zeile noch Ueberschrift zieht sich per negativem Seitenrand aus der Liste heraus");
// ⚠️ Am ZEILENANFANG ankern: `.edit-shell__menu-list {` ist Teilstring des `:not([open])`-
// Selektors daneben, und ein blankes `indexOf` landet in dessen Rumpf (nur `display: none`).
const listenRegel = editCss.slice(editCss.search(/^\.edit-shell__menu-list \{/m));
const seitlich = /\n\s*padding:\s*\d+px\s+(\d+)px\s*;/.exec(listenRegel.slice(0, listenRegel.indexOf("}")));
assert.ok(seitlich && Number(seitlich[1]) <= 4,
	"die Liste polstert seitlich schmal (<= 4px) -- den Textabstand bringt die Zeile mit");
assert.ok(!/width:\s*calc\(100%\s*\+/.test(zeilenRumpf),
	"die Zeilenbreite ist nicht an die Listenpolsterung gerechnet -- genau diese Kopplung soll "
	+ "es nicht geben");

// ---- Die abgeloeste Klasse ist WEG, nicht danebengelassen -------------------------------------
//
// Eine zurueckgelassene Regel wirkt weiter, solange irgendwo noch das alte Klassenwort steht --
// die zweite Wahrheit in ihrer haesslichsten Form: sie stimmt sogar, bis eine der beiden
// geaendert wird.
[editCss, shellPhp].forEach((quelle) => {
	assert.ok(!quelle.includes("edit-shell__handbook"),
		"die Klasse `edit-shell__handbook` ist restlos weg (das Handbuch ist eine Menuezeile)");
});

// ---- Das Skript ergaenzt, es baut nicht --------------------------------------------------------
//
// 💣 Faellt es aus, muss das Menue bedienbar bleiben. Ein `preventDefault` auf dem Knopf oder ein
// selbstgebauter `open`-Umschalter am Klick waere genau die Abhaengigkeit, die <details>
// vermeiden soll.
assert.ok(!/preventDefault/.test(menueJs),
	"das Skript haelt das native Aufklappen nicht auf");
assert.ok(shellPhp.includes('<summary class="edit-shell__menu-button"'),
	"der Knopf ist ein <summary>, kein <button> mit eigenem Zustand");

// 💣 Der Fall, den ein Klick-Riegel prinzipiell nicht sehen kann: unter der Leiste liegt die
// ganze Karte in einem <iframe>, und ein Klick DORT erzeugt in diesem Dokument kein Ereignis.
// Ohne den Fokus-Riegel bleibt das Menue offen ueber der Karte stehen.
assert.ok(/window\.addEventListener\("blur"/.test(menueJs) && /IFRAME/.test(menueJs),
	"der Fokuswechsel in den Karten-iframe schliesst das Menue");
assert.ok(/menue\.contains\(ereignis\.target\)/.test(menueJs),
	"der Klick-Riegel laesst Klicks INNERHALB des Menues durch -- sonst schluckt er Abmelden");
assert.ok(/ereignis\.key !== "Escape"/.test(menueJs), "Esc schliesst");

// ---- Beide Verweise, die der Deploy nicht stempelt ----------------------------------------------
//
// 💣 Der Stamping-Schritt des Deploys laeuft nur ueber index.html und html/*.html und erreicht
// diese PHP-Seite nie (AGENTS.md §7). Das Blatt traegt deshalb einen Stempel von Hand -- und wer
// diese Datei anfasst, ohne ihn zu bewegen, liefert Editoren das alte Aussehen aus.
// ⚠️ Geprueft wird die FORM, nicht der Wert: ein fest verdrahteter Stempel muesste bei jedem
// legitimen Bump mitgezogen werden, und ein Test, den man staendig anfassen muss, wird
// irgendwann falsch nachgezogen statt gelesen. Dass jemand das Bumpen VERGISST, kann kein Test
// sehen -- dagegen steht der Kommentar an der Stelle selbst.
assert.ok(/edit\.css\?v=\d{8}-[a-z-]+"/.test(shellPhp),
	"edit.css traegt einen handgeschriebenen Stempel der Form <datum>-<wort>");

// ⭐ Das Skript stempelt sich dagegen SELBST (filemtime, wie der Karten-iframe daneben) und kann
// damit gar nicht erst veralten. Wer es auf einen Handstempel zurueckbaut, holt sich die Falle
// darueber ein zweites Mal ins Haus.
assert.ok(/filemtime\(\$menuScriptPath\)/.test(shellPhp),
	"der Verweis auf das Menue-Skript wird gerechnet, nicht gepflegt");
assert.ok(/is_file\(\$menuScriptPath\)/.test(shellPhp),
	"fehlt die Datei, bleibt der Verweis ungestempelt statt zu verschwinden");

console.log("hauptleisten-menue.test.js: alle Zusicherungen erfuellt");
