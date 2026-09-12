"use strict";

/**
 * Ein umbenanntes Konfliktgebiet darf sich NICHT selbst als Anspruchsteller listen.
 *
 * 💣 Gefunden von einem Pruefagenten am 12.09.2026, als Folge des Fixes zu Fall #123: seither traegt
 * `properties.display_name` den Editor-Override, und `getRegionFeatureName` liest ihn ZUERST -- damit
 * trugen `regionEntry.name` UND `regionEntry.displayName` den Anzeigenamen. Die Konfliktparteien baut
 * der Server dagegen aus `political_territory.name`, also KANONISCH (territories-layer.php). Der
 * Unterdrueckungsschluessel des Besitzers passte deshalb nicht mehr auf seine eigene Partei:
 *   ohne Override -> Anspruchsteller []          (richtig)
 *   mit  Override -> Anspruchsteller ["Nordhjaldor"]  (das Gebiet listet SICH SELBST)
 *
 * 🪤 Der naheliegende Einzeiler ("nimm statt displayName einfach name") haette NICHT geholfen --
 * `name` ist selbst der Override. Es brauchte den kanonischen Namen aus der Normalisierung.
 *
 * 🪤 Die Ergebnisse kommen aus einem `vm`-Kontext und tragen einen FREMDEN Array-Prototyp --
 * `deepStrictEqual` faellt dagegen bei ZEICHENGLEICHEM Inhalt ("actual [a], expected [a]").
 * Deshalb `[...x]` vor jedem Vergleich; die Falle steht so auch in AGENTS.md §11.
 *
 * Beide Bauer werden AUSGEFUEHRT, nicht gelesen. Lauf:
 *   node js/map-features/__tests__/anspruchsteller-eigener-name.test.js
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..");

function ladeBauteile() {
    const kontext = {
        // Die zwei Helfer, die beide Dateien aus dem globalen Raum erwarten.
        normalizeRegionParentheticalSpacing: (wert) => String(wert || "").replace(/\s*\(\s*/g, " (").replace(/\s+/g, " ").trim(),
        normalizeRegionStringList: () => [],
        readFeatureOtherSource: () => "",
        console,
    };
    vm.createContext(kontext);
    for (const datei of [
        "map-features-region-feature-normalization.js",
        "map-features-region-info-markup.js",
    ]) {
        const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8");
        // Nur die zwei Funktionen, die hier gefragt sind -- die Dateien tragen Browser-Abhaengigkeiten.
        for (const name of ["getRegionFeatureName", "collectRegionContestedClaimants"]) {
            const ab = quelle.indexOf(`function ${name}(`);
            if (ab === -1) continue;
            let tiefe = 0, i = quelle.indexOf("{", ab), ende = -1;
            for (; i < quelle.length; i++) {
                if (quelle[i] === "{") tiefe++;
                else if (quelle[i] === "}") { tiefe--; if (tiefe === 0) { ende = i + 1; break; } }
            }
            assert.ok(ende > ab, `${name}: Rumpf nicht gefunden`);
            vm.runInContext(quelle.slice(ab, ende), kontext);
        }
    }
    assert.strictEqual(typeof kontext.collectRegionContestedClaimants, "function", "Bauer geladen");
    assert.strictEqual(typeof kontext.getRegionFeatureName, "function", "Namensbauer geladen");
    return kontext;
}

const k = ladeBauteile();

// Die Parteien, wie der Server sie baut: KANONISCH. Besitzer zuerst, dann die Anspruchsteller.
const parteien = [
    { name: "Nordhjaldor", color: "#884422" },
    { name: "Fuerstentum Kosch", color: "#225588" },
];

// --- A. Ohne Override: unveraendertes Verhalten -------------------------------------------------------
const ohne = k.collectRegionContestedClaimants({
    name: "Nordhjaldor",
    displayName: "Nordhjaldor",
    canonicalName: "Nordhjaldor",
    contestedParties: parteien,
});
assert.deepStrictEqual(
    [...ohne].map((p) => p.name),
    ["Fuerstentum Kosch"],
    "A: ohne Override wird nur der fremde Anspruchsteller gelistet"
);

// --- B. Mit Override: das Gebiet listet sich NICHT selbst ---------------------------------------------
// Genau der gemeldete Zustand: der Editor hat "Jarltum Nordhjaldor" gesetzt, die Partei heisst kanonisch.
const mit = k.collectRegionContestedClaimants({
    name: "Jarltum Nordhjaldor",       // getRegionFeatureName liest display_name zuerst
    displayName: "Jarltum Nordhjaldor",
    canonicalName: "Nordhjaldor",      // political_territory.name
    contestedParties: parteien,
});
assert.deepStrictEqual(
    [...mit].map((p) => p.name),
    ["Fuerstentum Kosch"],
    "B: ein umbenanntes Gebiet listet sich NICHT selbst als Anspruchsteller"
);
assert.ok(
    ![...mit].some((p) => p.name === "Nordhjaldor"),
    "B2: der kanonische eigene Name taucht nicht als Anspruchsteller auf"
);

// --- C. Der Anzeigename bleibt ebenfalls gesperrt -----------------------------------------------------
// ⚠️ Beide Schluessel muessen wirken: haette eine Partei zufaellig den ANZEIGENAMEN, waere sie ebenso
// das Gebiet selbst. Der alte Code konnte nur das; das darf nicht verlorengehen.
const beide = k.collectRegionContestedClaimants({
    name: "Jarltum Nordhjaldor",
    displayName: "Jarltum Nordhjaldor",
    canonicalName: "Nordhjaldor",
    contestedParties: [
        { name: "Nordhjaldor", color: "#884422" },
        { name: "Jarltum Nordhjaldor", color: "#334455" },
        { name: "Fuerstentum Kosch", color: "#225588" },
    ],
});
assert.deepStrictEqual(
    [...beide].map((p) => p.name),
    ["Fuerstentum Kosch"],
    "C: beide Namen des Gebiets sind gesperrt, der fremde kommt durch"
);

// --- D. Die Normalisierung liefert den kanonischen Namen ueberhaupt ------------------------------------
// 💣 Ohne diese Zeile ist der ganze Fix oben wirkungslos -- canonicalName waere undefined und die
// Sperre fiele stillschweigend auf den Anzeigenamen zurueck. Am Quelltext gemessen, weil der
// Normalisierer selbst zu viele Browser-Abhaengigkeiten hat, um ihn hier auszufuehren.
const normQuelle = fs.readFileSync(path.join(wurzel, "map-features-region-feature-normalization.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
assert.ok(
    /canonicalName\s*:/.test(normQuelle),
    "D1: die Normalisierung gibt canonicalName heraus"
);
assert.ok(
    /canonicalName\s*:\s*normalizeRegionParentheticalSpacing\(\s*properties\.name\b/.test(normQuelle),
    "D2: canonicalName kommt aus properties.name -- NICHT aus display_name (sonst ist es derselbe Wert)"
);

// --- E. Und der Leser fragt ihn auch wirklich ----------------------------------------------------------
const markupQuelle = fs.readFileSync(path.join(wurzel, "map-features-region-info-markup.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((z) => !/^\s*\/\//.test(z)).join("\n");
const ab = markupQuelle.indexOf("function collectRegionContestedClaimants(");
assert.ok(ab !== -1, "E0: Bauer gefunden");
assert.ok(
    markupQuelle.slice(ab, ab + 1200).includes("canonicalName"),
    "E1: collectRegionContestedClaimants liest canonicalName"
);

console.log("OK: anspruchsteller-eigener-name.test.js -- alle Zusicherungen gehalten.");
