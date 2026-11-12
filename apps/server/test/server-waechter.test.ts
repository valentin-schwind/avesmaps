import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    dateisystemZugriff,
    erzeugeAenderungswaechter,
    istBeobachtet,
    type Aenderung,
    type BaumZugriff,
} from "../../../scripts/dev/server-waechter-kern.ts";

/**
 * Der Wächter für den lokalen Fastify (`scripts/dev/server-waechter-kern.ts`). Anlass: `node --watch` startete den Server unter Windows
 * über tausendmal am Tag neu, weil schon das LESEN einer Datei ein `change` meldet (Zugriffszeiten sind auf dem Rechner eingeschaltet).
 * Geprüft wird die reine Entscheidung gegen einen Baum im Speicher, ohne `fs.watch` und ohne Server.
 */

/** Ein Baum im Speicher; `lies` zählt die Inhaltsprüfungen (die teuren), `statistiken` die `stat`-Aufrufe. */
class Speicherbaum implements BaumZugriff {
    readonly dateien_ = new Map<string, { inhalt: string; mtimeMs: number }>();
    hashLesungen = 0;
    nunMs = 1_000;

    schreibe(pfad: string, inhalt: string): void {
        this.nunMs += 10;
        this.dateien_.set(pfad, { inhalt, mtimeMs: this.nunMs });
    }

    /** `touch`: neue Zeit, gleicher Inhalt. */
    beruehre(pfad: string): void {
        const datei = this.dateien_.get(pfad);
        if (datei === undefined) throw new Error(`fehlt: ${pfad}`);
        this.nunMs += 10;
        this.dateien_.set(pfad, { inhalt: datei.inhalt, mtimeMs: this.nunMs });
    }

    loesche(pfad: string): void {
        this.dateien_.delete(pfad);
    }

    dateien(): readonly string[] {
        return [...this.dateien_.keys()].filter(istBeobachtet);
    }

    merkmal(pfad: string) {
        const datei = this.dateien_.get(pfad);
        return datei === undefined ? undefined : { mtimeMs: datei.mtimeMs, size: datei.inhalt.length };
    }

    hash(pfad: string): string | undefined {
        this.hashLesungen++;
        const datei = this.dateien_.get(pfad);
        return datei === undefined ? undefined : createHash("sha1").update(datei.inhalt).digest("hex");
    }
}

const A = "/repo/apps/server/src/app.ts";
const B = "/repo/apps/server/src/routes/health.ts";
const C = "/repo/packages/shared/src/index.ts";
const ENTPRELLEN = 300;

