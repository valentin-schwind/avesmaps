import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { DerivedRun, RegionInput } from "../src/derive/label-runs.ts";
import { storeRuns } from "../src/derive/refresh-label-curve.ts";
import { AUSWEICHRAUM, ausweichLauf, mapUnitsPerPixel, NAME_ROOM } from "../src/derive/run-geometry.ts";
import { leseKachel, type MvtMerkmal } from "./support/mvt-lesen.ts";

/**
 * Kurvennamen weichen aus (Migration 0110; Betreiber 2026-10-11: „A, überlappungen sind einfach scheisse. kannst du nicht versuchen
 * etwas auszuweichen, wenn du schon längere läufe baust?“). Die Kachel liefert je Einzellauf bis zu fünf Kandidaten wie bei den
 * Wegnamen (0030): die Mitte, dann ⅛ und ¼ der Namenslänge vor und zurück. MapLibre nimmt den ersten freien; weil sie sich
 * gegenseitig überdecken, steht höchstens einer.
 *
 * Gemessen wird die ausgelieferte Kachel selbst (`landscape_label_run_tile`), nicht ihr Quelltext.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const REGION_PUBLIC_ID = "00000000-0000-4000-8000-0000000006a1";
const LABEL_PUBLIC_ID = "00000000-0000-4000-8000-0000000006b1";
const NAME = "Ausweichprobe";
const NAME_PX = 120;
const CX = 520;
const CY = 520;

describeWithDatabase("Ausweichstellen der Kurvennamen in der Kachel", () => {
    let database: Database;
    let regionId = 0;
    let labelId = 0;

    const input = (): RegionInput => ({
        regionId,
        regionPublicId: REGION_PUBLIC_ID,
        name: NAME,
        styleLabelId: labelId,
        labelText: NAME,
        labelSize: 18,
        labelType: null,
        labelMinZoom: 4,
        labelMaxZoom: 7,
        curveMax: 2,
        curveDegree: 3,
    });

    /** Ein waagerechter Kern der Länge `einheiten`, mittig bei (CX, CY). */
    const kern = (einheiten: number): { x: number; y: number }[] => [
        { x: CX - einheiten / 2, y: CY },
        { x: CX, y: CY },
        { x: CX + einheiten / 2, y: CY },
    ];
    const lauf = (zoom: number, points: { x: number; y: number }[], instance = 0, instanceCount = 1): DerivedRun => ({
        instance,
        instanceCount,
        runMinZoom: zoom,
        runMaxZoom: zoom,
        points,
    });

    /** Die Merkmale der Probe auf dieser Stufe, aus jeder Kachel, in der die Mitte eines ihrer Läufe liegt (einmal je Kandidat). */
    async function kachel(zoom: number): Promise<{ merkmale: MvtMerkmal[]; extent: number }> {
        const orte = await database<{ x: number; y: number }[]>`
            SELECT DISTINCT
                   floor((ST_X(ST_LineInterpolatePoint(geom, 0.5)) + 20037508.342789244)
                         / ((2 * 20037508.342789244) / power(2, ${zoom})))::int AS x,
                   floor((20037508.342789244 - ST_Y(ST_LineInterpolatePoint(geom, 0.5)))
                         / ((2 * 20037508.342789244) / power(2, ${zoom})))::int AS y
            FROM landscape_label_run_render
            WHERE region_public_id = ${REGION_PUBLIC_ID} AND run_min_zoom = ${zoom}
        `;
        if (orte.length === 0) throw new Error("Lauf fehlt in der Sicht");
        const gesehen = new Map<string, MvtMerkmal>();
        let extent = 4096;
        for (const ort of orte) {
            const [zeile] = await database<{ tile: Uint8Array }[]>`
                SELECT landscape_label_run_tile(${zoom}, ${ort.x}, ${ort.y}) AS tile
            `;
            const ebene = leseKachel(zeile?.tile ?? new Uint8Array()).find((e) => e.name === "landscape_label_run");
            extent = ebene?.extent ?? extent;
            for (const merkmal of ebene?.merkmale ?? []) {
                if (merkmal.eigenschaften["region_public_id"] !== REGION_PUBLIC_ID) continue;
                const schluessel = `${String(merkmal.eigenschaften["instance"])}:${String(merkmal.eigenschaften["candidate"])}`;
                if (!gesehen.has(schluessel)) gesehen.set(schluessel, merkmal);
            }
        }
        return { merkmale: [...gesehen.values()], extent };
    }

    async function speichere(runs: DerivedRun[]): Promise<void> {
        await storeRuns(database, input(), {
            regionId,
            name: NAME,
            runs,
            fingerprint: "landscape-run-candidates-test",
            curveLength: 1,
            nameWidthPixels: NAME_PX,
        });
    }

    /** Die Mitte eines Kandidaten in Kachelpixeln (die Kachel hat 512 Pixel). */
    const mitteX = (merkmal: MvtMerkmal, extent: number): number => {
        const punkte = merkmal.linien.flat();
        const erster = punkte[0] as { x: number };
        const letzter = punkte[punkte.length - 1] as { x: number };
        return ((erster.x + letzter.x) / 2) * (512 / extent);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active, label_curve_enabled, label_curve_max)
            VALUES (${REGION_PUBLIC_ID}, 'aventuria', ${NAME}, 'topographie', true, true, 2)
            ON CONFLICT (public_id) DO UPDATE SET label_curve_max = 2
            RETURNING id::text
        `;
        regionId = Number(region?.id);
        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, name, geom, is_active,
                                   label_size, label_min_zoom, label_max_zoom, label_priority, region_id)
            VALUES (${LABEL_PUBLIC_ID}, 'aventuria', ${NAME}, ST_SetSRID(ST_MakePoint(${CX}, ${CY}), 0), true,
                    18, 4, 7, 3, ${regionId})
            ON CONFLICT (public_id) DO UPDATE SET region_id = ${regionId}
            RETURNING id::text
        `;
        labelId = Number(label?.id);
        await database`UPDATE region SET primary_label_id = ${labelId} WHERE id = ${regionId}`;
    });

    afterAll(async () => {
        await database`DELETE FROM landscape_label_run WHERE region_id = ${regionId}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE id = ${regionId}`;
        await database`DELETE FROM map_label WHERE id = ${labelId}`;
        await database`DELETE FROM region WHERE id = ${regionId}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 ein Einzellauf mit Ausweichraum liefert fünf Kandidaten: die Mitte, dann ⅛ und ¼ vor und zurück", async () => {
        const zoom = 6;
        const needed = NAME_PX * mapUnitsPerPixel(zoom);
        await speichere([lauf(zoom, ausweichLauf(kern(needed * 1.2), needed))]);
        const { merkmale, extent } = await kachel(zoom);
        const kandidaten = new Map(merkmale.map((m) => [Number(m.eigenschaften["candidate"]), m]));
        expect([...kandidaten.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
        const mitte = mitteX(kandidaten.get(0) as MvtMerkmal, extent);
        // Je Kandidat der Versatz seiner Mitte in Bildschirmpixeln: ⅛ und ¼ der Namensbreite, abwechselnd vor und zurück.
        const versatz = [1, 2, 3, 4].map((k) => mitteX(kandidaten.get(k) as MvtMerkmal, extent) - mitte);
        expect(versatz[0]).toBeCloseTo(NAME_PX / 8, 0);
        expect(versatz[1]).toBeCloseTo(-NAME_PX / 8, 0);
        expect(versatz[2]).toBeCloseTo(NAME_PX * AUSWEICHRAUM, 0);
        expect(versatz[3]).toBeCloseTo(-NAME_PX * AUSWEICHRAUM, 0);
        // Jeder Kandidat ist genau so lang wie der Name: MapLibre setzt ihn mit `line-center` auf dessen Mitte.
        for (const merkmal of merkmale) {
            const punkte = merkmal.linien.flat();
            const laenge =
                ((punkte[punkte.length - 1] as { x: number }).x - (punkte[0] as { x: number }).x) * (512 / extent);
            expect(laenge).toBeCloseTo(NAME_PX, 0);
        }
    });

    it("🔴 ein Lauf ohne Ausweichraum (vor ALGORITHM_VERSION 7) liefert nur die Mitte, wie bisher", async () => {
        // Die Migration erträgt das vorige Release: Bis `derive:runs` neu ableitet, liegen die alten Läufe in der Tafel.
        const zoom = 6;
        const needed = NAME_PX * mapUnitsPerPixel(zoom);
        await speichere([lauf(zoom, kern(needed * NAME_ROOM))]);
        const { merkmale } = await kachel(zoom);
        expect(merkmale.map((m) => Number(m.eigenschaften["candidate"]))).toEqual([0]);
    });

    it("🔴 ein Satz mit mehreren Instanzen weicht nicht aus: je Instanz nur die Mitte", async () => {
        const zoom = 7;
        const needed = NAME_PX * mapUnitsPerPixel(zoom);
        const links = kern(needed * 1.6).map((p) => ({ x: p.x - needed, y: p.y }));
        const rechts = kern(needed * 1.6).map((p) => ({ x: p.x + needed, y: p.y }));
        await speichere([lauf(zoom, links, 0, 2), lauf(zoom, rechts, 1, 2)]);
        const { merkmale } = await kachel(zoom);
        expect(
            merkmale
                .map((m) => `${String(m.eigenschaften["instance"])}:${String(m.eigenschaften["candidate"])}`)
                .sort(),
        ).toEqual(["0:0", "1:0"]);
    });
});
