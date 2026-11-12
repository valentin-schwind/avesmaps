import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { deriveLandSmooth } from "../src/areas/smooth.ts";
import { createDatabase, type Database } from "../src/database.ts";
import {
    LANDSCHAFT_ART,
    LANDSCHAFT_FOLGEN_DELAY_S,
    mapOperation,
    TEILFLAECHE_ART,
    type MapActor,
} from "../src/editor/map-operation.ts";
import type { AreaEventJob } from "../src/jobs/area-events.ts";
import { glaetteNachSpeichern, laeufeNachSpeichern } from "../src/jobs/landschaft-folgen-job.ts";
import { importRegions } from "../src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../src/migration/regions.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Folgen einer gespeicherten Landschaft (WI-0178 B3; EDIT-0004 §6, §7 B3; Migration 0142), so wie auf dem VPS: Wegwerf-Cluster
 * mit Migrations-, App- und Jobs-Rolle und den Vorlagen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: Eine Operation an einer Landschaft reiht nichts ein, oder außerhalb ihrer Transaktion (ein Fehlschlag hinterlässt einen
 * Auftrag); jede Speicherung legt einen eigenen Auftrag an statt mit dem wartenden zu fahren; zwei Landschaften teilen sich einen
 * Schriftlauf-Auftrag; der Auftrag wartet nicht; der Auftrag rundet das volle Netz (400 MB); die Jobs-Rolle darf die zwei Tafeln nicht
 * schreiben, oder der Schriftlauf scheitert an der Zeilensperre auf `region` (UPDATE-Recht, EDIT-0004 Fund 6); nach dem Runden lädt
 * keine Karte neu, weil kein `map.changed` kommt; der Schriftlauf einer Landschaft ohne Beschriftung scheitert endgültig
 * (`input_invalid`), schon nach einer reinen Namensänderung.
 */

const ENV = "landfolg";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const WALD = "b3b3b3b3-0000-4000-8000-000000000001";
const MOOR = "b3b3b3b3-0000-4000-8000-000000000002";
const WALD_FLAECHE = "b3b3b3b3-0000-4000-8000-0000000000a1";
const MOOR_FLAECHE = "b3b3b3b3-0000-4000-8000-0000000000a2";
const WALD_LABEL = "b3b3b3b3-0000-4000-8000-0000000000c1";
const MOOR_LABEL = "b3b3b3b3-0000-4000-8000-0000000000c2";
/** Eine Landschaft ohne Beschriftung (EDIT-0004 B6: es gibt sie); ihr Schriftlauf darf nicht scheitern. */
const OHNE = "b3b3b3b3-0000-4000-8000-000000000003";

/** Ein langes Rechteck, damit ein Name auf die Kurve passt; das Moor liegt mit einer gemeinsamen Kante daneben. */
const rechteck = (x: number, y: number, breite: number, hoehe: number): number[][][] => [
    [
        [x, y],
        [x + breite, y],
        [x + breite, y + hoehe],
        [x, y + hoehe],
        [x, y],
    ],
];
const label = (publicId: string, name: string, region: string, x: number, y: number): Record<string, unknown> => ({
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { feature_type: "label", public_id: publicId, name, ecosystem_region_public_id: region },
});

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: [
                {
                    public_id: WALD,
                    name: "Langer Folgenwald",
                    kind: "vegetation",
                    region_type: "wald",
                    area_count: 1,
                    label_public_id: WALD_LABEL,
                    curve_label: true,
                    curve_label_max: 1,
                },
                {
                    public_id: MOOR,
                    name: "Folgenmoor",
                    kind: "vegetation",
                    region_type: "moor",
                    area_count: 1,
                    label_public_id: MOOR_LABEL,
                },
                {
                    public_id: OHNE,
                    name: "Namenlose Folgenheide",
                    kind: "vegetation",
                    region_type: "wald",
                    area_count: 0,
                },
            ],
        } as never,
        areas: {
            ok: true,
            revision: 9301,
            truncated: false,
            areas: [
                {
                    public_id: WALD_FLAECHE,
                    region_public_id: WALD,
                    geometry: { type: "Polygon", coordinates: rechteck(300, 300, 120, 30) },
                },
                {
                    public_id: MOOR_FLAECHE,
                    region_public_id: MOOR,
                    geometry: { type: "Polygon", coordinates: rechteck(300, 330, 60, 30) },
                },
            ],
        } as never,
        labels: {
            ok: true,
            revision: 9302,
            features: [
                label(WALD_LABEL, "Langer Folgenwald", WALD, 360, 315),
                label(MOOR_LABEL, "Folgenmoor", MOOR, 330, 345),
            ],
        } as never,
    };
}