function aufbau() {
    const baum = new Speicherbaum();
    baum.schreibe(A, "const a = 1;");
    baum.schreibe(B, "export const health = 1;");
    baum.schreibe(C, "export * from './x';");
    const neustarts: Aenderung[][] = [];
    const waechter = erzeugeAenderungswaechter({
        zugriff: baum,
        entprellenMs: ENTPRELLEN,
        beiNeustart: (aenderungen) => neustarts.push([...aenderungen]),
        beiFehler: (fehler) => {
            throw fehler;
        },
    });
    waechter.aufnehmen();
    return { baum, neustarts, waechter };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("Wächter des lokalen Servers: Ereignis ist noch keine Änderung", () => {
    it("🔴 viele Zugriffsereignisse ohne Änderung starten nichts neu (der Sturm von 2026-10-29)", () => {
        const { baum, neustarts, waechter } = aufbau();
        for (let i = 0; i < 50; i++) {
            waechter.ereignis(A);
            waechter.ereignis(B);
            waechter.ereignis(C);
            vi.advanceTimersByTime(100);
        }
        vi.advanceTimersByTime(ENTPRELLEN * 3);
        expect(neustarts).toEqual([]);
        // Nur zur Probe der Kosten: ein Zugriff kostet kein Lesen der Datei, nur das Aufnehmen am Anfang (drei Dateien).
        expect(baum.hashLesungen).toBe(3);
    });

    it("🔴 ein Ereignis ohne Namen (Überlauf des Puffers) vergleicht alles und startet bei unverändertem Baum nichts neu", () => {
        const { neustarts, waechter } = aufbau();
        waechter.ereignis(null);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([]);
    });

    it("berühren ohne Änderung des Inhalts (touch, Git schreibt dieselben Bytes) startet nichts neu und führt den Stand nach", () => {
        const { baum, neustarts, waechter } = aufbau();
        baum.beruehre(A);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([]);
        // Der Stand ist nachgeführt: ein weiteres Ereignis kostet kein erneutes Lesen.
        const gelesen = baum.hashLesungen;
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(baum.hashLesungen).toBe(gelesen);
        expect(neustarts).toEqual([]);
    });

    it("Zwischendateien der Editoren und .git lösen nichts aus, auch wenn sie entstehen", () => {
        const { baum, neustarts, waechter } = aufbau();
        for (const pfad of [
            "/repo/apps/server/src/app.ts~",
            "/repo/apps/server/src/.app.ts.swp",
            "/repo/apps/server/src/app.ts.tmp",
            "/repo/apps/server/src/.#app.ts",
            "/repo/apps/server/src/node_modules/x/index.js",
            "/repo/packages/shared/src/.git/index",
        ]) {
            baum.schreibe(pfad, "x");
            waechter.ereignis(pfad);
        }
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([]);
    });
});

describe("Wächter des lokalen Servers: echte Änderung", () => {
    it("🔴 eine Änderung des Inhalts startet genau einmal neu, erst nach dem Entprellen", () => {
        const { baum, neustarts, waechter } = aufbau();
        baum.schreibe(A, "const a = 2;");
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN - 1);
        expect(neustarts).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(neustarts).toEqual([[{ pfad: A, art: "geaendert" }]]);
        // Weitere Ereignisse zur selben Datei ändern nichts mehr: der Stand ist nachgeführt.
        waechter.ereignis(A);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN * 3);
        expect(neustarts).toHaveLength(1);
    });

    it("eine Welle aus mehreren Dateien und Ereignissen ergibt einen Neustart, der alle nennt", () => {
        const { baum, neustarts, waechter } = aufbau();
        baum.schreibe(A, "const a = 2;");
        waechter.ereignis(A);
        vi.advanceTimersByTime(200); // noch innerhalb der Stille: das nächste Ereignis verlängert sie
        baum.schreibe(C, "export * from './y';");
        waechter.ereignis(C);
        waechter.ereignis(B); // nur Zugriff
        vi.advanceTimersByTime(200);
        expect(neustarts).toEqual([]);
        vi.advanceTimersByTime(100);
        expect(neustarts).toHaveLength(1);
        expect(neustarts[0]).toEqual(
            expect.arrayContaining([
                { pfad: A, art: "geaendert" },
                { pfad: C, art: "geaendert" },
            ]),
        );
        expect(neustarts[0]).toHaveLength(2);
    });

    it("eine neue Datei und eine gelöschte Datei starten neu", () => {
        const { baum, neustarts, waechter } = aufbau();
        const neu = "/repo/apps/server/src/neu.ts";
        baum.schreibe(neu, "export {};");
        waechter.ereignis(neu);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([[{ pfad: neu, art: "neu" }]]);

        baum.loesche(B);
        waechter.ereignis(B);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toHaveLength(2);
        expect(neustarts[1]).toEqual([{ pfad: B, art: "weg" }]);
    });

    it("ein Ereignis auf ein Verzeichnis (umbenannt, gelöscht) findet Neues und Fehlendes darin", () => {
        const { baum, neustarts, waechter } = aufbau();
        // `routes/` wird zu `strecken/` umbenannt: Windows meldet beide Verzeichnisse, die Dateien darin nicht einzeln.
        baum.loesche(B);
        const verschoben = "/repo/apps/server/src/strecken/health.ts";
        baum.schreibe(verschoben, "export const health = 1;");
        waechter.ereignis("/repo/apps/server/src/routes");
        waechter.ereignis("/repo/apps/server/src/strecken");
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toHaveLength(1);
        expect(neustarts[0]).toEqual(
            expect.arrayContaining([
                { pfad: B, art: "weg" },
                { pfad: verschoben, art: "neu" },
            ]),
        );
    });

    it("ein Ereignis auf ein unverändertes Verzeichnis (Zugriff) startet nichts neu", () => {
        const { neustarts, waechter } = aufbau();
        waechter.ereignis("/repo/apps/server/src");
        waechter.ereignis("/repo/apps/server/src/routes");
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([]);
    });

    it("zurück auf den alten Inhalt ist wieder eine Änderung (der Stand ist der des laufenden Servers, nicht der der ersten Aufnahme)", () => {
        const { baum, neustarts, waechter } = aufbau();
        baum.schreibe(A, "const a = 2;");
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        baum.schreibe(A, "const a = 1;");
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toHaveLength(2);
    });
});

