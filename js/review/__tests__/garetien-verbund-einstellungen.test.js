"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

// 💣 DIE VIER SPEICHER MUESSEN DENSELBEN SCHLUESSEL LESEN. Vier Fragmente haetten sonst vier
// Saetze Einstellungen, drei davon wuerden beim Import lautlos verworfen, und welcher gewinnt,
// haenge an der Reihenfolge der Items. Von aussen sieht das aus wie "die Einstellung wurde
// ignoriert" -- deshalb wird hier der QUELLTEXT jeder der vier Funktionen geprueft.
//
// 🔴 Fixrunde 1 (Pruefbefund an Aufgabe 5): `garetienEinfuegeWahl` war ein FUENFTER Speicher, den
// der Brief nicht kannte -- er las `_garetienEinfuegeWahl` weiterhin unter `objekt.key`. Genau
// diese zwei Haekchen ("Neu einfuegen" / "Als Quelle einfuegen") entscheiden den Schreibumfang
// beim Import (garetienStageItems), und ein zusammengelegter Verbund zeigt sie nur EINMAL.
[
    { name: "garetienEingabenZustandZu", sucheAls: "function garetienEingabenZustandZu" },
    { name: "garetienZielWahlZu", sucheAls: "function garetienZielWahlZu" },
    { name: "garetienNameWahlZu", sucheAls: "function garetienNameWahlZu" },
    // 🪤 "garetienEinfuegeWahl" ist PRAEFIX von "garetienEinfuegeWahlVergessen" (weiter oben in
    // der Datei definiert) und von "garetienEinfuegeWahlSetzen" -- ein blosser Namenslauf faende
    // per `indexOf` die FALSCHE (fruehere) Funktion und der Test waere vakuum. Die volle Signatur
    // mit Parameter macht die Fundstelle eindeutig.
    { name: "garetienEinfuegeWahl", sucheAls: "function garetienEinfuegeWahl(objekt)" }
].forEach(function (eintrag) {
    const a = quelle.indexOf(eintrag.sucheAls);
    assert.ok(a > -1, eintrag.name + " fehlt");
    const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        eintrag.name + " liest nicht den Einstellungsschluessel");
});

// Und die Setzer ebenso -- sonst schreiben sie woanders hin, als gelesen wird.
["garetienNameWahlSetzen", "garetienEinfuegeWahlSetzen"].forEach(function (name) {
    const s = quelle.indexOf("function " + name);
    assert.ok(s > -1, name + " fehlt");
    const rumpf = quelle.slice(s, quelle.indexOf("\n\t}", s));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        name + " schreibt unter einem anderen Schluessel als gelesen wird");
});

// =================================================================================================
// Fixrunde 1 -- Verhaltenszusicherung: der FUENFTE Speicher teilt sich wirklich
// =================================================================================================
//
// Die Quelltextpruefung oben zeigt nur, dass die richtige FUNKTION gerufen wird -- sie belegt
// nicht, dass zwei Fragmente eines zusammengelegten Verbunds ihre Wahl WIRKLICH teilen und zwei
// NICHT zusammengelegte Objekte ihre eigene behalten. Dafuer laeuft das echte Modul (per `require`,
// ueber den Fake-Dom-Helfer wie in garetien-einfuege-haken.test.js).
//
// 🔴 Beide Fragmente tragen NUR ein Quellen-Ergaenzungs-Item (kein `new`-Item) -- damit ist
// `neuGeht` fuer beide false und "quelle" die einzig bewegliche Groesse; die Vorbelegung eines
// solchen Objekts ist `quelle: true` (garetienStageVorhaben -> "ergaenzung"), also wird hier auf
// FALSE umgeschaltet, um einen echten, vom Ausgangswert unterscheidbaren Wert zu pruefen.
const { api } = ladeImporter();

function garetienZweiFragmente() {
    // Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
    const verbund = { ebene: "region", typ: "wald", verbund_stamm: "Pruefwald-Fixrunde1",
        verbund_n: 2, ziel: "region", subtyp: "wald" };
    const item = [{ id: 1, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"] }];
    return [
        Object.assign({ key: "ggp:pruefwald:eins", items: item }, verbund),
        Object.assign({ key: "ggp:pruefwald:zwei", items: item }, verbund),
    ];
}

// ---- Zusammengelegt: die Wahl an EINEM Mitglied gilt am ANDEREN --------------------------------
(function () {
    api.garetienVerbundVergessen();
    api.garetienEinfuegeWahlVergessen();
    api.avesmapsGaretienStageLeeren();

    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(schluessel !== "", "Testaufbau: die zwei Fragmente bilden einen Verbund");
    // 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
    api.avesmapsGaretienStageHinzufuegen([m1, m2]);
    assert.strictEqual(api.garetienVerbundZusammenlegen(schluessel, [m1, m2]), 2,
        "Testaufbau: beide Fragmente liegen auf der Stage und sind zusammengelegt");
    assert.ok(api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: der Verbund gilt als zusammengelegt");

    // Vorbelegung vor jeder Wahl: „Quelle ergaenzen" ist vorangehakt.
    assert.strictEqual(api.garetienEinfuegeWahl(m2).quelle, true,
        "Testaufbau: die Vorbelegung ist quelle=true, bevor irgendwer etwas anhakt");

    api.garetienEinfuegeWahlSetzen(m1, "quelle", false);
    assert.strictEqual(api.garetienEinfuegeWahl(m2).quelle, false,
        "zusammengelegter Verbund: das Abhaken an EINEM Fragment gilt am ANDEREN");
})();

// ---- Ohne Zusammenlegung: jedes Fragment behaelt seine eigene Wahl -----------------------------
(function () {
    api.garetienVerbundVergessen();
    api.garetienEinfuegeWahlVergessen();
    api.avesmapsGaretienStageLeeren();

    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(!api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: derselbe Verbund ist diesmal NICHT zusammengelegt");

    api.garetienEinfuegeWahlSetzen(m1, "quelle", false);
    assert.strictEqual(api.garetienEinfuegeWahl(m1).quelle, false,
        "m1 traegt seine eigene Abwahl");
    assert.strictEqual(api.garetienEinfuegeWahl(m2).quelle, true,
        "OHNE Zusammenlegung bleibt m2 bei seiner eigenen (unangetasteten) Vorbelegung");
})();

console.log("OK -- garetien-verbund-einstellungen");
