import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ABZUG_HOLEN_URL,
    ABZUG_SCHLUESSEL_HOECHSTENS,
    ABZUG_URL,
    type AbzugDatei,
    type AbzugHolenListe,
    type AbzugQuelle,
    type AbzugSchluesselNeu,
    type AbzugSicht,
    type AbzugSichtEinspielen,
    type AbzugSichtErstellen,
    type Role,
} from "@avesmaps3d/shared";
import { HolenFehler, erzeugeSchluesselSpeicher, holeAbzug } from "../src/abzug/holen.ts";
import { leseKatalog } from "../src/abzug/katalog.ts";
import { baueAbzugPlan } from "../src/abzug/plan.ts";
import { ladeRegeln } from "../src/abzug/regeln.ts";
import { neuerSchluessel, schluesselAusKopf } from "../src/abzug/schluessel.ts";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { leseBereich } from "../src/routes/abzug-holen.ts";
import { schreibeAbzug } from "./support/abzug-export.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Den Abzug selbst abholen (WI-0251; Vali 2026-10-25: „ich will keine dateien runter und wieder hochladen“):
 *
 * - **Ohne Datenbank:** der Bereich einer `Range`-Zeile, der Schlüsselspeicher (nur Booleans nach außen, nichts in einer Ausgabe), und das Laden mit
 *   Fortsetzen gegen eine Attrappe der Quelle: Abbruch mitten in der Datei, Quelle ohne `Range`, abgelaufener Schlüssel, leere Liste, zu wenig Platz.
 * - **Wegwerf-Cluster:** Der Schlüssel (Admin mit Passkey, nur der Hash in der Datenbank, einmal zu sehen, Ablauf, Widerruf, Höchstzahl, Konto gesperrt,
 *   falsche Umgebung) darf genau die Liste und die Datei; mit `Range` setzt das Herunterladen fort, ein Fortsetzen schreibt kein zweites Ereignis.
 *   Danach der ganze Weg lokal: Schlüssel hinterlegen, „holen“ gegen die echte Stage-Instanz über HTTP, das ECHTE Einspielen in die Wegwerf-Datenbank,
 *   danach ist die Datei gelöscht und der Schlüssel in keiner Antwort.
 */

const ENV = "abzugholen";
const grants = [
    fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url)),
    fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url)),
    fileURLToPath(new URL("../src/db/jobs-grants.psql", import.meta.url)),
];
const describeWithCluster = postgresBin ? describe : describe.skip;

const code = (response: { statusCode: number; json(): unknown }): string =>
    response.statusCode < 300
        ? String(response.statusCode)
        : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

// --- Ohne Datenbank ----------------------------------------------------------------------------------------------------------------------------

describe("Abzug holen: Bereiche, Schlüssel und Kopfzeile", () => {
    it("liest genau einen Bereich `bytes=N-` oder `bytes=N-M`; alles andere ist 416 oder keine Zeile", () => {
        expect(leseBereich(undefined, 100)).toBeUndefined();
        expect(leseBereich("bytes=10-", 100)).toEqual({ start: 10, ende: 99 });
        expect(leseBereich("bytes=10-20", 100)).toEqual({ start: 10, ende: 20 });
        expect(leseBereich("bytes=10-500", 100)).toEqual({ start: 10, ende: 99 });
        expect(leseBereich("bytes=0-", 100)).toEqual({ start: 0, ende: 99 });
        for (const falsch of ["bytes=100-", "bytes=-5", "bytes=0-1,5-6", "items=1-2", "bytes=20-10", "bytes=a-"]) {
            expect(leseBereich(falsch, 100), falsch).toBeNull();
        }
    });

    it("nimmt den Schlüssel nur aus `Authorization: Bearer …` und erzeugt ihn in der festen Form", () => {
        const schluessel = neuerSchluessel();
        expect(schluessel).toMatch(/^abz_[A-Za-z0-9_-]{43}$/u);
        expect(neuerSchluessel()).not.toBe(schluessel);
        expect(schluesselAusKopf(`Bearer ${schluessel}`)).toBe(schluessel);
        expect(schluesselAusKopf(schluessel)).toBeUndefined();
        expect(schluesselAusKopf("Basic abc")).toBeUndefined();
        expect(schluesselAusKopf(undefined)).toBeUndefined();
    });
});

