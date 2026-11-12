import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiErrorBody } from "@avesmaps3d/shared";
import { mitSperrWiederholung } from "../src/editor/map-operation.ts";
import { DATABASE_BUSY, registerErrorHandler } from "../src/error-handler.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Speichern während der Gebietsableitung (WI-0229; Stage 2026-10-19, Claudio `2026-10-19-gebiet-speichern-503-waehrend-ableitung-an-claudia.md`
 * und die Hauptorchestrierung: „Kein Speichern im Editor darf hinter einer Ableitung warten“).
 *
 * - Problemfall: Die Ableitung fügt in einer Transaktion von bis zu 90 s abgeleitete Zeilen ein; jede prüfte ihren Fremdschlüssel sofort und
 *   hielt `FOR KEY SHARE` auf ihr Gebiet. Ein Schreibweg mit `FOR UPDATE` auf die Gebietszeile wartete, nach 2 s kam 503 „Die Datenbank ist
 *   gerade nicht erreichbar.“, obwohl sie erreichbar war.
 * - Soll: Mit aufgeschobenen Fremdschlüsseln (Migration 0204, `SET CONSTRAINTS ALL DEFERRED` in der Ableitung) wartet das Sperren nicht;
 *   die Ableitung prüft beim Commit und kommt durch. Eine Sperrzeit (55P03) heißt `database_busy`, und eine Operation an der Karte versucht
 *   es noch zweimal.
 */

const sperrzeit = (): Error =>
    new postgres.PostgresError({ message: "canceling statement due to lock timeout", code: "55P03" } as never);

describe("Speichern während der Ableitung: Wiederholung und Wortlaut", () => {
    it("🔴 eine Operation, die an der Sperrzeit scheitert, läuft noch einmal; nach zwei Wiederholungen geht der Fehler weiter", async () => {
        let laeufe = 0;
        const ergebnis = await mitSperrWiederholung(async () => {
            laeufe += 1;
            if (laeufe < 3) throw sperrzeit();
            return "gespeichert";
        }, [1, 1]);
        expect([ergebnis, laeufe]).toEqual(["gespeichert", 3]);

        laeufe = 0;
        await expect(
            mitSperrWiederholung(async () => {
                laeufe += 1;
                throw sperrzeit();
            }, [1, 1]),
        ).rejects.toMatchObject({ code: "55P03" });
        expect(laeufe).toBe(3);
    });

    it("🔴 das Opfer eines Deadlocks läuft noch einmal (WI-0283, Production 2026-11-05: einmal `PATCH /api/editor/landscapes`)", async () => {
        let laeufe = 0;
        const ergebnis = await mitSperrWiederholung(async () => {
            laeufe += 1;
            if (laeufe === 1) throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
            return "gespeichert";
        }, [1, 1]);
        expect([ergebnis, laeufe]).toEqual(["gespeichert", 2]);
    });

    it("jeder andere Fehler läuft genau einmal", async () => {
        let laeufe = 0;
        await expect(
            mitSperrWiederholung(async () => {
                laeufe += 1;
                throw Object.assign(new Error("Konflikt"), { code: "23505" });
            }, [1, 1]),
        ).rejects.toThrow("Konflikt");
        expect(laeufe).toBe(1);
    });

    it("🔴 eine Sperrzeit heißt im Umschlag `database_busy`, nicht „nicht erreichbar“; ältere Routen behalten ihre Form", async () => {
        const app = Fastify({ logger: false });
        registerErrorHandler(app);
        app.get(
            "/umschlag",
            { config: { errorEnvelope: true }, schema: { response: { 503: ApiErrorBody } } },
            async () => {
                throw sperrzeit();
            },
        );
        app.get("/alt", async () => {
            throw sperrzeit();
        });
        try {
            const umschlag = await app.inject({ method: "GET", url: "/umschlag" });
            expect(umschlag.statusCode).toBe(503);
            expect(umschlag.headers["retry-after"]).toBe("2");
            expect(umschlag.json()).toEqual({ error: { code: "database_busy", message: DATABASE_BUSY } });
            expect(umschlag.body).not.toMatch(/lock timeout|55P03|nicht erreichbar/u);
            const alt = await app.inject({ method: "GET", url: "/alt" });
            expect(alt.statusCode).toBe(503);
            expect(alt.json()).toEqual({ error: "database_unavailable" });
        } finally {
            await app.close();
        }
    });
});

