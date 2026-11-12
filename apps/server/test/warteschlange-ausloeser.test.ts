import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leseWarteschlangeStand } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { anzeigenamen, ausloeserArt, ausloeserVon, bekannteArt } from "../src/jobs/ausloeser.ts";
import { auftragImStand, baueStand } from "../src/jobs/dirigent/stand.ts";
import { gemeinsameWarteschlange } from "../src/jobs/gemeinsame-reihe.ts";
import { buildJobsOverview } from "../src/jobs/overview.ts";
import { rowToJob, type JobRow } from "../src/jobs/rows.ts";
import { createWarteschlangeStandLeser, standJetzt } from "../src/jobs/stand-datei.ts";
import { insertJob } from "../src/jobs/store.ts";
import { authFixture } from "./support/auth-fixture.ts";
import { testJobsConfig, uniqueScope } from "./support/jobs-support.ts";
import { auftrag, stand, standOrdner } from "./support/warteschlange-stand.ts";

/**
 * Wer, wann, wo in der Warteschlange (WI-0293; Betreiber 2026-11-09: „Wer hat sie gestartet. Wann. Wo (Stage oder Production)?“).
 *
 * **Problemfall.** Production zeigte fünf wartende Aufträge (Gelände veröffentlichen, Routenrechner, Höhenlinien …), und niemand sah,
 * wer sie ausgelöst hatte, wann und in welcher Umgebung: Die gemeinsame Reihe (WI-0163) mischt Stage und Production.
 *
 * **Soll**, je Fall mit Namen:
 *
 * 1. Die Art folgt aus `actor_ref` und Herkunft; Kette und Folgeaufträge tragen die Person des Auslösers.
 * 2. 🔴 Der Stand des Dirigenten trägt die Art und bei einer Person ihren Anzeigenamen (Betreiber 2026-11-09: „Ja, Namen zeigen“), nie
 *    `actor_ref`; eine unbekannte Art heißt „unbekannt“. Die Rechte der Leserolle prüft `warteschlange-namen-rechte.test.ts`.
 * 3. Die Übersicht nennt den heutigen Anzeigenamen der Person (gegen echtes PostgreSQL), die Umgebung der Tafel, und für die
 *    andere Umgebung Art und Namen aus dem Stand.
 */

const PERSON = "7e570000-0000-4000-8000-000000002930";

function zeile(teile: Partial<JobRow> & { id: number }): JobRow {
    return rowToJob({
        id: teile.id,
        public_id: teile.publicId ?? randomUUID(),
        kind: teile.kind ?? "terrain_local",
        kind_version: 1,
        map_domain_id: "aventuria",
        origin: teile.origin ?? "queued",
        actor_ref: teile.actorRef ?? null,
        external_ref: null,
        label: null,
        input_ref: {},
        state: teile.state ?? "QUEUED",
        wait_reason: null,
        priority: 50,
        queued_at: new Date("2026-11-09T08:00:00.000Z"),
        not_before: teile.notBefore ?? null,
        first_requested_at: new Date("2026-11-09T08:00:00.000Z"),
        coalesced_count: 0,
        scope_kind: "tiles",
        scope_tiles: [],
        attempt: 0,
        lease_owner: null,
        lease_no: 0,
        lease_expires_at: null,
        heartbeat_at: null,
        phase: null,
        progress: null,
        cancel_requested_at: null,
        cancel_reason: null,
        started_at: null,
        finished_at: null,
        rss_peak_mb: null,
        arraybuffer_peak_mb: null,
        cpu_ms: null,
        wall_ms: null,
        swap_seen_mb: null,
        mem_expected_mb: null,
        phase_stats: {},
        findings: [],
        result: null,
        error_code: null,
        error_summary: null,
        depends_on: [],
    });
}

