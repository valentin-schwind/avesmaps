"use strict";

/**
 * Der Wege-Editor liest Serverantworten über EINEN Leser -- und der nennt den Statuscode.
 *
 * Owner-Meldung 02.09.2026: „Zuweisen fehlgeschlagen: Unexpected token '<', "<!DOCTYPE "... is
 * not valid JSON". Das ist keine Auskunft, sondern ein Symptom: `response.json()` lief ohne
 * Statusprüfung, der Editor erfuhr vom Server also NICHTS -- weder ob die Adresse fehlt (404),
 * noch ob PHP gestorben ist (500), noch ob der Rumpf zu gross war (413). Alle drei sehen gleich
 * aus, und alle drei brauchen etwas anderes.
 *
 * ⚠️ `wege-editor.js` ist ein IIFE-Modul ohne Export (0 Funktionen in Spalte 0) -- der Leser lässt
 * sich nicht `require`n. Geprüft wird deshalb der Quelltext PLUS ein ausgeschnittener, wirklich
 * AUSGEFÜHRTER Leser: eine reine Quelltextprüfung sähe nicht, ob er auch tut, was dasteht.
 *
 * Fahren: node js/pages/__tests__/wege-editor-antwort.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "wege-editor.js"), "utf8");
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

let anzahl = 0;
const zaehl = () => { anzahl += 1; };

// ══ 1 · Es gibt genau EINEN Leser ═══════════════════════════════════════════════════════════════

// 💣 Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel: `getJson` und `postJson`
// riefen beide ihr eigenes `response.json()`. Wer den einen repariert, lässt den anderen stehen.
const rohParse = (ohneKommentare.match(/response\.json\(\)/g) || []).length;
assert.strictEqual(rohParse, 1, "`response.json()` steht genau einmal im ganzen Modul -- im Leser");
zaehl();
assert.ok(/function leseAntwort\(response\)/.test(ohneKommentare), "und der Leser heisst so");
zaehl();
assert.ok(/function getJson\(url\)[\s\S]{0,200}\.then\(leseAntwort\)/.test(ohneKommentare),
  "getJson geht durch den Leser");
zaehl();
assert.ok(/function postJson\(url, body\)[\s\S]{0,400}\.then\(leseAntwort\)/.test(ohneKommentare),
  "postJson ebenso");
zaehl();

// ══ 2 · Der Leser, wirklich ausgeführt ══════════════════════════════════════════════════════════

// 🔴 AUSGESCHNITTEN UND GEFAHREN, nicht nur gelesen. Ein Quelltexttest bestätigt, dass etwas
// DASTEHT; ob es das Richtige TUT, sagt nur der Lauf. Genau diese Lücke steht im Haus mehrfach
// angeschrieben.
const ab = quelle.indexOf("function leseAntwort(response)");
assert.ok(ab > -1, "der Leser ist im Quelltext auffindbar");
const bis = quelle.indexOf("function getJson(url)", ab);
assert.ok(bis > ab, "und endet vor getJson");
const kontext = { module: {} };
vm.runInNewContext(quelle.slice(ab, bis) + "\nmodule.leseAntwort = leseAntwort;", kontext);
const leseAntwort = kontext.module.leseAntwort;
zaehl();

const antwort = (ok, status, koerper) => ({
  ok, status,
  json: () => (koerper instanceof Error ? Promise.reject(koerper) : Promise.resolve(koerper)),
});

(async () => {
  // Der gute Fall geht unverändert durch.
  const gut = await leseAntwort(antwort(true, 200, { ok: true, wiki_name: "Reichsstrasse 2" }));
  assert.strictEqual(gut.wiki_name, "Reichsstrasse 2", "eine gültige Antwort kommt durch");
  zaehl();

  // 💣 DER GEMELDETE FALL: eine HTML-Seite. Der Editor muss den STATUS erfahren, nicht den
  // Parserfehler -- „Unexpected token '<'" sagt ihm nicht, ob die Adresse fehlt oder PHP starb.
  const htmlFehler = await leseAntwort(antwort(false, 500, new SyntaxError("Unexpected token '<'")))
    .then(() => null, (fehler) => fehler);
  // 🪤 NICHT `instanceof Error` prüfen: der Fehler entsteht IM vm-Kontext und trägt dessen
  // `Error`-Prototyp, nicht den dieses Tests. Über eine Realm-Grenze ist `instanceof` immer
  // falsch -- und der Test wäre rot, obwohl der Code stimmt. Genau so passiert, 02.09.2026.
  assert.ok(htmlFehler && typeof htmlFehler.message === "string", "eine HTML-Antwort wirft");
  zaehl();
  assert.ok(/HTTP 500/.test(htmlFehler.message), "und nennt den Statuscode: " + htmlFehler.message);
  zaehl();
  assert.ok(!/Unexpected token/.test(htmlFehler.message),
    "der Parserfehler taucht NICHT mehr auf -- er war das Symptom, nicht der Grund");
  zaehl();

  // ⚠️ Die HTML-Seite selbst wird nicht gezeigt: sie ist seitenlang und sagt einem Editor nichts.
  assert.ok(!/DOCTYPE/i.test(htmlFehler.message), "die Fehlerseite wird nicht durchgereicht");
  zaehl();

  // 🔴 Trägt der Server einen echten Umschlag, gewinnt SEINE Meldung -- sie ist genauer als
  // „HTTP 400".
  const mitGrund = await leseAntwort(antwort(false, 400, { ok: false, error: { message: "Der Weg hat keinen Wiki-Schlüssel." } }))
    .then(() => null, (f) => f);
  assert.strictEqual(mitGrund.message, "Der Weg hat keinen Wiki-Schlüssel.",
    "die Begründung des Servers schlägt den nackten Statuscode");
  zaehl();

  // ⚠️ 401 bekommt einen Zusatz: eine abgelaufene Sitzung ist der häufigste Fall und sieht sonst
  // wie ein Programmfehler aus.
  const abgemeldet = await leseAntwort(antwort(false, 401, null)).then(() => null, (f) => f);
  assert.ok(/angemeldet/.test(abgemeldet.message), "401 fragt nach der Anmeldung");
  zaehl();

  // 💣 HTTP 200 mit `ok:false` wird NICHT geworfen. Das ist der Weg, auf dem `type_ok:false`
  // heute schon läuft -- die Aufrufer prüfen es selbst, und ihnen den Fall wegzunehmen hiesse,
  // ihre eigenen Meldungen stillzulegen.
  const zweihundertNein = await leseAntwort(antwort(true, 200, { ok: false, reason: "type_mismatch" }));
  assert.strictEqual(zweihundertNein.reason, "type_mismatch",
    "eine 200 mit ok:false kommt durch -- der Aufrufer entscheidet");
  zaehl();

  console.log("OK — " + anzahl + " Zusicherungen (Wege-Editor: eine Antwort, ein Leser)");
})().catch((fehler) => {
  console.error(fehler);
  process.exit(1);
});
