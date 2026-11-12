import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TerritoryUpdateBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readEditorTerritory } from "../src/editor/territories.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fertig“ im Gebietseditor (WI-0209 B2; O3; Operation `territory.update`), so wie auf dem VPS: Wegwerf-Cluster mit Migrations-, App-
 * und Jobs-Rolle, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Felder ohne Revision; eine reine Formänderung zählt die Revision des Gebiets hoch (T44 (4)); ein leerer Text bleibt ein
 * leerer Text statt NULL; die Hauptstadt zeigt auf einen Ort, den es nicht gibt; ein Konflikt an einer Fläche lässt die Felder geschrieben
 * stehen; ein anderer hält das Gebiet, und die Operation schreibt trotzdem; der Auftrag `territory_derive` fehlt.
 */

const ENV = "gebietfelder";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `b2b2b2b2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GEBIET = ID(1);
const FLAECHE = ID(0xa1);
const STADT = ID(0xc1);
const OHNE_LAGE = ID(0xc2);

type Ring = [number, number][];
const RING: Ring = [
    [300, 300],
    [420, 300],
    [420, 330],
    [300, 330],
];

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-gebietfelder",
        territories: [
            {
                public_id: GEBIET,
                name: "Baronie Alt",
                short_name: "Alt",
                type: "Baronie",
                wiki_type: "Baronie",
                parent_public_id: null,
                status: "Lehen",
                color: "#b2b065",
                opacity: 0.7,
                min_zoom: 4,
                max_zoom: 6,
                valid_from_bf: 100,
                valid_to_bf: 9999,
                valid_label: "",
                wiki_key: "wiki:Baronie Alt",
                wiki_url: null,
                capital_place_public_id: null,
                seat_place_public_id: null,
                sort_order: 0,
                updated_at: "2026-10-17 01:00:00",
                coat_of_arms_url: "",
                coat_license_status: "",
                coat_origin: "",
            },
        ],
        geometries: [
            {
                public_id: FLAECHE,
                territory_public_id: GEBIET,
                geometry: { type: "Polygon", coordinates: [[...RING, RING[0]!]] },
                valid_from_bf: null,
                valid_to_bf: null,
                min_zoom: null,
                max_zoom: null,
                updated_at: "2026-10-17 01:00:00",
            },
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

describeWithCluster("„Fertig“: territory.update (WI-0209 B2, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const koerper = (rest: Omit<TerritoryUpdateBody, "operationId">): TerritoryUpdateBody => ({
        operationId: randomUUID(),
        ...rest,
    });
    const gebiet = async () => {
        const [zeile] = await cluster!.admin<
            {
                revision: number;
                name: string;
                short_name: string | null;
                territory_type: string | null;
                status_text: string | null;
                capital: string | null;
            }[]
        >`
            SELECT revision::int AS revision, name, short_name, territory_type, status_text,
                   capital_place_public_id::text AS capital
              FROM territory WHERE public_id = ${GEBIET}
        `;
        return zeile!;
    };
    const flaeche = async () => {
        const [zeile] = await cluster!.admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM territory_area WHERE public_id = ${FLAECHE}
        `;
        return zeile!;
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
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        await importTerritories(importer, quelle());
        await cluster.admin`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${STADT}, 'aventuria', 'B2 Neustadt', 'stadt', ST_SetSRID(ST_MakePoint(350, 310), 0), 'test')
        `;
        await cluster.admin`
            INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, source_system)
            VALUES (${OHNE_LAGE}, 'aventuria', 'B2 Irgendwo', 'dorf', 'test')
        `;
    }, 240_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 Felder gegen die Revision: Name, Kurzname geleert, Hauptstadt als Ort; Protokoll und Auftrag; das Detail trägt die Revision", async () => {
        const vorher = await gebiet();
        const detail = await readEditorTerritory(cluster!.app, GEBIET);
        expect(detail?.revision).toBe(vorher.revision);
        const quittung = await updateTerritory(
            cluster!.app,
            thomas,
            GEBIET,
            koerper({
                baseRevision: vorher.revision,
                changes: { name: "  Baronie Neu ", shortName: "", status: "Lehen", capital: STADT },
            }),
        );
        expect(await gebiet()).toEqual({
            revision: vorher.revision + 1,
            name: "Baronie Neu",
            short_name: null,
            territory_type: "Baronie",
            status_text: "Lehen",
            capital: STADT,
        });
        expect(quittung.affected).toEqual([{ kind: "territory", id: GEBIET, revision: vorher.revision + 1 }]);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
        const protokoll = await cluster!.admin<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event WHERE territory_public_id = ${GEBIET} ORDER BY id
        `;
        expect(protokoll).toEqual([
            {
                action: "territory.updated",
                changes: {
                    name: { before: "Baronie Alt", after: "Baronie Neu" },
                    shortName: { before: "Alt", after: null },
                    capital: { before: null, after: STADT },
                },
            },
        ]);
    });

    it("🔴 eine Hauptstadt ohne Lage geht, ein unbekannter Ort nicht; ein leerer Wert nimmt sie weg", async () => {
        const r = (await gebiet()).revision;
        await updateTerritory(
            cluster!.app,
            thomas,
            GEBIET,
            koerper({ baseRevision: r, changes: { capital: OHNE_LAGE } }),
        );
        expect((await gebiet()).capital).toBe(OHNE_LAGE);
        expect(
            await fehler(
                updateTerritory(
                    cluster!.app,
                    thomas,
                    GEBIET,
                    koerper({ baseRevision: r + 1, changes: { capital: ID(0xdead) } }),
                ),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        await updateTerritory(cluster!.app, thomas, GEBIET, koerper({ baseRevision: r + 1, changes: { capital: "" } }));
        expect((await gebiet()).capital).toBeNull();
    });

    it("🔴 nur die Form: die Fläche gegen ihre Revision, das Gebiet zählt nicht (T44 (4)); ein Konflikt dort nimmt auch die Felder zurück", async () => {
        const vorher = await gebiet();
        const f = await flaeche();
        const neu: Ring = RING.map(([x, y]) => (x === 420 && y === 330 ? [425, 335] : [x, y]));
        const quittung = await updateTerritory(
            cluster!.app,
            thomas,
            GEBIET,
            koerper({ areas: [{ id: FLAECHE, baseRevision: f.revision, polygons: [[neu]] }] }),
        );
        expect((await gebiet()).revision).toBe(vorher.revision);
        expect((await flaeche()).revision).toBe(f.revision + 1);
        expect(quittung.affected).toEqual([
            { kind: "territory", id: GEBIET, revision: vorher.revision },
            { kind: "territory_area", id: FLAECHE, revision: f.revision + 1 },
        ]);
        // Felder und eine veraltete Fläche in einer Operation: alles zurück.
        expect(
            await fehler(
                updateTerritory(
                    cluster!.app,
                    thomas,
                    GEBIET,
                    koerper({
                        baseRevision: vorher.revision,
                        changes: { name: "Baronie Zwischen" },
                        areas: [{ id: FLAECHE, baseRevision: f.revision, polygons: [[RING]] }],
                    }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await gebiet()).toEqual(vorher);
    });

    it("🔴 veraltete Revision 409; hält ein anderer das Gebiet 409 object_locked; nichts zu schreiben 400", async () => {
        const vorher = await gebiet();
        expect(
            await fehler(
                updateTerritory(
                    cluster!.app,
                    thomas,
                    GEBIET,
                    koerper({ baseRevision: vorher.revision - 1, changes: { name: "Spät" } }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        await takeEditorLock(cluster!.app, {
            kind: "territory",
            id: GEBIET,
            part: "felder",
            run: randomUUID(),
            personId: randomUUID(),
            personName: "Anna",
        });
        expect(
            await fehler(
                updateTerritory(
                    cluster!.app,
                    thomas,
                    GEBIET,
                    koerper({ baseRevision: vorher.revision, changes: { name: "Gesperrt" } }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        await cluster!.admin`DELETE FROM editor_lock`;
        expect(await fehler(updateTerritory(cluster!.app, thomas, GEBIET, koerper({})))).toMatchObject({
            statusCode: 400,
        });
        expect(
            await fehler(
                updateTerritory(cluster!.app, thomas, GEBIET, koerper({ changes: { name: "Ohne Revision" } })),
            ),
        ).toMatchObject({ statusCode: 400 });
        expect(await gebiet()).toEqual(vorher);
    });
});
