import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { refreshLabelCurve } from "../src/derive/refresh-label-curve.ts";
import { verifyRuns } from "../src/derive/verify-runs.ts";
import { listEditorLandscapes, listHiddenLandscapes, readEditorLandscape } from "../src/editor/landscapes.ts";
import { queryAreasAt } from "../src/areas/area-lookup.ts";
import { search } from "../src/search/search.ts";
import { retireLandscape } from "../src/editor/landscape-retire.ts";
import { updateLandscape } from "../src/editor/landscape-update.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { importTerrain, readTerrainSources } from "../src/migration/terrain.ts";
import { verifyRegions } from "../src/migration/verify-regions.ts";
import { verifyTerrain } from "../src/migration/verify-terrain.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Fläche entfernen …“ (WI-0178 D2; Claudio 2026-10-18, `2026-10-18-landschaft-entfernen-antwort-an-claudia.md`), so wie auf dem VPS:
 * Wegwerf-Cluster, geschrieben als App-Rolle, der Zug als Migrationsrolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: Teilflächen oder Beschriftungen bleiben aktiv (Kacheln, Suche, Gelände sähen die Fläche weiter); der nächste
 * Landschaften-Zug holt eine abgenommene Fläche samt Teilen zurück, oder er stellt Teile still und meldet sie im zweiten Lauf als
 * Änderung; `verify:regions`, `verify:terrain` oder `verify:runs` werden mit einer abgenommenen Fläche rot (Claudio, Bedingungen A und
 * B: dann erreicht der Zug Production nicht); der Auftrag `label_runs` scheitert an einer stillen Fläche; ↺ holt nicht genau zurück, was
 * mitging; eine Kraftlinie verliert ihren Endpunkt (Bedingung C); der Kontinent „Aventurien“ verschwindet.
 */

const ENV = "landretire";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const GEBIRGE = "c6c6c6c6-0000-4000-8000-000000000001";
const GEBIRGE_FLAECHE = "c6c6c6c6-0000-4000-8000-0000000000a1";
const GEBIRGE_LABEL = "c6c6c6c6-0000-4000-8000-0000000000c1";
const WALD = "c6c6c6c6-0000-4000-8000-000000000002";
const WALD_FLAECHE = "c6c6c6c6-0000-4000-8000-0000000000a2";
const WALD_LABEL = "c6c6c6c6-0000-4000-8000-0000000000c2";
const HUEGEL = "c6c6c6c6-0000-4000-8000-000000000003";
const HUEGEL_FLAECHE = "c6c6c6c6-0000-4000-8000-0000000000a3";
const HUEGEL_LABEL = "c6c6c6c6-0000-4000-8000-0000000000c3";
const AVENTURIEN = "c6c6c6c6-0000-4000-8000-000000000004";

