import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    KARTEN_API_FEHLER,
    KARTEN_API_URL,
    KARTEN_EXPORT_URL,
    KARTEN_PAKET_URL,
    KARTEN_SVG_EXPORT_URL,
    KartenApiListe,
    KartenExportStand,
    KartenPaketSicht,
    type KartenZugangNeu,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { randomToken, tokenHash } from "../src/auth/tokens.ts";
import { runKartenSvg } from "../src/jobs/karten-svg-job.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Karten herunterladen (WI-0280) im Wegwerf-Cluster mit den Rollen des VPS: Sitzung, Token-Link und API-Schlüssel gegen echte Dateien. 🔴 Das ist auch der Vertragstest von
 * `/api/v1/karten` (Kap. 11.15): Die Antworten gehen gegen die Laufzeitschemata, die Fehlercodes gegen `KARTEN_API_FEHLER`.
 */

// Der Vertrag nennt Formate; `Value.Check` kennt sie nur, wenn man sie anmeldet.
if (!FormatRegistry.Has("date-time")) FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));
if (!FormatRegistry.Has("uuid")) FormatRegistry.Set("uuid", (wert) => /^[0-9a-f-]{36}$/u.test(wert));

const ENV = "kartenexport";
const grants = [
    fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url)),
    fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url)),
    fileURLToPath(new URL("../src/db/jobs-grants.psql", import.meta.url)),
];
const describeWithCluster = postgresBin ? describe : describe.skip;

const INHALT = Buffer.from("PNG-Ersatz ".repeat(1000));
const NAME = "abcdef012345.png";

const fehlerCode = (antwort: { json(): unknown }): string => (antwort.json() as { error: { code: string } }).error.code;

/** Die Einträge eines ZIP, vom Ende her gelesen, wie ein Entpacker es tut. */
function namenIm(zip: Buffer): string[] {
    const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const anzahl = zip.readUInt16LE(ende + 10);
    let stelle = zip.readUInt32LE(ende + 16);
    const namen: string[] = [];
    for (let i = 0; i < anzahl; i += 1) {
        const laenge = zip.readUInt16LE(stelle + 28);
        namen.push(zip.subarray(stelle + 46, stelle + 46 + laenge).toString("utf8"));
        stelle += 46 + laenge + zip.readUInt16LE(stelle + 30);
    }
    return namen;
}

