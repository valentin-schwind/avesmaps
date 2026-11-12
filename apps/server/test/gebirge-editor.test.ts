import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { GebirgsAenderung } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { Queryable } from "../src/database.ts";
import { gebirgSchreiben } from "../src/terrain/gebirge-editor.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";

const AREA = "d4d4d4d4-0000-4000-8000-0000000000a1";

/** Eine Ersatz-Datenbank: antwortet je nach SQL-Text und merkt sich, was geschrieben wurde. */
function ersatz(ziel: { id: string; domain: string; gebirge: boolean } | null, zeile: Record<string, unknown> | null) {
    const geschrieben: { sql: string; werte: unknown[] }[] = [];
    const tx = (strings: TemplateStringsArray, ...werte: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("FROM region_area a JOIN region r")) return Promise.resolve(ziel ? [ziel] : []);
        if (sql.includes("FROM terrain_control WHERE area_id")) return Promise.resolve(zeile ? [zeile] : []);
        geschrieben.push({ sql, werte });
        // Schreiben gibt die neue Revision der Gebirgswerte zurück (WI-0245, Trigger aus 0212).
        return Promise.resolve(sql.includes("RETURNING revision") ? [{ revision: "2" }] : []);
    };
    return { tx: tx as unknown as Queryable, geschrieben };
}
const GEBIRGE = { id: "17", domain: "aventuria", gebirge: true };
const LEGACY = {
    id: "5",
    is_active: true,
    gebirgstyp: null,
    muster: null,
    maximalhoehe: 4000,
    hypsometrie: 0.45,
    plateau: 0.9,
    rauschen: 0.25,
    einschnitt: 550,
    erosion: 3,
    talbreite: 1.6,
    koernung: 14,
    stufen: 3,
    bergform: 2,
    sattel: 1,
};

