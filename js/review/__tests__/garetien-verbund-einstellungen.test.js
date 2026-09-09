"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

// 💣 DIE DREI SPEICHER MUESSEN DENSELBEN SCHLUESSEL LESEN. Vier Fragmente haetten sonst vier
// Saetze Einstellungen, drei davon wuerden beim Import lautlos verworfen, und welcher gewinnt,
// haenge an der Reihenfolge der Items. Von aussen sieht das aus wie "die Einstellung wurde
// ignoriert" -- deshalb wird hier der QUELLTEXT jeder der drei Funktionen geprueft.
["garetienEingabenZustandZu", "garetienZielWahlZu", "garetienNameWahlZu"].forEach(function (name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        name + " liest nicht den Einstellungsschluessel");
});

// Und der Setzer ebenso -- sonst schreibt er woanders hin, als gelesen wird.
const setz = quelle.indexOf("function garetienNameWahlSetzen");
assert.ok(quelle.slice(setz, quelle.indexOf("\n\t}", setz)).indexOf("garetienEinstellungsSchluessel") > -1,
    "garetienNameWahlSetzen schreibt unter einem anderen Schluessel als gelesen wird");

console.log("OK -- garetien-verbund-einstellungen");
