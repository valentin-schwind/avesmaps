import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { listEditorTerritories, readEditorTerritory } from "../src/editor/territories.ts";
import { restoreTerritory, retireTerritory } from "../src/editor/territory-retire.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Entfernen“ (WI-0209 D3; EDIT-0005 §7 D3, Fragen 4 und 5): `territory.retire` in zwei Stufen und ↺ (`territory.restore`), so wie auf
 * dem VPS: Wegwerf-Cluster, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: „Von der Karte nehmen“ nimmt das Gebiet aus dem Baum; „Ganz löschen“ lässt Untergebiete auf ein stilles Gebiet zeigen;
 * eine fremde Sperre an einem Untergebiet hält nicht auf; ↺ schreibt über eine spätere Änderung hinweg oder vergisst die Herkunft.
 */

const ENV = "entfernen";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d3d3d3d3-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const WEST = ID(2);
const OST = ID(3);
const BARONIE = ID(4);
const JUNKERGUT = ID(5);
const BARONIE_FLAECHE = ID(0xa4);
const JUNKER_FLAECHE = ID(0xa5);

type Ring = [number, number][];
const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

function gebiet(
    id: string,
    name: string,
    eltern: string | null,
    [min, max]: [number, number],
): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: eltern,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: min,
        max_zoom: max,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
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
function flaeche(id: string, territory: string, ring: Ring): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [geschlossen(ring)] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: null,
        max_zoom: null,
        updated_at: "2026-10-18 01:00:00",
    };
}
/** Ein Reich (0–1) mit zwei Provinzen (2–3); die Baronie (4–6) hängt unter West, ihr Junkergut (7–8) unter ihr. */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-entfernen",
        territories: [
            gebiet(REICH, "Reich", null, [0, 1]),
            gebiet(WEST, "Provinz West", REICH, [2, 3]),
            gebiet(OST, "Provinz Ost", REICH, [2, 3]),
            gebiet(BARONIE, "Baronie", WEST, [4, 6]),
            gebiet(JUNKERGUT, "Junkergut", BARONIE, [7, 8]),
        ],
        geometries: [
            flaeche(BARONIE_FLAECHE, BARONIE, [
                [300, 300],
                [420, 300],
                [420, 330],
                [300, 330],
            ]),
            flaeche(JUNKER_FLAECHE, JUNKERGUT, [
                [300, 330],
                [420, 330],
                [420, 360],
                [300, 360],
            ]),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster(
    "Entfernen: territory.retire und territory.restore (WI-0209 D3, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const zeile = async (
            id: string,
        ): Promise<{ revision: number; active: boolean; parent: string | null; origin: string | null }> => {
            const [z] = await cluster!.admin<
                { revision: number; active: boolean; parent: string | null; origin: string | null }[]
            >`
            SELECT t.revision::int AS revision, t.is_active AS active, p.public_id::text AS parent, t.parent_origin AS origin
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${id}
        `;
            return z!;
        };
        const flaecheAktiv = async (id: string): Promise<boolean> => {
            const [z] = await cluster!.admin<
                { aktiv: boolean }[]
            >`SELECT is_active AS aktiv FROM territory_area WHERE public_id = ${id}`;
            return z!.aktiv;
        };
        const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string };
            }
        };
        const entfernen = async (id: string, stage: "off_map" | "retire", children?: "up" | "along" | "root") =>
            retireTerritory(cluster!.app, thomas, id, {
                operationId: randomUUID(),
                baseRevision: (await zeile(id)).revision,
                stage,
                ...(children === undefined ? {} : { children }),
            });
        const zurueck = async (id: string, reverts: string) =>
            restoreTerritory(cluster!.app, thomas, id, { operationId: randomUUID(), reverts });

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
            await deriveTerritories(cluster.jobs, { force: true });
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 „Von der Karte nehmen“: die Flächen gehen, das Gebiet bleibt im Baum; ↺ bringt sie zurück", async () => {
            const vorher = await zeile(BARONIE);
            const quittung = await entfernen(BARONIE, "off_map");
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            expect(await flaecheAktiv(BARONIE_FLAECHE)).toBe(false);
            expect(await zeile(BARONIE)).toEqual(vorher);
            expect(await flaecheAktiv(JUNKER_FLAECHE)).toBe(true);
            // Ohne eigene Fläche geht es nicht.
            expect(await fehler(entfernen(WEST, "off_map"))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            const r = await zurueck(BARONIE, quittung.operationId);
            expect(r.status).toBe("applied");
            expect(await flaecheAktiv(BARONIE_FLAECHE)).toBe(true);
        });

        it("🔴 „Ganz löschen“ mit Untergebieten eine Ebene hoch; ↺ hängt sie zurück, samt Herkunft", async () => {
            expect(await fehler(entfernen(WEST, "retire"))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            const quittung = await entfernen(WEST, "retire", "up");
            expect(await zeile(WEST)).toMatchObject({ active: false });
            expect(await zeile(BARONIE)).toMatchObject({ active: true, parent: REICH, origin: "override" });
            const protokoll = await cluster!.admin<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId} ORDER BY id
        `;
            expect(protokoll).toEqual([
                { action: "territory.retired", changes: { active: { before: true, after: false } } },
                {
                    action: "territory.updated",
                    changes: {
                        parent: { before: WEST, after: REICH },
                        parentOrigin: { before: null, after: "override" },
                    },
                },
            ]);
            // T54: Liste und Detail lesen es weiter, als gelöscht (die Facette „Gelöscht“, das Fenster lesend); kein Lebendes hängt darunter.
            const liste = await listEditorTerritories(cluster!.app);
            expect(liste.rows.find((r) => r.id === WEST)).toMatchObject({
                deleted: true,
                parent: REICH,
                circle: "leer",
            });
            expect(liste.rows.filter((r) => r.parent === WEST)).toEqual([]);
            expect(liste.rows.find((r) => r.id === REICH)?.deleted).toBeUndefined();
            expect(await readEditorTerritory(cluster!.app, WEST)).toMatchObject({ deleted: true, children: [] });
            await zurueck(WEST, quittung.operationId);
            expect(await zeile(WEST)).toMatchObject({ active: true });
            expect((await readEditorTerritory(cluster!.app, WEST))?.deleted).toBeUndefined();
            expect(await zeile(BARONIE)).toMatchObject({ active: true, parent: WEST, origin: null });
        });

        it("🔴 eine fremde Sperre an einem Untergebiet hält „Ganz löschen“ auf; mitgelöscht geht der ganze Teilbaum, ↺ holt ihn", async () => {
            const anna = { personId: randomUUID(), personName: "Anna" };
            await takeEditorLock(cluster!.app, {
                kind: "territory",
                id: JUNKERGUT,
                part: "felder",
                run: randomUUID(),
                ...anna,
            });
            expect(await fehler(entfernen(BARONIE, "retire", "along"))).toMatchObject({
                statusCode: 409,
                code: "object_locked",
            });
            expect(await zeile(BARONIE)).toMatchObject({ active: true });
            await cluster!.admin`DELETE FROM editor_lock`;
            const quittung = await entfernen(BARONIE, "retire", "along");
            expect(await zeile(BARONIE)).toMatchObject({ active: false });
            expect(await zeile(JUNKERGUT)).toMatchObject({ active: false, parent: BARONIE });
            await zurueck(BARONIE, quittung.operationId);
            expect(await zeile(BARONIE)).toMatchObject({ active: true });
            expect(await zeile(JUNKERGUT)).toMatchObject({ active: true, parent: BARONIE });
        });

        it("🔴 ↺ schreibt nicht über eine spätere Änderung: seitdem umgehängt ist 409", async () => {
            const quittung = await entfernen(BARONIE, "retire", "root");
            expect(await zeile(JUNKERGUT)).toMatchObject({ parent: null, origin: "override" });
            await updateTerritory(cluster!.app, thomas, JUNKERGUT, {
                operationId: randomUUID(),
                baseRevision: (await zeile(JUNKERGUT)).revision,
                changes: { parent: OST },
            });
            expect(await fehler(zurueck(BARONIE, quittung.operationId))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await zeile(BARONIE)).toMatchObject({ active: false });
            // Eine fremde Operation lässt sich hier nicht zurücknehmen.
            expect(await fehler(zurueck(OST, quittung.operationId))).toMatchObject({ statusCode: 400 });
        });
    },
);
