import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TerritoryUpdateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fertig“ in „Grenzen bearbeiten“ (WI-0209 C2, seit B2 Teil 2 über `territory.update`; EDIT-0005 §7 C1/C2), so wie auf dem VPS:
 * Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle und den Vorlagen, geschrieben als App-Rolle. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die Nachbarfläche wird nicht in derselben Operation geschrieben; ein Konflikt an einer der Flächen lässt die andere
 * geschrieben stehen; über diese Route lässt sich eine fremde Fläche umzeichnen; unveränderte Ecken werden gerundet; ein anderer hält
 * das Nachbargebiet, und die Operation schreibt trotzdem; während des Zugs wird geschrieben; der Auftrag `territory_derive` fehlt; das
 * Fachprotokoll nennt die Fläche nicht.
 */

const ENV = "grenzform";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `c2c2c2c2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WEST = ID(1);
const OST = ID(2);
const WEST_FLAECHE = ID(0xa1);
const OST_FLAECHE = ID(0xa2);
/** Eine Ecke mit vielen Nachkommastellen, wie Legacy sie liefert: Sie muss nach dem Speichern bitgenau bleiben. */
const KRUMM: [number, number] = [360.123456789, 330];

type Ring = [number, number][];
const WEST_RING: Ring = [
    [300, 300],
    [420, 300],
    [420, 330],
    [300, 330],
];
// Ost liegt mit der gemeinsamen Ecke (300, 330) über West.
const OST_RING: Ring = [[300, 330], KRUMM, [360, 360], [300, 360]];
const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

function gebiet(id: string, name: string): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: null,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: 4,
        max_zoom: 6,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}
function flaeche(id: string, territory: string, ring: Ring): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [geschlossen(ring)] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: null,
        max_zoom: null,
        updated_at: "2026-10-17 01:00:00",
    };
}
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-grenzform",
        territories: [gebiet(WEST, "Baronie West"), gebiet(OST, "Baronie Ost")],
        geometries: [flaeche(WEST_FLAECHE, WEST, WEST_RING), flaeche(OST_FLAECHE, OST, OST_RING)],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

type Flaechen = NonNullable<TerritoryUpdateBody["areas"]>;

interface Flaeche {
    revision: number;
    ring: Ring;
}

describeWithCluster(
    "„Fertig“ der Form: territory.update mit Flächen (WI-0209 C2, B2, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const lies = async (id: string): Promise<Flaeche> => {
            const [zeile] = await cluster!.admin<{ revision: number; geojson: string }[]>`
            SELECT revision::int AS revision, ST_AsGeoJSON(geom, 15) AS geojson FROM territory_area WHERE public_id = ${id}
        `;
            // Die Spalte ist ein MultiPolygon (0055): der äußere Ring des ersten Polygons.
            const g = JSON.parse(zeile!.geojson) as { coordinates: Ring[][] };
            return { revision: zeile!.revision, ring: g.coordinates[0]![0]!.slice(0, -1) };
        };
        const koerper = (areas: Flaechen): TerritoryUpdateBody => ({
            operationId: randomUUID(),
            areas,
        });
        /** West mit der gemeinsamen Ecke (die erste von Ost) auf `nach`, Ost mit ihr mitgezogen. */
        const mitNachbar = async (nach: [number, number]): Promise<Flaechen> => {
            const west = await lies(WEST_FLAECHE);
            const ost = await lies(OST_FLAECHE);
            const [gx, gy] = ost.ring[0]!;
            const ziehe = (ring: Ring): Ring => ring.map(([x, y]) => (x === gx && y === gy ? nach : [x, y]));
            return [
                { id: WEST_FLAECHE, baseRevision: west.revision, polygons: [[ziehe(west.ring)]] },
                { id: OST_FLAECHE, baseRevision: ost.revision, polygons: [[ziehe(ost.ring)]] },
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
            await importTerritories(importer, quelle());
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 eine Operation schreibt die eigene Fläche und die mitgezogene Nachbarin, zählt beide Revisionen, reiht die Ableitung ein", async () => {
            const vorher = { west: await lies(WEST_FLAECHE), ost: await lies(OST_FLAECHE) };
            const quittung = await updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([298, 333])));
            const nach = { west: await lies(WEST_FLAECHE), ost: await lies(OST_FLAECHE) };
            expect(nach.west.revision).toBe(vorher.west.revision + 1);
            expect(nach.ost.revision).toBe(vorher.ost.revision + 1);
            expect(nach.west.ring).toContainEqual([298, 333]);
            expect(nach.ost.ring[0]).toEqual([298, 333]);
            // Unveränderte Ecken bleiben bitgenau, auch mit vielen Nachkommastellen.
            expect(nach.ost.ring[1]).toEqual(KRUMM);
            expect(quittung.affected).toEqual([
                { kind: "territory", id: WEST, revision: expect.any(Number) as number },
                { kind: "territory_area", id: WEST_FLAECHE, revision: nach.west.revision },
                { kind: "territory", id: OST, revision: expect.any(Number) as number },
                { kind: "territory_area", id: OST_FLAECHE, revision: nach.ost.revision },
            ]);
            // Der Editor leitet nie selbst ab: Die Schreibnaht reiht EINEN Auftrag ein (B3).
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            expect(quittung.mapRevision).toBeGreaterThan(0);
            const auftraege = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'territory_derive' AND state = 'QUEUED'
        `;
            expect(auftraege[0]!.n).toBe(1);
            const protokoll = await cluster!.admin<{ action: string; gebiet: string; flaeche: string }[]>`
            SELECT action, territory_public_id::text AS gebiet, territory_area_public_id::text AS flaeche
              FROM map_audit_event ORDER BY id
        `;
            expect(protokoll).toEqual([
                { action: "territory_area.reshaped", gebiet: WEST, flaeche: WEST_FLAECHE },
                { action: "territory_area.carried", gebiet: OST, flaeche: OST_FLAECHE },
            ]);
            // Eine zweite Speicherung kurz danach fährt mit demselben wartenden Auftrag (zwei Minuten Sammelzeit).
            await updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([299, 332])));
            const danach = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'territory_derive' AND state = 'QUEUED'
        `;
            expect(danach[0]!.n).toBe(1);
        });

        it("🔴 ein Konflikt an der Nachbarin nimmt alles zurück: die eigene Fläche bleibt, wie sie war", async () => {
            const flaechen = await mitNachbar([297, 334]);
            const veraltet = flaechen.map((area) =>
                area.id === OST_FLAECHE ? { ...area, baseRevision: area.baseRevision - 1 } : area,
            );
            const vorher = await lies(WEST_FLAECHE);
            expect(await fehler(updateTerritory(cluster!.app, thomas, WEST, koerper(veraltet)))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await lies(WEST_FLAECHE)).toEqual(vorher);
        });

        it("🔴 über diese Route lässt sich keine fremde Fläche umzeichnen: an der Nachbarin bewegt sich nur die gemeinsame Ecke", async () => {
            const flaechen = await mitNachbar([297, 334]);
            const fremd = flaechen.map((area) =>
                area.id === OST_FLAECHE
                    ? {
                          ...area,
                          polygons: [
                              [area.polygons[0]![0]!.map(([x, y]) => [x, y === 360 ? 365 : y] as [number, number])],
                          ],
                      }
                    : area,
            );
            const vorher = await lies(OST_FLAECHE);
            expect(await fehler(updateTerritory(cluster!.app, thomas, WEST, koerper(fremd)))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                // Wo und an welchem Gebiet (Vali 2026-11-10): die erste Ecke, die nie gemeinsam war und doch wanderte.
                details: {
                    reason: "nachbar_umgezeichnet",
                    areaId: OST_FLAECHE,
                    gebiet: { id: OST, name: "Baronie Ost", eigene: false },
                    stelle: { x: 360, y: 365 },
                },
            });
            expect(await lies(OST_FLAECHE)).toEqual(vorher);
        });

        it("🔴 ein Gebiet, das sich selbst kreuzt, ist 400 mit Stelle und Namen, und nichts ist geschrieben (Vali 2026-11-10)", async () => {
            const west = await lies(WEST_FLAECHE);
            const [a, b, c, d] = west.ring as [[number, number], [number, number], [number, number], [number, number]];
            // Zwei Ecken getauscht: eine Acht.
            const acht: Ring = [a, c, b, d];
            const antwort = (await fehler(
                updateTerritory(
                    cluster!.app,
                    thomas,
                    WEST,
                    koerper([{ id: WEST_FLAECHE, baseRevision: west.revision, polygons: [[acht]] }]),
                ),
            )) as { statusCode?: number; code?: string; details?: Record<string, unknown> };
            expect(antwort).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                details: {
                    reason: "form_ungueltig",
                    areaId: WEST_FLAECHE,
                    art: "schneidet_sich",
                    gebiet: { id: WEST, name: "Baronie West", eigene: true },
                },
            });
            // Der Schnitt von a→c mit b→d, gerechnet wie auf Papier.
            const stelle = antwort.details?.["stelle"] as { x: number; y: number };
            const nenner = (a[0] - c[0]) * (b[1] - d[1]) - (a[1] - c[1]) * (b[0] - d[0]);
            const t = ((a[0] - b[0]) * (b[1] - d[1]) - (a[1] - b[1]) * (b[0] - d[0])) / nenner;
            expect(stelle.x).toBeCloseTo(a[0] + t * (c[0] - a[0]), 6);
            expect(stelle.y).toBeCloseTo(a[1] + t * (c[1] - a[1]), 6);
            expect(await lies(WEST_FLAECHE)).toEqual(west);
        });

        it("🔴 ein Gebiet, das schon vorher ungültig war (Legacy), lässt sich weiter speichern", async () => {
            const west = await lies(WEST_FLAECHE);
            const [a, b, c, d] = west.ring as [[number, number], [number, number], [number, number], [number, number]];
            const geschrieben = async (ring: Ring): Promise<void> => {
                await cluster!.admin`
                    UPDATE territory_area
                       SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: "Polygon", coordinates: [geschlossen(ring)] })}), 0))
                     WHERE public_id = ${WEST_FLAECHE}
                `;
            };
            await geschrieben([a, c, b, d]);
            try {
                const kaputt = await lies(WEST_FLAECHE);
                const verschoben = kaputt.ring.map(([x, y], i) => (i === 0 ? [x - 1, y] : [x, y]) as [number, number]);
                await updateTerritory(
                    cluster!.app,
                    thomas,
                    WEST,
                    koerper([{ id: WEST_FLAECHE, baseRevision: kaputt.revision, polygons: [[verschoben]] }]),
                );
                expect((await lies(WEST_FLAECHE)).ring[0]).toEqual([a[0] - 1, a[1]]);
            } finally {
                await geschrieben([a, b, c, d]);
            }
        });

        it("🔴 nur die Nachbarin im Körper schreibt sie (OPS-000079, 23 × 404 an Fürstenhort): Die eigene Fläche ist am Ende wie zu Beginn", async () => {
            const flaechen = await mitNachbar([296, 335]);
            const west = await lies(WEST_FLAECHE);
            const ostVorher = await lies(OST_FLAECHE);
            const nurOst = flaechen.filter((area) => area.id === OST_FLAECHE);
            await updateTerritory(cluster!.app, thomas, WEST, koerper(nurOst));
            expect(await lies(WEST_FLAECHE)).toEqual(west);
            const ost = await lies(OST_FLAECHE);
            expect(ost.revision).toBe(ostVorher.revision + 1);
            expect(ost.ring[0]).toEqual([296, 335]);
            // Zurück auf die gemeinsame Ecke: Die folgenden Fälle lesen die Ausgangslage. Auch das schreibt nur die Nachbarin.
            await updateTerritory(
                cluster!.app,
                thomas,
                WEST,
                koerper([{ id: OST_FLAECHE, baseRevision: ost.revision, polygons: [[ostVorher.ring]] }]),
            );
            expect((await lies(OST_FLAECHE)).ring).toEqual(ostVorher.ring);
        });

        it("🔴 eine Nachbarin mit doppelter Ecke aus den Altdaten zieht mit (OPS-000079, Baronie Gemhar neben Bockshag am Drei-Länder-Eck)", async () => {
            const ost = await lies(OST_FLAECHE);
            const doppelt: Ring = [ost.ring[0]!, ost.ring[1]!, ost.ring[1]!, ...ost.ring.slice(2)];
            const geojson = JSON.stringify({ type: "Polygon", coordinates: [geschlossen(doppelt)] });
            await cluster!.admin`
                UPDATE territory_area SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 0))
                 WHERE public_id = ${OST_FLAECHE}
            `;
            expect((await lies(OST_FLAECHE)).ring).toHaveLength(ost.ring.length + 1);
            // Der Client schickt sie, wie er sie las, mit der gezogenen Ecke; der Server schreibt sie bereinigt.
            await updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([296, 335])));
            const nach = await lies(OST_FLAECHE);
            expect(nach.ring[0]).toEqual([296, 335]);
            expect(nach.ring).toHaveLength(ost.ring.length);
            const [letztes] = await cluster!.admin<{ action: string; changes: { geometry: { before: unknown } } }[]>`
                SELECT action, changes FROM map_audit_event WHERE territory_area_public_id = ${OST_FLAECHE} ORDER BY id DESC LIMIT 1
            `;
            expect(letztes!.action).toBe("territory_area.carried");
            expect(letztes!.changes.geometry.before).toEqual([ost.ring[0]]);
        });

        it("🔴 ein neuer Punkt auf der gemeinsamen Grenze kommt in die Nachbarin (Thomas 2026-10-19, 5.2); das Protokoll trägt ihre ganze Form", async () => {
            const west = await lies(WEST_FLAECHE);
            const ost = await lies(OST_FLAECHE);
            // Ein Punkt auf der Kante von West, die an der gemeinsamen Ecke endet, kurz vor ihr; West bekommt ihn vor der Ecke, Ost dahinter.
            // Seit 2026-11-10 prüft der Server, ob sich ein Gebiet kreuzt: Der frühere Punkt (+7, +1) hinter der Ecke kreuzte West.
            const [gx, gy] = ost.ring[0]!;
            const iWest = west.ring.findIndex(([x, y]) => x === gx && y === gy);
            const [vx, vy] = west.ring[(iWest + west.ring.length - 1) % west.ring.length]!;
            const neu: [number, number] = [gx + (vx - gx) / 16, gy + (vy - gy) / 16];
            const mitPunkt = (ring: Ring): Ring => {
                const i = ring.findIndex(([x, y]) => x === gx && y === gy);
                const stelle = ring === west.ring ? i : i + 1;
                return [...ring.slice(0, stelle), neu, ...ring.slice(stelle)];
            };
            await updateTerritory(
                cluster!.app,
                thomas,
                WEST,
                koerper([
                    { id: WEST_FLAECHE, baseRevision: west.revision, polygons: [[mitPunkt(west.ring)]] },
                    { id: OST_FLAECHE, baseRevision: ost.revision, polygons: [[mitPunkt(ost.ring)]] },
                ]),
            );
            expect((await lies(OST_FLAECHE)).ring).toEqual(mitPunkt(ost.ring));
            const [letztes] = await cluster!.admin<
                { action: string; changes: { geometry: { before: unknown; after: unknown } } }[]
            >`
                SELECT action, changes FROM map_audit_event WHERE territory_area_public_id = ${OST_FLAECHE} ORDER BY id DESC LIMIT 1
            `;
            expect(letztes!.action).toBe("territory_area.reshaped");
            expect(letztes!.changes.geometry.before).toEqual([[ost.ring]]);
            expect(letztes!.changes.geometry.after).toEqual([[mitPunkt(ost.ring)]]);

            // Ein Punkt auf einer Kante, die das Gebiet nicht teilt und den es auch nicht hat, zeichnet die Nachbarin um: abgelehnt.
            const westDanach = await lies(WEST_FLAECHE);
            const ostDanach = await lies(OST_FLAECHE);
            const [x0, y0] = ostDanach.ring[0]!;
            const fremd: Ring = [...ostDanach.ring.slice(0, 3), [x0 + 3, y0 + 9], ...ostDanach.ring.slice(3)];
            expect(
                await fehler(
                    updateTerritory(
                        cluster!.app,
                        thomas,
                        WEST,
                        koerper([
                            { id: WEST_FLAECHE, baseRevision: westDanach.revision, polygons: [[westDanach.ring]] },
                            { id: OST_FLAECHE, baseRevision: ostDanach.revision, polygons: [[fremd]] },
                        ]),
                    ),
                ),
            ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        });

        it("🔴 hält ein anderer das Nachbargebiet, schreibt die Operation nicht; die eigene Sperre hält nicht auf", async () => {
            const anna = { personId: randomUUID(), personName: "Anna" };
            await takeEditorLock(cluster!.app, {
                kind: "territory",
                id: OST,
                part: "form",
                run: randomUUID(),
                ...anna,
            });
            await takeEditorLock(cluster!.app, {
                kind: "territory",
                id: WEST,
                part: "form",
                run: randomUUID(),
                personId: (thomas as { personId: string }).personId,
                personName: "Thomas",
            });
            const vorher = await lies(WEST_FLAECHE);
            expect(
                await fehler(updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([296, 335])))),
            ).toMatchObject({ statusCode: 409, code: "object_locked" });
            expect(await lies(WEST_FLAECHE)).toEqual(vorher);
            await cluster!.admin`DELETE FROM editor_lock WHERE object_id = ${OST}`;
            const quittung = await updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([296, 335])));
            expect(quittung.status).toBe("applied");
            await cluster!.admin`DELETE FROM editor_lock`;
        });

        it("🔴 während der Zug importiert, wird nichts geschrieben (503 map_import_running)", async () => {
            const zug = await cluster!.migrator.reserve();
            try {
                await zug`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                const vorher = await lies(WEST_FLAECHE);
                expect(
                    await fehler(updateTerritory(cluster!.app, thomas, WEST, koerper(await mitNachbar([295, 336])))),
                ).toMatchObject({ statusCode: 503, code: "map_import_running" });
                expect(await lies(WEST_FLAECHE)).toEqual(vorher);
            } finally {
                await zug`SELECT pg_advisory_unlock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                zug.release();
            }
        });
    },
);
