import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { DeriveBusyError, withDeriveLock } from "../src/derive/derive-lock.ts";
import { deriveTerrain } from "../src/terrain/derive.ts";
import { deriveDisplayHeights } from "../src/terrain/display-height/derive.ts";
import { deriveDomainTerrain } from "../src/terrain/domain/derive.ts";

/**
 * Eine Ableitung des Geländes zur Zeit (Koordination 2026-09-29: zwei `derive:terrain` gleichzeitig mit dem
 * Live-Zug räumten einander Raster weg). Die Sperre lebt in PostgreSQL, deshalb gegen die echte Testdatenbank
 * und mit eigenen Kartendomänen, damit parallele Läufe `aventuria` nicht sperren. Keine Domäne hier hat Daten:
 * Wer die Sperre nicht bekommt, bricht ab, bevor er etwas liest oder schreibt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Hält die Sperre einer Domäne, bis `freigeben()` gerufen wird. */
function halten(
    database: Database,
    domain: string,
): { gehalten: Promise<void>; freigeben: () => void; fertig: Promise<void> } {
    let freigeben: () => void = () => undefined;
    const warten = new Promise<void>((resolve) => {
        freigeben = resolve;
    });
    let gestartet: () => void = () => undefined;
    const gehalten = new Promise<void>((resolve) => {
        gestartet = resolve;
    });
    const fertig = withDeriveLock(database, domain, "Test", async () => {
        gestartet();
        await warten;
    });
    return { gehalten, freigeben, fertig };
}

describeWithDatabase("Sperre der Geländeableitungen", () => {
    let database: Database;

    beforeAll(() => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 eine zweite Ableitung derselben Domäne bricht sofort ab, ohne zu rechnen; danach ist die Sperre frei", async () => {
        const erste = halten(database, "test-lock-a");
        await erste.gehalten;
        let zweiteRechnete = false;
        await expect(
            withDeriveLock(database, "test-lock-a", "derive:visual-relief", async () => {
                zweiteRechnete = true;
            }),
        ).rejects.toBeInstanceOf(DeriveBusyError);
        expect(zweiteRechnete).toBe(false);
        erste.freigeben();
        await erste.fertig;
        await expect(withDeriveLock(database, "test-lock-a", "Test", async () => "danach")).resolves.toBe("danach");
    });

    it("die Meldung sagt, was abbrach und warum", async () => {
        const erste = halten(database, "test-lock-b");
        await erste.gehalten;
        await expect(
            withDeriveLock(database, "test-lock-b", "derive:visual-relief", async () => undefined),
        ).rejects.toThrow(/derive:visual-relief: Eine andere Ableitung des Geländes läuft gerade/);
        erste.freigeben();
        await erste.fertig;
    });

    it("🔴 wirft die Ableitung, ist die Sperre trotzdem wieder frei", async () => {
        await expect(
            withDeriveLock(database, "test-lock-c", "Test", async () => {
                throw new Error("kaputt");
            }),
        ).rejects.toThrow("kaputt");
        await expect(withDeriveLock(database, "test-lock-c", "Test", async () => 1)).resolves.toBe(1);
    });

    it("andere Kartendomänen sperren einander nicht", async () => {
        const erste = halten(database, "test-lock-d");
        await erste.gehalten;
        await expect(withDeriveLock(database, "test-lock-e", "Test", async () => "frei")).resolves.toBe("frei");
        erste.freigeben();
        await erste.fertig;
    });

    it("🔴 alle drei Ableitungen nehmen die Sperre selbst, also auch legacy:update im selben Prozess", async () => {
        const erste = halten(database, "test-lock-f");
        await erste.gehalten;
        const options = { mapDomainId: "test-lock-f", onlyCurrent: true };
        await expect(deriveTerrain(database, options)).rejects.toThrow(/^derive:terrain: .*läuft gerade/);
        await expect(deriveDomainTerrain(database, options)).rejects.toThrow(/^derive:domain-terrain: .*läuft gerade/);
        await expect(deriveDisplayHeights(database, options)).rejects.toThrow(
            /^derive:display-heights: .*läuft gerade/,
        );
        erste.freigeben();
        await erste.fertig;
    });
});