interface Auftrag {
    id: string;
    public_id: string;
    kind: string;
    input_ref: Record<string, unknown>;
    wartet_s: number;
    scope_kind: string;
    scope_tiles: number[];
}

describeWithCluster("Folgen einer gespeicherten Landschaft (WI-0178 B3, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    // Der Import hält die Sperre des Zugs auf einer Verbindung und schreibt auf einer zweiten (wie `landscape-revision.test.ts`).
    let importer: Database | undefined;
    const actor: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    /** Eine Operation an Landschaften als App-Rolle; `work` meldet nur, was sie berührt hat. */
    const speichere = (affected: OperationReceipt["affected"], scheitert = false): Promise<OperationReceipt> =>
        mapOperation(
            cluster!.app,
            actor,
            { operationId: randomUUID(), operation: "area.reshape", mapDomainId: "aventuria", body: {} },
            async () => {
                if (scheitert) throw new Error("Fachoperation scheitert");
                return { receipt: { affected, derivedWork: [], warnings: [] }, entries: [] };
            },
        );
    const auftraege = async (): Promise<Auftrag[]> =>
        cluster!.admin<Auftrag[]>`
            SELECT id::text, public_id::text, kind, input_ref, scope_kind, scope_tiles,
                   round(extract(epoch FROM (not_before - queued_at)))::int AS wartet_s
              FROM job WHERE kind IN ('land_smooth', 'label_runs') ORDER BY id
        `;
    const alsEreignis = (auftrag: Auftrag): AreaEventJob => ({
        id: Number(auftrag.id),
        publicId: auftrag.public_id,
        kind: auftrag.kind,
        mapDomainId: "aventuria",
    });
    const kartenEreignisse = async (): Promise<{ payload: Record<string, unknown> }[]> =>
        cluster!.admin<{ payload: Record<string, unknown> }[]>`
            SELECT payload FROM job_event WHERE kind = 'map.changed' ORDER BY seq
        `;

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
    }, 60_000);

    it("🔴 eine Operation reiht in ihrer Transaktion ein: ein Auftrag zum Runden, einer je Landschaft für die Schriftläufe; ein Fehlschlag reiht nichts ein", async () => {
        await expect(
            speichere(
                [
                    { kind: LANDSCHAFT_ART, id: WALD },
                    { kind: TEILFLAECHE_ART, id: WALD_FLAECHE },
                ],
                true,
            ),
        ).rejects.toThrow("Fachoperation scheitert");
        expect(await auftraege()).toEqual([]);

        const quittung = await speichere([
            { kind: LANDSCHAFT_ART, id: WALD, revision: 3 },
            { kind: TEILFLAECHE_ART, id: WALD_FLAECHE, revision: 2 },
            // Die mitgezogene Nachbarin (C2): ihre Landschaft und ihre Fläche.
            { kind: LANDSCHAFT_ART, id: MOOR, revision: 2 },
            { kind: TEILFLAECHE_ART, id: MOOR_FLAECHE, revision: 2 },
        ]);
        const nach = await auftraege();
        expect(nach.map((auftrag) => [auftrag.kind, auftrag.input_ref])).toEqual([
            ["land_smooth", {}],
            ["label_runs", { landscape: WALD }],
            ["label_runs", { landscape: MOOR }],
        ]);
        // Er wartet: Speicherungen in dieser Zeit fahren mit (nie ein Auftrag je Klick).
        for (const auftrag of nach) expect(auftrag.wartet_s).toBe(LANDSCHAFT_FOLGEN_DELAY_S);
        // 🔴 Ohne Bereich (WI-0283): Sonst warteten sie hinter der ganzen Geländekette und hielten den nächsten Geländelauf auf.
        for (const auftrag of nach) {
            expect(auftrag.scope_kind).toBe("tiles");
            expect(auftrag.scope_tiles).toEqual([]);
        }
        expect(quittung.derivedWork).toEqual([
            { kind: "land_smooth", jobId: nach[0]!.public_id, state: "queued" },
            { kind: "label_runs", jobId: nach[1]!.public_id, state: "queued" },
            { kind: "label_runs", jobId: nach[2]!.public_id, state: "queued" },
            { kind: "tiles", state: "done" },
        ]);
    });

    it("🔴 weitere Speicherungen fahren mit dem wartenden Auftrag; nur eine Beschriftung geändert: kein Runden", async () => {
        const vorher = await auftraege();
        const zweite = await speichere([
            { kind: LANDSCHAFT_ART, id: WALD },
            { kind: TEILFLAECHE_ART, id: WALD_FLAECHE },
        ]);
        const nurName = await speichere([{ kind: LANDSCHAFT_ART, id: MOOR }]);
        expect(await auftraege()).toEqual(vorher);
        expect(zweite.derivedWork.map((arbeit) => arbeit.jobId)).toEqual([
            vorher[0]!.public_id,
            vorher[1]!.public_id,
            undefined,
        ]);
        expect(nurName.derivedWork.map((arbeit) => [arbeit.kind, arbeit.jobId])).toEqual([
            ["label_runs", vorher[2]!.public_id],
            ["tiles", undefined],
        ]);
    });

    it("🔴 nie das volle Netz: Ist noch nichts gerundet, lässt der Auftrag das Netz aus und meldet es, statt 400 MB zu rechnen", async () => {
        const [runden] = await auftraege();
        const ergebnis = await glaetteNachSpeichern(cluster!.jobs, alsEreignis(runden!));
        expect(ergebnis).toMatchObject({ mode: "keine", written: 0, finding: "voll_noetig" });
        const [n] = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM region_area_smooth`;
        expect(n?.n).toBe(0);
    });

    it("🔴 als Jobs-Rolle: die geänderte Fläche und ihre Nachbarin neu gerundet, `source_updated_at` stimmt, die Karten hören `map.changed`", async () => {
        // Das volle Netz rechnet die Ableitung des Imports (Migrationsrolle), wie nach dem Zug.
        await deriveLandSmooth(cluster!.migrator, { climate: false });
        // Eine Ecke des Walds rückt (wie `area.reshape` es täte; der Trigger aus 0137 setzt `updated_at`).
        await cluster!.admin`
            UPDATE region_area
               SET geom = ST_SetSRID(ST_GeomFromText('POLYGON((300 300, 425 300, 420 330, 300 330, 300 300))'), 0)
             WHERE public_id = ${WALD_FLAECHE}
        `;
        const ereignisseVorher = (await kartenEreignisse()).length;
        const [runden] = await auftraege();
        const ergebnis = await glaetteNachSpeichern(cluster!.jobs, alsEreignis(runden!));
        expect(ergebnis).toMatchObject({ mode: "lokal" });
        expect(ergebnis["written"]).toBeGreaterThanOrEqual(1);
        expect(ergebnis["finding"]).toBeUndefined();
        const stand = await cluster!.admin<{ public_id: string; frisch: boolean }[]>`
            SELECT a.public_id::text, s.source_updated_at = a.updated_at AS frisch
              FROM region_area a JOIN region_area_smooth s ON s.region_area_id = a.id
             ORDER BY a.public_id
        `;
        expect(stand).toEqual([
            { public_id: WALD_FLAECHE, frisch: true },
            { public_id: MOOR_FLAECHE, frisch: true },
        ]);
        const ereignisse = await kartenEreignisse();
        expect(ereignisse).toHaveLength(ereignisseVorher + 1);
        expect(ereignisse.at(-1)?.payload).toMatchObject({ operation: "land_smooth", jobKind: "land_smooth" });

        // Nichts mehr veraltet: Der nächste Lauf rechnet nichts und meldet nichts.
        expect(await glaetteNachSpeichern(cluster!.jobs, alsEreignis(runden!))).toMatchObject({
            mode: "keine",
            written: 0,
        });
        expect(await kartenEreignisse()).toHaveLength(ereignisseVorher + 1);
    });

    it("🔴 als Jobs-Rolle ohne UPDATE-Recht an `region`: der Schriftlauf einer Region schreibt und meldet", async () => {
        const [darf] = await cluster!.admin<{ darf: boolean }[]>`
            SELECT has_table_privilege(${cluster!.roles.jobs}, 'region', 'UPDATE') AS darf
        `;
        expect(darf?.darf).toBe(false);
        const wald = (await auftraege()).find((auftrag) => auftrag.input_ref["landscape"] === WALD);
        const ergebnis = await laeufeNachSpeichern(cluster!.jobs, alsEreignis(wald!), WALD);
        expect(ergebnis).toMatchObject({ status: "written" });
        const [laeufe] = await cluster!.admin<{ laeufe: number }[]>`
            SELECT count(*)::int AS laeufe FROM landscape_label_run l JOIN region r ON r.id = l.region_id
             WHERE r.public_id = ${WALD}
        `;
        expect(laeufe?.laeufe).toBeGreaterThanOrEqual(1);
        expect((await kartenEreignisse()).at(-1)?.payload).toMatchObject({
            operation: "label_runs",
            affected: [{ kind: "landscape", id: WALD }],
        });
        // Ohne Kurvenbeschriftung (das Moor): keine Läufe, kein Fehler.
        const moor = (await auftraege()).find((auftrag) => auftrag.input_ref["landscape"] === MOOR);
        expect(await laeufeNachSpeichern(cluster!.jobs, alsEreignis(moor!), MOOR)).toMatchObject({ status: "skipped" });
    });

    it("🔴 eine Landschaft ohne Beschriftung: der Schriftlauf scheitert nicht, eine unbekannte schon", async () => {
        const wald = (await auftraege()).find((auftrag) => auftrag.input_ref["landscape"] === WALD);
        expect(await laeufeNachSpeichern(cluster!.jobs, alsEreignis(wald!), OHNE)).toMatchObject({
            status: "skipped",
        });
        await expect(
            laeufeNachSpeichern(cluster!.jobs, alsEreignis(wald!), "b3b3b3b3-0000-4000-8000-0000000000ff"),
        ).rejects.toMatchObject({ code: "input_invalid" });
    });

    it("🔴 die App-Rolle schreibt die abgeleiteten Tafeln weiter nicht; `job_enqueue` nimmt die zwei Arten an, andere nicht", async () => {
        for (const tafel of ["region_area_smooth", "landscape_label_run"]) {
            const [darf] = await cluster!.admin<{ darf: boolean }[]>`
                SELECT has_table_privilege(${cluster!.roles.app}, ${tafel}, 'INSERT') AS darf
            `;
            expect(darf?.darf, tafel).toBe(false);
        }
        await expect(
            cluster!.app`SELECT * FROM job_enqueue('terrain_full', 1::smallint, 'aventuria', 'test', '{}'::jsonb)`,
        ).rejects.toMatchObject({ code: "42501" });
    });
});
