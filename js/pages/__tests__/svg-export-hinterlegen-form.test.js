// Der Knopf „Abzug hinterlegen" und sein Kitt -- die Zusicherungen, die ohne angemeldete
// Sitzung prüfbar sind. Lauf: node js/pages/__tests__/svg-export-hinterlegen-form.test.js
//
// ⚠️ WAS DIESER TEST NICHT KANN: den Klick mit echter Admin-Sitzung. Dafür braucht es eine
// Datenbank. Das Protokoll selbst (start → n × chunk → finish, gestückelt) ist server-seitig
// gefahren -- tools/svg-export/__tests__/ablage-ablauf.js schickt dieselben Aufrufe über
// dieselbe Strecke, nur aus Node statt aus dem Browser.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const seite = fs.readFileSync(path.join(WURZEL, "edit", "svg-export.php"), "utf8");
const kitt = fs.readFileSync(path.join(WURZEL, "js", "pages", "svg-export-page.js"), "utf8");

// ---- 1. Der Knopf ist da und startet AUSGEGRAUT ---------------------------------------
// 🔴 Hinterlegt wird der zuletzt ERZEUGTE Abzug. Ein Knopf, der von Anfang an klickbar ist,
// verspricht etwas, das es noch nicht gibt.
assert.ok(/id="svgx-deposit"/.test(seite), "der Knopf steht auf der Seite");
const knopf = /<button[^>]*id="svgx-deposit"[^>]*>/.exec(seite);
assert.ok(knopf, "als <button>");
assert.ok(/\bdisabled\b/.test(knopf[0]), "und startet ausgegraut");
assert.ok(/id="svgx-deposit-status"/.test(seite), "mit eigener Statuszeile");
// ⚠️ Eine eigene Zeile, nicht die des Erzeugens: sonst überschreibt die eine Meldung die andere,
// und „Fertig — heruntergeladen" verschwindet in dem Moment, in dem man hinterlegt.
assert.notStrictEqual(seite.indexOf('id="svgx-status"'), seite.indexOf('id="svgx-deposit-status"'));

// ---- 2. Der Kitt verdrahtet ihn und macht ihn erst nach dem Bauen scharf ---------------
assert.ok(/getElementById|el\("svgx-deposit"\)/.test(kitt) || kitt.includes('el("svgx-deposit")'),
	"der Kitt kennt den Knopf");
assert.ok(kitt.includes('hinterlegenKnopf.addEventListener("click", hinterlegen)'),
	"und hängt hinterlegen() daran");
const scharfStelle = kitt.indexOf("dk.disabled = false");
const merkStelle = kitt.indexOf("letzterAbzug = {");
assert.ok(merkStelle > 0 && scharfStelle > merkStelle,
	"scharf wird er ERST, nachdem ein Abzug gemerkt wurde");

// ---- 3. 💣 KEIN ZWEITER BAU ------------------------------------------------------------
// Hinterlegt wird der Blob, den der Owner gesehen hat. Neu zu bauen hieße 20 MB Kartendaten
// ein zweites Mal zu holen -- und wenn ein Editor dazwischen speichert, eine ANDERE Datei
// abzulegen als die heruntergeladene.
// ⚠️ Der Ausschnitt beginnt bei `hinterlegeRuf`, nicht erst bei `hinterlegen()`: der
// gemeinsame Aufrufer traegt `credentials` und die Fehlerbehandlung, und eine Zusicherung, die
// ihn nicht sieht, prueft die falsche Haelfte. (Erst gemerkt, als eine Mutationsprobe
// `credentials` umstellte und der Test gruen blieb -- weil dasselbe Wort weiter oben im
// Kartendaten-Holer noch einmal steht.)
const hinterlegenBlock = kitt.slice(kitt.indexOf("async function hinterlegeRuf("),
	kitt.indexOf("async function erzeugen()"));
assert.ok(hinterlegenBlock.length > 200, "der Block wurde gefunden");
assert.ok(!hinterlegenBlock.includes("AvesmapsSvgExport.build")
	&& !hinterlegenBlock.includes("svgxBuildDocument"),
	"hinterlegen() baut NICHT neu");
assert.ok(hinterlegenBlock.includes("letzterAbzug.blob.slice"),
	"es schneidet den gemerkten Blob in Stücke");

// ---- 4. 💣 GESTÜCKELT, und die Stückgröße ist begründet --------------------------------
// Ein Abzug ist ~8,6 MB; ein einzelner POST läuft auf STRATO in `post_max_size`, deren
// Fehlerbild ein LEERER Rumpf ohne Ausnahme ist -- nicht von „nichts geschickt" zu unterscheiden.
const stueck = /HINTERLEGEN_STUECK\s*=\s*([^;]+);/.exec(kitt);
assert.ok(stueck, "die Stückgröße steht als benannter Wert da");
const groesse = Function(`"use strict";return (${stueck[1]})`)();
assert.ok(groesse > 0 && groesse <= 4 * 1024 * 1024,
	`höchstens 4 MB je Stück, gefunden: ${groesse}`);
assert.ok(hinterlegenBlock.includes("action=start")
	&& hinterlegenBlock.includes("action=chunk")
	&& hinterlegenBlock.includes("action=finish"),
	"alle drei Schritte des Protokolls");

// ---- 5. 🔴 DIE HERKUNFT KOMMT NICHT VOM CLIENT -----------------------------------------
// Sie bestimmt der Riegel auf dem Server. Mitgeschickt könnte ein Handabzug sich als Routine
// ausgeben -- und genau diese Angabe soll die beiden auseinanderhalten.
assert.ok(!/quelle/.test(hinterlegenBlock.replace(/\/\/[^\n]*/g, "")),
	"der Kitt schickt kein `quelle` mit");
// Und die Sitzung reist mit, sonst ist der Admin für den Server ein Fremder.
// 💣 IM BLOCK gesucht, nicht in der ganzen Datei: `credentials: "same-origin"` steht auch im
// Kartendaten-Holer weiter oben, eine dateiweite Suche wäre also immer grün.
assert.ok(/credentials:\s*"same-origin"/.test(hinterlegenBlock),
	"die Sitzung reist beim Hinterlegen mit");

// ---- 6. Der Endpunkt ist der GETEILTE, nicht ein eigener -------------------------------
// 🔴 Ein zweiter Schreibweg bräuchte dieselben Regeln ein zweites Mal (aufräumen, Zeiger,
// Sperre) -- genau die Bauform, die AGENTS.md „zwei von drei Löschwegen" nennt.
// 💣 Auf den benannten Wert geprüft, nicht auf das blosse Vorkommen der Zeichenkette --
// sonst hielte auch ein Kommentar die Zusicherung am Leben.
const zielUrl = /HINTERLEGEN_URL\s*=\s*"([^"]+)"/.exec(kitt);
assert.ok(zielUrl, "der Endpunkt steht als benannter Wert da");
assert.strictEqual(zielUrl[1], "/api/svg-export-deposit.php",
	"derselbe Endpunkt, den auch die Routine benutzt");
const workflow = fs.readFileSync(
	path.join(WURZEL, ".github", "workflows", "svg-export-abzug.yml"), "utf8");
assert.ok(workflow.includes("/api/svg-export-deposit.php"),
	"und die Routine benutzt ihn ebenfalls");
assert.ok(!/lftp|sftp:/.test(workflow.replace(/^\s*#.*$/gm, "")),
	"die Routine hat keinen eigenen Schreibweg mehr (kein SFTP im Code)");

console.log("svg-export-hinterlegen-form: ok");
