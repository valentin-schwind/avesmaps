import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { territoryHistory } from "../src/editor/history.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readEditorTerritory } from "../src/editor/territories.ts";
import { readParentConsequences } from "../src/editor/territory-reparent.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { verifyOwnBands } from "../src/territories/verify-legacy-bands.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Umhängen“ (WI-0209 D1; EDIT-0005 §7 D1, EDIT-0003 R13, F24 Ausnahme): das Obergebiet als Feld von `territory.update` und das Blatt der
 * Folgen je Band vorher, so wie auf dem VPS: Wegwerf-Cluster, geschrieben als App-Rolle, abgeleitet als Jobs-Rolle. 🔴 Kein Test schreibt
 * in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Das Blatt sagt anderes, als die Karte nach der Ableitung zeigt (N2); ein Gebiet landet unter sich selbst oder einem seiner
 * Untergebiete; das Umhängen geschieht still (keine Herkunft `override`, kein Protokoll mit vorher und nachher); der nächste Gebietsimport
 * lässt die Herkunft stehen, obwohl er den Elter zurückschreibt.
 */

const ENV = "umhaengen";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d1d1d1d1-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
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
        territories_revision: "pt-fixture-umhaengen",
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
    "Umhängen: Obergebiet in territory.update und die Folgen je Band (WI-0209 D1, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const zeile = async (
            id: string,
        ): Promise<{ revision: number; parent: string | null; origin: string | null }> => {
            const [z] = await cluster!.admin<{ revision: number; parent: string | null; origin: string | null }[]>`
            SELECT t.revision::int AS revision, p.public_id::text AS parent, t.parent_origin AS origin
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${id}
        `;
            return z!;
        };
        const fehler = async (
            arbeit: Promise<unknown>,
        ): Promise<{ statusCode?: number; code?: string; details?: unknown }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string; details?: unknown };
            }
        };
        const umhaengen = async (id: string, parent: string) =>
            updateTerritory(cluster!.app, thomas, id, {
                operationId: randomUUID(),
                baseRevision: (await zeile(id)).revision,
                changes: { parent },
            });
        /** Was die Ableitung in einem Band zeigt: Fläche → Gebiet. */
        const band = async (b: number): Promise<Map<string, string>> =>
            new Map(
                (
                    await cluster!.admin<{ flaeche: string; gebiet: string }[]>`
                    SELECT a.public_id::text AS flaeche, t.public_id::text AS gebiet
                      FROM territory_display_area da
                      JOIN territory_area a ON a.id = da.area_id
                      JOIN territory t ON t.id = da.territory_id
                     WHERE da.band = ${b}
                `
                ).map((r) => [r.flaeche, r.gebiet]),
            );

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

        it("🔴 das Blatt sagt vorher, was die Karte nach der Ableitung zeigt: Band 2 und 3 zählen die Flächen dann zu Ost (N2 ohne Abweichung)", async () => {
            const folgen = await readParentConsequences(cluster!.app, BARONIE, OST);
            expect(folgen).toMatchObject({
                id: BARONIE,
                from: { id: WEST, name: "Provinz West" },
                to: { id: OST, name: "Provinz Ost" },
                kreis: false,
                descendants: 1,
            });
            expect(folgen!.changes).toEqual([
                {
                    bands: [2, 3],
                    from: { id: WEST, name: "Provinz West" },
                    to: { id: OST, name: "Provinz Ost" },
                    areas: 2,
                },
            ]);

            const quittung = await umhaengen(BARONIE, OST);
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            await deriveTerritories(cluster!.jobs);
            for (const wechsel of folgen!.changes)
                for (const b of wechsel.bands) {
                    const gezeigt = await band(b);
                    expect(gezeigt.get(BARONIE_FLAECHE), `Band ${String(b)}`).toBe(wechsel.to?.id);
                    expect(gezeigt.get(JUNKER_FLAECHE), `Band ${String(b)}`).toBe(wechsel.to?.id);
                }
            const nachweis = await verifyOwnBands(cluster!.jobs);
            expect(nachweis.bands.filter((b) => b.differences.length > 0)).toEqual([]);
        });

        it("🔴 nicht still: Herkunft override am Obergebiet, ✎ im Detail, Protokoll mit vorher und nachher, die Revision zählt", async () => {
            const jetzt = await zeile(BARONIE);
            expect(jetzt).toMatchObject({ parent: OST, origin: "override" });
            expect((await readEditorTerritory(cluster!.app, BARONIE))?.parentOrigin).toBe("override");
            expect((await readEditorTerritory(cluster!.app, WEST))?.parentOrigin).toBeUndefined();
            const protokoll = await cluster!.admin<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event WHERE territory_public_id = ${BARONIE} ORDER BY id
        `;
            expect(protokoll.at(-1)).toEqual({
                action: "territory.updated",
                changes: { parent: { before: WEST, after: OST } },
            });
            // Zur Wurzel geht es auch; zurück unter West wieder.
            await umhaengen(BARONIE, "");
            expect(await zeile(BARONIE)).toMatchObject({ parent: null, origin: "override" });
            await umhaengen(BARONIE, WEST);
            expect(await zeile(BARONIE)).toMatchObject({
                parent: WEST,
                origin: "override",
                revision: jetzt.revision + 2,
            });
        });

        it("🔴 nie unter sich selbst oder ein eigenes Untergebiet: 400 mit Satz, das Blatt nennt den Kreis; unbekannt ist 400", async () => {
            const vorher = await zeile(BARONIE);
            expect(await fehler(umhaengen(BARONIE, JUNKERGUT))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                details: { field: "parent", reason: "kreis" },
            });
            expect(await fehler(umhaengen(BARONIE, BARONIE))).toMatchObject({ statusCode: 400 });
            expect(await fehler(umhaengen(BARONIE, ID(0xff)))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            expect(await zeile(BARONIE)).toEqual(vorher);
            expect(await readParentConsequences(cluster!.app, BARONIE, JUNKERGUT)).toMatchObject({
                kreis: true,
                changes: [],
            });
        });

        it("🔴 D5: der Verlauf nennt das Umhängen mit vorher und nachher; ↺ holt es als neue Operation zurück (Quelle restore)", async () => {
            await umhaengen(BARONIE, OST);
            const seite = await territoryHistory(cluster!.app, BARONIE, { personId: thomas.personId });
            const neueste = seite.entries[0]!;
            expect(neueste).toMatchObject({
                operation: "territory.update",
                source: "editor",
                actor: { kind: "person", self: true },
            });
            expect(neueste.objects).toEqual([
                expect.objectContaining({
                    kind: "territory",
                    id: BARONIE,
                    name: "Baronie",
                    action: "territory.updated",
                    changes: { parent: { before: WEST, after: OST } },
                }),
            ]);
            // Ein Nachbar steht nicht im Verlauf der Baronie: Die Provinz Ost hat keinen eigenen Eintrag.
            expect((await territoryHistory(cluster!.app, OST, {})).entries).toEqual([]);

            const jetzt = await zeile(BARONIE);
            const quittung = await updateTerritory(cluster!.app, thomas, BARONIE, {
                operationId: randomUUID(),
                reverts: neueste.operationId,
                baseRevision: jetzt.revision,
                changes: { parent: WEST },
            });
            expect(quittung.status).toBe("applied");
            expect(await zeile(BARONIE)).toMatchObject({ parent: WEST, origin: "override" });
            const zurueck = (await territoryHistory(cluster!.app, BARONIE, {})).entries[0]!;
            expect(zurueck).toMatchObject({ source: "restore", summary: "Baronie: Änderung zurückgenommen" });
        });

        it("🔴 der nächste Gebietsimport schreibt den Elter zurück und nimmt die Herkunft mit", async () => {
            await umhaengen(BARONIE, OST);
            expect(await zeile(BARONIE)).toMatchObject({ parent: OST, origin: "override" });
            await importTerritories(importer!, quelle());
            expect(await zeile(BARONIE)).toMatchObject({ parent: WEST, origin: null });
        });
    },
);
