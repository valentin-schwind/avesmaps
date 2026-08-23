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

// ---- 1. Der Knopf ist da und IMMER klickbar -------------------------------------------
// 🔴 Er baut seinen Abzug selbst und hängt an nichts, was vorher passiert sein müsste. Bis
// 23.08.2026 startete er ausgegraut, weil er den zuletzt ERZEUGTEN Abzug hinterlegte -- und
// genau das war der Fehler: damit hing die Datei, die die API ausliefert, an den Häkchen der
// Seite. Owner: „die häkchen soll nur für den SVG export sein, der abzug für die API soll
// automatisch immer alles speichern."
assert.ok(/id="svgx-deposit"/.test(seite), "der Knopf steht auf der Seite");
const knopf = /<button[^>]*id="svgx-deposit"[^>]*>/.exec(seite);
assert.ok(knopf, "als <button>");
assert.ok(!/\bdisabled\b/.test(knopf[0]), "und ist von Anfang an klickbar");
assert.ok(/id="svgx-deposit-status"/.test(seite), "mit eigener Statuszeile");
// ⚠️ Eine eigene Zeile, nicht die des Erzeugens: sonst überschreibt die eine Meldung die andere,
// und „Fertig — heruntergeladen" verschwindet in dem Moment, in dem man hinterlegt.
assert.notStrictEqual(seite.indexOf('id="svgx-status"'), seite.indexOf('id="svgx-deposit-status"'));

// ---- 2. Der Kitt verdrahtet ihn -------------------------------------------------------
assert.ok(kitt.includes('el("svgx-deposit")'), "der Kitt kennt den Knopf");
assert.ok(kitt.includes('hinterlegenKnopf.addEventListener("click", hinterlegen)'),
	"und hängt hinterlegen() daran");
// 🔴 Und der Erzeugen-Pfad fasst den Knopf NICHT mehr an -- die beiden Wege sind getrennt.
assert.ok(!kitt.includes("letzterAbzug = {"),
	"kein gemerkter Download mehr, an dem das Hinterlegen hinge");

// ---- 3. 💣 DER API-ABZUG WIRD EIGENS GEBAUT, KANONISCH ----------------------------------
// Der API-Abzug ist eine DATENQUELLE, kein Gestaltungsstück: vollständig, in fester
// Schreibweise, unabhängig von den Häkchen. 💣 Live ist genau das schiefgegangen -- die Seite
// hat `illustrator` vorangehäkelt, die Routine baut `inkscape`, und Inkscape schreibt an jedes
// Element zusätzlich `inkscape:label`. Der hinterlegte Handabzug war 7,4 statt 9,0 MB bei
// identischem Inhalt, und das sah aus wie fehlende Ebenen.
// ⚠️ Der Ausschnitt beginnt bei `hinterlegeRuf`, nicht erst bei `hinterlegen()`: der
// gemeinsame Aufrufer traegt `credentials` und die Fehlerbehandlung, und eine Zusicherung, die
// ihn nicht sieht, prueft die falsche Haelfte. (Erst gemerkt, als eine Mutationsprobe
// `credentials` umstellte und der Test gruen blieb -- weil dasselbe Wort weiter oben im
// Kartendaten-Holer noch einmal steht.)
const hinterlegenBlock = kitt.slice(kitt.indexOf("async function hinterlegeRuf("),
	kitt.indexOf("async function erzeugen()"));
assert.ok(hinterlegenBlock.length > 200, "der Block wurde gefunden");
assert.ok(hinterlegenBlock.includes("E.ABZUG_EINSTELLUNGEN"),
	"gebaut wird mit den GETEILTEN Einstellungen aus dem Bauer");
assert.ok(hinterlegenBlock.includes("F.vorgabeFarben("),
	"und mit den geteilten Vorgabefarben -- nicht mit den Farbfeldern der Seite");
// 💣 KEIN BLICK AUF DAS FORMULAR. Diese sechs Funktionen lesen die Häkchen; taucht auch nur
// eine im Ablage-Block auf, hängt der API-Abzug wieder an einer Einstellung.
[["eingestellteFarben", "Farbfelder"], ["gewaehlteEbenen", "Ebenen-Häkchen"],
	["gewaehlterDialekt", "Dialekt-Auswahl"], ["glaettung", "Glättung"],
	["gewaehlteGroesse", "Größenfeld"], ["gewaehlteUnterarten", "Unterarten"]]
	.forEach(([fn, was]) => {
		assert.ok(!hinterlegenBlock.includes(fn + "("),
			`der API-Abzug liest die ${was} NICHT (${fn})`);
	});
assert.ok(hinterlegenBlock.includes("letzterAbzug.blob.slice"),
	"und schneidet den eben gebauten Blob in Stücke");
// 🔴 Und die kanonische Schreibweise ist wirklich inkscape -- der Dialekt, den die Seite
// NICHT vorangehäkelt hat.
const B = require("../svg-export-build.js");
assert.strictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.dialect, "inkscape");
assert.strictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.sizePx, 32768);
assert.strictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.semantics, true);
assert.strictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.smooth, false);
assert.strictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.smoothAreas, false);
assert.deepStrictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.layers, {}, "alle Ebenen");
assert.deepStrictEqual(B.SVGX_ABZUG_EINSTELLUNGEN.subgroups, {}, "alle Unterarten");
// ⚠️ Und der Läufer hat KEINE eigene Kopie mehr.
const laeuferQuelle = fs.readFileSync(
	path.join(WURZEL, "tools", "svg-export", "abzug-bauen.js"), "utf8");
assert.ok(laeuferQuelle.includes("bauer.SVGX_ABZUG_EINSTELLUNGEN"),
	"der Läufer nimmt dieselben Werte");
assert.ok(!/const ABZUG_EINSTELLUNGEN = \{/.test(laeuferQuelle),
	"und führt keine zweite Fassung davon");

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
