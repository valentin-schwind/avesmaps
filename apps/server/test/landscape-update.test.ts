import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LandscapeUpdateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { landscapeHistory } from "../src/editor/history.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import { updateLandscape } from "../src/editor/landscape-update.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readSubjectRevision } from "../src/subjects/revision.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fertig“ im Landschaftseditor (WI-0178 B2; O3; Operation `landscape.update`), so wie auf dem VPS: Wegwerf-Cluster mit Migrations-,
 * App- und Jobs-Rolle und den Vorlagen, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: Name, Beschriftung und Form gehen in zwei Operationen; die Form zählt die Revision der Landschaft und macht dem
 * Felder-Entwurf einer Nachbarin einen Konflikt ohne Grund; ein Konflikt an einem Objekt lässt die anderen geschrieben stehen; der Name
 * erreicht die Beschriftung nicht, oder er überschreibt einen abweichenden Text aus Legacy; „sichtbar ab“ hinter „sichtbar bis“ wird
 * gespeichert; ein anderer hält die Landschaft, und die Operation schreibt trotzdem. Ebene und Art (Betreiber 2026-10-17): eine neue
 * Ebene ohne Art oder eine Art aus einer anderen Ebene wird gespeichert; die Beschriftung behält die alte Namensart (Zoomband und Größe
 * der alten Tafelzeile); die Landschaft steht in der neuen Ebene irgendwo zwischen den anderen; der Kontinent „Aventurien“ verliert
 * Name, Ebene oder Art (der nächste Geländelauf bräche ab); alte Gebirgswerte gelten still wieder, wenn eine Fläche zum Gebirge wird
 * (EDIT-0003 T50 (b)); Klicksperre, Kurve und „Namen übernehmen“ gehen in getrennte Operationen oder fehlen im Protokoll; eine halbe
 * Spanne wird gespeichert (sie wirkte nicht, `map_label_effective`), und zurück auf die Vorgabe der Art geht nicht.
 */

const ENV = "landupdate";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const WALD = "c3c3c3c3-0000-4000-8000-000000000001";
const MOOR = "c3c3c3c3-0000-4000-8000-000000000002";
const WALD_FLAECHE = "c3c3c3c3-0000-4000-8000-0000000000a1";
const MOOR_FLAECHE = "c3c3c3c3-0000-4000-8000-0000000000a2";
const WALD_LABEL = "c3c3c3c3-0000-4000-8000-0000000000c1";
const MOOR_LABEL = "c3c3c3c3-0000-4000-8000-0000000000c2";
const HUEGEL = "c3c3c3c3-0000-4000-8000-000000000003";
const AVENTURIEN = "c3c3c3c3-0000-4000-8000-000000000004";

type Ring = [number, number][];
const WALD_RING: Ring = [
    [300, 300],
    [420, 300],
    [420, 330],
    [300, 330],
];
const MOOR_RING: Ring = [
    [300, 330],
    [360, 330],
    [360, 360],
    [300, 360],
];
const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: [
                { public_id: WALD, name: "Formwald", kind: "vegetation", region_type: "wald", area_count: 1 },
                { public_id: MOOR, name: "Formmoor", kind: "vegetation", region_type: "moor", area_count: 1 },
                {
                    public_id: HUEGEL,
                    name: "Formhügel",
                    kind: "topographie",
                    region_type: "huegelland",
                    stack_order: 7,
                    area_count: 0,
                },
                {
                    public_id: AVENTURIEN,
                    name: "Aventurien",
                    kind: "derographisch",
                    region_type: "kontinent",
                    area_count: 0,
                },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9501,
            truncated: false,
            areas: [
                {
                    public_id: WALD_FLAECHE,
                    region_public_id: WALD,
                    geometry: { type: "Polygon", coordinates: [geschlossen(WALD_RING)] },
                },
                {
                    public_id: MOOR_FLAECHE,
                    region_public_id: MOOR,
                    geometry: { type: "Polygon", coordinates: [geschlossen(MOOR_RING)] },
                },
            ],
        } as never,
        labels: {
            ok: true,
            revision: 9502,
            features: [
                {
                    geometry: { type: "Point", coordinates: [350, 315] },
                    properties: {
                        feature_type: "label",
                        public_id: WALD_LABEL,
                        name: "Formwald",
                        feature_subtype: "wald",
                        ecosystem_region_public_id: WALD,
                    },
                },
                {
                    geometry: { type: "Point", coordinates: [330, 345] },
                    properties: {
                        feature_type: "label",
                        public_id: MOOR_LABEL,
                        name: "Formmoor",
                        feature_subtype: "moor",
                        ecosystem_region_public_id: MOOR,
                    },
                },
            ],
        } as never,
    };
}