describe("Wächter des lokalen Servers: Server steht nach einem Fehlstart", () => {
    it("🔴 berühren genügt dann (der Weg zurück nach einem Pull, der den Start scheitern ließ)", () => {
        const { baum, neustarts, waechter } = aufbau();
        waechter.setzeLaeuft(false);
        baum.beruehre(A);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([[{ pfad: A, art: "beruehrt" }]]);
    });

    it("ein bloßer Zugriff genügt auch dann nicht", () => {
        const { neustarts, waechter } = aufbau();
        waechter.setzeLaeuft(false);
        waechter.ereignis(A);
        waechter.ereignis(null);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toEqual([]);
    });

    it("nach dem Neustart gilt der Server wieder als laufend: Berühren löst dann nichts mehr aus", () => {
        const { baum, neustarts, waechter } = aufbau();
        waechter.setzeLaeuft(false);
        baum.beruehre(A);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toHaveLength(1);
        baum.beruehre(A);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN);
        expect(neustarts).toHaveLength(1);
    });
});

describe("Wächter des lokalen Servers: Schließen", () => {
    it("nach dem Schließen kommt kein Neustart mehr", () => {
        const { baum, neustarts, waechter } = aufbau();
        baum.schreibe(A, "const a = 2;");
        waechter.ereignis(A);
        waechter.schliessen();
        vi.advanceTimersByTime(ENTPRELLEN * 3);
        waechter.ereignis(A);
        vi.advanceTimersByTime(ENTPRELLEN * 3);
        expect(neustarts).toEqual([]);
    });
});

describe("istBeobachtet", () => {
    it.each([
        ["/repo/apps/server/src/app.ts", true],
        ["C:\\repo\\apps\\server\\src\\db\\migrations\\0001.sql", true],
        ["/repo/apps/server/src/node_modules/x.js", false],
        ["C:\\repo\\packages\\shared\\src\\.git\\HEAD", false],
        ["/repo/apps/server/src/app.ts~", false],
        ["/repo/apps/server/src/.app.ts.swp", false],
        ["/repo/apps/server/src/app.ts.TMP", false],
        ["/repo/apps/server/src/.#app.ts", false],
    ])("%s -> %s", (pfad, erwartet) => {
        expect(istBeobachtet(pfad)).toBe(erwartet);
    });
});

describe("dateisystemZugriff (echte Platte)", () => {
    let wurzel: string;
    beforeEach(() => {
        vi.useRealTimers();
        wurzel = mkdtempSync(join(tmpdir(), "waechter-"));
    });
    afterEach(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    it("listet Dateien ohne Zwischendateien und node_modules; Zeit, Größe und Hash unterscheiden Berühren von Ändern", () => {
        mkdirSync(join(wurzel, "unter"), { recursive: true });
        mkdirSync(join(wurzel, "node_modules", "x"), { recursive: true });
        const a = join(wurzel, "a.ts");
        const b = join(wurzel, "unter", "b.ts");
        writeFileSync(a, "eins");
        writeFileSync(b, "zwei");
        writeFileSync(join(wurzel, "a.ts~"), "weg");
        writeFileSync(join(wurzel, "node_modules", "x", "i.js"), "weg");

        const zugriff = dateisystemZugriff([wurzel]);
        expect([...zugriff.dateien()].sort()).toEqual([a, b].sort());
        expect(zugriff.merkmal(join(wurzel, "unter"))).toBeUndefined(); // Verzeichnis
        expect(zugriff.merkmal(join(wurzel, "gibt-es-nicht"))).toBeUndefined();
        expect(zugriff.hash(join(wurzel, "gibt-es-nicht"))).toBeUndefined();

        // touch: Zeit anders, Inhalt gleich; ändern: Größe anders
        const vorher = zugriff.merkmal(a);
        const spaeter = new Date(Date.now() + 60_000);
        utimesSync(a, spaeter, spaeter);
        expect(zugriff.merkmal(a)?.mtimeMs).not.toBe(vorher?.mtimeMs);
        expect(zugriff.merkmal(a)?.size).toBe(vorher?.size);
        expect(zugriff.hash(a)).toBe(createHash("sha1").update("eins").digest("hex"));
        writeFileSync(a, "eins und mehr");
        expect(zugriff.merkmal(a)?.size).toBe("eins und mehr".length);
        expect(zugriff.hash(a)).not.toBe(createHash("sha1").update("eins").digest("hex"));
    });
});
