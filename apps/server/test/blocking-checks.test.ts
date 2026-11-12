import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    BLOCKING_CHECKS,
    BLOCKING_SOURCE_CHECKS,
    befundSummary,
    blockingEntries,
    blockingEntry,
    blockingNames,
    checkFindings,
    checkWord,
    isBlockingCheck,
    settleChecks,
    settleWith,
} from "../src/blocking-checks.ts";
import { seaRoutesPassed } from "../src/routing/sea-verify.ts";

/**
 * Nur Prüfungen, die der Betreiber definiert hat, halten einen Import, eine Ableitung oder einen Prüflauf an
 * (Betreiber 2026-10-03, AGENTS.md „Blockierende Prüfungen im Betrieb“). Hier steht, dass diese Liste wirkt, dass jeder
 * Prüfer sie anwendet und dass Liste und Inventur dasselbe sagen.
 *
 * Stand nach „A auch für die Prüfungen“ und „B“ zu den Klima-Prüfungen (Betreiber 2026-10-03): Kein Prüfer hält mehr an,
 * `BLOCKING_CHECKS` ist leer. Blockierend sind nur noch die Quellenprüfungen der Importer (Gruppen 5 bis 7).
 */

const SERVER_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..", "..");
const INVENTORY = resolve(REPO_ROOT, "project-control", "discovery", "blockierende-pruefungen-2026-10-03.md");

/** Wo jeder Prüfer seine Prüfungen benennt (Quelltext, relativ zu `apps/server/src`). */
const VERIFIER_SOURCES: Record<string, string[]> = {
    "verify:places": ["migration/verify-places.ts"],
    "verify:regions": ["migration/verify-regions.ts"],
    "verify:paths": ["migration/verify-paths.ts"],
    "verify:powerlines": ["migration/verify-powerlines.ts"],
    "verify:terrain": ["migration/verify-terrain.ts"],
    "verify:territories": ["migration/verify-territories.ts"],
    "verify:landscape-display": ["migration/verify-landscape-display.ts"],
    "verify:climate": ["migration/verify-climate.ts"],
    "verify:runs": ["derive/verify-runs.ts"],
    "verify:path-runs": ["derive/verify-path-runs.ts"],
    "verify:path-visuals": ["derive/verify-path-visual.ts"],
    "verify:sea-routes": ["routing/sea-verify.ts"],
    "verify:territory-shapes": [
        "territories/verify-derived.ts",
        "territories/verify-claims.ts",
        "territories/verify-inner-borders.ts",
        "territories/verify-band-runs.ts",
    ],
    "verify:domain-terrain": ["terrain/domain/verify-current.ts"],
    "verify:display-heights": ["terrain/display-height/verify.ts"],
};

const source = (file: string): string => readFileSync(resolve(SERVER_ROOT, "src", file), "utf8");

