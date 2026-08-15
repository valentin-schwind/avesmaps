// Das Postfach-Archiv: der Ordner-Schlüssel, die zwei Zeilenhandlungen und der Reiter.
// Entwurf: docs/superpowers/specs/2026-08-15-mail-archiv-design.md
//
// 💣 DIE TRAGENDE ZUSICHERUNG IST DER ORDNER-SCHLÜSSEL. Eine IMAP-`uid` gilt nur INNERHALB eines
// Ordners: Nachricht 123 im Posteingang und Nachricht 123 im Archiv sind zwei verschiedene Mails.
// Solange das Postfach genau einen Ordner kannte, konnte das nicht auffallen. Wer eine uid-Aktion
// ohne `box` abschickt, trifft die gleichnummerierte Mail im FALSCHEN Ordner -- und bekommt eine
// gültige Antwort, nur eben zur falschen Nachricht. Deshalb prüft dieser Test jeden Aufrufer.
//
// 🪤 WARUM QUELLTEXT-PRÜFUNG: `review-mail.js` ist ein Browser-Global-Skript ohne Exporte; alles
// liegt in einer IIFE, die beim Laden schon `document.addEventListener` ruft. Hier gibt es weder
// jsdom noch einen Runner (dieselbe Lage wie bei ecosystem-terrain-number-input.test.js). Die
// Geometrie -- stapeln die Abschnitte? -- ist im Browser zu beweisen und steht im Entwurf §8 als
// Live-Abnahme; dieser Test hält fest, was am Quelltext entscheidbar ist.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/mail-archiv-form.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

// Kommentare zuerst weg: die Regeln werden im Modul ausführlich begründet, und eine Prüfung auf den
// blossen Bezeichner schlüge sonst auf die Prosa an statt auf den Code.
function code(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((zeile) => !/^\s*\/\//.test(zeile))
		.join("\n");
}

const js = code(lies("js", "review", "review-mail.js"));
const css = lies("css", "features", "mail-inbox.css");
const html = lies("index.html");

// Der Rumpf einer Top-Level-Funktion des Moduls (Einrückung: vier Leerzeichen).
function rumpf(name) {
	const start = js.indexOf("function " + name + "(");
	assert.notStrictEqual(start, -1, "Funktion " + name + " fehlt in review-mail.js");
	const ende = js.indexOf("\n    function ", start + 1);
	return js.slice(start, ende === -1 ? js.length : ende);
}

let geprueft = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); geprueft += 1; };

// ---- 1. Jede uid-Aktion nennt ihren Ordner ------------------------------------------------------

