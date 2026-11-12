import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../src/database.ts";
import { InhaltsschalterStore, inhaltsstandFuer } from "../src/system/inhaltsstand.ts";

/**
 * Der Rückfall der Inhaltsschalter bei einem Lesefehler (`unknown`, die Bilder gelten als aus) bleibt, aber nicht stumm (WI-0278):
 * 2026-11-03 scheiterte das Lesen in der Jobs-Rolle mit 42501, und der leere `catch` ließ den Fehler spurlos verschwinden, bis Vali
 * den ersten Beitrag mit Bild sendete. Ohne Datenbank: Die Verbindung ist eine Attrappe, die wirft oder leer antwortet.
 * Die Rechte der Jobs-Rolle selbst prüft `inhaltsstand-jobs-rolle.test.ts` (Wegwerf-Cluster).
 */

let ausfall: Error | undefined;
/** Eine Verbindung, die jede Frage mit dem Fehler beantwortet, solange `ausfall` gesetzt ist, sonst mit keiner Zeile. */
function attrappe(): Queryable {
    return (async () => {
        if (ausfall !== undefined) throw ausfall;
        return [];
    }) as unknown as Queryable;
}
const fehler = (code: string, text: string): Error => Object.assign(new Error(text), { code });

afterEach(() => {
    ausfall = undefined;
    vi.restoreAllMocks();
});

describe("Inhaltsschalter: ein Lesefehler steht im Protokoll", () => {
    it("🔴 ohne Store: derselbe Fehler steht einmal auf stderr, der Rückfall bleibt `unknown`; nach einem gelungenen Lesen wieder", async () => {
        const zeilen: string[] = [];
        vi.spyOn(process.stderr, "write").mockImplementation((text: string | Uint8Array) => {
            zeilen.push(String(text));
            return true;
        });
        const db = attrappe();

        ausfall = fehler("42501", "permission denied for table person");
        expect((await inhaltsstandFuer(db)).source).toBe("unknown");
        expect((await inhaltsstandFuer(db)).source).toBe("unknown");
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]).toContain("42501: permission denied for table person");
        expect(zeilen[0]).toContain("gelten als aus");

        // Ein anderer Fehler wird gemeldet.
        ausfall = fehler("08006", "connection terminated");
        expect((await inhaltsstandFuer(db)).source).toBe("unknown");
        expect(zeilen).toHaveLength(2);
        expect(zeilen[1]).toContain("08006: connection terminated");

        // Gelingt das Lesen, ist der Stand da, und derselbe Fehler später steht wieder im Protokoll.
        ausfall = undefined;
        expect((await inhaltsstandFuer(db)).source).toBe("database");
        ausfall = fehler("08006", "connection terminated");
        expect((await inhaltsstandFuer(db)).source).toBe("unknown");
        expect(zeilen).toHaveLength(3);
    });

    it("🔴 im Store: dieselbe Meldung geht einmal an `warn`; scheitert das Lesen nach einem Stand, gilt der letzte", async () => {
        const meldungen: string[] = [];
        const store = new InhaltsschalterStore({
            database: attrappe(),
            revision: () => 1,
            warn: (text) => meldungen.push(text),
        });

        // Nie gelesen: `unknown`, einmal gemeldet.
        ausfall = fehler("42501", "permission denied for table person");
        expect((await store.read()).source).toBe("unknown");
        expect((await store.read()).source).toBe("unknown");
        expect(meldungen).toHaveLength(1);
        expect(meldungen[0]).toContain("42501: permission denied for table person");
        expect(meldungen[0]).toContain("gelten als aus");

        // Gelungen: ein Stand ist da. Scheitert das Lesen danach wieder, gilt dieser Stand (die Tafel trägt keine Revision, also liest jedes
        // `read()` neu), und die Meldung sagt es.
        ausfall = undefined;
        expect((await store.read()).source).toBe("database");
        ausfall = fehler("42501", "permission denied for table person");
        expect((await store.read()).source).toBe("database");
        expect(meldungen).toHaveLength(2);
        expect(meldungen[1]).toContain("es gilt der letzte gelesene Stand");
    });
});
