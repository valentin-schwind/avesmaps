import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { DERIVE_LOCK_CLASS, DeriveBusyError, withZugSperre } from "../src/derive/derive-lock.ts";
import { EDITOR_TABELLEN, PIPELINE_STEPS } from "../src/migration/pipeline-steps.ts";
import { importStaetten } from "../src/migration/staetten-import.ts";

/**
 * Der Zug gegen das Speichern (EDIT-0003 T17, EDIT-0004 §1.3 Nr. 3; Zuteilung der Koordination 2026-10-15). Das Speichern im Editor
 * nimmt die Sperre der Kartendomäne geteilt und weist mit 503 `map_import_running` ab, wenn sie exklusiv belegt ist
 * (`editor/map-operation.ts`). Bis hierher nahm der Zug sie beim Schreiben von Orten, Wegen und Landschaften gar nicht: Ein Speichern
 * konnte zwischen seine Zeilen fallen.
 *
 * Problemfälle: Der Zug schreibt, während ein Speichern noch läuft; ein Speichern kommt durch, während der Zug schreibt; der Zug wartet
 * still ewig auf eine Sperre; ein Zugschritt, der eine Tafel der Editoren schreibt, nimmt die Sperre nicht; ein Schritt, der die Sperre
 * selbst nimmt (Gelände), steht in der Liste und sperrt sich gegen sich selbst. Gegen echtes PostgreSQL, weil die Sperre dort lebt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Ein Speichern, das gerade läuft: hält die geteilte Sperre in einer offenen Transaktion, bis `fertig()` gerufen wird. */