describe("settleChecks: nur eine ausgefallene blockierende Prüfung kippt das Urteil", () => {
    const failing = { name: "zonen_vollzaehlig", passed: false, detail: "7 Zonentypen (erwartet 8)", offenders: ["x"] };
    const otherFailing = { name: "namen_vollzaehlig", passed: false, detail: "2 abweichend" };
    const passing = { name: "wege_vollzaehlig", passed: true, detail: "ok" };

    it("der Mechanismus bleibt: ein Eintrag in einer Liste lässt das Urteil scheitern (hier eine Probeliste, die echte ist leer)", () => {
        const probeliste = {
            "verify:probe/zonen_vollzaehlig": { class: "BETREIBER", source: "Probeeintrag fuer den Test" },
        } as const;
        const settled = settleChecks("verify:probe", [passing, failing], probeliste);
        expect(settled.passed).toBe(false);
        expect(settled.checks.map((check) => check.blocking)).toEqual([false, true]);
    });

    it("🔴 Klima meldet nur (Betreiber 2026-10-03, „B“): eine ausgefallene Klima-Prüfung kippt das Urteil nicht", () => {
        const settled = settleChecks("verify:climate", [passing, failing]);
        expect(settled.passed).toBe(true);
        expect(settled.checks[1]).toMatchObject({ passed: false, blocking: false });
        const findings = checkFindings("verify:climate", settled.checks, (check) => check.passed);
        expect(findings.map((finding) => finding.code)).toEqual(["verify:climate/zonen_vollzaehlig"]);
    });

    it("🔴 eine Prüfung außerhalb der Liste fällt aus, ohne das Urteil zu kippen (Verstoß -> Lauf läuft durch)", () => {
        const settled = settleChecks("verify:paths", [passing, otherFailing]);
        expect(settled.passed).toBe(true);
        // Das eigene Ergebnis der Prüfung bleibt wahr: sie ist ausgefallen und wird als Befund gemeldet.
        expect(settled.checks[1]).toMatchObject({ passed: false, blocking: false });
        const findings = checkFindings("verify:paths", settled.checks, (check) => check.passed);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.code).toBe("verify:paths/namen_vollzaehlig");
        expect(findings[0]?.message).toContain("2 abweichend");
        expect(blockingNames(settled.checks)).toBe("");
        expect(befundSummary(settled.checks, (check) => check.passed)).toContain("1 Prüfung(en) als BEFUND");
    });

    it("🔴 die früheren UNKLAR-Prüfungen melden nur: Höhenmodell, Anzeigehöhen, Schriftläufe, Seegraph, Gebiete (A auch für die Prüfungen)", () => {
        for (const [verifier, check] of [
            ["verify:domain-terrain", "Domain-Constraints"],
            ["verify:display-heights", "Seen eben"],
            ["verify:display-heights", "Domain-Constraints"],
            ["verify:terrain", "gipfel_gleich_wie_legacy"],
            ["verify:landscape-display", "paritaet"],
            ["verify:runs", "I5_laeuft_in_der_flaeche"],
            ["verify:path-runs", "auf_der_sichtbaren_linie"],
            ["verify:path-visuals", "endpunkte_unveraendert"],
            ["verify:regions", "retirement_applied"],
            ["verify:powerlines", "kraftlinienpunkte_lage"],
            ["verify:sea-routes", "Stichprobe über Wasser"],
            ["verify:territory-shapes", "inner_border_unique"],
        ] as const) {
            expect(isBlockingCheck(verifier, check), `${verifier}/${check}`).toBe(false);
        }
    });

    it("liest bei Bedarf ein anderes Feld als `passed` (Seegraph: `ok`)", () => {
        const settled = settleWith(
            "verify:sea-routes",
            [{ name: "Stichprobe über Wasser", ok: false, detail: "1 über Land" }],
            (c) => c.ok,
        );
        expect(settled.passed).toBe(true);
        expect(seaRoutesPassed(settled.checks)).toBe(true);
        expect(settled.checks[0]?.blocking).toBe(false);
    });

    it("eine nicht eingeordnete Prüfung (ohne `blocking`) gilt für die Ausgabe als blockierend", () => {
        expect(checkWord(false, true, "OK  ")).toBe("FAIL");
        expect(checkWord(false, false, "OK  ")).toBe("BEFUND");
        expect(checkWord(true, false, "OK  ")).toBe("OK  ");
        expect(
            blockingNames([
                { name: "a", passed: false },
                { name: "b", passed: false, blocking: false },
            ]),
        ).toBe("a");
    });
});