type Ring = [number, number][];
const quadrat = (x0: number, y0: number, x1: number, y1: number): Ring[] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ],
];

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    const label = (id: string, region: string, name: string, subtype: string, x: number, y: number) => ({
        geometry: { type: "Point", coordinates: [x, y] },
        properties: {
            feature_type: "label",
            public_id: id,
            name,
            feature_subtype: subtype,
            ecosystem_region_public_id: region,
        },
    });
    return {
        regions: {
            ok: true,
            regions: [
                { public_id: GEBIRGE, name: "Probegrat", kind: "topographie", region_type: "gebirge", area_count: 1 },
                { public_id: WALD, name: "Probeforst", kind: "vegetation", region_type: "wald", area_count: 1 },
                {
                    public_id: HUEGEL,
                    name: "Probehügel",
                    kind: "topographie",
                    region_type: "huegelland",
                    area_count: 1,
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
            revision: 9601,
            truncated: false,
            areas: [
                {
                    public_id: GEBIRGE_FLAECHE,
                    region_public_id: GEBIRGE,
                    kind: "topographie",
                    region_type: "gebirge",
                    label_public_id: GEBIRGE_LABEL,
                    geometry: { type: "Polygon", coordinates: quadrat(500, 500, 560, 530) },
                    terrain_grain: 6,
                    terrain_levels: 5,
                    terrain_erosion: 3,
                    terrain_plateau: 0.85,
                    terrain_hypsometrie: null,
                    terrain_avg_height: 3200,
                    terrain_bergform: 2,
                    terrain_rauschen: 0.35,
                    terrain_sattel: 0.4,
                    terrain_talbreite: 1.5,
                    terrain_einschnitt: 800,
                    terrain_preset_morph: "karst",
                    terrain_preset_hoehe: "hochgebirge",
                },
                {
                    public_id: WALD_FLAECHE,
                    region_public_id: WALD,
                    geometry: { type: "Polygon", coordinates: quadrat(600, 500, 640, 530) },
                },
                {
                    public_id: HUEGEL_FLAECHE,
                    region_public_id: HUEGEL,
                    geometry: { type: "Polygon", coordinates: quadrat(700, 500, 740, 530) },
                },
            ],
        } as never,
        labels: {
            ok: true,
            revision: 9602,
            features: [
                label(GEBIRGE_LABEL, GEBIRGE, "Probegrat", "gebirge", 530, 515),
                label(WALD_LABEL, WALD, "Probeforst", "wald", 620, 515),
                label(HUEGEL_LABEL, HUEGEL, "Probehügel", "huegelland", 720, 515),
            ],
        } as never,
    };
}

describeWithCluster(
    "„Fläche entfernen …“: landscape.retire und ↺ (WI-0178 D2, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const stand = async (
            tafel: "region" | "region_area" | "map_label",
            id: string,
        ): Promise<{ aktiv: boolean; revision: number }> => {
            const [zeile] = await cluster!.admin.unsafe<{ aktiv: boolean; revision: number }[]>(
                `SELECT is_active AS aktiv, revision::int AS revision FROM ${tafel} WHERE public_id = $1`,
                [id],
            );
            return zeile!;
        };
        const regler = async (flaeche: string): Promise<boolean> => {
            const [zeile] = await cluster!.admin<{ aktiv: boolean }[]>`
            SELECT c.is_active AS aktiv FROM terrain_control c JOIN region_area a ON a.id = c.area_id WHERE a.public_id = ${flaeche}
        `;
            return zeile!.aktiv;
        };
        /** Der Landschaften-Zug: Regionen (I2) und Regler (I10) aus demselben Satz. */
        const zug = async () => {
            const satz = quelle();
            const bericht = await importRegions(importer!, satz.regions, satz.areas, satz.labels);
            await importTerrain(importer!, readTerrainSources(satz.areas, satz.labels));
            return bericht;
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
            await zug();
            // Eine Kraftlinie endet an der Beschriftung des Hügels (Claudio, Bedingung C).
            await cluster.admin`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${randomUUID()}, 'aventuria', 'Probelinie', ${HUEGEL_LABEL}, ${randomUUID()},
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(720, 515), ST_MakePoint(780, 515)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(720, 515), ST_MakePoint(780, 515)), 0), 'avesmaps3d')
        `;
        }, 300_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 von der Karte genommen: Teile mit, der Zug lässt alles still, die drei Prüfer bleiben grün, ↺ holt genau zurück", async () => {
            // Kurve an, damit Schriftläufe liegen, die nach dem Abnehmen weg müssen.
            const gebirge = await stand("region", GEBIRGE);
            await updateLandscape(cluster!.app, thomas, GEBIRGE, {
                operationId: randomUUID(),
                baseRevision: gebirge.revision,
                changes: { curve: { enabled: true, max: 1 } },
            });
            await refreshLabelCurve(cluster!.jobs, GEBIRGE);
            const quittung = await retireLandscape(cluster!.app, thomas, GEBIRGE, {
                operationId: randomUUID(),
                baseRevision: (await stand("region", GEBIRGE)).revision,
                stage: "off_map",
            });
            expect(quittung.warnings.map((befund) => befund.code)).toEqual(["terrain_stale"]);
            expect(quittung.derivedWork.map((auftrag) => auftrag.kind).sort()).toEqual([
                "label_runs",
                "land_smooth",
                "tiles",
            ]);
            expect(await stand("region", GEBIRGE)).toMatchObject({ aktiv: false });
            expect(await stand("region_area", GEBIRGE_FLAECHE)).toMatchObject({ aktiv: false });
            expect(await stand("map_label", GEBIRGE_LABEL)).toMatchObject({ aktiv: false });
            const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
            expect(protokoll.map((zeile) => zeile.action)).toEqual([
                "region.taken_off_map",
                "area.retired",
                "label.retired",
            ]);
            // Liste und Fenster kennen sie weiter (T54).
            const zeile = (await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === GEBIRGE);
            expect(zeile).toMatchObject({ state: "off_map", areas: 1, labels: 1 });
            expect(await readEditorLandscape(cluster!.app, GEBIRGE)).toMatchObject({ state: "off_map" });
            // Der Auftrag label_runs (Jobs-Rolle) räumt die Schriftläufe, statt zu scheitern.
            expect(await refreshLabelCurve(cluster!.jobs, GEBIRGE)).toMatchObject({ status: "skipped" });

            // ↺ holt genau zurück, was mitging (WI-0265 B6c: der Server, eine Operation für Landschaft, Teilfläche und Beschriftung).
            const zurueck = await nimmFlaecheZurueck(cluster!.app, thomas, GEBIRGE, {
                operationId: randomUUID(),
                reverts: quittung.operationId,
            });
            expect(zurueck.affected.map((x) => x.kind).sort()).toEqual(["area", "label", "landscape"]);
            expect(await stand("region", GEBIRGE)).toMatchObject({ aktiv: true });
            expect(await stand("region_area", GEBIRGE_FLAECHE)).toMatchObject({ aktiv: true });
            expect(await stand("map_label", GEBIRGE_LABEL)).toMatchObject({ aktiv: true });
            const [op] = await cluster!.admin<{ source: string }[]>`
            SELECT source FROM map_operation WHERE operation_id = ${zurueck.operationId}::uuid
        `;
            expect(op).toEqual({ source: "restore" });
            // Ein zweites ↺ derselben Operation findet nichts Stilles mehr: 409 `already_reverted`.
            expect(
                await fehler(
                    nimmFlaecheZurueck(cluster!.app, thomas, GEBIRGE, {
                        operationId: randomUUID(),
                        reverts: quittung.operationId,
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "already_reverted" });
            // Noch einmal entfernen: Der Zug darf sie still lassen.
            const nochmal = await retireLandscape(cluster!.app, thomas, GEBIRGE, {
                operationId: randomUUID(),
                baseRevision: (await stand("region", GEBIRGE)).revision,
                stage: "off_map",
            });

            // Der Zug: alles bleibt still, auch der Regler (Bedingung B); der zweite Lauf ändert nichts.
            await zug();
            expect(await stand("region", GEBIRGE)).toMatchObject({ aktiv: false });
            expect(await stand("region_area", GEBIRGE_FLAECHE)).toMatchObject({ aktiv: false });
            expect(await stand("map_label", GEBIRGE_LABEL)).toMatchObject({ aktiv: false });
            expect(await regler(GEBIRGE_FLAECHE)).toBe(false);
            const zweiter = await zug();
            expect([zweiter.regions.updated, zweiter.areas.updated, zweiter.labels.updated]).toEqual([0, 0, 0]);

            const satz = quelle();
            const regionen = await verifyRegions(importer!, satz.regions, satz.areas, satz.labels);
            for (const name of ["count_parity", "region_integrity", "fan_out_parity", "geometry_parity"])
                expect(
                    regionen.checks.find((c) => c.name === name),
                    name,
                ).toMatchObject({ passed: true });
            expect(regionen.checks.find((c) => c.name === "count_parity")?.detail).toContain("1 vom Editor abgenommen");
            const gelaende = await verifyTerrain(importer!, readTerrainSources(satz.areas, satz.labels));
            for (const name of ["gebirge_vollzaehlig", "keine_fremden_flaechen"])
                expect(
                    gelaende.checks.find((c) => c.name === name),
                    name,
                ).toMatchObject({ passed: true });
            const laeufe = await verifyRuns(importer!);
            expect(laeufe.checks.find((c) => c.name === "nur_aktive_kurvenregionen")).toMatchObject({ passed: true });

            // Seit dem Zug steht die Revision der Landschaft anders, ohne dass das Protokoll eine Operation dazu kennt (er schreibt die Zeilen neu): Die Rücknahme ist ein Konflikt der Revision
            // (Fachvertrag C.3: Bedingung ist auch die Ist-Revision), nichts wird geschrieben; wie bei jeder Familie nach einem Eingriff am Rand der Schreibnaht.
            const abgelehnt = await fehler(
                nimmFlaecheZurueck(cluster!.app, thomas, GEBIRGE, {
                    operationId: randomUUID(),
                    reverts: nochmal.operationId,
                }),
            );
            expect(abgelehnt).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await stand("region", GEBIRGE)).toMatchObject({ aktiv: false });
        });

        it("🔴 ganz gelöscht: weich; der Zug holt sie bis zum Cutoff zurück, wie bei Wegen", async () => {
            await retireLandscape(cluster!.app, thomas, WALD, {
                operationId: randomUUID(),
                baseRevision: (await stand("region", WALD)).revision,
                stage: "retire",
            });
            expect((await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === WALD)).toMatchObject({
                state: "retired",
            });
            await zug();
            expect(await stand("region", WALD)).toMatchObject({ aktiv: true });
            expect(await stand("region_area", WALD_FLAECHE)).toMatchObject({ aktiv: true });
            expect(await stand("map_label", WALD_LABEL)).toMatchObject({ aktiv: true });
        });

        it("🔴 abgewiesen: eine Kraftlinie endet an einer Beschriftung (409); der Kontinent Aventurien (400); nichts geschrieben", async () => {
            const huegel = await stand("region", HUEGEL);
            expect(
                await fehler(
                    retireLandscape(cluster!.app, thomas, HUEGEL, {
                        operationId: randomUUID(),
                        baseRevision: huegel.revision,
                        stage: "off_map",
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "powerline_endpoint" });
            expect(await stand("region", HUEGEL)).toEqual(huegel);
            expect(await stand("map_label", HUEGEL_LABEL)).toMatchObject({ aktiv: true });
            const aventurien = await stand("region", AVENTURIEN);
            expect(
                await fehler(
                    retireLandscape(cluster!.app, thomas, AVENTURIEN, {
                        operationId: randomUUID(),
                        baseRevision: aventurien.revision,
                        stage: "retire",
                    }),
                ),
            ).toMatchObject({ statusCode: 400 });
            expect(await stand("region", AVENTURIEN)).toEqual(aventurien);
        });

        it("🔴 T41 verborgen: Besucherquellen, Klick und Suche ohne sie; die Zusatzschicht für Editoren mit ihr; keine Folgeaufträge; der Zug lässt das Merkmal", async () => {
            const huegel = await stand("region", HUEGEL);
            const quittung = await updateLandscape(cluster!.app, thomas, HUEGEL, {
                operationId: randomUUID(),
                baseRevision: huegel.revision,
                changes: { hidden: true },
            });
            // Verbergen allein geht in keine Ableitung ein (Claudio): nur die Kachelrevision.
            expect(quittung.derivedWork.map((auftrag) => auftrag.kind)).toEqual(["tiles"]);
            const [eintrag] = await cluster!.admin<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid
        `;
            expect(eintrag).toEqual({ changes: { hidden: { before: false, after: true } } });
            const zaehle = async (sicht: string, spalte: string): Promise<number> => {
                const [z] = await cluster!.admin.unsafe<{ n: number }[]>(
                    `SELECT count(*)::int AS n FROM ${sicht} WHERE ${spalte} = $1`,
                    [sicht === "map_label_render" ? HUEGEL_LABEL : HUEGEL],
                );
                return z!.n;
            };
            expect(await zaehle("region_area_render", "region_public_id")).toBe(0);
            expect(await zaehle("map_label_render", "public_id")).toBe(0);
            const klick = await queryAreasAt(cluster!.app, {
                x: 720,
                y: 515,
                layers: ["topographie"],
                lakes: true,
                reach: 0,
            });
            expect(klick.areas).toEqual([]);
            expect((await search(cluster!.app, "Probehügel")).hits).toEqual([]);
            // Editoren: die Zusatzschicht mit Fläche und Auge, Liste und Detail mit dem Merkmal.
            const schicht = await listHiddenLandscapes(cluster!.app);
            expect(schicht.rows).toEqual([
                expect.objectContaining({ id: HUEGEL, name: "Probehügel", layer: "topographie", at: [720, 515] }),
            ]);
            expect(schicht.rows[0]!.polygons).toHaveLength(1);
            expect((await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === HUEGEL)).toMatchObject({
                hidden: true,
            });
            // Der Zug schreibt das Merkmal nie, und der zweite Lauf ändert nichts.
            await zug();
            const [nachZug] = await cluster!.admin<{ is_hidden: boolean }[]>`
            SELECT is_hidden FROM region WHERE public_id = ${HUEGEL}
        `;
            expect(nachZug).toEqual({ is_hidden: true });
            const zweiter = await zug();
            expect(zweiter.regions.updated).toBe(0);
            // Kennt Legacy sie nicht mehr, legt der Zug sie still und meldet es als Befund.
            const satz = quelle();
            const ohne = {
                ...satz.regions,
                regions: (satz.regions as unknown as { regions: { public_id: string }[] }).regions.filter(
                    (r) => r.public_id !== HUEGEL,
                ),
            } as unknown as typeof satz.regions;
            const ohneFlaechen = {
                ...satz.areas,
                areas: (satz.areas as unknown as { areas: { region_public_id: string }[] }).areas.filter(
                    (a) => a.region_public_id !== HUEGEL,
                ),
            } as unknown as typeof satz.areas;
            const ohneLabels = {
                ...satz.labels,
                features: (
                    satz.labels as unknown as { features: { properties: { ecosystem_region_public_id: string } }[] }
                ).features.filter((f) => f.properties.ecosystem_region_public_id !== HUEGEL),
            } as unknown as typeof satz.labels;
            const bericht = await importRegions(importer!, ohne, ohneFlaechen, ohneLabels);
            expect(bericht.findings.map((befund) => befund.code)).toContain("hidden_landscape_retired");
        });
    },
);
