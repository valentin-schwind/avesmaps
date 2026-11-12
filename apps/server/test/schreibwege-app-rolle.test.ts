import { readdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { WRITE_METHODS } from "../src/system/write-guard.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";
import { DISCORD_TEST_ANWENDUNG, DISCORD_TEST_SCHLUESSEL } from "./support/discord-signatur.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { GEBIETE_KRAFTLINIEN } from "./support/schreibwege/gebiete-kraftlinien.ts";
import { INHALTE } from "./support/schreibwege/inhalte.ts";
import { KARTE_UND_KANAL } from "./support/schreibwege/karte-kanal.ts";
import { KARTEN } from "./support/schreibwege/karten.ts";
import { LANDSCHAFTEN } from "./support/schreibwege/landschaften.ts";
import { KONTEN } from "./support/schreibwege/konten.ts";
import { MEDIEN } from "./support/schreibwege/medien.ts";
import { SPRACHEN_FAELLE } from "./support/schreibwege/sprachen.ts";
import { SYSTEM } from "./support/schreibwege/system.ts";
import { WIKI_BOX } from "./support/schreibwege/wiki-box.ts";
import { WIKISYNC } from "./support/schreibwege/wikisync.ts";
import { WETTER } from "./support/schreibwege/wetter.ts";
import { FREIGABE_DATEI, welt as baueWelt, type Faelle, type Welt } from "./support/schreibwege/welt.ts";
import { DISCORD_BERICHT, RELEASE_TEST_ZUSTAND } from "./support/schreibwege/system.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Rauchtest der Schreibwege als App-Rolle (WI-0189 Etappe 2a; Review O2-01 mit L6-02): Lokal laufen Entwicklung und Servertests als
 * Besitzer der Datenbank, auf dem VPS läuft Fastify als App-Rolle. Rechtefehler (`SELECT … FOR UPDATE` ohne UPDATE-Recht, INSERT in ein
 * fremdes Schema) zeigten sich deshalb erst auf Stage oder in Production. Hier ruft Fastify jeden Schreibweg (jede Route mit
 * `config.writeClass`, `system/write-guard.ts`) einmal auf einem Wegwerf-Cluster mit den Rollen des VPS, dem Rechtewerkzeug und ALLEN
 * Vorlagen unter `src/db/*.psql`, angemeldet als App-Rolle (Muster `abgleiche-routes.test.ts`).
 *
 * - Je Route ein Fall mit eigener Vorbereitung (`support/schreibwege/`); der erwartete Status zeigt, dass der Aufruf bis in die Datenbank
 *   kam (meist 200). Ein fachliches 4xx wäre kein Rechtefehler, aber dann prüfte der Fall nichts mehr.
 * - 🔴 Daneben liest der Test das Protokoll des Servers: Jeder Fehler 42501 der App-Rolle während des Falls macht ihn rot, auch einer, den
 *   die Anwendung abfängt und als 503 „noch nicht eingerichtet“ oder als fachlichen Fehler meldet.
 * - Eine Route ohne Fall erscheint als „todo“ (meldet, hält nichts an); ein Fall ohne Route macht den Tafeltest rot.
 * - Gefundene, noch offene Rechtefehler stehen in `BEFUNDE` und laufen als erwarteter Fehlschlag mit, bis ihr Fix da ist.
 * - Die Werkstatt „19 (Test)“ schreibt nur in eine offene Fassung; seit der Abnahme von 19 (2026-11-07) gibt es keine. Der Fall prüft ihren
 *   Schreibweg darum an einer gedachten offenen 19 (`support/offene-fassung.ts`).
 */
vi.mock("../src/terrain/domain/recipes.ts", async (importOriginal) =>
    (await import("./support/offene-fassung.ts")).mitOffenerFassung19(await importOriginal()),
);

const ENV = "schreibwege";
/**
 * Mit `SCHREIBWEGE_DUMP` (der `daten.dump` des Testpakets, WI-0264 S2) läuft der Test auf echten Daten: Der Dump kommt vor den Migrationen
 * des Kandidaten in den Cluster (`startVpsCluster`, Option `dump`). Ohne die Variable bleibt es die leere Datenbank wie bisher.
 */
const DUMP = process.env["SCHREIBWEGE_DUMP"]?.trim() || undefined;
/** Der Anlauf des Clusters: leer unter einer Minute, mit Dump rechnet das Einspielen von rund 1 GB mit (Zeitgrenze des Teils `daten`). */
const ANLAUF_MS = DUMP === undefined ? 180_000 : 1_500_000;
const describeWithCluster = postgresBin ? describe : describe.skip;
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const FAELLE: Faelle = {
    ...KONTEN,
    ...MEDIEN,
    ...KARTE_UND_KANAL,
    ...KARTEN,
    ...LANDSCHAFTEN,
    ...GEBIETE_KRAFTLINIEN,
    ...INHALTE,
    ...SPRACHEN_FAELLE,
    ...SYSTEM,
    ...WIKISYNC,
    ...WIKI_BOX,
    ...WETTER,
};
const SILENT = { write: () => undefined };

/** Alle Schreibwege, wie Fastify sie anmeldet (ohne Datenbank, wie `system-write-classes.test.ts`). */
async function schreibwege(): Promise<string[]> {
    const app = buildApp({
        config: {
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            // Die Routen des Release-Tests gibt es nur lokal (WI-0248 L); die Aufzählung der Schreibwege nimmt die Konfiguration, die sie anmeldet.
            releaseTest: { starter: undefined },
            // Der Abzug für lokal (WI-0251): auf dem VPS erstellen Stage und Production; die Routen zum Einspielen gibt es dort nicht.
            abzug: { rollen: ["erstellen"], quelle: "staging", wurzel: undefined },
        },
        logStream: SILENT,
    });
    const found: string[] = [];
    app.addHook("onRoute", (options) => {
        const methods = Array.isArray(options.method) ? options.method : [options.method];
        for (const method of methods) if (WRITE_METHODS.has(method)) found.push(`${method} ${options.url}`);
    });
    await app.ready();
    await app.close();
    return found.sort();
}

const ROUTEN = await schreibwege();

/**
 * Rechtefehler, die dieser Test gefunden hat und die noch offen sind (WI-0189 §3, 2026-10-16). Der Fall läuft als `it.fails`: grün,
 * solange der Fehler besteht, rot, sobald ihn jemand behebt; dann gehört seine Zeile hier weg. Neue Einträge nur mit Fundstelle.
 */
const BEFUNDE: Readonly<Record<string, string>> = {};

/** Die Rechtefehler im Protokoll des Servers ab `ab` (Byte): die Fehlerzeile und die Anweisung dahinter. */
function rechtefehler(logFile: string, ab: number): { bis: number; fehler: string[] } {
    const text = readFileSync(logFile).subarray(ab).toString("utf8");
    const zeilen = text.split(/\r?\n/u);
    const fehler: string[] = [];
    zeilen.forEach((zeile, index) => {
        if (!/ERROR:\s+(?:42501:\s+)?(?:permission denied|must be owner)/u.test(zeile)) return;
        // Die Anweisung folgt als STATEMENT, oft über mehrere Zeilen ohne Präfix (die Abfragen beginnen mit einem Zeilenumbruch).
        const start = zeilen.findIndex((folgende, j) => j > index && j < index + 12 && folgende.includes("STATEMENT:"));
        const anweisung: string[] = [];
        if (start > 0) {
            anweisung.push(zeilen[start]!.replace(/^.*?STATEMENT:/u, ""));
            for (const folgende of zeilen.slice(start + 1)) {
                if (/^\d{4}-\d{2}-\d{2} /u.test(folgende)) break;
                anweisung.push(folgende);
            }
        }
        const sql = anweisung.join(" ").replace(/\s+/gu, " ").trim().slice(0, 160);
        fehler.push(`${zeile.replace(/^.*?ERROR:\s+/u, "")}${sql === "" ? "" : ` · ${sql}`}`);
    });
    return { bis: ab + Buffer.byteLength(text), fehler };
}

describe("Rauchtest der Schreibwege: die Tafel (ohne Datenbank)", () => {
    it("jeder Fall und jeder Befund gehört zu einem Schreibweg, den es gibt", () => {
        expect(ROUTEN.length).toBeGreaterThanOrEqual(100);
        expect(Object.keys(FAELLE).filter((key) => !ROUTEN.includes(key))).toEqual([]);
        expect(Object.keys(BEFUNDE).filter((key) => FAELLE[key] === undefined)).toEqual([]);
    });
});

describeWithCluster(
    "Rauchtest der Schreibwege als App-Rolle (Wegwerf-Cluster mit allen Vorlagen)",
    { timeout: 60_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let app: FastifyInstance | undefined;
        let ordner: string;
        let welt: Welt;
        let gelesen = 0;

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, VORLAGEN, {
                mapDomains: true,
                ...(DUMP === undefined ? {} : { dump: DUMP }),
            });
            // Mit SQLSTATE im Protokoll; gilt für jede Sitzung der App-Rolle, die danach beginnt (der Pool hat noch keine).
            await cluster.admin.unsafe(`ALTER ROLE ${cluster.roles.app} SET log_error_verbosity = 'verbose'`);
            ordner = await mkdtemp(join(tmpdir(), "avesmaps3d-schreibwege-"));
            const freigabe = join(ordner, "freigabe.json");
            await writeFile(freigabe, JSON.stringify(FREIGABE_DATEI), "utf8");
            // Der Ersatz für den Starter des Release-Tests (WI-0248 L): antwortet aus `zustand.json` und startet nie einen echten Test.
            const starterOrdner = join(ordner, "release-test");
            await mkdir(starterOrdner);
            await copyFile(
                fileURLToPath(new URL("./support/release-test-starter.mjs", import.meta.url)),
                join(starterOrdner, "starter.mjs"),
            );
            await writeFile(join(starterOrdner, "zustand.json"), JSON.stringify(RELEASE_TEST_ZUSTAND), "utf8");
            const config: ServerConfig = {
                port: 0,
                host: "127.0.0.1",
                releaseId: "wi-0189-rauchtest",
                databaseUrl: undefined,
                tileRoot: undefined,
                statusPage: true,
                auth: TEST_AUTH,
                mapEditing: "testwelt",
                mediaRoot: join(ordner, "medien"),
                abgleiche: "worker",
                backup: { statusFile: undefined, requestDir: join(ordner, "sicherung") },
                freigabe: { statusFile: freigabe },
                // 🔴 `ausgabe` gehört in den Wegwerfordner: Ohne sie schriebe der abgelöste Ersatz-Starter `starter-<sha12>.log` in die echte
                // Datenwurzel (`C:/avesmaps3d-data/release-abholer`, 2026-10-24: `starter-aaaaaaaaaaaa.log` aus dem Rauchtest).
                releaseTest: { starter: join(starterOrdner, "starter.mjs"), ausgabe: join(starterOrdner, "ausgabe") },
                abzug: { rollen: ["erstellen"], quelle: "staging", wurzel: join(ordner, "abzug") },
                besucher: { salt: "rauchtest-salz" },
                // Die Discord-Befehle (WI-0255 Paket 2): eingeschaltet mit dem Schlüssel des Tests, damit die Fälle bis in den Kanal kommen.
                discordInteraktionen: { schluessel: DISCORD_TEST_SCHLUESSEL, anwendung: DISCORD_TEST_ANWENDUNG },
                // Der Tagesbericht (WI-0255): die Konfiguration der Stage, die allein sendet, mit gestelltem Discord; so kommt das Wiederholen
                // bis in die Datenbank und den Versand, ohne je eine echte Nachricht.
                discord: DISCORD_BERICHT,
            };
            app = buildApp({
                config,
                database: cluster.app,
                logStream: SILENT,
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
                stichprobe: { start: () => undefined, close: () => undefined },
            });
            await app.ready();
            welt = baueWelt(cluster, app, authFixture(cluster.admin), ordner);
            gelesen = statSync(cluster.logFile).size;
        }, ANLAUF_MS);

        /** Nach jedem Fall: Betrieb normal und offen, keine Pause, offene Aufträge abgebrochen; so stört kein Fall den nächsten. */
        afterEach(async () => {
            if (cluster === undefined) return;
            await cluster.admin`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL,
                   queue_paused = false, queue_paused_since = NULL, queue_paused_by = NULL, queue_paused_by_label = NULL,
                   queue_paused_reason = NULL
             WHERE id = 1
        `;
            await cluster.admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
            // Das Höhenmodell zurück auf die Vorgabe der Datei: Sonst wählte der nächste Fall eine Fassung, die schon gilt.
            await cluster.admin`DELETE FROM terrain_recipe_choice`;
            await app?.systemState?.refresh();
        });

        afterAll(async () => {
            await app?.close();
            await cluster?.stop();
            if (ordner !== undefined) await rm(ordner, { recursive: true, force: true });
        }, 60_000);

        it("🔴 Gegenprobe: die Erkennung sieht einen Rechtefehler der App-Rolle im Protokoll", async () => {
            expect(await cluster!.codesAs(cluster!.app, ["DELETE FROM avesmaps_auth.person WHERE false"])).toEqual([
                "42501",
            ]);
            const { bis, fehler } = rechtefehler(cluster!.logFile, gelesen);
            gelesen = bis;
            expect(fehler).toEqual([
                "42501: permission denied for table person · DELETE FROM avesmaps_auth.person WHERE false",
            ]);
        });

        for (const route of ROUTEN) {
            const fall = FAELLE[route];
            if (fall === undefined) {
                it.todo(`${route}: noch ohne Fall`);
                continue;
            }
            const befund = BEFUNDE[route];
            (befund === undefined ? it : it.fails)(
                befund === undefined ? route : `${route} · BEFUND offen: ${befund}`,
                async () => {
                    let antwort: Awaited<ReturnType<typeof fall.rufe>> | undefined;
                    let abbruch: unknown;
                    try {
                        antwort = await fall.rufe(welt);
                    } catch (error) {
                        abbruch = error;
                    }
                    // Auch wenn die Vorbereitung scheitert: Was dabei ins Protokoll kam, gehört zu diesem Fall, nicht zum nächsten.
                    const { bis, fehler } = rechtefehler(cluster!.logFile, gelesen);
                    gelesen = bis;
                    expect(fehler, "Rechtefehler der App-Rolle").toEqual([]);
                    if (abbruch !== undefined) throw abbruch;
                    expect(antwort!.statusCode, antwort!.body.slice(0, 500)).toBe(fall.erwartet);
                },
            );
        }
    },
);
