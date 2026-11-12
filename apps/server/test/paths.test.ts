import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFindings } from "../src/blocking-checks.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { verifyPaths } from "../src/migration/verify-paths.ts";
import {
    assertSourceComplete,
    importPaths,
    MigrationAborted,
    transformPaths,
    type LegacyPayload,
} from "../src/migration/paths.ts";

/**
 * Die Wege-Domäne (WI-0010, Contract `paths.yaml` Version 3: Routingdaten aus WI-0017 R1, seit WI-0132 Release N ohne Kreuzungen).
 *
 * Der reine Teil (Umwandlung) läuft ohne Datenbank; alles, was Geometrie oder Idempotenz betrifft,
 * misst gegen echtes PostGIS — ein Nachbau prüfte die eigene Kopie, nicht die Karte (Kap. 11.10).
 */

function weg(overrides: Record<string, unknown> = {}, geometry?: unknown): Record<string, unknown> {
    return {
        geometry: geometry ?? {
            type: "LineString",
            coordinates: [
                [400, 400],
                [410, 405],
            ],
        },
        properties: {
            feature_type: "path",
            public_id: "11111111-0000-4000-8000-000000000001",
            name: "Teststrasse",
            feature_subtype: "Strasse",
            ...overrides,
        },
    };
}

describe("Wege umwandeln", () => {
    it("💣 bricht ab, wenn die Quelle unvollständig ist, statt alles stillzulegen", () => {
        // Ein Lauf, der eine leere Antwort als leere Welt liest, legt den ganzen Bestand still.
        expect(() => {
            assertSourceComplete({ ok: false, features: [weg()] });
        }).toThrow(MigrationAborted);
        expect(() => {
            assertSourceComplete({} as LegacyPayload);
        }).toThrow(MigrationAborted);
        expect(() => {
            assertSourceComplete({ features: [] });
        }).toThrow(MigrationAborted);
    });

    it("🔴 zählt Legacys Kreuzungen nur, in beiden Schreibweisen, und übernimmt keine (Version 3, WI-0132)", () => {
        // Seit Contract-Version 3: Das Netz entsteht aus Orten und Wegen (`routing/topology.ts`), Kreuzungsobjekte
        // kehren über den Import nicht zurück (Betreiber 2026-10-10).
        const punkt = { type: "Point", coordinates: [500, 500] };
        const result = transformPaths({
            features: [
                weg(),
                weg({ feature_type: "junction", public_id: "2", name: "Kreuzung" }, punkt),
                weg({ feature_type: "crossing", public_id: "3", name: "Kreuzung-41" }, punkt),
                weg({ feature_type: "location", public_id: "4", name: "Gareth" }),
            ],
        });
        expect(result.paths).toHaveLength(1);
        expect(result.crossingFeatures, "beide Schreibweisen zählen").toBe(2);
        expect(result.skippedOtherTypes).toBe(1);
        expect(result.rejected, "eine Kreuzung ist kein abgewiesener Weg").toEqual([]);
    });

    it("🪤 unterscheidet eine FEHLENDE Transportliste von einer LEEREN", () => {
        // Legacy: eine gespeicherte leere Liste heisst "hier faehrt nichts", eine fehlende heisst
        // "Vorgabe der Wegart" (client-graph.php#L1752-L1826). Beides muss getrennt ankommen.
        const result = transformPaths({
            features: [
                weg({ public_id: "11111111-0000-4000-8000-00000000003a" }),
                weg({ public_id: "11111111-0000-4000-8000-00000000003b", allowed_transports: [] }),
                weg({
                    public_id: "11111111-0000-4000-8000-00000000003c",
                    allowed_transports: ["lightRider", "groupFoot"],
                    transport_domain: "land",
                    flow: { dir: "forward", factor: 2 },
                    transport_seasons: {
                        groupFoot: { from_month: "ingerimm", from_day: 1, to_month: "efferd", to_day: 30 },
                    },
                }),
            ],
        });
        expect(result.paths.map((path) => path.allowedTransports)).toEqual([
            null,
            [],
            // Feste Reihenfolge, damit zwei gleiche Listen auch in SQL gleich sind.
            ["groupFoot", "lightRider"],
        ]);
        expect(result.paths[2]).toMatchObject({
            transportDomain: "land",
            flowFactor: 2,
            transportSeasons: { groupFoot: { from_month: "ingerimm", from_day: 1, to_month: "efferd", to_day: 30 } },
        });
        expect(result.paths[0]).toMatchObject({ transportDomain: null, flowFactor: null, transportSeasons: null });
    });

    it("🔴 weist einen Weg mit unlesbaren Routingdaten zurueck, statt sie zu verbiegen", () => {
        const result = transformPaths({
            features: [
                weg({ public_id: "11111111-0000-4000-8000-00000000004a", allowed_transports: ["drache"] }),
                weg({ public_id: "11111111-0000-4000-8000-00000000004b", transport_domain: "luft" }),
                weg({ public_id: "11111111-0000-4000-8000-00000000004c", flow: { dir: "forward", factor: 0.5 } }),
                weg({
                    public_id: "11111111-0000-4000-8000-00000000004d",
                    transport_seasons: {
                        groupFoot: { from_month: "januar", from_day: 1, to_month: "efferd", to_day: 30 },
                    },
                }),
            ],
        });
        expect(result.paths).toHaveLength(0);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
            'unbekanntes Transportmittel "drache"',
            'unbekannte transport_domain "luft"',
            "Strömungsfaktor 0.5 ist keine Zahl ab 1",
            'from_month "januar" ist kein aventurischer Monat',
        ]);
    });

    it("🪤 liest ein fehlendes `show_label` als AUS, wie Legacy auf beiden Seiten", () => {
        const result = transformPaths({
            features: [
                weg({ public_id: "11111111-0000-4000-8000-00000000000a", show_label: true }),
                weg({ public_id: "11111111-0000-4000-8000-00000000000b", show_label: false }),
                weg({ public_id: "11111111-0000-4000-8000-00000000000c" }),
                weg({ public_id: "11111111-0000-4000-8000-00000000000d", show_label: null }),
                weg({ public_id: "11111111-0000-4000-8000-00000000000e", show_label: 1 }),
                weg({ public_id: "11111111-0000-4000-8000-00000000000f", show_label: "1" }),
            ],
        });
        expect(result.paths.map((path) => path.labelVisible)).toEqual([true, false, false, false, true, true]);
    });

    it("🪤 macht aus `is_bach` kein eigenes Merkmal an einer fremden Wegart", () => {
        // Ein Bach ist ein FLUSSWEG mit einem Merkmal (Legacy, Owner 30.08.2026). Ein `is_bach` an
        // einer Strasse ist ein Datenfehler und wird nicht übernommen - das CHECK im Schema hielte
        // ihn sonst an, mitten im Lauf.
        const result = transformPaths({
            features: [
                weg({ public_id: "11111111-0000-4000-8000-00000000001a", feature_subtype: "Flussweg", is_bach: true }),
                weg({ public_id: "11111111-0000-4000-8000-00000000001b", feature_subtype: "Strasse", is_bach: true }),
            ],
        });
        expect(result.paths.map((path) => path.isBach)).toEqual([true, false]);
    });

    it("🔴 weist zurück, statt stillschweigend zu verschlucken", () => {
        const result = transformPaths({
            features: [
                weg({ feature_subtype: "Zauberpfad", public_id: "11111111-0000-4000-8000-00000000002a" }),
                weg({ name: "   ", public_id: "11111111-0000-4000-8000-00000000002b" }),
                weg({ public_id: "" }),
                weg(
                    { public_id: "11111111-0000-4000-8000-00000000002c" },
                    { type: "MultiLineString", coordinates: [] },
                ),
                weg(
                    { public_id: "11111111-0000-4000-8000-00000000002d" },
                    { type: "LineString", coordinates: [[1, 1]] },
                ),
            ],
        });
        expect(result.paths).toHaveLength(0);
        expect(result.rejected.map((entry) => entry.reason)).toEqual([
            "unbekannte Wegart Zauberpfad",
            "ohne Namen",
            "ohne public_id",
            "Geometrie ist MultiLineString, erwartet LineString",
            "weniger als zwei Stützpunkte",
        ]);
    });

    it("🪤 nimmt eine doppelte public_id nicht zweimal", () => {
        const result = transformPaths({ features: [weg(), weg()] });
        expect(result.paths).toHaveLength(1);
        expect(result.rejected[0]?.reason).toBe("public_id doppelt");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Wege importieren, gegen PostGIS", () => {
    let database: Database;

    const payload: LegacyPayload = {
        ok: true,
        revision: 1,
        features: [
            weg({
                public_id: "22222222-0000-4000-8000-000000000001",
                name: "Reichsstrasse 1",
                feature_subtype: "Reichsstrasse",
                show_label: true,
                allowed_transports: ["groupFoot", "caravan"],
                transport_domain: "land",
                transport_seasons: {
                    caravan: { from_month: "ingerimm", from_day: 1, to_month: "efferd", to_day: 30 },
                },
            }),
            weg({
                public_id: "22222222-0000-4000-8000-000000000002",
                name: "Bachlauf",
                feature_subtype: "Flussweg",
                is_bach: true,
            }),
            weg(
                { public_id: "22222222-0000-4000-8000-000000000003", name: "Kreuzung", feature_type: "junction" },
                { type: "Point", coordinates: [405, 402] },
            ),
        ],
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database.unsafe(`DELETE FROM path WHERE name IN ('Reichsstrasse 1', 'Bachlauf', 'Teststrasse')`);
        await database.unsafe(`DELETE FROM crossing WHERE public_id = '22222222-0000-4000-8000-000000000003'`);
    });

    afterAll(async () => {
        await database.unsafe(`DELETE FROM path WHERE name IN ('Reichsstrasse 1', 'Bachlauf', 'Teststrasse')`);
        await database.unsafe(`DELETE FROM crossing WHERE public_id = '22222222-0000-4000-8000-000000000003'`);
        // 🪤 Und das Lauftagebuch dazu (WI-0101): die Wege gingen, die `migration_run`-Zeilen blieben
        // liegen und wuchsen mit jedem Lauf. `NOT EXISTS` statt einer Marke, weil `paths` als Domäne
        // auch echten Importen gehört; es fällt nur, was niemand mehr nennt.
        await database.unsafe(`
            DELETE FROM migration_run
            WHERE data_domain = 'paths'
              AND NOT EXISTS (SELECT 1 FROM path WHERE path.migration_run_id = migration_run.id)
              AND NOT EXISTS (SELECT 1 FROM crossing WHERE crossing.migration_run_id = migration_run.id)
        `);
        await database.end({ timeout: 5 });
    });

    it("🔴 schreibt beim zweiten Lauf NICHTS", async () => {
        // Idempotenz heisst "tut nichts", nicht "endet gleich" (Kap. 9.32).
        const erst = await importPaths(database, payload);
        expect(erst.created).toBe(2);
        expect(erst.crossingsIgnored, "die Kreuzung wird gezählt, nicht übernommen").toBe(1);

        const zweit = await importPaths(database, payload);
        expect(zweit.created).toBe(0);
        expect(zweit.updated, "kein Schreibvorgang beim Wiederholen").toBe(0);
        expect(zweit.unchanged).toBe(2);
        expect(zweit.retired).toBe(0);
        expect(zweit.crossingsIgnored).toBe(1);
    });

    it("🔴 ein abgenommener Weg bleibt abgenommen, ein gelöschter kommt zurück (WI-0177 Stufe 3b, EDIT-0003 T43)", async () => {
        await importPaths(database, payload);
        const strasse = "22222222-0000-4000-8000-000000000001";
        const bach = "22222222-0000-4000-8000-000000000002";
        await database`UPDATE path SET is_active = FALSE, off_map = TRUE WHERE public_id = ${strasse}::uuid`;
        await database`UPDATE path SET is_active = FALSE WHERE public_id = ${bach}::uuid`;
        const lauf = await importPaths(database, payload);
        expect(lauf.updated, "nur der gelöschte Bach wird belebt").toBe(1);
        const stand = await database<{ public_id: string; aktiv: boolean; abgenommen: boolean }[]>`
            SELECT public_id::text, is_active AS aktiv, off_map AS abgenommen FROM path
             WHERE public_id = ANY(${[strasse, bach]}::uuid[]) ORDER BY public_id
        `;
        expect(stand).toEqual([
            { public_id: strasse, aktiv: false, abgenommen: true },
            { public_id: bach, aktiv: true, abgenommen: false },
        ]);
        await database`UPDATE path SET is_active = TRUE, off_map = FALSE WHERE public_id = ${strasse}::uuid`;
    });

    it("🔴 der Zug fasst „Tunnel“ nie an, auch wenn er den Abschnitt selbst neu schreibt (WI-0177, Migration 0172)", async () => {
        await importPaths(database, payload);
        const strasse = "22222222-0000-4000-8000-000000000001";
        try {
            // Ein anderer Name zwingt den Zug, die Zeile zu schreiben; das Merkmal aus dem Editor muss das überstehen.
            await database`UPDATE path SET is_tunnel = TRUE, name = 'Anders' WHERE public_id = ${strasse}::uuid`;
            const lauf = await importPaths(database, payload);
            expect(lauf.updated, "der Zug schreibt den Namen zurück").toBe(1);
            const [zeile] = await database<{ name: string; tunnel: boolean }[]>`
                SELECT name, is_tunnel AS tunnel FROM path WHERE public_id = ${strasse}::uuid
            `;
            expect(zeile?.name).not.toBe("Anders");
            expect(zeile?.tunnel).toBe(true);
        } finally {
            await database`UPDATE path SET is_tunnel = FALSE WHERE public_id = ${strasse}::uuid`;
        }
    });

    it("🔴 der Zug fasst das Kennzeichen „Karawanenroute“ nie an, auch wenn er den Abschnitt selbst neu schreibt (WI-0177 §30, Migration 0174)", async () => {
        await importPaths(database, payload);
        const strasse = "22222222-0000-4000-8000-000000000001";
        try {
            await database`UPDATE path SET mark = 'karawanenroute', name = 'Anders' WHERE public_id = ${strasse}::uuid`;
            const lauf = await importPaths(database, payload);
            expect(lauf.updated, "der Zug schreibt den Namen zurück").toBe(1);
            const [zeile] = await database<{ name: string; mark: string | null }[]>`
                SELECT name, mark FROM path WHERE public_id = ${strasse}::uuid
            `;
            expect(zeile?.name).not.toBe("Anders");
            expect(zeile?.mark).toBe("karawanenroute");
        } finally {
            await database`UPDATE path SET mark = NULL WHERE public_id = ${strasse}::uuid`;
        }
    });

    it("🔴 verify:paths: ein vom Editor abgenommener Weg fehlt dem Prüfer nicht, ein ganz gelöschter schon (WI-0177 Stufe 3b)", async () => {
        await importPaths(database, payload);
        const strasse = "22222222-0000-4000-8000-000000000001";
        const zaehlung = async () =>
            (await verifyPaths(database, payload)).checks.find((check) => check.name === "wege_vollzaehlig");
        try {
            await database`UPDATE path SET is_active = FALSE, off_map = TRUE WHERE public_id = ${strasse}::uuid`;
            const abgenommen = await zaehlung();
            expect(abgenommen?.detail).toContain("(ohne 1 vom Editor abgenommene)");
            expect(abgenommen?.offenders ?? []).not.toContain(`fehlt: ${strasse}`);
            // Ganz gelöscht ist kein Stand, den der Zug achtet: Er fehlt.
            await database`UPDATE path SET off_map = FALSE WHERE public_id = ${strasse}::uuid`;
            const geloescht = await zaehlung();
            expect(geloescht?.passed).toBe(false);
            expect(geloescht?.offenders).toContain(`fehlt: ${strasse}`);
            expect(geloescht?.detail).not.toContain("abgenommene");
        } finally {
            await database`UPDATE path SET is_active = TRUE, off_map = FALSE WHERE public_id = ${strasse}::uuid`;
        }
    });

    it("🔴 der Wegeimport schreibt keine Kreuzung (Version 3, WI-0132 Release N)", async () => {
        // Die Tabelle `crossing` bleibt bis Release N+1 als Rückweg stehen; der Import fasst sie nicht mehr an.
        const kreuzung = "22222222-0000-4000-8000-000000000003";
        await importPaths(database, payload);
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM crossing WHERE public_id = ${kreuzung}
        `;
        expect(row?.n, "keine Zeile für die Kreuzung des Snapshots").toBe(0);
        const [run] = await database<{ journal: Record<string, unknown> }[]>`
            SELECT journal FROM migration_run WHERE data_domain = 'paths' AND status = 'completed'
            ORDER BY completed_at DESC LIMIT 1
        `;
        expect(run?.journal["crossings_ignored"], "das Journal nennt die gezählten Kreuzungen").toBe(1);
        expect(run?.journal, "und keine geschriebenen").not.toHaveProperty("crossings");
    });

    it("🔴 verify:paths: eine abweichende Parität ist ein Befund, das Urteil bleibt grün (Betreiber 2026-10-03)", async () => {
        await database`UPDATE path SET label_visible = NOT label_visible WHERE name = 'Reichsstrasse 1'`;
        try {
            const report = await verifyPaths(database, payload);
            const steuerung = report.checks.find((check) => check.name === "beschriftungssteuerung_erhalten");
            expect(steuerung).toMatchObject({ passed: false, blocking: false });
            expect(steuerung?.offenders).toContain("22222222-0000-4000-8000-000000000001");
            expect(report.passed, "keine Prüfung der Liste fiel aus").toBe(true);
            const befunde = checkFindings("verify:paths", report.checks, (check) => check.passed);
            expect(befunde.map((befund) => befund.code)).toContain("verify:paths/beschriftungssteuerung_erhalten");
        } finally {
            await database`UPDATE path SET label_visible = NOT label_visible WHERE name = 'Reichsstrasse 1'`;
        }
    });

    it("💣 legt das Saisonfenster als OBJEKT ab, nicht als JSON-Zeichenkette", async () => {
        // Regressionsfall vom 2026-09-23: vorkodiert (JSON.stringify) kodierte postgres.js ein
        // zweites Mal, und alle 99 Fenster standen als Zeichenkette in der Spalte. Der Router
        // haette sie nie als Sperre erkannt - ohne jede Fehlermeldung.
        const [row] = await database<{ typ: string; fenster: string; transporte: string[]; bach: string[] | null }[]>`
            SELECT jsonb_typeof(p.transport_seasons) AS typ,
                   p.transport_seasons -> 'caravan' ->> 'from_month' AS fenster,
                   p.allowed_transports AS transporte,
                   b.allowed_transports AS bach
            FROM path p, path b
            WHERE p.name = 'Reichsstrasse 1' AND b.name = 'Bachlauf'
        `;
        expect(row?.typ).toBe("object");
        expect(row?.fenster).toBe("ingerimm");
        expect(row?.transporte, "feste Reihenfolge der Transportmittel").toEqual(["caravan", "groupFoot"]);
        expect(row?.bach, "keine Liste gespeichert heisst NULL, nicht leer").toBeNull();
    });

    it("💣 legt die Geometrie mit SRID 0 ab, nicht mit 4326", async () => {
        // ST_GeomFromGeoJSON liefert 4326, auch bei Koordinaten 0..1024. Ohne ST_SetSRID bricht
        // jede Verknuepfung mit Zielgeometrie ab - und wo sie nicht bricht, rechnet sie falsch.
        const [row] = await database<{ srid: number; typ: string }[]>`
            SELECT ST_SRID(geom) AS srid, GeometryType(geom) AS typ
            FROM path WHERE name = 'Reichsstrasse 1'
        `;
        expect(row?.srid).toBe(0);
        expect(row?.typ).toBe("LINESTRING");
    });

    it("🪤 haelt im Schema fest, dass ein Bach ein Flussweg ist", async () => {
        // Die Regel stammt aus dem Fachmodell und ueberlebt so auch einen Import, der sie nicht
        // kennt - ein CHECK, keine Anwendungslogik.
        await expect(
            database.unsafe(`
                INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system)
                VALUES ('33333333-0000-4000-8000-000000000001', 'aventuria', 'Falscher Bach', 'Strasse', TRUE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(400,400), ST_MakePoint(401,401)), 0), 'test')`),
        ).rejects.toThrow(/path_bach_ist_flussweg/);
    });

    it("🔴 meldet eine Stilllegung über 5 % als Befund mit Zahlen und Namen, der Lauf geht durch (Betreiber 2026-10-03)", async () => {
        // Ein Snapshot aus einem halben Abruf sieht aus wie eine Massenloeschung. Früher hielt eine Schwelle von 5 %
        // den Lauf an; jetzt legt er still und der Bericht sagt, wie viele und welche.
        const [aktiv] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM path
            WHERE map_domain_id = 'aventuria' AND source_system = 'legacy' AND is_active
        `;
        const wegeAktiv = aktiv?.n ?? 0;
        const fast_leer: LegacyPayload = { ok: true, revision: 2, features: [payload.features?.[0] as never] };
        const report = await importPaths(database, fast_leer);

        expect(report.retired).toBeGreaterThanOrEqual(1);
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM path WHERE name = 'Bachlauf' AND is_active
        `;
        expect(row?.n, "der Lauf hat den Bachlauf stillgelegt").toBe(0);

        // Seit Version 3 nur noch die Wege: Kreuzungen legt der Import weder an noch still.
        expect(report.findings.map((finding) => finding.code)).toEqual(["stilllegequote"]);
        const [wege] = report.findings;
        expect(wege?.numbers).toMatchObject({ table: "path", active: wegeAktiv, retiring: report.retired });
        expect(wege?.objects).toContainEqual({
            table: "path",
            publicId: "22222222-0000-4000-8000-000000000002",
            name: "Bachlauf",
        });
    });

    /**
     * Die Grenze der Routingattribute aus `paths.yaml` Version 2 — als Test statt nur als Prosa.
     *
     * Seit WI-0017 R1 (Betreiberfreigabe 2026-09-23) kommen GENAU vier Routingattribute herein.
     * `befahrbar` bleibt draussen: Legacys Routing liest es nicht (MCS-017).
     */
    it("🔴 nimmt genau die vier Routingattribute herein und laesst befahrbar draussen", async () => {
        const spalten = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'path'
        `;
        const namen = spalten.map((zeile) => zeile.column_name);

        for (const herein of ["allowed_transports", "transport_domain", "transport_seasons", "flow_factor"]) {
            expect(namen, `${herein} ist Routingattribut (Contract Version 2)`).toContain(herein);
        }
        expect(namen, "befahrbar liest Legacys Routing nicht").not.toContain("befahrbar");
        expect(namen).toContain("flow_direction");
    });

    it("🪤 zeichnet Kreuzungen nicht: keine Renderrelation", async () => {
        const [zeile] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'crossing%render%'
        `;
        expect(zeile?.n, "Kreuzungen sind keine Kartenobjekte").toBe(0);
    });
});
