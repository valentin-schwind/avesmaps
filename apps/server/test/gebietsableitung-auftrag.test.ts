import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import type { AreaEventJob } from "../src/jobs/area-events.ts";
import {
    GEBIETSABLEITUNG_HOECHSTENS_S,
    GEBIETSABLEITUNG_RUHE_S,
    TERRITORY_DERIVE_JOB_KIND,
} from "../src/jobs/gebiets-arten.ts";
import { leiteGebieteAb } from "../src/jobs/gebietsableitung-job.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Ableitung der Herrschaftsgebiete als Auftrag (WI-0209 Paket B3a; EDIT-0005 §5; Migration 0147; Claudio 2026-10-17), so wie auf
 * dem VPS: Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle und den Vorlagen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: Eine Operation an einem Gebiet reiht nichts ein, oder außerhalb ihrer Transaktion; jede Speicherung legt einen eigenen
 * Auftrag an; der Auftrag wartet nicht zwei Minuten; die Jobs-Rolle darf die Ableitung nicht schreiben, oder sie darf TRUNCATE; der
 * Auftrag rechnet ohne geänderte Eingabe; nach dem Rechnen hört keine Karte `map.changed`; die neue Ableitung weicht von der Regel ab.
 */

const ENV = "gebabl";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777783-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const BARONIE = ID(2);
const FLAECHE = ID(0x101);
const ABLEITUNG = [
    "territory_display_area",
    "territory_shape",
    "territory_border",
    "territory_capital_band",
    "territory_claim_shape",
];

function gebiet(id: string, name: string, parent: string | null, band: [number, number]): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: parent,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: null,
        valid_to_bf: null,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 03:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-b3",
        territories: [gebiet(REICH, "B3 Reich", null, [0, 1]), gebiet(BARONIE, "B3 Baronie", REICH, [2, 6])],
        geometries: [
            {
                public_id: FLAECHE,
                territory_public_id: BARONIE,
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [100, 100],
                            [130, 100],
                            [130, 130],
                            [100, 130],
                            [100, 100],
                        ],
                    ],
                },
                valid_from_bf: null,
                valid_to_bf: null,
                min_zoom: null,
                max_zoom: null,
                updated_at: "2026-10-17 03:00:00",
            },
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

interface Auftrag {
    id: string;
    public_id: string;
    kind: string;
    wartet_s: number;
}

