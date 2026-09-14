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
    // 🔴 14.09.2026: der FUENFTE Speicher ist die ZIELWAHL (vorher die zwei Haekchen,
    // `garetienEinfuegeWahl`). 🪤 `garetienZielwahlZu` unterscheidet sich von `garetienZielWahlZu`
    // (Zeile darueber) NUR im „w" -- `indexOf` ist gross/klein-empfindlich, die volle Signatur mit
    // Parameter haelt die Fundstelle trotzdem eindeutig.
    { name: "garetienZielwahlZu", sucheAls: "function garetienZielwahlZu(objekt)" }
].forEach(function (eintrag) {
    const a = quelle.indexOf(eintrag.sucheAls);
    assert.ok(a > -1, eintrag.name + " fehlt");
    const rumpf = quelle.slice(a, quelle.indexOf("\n\t}", a));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        eintrag.name + " liest nicht den Einstellungsschluessel");
});

// Und die Setzer ebenso -- sonst schreiben sie woanders hin, als gelesen wird.
["garetienNameWahlSetzen", "garetienZielwahlSetzen"].forEach(function (name) {
    const s = quelle.indexOf("function " + name);
    assert.ok(s > -1, name + " fehlt");
    const rumpf = quelle.slice(s, quelle.indexOf("\n\t}", s));
    assert.ok(rumpf.indexOf("garetienEinstellungsSchluessel") > -1,
        name + " schreibt unter einem anderen Schluessel als gelesen wird");
});

// =================================================================================================
// Verhaltenszusicherung: der FUENFTE Speicher (seit 14.09.2026 die Zielwahl) teilt sich wirklich
// =================================================================================================
//
// Die Quelltextpruefung oben zeigt nur, dass die richtige FUNKTION gerufen wird -- sie belegt nicht,
// dass zwei Fragmente eines zusammengelegten Verbunds ihre Wahl WIRKLICH teilen und zwei NICHT
// zusammengelegte ihre eigene behalten. Dafuer laeuft das echte Modul.
//
// 🔴 Beide Fragmente tragen ein Neu-Item -- ihre Vorbelegung ist „karte"; umgeschaltet wird auf
// „nichts", damit der gepruefte Wert vom Ausgangswert unterscheidbar ist.
const { api } = ladeImporter();

function garetienZweiFragmente() {
    // Aufgabe 6: Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
    const verbund = { ebene: "region", typ: "wald", verbund_stamm: "Pruefwald-Fixrunde1",
        verbund_n: 2, ziel: "region", subtyp: "wald" };
    const item = [{ id: 1, change_type: "new", anlass: "", felder: ["quelle"] }];
    return [
        Object.assign({ key: "ggp:pruefwald:eins", items: item }, verbund),
        Object.assign({ key: "ggp:pruefwald:zwei", items: item }, verbund),
    ];
}

function aufraeumen() {
    // ⚠️ Seit Aufgabe 6 lebt „zusammengelegt" am Stage-Eintrag und stirbt mit „Stage leeren";
    // `garetienVerbundVergessen` wird gerufen, solange es die Funktion gibt.
    if (typeof api.garetienVerbundVergessen === "function") { api.garetienVerbundVergessen(); }
    api.garetienZielwahlVergessen();
    api.avesmapsGaretienStageLeeren();
}

// ---- Zusammengelegt: die Wahl an EINEM Mitglied wirkt am GANZEN Verbund ------------------------
// 🔴 Ruling R-a (Koordinator, Aufgabe 9, 14.09.2026): eine Zielwahl ungleich „karte" löst einen
// zusammengelegten Verbund AKTIV auf (garetienZielwahlSetzen ruft garetienVerbundAufloesen).
// „Geteilt" lässt sich seither nicht mehr als „dieselbe Wahl steht am Nachbarn" zeigen -- jede
// Abweichung von „karte" löst sofort auf, bevor ein zweiter Lesezugriff sie beobachten könnte --,
// sondern nur noch an der WIRKUNG: der Nachbar löst MIT auf, weil der Riegel (garetienVerbundZusammenlegbar)
// jedes Mitglied über DENSELBEN Speicher (`garetienEinstellungsSchluessel`) liest.
(function () {
    aufraeumen();
    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(schluessel !== "", "Testaufbau: die zwei Fragmente bilden einen Verbund");
    // ⚠️ Erst auflegen, dann zusammenlegen -- seit Aufgabe 6 legt Zusammenlegen nicht mehr selbst auf.
    api.avesmapsGaretienStageHinzufuegen([m1, m2]);
    assert.strictEqual(api.garetienVerbundZusammenlegen(schluessel, [m1, m2]), 2,
        "Testaufbau: beide Fragmente liegen auf der Stage und sind zusammengelegt");
    assert.ok(api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: der Verbund gilt als zusammengelegt");

    assert.strictEqual(api.garetienZielwahlZu(m2), "karte",
        "Testaufbau: die Vorbelegung ist „karte\", bevor irgendwer etwas waehlt");

    api.garetienZielwahlSetzen(m1, "nichts");
    assert.strictEqual(api.garetienVerbundIstZusammen(schluessel), false,
        "🔴 die Wahl an EINEM Fragment wirkt am GANZEN (geteilten) Verbund -- er löst sich auf (Ruling R-a)");
    assert.ok(!("verbund" in (api.garetienEingabenFuerServer(m2) || {})),
        "…und der Rumpf des ANDEREN Fragments trägt danach ebenfalls kein `verbund` mehr");
})();

// ---- Ohne Zusammenlegung: jedes Fragment behaelt seine eigene Wahl -----------------------------
(function () {
    aufraeumen();
    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(!api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: derselbe Verbund ist diesmal NICHT zusammengelegt");

    api.garetienZielwahlSetzen(m1, "nichts");
    assert.strictEqual(api.garetienZielwahlZu(m1), "nichts", "m1 traegt seine eigene Wahl");
    assert.strictEqual(api.garetienZielwahlZu(m2), "karte",
        "OHNE Zusammenlegung bleibt m2 bei seiner eigenen (unangetasteten) Vorbelegung");
})();

console.log("OK -- garetien-verbund-einstellungen");
