// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Block „Verbund" in der Einzelansicht: jedes
// Fragment mit einem ✕, um es einzeln herauszunehmen.
// Auftrag: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §9 (Block B)
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-8-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-detail.test.js
//
// 🔴 Der reine Bauer wird per `vm` AUSGESCHNITTEN und AUSGEFUEHRT, nicht per Regex gelesen -- ein
// Regex kennt keinen Geltungsbereich (siehe die Lehre vom 03.09.2026, an mehreren Stellen dieses
// Fensters dokumentiert).

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

function schneide(name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
}

const kontext = { avesmapsGaretienEscape: (s) => String(s), _garetienVerbundZusammen: new Set() };
vm.createContext(kontext);
vm.runInContext(
    schneide("garetienVerbundSchluessel") + "\n"
    + schneide("garetienVerbundMitglieder") + "\n"
    + schneide("garetienVerbundIstZusammen") + "\n"
    + schneide("garetienVerbundBlockMarkup") + "\n"
    + "this.block = garetienVerbundBlockMarkup;", kontext);

const objekte = [1, 2, 3, 4].map((i) => ({
    key: "k" + i, name: "Silker Hain " + i, ebene: "Waelder", typ: "Wald",
    verbund_stamm: "Silker Hain", verbund_n: 4, geometrie: new Array(10 + i).fill([0, 0]),
}));

// Ohne Verbund: kein Block.
assert.strictEqual(kontext.block({ key: "x", name: "Weidicht" }, []), "");

// Mit Verbund: vier Zeilen, jede mit einem ✕.
const m = kontext.block(objekte[0], objekte);
assert.ok(m.indexOf("Silker Hain 1") > -1);
assert.ok(m.indexOf("Silker Hain 4") > -1);
assert.strictEqual((m.match(/gi-seg__weg/g) || []).length, 4, "es fehlt ein ✕");

// 💣 Die Punktzahl steht IM Namen, nicht in einer eigenen Rasterzelle -- sonst braucht die Zeile
// mit Knopf eine zweite Rasterreihe und wird doppelt so hoch (gemessen 46 statt 28 px).
assert.ok(m.indexOf("gi-seg__zahl") > -1, "die Punktzahl steht in einer eigenen Zelle");
assert.strictEqual((m.match(/gi-seg__gap/g) || []).length, 0,
    "eine vierte Rasterzelle bricht die Zeile um");

// ⚠️ Ein Verbund mit nur EINEM verbliebenen Mitglied (die uebrigen wurden ✕ herausgenommen) zeigt
// ebenfalls keinen Block mehr -- „Verbund" ohne einen zweiten Partner ist keiner mehr. Dieselbe
// Regel wie bei garetienVerbundMarkeMarkup (`n < 2` ist kein Verbund).
assert.strictEqual(kontext.block(objekte[0], [objekte[0]]), "",
    "ein einzelnes Fragment ist kein Verbund mehr");

// Der Knopf traegt den SCHLUESSEL des Fragments, nicht seinen Namen -- er muss das richtige
// Objekt treffen, wenn ein Klick es aus dem Verbund nimmt.
assert.ok(m.indexOf('data-verbund-weg="k1"') > -1, "der erste Knopf traegt den Schluessel k1");
assert.ok(m.indexOf('data-verbund-weg="k4"') > -1, "der vierte Knopf traegt den Schluessel k4");

// Escaping: der Name geht durch den Escaper -- mit einer Attrappe, die wirklich etwas aendert,
// nicht der Identitaets-Stub von oben, sonst waere das Merkmal ungeprueft.
const kontext2 = { avesmapsGaretienEscape: (s) => String(s).replace(/</g, "&lt;"),
    _garetienVerbundZusammen: new Set() };
vm.createContext(kontext2);
vm.runInContext(
    schneide("garetienVerbundSchluessel") + "\n"
    + schneide("garetienVerbundMitglieder") + "\n"
    + schneide("garetienVerbundIstZusammen") + "\n"
    + schneide("garetienVerbundBlockMarkup") + "\n"
    + "this.block = garetienVerbundBlockMarkup;", kontext2);
const boese = objekte.map((o, i) => (i === 0 ? Object.assign({}, o, { name: "<Silker> Hain 1" }) : o));
const mBoese = kontext2.block(boese[0], boese);
assert.ok(!mBoese.includes("<Silker>"), "der Fragmentname wird escaped: " + mBoese);
assert.ok(mBoese.includes("&lt;Silker"), "und escaped landet er auch wirklich im Markup: " + mBoese);

console.log("OK -- garetien-verbund-detail");