const ENV = "sperreabl";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster(
    "Speichern während der Ableitung als App- und Jobs-Rolle (Wegwerf-Cluster wie auf dem VPS)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let gebiet = "";
        let flaeche = "";

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const [g] = await cluster.admin<{ id: string }[]>`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
                VALUES (gen_random_uuid(), 'aventuria', 'Sperrbaronie', '#336699', 0.5, 'test-wi0229')
                RETURNING id::text
            `;
            gebiet = g!.id;
            const [f] = await cluster.admin<{ id: string }[]>`
                INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
                VALUES (gen_random_uuid(), ${gebiet}::bigint, 'aventuria',
                        ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((460 460, 470 460, 470 470, 460 470, 460 460))'), 0)), 'test-wi0229')
                RETURNING id::text
            `;
            flaeche = f!.id;
        }, 180_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 die Fremdschlüssel der vier abgeleiteten Tafeln auf Gebiet und Fläche sind aufschiebbar (0204)", async () => {
            const zeilen = await cluster!.admin<{ tafel: string; aufschiebbar: boolean }[]>`
                SELECT c.conrelid::regclass::text AS tafel, c.condeferrable AS aufschiebbar
                  FROM pg_constraint c
                 WHERE c.contype = 'f'
                   AND c.conrelid::regclass::text IN ('territory_display_area', 'territory_shape', 'territory_border', 'territory_claim_shape')
                   AND c.confrelid::regclass::text IN ('territory', 'territory_area')
            `;
            expect(zeilen).toHaveLength(7);
            expect(zeilen.every((z) => z.aufschiebbar)).toBe(true);
        });

        /**
         * Die Jobs-Rolle fügt wie die Ableitung eine abgeleitete Zeile ein und hält die Transaktion offen; die App-Rolle sperrt
         * währenddessen die Gebietszeile wie `territory-update.ts` (`FOR UPDATE`). Gibt zurück, ob das Sperren durchging.
         */
        async function sperrenWaehrendAbleitung(aufgeschoben: boolean): Promise<"durch" | string> {
            let loslassen!: () => void;
            const haelt = new Promise<void>((weiter) => (loslassen = weiter));
            let eingefuegt!: () => void;
            const bereit = new Promise<void>((weiter) => (eingefuegt = weiter));
            const ableitung = cluster!.jobs.begin(async (tx) => {
                if (aufgeschoben) await tx`SET CONSTRAINTS ALL DEFERRED`;
                await tx`DELETE FROM territory_display_area WHERE area_id = ${flaeche}::bigint`;
                await tx`
                    INSERT INTO territory_display_area (band, area_id, territory_id)
                    VALUES (0, ${flaeche}::bigint, ${gebiet}::bigint)
                `;
                eingefuegt();
                await haelt;
            });
            await bereit;
            try {
                await cluster!.app.begin(async (tx) => {
                    await tx`SET LOCAL lock_timeout = '1s'`;
                    await tx`SELECT id FROM territory WHERE id = ${gebiet}::bigint FOR UPDATE`;
                });
                return "durch";
            } catch (error) {
                return String((error as { code?: unknown }).code);
            } finally {
                loslassen();
                await ableitung;
            }
        }

        it("Gegenprobe: sofort geprüft wartet das Sperren auf die Ableitung (55P03)", async () => {
            expect(await sperrenWaehrendAbleitung(false)).toBe("55P03");
        });

        it("🔴 aufgeschoben geht das Sperren sofort durch, und die Ableitung kommt beim Commit durch", async () => {
            expect(await sperrenWaehrendAbleitung(true)).toBe("durch");
            const [zeile] = await cluster!.admin<{ n: number }[]>`
                SELECT count(*)::int AS n FROM territory_display_area WHERE area_id = ${flaeche}::bigint
            `;
            expect(zeile!.n).toBe(1);
        });
    },
);
