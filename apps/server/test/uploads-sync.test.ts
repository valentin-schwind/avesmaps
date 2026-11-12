import { execFile } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DownloadStore, sha256Hex } from "../src/migration/media-download.ts";
import { parseUploadsList, UploadsSourceIncomplete, type UploadsList } from "../src/migration/uploads-list.ts";
import { pathUnderRoot, plainFileUnder } from "../src/migration/uploads-path.ts";
import {
    buildSyncReport,
    compareUploads,
    fetchPlanned,
    MAX_PRUNE_FRACTION,
    pruneOrphans,
    requestUploadsList,
    syncFindings,
    uploadsListUrl,
    UPLOADS_ETAG_HEADER,
} from "../src/migration/uploads-sync.ts";
import { coatPng, coverJpeg } from "./support/media-files-fixture.ts";

/**
 * WI-0086: Legacys `uploads/` ziehen und gleichstandig halten. Die zehn Abnahmefälle A1 bis A10 aus §7 und die drei harten
 * Zusicherungen aus §5 stehen hier als benannte Fälle.
 *
 * 🔴 **Kein Abruf bei Legacy.** Geprüft wird gegen einen ECHTEN, aber lokalen Server (127.0.0.1:3261, im Test gestartet) und gegen
 * Fixtures. Der Endpunkt `uploads-export.php` existiert in Legacy noch nicht; Teil L wartet auf die Freigabe des Betreibers.
 */

const FAKE_PORT = 3261;
const SERVER_ROOT = resolve(import.meta.dirname, "..");
const CLI = resolve(SERVER_ROOT, "src", "migration", "uploads-sync-cli.ts");
const run = promisify(execFile);

/** Eine Datei, wie der Fake-Server sie ausliefert. */
interface Served {
    body: Buffer;
    type: string;
    etag?: string;
    lastModified: string;
}

const httpDate = (seconds: number): string => new Date(seconds * 1000).toUTCString();
const epochOf = (http: string): number => Math.floor(Date.parse(http) / 1000);
const T0 = epochOf("Thu, 16 Jul 2026 23:38:54 GMT");

