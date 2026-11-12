import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LandscapeUpdateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { updateLandscape } from "../src/editor/landscape-update.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Form in „Fertig“ (WI-0178 C2, seit B2 in `landscape.update`; EDIT-0004 §7 C2), so wie auf dem VPS: Wegwerf-Cluster mit
 * Migrations-, App- und Jobs-Rolle und den Vorlagen, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: Die Nachbarfläche wird nicht in derselben Operation geschrieben; ein Konflikt an einer der Flächen lässt die andere
 * geschrieben stehen; über den Schreibweg lässt sich eine fremde Fläche umzeichnen; unveränderte Ecken werden gerundet und liegen nicht
 * mehr auf denen der Nachbarn; ein anderer hält die Nachbarlandschaft, und die Operation schreibt trotzdem; während des Zugs wird
 * geschrieben; `geometry_revision` bleibt stehen, und die Schriftläufe sehen die Änderung nicht; die Folgen (B3) fehlen.
 */

const ENV = "landform";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const WALD = "c2c2c2c2-0000-4000-8000-000000000001";
const MOOR = "c2c2c2c2-0000-4000-8000-000000000002";
const WALD_FLAECHE = "c2c2c2c2-0000-4000-8000-0000000000a1";
const MOOR_FLAECHE = "c2c2c2c2-0000-4000-8000-0000000000a2";
const WALD_LABEL = "c2c2c2c2-0000-4000-8000-0000000000c1";
const MOOR_LABEL = "c2c2c2c2-0000-4000-8000-0000000000c2";
/** Eine Ecke mit vielen Nachkommastellen, wie Legacy sie liefert: Sie muss nach dem Speichern bitgenau bleiben. */
const KRUMM: [number, number] = [360.123456789, 330];

type Ring = [number, number][];
const WALD_RING: Ring = [
    [300, 300],
    [420, 300],
    [420, 330],
    [300, 330],
];
// Das Moor liegt mit der gemeinsamen Ecke (300, 330) über dem Wald.
const MOOR_RING: Ring = [[300, 330], KRUMM, [360, 360], [300, 360]];
const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: [
                { public_id: WALD, name: "Formwald", kind: "vegetation", region_type: "wald", area_count: 1 },
                { public_id: MOOR, name: "Formmoor", kind: "vegetation", region_type: "moor", area_count: 1 },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9401,
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
            revision: 9402,
            features: [
                {
                    geometry: { type: "Point", coordinates: [350, 315] },
                    properties: {
                        feature_type: "label",
                        public_id: WALD_LABEL,
                        name: "Formwald",
                        ecosystem_region_public_id: WALD,
                    },
                },
                {
                    geometry: { type: "Point", coordinates: [330, 345] },
                    properties: {
                        feature_type: "label",
                        public_id: MOOR_LABEL,
                        name: "Formmoor",
                        ecosystem_region_public_id: MOOR,
                    },
                },
            ],
        } as never,
    };
}

interface Flaeche {
    revision: number;
    geometry_revision: string | null;
    ring: Ring;
}