pruefe(/api\("message",\s*null,\s*\{[^}]*\bbox:/.test(js),
	'Der Abruf einer Nachricht schickt kein `box` mit. Eine uid gilt nur innerhalb eines Ordners -- '
	+ 'ohne den Schlüssel liest der Server die gleichnummerierte Mail des Posteingangs und antwortet '
	+ 'mit einer ANDEREN Nachricht, ohne Fehler.');

pruefe(/action=image[\s\S]{0,400}?box=archive/.test(js),
	'Die Bild-Adresse trägt kein `box=archive`. Ein Bild aus einer archivierten Mail käme sonst aus '
	+ 'der gleichnummerierten Mail des Posteingangs -- also aus fremder Post.');

// Und der Rückweg: der Server gibt die Kiste zurück, der Client baut sie nicht aus dem Gedächtnis
// nach. `msg.box` ist die Quelle, nicht eine gemerkte Variable.
pruefe(/msg\.box === "archive"/.test(rumpf("renderDetail")),
	"renderDetail entscheidet nicht mehr an `msg.box`, welcher Ordner gerade offen ist.");

// ---- 2. Der offene Aufklapper ist nach ORDNER UND uid geschlüsselt ------------------------------
// 💣 Wäre er nur nach uid geschlüsselt, schlösse das Öffnen von Archiv-Nr. 123 den offenen
// Posteingangs-Eintrag Nr. 123 -- oder täte gar nichts, weil der Schlüssel schon passt.

pruefe(/function messageKey\(box, uid\)/.test(js) && /openKey/.test(js),
	"Der offene Eintrag wird wieder nur an der uid festgemacht (openUid statt openKey/messageKey).");
pruefe(!/\bopenUid\b/.test(js),
	"`openUid` steht noch im Modul -- der alte, ordnerblinde Schlüssel.");

// ---- 3. Zwei Zeilenhandlungen, Archiv links, Papierkorb rechts ----------------------------------

const zeile = rumpf("buildMessageRow");
const iArchiv = zeile.indexOf('"mail-inbox__archive"');
const iPapier = zeile.indexOf('"mail-inbox__trash"');
pruefe(iArchiv !== -1, "Die Posteingangszeile trägt keinen Archiv-Knopf.");
pruefe(iPapier !== -1, "Die Posteingangszeile trägt keinen Papierkorb mehr.");
pruefe(iArchiv < iPapier,
	"Der Papierkorb steht VOR dem Archiv. Die zerstörerische Handlung gehört nach aussen, nicht "
	+ "zwischen die beiden anderen Klickziele (Entwurf §7.1).");

// Die Archiv-Zeile bietet Zurückholen statt Archivieren -- sonst archivierte man Archiviertes.
pruefe(/box === "archive"[\s\S]{0,300}?"unarchive"/.test(zeile),
	"Eine Zeile im Archiv bietet kein Zurückholen an.");
pruefe(!/box === "archive"[\s\S]{0,200}?"mail-inbox__trash"/.test(zeile),
	"Im Archiv steht ein Papierkorb. Laut Entwurf §2 gibt es dort keinen -- zurückholen, dann löschen.");

// ---- 4. Die Zeile verschwindet erst, wenn der Server bestätigt hat ------------------------------
// 💣 Eine Zeile, die bei einem fehlgeschlagenen Verschieben trotzdem verschwindet, sieht exakt aus
// wie ein geglücktes -- und die Mail liegt noch da, wo sie lag.

const mover = rumpf("runRowAction");
const iAbbruch = mover.indexOf("if (!res || !res.ok)");
const iEntfernt = mover.indexOf("row.remove()");
pruefe(iAbbruch !== -1 && iEntfernt !== -1 && iAbbruch < iEntfernt,
	"runRowAction entfernt die Zeile ohne vorherige Erfolgsprüfung des Servers.");
pruefe(/fail\(moveErrorText\(res\)\)/.test(mover),
	"Ein Fehlschlag nennt seinen Grund nicht mehr im Klartext.");

// Und die Liste, in der die Zeile stand, sagt danach, dass sie leer ist -- nicht die falsche.
pruefe(/const list = row\.parentNode/.test(mover),
	"Die Leermeldung geht wieder an eine feste Liste statt an die, aus der die Zeile kam. Mit vier "
	+ "Listen (Empfangen, Gesendet, Archiv-Empfangen, Archiv-Gesendet) trifft das die falsche.");

// ---- 5. „Kein Ordner" ist etwas anderes als „leer" ---------------------------------------------
// ⚠️ Nur der erste Fall ist eine Aufgabe für den Owner. Sähen beide gleich aus, suchte niemand
// den fehlenden Ordner.

const laden = rumpf("loadArchive");
pruefe(/!res\.mailbox/.test(laden) && /keinen Ordner/.test(laden),
	'Der Archiv-Reiter unterscheidet nicht mehr zwischen „es gibt keinen Archiv-Ordner" und „das '
	+ 'Archiv ist leer".');
pruefe(/api\("sent-archived"\)/.test(laden),
	"Die gesendete Hälfte des Archivs wird nicht geladen.");

// ---- 6. Kein Antworten aus dem Archiv ----------------------------------------------------------
// 🔴 Der Antwortweg holt den Empfänger serverseitig aus der Originalmail; er wird für diese
// Bequemlichkeit nicht auf einen zweiten Ordner ausgeweitet (Entwurf §2).

const detail = rumpf("renderDetail");
const iArchivZweig = detail.indexOf('msg.box === "archive"');
const iAntwort = detail.indexOf("mail-inbox__reply");
pruefe(iArchivZweig !== -1 && iAntwort !== -1 && iArchivZweig < iAntwort,
	"Das Antwortfeld wird auch im Archiv gebaut. Erst zurückholen, dann antworten.");
pruefe(/return;/.test(detail.slice(iArchivZweig, iAntwort)),
	"Der Archiv-Zweig in renderDetail kehrt nicht zurück -- das Antwortfeld käme trotzdem.");

// ---- 7. Das Abzeichen „✓ beantwortet" klickt nicht ins Leere -----------------------------------
// ⚠️ Ist die Antwort archiviert, steht sie nicht mehr in „Gesendet". Ohne den zweiten Sprung täte
// der Klick nichts, ohne Erklärung.

const sprung = rumpf("jumpToSent");
pruefe(/highlightSent\(replyId, sentEl\(\)\)/.test(sprung) && /archiveSentEl\(\)/.test(sprung),
	'Der Sprung aus „✓ beantwortet" sucht eine archivierte Antwort nicht im Archiv weiter.');

// ---- 8. Der Reiter ist verdrahtet --------------------------------------------------------------

const wechsel = rumpf("switchMailTab");
pruefe(/"archiv"/.test(wechsel), 'switchMailTab kennt den Reiter „archiv" nicht.');
pruefe(/name === "archiv"[\s\S]{0,80}?loadArchive\(true\)/.test(js),
	"Der ↻-Knopf lädt im Archiv-Reiter nicht das Archiv neu.");

// ---- 9. Das Markup ------------------------------------------------------------------------------

pruefe(/data-mail-tab="archiv"/.test(html), 'index.html hat keinen dritten Reiterknopf „Archiv".');
pruefe(/data-mail-pane="archiv"/.test(html), "index.html hat keinen Archiv-Bereich.");
pruefe(/id="mail-archive-list"/.test(html) && /id="mail-archive-sent-list"/.test(html),
	"Dem Archiv-Bereich fehlt einer seiner beiden Abschnitte (empfangen / gesendet).");

// ---- 10. Der Knopf-Look steht EINMAL ------------------------------------------------------------
// 💣 Zwei Knöpfe, eine Rezeptur: schriebe man den weichen Look ein zweites Mal ab, liefen sie
// auseinander -- genau die Divergenz, die die Listenzeilen am 14.08.2026 gekostet hat.

pruefe(/\.mail-inbox__action \{/.test(css),
	"Der geteilte Knopf-Look .mail-inbox__action fehlt in mail-inbox.css.");
pruefe(!/\.mail-inbox__trash \{/.test(css) && !/\.mail-inbox__archive \{/.test(css),
	"Ein Zeilenknopf trägt wieder seine eigene Grundregel. Die Grundform gehört .mail-inbox__action; "
	+ "die beiden unterscheiden sich NUR im :hover.");
pruefe(/\.mail-inbox__archive:hover/.test(css) && /\.mail-inbox__trash:hover/.test(css),
	"Einem der beiden Zeilenknöpfe fehlt sein Hover-Ton.");

// Kein Literal: die Warnfarbe und der neutrale Ton kommen aus Token (AGENTS.md §12).
const knopfRegeln = (css.match(/\.mail-inbox__(action|archive|trash)[^{]*\{[^}]*\}/g) || []).join("\n");
pruefe(knopfRegeln.length > 0 && !/#[0-9a-fA-F]{3,8}\b/.test(knopfRegeln),
	"In den Zeilenknopf-Regeln steht eine hartkodierte Farbe. Immer ein Token aus css/base/tokens.css.");

// ---- 11. Der Zustandsname wanderte mit ----------------------------------------------------------
// Die Zeile ist beim Archivieren genauso beschäftigt wie beim Löschen; „is-trashing" wäre dafür
// gelogen. Beide Seiten müssen denselben Namen tragen, sonst bleibt die Zeile ungedimmt.

pruefe(/\.mail-inbox__row\.is-busy/.test(css), "Die CSS-Regel für die beschäftigte Zeile fehlt.");
pruefe(/is-busy/.test(js), "Das Modul setzt die Klasse für die beschäftigte Zeile nicht.");
pruefe(!/is-trashing/.test(css) && !/is-trashing/.test(js),
	'„is-trashing" steht noch irgendwo -- der Name gilt nur noch für eine von zwei Handlungen.');
pruefe(!/mail-inbox__trash-error/.test(css) && !/mail-inbox__trash-error/.test(js),
	'„mail-inbox__trash-error" steht noch irgendwo -- die Fehlerzeile gehört jetzt beiden Handlungen '
	+ "(.mail-inbox__row-error).");

console.log("OK: Postfach-Archiv, " + geprueft + " Zusicherungen");
