import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AVENTURIA_SERIES, type KartenserieUebernahme } from "@avesmaps3d/shared";
import type { SchluesselSpeicher } from "../src/abzug/holen.ts";
import { leseKatalog } from "../src/abzug/katalog.ts";
import { baueAbzugPlan } from "../src/abzug/plan.ts";
import { ladeRegeln } from "../src/abzug/regeln.ts";
import { neuerSchluessel } from "../src/abzug/schluessel.ts";
import { buildApp } from "../src/app.ts";
import { AUDIT_BEREICH, type AuditAction } from "../src/auth/audit.ts";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { discordKonfiguration } from "../src/discord/konfig.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { SYSTEM_COMMANDS } from "../src/system/system-cli.ts";
import {
    SYSTEM_COMMAND_EVENTS,
    SYSTEM_ROUTE_DATENSTUECKE,
    SYSTEM_ROUTE_EVENTS,
} from "../src/system/protokollpflicht.ts";
import { WRITE_METHODS } from "../src/system/write-guard.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { schreibeAbzug } from "./support/abzug-export.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Wächter der Protokollpflicht (WI-0127 SYS-15, SYS-0001 §9d.2): Jede Handlung der Systemsteuerung schreibt genau ein Ereignis, über
 * die Route wie über die Kommandozeile.
 *
 * - Ohne Datenbank: Jede schreibende Route unter `/api/admin/system…` und jeder schreibende Befehl der Kommandozeile hat eine Zeile in
 *   `system/protokollpflicht.ts`; jede genannte Art ist ein System-Ereignis (`AUDIT_BEREICH`).
 * - Mit Datenbank: Jede Handlung wird einmal gerufen, und genau ein neuer Eintrag ihrer Art entsteht. Der Test hinterlässt Normal und
 *   offen und bricht seine Aufträge ab.
 * - Die Werkstatt „19 (Test)“ schreibt nur in eine offene Fassung; seit der Abnahme von 19 (2026-11-07) gibt es keine. Ihre Handlung läuft
 *   darum an einer gedachten offenen 19 (`support/offene-fassung.ts`).
 */
vi.mock("../src/terrain/domain/recipes.ts", async (importOriginal) =>
    (await import("./support/offene-fassung.ts")).mitOffenerFassung19(await importOriginal()),
);

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SILENT = { write: () => undefined };

function config(
    databaseUrl: string | undefined,
    requestDir?: string,
    freigabeFile?: string,
    releaseTestStarter?: string,
): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "sys15-test",
        databaseUrl,
        // Kacheln der Kartenserien (WI-0220 Schnitt 4): Die Übernahme nach Production braucht eine Fassung auf der Platte.
        tileRoot: requestDir === undefined ? undefined : join(requestDir, "tiles"),
        statusPage: true,
        auth: TEST_AUTH,
        abgleiche: "worker",
        backup: { statusFile: undefined, requestDir },
        freigabe: { statusFile: freigabeFile },
        // Die Routen des Release-Tests gibt es nur lokal (WI-0248 L); der Wächter prüft die Konfiguration, die sie anmeldet.
        // 🔴 `ausgabe` in den Wegwerfordner neben dem Ersatz-Starter: Sonst schriebe der abgelöste Starter `starter-<sha12>.log` in die echte Datenwurzel
        // (`C:/avesmaps3d-data/release-abholer`, 2026-10-24: `starter-aaaaaaaaaaaa.log`).
        releaseTest: {
            starter: releaseTestStarter,
            ...(releaseTestStarter === undefined ? {} : { ausgabe: join(dirname(releaseTestStarter), "ausgabe") }),
        },
        // Der Abzug für lokal (WI-0251): beide Rollen, damit der Wächter alle vier Schreibwege sieht; das Einspielen ist ein Ersatz, der nichts ersetzt.
        abzug: {
            rollen: ["erstellen", "einspielen"],
            quelle: "staging",
            wurzel: requestDir === undefined ? undefined : join(requestDir, "abzug"),
            pgDump: "attrappe",
            databaseUrl: "postgres://ungenutzt@127.0.0.1/ungenutzt",
            einspielen: async () => ({
                kennung: ABZUG_WAECHTER,
                tafeln: 0,
                zeilen: 0,
                sicherung: "vorher-waechter.dump",
                medien: { dateien: 0, geschrieben: 0, vorhanden: 0, offen: 0, bytes: 0, ersterFehler: null },
            }),
            // Das Holen (WI-0251) erreicht nie eine echte Quelle: `fetch` scheitert sofort, der Schlüssel liegt im Speicher statt in einer Datei.
            quellen: { staging: "http://127.0.0.1:9" },
            fetch: () => Promise.reject(new Error("Wächter: keine Quelle")),
            pauseMs: 0,
            schluessel: abzugSchluesselImSpeicher(),
        },
        // Der Discord-Tagesbericht (WI-0255): sendet wie die Stage (nur sie sendet), aber `fetch` scheitert sofort — kein Test spricht mit Discord.
        discord: {
            ...discordKonfiguration({
                AVESMAPS_ENV: "staging",
                RELEASE_ID: "20261025T000000Z-aaaaaaa",
                DISCORD_BERICHT: "senden",
                DISCORD_BOT_TOKEN: "waechter-schluessel",
                DISCORD_BERICHT_KANAL: DISCORD_KANAL,
            }),
            abruf: () => Promise.reject(new Error("Wächter: kein Discord")),
        },
    };
}

