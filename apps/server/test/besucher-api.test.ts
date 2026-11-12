import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKlasse, apiZone } from "@avesmaps3d/shared";
import { registerErrorHandler } from "../src/error-handler.ts";
import { ApiError } from "../src/http/api-error.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { leseApiZahlen } from "../src/besucher/api-lesen.ts";
import {
    grundAusAntwort,
    merkePosten,
    postenFuer,
    schreibeSchnittstellen,
    verdichteSchnittstellen,
    vergissOffene,
} from "../src/besucher/api-zaehler.ts";

/**
 * Die Nutzung der eigenen Schnittstellen (WI-0138 V12): Zonen, Klassen, der Routenname statt der Adresse, und die
 * Verdichtung nach der Aufbewahrung.
 */

describe("Zonen und Klassen", () => {
    it("ordnet auf Segmentgrenzen zu, nie auf Teilstücken", () => {
        expect(apiZone("/api/route")).toBe("offen");
        expect(apiZone("/api/route/:id")).toBe("offen");
        // 🪤 `/api/routenplaner` fängt mit `/api/route` an, ist aber ein anderer Weg.
        expect(apiZone("/api/routenplaner")).toBe("karte");
        expect(apiZone("/api/editor/places")).toBe("editor");
        expect(apiZone("/api/besuch/ping")).toBe("takt");
        expect(apiZone("/api/besuch")).toBe("offen");
        expect(apiZone("/api/search")).toBe("karte");
        expect(apiZone("/healthz")).toBe("uebrige");
    });

    it("kennt fünf Antwortklassen, und „gestorben“ ist eine davon", () => {
        expect(apiKlasse(200)).toBe("2xx");
        expect(apiKlasse(304)).toBe("3xx");
        expect(apiKlasse(404)).toBe("4xx");
        expect(apiKlasse(500)).toBe("5xx");
        expect(apiKlasse(undefined)).toBe("gestorben");
    });
});

