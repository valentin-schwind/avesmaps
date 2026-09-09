"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

// Den reinen Bauer ausschneiden und AUSFUEHREN -- ein Regex ueber den Quelltext kennt keinen
// Geltungsbereich und liesse einen ReferenceError durch (die Lehre vom 03.09.2026).
const anfang = quelle.indexOf("function garetienVerbundMarkeMarkup");
assert.ok(anfang > -1, "garetienVerbundMarkeMarkup fehlt");
const rumpf = quelle.slice(anfang, quelle.indexOf("\n\t}", anfang) + 3);

const kontext = { avesmapsGaretienEscape: (s) => String(s) };
vm.createContext(kontext);
vm.runInContext(rumpf + "\nthis.bau = garetienVerbundMarkeMarkup;", kontext);
const bau = kontext.bau;

// Ohne Verbund: nichts.
assert.strictEqual(bau({ name: "Weidicht" }), "");
assert.strictEqual(bau({ name: "Weidicht", verbund_n: 1 }), "", "n=1 ist kein Verbund");

// Mit Verbund: die Marke, mit der Zahl.
const m = bau({ name: "Silker Hain 1", verbund_stamm: "Silker Hain", verbund_n: 4 });
assert.ok(m.indexOf("gi-frag") > -1, "die Klasse fehlt");
assert.ok(m.indexOf("4 Fragmente") > -1, "die Zahl fehlt");

// 💣 Die Marke steht NEBEN dem Namen, nie darin: .avm-row__name ellipsiert, und ein Zusatz
// darin verschwaende bei jedem laengeren Titel hinter den drei Punkten.
// ⚠️ Diese erste Zusicherung bleibt eine grobe QUELLTEXT-Vorpruefung (der Aufruf steht im
// Quelltext nach dem Namensfeld) -- sie ist nicht falsch, nur schwach. Die tragende Pruefung
// folgt unten am ECHTEN, gebauten Markup.
const zeileAnfang = quelle.indexOf("function garetienZeileMarkup");
const zeile = quelle.slice(zeileAnfang, quelle.indexOf("\n\t}", zeileAnfang));
const nameEnde = zeile.indexOf('avm-row__name">');
const markeStelle = zeile.indexOf("garetienVerbundMarkeMarkup");
assert.ok(markeStelle > nameEnde, "die Marke wird vor dem Namen gebaut");

// 💣 PRUEFBEFUND (Korrektur 09.09.2026): hier stand eine Quelltext-Zusicherung, die als EIN-
// ZEILEN-Teilkette nach `'avm-row__name">\' + name + "</span>" + '` suchte. Diese Zeichenkette
// kommt in review-garetien-importer.js NIE vor -- die Datei bricht nach JEDEM String-Literal
// vor dem naechsten "+" auf eine neue Zeile um:
//   + '<span class="avm-row__name">' + name + "</span>"
//   + garetienVerbundMarkeMarkup(o)
// Die Zusicherung war damit VAKUUM: sie traf IMMER zu, unabhaengig davon, ob die Marke wirklich
// danebensteht oder heimlich in den Namen hineingebaut wurde. Gemessen wird deshalb am ECHTEN,
// GEBAUTEN Markup statt am Quelltext -- garetienZeileMarkup ist ohnehin exportiert
// (js/review/__tests__/garetien-liste-zeile.test.js nutzt denselben Weg).
const echtesModul = require(path.join(__dirname, "..", "review-garetien-importer.js"));
assert.strictEqual(typeof echtesModul.garetienZeileMarkup, "function",
    "garetienZeileMarkup fehlt im Export");

const objektMitVerbund = {
    key: "probe-verbund", name: "Silker Hain 1", typ: "Weiler", urteil: "neu",
    verbund_stamm: "Silker Hain", verbund_n: 4,
};
const gebaut = echtesModul.garetienZeileMarkup(objektMitVerbund, false);

// Das Namensfeld muss als VOLLSTAENDIGES, UNZERRISSENES <span> auftauchen. Staekfe die Marke
// DARIN (zwischen Namen und schliessendem Tag), gaebe es diese zusammenhaengende Zeichenkette
// nicht mehr -- genau das ist die Falle, an der die Marke „12 von 56 Abschnitten" (AGENTS.md §11)
// schon einmal unsichtbar war: .avm-row__name ellipsiert den GANZEN Inhalt, ein Zusatz DARIN
// verschwaende bei jedem laengeren Titel hinter den drei Punkten.
const nameSpanGanz = '<span class="avm-row__name">Silker Hain 1</span>';
const nameSpanIndex = gebaut.indexOf(nameSpanGanz);
assert.ok(nameSpanIndex > -1,
    "das Namensfeld muss als geschlossenes <span> im gebauten Markup stehen -- steckt dort "
    + "etwas zusaetzliches, findet sich die Zeichenkette nicht mehr: " + gebaut);

const markeImMarkup = gebaut.indexOf("gi-frag");
assert.ok(markeImMarkup > -1, "die Marke muss im gebauten Markup wirklich vorkommen");
assert.ok(markeImMarkup >= nameSpanIndex + nameSpanGanz.length,
    "die Marke muss NACH dem geschlossenen Namensfeld stehen, nicht darin: " + gebaut);

// Gegenprobe: ohne Verbund baut dieselbe (echte, verdrahtete) Funktion keine Marke -- sonst waere
// die vorige Zusicherung nur zufaellig erfuellt, weil "gi-frag" ohnehin nie vorkaeme.
const ohneVerbundEcht = echtesModul.garetienZeileMarkup(
    { key: "probe-ohne", name: "Weidicht", typ: "Bach", urteil: "neu" }, false);
assert.ok(ohneVerbundEcht.indexOf("gi-frag") === -1,
    "ohne Verbund darf im echten, gebauten Markup keine Marke stehen");

console.log("OK -- garetien-verbund-marke");
