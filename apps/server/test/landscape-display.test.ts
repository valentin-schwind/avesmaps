import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS, LandscapeDisplayError } from "@avesmaps3d/shared";
import { checkFindings } from "../src/blocking-checks.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { loadCurveRegions } from "../src/derive/refresh-label-curve.ts";
import { verifyRuns } from "../src/derive/verify-runs.ts";
import {
    importLandscapeDisplay,
    landscapeDisplayFromBytes,
    requestLandscapeDisplay,
    summarizeLandscapeDisplay,
    type LandscapeDisplayInput,
} from "../src/migration/landscape-display.ts";
import { verifyLandscapeDisplay } from "../src/migration/verify-landscape-display.ts";

/**
 * Die Darstellungstafel der Landschaften (WI-0064): Lesen der Antwort, Import, Pruefer und Wirkung auf die Kachelansichten,
 * gegen echtes PostgreSQL (Kapitel 11.10).
 *
 * Die Fixture ist die Live-Antwort von Legacys `ecosystem-display.php` vom 2026-09-29 (Stempel 1788310790), nur formatiert. Ihr
 * Inhalt ist der wirkliche: 8 Baenderzeilen (wald ab 5, dschungel ab 3 ...), 24 Groessenzeilen, drift 150, Gipfel fest.
 *
 * 💣 Die Wirkung wird an der ECHTEN Ansicht gemessen (`map_label_render`, `landscape_label_run_render`), nicht an einem selbst
 * gebauten Ausdruck: die Lehre aus `label-style-properties.test.ts`.
 */

const FIXTURE = new URL("./fixtures/ecosystem-display-2026-09-29.json", import.meta.url);
const live = (): LandscapeDisplayInput => landscapeDisplayFromBytes(readFileSync(FIXTURE));

function mitAenderung(aender: (display: Record<string, unknown>) => void, stamp = "1788999999"): LandscapeDisplayInput {
    const body = JSON.parse(readFileSync(FIXTURE, "utf8")) as { display: Record<string, unknown>; stamp: string };
    aender(body.display);
    body.stamp = stamp;
    return landscapeDisplayFromBytes(Buffer.from(JSON.stringify(body)));
}

describe("die Antwortdatei lesen", () => {
    it("liest die Live-Antwort und nennt den SHA-256 der Bytes", () => {
        const input = live();
        expect(input.response.stamp).toBe("1788310790");
        expect(input.response.overrides.vorgabe["wald"]).toEqual({ ab: 5, bis: 7, curveMax: 1, prio: 3 });
        expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(input.bytes).toBe(readFileSync(FIXTURE).byteLength);
    });

    it("ein BOM am Anfang ist kein Inhalt (so liegt der Schnappschuss vom 2026-09-21), aendert aber den SHA-256", () => {
        const roh = readFileSync(FIXTURE);
        const mitBom = landscapeDisplayFromBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), roh]));
        expect(mitBom.response.stamp).toBe("1788310790");
        expect(mitBom.sha256).not.toBe(live().sha256);
    });

    it("🔴 eine Antwort ohne Stempel (Legacys Endpunkt faellt offen aus) bricht ab, statt die Vorgaben zu nehmen", () => {
        const ausfall = Buffer.from(JSON.stringify({ ok: true, display: null, stamp: "" }));
        expect(() => landscapeDisplayFromBytes(ausfall)).toThrow(LandscapeDisplayError);
        expect(() => landscapeDisplayFromBytes(Buffer.from("<html>502</html>"))).toThrow(/kein JSON/);
    });
});