describe("die Listen der anhaltenden Prüfungen", () => {
    it("ein genauer Schlüssel und ein Anfang mit Stern gelten, alles andere nicht", () => {
        expect(isBlockingCheck("verify:climate", "linien_anzahl")).toBe(false);
        expect(
            isBlockingCheck("verify:probe", "x", { "verify:probe/*": { class: "BETREIBER", source: "Probe" } }),
        ).toBe(true);
        expect(isBlockingCheck("verify:terrain", "gebirge_vollzaehlig")).toBe(false);
        expect(isBlockingCheck("verify:places", "count")).toBe(false);
        expect(isBlockingCheck("verify:unbekannt", "irgendwas")).toBe(false);
    });

    it("🔴 kein Prüfer hält mehr an (Klima „B“): die Liste ist leer, und jeder künftige Eintrag nennt Klasse und Fundstelle", () => {
        expect(blockingEntries()).toEqual([]);
        for (const [key, entry] of blockingEntries()) {
            expect(entry.class, key).toBe("BETREIBER");
            expect(entry.source.length, `${key}: Fundstelle fehlt`).toBeGreaterThan(10);
            expect(Object.keys(VERIFIER_SOURCES), key).toContain(key.slice(0, key.indexOf("/")));
        }
        expect(blockingEntry("verify:climate", "linien_anzahl")).toBeUndefined();
    });

    it("🔴 die Quellenprüfungen der Importer sind Betreiberentscheidungen (A auch für die Prüfungen) und stehen in der Liste", () => {
        expect(Object.keys(BLOCKING_SOURCE_CHECKS)).toEqual([
            "A12",
            "A13",
            "A14",
            "A15",
            "A16",
            "A17",
            "A18",
            "A21",
            "A22",
            "A24",
        ]);
        for (const [key, entry] of Object.entries(BLOCKING_SOURCE_CHECKS)) {
            expect(entry.class, key).toBe("BETREIBER");
            expect(entry.source.length, key).toBeGreaterThan(10);
            expect(entry.where.length, key).toBeGreaterThan(10);
        }
        expect(BLOCKING_SOURCE_CHECKS["A12"]?.source).toContain("A auch für die Prüfungen");
        expect(BLOCKING_SOURCE_CHECKS["A21"]?.source).toContain("Gruppe 7");
    });

    it("jeder Schlüssel benennt eine Prüfung, die im Quelltext ihres Prüfers steht", () => {
        for (const [key] of blockingEntries()) {
            const verifier = key.slice(0, key.indexOf("/"));
            const name = key.slice(key.indexOf("/") + 1);
            const text = (VERIFIER_SOURCES[verifier] ?? []).map(source).join("\n");
            const needle = name.endsWith("*") ? name.slice(0, -1) : name;
            if (needle === "") continue; // „verify:x/*“ - alle Prüfungen des Prüfers
            expect(text, `${key}: der Prüfer ${verifier} nennt keine Prüfung „${needle}“`).toContain(needle);
        }
    });

    it("🔴 jeder Prüfer wendet die Liste an (settleChecks/settleWith mit seiner Kennung)", () => {
        for (const [verifier, files] of Object.entries(VERIFIER_SOURCES)) {
            const text = files.map(source).join("\n");
            expect(text, `${verifier} wendet BLOCKING_CHECKS nicht an`).toMatch(
                new RegExp(`settle(Checks|With)\\(\\s*"${verifier}"`),
            );
        }
    });

    it("🔴 die Quellenprüfungen stehen im Code, wo die Liste sie nennt (Kommentar mit Schlüssel)", () => {
        const where: Record<string, string> = {
            A12: "migration/places.ts",
            A13: "migration/map-features.ts",
            A14: "migration/paths.ts",
            A15: "migration/regions.ts",
            A16: "migration/terrain.ts",
            A17: "migration/territories.ts",
            A21: "migration/landscape-display.ts",
            A24: "migration/uploads-list.ts",
        };
        for (const [key, file] of Object.entries(where)) {
            expect(source(file), `${file} nennt BLOCKING_SOURCE_CHECKS ${key} nicht`).toContain(
                `BLOCKING_SOURCE_CHECKS ${key}`,
            );
        }
    });
});

describe("Inventur und Listen sagen dasselbe", () => {
    const rows = (): string[] =>
        readFileSync(INVENTORY, "utf8")
            .split("\n")
            .filter((line) => line.startsWith("|"));

    it("die Inventur nennt jeden Schlüssel der Prüferliste samt Klasse", () => {
        expect(existsSync(INVENTORY), "project-control/discovery/blockierende-pruefungen-2026-10-03.md fehlt").toBe(
            true,
        );
        for (const [key, entry] of Object.entries(BLOCKING_CHECKS)) {
            const row = rows().find((line) => line.includes(`\`${key}\``));
            expect(row, `Inventur: Zeile für ${key} fehlt`).toBeDefined();
            expect(row, `Inventur: ${key} soll ${entry.class} sein`).toContain(entry.class);
        }
    });

    it("die Inventur führt jede Quellenprüfung der Liste unter ihrer Nummer als BETREIBER", () => {
        for (const [key, entry] of Object.entries(BLOCKING_SOURCE_CHECKS)) {
            const row = rows().find((line) => line.startsWith(`| ${key} |`));
            expect(row, `Inventur: Zeile für ${key} fehlt`).toBeDefined();
            expect(row, `Inventur: ${key} soll ${entry.class} sein`).toContain(entry.class);
        }
    });

    it("🔴 die Inventur führt Klima als OHNE (Betreiber 2026-10-03, „B“), nicht mehr als BETREIBER", () => {
        const climate = rows().filter((line) => line.startsWith("| `verify:climate/*`") || line.startsWith("| A20 |"));
        expect(climate).toHaveLength(2);
        for (const row of climate) {
            expect(row).toContain("**OHNE**");
            expect(row).not.toContain("**BETREIBER**");
        }
    });

    it("die Inventur kennt keine Prüfung mit der Klasse UNKLAR mehr (die Vorlage ist entschieden)", () => {
        const unklar = rows().filter((line) => /\|\s*\*\*UNKLAR\*\*\s*\|/.test(line));
        expect(unklar).toEqual([]);
    });
});
