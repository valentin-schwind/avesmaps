import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { powerlineDrawnPath, type PowerlineNetwork } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { LegacyPayload } from "../src/migration/paths.ts";
import { importPowerlines, powerlinePoints, transformPowerlines } from "../src/migration/powerlines.ts";
import { verifyPowerlines } from "../src/migration/verify-powerlines.ts";

/**
 * Die Kraftlinien (WI-0025, Contract `powerlines.yaml`).
 *
 * Der reine Teil (Umwandlung, Knotenregel) läuft ohne Datenbank; Geometrie, Idempotenz, Probelauf,
 * Kachel und Prüfer messen gegen echtes PostGIS (Kap. 11.10).
 */

const ORT_A = "44444444-0000-4000-8000-00000000000a";
const ORT_B = "44444444-0000-4000-8000-00000000000b";
const KREUZUNG = "44444444-0000-4000-8000-00000000000c";
const LABEL = "44444444-0000-4000-8000-00000000000d";
const FEHLT = "44444444-0000-4000-8000-0000000000ff";

function linie(overrides: Record<string, unknown> = {}, coordinates?: number[][]): Record<string, unknown> {
    return {
        type: "Feature",
        geometry: {
            type: "LineString",
            coordinates: coordinates ?? [
                [401, 402],
                [461, 422],
            ],
        },
        properties: {
            feature_type: "powerline",
            feature_subtype: "powerline",
            public_id: "44444444-0000-4000-8000-000000000001",
            name: "Testlinie",
            from_public_id: ORT_A,
            to_public_id: ORT_B,
            show_label: true,
            ...overrides,
        },
    };
}

function punkt(id: string, featureType: string, name: string, x: number, y: number): Record<string, unknown> {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [x, y] },
        properties: { feature_type: featureType, public_id: id, name },
    };
}

/** Die Knoten liegen NEBEN den Enden der gespeicherten Linie - genau wie 64 Enden im Bestand. */
const KNOTEN = [
    punkt(ORT_A, "location", "Testort A", 400, 400),
    punkt(ORT_B, "location", "Testort B", 460, 420),
    punkt(KREUZUNG, "junction", "Kreuzung", 430, 450),
    punkt(LABEL, "label", "Ein Label", 500, 500),
];

function quelle(...features: Record<string, unknown>[]): LegacyPayload {
    return { ok: true, revision: 140088, features: [...KNOTEN, ...features] as never };
}

