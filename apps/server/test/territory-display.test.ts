import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TerritoryDisplayBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { changeTerritoryDisplay } from "../src/editor/territory-display.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { verifyOwnBands } from "../src/territories/verify-legacy-bands.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fertig“ in „Farben und Zoombänder“ (WI-0209 D2, D4; EDIT-0005 §7 D2 und D4; Operation `territory.display`), so wie auf dem VPS: Wegwerf-Cluster
 * mit Migrations-, App- und Jobs-Rolle, geschrieben als App-Rolle, abgeleitet als Jobs-Rolle wie der Auftrag. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Eine Baronie mit Spanne 4 bis 8 fehlt in Band 7 und 8, weil ihre Fläche ihr eigenes Band bis 5 behält oder die
 * Ableitung nur bis 6 rechnet (`deriveMaxBand`); ein Konflikt an einem Gebiet lässt das andere geschrieben stehen; ein Gebiet, das
 * nicht geändert wurde, zählt seine Revision hoch oder hält eine fremde Sperre auf; eine Lücke sperrt das Speichern; der Auftrag
 * `territory_derive` fehlt; N2 findet nach der Ableitung eine Abweichung. Eine reine Farbänderung reiht eine Ableitung ein, schreibt die
 * Spanne mit oder leert die Bänder der Flächen.
 */

const ENV = "zoomband";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d2d2d2d2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const GRAFSCHAFT = ID(2);
const NORD = ID(3);
const SUED = ID(4);
const NORD_FLAECHE = ID(0xa3);
const SUED_FLAECHE = ID(0xa4);

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
        updated_at: "2026-10-17 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}