describe("Posten einer Anfrage", () => {
    it("zählt den Routennamen, die Klasse, die Zone und die Stunde", () => {
        const posten = postenFuer("/api/share/:code", 200, 19);
        expect(posten.map((p) => `${p.metric}=${p.dimension}`)).toEqual([
            "anfrage=/api/share/:code",
            "klasse=2xx",
            "zone=offen",
            "stunde=",
        ]);
        expect(posten.find((p) => p.metric === "stunde")?.hour).toBe(19);
    });

    it("legt bei einer schlechten Antwort eine Fehlerzeile an", () => {
        const posten = postenFuer("/api/route", 500, 3);
        expect(posten.find((p) => p.metric === "fehler")?.dimension).toBe("/api/route|5xx");
    });

    it("🔴 eine Ablehnung zählt mit ihrem Grund, damit eine neue beim Speichern auffällt (Vali 2026-11-10)", () => {
        const posten = postenFuer("/api/editor/landscapes/:id", 400, 3, "nachbar_umgezeichnet");
        expect(posten.find((p) => p.metric === "fehler")?.dimension).toBe(
            "/api/editor/landscapes/:id|nachbar_umgezeichnet",
        );
        // Die Spalte fasst 190 Zeichen: Auch ein langer Weg mit Grund passt.
        expect(postenFuer(`/${"x".repeat(200)}`, 400, 3, "ring_unter_drei").at(-1)!.dimension.length).toBe(190);
    });

    it("🔴 der Grund kommt aus der Antwort: `details.reason` vor dem Code, nie ein Satz", () => {
        const antwort = (error: unknown): string => JSON.stringify({ error });
        expect(
            grundAusAntwort(
                antwort({ code: "validation_failed", message: "Ein Satz.", details: { reason: "ring_unter_drei" } }),
            ),
        ).toBe("ring_unter_drei");
        expect(grundAusAntwort(antwort({ code: "edit_conflict", message: "Ein Satz." }))).toBe("edit_conflict");
        expect(grundAusAntwort(antwort("database_unavailable"))).toBe("database_unavailable");
        expect(grundAusAntwort(antwort({ code: "x", details: { reason: "Ein ganzer Satz mit Leerzeichen." } }))).toBe(
            undefined,
        );
        expect(grundAusAntwort('{"ok":true}')).toBeUndefined();
        expect(grundAusAntwort('{"error":')).toBeUndefined();
    });

    it("🔴 am Server: Eine Ablehnung mit Grund landet so im Zähler", async () => {
        const { zaehleSchnittstellen } = await import("../src/besucher/api-zaehler.ts");
        const app = Fastify();
        registerErrorHandler(app);
        zaehleSchnittstellen(app);
        app.post("/api/editor/landscapes/:id", { config: { errorEnvelope: true } }, () => {
            throw new ApiError(400, "validation_failed", "Ein Ring braucht mindestens drei Ecken.", {
                reason: "ring_unter_drei",
            });
        });
        vergissOffene();
        const antwort = await app.inject({ method: "POST", url: "/api/editor/landscapes/abc" });
        expect(antwort.statusCode).toBe(400);
        const geschrieben: string[] = [];
        const sql = ((_teile: TemplateStringsArray, werte: string) => {
            geschrieben.push(werte);
            return Promise.resolve([]);
        }) as never;
        await schreibeSchnittstellen(sql);
        expect(geschrieben.join("")).toContain("/api/editor/landscapes/:id|ring_unter_drei");
        await app.close();
    });

    it("zählt eine Anfrage ohne Route als „unbekannt“, nie mit ihrem rohen Pfad", () => {
        expect(postenFuer(undefined, 404, 1)[0]?.dimension).toBe("unbekannt");
        expect(postenFuer("wp-admin.php", 404, 1)[0]?.dimension).toBe("unbekannt");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Schnittstellenzahlen gegen echtes PostgreSQL", { timeout: 60_000 }, () => {
    let sql: Database;

    beforeAll(async () => {
        sql = createDatabase(testDatabaseUrl!);
        await migrate(sql);
        await sql`DELETE FROM api_metric`;
        vergissOffene();
    });

    afterAll(async () => {
        await sql`DELETE FROM api_metric`;
        await sql.end();
    });

    it("sammelt im Prozess und schreibt im Takt, statt je Anfrage einzufügen", async () => {
        merkePosten(postenFuer("/api/route", 200, 20));
        merkePosten(postenFuer("/api/route", 200, 20));
        merkePosten(postenFuer("/api/route", 500, 20));
        merkePosten(postenFuer("/api/besuch/ping", 204, 20));
        // Vor dem Takt steht nichts in der Tafel.
        const [vorher] = await sql<{ anzahl: string }[]>`SELECT COUNT(*)::text AS anzahl FROM api_metric`;
        expect(Number(vorher?.anzahl)).toBe(0);

        expect(await schreibeSchnittstellen(sql)).toBeGreaterThan(0);

        const zahlen = await leseApiZahlen(sql, 30);
        expect(zahlen.kennzahlen.anfragen).toBe(4);
        expect(zahlen.kennzahlen.fehlerquote).toBeCloseTo(0.25, 5);
        expect(zahlen.kennzahlen.spitzenstunde).toBe(20);
        // Der Takt steht in den Kennzahlen, nicht im Ring der Zonen.
        expect(zahlen.kennzahlen.takt).toBe(1);
        expect(zahlen.zonen.map((zone) => zone.name)).toEqual(["offen"]);
        expect(zahlen.wege[0]).toEqual({ name: "/api/route", wert: 3 });
        expect(zahlen.fehler[0]?.name).toBe("/api/route|5xx");
        expect(zahlen.stunden[20]).toBe(4);
    });

    it("schreibt nichts, wenn nichts anliegt", async () => {
        expect(await schreibeSchnittstellen(sql)).toBe(0);
    });

    it("verdichtet, was älter ist als die Aufbewahrung, auf Monatssummen", async () => {
        await sql`
            INSERT INTO api_metric (day, hour, metric, dimension, count)
            VALUES (CURRENT_DATE - 500, 9, 'anfrage', '/api/alt', 5),
                   (CURRENT_DATE - 500, 10, 'anfrage', '/api/alt', 7)
        `;
        // Zwei Stunden desselben Tages: sie fallen auf dieselbe Monatszeile, und die Stunde verfällt.
        const verdichtet = await verdichteSchnittstellen(sql);
        expect(verdichtet).toBeGreaterThan(0);
        const zeilen = await sql<{ hour: number; count: string; day: string }[]>`
            SELECT hour, count::text, day::text FROM api_metric WHERE dimension = '/api/alt'
        `;
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]?.hour).toBe(24);
        expect(Number(zeilen[0]?.count)).toBe(12);
        expect(zeilen[0]?.day.endsWith("-01")).toBe(true);
    });
});
