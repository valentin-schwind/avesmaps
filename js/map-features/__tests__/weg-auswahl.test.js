"use strict";
// Die Klickfolge auf der Karte (Entwurf 2026-09-14 §3.1) -- AUSGEFUEHRT, Zeile fuer Zeile der Tabelle.
// Aus der Wurzel: node js/map-features/__tests__/weg-auswahl.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const A = require(path.join(__dirname, "..", "weg-auswahl.js"));

const RS = "wiki:reichsstrasse-2";
const BP = "wiki:b-renpfad";
const klick = A.avesmapsWegAuswahlNachKlick;

// §3.1
let s = klick(null, RS, "rs-7");
assert.deepStrictEqual(s, { gruppe: RS, publicId: null }, "nichts markiert: ganze Strasse");
s = klick(s, RS, "rs-7");
assert.deepStrictEqual(s, { gruppe: RS, publicId: "rs-7" }, "Klick auf die markierte ganze Strasse: der Abschnitt");
s = klick(s, RS, "rs-6");
assert.deepStrictEqual(s, { gruppe: RS, publicId: "rs-6" }, "anderer Abschnitt derselben Strasse: dieser Abschnitt");
s = klick(s, RS, "rs-6");
assert.deepStrictEqual(s, { gruppe: RS, publicId: null }, "markierter Abschnitt: wieder die ganze Strasse");
s = klick(s, BP, "bp-1");
assert.deepStrictEqual(s, { gruppe: BP, publicId: null }, "andere Strasse: deren ganze Strasse");
// Ein Doppelklick feuert vorher zwei Klicks: die Markierung darf wechseln (der Verlauf-Editor bekommt den Pfad selbst).
assert.deepStrictEqual(klick(klick(null, RS, "rs-3"), RS, "rs-3"), { gruppe: RS, publicId: "rs-3" });
// `vorher` bleibt unangetastet
const eingefroren = Object.freeze({ gruppe: RS, publicId: null });
assert.deepStrictEqual(klick(eingefroren, RS, "rs-1"), { gruppe: RS, publicId: "rs-1" });
assert.deepStrictEqual(eingefroren, { gruppe: RS, publicId: null });
// Ohne Gruppe oder Abschnitt kein Zustand
assert.strictEqual(klick(s, "", "x"), null);
assert.strictEqual(klick(s, RS, ""), null);

// Was markiert ist
assert.deepStrictEqual(A.avesmapsWegAuswahlIds({ gruppe: RS, publicId: null }, ["rs-1", "rs-2"]), ["rs-1", "rs-2"]);
assert.deepStrictEqual(A.avesmapsWegAuswahlIds({ gruppe: RS, publicId: "rs-2" }, ["rs-1", "rs-2"]), ["rs-2"]);
assert.deepStrictEqual(A.avesmapsWegAuswahlIds(null, ["rs-1"]), []);

// Die Markierungszeile (Kurzform §4)
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: null }, "Perz – Helmdahl"), "Ganze Straße: Perz – Helmdahl");
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: "rs-7" }, "Silkwiesen – Wieha"), "Abschnitt: Silkwiesen – Wieha");
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: null }, ""), "Ganze Straße", "ohne Enden nur das Wort (§4)");
assert.strictEqual(A.avesmapsWegMarkierungszeile(null, "Perz – Helmdahl"), "");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: null }, "Perz – Helmdahl"), "<b>Ganze Straße:</b> Perz – Helmdahl");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: null }, ""), "<b>Ganze Straße</b>");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: "x" }, "A<b> – B"), "<b>Abschnitt:</b> A&lt;b&gt; – B");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup(null, "A – B"), "");

// „Verlauf bearbeiten" nur am Abschnitt (§3.4); ohne Markierung (Suche, Deeplink) wie bisher
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt({ gruppe: RS, publicId: null }), false);
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt({ gruppe: RS, publicId: "rs-7" }), true);
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt(null), true);

// Traegt ein Abschnitt den Artikel als weitere Zuweisung?
const rs7 = { wiki_path_weitere: [{ wiki_key: "b-renpfad" }] };
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, "b-renpfad"), true);
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, "reichsstrasse-2"), false);
assert.strictEqual(A.avesmapsWegTraegtWeiteren({}, "b-renpfad"), false);
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, ""), false);

const seite = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const tag = seite.indexOf('<script src="js/map-features/weg-auswahl.js"></script>');
assert.ok(tag > seite.indexOf('<script src="js/map-features/weg-weitere-anzeige.js"></script>') && tag > 0, "index.html laedt die Regel nach weg-weitere-anzeige.js");

console.log("weg-auswahl.test.js: ok");
