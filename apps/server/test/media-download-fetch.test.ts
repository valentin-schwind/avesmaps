import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DownloadStore, sha256Hex } from "../src/migration/media-download.ts";
import { fetchMissingFiles, importFromUploadsCopy, legacyFileUrl } from "../src/migration/media-fetch.ts";
import { coatPng, coatSvg, coverJpeg } from "./support/media-files-fixture.ts";

/**
 * Das Download-Fach und der Abruf (WI-0063 MEDIA-M9): Der Abruf ist gebaut und hier gegen einen ECHTEN, aber lokalen Server geprüft
 * (127.0.0.1, im Test gestartet), nie gegen Legacy. Geprüft wird, dass er nur `/uploads/…` auf der Basisadresse holt, nichts verfolgt,
 * nichts Fremdes schickt, nacheinander arbeitet, bei Überlast aufhört und nur Fehlendes oder Geändertes überträgt.
 */

interface Seen {
    url: string;
    headers: IncomingHttpHeaders;
}

describe("Download-Fach und Abruf", () => {
    let server: Server;
    let base: string;
    let directory: string;
    let seen: Seen[];
    let files: Map<string, { body: Buffer; type: string; etag?: string }>;
    let handler: (
        url: string,
        request: IncomingHttpHeaders,
        respond: (status: number, headers: Record<string, string>, body?: Buffer) => void,
    ) => boolean;

    beforeAll(async () => {
        server = createServer((request, response) => {
            const url = request.url ?? "";
            seen.push({ url, headers: request.headers });
            const respond = (status: number, headers: Record<string, string>, body?: Buffer): void => {
                response.writeHead(status, headers);
                response.end(body);
            };
            if (handler(url, request.headers, respond)) return;
            const file = files.get(url);
            if (file === undefined) return respond(404, { "content-type": "text/plain" }, Buffer.from("nicht da"));
            if (file.etag !== undefined && request.headers["if-none-match"] === file.etag)
                return respond(304, { etag: file.etag });
            respond(
                200,
                {
                    "content-type": file.type,
                    ...(file.etag === undefined ? {} : { etag: file.etag }),
                    "last-modified": "Thu, 16 Jul 2026 23:38:54 GMT",
                },
                file.body,
            );
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(async () => {
        seen = [];
        files = new Map();
        handler = () => false;
        directory = await mkdtemp(join(tmpdir(), "avesmaps3d-download-"));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    const noPause = { delayMs: 0, sleep: () => Promise.resolve() };
    const open = () => DownloadStore.open(directory);

    it("holt nur, was fehlt, legt die Bytes unverändert unter ihrem SHA-256-Namen ab und führt die Liste", async () => {
        const png = await coatPng(1);
        const svg = coatSvg(2);
        const jpg = await coverJpeg(3);
        files.set("/uploads/wappen/a.png", { body: png, type: "image/png", etag: '"a"' });
        files.set("/uploads/wappen/b.svg", { body: svg, type: "image/svg+xml" });
        files.set("/uploads/questcovers/c.jpg", { body: jpg, type: "image/jpeg" });
        const store = await open();
        const report = await fetchMissingFiles(
            ["/uploads/wappen/a.png", "/uploads/wappen/b.svg", "/uploads/questcovers/c.jpg"],
            store,
            {
                baseUrl: base,
                ...noPause,
            },
        );
        expect(report).toMatchObject({
            requested: 3,
            fetched: 3,
            notModified: 0,
            alreadyPresent: 0,
            refused: [],
            failed: [],
            aborted: null,
        });
        expect(report.bytes).toBe(png.byteLength + svg.byteLength + jpg.byteLength);
        await store.writeListing("zug-1", { zug: "Test", basis: base, fetchedAt: "2026-10-05T00:00:00.000Z" });

        const reopened = await open();
        expect(reopened.size()).toBe(3);
        const entry = reopened.entryFor("/uploads/wappen/a.png");
        expect(entry).toMatchObject({ status: 200, sha256: sha256Hex(png), etag: '"a"', bytes: png.byteLength });
        expect(entry?.stored).toBe(
            `sha256/${sha256Hex(png).slice(0, 2)}/${sha256Hex(png).slice(2, 4)}/${sha256Hex(png)}.png`,
        );
        // Die Endung kommt aus den Bytes (SVG, JPEG), nie aus dem Namen der Adresse.
        expect(reopened.entryFor("/uploads/wappen/b.svg")?.stored.endsWith(".svg")).toBe(true);
        expect(reopened.entryFor("/uploads/questcovers/c.jpg")?.stored.endsWith(".jpg")).toBe(true);
        expect((await readFile(join(directory, entry?.stored as string))).equals(png)).toBe(true);

        // Ein zweiter Zug fragt nichts mehr an, was schon da ist.
        seen.length = 0;
        const second = await fetchMissingFiles(["/uploads/wappen/a.png", "/uploads/wappen/b.svg"], reopened, {
            baseUrl: base,
            ...noPause,
        });
        expect(second).toMatchObject({ fetched: 0, alreadyPresent: 2 });
        expect(seen).toEqual([]);
    });

    it("mit refresh fragt er bedingt nach: unverändert kostet keine Bytes, geändert wird ersetzt", async () => {
        const first = await coatPng(10);
        files.set("/uploads/wappen/a.png", { body: first, type: "image/png", etag: '"v1"' });
        files.set("/uploads/wappen/b.png", { body: await coatPng(11), type: "image/png" });
        const store = await open();
        await fetchMissingFiles(["/uploads/wappen/a.png", "/uploads/wappen/b.png"], store, {
            baseUrl: base,
            ...noPause,
        });
        seen.length = 0;

        const unchanged = await fetchMissingFiles(["/uploads/wappen/a.png"], store, {
            baseUrl: base,
            refresh: true,
            ...noPause,
        });
        expect(unchanged).toMatchObject({ notModified: 1, fetched: 0, bytes: 0 });
        expect(seen[0]?.headers["if-none-match"]).toBe('"v1"');

        const next = await coatPng(12);
        files.set("/uploads/wappen/a.png", { body: next, type: "image/png", etag: '"v2"' });
        const changed = await fetchMissingFiles(["/uploads/wappen/a.png"], store, {
            baseUrl: base,
            refresh: true,
            ...noPause,
        });
        expect(changed).toMatchObject({ fetched: 1, notModified: 0 });
        expect(store.entryFor("/uploads/wappen/a.png")).toMatchObject({ sha256: sha256Hex(next), etag: '"v2"' });
        // Ohne ETag fragt er mit Last-Modified nach.
        seen.length = 0;
        await fetchMissingFiles(["/uploads/wappen/b.png"], store, { baseUrl: base, refresh: true, ...noPause });
        expect(seen[0]?.headers["if-modified-since"]).toBe("Thu, 16 Jul 2026 23:38:54 GMT");
    });

    it("holt nur lokale Legacy-Dateien: jede andere Adresse wird abgewiesen, ohne dass eine Anfrage hinausgeht", async () => {
        const store = await open();
        const report = await fetchMissingFiles(
            [
                "https://de.wiki-aventurica.de/images/a.png",
                "/etc/passwd",
                "/uploads/../geheim.png",
                "/images/a.png",
                "/uploads/a\\b.png",
                "//evil.invalid/uploads/a.png",
                "/uploads/a.png#x",
            ],
            store,
            { baseUrl: base, ...noPause },
        );
        expect(report.refused).toHaveLength(7);
        expect(report.fetched + report.failed.length).toBe(0);
        expect(seen).toEqual([]);
    });

    it("die Basisadresse muss https sein (oder ein lokaler Entwicklungsrechner); Pfad und Ursprung bleiben, wie sie sind", () => {
        expect(legacyFileUrl("/uploads/a.png", "https://avesmaps.de")?.href).toBe("https://avesmaps.de/uploads/a.png");
        expect(legacyFileUrl("/uploads/a.png", "http://avesmaps.de")).toBeNull();
        expect(legacyFileUrl("/uploads/a.png", "http://127.0.0.1:3000")?.href).toBe(
            "http://127.0.0.1:3000/uploads/a.png",
        );
        expect(legacyFileUrl("/uploads/a b.png", "https://avesmaps.de")).toBeNull();
        expect(legacyFileUrl("/uploads/../a.png", "https://avesmaps.de")).toBeNull();
        // Ein Cache-Stempel am Pfad wird nie mitgeholt.
        expect(legacyFileUrl("/uploads/wappen/a-custom.png?v=1786648684", "https://avesmaps.de")?.href).toBe(
            "https://avesmaps.de/uploads/wappen/a-custom.png",
        );
    });

    it("folgt keiner Weiterleitung (sie wäre ein Weg zu einem fremden Ziel)", async () => {
        handler = (url, _headers, respond) => {
            if (url === "/uploads/wappen/r.png") {
                respond(302, { location: `${base}/uploads/wappen/ziel.png` });
                return true;
            }
            return false;
        };
        files.set("/uploads/wappen/ziel.png", { body: await coatPng(1), type: "image/png" });
        const report = await fetchMissingFiles(["/uploads/wappen/r.png"], await open(), { baseUrl: base, ...noPause });
        expect(report.refused).toHaveLength(1);
        expect(report.fetched).toBe(0);
        expect(seen.map((entry) => entry.url)).toEqual(["/uploads/wappen/r.png"]);
    });

    it("sendet weder Cookie noch Anmeldung: anonym und öffentlich, wie ein Besucher", async () => {
        files.set("/uploads/wappen/a.png", { body: await coatPng(1), type: "image/png" });
        await fetchMissingFiles(["/uploads/wappen/a.png"], await open(), { baseUrl: base, ...noPause });
        expect(Object.keys(seen[0]?.headers ?? {})).not.toEqual(expect.arrayContaining(["cookie"]));
        expect(seen[0]?.headers["authorization"]).toBeUndefined();
        expect(seen[0]?.headers["cookie"]).toBeUndefined();
    });

    it("arbeitet nacheinander mit Pause und hört bei 429 oder 503 auf: ein überlasteter Server bekommt nichts mehr", async () => {
        for (const name of ["a", "b", "c", "d"])
            files.set(`/uploads/wappen/${name}.png`, { body: Buffer.from(name), type: "image/png" });
        const pauses: number[] = [];
        handler = (url, _headers, respond) => {
            if (url === "/uploads/wappen/c.png") {
                respond(503, { "retry-after": "30" });
                return true;
            }
            return false;
        };
        const report = await fetchMissingFiles(
            ["/uploads/wappen/a.png", "/uploads/wappen/b.png", "/uploads/wappen/c.png", "/uploads/wappen/d.png"],
            await open(),
            { baseUrl: base, delayMs: 350, sleep: (ms) => (pauses.push(ms), Promise.resolve()) },
        );
        expect(report.fetched).toBe(2);
        expect(report.aborted).toContain("HTTP 503");
        expect(seen.map((entry) => entry.url)).toEqual([
            "/uploads/wappen/a.png",
            "/uploads/wappen/b.png",
            "/uploads/wappen/c.png",
        ]);
        // Eine Pause zwischen zwei Abrufen, nie danach und nie davor (der dritte war schon der Abbruch).
        expect(pauses).toEqual([350, 350]);
    });

    it("ein Fehler (404) ist ein Befund, kein Abbruch: die übrigen werden geholt", async () => {
        files.set("/uploads/wappen/b.png", { body: await coatPng(2), type: "image/png" });
        const report = await fetchMissingFiles(["/uploads/wappen/fehlt.png", "/uploads/wappen/b.png"], await open(), {
            baseUrl: base,
            ...noPause,
        });
        expect(report.fetched).toBe(1);
        expect(report.failed).toEqual([{ url: "/uploads/wappen/fehlt.png", reason: "HTTP 404" }]);
        expect(report.aborted).toBeNull();
    });

    it("eine zu große Antwort wird abgebrochen und nicht abgelegt (Kopf und Strom)", async () => {
        files.set("/uploads/wappen/gross.png", { body: Buffer.alloc(2048, 1), type: "image/png" });
        handler = (url, _headers, respond) => {
            if (url === "/uploads/wappen/strom.png") {
                // Ohne Content-Length (chunked): die Grenze greift beim Lesen.
                respond(200, { "content-type": "image/png", "transfer-encoding": "chunked" }, Buffer.alloc(4096, 2));
                return true;
            }
            return false;
        };
        const store = await open();
        const report = await fetchMissingFiles(["/uploads/wappen/gross.png", "/uploads/wappen/strom.png"], store, {
            baseUrl: base,
            maxBytes: 1024,
            ...noPause,
        });
        expect(report.fetched).toBe(0);
        expect(report.failed.map((entry) => entry.url)).toEqual([
            "/uploads/wappen/gross.png",
            "/uploads/wappen/strom.png",
        ]);
        expect(store.size()).toBe(0);
    });

    describe("Kopie von uploads/ (vom Betreiber bereitgestellt, nur lesen)", () => {
        const putFile = async (relative: string, bytes: Buffer): Promise<void> => {
            const target = join(directory, "uploads-kopie", relative);
            await mkdir(join(target, ".."), { recursive: true });
            await writeFile(target, bytes);
        };

        it("übernimmt, was das Manifest nennt, unverändert und nach SHA-256 benannt; fehlendes wird genannt, schon Vorhandenes nicht neu gelesen", async () => {
            const png = await coatPng(21);
            await putFile("wappen/a.png", png);
            await putFile("siedlungen/x/b.webp", await coverJpeg(22));
            const store = await open();
            const report = await importFromUploadsCopy(
                [
                    "/uploads/wappen/a.png",
                    "/uploads/siedlungen/x/b.webp",
                    "/uploads/wappen/fehlt.png",
                    "/uploads/wappen/a-custom.png?v=1786648684",
                ],
                store,
                join(directory, "uploads-kopie"),
            );
            expect(report).toMatchObject({
                requested: 4,
                copied: 2,
                alreadyPresent: 0,
                missing: ["/uploads/wappen/a-custom.png", "/uploads/wappen/fehlt.png"].sort(),
                refused: [],
            });
            expect(store.entryFor("/uploads/wappen/a.png")).toMatchObject({
                sha256: sha256Hex(png),
                status: 200,
                bytes: png.byteLength,
            });
            // Die Endung kommt aus den Bytes (hier ein JPEG unter dem Namen .webp).
            expect(store.entryFor("/uploads/siedlungen/x/b.webp")?.stored.endsWith(".jpg")).toBe(true);
            const second = await importFromUploadsCopy(
                ["/uploads/wappen/a.png"],
                store,
                join(directory, "uploads-kopie"),
            );
            expect(second).toMatchObject({ copied: 0, alreadyPresent: 1 });
        });

        it("liest nichts außerhalb der Kopie und folgt keiner Verknüpfung: .., absolute Pfade, Verzeichnisse", async () => {
            await writeFile(join(directory, "geheim.png"), await coatPng(23));
            await mkdir(join(directory, "uploads-kopie", "ordner.png"), { recursive: true });
            const report = await importFromUploadsCopy(
                ["/uploads/../geheim.png", "/etc/passwd", "https://fremd.invalid/uploads/a.png", "/uploads/ordner.png"],
                await open(),
                join(directory, "uploads-kopie"),
            );
            expect(report.copied).toBe(0);
            expect(report.refused.map((entry) => entry.url).sort()).toEqual(
                [
                    "/etc/passwd",
                    "/uploads/../geheim.png",
                    "/uploads/ordner.png",
                    "https://fremd.invalid/uploads/a.png",
                ].sort(),
            );
        });

        it("eine zu große Datei der Kopie wird nicht gelesen", async () => {
            await putFile("wappen/gross.png", Buffer.alloc(2048, 3));
            const report = await importFromUploadsCopy(
                ["/uploads/wappen/gross.png"],
                await open(),
                join(directory, "uploads-kopie"),
                { maxBytes: 1024 },
            );
            expect(report.copied).toBe(0);
            expect(report.refused).toHaveLength(1);
        });
    });

    describe("DownloadStore.read", () => {
        const sampleListing = (entries: unknown[]) => ({
            zug: "Test",
            satz: "x",
            abgerufen_am: "2026-10-04T11:07:20.488Z",
            basis: "https://avesmaps.de",
            anzahl: entries.length,
            ok: entries.length,
            fehler: 0,
            eintraege: entries,
        });

        it("liest die Liste des ersten Zuges (deutsche Schlüssel) und nimmt den Cache-Stempel von der Adresse", async () => {
            const bytes = await coatPng(5);
            const sha = sha256Hex(bytes);
            const stored = `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.png`;
            await mkdir(join(directory, "sha256", sha.slice(0, 2), sha.slice(2, 4)), { recursive: true });
            await writeFile(join(directory, stored), bytes);
            await writeFile(
                join(directory, "manifest-161832.json"),
                JSON.stringify(
                    sampleListing([
                        {
                            klass: "territory_coat",
                            subject: "x",
                            url: "/uploads/wappen/a-custom.png?v=1786648684",
                            position: 0,
                            status: 200,
                            content_type: "image/png",
                            bytes: bytes.byteLength,
                            sha256: sha,
                            etag: '"1"',
                            last_modified: "Fri, 10 Jul 2026 09:15:20 GMT",
                            stored,
                        },
                    ]),
                ),
            );
            const store = await open();
            const result = await store.read("/uploads/wappen/a-custom.png", 1_000_000);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.file.bytes.equals(bytes)).toBe(true);
                expect(result.file.entry).toMatchObject({
                    etag: '"1"',
                    lastModified: "Fri, 10 Jul 2026 09:15:20 GMT",
                    fetchedAt: "2026-10-04T11:07:20.488Z",
                });
            }
        });

        it("meldet, warum eine Datei fehlt: nicht gelistet, Status, Datei, Größe, SHA-256", async () => {
            const bytes = Buffer.from("echt");
            const sha = sha256Hex(bytes);
            const stored = `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.png`;
            await mkdir(join(directory, "sha256", sha.slice(0, 2), sha.slice(2, 4)), { recursive: true });
            await writeFile(join(directory, stored), Buffer.from("verändert"));
            const row = (url: string, extra: Record<string, unknown> = {}) => ({
                url,
                status: 200,
                content_type: "image/png",
                bytes: 4,
                sha256: sha,
                stored,
                ...extra,
            });
            await writeFile(
                join(directory, "manifest-x.json"),
                JSON.stringify(
                    sampleListing([
                        row("/uploads/a.png"),
                        row("/uploads/b.png", { status: 404 }),
                        row("/uploads/c.png", { stored: `sha256/00/00/${"0".repeat(64)}.png`, sha256: "0".repeat(64) }),
                    ]),
                ),
            );
            const store = await open();
            expect(await store.read("/uploads/unbekannt.png", 100)).toEqual({
                ok: false,
                miss: { kind: "not_listed" },
            });
            expect(await store.read("/uploads/b.png", 100)).toEqual({
                ok: false,
                miss: { kind: "not_ok", status: 404 },
            });
            expect(await store.read("/uploads/c.png", 100)).toEqual({ ok: false, miss: { kind: "file_missing" } });
            expect(await store.read("/uploads/a.png", 3)).toEqual({
                ok: false,
                miss: { kind: "too_large", size: Buffer.byteLength("verändert") },
            });
            const mismatch = await store.read("/uploads/a.png", 100);
            expect(mismatch).toMatchObject({ ok: false, miss: { kind: "hash_mismatch", expected: sha } });
        });

        it("ein Ablageort, der nicht aus dem Hash abgeleitet ist oder den Ordner verlassen will, ist keine Zeile der Liste", async () => {
            const sha = "a".repeat(64);
            await writeFile(
                join(directory, "manifest-x.json"),
                JSON.stringify(
                    sampleListing([
                        { url: "/uploads/a.png", status: 200, sha256: sha, stored: "../../etc/passwd" },
                        {
                            url: "/uploads/b.png",
                            status: 200,
                            sha256: sha,
                            stored: `sha256/aa/aa/${"b".repeat(64)}.png`,
                        },
                        { url: "/uploads/c.png", status: 200, sha256: sha, stored: `/sha256/aa/aa/${sha}.png` },
                        {
                            url: "https://fremd.invalid/x.png",
                            status: 200,
                            sha256: sha,
                            stored: `sha256/aa/aa/${sha}.png`,
                        },
                    ]),
                ),
            );
            expect((await open()).size()).toBe(0);
        });

        it("bei derselben Adresse gilt der spätere Abruf", async () => {
            const sha1 = "1".repeat(64);
            const sha2 = "2".repeat(64);
            const row = (sha: string, at: string) => ({
                url: "/uploads/a.png",
                status: 200,
                sha256: sha,
                stored: `sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.png`,
                abgerufen_am: at,
            });
            await writeFile(
                join(directory, "manifest-a.json"),
                JSON.stringify(sampleListing([row(sha2, "2026-10-05T00:00:00Z")])),
            );
            await writeFile(
                join(directory, "manifest-b.json"),
                JSON.stringify(sampleListing([row(sha1, "2026-10-04T00:00:00Z")])),
            );
            expect((await open()).entryFor("/uploads/a.png")?.sha256).toBe(sha2);
        });

        it("ein Ordner, den es nicht gibt, ist ein leeres Fach, kein Fehler", async () => {
            expect((await DownloadStore.open(join(directory, "gibt-es-nicht"))).size()).toBe(0);
        });
    });
});
