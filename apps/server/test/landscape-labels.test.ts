import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { releaseEditorLock, takeEditorLock } from "../src/editor/editor-lock.ts";
import { createLandscapeLabel, retireLandscapeLabel } from "../src/editor/landscape-labels.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Beschriftungen anlegen, duplizieren und löschen (WI-0232, `label.create` und `label.retire`), so wie auf dem VPS: Wegwerf-Cluster mit
 * Migrations-, App- und Jobs-Rolle und den Vorlagen, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: die neue Beschriftung trägt einen eigenen Text oder eine andere Art als die Landschaft (FL3); ein Duplikat verliert Größe,
 * Rang oder Spanne; an einer Landschaft „entlang der Fläche“ entsteht ein Punkt (F7); eine Beschriftung landet außerhalb der Karte oder
 * ohne Lage nirgends; gegen eine alte Revision der Landschaft oder unter der Sperre eines anderen wird geschrieben; Löschen löscht hart,
 * nimmt die letzte Beschriftung ohne Rückfrage (Betreiber 2026-07-28: die Landschaft geht mit, über „Fläche entfernen …“) oder eine, an der
 * eine Kraftlinie endet; ↺ holt eine andere Beschriftung zurück oder eine, die sich seitdem geändert hat; die App-Rolle darf nicht schreiben.
 */

const ENV = "landlabels";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const WALD = "c4c4c4c4-0000-4000-8000-000000000001";
const MOOR = "c4c4c4c4-0000-4000-8000-000000000002";
const HEIDE = "c4c4c4c4-0000-4000-8000-000000000003";
const WALD_FLAECHE = "c4c4c4c4-0000-4000-8000-0000000000a1";
const MOOR_FLAECHE = "c4c4c4c4-0000-4000-8000-0000000000a2";
const HEIDE_FLAECHE = "c4c4c4c4-0000-4000-8000-0000000000a3";
const WALD_LABEL = "c4c4c4c4-0000-4000-8000-0000000000c1";
const MOOR_LABEL = "c4c4c4c4-0000-4000-8000-0000000000c2";
const HEIDE_LABEL = "c4c4c4c4-0000-4000-8000-0000000000c3";

const ring = (x: number, y: number, k: number): [number, number][] => [
    [x, y],
    [x + k, y],
    [x + k, y + k],
    [x, y + k],
    [x, y],
];

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    const label = (id: string, region: string, name: string, art: string, x: number, y: number) => ({
        geometry: { type: "Point", coordinates: [x, y] },
        properties: {
            feature_type: "label",
            public_id: id,
            name,
            feature_subtype: art,
            ecosystem_region_public_id: region,
            size: 22,
            priority: 4,
            min_zoom: 2,
            max_zoom: 6,
        },
    });
    const flaeche = (id: string, region: string, x: number, k: number) => ({
        public_id: id,
        region_public_id: region,
        geometry: { type: "Polygon", coordinates: [ring(x, 300, k)] },
    });
    return {
        regions: {
            ok: true,
            regions: [
                { public_id: WALD, name: "Schriftwald", kind: "vegetation", region_type: "wald", area_count: 1 },
                { public_id: MOOR, name: "Schriftmoor", kind: "vegetation", region_type: "moor", area_count: 1 },
                { public_id: HEIDE, name: "Schriftheide", kind: "vegetation", region_type: "steppe", area_count: 1 },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9601,
            truncated: false,
            areas: [
                flaeche(WALD_FLAECHE, WALD, 300, 80),
                flaeche(MOOR_FLAECHE, MOOR, 500, 60),
                flaeche(HEIDE_FLAECHE, HEIDE, 650, 50),
            ],
        } as never,
        labels: {
            ok: true,
            revision: 9602,
            features: [
                label(WALD_LABEL, WALD, "Schriftwald", "wald", 340, 340),
                label(MOOR_LABEL, MOOR, "Schriftmoor", "moor", 530, 330),
                label(HEIDE_LABEL, HEIDE, "Schriftheide", "steppe", 670, 320),
            ],
        } as never,
    };
}

