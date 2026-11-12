import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BENACHRICHTIGUNG_ARTEN } from "@avesmaps3d/shared";
import { readAbgleiche } from "../src/abgleiche/lesen.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { BENACHRICHTIGUNG_JOB_ARTEN } from "../src/jobs/benachrichtigung-job.ts";
import { listFinished, listQueued } from "../src/jobs/store.ts";
import { leseWarteumstand } from "../src/jobs/wartegrund.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Abgleiche über Claudios Korridor (WI-0127 SYS-14b, Migration 0098, Claudio 2026-10-10 Option A), auf einem Wegwerf-Cluster mit den
 * Rollen und dem Rechtewerkzeug des VPS, dazu `apps/server/src/db/jobs-grants.psql`:
 *
 * - Nur die Jobs-Rolle führt `job_sync_claim`, `job_sync_phase` und `job_sync_finish` aus; die App-Rolle und PUBLIC nicht.
 * - Übernehmen nimmt nur Arten der Abgleiche und nur wartende Aufträge, den ältesten zuerst; die Phase setzt den groben Fortschritt und
 *   meldet einen verlangten Abbruch; das Ende schreibt SUCCEEDED, FAILED oder CANCELLED (übersprungen) mit der Zusammenfassung.
 * - Fremde Läufe (vom Worker übernommen) fasst der Korridor nicht an; ein beendeter Lauf lässt sich nicht noch einmal beenden.
 * - Das Lesemodell zeigt den wartenden Auftrag als „wartet auf Abholung“ und danach Kreis und Fehler aus dem Ende.
 *
 * Dazu das Ende des Sonderwegs der Geländekette (Migration 0325; Vali 2026-11-07: „die soll den sonderweg abschaffen“): Bis dahin ging
 * `terrain_full` in Production über den Korridor, und ein Lauf schloss die zwei Nachfolger ohne eigenen Lauf mit ab (Migration 0129).
 * Seit 0325 nimmt der Korridor keine Art der Geländekette an; die Kette wartet auf den Worker, jeder Auftrag läuft selbst. Verwerfen
 * mit Grund (`job_sync_discard`) bleibt für die Arten der Abgleiche.
 *
 * Dazu die gemeinsame Warteschlange (WI-0163, Migration 0133): `job_sync_claim_id` übernimmt GENAU den Auftrag, den der Dirigent
 * meint, ohne Pausen-Riegel; `benachrichtigung_einreihen` reiht „Neu auf der Stage/Production“ und den Prüflauf nach dem Push
 * (WI-0201, Migration 0140) als Auftrag ein, einmal je Quelle;
 * und die Leserolle des Dirigenten (`queue-read-grants.psql`) liest drei Tafeln und schreibt nichts.
 *
 * Dazu die Rechte der Warteschlange (JOBS-0001 Q10, WI-0074), angemeldet wie auf dem VPS: Die Jobs-Rolle schreibt `job*` über die
 * Hilfsfunktionen und keine Kartendaten; die App-Rolle liest `job*` und hat nur EINE Tür, `job_enqueue` (SECURITY DEFINER). Bis
 * WI-0189 prüften das `jobs-roles.test.ts` und `queue-read-role.test.ts` per `SET ROLE` in Handrollen der geteilten Testdatenbank.
 */

const ENV = "korridor";
const PERSON = "7e570000-0000-4000-8000-0000000000ab";
const describeWithCluster = postgresBin ? describe : describe.skip;
const jobsGrants = fileURLToPath(new URL("../src/db/jobs-grants.psql", import.meta.url));
const queueReadGrants = fileURLToPath(new URL("../src/db/queue-read-grants.psql", import.meta.url));