describe("Abzug holen: der Schlüsselspeicher lokal", () => {
    it("🔴 hinterlegt, entfernt und meldet nach außen nur, FÜR WELCHE Quelle einer da ist", () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-schluessel-"));
        try {
            const speicher = erzeugeSchluesselSpeicher(ordner, () => undefined);
            expect(speicher.gesetzt()).toEqual({ staging: false, production: false });
            const stage = neuerSchluessel();
            const produktion = neuerSchluessel();
            speicher.setze("staging", stage);
            speicher.setze("production", produktion);
            expect(speicher.lies("staging")).toBe(stage);
            expect(speicher.gesetzt()).toEqual({ staging: true, production: true });
            // Nach außen steht kein Wert.
            expect(JSON.stringify(speicher.gesetzt())).not.toContain(stage);
            // Ein neuer Speicher auf derselben Datei sieht dasselbe (der Server startet bei jeder Änderung neu).
            expect(erzeugeSchluesselSpeicher(ordner, () => undefined).lies("production")).toBe(produktion);
            speicher.setze("staging", null);
            expect(speicher.gesetzt()).toEqual({ staging: false, production: true });
            expect(speicher.lies("staging")).toBeUndefined();
            // Eine Datei mit Unsinn zählt nicht.
            rmSync(join(ordner, "schluessel.json"));
            mkdirSync(ordner, { recursive: true });
            expect(erzeugeSchluesselSpeicher(ordner, () => undefined).gesetzt()).toEqual({
                staging: false,
                production: false,
            });
            expect(readdirSync(ordner).filter((name) => name.endsWith(".neu"))).toEqual([]);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

/** Eine Attrappe der Quelle: Liste und Datei mit `Range`; `bruchBei` lässt das erste Laden nach so vielen Bytes abreißen. */
function quellenAttrappe(
    inhalt: Buffer,
    optionen: {
        quelle?: AbzugQuelle;
        liste?: AbzugDatei[];
        bruchBei?: number;
        ohneRange?: boolean;
        status?: number;
        code?: string;
    } = {},
) {
    const datei: AbzugDatei = {
        kennung: "20261025T090000Z-attrappe",
        erstellt: "2026-10-25T09:00:00.000Z",
        bytes: inhalt.length,
        tafeln: 143,
        zeilen: 1,
        medien: 0,
        medienBytes: 0,
        laeuftAb: "2026-10-26T09:00:00.000Z",
    };
    const anfragen: { url: string; range: string | null; authorization: string | null }[] = [];
    let abgerissen = false;
    const holen = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const adresse = String(url);
        const kopf = new Headers(init?.headers);
        anfragen.push({ url: adresse, range: kopf.get("range"), authorization: kopf.get("authorization") });
        if (optionen.status !== undefined) {
            return new Response(JSON.stringify({ error: { code: optionen.code ?? "x", message: "m" } }), {
                status: optionen.status,
                headers: { "content-type": "application/json" },
            });
        }
        if (adresse.endsWith("/liste")) {
            const body: AbzugHolenListe = {
                umgebung: optionen.quelle ?? "staging",
                jetzt: "2026-10-25T09:05:00.000Z",
                abzuege: optionen.liste ?? [datei],
            };
            return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        }
        const range = optionen.ohneRange === true ? null : kopf.get("range");
        const start = range === null ? 0 : Number(/^bytes=(\d+)-$/u.exec(range)![1]);
        const rest = inhalt.subarray(start);
        const reisstAb = optionen.bruchBei !== undefined && !abgerissen;
        const stueck = reisstAb ? rest.subarray(0, optionen.bruchBei) : rest;
        if (reisstAb) abgerissen = true;
        let gesendet = 0;
        const strom = new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (gesendet >= stueck.length) {
                    // Eine Leitung, die reißt, hat das Vorherige meist schon abgegeben: erst die Platte, dann der Fehler.
                    if (reisstAb) {
                        await new Promise((fertig) => setTimeout(fertig, 40));
                        controller.error(new Error("Verbindung abgebrochen"));
                    } else controller.close();
                    return;
                }
                const ende = Math.min(gesendet + 700, stueck.length);
                controller.enqueue(stueck.subarray(gesendet, ende));
                gesendet = ende;
            },
        });
        return new Response(strom, {
            status: range === null ? 200 : 206,
            headers:
                range === null
                    ? { "content-length": String(inhalt.length) }
                    : {
                          "content-range": `bytes ${String(start)}-${String(inhalt.length - 1)}/${String(inhalt.length)}`,
                      },
        });
    };
    return { holen: holen as typeof fetch, anfragen, datei };
}