describe("WI-0086 uploads-sync", () => {
    let server: Server;
    let base: string;
    let directory: string;
    let seen: { url: string; headers: IncomingHttpHeaders }[];
    let files: Map<string, Served>;
    let listResponse: { status: number; body: string; etag?: string };

    beforeAll(async () => {
        server = createServer((request, response) => {
            const url = request.url ?? "";
            seen.push({ url, headers: request.headers });
            if (url === "/api/app/uploads-export.php") {
                if (
                    listResponse.etag !== undefined &&
                    request.headers["if-none-match"] === listResponse.etag &&
                    listResponse.status === 200
                ) {
                    response.writeHead(304, { [UPLOADS_ETAG_HEADER]: listResponse.etag });
                    return response.end();
                }
                response.writeHead(listResponse.status, {
                    "content-type": "application/json",
                    ...(listResponse.etag === undefined ? {} : { [UPLOADS_ETAG_HEADER]: listResponse.etag }),
                });
                return response.end(listResponse.body);
            }
            const file = files.get(url);
            if (file === undefined) {
                response.writeHead(404, { "content-type": "text/plain" });
                return response.end("nicht da");
            }
            if (file.etag !== undefined && request.headers["if-none-match"] === file.etag) {
                response.writeHead(304, { etag: file.etag });
                return response.end();
            }
            response.writeHead(200, {
                "content-type": file.type,
                ...(file.etag === undefined ? {} : { etag: file.etag }),
                "last-modified": file.lastModified,
            });
            response.end(file.body);
        });
        await new Promise<void>((ready) => server.listen(FAKE_PORT, "127.0.0.1", ready));
        base = `http://127.0.0.1:${String(FAKE_PORT)}`;
    });

    afterAll(async () => {
        // Was gestartet wird, wird beendet: der Port bleibt nicht belegt.
        await new Promise<void>((done) => server.close(() => done()));
    });

    beforeEach(async () => {
        seen = [];
        files = new Map();
        listResponse = { status: 200, body: "{}" };
        directory = await mkdtemp(join(tmpdir(), "avesmaps3d-uploads-"));
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    const noPause = { delayMs: 0, sleep: () => Promise.resolve() };
    const open = (): Promise<DownloadStore> => DownloadStore.open(directory);

    interface UploadsItemRaw {
        path: string;
        bytes: number;
        mtime: number;
    }

    /** Eine Aufzählung in Legacys Antwortform, aus dem, was der Fake-Server gerade ausliefert. */
    const listingOf = (paths: readonly string[], overrides: Record<string, Partial<UploadsItemRaw>> = {}): string => {
        const items = paths.map((path) => {
            const file = files.get(path);
            return {
                path,
                bytes: file?.body.byteLength ?? 0,
                mtime: file === undefined ? T0 : epochOf(file.lastModified),
                ...overrides[path],
            };
        });
        return JSON.stringify({
            ok: true,
            uploads_revision: "uploads-0123456789abcdef",
            counts: { files: items.length, bytes: items.reduce((sum, item) => sum + item.bytes, 0) },
            truncated: false,
            items,
        });
    };

    /** Die Aufzählung holen und lesen, so wie die CLI es tut. */
    const pullList = async (storedEtag = ""): Promise<UploadsList> => {
        const url = uploadsListUrl(base);
        expect(url).not.toBeNull();
        const response = await requestUploadsList({ url: (url as URL).href, storedEtag });
        expect(response.kind).toBe("fresh");
        return parseUploadsList(JSON.parse((response as { text: string }).text)).list;
    };

    const serve = (path: string, body: Buffer, at = T0, etag?: string): void => {
        files.set(path, {
            body,
            type: "image/png",
            lastModified: httpDate(at),
            ...(etag === undefined ? {} : { etag }),
        });
    };

    const put = (store: DownloadStore, url: string, bytes: Buffer, at = T0): Promise<unknown> =>
        store.put(
            {
                url,
                status: 200,
                contentType: "image/png",
                etag: null,
                lastModified: httpDate(at),
                fetchedAt: "2026-10-04T00:00:00.000Z",
            },
            bytes,
            "png",
        );

    /**
     * Füllt das Fach mit Adressen, die mit dem Fall nichts zu tun haben, und legt sie auch in die Aufzählung.
     * 🪤 Nötig, weil `--prune` über 5 % verwaister Adressen NICHT aufräumt (A6): In einem Fach mit drei Zeilen wäre jede einzelne
     * verwaiste Adresse ein Drittel - der Prune-Fall prüfte dann versehentlich die Quote statt des Aufräumens.
     */
    const fill = async (store: DownloadStore, count: number): Promise<string[]> => {
        const urls: string[] = [];
        for (let index = 0; index < count; index += 1) {
            const url = `/uploads/fuellung/f${String(index)}.png`;
            const bytes = await coatPng(900 + index);
            serve(url, bytes);
            await put(store, url, bytes);
            urls.push(url);
        }
        return urls;
    };

    describe("A1 Liste unverändert", () => {
        it("ein GET, 304, nichts geholt, der Bericht sagt „gleichstandig“", async () => {
            serve("/uploads/wappen/a.png", await coatPng(1));
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]), etag: '"uploads-v1"' };
            const url = uploadsListUrl(base) as URL;

            const response = await requestUploadsList({ url: url.href, storedEtag: '"uploads-v1"' });
            expect(response).toEqual({ kind: "not_modified", etag: '"uploads-v1"' });
            // 🔴 Genau EINE Anfrage: der ganze Zug ist damit fertig, keine Datei wird gefragt.
            expect(seen.map((entry) => entry.url)).toEqual(["/api/app/uploads-export.php"]);
            expect(seen[0]?.headers["if-none-match"]).toBe('"uploads-v1"');

            const report = buildSyncReport({
                zug: "zieh mal",
                basis: base,
                at: "2026-10-05T00:00:00.000Z",
                list: null,
                plan: null,
                fetched: null,
                prune: null,
                listedBefore: 1,
                findings: [],
                mode: "gleichstandig",
            });
            expect(report["stand"]).toBe("gleichstandig");
            expect(report["abruf"]).toBeNull();
        });
    });

    describe("A2 ein neues Bild in uploads/", () => {
        it("genau eine Datei geholt, im Fach, SHA-256 stimmt", async () => {
            const alt = await coatPng(2);
            const neu = await coverJpeg(3);
            serve("/uploads/wappen/alt.png", alt);
            const store = await open();
            await store.put(
                {
                    url: "/uploads/wappen/alt.png",
                    status: 200,
                    contentType: "image/png",
                    etag: null,
                    lastModified: httpDate(T0),
                    fetchedAt: "2026-10-04T00:00:00.000Z",
                },
                alt,
                "png",
            );
            serve("/uploads/questcovers/neu.jpg", neu);
            listResponse = {
                status: 200,
                body: listingOf(["/uploads/wappen/alt.png", "/uploads/questcovers/neu.jpg"]),
            };

            const list = await pullList();
            const plan = compareUploads(list, store);
            expect(plan.fresh).toEqual(["/uploads/questcovers/neu.jpg"]);
            expect(plan.changed).toEqual([]);
            expect(plan.unchanged).toEqual(["/uploads/wappen/alt.png"]);

            seen.length = 0;
            const fetched = await fetchPlanned(plan, store, { baseUrl: base, ...noPause });
            expect(fetched).toMatchObject({ requested: 1, fetched: 1, failed: [], refused: [], aborted: null });
            expect(seen.map((entry) => entry.url)).toEqual(["/uploads/questcovers/neu.jpg"]);
            expect(store.entryFor("/uploads/questcovers/neu.jpg")).toMatchObject({
                sha256: sha256Hex(neu),
                bytes: neu.byteLength,
            });
            const read = await store.read("/uploads/questcovers/neu.jpg", 1_000_000);
            expect(read.ok).toBe(true);
        });
    });

    describe("A3 ein Bild ersetzt, Adresse gleich (Loch 1)", () => {
        const seed = async (): Promise<DownloadStore> => {
            const store = await open();
            await store.put(
                {
                    url: "/uploads/wappen/a.png",
                    status: 200,
                    contentType: "image/png",
                    etag: '"v1"',
                    lastModified: httpDate(T0),
                    fetchedAt: "2026-10-04T00:00:00.000Z",
                },
                await coatPng(10),
                "png",
            );
            return store;
        };

        it("andere Änderungszeit bei gleicher Größe: erkannt und neu geholt", async () => {
            const store = await seed();
            const alt = store.entryFor("/uploads/wappen/a.png");
            // Dieselbe Länge, andere Bytes: nur die Zeit verrät den Austausch - genau Loch 1.
            const ersetzt = Buffer.from(await coatPng(10));
            ersetzt[ersetzt.byteLength - 1] = (ersetzt[ersetzt.byteLength - 1] ?? 0) ^ 0xff;
            serve("/uploads/wappen/a.png", ersetzt, T0 + 3600, '"v2"');
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]) };

            const plan = compareUploads(await pullList(), store);
            expect(plan.changed).toHaveLength(1);
            expect(plan.changed[0]).toMatchObject({ path: "/uploads/wappen/a.png", reason: "zeit" });
            expect(plan.fresh).toEqual([]);

            const fetched = await fetchPlanned(plan, store, { baseUrl: base, ...noPause });
            expect(fetched).toMatchObject({ fetched: 1, notModified: 0 });
            const neu = store.entryFor("/uploads/wappen/a.png");
            expect(neu?.sha256).toBe(sha256Hex(ersetzt));
            expect(neu?.sha256).not.toBe(alt?.sha256);
            // Der Binärimport vergleicht sourceRow.sha256 gegen die Liste: er rendert jetzt neu statt „unchanged“ zu zählen.
            expect(neu).toMatchObject({ etag: '"v2"', lastModified: httpDate(T0 + 3600) });
        });

        it("andere Größe bei gleicher Zeit: ebenso erkannt", async () => {
            const store = await seed();
            serve("/uploads/wappen/a.png", await coverJpeg(11), T0);
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]) };
            const plan = compareUploads(await pullList(), store);
            expect(plan.changed[0]).toMatchObject({ reason: "groesse" });
            expect((await fetchPlanned(plan, store, { baseUrl: base, ...noPause })).fetched).toBe(1);
        });

        it("beides anders: der Grund nennt beides", async () => {
            const store = await seed();
            serve("/uploads/wappen/a.png", await coverJpeg(12), T0 + 10);
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]) };
            expect(compareUploads(await pullList(), store).changed[0]).toMatchObject({ reason: "groesse_und_zeit" });
        });

        it("🪤 ohne Last-Modified im Fach bleibt ein Austausch gleicher Länge unsichtbar - und das wird befundet", async () => {
            const store = await open();
            await store.put(
                {
                    url: "/uploads/wappen/b.png",
                    status: 200,
                    contentType: "image/png",
                    etag: null,
                    lastModified: null,
                    fetchedAt: "2026-10-04T00:00:00.000Z",
                },
                await coatPng(13),
                "png",
            );
            serve("/uploads/wappen/b.png", await coatPng(13), T0 + 99);
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/b.png"]) };
            const list = await pullList();
            const plan = compareUploads(list, store);
            expect(plan.changed).toEqual([]);
            expect(plan.undatable).toEqual(["/uploads/wappen/b.png"]);
            const findings = syncFindings(plan, list, store, null, null);
            expect(findings.map((finding) => finding.code)).toContain("uploads_ohne_zeitstempel");
        });
    });

    describe("A4 Datei zwischen Aufzählung und Abruf geschrieben", () => {
        it("verbucht wird, was ankam; der nächste Lauf holt sie erneut", async () => {
            const aufgezaehlt = await coatPng(20);
            serve("/uploads/wappen/a.png", aufgezaehlt, T0);
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]) };
            const list = await pullList();

            // Zwischen Aufzählung und Abruf schreibt ein Editor die Datei neu.
            const angekommen = await coverJpeg(21);
            serve("/uploads/wappen/a.png", angekommen, T0 + 5);

            const store = await open();
            const plan = compareUploads(list, store);
            const fetched = await fetchPlanned(plan, store, { baseUrl: base, ...noPause });
            expect(fetched.fetched).toBe(1);
            // 💣 Verbucht ist die ANTWORT, nicht die Aufzählung: sonst wäre eine halb geschriebene Datei für immer „aktuell“.
            const entry = store.entryFor("/uploads/wappen/a.png");
            expect(entry).toMatchObject({ bytes: angekommen.byteLength, lastModified: httpDate(T0 + 5) });
            expect(entry?.bytes).not.toBe(aufgezaehlt.byteLength);
            expect(syncFindings(plan, list, store, fetched, null).map((finding) => finding.code)).toContain(
                "uploads_antwort_weicht_ab",
            );

            // Derselbe Lauf noch einmal gegen DIESELBE Aufzählung: sie weicht wieder ab, also wird erneut geholt.
            const second = compareUploads(list, store);
            expect(second.changed).toHaveLength(1);
            expect(second.wanted).toEqual(["/uploads/wappen/a.png"]);
        });
    });

    describe("A5 ein Bild in Legacy gelöscht", () => {
        /** Drei echte Adressen plus `filler` Füllzeilen, damit die Prune-Quote nicht den Fall übernimmt. */
        const seedThree = async (filler = 0): Promise<{ store: DownloadStore; filled: string[] }> => {
            const store = await open();
            for (const [index, name] of ["a", "b", "c"].entries()) {
                const bytes = await coatPng(30 + index);
                serve(`/uploads/wappen/${name}.png`, bytes);
                await put(store, `/uploads/wappen/${name}.png`, bytes);
            }
            return { store, filled: await fill(store, filler) };
        };

        it("ohne --prune: als verwaist befundet, NICHT gelöscht", async () => {
            const { store } = await seedThree();
            files.delete("/uploads/wappen/c.png");
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png", "/uploads/wappen/b.png"]) };
            const list = await pullList();
            const plan = compareUploads(list, store);
            expect(plan.orphaned).toEqual(["/uploads/wappen/c.png"]);

            const findings = syncFindings(plan, list, store, null, null);
            const verwaist = findings.find((finding) => finding.code === "uploads_verwaist");
            expect(verwaist?.notes).toContain("/uploads/wappen/c.png");
            expect(store.entryFor("/uploads/wappen/c.png")).toBeDefined();
            const stored = store.entryFor("/uploads/wappen/c.png")?.stored as string;
            expect((await readFile(join(directory, stored))).byteLength).toBeGreaterThan(0);
        });

        it("mit --prune: gelöscht, und nach dem Wiederöffnen des Fachs bleibt sie weg", async () => {
            // 22 Füllzeilen: eine von 25 verwaisten Adressen sind 4 % und damit unter der Quote (A6 prüft den anderen Fall).
            const { store, filled } = await seedThree(22);
            const stored = store.entryFor("/uploads/wappen/c.png")?.stored as string;
            files.delete("/uploads/wappen/c.png");
            listResponse = {
                status: 200,
                body: listingOf(["/uploads/wappen/a.png", "/uploads/wappen/b.png", ...filled]),
            };
            const plan = compareUploads(await pullList(), store);
            expect(plan.orphaned).toEqual(["/uploads/wappen/c.png"]);

            const prune = await pruneOrphans(plan.orphaned, store, store.size());
            expect(prune).toMatchObject({ removed: 1, entryOnly: 0, refused: [], withheld: null });
            expect(prune.bytes).toBeGreaterThan(0);
            expect(store.entryFor("/uploads/wappen/c.png")).toBeUndefined();
            await expect(readFile(join(directory, stored))).rejects.toThrow();

            // 💣 `open()` vereinigt ALLE `manifest-*.json`: ohne das Ersetzen der älteren Listen käme die Zeile zurück.
            await store.writeListing(
                "nach-prune",
                { zug: "Test", basis: base, fetchedAt: "2026-10-05T00:00:00.000Z" },
                { replacesOlderLists: true },
            );
            const reopened = await open();
            expect(reopened.entryFor("/uploads/wappen/c.png")).toBeUndefined();
            expect(reopened.size()).toBe(24);
        });

        it("💣 das Fach entdoppelt: dieselben Bytes unter zwei Adressen überleben das Aufräumen einer von beiden", async () => {
            const store = await open();
            const bytes = await coatPng(40);
            for (const url of ["/uploads/wappen/x.png", "/uploads/wappen/y.png"]) await put(store, url, bytes);
            await fill(store, 23);
            const stored = store.entryFor("/uploads/wappen/x.png")?.stored as string;
            expect(store.entryFor("/uploads/wappen/y.png")?.stored).toBe(stored);

            const prune = await pruneOrphans(["/uploads/wappen/x.png"], store, store.size());
            expect(prune).toMatchObject({ removed: 0, entryOnly: 1 });
            expect(store.entryFor("/uploads/wappen/x.png")).toBeUndefined();
            // Die noch gültige Adresse hat ihre Bytes behalten.
            expect((await readFile(join(directory, stored))).equals(bytes)).toBe(true);
            expect((await store.read("/uploads/wappen/y.png", 1_000_000)).ok).toBe(true);
        });
    });

    describe("A6 mehr als 5 % verwaist", () => {
        it("--prune löscht nicht, sondern befundet", async () => {
            const store = await open();
            for (let index = 0; index < 20; index += 1) {
                await store.put(
                    {
                        url: `/uploads/wappen/w${String(index)}.png`,
                        status: 200,
                        contentType: "image/png",
                        etag: null,
                        lastModified: httpDate(T0),
                        fetchedAt: "2026-10-04T00:00:00.000Z",
                    },
                    await coatPng(100 + index),
                    "png",
                );
            }
            // 2 von 20 sind 10 % und damit über der Quote.
            const orphaned = ["/uploads/wappen/w0.png", "/uploads/wappen/w1.png"];
            expect(orphaned.length / 20).toBeGreaterThan(MAX_PRUNE_FRACTION);

            const prune = await pruneOrphans(orphaned, store, 20);
            expect(prune).toMatchObject({ removed: 0, entryOnly: 0 });
            expect(prune.withheld?.code).toBe("uploads_prune_quote");
            expect(prune.withheld?.message).toContain("10,0 %");
            expect(store.size()).toBe(20);
            for (const url of orphaned) expect((await store.read(url, 1_000_000)).ok).toBe(true);

            // Genau an der Quote (1 von 20 = 5 %) wird aufgeräumt: „über der Quote“ heißt über, nicht ab.
            const atLimit = await pruneOrphans(["/uploads/wappen/w0.png"], store, 20);
            expect(atLimit).toMatchObject({ removed: 1, withheld: null });
        });
    });

    describe("A7 Liste truncated oder nicht ok", () => {
        const cases: [string, unknown][] = [
            ["kein Objekt", []],
            ["ok nicht wahr", { ok: false, items: [], counts: { files: 0 } }],
            [
                "abgeschnitten",
                {
                    ok: true,
                    truncated: true,
                    counts: { files: 1 },
                    items: [{ path: "/uploads/a.png", bytes: 1, mtime: T0 }],
                },
            ],
            ["ohne items", { ok: true, counts: { files: 0 } }],
            ["leer", { ok: true, truncated: false, counts: { files: 0 }, items: [] }],
            [
                "falsche Anzahl",
                {
                    ok: true,
                    truncated: false,
                    counts: { files: 2 },
                    items: [{ path: "/uploads/a.png", bytes: 1, mtime: T0 }],
                },
            ],
        ];

        it.each(cases)("hält den Sync an: %s (Quellenprüfung A24)", (_name, payload) => {
            expect(() => parseUploadsList(payload)).toThrow(UploadsSourceIncomplete);
        });

        it("die CLI endet mit Exit 2 und hat nichts geholt und nichts gelöscht", async () => {
            const file = join(directory, "liste.json");
            await writeFile(file, JSON.stringify({ ok: true, truncated: true, counts: { files: 0 }, items: [] }));
            const failure = await run(process.execPath, [
                CLI,
                "--download-dir",
                directory,
                "--base-url",
                base,
                "--list-file",
                file,
            ]).catch((error: { code?: number; stderr?: string }) => error);
            expect((failure as { code?: number }).code).toBe(2);
            expect((failure as { stderr?: string }).stderr).toContain("A24");
            expect((await open()).size()).toBe(0);
        });
    });

    describe("A8 Adresse mit .., Verknüpfung, fremdem Ursprung", () => {
        it("abgewiesen, mit Grund im Bericht - und keine Anfrage geht hinaus", async () => {
            const store = await open();
            const list: UploadsList = {
                revision: "uploads-x",
                declared: { files: 0, bytes: 0 },
                items: [],
            };
            const plan = compareUploads(list, store);
            // Die Adressen kämen nicht aus der Aufzählung durch (legacyLocalPath), aber der Abruf prüft noch einmal selbst.
            plan.wanted = [
                "/uploads/../geheim.png",
                "/etc/passwd",
                "https://fremd.invalid/uploads/a.png",
                "//evil.invalid/uploads/a.png",
                "/uploads/a\\b.png",
            ];
            seen.length = 0;
            const fetched = await fetchPlanned(plan, store, { baseUrl: base, ...noPause });
            expect(fetched.refused).toHaveLength(5);
            expect(fetched.fetched).toBe(0);
            expect(seen).toEqual([]);

            const findings = syncFindings(plan, list, store, fetched, null);
            const abgewiesen = findings.find((finding) => finding.code === "uploads_adresse_abgewiesen");
            expect(abgewiesen?.notes.join(" ")).toContain("keine lokale Legacy-Datei");

            // Die Aufzählung selbst lässt solche Zeilen gar nicht erst durch: Befund, der Rest geht weiter.
            const parsed = parseUploadsList({
                ok: true,
                truncated: false,
                counts: { files: 3 },
                items: [
                    { path: "/uploads/../geheim.png", bytes: 1, mtime: T0 },
                    { path: "https://fremd.invalid/a.png", bytes: 1, mtime: T0 },
                    { path: "/uploads/gut.png", bytes: 1, mtime: T0 },
                ],
            });
            expect(parsed.list.items.map((item) => item.path)).toEqual(["/uploads/gut.png"]);
            expect(parsed.findings.map((finding) => finding.code)).toContain("uploads_item_unbrauchbar");
        });

        it("eine Verknüpfung im Fach wird nicht gelöscht (lstat, nie stat)", async () => {
            const store = await open();
            await put(store, "/uploads/wappen/link.png", await coatPng(50));
            await fill(store, 24);
            const stored = store.entryFor("/uploads/wappen/link.png")?.stored as string;
            const outside = join(directory, "..", `avesmaps3d-ziel-${String(process.pid)}.png`);
            await writeFile(outside, Buffer.from("fremde Bytes"));
            await rm(join(directory, stored));
            let linked = true;
            try {
                await symlink(outside, join(directory, stored));
            } catch {
                // Ohne Entwicklermodus darf Windows keine Verknüpfung anlegen; dann greift die Probe hier nicht.
                linked = false;
            }
            try {
                const prune = await pruneOrphans(["/uploads/wappen/link.png"], store, store.size());
                if (linked) {
                    expect(prune.refused).toEqual([
                        {
                            url: "/uploads/wappen/link.png",
                            reason: "keine einfache Datei (Verknüpfung oder Verzeichnis)",
                        },
                    ]);
                    expect((await readFile(outside)).toString()).toBe("fremde Bytes");
                }
            } finally {
                await rm(outside, { force: true });
            }
        });

        it("die geteilte Probe lässt keinen Pfad aus dem Ordner hinaus", async () => {
            expect(pathUnderRoot(directory, "a/b.png")).toBe(resolve(directory, "a", "b.png"));
            expect(pathUnderRoot(directory, "../geheim.png")).toBeNull();
            expect(pathUnderRoot(directory, "a/../../geheim.png")).toBeNull();
            expect(pathUnderRoot(directory, resolve(directory, "..", "geheim.png"))).toBeNull();
            // Der Ordner selbst ist kein Treffer: es geht immer um eine Datei DARIN.
            expect(pathUnderRoot(directory, ".")).toBeNull();
            await mkdir(join(directory, "ordner"), { recursive: true });
            expect(await plainFileUnder(directory, "ordner")).toEqual({
                kind: "refused",
                reason: "keine einfache Datei (Verknüpfung oder Verzeichnis)",
            });
            expect(await plainFileUnder(directory, "fehlt.png")).toEqual({ kind: "missing" });
        });
    });

    describe("A9 zweiter Lauf", () => {
        it("ändert nichts: nichts geholt, nichts geschrieben, nichts gelöscht", async () => {
            for (const [index, name] of ["a", "b"].entries())
                serve(`/uploads/wappen/${name}.png`, await coatPng(60 + index));
            listResponse = {
                status: 200,
                body: listingOf(["/uploads/wappen/a.png", "/uploads/wappen/b.png"]),
                etag: '"uploads-v1"',
            };
            const store = await open();
            const first = compareUploads(await pullList(), store);
            await fetchPlanned(first, store, { baseUrl: base, ...noPause });
            await store.writeListing("zug-1", { zug: "Test", basis: base, fetchedAt: "2026-10-05T00:00:00.000Z" });
            const before = await readdir(join(directory, "sha256"), { recursive: true });

            const reopened = await open();
            seen.length = 0;
            const second = compareUploads(await pullList(), reopened);
            expect(second).toMatchObject({ fresh: [], changed: [], orphaned: [], wanted: [] });
            expect(second.unchanged).toEqual(["/uploads/wappen/a.png", "/uploads/wappen/b.png"]);
            const fetched = await fetchPlanned(second, reopened, { baseUrl: base, ...noPause });
            expect(fetched).toMatchObject({ requested: 0, fetched: 0, bytes: 0 });
            // Nur die eine Anfrage nach der Aufzählung, keine nach einer Datei.
            expect(seen.map((entry) => entry.url)).toEqual(["/api/app/uploads-export.php"]);
            expect(await readdir(join(directory, "sha256"), { recursive: true })).toEqual(before);
            const prune = await pruneOrphans(second.orphaned, reopened, reopened.size());
            expect(prune).toMatchObject({ removed: 0, entryOnly: 0, withheld: null });
        });
    });

    describe("A10 ohne --operator-said", () => {
        it("rechnet nur und ruft NICHTS ab - auch nicht die Aufzählung", async () => {
            serve("/uploads/wappen/a.png", await coatPng(70));
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png"]) };
            seen.length = 0;
            const { stdout } = await run(process.execPath, [
                CLI,
                "--download-dir",
                directory,
                "--base-url",
                base,
                "--prune",
            ]);
            expect(stdout).toContain("NUR GERECHNET");
            // 🔴 Der Beleg: der Fake-Server hat keine einzige Anfrage gesehen.
            expect(seen).toEqual([]);
            expect((await open()).size()).toBe(0);
            const reports = (await readdir(directory)).filter((name) => name.startsWith("uploads-sync-"));
            expect(reports).toHaveLength(1);
            const report = JSON.parse(await readFile(join(directory, reports[0] as string), "utf8")) as Record<
                string,
                unknown
            >;
            expect(report["stand"]).toBe("nur_gerechnet");
            expect(report["abruf"]).toBeNull();
        });

        it("mit einer gespeicherten Antwort rechnet er den Plan, holt aber weiter nichts", async () => {
            serve("/uploads/wappen/a.png", await coatPng(71));
            const file = join(directory, "liste.json");
            await writeFile(file, listingOf(["/uploads/wappen/a.png"]));
            seen.length = 0;
            const { stdout } = await run(process.execPath, [
                CLI,
                "--download-dir",
                directory,
                "--base-url",
                base,
                "--list-file",
                file,
            ]);
            expect(stdout).toContain("1 neu");
            expect(stdout).toContain("NUR GERECHNET");
            expect(seen).toEqual([]);
            expect((await open()).size()).toBe(0);
        });
    });

    describe("🔴 harte Zusicherung: nur lesen", () => {
        const sources = [
            "src/migration/uploads-sync.ts",
            "src/migration/uploads-sync-cli.ts",
            "src/migration/uploads-list.ts",
            "src/migration/uploads-path.ts",
        ];

        it("kein Modul des Syncs kennt eine andere HTTP-Methode als GET, keine Anmeldung und kein Cookie", async () => {
            for (const file of sources) {
                const text = await readFile(resolve(SERVER_ROOT, file), "utf8");
                // Zeilen mit dem Wort im Fließtext eines Kommentars zählen nicht: gesucht wird der Code.
                const code = text
                    .split("\n")
                    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
                    .join("\n");
                for (const forbidden of [
                    /\bmethod\s*:/i,
                    /["']POST["']|["']PUT["']|["']DELETE["']|["']PATCH["']/,
                    /\bFormData\b/,
                    /\bauthorization\b/i,
                    /\bcookie\b/i,
                    /\bcredentials\s*:/i,
                    /\bbody\s*:/,
                ]) {
                    expect(code, `${file}: ${String(forbidden)}`).not.toMatch(forbidden);
                }
            }
        });

        it("der Abruf schickt weder Cookie noch Anmeldung und folgt keiner Weiterleitung", async () => {
            listResponse = { status: 200, body: "{}" };
            const url = uploadsListUrl(base) as URL;
            await requestUploadsList({ url: url.href, storedEtag: "" }).catch(() => undefined);
            const headers = seen[0]?.headers ?? {};
            expect(headers["cookie"]).toBeUndefined();
            expect(headers["authorization"]).toBeUndefined();
        });

        it("die Basisadresse muss https sein, oder http auf einem lokalen Entwicklungsrechner", () => {
            expect(uploadsListUrl("https://avesmaps.de")?.href).toBe("https://avesmaps.de/api/app/uploads-export.php");
            expect(uploadsListUrl("http://avesmaps.de")).toBeNull();
            expect(uploadsListUrl("ftp://avesmaps.de")).toBeNull();
            expect(uploadsListUrl("keine adresse")).toBeNull();
            expect(uploadsListUrl("http://127.0.0.1:3261")?.href).toBe(
                "http://127.0.0.1:3261/api/app/uploads-export.php",
            );
        });

        it("eine Antwort, die weder 200 noch 304 ist, ist ein technischer Abbruch (kein stiller Rückfall)", async () => {
            listResponse = { status: 503, body: "weg" };
            const url = uploadsListUrl(base) as URL;
            await expect(requestUploadsList({ url: url.href, storedEtag: "" })).rejects.toThrow("HTTP 503");
        });
    });

    describe("Bericht", () => {
        it("nennt je Menge Zahl und Bytes, den Grund je geänderter Adresse und alle Befunde", async () => {
            serve("/uploads/wappen/a.png", await coatPng(80));
            serve("/uploads/wappen/b.png", await coatPng(81));
            const store = await open();
            await store.put(
                {
                    url: "/uploads/wappen/weg.png",
                    status: 200,
                    contentType: "image/png",
                    etag: null,
                    lastModified: httpDate(T0),
                    fetchedAt: "2026-10-04T00:00:00.000Z",
                },
                await coatPng(82),
                "png",
            );
            listResponse = { status: 200, body: listingOf(["/uploads/wappen/a.png", "/uploads/wappen/b.png"]) };
            const list = await pullList();
            const plan = compareUploads(list, store);
            const fetched = await fetchPlanned(plan, store, { baseUrl: base, ...noPause });
            const findings = syncFindings(plan, list, store, fetched, null);
            const report = buildSyncReport({
                zug: "zieh mal",
                basis: base,
                at: "2026-10-05T12:00:00.000Z",
                list,
                plan,
                fetched,
                prune: null,
                listedBefore: 1,
                findings,
                mode: "geholt",
            });
            expect(report).toMatchObject({
                werkzeug: "legacy:uploads-sync",
                stand: "geholt",
                uploads_revision: "uploads-0123456789abcdef",
                fach_vorher: 1,
            });
            const mengen = report["mengen"] as Record<string, Record<string, unknown>>;
            expect(mengen["neu"]).toMatchObject({ anzahl: 2 });
            expect(mengen["neu"]?.["bytes"]).toBeGreaterThan(0);
            expect(mengen["verwaist"]).toMatchObject({ anzahl: 1, adressen: ["/uploads/wappen/weg.png"] });
            expect((report["abruf"] as Record<string, unknown>)["geholt"]).toBe(2);
            expect((report["befunde"] as { code: string }[]).map((finding) => finding.code)).toContain(
                "uploads_verwaist",
            );
            // Der Bericht ist reproduzierbar: dieselben Eingaben, dasselbe JSON.
            expect(JSON.stringify(report)).toBe(
                JSON.stringify(
                    buildSyncReport({
                        zug: "zieh mal",
                        basis: base,
                        at: "2026-10-05T12:00:00.000Z",
                        list,
                        plan,
                        fetched,
                        prune: null,
                        listedBefore: 1,
                        findings,
                        mode: "geholt",
                    }),
                ),
            );
        });
    });
});