/** Der Kanal des Wächters (eine erfundene Kennung im Format von Discord). */
const DISCORD_KANAL = "1000000000000000001";

/** Ein Schlüsselspeicher im Arbeitsspeicher: Der Wächter schreibt keine Datei mit einem Schlüssel. */
function abzugSchluesselImSpeicher(): SchluesselSpeicher {
    const werte: Partial<Record<"staging" | "production", string>> = {};
    return {
        lies: (quelle) => werte[quelle],
        gesetzt: () => ({ staging: werte.staging !== undefined, production: werte.production !== undefined }),
        setze(quelle, wert) {
            if (wert === null) delete werte[quelle];
            else werte[quelle] = wert;
        },
    };
}

/** Die Kennung des Abzugs, den der Wächter ablegt und einspielen lässt. */
const ABZUG_WAECHTER = "20261024T120000Z-waechter";

/**
 * Die Statusdatei der Production-Freigabe, so klein wie der Vertrag sie zulässt: Production und Stage verschieden, Stage grün —
 * sonst wäre der Weg nach Production zu und die Route käme nicht bis zum Protokollereignis.
 */
const FREIGABE_DATEI = {
    schema: 1,
    standAt: "2026-10-14T00:00:00.000Z",
    production: { release: "aaaaaaa", commit: "a".repeat(40), seit: "2026-10-13T00:00:00.000Z" },
    stage: { release: "bbbbbbb", commit: "b".repeat(40), seit: "2026-10-14T00:00:00.000Z" },
    stageGruen: true,
    stagePruefung: "Proben und Journal gruen",
    technik: { migrationen: [], rechte: [], umgebungswerte: [] },
    themen: [],
} as const;

describe("Protokollpflicht: die Tafel (ohne Datenbank)", () => {
    it("🔴 jede schreibende Route unter /api/admin/system… steht in der Tafel, und die Tafel nennt keine, die es nicht gibt", async () => {
        const app = buildApp({ config: config(undefined), logStream: SILENT });
        const found: string[] = [];
        app.addHook("onRoute", (options) => {
            const methods = Array.isArray(options.method) ? options.method : [options.method];
            for (const method of methods) {
                if (WRITE_METHODS.has(method) && options.url.startsWith("/api/admin/system")) {
                    found.push(`${method} ${options.url}`);
                }
            }
        });
        await app.ready();
        await app.close();
        // Datenstücke eines angelegten Uploads (WI-0220 Schnitt 3) sind keine Handlung; sie stehen in ihrer eigenen, kurzen Liste.
        expect(found.sort()).toEqual([...Object.keys(SYSTEM_ROUTE_EVENTS), ...SYSTEM_ROUTE_DATENSTUECKE].sort());
    });

    it("🔴 die Ausnahme für Datenstücke ist eng: nur PUT auf einen angelegten Upload, und sie schreibt keine Handlung", () => {
        for (const route of SYSTEM_ROUTE_DATENSTUECKE) {
            expect(route).toMatch(/^PUT \/api\/admin\/system\/[a-z]+\/uploads\/:id$/u);
            expect(Object.keys(SYSTEM_ROUTE_EVENTS)).not.toContain(route);
        }
    });

    it("🔴 jeder schreibende Befehl der Kommandozeile steht in der Tafel", () => {
        // Nur lesende Befehle (`…-zeigen`) schreiben nichts.
        expect(SYSTEM_COMMANDS.filter((command) => !command.endsWith("-zeigen")).sort()).toEqual(
            Object.keys(SYSTEM_COMMAND_EVENTS).sort(),
        );
    });

    it("🔴 die Einordnung folgt der Regel aus §9d.2: system., backup., recovery. sind System, alles andere Konten", () => {
        const falsch = (Object.entries(AUDIT_BEREICH) as [AuditAction, string][]).filter(
            ([action, bereich]) => (/^(system|backup|recovery)\./u.test(action) ? "system" : "konten") !== bereich,
        );
        expect(falsch).toEqual([]);
    });

    it("jede Art der Tafel ist ein System-Ereignis", () => {
        const kinds = [...Object.values(SYSTEM_ROUTE_EVENTS), ...Object.values(SYSTEM_COMMAND_EVENTS)];
        expect(kinds.filter((kind) => AUDIT_BEREICH[kind] !== "system")).toEqual([]);
    });
});