describe("Auslöser einer Zeile (WI-0293, 1)", () => {
    it("die Art aus actor_ref und Herkunft", () => {
        expect(ausloeserArt(PERSON, "queued")).toBe("person");
        expect(ausloeserArt(PERSON.toUpperCase(), "queued")).toBe("person");
        expect(ausloeserArt("cli:vali", "queued")).toBe("kommandozeile");
        expect(ausloeserArt("jobs-cli", "queued")).toBe("kommandozeile");
        expect(ausloeserArt("agent:claudio", "queued")).toBe("agent");
        for (const ref of ["system:wikisync", "kanal", "inhaltsschalter", "notaus"]) {
            expect(ausloeserArt(ref, "queued")).toBe("automatik");
        }
        expect(ausloeserArt(null, "recorded")).toBe("betrieb");
        expect(ausloeserArt(null, "queued")).toBe("unbekannt");
        expect(ausloeserArt("  ", "queued")).toBe("unbekannt");
    });

    it("der Name: die Person aus der Karte der Namen, der Agent aus seiner Kennung, sonst keiner", () => {
        const namen = new Map([[PERSON, "Vali"]]);
        expect(ausloeserVon({ actorRef: PERSON, origin: "queued" }, namen)).toEqual({ art: "person", name: "Vali" });
        expect(ausloeserVon({ actorRef: randomUUID(), origin: "queued" }, namen)).toEqual({
            art: "person",
            name: null,
        });
        expect(ausloeserVon({ actorRef: "agent:claudio", origin: "queued" }, namen)).toEqual({
            art: "agent",
            name: "Claudio",
        });
        expect(ausloeserVon({ actorRef: "cli:root", origin: "queued" }, namen)).toEqual({
            art: "kommandozeile",
            name: null,
        });
    });

    it("eine Art aus dem Stand, die diese App nicht kennt, heißt „unbekannt“; ohne Angabe bleibt sie aus", () => {
        expect(bekannteArt("person")).toBe("person");
        expect(bekannteArt("zeitplan")).toBe("unbekannt");
        expect(bekannteArt(undefined)).toBeUndefined();
    });
});