describeWithCluster("Karten herunterladen (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster;
    let fixture: AuthFixture;
    let wurzel: string;
    let app: FastifyInstance;
    let betreiber: { cookie: string; id: string };
    let editor: { cookie: string };
    let alteWurzel: string | undefined;

    const post = (url: string, cookie: string, payload: object = {}) =>
        app.inject({
            method: "POST",
            url,
            payload: { operationId: randomUUID(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const holen = (url: string, cookie: string, extra: Record<string, string> = {}) =>
        app.inject({ method: "GET", url, headers: { cookie, ...extra } });
    const mitWert = (url: string, wert: string, extra: Record<string, string> = {}) =>
        app.inject({ method: "GET", url, headers: { authorization: `Bearer ${wert}`, ...extra } });
    const lege = async (art: "link" | "schluessel", karten: string[], tage = art === "link" ? 7 : 90) => {
        const antwort = await post(`${KARTEN_EXPORT_URL}/zugaenge`, betreiber.cookie, {
            art,
            fuerWen: "Probe",
            tage,
            karten,
        });
        expect(antwort.statusCode).toBe(200);
        return antwort.json<KartenZugangNeu>();
    };
    const tokenAus = (neu: KartenZugangNeu): string => neu.wert.split("#")[1]!;
    const ereignisse = (aktion: string) =>
        cluster.admin<{ details: Record<string, unknown>; actor_label: string | null }[]>`
            SELECT details, actor_label FROM avesmaps_auth.security_event WHERE action = ${aktion} ORDER BY id`;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        fixture = authFixture(cluster.admin);
        wurzel = await mkdtemp(join(tmpdir(), "kartenexport-"));
        const tiles = join(wurzel, "tiles");
        await mkdir(tiles, { recursive: true });
        await mkdir(join(wurzel, "map-sources", "modern"), { recursive: true });
        await writeFile(join(wurzel, "map-sources", "modern", NAME), INHALT);
        alteWurzel = process.env["MAP_SOURCES_ROOT"];
        delete process.env["MAP_SOURCES_ROOT"];
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "wi0280",
            databaseUrl: "postgres://ungenutzt@127.0.0.1/ungenutzt",
            tileRoot: tiles,
            statusPage: true,
            auth: TEST_AUTH,
        };
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        const person = async (role: "operator" | "editor", name: string) => {
            const angelegt = await fixture.person(role, { name });
            const { cookie } = await fixture.session(angelegt.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { cookie, id: angelegt.id };
        };
        betreiber = await person("operator", "Rondrikan");
        editor = await person("editor", "Efferdan");
    }, 180_000);

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
        if (alteWurzel !== undefined) process.env["MAP_SOURCES_ROOT"] = alteWurzel;
        await rm(wurzel, { recursive: true, force: true });
    });

    it("zeigt den Stand nur mit dem Recht; eine fehlende Quelle sagt die Zeile", async () => {
        expect((await app.inject({ method: "GET", url: `${KARTEN_EXPORT_URL}/stand` })).statusCode).toBe(401);
        expect((await holen(`${KARTEN_EXPORT_URL}/stand`, editor.cookie)).statusCode).toBe(403);
        const antwort = await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie);
        expect(antwort.statusCode).toBe(200);
        const stand = antwort.json<KartenExportStand>();
        expect(Value.Check(KartenExportStand, stand)).toBe(true);
        expect(stand.karten.find((k) => k.id === "modern")?.bytes).toBe(INHALT.length);
        expect(stand.karten.find((k) => k.id === "original")?.bytes).toBeNull();
        expect(stand.karten.find((k) => k.id === "old")?.nurEditoren).toBe(false);
        expect(stand.karten.find((k) => k.id === "svg-roh")?.bytes).toBeNull();
    });

    it("liefert das ZIP der Sitzung mit Lizenz, Beleg und Fortsetzen", async () => {
        const url = `${KARTEN_EXPORT_URL}/paket.zip?ids=modern`;
        const antwort = await holen(url, betreiber.cookie);
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["content-type"]).toBe("application/zip");
        expect(antwort.headers["x-accel-buffering"]).toBe("no");
        expect(String(antwort.headers["content-disposition"])).toMatch(/^attachment; filename="avesmaps-karten-/u);
        const zip = antwort.rawPayload;
        expect(namenIm(zip)).toContain("avesmaps-modern-32768px.png");
        expect(namenIm(zip)).toContain("LIZENZ.txt");
        expect(zip.includes(INHALT)).toBe(true);
        expect(zip.toString("utf8")).toContain("https://de.wiki-aventurica.de/wiki/Kartenpaket/Lizenz");
        const [abruf] = await cluster.admin<{ zustand: string; person_id: string; karten: string[] }[]>`
            SELECT zustand, person_id, karten FROM karten_abruf ORDER BY id DESC LIMIT 1`;
        expect(abruf?.person_id).toBe(betreiber.id);
        expect(abruf?.karten).toEqual(["modern"]);
        expect((await ereignisse("system.karten_abruf")).at(-1)?.details["weg"]).toBe("sitzung");

        const zahl = (await ereignisse("system.karten_abruf")).length;
        const rest = await holen(url, betreiber.cookie, { range: `bytes=${String(zip.length - 40)}-` });
        expect(rest.statusCode).toBe(206);
        expect(rest.rawPayload.equals(zip.subarray(zip.length - 40))).toBe(true);
        expect((await ereignisse("system.karten_abruf")).length).toBe(zahl);

        const sha = String(antwort.headers["x-avesmaps-sha256"]);
        expect((await holen(url, betreiber.cookie, { "if-none-match": sha })).statusCode).toBe(304);
        expect((await holen(url, betreiber.cookie, { "if-none-match": `"${sha}"` })).statusCode).toBe(304);
        expect((await holen(url, betreiber.cookie, { range: `bytes=${String(zip.length + 5)}-` })).statusCode).toBe(
            416,
        );
    });

    it("ab Admin und mit der Sonderrolle Kartograph, sonst nicht (Vali 2026-11-05)", async () => {
        const rolle = async (role: "admin" | "editor", name: string, sonderrolle?: string) => {
            const person = await fixture.person(role, { name });
            if (sonderrolle !== undefined) {
                await cluster.admin`
                    INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, reason)
                    VALUES (${person.id}, 'test', ${sonderrolle}, 'Probe')`;
            }
            return (await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 })).cookie;
        };
        const stand = `${KARTEN_EXPORT_URL}/stand`;
        expect((await holen(stand, await rolle("admin", "Praiodan"))).statusCode).toBe(200);
        expect((await holen(stand, await rolle("editor", "Boronian"))).statusCode).toBe(403);
        expect((await holen(stand, await rolle("editor", "Kartografin", "kartograph"))).statusCode).toBe(200);
        expect((await holen(stand, await rolle("editor", "Kuratorin", "kurator"))).statusCode).toBe(403);
    });

    it("gibt kein ZIP, wenn eine Karte fehlt, auch kein kleineres", async () => {
        const antwort = await holen(`${KARTEN_EXPORT_URL}/paket.zip?ids=modern,original`, betreiber.cookie);
        expect(antwort.statusCode).toBe(404);
        expect(fehlerCode(antwort)).toBe("export_not_available");
    });

    it("ein Token-Link: Wert einmal, nur Hash, Empfängerseite, Zurücknehmen wirkt sofort", async () => {
        const neu = await lege("link", ["modern"]);
        expect(neu.wert).toMatch(/\/paket#[A-Za-z0-9_-]{43}$/u);
        const token = tokenAus(neu);
        const [zeile] = await cluster.admin<{ h: string }[]>`
            SELECT encode(token_hash, 'hex') AS h FROM avesmaps_auth.karten_zugang WHERE id = ${neu.id}::uuid`;
        expect(zeile?.h).not.toContain(token);

        const offen = await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, token);
        expect(offen.statusCode).toBe(200);
        const sicht = offen.json<KartenPaketSicht>();
        expect(Value.Check(KartenPaketSicht, sicht)).toBe(true);
        expect(sicht.karten.map((k) => k.id)).toEqual(["modern"]);
        expect(sicht.datei).not.toContain(token);

        const datei = await app.inject({ method: "GET", url: sicht.datei });
        expect(datei.statusCode).toBe(200);
        expect(namenIm(datei.rawPayload)).toContain("avesmaps-modern-32768px.png");
        const ereignis = (await ereignisse("system.karten_abruf")).at(-1);
        expect(ereignis?.details["weg"]).toBe("link");
        expect(ereignis?.actor_label).toMatch(/^karten-link:/u);
        expect(JSON.stringify(ereignis)).not.toContain(token);

        const weg = await post(`${KARTEN_EXPORT_URL}/zugaenge/${neu.id}/weg`, betreiber.cookie);
        expect(weg.statusCode).toBe(200);
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, token)).statusCode).toBe(410);
        expect((await app.inject({ method: "GET", url: sicht.datei })).statusCode).toBe(410);
    });

    it("ein Link fällt mit Ablauf, falschem Wert und Fälschung des Tickets", async () => {
        const neu = await lege("link", ["modern"]);
        const token = tokenAus(neu);
        const { datei } = (await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, token)).json<KartenPaketSicht>();
        const falsch = datei.replace(/.$/u, (zeichen) => (zeichen === "A" ? "B" : "A"));
        expect((await app.inject({ method: "GET", url: falsch })).statusCode).toBe(410);
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, "x".repeat(43))).statusCode).toBe(410);
        expect((await app.inject({ method: "GET", url: `${KARTEN_PAKET_URL}/oeffnen` })).statusCode).toBe(410);
        await cluster.admin`
            UPDATE avesmaps_auth.karten_zugang SET created_at = now() - interval '9 days', expires_at = now() - interval '1 minute'
             WHERE id = ${neu.id}::uuid`;
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, token)).statusCode).toBe(410);
        expect((await app.inject({ method: "GET", url: datei })).statusCode).toBe(410);
    });

    it("„Neu ausstellen“: Ein alter Link gilt sofort nicht mehr, ein alter Schlüssel noch sieben Tage", async () => {
        const link = await lege("link", ["modern"]);
        const neuerLink = (
            await post(`${KARTEN_EXPORT_URL}/zugaenge/${link.id}/neu`, betreiber.cookie)
        ).json<KartenZugangNeu>();
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, tokenAus(link))).statusCode).toBe(410);
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, tokenAus(neuerLink))).statusCode).toBe(200);

        const schluessel = await lege("schluessel", ["modern"]);
        const neuerSchluessel = (
            await post(`${KARTEN_EXPORT_URL}/zugaenge/${schluessel.id}/neu`, betreiber.cookie)
        ).json<KartenZugangNeu>();
        expect((await mitWert(KARTEN_API_URL, schluessel.wert)).statusCode).toBe(200);
        expect((await mitWert(KARTEN_API_URL, neuerSchluessel.wert)).statusCode).toBe(200);
        const [alt] = await cluster.admin<{ tage: number }[]>`
            SELECT extract(epoch FROM expires_at - now()) / 86400 AS tage FROM avesmaps_auth.karten_zugang WHERE id = ${schluessel.id}::uuid`;
        expect(Number(alt?.tage)).toBeLessThan(7.01);
    });

    it("der API-Vertrag: Liste, eine Karte, Paket, fremde Kennung, kein Schlüssel", async () => {
        const { wert, id } = await lege("schluessel", ["modern"]);
        expect(wert).toMatch(/^avk_[A-Za-z0-9_-]{43}$/u);

        const liste = await mitWert(KARTEN_API_URL, wert);
        expect(liste.statusCode).toBe(200);
        const inhalt = liste.json<KartenApiListe>();
        expect(Value.Check(KartenApiListe, inhalt)).toBe(true);
        expect(inhalt.vertrag).toBe(1);
        expect(inhalt.karten.map((k) => k.id)).toEqual(["modern"]);

        const eine = await mitWert(`${KARTEN_API_URL}/modern.zip`, wert);
        expect(eine.statusCode).toBe(200);
        expect(namenIm(eine.rawPayload)).toContain("LIZENZ.txt");
        expect((await ereignisse("system.karten_abruf")).at(-1)?.actor_label).toMatch(/^karten-schluessel:avk_/u);
        const paket = await mitWert(`${KARTEN_API_URL}/paket.zip?ids=modern`, wert);
        expect(paket.rawPayload.equals(eine.rawPayload)).toBe(true);

        const fehler = new Map<string, number>([]);
        const merke = (antwort: { statusCode: number; json(): unknown }) => {
            const code = fehlerCode(antwort);
            fehler.set(code, antwort.statusCode);
            return code;
        };
        expect(merke(await mitWert(`${KARTEN_API_URL}/original.zip`, wert))).toBe("not_in_scope");
        expect(merke(await mitWert(`${KARTEN_API_URL}/paket.zip?ids=modern,original`, wert))).toBe("not_in_scope");
        expect(merke(await app.inject({ method: "GET", url: KARTEN_API_URL }))).toBe("unauthorized");
        expect(merke(await mitWert(KARTEN_API_URL, `avk_${"a".repeat(43)}`))).toBe("unauthorized");
        expect(merke(await app.inject({ method: "GET", url: `${KARTEN_API_URL}?key=${wert}` }))).toBe("unauthorized");
        expect(merke(await mitWert(`${KARTEN_API_URL}/paket.zip?ids=A!`, wert))).toBe("invalid_request");
        expect(merke(await mitWert(`${KARTEN_API_URL}/gibtesnicht.txt`, wert))).toBe("export_not_available");
        expect(fehler.get("unauthorized")).toBe(401);
        expect(fehler.get("not_in_scope")).toBe(403);
        for (const code of fehler.keys()) expect(KARTEN_API_FEHLER as readonly string[]).toContain(code);

        await post(`${KARTEN_EXPORT_URL}/zugaenge/${id}/weg`, betreiber.cookie);
        expect(fehlerCode(await mitWert(KARTEN_API_URL, wert))).toBe("unauthorized");
    });

    it("eine gesperrte Person nimmt ihre Zugänge mit", async () => {
        const { wert } = await lege("schluessel", ["modern"]);
        expect((await mitWert(KARTEN_API_URL, wert)).statusCode).toBe(200);
        await cluster.admin`UPDATE avesmaps_auth.person SET status = 'locked' WHERE id = ${betreiber.id}::uuid`;
        expect((await mitWert(KARTEN_API_URL, wert)).statusCode).toBe(401);
        await cluster.admin`UPDATE avesmaps_auth.person SET status = 'active' WHERE id = ${betreiber.id}::uuid`;
    });

    it("listet Zugänge ohne Wert, mit Abrufen", async () => {
        const stand = (await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie)).json<KartenExportStand>();
        expect(stand.links.length).toBeGreaterThan(0);
        expect(stand.schluessel.length).toBeGreaterThan(0);
        expect(JSON.stringify(stand)).not.toMatch(/avk_[A-Za-z0-9_-]{43}/u);
        expect(stand.links.some((z) => z.abrufe > 0)).toBe(true);
    });

    it("lehnt eine unbekannte Frist und eine fehlende Karte beim Anlegen ab", async () => {
        const frist = await post(`${KARTEN_EXPORT_URL}/zugaenge`, betreiber.cookie, {
            art: "link",
            fuerWen: "Probe",
            tage: 2,
            karten: ["modern"],
        });
        expect(fehlerCode(frist)).toBe("invalid_request");
        const fehlt = await post(`${KARTEN_EXPORT_URL}/zugaenge`, betreiber.cookie, {
            art: "link",
            fuerWen: "Probe",
            tage: 7,
            karten: ["original"],
        });
        expect(fehlerCode(fehlt)).toBe("export_not_available");
    });

    it("der Auftrag zeichnet als Jobs-Rolle, legt ab, und die Abzüge sind danach zu haben", async () => {
        const lauf = (input: Record<string, unknown>): JobContext => ({
            input,
            attempt: 1,
            job: { id: 1, publicId: randomUUID(), leaseNo: null, mapDomainId: "aventuria" },
            beginPhase: async () => undefined,
            checkpoint: () => undefined,
        });
        const vorher = process.env["TILE_ROOT"];
        process.env["TILE_ROOT"] = join(wurzel, "tiles");
        try {
            const mitJobs = <T>(arbeit: (db: VpsCluster["jobs"]) => Promise<T>): Promise<T> => arbeit(cluster.jobs);
            await runKartenSvg(lauf({ art: "standard" }), mitJobs);
            const stand = (await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie)).json<KartenExportStand>();
            const roh = stand.karten.find((k) => k.id === "svg-roh");
            expect(roh?.bytes).toBeGreaterThan(100);
            expect(stand.karten.find((k) => k.id === "svg-glatt")?.bytes).toBeGreaterThan(100);
            expect(stand.svg.veraltet).toBe(false);

            const zip = await holen(`${KARTEN_EXPORT_URL}/paket.zip?ids=svg-roh`, betreiber.cookie);
            expect(zip.statusCode).toBe(200);
            expect(namenIm(zip.rawPayload)).toContain("avesmaps-karte-roh.svg");
            expect(zip.rawPayload.toString("utf8")).toContain('xmlns:avm="https://avesmaps.de/ns/export/1"');
            expect(zip.headers["x-avesmaps-kartenfassung"]).toBe(roh?.fassung);

            await runKartenSvg(
                lauf({
                    art: "eigen",
                    id: "svg-eigen-0123456789ab",
                    einstellungen: {
                        dialekt: "illustrator",
                        groessePx: 4096,
                        semantik: false,
                        passmarken: true,
                        strichProzent: 150,
                        glattWege: true,
                        glattFlaechen: false,
                        spannung: 0.5,
                        ebenen: ["wege", "orte"],
                    },
                }),
                mitJobs,
            );
            const danach = (await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie)).json<KartenExportStand>();
            expect(danach.karten.find((k) => k.id === "svg-eigen-0123456789ab")?.pixel).toBe(4096);
            expect(danach.karten.find((k) => k.id === "svg-roh")?.bytes).toBe(roh?.bytes);
            await expect(runKartenSvg(lauf({ art: "eigen", id: "../boese" }), mitJobs)).rejects.toThrow(/ungültig/u);
        } finally {
            if (vorher === undefined) delete process.env["TILE_ROOT"];
            else process.env["TILE_ROOT"] = vorher;
        }
    });

    it("svg-export: der Vertrag der Terrain-Pipeline (Kopfzeilen, Prüfsumme, 304, roh und glatt, nie ersatzweise)", async () => {
        const lauf = (input: Record<string, unknown>): JobContext => ({
            input,
            attempt: 1,
            job: { id: 2, publicId: randomUUID(), leaseNo: null, mapDomainId: "aventuria" },
            beginPhase: async () => undefined,
            checkpoint: () => undefined,
        });
        const mitJobs = <T>(arbeit: (db: VpsCluster["jobs"]) => Promise<T>): Promise<T> => arbeit(cluster.jobs);
        const vorher = process.env["TILE_ROOT"];
        process.env["TILE_ROOT"] = join(wurzel, "tiles");
        try {
            await runKartenSvg(lauf({ art: "standard", quelle: "routine" }), mitJobs);
            const { wert } = await lege("schluessel", ["svg-roh", "svg-glatt"]);
            const nurPng = (await lege("schluessel", ["modern"])).wert;

            // Ohne Schlüssel oder mit einem ohne SVG: nichts, auch keine Fassung.
            const ohne = await app.inject({ method: "GET", url: KARTEN_SVG_EXPORT_URL });
            expect(ohne.statusCode).toBe(401);
            expect(ohne.headers["x-avesmaps-sha256"]).toBeUndefined();
            expect(fehlerCode(await mitWert(KARTEN_SVG_EXPORT_URL, nurPng))).toBe("not_in_scope");

            const roh = await mitWert(KARTEN_SVG_EXPORT_URL, wert);
            const glatt = await mitWert(`${KARTEN_SVG_EXPORT_URL}?smooth=1`, wert);
            for (const [antwort, variante] of [
                [roh, "roh"],
                [glatt, "glatt"],
            ] as const) {
                expect(antwort.statusCode).toBe(200);
                expect(antwort.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
                expect(antwort.headers["location"]).toBeUndefined();
                const sha = createHash("sha256").update(antwort.rawPayload).digest("hex");
                expect(antwort.headers["x-avesmaps-sha256"]).toBe(sha);
                expect(antwort.headers["etag"]).toBe(`"${sha}"`);
                expect(antwort.headers["x-avesmaps-variante"]).toBe(variante);
                expect(antwort.headers["x-avesmaps-quelle"]).toBe("routine");
                const wurzelTag = /<svg\b[^>]*>/u.exec(antwort.rawPayload.toString("utf8"))![0];
                const attr = (name: string) => new RegExp(`${name}="([^"]*)"`, "u").exec(wurzelTag)?.[1];
                expect(antwort.headers["x-avesmaps-kartenfassung"]).toBe(attr("avm:kartenfassung"));
                expect(antwort.headers["x-avesmaps-landschaftsfassung"]).toBe(attr("avm:landschaftsfassung"));
                expect(attr("avm:geglaettet")).toBe(variante === "glatt" ? "ja" : "nein");
                expect(attr("viewBox")).toBe("0 0 1024 1024");
                expect(attr("width")).toBe("32768");
                expect(attr("avm:einheit_px")).toBe("32");
                expect(antwort.headers["content-disposition"]).toBe(
                    `attachment; filename="avesmaps-karte-${attr("avm:exportiert")!.slice(0, 10)}-r${attr("avm:kartenfassung")!}-inkscape-${variante}.svg"`,
                );

                // Die blanke Prüfsumme, wie die Pipeline sie schickt, und der ETag mit Anführungszeichen: 304, dieselben Kopfzeilen, kein Rumpf.
                for (const merke of [sha, `"${sha}"`]) {
                    const gleich = await mitWert(
                        `${KARTEN_SVG_EXPORT_URL}${variante === "glatt" ? "?smooth=1" : ""}`,
                        wert,
                        { "if-none-match": merke },
                    );
                    expect(gleich.statusCode).toBe(304);
                    expect(gleich.headers["x-avesmaps-sha256"]).toBe(sha);
                    expect(gleich.headers["x-avesmaps-variante"]).toBe(variante);
                    expect(gleich.headers["x-avesmaps-kartenfassung"]).toBe(attr("avm:kartenfassung"));
                    expect(gleich.rawPayload.length).toBe(0);
                }
            }
            expect(roh.headers["x-avesmaps-sha256"]).not.toBe(glatt.headers["x-avesmaps-sha256"]);
            expect((await mitWert(`${KARTEN_SVG_EXPORT_URL}?smooth=true`, wert)).headers["x-avesmaps-variante"]).toBe(
                "glatt",
            );
            expect((await mitWert(`${KARTEN_SVG_EXPORT_URL}?smooth=0`, wert)).headers["x-avesmaps-variante"]).toBe(
                "roh",
            );

            // „SVG erzeugen“ von Hand trägt `manuell`.
            await runKartenSvg(lauf({ art: "standard", quelle: "manuell" }), mitJobs);
            expect((await mitWert(KARTEN_SVG_EXPORT_URL, wert)).headers["x-avesmaps-quelle"]).toBe("manuell");

            // Fehlt die glatte Datei: 404 mit dem eigenen Grund, nie die rohe an ihrer Stelle.
            const exporte = join(wurzel, "karten-export");
            const zeiger = JSON.parse(await readFile(join(exporte, "aktuell.json"), "utf8")) as {
                abzuege: Record<string, { datei: string }>;
            };
            const glattDatei = join(exporte, zeiger.abzuege["svg-glatt"]!.datei);
            await rename(glattDatei, `${glattDatei}.weg`);
            try {
                const fehlt = await mitWert(`${KARTEN_SVG_EXPORT_URL}?smooth=1`, wert);
                expect(fehlt.statusCode).toBe(404);
                expect(fehlt.headers["content-type"]).toMatch(/^application\/json/u);
                expect(fehlt.json()).toMatchObject({ error: "smooth_export_not_available" });
                expect(fehlt.headers["x-avesmaps-sha256"]).toBeUndefined();
            } finally {
                await rename(`${glattDatei}.weg`, glattDatei);
            }
        } finally {
            if (vorher === undefined) delete process.env["TILE_ROOT"];
            else process.env["TILE_ROOT"] = vorher;
        }
    });

    it("reiht den SVG-Bau ein, ohne selbst zu rechnen", async () => {
        const antwort = await post(`${KARTEN_EXPORT_URL}/svg`, betreiber.cookie, {});
        expect(antwort.statusCode).toBe(200);
        const [job] = await cluster.admin<{ kind: string; scope: string }[]>`
            SELECT kind, input_ref->>'art' AS scope FROM job ORDER BY id DESC LIMIT 1`;
        expect(job).toEqual({ kind: "karten_svg", scope: "standard" });
        // Ein zweiter Klick stapelt nichts: Es bleibt bei dem Auftrag, der schon wartet.
        expect((await post(`${KARTEN_EXPORT_URL}/svg`, betreiber.cookie, {})).statusCode).toBe(200);
        const [zahl] = await cluster.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'karten_svg' AND state = 'QUEUED'`;
        expect(zahl?.n).toBe(1);
        const stand = (await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie)).json<KartenExportStand>();
        expect(stand.svg.zustand).toBe("laeuft");
    });

    // 🔴 Migration 0324: Die Rechte an `avesmaps_auth.karten_zugang` spielt Claudio mit `auth-grants.psql` ein, nie der Korridor. Bis dahin darf nichts
    // an einem Rechtefehler scheitern: nicht die Anmeldung, nicht ein Link, ein Ticket oder ein Schlüssel, nicht der SVG-Bau.
    it("🔴 ohne Rechte an der neuen Tafel: liest die alte, schreibt nichts, Anmeldung, Downloads und SVG-Bau laufen", async () => {
        const lauf = (input: Record<string, unknown>): JobContext => ({
            input,
            attempt: 1,
            job: { id: 3, publicId: randomUUID(), leaseNo: null, mapDomainId: "aventuria" },
            beginPhase: async () => undefined,
            checkpoint: () => undefined,
        });
        const mitJobs = <T>(arbeit: (db: VpsCluster["jobs"]) => Promise<T>): Promise<T> => arbeit(cluster.jobs);
        // Was die Migration aus der alten Tafel kopiert hätte, hier nur in der alten: ein Link und ein Schlüssel aus der Zeit vor 0324.
        const alt = async (art: "link" | "schluessel", wert: string, kennung: string): Promise<string> => {
            const [zeile] = await cluster.admin<{ id: string }[]>`
                INSERT INTO public.karten_zugang (art, token_hash, kennung, fuer_wen, karten, created_by, expires_at)
                VALUES (${art}, ${tokenHash(wert)}, ${kennung}, 'Altbestand', ${["modern"]}, ${betreiber.id}::uuid, now() + interval '7 days')
                RETURNING id::text AS id`;
            return zeile!.id;
        };
        const linkWert = randomToken();
        const schluesselWert = `avk_${randomToken()}`;
        const altLink = await alt("link", linkWert, "alt00001");
        await alt("schluessel", schluesselWert, schluesselWert.slice(0, 8));
        // Ein eigener Abzug, den kein Zugang nennt und der älter ist als die Aufbewahrung: Nur das Wissen um die Zugänge darf ihn räumen.
        const exporte = join(wurzel, "karten-export");
        const zeigerDatei = join(exporte, "aktuell.json");
        const zeiger = JSON.parse(await readFile(zeigerDatei, "utf8")) as {
            abzuege: Record<string, { erstellt: string }>;
        };
        const EIGEN = "svg-eigen-0123456789ab";
        zeiger.abzuege[EIGEN]!.erstellt = new Date(Date.now() - 40 * 86_400_000).toISOString();
        await writeFile(zeigerDatei, JSON.stringify(zeiger, null, 2));
        const abzuege = async (): Promise<string[]> =>
            Object.keys((JSON.parse(await readFile(zeigerDatei, "utf8")) as { abzuege: object }).abzuege);

        const vorher = process.env["TILE_ROOT"];
        process.env["TILE_ROOT"] = join(wurzel, "tiles");
        const protokollVorher = (await readFile(cluster.logFile, "utf8")).length;
        await cluster.admin.unsafe(`REVOKE ALL ON avesmaps_auth.karten_zugang FROM ${cluster.roles.app}`);
        await cluster.admin.unsafe(
            `REVOKE EXECUTE ON FUNCTION avesmaps_auth.karten_zugang_karten() FROM ${cluster.roles.jobs}`,
        );
        try {
            expect((await holen("/api/auth/session", betreiber.cookie)).statusCode).toBe(200);
            const stand = await holen(`${KARTEN_EXPORT_URL}/stand`, betreiber.cookie);
            expect(stand.statusCode).toBe(200);
            expect(stand.json<KartenExportStand>().links.map((z) => z.id)).toContain(altLink);

            const offen = await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, linkWert);
            expect(offen.statusCode).toBe(200);
            const datei = await app.inject({ method: "GET", url: offen.json<KartenPaketSicht>().datei });
            expect(datei.statusCode).toBe(200);
            expect(namenIm(datei.rawPayload)).toContain("LIZENZ.txt");
            expect((await mitWert(KARTEN_API_URL, schluesselWert)).statusCode).toBe(200);
            expect((await mitWert(`${KARTEN_API_URL}/modern.zip`, schluesselWert)).statusCode).toBe(200);

            // Schreiben nur in die neue Tafel: bis dahin eine klare Absage, kein 500 und nichts, was beim Umschalten verloren ginge.
            const anlegen = await post(`${KARTEN_EXPORT_URL}/zugaenge`, betreiber.cookie, {
                art: "link",
                fuerWen: "Probe",
                tage: 7,
                karten: ["modern"],
            });
            expect([anlegen.statusCode, fehlerCode(anlegen)]).toEqual([503, "karten_zugang_umzug"]);
            for (const handlung of ["weg", "neu"]) {
                const antwort = await post(`${KARTEN_EXPORT_URL}/zugaenge/${altLink}/${handlung}`, betreiber.cookie);
                expect([antwort.statusCode, fehlerCode(antwort)]).toEqual([503, "karten_zugang_umzug"]);
            }

            await runKartenSvg(lauf({ art: "standard" }), mitJobs);
            expect(await abzuege()).toContain(EIGEN);

            // Der Server fing nichts ab: kein Rechtefehler im Protokoll der Datenbank.
            expect((await readFile(cluster.logFile, "utf8")).slice(protokollVorher)).not.toMatch(/permission denied/u);
        } finally {
            await cluster.regrant();
            if (vorher === undefined) delete process.env["TILE_ROOT"];
            else process.env["TILE_ROOT"] = vorher;
        }

        // Mit den Rechten gilt ohne Neustart die neue Tafel: Eine Zeile nur in der alten gilt nicht mehr, Anlegen geht wieder.
        expect((await mitWert(`${KARTEN_PAKET_URL}/oeffnen`, linkWert)).statusCode).toBe(410);
        const wieder = await post(`${KARTEN_EXPORT_URL}/zugaenge`, betreiber.cookie, {
            art: "link",
            fuerWen: "Probe",
            tage: 7,
            karten: ["modern"],
        });
        expect(wieder.statusCode).toBe(200);
        process.env["TILE_ROOT"] = join(wurzel, "tiles");
        try {
            await runKartenSvg(lauf({ art: "standard" }), mitJobs);
            expect(await abzuege()).not.toContain(EIGEN);
        } finally {
            if (vorher === undefined) delete process.env["TILE_ROOT"];
            else process.env["TILE_ROOT"] = vorher;
        }
        // Die Jobs-Rolle sieht die Tafel nie, nur die Funktion; die App liest, legt an und ändert, löscht nie.
        expect(
            await cluster.codesAs(cluster.jobs, [
                "SELECT 1 FROM avesmaps_auth.karten_zugang LIMIT 1",
                "SELECT avesmaps_auth.karten_zugang_karten()",
            ]),
        ).toEqual(["42501", "ok"]);
        expect(
            await cluster.codesAs(cluster.app, [
                "SELECT 1 FROM avesmaps_auth.karten_zugang LIMIT 1",
                "DELETE FROM avesmaps_auth.karten_zugang WHERE false",
                "SELECT avesmaps_auth.karten_zugang_karten()",
            ]),
        ).toEqual(["ok", "42501", "42501"]);
    });
});