describeWithCluster("Abgleiche über den Korridor: Funktionen und Rechte wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [jobsGrants, queueReadGrants]);
        await seedMapDomains(cluster.migrator);
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    /** SQLSTATE je Anweisung unter einer Rolle (`SET LOCAL ROLE`); die Transaktion wird immer zurückgerollt. */
    async function as(role: string, statements: string[]): Promise<string[]> {
        const codes: string[] = [];
        try {
            await cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${role}`);
                for (const sql of statements) {
                    await tx.unsafe("SAVEPOINT probe");
                    try {
                        await tx.unsafe(sql);
                        await tx.unsafe("RELEASE SAVEPOINT probe");
                        codes.push("ok");
                    } catch (error) {
                        await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                        codes.push((error as { code?: string }).code ?? "fehler");
                    }
                }
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return codes;
    }

    /** Als Jobs-Rolle, festgeschrieben (wie Claudios Korridor-Befehl). */
    async function jobs<T>(work: (sql: VpsCluster["admin"]) => Promise<T>): Promise<T> {
        return cluster!.admin.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.jobs}`);
            return work(tx as unknown as VpsCluster["admin"]);
        }) as Promise<T>;
    }

    const enqueue = async (kind: string): Promise<string> => {
        const [row] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id FROM job_enqueue(${kind}, 1::smallint, 'aventuria', ${PERSON}, '{}'::jsonb)
        `;
        return row!.public_id;
    };
    const claim = (kind: string) =>
        jobs(
            async (sql) => (await sql<{ id: string | null }[]>`SELECT job_sync_claim(${kind}, 600)::text AS id`)[0]!.id,
        );
    const phase = (id: string, name: string) =>
        jobs(
            async (sql) =>
                (await sql<{ ok: boolean }[]>`SELECT job_sync_phase(${id}::uuid, ${name}, 'Satz 4711') AS ok`)[0]!.ok,
        );
    const finish = (id: string, result: string, summary: string) =>
        jobs(
            async (sql) =>
                (await sql<{ ok: boolean }[]>`SELECT job_sync_finish(${id}::uuid, ${result}, ${summary}) AS ok`)[0]!.ok,
        );
    /**
     * Der Umstand für den Wartegrund (WI-0160): wie in Production — kein Planer, die Arten des Korridors holt Claudios Abholer.
     * Ohne ihn stünde in der Zeile `waits_no_worker`, und das wäre dort falsch: Es holt ja jemand ab.
     */
    const umstand = (kinds: string[]) =>
        leseWarteumstand(cluster!.app, { plannerActive: false, pickupKinds: new Set(kinds) });

    const row = async (id: string) =>
        (
            await cluster!.admin<
                {
                    state: string;
                    phase: string | null;
                    progress: number | null;
                    lease_owner: string | null;
                    result: unknown;
                    error_summary: string | null;
                    cancel_reason: string | null;
                }[]
            >`SELECT state, phase, progress::float8 AS progress, lease_owner, result, error_summary, cancel_reason FROM job WHERE public_id = ${id}::uuid`
        )[0]!;

    it("🔴 nur die Jobs-Rolle führt die drei Funktionen aus; die App nicht", async () => {
        const calls = [
            "SELECT job_sync_claim('legacy_pull', 600)",
            "SELECT job_sync_phase(gen_random_uuid(), 'holen', '')",
            "SELECT job_sync_finish(gen_random_uuid(), 'ok', '')",
        ];
        expect(await as(cluster!.roles.app, calls)).toEqual(["42501", "42501", "42501"]);
        expect(await as(cluster!.roles.jobs, calls)).toEqual(["ok", "ok", "ok"]);
        expect(await as(cluster!.roles.tiles, calls)).toEqual(["42501", "42501", "42501"]);
    });

    it("🔴 übernehmen nur Arten der Abgleiche, mit gültiger Lease; ohne wartenden Auftrag NULL", async () => {
        expect(
            await as(cluster!.roles.jobs, [
                "SELECT job_sync_claim('import', 600)",
                "SELECT job_sync_claim('legacy_pull', 5)",
                "SELECT job_sync_phase(gen_random_uuid(), 'Holen!', '')",
                "SELECT job_sync_finish(gen_random_uuid(), 'fertig', '')",
            ]),
        ).toEqual(["22023", "22023", "22023", "22023"]);
        expect(await claim("legacy_media")).toBeNull();
    });

    it("🔴 der Production-Zug geht durch die ganze Kette (WI-0144, Migration 0126)", async () => {
        // Betreiber 2026-10-14: Knopf auf der Stage, Claudios Abholer (`production-zug-abholer.sh`) führt ihn aus.
        // Die App darf ihn einreihen, die Jobs-Rolle übernehmen, melden und beenden — wie jede andere Art der Abgleiche.
        const id = await enqueue("production_pull");
        const zeilen = await readAbgleiche(
            cluster!.app,
            { production: "korridor" },
            await umstand(["production_pull"]),
        );
        expect(zeilen.find((zeile) => zeile.quelle === "production")).toMatchObject({
            ausfuehrung: "korridor",
            laufend: { state: "QUEUED", waitReason: "waits_pickup" },
        });
        expect(await claim("production_pull")).toBe(id);
        // Die Phasen des Abholers: `einspielen`, dann `proben`.
        expect(await phase(id, "einspielen")).toBe(true);
        expect(await phase(id, "proben")).toBe(true);
        const gemeldet = await row(id);
        expect(gemeldet).toMatchObject({ phase: "proben", lease_owner: "korridor" });
        // `progress` ist REAL in der Datenbank: vergleichen, nicht gleichsetzen.
        expect(gemeldet.progress).toBeCloseTo(0.9, 5);
        expect(await finish(id, "ok", "Die Stage trägt jetzt den Stand von Production.")).toBe(true);
        expect(await row(id)).toMatchObject({
            state: "SUCCEEDED",
            result: { zusammenfassung: "Die Stage trägt jetzt den Stand von Production." },
        });
        // Eine Art, die es nicht gibt, bleibt abgelehnt — die Erweiterung hat die Liste nicht geöffnet.
        expect(
            await as(cluster!.roles.app, [
                "SELECT * FROM job_enqueue('production_push', 1::smallint, 'aventuria', 'x', '{}'::jsonb)",
            ]),
        ).toEqual(["42501"]);
        expect(await as(cluster!.roles.jobs, ["SELECT job_sync_claim('production_push', 600)"])).toEqual(["22023"]);
    });

    it("🔴 der Lauf: wartet auf Abholung, übernommen, Phasen mit Fortschritt, fertig mit Zusammenfassung", async () => {
        const id = await enqueue("legacy_pull");
        const [wartend] = await readAbgleiche(
            cluster!.app,
            { legacy: "korridor", medien: "aus" },
            await umstand(["legacy_pull"]),
        );
        expect(wartend).toMatchObject({
            ausfuehrung: "korridor",
            laufend: { state: "QUEUED", waitReason: "waits_pickup" },
        });

        expect(await claim("legacy_pull")).toBe(id);
        expect(await row(id)).toMatchObject({ state: "RUNNING", lease_owner: "korridor" });
        // Ein zweiter Abholer bekommt denselben Auftrag nicht.
        expect(await claim("legacy_pull")).toBeNull();

        expect(await phase(id, "holen")).toBe(true);
        expect(await row(id)).toMatchObject({ phase: "holen", progress: expect.closeTo(0.1, 5) });
        expect(await phase(id, "einspielen")).toBe(true);
        expect((await row(id)).progress).toBeCloseTo(0.5, 5);
        // Eine unbekannte Phase lässt den Anteil stehen.
        expect(await phase(id, "warten-auf-sperre")).toBe(true);
        expect((await row(id)).progress).toBeCloseTo(0.5, 5);

        const [laeuft] = await readAbgleiche(cluster!.app, { legacy: "korridor" }, await umstand(["legacy_pull"]));
        expect(laeuft?.laufend).toMatchObject({ state: "RUNNING", phase: "warten-auf-sperre" });

        expect(await finish(id, "ok", "satz map1-eco2-live20261010t1800z: 0 Befunde")).toBe(true);
        expect(await row(id)).toMatchObject({
            state: "SUCCEEDED",
            progress: 1,
            result: { zusammenfassung: "satz map1-eco2-live20261010t1800z: 0 Befunde" },
        });
        // Beendet ist beendet: weder Phase noch zweites Ende.
        expect(await phase(id, "proben")).toBe(false);
        expect(await finish(id, "failed", "zu spät")).toBe(false);

        const [fertig] = await readAbgleiche(cluster!.app, { legacy: "korridor" }, await umstand(["legacy_pull"]));
        expect(fertig).toMatchObject({ kreis: "voll", laufend: null, letzter: { state: "SUCCEEDED" } });
    });

    it("gescheitert mit Satz; übersprungen und auf Verlangen abgebrochen enden CANCELLED mit ihrem Grund", async () => {
        const failed = await enqueue("legacy_pull");
        await claim("legacy_pull");
        expect(await finish(failed, "failed", "Prüfer rot: I24 Wiki-Linkziele")).toBe(true);
        expect(await row(failed)).toMatchObject({ state: "FAILED", error_summary: "Prüfer rot: I24 Wiki-Linkziele" });
        const [nachFehler] = await readAbgleiche(cluster!.app, { legacy: "korridor" }, await umstand(["legacy_pull"]));
        expect(nachFehler).toMatchObject({
            kreis: "leer",
            letzter: { state: "FAILED", fehler: "Prüfer rot: I24 Wiki-Linkziele" },
        });

        const skipped = await enqueue("legacy_pull");
        await claim("legacy_pull");
        expect(await finish(skipped, "skipped", "Tageszug um 12:00 läuft")).toBe(true);
        expect(await row(skipped)).toMatchObject({
            state: "CANCELLED",
            cancel_reason: "skipped",
            error_summary: "Tageszug um 12:00 läuft",
        });

        const cancelled = await enqueue("legacy_pull");
        await claim("legacy_pull");
        // Die Statusseite verlangt den Abbruch (wie `cancelJob`): die nächste Phase sagt „aufhören“.
        await cluster!
            .admin`UPDATE job SET cancel_requested_at = now(), cancel_reason = 'operator' WHERE public_id = ${cancelled}::uuid`;
        expect(await phase(cancelled, "pruefen")).toBe(false);
        expect(await finish(cancelled, "skipped", "auf Verlangen abgebrochen")).toBe(true);
        expect(await row(cancelled)).toMatchObject({ state: "CANCELLED", cancel_reason: "operator" });
    });

    /**
     * Die Geländekette, wie „Aktivieren“ sie einreiht (`terrain_chain_enqueue`, Migration 0100): `terrain_full`, dahinter
     * `routing_reload` und `display_heights` als Nachfolger in `job_dependency`.
     */
    const kette = async (label: string): Promise<{ full: string; routing: string; heights: string }> => {
        const [erste] = await cluster!.app<{ full: string }[]>`
            SELECT terrain_chain_enqueue('aventuria', ${PERSON}, ${label})::text AS full
        `;
        const nachfolger = await cluster!.admin<{ kind: string; public_id: string }[]>`
            SELECT j.kind, j.public_id::text AS public_id FROM job j
            JOIN job_dependency d ON d.job_id = j.id
            JOIN job v ON v.id = d.depends_on_id
            WHERE v.public_id = ${erste!.full}::uuid
        `;
        return {
            full: erste!.full,
            routing: nachfolger.find((zeile) => zeile.kind === "routing_reload")!.public_id,
            heights: nachfolger.find((zeile) => zeile.kind === "display_heights")!.public_id,
        };
    };
    const discard = (kind: string, reason: string) =>
        jobs(async (sql) => (await sql<{ n: number }[]>`SELECT job_sync_discard(${kind}, ${reason}) AS n`)[0]!.n);
    const KETTE = ["terrain_full", "routing_reload", "display_heights"];
    /**
     * Die Zeilen der Geländekette, die die Systemsteuerung als „wartet“ zeigt: dieselbe Abfrage wie die Statusseite
     * (`listQueued`, hinter `buildJobsOverview`), auf die drei Arten eingeschränkt.
     */
    const wartend = async (): Promise<string[]> =>
        (await listQueued(cluster!.app))
            .filter((job) => KETTE.includes(job.kind))
            .map((job) => `${job.kind}:${job.label ?? ""}`);

    it("🔴 die Geländekette geht nicht mehr über den Korridor; sie wartet auf den Worker (Migration 0325)", async () => {
        // Vali 2026-11-07: „die soll den sonderweg abschaffen“. Seit Claudios c31c03fde rechnet die App `terrain_full` auch in
        // Production, und die zwei Nachfolger laufen danach selbst (Probe 2026-11-08 03:19: drei echte Aufträge).
        const { full, routing, heights } = await kette("Gelände voll: Fassung 19");
        expect(
            await as(cluster!.roles.jobs, [
                "SELECT job_sync_claim('terrain_full', 600)",
                "SELECT job_sync_discard('terrain_full', 'Grund')",
            ]),
        ).toEqual(["22023", "22023"]);
        // Auch die gemeinsame Warteschlange übergibt ihn dem Korridor nicht, und Phase und Ende greifen nicht.
        expect(await claimId(await kennung(full))).toBeNull();
        expect(await phase(full, "ableiten")).toBe(false);
        // 🔴 Der alte Fehler: Ein Ende mit „ok“ schloss die Nachfolger ohne eigenen Lauf mit ab („mit dem vollen Lauf erledigt“).
        expect(await finish(full, "ok", "ohne Lauf")).toBe(false);
        for (const id of [full, routing, heights]) {
            expect(await row(id)).toMatchObject({ state: "QUEUED", lease_owner: null });
        }
        expect(await wartend()).toEqual([
            "routing_reload:Routenrechner nach vollem Lauf",
            "display_heights:Höhenlinien nach vollem Lauf",
            "terrain_full:Gelände voll: Fassung 19",
        ]);

        // Aufräumen für die folgenden Fälle, so wie das Verwerfen bis 0325 die Kette schloss.
        await cluster!.admin`
            UPDATE job SET state = 'CANCELLED', cancel_reason = 'superseded', finished_at = now(), wait_reason = NULL
             WHERE public_id IN (${full}::uuid, ${routing}::uuid, ${heights}::uuid)
        `;
        expect(await wartend()).toEqual([]);
    });

    it("🔴 verwerfen mit Grund: ein wartender Auftrag einer Abgleich-Art, mit Spur; ohne Grund nichts (WI-0154)", async () => {
        const id = await enqueue("legacy_media");
        expect(await discard("legacy_media", "durch einen neueren Zug überholt")).toBe(1);
        expect(await row(id)).toMatchObject({
            state: "CANCELLED",
            cancel_reason: "superseded",
            error_summary: "durch einen neueren Zug überholt",
        });
        const fertig = await listFinished(cluster!.app, ["SUCCEEDED", "CANCELLED"], 15);
        expect(fertig.find((job) => job.publicId === id)).toMatchObject({
            state: "CANCELLED",
            cancelReason: "superseded",
            errorSummary: "durch einen neueren Zug überholt",
        });
        // Ohne wartenden Auftrag 0, und ohne Grund wird nichts verworfen.
        expect(await discard("legacy_media", "noch einmal")).toBe(0);
        expect(await as(cluster!.roles.jobs, ["SELECT job_sync_discard('legacy_media', '   ')"])).toEqual(["22023"]);
    });

    it("🔴 eine Jobart ohne Berechtigung wird abgewiesen (WI-0154, Migration 0129 und 0325)", async () => {
        // Keine Art der Geländekette geht über den Korridor: Sonst könnte er die Höhenlinien ohne ihren vollen Lauf übernehmen
        // oder verwerfen, und seit 0325 auch den vollen Lauf selbst nicht mehr.
        expect(
            await as(cluster!.roles.jobs, [
                "SELECT job_sync_claim('terrain_full', 600)",
                "SELECT job_sync_claim('routing_reload', 600)",
                "SELECT job_sync_claim('display_heights', 600)",
                "SELECT job_sync_claim('terrain_local', 600)",
                "SELECT job_sync_discard('terrain_full', 'Grund')",
                "SELECT job_sync_discard('routing_reload', 'Grund')",
                "SELECT job_sync_discard('display_heights', 'Grund')",
                "SELECT job_sync_discard('terrain_gips', 'Grund')",
            ]),
        ).toEqual(["22023", "22023", "22023", "22023", "22023", "22023", "22023", "22023"]);

        // Das Verwerfen gehört der Jobs-Rolle allein; der Nachfolger-Abbruch niemandem.
        const verwerfen = ["SELECT job_sync_discard('legacy_pull', 'Grund')"];
        expect(await as(cluster!.roles.app, verwerfen)).toEqual(["42501"]);
        expect(await as(cluster!.roles.tiles, verwerfen)).toEqual(["42501"]);
        expect(await as(cluster!.roles.jobs, verwerfen)).toEqual(["ok"]);
        const kaskade = ["SELECT job_chain_cancel_waiting(1::bigint, 'dependency_cancelled')"];
        expect(await as(cluster!.roles.app, kaskade)).toEqual(["42501"]);
        expect(await as(cluster!.roles.jobs, kaskade)).toEqual(["42501"]);
    });

    // --- Die gemeinsame Warteschlange (WI-0163, Migration 0133) ------------------------------------------------------

    const claimId = (id: number | string) =>
        jobs(
            async (sql) =>
                (
                    await sql<{ id: string | null }[]>`SELECT job_sync_claim_id(${String(id)}::bigint, 600)::text AS id`
                )[0]!.id,
        );
    const kennung = async (publicId: string): Promise<string> =>
        (await cluster!.admin<{ id: string }[]>`SELECT id::text AS id FROM job WHERE public_id = ${publicId}::uuid`)[0]!
            .id;

    it("🔴 `job_sync_claim_id` führt nur die Jobs-Rolle aus; die App und die Kachelrolle nicht", async () => {
        const call = ["SELECT job_sync_claim_id(1::bigint, 600)"];
        expect(await as(cluster!.roles.app, call)).toEqual(["42501"]);
        expect(await as(cluster!.roles.tiles, call)).toEqual(["42501"]);
        expect(await as(cluster!.roles.jobs, call)).toEqual(["ok"]);
        // Dieselben Grenzen wie `job_sync_claim`: ein falscher Aufruf bekommt seinen Fehler, statt still NULL zu lesen.
        expect(
            await as(cluster!.roles.jobs, [
                "SELECT job_sync_claim_id(NULL::bigint, 600)",
                "SELECT job_sync_claim_id(1::bigint, 5)",
                "SELECT job_sync_claim_id(1::bigint, 20000)",
            ]),
        ).toEqual(["22023", "22023", "22023"]);
    });

    it("🔴 `job_sync_claim_id` übernimmt GENAU diesen Auftrag, auch wenn ältere derselben Art warten", async () => {
        const aelter = await enqueue("legacy_media");
        const gemeint = await enqueue("legacy_media");
        expect(await claimId(await kennung(gemeint))).toBe(gemeint);
        expect(await row(gemeint)).toMatchObject({ state: "RUNNING", lease_owner: "korridor" });
        expect(await row(aelter)).toMatchObject({ state: "QUEUED", lease_owner: null });
        // Dasselbe Ereignis wie beim Claim: `job.started` mit Art und Versuch.
        const [ereignis] = await cluster!.admin<{ payload: Record<string, unknown> }[]>`
            SELECT e.payload FROM job_event e JOIN job j ON j.id = e.job_id
             WHERE j.public_id = ${gemeint}::uuid AND e.kind = 'job.started'
        `;
        expect(ereignis?.payload).toMatchObject({ jobId: gemeint, jobKind: "legacy_media", attempt: 1 });
        // Aufräumen: beide zu Ende, damit die übrigen Fälle eine leere Schlange sehen.
        expect(await finish(gemeint, "ok", "fertig")).toBe(true);
        expect(await claim("legacy_media")).toBe(aelter);
        expect(await finish(aelter, "ok", "fertig")).toBe(true);
    });

    it("🔴 `job_sync_claim_id` gibt nichts bei falschem Zustand, falscher Herkunft oder einer Art außerhalb des Korridors", async () => {
        const einmal = await enqueue("legacy_media");
        const id = await kennung(einmal);
        expect(await claimId(id)).toBe(einmal);
        // Schon übernommen: kein zweites Mal.
        expect(await claimId(id)).toBeNull();
        expect(await finish(einmal, "ok", "fertig")).toBe(true);
        // Fertig: auch nicht.
        expect(await claimId(id)).toBeNull();
        // Eine Art, die nicht über den Korridor läuft, wartet weiter, unberührt.
        const lokal = await enqueue("terrain_local");
        expect(await claimId(await kennung(lokal))).toBeNull();
        expect(await row(lokal)).toMatchObject({ state: "QUEUED", lease_owner: null });
        // Ein aufgezeichneter Ablauf gehört nicht der Warteschlange.
        const aufgezeichnet = await enqueue("legacy_pull");
        await cluster!.admin`UPDATE job SET origin = 'recorded' WHERE public_id = ${aufgezeichnet}::uuid`;
        expect(await claimId(await kennung(aufgezeichnet))).toBeNull();
        // Eine Kennung, die es nicht gibt: nichts.
        expect(await claimId(999_999_999)).toBeNull();
        await cluster!.admin`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), cancel_reason = 'operator'
             WHERE public_id IN (${lokal}::uuid, ${aufgezeichnet}::uuid)
        `;
    });

    it("🔴 `job_sync_claim_id` hat keinen Pausen-Riegel: Die wirksame Pause hält der Dirigent, nicht die eigene Zeile", async () => {
        const id = await enqueue("legacy_pull");
        await cluster!.admin`
            UPDATE system_state SET queue_paused = true, queue_paused_since = now(), queue_paused_by_label = 'cli:test',
                   queue_paused_reason = 'Sicherung', queue_changed_at = now()
             WHERE id = 1
        `;
        try {
            // Der alte Claim hält an (Claudios Abholer im Übergang), der neue nimmt, was der Dirigent meint.
            expect(await claim("legacy_pull")).toBeNull();
            expect(await claimId(await kennung(id))).toBe(id);
            expect(await finish(id, "ok", "fertig")).toBe(true);
        } finally {
            await cluster!.admin`
                UPDATE system_state SET queue_paused = false, queue_paused_since = NULL, queue_paused_by_label = NULL,
                       queue_paused_reason = NULL, queue_changed_at = NULL
                 WHERE id = 1
            `;
        }
    });

    it("🔴 die Leserolle des Dirigenten: liest job, job_dependency und system_state, schreibt nichts, führt nichts aus", async () => {
        const rolle = `avesmaps3d_${ENV}_queue_read`;
        // Die Rolle legt der Cluster wie Claudio mit CONNECT an, die Rechte kommen aus Werkzeug und Vorlage (WI-0189).
        expect(
            await as(rolle, [
                "SELECT count(*) FROM job",
                "SELECT count(*) FROM job_dependency",
                "SELECT queue_paused, queue_changed_at FROM system_state",
            ]),
        ).toEqual(["ok", "ok", "ok"]);
        expect(
            await as(rolle, [
                "INSERT INTO job (kind, map_domain_id) VALUES ('probe', 'aventuria')",
                "UPDATE job SET priority = 1",
                "DELETE FROM job",
                "DELETE FROM job_dependency",
                "UPDATE system_state SET queue_paused = true",
                "TRUNCATE system_state",
                "SELECT count(*) FROM job_event",
                "SELECT count(*) FROM place",
                "SELECT count(*) FROM avesmaps_auth.person",
                // Auch durch keine Tür: Einreihen, Übernehmen und Ereignisse bleiben ihr verwehrt.
                "SELECT * FROM job_enqueue('legacy_pull', 1::smallint, 'aventuria', 'x', '{}'::jsonb)",
                "SELECT job_sync_claim('legacy_pull', 600)",
                "SELECT job_sync_claim_id(1::bigint, 600)",
                "SELECT job_event_add('x', NULL, 'aventuria', '{}'::jsonb)",
            ]),
        ).toEqual(Array.from({ length: 13 }, () => "42501"));
    });

    /** Betreiber 2026-10-15: „Meldungen wie „Neu auf Production" sollen über die Warteschlange in die richtige Umgebung gelangen“. */
    const einreihen = (art: string, quelle: string, text = "Kurzinfo") =>
        jobs(
            async (sql) =>
                (
                    await sql<{ id: string | null }[]>`
                        SELECT benachrichtigung_einreihen(${art}, '{"rolle":"operator"}'::jsonb, ${text}, ${quelle})::text AS id
                    `
                )[0]!.id,
        );

    it("🔴 `benachrichtigung_einreihen`: ein Auftrag der Art `benachrichtigung`, einmal je Quelle, solange er aktiv ist", async () => {
        const id = await einreihen("production_neu", "production:20261015T0300Z", "  Neue Wegfindung  ");
        expect(id).toMatch(/^\d+$/u);
        const [auftrag] = await cluster!.admin<
            {
                kind: string;
                state: string;
                origin: string;
                label: string;
                external_ref: string;
                priority: number;
                input_ref: Record<string, unknown>;
            }[]
        >`SELECT kind, state, origin, label, external_ref, priority::int AS priority, input_ref FROM job WHERE id = ${id}::bigint`;
        expect(auftrag).toEqual({
            kind: "benachrichtigung",
            state: "QUEUED",
            origin: "queued",
            label: "Meldung: Neu auf avesmaps.de",
            external_ref: "benachrichtigung:production:20261015T0300Z",
            priority: 50,
            input_ref: {
                art: "production_neu",
                an: { rolle: "operator" },
                text: "Neue Wegfindung",
                quelle: "production:20261015T0300Z",
            },
        });
        // Doppelt eingereiht: nichts Neues, `NULL`, und es bleibt bei einem Auftrag.
        expect(await einreihen("production_neu", "production:20261015T0300Z")).toBeNull();
        const [anzahl] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE external_ref = 'benachrichtigung:production:20261015T0300Z'
        `;
        expect(anzahl!.n).toBe(1);
        // Ist er erledigt, darf dieselbe Quelle wieder (die Tafel `benachrichtigung` hält sie je Person ohnehin nur einmal).
        await cluster!.admin`UPDATE job SET state = 'SUCCEEDED', finished_at = now() WHERE id = ${id}::bigint`;
        const wieder = await einreihen("production_neu", "production:20261015T0300Z");
        expect(wieder).not.toBeNull();
        // Die Stage hat ihre eigene Bezeichnung.
        const stage = await einreihen("stage_neu", "stage:abc1234");
        const [stageAuftrag] = await cluster!.admin<
            { label: string }[]
        >`SELECT label FROM job WHERE id = ${stage}::bigint`;
        expect(stageAuftrag!.label).toBe("Meldung: Neu auf der Stage");
        await cluster!.admin`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), cancel_reason = 'operator'
             WHERE id IN (${wieder}::bigint, ${stage}::bigint)
        `;
    });

    it("🔴 `benachrichtigung_einreihen` prüft Art, Ziel, Text und Quelle nach dem Vertrag der Jobart", async () => {
        const PERSON_ID = "7e570000-0000-4000-8000-0000000000cd";
        /** Ein Aufruf, an dem genau EIN Teil vom Gültigen abweicht. */
        const mit = (teile: { art?: string; an?: string; text?: string; quelle?: string }) =>
            `SELECT benachrichtigung_einreihen(${teile.art ?? "'stage_neu'"}, ${teile.an ?? `'{"alle":true}'`}::jsonb, ${
                teile.text ?? "'Kurzinfo'"
            }, ${teile.quelle ?? "'stage:pruef'"})`;
        expect(
            await as(cluster!.roles.jobs, [
                mit({ art: "'kanal_antwort'" }),
                mit({ art: "NULL" }),
                mit({ an: `'{"wer":"alle"}'` }),
                mit({ an: "'[]'" }),
                mit({ an: `'{"alle":false}'` }),
                mit({ an: `'{"rolle":"operator","alle":true}'` }),
                mit({ an: `'{"person":"keine-kennung"}'` }),
                mit({ an: `'{"rolle":"operator","x":1}'` }),
                mit({ an: `'{"alle":true,"ausser":"niemand"}'` }),
                mit({ text: "NULL" }),
                mit({ text: "'   '" }),
                mit({ text: "repeat('x', 301)" }),
                mit({ quelle: "'   '" }),
                mit({ quelle: "'ohne-doppelpunkt'" }),
                mit({ quelle: "'Stage:gross'" }),
                mit({ quelle: "'stage:mit leerzeichen'" }),
            ]),
        ).toEqual(Array.from({ length: 16 }, () => "22023"));
        // Gültig: jede der drei Formen des Ziels, mit `ausser`; die Transaktion von `as` rollt die Aufträge wieder zurück.
        expect(
            await as(cluster!.roles.jobs, [
                mit({ an: `'{"person":"${PERSON_ID}"}'`, quelle: "'stage:p1'" }),
                mit({ an: `'{"rolle":"operator","ausser":"${PERSON_ID}"}'`, quelle: "'stage:p2'" }),
                mit({ an: `'{"alle":true}'`, quelle: "'production:20261015T030000Z-abcdef1'" }),
            ]),
        ).toEqual(["ok", "ok", "ok"]);
    });

    it("🔴 `benachrichtigung_einreihen` nimmt genau die Arten der Warteschlange aus dem Katalog an, jede andere nicht (WI-0201)", async () => {
        // Katalog und Tür in einem Fall: Eine neue Art im Katalog, die über die Warteschlange kommt, braucht eine Migration, die die
        // Tür erweitert (0133, 0140). Kanal und Störungen weist die Tür ab, ebenso eine Art, die es nicht gibt.
        const arten = [...BENACHRICHTIGUNG_ARTEN, "pruefung_nach_push"];
        expect(
            await as(
                cluster!.roles.jobs,
                arten.map(
                    (art) =>
                        `SELECT benachrichtigung_einreihen('${art}', '{"rolle":"operator"}'::jsonb, 'a1b2c3d · lint', 'tuer:${art}')`,
                ),
            ),
        ).toEqual(
            arten.map((art) => ((BENACHRICHTIGUNG_JOB_ARTEN as readonly string[]).includes(art) ? "ok" : "22023")),
        );
        // Der Prüflauf bekommt seine eigene Bezeichnung in der Warteschlange.
        const rot = await einreihen("pruefung_rot", "pruefung-rot:a1b2c3d4", "a1b2c3d · typecheck · error TS2345");
        const gruen = await einreihen("pruefung_gruen", "pruefung-gruen:a1b2c3d4", "a1b2c3d");
        const auftraege = await cluster!.admin<{ label: string; art: string }[]>`
            SELECT label, input_ref ->> 'art' AS art FROM job WHERE id IN (${rot}::bigint, ${gruen}::bigint) ORDER BY id
        `;
        expect(auftraege).toEqual([
            { label: "Meldung: Prüflauf nach dem Push rot", art: "pruefung_rot" },
            { label: "Meldung: Prüflauf nach dem Push wieder grün", art: "pruefung_gruen" },
        ]);
        await cluster!.admin`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), cancel_reason = 'operator'
             WHERE id IN (${rot}::bigint, ${gruen}::bigint)
        `;
    });

    it("🔴 `benachrichtigung_einreihen` führt nur die Jobs-Rolle aus; der Auftrag gilt nie als Editor-Job", async () => {
        const aufruf = [
            "SELECT benachrichtigung_einreihen('stage_neu', '{\"alle\":true}'::jsonb, 'Neu', 'stage:rechte')",
        ];
        expect(await as(cluster!.roles.app, aufruf)).toEqual(["42501"]);
        expect(await as(cluster!.roles.tiles, aufruf)).toEqual(["42501"]);
        const id = await einreihen("stage_neu", "stage:rechte");
        const [auftrag] = await cluster!.admin<{ actor_ref: string; scope_kind: string; scope_tiles: number[] }[]>`
            SELECT actor_ref, scope_kind, scope_tiles FROM job WHERE id = ${id}::bigint
        `;
        // Keine Personen-Kennung als Auslöser: Sonst wartete die Meldung unter der Kartensperre wie ein Editor-Job.
        expect(auftrag).toEqual({ actor_ref: "korridor", scope_kind: "tiles", scope_tiles: [] });
        await cluster!.admin`
            UPDATE job SET state = 'CANCELLED', finished_at = now(), cancel_reason = 'operator' WHERE id = ${id}::bigint
        `;
    });

    it("🔴 einen Lauf des Workers fasst der Korridor nicht an", async () => {
        const id = await enqueue("legacy_media");
        await cluster!.admin`
            UPDATE job SET state = 'RUNNING', lease_owner = 'worker-1', lease_no = lease_no + 1,
                   lease_expires_at = now() + interval '10 minutes', heartbeat_at = now(), started_at = now()
             WHERE public_id = ${id}::uuid
        `;
        expect(await phase(id, "holen")).toBe(false);
        expect(await finish(id, "ok", "fremd")).toBe(false);
        expect(await row(id)).toMatchObject({ state: "RUNNING", lease_owner: "worker-1", phase: null });
    });

    /** Führt `work` über eine angemeldete Rolle aus und rollt immer zurück: Der Fall hinterlässt nichts. */
    async function rolledBack<T>(
        connection: VpsCluster["app"],
        work: (sql: VpsCluster["app"]) => Promise<T>,
    ): Promise<T> {
        let result: T | undefined;
        try {
            await connection.begin(async (tx) => {
                result = await work(tx as unknown as VpsCluster["app"]);
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return result as T;
    }
    const JOB_INSERT =
        "SELECT id::text FROM job_insert('probe', 1::smallint, 'aventuria', 'queued', NULL, NULL, NULL, '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[], '{}'::bigint[])";

    it("Jobs-Rolle: schreibt job, job_dependency und job_event über die Hilfsfunktionen, liest die Quellen", async () => {
        const outcome = await rolledBack(cluster!.jobs, async (sql) => {
            const [row] = await sql.unsafe<{ id: string }[]>(JOB_INSERT);
            await sql`UPDATE job SET priority = 10 WHERE id = ${Number(row?.id)}`;
            const [events] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event`;
            const [places] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM place`;
            return { id: row?.id, events: Number(events?.n), places: Number(places?.n) };
        });
        expect(outcome.id).toMatch(/^\d+$/u);
        expect(outcome.events).toBeGreaterThan(0);
        expect(outcome.places).toBeGreaterThanOrEqual(0);
    });

    it("🔴 Jobs-Rolle: schreibt keine Kartendaten und legt nichts an", async () => {
        expect(
            await cluster!.codesAs(cluster!.jobs, [
                "INSERT INTO map_domain (id) VALUES ('x')",
                "DELETE FROM place",
                "CREATE TABLE zz_jobs_ddl (x int)",
            ]),
        ).toEqual(["42501", "42501", "42501"]);
    });

    it("🔴 App-Rolle: liest job, job_event und die Sicht job_health, schreibt nichts", async () => {
        expect(
            await cluster!.codesAs(cluster!.app, [
                "SELECT count(*) FROM job",
                "SELECT count(*) FROM job_event",
                "SELECT kind FROM job_health",
                "INSERT INTO job (kind, map_domain_id) VALUES ('probe', 'aventuria')",
                "UPDATE job SET priority = 1",
                "DELETE FROM job",
                "INSERT INTO job_event (kind) VALUES ('x')",
            ]),
        ).toEqual(["ok", "ok", "ok", "42501", "42501", "42501", "42501"]);
    });

    it("🔴 App-Rolle: die einzige Tür ist job_enqueue; die Hilfsfunktionen darf sie nicht rufen", async () => {
        const enqueued = await rolledBack(cluster!.app, async (sql) => {
            const [row] = await sql<{ public_id: string }[]>`
                SELECT public_id FROM job_enqueue('terrain_local', 1::smallint, 'aventuria', 'actor-1', '{}'::jsonb)
            `;
            return row?.public_id;
        });
        expect(enqueued).toMatch(/^[0-9a-f-]{36}$/u);
        expect(
            await cluster!.codesAs(cluster!.app, [
                JOB_INSERT,
                "SELECT job_event_add('x', NULL, 'aventuria', '{}'::jsonb)",
                // Auch durch die Tür kommt nur, was sie erlaubt.
                "SELECT * FROM job_enqueue('probe', 1::smallint, 'aventuria', 'a', '{}'::jsonb)",
            ]),
        ).toEqual(["42501", "42501", "42501"]);
    });
});