describe("Auslöser im Stand des Dirigenten (WI-0293, 2)", () => {
    it("🔴 nie actor_ref: auch nicht irgendwo im geschriebenen Stand; ohne Namen kein Feld", () => {
        const geschrieben = auftragImStand({
            umgebung: "staging",
            job: zeile({ id: 7, actorRef: PERSON }),
            platz: 1,
            wartegrund: null,
            schwer: true,
        });
        expect(geschrieben.ausloeser).toBe("person");
        expect(geschrieben).not.toHaveProperty("ausloeserName");
        expect(JSON.stringify(geschrieben)).not.toContain(PERSON);
        expect(leseWarteschlangeStand(JSON.parse(JSON.stringify(stand({ auftraege: [geschrieben] }))))).not.toBeNull();
    });

    it("🔴 der Name aus der Quelle steht im Stand, nur bei einer Person, gekürzt auf die Grenze; nie actor_ref", () => {
        const { stand: geschrieben } = baueStand({
            nowMs: Date.parse("2026-11-09T08:00:00.000Z"),
            dirigent: { instanz: "test", release: null, taktS: 2 },
            pause: stand().pause,
            umgebungen: [{ name: "production", erreichbar: true, planer: true }],
            reihe: [
                {
                    umgebung: "production",
                    job: zeile({ id: 1, actorRef: PERSON }),
                    platz: 1,
                    wartegrund: null,
                    schwer: true,
                },
                {
                    umgebung: "production",
                    job: zeile({ id: 2, actorRef: "cli:vali" }),
                    platz: 2,
                    wartegrund: null,
                    schwer: true,
                },
                {
                    umgebung: "production",
                    job: zeile({ id: 3, actorRef: randomUUID() }),
                    platz: 3,
                    wartegrund: null,
                    schwer: true,
                },
            ],
            name: (umgebung, ref) =>
                umgebung === "production" && ref === PERSON ? `  ${"Rondrikan".repeat(10)}  ` : null,
        });
        expect(leseWarteschlangeStand(JSON.parse(JSON.stringify(geschrieben)))).not.toBeNull();
        expect(geschrieben.auftraege.map((eintrag) => [eintrag.ausloeser, eintrag.ausloeserName])).toEqual([
            ["person", "Rondrikan".repeat(10).slice(0, 80)],
            ["kommandozeile", undefined],
            ["person", undefined],
        ]);
        expect(JSON.stringify(geschrieben)).not.toContain(PERSON);
    });

    it("die gemeinsame Reihe gibt Art und Namen weiter; Unbekanntes wird „unbekannt“, Fehlendes fehlt", () => {
        const lage = {
            zustand: "ok" as const,
            stand: stand({
                auftraege: [
                    auftrag("staging", {
                        publicId: randomUUID(),
                        platz: 1,
                        ausloeser: "person",
                        ausloeserName: "Vali",
                    }),
                    auftrag("staging", { publicId: randomUUID(), platz: 2, ausloeser: "person" }),
                    auftrag("staging", { publicId: randomUUID(), platz: 3, ausloeser: "zeitplan", ausloeserName: "x" }),
                    auftrag("test", { publicId: randomUUID(), platz: 4 }),
                ],
            }),
        };
        const reihe = gemeinsameWarteschlange(lage, "test", null)?.reihe ?? [];
        expect(reihe.map((eintrag) => eintrag.ausgeloest)).toEqual([
            { art: "person", name: "Vali" },
            { art: "person", name: null },
            { art: "unbekannt", name: null },
            undefined,
        ]);
    });

    it("🔴 ein sammelnder Auftrag trägt seinen frühesten Start in die andere Umgebung (sonst stand dort „{time}“)", () => {
        const start = new Date("2026-11-09T08:00:13.000Z");
        const geschrieben = auftragImStand({
            umgebung: "production",
            job: zeile({ id: 8, notBefore: start }),
            platz: 3,
            wartegrund: "debouncing",
            schwer: true,
        });
        expect(geschrieben.notBefore).toBe(start.toISOString());
        expect(
            auftragImStand({ umgebung: "production", job: zeile({ id: 9 }), platz: 4, wartegrund: null, schwer: true })
                .notBefore,
        ).toBeNull();
        const lage = { zustand: "ok" as const, stand: stand({ auftraege: [geschrieben] }) };
        expect(leseWarteschlangeStand(JSON.parse(JSON.stringify(lage.stand)))).not.toBeNull();
        expect(gemeinsameWarteschlange(lage, "staging", null)?.reihe[0]).toMatchObject({
            waitReason: "debouncing",
            notBefore: start.toISOString(),
        });
        // Ein älterer Dirigent schreibt das Feld nicht: Dann fehlt es auch in der Antwort.
        const alt = {
            zustand: "ok" as const,
            stand: stand({ auftraege: [auftrag("production", { publicId: randomUUID() })] }),
        };
        expect(gemeinsameWarteschlange(alt, "staging", null)?.reihe[0]).not.toHaveProperty("notBefore");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Auslöser in der Übersicht (WI-0293, 3)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let ordner: Awaited<ReturnType<typeof standOrdner>>;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        ordner = await standOrdner();
    });

    beforeEach(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
    });

    afterAll(async () => {
        await database`DELETE FROM job_event`;
        await database`DELETE FROM job`;
        await fixture.cleanup();
        await ordner.weg();
        await database.end({ timeout: 5 });
    });

    const reiheEin = async (actorRef: string | null) =>
        (
            await insertJob(database, {
                kind: "probe",
                mapDomainId: "aventuria",
                scopeKind: "tiles",
                scopeTiles: [],
                ...(actorRef === null ? {} : { actorRef }),
            })
        ).publicId;

    it("anzeigenamen: eine Abfrage für viele, nur Personen, Großschreibung egal", async () => {
        const vali = await fixture.person("admin", { name: "Vali" });
        const namen = await anzeigenamen(database, [vali.id.toUpperCase(), "cli:root", null, randomUUID()]);
        expect([...namen.entries()]).toEqual([[vali.id, "Vali"]]);
    });

    it("🔴 Person mit Namen, Kommandozeile, unbekannt; die Umgebung der Tafel; die andere Umgebung mit Namen aus dem Stand", async () => {
        const editor = await fixture.person("editor", { name: "Rondrikan" });
        const vonPerson = await reiheEin(editor.id);
        const vonCli = await reiheEin("cli:vali");
        const ohne = await reiheEin(null);
        await ordner.schreibe(
            stand({
                auftraege: [
                    auftrag("staging", {
                        publicId: randomUUID(),
                        platz: 1,
                        ausloeser: "person",
                        ausloeserName: "Vali",
                    }),
                    auftrag("test", { publicId: vonPerson, platz: 2 }),
                ],
            }),
        );
        const optionen = {
            database,
            config: testJobsConfig(),
            releaseId: "test",
            mapDomainId: "aventuria",
            plannerScope: uniqueScope("wi0293"),
            stand: await standJetzt(createWarteschlangeStandLeser(ordner.datei, "test", { ttlMs: 0 })),
        };
        const alle = await buildJobsOverview(optionen);
        const von = (id: string) => alle.queued.find((job) => job.id === id)?.ausgeloest;
        expect(von(vonPerson)).toEqual({ art: "person", name: "Rondrikan" });
        expect(von(vonCli)).toEqual({ art: "kommandozeile", name: null });
        expect(von(ohne)).toEqual({ art: "unbekannt", name: null });
        expect(alle.umgebung).toBe("test");
        const fremd = alle.gemeinsam?.reihe.find((eintrag) => !eintrag.eigen);
        expect(fremd?.ausgeloest).toEqual({ art: "person", name: "Vali" });

        // Die eigene Sicht: nur die eigenen Aufträge, also nur der eigene Name.
        const eigene = await buildJobsOverview({ ...optionen, owner: editor.id });
        expect(eigene.queued.map((job) => job.ausgeloest)).toEqual([{ art: "person", name: "Rondrikan" }]);
    });
});