describeWithDatabase("Protokollpflicht: genau ein Ereignis je Handlung (PostgreSQL)", { timeout: 300_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let app: FastifyInstance;
    let cookie: string;
    let requests: string;
    let freigabeFile: string;

    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL,
                   queue_paused = false, queue_paused_since = NULL, queue_paused_by = NULL, queue_paused_by_label = NULL,
                   queue_paused_reason = NULL
             WHERE id = 1
        `;
        await database`
            UPDATE job SET state = 'CANCELLED', finished_at = now()
             WHERE kind IN ('legacy_pull', 'legacy_media', 'terrain_full', 'routing_reload', 'display_heights', 'terrain_preview',
                           'map_series_tile', 'map_series_production', 'abzug_lokal')
               AND state IN ('QUEUED', 'RUNNING')
        `;
        // Wiederherstellungsanträge (WI-0124 K5) und Freigaben (FREIGABE-0001) sind Vorgänge im Kanal; abgelöste und abgebrochene
        // Freigaben tragen einen Verlauf (WI-0234), der zuerst geht.
        await database`
            DELETE FROM avesmaps_kanal.eintrag
             WHERE vorgang_id IN (
                 SELECT id FROM avesmaps_kanal.vorgang WHERE art IN ('wiederherstellung', 'freigabe') AND environment = 'test'
             )
        `;
        await database`
            DELETE FROM avesmaps_kanal.vorgang
             WHERE art IN ('wiederherstellung', 'freigabe') AND environment = 'test'
        `;
        // Neuigkeiten (WI-0139): Die Routen löschen nie, der Wächter räumt seine eigenen Zeilen selbst weg.
        await database`DELETE FROM public.news_entry WHERE titel = 'Wächter SYS-15'`;
        // Discord-Tagesbericht (WI-0255): die Zustellungen des Wächters weg, die Routine wieder aus.
        await database`DELETE FROM public.discord_zustellung`;
        await database`UPDATE public.discord_routine SET aktiv = false, uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL`;
        // Mailpostfach (WI-0268 C6c): beide Schalter wieder an (die Vorgabe; die Tests der Mailjobs setzen das voraus).
        await database`UPDATE avesmaps_community.mail_routine SET aktiv = true, geaendert_at = NULL, geaendert_von = NULL`;
        // Inhaltsschalter (SYS-10): alles wieder an (Zeilen bleiben, die App löscht nie).
        await database`UPDATE content_switch SET enabled = TRUE WHERE NOT enabled`;
        // Wegfindung (WI-0153): alle Abweichungen weg, gespeichert UND freigegeben, also gelten wieder die Vorgaben.
        await database`DELETE FROM routing_setting`;
        await database`DELETE FROM routing_setting_applied`;
        // Karteneinstellungen (WI-0166): alle Abweichungen weg, also gelten wieder die Vorgaben der Tafel.
        await database`DELETE FROM map_setting`;
        await database`DELETE FROM map_series`;
        await database`DELETE FROM zoom_band_setting`;
        // Wettermodell (WI-0288): alle Abweichungen weg.
        await database`DELETE FROM weather_model_setting`;
        // Höhenmodell (SYS-13): zurück auf die Vorgabe der Datei, offene Entwürfe verworfen.
        await database`DELETE FROM terrain_recipe_choice`;
        await database`UPDATE terrain_recipe_draft SET state = 'verworfen', discarded_at = now() WHERE state = 'entwurf'`;
        await app?.systemState?.refresh();
    }

    async function count(action: AuditAction): Promise<number> {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE environment = 'test' AND action = ${action}
        `;
        return row!.n;
    }

    async function wegfindungRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM routing_setting_state WHERE id = 1`;
        return row!.revision;
    }

    async function zoombandRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM zoom_band_state WHERE id = 1`;
        return row!.revision;
    }

    async function wettermodellRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM weather_model_state WHERE id = 1`;
        return row!.revision;
    }

    async function kartenserienRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM map_series_state WHERE id = 1`;
        return row!.revision;
    }

    async function kartenRevision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM map_setting_state WHERE id = 1`;
        return row!.revision;
    }

    async function terrainRevision(): Promise<number> {
        const [row] = await database<{ revision: number }[]>`SELECT revision FROM terrain_recipe_choice`;
        return row?.revision ?? 0;
    }

    async function lastDraft(): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            SELECT id::text AS id FROM terrain_recipe_draft WHERE state = 'entwurf' ORDER BY created_at DESC LIMIT 1
        `;
        return row!.id;
    }

    async function lastNews(): Promise<number> {
        const [row] = await database<{ id: number }[]>`
            SELECT id::int AS id FROM public.news_entry ORDER BY id DESC LIMIT 1
        `;
        return row!.id;
    }

    /**
     * Offene Freigaben wegräumen: Eine laufende Freigabe sperrt den nächsten Weg (`sperreVon`, `kanal_freigabe_anlegen`).
     * Gelöscht, nicht abgenommen — eine Abnahme verlangt ihre Nachweise (`vorgang_abnahme`), und der Wächter will hier
     * keinen Vorgang nachspielen, sondern nur den Weg frei haben.
     */
    async function freigabenWeg(): Promise<void> {
        // Abgelöste und abgebrochene Freigaben tragen einen Verlauf (WI-0234); der geht zuerst.
        await database`
            DELETE FROM avesmaps_kanal.eintrag
             WHERE vorgang_id IN (SELECT id FROM avesmaps_kanal.vorgang WHERE art = 'freigabe' AND environment = 'test')
        `;
        await database`DELETE FROM avesmaps_kanal.vorgang WHERE art = 'freigabe' AND environment = 'test'`;
    }

    async function revision(): Promise<number> {
        const [row] = await database<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM system_state WHERE id = 1`;
        return row!.revision;
    }

    /** Genau ein neuer Eintrag dieser Art, während `handlung` läuft. */
    async function genauEins(action: AuditAction, handlung: () => Promise<void>): Promise<void> {
        const before = await count(action);
        await handlung();
        expect(await count(action), action).toBe(before + 1);
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        requests = await mkdtemp(join(tmpdir(), "protokollpflicht-"));
        freigabeFile = join(requests, "freigabe.json");
        await writeFile(freigabeFile, JSON.stringify(FREIGABE_DATEI), "utf8");
        // Der Ersatz für den Starter des Release-Tests: antwortet aus `zustand.json` und startet nie einen echten Test.
        const starterOrdner = join(requests, "release-test");
        await mkdir(starterOrdner);
        await copyFile(
            fileURLToPath(new URL("./support/release-test-starter.mjs", import.meta.url)),
            join(starterOrdner, "starter.mjs"),
        );
        await writeFile(
            join(starterOrdner, "zustand.json"),
            JSON.stringify({
                kandidat: { stage: { sha: "a".repeat(40), zeit: "2026-10-23T08:00:00Z" }, auftrag: null },
                trocken: { status: "trocken", grund: "Würde starten." },
                start: { status: "gestartet", grund: "Release-Test gestartet" },
                abbrechen: { status: "abbruch-angefordert", grund: "Abbruch angefordert" },
            }),
            "utf8",
        );
        app = buildApp({
            config: config(undefined, requests, freigabeFile, join(starterOrdner, "starter.mjs")),
            // Eine eigene Verbindung: Die App schließt ihre beim Beenden, die Aufräumarbeit danach braucht die des Tests.
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: SILENT,
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        await resetState();
        const operator = await fixture.person("operator", { name: "Wächterin" });
        await database`
            INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
            VALUES (${operator.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
        `;
        cookie = (await fixture.session(operator.id, { passkeyMinutesAgo: 1 })).cookie;
    });

    afterAll(async () => {
        await resetState();
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (requests !== undefined) await rm(requests, { recursive: true, force: true });
    });

    const post = async (url: string, payload: object): Promise<void> => {
        const response = await app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
        expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
        await app.systemState?.refresh();
    };

    const cli = async (argv: string[]): Promise<void> => {
        const err: string[] = [];
        const code = await runAuthCli(
            argv,
            { AVESMAPS_ENV: "test", ABGLEICHE: "worker", TILE_ROOT: join(requests, "tiles") },
            { out: () => undefined, err: (line) => void err.push(line) },
            { database, systemUser: "waechter" },
        );
        expect(code, `${argv.join(" ")}: ${err.join(" ")}`).toBe(0);
        await app.systemState?.refresh();
    };

    /** Eine Fassung der Serie „original“ auf der Platte, mit Zeiger daneben und als `current.json` (WI-0220 Schnitt 4). */
    const kartenfassung = async (): Promise<string> => {
        const revision = "aaaaaaaaaaaa";
        const ordner = join(requests, "tiles", "original");
        await mkdir(join(ordner, revision, "0", "0"), { recursive: true });
        await writeFile(join(ordner, revision, "0", "0", "0.webp"), revision);
        const zeiger = JSON.stringify({
            schemaVersion: 1,
            series: "original",
            revision,
            manifest: `${revision}${"0".repeat(52)}`,
            format: "webp",
            tileSize: 512,
            maxNativeZoom: 6,
        });
        await writeFile(
            join(ordner, `${revision}.json`),
            `${zeiger}
`,
        );
        await writeFile(
            join(ordner, "current.json"),
            `${zeiger}
`,
        );
        return revision;
    };

    /** Eine kleine Datei mit dem Kopf eines 8k-PNG (zerlegt wird hier nicht, der Abschluss prüft nur Größe und Kopf). */
    const kartenquelle = (): Buffer => {
        const masse = Buffer.alloc(8);
        masse.writeUInt32BE(8192, 0);
        masse.writeUInt32BE(8192, 4);
        return Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), masse, Buffer.alloc(40, 7)]);
    };
    /** Einen Upload anlegen und vollständig schicken (WI-0220 Schnitt 3); gibt seine Kennung zurück. */
    const kartenupload = async (serie: string): Promise<string> => {
        const quelle = kartenquelle();
        const angelegt = await app.inject({
            method: "POST",
            url: "/api/admin/system/kartenserien/uploads",
            payload: {
                operationId: randomUUID(),
                ziel: { art: "neu", id: serie, anlage: { label: "Wächter", labelsInImage: false, nurEditoren: true } },
                bytes: quelle.length,
                kante: 8192,
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(angelegt.statusCode, angelegt.body).toBe(200);
        const id = (angelegt.json() as { affected: { id: string }[] }).affected[0]!.id;
        const stueck = await app.inject({
            method: "PUT",
            url: `/api/admin/system/kartenserien/uploads/${id}?versatz=0`,
            payload: quelle,
            headers: {
                origin: TEST_ORIGIN,
                cookie,
                "content-type": "application/octet-stream",
                "x-avesmaps-sha256": createHash("sha256").update(quelle).digest("hex"),
            },
        });
        expect(stueck.statusCode, stueck.body).toBe(200);
        return id;
    };

    it("🔴 jede Route: genau ein Ereignis", async () => {
        // Hochladen (WI-0220 Schnitt 3): Der Abschluss braucht einen fertigen Upload; dessen Anlegen schreibt ein Ereignis derselben
        // Art und steht darum VOR der Zählung. Die Quellen liegen in einem eigenen Ordner, nicht neben echten Kacheln.
        process.env["MAP_SOURCES_ROOT"] = join(requests, "map-sources");
        const fertigerUpload = await kartenupload("waechterzwei");
        // Der Abzug für lokal (WI-0251): einer in der Ablage der Stage (für den Link) und dieselbe Datei als Eingang für das Einspielen.
        const abzugOrdner = join(requests, "abzug", "staging", ABZUG_WAECHTER);
        await mkdir(abzugOrdner, { recursive: true });
        await schreibeAbzug(database, baueAbzugPlan(await leseKatalog(database), ladeRegeln(), "staging"), {
            ziel: join(abzugOrdner, "abzug.tar"),
            kennung: ABZUG_WAECHTER,
            quelle: "staging",
        });
        const abzugBytes = await readFile(join(abzugOrdner, "abzug.tar"));
        const routes: Record<keyof typeof SYSTEM_ROUTE_EVENTS, () => Promise<void>> = {
            "POST /api/admin/system/mode": async () => {
                await post("/api/admin/system/mode", {
                    operationId: randomUUID(),
                    baseRevision: await revision(),
                    mode: "restricted",
                    reason: "Wächter SYS-15",
                });
            },
            "POST /api/admin/system/lock": async () => {
                await post("/api/admin/system/lock", {
                    operationId: randomUUID(),
                    baseRevision: await revision(),
                    lock: "map",
                    locked: true,
                    reason: "Wächter SYS-15",
                });
            },
            // Die Warteschlange pausieren (WI-0160): dieselbe Form, ein Ereignis `system.queue_changed`.
            "POST /api/admin/system/queue": async () => {
                await post("/api/admin/system/queue", {
                    operationId: randomUUID(),
                    baseRevision: await revision(),
                    paused: true,
                    reason: "Wächter SYS-15",
                });
            },
            "POST /api/admin/system/abgleiche/start": async () => {
                await post("/api/admin/system/abgleiche/start", { operationId: randomUUID(), quelle: "medien" });
            },
            "POST /api/admin/system/backup/start": async () => {
                await post("/api/admin/system/backup/start", { operationId: randomUUID() });
            },
            "POST /api/admin/system/backup/wiederherstellung": async () => {
                await post("/api/admin/system/backup/wiederherstellung", {
                    operationId: randomUUID(),
                    sicherung: "letzte",
                    umfang: "datenbank",
                    grund: "Wächter K5",
                });
            },
            "POST /api/admin/system/hoehenmodell/waehlen": async () => {
                await post("/api/admin/system/hoehenmodell/waehlen", {
                    operationId: randomUUID(),
                    baseRevision: await terrainRevision(),
                    version: 17,
                    reason: "Wächter SYS-13",
                });
            },
            "POST /api/admin/system/hoehenmodell/zurueck": async () => {
                await post("/api/admin/system/hoehenmodell/zurueck", {
                    operationId: randomUUID(),
                    baseRevision: await terrainRevision(),
                    reason: "Wächter SYS-13",
                });
            },
            "POST /api/admin/system/hoehenmodell/neu-rechnen": async () => {
                // Wählen und Zurück lassen eine Kette wartend zurück; neu rechnen nimmt nur an, wenn keine wartet.
                await database`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE kind = 'terrain_full' AND state = 'QUEUED'`;
                await post("/api/admin/system/hoehenmodell/neu-rechnen", { operationId: randomUUID() });
            },
            "POST /api/admin/system/content-switches": async () => {
                const [row] = await database<{ revision: number }[]>`
                    SELECT content_revision::int AS revision FROM system_state WHERE id = 1
                `;
                await post("/api/admin/system/content-switches", {
                    operationId: randomUUID(),
                    baseRevision: row!.revision,
                    key: "panel.reviews",
                    enabled: false,
                });
            },
            // Kenngrößen der Wegfindung (WI-0153): ein Wert verstellt, ein Ereignis. Der Wächter räumt die Zeile in
            // `resetState` weg; das Zurücksetzen (`value: null`) wäre eine zweite Handlung derselben Art.
            "POST /api/admin/system/wegfindung": async () => {
                await post("/api/admin/system/wegfindung", {
                    operationId: randomUUID(),
                    baseRevision: await wegfindungRevision(),
                    id: "endSnap",
                    value: 0.03,
                });
            },
            // Karteneinstellungen (WI-0166): ein Startzoom verstellt, ein Ereignis; `resetState` räumt die Zeile weg.
            "POST /api/admin/system/karteneinstellungen": async () => {
                await post("/api/admin/system/karteneinstellungen", {
                    operationId: randomUUID(),
                    baseRevision: await kartenRevision(),
                    id: "startZoom",
                    value: 3,
                });
            },
            // Kartenserien (WI-0220): eine Handlung, hier das Bild im Fächer.
            "POST /api/admin/system/kartenserien": async () => {
                await post("/api/admin/system/kartenserien", {
                    operationId: randomUUID(),
                    baseRevision: await kartenserienRevision(),
                    id: "original",
                    aktion: { art: "thumb", thumb: { x: 3, y: 9 } },
                });
            },
            // Hochladen (WI-0220 Schnitt 3): Anlegen schreibt ein Ereignis; die Stücke danach keines (Datenstücke).
            "POST /api/admin/system/kartenserien/uploads": async () => {
                await kartenupload("waechterneu");
            },
            "POST /api/admin/system/kartenserien/uploads/:id/abschluss": async () => {
                await post(`/api/admin/system/kartenserien/uploads/${fertigerUpload}/abschluss`, {
                    operationId: randomUUID(),
                });
            },
            // Übernahme nach Production (WI-0220 Schnitt 4): Einreihen auf der Stage, ein Ereignis.
            "POST /api/admin/system/kartenserien/production": async () => {
                await kartenfassung();
                await post("/api/admin/system/kartenserien/production", { operationId: randomUUID(), id: "original" });
            },
            // Zoombänder (WI-0221): ein Übernehmen mit einer Spanne.
            "POST /api/admin/system/zoombaender": async () => {
                await post("/api/admin/system/zoombaender", {
                    operationId: randomUUID(),
                    baseRevision: await zoombandRevision(),
                    aenderungen: [{ id: "orte.dorf.name", spanne: { von: 3, bis: 8 } }],
                });
            },
            // Wettermodell (WI-0288): ein Wert verstellt, ein Ereignis; `resetState` räumt die Zeile weg.
            "POST /api/admin/system/wettermodell": async () => {
                await post("/api/admin/system/wettermodell", {
                    operationId: randomUUID(),
                    baseRevision: await wettermodellRevision(),
                    id: "conf",
                    value: 2,
                });
            },
            // Freigeben (WI-0153 Schnitt 6): Erst muss etwas anstehen, sonst antwortet die Route 409 `nothing_to_apply`.
            // Das Verstellen davor schreibt sein eigenes Ereignis anderer Art; gezaehlt wird hier nur die Freigabe.
            "POST /api/admin/system/wegfindung/freigeben": async () => {
                await post("/api/admin/system/wegfindung", {
                    operationId: randomUUID(),
                    baseRevision: await wegfindungRevision(),
                    id: "endSnap",
                    value: 0.031,
                });
                await post("/api/admin/system/wegfindung/freigeben", {
                    operationId: randomUUID(),
                    baseRevision: await wegfindungRevision(),
                });
            },
            "POST /api/admin/system/hoehenmodell/abnehmen": async () => {
                await post("/api/admin/system/hoehenmodell/abnehmen", {
                    operationId: randomUUID(),
                    version: 18,
                    reason: "Wächter SYS-13",
                });
            },
            "POST /api/admin/system/hoehenmodell/entwurf": async () => {
                await post("/api/admin/system/hoehenmodell/entwurf", {
                    operationId: randomUUID(),
                    basis: 18,
                    aenderungen: { saturation: 12 },
                    reason: "Wächter SYS-13",
                });
            },
            "POST /api/admin/system/hoehenmodell/entwurf/messen": async () => {
                await post("/api/admin/system/hoehenmodell/entwurf/messen", {
                    operationId: randomUUID(),
                    draft: await lastDraft(),
                });
            },
            "POST /api/admin/system/hoehenmodell/entwurf/verwerfen": async () => {
                await post("/api/admin/system/hoehenmodell/entwurf/verwerfen", {
                    operationId: randomUUID(),
                    draft: await lastDraft(),
                });
            },
            // „19 (Test)“ (WI-0240): die Werte gegen die geltende Revision setzen.
            "POST /api/admin/system/hoehenmodell/test": async () => {
                const [row] = await database<{ revision: number }[]>`
                    SELECT revision FROM terrain_recipe_test WHERE version = 19
                `;
                await post("/api/admin/system/hoehenmodell/test", {
                    operationId: randomUUID(),
                    baseRevision: row?.revision ?? 0,
                    werte: { regler: { continentalHeight: 311 + (row?.revision ?? 0) } },
                    reason: "Wächter WI-0240",
                });
            },
            "POST /api/admin/system/news": async () => {
                await post("/api/admin/system/news", {
                    operationId: randomUUID(),
                    datum: "2026-10-14",
                    titel: "Wächter SYS-15",
                    text: "Ein Eintrag des Wächters.",
                    rubrik: "karte",
                });
            },
            "POST /api/admin/system/news/:id": async () => {
                await post(`/api/admin/system/news/${String(await lastNews())}`, {
                    operationId: randomUUID(),
                    zustand: "versteckt",
                });
            },
            "POST /api/admin/system/discord/routine": async () => {
                await post("/api/admin/system/discord/routine", { operationId: randomUUID(), aktiv: true });
            },
            // Die Einstellungen (WI-0255): ohne Kanal im Satz gibt es keine Prüfung bei Discord, also auch kein Netz; die Uhrzeit ändert sich, damit etwas zu protokollieren ist.
            "POST /api/admin/system/discord/einstellungen": async () => {
                await post("/api/admin/system/discord/einstellungen", {
                    operationId: randomUUID(),
                    prompt: "Knapp und freundlich.",
                    uhrzeit: "10:30",
                    berichtsKanal: null,
                });
            },
            // Das Panel Mailpostfach (WI-0268 C6c): Der Versand steht ab Werk an, also ändert das Ausschalten etwas.
            "POST /api/admin/system/mail/routine": async () => {
                await post("/api/admin/system/mail/routine", {
                    operationId: randomUUID(),
                    art: "versand",
                    aktiv: false,
                });
            },
            // Eine heutige, fehlgeschlagene Zustellung; das gestellte `fetch` scheitert, die Zeile bleibt unklar — das Ereignis steht davor.
            "POST /api/admin/system/discord/zustellungen/:id/wiederholen": async () => {
                const tag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
                const [zeile] = await database<{ id: number }[]>`
                    INSERT INTO public.discord_zustellung
                        (berichtstag, kanal, kanal_art, status, nonce, inhalt, text, fakten, ausgeloest, versuche)
                    VALUES (${tag}::date, ${DISCORD_KANAL}, 'bericht', 'fehlgeschlagen', 'w1', '{"content":"x"}'::jsonb, 'x', '{}'::jsonb,
                            'zeitplan', 1)
                    RETURNING id::int AS id
                `;
                await post(`/api/admin/system/discord/zustellungen/${String(zeile!.id)}/wiederholen`, {
                    operationId: randomUUID(),
                });
            },
            // 🪤 Beide Wege legen einen Vorgang im Kanal an, und `kanal_freigabe_anlegen` lässt je Umgebung nur EINE offene
            //    Freigabe zu (Migration 0124). Der zweite Weg käme sonst nie bis zu seinem Ereignis — also wird der Vorgang
            //    des ersten davor weggeräumt.
            "POST /api/admin/system/production/release": async () => {
                await freigabenWeg();
                await post("/api/admin/system/production/release", {
                    operationId: randomUUID(),
                    commit: FREIGABE_DATEI.stage.commit.slice(0, 7),
                });
            },
            "POST /api/admin/system/production/rollback": async () => {
                await freigabenWeg();
                await post("/api/admin/system/production/rollback", { operationId: randomUUID() });
            },
            // Eine Nacht-Freigabe abbrechen (WI-0234): erst eine anlegen, wie die Route es mit `nachts` täte.
            "POST /api/admin/system/production/abbrechen": async () => {
                await freigabenWeg();
                const [person] = await database<{ id: string }[]>`
                    SELECT id::text FROM avesmaps_auth.person WHERE display_name = 'Wächterin' ORDER BY created_at DESC LIMIT 1
                `;
                const [vorgang] = await database<{ id: string }[]>`
                    SELECT avesmaps_kanal.kanal_freigabe_anlegen(
                        ${randomUUID()}::uuid, 'test', ${person!.id}::uuid, 'nacht', 'Für Production freigegeben: waechter',
                        'Stand abcdef1 wird jetzt vollständig geprüft; ist die Prüfung grün, geht er im nächsten Nachtfenster (04:30–07:00) nach Production.'
                    )::text AS id
                `;
                await post("/api/admin/system/production/abbrechen", {
                    operationId: randomUUID(),
                    ops: `OPS-${vorgang!.id.padStart(6, "0")}`,
                });
            },
            // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L): Starten und Abbrechen gegen den Ersatz-Starter, je ein Ereignis.
            "POST /api/admin/system/release-test/starten": async () => {
                await post("/api/admin/system/release-test/starten", {
                    operationId: randomUUID(),
                    commit: "a".repeat(40),
                });
            },
            "POST /api/admin/system/release-test/abbrechen": async () => {
                await post("/api/admin/system/release-test/abbrechen", {
                    operationId: randomUUID(),
                    commit: "a".repeat(40),
                });
            },
            // Der Abzug für lokal (WI-0251): Erstellen reiht einen Auftrag ein, der Link entsteht für einen abgelegten Abzug, der Eingang nimmt
            // die Datei an, und Einspielen startet (hier den Ersatz) für genau diese Datei. Je Handlung ein Ereignis ihrer Art.
            "POST /api/admin/system/abzug/erstellen": async () => {
                await database`DELETE FROM job WHERE kind = 'abzug_lokal'`;
                await post("/api/admin/system/abzug/erstellen", { operationId: randomUUID() });
            },
            "POST /api/admin/system/abzug/link": async () => {
                await post("/api/admin/system/abzug/link", { operationId: randomUUID(), kennung: ABZUG_WAECHTER });
            },
            "PUT /api/admin/system/abzug/eingang": async () => {
                const response = await app.inject({
                    method: "PUT",
                    url: `/api/admin/system/abzug/eingang?name=waechter.tar&operationId=${randomUUID()}`,
                    payload: abzugBytes,
                    headers: { origin: TEST_ORIGIN, cookie, "content-type": "application/x-tar" },
                });
                expect(response.statusCode, response.body).toBe(200);
            },
            "POST /api/admin/system/abzug/einspielen": async () => {
                await post("/api/admin/system/abzug/einspielen", {
                    operationId: randomUUID(),
                    kennung: ABZUG_WAECHTER,
                });
            },
            // Den Abzug selbst abholen (WI-0251): Schlüssel anlegen und widerrufen (Stage), lokal einen Schlüssel hinterlegen und holen (die Quelle ist
            // hier eine, die nicht antwortet: Das Ereignis steht beim Auslösen, der Lauf im Hintergrund scheitert und verändert nichts).
            "POST /api/admin/system/abzug/schluessel": async () => {
                await post("/api/admin/system/abzug/schluessel", { operationId: randomUUID(), tage: 30 });
            },
            "POST /api/admin/system/abzug/schluessel/widerrufen": async () => {
                const [zeile] = await database<{ id: string }[]>`
                    SELECT id::text AS id FROM avesmaps_auth.abzug_schluessel WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`;
                await post("/api/admin/system/abzug/schluessel/widerrufen", {
                    operationId: randomUUID(),
                    id: zeile!.id,
                });
            },
            "POST /api/admin/system/abzug/quelle": async () => {
                await post("/api/admin/system/abzug/quelle", {
                    operationId: randomUUID(),
                    quelle: "staging",
                    schluessel: neuerSchluessel(),
                });
            },
            "POST /api/admin/system/abzug/holen": async () => {
                // Das Einspielen davor (Ersatz) läuft im Hintergrund: abwarten, bis der Dienst wieder frei ist.
                await new Promise((fertig) => setTimeout(fertig, 150));
                await post("/api/admin/system/abzug/holen", { operationId: randomUUID(), quelle: "staging" });
                await new Promise((fertig) => setTimeout(fertig, 150));
            },
        };
        for (const [route, handlung] of Object.entries(routes)) {
            await genauEins(SYSTEM_ROUTE_EVENTS[route as keyof typeof SYSTEM_ROUTE_EVENTS], handlung);
        }
        await resetState();
        delete process.env["MAP_SOURCES_ROOT"];
    });

    /** Die Eingabe der Übernahme, wie der Korridor sie dem Befehl gibt (WI-0220 Schnitt 4), für die Serie „original“. */
    const uebernahmeDatei = async (): Promise<string> => {
        const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === "original")!;
        const eingabe: KartenserieUebernahme = {
            serie: "original",
            revision: await kartenfassung(),
            quelle: null,
            einstellungen: {
                label: vorgabe.label,
                description: vorgabe.description,
                visibility: vorgabe.visibility,
                labelsInImage: vorgabe.labelsInImage,
                sortOrder: 10,
                thumb: null,
                author: vorgabe.author,
                origin: vorgabe.origin,
                derivation: vorgabe.derivation,
                permissionStatement: vorgabe.permission.statement,
                attribution: vorgabe.attribution,
                en: { ...vorgabe.en },
                sourcePixels: vorgabe.sourcePixels,
                maxNativeZoom: vorgabe.maxNativeZoom,
                istVorgabe: false,
            },
        };
        const datei = join(requests, "uebernahme.json");
        await writeFile(datei, JSON.stringify(eingabe), "utf8");
        return datei;
    };

    it("🔴 jeder Befehl der Kommandozeile: genau ein Ereignis", async () => {
        const befehle: [keyof typeof SYSTEM_COMMAND_EVENTS, string[]][] = [
            ["betrieb-einschraenken", ["betrieb-einschraenken", "--grund", "Wächter SYS-15"]],
            ["betrieb-normal", ["betrieb-normal"]],
            ["sperre-setzen", ["sperre-setzen", "--art", "karte", "--grund", "Wächter SYS-15"]],
            ["sperre-loesen", ["sperre-loesen", "--art", "karte"]],
            ["warteschlange-pausieren", ["warteschlange-pausieren", "--grund", "Wächter SYS-15"]],
            ["warteschlange-fort", ["warteschlange-fort"]],
            ["abgleich-starten", ["abgleich-starten", "--quelle", "legacy"]],
            ["gelaende-waehlen", ["gelaende-waehlen", "--fassung", "17", "--grund", "Wächter SYS-13"]],
            ["kartenserie-uebernehmen", ["kartenserie-uebernehmen", "--eingabe", await uebernahmeDatei()]],
        ];
        expect(befehle.map(([name]) => name).sort()).toEqual(Object.keys(SYSTEM_COMMAND_EVENTS).sort());
        for (const [name, argv] of befehle) await genauEins(SYSTEM_COMMAND_EVENTS[name], () => cli(argv));
        await resetState();
    });

    it("ein Protokoll, zwei Filter: bereich=system zeigt nur System-Ereignisse, bereich=konten keine (SYS-0001 §9d.2)", async () => {
        const lesen = async (bereich: string): Promise<string[]> => {
            const response = await app.inject({
                method: "GET",
                url: `/api/admin/audit?bereich=${bereich}&limit=200`,
                headers: { cookie },
            });
            expect(response.statusCode).toBe(200);
            return (response.json() as { events: { action: string }[] }).events.map((event) => event.action);
        };
        const system = await lesen("system");
        expect(system).toContain("system.sync_requested");
        expect(system.filter((action) => AUDIT_BEREICH[action as AuditAction] !== "system")).toEqual([]);
        const konten = await lesen("konten");
        expect(konten.filter((action) => AUDIT_BEREICH[action as AuditAction] !== "konten")).toEqual([]);
        const falsch = await app.inject({ method: "GET", url: "/api/admin/audit?bereich=alles", headers: { cookie } });
        expect(falsch.statusCode).toBe(400);
    });
});
