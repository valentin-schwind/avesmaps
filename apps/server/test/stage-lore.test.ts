import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
    ROUTE_STAGE_LORE_LIMITS,
    ROUTE_STAGE_LORE_URL,
    ROUTE_UNTERWEGS_LIMITS,
    ROUTE_UNTERWEGS_URL,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die HÜLLE des Endpunkts `POST /api/route/stage/lore` (WI-0106): Schranken, Kopfzeilen und die Drossel.
 *
 * 🔴 **Die Rechnung selbst prüft `lore-panel.test.ts`** gegen echte Daten (die Etappe über einen Weg antwortet Zeichen für
 * Zeichen wie der Weg; zwei Wege erben die Vereinigung; ohne Weg bleibt die Linkzeile). Hier wird nur geprüft, was der
 * Endpunkt selbst verantwortet - sonst stünden zwei Dateien über dieselbe Aussage.
 *
 * 🪤 Darum kommt diese Datei ohne die Lore-Fixture aus: Sie braucht eine Datenbank, damit `app.subjects` existiert, aber
 * keinen bestimmten Bestand. Die Zusicherungen gelten für jede Datenbank.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const uuid = (n: number): string => `11111111-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describeWithDatabase("Der Endpunkt der Etappen-Vorkommen", () => {
    let app: FastifyInstance | undefined;

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    type Answer = Awaited<ReturnType<FastifyInstance["inject"]>>;

    /** Eine App mit eigener Verbindung; `buildApp` schließt sie im `onClose`. */
    const start = async (max: number): Promise<(payload: unknown) => Promise<Answer>> => {
        const database = createDatabase(testDatabaseUrl as string, { max });
        await migrate(database);
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database,
        });
        return (payload: unknown) =>
            (app as FastifyInstance).inject({ method: "POST", url: ROUTE_STAGE_LORE_URL, payload: payload as object });
    };

    it("🔴 antwortet mit Revision und Zeilen, und die Antwort liegt in keinem Cache", async () => {
        const post = await start(2);
        const ok = await post({ paths: [] });
        expect(ok.statusCode).toBe(200);
        expect(ok.headers["cache-control"]).toBe("no-store");
        const body = ok.json<{ revision: string; rows: unknown[] }>();
        expect(body.revision).toMatch(/^[0-9a-f]{12}$/);
        expect(Array.isArray(body.rows)).toBe(true);
        // 🪤 Ein Weg, den es nicht gibt, ist kein Fehler: Er trägt nur keine Geometrie bei (dieselbe Antwort wie ohne Weg).
        expect((await post({ paths: [uuid(1)] })).json()).toEqual(body);
    });

    it("🔴 die Schranken stehen im Schema, nicht im Handler", async () => {
        const post = await start(2);
        // Keine Kennung, eine Großschreibung, ein fremdes Feld, zu viele Wege: alles 400, bevor etwas gerechnet wird.
        expect((await post({ paths: ["kein-uuid"] })).statusCode).toBe(400);
        // 🪤 Eine Kennung mit Buchstaben, groß geschrieben: `uuid(1)` besteht nur aus Ziffern, `toUpperCase` ändert daran
        // nichts - der Fall hätte stumm bestanden und nichts belegt.
        expect((await post({ paths: ["AAAAAAAA-0000-4000-8000-00000000000B"] })).statusCode).toBe(400);
        expect((await post({})).statusCode).toBe(400);
        // 🪤 Ein FREMDES Feld ist kein 400: Fastifys Ajv läuft mit `removeAdditional`, es wird stillschweigend entfernt.
        // Das ist die Hauseinstellung und gilt für jeden Endpunkt - hier nur festgehalten, damit niemand es für eine
        // Lücke dieses Vertrags hält.
        expect((await post({ paths: [], stages: [] })).statusCode).toBe(200);
        const zuViele = Array.from({ length: ROUTE_STAGE_LORE_LIMITS.paths + 1 }, (_item, at) => uuid(at + 1));
        expect((await post({ paths: zuViele })).statusCode).toBe(400);
        // Genau am Deckel geht es noch.
        expect((await post({ paths: zuViele.slice(0, -1) })).statusCode).toBe(200);
    });

    it("🔴 die Linien der Abschnitte ohne Weg (WI-0257 S2) haben ihre Schranken ebenfalls im Schema", async () => {
        const post = await start(2);
        // Eine Linie braucht mindestens zwei Punkte, Koordinaten liegen in der Karte, die Zahl der Linien und Punkte ist gedeckelt.
        expect((await post({ paths: [], lines: [[1, 2, 3]] })).statusCode).toBe(400);
        expect((await post({ paths: [], lines: [[1, 2, 3, -4]] })).statusCode).toBe(400);
        expect((await post({ paths: [], lines: [[1, 2, 3, "x"]] })).statusCode).toBe(400);
        const zuVieleLinien = Array.from({ length: ROUTE_STAGE_LORE_LIMITS.lines + 1 }, () => [1, 2, 3, 4]);
        expect((await post({ paths: [], lines: zuVieleLinien })).statusCode).toBe(400);
        const zuLang = [Array.from({ length: ROUTE_STAGE_LORE_LIMITS.vertices * 2 + 2 }, () => 5)];
        expect((await post({ paths: [], lines: zuLang })).statusCode).toBe(400);
        // Gültig, auch am Deckel: eine Etappe ganz ohne Weg, nur mit Linien.
        expect((await post({ paths: [], lines: [[1, 2, 3, 4]] })).statusCode).toBe(200);
        expect((await post({ paths: [], lines: zuVieleLinien.slice(0, -1) })).statusCode).toBe(200);
    });

    it("🔴 ein zu großer Körper bleibt ein 413 und wird kein 500", async () => {
        const post = await start(2);
        // Fastify weist ihn ab, bevor er gelesen ist; nur mit seiner eigenen Fehlerform im Schema bleibt es ein 413.
        const riesig = await post({ paths: [uuid(1)], füllung: "x".repeat(ROUTE_STAGE_LORE_LIMITS.bodyBytes) });
        expect(riesig.statusCode).toBe(413);
        expect(riesig.headers["cache-control"]).toBe("no-store");
    });

    it("🔴 höchstens zwei Abfragen zugleich; die dritte wartet nicht, sie bekommt 503 busy", async () => {
        const post = await start(4);
        const antworten = await Promise.all([1, 2, 3].map(() => post({ paths: [] })));
        expect(antworten.map((antwort) => antwort.statusCode).sort()).toEqual([200, 200, 503]);
        const besetzt = antworten.find((antwort) => antwort.statusCode === 503);
        expect(besetzt?.json()).toEqual({ error: "busy" });
        expect(besetzt?.headers["retry-after"]).toBe("1");
        // Danach ist wieder Platz.
        expect((await post({ paths: [] })).statusCode).toBe(200);
    });

    it("🔴 Unterwegs (S4): die ganze Route in einem Körper, Schranken im Schema, kein Cache", async () => {
        await start(2);
        const route = (payload: unknown): Promise<Answer> =>
            (app as FastifyInstance).inject({ method: "POST", url: ROUTE_UNTERWEGS_URL, payload: payload as object });
        const ok = await route({ stages: [{ paths: [] }, { paths: [uuid(1)], lines: [[1, 2, 3, 4]] }] });
        expect(ok.statusCode).toBe(200);
        expect(ok.headers["cache-control"]).toBe("no-store");
        const body = ok.json<{ revision: string; eintraege: unknown[] }>();
        expect(body.revision).toMatch(/^[0-9a-f]{12}$/);
        expect(Array.isArray(body.eintraege)).toBe(true);
        // Keine Etappe, keine Kennung, zu viele Etappen, zu viele Wege in einer Etappe: alles 400, bevor etwas gerechnet wird.
        expect((await route({})).statusCode).toBe(400);
        expect((await route({ stages: [] })).statusCode).toBe(400);
        expect((await route({ stages: [{ paths: ["kein-uuid"] }] })).statusCode).toBe(400);
        const zuViele = Array.from({ length: ROUTE_UNTERWEGS_LIMITS.stages + 1 }, () => ({ paths: [] }));
        expect((await route({ stages: zuViele })).statusCode).toBe(400);
        const zuvieleWege = Array.from({ length: ROUTE_STAGE_LORE_LIMITS.paths + 1 }, (_item, at) => uuid(at + 1));
        expect((await route({ stages: [{ paths: zuvieleWege }] })).statusCode).toBe(400);
        // Ein zu großer Körper bleibt ein 413.
        const riesig = await route({ stages: [{ paths: [] }], füllung: "x".repeat(ROUTE_UNTERWEGS_LIMITS.bodyBytes) });
        expect(riesig.statusCode).toBe(413);
    });

    it("🔴 Unterwegs teilt die Zweierschranke mit der Etappe: die dritte Abfrage bekommt 503 busy", async () => {
        const post = await start(4);
        const route = (): Promise<Answer> =>
            (app as FastifyInstance).inject({
                method: "POST",
                url: ROUTE_UNTERWEGS_URL,
                payload: { stages: [{ paths: [] }] },
            });
        const antworten = await Promise.all([post({ paths: [] }), route(), route()]);
        expect(antworten.map((antwort) => antwort.statusCode).sort()).toEqual([200, 200, 503]);
        expect(antworten.find((antwort) => antwort.statusCode === 503)?.json()).toEqual({ error: "busy" });
    });

    it("🪤 ohne Datenbank sagt er das, statt abzustürzen", async () => {
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
        });
        const answer = await app.inject({ method: "POST", url: ROUTE_STAGE_LORE_URL, payload: { paths: [] } });
        expect(answer.statusCode).toBe(503);
        expect(answer.json()).toEqual({ error: "database_unavailable" });
    });
});