describe("die Antwort holen (ein Abruf, keine Schleife)", () => {
    const antwort = (status: number, body: string | Buffer): typeof fetch =>
        (() => Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

    it("liefert die Bytes unveraendert zurueck, damit die Datei denselben SHA-256 traegt wie der Bericht", async () => {
        const roh = readFileSync(FIXTURE);
        const { input, bytes } = await requestLandscapeDisplay({
            url: "http://probe.test/x",
            fetcher: antwort(200, roh),
        });
        expect(bytes.equals(roh)).toBe(true);
        expect(input.sha256).toBe(live().sha256);
    });

    it("ruft genau einmal ab und sendet keine bedingten Kopfzeilen (STRATO entfernt den ETag aus Antworten mit Rumpf)", async () => {
        const gesehen: { url: string; init: RequestInit | undefined }[] = [];
        const fetcher = ((url: string, init?: RequestInit) => {
            gesehen.push({ url: String(url), init });
            return Promise.resolve(new Response(readFileSync(FIXTURE), { status: 200 }));
        }) as unknown as typeof fetch;
        await requestLandscapeDisplay({ url: "http://probe.test/x", fetcher });
        expect(gesehen).toHaveLength(1);
        expect(gesehen[0]?.init).toBeUndefined();
    });

    it("🔴 jede andere Antwort als 200 scheitert laut; eine Antwort ohne Stempel ist ein Ausfall, nicht 'nichts uebersteuert'", async () => {
        await expect(
            requestLandscapeDisplay({ url: "http://probe.test/x", fetcher: antwort(503, "") }),
        ).rejects.toThrow(/HTTP 503/);
        await expect(
            requestLandscapeDisplay({
                url: "http://probe.test/x",
                fetcher: antwort(200, '{"ok":true,"display":null,"stamp":""}'),
            }),
        ).rejects.toThrow(LandscapeDisplayError);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "aventuria";
const ID = (n: number): string => `64646464-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describeWithDatabase("Darstellungstafel importieren, pruefen und anwenden, gegen PostGIS", () => {
    let database: Database;

    async function tafelLeeren(): Promise<void> {
        await database`DELETE FROM landscape_display_art WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM landscape_display_source WHERE map_domain_id = ${DOMAIN}`;
    }

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM landscape_label_run WHERE region_id IN (SELECT id FROM region WHERE public_id::text LIKE '64646464-%')`;
        await database`UPDATE region SET primary_label_id = NULL WHERE public_id::text LIKE '64646464-%'`;
        await database`DELETE FROM map_label WHERE public_id::text LIKE '64646464-%'`;
        await database`DELETE FROM region WHERE public_id::text LIKE '64646464-%'`;
        await tafelLeeren();
        await database`DELETE FROM migration_run WHERE data_domain = 'landscape_display'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
    }, 120_000);

    beforeEach(tafelLeeren);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    async function zeilen(): Promise<Map<string, Record<string, unknown>>> {
        const rows = await database<Record<string, unknown>[]>`
            SELECT art_key, band_from, band_to, curve_max, priority, size_by_band::float8[] AS sizes
            FROM landscape_display_art WHERE map_domain_id = ${DOMAIN}
        `;
        return new Map(rows.map((row) => [row.art_key as string, row]));
    }

    it("🔴 der Erstimport legt jede Art der wirksamen Tafel und die Grundvorgabe an; der Pruefer findet Paritaet", async () => {
        const report = await importLandscapeDisplay(database, live());
        // 33 Arten aus Vorgaben und Uebersteuerung (siehe packages/shared/test) plus die Grundvorgabe.
        expect(report.arts).toEqual({ created: 34, updated: 0, unchanged: 0, retired: 0 });
        expect(report.changed).toBe(true);
        expect(report.runId).not.toBeNull();
        expect(report.overrides).toMatchObject({ vorgabe: 8, groesse: 24, kollision: 2, global: 3, abstaende: 2 });
        expect(report.unapplied).toEqual({ farbe: 1, flaeche: 1, kurve: 1 });
        expect(summarizeLandscapeDisplay(report)).toContain("Stempel 1788310790");

        const tafel = await zeilen();
        expect(tafel.size).toBe(34);
        // Die Uebersteuerung schlaegt die Vorgabe (wald ab 4 -> 5), die Vorgabe der Art die Grundvorgabe (gebirge ab 2).
        // 🔴 Legacys Obergrenze 7 steht im Ziel als 8 (WI-0129, Betreiber 2026-10-10 E2 A); „bis 3“ bleibt 3.
        expect(tafel.get("wald")).toMatchObject({ band_from: 5, band_to: 8, curve_max: 1, priority: 3 });
        expect(tafel.get("gebirge")).toMatchObject({ band_from: 2, band_to: 8 });
        expect(tafel.get("kontinent")).toMatchObject({ band_from: 0, band_to: 3 });
        expect(tafel.get("dschungel")).toMatchObject({ band_from: 3, band_to: 8 });
        expect(tafel.get("*")).toMatchObject({ band_from: 0, band_to: 8, curve_max: 1, priority: 3 });
        expect(tafel.get("gebirge")?.["sizes"]).toEqual([9, 11, 16, 18, 20, 22, 24, 26, 28]);
        // Die drei Arten, die Legacys Groessentafel nicht kennt, tragen Legacys Vorgabekurve - nicht die einer Nachbarart.
        expect(tafel.get("dschungel")?.["sizes"]).toEqual(AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS.sizeByBand);

        const pruefer = await verifyLandscapeDisplay(database, live());
        expect(pruefer.checks.filter((c) => !c.passed)).toEqual([]);
        expect(pruefer.passed).toBe(true);
        expect(pruefer.checks.map((c) => c.name)).toEqual([
            "arten",
            "baender",
            "groessen",
            "paritaet",
            "herkunft",
            "wirkung",
        ]);
    });

    it("🔴 der zweite Lauf mit demselben Stand aendert nichts und legt keinen Lauf an", async () => {
        await importLandscapeDisplay(database, live());
        const [vorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'landscape_display'`;
        const zweiter = await importLandscapeDisplay(database, live());
        expect(zweiter.changed).toBe(false);
        expect(zweiter.runId).toBeNull();
        expect(zweiter.arts).toEqual({ created: 0, updated: 0, unchanged: 34, retired: 0 });
        const [nachher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'landscape_display'`;
        expect(nachher?.n).toBe(vorher?.n);
    });

    it("ein neuer Stand aendert genau, was sich aendert, und raeumt eine Art weg, die nirgends mehr vorkommt", async () => {
        await importLandscapeDisplay(database, live());
        // wald ab 6 statt 5; dschungel (nur in der Uebersteuerung) entfaellt; ein neuer Stempel.
        const neu = mitAenderung((display) => {
            (display["vorgabe"] as Record<string, unknown>)["wald"] = { ab: 6, bis: 7, curveMax: 1, prio: 3 };
            delete (display["vorgabe"] as Record<string, unknown>)["dschungel"];
        });
        const report = await importLandscapeDisplay(database, neu);
        expect(report.arts).toEqual({ created: 0, updated: 1, unchanged: 32, retired: 1 });
        const tafel = await zeilen();
        expect(tafel.get("wald")).toMatchObject({ band_from: 6 });
        expect(tafel.has("dschungel")).toBe(false);
        const [herkunft] = await database<{ stamp: string }[]>`
            SELECT stamp FROM landscape_display_source WHERE map_domain_id = ${DOMAIN}`;
        expect(herkunft?.stamp).toBe("1788999999");
        expect((await verifyLandscapeDisplay(database, neu)).passed).toBe(true);
    });

    it("🔴 ein Widerspruch bricht ab, BEVOR eine Zeile geschrieben ist", async () => {
        await importLandscapeDisplay(database, live());
        const widerspruch = mitAenderung((display) => {
            (display["vorgabe"] as Record<string, unknown>)["kontinent"] = { ab: 5 };
        });
        await expect(importLandscapeDisplay(database, widerspruch)).rejects.toThrow(/kontinent.*widerspruechlich/);
        const tafel = await zeilen();
        expect(tafel.get("kontinent")).toMatchObject({ band_from: 0, band_to: 3 });
        const [herkunft] = await database<{ stamp: string }[]>`
            SELECT stamp FROM landscape_display_source WHERE map_domain_id = ${DOMAIN}`;
        expect(herkunft?.stamp).toBe("1788310790");
    });

    it("🔴 Legacys bis = -1 bleibt aus, ab 7 bleibt 7 und endet als Ziel bei 8 (WI-0129)", async () => {
        const satz = mitAenderung((display) => {
            (display["vorgabe"] as Record<string, unknown>)["wald"] = { ab: 7, bis: 7, curveMax: 1, prio: 3 };
            (display["vorgabe"] as Record<string, unknown>)["urwald"] = { ab: 5, bis: -1, curveMax: 1, prio: 3 };
        });
        await importLandscapeDisplay(database, satz);
        const tafel = await zeilen();
        expect(tafel.get("wald")).toMatchObject({ band_from: 7, band_to: 8 });
        expect(tafel.get("urwald")).toMatchObject({ band_from: 5, band_to: -1 });
        expect(tafel.get("kontinent")).toMatchObject({ band_from: 0, band_to: 3 });
        const pruefer = await verifyLandscapeDisplay(database, satz);
        expect(pruefer.checks.filter((c) => !c.passed)).toEqual([]);
        // Ein zweiter Lauf derselben Quelle ändert nichts: ein Ziel 8 wird nie wieder 7.
        expect((await importLandscapeDisplay(database, satz)).changed).toBe(false);
    });

    it("🔴 die Tabelle nimmt das Ziel bis Stufe 8 an (Migration 0096), Stufe 9 nicht", async () => {
        await database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                       VALUES (${DOMAIN}, 'probe', 8, 8, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`;
        await expect(
            database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                     VALUES (${DOMAIN}, 'probe_neun', 1, 9, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`,
        ).rejects.toThrow(/landscape_display_art_band_to_check/);
        await expect(
            database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                     VALUES (${DOMAIN}, 'probe_ab', 9, -1, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`,
        ).rejects.toThrow(/landscape_display_art_band_from_check/);
    });

    it("die Tabelle selbst lehnt ein Band ab, das vor seinem Anfang endet, und eine Groessenzeile mit zehn Werten", async () => {
        await expect(
            database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                     VALUES (${DOMAIN}, 'probe', 5, 3, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`,
        ).rejects.toThrow(/landscape_display_art_band/);
        await expect(
            database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                     VALUES (${DOMAIN}, 'probe', 1, 3, 1, 3, '{9,9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`,
        ).rejects.toThrow(/landscape_display_art_sizes/);
        // 'aus' ist erlaubt.
        await database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                       VALUES (${DOMAIN}, 'probe', 5, -1, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`;
    });

    describe("die Wirkung auf die Kachelansichten", () => {
        interface Etikett {
            id: number;
            nummer: number;
            min?: number | null;
            max?: number | null;
            size?: number | null;
            priority?: number | null;
            subtype: string | null;
        }
        const labels: Record<string, Etikett> = {};

        beforeAll(async () => {
            const einfuegen = async (
                nummer: number,
                name: string,
                etikett: Omit<Etikett, "id" | "nummer">,
            ): Promise<void> => {
                const [row] = await database<{ id: string }[]>`
                    INSERT INTO map_label (public_id, map_domain_id, name, subtype, geom, is_active,
                                           label_min_zoom, label_max_zoom, label_size, label_priority)
                    VALUES (${ID(nummer)}, ${DOMAIN}, ${name}, ${etikett.subtype}, ST_SetSRID(ST_MakePoint(500, 500), 0), true,
                            ${etikett.min ?? null}, ${etikett.max ?? null}, ${etikett.size ?? null}, ${etikett.priority ?? null})
                    RETURNING id::text`;
                labels[name] = { ...etikett, id: Number(row?.id), nummer };
            };
            await einfuegen(1, "Eigen", { subtype: "wald", min: 2, max: 6, size: 20, priority: 4 });
            await einfuegen(2, "Ohne", { subtype: "wald" });
            await einfuegen(3, "Halb", { subtype: "wald", min: 2 });
            await einfuegen(4, "Ohne Zeile", { subtype: "tundra" });
            await einfuegen(5, "Nur Uebersteuerung", { subtype: "dschungel" });
            await einfuegen(6, "Ohne Art", { subtype: null });
        });

        async function wirksam(name: string): Promise<Record<string, unknown> | undefined> {
            const [row] = await database<Record<string, unknown>[]>`
                SELECT e.label_size::float8 AS size, e.label_min_zoom AS min, e.label_max_zoom AS max,
                       e.label_priority AS priority, e.curve_max
                FROM map_label_effective e JOIN map_label l ON l.id = e.label_id
                WHERE l.public_id = ${ID(labels[name]?.nummer ?? 0)}`;
            return row;
        }

        it("ohne Tafel bleibt alles, wie es war: der eigene Wert, sonst nichts", async () => {
            expect(await wirksam("Eigen")).toMatchObject({ size: 20, min: 2, max: 6, priority: 4, curve_max: null });
            expect(await wirksam("Ohne")).toMatchObject({ size: null, min: null, max: null, priority: null });
            // Ein halbes Band bleibt halb: ohne Tafel steht nichts daneben.
            expect(await wirksam("Halb")).toMatchObject({ min: 2, max: null });
        });

        it("🔴 das eigene Band gewinnt gegen die Tafel: wald ab 5 aendert Eigen (2..6) nicht", async () => {
            await importLandscapeDisplay(database, live());
            expect(await wirksam("Eigen")).toMatchObject({ size: 20, min: 2, max: 6, priority: 4 });
        });

        it("wo ein Label keinen eigenen Wert hat, gilt die Tafel seiner Art, sonst die Grundvorgabe", async () => {
            await importLandscapeDisplay(database, live());
            // wald: Band 5..8 (Uebersteuerung, Legacys bis 7 als Ziel 8), Prioritaet 3, Grundgroesse = Tafelwert bei z5 (18).
            expect(await wirksam("Ohne")).toMatchObject({ size: 18, min: 5, max: 8, priority: 3, curve_max: 1 });
            // dschungel: nur in der Uebersteuerung (ab 3), Groesse aus Legacys Vorgabekurve bei z5 (18).
            expect(await wirksam("Nur Uebersteuerung")).toMatchObject({ min: 3, max: 8, size: 18 });
            // tundra kennt keine Tafel, gilt die Grundvorgabe 0..8 - ebenso ein Label ganz ohne Art.
            expect(await wirksam("Ohne Zeile")).toMatchObject({ min: 0, max: 8, priority: 3 });
            expect(await wirksam("Ohne Art")).toMatchObject({ min: 0, max: 8, priority: 3 });
        });

        it("🔴 ein Band gilt nur mit BEIDEN Enden als eigenes (Legacy avesmapsLabelImBand): ein halbes wird durch das der Tafel ersetzt", async () => {
            await importLandscapeDisplay(database, live());
            expect(await wirksam("Halb")).toMatchObject({ min: 5, max: 8 });
        });

        it("'aus' (bis = -1) macht ein Label ohne eigenes Band unsichtbar, nicht sichtbar auf Stufe 0", async () => {
            await importLandscapeDisplay(
                database,
                mitAenderung((display) => {
                    (display["vorgabe"] as Record<string, unknown>)["wald"] = { bis: -1 };
                }),
            );
            const aus = await wirksam("Ohne");
            expect(aus).toMatchObject({ min: 4, max: -1 });
            // Der Stilfilter verlangt zoom >= min + 1 UND zoom <= max + 1: mit max = -1 nie erfuellt.
            const aktiv = Number(aus?.["min"]) + 1;
            const bis = Number(aus?.["max"]) + 1;
            expect(
                Array.from({ length: 10 }, (_, zoom) => zoom).filter((zoom) => zoom >= aktiv && zoom <= bis),
            ).toEqual([]);
        });

        it("beide Kachelansichten tragen die wirksamen Werte und den Rang aus dem wirksamen Erscheinungsband", async () => {
            await importLandscapeDisplay(database, live());
            const [punkt] = await database<Record<string, unknown>[]>`
                SELECT label_size::float8 AS size, label_min_zoom AS min, label_max_zoom AS max, label_priority AS priority,
                       collision_rank
                FROM map_label_render WHERE public_id = ${ID(2)}`;
            expect(punkt).toMatchObject({ size: 18, min: 5, max: 8, priority: 3 });
            // Der Rang rechnet aus Prioritaet UND Erscheinungsband: dasselbe Label mit eigenem ab 5 haette denselben Rang.
            const [rang] = await database<{ rank: number }[]>`
                SELECT label_collision_rank(NULL::smallint, 3::smallint, 5::smallint) AS rank`;
            expect(punkt?.["collision_rank"]).toBe(rang?.rank);

            // Der Schriftlauf: die Ansicht der Laeufe liest dieselben Werte fuer das Stillabel.
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active)
                VALUES (${ID(100)}, ${DOMAIN}, 'Testlauf', 'vegetation', true) RETURNING id::text`;
            await database`UPDATE map_label SET region_id = ${Number(region?.id)} WHERE public_id = ${ID(2)}`;
            await database`INSERT INTO landscape_label_run (region_id, style_label_id, instance, instance_count, run_min_zoom, run_max_zoom,
                                                          name_width_px, geom, source_fingerprint, algorithm_version)
                           VALUES (${Number(region?.id)}, ${labels["Ohne"]?.id ?? 0}, 0, 1, 6, 8, 80,
                                   ST_SetSRID(ST_GeomFromText('LINESTRING(500 500, 520 500)'), 0), 'test', 1)`;
            const [lauf] = await database<Record<string, unknown>[]>`
                SELECT label_size::float8 AS size, label_min_zoom AS min, label_max_zoom AS max, collision_rank
                FROM landscape_label_run_render WHERE region_public_id = ${ID(100)}`;
            expect(lauf).toMatchObject({ size: 18, min: 5, max: 8 });
            expect(lauf?.["collision_rank"]).toBe(rang?.rank);
            await database`DELETE FROM landscape_label_run WHERE region_id = ${Number(region?.id)}`;
            await database`UPDATE map_label SET region_id = NULL WHERE public_id = ${ID(2)}`;
            await database`DELETE FROM region WHERE id = ${Number(region?.id)}`;
        });

        it("🔴 „Regionname anzeigen“ aus verbirgt den Namen in beiden Ansichten; ein fehlender Wert zeigt ihn (Legacy `!== false`)", async () => {
            // Betreiber 2026-10-09 an „See-281“ auf Stage: „ein blick in legacy zeigt, dass sie "auto-name" sind“ (Migration 0084).
            const sichtbar = async (): Promise<boolean> => {
                const [row] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM map_label_render WHERE public_id = ${ID(2)}`;
                return (row?.n ?? 0) === 1;
            };
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active)
                VALUES (${ID(101)}, ${DOMAIN}, 'See-281', 'topographie', true) RETURNING id::text`;
            await database`UPDATE map_label SET region_id = ${Number(region?.id)} WHERE public_id = ${ID(2)}`;
            await database`INSERT INTO landscape_label_run (region_id, style_label_id, instance, instance_count, run_min_zoom, run_max_zoom,
                                                          name_width_px, geom, source_fingerprint, algorithm_version)
                           VALUES (${Number(region?.id)}, ${labels["Ohne"]?.id ?? 0}, 0, 1, 6, 8, 80,
                                   ST_SetSRID(ST_GeomFromText('LINESTRING(500 500, 520 500)'), 0), 'test', 1)`;
            const laeufe = async (): Promise<number> => {
                const [row] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM landscape_label_run_render WHERE region_public_id = ${ID(101)}`;
                return row?.n ?? 0;
            };
            try {
                for (const [wert, erwartet] of [
                    [null, true],
                    [true, true],
                    [false, false],
                ] as const) {
                    await database`UPDATE map_label SET show_name = ${wert} WHERE public_id = ${ID(2)}`;
                    expect(await sichtbar(), `show_name ${String(wert)}: Punktname`).toBe(erwartet);
                    expect(await laeufe(), `show_name ${String(wert)}: Schriftlauf`).toBe(erwartet ? 1 : 0);
                }
            } finally {
                await database`UPDATE map_label SET show_name = NULL WHERE public_id = ${ID(2)}`;
                await database`DELETE FROM landscape_label_run WHERE region_id = ${Number(region?.id)}`;
                await database`UPDATE map_label SET region_id = NULL WHERE public_id = ${ID(2)}`;
                await database`DELETE FROM region WHERE id = ${Number(region?.id)}`;
            }
        });

        it("der Pruefer misst die Wirkung am Bestand und findet, wo die Tafel eingreift", async () => {
            await importLandscapeDisplay(database, live());
            const bericht = await verifyLandscapeDisplay(database, live());
            expect(bericht.passed).toBe(true);
            expect(bericht.findings.join("\n")).toMatch(/ohne vollstaendiges eigenes Band .*: [2-9]\d*/);
            // tundra kommt im Bestand vor und steht in keiner Zeile: sie erbt die Grundvorgabe.
            expect(bericht.findings.join("\n")).toMatch(/ohne eigene Zeile.*tundra/);
        });

        it("die Ableitung der Schriftlaeufe rechnet mit den wirksamen Werten (Band, Groesse, Hoechstzahl)", async () => {
            await importLandscapeDisplay(database, live());
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active, label_curve_enabled)
                VALUES (${ID(101)}, ${DOMAIN}, 'Testkurve', 'vegetation', true, true) RETURNING id::text`;
            await database`UPDATE map_label SET region_id = ${Number(region?.id)} WHERE public_id = ${ID(2)}`;
            await database`UPDATE region SET primary_label_id = ${labels["Ohne"]?.id ?? 0} WHERE id = ${Number(region?.id)}`;
            const [eingabe] = await loadCurveRegions(database, ID(101));
            expect(eingabe?.input).toMatchObject({ labelMinZoom: 5, labelMaxZoom: 8, labelSize: 18, curveMax: 1 });
            // Ohne die Tafel gaelten die alten Ersatzwerte (2..8, 18, 1): sie stehen nur noch fuer eine leere Tabelle. Das
            // Maximum ist Legacys Vorgabe 7 („bis ganz nah“) im Ziel, also 8 (WI-0129).
            await tafelLeeren();
            const [ohne] = await loadCurveRegions(database, ID(101));
            expect(ohne?.input).toMatchObject({ labelMinZoom: 2, labelMaxZoom: 8, labelSize: 18, curveMax: 1 });
            // Der Verifier der Laeufe liest dieselbe Ansicht und meldet kein Loch, wo keines ist.
            expect((await verifyRuns(database)).checks.find((c) => c.name === "I2_baender_lueckenlos")?.passed).toBe(
                true,
            );
            await database`UPDATE region SET primary_label_id = NULL WHERE id = ${Number(region?.id)}`;
            await database`UPDATE map_label SET region_id = NULL WHERE public_id = ${ID(2)}`;
            await database`DELETE FROM region WHERE id = ${Number(region?.id)}`;
        });
    });

    describe("der Pruefer schlaegt an, wenn Tafel und Datei auseinanderlaufen", () => {
        it("meldet eine geaenderte Zeile, eine fehlende Art, eine fremde Art und eine andere Herkunft", async () => {
            await importLandscapeDisplay(database, live());
            await database`UPDATE landscape_display_art SET band_from = 1 WHERE map_domain_id = ${DOMAIN} AND art_key = 'meer'`;
            await database`DELETE FROM landscape_display_art WHERE map_domain_id = ${DOMAIN} AND art_key = 'see'`;
            await database`INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
                           VALUES (${DOMAIN}, 'fremd', 0, 7, 1, 3, '{9,9,9,9,9,9,9,9,9}'::numeric(4,1)[])`;
            await database`UPDATE landscape_display_source SET sha256 = repeat('0', 64) WHERE map_domain_id = ${DOMAIN}`;
            const bericht = await verifyLandscapeDisplay(database, live());
            // Betreiber 2026-10-03 („A auch für die Prüfungen“): Die Parität der Tafel hält den Zug nicht mehr an. Die
            // Prüfungen schlagen an und stehen als Befund da; das Urteil bleibt grün.
            expect(bericht.passed).toBe(true);
            const durchgefallen = new Map(bericht.checks.filter((c) => !c.passed).map((c) => [c.name, c]));
            expect([...durchgefallen.keys()].sort()).toEqual(["arten", "herkunft", "paritaet"]);
            expect(durchgefallen.get("arten")?.offenders).toEqual(
                expect.arrayContaining(["fehlt: see", "zu viel: fremd"]),
            );
            expect(durchgefallen.get("paritaet")?.offenders?.[0]).toMatch(/^meer: Band 1\.\.8 statt 2\.\.8/);
            for (const entry of durchgefallen.values()) expect(entry.blocking, entry.name).toBe(false);
            const befunde = checkFindings("verify:landscape-display", bericht.checks, (c) => c.passed);
            expect(befunde.map((befund) => befund.code).sort()).toEqual([
                "verify:landscape-display/arten",
                "verify:landscape-display/herkunft",
                "verify:landscape-display/paritaet",
            ]);
        });

        it("🔴 eine fehlende Art allein ist ein Befund: das Urteil bleibt grün (Betreiber 2026-10-03)", async () => {
            await importLandscapeDisplay(database, live());
            await database`DELETE FROM landscape_display_art WHERE map_domain_id = ${DOMAIN} AND art_key = 'see'`;
            const bericht = await verifyLandscapeDisplay(database, live());
            const arten = bericht.checks.find((c) => c.name === "arten");
            expect(arten).toMatchObject({ passed: false, blocking: false });
            expect(arten?.offenders).toContain("fehlt: see");
            expect(bericht.checks.filter((c) => !c.passed && c.blocking !== false)).toEqual([]);
            expect(bericht.passed, "ohne eine blockierende Prüfung bleibt das Urteil grün").toBe(true);
            const befunde = checkFindings("verify:landscape-display", bericht.checks, (c) => c.passed);
            expect(befunde.map((befund) => befund.code)).toEqual(["verify:landscape-display/arten"]);
            expect(befunde[0]?.notes).toContain("fehlt: see");
        });
    });
});