describeWithCluster("„Fertig“: landscape.update (WI-0178 B2, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const region = async (id: string): Promise<{ name: string; revision: number }> => {
        const [zeile] = await cluster!.admin<{ name: string; revision: number }[]>`
            SELECT name, revision::int AS revision FROM region WHERE public_id = ${id}
        `;
        return zeile!;
    };
    const label = async (
        id: string,
    ): Promise<{ name: string; revision: number; size: number | null; min: number | null; max: number | null }> => {
        const [zeile] = await cluster!.admin<
            { name: string; revision: number; size: number | null; min: number | null; max: number | null }[]
        >`
            SELECT name, revision::int AS revision, label_size::float8 AS size, label_min_zoom AS min, label_max_zoom AS max
              FROM map_label WHERE public_id = ${id}
        `;
        return zeile!;
    };
    const flaeche = async (id: string): Promise<{ revision: number; ring: Ring }> => {
        const [zeile] = await cluster!.admin<{ revision: number; geojson: string }[]>`
            SELECT revision::int AS revision, ST_AsGeoJSON(geom, 15) AS geojson FROM region_area WHERE public_id = ${id}
        `;
        const g = JSON.parse(zeile!.geojson) as { coordinates: Ring[] };
        return { revision: zeile!.revision, ring: g.coordinates[0]!.slice(0, -1) };
    };
    /** Der Wald mit der gemeinsamen Ecke (300, 330) auf `nach`, das Moor mit ihr mitgezogen. */
    const mitNachbar = async (nach: [number, number]): Promise<NonNullable<LandscapeUpdateBody["areas"]>> => {
        const wald = await flaeche(WALD_FLAECHE);
        const moor = await flaeche(MOOR_FLAECHE);
        const [gx, gy] = moor.ring[0]!;
        const ziehe = (ring: Ring): Ring => ring.map(([x, y]) => (x === gx && y === gy ? nach : [x, y]));
        return [
            { id: WALD_FLAECHE, baseRevision: wald.revision, polygons: [[ziehe(wald.ring)]] },
            { id: MOOR_FLAECHE, baseRevision: moor.revision, polygons: [[ziehe(moor.ring)]] },
        ];
    };
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };
    const op = (rest: Omit<LandscapeUpdateBody, "operationId">): LandscapeUpdateBody => ({
        operationId: randomUUID(),
        ...rest,
    });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        const satz = quelle();
        await importRegions(importer, satz.regions, satz.areas, satz.labels);
    }, 240_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 EINE Operation schreibt Name, Beschriftung und Form samt Nachbarin; der Name erreicht die Beschriftung", async () => {
        const vorher = { wald: await region(WALD), label: await label(WALD_LABEL), moor: await flaeche(MOOR_FLAECHE) };
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            WALD,
            op({
                baseRevision: vorher.wald.revision,
                changes: { name: "Formforst" },
                labels: [
                    {
                        id: WALD_LABEL,
                        baseRevision: vorher.label.revision,
                        changes: { size: 14, zoomMin: 2, zoomMax: 6 },
                    },
                ],
                areas: await mitNachbar([298, 333]),
            }),
        );
        const nach = { wald: await region(WALD), label: await label(WALD_LABEL), moor: await flaeche(MOOR_FLAECHE) };
        expect(nach.wald).toEqual({ name: "Formforst", revision: vorher.wald.revision + 1 });
        expect(nach.label).toMatchObject({ name: "Formforst", size: 14, max: 6 });
        expect(nach.label.revision).toBeGreaterThan(vorher.label.revision);
        expect(nach.moor.revision).toBe(vorher.moor.revision + 1);
        expect(nach.moor.ring[0]).toEqual([298, 333]);
        // Der Wald speist das Gelände: Es rechnet nicht neu, die Quittung sagt es (T18).
        expect(quittung.warnings.map((befund) => befund.code)).toEqual(["terrain_stale"]);
        expect(quittung.affected.filter((x) => x.kind === "landscape").map((x) => x.id)).toEqual([WALD, MOOR]);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual([
            "land_smooth",
            "label_runs",
            "label_runs",
            "tiles",
        ]);
        const operationen = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${quittung.operationId}::uuid
        `;
        expect(operationen[0]!.n).toBe(1);
        const protokoll = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((zeile) => zeile.action)).toEqual([
            "label.updated",
            "region.updated",
            "label.renamed",
            "area.reshaped",
            "area.carried",
        ]);
        expect(protokoll[0]!.changes).toMatchObject({ size: { before: null, after: 14 } });
        expect(protokoll[1]!.changes).toEqual({ name: { before: "Formwald", after: "Formforst" } });
    });

    it("🔴 nur die Form: die Revision der Landschaft bleibt (G5, Revision je Objekt)", async () => {
        const vorher = await region(WALD);
        const nachbarin = await region(MOOR);
        await updateLandscape(cluster!.app, thomas, WALD, op({ areas: await mitNachbar([297, 334]) }));
        expect((await region(WALD)).revision).toBe(vorher.revision);
        expect((await region(MOOR)).revision).toBe(nachbarin.revision);
    });

    it("🔴 ein Konflikt an der Landschaft nimmt alles zurück: Beschriftung und Form bleiben, wie sie waren", async () => {
        const wald = await region(WALD);
        const vorher = { label: await label(WALD_LABEL), flaeche: await flaeche(WALD_FLAECHE) };
        expect(
            await fehler(
                updateLandscape(
                    cluster!.app,
                    thomas,
                    WALD,
                    op({
                        baseRevision: wald.revision - 1,
                        changes: { name: "Veraltet" },
                        labels: [{ id: WALD_LABEL, baseRevision: vorher.label.revision, changes: { priority: 4 } }],
                        areas: await mitNachbar([296, 335]),
                    }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await region(WALD)).toEqual(wald);
        expect(await label(WALD_LABEL)).toEqual(vorher.label);
        expect(await flaeche(WALD_FLAECHE)).toEqual(vorher.flaeche);
    });

    it("🔴 ein abweichender Text aus Legacy folgt dem Namen nicht", async () => {
        await cluster!
            .admin`UPDATE map_label SET name = 'Das Moor', text_follows_name = FALSE WHERE public_id = ${MOOR_LABEL}`;
        const moor = await region(MOOR);
        const subjekte = await readSubjectRevision(cluster!.app);
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: moor.revision, changes: { name: "Formsumpf" } }),
        );
        // Ein neuer Name speist das Gelände nicht.
        expect(quittung.warnings).toEqual([]);
        // Infopanel und Links lesen den neuen Namen sofort, nicht erst nach dem nächsten Import (EDIT-0003 T50).
        expect(await readSubjectRevision(cluster!.app)).not.toBe(subjekte);
        expect((await region(MOOR)).name).toBe("Formsumpf");
        expect((await label(MOOR_LABEL)).name).toBe("Das Moor");
    });

    it("„sichtbar ab“ hinter „sichtbar bis“, eine halbe Spanne und eine leere Änderung werden nicht gespeichert (400)", async () => {
        const vorher = await label(WALD_LABEL);
        for (const changes of [
            { zoomMin: 7, zoomMax: 5 },
            { zoomMin: 3 },
            { zoomReset: true as const, zoomMin: 1, zoomMax: 4 },
        ])
            expect(
                await fehler(
                    updateLandscape(
                        cluster!.app,
                        thomas,
                        WALD,
                        op({ labels: [{ id: WALD_LABEL, baseRevision: vorher.revision, changes }] }),
                    ),
                ),
                JSON.stringify(changes),
            ).toMatchObject({ statusCode: 400 });
        expect(await label(WALD_LABEL)).toEqual(vorher);
        expect(await fehler(updateLandscape(cluster!.app, thomas, WALD, op({})))).toMatchObject({ statusCode: 400 });
        expect(
            await fehler(updateLandscape(cluster!.app, thomas, WALD, op({ changes: { name: "Ohne Revision" } }))),
        ).toMatchObject({ statusCode: 400 });
    });

    it("🔴 hält ein anderer die Landschaft, schreibt die Operation nicht", async () => {
        await takeEditorLock(cluster!.app, {
            kind: "landscape",
            id: WALD,
            part: "felder",
            run: randomUUID(),
            personId: randomUUID(),
            personName: "Anna",
        });
        const wald = await region(WALD);
        expect(
            await fehler(
                updateLandscape(
                    cluster!.app,
                    thomas,
                    WALD,
                    op({ baseRevision: wald.revision, changes: { name: "Gesperrt" } }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        expect(await region(WALD)).toEqual(wald);
        await cluster!.admin`DELETE FROM editor_lock`;
    });
    it("Ebene und Art: eine neue Ebene ohne Art und eine Art aus einer anderen Ebene werden nicht gespeichert (400)", async () => {
        const wald = await region(WALD);
        const versuche: NonNullable<LandscapeUpdateBody["changes"]>[] = [
            { layer: "topographie" },
            { type: "gebirge" },
            { layer: "topographie", type: "wald" },
        ];
        for (const changes of versuche)
            expect(
                await fehler(updateLandscape(cluster!.app, thomas, WALD, op({ baseRevision: wald.revision, changes }))),
                JSON.stringify(changes),
            ).toMatchObject({ statusCode: 400 });
        expect(await region(WALD)).toEqual(wald);
    });

    it("🔴 D1: ganz nach vorn und ganz nach hinten in der Ebene; die anderen bleiben samt Revision; Platz n von m im Detail", async () => {
        const wald = await region(WALD);
        const rang = async (id: string): Promise<number> => {
            const [zeile] = await cluster!.admin<{ order: number }[]>`
                SELECT stack_order AS order FROM region WHERE public_id = ${id}
            `;
            return zeile!.order;
        };
        const waldRang = await rang(WALD);
        const vorn = await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: (await region(MOOR)).revision, changes: { order: "front" } }),
        );
        expect(await rang(MOOR)).toBe(waldRang + 1);
        expect(await region(WALD)).toEqual(wald);
        expect((await readEditorLandscape(cluster!.app, MOOR))?.place).toEqual({ n: 1, of: 2 });
        expect((await readEditorLandscape(cluster!.app, WALD))?.place).toEqual({ n: 2, of: 2 });
        const [eintrag] = await cluster!.admin<{ summary: string; changes: Record<string, unknown> }[]>`
            SELECT o.summary, e.changes FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
             WHERE o.operation_id = ${vorn.operationId}::uuid
        `;
        expect(eintrag).toEqual({
            summary: expect.stringMatching(/: ganz nach vorn geändert$/) as unknown,
            changes: { order: { before: 0, after: waldRang + 1 } },
        });
        // Wer schon ganz vorn liegt, bleibt: keine neue Revision.
        const moor = await region(MOOR);
        await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: moor.revision, changes: { order: "front" } }),
        );
        expect(await region(MOOR)).toEqual(moor);
        await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: moor.revision, changes: { order: "back" } }),
        );
        expect(await rang(MOOR)).toBe(waldRang - 1);
        expect((await readEditorLandscape(cluster!.app, MOOR))?.place).toEqual({ n: 2, of: 2 });
        expect(await region(WALD)).toEqual(wald);
    });

    it("🔴 C4: die Lage einer Beschriftung geht mit ihrer Revision ins Protokoll; außerhalb der Karte 400, nichts geschrieben", async () => {
        const vorher = await label(MOOR_LABEL);
        const lage = async (): Promise<[number, number]> => {
            const [zeile] = await cluster!.admin<{ x: number; y: number }[]>`
                SELECT ST_X(geom) AS x, ST_Y(geom) AS y FROM map_label WHERE public_id = ${MOOR_LABEL}
            `;
            return [zeile!.x, zeile!.y];
        };
        const alt = await lage();
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ labels: [{ id: MOOR_LABEL, baseRevision: vorher.revision, changes: { position: [335, 350] } }] }),
        );
        expect(await lage()).toEqual([335, 350]);
        expect((await label(MOOR_LABEL)).revision).toBe(vorher.revision + 1);
        const [eintrag] = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid AND action = 'label.updated'
        `;
        expect(eintrag).toEqual({ action: "label.updated", changes: { position: { before: alt, after: [335, 350] } } });
        const jetzt = await label(MOOR_LABEL);
        expect(
            await fehler(
                updateLandscape(
                    cluster!.app,
                    thomas,
                    MOOR,
                    op({
                        labels: [{ id: MOOR_LABEL, baseRevision: jetzt.revision, changes: { position: [-1e7, -1e7] } }],
                    }),
                ),
            ),
        ).toMatchObject({ statusCode: 400 });
        expect(await label(MOOR_LABEL)).toEqual(jetzt);
        expect(await lage()).toEqual([335, 350]);
    });

    // Zuletzt: Danach liegt der Wald nicht mehr in der Ebene des Moors, die Form zöge es nicht mehr mit.
    it("🔴 Ebene und Art: die Landschaft steht oben in der neuen Ebene, die Beschriftung nimmt die Art mit", async () => {
        const wald = await region(WALD);
        const vorher = await label(WALD_LABEL);
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            WALD,
            op({ baseRevision: wald.revision, changes: { layer: "topographie", type: "tal" } }),
        );
        const [zeile] = await cluster!.admin<{ layer: string; type: string; order: number; subtype: string }[]>`
            SELECT r.region_layer AS layer, r.region_type AS type, r.stack_order AS order, l.subtype
              FROM region r JOIN map_label l ON l.region_id = r.id WHERE r.public_id = ${WALD}
        `;
        expect(zeile).toEqual({ layer: "topographie", type: "tal", order: 8, subtype: "tal" });
        expect(quittung.warnings.map((befund) => befund.code)).toEqual(["terrain_stale"]);
        expect((await region(WALD)).revision).toBe(wald.revision + 1);
        expect((await label(WALD_LABEL)).revision).toBe(vorher.revision + 1);
        const protokoll = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(protokoll).toEqual([
            {
                action: "region.updated",
                changes: {
                    layer: { before: "vegetation", after: "topographie" },
                    type: { before: "wald", after: "tal" },
                    order: { before: 0, after: 8 },
                },
            },
            { action: "label.updated", changes: { type: { before: "wald", after: "tal" } } },
        ]);
    });

    it("🔴 der Kontinent „Aventurien“ behält Name, Ebene und Art (er rahmt das Gelände); seine Beschriftungen bleiben frei", async () => {
        const aventurien = await region(AVENTURIEN);
        const versuche: NonNullable<LandscapeUpdateBody["changes"]>[] = [
            { name: "Aventurien Ost" },
            { type: "region" },
            { layer: "topographie", type: "insel" },
        ];
        for (const changes of versuche)
            expect(
                await fehler(
                    updateLandscape(
                        cluster!.app,
                        thomas,
                        AVENTURIEN,
                        op({ baseRevision: aventurien.revision, changes }),
                    ),
                ),
                JSON.stringify(changes),
            ).toMatchObject({ statusCode: 400 });
        expect(await region(AVENTURIEN)).toEqual(aventurien);
    });

    it("🔴 zum Gebirge: alte Gebirgswerte der Teilflächen sind verworfen, nie still wieder gültig (T50 (b), (c))", async () => {
        await cluster!.admin`
            INSERT INTO terrain_control (area_id, map_domain_id, koernung)
            SELECT id, map_domain_id, 0.5 FROM region_area WHERE public_id = ${MOOR_FLAECHE}
        `;
        const werte = async (): Promise<number> => {
            const [zeile] = await cluster!.admin<{ n: number }[]>`
                SELECT count(*)::int AS n FROM terrain_control c JOIN region_area a ON a.id = c.area_id
                 WHERE a.public_id = ${MOOR_FLAECHE}
            `;
            return zeile!.n;
        };
        expect(await werte()).toBe(1);
        const moor = await region(MOOR);
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: moor.revision, changes: { layer: "topographie", type: "gebirge" } }),
        );
        expect(await werte()).toBe(0);
        expect(quittung.warnings.map((befund) => befund.code)).toEqual(["terrain_stale"]);
        // Verlässt die Fläche das Gebirge, bleiben neue Werte unwirksam stehen.
        await cluster!.admin`
            INSERT INTO terrain_control (area_id, map_domain_id, koernung)
            SELECT id, map_domain_id, 0.7 FROM region_area WHERE public_id = ${MOOR_FLAECHE}
        `;
        await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: (await region(MOOR)).revision, changes: { type: "huegelland" } }),
        );
        expect(await werte()).toBe(1);
    });

    it("🔴 Klicksperre, Kurve und ↺ „Namen übernehmen“ in EINER Operation, je im Protokoll", async () => {
        await cluster!
            .admin`UPDATE map_label SET name = 'Das Moor', text_follows_name = FALSE WHERE public_id = ${MOOR_LABEL}`;
        const moor = await region(MOOR);
        const vorher = await label(MOOR_LABEL);
        const quittung = await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({
                baseRevision: moor.revision,
                changes: { locked: true, curve: { enabled: true, max: 2 } },
                labels: [{ id: MOOR_LABEL, baseRevision: vorher.revision, changes: { followName: true } }],
            }),
        );
        const [zeile] = await cluster!.admin<{ locked: boolean; enabled: boolean | null; max: number | null }[]>`
            SELECT is_locked AS locked, label_curve_enabled AS enabled, label_curve_max AS max FROM region WHERE public_id = ${MOOR}
        `;
        expect(zeile).toEqual({ locked: true, enabled: true, max: 2 });
        expect((await label(MOOR_LABEL)).name).toBe(moor.name);
        const protokoll = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((x) => x.action)).toEqual(["label.updated", "region.updated"]);
        expect(protokoll[0]!.changes).toEqual({
            text: { before: "Das Moor", after: moor.name },
            textFollowsName: { before: false, after: true },
        });
        expect(Object.keys(protokoll[1]!.changes).sort()).toEqual(["curve", "locked"]);
        // Kurve aus: nur der Schalter, die Höchstzahl bleibt.
        await updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: (await region(MOOR)).revision, changes: { curve: { enabled: false } } }),
        );
        const [aus] = await cluster!.admin<{ enabled: boolean | null; max: number | null }[]>`
            SELECT label_curve_enabled AS enabled, label_curve_max AS max FROM region WHERE public_id = ${MOOR}
        `;
        expect(aus).toEqual({ enabled: false, max: 2 });
    });

    it("🔴 ↺ „Vorgabe der Art“: die eigene Spanne fällt weg, beide Grenzen leer", async () => {
        const gesetzt = await label(WALD_LABEL);
        await updateLandscape(
            cluster!.app,
            thomas,
            WALD,
            op({ labels: [{ id: WALD_LABEL, baseRevision: gesetzt.revision, changes: { zoomMin: 3, zoomMax: 7 } }] }),
        );
        const mitSpanne = await label(WALD_LABEL);
        expect(mitSpanne).toMatchObject({ min: 3, max: 7 });
        // F2 (Migration 0206): Die Kachel sagt, dass die Beschriftung ihre eigene Spanne trägt; die Karte lässt dann die der Art weg.
        const eigen = async (): Promise<boolean | undefined> =>
            (
                await cluster!.app<{ own_span: boolean }[]>`
                    SELECT own_span FROM map_label_render WHERE public_id = ${WALD_LABEL}::uuid
                `
            )[0]?.own_span;
        expect(await eigen()).toBe(true);
        await updateLandscape(
            cluster!.app,
            thomas,
            WALD,
            op({ labels: [{ id: WALD_LABEL, baseRevision: mitSpanne.revision, changes: { zoomReset: true } }] }),
        );
        expect(await label(WALD_LABEL)).toMatchObject({ min: null, max: null });
        expect(await eigen()).toBe(false);
    });

    it("das Detail liefert je Beschriftung die Spanne ihrer Art (eigene Art vor der Grundvorgabe)", async () => {
        await cluster!.admin`
            INSERT INTO landscape_display_art (map_domain_id, art_key, band_from, band_to, curve_max, priority, size_by_band)
            VALUES ('aventuria', '*', 1, 8, 1, 3, '{10,10,10,10,10,10,10,10,10}'),
                   ('aventuria', 'tal', 4, 6, 1, 3, '{10,10,10,10,10,10,10,10,10}')
        `;
        const wald = await readEditorLandscape(cluster!.app, WALD);
        expect(wald?.labels[0]?.zoomDefault).toEqual({ min: 4, max: 6 });
        const moor = await readEditorLandscape(cluster!.app, MOOR);
        expect(moor?.labels[0]?.zoomDefault).toEqual({ min: 1, max: 8 });
        await cluster!.admin`DELETE FROM landscape_display_art`;
    });

    it("🔴 der Verlauf der Fläche nennt ihre Operationen samt Beschriftungen und Teilflächen; ↺ (der Server, WI-0265 B6c) schreibt mit der Quelle restore", async () => {
        const seite = await landscapeHistory(cluster!.app, WALD, {});
        expect(seite.entries.length).toBeGreaterThan(0);
        const arten = new Set(seite.entries.flatMap((eintrag) => eintrag.objects.map((g) => g.kind)));
        expect([...arten].sort()).toEqual(expect.arrayContaining(["area", "label", "landscape"]));
        const jede = seite.entries.flatMap((eintrag) => eintrag.objects);
        expect(jede.find((g) => g.kind === "landscape")).toMatchObject({ id: WALD });
        expect(jede.find((g) => g.kind === "label")).toMatchObject({ id: WALD_LABEL });

        const wald = await region(WALD);
        const geaendert = await updateLandscape(
            cluster!.app,
            thomas,
            WALD,
            op({ baseRevision: wald.revision, changes: { name: "Formforst II" } }),
        );
        expect((await region(WALD)).name).toBe("Formforst II");
        // ↺ nimmt der Server zurück: eine neue Operation mit der Quelle restore und der Verknüpfung zum Original; der Name steht wie vorher.
        const quittung = await nimmFlaecheZurueck(cluster!.app, thomas, WALD, {
            operationId: randomUUID(),
            reverts: geaendert.operationId,
        });
        const [zeile] = await cluster!.admin<{ source: string; action: string }[]>`
            SELECT source, action FROM map_operation WHERE operation_id = ${quittung.operationId}::uuid
        `;
        expect(zeile).toEqual({ source: "restore", action: "landscape.restore_series" });
        expect((await region(WALD)).name).toBe(wald.name);
        expect((await landscapeHistory(cluster!.app, WALD, {})).entries[0]).toMatchObject({ source: "restore" });
    });

    it("🔴 speichern, während eine Ableitung die Schriftläufe schreibt (FOR KEY SHARE auf Landschaft und Beschriftung): kein 503; ein zweiter Editor wartet weiter", async () => {
        // Wie die Schriftläufe (`landscape_label_run`, Fremdschlüssel auf region und map_label): Die Prüfung sperrt mit FOR KEY SHARE bis
        // zum Ende der Ableitung. Vorher wartete landscape.update mit FOR UPDATE darauf und brach nach 2 s lock_timeout ab (Befund Claudio).
        const vorher = await region(MOOR);
        let loesen!: () => void;
        const gehalten = new Promise<void>((erfuellt) => (loesen = erfuellt));
        let gesperrt!: () => void;
        const sperreDa = new Promise<void>((erfuellt) => (gesperrt = erfuellt));
        const halter = cluster!.admin.begin(async (tx) => {
            await tx`SELECT 1 FROM region WHERE public_id = ${MOOR}::uuid FOR KEY SHARE`;
            await tx`SELECT 1 FROM map_label WHERE public_id = ${MOOR_LABEL}::uuid FOR KEY SHARE`;
            gesperrt();
            await gehalten;
        });
        await sperreDa;
        try {
            await updateLandscape(
                cluster!.app,
                thomas,
                MOOR,
                op({ baseRevision: vorher.revision, changes: { name: "Formsumpf" } }),
            );
        } finally {
            loesen();
            await halter;
        }
        expect((await region(MOOR)).name).toBe("Formsumpf");

        // Hält ein anderer Schreiber die Landschaft (FOR NO KEY UPDATE wie dieser Weg), wartet das Speichern, bis er fertig ist: Zwei
        // Editoren schließen sich weiter aus. (Die Verbindungen des Clusters haben kein lock_timeout; gelesen wird vorher, weil
        // `cluster.admin` EINE Verbindung hat und die gleich die Sperre hält.)
        const jetzt = await region(MOOR);
        let freigeben!: () => void;
        const offen = new Promise<void>((erfuellt) => (freigeben = erfuellt));
        let haelt!: () => void;
        const zweiterDa = new Promise<void>((erfuellt) => (haelt = erfuellt));
        const zweiter = cluster!.admin.begin(async (tx) => {
            await tx`SELECT 1 FROM region WHERE public_id = ${MOOR}::uuid FOR NO KEY UPDATE`;
            haelt();
            await offen;
        });
        await zweiterDa;
        let geschrieben = false;
        const speichern = updateLandscape(
            cluster!.app,
            thomas,
            MOOR,
            op({ baseRevision: jetzt.revision, changes: { name: "Formfenn" } }),
        ).then(() => {
            geschrieben = true;
        });
        try {
            await new Promise((weiter) => setTimeout(weiter, 1500));
            expect(geschrieben).toBe(false);
        } finally {
            freigeben();
            await zweiter;
        }
        await speichern;
        expect((await region(MOOR)).name).toBe("Formfenn");
    });
});
