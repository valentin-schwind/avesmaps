"use strict";
// „Ganze Straße: A – B" nennt die zwei ENTFERNTESTEN ORTE unter allen offenen Enden der Gruppe -- nicht die Enden der
// laengsten Kette. Owner 15.09.2026: „was auf keinen fall sein darf: ich klick auf ein segment und da steht "Ganze Straße:
// Punin – Neil" obwohl ich nur von Kreuzung A zu Kreuzung B markiert habe." Live gemessen: Reichsstraße 1 zeigte
// „Greifenfurt – Berler", markiert war sie bis Warunk.
// Aus der Wurzel: node js/pages/__tests__/wege-ganze-strecke-entfernteste-orte.test.js
const assert = require("assert");
const path = require("path");

const M = require(path.join(__dirname, "..", "wege-editor-model.js"));
const abschnitt = (id, von, bis, a, b) => ({ public_id: id, ends: { from: von, to: bis }, enden: { von: a, bis: b } });

// 1. Der Reichsstrasse-1-Fall: die laengste Kette endet in Berler, dahinter eine Luecke und ein Abzweig bis Warunk.
const rs1 = [
	abschnitt("g1", [0, 0], [1, 0], "Greifenfurt", "Gareth"),
	abschnitt("g2", [1, 0], [2, 0], "Gareth", "Berler"),
	abschnitt("h1", [5, 0], [6, 0], "Kreuzung", "Kreuzung"),
	abschnitt("h2", [6, 0], [9, 0], "Kreuzung", "Warunk"),
	abschnitt("h3", [6, 0], [6, 1], "Kreuzung", "Wegende"),
];
assert.strictEqual(M.wpChainSegments(rs1)[0].length, 2, "Voraussetzung: die laengste Kette ist Greifenfurt – Gareth – Berler");
assert.strictEqual(M.wpGanzeStrecke(rs1), "Greifenfurt – Warunk", "die zwei entferntesten Orte, ueber Luecke und Abzweig hinweg");
assert.strictEqual(M.wpGanzeStrecke(rs1.slice().reverse()), "Greifenfurt – Warunk", "die Eingabereihenfolge aendert nichts");

// Ein gedrehter Abschnitt: sein offenes Ende liegt an `to`.
const gedreht = rs1.map((s) => (s.public_id === "g1" ? abschnitt("g1", [1, 0], [0, 0], "Gareth", "Greifenfurt") : s));
assert.strictEqual(M.wpGanzeStrecke(gedreht), "Greifenfurt – Warunk");

// 2. Nur offene Enden zaehlen: ein Ort IN der Strasse (Gareth, Wieha) ist kein Ende, ein Abzweig schon.
const ypsilon = [
	abschnitt("a", [0, 0], [1, 0], "Perz", "Wieha"),
	abschnitt("b", [1, 0], [2, 0], "Wieha", "Helmdahl"),
	abschnitt("c", [1, 0], [0.8, 5], "Wieha", "Rudein"),
];
assert.strictEqual(M.wpGanzeStrecke(ypsilon), "Rudein – Helmdahl", "der Abzweig nach Rudein ist ein Ende; der Westliche steht vorn");

// 3. Weniger als zwei Orte: nur „Ganze Straße"
assert.strictEqual(M.wpGanzeStrecke([
	abschnitt("k1", [0, 0], [1, 0], "Kreuzung", "Perz"),
	abschnitt("k2", [1, 0], [2, 0], "Perz", "Wegende"),
]), "", "nur Kreuzung und Wegende aussen -- Perz liegt innen");
assert.strictEqual(M.wpGanzeStrecke([abschnitt("e1", [0, 0], [1, 0], "Perz", "Kreuzung")]), "", "EIN Ort genuegt nicht");
assert.strictEqual(M.wpGanzeStrecke([abschnitt("e2", [0, 0], [1, 0], "", "Wegende")]), "", "ein leerer Name ist kein Ort");
assert.strictEqual(M.wpGanzeStrecke([
	abschnitt("z1", [0, 0], [1, 0], "Gareth", "Kreuzung"),
	abschnitt("z2", [5, 5], [6, 5], "Kreuzung", "Gareth"),
]), "", "zweimal derselbe Ortsname ist kein Paar");
assert.strictEqual(M.wpGanzeStrecke([
	abschnitt("r1", [0, 0], [1, 0], "Perz", "Wieha"),
	abschnitt("r2", [1, 0], [0, 0], "Wieha", "Perz"),
]), "", "ein Ring hat keine offenen Enden");
assert.strictEqual(M.wpGanzeStrecke([]), "");
assert.strictEqual(M.wpGanzeStrecke([{ public_id: "ohne" }]), "", "ohne Endpunkte keine Enden");

// 4. Gleichstand: deterministisch alphabetisch nach dem Namenspaar, unabhaengig von der Eingabe
const quadrat = [
	abschnitt("q1", [0, 0], [2, 2], "Dorn", "Aue"),
	abschnitt("q2", [2, 0], [0, 2], "Birk", "Cel"),
];
assert.strictEqual(M.wpGanzeStrecke(quadrat), "Dorn – Aue", "zwei gleich lange Diagonalen: das Paar Aue/Dorn vor Birk/Cel");
assert.strictEqual(M.wpGanzeStrecke(quadrat.slice().reverse()), "Dorn – Aue", "dieselbe Antwort in umgekehrter Reihenfolge");

// 5. Der einfache Fall bleibt, wie er war
assert.strictEqual(M.wpGanzeStrecke([
	abschnitt("s1", [0, 0], [1, 0], "Perz", "Kreuzung"),
	abschnitt("s2", [2, 0], [1, 0], "Wieha", "Kreuzung"),
]), "Perz – Wieha");

console.log("wege-ganze-strecke-entfernteste-orte.test.js: ok");
