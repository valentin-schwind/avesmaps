import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TerritoryAreaCreateBody, TerritoryCreateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { createTerritory, createTerritoryArea, readTerritoryTargets } from "../src/editor/territory-create.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Neue Fläche“ für Herrschaftsgebiete (WI-0209 C3; `territory.create`, `territory_area.create`, die Ziele im Kasten), so wie auf dem VPS:
 * Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: Gebiet und Fläche entstehen in zwei Operationen oder nur eins von beiden; das neue Gebiet trägt eine Legacy-Herkunft;
 * der Platzhalter ist nicht Legacys erster freier Name; die Zoomspanne folgt nicht der Tiefe; eine wiederholte Kennung legt ein zweites
 * Gebiet an; eine Ecke außerhalb der Karte wird geschrieben; „Grenze zeichnen“ legt an einem Gebiet mit eigener Fläche eine zweite an,
 * zählt die Revision des Gebiets hoch oder übergeht eine fremde Sperre; der Auftrag `territory_derive` fehlt.
 */

const ENV = "gebietneu";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `c3c3c3c3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const BARONIE = ID(2);
const REICHSFLAECHE = ID(0xa1);

type Ring = [number, number][];
const REICHSRING: Ring = [
    [300, 300],
    [420, 300],
    [420, 400],
    [300, 400],
];
/** In der Mitte des Reichs; die erste Ecke liegt auf dessen Ecke. */
const NEU: Ring = [
    [300, 300],
    [340, 310],
    [330, 340],
];

function gebiet(publicId: string, name: string, parent: string | null) {
    return {
        public_id: publicId,
        name,
        short_name: "",
        type: "Reich",
        wiki_type: "",
        parent_public_id: parent,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: null,
        max_zoom: null,
        valid_from_bf: null,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: null,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-18 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-gebietneu",
        territories: [gebiet(REICH, "C3 Reich", null), gebiet(BARONIE, "C3 Baronie", REICH)],
        geometries: [
            {
                public_id: REICHSFLAECHE,
                territory_public_id: REICH,
                geometry: { type: "Polygon", coordinates: [[...REICHSRING, REICHSRING[0]!]] },
                valid_from_bf: null,
                valid_to_bf: null,
                min_zoom: null,
                max_zoom: null,
                updated_at: "2026-10-18 01:00:00",
            },
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster(
    "„Neue Fläche“: territory.create und territory_area.create (WI-0209 C3, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const neu = (rest: Omit<TerritoryCreateBody, "operationId">): TerritoryCreateBody => ({
            operationId: randomUUID(),
            ...rest,
        });
        const grenze = (rest: Omit<TerritoryAreaCreateBody, "operationId">): TerritoryAreaCreateBody => ({
            operationId: randomUUID(),
            ...rest,
        });
        const zeile = async (publicId: string) => {
            const [z] = await cluster!.admin<
                {
                    name: string;
                    parent: string | null;
                    color: string;
                    opacity: string;
                    min_zoom: number | null;
                    max_zoom: number | null;
                    source_system: string;
                    legacy_public_id: string | null;
                    revision: number;
                }[]
            >`
            SELECT t.name, p.public_id::text AS parent, t.color, t.opacity::text AS opacity, t.min_zoom, t.max_zoom,
                   t.source_system, t.legacy_public_id::text AS legacy_public_id, t.revision::int AS revision
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${publicId}::uuid
        `;
            return z;
        };
        const flaechen = async (publicId: string) =>
            cluster!.admin<{ public_id: string; source_system: string; ecken: number }[]>`
            SELECT a.public_id::text AS public_id, a.source_system, ST_NPoints(a.geom)::int AS ecken
              FROM territory_area a JOIN territory t ON t.id = a.territory_id
             WHERE t.public_id = ${publicId}::uuid AND a.is_active ORDER BY a.id
        `;
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

        it("🔴 ein Untergebiet: Gebiet und Fläche in EINER Operation, eigene Herkunft, Legacys Name, Spanne nach Tiefe, Protokoll, Auftrag", async () => {
            const quittung = await createTerritory(
                cluster!.app,
                thomas,
                neu({ parent: REICH, color: "#a1b2c3", ring: NEU }),
            );
            expect(quittung.name).toBe("Neues Herrschaftsgebiet");
            // Die Quittung sagt, ab welchem Band die Karte das Untergebiet zeigt (Fund 2026-10-19: darunter schien es verschwunden).
            expect(quittung.minZoom).toBe(2);
            expect(await zeile(quittung.publicId)).toEqual({
                name: "Neues Herrschaftsgebiet",
                parent: REICH,
                color: "#a1b2c3",
                // Die Deckkraft des Obergebiets; die Spanne der zweiten Stufe einer Kette der Länge zwei (Legacys Tafel, 6 wird 8).
                opacity: "0.70",
                min_zoom: 2,
                max_zoom: 8,
                source_system: "avesmaps3d",
                legacy_public_id: null,
                revision: 1,
            });
            expect(await flaechen(quittung.publicId)).toEqual([
                { public_id: quittung.areaId, source_system: "avesmaps3d", ecken: 4 },
            ]);
            expect(quittung.affected).toEqual([
                { kind: "territory", id: quittung.publicId, revision: 1 },
                { kind: "territory_area", id: quittung.areaId, revision: 1 },
            ]);
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            const operationen = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_operation WHERE operation_id = ${quittung.operationId}::uuid
        `;
            expect(operationen).toEqual([{ action: "territory.create" }]);
            const protokoll = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE territory_public_id = ${quittung.publicId}::uuid ORDER BY id
        `;
            expect(protokoll.map((p) => p.action)).toEqual(["territory.created", "territory_area.created"]);
            expect(protokoll[0]!.changes).toEqual({
                name: { after: "Neues Herrschaftsgebiet" },
                parent: { after: REICH },
                color: { after: "#a1b2c3" },
                minZoom: { after: 2 },
                maxZoom: { after: 8 },
                active: { after: true },
            });
            expect(protokoll[1]!.changes).toEqual({
                geometry: { after: [[NEU]] },
                active: { after: true },
            });
        });

        it("🔴 eine Wurzel: Legacys Deckkraft, die ganze Spanne; der Name ist der nächste freie; eine wiederholte Kennung legt nichts neu an", async () => {
            const koerper = neu({ color: "#888888", ring: NEU });
            const quittung = await createTerritory(cluster!.app, thomas, koerper);
            expect(quittung.name).toBe("Neues Herrschaftsgebiet (2)");
            expect(await zeile(quittung.publicId)).toMatchObject({
                parent: null,
                opacity: "0.33",
                min_zoom: 0,
                max_zoom: 8,
            });
            const nochmal = await createTerritory(cluster!.app, thomas, koerper);
            expect(nochmal).toMatchObject({
                publicId: quittung.publicId,
                areaId: quittung.areaId,
                name: quittung.name,
            });
            const [anzahl] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM territory WHERE source_system = 'avesmaps3d'
        `;
            expect(anzahl!.n).toBe(2);
        });

        it("🔴 abgelehnt: unbekanntes Obergebiet, eine Ecke außerhalb der Karte, zu wenig Ecken; nichts geschrieben", async () => {
            const [vorher] = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM territory`;
            for (const koerper of [
                neu({ parent: ID(0xdead), color: "#888888", ring: NEU }),
                neu({ color: "#888888", ring: [...NEU.slice(0, 2), [-90_000, -90_000]] }),
                neu({ color: "#888888", ring: [NEU[0]!, NEU[0]!, NEU[1]!] }),
            ])
                expect(await fehler(createTerritory(cluster!.app, thomas, koerper))).toMatchObject({
                    statusCode: 400,
                    code: "validation_failed",
                });
            const [nachher] = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM territory`;
            expect(nachher!.n).toBe(vorher!.n);
        });

        it("🔴 Claudios §4: ein Fehler NACH dem Einfügen des Gebiets nimmt alles zurück, kein leeres Gebiet bleibt; dieselbe Kennung legt danach an", async () => {
            const zaehle = async () => {
                const [z] = await cluster!.admin<
                    { gebiete: number; flaechen: number; operationen: number; protokoll: number }[]
                >`
                SELECT (SELECT count(*)::int FROM territory) AS gebiete,
                       (SELECT count(*)::int FROM territory_area) AS flaechen,
                       (SELECT count(*)::int FROM map_operation) AS operationen,
                       (SELECT count(*)::int FROM map_audit_event) AS protokoll
            `;
                return z!;
            };
            const vorher = await zaehle();
            const koerper = neu({ color: "#888888", ring: NEU });
            // Die Fläche scheitert, nachdem das Gebiet schon eingefügt ist (wie ein Fehler der Datenbank mitten in der Operation).
            await cluster!.admin.unsafe(`
                CREATE FUNCTION c3_flaeche_scheitert() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'C3-Probe: die Fläche scheitert'; END $$;
                CREATE TRIGGER c3_flaeche_scheitert BEFORE INSERT ON territory_area
                    FOR EACH ROW EXECUTE FUNCTION c3_flaeche_scheitert();
            `);
            try {
                await expect(createTerritory(cluster!.app, thomas, koerper)).rejects.toThrow();
            } finally {
                await cluster!.admin.unsafe(`
                    DROP TRIGGER c3_flaeche_scheitert ON territory_area;
                    DROP FUNCTION c3_flaeche_scheitert();
                `);
            }
            expect(await zaehle()).toEqual(vorher);
            // Nichts hängt an der Kennung: Derselbe Körper legt jetzt Gebiet und Fläche an.
            const quittung = await createTerritory(cluster!.app, thomas, koerper);
            expect(await flaechen(quittung.publicId)).toHaveLength(1);
        });

        it("🔴 „Grenze zeichnen“: nur gegen die Revision und ohne fremde Sperre; die Revision des Gebiets zählt nicht; eine zweite Fläche nie", async () => {
            const vorher = await zeile(BARONIE);
            expect(
                await fehler(
                    createTerritoryArea(
                        cluster!.app,
                        thomas,
                        BARONIE,
                        grenze({ baseRevision: vorher!.revision + 1, ring: NEU }),
                    ),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            await takeEditorLock(cluster!.app, {
                kind: "territory",
                id: BARONIE,
                part: "felder",
                run: randomUUID(),
                personId: randomUUID(),
                personName: "Anna",
            });
            expect(
                await fehler(
                    createTerritoryArea(
                        cluster!.app,
                        thomas,
                        BARONIE,
                        grenze({ baseRevision: vorher!.revision, ring: NEU }),
                    ),
                ),
            ).toMatchObject({ statusCode: 409, code: "object_locked" });
            await cluster!.admin`DELETE FROM editor_lock`;
            expect(await flaechen(BARONIE)).toEqual([]);

            const quittung = await createTerritoryArea(
                cluster!.app,
                thomas,
                BARONIE,
                grenze({ baseRevision: vorher!.revision, ring: NEU }),
            );
            expect(quittung).toMatchObject({ publicId: BARONIE, name: "C3 Baronie" });
            expect(await flaechen(BARONIE)).toEqual([
                { public_id: quittung.areaId, source_system: "avesmaps3d", ecken: 4 },
            ]);
            expect((await zeile(BARONIE))!.revision).toBe(vorher!.revision);
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            const protokoll = await cluster!.admin<{ action: string; area: string }[]>`
            SELECT action, territory_area_public_id::text AS area FROM map_audit_event
             WHERE territory_public_id = ${BARONIE}::uuid ORDER BY id
        `;
            expect(protokoll).toEqual([{ action: "territory_area.created", area: quittung.areaId }]);

            expect(
                await fehler(
                    createTerritoryArea(
                        cluster!.app,
                        thomas,
                        BARONIE,
                        grenze({ baseRevision: vorher!.revision, ring: NEU }),
                    ),
                ),
            ).toMatchObject({ statusCode: 400, code: "validation_failed" });
            expect(
                await fehler(
                    createTerritoryArea(cluster!.app, thomas, ID(0xbeef), grenze({ baseRevision: 1, ring: NEU })),
                ),
            ).toMatchObject({ statusCode: 404 });
        });

        it("die Ziele im Kasten: Ecken und Kanten der Flächen dort, keine von außerhalb", async () => {
            const ziele = await readTerritoryTargets(cluster!.app, { x0: 410, y0: 290, x1: 430, y1: 310 });
            expect(ziele.truncated).toBe(false);
            expect(ziele.corners).toEqual([{ areaId: REICHSFLAECHE, name: "C3 Reich", x: 420, y: 300 }]);
            // Die beiden Kanten des Reichs an seiner Ecke (420, 300); sonst keine Fläche dort.
            expect(ziele.edges.map((k) => k.areaId)).toEqual([REICHSFLAECHE, REICHSFLAECHE]);
            expect(await readTerritoryTargets(cluster!.app, { x0: 600, y0: 600, x1: 610, y1: 610 })).toEqual({
                corners: [],
                edges: [],
                truncated: false,
            });
        });
    },
);
