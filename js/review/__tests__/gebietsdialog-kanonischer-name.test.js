"use strict";

/**
 * Der Kartendialog "Herrschaftsgebiet bearbeiten" bearbeitet den KANONISCHEN Namen und fasst den
 * Anzeigenamen NICHT an.
 *
 * 💣 Gefunden am 12.09.2026 beim Suchen nach einer ganz anderen Meldung -- und von sechs
 * Pruefagenten NICHT gefunden, weil ich sie nach Lesern gefragt hatte und das hier ein SCHREIBweg
 * ist. Das Namensfeld war aus `region.displayName` vorbelegt. Solange Anzeigename und kanonischer
 * Name dasselbe waren, war das harmlos; seit sie auseinanderfallen duerfen, haette ein blosses
 * Oeffnen-und-Speichern den Override als `political_territory.name` fortgeschrieben:
 *   - der Slug wird aus dem Namen neu abgeleitet (die Waldmenschen-Dublettenfalle, begruendet in
 *     avesmapsPoliticalUpdateTerritory),
 *   - und danach leert avesmapsPoliticalDisplayNameForWrite die Spalte, weil der Anzeigename dem
 *     Namen nun gleicht -- der kanonische Name waere ersatzlos weg.
 *
 * Lauf: node js/review/__tests__/gebietsdialog-kanonischer-name.test.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..");

function ladeBauer() {
    const kontext = { console };
    vm.createContext(kontext);
    const quelle = fs.readFileSync(path.join(wurzel, "review-region-tabs-payload.js"), "utf8");
    for (const name of ["regionEditPayloadToRegion", "regionEditPayloadToPayload"]) {
        const ab = quelle.indexOf(`function ${name}(`);
        assert.ok(ab !== -1, `${name} nicht gefunden`);
        // 🪤 NICHT am ersten "{" nach dem Namen beginnen: die Signatur traegt `fallback = {}`, und ein
        // Zaehler, der dort startet, ist nach zwei Zeichen fertig. Die Falle steht so in AGENTS.md.
        // Erst die Parameterliste schliessen, dann den Rumpf suchen.
        let klammern = 0, rumpfAb = -1;
        for (let i = quelle.indexOf("(", ab); i < quelle.length; i++) {
            if (quelle[i] === "(") klammern++;
            else if (quelle[i] === ")") { klammern--; if (klammern === 0) { rumpfAb = quelle.indexOf("{", i); break; } }
        }
        assert.ok(rumpfAb > ab, `${name}: Rumpfbeginn nicht gefunden`);
        let tiefe = 0, ende = -1;
        for (let i = rumpfAb; i < quelle.length; i++) {
            if (quelle[i] === "{") tiefe++;
            else if (quelle[i] === "}") { tiefe--; if (tiefe === 0) { ende = i + 1; break; } }
        }
        vm.runInContext(quelle.slice(ab, ende), kontext);
    }
    return kontext;
}

const k = ladeBauer();

// Die Lage aus Fall #123: Gebiet heisst kanonisch "Nordhjaldor", zeigt "Jarltum Nordhjaldor".
const eintrag = {
    name: "Jarltum Nordhjaldor",          // getRegionFeatureName liest display_name zuerst
    displayName: "Jarltum Nordhjaldor",
    canonicalName: "Nordhjaldor",         // political_territory.name
    territoryPublicId: "pt-nord",
    geometryPublicId: "geo-1",
    parentPublicId: "pt-thorwal",
};

// --- A. Oeffnen ohne Aenderung: der Rundlauf darf den Namen NICHT verschieben --------------------
// Ein leeres Formular (der Benutzer hat nichts getippt) faellt auf den Eintrag zurueck.
const region = k.regionEditPayloadToRegion({}, eintrag);
assert.strictEqual(region.name, "Nordhjaldor", "A1: der Rundlauf traegt den kanonischen Namen");
assert.strictEqual(region.canonicalName, "Nordhjaldor", "A2: und haelt ihn getrennt fest");
assert.strictEqual(region.displayName, "Jarltum Nordhjaldor", "A3: der Anzeigename reist unveraendert mit");

const raus = k.regionEditPayloadToPayload(region);
assert.strictEqual(raus.name, "Nordhjaldor", "A4: gespeichert wird der KANONISCHE Name");
assert.notStrictEqual(raus.name, "Jarltum Nordhjaldor", "A5: NICHT der Anzeigename");

// --- B. Der Dialog schreibt den Anzeigenamen gar nicht -------------------------------------------
// ⚠️ Er hat kein Feld dafuer. Wuerde er `display_name` mitschicken, naehme der Server das als
// ausdrueckliche Aussage (array_key_exists) -- ein leeres Feld loeschte den Override.
assert.ok(!("display_name" in raus), "B1: `display_name` steht NICHT im Rumpf");
assert.ok(!("displayName" in raus), "B2: auch nicht in camelCase");

// --- C. Tippt der Benutzer einen neuen Namen, gilt der ------------------------------------------
const getippt = k.regionEditPayloadToRegion({ name: "Neu-Nordhjaldor" }, eintrag);
assert.strictEqual(getippt.name, "Neu-Nordhjaldor", "C1: das Formular gewinnt");
assert.strictEqual(k.regionEditPayloadToPayload(getippt).name, "Neu-Nordhjaldor", "C2: und wird gespeichert");
assert.strictEqual(getippt.displayName, "Jarltum Nordhjaldor", "C3: der Anzeigename bleibt unberuehrt");

// --- D. Ohne Override bleibt alles wie bisher ---------------------------------------------------
const ohne = { name: "Kosch", displayName: "Kosch", canonicalName: "Kosch" };
assert.strictEqual(k.regionEditPayloadToPayload(k.regionEditPayloadToRegion({}, ohne)).name, "Kosch", "D1: unveraendert");

// --- E. Und das Namensfeld des Dialogs wird kanonisch vorbelegt ----------------------------------
// 💣 Das ist die Stelle, an der die Mine lag. Am Quelltext gemessen, weil die Datei das DOM anfasst.
const pop = fs.readFileSync(path.join(wurzel, "review-region-dialog-population.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
const zeile = pop.split("\n").find((z) => z.includes('"region-edit-name"'));
assert.ok(zeile, "E0: die Vorbelegung ist da");
assert.ok(zeile.includes("canonicalName"), "E1: sie liest canonicalName");
assert.ok(!/region\.displayName/.test(zeile), "E2: und NICHT displayName (das war die Mine)");

console.log("OK: gebietsdialog-kanonischer-name.test.js -- alle Zusicherungen gehalten.");