describeWithCluster(
    "Ableitung der Herrschaftsgebiete als Auftrag (WI-0209 B3a, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const actor: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        /** Eine Operation an Gebieten als App-Rolle; `work` meldet nur, was sie berührt hat. */
        const speichere = (affected: OperationReceipt["affected"], scheitert = false): Promise<OperationReceipt> =>
            mapOperation(
                cluster!.app,
                actor,
                { operationId: randomUUID(), operation: "territory.update", mapDomainId: "aventuria", body: {} },
                async () => {
                    if (scheitert) throw new Error("Fachoperation scheitert");
                    return { receipt: { affected, derivedWork: [], warnings: [] }, entries: [] };
                },
            );
        const auftraege = async (): Promise<Auftrag[]> =>
            cluster!.admin<Auftrag[]>`
            SELECT id::text, public_id::text, kind, round(extract(epoch FROM (not_before - queued_at)))::int AS wartet_s
              FROM job WHERE kind = ${TERRITORY_DERIVE_JOB_KIND} ORDER BY id
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
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            await importTerritories(importer, quelle());
            // Die erste Ableitung macht der Zug (Migrationsrolle), wie auf der Stage.
            await deriveTerritories(cluster.migrator, { force: true });
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 eine Operation an einem Gebiet reiht in ihrer Transaktion EINEN Auftrag ein, der die Ruhe wartet; ein Fehlschlag reiht nichts ein", async () => {
            await expect(speichere([{ kind: GEBIET_ART, id: BARONIE }], true)).rejects.toThrow(
                "Fachoperation scheitert",
            );
            expect(await auftraege()).toEqual([]);
            const quittung = await speichere([
                { kind: GEBIET_ART, id: BARONIE, revision: 2 },
                { kind: GEBIETSFLAECHE_ART, id: FLAECHE, revision: 2 },
            ]);
            const nach = await auftraege();
            expect(nach).toHaveLength(1);
            expect(nach[0]?.wartet_s).toBe(GEBIETSABLEITUNG_RUHE_S);
            expect([GEBIETSABLEITUNG_RUHE_S, GEBIETSABLEITUNG_HOECHSTENS_S]).toEqual([10, 120]);
            expect(quittung.derivedWork).toEqual([
                { kind: TERRITORY_DERIVE_JOB_KIND, jobId: nach[0]!.public_id, state: "queued" },
                { kind: "tiles", state: "done" },
            ]);
        });

        it("🔴 weitere Speicherungen fahren mit dem wartenden Auftrag; eine Operation ohne Gebiet reiht keinen ein", async () => {
            const vorher = await auftraege();
            const zweite = await speichere([{ kind: GEBIETSFLAECHE_ART, id: FLAECHE }]);
            const fremd = await speichere([{ kind: "place", id: randomUUID() }]);
            // Derselbe Auftrag (sein Start rückt dabei, siehe den nächsten Fall).
            expect((await auftraege()).map((auftrag) => auftrag.public_id)).toEqual(
                vorher.map((auftrag) => auftrag.public_id),
            );
            expect(zweite.derivedWork.map((arbeit) => arbeit.jobId)).toEqual([vorher[0]!.public_id, undefined]);
            expect(fremd.derivedWork.some((arbeit) => arbeit.kind === TERRITORY_DERIVE_JOB_KIND)).toBe(false);
        });

        it("🔴 gleitend (WI-0229): jede Speicherung schiebt den Start auf Ruhe ab jetzt, höchstens bis zur Obergrenze ab der ersten", async () => {
            const abJetzt = async (): Promise<number> => {
                const [zeile] = await cluster!.admin<{ ab_jetzt: number }[]>`
                    SELECT round(extract(epoch FROM (not_before - now())))::int AS ab_jetzt FROM job WHERE kind = ${TERRITORY_DERIVE_JOB_KIND}
                `;
                return zeile!.ab_jetzt;
            };
            // Die erste Speicherung liegt eine Minute zurück, der Start wäre längst fällig: Die nächste schiebt ihn auf jetzt + Ruhe.
            await cluster!
                .admin`UPDATE job SET queued_at = now() - interval '60 seconds', not_before = now() - interval '50 seconds'
                                 WHERE kind = ${TERRITORY_DERIVE_JOB_KIND}`;
            await speichere([{ kind: GEBIETSFLAECHE_ART, id: FLAECHE }]);
            expect(await abJetzt()).toBeGreaterThan(GEBIETSABLEITUNG_RUHE_S - 3);
            expect(await abJetzt()).toBeLessThanOrEqual(GEBIETSABLEITUNG_RUHE_S);
            // Liegt die erste Speicherung fast an der Obergrenze, gilt die Obergrenze, nicht die Ruhe.
            await cluster!
                .admin`UPDATE job SET queued_at = now() - make_interval(secs => ${GEBIETSABLEITUNG_HOECHSTENS_S - 5})
                                 WHERE kind = ${TERRITORY_DERIVE_JOB_KIND}`;
            await speichere([{ kind: GEBIET_ART, id: BARONIE }]);
            expect(await abJetzt()).toBeGreaterThan(0);
            expect(await abJetzt()).toBeLessThanOrEqual(5);
            expect(await auftraege()).toHaveLength(1);
            // Ohne Kartenfußabdruck (Bereich `tiles` ohne Kacheln): Er schneidet kein Gelände im Umkreis (Hauptorchestrierung 2026-10-19).
            const [bereich] = await cluster!.admin<{ art: string; kacheln: number }[]>`
                SELECT scope_kind AS art, cardinality(scope_tiles)::int AS kacheln FROM job WHERE kind = ${TERRITORY_DERIVE_JOB_KIND}
            `;
            expect(bereich).toEqual({ art: "tiles", kacheln: 0 });
        });

        it("🔴 als Jobs-Rolle: ohne geänderte Eingabe `ueberholt`, ohne Rechnung und ohne Meldung", async () => {
            const [auftrag] = await auftraege();
            const vorher = (await kartenEreignisse()).length;
            expect(await leiteGebieteAb(cluster!.jobs, alsEreignis(auftrag!))).toMatchObject({ status: "ueberholt" });
            expect(await kartenEreignisse()).toHaveLength(vorher);
        });

        it("🔴 als Jobs-Rolle: eine geänderte Spanne wird abgeleitet, die Regel stimmt danach (N2), die Karten hören `map.changed`", async () => {
            // Wie eine Operation es täte: Die Baronie zeigt sich erst ab Band 4 (die App-Rolle schreibt das Gebiet).
            await cluster!.app`UPDATE territory SET min_zoom = 4 WHERE public_id = ${BARONIE}`;
            const [auftrag] = await auftraege();
            const vorher = (await kartenEreignisse()).length;
            const ergebnis = await leiteGebieteAb(cluster!.jobs, alsEreignis(auftrag!));
            expect(ergebnis).toMatchObject({
                status: "abgeleitet",
                nachweis: { passed: true, abweichend: 0, hierarchie: 0 },
            });
            expect(ergebnis["finding"]).toBeUndefined();
            const baender = await cluster!.admin<{ band: number }[]>`
            SELECT da.band::int AS band FROM territory_display_area da JOIN territory t ON t.id = da.territory_id
             WHERE t.public_id = ${BARONIE} ORDER BY da.band
        `;
            expect(baender.map((zeile) => zeile.band)).toEqual([4, 5, 6, 7, 8]);
            const ereignisse = await kartenEreignisse();
            expect(ereignisse).toHaveLength(vorher + 1);
            expect(ereignisse.at(-1)?.payload).toMatchObject({
                operation: TERRITORY_DERIVE_JOB_KIND,
                jobKind: TERRITORY_DERIVE_JOB_KIND,
            });
            // Nichts mehr geändert: Der nächste Lauf ist überholt.
            expect(await leiteGebieteAb(cluster!.jobs, alsEreignis(auftrag!))).toMatchObject({ status: "ueberholt" });
        });

        it("🔴 Rechte: die Jobs-Rolle schreibt die Ableitung, nie mit TRUNCATE; `job_enqueue` nimmt die Art von der App-Rolle an", async () => {
            for (const tafel of ABLEITUNG) {
                const [recht] = await cluster!.admin<{ einfuegen: boolean; loeschen: boolean; leeren: boolean }[]>`
                SELECT has_table_privilege(${cluster!.roles.jobs}, ${tafel}, 'INSERT') AS einfuegen,
                       has_table_privilege(${cluster!.roles.jobs}, ${tafel}, 'DELETE') AS loeschen,
                       has_table_privilege(${cluster!.roles.jobs}, ${tafel}, 'TRUNCATE') AS leeren
            `;
                expect({ tafel, ...recht }).toEqual({ tafel, einfuegen: true, loeschen: true, leeren: false });
            }
            const [zustand] = await cluster!.admin<{ schreiben: boolean }[]>`
            SELECT has_table_privilege(${cluster!.roles.jobs}, 'territory_state', 'UPDATE') AS schreiben
        `;
            expect(zustand?.schreiben).toBe(true);
            const [neu] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text FROM job_enqueue(${TERRITORY_DERIVE_JOB_KIND}, 1::smallint, 'aventuria', 'test', '{}'::jsonb)
        `;
            expect(neu?.public_id).toEqual(expect.any(String));
        });
    },
);