describeWithCluster(
    "„Fertig“: die Form in landscape.update (WI-0178 C2, B2, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const flaeche = async (id: string): Promise<Flaeche> => {
            const [zeile] = await cluster!.admin<
                { revision: number; geometry_revision: string | null; geojson: string }[]
            >`
            SELECT revision::int AS revision, geometry_revision::text, ST_AsGeoJSON(geom, 15) AS geojson
              FROM region_area WHERE public_id = ${id}
        `;
            const g = JSON.parse(zeile!.geojson) as { coordinates: Ring[] };
            return {
                revision: zeile!.revision,
                geometry_revision: zeile!.geometry_revision,
                ring: g.coordinates[0]!.slice(0, -1),
            };
        };
        type Flaechen = NonNullable<LandscapeUpdateBody["areas"]>;
        const koerper = (areas: Flaechen): LandscapeUpdateBody => ({
            operationId: randomUUID(),
            areas,
        });
        /** Der Wald mit der gemeinsamen Ecke (die erste des Moors) auf `nach`, das Moor mit ihr mitgezogen. */
        const mitNachbar = async (nach: [number, number]): Promise<Flaechen> => {
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

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            const satz = quelle();
            await importRegions(importer, satz.regions, satz.areas, satz.labels);
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 eine Operation schreibt die eigene Fläche und die mitgezogene Nachbarin, zählt beide Revisionen, reiht die Folgen ein", async () => {
            const vorher = { wald: await flaeche(WALD_FLAECHE), moor: await flaeche(MOOR_FLAECHE) };
            const quittung = await updateLandscape(cluster!.app, thomas, WALD, koerper(await mitNachbar([298, 333])));
            const nach = { wald: await flaeche(WALD_FLAECHE), moor: await flaeche(MOOR_FLAECHE) };
            expect(nach.wald.revision).toBe(vorher.wald.revision + 1);
            expect(nach.moor.revision).toBe(vorher.moor.revision + 1);
            expect(nach.wald.ring).toContainEqual([298, 333]);
            expect(nach.moor.ring[0]).toEqual([298, 333]);
            // Unveränderte Ecken bleiben bitgenau, auch mit vielen Nachkommastellen.
            expect(nach.moor.ring[1]).toEqual(KRUMM);
            expect(Number(nach.wald.geometry_revision)).toBe(Number(vorher.wald.geometry_revision ?? 0) + 1);
            expect(quittung.affected).toEqual([
                { kind: "landscape", id: WALD, revision: expect.any(Number) as number },
                { kind: "area", id: WALD_FLAECHE, revision: nach.wald.revision },
                { kind: "landscape", id: MOOR, revision: expect.any(Number) as number },
                { kind: "area", id: MOOR_FLAECHE, revision: nach.moor.revision },
            ]);
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual([
                "land_smooth",
                "label_runs",
                "label_runs",
                "tiles",
            ]);
            expect(quittung.mapRevision).toBeGreaterThan(0);
            const protokoll = await cluster!.admin<{ action: string; area: string }[]>`
            SELECT action, region_area_public_id::text AS area FROM map_audit_event ORDER BY id
        `;
            expect(protokoll).toEqual([
                { action: "area.reshaped", area: WALD_FLAECHE },
                { action: "area.carried", area: MOOR_FLAECHE },
            ]);
        });

        it("🔴 ein Konflikt an der Nachbarin nimmt alles zurück: die eigene Fläche bleibt, wie sie war", async () => {
            const flaechen = await mitNachbar([297, 334]);
            const veraltet = flaechen.map((area) =>
                area.id === MOOR_FLAECHE ? { ...area, baseRevision: area.baseRevision - 1 } : area,
            );
            const vorher = await flaeche(WALD_FLAECHE);
            expect(await fehler(updateLandscape(cluster!.app, thomas, WALD, koerper(veraltet)))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await flaeche(WALD_FLAECHE)).toEqual(vorher);
        });

        it("🔴 über diese Route lässt sich keine fremde Fläche umzeichnen: an der Nachbarin bewegt sich nur die gemeinsame Ecke", async () => {
            const flaechen = await mitNachbar([297, 334]);
            const fremd = flaechen.map((area) =>
                area.id === MOOR_FLAECHE
                    ? {
                          ...area,
                          polygons: [
                              [area.polygons[0]![0]!.map(([x, y]) => [x, y === 360 ? 365 : y] as [number, number])],
                          ],
                      }
                    : area,
            );
            const vorher = await flaeche(MOOR_FLAECHE);
            expect(await fehler(updateLandscape(cluster!.app, thomas, WALD, koerper(fremd)))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                // Wo und an welcher Fläche (Vali 2026-11-10): die erste Ecke, die nie gemeinsam war und doch wanderte.
                details: {
                    reason: "nachbar_umgezeichnet",
                    areaId: MOOR_FLAECHE,
                    landschaft: { id: MOOR, name: "Formmoor", eigene: false },
                    stelle: { x: 360, y: 365 },
                },
            });
            expect(await flaeche(MOOR_FLAECHE)).toEqual(vorher);
        });

        it("🔴 ein Ring, dessen Ecken aufeinanderfallen, ist 400 mit Stelle und Fläche, und nichts ist geschrieben", async () => {
            const wald = await flaeche(WALD_FLAECHE);
            const [a, b] = wald.ring as [[number, number], [number, number]];
            // Die dritte Ecke auf die zweite gezogen und die vierte auch: Bereinigt bleiben zwei.
            const zusammen: Ring = [a, b, b, b];
            expect(
                await fehler(
                    updateLandscape(
                        cluster!.app,
                        thomas,
                        WALD,
                        koerper([{ id: WALD_FLAECHE, baseRevision: wald.revision, polygons: [[zusammen]] }]),
                    ),
                ),
            ).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                details: {
                    reason: "ring_unter_drei",
                    areaId: WALD_FLAECHE,
                    landschaft: { id: WALD, name: "Formwald", eigene: true },
                    stelle: { x: a[0], y: a[1] },
                },
            });
            expect(await flaeche(WALD_FLAECHE)).toEqual(wald);
        });

        it("🔴 nur die Nachbarin im Körper schreibt sie (OPS-000079): Die eigene Fläche ist am Ende wie zu Beginn", async () => {
            const flaechen = await mitNachbar([296, 335]);
            const wald = await flaeche(WALD_FLAECHE);
            const moorVorher = await flaeche(MOOR_FLAECHE);
            const nurMoor = flaechen.filter((area) => area.id === MOOR_FLAECHE);
            await updateLandscape(cluster!.app, thomas, WALD, koerper(nurMoor));
            expect(await flaeche(WALD_FLAECHE)).toEqual(wald);
            const moor = await flaeche(MOOR_FLAECHE);
            expect(moor.revision).toBe(moorVorher.revision + 1);
            // Zurück auf die gemeinsame Ecke: Die folgenden Fälle lesen die Ausgangslage.
            await updateLandscape(
                cluster!.app,
                thomas,
                WALD,
                koerper([{ id: MOOR_FLAECHE, baseRevision: moor.revision, polygons: [[moorVorher.ring]] }]),
            );
            expect((await flaeche(MOOR_FLAECHE)).ring).toEqual(moorVorher.ring);
        });

        it("🔴 eine Form, die sich selbst schneidet, ist 400, und nichts ist geschrieben (Befund zu „Fläche vereinfachen“)", async () => {
            const wald = await flaeche(WALD_FLAECHE);
            const [a, b, c, d] = wald.ring;
            // Zwei Ecken getauscht: Der Ring kreuzt sich wie eine Schleife.
            const schleife: Ring = [a!, c!, b!, d!, ...wald.ring.slice(4)];
            expect(
                await fehler(
                    updateLandscape(
                        cluster!.app,
                        thomas,
                        WALD,
                        koerper([{ id: WALD_FLAECHE, baseRevision: wald.revision, polygons: [[schleife]] }]),
                    ),
                ),
            ).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                // Was falsch ist und wo (Vali 2026-11-09): Der Editor markiert die Stelle und nennt die Fläche.
                details: {
                    reason: "form_ungueltig",
                    areaId: WALD_FLAECHE,
                    art: "schneidet_sich",
                    landschaft: { id: WALD, name: "Formwald", eigene: true },
                },
            });
            expect(await flaeche(WALD_FLAECHE)).toEqual(wald);
        });

        it("🔴 die Stelle liegt dort, wo sich die Kanten kreuzen", async () => {
            const wald = await flaeche(WALD_FLAECHE);
            const [a, b, c, d] = wald.ring as [[number, number], [number, number], [number, number], [number, number]];
            const schleife: Ring = [a, c, b, d];
            const antwort = (await fehler(
                updateLandscape(
                    cluster!.app,
                    thomas,
                    WALD,
                    koerper([{ id: WALD_FLAECHE, baseRevision: wald.revision, polygons: [[schleife]] }]),
                ),
            )) as { details?: { stelle?: { x: number; y: number } } };
            // Der Schnitt von a→c mit b→d, gerechnet wie auf Papier.
            const nenner = (a[0] - c[0]) * (b[1] - d[1]) - (a[1] - c[1]) * (b[0] - d[0]);
            const s = ((a[0] - b[0]) * (b[1] - d[1]) - (a[1] - b[1]) * (b[0] - d[0])) / nenner;
            expect(antwort.details?.stelle?.x).toBeCloseTo(a[0] + s * (c[0] - a[0]), 6);
            expect(antwort.details?.stelle?.y).toBeCloseTo(a[1] + s * (c[1] - a[1]), 6);
        });

        it("🔴 schneidet sich nur die mitgezogene Nachbarin, nennt die Ablehnung sie", async () => {
            const vorher = { wald: await flaeche(WALD_FLAECHE), moor: await flaeche(MOOR_FLAECHE) };
            // Die gemeinsame Ecke weit nach unten: Der Wald bleibt ein einfaches Viereck, die Kante des Moors kreuzt seine Unterkante.
            const flaechen = await mitNachbar([340, 400]);
            const antwort = await fehler(updateLandscape(cluster!.app, thomas, WALD, koerper(flaechen)));
            expect(antwort).toMatchObject({
                statusCode: 400,
                details: {
                    reason: "form_ungueltig",
                    areaId: MOOR_FLAECHE,
                    art: "schneidet_sich",
                    landschaft: { id: MOOR, name: "Formmoor", eigene: false },
                },
            });
            // Die Kante von der gemeinsamen Ecke zu KRUMM kreuzt die Unterkante des Moors (y = 360).
            expect((antwort as { details?: { stelle?: { y: number } } }).details?.stelle?.y).toBeCloseTo(360, 6);
            expect(await flaeche(WALD_FLAECHE)).toEqual(vorher.wald);
            expect(await flaeche(MOOR_FLAECHE)).toEqual(vorher.moor);
        });

        it("🔴 ein Loch außerhalb des Rands heißt loch_ueber_rand", async () => {
            const wald = await flaeche(WALD_FLAECHE);
            const loch: Ring = [
                [430, 305],
                [440, 305],
                [440, 315],
                [430, 315],
            ];
            expect(
                await fehler(
                    updateLandscape(
                        cluster!.app,
                        thomas,
                        WALD,
                        koerper([{ id: WALD_FLAECHE, baseRevision: wald.revision, polygons: [[wald.ring, loch]] }]),
                    ),
                ),
            ).toMatchObject({
                statusCode: 400,
                details: { reason: "form_ungueltig", art: "loch_ueber_rand", landschaft: { eigene: true } },
            });
            expect(await flaeche(WALD_FLAECHE)).toEqual(wald);
        });

        it("🔴 hält ein anderer die Nachbarlandschaft, schreibt die Operation nicht; die eigene Sperre hält nicht auf", async () => {
            const anna = { personId: randomUUID(), personName: "Anna" };
            await takeEditorLock(cluster!.app, {
                kind: "landscape",
                id: MOOR,
                part: "form",
                run: randomUUID(),
                ...anna,
            });
            await takeEditorLock(cluster!.app, {
                kind: "landscape",
                id: WALD,
                part: "form",
                run: randomUUID(),
                personId: (thomas as { personId: string }).personId,
                personName: "Thomas",
            });
            const vorher = await flaeche(WALD_FLAECHE);
            expect(
                await fehler(updateLandscape(cluster!.app, thomas, WALD, koerper(await mitNachbar([296, 335])))),
            ).toMatchObject({ statusCode: 409, code: "object_locked" });
            expect(await flaeche(WALD_FLAECHE)).toEqual(vorher);
            await cluster!.admin`DELETE FROM editor_lock WHERE object_id = ${MOOR}`;
            const quittung = await updateLandscape(cluster!.app, thomas, WALD, koerper(await mitNachbar([296, 335])));
            expect(quittung.status).toBe("applied");
            await cluster!.admin`DELETE FROM editor_lock`;
        });

        it("🔴 während der Zug importiert, wird nichts geschrieben (503 map_import_running)", async () => {
            const zug = await cluster!.migrator.reserve();
            try {
                await zug`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                const vorher = await flaeche(WALD_FLAECHE);
                expect(
                    await fehler(updateLandscape(cluster!.app, thomas, WALD, koerper(await mitNachbar([295, 336])))),
                ).toMatchObject({ statusCode: 503, code: "map_import_running" });
                expect(await flaeche(WALD_FLAECHE)).toEqual(vorher);
            } finally {
                await zug`SELECT pg_advisory_unlock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                zug.release();
            }
        });
    },
);
