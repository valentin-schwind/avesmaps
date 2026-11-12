import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { listeSprachen, spracheLesen } from "../src/sprachen/lesen.ts";
import type { SpracheEintrag, SpracheMitTeilflaechen } from "../src/sprachen/typen.ts";

/**
 * Sprachen als Kartenebene, Schema und Lesewege (WI-0261 S2, Migration 0254) gegen echtes PostGIS.
 *
 * Problemfälle: eine stillgelegte Sprache oder Fläche erscheint in der Liste, im Einzelabruf oder in der Kachelsicht; die Summe zählt
 * Stillgelegtes mit; die Kachelsicht liefert nicht SRID 3857; zwei Sprachen dürfen sich NICHT überlappen (sie dürfen, E2); eine Fläche aus
 * der Sprachenkarte ohne Revision der Quelle oder eine der Redaktion mit ihr; eine Farbe, die kein `#rrggbb` ist.
 *
 * 🔴 Eigene Schlüssel (`s2test-…`) und eine eigene Ecke der Karte: Der Test fasst keinen fremden Bestand an und filtert jede Liste auf sein
 * Präfix. Aufgeräumt wird davor und danach; die Testdatenbank behält keine Reste.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PRAEFIX = "s2test-";
const SCHLUESSEL = {
    alpha: `${PRAEFIX}alpha`,
    beta: `${PRAEFIX}beta`,
    gamma: `${PRAEFIX}gamma`,
    delta: `${PRAEFIX}delta`,
};
const FLAECHE = {
    alpha1: "00000000-0000-4000-8000-0000002612a1",
    alpha2: "00000000-0000-4000-8000-0000002612a2",
    alphaStill: "00000000-0000-4000-8000-0000002612a3",
    beta1: "00000000-0000-4000-8000-0000002612b1",
    gamma1: "00000000-0000-4000-8000-0000002612c1",
};
const QUELLE = "e0619e909dcc".padEnd(64, "0");

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

describeWithDatabase("Sprachen: Schema, Lesewege und Kachelsicht (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance | undefined;
    const ids: Record<keyof typeof SCHLUESSEL, string> = { alpha: "", beta: "", gamma: "", delta: "" };

    const aufraeumen = async (): Promise<void> => {
        await database`
            DELETE FROM sprache_flaeche WHERE sprache_id IN (SELECT id FROM sprache WHERE schluessel LIKE ${`${PRAEFIX}%`})
        `;
        await database`DELETE FROM sprache WHERE schluessel LIKE ${`${PRAEFIX}%`}`;
    };

    const sprache = async (
        schluessel: string,
        name: string,
        farbe: string,
        reihenfolge: number,
        extra: { legende?: string; herkunft?: string; still?: boolean } = {},
    ): Promise<string> => {
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO sprache (schluessel, name, legende, farbe, reihenfolge, herkunft, state, is_active, retired_at, retired_origin)
            VALUES (${schluessel}, ${name}, ${extra.legende ?? null}, ${farbe}, ${reihenfolge}, ${extra.herkunft ?? "sprachenkarte"},
                    ${extra.still === true ? "retired" : "active"}, ${extra.still !== true},
                    ${extra.still === true ? database`now()` : null}, ${extra.still === true ? "editor" : null})
            RETURNING public_id::text AS public_id
        `;
        return (zeile as { public_id: string }).public_id;
    };

    const flaeche = async (
        publicId: string,
        schluessel: string,
        wkt: string,
        extra: { herkunft?: string; quelle?: string | null; still?: boolean } = {},
    ): Promise<void> => {
        const herkunft = extra.herkunft ?? "sprachenkarte";
        const quelle = extra.quelle === undefined ? (herkunft === "sprachenkarte" ? QUELLE : null) : extra.quelle;
        await database`
            INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision, is_active, retired_at,
                                         retired_origin)
            VALUES (${publicId}, (SELECT id FROM sprache WHERE schluessel = ${schluessel}), 'aventuria', ST_GeomFromText(${wkt}, 0),
                    ${herkunft}, ${quelle}, ${extra.still !== true}, ${extra.still === true ? database`now()` : null},
                    ${extra.still === true ? "editor" : null})
        `;
    };

    /** Die Liste, ohne Fremdes. */
    const eigene = async (): Promise<SpracheEintrag[]> =>
        (await listeSprachen(database)).filter((eintrag) => eintrag.schluessel.startsWith(PRAEFIX));

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await aufraeumen();
        // Reihenfolge der Legende: Delta (Anton) und Beta stehen bei 1, Alpha bei 2; Gamma ist stillgelegt.
        ids.alpha = await sprache(SCHLUESSEL.alpha, "Alpha", "#aa0000", 2, { legende: "Alpha / Alphisch" });
        ids.beta = await sprache(SCHLUESSEL.beta, "Beta", "#00aa00", 1, { herkunft: "redaktion" });
        ids.gamma = await sprache(SCHLUESSEL.gamma, "Gamma", "#0000aa", 3, { still: true });
        ids.delta = await sprache(SCHLUESSEL.delta, "Anton", "#aaaa00", 1);
        // Alpha: ein Quadrat (10 000 E²), ein MultiPolygon aus zwei Quadraten (200 E²) und eine stillgelegte Fläche.
        await flaeche(FLAECHE.alpha1, SCHLUESSEL.alpha, quadrat(100, 100, 200, 200));
        await flaeche(
            FLAECHE.alpha2,
            SCHLUESSEL.alpha,
            `MULTIPOLYGON(((300 300,310 300,310 310,300 310,300 300)),((320 300,330 300,330 310,320 310,320 300)))`,
        );
        await flaeche(FLAECHE.alphaStill, SCHLUESSEL.alpha, quadrat(400, 400, 450, 450), { still: true });
        // Beta überlappt Alpha (E2): ein Mischgebiet ist, wo sich zwei Sprachen überlappen.
        await flaeche(FLAECHE.beta1, SCHLUESSEL.beta, quadrat(150, 150, 250, 250), { herkunft: "redaktion" });
        // Gamma ist stillgelegt, seine Fläche aktiv: Sie gehört trotzdem nicht in die Kachelsicht.
        await flaeche(FLAECHE.gamma1, SCHLUESSEL.gamma, quadrat(500, 500, 510, 510));
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen().catch(() => undefined);
        await database?.end({ timeout: 5 });
    });

    it("🔴 die Liste nennt die aktiven Sprachen nach Reihenfolge und Name, mit Zahl und Summe der aktiven Teilflächen", async () => {
        const liste = await eigene();
        expect(liste.map((eintrag) => eintrag.schluessel)).toEqual([
            SCHLUESSEL.delta,
            SCHLUESSEL.beta,
            SCHLUESSEL.alpha,
        ]);
        expect(liste.map((eintrag) => eintrag.schluessel)).not.toContain(SCHLUESSEL.gamma);
        expect(liste[0]).toEqual({
            id: ids.delta,
            schluessel: SCHLUESSEL.delta,
            name: "Anton",
            legende: null,
            farbe: "#aaaa00",
            reihenfolge: 1,
            herkunft: "sprachenkarte",
            revision: 1,
            anzahlTeilflaechen: 0,
            flaeche: 0,
        });
        expect(liste[1]).toMatchObject({ name: "Beta", herkunft: "redaktion", anzahlTeilflaechen: 1, flaeche: 10000 });
        // Alpha: 10 000 + 2 × 100 E²; die stillgelegte Fläche (2 500 E²) zählt nicht.
        expect(liste[2]).toMatchObject({
            id: ids.alpha,
            name: "Alpha",
            legende: "Alpha / Alphisch",
            farbe: "#aa0000",
            reihenfolge: 2,
            anzahlTeilflaechen: 2,
            flaeche: 10200,
        });
    });

    it("🔴 eine Sprache mit ihren aktiven Teilflächen, die größte zuerst, jede mit Fläche und Hülle in Kartenkoordinaten", async () => {
        const alpha = await spracheLesen(database, SCHLUESSEL.alpha);
        expect(alpha).toEqual<SpracheMitTeilflaechen>({
            id: ids.alpha,
            schluessel: SCHLUESSEL.alpha,
            name: "Alpha",
            legende: "Alpha / Alphisch",
            farbe: "#aa0000",
            reihenfolge: 2,
            herkunft: "sprachenkarte",
            revision: 1,
            anzahlTeilflaechen: 2,
            flaeche: 10200,
            teilflaechen: [
                { id: FLAECHE.alpha1, herkunft: "sprachenkarte", flaeche: 10000, bbox: [100, 100, 200, 200] },
                { id: FLAECHE.alpha2, herkunft: "sprachenkarte", flaeche: 200, bbox: [300, 300, 330, 310] },
            ],
        });
        // Eine Sprache ohne Fläche ist da, mit leerer Liste.
        expect(await spracheLesen(database, SCHLUESSEL.delta)).toMatchObject({
            anzahlTeilflaechen: 0,
            flaeche: 0,
            teilflaechen: [],
        });
        // Die Redaktion zeichnet; ihre Fläche trägt die Herkunft.
        expect((await spracheLesen(database, SCHLUESSEL.beta))?.teilflaechen).toEqual([
            { id: FLAECHE.beta1, herkunft: "redaktion", flaeche: 10000, bbox: [150, 150, 250, 250] },
        ]);
    });

    it("🔴 eine unbekannte oder stillgelegte Sprache gibt null", async () => {
        expect(await spracheLesen(database, SCHLUESSEL.gamma)).toBeNull();
        expect(await spracheLesen(database, `${PRAEFIX}gibt-es-nicht`)).toBeNull();
    });

    it("🔴 die Kachelsicht liefert nur aktive Flächen aktiver Sprachen, in SRID 3857, mit Farbe und Fläche der Quelle", async () => {
        const zeilen = await database<
            {
                public_id: string;
                sprache_public_id: string;
                schluessel: string;
                name: string;
                farbe: string;
                reihenfolge: number;
                area: number;
                srid: number;
            }[]
        >`
            SELECT public_id::text AS public_id, sprache_public_id::text AS sprache_public_id, schluessel, name, farbe, reihenfolge, area,
                   ST_SRID(geom) AS srid
              FROM sprache_flaeche_render
             WHERE schluessel LIKE ${`${PRAEFIX}%`}
             ORDER BY public_id
        `;
        expect(zeilen.map((zeile) => zeile.public_id)).toEqual([FLAECHE.alpha1, FLAECHE.alpha2, FLAECHE.beta1]);
        expect(zeilen.map((zeile) => zeile.srid)).toEqual([3857, 3857, 3857]);
        expect(zeilen[0]).toMatchObject({
            sprache_public_id: ids.alpha,
            schluessel: SCHLUESSEL.alpha,
            name: "Alpha",
            farbe: "#aa0000",
            reihenfolge: 2,
            area: 10000,
        });
        expect(zeilen[1]?.area).toBe(200);
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'sprache_flaeche_render' ORDER BY ordinal_position
        `;
        expect(spalten.map((spalte) => spalte.column_name)).toEqual([
            "public_id",
            "sprache_public_id",
            "schluessel",
            "name",
            "farbe",
            "reihenfolge",
            "area",
            "geom",
        ]);
    });

    it("🔴 zwei Sprachen dürfen sich überlappen: beide Flächen stehen in der Tafel und in der Kachelsicht", async () => {
        const [zeile] = await database<{ ueberlappt: boolean; flaeche: number }[]>`
            SELECT ST_Intersects(a.geom, b.geom) AS ueberlappt, ST_Area(ST_Intersection(a.geom, b.geom))::float8 AS flaeche
              FROM sprache_flaeche a, sprache_flaeche b
             WHERE a.public_id = ${FLAECHE.alpha1} AND b.public_id = ${FLAECHE.beta1}
        `;
        // (150,150)-(200,200): 2 500 E² gemeinsam.
        expect(zeile).toEqual({ ueberlappt: true, flaeche: 2500 });
        const [sicht] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM sprache_flaeche_render WHERE public_id IN (${FLAECHE.alpha1}, ${FLAECHE.beta1})
        `;
        expect(sicht?.n).toBe(2);
    });

    it("🔴 die Herkunft einer Fläche gehört zur Revision ihrer Quelle: Sprachenkarte mit, Redaktion ohne", async () => {
        const verletzung = async (
            herkunft: string,
            quelle: string | null,
        ): Promise<{ code?: string; constraint_name?: string }> => {
            try {
                await database`
                    INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft, quelle_revision)
                    VALUES ((SELECT id FROM sprache WHERE schluessel = ${SCHLUESSEL.alpha}), 'aventuria',
                            ST_GeomFromText(${quadrat(600, 600, 610, 610)}, 0), ${herkunft}, ${quelle})
                `;
            } catch (error) {
                return error as { code?: string; constraint_name?: string };
            }
            return {};
        };
        expect(await verletzung("sprachenkarte", null)).toMatchObject({
            code: "23514",
            constraint_name: "sprache_flaeche_quelle_matches_herkunft",
        });
        expect(await verletzung("redaktion", QUELLE)).toMatchObject({
            code: "23514",
            constraint_name: "sprache_flaeche_quelle_matches_herkunft",
        });
        expect(await verletzung("unbekannt", null)).toMatchObject({ code: "23514" });
        // Nichts davon blieb stehen.
        expect((await spracheLesen(database, SCHLUESSEL.alpha))?.anzahlTeilflaechen).toBe(2);
    });

    it("🔴 die Farbe ist #rrggbb in Kleinbuchstaben, der Schlüssel klein und mit einem Buchstaben am Anfang", async () => {
        const verletzung = async (
            schluessel: string,
            farbe: string,
        ): Promise<{ code?: string; constraint_name?: string }> => {
            try {
                await database`
                    INSERT INTO sprache (schluessel, name, farbe, herkunft) VALUES (${schluessel}, 'Probe', ${farbe}, 'redaktion')
                `;
            } catch (error) {
                return error as { code?: string; constraint_name?: string };
            }
            return {};
        };
        for (const farbe of ["#AA0000", "aa0000", "#aa00", "#aa00000", "rot", ""]) {
            expect(await verletzung(`${PRAEFIX}farbe`, farbe), farbe).toMatchObject({
                code: "23514",
                constraint_name: "sprache_farbe_format",
            });
        }
        for (const schluessel of ["1probe", "Probe", "pro be", "-probe", ""]) {
            expect(await verletzung(schluessel, "#aa0000"), schluessel).toMatchObject({ code: "23514" });
        }
        expect(await eigene()).toHaveLength(3);
    });

    it("die Revision zählt der Trigger bei einer fachlichen Änderung, nicht bei einer Abfrage", async () => {
        const schluessel = `${PRAEFIX}revision`;
        await sprache(schluessel, "Revision", "#aa0000", 9);
        try {
            await database`UPDATE sprache SET farbe = '#bb0000' WHERE schluessel = ${schluessel}`;
            await database`UPDATE sprache SET name = 'Revision zwei' WHERE schluessel = ${schluessel}`;
            expect((await spracheLesen(database, schluessel))?.revision).toBe(3);
            await database`SELECT * FROM sprache WHERE schluessel = ${schluessel}`;
            expect((await spracheLesen(database, schluessel))?.revision).toBe(3);
        } finally {
            await database`DELETE FROM sprache WHERE schluessel = ${schluessel}`;
        }
    });

    it("🔴 eine Fläche außerhalb der Karte weist die Datenbank ab (map_domain_contains)", async () => {
        const ergebnis = await database`
            INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft)
            VALUES ((SELECT id FROM sprache WHERE schluessel = ${SCHLUESSEL.beta}), 'aventuria',
                    ST_GeomFromText(${quadrat(2000, 2000, 2010, 2010)}, 0), 'redaktion')
        `.then(
            () => ({}),
            (error: unknown) => error as { code?: string; constraint_name?: string },
        );
        expect(ergebnis).toMatchObject({ code: "23514", constraint_name: "sprache_flaeche_inside_domain" });
        // Ein Punkt ist keine Fläche.
        const punkt = await database`
            INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft)
            VALUES ((SELECT id FROM sprache WHERE schluessel = ${SCHLUESSEL.beta}), 'aventuria', ST_GeomFromText('POINT(10 10)', 0), 'redaktion')
        `.then(
            () => ({}),
            (error: unknown) => error as { code?: string; constraint_name?: string },
        );
        expect(punkt).toMatchObject({ code: "23514", constraint_name: "sprache_flaeche_is_surface" });
    });

    it("GET /api/sprachen und /api/sprachen/:schluessel: 200 mit ETag, 304, 400 und 404", async () => {
        const config = { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined };
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
        });
        await app.ready();

        const liste = await app.inject({ url: "/api/sprachen" });
        expect(liste.statusCode).toBe(200);
        expect(liste.headers["cache-control"]).toBe("no-cache");
        const sprachen = liste.json<{ sprachen: SpracheEintrag[] }>().sprachen;
        expect(
            sprachen.filter((eintrag) => eintrag.schluessel.startsWith(PRAEFIX)).map((eintrag) => eintrag.schluessel),
        ).toEqual([SCHLUESSEL.delta, SCHLUESSEL.beta, SCHLUESSEL.alpha]);
        const etag = liste.headers["etag"] as string;
        expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
        const unveraendert = await app.inject({ url: "/api/sprachen", headers: { "if-none-match": etag } });
        expect(unveraendert.statusCode).toBe(304);

        const einzeln = await app.inject({ url: `/api/sprachen/${SCHLUESSEL.alpha}` });
        expect(einzeln.statusCode).toBe(200);
        expect(einzeln.json<SpracheMitTeilflaechen>()).toMatchObject({
            schluessel: SCHLUESSEL.alpha,
            anzahlTeilflaechen: 2,
            flaeche: 10200,
            teilflaechen: [{ id: FLAECHE.alpha1, flaeche: 10000, bbox: [100, 100, 200, 200] }, { id: FLAECHE.alpha2 }],
            // Die Zahlen der Treffer (WI-0261 S4): Hier rechnet kein Auftrag, also keine; gerechnet wird in `sprachen-treffer.test.ts`.
            treffer: { orte: 0, gebiete: 0, regionen: 0, wege: 0 },
        });
        const einzelnEtag = einzeln.headers["etag"] as string;
        expect(
            (await app.inject({ url: `/api/sprachen/${SCHLUESSEL.alpha}`, headers: { "if-none-match": einzelnEtag } }))
                .statusCode,
        ).toBe(304);

        // Unbekannt und stillgelegt: 404 in der Form der Route.
        for (const schluessel of [`${PRAEFIX}gibt-es-nicht`, SCHLUESSEL.gamma]) {
            const fehlt = await app.inject({ url: `/api/sprachen/${schluessel}` });
            expect(fehlt.statusCode, schluessel).toBe(404);
            expect(fehlt.json()).toEqual({ error: "not_found" });
        }
        // Ein Schlüssel falscher Form ist 400 in Fastifys Form, nie 500.
        const falsch = await app.inject({ url: "/api/sprachen/Gro%C3%9F" });
        expect(falsch.statusCode).toBe(400);
        expect(falsch.json()).toMatchObject({ statusCode: 400, code: "FST_ERR_VALIDATION" });
    });
});