function flaeche(id: string, territory: string, ring: Ring, [min, max]: [number, number]): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [geschlossen(ring)] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: min,
        max_zoom: max,
        updated_at: "2026-10-17 01:00:00",
    };
}
/**
 * Ein Reich (0 bis 1), seine Grafschaft (2 bis 3) und zwei Baronien (4 bis 5) mit je einer Fläche, die ihr eigenes Band 4 bis 5
 * trägt. Legacys Obergrenze 5 bleibt beim Import 5 (nur 6 wird 8): In Band 6 bis 8 zeigt die Karte hier nichts.
 */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-zoomband",
        territories: [
            gebiet(REICH, "Reich", null, [0, 1]),
            gebiet(GRAFSCHAFT, "Grafschaft", REICH, [2, 3]),
            gebiet(NORD, "Baronie Nord", GRAFSCHAFT, [4, 5]),
            gebiet(SUED, "Baronie Süd", GRAFSCHAFT, [4, 5]),
        ],
        geometries: [
            flaeche(
                NORD_FLAECHE,
                NORD,
                [
                    [300, 300],
                    [420, 300],
                    [420, 330],
                    [300, 330],
                ],
                [4, 5],
            ),
            flaeche(
                SUED_FLAECHE,
                SUED,
                [
                    [300, 330],
                    [420, 330],
                    [420, 360],
                    [300, 360],
                ],
                [4, 5],
            ),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

interface Spanne {
    revision: number;
    min: number | null;
    max: number | null;
}

describeWithCluster("„Fertig“: territory.display (WI-0209 D2, D4, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const gebietLesen = async (id: string): Promise<Spanne> => {
        const [zeile] = await cluster!.admin<Spanne[]>`
            SELECT revision::int AS revision, min_zoom AS min, max_zoom AS max FROM territory WHERE public_id = ${id}
        `;
        return zeile!;
    };
    const flaecheLesen = async (id: string): Promise<Spanne> => {
        const [zeile] = await cluster!.admin<Spanne[]>`
            SELECT revision::int AS revision, min_zoom AS min, max_zoom AS max FROM territory_area WHERE public_id = ${id}
        `;
        return zeile!;
    };
    const koerper = (territories: TerritoryDisplayBody["territories"]): TerritoryDisplayBody => ({
        operationId: randomUUID(),
        territories,
    });
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };
    /** Was die Ableitung in einem Band zeigt: Fläche → Gebiet. */
    const band = async (b: number): Promise<string[]> =>
        (
            await cluster!.admin<{ zeile: string }[]>`
                SELECT a.public_id::text || '>' || t.public_id::text AS zeile
                  FROM territory_display_area da
                  JOIN territory_area a ON a.id = da.area_id
                  JOIN territory t ON t.id = da.territory_id
                 WHERE da.band = ${b}
                 ORDER BY 1
            `
        ).map((r) => r.zeile);

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
        await deriveTerritories(cluster.jobs, { force: true });
    }, 240_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 Spanne 4 bis 8 einer Baronie: ihre Fläche verliert das eigene Band, Band 7 und 8 zeigen sie, N2 ohne Abweichung", async () => {
        expect(await band(7)).toEqual([]);
        const nord = await gebietLesen(NORD);
        const sued = await gebietLesen(SUED);
        const flaecheVorher = await flaecheLesen(NORD_FLAECHE);
        const quittung = await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([
                { id: NORD, baseRevision: nord.revision, zoom: { minZoom: 4, maxZoom: 8 } },
                // Unverändert mitgeschickt: zählt nicht und schreibt nicht.
                { id: SUED, baseRevision: sued.revision, zoom: { minZoom: 4, maxZoom: 5 } },
            ]),
        );
        expect(await gebietLesen(NORD)).toEqual({ revision: nord.revision + 1, min: 4, max: 8 });
        expect(await gebietLesen(SUED)).toEqual(sued);
        expect(await flaecheLesen(NORD_FLAECHE)).toEqual({
            revision: flaecheVorher.revision + 1,
            min: null,
            max: null,
        });
        expect(await flaecheLesen(SUED_FLAECHE)).toMatchObject({ min: 4, max: 5 });
        expect(quittung.affected).toEqual([
            { kind: "territory", id: NORD, revision: nord.revision + 1 },
            { kind: "territory_area", id: NORD_FLAECHE, revision: flaecheVorher.revision + 1 },
        ]);
        // Der Editor leitet nie selbst ab: Die Schreibnaht reiht EINEN Auftrag ein (B3).
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
        const protokoll = await cluster!.admin<{ action: string; flaeche: string | null; changes: unknown }[]>`
            SELECT action, territory_area_public_id::text AS flaeche, changes FROM map_audit_event ORDER BY id
        `;
        expect(protokoll).toEqual([
            { action: "territory.display_changed", flaeche: null, changes: { maxZoom: { before: 5, after: 8 } } },
            {
                action: "territory_area.bands_cleared",
                flaeche: NORD_FLAECHE,
                changes: { minZoom: { before: 4, after: null }, maxZoom: { before: 5, after: null } },
            },
        ]);

        // Der Auftrag (hier direkt, als Jobs-Rolle): Band 6 bis 8 zeigen die Baronie Nord, Band 4 und 5 beide Baronien wie vorher.
        await deriveTerritories(cluster!.jobs);
        for (const b of [6, 7, 8]) expect(await band(b), `Band ${String(b)}`).toEqual([`${NORD_FLAECHE}>${NORD}`]);
        expect(await band(5)).toEqual([`${NORD_FLAECHE}>${NORD}`, `${SUED_FLAECHE}>${SUED}`].sort());
        const nachweis = await verifyOwnBands(cluster!.jobs);
        expect(nachweis.bands.filter((b) => b.differences.length > 0)).toEqual([]);
        expect(nachweis.derivedMaxBand).toBe(8);
    });

    it("🔴 eine Lücke sperrt nicht: Süd auf 6 bis 6 lässt Band 4 und 5 ohne Süd, gespeichert wird trotzdem", async () => {
        const sued = await gebietLesen(SUED);
        const quittung = await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([{ id: SUED, baseRevision: sued.revision, zoom: { minZoom: 6, maxZoom: 6 } }]),
        );
        expect(quittung.status).toBe("applied");
        expect(await gebietLesen(SUED)).toMatchObject({ min: 6, max: 6 });
        // Eine offene Grenze ist erlaubt (Legacy NULL), „von“ über „bis“ nicht.
        const jetzt = await gebietLesen(SUED);
        expect(
            await fehler(
                changeTerritoryDisplay(
                    cluster!.app,
                    thomas,
                    koerper([{ id: SUED, baseRevision: jetzt.revision, zoom: { minZoom: 7, maxZoom: 5 } }]),
                ),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([{ id: SUED, baseRevision: jetzt.revision, zoom: { minZoom: 4 } }]),
        );
        expect(await gebietLesen(SUED)).toMatchObject({ min: 4, max: null });
    });

    it("🔴 ein Konflikt an einem Gebiet nimmt alles zurück: das andere bleibt, wie es war", async () => {
        const nord = await gebietLesen(NORD);
        const sued = await gebietLesen(SUED);
        expect(
            await fehler(
                changeTerritoryDisplay(
                    cluster!.app,
                    thomas,
                    koerper([
                        { id: NORD, baseRevision: nord.revision, zoom: { minZoom: 3, maxZoom: 8 } },
                        { id: SUED, baseRevision: sued.revision - 1, zoom: { minZoom: 3, maxZoom: 8 } },
                    ]),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await gebietLesen(NORD)).toEqual(nord);
    });

    it("🔴 nur geänderte Gebiete zählen: eine fremde Sperre an einem anderen Gebiet hält nicht auf, an einem geänderten schon", async () => {
        const anna = { personId: randomUUID(), personName: "Anna" };
        await takeEditorLock(cluster!.app, {
            kind: "territory",
            id: GRAFSCHAFT,
            part: "form",
            run: randomUUID(),
            ...anna,
        });
        const nord = await gebietLesen(NORD);
        const quittung = await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([{ id: NORD, baseRevision: nord.revision, zoom: { minZoom: 5, maxZoom: 8 } }]),
        );
        expect(quittung.status).toBe("applied");
        await takeEditorLock(cluster!.app, { kind: "territory", id: SUED, part: "form", run: randomUUID(), ...anna });
        const sued = await gebietLesen(SUED);
        expect(
            await fehler(
                changeTerritoryDisplay(
                    cluster!.app,
                    thomas,
                    koerper([{ id: SUED, baseRevision: sued.revision, zoom: { minZoom: 5, maxZoom: 8 } }]),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        expect(await gebietLesen(SUED)).toEqual(sued);
        await cluster!.admin`DELETE FROM editor_lock`;
    });

    it("🔴 D4 nur Farben: geschrieben mit Protokoll, keine Ableitung, Spanne und Bänder der Flächen bleiben", async () => {
        const nord = await gebietLesen(NORD);
        const sued = await gebietLesen(SUED);
        const flaecheVorher = await flaecheLesen(SUED_FLAECHE);
        await cluster!.admin`DELETE FROM map_audit_event`;
        const quittung = await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([
                { id: NORD, baseRevision: nord.revision, color: "#5dac60" },
                { id: SUED, baseRevision: sued.revision, color: "#a1ae62" },
            ]),
        );
        // Die Farbe geht in kein abgeleitetes Ergebnis ein: nur eine neue Kachelrevision, kein Auftrag (auch kein wartender).
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
        expect(quittung.mapRevision).toBeGreaterThan(0);
        expect(await gebietLesen(NORD)).toEqual({ ...nord, revision: nord.revision + 1 });
        expect(await gebietLesen(SUED)).toEqual({ ...sued, revision: sued.revision + 1 });
        expect(await flaecheLesen(SUED_FLAECHE)).toEqual(flaecheVorher);
        const farben = await cluster!.admin<{ public_id: string; color: string }[]>`
            SELECT public_id::text AS public_id, color FROM territory WHERE public_id IN (${NORD}, ${SUED}) ORDER BY public_id
        `;
        expect(farben).toEqual([
            { public_id: NORD, color: "#5dac60" },
            { public_id: SUED, color: "#a1ae62" },
        ]);
        const protokoll = await cluster!.admin<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event ORDER BY id
        `;
        expect(protokoll).toEqual([
            { action: "territory.display_changed", changes: { color: { before: "#b2b065", after: "#5dac60" } } },
            { action: "territory.display_changed", changes: { color: { before: "#b2b065", after: "#a1ae62" } } },
        ]);
    });

    it("🔴 D4 Farbe und Spanne zusammen: EINE Operation, mit Ableitung; nichts zu ändern ist 400, ohne beides auch", async () => {
        const nord = await gebietLesen(NORD);
        const quittung = await changeTerritoryDisplay(
            cluster!.app,
            thomas,
            koerper([{ id: NORD, baseRevision: nord.revision, zoom: { minZoom: 4, maxZoom: 8 }, color: "#60a75a" }]),
        );
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
        const jetzt = await gebietLesen(NORD);
        expect(
            await fehler(
                changeTerritoryDisplay(
                    cluster!.app,
                    thomas,
                    koerper([{ id: NORD, baseRevision: jetzt.revision, color: "#60a75a" }]),
                ),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(
            await fehler(
                changeTerritoryDisplay(cluster!.app, thomas, koerper([{ id: NORD, baseRevision: jetzt.revision }])),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(await gebietLesen(NORD)).toEqual(jetzt);
    });

    it("🔴 während der Zug importiert, wird nichts geschrieben (503 map_import_running)", async () => {
        const zug = await cluster!.migrator.reserve();
        try {
            await zug`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
            const nord = await gebietLesen(NORD);
            expect(
                await fehler(
                    changeTerritoryDisplay(
                        cluster!.app,
                        thomas,
                        koerper([{ id: NORD, baseRevision: nord.revision, zoom: { minZoom: 2, maxZoom: 8 } }]),
                    ),
                ),
            ).toMatchObject({ statusCode: 503, code: "map_import_running" });
            expect(await gebietLesen(NORD)).toEqual(nord);
        } finally {
            await zug`SELECT pg_advisory_unlock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
            zug.release();
        }
    });
});
