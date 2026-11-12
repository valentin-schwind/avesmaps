import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { getJobById } from "../src/jobs/store.ts";
import {
    enqueueTerrainFull,
    enqueueTerrainLocal,
    TERRAIN_PRIORITY,
    vollerLaufEtikett,
} from "../src/jobs/terrain-chain.ts";
import { uebergibAnVollenLauf } from "../src/jobs/terrain-local-job.ts";
import { AVENTURIA_TERRAIN_SELECTION, fassungsName } from "../src/terrain/domain/recipes.ts";
import { runJobsCli } from "../src/jobs/cli-commands.ts";

/**
 * Die Gelände-Kette einreihen (WI-0125, JOBS-0001 4.4): ein Baum in EINER Transaktion, mit Fußabdruck und Vorrang; der volle Lauf
 * wird gesammelt. Auslöser nur über die Kommandozeile.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
describe.skipIf(!testDatabaseUrl)("Gelände-Kette", () => {
    let database: Database;
    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl ?? "", { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
    });
    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });
    afterAll(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await database.end({ timeout: 5 });
    });

    const dependsOn = async (id: number): Promise<number[]> =>
        (
            await database<{ depends_on_id: string }[]>`
                SELECT depends_on_id::text FROM job_dependency WHERE job_id = ${id} ORDER BY depends_on_id`
        ).map((row) => Number(row.depends_on_id));

    it("🔴 lokal → veröffentlichen → Routing und Anzeigehöhen; mit Bereich die Rechenkacheln, Vorrang wie geplant", async () => {
        const chain = await enqueueTerrainLocal(database, {
            mapDomainId: "aventuria",
            actorRef: "test",
            bounds: [{ minX: 500, minY: 600, maxX: 560, maxY: 680 }],
        });
        // Ohne Master im Testbestand fehlt der Index: Der Bereich allein bestimmt den Fußabdruck (Zeilen 2 und 3 von Norden, Spalten 3 und 4).
        expect(chain.footprint).toMatchObject({ tiles: [19, 20, 27, 28], indexMissing: true });
        const local = await getJobById(database, chain.local.id);
        const publish = await getJobById(database, chain.publish.id);
        expect(local).toMatchObject({
            kind: "terrain_local",
            state: "QUEUED",
            scopeKind: "tiles",
            scopeTiles: [19, 20, 27, 28],
            priority: TERRAIN_PRIORITY.terrain_local,
            inputRef: { bounds: [[500, 600, 560, 680]] },
        });
        expect(publish).toMatchObject({
            kind: "dem_publish",
            scopeTiles: [19, 20, 27, 28],
            priority: TERRAIN_PRIORITY.dem_publish,
            inputRef: { candidateJob: chain.local.publicId },
        });
        expect(await dependsOn(chain.publish.id)).toEqual([chain.local.id]);
        expect(await dependsOn(chain.routing.id)).toEqual([chain.publish.id]);
        expect(await dependsOn(chain.heights.id)).toEqual([chain.publish.id]);
        // Routing und Anzeigehöhen sperren keinen Bereich: ein späterer Gelände-Job wartet nicht auf die Höhenlinien.
        expect(await getJobById(database, chain.heights.id)).toMatchObject({ scopeKind: "tiles", scopeTiles: [] });
    });

    it("🔴 der volle Lauf wird gesammelt: ein wartender nimmt die nächste Anforderung auf, statt einen zweiten anzulegen", async () => {
        const first = await enqueueTerrainFull(database, { mapDomainId: "aventuria" });
        expect(first.coalesced).toBe(false);
        expect(await getJobById(database, first.full.id)).toMatchObject({ scopeKind: "domain", priority: 70 });
        const local = await enqueueTerrainLocal(database, { mapDomainId: "aventuria", fullAfter: true });
        expect(local.full).toMatchObject({ coalesced: true, full: { id: first.full.id } });
        expect((await getJobById(database, first.full.id))?.coalescedCount).toBe(1);
        expect(await dependsOn(first.routing?.id ?? 0)).toEqual([first.full.id]);
        // Ohne Index und ohne Bereich: die ganze Domäne.
        expect(local.footprint).toMatchObject({ tiles: [], indexMissing: true });
        expect(await getJobById(database, local.local.id)).toMatchObject({ scopeKind: "domain" });
    });

    it("🔴 Fassungswechsel (A, Betreiber 2026-10-19): der lokale Lauf übergibt an den vollen, nimmt einen wartenden mit und endet ohne Fehler", async () => {
        const grund = "Der Master stammt aus Fassung 18, gewählt ist 19: erst der volle Lauf";
        const erste = await enqueueTerrainLocal(database, { mapDomainId: "aventuria", actorRef: "redaktion-1" });
        const ergebnis = await uebergibAnVollenLauf(database, { id: erste.local.id, mapDomainId: "aventuria" }, grund);
        // Ohne Kandidat: `dem_publish` schließt leer ab (`loadCandidate` liest `unchanged`), kein Fehlschlag in der Warteschlange.
        expect(ergebnis).toMatchObject({ unchanged: true, reason: "recipe_changed", detail: grund });
        const volle = await database<
            { id: string; public_id: string; actor_ref: string; label: string; state: string }[]
        >`
            SELECT id::text, public_id::text, actor_ref, label, state FROM job WHERE kind = 'terrain_full'`;
        expect(volle).toHaveLength(1);
        const voll = volle[0]!;
        // In der Warteschlange dessen, der gespeichert hat, mit der Fassung im Etikett.
        expect(voll).toMatchObject({ actor_ref: "redaktion-1", state: "QUEUED" });
        // Ohne Wahl gilt die Vorgabe der Datei, eine abgenommene Fassung: ohne „(Test)“ (`fassungsName`).
        expect(voll.label).toBe(vollerLaufEtikett(fassungsName(AVENTURIA_TERRAIN_SELECTION.recipe.version)));
        expect(voll.label).toMatch(/^Gelände voll rechnen \(Fassung \d+\)$/u);
        expect(ergebnis["handedOver"]).toEqual({ job: voll.public_id, coalesced: false });
        const folger = await database<{ kind: string }[]>`
            SELECT j.kind FROM job_dependency d JOIN job j ON j.id = d.job_id WHERE d.depends_on_id = ${voll.id} ORDER BY j.kind`;
        expect(folger.map((zeile) => zeile.kind)).toEqual(["display_heights", "routing_reload"]);

        // Ein zweiter Lauf mit demselben Befund legt keinen zweiten vollen an, er zählt am wartenden.
        const zweite = await enqueueTerrainLocal(database, { mapDomainId: "aventuria", actorRef: "redaktion-2" });
        const nochmal = await uebergibAnVollenLauf(database, { id: zweite.local.id, mapDomainId: "aventuria" }, grund);
        expect(nochmal["handedOver"]).toEqual({ job: voll.public_id, coalesced: true });
        expect((await getJobById(database, Number(voll.id)))?.coalescedCount).toBe(1);
        expect((await database`SELECT 1 FROM job WHERE kind = 'terrain_full'`).length).toBe(1);
    });

    it("ein wartender voller Lauf trägt das Etikett der jüngsten Anforderung", async () => {
        const erste = await enqueueTerrainFull(database, {
            mapDomainId: "aventuria",
            label: vollerLaufEtikett("Fassung 18"),
        });
        await enqueueTerrainFull(database, {
            mapDomainId: "aventuria",
            label: vollerLaufEtikett("Fassung 19 (Test)", "zurück"),
        });
        expect((await getJobById(database, erste.full.id))?.label).toBe(
            "Gelände voll rechnen (Fassung 19 (Test), zurück)",
        );
        // Ohne Etikett bleibt das alte stehen (die Kommandozeile nennt keine Fassung).
        await enqueueTerrainFull(database, { mapDomainId: "aventuria" });
        expect((await getJobById(database, erste.full.id))?.label).toBe(
            "Gelände voll rechnen (Fassung 19 (Test), zurück)",
        );
    });

    it("die Kommandozeile reiht ein und nennt die Kennungen; ein falscher Bereich ist ein Aufruffehler", async () => {
        const out: string[] = [];
        const err: string[] = [];
        const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line) };
        const code = await runJobsCli(
            ["enqueue", "terrain_local", "--bounds", "500,600,560,680", "--json"],
            { JOBS_PROFILE: "local" },
            io,
            { database },
        );
        expect(code).toBe(0);
        const parsed = JSON.parse(out[0] ?? "{}") as { tiles: number[]; jobs: { kind: string }[] };
        expect(parsed.tiles).toEqual([19, 20, 27, 28]);
        expect(parsed.jobs.map((job) => job.kind)).toEqual([
            "terrain_local",
            "dem_publish",
            "routing_reload",
            "display_heights",
        ]);
        expect(
            await runJobsCli(["enqueue", "terrain_local", "--bounds", "1,2,3"], { JOBS_PROFILE: "local" }, io, {
                database,
            }),
        ).toBe(2);
        expect(await runJobsCli(["enqueue", "probe"], { JOBS_PROFILE: "local" }, io, { database })).toBe(2);
    });
});