describeWithCluster("Beschriftungen anlegen und löschen (WI-0232, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const revision = async (regionId: string): Promise<number> => {
        const [z] = await cluster!.admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM region WHERE public_id = ${regionId}::uuid
        `;
        return z!.revision;
    };
    const zeile = async (publicId: string) => {
        const [z] = await cluster!.admin<
            {
                name: string;
                subtype: string | null;
                x: number;
                y: number;
                size: number | null;
                priority: number | null;
                min: number | null;
                max: number | null;
                show_name: boolean | null;
                placement: string | null;
                text_follows_name: boolean | null;
                source_system: string;
                is_active: boolean;
                revision: number;
                region: string;
            }[]
        >`
            SELECT l.name, l.subtype, ST_X(l.geom) AS x, ST_Y(l.geom) AS y, l.label_size::float8 AS size, l.label_priority AS priority,
                   l.label_min_zoom AS min, l.label_max_zoom AS max, l.show_name, l.placement, l.text_follows_name, l.source_system,
                   l.is_active, l.revision::int AS revision, r.public_id::text AS region
              FROM map_label l JOIN region r ON r.id = l.region_id WHERE l.public_id = ${publicId}::uuid
        `;
        return z;
    };
    const neu = (regionId: string, rest: Record<string, unknown> = {}) =>
        revision(regionId).then((baseRevision) =>
            createLandscapeLabel(cluster!.app, thomas, regionId, { operationId: randomUUID(), baseRevision, ...rest }),
        );
    const weg = async (regionId: string, labelId: string, rest: Record<string, unknown> = {}) =>
        retireLandscapeLabel(cluster!.app, thomas, regionId, labelId, {
            operationId: randomUUID(),
            baseRevision: await revision(regionId),
            labelRevision: (await zeile(labelId))!.revision,
            ...rest,
        });
    const fehler = async (
        arbeit: Promise<unknown>,
    ): Promise<{ statusCode?: number; code?: string; message?: string; details?: Record<string, unknown> }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string; message?: string };
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
        const satz = quelle();
        await importRegions(importer, satz.regions, satz.areas, satz.labels);
    }, 240_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    });

    it("🔴 „Neue Beschriftung“ an der Stelle des Menüs: Text und Art der Landschaft, an einem Punkt, eigene Herkunft, als App-Rolle", async () => {
        const vorher = await revision(WALD);
        const quittung = await neu(WALD, { position: [320, 310] });
        expect(quittung.status).toBe("applied");
        expect(quittung.affected).toEqual(
            expect.arrayContaining([
                { kind: "label", id: quittung.publicId, revision: 1 },
                expect.objectContaining({ id: WALD }),
            ]),
        );
        expect(await revision(WALD)).toBe(vorher + 1);
        expect(await zeile(quittung.publicId)).toMatchObject({
            name: "Schriftwald",
            subtype: "wald",
            x: 320,
            y: 310,
            size: null,
            priority: null,
            show_name: true,
            placement: "punkt",
            text_follows_name: true,
            source_system: "avesmaps3d",
            is_active: true,
            region: WALD,
        });
        // Die Schriftläufe folgen von selbst (`deriveAfter`, ein Auftrag je Landschaft).
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("label_runs");
        const [protokoll] = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE map_label_public_id = ${quittung.publicId}::uuid
        `;
        expect(protokoll!.action).toBe("label.created");
    });

    it("ohne Lage ein Punkt in der Fläche; als Duplikat mit Größe, Rang, Spanne und Sichtbarkeit des Originals", async () => {
        const ohne = await neu(WALD);
        const punkt = (await zeile(ohne.publicId))!;
        expect(punkt.x).toBeGreaterThan(300);
        expect(punkt.x).toBeLessThan(380);
        expect(punkt.y).toBeGreaterThan(300);
        expect(punkt.y).toBeLessThan(380);

        await cluster!.admin`UPDATE map_label SET show_name = FALSE WHERE public_id = ${WALD_LABEL}::uuid`;
        const kopie = await neu(WALD, { position: [350, 360], from: WALD_LABEL });
        expect(await zeile(kopie.publicId)).toMatchObject({
            name: "Schriftwald",
            subtype: "wald",
            size: 22,
            priority: 4,
            min: 2,
            max: 6,
            show_name: false,
            source_system: "avesmaps3d",
        });
        await cluster!.admin`UPDATE map_label SET show_name = TRUE WHERE public_id = ${WALD_LABEL}::uuid`;
    });

    it("abgewiesen, ohne zu schreiben: entlang der Fläche (F7), außerhalb, fremde Vorlage, alte Revision, fremde Sperre", async () => {
        const anzahl = async () =>
            (await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM map_label`)[0]!.n;
        const vorher = await anzahl();
        await cluster!
            .admin`UPDATE region SET label_curve_enabled = TRUE, label_curve_max = 1 WHERE public_id = ${MOOR}::uuid`;
        const entlang = await fehler(neu(MOOR, { position: [520, 320] }));
        expect(entlang).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(entlang.message).toContain("entlang der Fläche");
        await cluster!.admin`UPDATE region SET label_curve_enabled = FALSE WHERE public_id = ${MOOR}::uuid`;

        expect(await fehler(neu(WALD, { position: [-50, -50] }))).toMatchObject({ statusCode: 400 });
        expect(await fehler(neu(WALD, { position: [320, 320], from: MOOR_LABEL }))).toMatchObject({ statusCode: 400 });
        expect(
            await fehler(
                createLandscapeLabel(cluster!.app, thomas, WALD, {
                    operationId: randomUUID(),
                    baseRevision: (await revision(WALD)) - 1,
                    position: [320, 320],
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });

        const run = randomUUID();
        await takeEditorLock(cluster!.app, {
            kind: "landscape",
            id: WALD,
            part: "felder",
            run,
            personId: randomUUID(),
            personName: "Anna",
        });
        expect(await fehler(neu(WALD, { position: [320, 320] }))).toMatchObject({
            statusCode: 409,
            code: "object_locked",
        });
        await releaseEditorLock(cluster!.app, run, { kind: "landscape", id: WALD });
        expect(await anzahl()).toBe(vorher);
    });

    it("🔴 „Löschen“: still gelegt, nie hart, die Landschaft bleibt", async () => {
        const quittung = await neu(WALD, { position: [310, 370] });
        const r = (await zeile(quittung.publicId))!.revision;
        const geloescht = await weg(WALD, quittung.publicId);
        expect(geloescht.affected).toEqual(
            expect.arrayContaining([{ kind: "label", id: quittung.publicId, revision: r + 1 }]),
        );
        expect(await zeile(quittung.publicId)).toMatchObject({ is_active: false, revision: r + 1 });
        const [protokoll] = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE map_label_public_id = ${quittung.publicId}::uuid ORDER BY id DESC LIMIT 1
        `;
        expect(protokoll!.action).toBe("label.retired");
        expect(
            await cluster!.codesAs(cluster!.app, [`DELETE FROM map_label WHERE public_id = '${quittung.publicId}'`]),
        ).toEqual(["42501"]);
    });

    it("🔴 die letzte Beschriftung: 409 `last_label` mit dem Satz der Rückfrage, nichts geschrieben (sie geht über „Fläche entfernen …“)", async () => {
        const vorher = await zeile(MOOR_LABEL);
        const antwort = await fehler(weg(MOOR, MOOR_LABEL));
        expect(antwort).toMatchObject({ statusCode: 409, code: "last_label" });
        expect(antwort.message).toBe(
            "Das ist die letzte Beschriftung von „Schriftmoor“. Die Landschaft mit ihrer Fläche wird mit entfernt.",
        );
        expect(antwort.details).toMatchObject({ name: "Schriftmoor", areas: 1 });
        expect(await zeile(MOOR_LABEL)).toEqual(vorher);
    });

    it("409, wenn an der Beschriftung eine Kraftlinie endet (wie „Fläche entfernen“)", async () => {
        const zweite = await neu(HEIDE, { position: [660, 330] });
        await cluster!.admin`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${randomUUID()}::uuid, 'aventuria', 'Schriftader', TRUE, ${HEIDE_LABEL}::uuid, ${randomUUID()}::uuid,
                    ST_GeomFromText('LINESTRING(670 320, 900 320)', 0), ST_GeomFromText('LINESTRING(670 320, 900 320)', 0), 'avesmaps3d')
        `;
        const antwort = await fehler(weg(HEIDE, HEIDE_LABEL));
        expect(antwort).toMatchObject({ statusCode: 409, code: "powerline_endpoint" });
        expect(antwort.message).toContain("Schriftader");
        expect((await zeile(HEIDE_LABEL))!.is_active).toBe(true);
        expect((await zeile(zweite.publicId))!.is_active).toBe(true);
    });

    it("↺ im Verlauf: Anlegen zurücknehmen (auch die einzige neue), Löschen zurückholen, nicht nach einer Änderung", async () => {
        const quittung = await neu(WALD, { position: [330, 330] });
        await weg(WALD, quittung.publicId, { reverts: quittung.operationId });
        expect((await zeile(quittung.publicId))!.is_active).toBe(false);

        const zweite = await neu(WALD, { position: [335, 335] });
        const geloescht = await weg(WALD, zweite.publicId);
        const zurueck = await neu(WALD, { reverts: geloescht.operationId });
        expect(zurueck.publicId).toBe(zweite.publicId);
        expect(await zeile(zweite.publicId)).toMatchObject({ is_active: true, x: 335, y: 335 });

        // Nach einer Änderung an der Beschriftung geht ↺ des Anlegens nicht mehr.
        await cluster!.admin`UPDATE map_label SET label_size = 30 WHERE public_id = ${zweite.publicId}::uuid`;
        expect(await fehler(weg(WALD, zweite.publicId, { reverts: zweite.operationId }))).toMatchObject({
            statusCode: 409,
            code: "edit_conflict",
        });
        // ↺ mit Lage oder Vorlage ist kein ↺.
        expect(await fehler(neu(WALD, { reverts: geloescht.operationId, position: [1, 1] }))).toMatchObject({
            statusCode: 400,
        });
    });
});