describe("gebirgSchreiben (WI-0226)", () => {
    it("prüft gegen den Vertrag: Zahl der Erhebungen über 100 und fremde Felder sind 400", async () => {
        const { tx } = ersatz(GEBIRGE, LEGACY);
        await expect(gebirgSchreiben(tx, AREA, { werte: { koernung: 101 } })).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(gebirgSchreiben(tx, AREA, { werte: { maximalhoehe: 1 } })).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(gebirgSchreiben(tx, AREA, { werte: { stufen: 3.5 } })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("↺ nur über `zurueck`: null im Feld ist 400, ein Feld zugleich setzen und zurücknehmen auch", async () => {
        const { tx, geschrieben } = ersatz(GEBIRGE, LEGACY);
        await expect(gebirgSchreiben(tx, AREA, { kammhoehe: null })).rejects.toMatchObject({ statusCode: 400 });
        await expect(gebirgSchreiben(tx, AREA, { werte: { plateau: null } })).rejects.toMatchObject({
            statusCode: 400,
        });
        await expect(
            gebirgSchreiben(tx, AREA, { kammhoehe: 3000, zurueck: ["kammhoehe", "plateau"] }),
        ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("kammhoehe") });
        expect(geschrieben).toEqual([]);
    });

    it("404 ohne Fläche, 400 für eine Fläche, die kein Gebirge ist", async () => {
        await expect(gebirgSchreiben(ersatz(null, null).tx, AREA, { typ: "bergland" })).rejects.toMatchObject({
            statusCode: 404,
        });
        await expect(
            gebirgSchreiben(ersatz({ ...GEBIRGE, gebirge: false }, null).tx, AREA, { typ: "bergland" }),
        ).rejects.toMatchObject({ statusCode: 400, code: "kein_gebirge" });
    });

    it("ohne Änderung: nichts geschrieben, nichts gemeldet", async () => {
        const { tx, geschrieben } = ersatz(GEBIRGE, LEGACY);
        const ergebnis = await gebirgSchreiben(tx, AREA, { werte: { koernung: 14 }, kammhoehe: 4000 });
        expect(ergebnis).toEqual({ affected: [], aenderungen: [] });
        expect(geschrieben).toEqual([]);
    });

    it("Typ, Muster und Werte: ein UPDATE, affected für die Rechnung im Umkreis, je Feld alt und neu", async () => {
        const { tx, geschrieben } = ersatz(GEBIRGE, LEGACY);
        const ergebnis = await gebirgSchreiben(tx, AREA, {
            typ: "bergland",
            muster: "zellen",
            werte: { koernung: 100 },
            zurueck: ["plateau"],
        });
        expect(ergebnis.affected).toEqual([{ kind: "terrain_control", id: AREA, revision: 2 }]);
        expect(ergebnis.aenderungen).toEqual([
            { feld: "gebirgstyp", alt: null, neu: "bergland" },
            { feld: "muster", alt: null, neu: "zellen" },
            { feld: "plateau", alt: 0.9, neu: null },
            { feld: "koernung", alt: 14, neu: 100 },
        ]);
        expect(geschrieben).toHaveLength(1);
        expect(geschrieben[0]!.sql).toMatch(/UPDATE terrain_control/);
        expect(geschrieben[0]!.werte).toEqual([
            "bergland",
            "zellen",
            4000,
            0.45,
            null,
            0.25,
            550,
            3,
            1.6,
            100,
            3,
            2,
            1,
            null,
            null,
            null,
            // erosionsfestigkeit (Migration 0222, WI-0249)
            null,
            // saat (Migration 0214)
            null,
            "5",
        ]);
    });

    it("ein neues Gebirge ohne Zeile: INSERT mit der Änderung allein (Herkunft avesmaps3d)", async () => {
        const { tx, geschrieben } = ersatz(GEBIRGE, null);
        const ergebnis = await gebirgSchreiben(tx, AREA, { typ: "massengebirge", kammhoehe: 1500 });
        expect(ergebnis.affected).toEqual([{ kind: "terrain_control", id: AREA, revision: 2 }]);
        expect(geschrieben[0]!.sql).toMatch(/INSERT INTO terrain_control/);
        expect(geschrieben[0]!.sql).toMatch(/'avesmaps3d'/);
        expect(geschrieben[0]!.werte.slice(0, 5)).toEqual(["17", "aventuria", "massengebirge", null, 1500]);
    });

    it("eine stillgelegte Zeile zählt als „keine Werte“ und wird mit der Änderung allein wieder aktiv", async () => {
        const { tx, geschrieben } = ersatz(GEBIRGE, { ...LEGACY, is_active: false });
        const ergebnis = await gebirgSchreiben(tx, AREA, { kammhoehe: 2000 });
        expect(ergebnis.aenderungen).toEqual([{ feld: "maximalhoehe", alt: null, neu: 2000 }]);
        expect(geschrieben[0]!.sql).toMatch(/is_active = TRUE/);
        expect(geschrieben[0]!.werte).toEqual([
            null,
            null,
            2000,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            // erosionsfestigkeit (Migration 0222, WI-0249)
            null,
            // saat (Migration 0214)
            null,
            "5",
        ]);
    });
});

/**
 * Durch Fastify, mit der echten App (`buildApp`, dieselbe ajv-Einstellung wie jede Route): Was der Körper einer Route mit
 * `GebirgsAenderung` nach der Schemaprüfung ist, bekommt `gebirgSchreiben`. Die Probe-Route gibt es nur hier; die PATCH-Route der
 * Landschaften trägt das Gebirge erst mit ihrer Verdrahtung (WI-0178), ihr Test als App-Rolle kommt dort dazu.
 */
describe("GebirgsAenderung durch Fastify (WI-0226)", () => {
    let app: FastifyInstance;
    let letzte: ReturnType<typeof ersatz>;
    beforeAll(async () => {
        app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
            },
            logStream: { write: () => undefined },
        });
        app.post(
            "/test/gebirge",
            { schema: { body: GebirgsAenderung }, config: { writeClass: "public" } },
            async (request) => {
                letzte = ersatz(GEBIRGE, LEGACY);
                return { koerper: request.body, ergebnis: await gebirgSchreiben(letzte.tx, AREA, request.body) };
            },
        );
        await app.ready();
    });
    afterAll(async () => app.close());
    const senden = (payload: object) =>
        app.inject({ method: "POST", url: "/test/gebirge", payload, headers: { origin: TEST_ORIGIN } });

    it("↺ für Kammhöhe und einen Wert kommt unverändert an und setzt beide auf die Vorgabe", async () => {
        const antwort = await senden({ werte: { koernung: 40 }, zurueck: ["kammhoehe", "plateau"] });
        expect(antwort.statusCode).toBe(200);
        const { koerper, ergebnis } = antwort.json();
        expect(koerper).toEqual({ werte: { koernung: 40 }, zurueck: ["kammhoehe", "plateau"] });
        expect(ergebnis.aenderungen).toEqual([
            { feld: "maximalhoehe", alt: 4000, neu: null },
            { feld: "plateau", alt: 0.9, neu: null },
            { feld: "koernung", alt: 14, neu: 40 },
        ]);
        expect(letzte.geschrieben[0]!.werte.slice(0, 5)).toEqual([null, null, null, 0.45, null]);
    });

    it("🪤 darum kein null: ajv macht aus null in einem Zahlfeld still eine 0 und streift Fremdes ab, statt 400", async () => {
        const nullKamm = (await senden({ kammhoehe: null })).json();
        expect(nullKamm.koerper).toEqual({ kammhoehe: 0 });
        expect(nullKamm.ergebnis.aenderungen).toEqual([{ feld: "maximalhoehe", alt: 4000, neu: 0 }]);
        expect((await senden({ werte: { plateau: null } })).json().koerper).toEqual({ werte: { plateau: 0 } });
        expect((await senden({ werte: { maximalhoehe: 1 } })).json().koerper).toEqual({ werte: {} });
    });
});