describe("Abzug holen: Laden mit Fortsetzen (Attrappe der Quelle)", () => {
    const optionen = (ordner: string, fetchAttrappe: typeof fetch, schluessel = neuerSchluessel()) => ({
        quelle: "staging" as const,
        adresse: "https://stage.test",
        schluessel,
        ordner,
        fetch: fetchAttrappe,
        pauseMs: 0,
        freieBytes: () => 50 * 1024 ** 3,
    });

    it("🔴 setzt nach einem Abbruch mit Range dort fort, wo die Datei endet, und liefert genau die Bytes der Quelle", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(12_345);
            const quelle = quellenAttrappe(inhalt, { bruchBei: 5000 });
            const stand: number[] = [];
            const schluessel = neuerSchluessel();
            const ergebnis = await holeAbzug({
                ...optionen(ordner, quelle.holen, schluessel),
                bericht: ({ geladen }) => stand.push(geladen),
            });
            expect(readFileSync(ergebnis.pfad).equals(inhalt)).toBe(true);
            expect(ergebnis.kennung).toBe("20261025T090000Z-attrappe");
            // Liste, Datei (abgerissen), Datei ab dem Byte, an dem sie endete.
            expect(quelle.anfragen.map((anfrage) => anfrage.range)).toEqual([null, null, "bytes=5000-"]);
            expect(quelle.anfragen.every((anfrage) => anfrage.authorization === `Bearer ${schluessel}`)).toBe(true);
            expect(stand.at(-1)).toBe(inhalt.length);
            expect(Math.max(...stand.slice(0, -1).filter((n) => n < inhalt.length))).toBeGreaterThanOrEqual(5000);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("setzt eine Teil-Datei eines früheren Versuchs fort und löscht die eines anderen Abzugs", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(9000);
            const quelle = quellenAttrappe(inhalt);
            const teil = join(ordner, `holen-staging-${quelle.datei.kennung}.tar.part`);
            const fremd = join(ordner, "holen-staging-20261001T000000Z-alt.tar.part");
            const { writeFileSync } = await import("node:fs");
            writeFileSync(teil, inhalt.subarray(0, 4000));
            writeFileSync(fremd, "alt");
            const ergebnis = await holeAbzug(optionen(ordner, quelle.holen));
            expect(readFileSync(ergebnis.pfad).equals(inhalt)).toBe(true);
            expect(quelle.anfragen.map((anfrage) => anfrage.range)).toEqual([null, "bytes=4000-"]);
            expect(existsSync(fremd)).toBe(false);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 lädt nichts, wenn der neueste Abzug schon vollständig im Eingang liegt, und räumt dessen Teil-Datei", async () => {
        // Vali 2026-10-25: Nach einem gescheiterten Einspielen holte „Abzug holen und einspielen“ dieselben 1,7 GB noch einmal.
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(9000);
            const quelle = quellenAttrappe(inhalt);
            const { writeFileSync } = await import("node:fs");
            const liegt = join(ordner, "aktuell.tar");
            writeFileSync(liegt, inhalt);
            const teil = join(ordner, `holen-staging-${quelle.datei.kennung}.tar.part`);
            writeFileSync(teil, inhalt.subarray(0, 4000));
            const ergebnis = await holeAbzug({
                ...optionen(ordner, quelle.holen),
                liegt: { pfad: liegt, kennung: quelle.datei.kennung, bytes: inhalt.length },
            });
            expect(ergebnis.pfad).toBe(liegt);
            expect(quelle.anfragen).toHaveLength(1);
            expect(existsSync(teil)).toBe(false);
            expect(readFileSync(liegt).equals(inhalt)).toBe(true);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("lädt, wenn im Eingang ein anderer Abzug liegt", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(9000);
            const quelle = quellenAttrappe(inhalt);
            const ergebnis = await holeAbzug({
                ...optionen(ordner, quelle.holen),
                liegt: { pfad: join(ordner, "aktuell.tar"), kennung: "20261001T000000Z-alt", bytes: inhalt.length },
            });
            expect(readFileSync(ergebnis.pfad).equals(inhalt)).toBe(true);
            expect(quelle.anfragen).toHaveLength(2);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("lädt von vorn, wenn die Quelle `Range` übergeht (200 statt 206), und verwirft eine Datei in falscher Größe", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(6000);
            const quelle = quellenAttrappe(inhalt, { bruchBei: 2500, ohneRange: true });
            const ergebnis = await holeAbzug(optionen(ordner, quelle.holen));
            expect(readFileSync(ergebnis.pfad).equals(inhalt)).toBe(true);
            // Die Liste nennt eine andere Größe als die Datei hat: Sie wird nie weitergereicht.
            const falsch = quellenAttrappe(inhalt, { liste: [{ ...quelle.datei, bytes: inhalt.length + 10 }] });
            await expect(holeAbzug(optionen(join(ordner, "zwei"), falsch.holen))).rejects.toThrow(/Größe/u);
            expect(readdirSync(join(ordner, "zwei"))).toEqual([]);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 sagt es klar und in einem Satz ohne Schlüssel: abgelaufen, falsch, kein Abzug, zu wenig Platz", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const inhalt = randomBytes(1000);
            const schluessel = neuerSchluessel();
            const wirf = async (
                fetchAttrappe: typeof fetch,
                extra: { freieBytes?: () => number | undefined } = {},
            ): Promise<HolenFehler> => {
                try {
                    await holeAbzug({ ...optionen(ordner, fetchAttrappe, schluessel), ...extra });
                } catch (error) {
                    return error as HolenFehler;
                }
                throw new Error("hätte werfen müssen");
            };
            const abgelaufen = await wirf(
                quellenAttrappe(inhalt, { status: 401, code: "abzug_schluessel_abgelaufen" }).holen,
            );
            expect(abgelaufen.code).toBe("schluessel_abgelaufen");
            expect(abgelaufen.message).toMatch(/abgelaufen oder widerrufen/u);
            const falsch = await wirf(
                quellenAttrappe(inhalt, { status: 401, code: "abzug_schluessel_ungueltig" }).holen,
            );
            expect(falsch.code).toBe("schluessel_ungueltig");
            expect((await wirf(quellenAttrappe(inhalt, { liste: [] }).holen)).code).toBe("kein_abzug");
            expect((await wirf(quellenAttrappe(inhalt, { status: 503 }).holen)).code).toBe("nicht_bereit");
            const platz = quellenAttrappe(inhalt);
            const zuWenig = await wirf(platz.holen, { freieBytes: () => 10 * 1024 * 1024 });
            expect(zuWenig.code).toBe("platz");
            // Es wurde nur die Liste gefragt, die Datei nie.
            expect(platz.anfragen).toHaveLength(1);
            // Kein Satz nennt den Schlüssel.
            for (const fehler of [abgelaufen, falsch, zuWenig]) expect(fehler.message).not.toContain(schluessel);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 folgt keiner Umleitung (der Schlüssel geht nur an die Adresse der Quelle)", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-holen-"));
        try {
            const gesehen: (string | undefined)[] = [];
            const attrappe = (async (_url: string | URL | Request, init?: RequestInit) => {
                gesehen.push(init?.redirect);
                return new Response("{}", { status: 200 });
            }) as typeof fetch;
            await expect(holeAbzug(optionen(ordner, attrappe))).rejects.toBeInstanceOf(HolenFehler);
            expect(gesehen).toEqual(["error"]);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

// --- Wegwerf-Cluster ---------------------------------------------------------------------------------------------------------------------------

describeWithCluster("Abzug holen: Schlüssel, Lesewege und der ganze Weg lokal (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let wurzel: string;
    let stage: FastifyInstance;
    let produktion: FastifyInstance;
    let lokal: FastifyInstance;
    let basis: string;
    let admin: { cookie: string; id: string };
    let adminAlt: { cookie: string };
    let editor: { cookie: string };
    let operator: { cookie: string };
    let operatorAlt: { cookie: string };
    let tarBytes: Buffer;
    const KENNUNG = "20261025T100000Z-schluessel";

    const config = (): Omit<ServerConfig, "abzug"> => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0251-holen",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    });
    const post = (app: FastifyInstance, url: string, cookie: string, payload: object = {}) =>
        app.inject({
            method: "POST",
            url,
            payload: { operationId: randomUUID(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const get = (app: FastifyInstance, url: string, cookie: string) =>
        app.inject({ method: "GET", url, headers: { cookie } });
    const mitSchluessel = (app: FastifyInstance, url: string, schluessel: string, extra: Record<string, string> = {}) =>
        app.inject({ method: "GET", url, headers: { authorization: `Bearer ${schluessel}`, ...extra } });
    const neu = async (app: FastifyInstance, cookie: string, tage = 90): Promise<AbzugSchluesselNeu> => {
        const antwort = await post(app, `${ABZUG_URL}/schluessel`, cookie, { tage });
        expect(code(antwort)).toBe("200");
        return antwort.json<AbzugSchluesselNeu>();
    };
    const ereignisse = async (aktion: string) =>
        await cluster!.admin<
            { target_ref: string | null; actor_label: string | null; details: Record<string, unknown> }[]
        >`SELECT target_ref, actor_label, details FROM avesmaps_auth.security_event WHERE action = ${aktion} ORDER BY id`;
    const alleSchluessel = async (): Promise<void> => {
        await cluster!.admin`DELETE FROM avesmaps_auth.abzug_schluessel`;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        wurzel = await mkdtemp(join(tmpdir(), "abzugholen-"));
        const stageWurzel = join(wurzel, "stage");
        const katalog = await leseKatalog(cluster.migrator);
        const plan = baueAbzugPlan(katalog, ladeRegeln(), "staging");
        await mkdir(join(stageWurzel, "staging", KENNUNG), { recursive: true });
        const ziel = join(stageWurzel, "staging", KENNUNG, "abzug.tar");
        await schreibeAbzug(cluster.migrator, plan, {
            ziel,
            kennung: KENNUNG,
            quelle: "staging",
            veraendereManifest: (manifest) => ({ ...manifest, erstellt: new Date(Date.now() - 600_000).toISOString() }),
        });
        tarBytes = await readFile(ziel);
        const bauen = (abzug: ServerConfig["abzug"], database: VpsCluster["app"], extra: Partial<ServerConfig> = {}) =>
            buildApp({
                config: { ...config(), databaseUrl: "postgres://ungenutzt@127.0.0.1/ungenutzt", abzug, ...extra },
                database,
                logStream: { write: () => undefined },
                jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            });
        stage = bauen({ rollen: ["erstellen"], quelle: "staging", wurzel: stageWurzel }, cluster.app);
        produktion = bauen({ rollen: ["erstellen"], quelle: "production", wurzel: join(wurzel, "prod") }, cluster.app);
        // Die Stage wirklich auf einem Port: Der lokale Dienst holt über HTTP, wie er es gegen https://stage.avesmaps.de täte.
        await stage.listen({ port: 0, host: "127.0.0.1" });
        const adresse = stage.server.address();
        basis = `http://127.0.0.1:${String(typeof adresse === "object" && adresse !== null ? adresse.port : 0)}`;
        // Lokal: Besitzerin der Tafeln (Entwicklungsrechner) und das ECHTE Einspielen in diese Wegwerf-Datenbank.
        const optionenDb = cluster.migrator.options;
        const databaseUrl = `postgres://${String(optionenDb.user)}@127.0.0.1:${String(optionenDb.port[0])}/${String(optionenDb.database)}`;
        lokal = bauen(
            {
                rollen: ["einspielen"],
                quelle: undefined,
                wurzel: join(wurzel, "lokal"),
                abgleicheVerbergen: true,
                pgDump: postgresBin,
                quellen: { staging: basis },
                pauseMs: 0,
            },
            cluster.migrator,
            { databaseUrl },
        );
        await Promise.all([stage.ready(), produktion.ready(), lokal.ready()]);
        const person = async (role: Role, name: string, passkeyMinutesAgo: number | null = 1) => {
            const angelegt = await fixture.person(role, { name });
            const { cookie } = await fixture.session(angelegt.id, { assurance: "strong", passkeyMinutesAgo });
            return { cookie, id: angelegt.id };
        };
        admin = await person("admin", "Alrike");
        adminAlt = await person("admin", "Alt", 120);
        editor = await person("editor", "Efferdan");
        operator = await person("operator", "Rondrikan");
        operatorAlt = await person("operator", "Rondrikan-Alt", 120);
    }, 240_000);

    afterAll(async () => {
        await Promise.all([stage?.close(), produktion?.close(), lokal?.close()]);
        await cluster?.stop();
        if (wurzel !== undefined) await rm(wurzel, { recursive: true, force: true });
    }, 60_000);

    it("🔴 anlegen: Admin mit frischem Passkey, der Wert steht einmal da, in der Datenbank nur der Hash, im Protokoll nie", async () => {
        await alleSchluessel();
        expect(code(await post(stage, `${ABZUG_URL}/schluessel`, editor.cookie, { tage: 30 }))).toBe("403 forbidden");
        expect(code(await post(stage, `${ABZUG_URL}/schluessel`, adminAlt.cookie, { tage: 30 }))).toBe(
            "403 reauth_required",
        );
        expect(code(await post(stage, `${ABZUG_URL}/schluessel`, admin.cookie, { tage: 7 }))).toBe(
            "400 validation_failed",
        );

        const vorher = (await ereignisse("system.abzug_schluessel")).length;
        const operationId = randomUUID();
        const antwort = await stage.inject({
            method: "POST",
            url: `${ABZUG_URL}/schluessel`,
            payload: { operationId, tage: 90 },
            headers: { origin: TEST_ORIGIN, cookie: admin.cookie },
        });
        expect(code(antwort)).toBe("200");
        expect(antwort.headers["cache-control"]).toBe("no-store");
        const angelegt = antwort.json<AbzugSchluesselNeu>();
        expect(angelegt.schluessel).toMatch(/^abz_[A-Za-z0-9_-]{43}$/u);
        const tage = (new Date(angelegt.laeuftAb).getTime() - Date.now()) / 86_400_000;
        expect(tage).toBeGreaterThan(89.9);
        expect(tage).toBeLessThan(90.1);

        // Wiederholen mit derselben Kennung gibt den Wert NICHT noch einmal her.
        const wiederholt = await stage.inject({
            method: "POST",
            url: `${ABZUG_URL}/schluessel`,
            payload: { operationId, tage: 90 },
            headers: { origin: TEST_ORIGIN, cookie: admin.cookie },
        });
        expect(code(wiederholt)).toBe("409 abzug_schluessel_gesehen");
        expect(wiederholt.body).not.toContain(angelegt.schluessel);

        // Datenbank: nur der Hash, nie der Wert (nicht in der Tafel, nicht im Protokoll, nicht in einer Quittung).
        const zeilen = await cluster!.admin<{ token_hash: Buffer; quelle: string }[]>`
            SELECT token_hash, quelle FROM avesmaps_auth.abzug_schluessel`;
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]!.quelle).toBe("staging");
        expect(zeilen[0]!.token_hash.equals(createHash("sha256").update(angelegt.schluessel, "utf8").digest())).toBe(
            true,
        );
        const protokoll = await cluster!.admin<{ text: string }[]>`
            SELECT (details::text || coalesce(receipt::text, '') || coalesce(target_ref, '')) AS text
              FROM avesmaps_auth.security_event WHERE action = 'system.abzug_schluessel'`;
        expect(protokoll).toHaveLength(vorher + 1);
        for (const zeile of protokoll) expect(zeile.text).not.toContain(angelegt.schluessel);
        const ereignis = (await ereignisse("system.abzug_schluessel")).at(-1)!;
        expect(ereignis.details).toEqual({ aktion: "angelegt", tage: 90 });
        expect(ereignis.target_ref).toBe(`abzug-schluessel:${angelegt.id}`);

        // Die Sicht zeigt ihn ohne Wert.
        const sicht = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>();
        expect(sicht.schluessel).toHaveLength(1);
        expect(sicht.schluessel[0]).toMatchObject({
            id: angelegt.id,
            zustand: "gueltig",
            von: "Alrike",
            zuletzt: null,
        });
        expect(JSON.stringify(sicht)).not.toContain(angelegt.schluessel);
    });

    it("🔴 der Schlüssel darf die Liste und die Datei, mit Range auch ab der Mitte, und schreibt ein Ereignis nur beim ersten Byte", async () => {
        await alleSchluessel();
        const { schluessel, id } = await neu(stage, admin.cookie);
        const liste = await mitSchluessel(stage, `${ABZUG_HOLEN_URL}/liste`, schluessel);
        expect(code(liste)).toBe("200");
        const stand = liste.json<AbzugHolenListe>();
        expect(stand.umgebung).toBe("staging");
        expect(stand.abzuege.map((datei) => datei.kennung)).toEqual([KENNUNG]);
        expect(stand.abzuege[0]!.bytes).toBe(tarBytes.length);
        expect(liste.headers["cache-control"]).toBe("no-store");
        // Die Nutzung wird vermerkt.
        const [genutzt] = await cluster!.admin<{ last_used_at: Date | null }[]>`
            SELECT last_used_at FROM avesmaps_auth.abzug_schluessel WHERE id = ${id}::uuid`;
        expect(genutzt!.last_used_at).not.toBeNull();

        const vorher = (await ereignisse("backup.downloaded")).length;
        const url = `${ABZUG_HOLEN_URL}/${KENNUNG}/datei`;
        const ganz = await mitSchluessel(stage, url, schluessel);
        expect(code(ganz)).toBe("200");
        expect(ganz.headers["content-type"]).toBe("application/x-tar");
        expect(ganz.headers["accept-ranges"]).toBe("bytes");
        expect(ganz.headers["content-disposition"]).toBe(
            `attachment; filename="avesmaps-abzug-staging-${KENNUNG}.tar"`,
        );
        expect(ganz.rawPayload.equals(tarBytes)).toBe(true);
        const protokoll = await ereignisse("backup.downloaded");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)).toMatchObject({
            target_ref: `abzug:staging:${KENNUNG}`,
            actor_label: `abzug-schluessel:${id.slice(0, 8)}`,
            details: { name: `avesmaps-abzug-staging-${KENNUNG}.tar` },
        });

        // Fortsetzen: 206 mit dem Rest, ohne zweites Ereignis.
        const mitte = Math.floor(tarBytes.length / 3);
        const rest = await mitSchluessel(stage, url, schluessel, { range: `bytes=${String(mitte)}-` });
        expect(code(rest)).toBe("206");
        expect(rest.headers["content-range"]).toBe(
            `bytes ${String(mitte)}-${String(tarBytes.length - 1)}/${String(tarBytes.length)}`,
        );
        expect(rest.headers["content-length"]).toBe(String(tarBytes.length - mitte));
        expect(rest.rawPayload.equals(tarBytes.subarray(mitte))).toBe(true);
        const stueck = await mitSchluessel(stage, url, schluessel, { range: "bytes=10-19" });
        expect(code(stueck)).toBe("206");
        expect(stueck.rawPayload.equals(tarBytes.subarray(10, 20))).toBe(true);
        expect(await ereignisse("backup.downloaded")).toHaveLength(vorher + 1);

        // Ein Bereich hinter dem Ende ist 416.
        const dahinter = await mitSchluessel(stage, url, schluessel, { range: `bytes=${String(tarBytes.length)}-` });
        expect(code(dahinter)).toBe("416 range_not_satisfiable");
        expect(dahinter.headers["content-range"]).toBe(`bytes */${String(tarBytes.length)}`);
        // Einen Abzug, den es nicht gibt, gibt es nicht.
        expect(
            code(await mitSchluessel(stage, `${ABZUG_HOLEN_URL}/20261025T000000Z-gibtesnicht/datei`, schluessel)),
        ).toBe("404 abzug_unbekannt");
        expect(code(await mitSchluessel(stage, `${ABZUG_HOLEN_URL}/..%2F..%2Fetc/datei`, schluessel))).toMatch(
            /^40[04]/u,
        );
    });

    it("🔴 falsch, fehlend, abgelaufen, widerrufen, von einer anderen Umgebung, vom gesperrten Konto: 401; und sonst öffnet er nichts", async () => {
        await alleSchluessel();
        const liste = `${ABZUG_HOLEN_URL}/liste`;
        const { schluessel, id } = await neu(stage, admin.cookie);
        expect(code(await mitSchluessel(stage, liste, schluessel))).toBe("200");
        expect(code(await mitSchluessel(stage, liste, neuerSchluessel()))).toBe("401 abzug_schluessel_ungueltig");
        expect(code(await mitSchluessel(stage, liste, "kein-schluessel"))).toBe("401 abzug_schluessel_ungueltig");
        expect(code(await stage.inject({ method: "GET", url: liste }))).toBe("401 abzug_schluessel_ungueltig");
        // Der Hash allein (aus der Datenbank gelesen) ist kein Schlüssel.
        const [zeile] = await cluster!.admin<{ h: string }[]>`
            SELECT encode(token_hash, 'hex') AS h FROM avesmaps_auth.abzug_schluessel WHERE id = ${id}::uuid`;
        expect(code(await mitSchluessel(stage, liste, zeile!.h))).toBe("401 abzug_schluessel_ungueltig");

        // Ein Schlüssel der Production gilt auf der Stage nicht (und umgekehrt).
        const fremd = await neu(produktion, admin.cookie);
        expect(code(await mitSchluessel(stage, liste, fremd.schluessel))).toBe("401 abzug_schluessel_ungueltig");
        expect(code(await mitSchluessel(produktion, liste, fremd.schluessel))).toBe("200");
        expect(code(await mitSchluessel(produktion, liste, schluessel))).toBe("401 abzug_schluessel_ungueltig");

        // Abgelaufen.
        await cluster!
            .admin`UPDATE avesmaps_auth.abzug_schluessel SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE id = ${id}::uuid`;
        expect(code(await mitSchluessel(stage, liste, schluessel))).toBe("401 abzug_schluessel_abgelaufen");
        expect(code(await mitSchluessel(stage, `${ABZUG_HOLEN_URL}/${KENNUNG}/datei`, schluessel))).toBe(
            "401 abzug_schluessel_abgelaufen",
        );
        const sicht = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>();
        expect(sicht.schluessel.find((eintrag) => eintrag.id === id)?.zustand).toBe("abgelaufen");

        // Gesperrtes Konto: Der Schlüssel geht mit.
        const zwei = await neu(stage, admin.cookie);
        expect(code(await mitSchluessel(stage, liste, zwei.schluessel))).toBe("200");
        await cluster!.admin`UPDATE avesmaps_auth.person SET status = 'locked' WHERE id = ${admin.id}::uuid`;
        expect(code(await mitSchluessel(stage, liste, zwei.schluessel))).toBe("401 abzug_schluessel_abgelaufen");
        await cluster!.admin`UPDATE avesmaps_auth.person SET status = 'active' WHERE id = ${admin.id}::uuid`;
        expect(code(await mitSchluessel(stage, liste, zwei.schluessel))).toBe("200");

        // Sonst öffnet er nichts: keine Verwaltung, kein Anstoßen eines Abzugs, kein Schlüssel für sich selbst.
        const kopf = { authorization: `Bearer ${zwei.schluessel}`, origin: TEST_ORIGIN };
        expect((await stage.inject({ method: "GET", url: ABZUG_URL, headers: kopf })).statusCode).toBe(401);
        expect(
            (
                await stage.inject({
                    method: "POST",
                    url: `${ABZUG_URL}/erstellen`,
                    headers: kopf,
                    payload: { operationId: randomUUID() },
                })
            ).statusCode,
        ).toBe(401);
        expect(
            (
                await stage.inject({
                    method: "POST",
                    url: `${ABZUG_URL}/schluessel`,
                    headers: kopf,
                    payload: { operationId: randomUUID(), tage: 30 },
                })
            ).statusCode,
        ).toBe(401);
        expect(
            (await stage.inject({ method: "GET", url: "/api/admin/system/abgleiche", headers: kopf })).statusCode,
        ).toBe(401);
    });

    it("🔴 widerrufen: Admin mit frischem Passkey, ein Ereignis, danach gilt er nicht mehr; höchstens fünf gültige zugleich", async () => {
        await alleSchluessel();
        const { schluessel, id } = await neu(stage, admin.cookie);
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, editor.cookie, { id }))).toBe(
            "403 forbidden",
        );
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, adminAlt.cookie, { id }))).toBe(
            "403 reauth_required",
        );
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, admin.cookie, { id: randomUUID() }))).toBe(
            "404 abzug_schluessel_unbekannt",
        );
        // Ein Schlüssel der anderen Umgebung lässt sich hier nicht widerrufen.
        expect(code(await post(produktion, `${ABZUG_URL}/schluessel/widerrufen`, admin.cookie, { id }))).toBe(
            "404 abzug_schluessel_unbekannt",
        );
        const vorher = (await ereignisse("system.abzug_schluessel")).length;
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, admin.cookie, { id }))).toBe("200");
        const protokoll = await ereignisse("system.abzug_schluessel");
        expect(protokoll).toHaveLength(vorher + 1);
        expect(protokoll.at(-1)).toMatchObject({
            target_ref: `abzug-schluessel:${id}`,
            details: { aktion: "widerrufen" },
        });
        expect(code(await mitSchluessel(stage, `${ABZUG_HOLEN_URL}/liste`, schluessel))).toBe(
            "401 abzug_schluessel_abgelaufen",
        );
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, admin.cookie, { id }))).toBe(
            "404 abzug_schluessel_unbekannt",
        );
        const sicht = (await get(stage, ABZUG_URL, admin.cookie)).json<AbzugSichtErstellen>();
        expect(sicht.schluessel[0]).toMatchObject({ id, zustand: "widerrufen" });

        for (let n = 1; n < ABZUG_SCHLUESSEL_HOECHSTENS; n += 1) await neu(stage, admin.cookie);
        expect(code(await post(stage, `${ABZUG_URL}/schluessel`, admin.cookie, { tage: 30 }))).toBe("200");
        expect(code(await post(stage, `${ABZUG_URL}/schluessel`, admin.cookie, { tage: 30 }))).toBe(
            "409 abzug_schluessel_zuviele",
        );
    });

    it("🔴 lokal: Schlüssel hinterlegen (nie in einer Antwort), holen über HTTP, ECHT einspielen in die Wegwerf-Datenbank, danach die Datei weg", async () => {
        await alleSchluessel();
        const { schluessel } = await neu(stage, admin.cookie);
        const lokalWurzel = join(wurzel, "lokal");
        const sichtLokal = async (): Promise<AbzugSichtEinspielen> =>
            (await get(lokal, ABZUG_URL, operator.cookie)).json<AbzugSicht>() as AbzugSichtEinspielen;

        expect((await sichtLokal()).schluessel).toEqual({ staging: false, production: false });
        // Ohne Schlüssel kein Holen; ein falsch geformter Wert wird gar nicht erst angenommen.
        expect(code(await post(lokal, `${ABZUG_URL}/holen`, operator.cookie, { quelle: "staging" }))).toBe(
            "409 abzug_schluessel_fehlt",
        );
        expect(
            code(await post(lokal, `${ABZUG_URL}/quelle`, operator.cookie, { quelle: "staging", schluessel: "kurz" })),
        ).toBe("400 validation_failed");
        expect(code(await get(lokal, ABZUG_URL, editor.cookie))).toBe("403 forbidden");

        const hinterlegt = await post(lokal, `${ABZUG_URL}/quelle`, operator.cookie, { quelle: "staging", schluessel });
        expect(code(hinterlegt)).toBe("200");
        expect(hinterlegt.body).not.toContain(schluessel);
        const nachher = await get(lokal, ABZUG_URL, operator.cookie);
        expect(nachher.json<AbzugSichtEinspielen>().schluessel).toEqual({ staging: true, production: false });
        expect(nachher.body).not.toContain(schluessel);
        // Der Wert liegt in der Datei des Dienstes, nirgends sonst.
        expect(JSON.parse(readFileSync(join(lokalWurzel, "schluessel.json"), "utf8"))).toEqual({ staging: schluessel });
        const protokollQuelle = await cluster!.admin<{ text: string }[]>`
            SELECT (details::text || coalesce(receipt::text, '') || coalesce(target_ref, '')) AS text
              FROM avesmaps_auth.security_event WHERE action = 'system.abzug_einspielen'`;
        for (const zeile of protokollQuelle) expect(zeile.text).not.toContain(schluessel);

        // Das Holen ersetzt die lokalen Daten: frischer Passkey, sonst nicht.
        expect(code(await post(lokal, `${ABZUG_URL}/holen`, operatorAlt.cookie, { quelle: "staging" }))).toBe(
            "403 reauth_required",
        );
        const vorher = (await ereignisse("system.abzug_einspielen")).length;
        const holen = await post(lokal, `${ABZUG_URL}/holen`, operator.cookie, { quelle: "staging" });
        expect(code(holen)).toBe("200");
        expect(await ereignisse("system.abzug_einspielen")).toHaveLength(vorher + 1);
        expect((await ereignisse("system.abzug_einspielen")).at(-1)?.details).toEqual({ schritt: "holen" });
        // Während es läuft, kein zweites.
        expect(code(await post(lokal, `${ABZUG_URL}/holen`, operator.cookie, { quelle: "staging" }))).toMatch(
            /^409 abzug_laeuft|^200/u,
        );

        let sicht = await sichtLokal();
        for (let n = 0; n < 600 && (sicht.lauf === null || sicht.lauf.zustand === "laeuft"); n += 1) {
            await new Promise((fertig) => setTimeout(fertig, 100));
            sicht = await sichtLokal();
        }
        expect(sicht.lauf, JSON.stringify(sicht.lauf)).toMatchObject({
            zustand: "fertig",
            kennung: KENNUNG,
            meldung: null,
        });
        expect(sicht.lauf!.zeilen).toBeGreaterThanOrEqual(0);
        expect(sicht.lauf!.sicherung).toMatch(/^vorher-/u);
        // Eingespielt: Die Datei ist gelöscht, kein Rest im Eingang, kein Schlüssel in der Sicht.
        expect(sicht.eingang).toBeNull();
        const eingang = join(lokalWurzel, "eingang");
        expect(existsSync(eingang) ? readdirSync(eingang) : []).toEqual([]);
        expect(JSON.stringify(sicht)).not.toContain(schluessel);
        expect(readFileSync(join(lokalWurzel, "letzter-lauf.json"), "utf8")).not.toContain(schluessel);
        // Die Quelle hat die Datei einmal herausgegeben, und sie liegt unverändert da.
        expect(statSync(join(wurzel, "stage", "staging", KENNUNG, "abzug.tar")).size).toBe(tarBytes.length);

        // Entfernen räumt den Schlüssel; danach geht das Holen wieder nicht.
        expect(
            code(await post(lokal, `${ABZUG_URL}/quelle`, operator.cookie, { quelle: "staging", schluessel: null })),
        ).toBe("200");
        expect((await sichtLokal()).schluessel).toEqual({ staging: false, production: false });
        expect(code(await post(lokal, `${ABZUG_URL}/holen`, operator.cookie, { quelle: "staging" }))).toBe(
            "409 abzug_schluessel_fehlt",
        );
    });

    it("🔴 lokal: ein widerrufener Schlüssel endet im Lauf mit einem klaren Satz, und es ist nichts verändert", async () => {
        await alleSchluessel();
        const { schluessel, id } = await neu(stage, admin.cookie);
        expect(code(await post(stage, `${ABZUG_URL}/schluessel/widerrufen`, admin.cookie, { id }))).toBe("200");
        await post(lokal, `${ABZUG_URL}/quelle`, operator.cookie, { quelle: "staging", schluessel });
        expect(code(await post(lokal, `${ABZUG_URL}/holen`, operator.cookie, { quelle: "staging" }))).toBe("200");
        let sicht = (await get(lokal, ABZUG_URL, operator.cookie)).json<AbzugSichtEinspielen>();
        for (let n = 0; n < 100 && sicht.lauf?.zustand === "laeuft"; n += 1) {
            await new Promise((fertig) => setTimeout(fertig, 50));
            sicht = (await get(lokal, ABZUG_URL, operator.cookie)).json<AbzugSichtEinspielen>();
        }
        expect(sicht.lauf?.zustand).toBe("fehler");
        expect(sicht.lauf?.meldung).toMatch(/Schlüssel für Stage ist abgelaufen oder widerrufen/u);
        expect(sicht.lauf?.meldung).not.toContain(schluessel);
        expect(sicht.eingang).toBeNull();
        await post(lokal, `${ABZUG_URL}/quelle`, operator.cookie, { quelle: "staging", schluessel: null });
    });
});