function speichernLaeuft(
    database: Database,
    domain: string,
): { gehalten: Promise<void>; fertig: () => void; ende: Promise<void> } {
    let fertig: () => void = () => undefined;
    const warten = new Promise<void>((resolve) => {
        fertig = resolve;
    });
    let gestartet: () => void = () => undefined;
    const gehalten = new Promise<void>((resolve) => {
        gestartet = resolve;
    });
    const ende = database
        .begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domain}))`;
            gestartet();
            await warten;
        })
        .then(() => undefined);
    return { gehalten, fertig, ende };
}

/** Was das Speichern im Editor fragt (`map-operation.ts`, `serialize`): Bekommt es die geteilte Sperre? */
async function speichernDarf(database: Database, domain: string): Promise<boolean> {
    return database.begin(async (tx) => {
        const [row] = await tx<{ ok: boolean }[]>`
            SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domain})) AS ok
        `;
        return row?.ok === true;
    });
}

describeWithDatabase("Der Zug hält die Sperre der Domäne, solange er schreibt (T17)", { timeout: 60_000 }, () => {
    let database: Database;

    beforeAll(() => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 ein laufendes Speichern lässt den Zug warten; er schreibt erst danach und sagt es im Log", async () => {
        const reihenfolge: string[] = [];
        const log: string[] = [];
        const speichern = speichernLaeuft(database, "test-zug-a");
        await speichern.gehalten;

        const zug = withZugSperre(
            database,
            "test-zug-a",
            "I1 Orte",
            async () => {
                reihenfolge.push("zug schreibt");
            },
            { log: (zeile) => log.push(zeile) },
        );
        await pause(400);
        expect(reihenfolge).toEqual([]);
        expect(log.join("\n")).toMatch(/BEFUND zug_sperre_wartet: I1 Orte/u);

        reihenfolge.push("speichern fertig");
        speichern.fertig();
        await speichern.ende;
        await zug;
        expect(reihenfolge).toEqual(["speichern fertig", "zug schreibt"]);
    });

    it("🔴 solange der Zug schreibt, bekommt ein Speichern die Sperre nicht (503 map_import_running); danach wieder", async () => {
        let waehrend: boolean | undefined;
        await withZugSperre(database, "test-zug-b", "I2 Regionen", async () => {
            waehrend = await speichernDarf(database, "test-zug-b");
        });
        expect(waehrend).toBe(false);
        expect(await speichernDarf(database, "test-zug-b")).toBe(true);
    });

    it("🔴 die Wartezeit hat eine Obergrenze: Befund im Log, Abbruch, nichts geschrieben", async () => {
        const log: string[] = [];
        let geschrieben = false;
        const speichern = speichernLaeuft(database, "test-zug-c");
        await speichern.gehalten;
        try {
            await expect(
                withZugSperre(
                    database,
                    "test-zug-c",
                    "I5 Wege",
                    async () => {
                        geschrieben = true;
                    },
                    { maxWartenMs: 500, log: (zeile) => log.push(zeile) },
                ),
            ).rejects.toBeInstanceOf(DeriveBusyError);
        } finally {
            speichern.fertig();
            await speichern.ende;
        }
        expect(geschrieben).toBe(false);
        expect(log.join("\n")).toMatch(/BEFUND zug_sperre_belegt: I5 Wege/u);
        // Danach ist nichts liegen geblieben: Der nächste Schritt bekommt die Sperre sofort.
        await withZugSperre(database, "test-zug-c", "I5 Wege", async () => {
            geschrieben = true;
        });
        expect(geschrieben).toBe(true);
    });

    it("🔴 ein echter Zugschritt nimmt sie: importStaetten wartet, bis ein Speichern fertig ist", async () => {
        const speichern = speichernLaeuft(database, "aventuria");
        await speichern.gehalten;
        let fertig = false;
        const schritt = importStaetten(database, null, { dryRun: true }).then(() => {
            fertig = true;
        });
        await pause(400);
        expect(fertig).toBe(false);
        speichern.fertig();
        await speichern.ende;
        await schritt;
        expect(fertig).toBe(true);
    });
});

/** Welcher Zugschritt in welcher Funktion schreibt; ihre Datei muss die Sperre nehmen. */
const SCHRITT_FUNKTION: Record<string, { datei: string; funktion: string }> = {
    I1: { datei: "../src/migration/places.ts", funktion: "importPlaces" },
    I2: { datei: "../src/migration/region-import.ts", funktion: "importRegions" },
    I5: { datei: "../src/migration/paths.ts", funktion: "importPaths" },
    I6: { datei: "../src/derive/path-visual.ts", funktion: "derivePathVisuals" },
    I8: { datei: "../src/migration/powerlines.ts", funktion: "importPowerlines" },
    // Die Gelände-Eingaben, seit der Landschafts-Editor Gebirgswerte und Gipfel schreibt (WI-0178; Befund Topographie 2026-10-20).
    I10: { datei: "../src/migration/terrain.ts", funktion: "importTerrain" },
    I14: { datei: "../src/migration/territory-import.ts", funktion: "importTerritories" },
    I17: { datei: "../src/migration/subject-details-import.ts", funktion: "importSubjectDetails" },
    I21: { datei: "../src/migration/citymaps-import.ts", funktion: "importCitymaps" },
    // Die Gebietsdetails, seit der Gebietseditor sie schreibt (WI-0209 G6).
    I23: { datei: "../src/migration/territory-details-import.ts", funktion: "importTerritoryDetails" },
    I24: { datei: "../src/migration/wiki-link-targets-import.ts", funktion: "importWikiLinkTargets" },
    I27: { datei: "../src/migration/staetten-import.ts", funktion: "importStaetten" },
};

describe("Welche Zugschritte die Sperre nehmen (T17)", () => {
    const sperrend = PIPELINE_STEPS.filter((schritt) =>
        schritt.writes.some((tafel) => EDITOR_TABELLEN.includes(tafel)),
    );

    it("🔴 genau die Schritte, die eine Tafel der Editoren schreiben, stehen in der Liste", () => {
        expect(sperrend.map((schritt) => schritt.id).sort()).toEqual(Object.keys(SCHRITT_FUNKTION).sort());
    });

    // I10 (Gelände-Eingaben) gehört dazu: Der Import nimmt keine Sperre selbst, erst die Ableitung ab I11 (`withDeriveLock`).
    it("🔴 keiner davon nimmt die Sperre schon selbst (die Ableitung des Geländes): sonst sperrte er sich gegen sich selbst", () => {
        for (const id of ["I11", "I12", "I13"]) {
            expect(sperrend.map((schritt) => schritt.id)).not.toContain(id);
        }
    });

    it("🔴 jede dieser Funktionen nimmt die Sperre (withZugSperre), so gilt sie für legacy:update und für die einzelnen CLIs", () => {
        for (const [id, { datei, funktion }] of Object.entries(SCHRITT_FUNKTION)) {
            const text = readFileSync(new URL(datei, import.meta.url), "utf8");
            // `async` ist erlaubt: `importPowerlines` liest seit WI-0253 D-1 zuerst, ob die Kraftlinien dem WikiSync gehören (der Zug lässt sie dann aus,
            // dieser Weg schreibt nichts); jeder Weg, der schreibt, läuft weiter unter `withZugSperre`, und das prüft der Körper unten.
            const start = text.search(new RegExp(`export (?:async )?function ${funktion}\\(`));
            expect(start, `${id}: ${funktion} ist kein exportierter Eingang`).toBeGreaterThanOrEqual(0);
            const koerper = text.slice(start, start + 1_200);
            expect(koerper, `${id}: ${funktion} nimmt die Sperre nicht`).toContain("withZugSperre(");
        }
    });
});
