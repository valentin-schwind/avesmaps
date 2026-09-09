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
const zeileAnfang = quelle.indexOf("function garetienZeileMarkup");
const zeile = quelle.slice(zeileAnfang, quelle.indexOf("\n\t}", zeileAnfang));
const nameEnde = zeile.indexOf('avm-row__name">');
const markeStelle = zeile.indexOf("garetienVerbundMarkeMarkup");
assert.ok(markeStelle > nameEnde, "die Marke wird vor dem Namen gebaut");
assert.ok(zeile.indexOf('avm-row__name">\' + name + "</span>" + ') === -1,
    "die Marke haengt IM Namen");

console.log("OK -- garetien-verbund-marke");