describe("Kraftlinien umwandeln", () => {
    it("🔴 zeichnet von den KNOTEN aus, nicht von der gespeicherten Linie", () => {
        // Legacy `getPowerlineLatLngs`: kennt es beide Knoten, gilt deren Lage.
        const [line] = transformPowerlines(quelle(linie())).powerlines;
        expect(line?.drawnFrom).toBe("knoten");
        expect(JSON.parse(line?.drawnGeojson ?? "{}")).toEqual({
            type: "LineString",
            coordinates: [
                [400, 400],
                [460, 420],
            ],
        });
        // Die gespeicherte Linie bleibt unverändert daneben stehen.
        expect(JSON.parse(line?.geojson ?? "{}").coordinates).toEqual([
            [401, 402],
            [461, 422],
        ]);
    });

    it("🪤 fällt auf die GANZE gespeicherte Linie zurück, sobald EIN Knoten fehlt, und meldet ihn", () => {
        const result = transformPowerlines(quelle(linie({ to_public_id: FEHLT })));
        const [line] = result.powerlines;
        expect(line?.drawnFrom).toBe("linie");
        expect(JSON.parse(line?.drawnGeojson ?? "{}").coordinates).toEqual([
            [401, 402],
            [461, 422],
        ]);
        expect(result.missingNodes).toEqual([
            {
                powerlinePublicId: "44444444-0000-4000-8000-000000000001",
                name: "Testlinie",
                side: "to",
                nodePublicId: FEHLT,
            },
        ]);
    });

    it("eine Kreuzung ist ein Knoten, ein Label nicht", () => {
        // Legacys Knotenliste: jedes Punktobjekt mit Namen, das kein Label ist (Editorbild).
        const mitKreuzung = transformPowerlines(quelle(linie({ to_public_id: KREUZUNG }))).powerlines[0];
        expect(mitKreuzung?.drawnFrom).toBe("knoten");
        const mitLabel = transformPowerlines(quelle(linie({ to_public_id: LABEL }))).powerlines[0];
        expect(mitLabel?.drawnFrom).toBe("linie");
    });

    it("💣 biegt mit Legacys Formel, von den Knoten aus", () => {
        const [line] = transformPowerlines(quelle(linie({ curve: -9 }))).powerlines;
        const erwartet = powerlineDrawnPath(
            [
                { x: 400, y: 400 },
                { x: 460, y: 420 },
            ],
            -9,
        ).map((p) => [p.x, p.y]);
        expect(JSON.parse(line?.drawnGeojson ?? "{}").coordinates).toEqual(erwartet);
        expect(erwartet, "−9 % ergibt 11 Schritte, also 12 Punkte").toHaveLength(12);
        expect(line?.curve).toBe(-9);
    });

    it("🪤 hält „nicht gespeichert“ und „0“ auseinander, und ein kaputter Bogen weist zurück", () => {
        const result = transformPowerlines(
            quelle(
                linie({ public_id: "44444444-0000-4000-8000-000000000011" }),
                linie({ public_id: "44444444-0000-4000-8000-000000000012", curve: 0 }),
                linie({ public_id: "44444444-0000-4000-8000-000000000013", curve: 60 }),
                linie({ public_id: "44444444-0000-4000-8000-000000000014", curve: "5" }),
            ),
        );
        expect(result.powerlines.map((line) => line.curve)).toEqual([null, 0, 60]);
        expect(result.rejected).toEqual([
            { publicId: "44444444-0000-4000-8000-000000000014", reason: 'curve "5" ist keine Zahl' },
        ]);
    });

    it("liest ein fehlendes `show_label` als AUS, wie Legacy auf beiden Seiten", () => {
        const result = transformPowerlines(
            quelle(
                linie({ public_id: "44444444-0000-4000-8000-000000000021", show_label: undefined }),
                linie({ public_id: "44444444-0000-4000-8000-000000000022", show_label: false }),
                linie({ public_id: "44444444-0000-4000-8000-000000000023", show_label: 1 }),
            ),
        );
        expect(result.powerlines.map((line) => line.labelVisible)).toEqual([false, false, true]);
    });

    it("🔴 ein Kreuzungsobjekt an einem Linienende wird ein Kraftlinienpunkt - einmal, und ein Label nicht", () => {
        // Betreiber 2026-09-26: „für deinen import reicht es "Kraftlinienpunkte a.k.a. Nodix" als eigenes
        // objekt zu bauen“ - NICHT als Kreuzung des Wegenetzes.
        const zweiAnDerKreuzung = transformPowerlines(
            quelle(
                linie({ public_id: "44444444-0000-4000-8000-000000000041", to_public_id: KREUZUNG }),
                linie({ public_id: "44444444-0000-4000-8000-000000000042", from_public_id: KREUZUNG }),
                linie({ public_id: "44444444-0000-4000-8000-000000000043", to_public_id: LABEL }),
            ),
        );
        expect(zweiAnDerKreuzung.nodices).toEqual([
            { publicId: KREUZUNG, legacyKind: "junction", legacyName: "Kreuzung", x: 430, y: 450 },
        ]);
        // Eine Kreuzung, an der keine Kraftlinie endet, ist keiner.
        expect(powerlinePoints(quelle(), [])).toEqual([]);
    });

    it("🔴 weist zurück, statt still zu verbiegen, und übergeht alle anderen Objektarten", () => {
        const result = transformPowerlines(
            quelle(
                linie({ public_id: "" }),
                linie({ public_id: "44444444-0000-4000-8000-000000000031", from_public_id: "" }),
                linie({ public_id: "44444444-0000-4000-8000-000000000032" }, [[400, 400]]),
                linie({ public_id: "44444444-0000-4000-8000-000000000033" }, [
                    [400, 400],
                    [2000, 400],
                ]),
            ),
        );
        expect(result.powerlines).toHaveLength(0);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
            "ohne public_id",
            "from_public_id fehlt",
            "keine Linie mit mindestens zwei Stützpunkten",
            "Stützpunkt außerhalb des Kartenraums",
        ]);
        expect(result.skippedOtherTypes, "die vier Knoten sind keine Kraftlinien").toBe(4);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Kraftlinien importieren, gegen PostGIS", () => {
    let database: Database;

    const gerade = linie({ public_id: "44444444-0000-4000-8000-000000000101", name: "Gerade Linie" });
    const gebogen = linie({
        public_id: "44444444-0000-4000-8000-000000000102",
        name: "Gebogene Linie",
        from_public_id: ORT_A,
        to_public_id: KREUZUNG,
        curve: -9,
    });
    const verwaist = linie({
        public_id: "44444444-0000-4000-8000-000000000103",
        name: "Verwaiste Linie",
        to_public_id: FEHLT,
        show_label: false,
    });
    const payload = quelle(gerade, gebogen, verwaist);

    async function aufraeumen(): Promise<void> {
        await database.unsafe(`DELETE FROM powerline WHERE public_id::text LIKE '44444444-%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '44444444-%'`);
        await database.unsafe(`DELETE FROM nodix WHERE public_id::text LIKE '44444444-%'`);
        await database.unsafe(`DELETE FROM map_label WHERE public_id::text LIKE '44444444-%'`);
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'powerlines' AND source_ref = 'map_revision=140088'
            AND NOT EXISTS (SELECT 1 FROM powerline WHERE migration_run_id = migration_run.id)
            AND NOT EXISTS (SELECT 1 FROM nodix WHERE migration_run_id = migration_run.id)`);
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        // Der Bestand entsteht mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand (siehe den Fall zum Auslassen).
        legacyImportOffen();
        await importPowerlines(database, payload);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 der Legacy-Import lässt die Kraftlinien aus, solange sie dem WikiSync gehören: Befund bereich_wikisync, nichts geschrieben", async () => {
        vi.restoreAllMocks();
        try {
            const [vorher] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM migration_run`;
            const bericht = await importPowerlines(database, payload);
            expect(bericht).toMatchObject({ created: 0, updated: 0, retired: 0 });
            expect(bericht.findings.map((finding) => finding.code)).toContain("bereich_wikisync");
            const [nachher] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM migration_run`;
            expect(nachher?.n, "kein migration_run aus dem ausgelassenen Zug").toBe(vorher?.n);
        } finally {
            legacyImportOffen();
        }
    });

    it("💣 legt beide Geometrien mit SRID 0 ab, und die gezeichnete Bahn ist gebogen", async () => {
        const rows = await database<{ name: string; srid: number; punkte: number; gezeichnet: number }[]>`
            SELECT name, ST_SRID(drawn_geom) AS srid, ST_NPoints(geom)::int AS punkte,
                   ST_NPoints(drawn_geom)::int AS gezeichnet
            FROM powerline WHERE public_id::text LIKE '44444444-%' ORDER BY name
        `;
        expect(rows).toEqual([
            { name: "Gebogene Linie", srid: 0, punkte: 2, gezeichnet: 12 },
            { name: "Gerade Linie", srid: 0, punkte: 2, gezeichnet: 2 },
            { name: "Verwaiste Linie", srid: 0, punkte: 2, gezeichnet: 2 },
        ]);
    });

    it("🔴 die Renderrelation liefert die GEZEICHNETE Bahn, nicht die gespeicherte Linie", async () => {
        const [row] = await database<{ gleich: boolean }[]>`
            SELECT ST_Equals(r.geom, map_domain_to_render(p.map_domain_id, p.drawn_geom)) AS gleich
            FROM powerline_render r JOIN powerline p USING (public_id)
            WHERE p.name = 'Gerade Linie'
        `;
        expect(row?.gleich).toBe(true);
    });

    it("die unbeschnittene Namenskachel gibt es nicht mehr (0039)", async () => {
        // Die Namen kommen seit a240338 aus powerline_render. Stünde die Funktion noch da, veröffentlichte
        // Martin eine Quelle, die niemand fragt und die nach jedem Umbau veraltet.
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'powerline_label_tile'
        `;
        expect(row?.n).toBe(0);
    });

    it("🔴 der Prüfer besteht - auch gegen die Orte und Kraftlinienpunkte dieser Datenbank", async () => {
        await database.unsafe(`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
            VALUES ('${ORT_A}', 'aventuria', 'Testort A', 'stadt', ST_SetSRID(ST_MakePoint(400, 400), 0)),
                   ('${ORT_B}', 'aventuria', 'Testort B', 'dorf', ST_SetSRID(ST_MakePoint(460, 420), 0))`);
        // Der Kraftlinienpunkt an der Kreuzung kommt aus dem Import selbst, nicht aus dem Wegenetz.
        const report = await verifyPowerlines(database, payload);
        // 🪤 Der Prüfer zählt ALLE aktiven Kraftlinien der Datenbank; in der Testdatenbank sind das
        // genau diese drei, weil jeder Test seine eigenen wieder entfernt.
        expect(report.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`)).toEqual(
            [],
        );
        expect(report.checks.map((check) => check.name)).toEqual([
            "kraftlinien_vollzaehlig",
            "identitaet_eindeutig",
            "geometrie_gueltig",
            "linie_unveraendert",
            "bahn_nach_legacys_formel",
            "knotenverweise_erhalten",
            "bogen_erhalten",
            "namen_erhalten",
            "beschriftungssteuerung_erhalten",
            "bahn_endet_an_den_knoten",
            "renderreihenfolge",
            "kraftlinienpunkte_vollzaehlig",
            "kraftlinienpunkte_lage",
        ]);
    });

    it("🔴 K10: eine von der Karte genommene Linie fehlt dem Prüfer nicht; eine gelöschte schon", async () => {
        const GERADE = "44444444-0000-4000-8000-000000000101";
        try {
            await database`UPDATE powerline SET is_active = FALSE, off_map = TRUE WHERE public_id = ${GERADE}`;
            const abgenommen = await verifyPowerlines(database, payload);
            const zaehlung = abgenommen.checks.find((check) => check.name === "kraftlinien_vollzaehlig");
            expect(zaehlung).toMatchObject({ passed: true });
            expect(zaehlung?.detail).toContain("ohne 1 von der Karte genommene");
            expect(abgenommen.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual([]);
            // Ganz gelöscht ist kein Stand, den der Zug achtet: Sie fehlt.
            await database`UPDATE powerline SET off_map = FALSE WHERE public_id = ${GERADE}`;
            const geloescht = await verifyPowerlines(database, payload);
            expect(geloescht.checks.find((check) => check.name === "kraftlinien_vollzaehlig")?.passed).toBe(false);
        } finally {
            await database`UPDATE powerline SET is_active = TRUE, off_map = FALSE WHERE public_id = ${GERADE}`;
        }
    });

    it("💣 der Prüfer merkt, wenn ein Ort gewandert ist und die Kraftlinie nicht", async () => {
        // Gegenprobe zu Gate 10: die Ortstabelle steht auf einem anderen Stand als die Kraftlinien.
        await database.unsafe(
            `UPDATE place SET geom = ST_SetSRID(ST_MakePoint(401, 400), 0) WHERE public_id = '${ORT_A}'`,
        );
        const report = await verifyPowerlines(database, payload);
        const gate = report.checks.find((check) => check.name === "bahn_endet_an_den_knoten");
        expect(gate?.passed).toBe(false);
        // Betreiber 2026-10-03: Diese Prüfung steht nicht in der Liste der anhaltenden (blocking-checks.ts): Befund, Urteil grün.
        expect(gate?.blocking).toBe(false);
        expect(report.passed).toBe(true);
        await database.unsafe(
            `UPDATE place SET geom = ST_SetSRID(ST_MakePoint(400, 400), 0) WHERE public_id = '${ORT_A}'`,
        );
    });

    it("💣 der Prüfer merkt, wenn ein Kraftlinienpunkt gewandert ist", async () => {
        await database.unsafe(
            `UPDATE nodix SET geom = ST_SetSRID(ST_MakePoint(431, 450), 0) WHERE public_id = '${KREUZUNG}'`,
        );
        try {
            const report = await verifyPowerlines(database, payload);
            const falsch = report.checks.filter((check) => !check.passed).map((check) => check.name);
            expect(falsch).toEqual(["bahn_endet_an_den_knoten", "kraftlinienpunkte_lage"]);
            // Betreiber 2026-10-03 („A auch für die Prüfungen“): Auch die Lage der Kraftlinienpunkte meldet nur.
            expect(report.checks.filter((check) => !check.passed).map((check) => check.blocking)).toEqual([
                false,
                false,
            ]);
            expect(report.passed, "keine Prüfung der Liste fiel aus").toBe(true);
        } finally {
            await database.unsafe(
                `UPDATE nodix SET geom = ST_SetSRID(ST_MakePoint(430, 450), 0) WHERE public_id = '${KREUZUNG}'`,
            );
        }
    });

    /** Die App mit einer EIGENEN Verbindung: sie schließt ihre Datenbank beim Beenden. */
    async function frage(url: string): Promise<{ status: number; cache: unknown; netz: PowerlineNetwork }> {
        const app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(testDatabaseUrl as string),
        });
        try {
            const antwort = await app.inject({ method: "GET", url });
            return { status: antwort.statusCode, cache: antwort.headers["cache-control"], netz: antwort.json() };
        } finally {
            await app.close();
        }
    }

    it("🔴 GET /api/powerlines liefert jede Linie GANZ, mit der Art ihrer Enden (Stufe 2)", async () => {
        // Ort A und B stehen seit dem Prüfertest in der Ortstabelle, die Kreuzung in ihrer.
        const { status, cache, netz } = await frage("/api/powerlines");
        expect(status).toBe(200);
        expect(cache).toBe("public, max-age=300");
        const unsere = netz.lines.filter((line) => line.id.startsWith("44444444-"));
        expect(unsere.map((line) => [line.name, line.from.kind, line.to.kind])).toEqual([
            ["Gerade Linie", "place", "place"],
            ["Gebogene Linie", "place", "nodix"],
            ["Verwaiste Linie", "place", "missing"],
        ]);
        // Die GEZEICHNETE Bahn in Kartenkoordinaten, nicht die gespeicherte Linie (401, 402).
        expect(unsere[0]?.path).toEqual([
            [400, 400],
            [460, 420],
        ]);
        expect(unsere[1]?.path, "−9 % sind 12 Punkte").toHaveLength(12);
        expect(unsere.map((line) => line.labelVisible)).toEqual([true, true, false]);
    });

    it("🔴 jedes Linienende ist ein Knoten der Ansicht - auch ohne Kennzeichen, und auch ein Label (0040)", async () => {
        // Betreiber 2026-09-23: „nicht nur orte sondern auch flächen oder labels können nodix sein“.
        await database.unsafe(`
            INSERT INTO map_label (public_id, map_domain_id, name, geom)
            VALUES ('${FEHLT}', 'aventuria', 'Ein Nodix-Label', ST_SetSRID(ST_MakePoint(461, 422), 0))`);
        try {
            const { netz } = await frage("/api/powerlines");
            const verwaist = netz.lines.find((line) => line.name === "Verwaiste Linie");
            expect(verwaist?.to.kind, "das Ende hängt jetzt an einem Label").toBe("label");

            const knoten = await database<{ id: string; art: string; klasse: string }[]>`
                SELECT public_id::text AS id, node_kind AS art, subtype AS klasse
                FROM ley_node_render WHERE public_id::text LIKE '44444444-%' ORDER BY public_id
            `;
            // Die Testorte tragen KEIN Nodix-Kennzeichen - Knoten sind sie, weil Linien dort enden. Der
            // Kraftlinienpunkt ist einer, wie jeder (Betreiber 2026-09-26).
            expect(knoten).toEqual([
                { id: ORT_A, art: "place", klasse: "stadt" },
                { id: ORT_B, art: "place", klasse: "dorf" },
                { id: KREUZUNG, art: "nodix", klasse: "dorf" },
                { id: FEHLT, art: "label", klasse: "stadt" },
            ]);
        } finally {
            await database.unsafe(`DELETE FROM map_label WHERE public_id = '${FEHLT}'`);
        }
    });

    it("🔴 auch ein Treffpunkt zweier Linien ist ein Knoten - die Bögen landen dort (0043)", async () => {
        // Betreiber 2026-09-26 zu den 19 Treffpunkten: „richtig, dort landen, wie bei knoten“. Bis 0043
        // war ein Treffpunkt kein Knoten, und die Bögen gingen im Himmel ineinander über.
        await database.unsafe(`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id,
                                   geom, drawn_geom, source_system, legacy_public_id)
            VALUES ('44444444-0000-4000-8000-000000000109', 'aventuria', 'Zweite Linie', FALSE,
                    '${KREUZUNG}', '${ORT_B}',
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(430, 450), ST_MakePoint(460, 420)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(430, 450), ST_MakePoint(460, 420)), 0),
                    'test', '44444444-0000-4000-8000-000000000109')`);
        try {
            const [row] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM ley_node_render WHERE public_id = ${KREUZUNG}
            `;
            expect(row?.n, "genau ein Knoten, auch bei zwei Linien").toBe(1);
            const { netz } = await frage("/api/powerlines");
            expect(netz.lines.find((line) => line.name === "Zweite Linie")?.from.kind).toBe("nodix");
        } finally {
            await database.unsafe(`DELETE FROM powerline WHERE public_id = '44444444-0000-4000-8000-000000000109'`);
        }
    });
});
