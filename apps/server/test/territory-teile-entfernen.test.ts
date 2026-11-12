import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Capability, TerritoryUpdateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ruecknehmenGebiet, vorschauGebiet } from "../src/editor/ruecknahme-gebiet.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { readEditorTerritoryForm } from "../src/editor/territory-form.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Unterpolygone löschen …“ am Herrschaftsgebiet (OPS-000075; Melder: „beim Editieren entstandene Unterpolygone wie z.B. außerhalb von
 * Uhdenwald sind nicht löschbar“): Eine Fläche ist ein MultiPolygon, ein Teil davon geht, indem `territory.update` die Fläche ohne ihn
 * schreibt - der vorhandene Schreibweg der Form, kein zweiter. Wegwerf-Cluster mit den Rollen des VPS, geschrieben als App-Rolle.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Der Lesepfad des Kartenmenüs schleppt Nachbarn und Kanten mit; ein Teil geht, aber die übrigen Ecken verschieben sich;
 * eine veraltete Revision schreibt trotzdem; der letzte Teil einer Fläche lässt sich entfernen (die Fläche wäre leer); das Fachprotokoll
 * trägt die Form davor und danach nicht vollständig, und ↺ holt den Teil nicht zurück.
 */

const ENV = "unterpoly";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `75757575-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WALD = ID(1);
const NACHBAR = ID(2);
const WALD_FLAECHE = ID(0xa1);
const NACHBAR_FLAECHE = ID(0xa2);
/** Eine Ecke mit vielen Nachkommastellen: Sie muss nach dem Entfernen eines anderen Teils bitgenau bleiben. */
const KRUMM: [number, number] = [410.123456789, 330];

type Ring = [number, number][];
const HAUPT: Ring = [[300, 300], [420, 300], KRUMM, [300, 330]];
/** Der Splitter außerhalb, wie ihn das Editieren hinterlässt: winzig, ohne Verbindung zum Hauptteil. */
const SPLITTER: Ring = [
    [500, 500],
    [500.3, 500],
    [500.3, 500.2],
    [500, 500.2],
];
const KLEIN: Ring = [
    [600, 600],
    [602, 600],
    [602, 601],
];
// Der Nachbar teilt die Ecke (300, 330) mit dem Hauptteil.
const NACHBAR_RING: Ring = [
    [300, 330],
    [360, 330],
    [360, 360],
    [300, 360],
];
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
function flaeche(id: string, territory: string, teile: Ring[]): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "MultiPolygon", coordinates: teile.map((ring) => [geschlossen(ring)]) },
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
        territories_revision: "pt-fixture-unterpoly",
        territories: [gebiet(WALD, "Uhdenwald"), gebiet(NACHBAR, "Baronie Nachbar")],
        geometries: [
            flaeche(WALD_FLAECHE, WALD, [HAUPT, SPLITTER, KLEIN]),
            flaeche(NACHBAR_FLAECHE, NACHBAR, [NACHBAR_RING]),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

type Flaechen = NonNullable<TerritoryUpdateBody["areas"]>;
type Polygone = Flaechen[number]["polygons"];

describeWithCluster(
    "„Unterpolygone löschen …“: territory.update ohne den Teil (OPS-000075, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const personId = randomUUID();
        const thomas: MapActor = { kind: "person", personId, environment: "test" };
        const leser: RuecknahmeLeser = {
            personId,
            // Seit WI-0279 (Betreiber 2026-11-04): Felder `edit_territories`, ein Teil entfernen oder zurückholen ist Form und steht ab Admin (`edit_territory_form`).
            rechte: new Set<Capability>(["use_editor_menu", "edit_territories", "edit_territory_form"]),
        };

        /** Die Fläche, wie der Server sie hält: Revision und alle Polygone als GeoJSON (bitgenau). */
        const lies = async (id: string): Promise<{ revision: number; teile: number; geojson: string }> => {
            const [zeile] = await cluster!.admin<{ revision: number; teile: number; geojson: string }[]>`
                SELECT revision::int AS revision, ST_NumGeometries(geom)::int AS teile, ST_AsGeoJSON(geom, 15) AS geojson
                  FROM territory_area WHERE public_id = ${id}::uuid
            `;
            return zeile!;
        };
        /** Der Lesepfad des Kartenmenüs: die Polygone ohne Schlusspunkt, wie der Client sie wieder zurückschickt. */
        const leseTeile = async (): Promise<{ revision: number; polygons: Polygone }> => {
            const form = await readEditorTerritoryForm(cluster!.app, WALD, undefined, "aventuria", undefined, true);
            const a = form!.areas.find((x) => x.id === WALD_FLAECHE)!;
            return { revision: a.revision, polygons: a.polygons };
        };
        const ohne = (polygons: Polygone, index: number): Polygone => polygons.filter((_, i) => i !== index);
        const koerper = (areas: Flaechen): TerritoryUpdateBody => ({ operationId: randomUUID(), areas });
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

        it("🔴 der schlanke Lesepfad liefert die Flächen mit allen Teilen, aber weder Nachbarn noch Kanten", async () => {
            const voll = await readEditorTerritoryForm(cluster!.app, WALD);
            const schlank = await readEditorTerritoryForm(cluster!.app, WALD, undefined, "aventuria", undefined, true);
            // Der volle Lesepfad kennt den Nachbarn mit der gemeinsamen Ecke; der schlanke lässt ihn und die Kanten weg.
            expect(voll!.neighbors.map((n) => n.id)).toEqual([NACHBAR_FLAECHE]);
            expect(schlank!.neighbors).toEqual([]);
            expect(schlank!.edges).toEqual([]);
            // Dieselben Flächen, dieselben drei Teile in der Folge, in der sie gespeichert sind.
            expect(schlank!.areas).toEqual(voll!.areas);
            expect(schlank!.areas[0]!.polygons).toHaveLength(3);
            expect(schlank!.areas[0]!.polygons[1]).toEqual([SPLITTER]);
        });

        it("🔴 ein Teil geht, die übrigen bleiben bitgenau; EINE Operation gegen die Revision, mit der Form davor und danach im Protokoll, Auftrag zur Ableitung", async () => {
            const vorher = await lies(WALD_FLAECHE);
            const nachbar = await lies(NACHBAR_FLAECHE);
            const stand = await leseTeile();
            expect(stand.revision).toBe(vorher.revision);
            const quittung = await updateTerritory(
                cluster!.app,
                thomas,
                WALD,
                koerper([{ id: WALD_FLAECHE, baseRevision: stand.revision, polygons: ohne(stand.polygons, 1) }]),
            );
            const nach = await lies(WALD_FLAECHE);
            expect(nach.teile).toBe(2);
            expect(nach.revision).toBe(vorher.revision + 1);
            // Der Hauptteil mit seiner krummen Ecke und der kleine Teil stehen genau wie vorher; nur der Splitter fehlt.
            const alt = JSON.parse(vorher.geojson) as { coordinates: number[][][][] };
            const neu = JSON.parse(nach.geojson) as { coordinates: number[][][][] };
            expect(neu.coordinates).toEqual([alt.coordinates[0], alt.coordinates[2]]);
            expect(neu.coordinates[0]![0]).toContainEqual([...KRUMM]);
            // Die Nachbarin bleibt unberührt: Es ist keine Formänderung mit mitgezogenen Ecken.
            expect((await lies(NACHBAR_FLAECHE)).revision).toBe(nachbar.revision);
            expect(quittung.affected).toContainEqual({
                kind: "territory_area",
                id: WALD_FLAECHE,
                revision: nach.revision,
            });
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("territory_derive");
            const protokoll = await cluster!.admin<
                { action: string; flaeche: string; changes: { geometry: { before: unknown[]; after: unknown[] } } }[]
            >`
                SELECT action, territory_area_public_id::text AS flaeche, changes
                  FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid
            `;
            expect(protokoll).toHaveLength(1);
            expect(protokoll[0]).toMatchObject({ action: "territory_area.reshaped", flaeche: WALD_FLAECHE });
            expect(protokoll[0]!.changes.geometry.before).toHaveLength(3);
            expect(protokoll[0]!.changes.geometry.after).toHaveLength(2);
        });

        it("🔴 eine veraltete Revision schreibt nicht (409 edit_conflict), die Fläche bleibt, wie sie war", async () => {
            const stand = await leseTeile();
            const vorher = await lies(WALD_FLAECHE);
            expect(
                await fehler(
                    updateTerritory(
                        cluster!.app,
                        thomas,
                        WALD,
                        koerper([
                            { id: WALD_FLAECHE, baseRevision: stand.revision - 1, polygons: ohne(stand.polygons, 1) },
                        ]),
                    ),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await lies(WALD_FLAECHE)).toEqual(vorher);
        });

        it("🔴 der letzte Teil einer Fläche lässt sich nicht entfernen (400); die Fläche bleibt", async () => {
            const stand = await leseTeile();
            const vorher = await lies(WALD_FLAECHE);
            for (const leer of [[], [[]]] as unknown as Polygone[]) {
                expect(
                    await fehler(
                        updateTerritory(
                            cluster!.app,
                            thomas,
                            WALD,
                            koerper([{ id: WALD_FLAECHE, baseRevision: stand.revision, polygons: leer }]),
                        ),
                    ),
                ).toMatchObject({ statusCode: 400, code: "validation_failed" });
            }
            expect(await lies(WALD_FLAECHE)).toEqual(vorher);
        });

        it("🔴 ↺ in „Änderungen“ holt den entfernten Teil zurück: die Fläche steht wieder wie vorher, bitgenau", async () => {
            // Nach dem ersten Fall hat die Fläche zwei Teile (Hauptteil, kleiner Teil); hier geht der kleine, und ↺ holt ihn wieder.
            const vorher = await lies(WALD_FLAECHE);
            const stand = await leseTeile();
            expect(stand.polygons).toHaveLength(2);
            const quittung = await updateTerritory(
                cluster!.app,
                thomas,
                WALD,
                koerper([{ id: WALD_FLAECHE, baseRevision: stand.revision, polygons: ohne(stand.polygons, 1) }]),
            );
            expect((await lies(WALD_FLAECHE)).teile).toBe(1);

            const pruefung = await vorschauGebiet(cluster!.app, WALD, { members: [quittung.operationId] }, leser);
            expect(pruefung.ergebnis).toBe("ok");
            const rueck = await ruecknehmenGebiet(cluster!.app, thomas, leser, WALD, {
                operationId: randomUUID(),
                members: [quittung.operationId],
                membersHash: pruefung.membersHash,
            });
            expect(rueck.reverts).toEqual([quittung.operationId]);
            const nach = await lies(WALD_FLAECHE);
            expect(nach.teile).toBe(2);
            expect(JSON.parse(nach.geojson)).toEqual(JSON.parse(vorher.geojson));
        });
    },
);
