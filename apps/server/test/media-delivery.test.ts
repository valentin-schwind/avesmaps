import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mediaInstagramUrl, mediaPublicUrl } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { publishedAddressForUrl } from "../src/media/delivery.ts";
import { MediaStore, instagramKey, sha256Of, storageKey } from "../src/media/storage.ts";

/**
 * Die Auslieferung der veröffentlichten Medien (WI-0063 MEDIA-M12).
 *
 * 🔴 Diese Route ist NICHT, was Besucher auf Stage und Production sehen - dort liefert Nginx die Dateien direkt. Sie
 * muss aber denselben Pfad, denselben Medientyp und dieselben Cache-Zusagen machen, sonst ist „lokal grün" eine Aussage
 * über eine andere Auslieferung (wie bei den Rasterkacheln, `raster-tiles.test.ts`).
 *
 * 🔴 Der Kern dieser Datei: **nur `published/` ist erreichbar.** Was öffentlich ist, hat die Policy beim Import
 * entschieden; der Auslieferweg entscheidet es nicht zum zweiten Mal und umgeht es nicht.
 */

const IMMUTABLE = "public, max-age=31536000, immutable";

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

/** Eine Datei, die wie ein veröffentlichtes WebP aussieht; der Inhalt ist der Auslieferung gleichgültig. */
const PUBLIC_BYTES = bytes("RIFF----WEBPVP8 ein veröffentlichtes Wappen");
const PRIVATE_BYTES = bytes("das private Original, das niemals ins Netz gehört");

let root: string;
let app: FastifyInstance;
let logLines: string[];

/** Die Adresse der veröffentlichten Datei und die der privaten, die dieselbe Form hätte. */
let publicUrl: string;
let privateUrl: string;

function buildWith(mediaRoot: string | undefined): FastifyInstance {
    logLines = [];
    return buildApp({
        config: {
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
        },
        logStream: {
            write: (line) => {
                logLines.push(line);
            },
        },
    });
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "avesmaps3d-media-delivery-"));
    const store = new MediaStore(root);
    const published = await store.store("published", PUBLIC_BYTES, "webp");
    publicUrl = mediaPublicUrl(published.sha256);
    // Dasselbe Original liegt NUR privat: seine Adresse existiert nicht, auch nicht mit derselben Form.
    const privateSource = await store.store("private_source", PRIVATE_BYTES, "webp");
    privateUrl = mediaPublicUrl(privateSource.sha256);
    app = buildWith(root);
    await app.ready();
});

afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
});

describe("eine veröffentlichte Datei", () => {
    it("🔴 kommt mit 200, als WebP und ein Jahr unveränderlich", async () => {
        const response = await app.inject({ method: "GET", url: publicUrl });

        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("image/webp");
        expect(response.headers["cache-control"]).toBe(IMMUTABLE);
        expect(response.headers["content-length"]).toBe(String(PUBLIC_BYTES.byteLength));
        expect(new Uint8Array(response.rawPayload)).toEqual(PUBLIC_BYTES);
    });

    it("🔴 trägt den Hash ihrer Bytes als ETag und antwortet bedingt mit 304", async () => {
        const first = await app.inject({ method: "GET", url: publicUrl });
        const etag = first.headers["etag"] as string;
        expect(etag).toBe(`"${sha256Of(PUBLIC_BYTES)}"`);

        for (const candidate of [etag, `W/${etag}`, `"fremd", ${etag}`, "*"]) {
            const again = await app.inject({
                method: "GET",
                url: publicUrl,
                headers: { "if-none-match": candidate },
            });
            expect(again.statusCode, candidate).toBe(304);
            expect(again.body).toBe("");
            expect(again.headers["cache-control"]).toBe(IMMUTABLE);
        }
    });

    it("ein fremder ETag bekommt die Bytes", async () => {
        const response = await app.inject({
            method: "GET",
            url: publicUrl,
            headers: { "if-none-match": '"0000"' },
        });
        expect(response.statusCode).toBe(200);
    });

    it("ein Abfrageteil ändert die Adresse nicht (sie braucht kein ?v=mtime)", async () => {
        const response = await app.inject({ method: "GET", url: `${publicUrl}?v=4711` });
        expect(response.statusCode).toBe(200);
    });
});

describe("🔴 nur published/ ist erreichbar", () => {
    it("die private Quelle hat keine Adresse, obwohl sie dieselbe Form hätte", async () => {
        const response = await app.inject({ method: "GET", url: privateUrl });

        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain("Original");
    });

    const outside = [
        ["der Bereich selbst", "/media/private/source/"],
        ["eine geratene private Datei", `/media/private/source/sha256/aa/bb/${"a".repeat(64)}.webp`],
        ["das Eingangsverzeichnis", "/media/incoming/beliebig.png"],
        ["die Belege", "/media/private/evidence/mail.pdf"],
        ["die Derivate", `/media/derivatives/sha256/aa/bb/${"a".repeat(64)}.webp`],
        ["der Master", `/media/master/sha256/aa/bb/${"a".repeat(64)}.webp`],
        ["published als Präfix in der Adresse", `/media/published/sha256/aa/bb/${"a".repeat(64)}.webp`],
    ] as const;

    it.each(outside)("%s ist nicht erreichbar", async (_, url) => {
        expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    });

    const shapes = [
        ["ein Aufstieg mit ..", `/media/sha256/aa/bb/../../../private/source/sha256/aa/bb/${"a".repeat(64)}.webp`],
        ["ein kodierter Aufstieg", "/media/sha256/aa/bb/..%2F..%2F..%2Fprivate%2Fsource%2Fx.webp"],
        ["ein doppelt kodierter Aufstieg", "/media/sha256/aa/bb/%252e%252e%252fprivate%252fsource%252fx.webp"],
        ["ein kodierter Schrägstrich im Hash", `/media/sha256/aa/bb/%2e%2e%2f${"a".repeat(64)}.webp`],
        ["ein Hash in Großschreibung", `/media/sha256/AA/BB/${"A".repeat(64)}.webp`],
        ["ein Fach, das nicht zu seinem Hash passt", `/media/sha256/00/00/${"a".repeat(64)}.webp`],
        ["eine andere Endung", `/media/sha256/aa/bb/${"a".repeat(64)}.png`],
        ["ein zu kurzer Hash", `/media/sha256/aa/bb/${"a".repeat(63)}.webp`],
        ["ein zweiter Punkt", `/media/sha256/aa/bb/${"a".repeat(64)}.webp.webp`],
        ["ein Rückwärtsstrich", `/media/sha256/aa/bb\\${"a".repeat(64)}.webp`],
        ["ein Nullbyte", `/media/sha256/aa/bb/${"a".repeat(64)}.webp%00.png`],
        ["die nackte Wurzel", "/media/"],
    ] as const;

    // 404 für eine Adresse, die die Route erreicht; 400, wo Fastify eine unlesbare Adresse schon vorher abweist.
    // Verlangt ist beides nicht - verlangt ist: nie 200 und nie ein Serverfehler.
    it.each(shapes)("%s wird abgewiesen", async (_, url) => {
        const response = await app.inject({ method: "GET", url });
        expect([400, 404]).toContain(response.statusCode);
        expect(response.body).not.toContain("Original");
    });

    it("🔴 über einen Junction im Baum wird keine Datei von außerhalb ausgeliefert", async () => {
        const elsewhere = await mkdtemp(join(tmpdir(), "avesmaps3d-media-outside-"));
        try {
            const sha256 = sha256Of(PRIVATE_BYTES);
            await writeFile(join(elsewhere, `${sha256}.webp`), PRIVATE_BYTES);
            await mkdir(join(root, "published", "sha256", sha256.slice(0, 2)), { recursive: true });
            await symlink(
                elsewhere,
                join(root, "published", "sha256", sha256.slice(0, 2), sha256.slice(2, 4)),
                "junction",
            );

            const response = await app.inject({ method: "GET", url: mediaPublicUrl(sha256) });
            expect(response.statusCode).toBe(404);
            expect(response.body).not.toContain("Original");
            // Der Wächterfall steht im Log, die Antwort verrät ihn nicht.
            expect(logLines.join("\n")).toContain("Mediendatei abgewiesen");
        } finally {
            await rm(elsewhere, { recursive: true, force: true });
        }
    });

    it("die Übersetzung kann GAR NICHTS anderes adressieren als published/", () => {
        for (const sha256 of [sha256Of(PUBLIC_BYTES), sha256Of(PRIVATE_BYTES), "f".repeat(64), "0".repeat(64)]) {
            const address = publishedAddressForUrl(mediaPublicUrl(sha256));
            expect(address?.key).toBe(`published/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.webp`);
        }
    });
});

describe("die Instagram-Fassung neben der WebP (WI-0268 C12b)", () => {
    const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...bytes("Instagram-Fassung")]);
    let sha256: string;
    let url: string;

    beforeEach(async () => {
        sha256 = sha256Of(PUBLIC_BYTES);
        url = mediaInstagramUrl(sha256);
        await new MediaStore(root).storeInstagram(sha256, JPEG_BYTES);
    });

    it("🔴 kommt als image/jpeg, ein Jahr unveränderlich und mit denselben Köpfen wie die WebP", async () => {
        const webp = await app.inject({ method: "GET", url: publicUrl });
        const response = await app.inject({ method: "GET", url });

        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("image/jpeg");
        expect(response.headers["cache-control"]).toBe(IMMUTABLE);
        expect(response.headers["x-content-type-options"]).toBe(webp.headers["x-content-type-options"]);
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["content-length"]).toBe(String(JPEG_BYTES.byteLength));
        expect(new Uint8Array(response.rawPayload)).toEqual(JPEG_BYTES);
    });

    it("hat einen eigenen ETag (dieselbe Hash-Zahl, aber eine andere Darstellung) und antwortet bedingt mit 304", async () => {
        const etag = (await app.inject({ method: "GET", url })).headers["etag"] as string;
        expect(etag).toBe(`"${sha256}-ig"`);
        const bedingt = await app.inject({ method: "GET", url, headers: { "if-none-match": etag } });
        expect(bedingt.statusCode).toBe(304);
        // Der ETag der WebP gilt für die Fassung nicht, und umgekehrt.
        const webpEtag = `"${sha256}"`;
        expect((await app.inject({ method: "GET", url, headers: { "if-none-match": webpEtag } })).statusCode).toBe(200);
        expect(
            (await app.inject({ method: "GET", url: publicUrl, headers: { "if-none-match": etag } })).statusCode,
        ).toBe(200);
    });

    it("🔴 ohne ihre WebP daneben hat sie keine Adresse (Quarantäne, Löschen, nie dagewesen): 404, auch wenn die Datei noch auf der Platte läge", async () => {
        await rm(join(root, ...storageKey("published", sha256, "webp").split("/")));
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(404);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).not.toContain("Instagram");
        // Die Fassung liegt noch dort; ausgeliefert wird sie trotzdem nicht.
        expect(await new MediaStore(root).exists(instagramKey(sha256))).toBe(true);
    });

    const falsch = [
        ["Großschreibung", `/media/sha256/AB/CD/${"A".repeat(64)}.ig.jpg`],
        ["ein Fach, das nicht zu seinem Hash passt", `/media/sha256/00/00/${"a".repeat(64)}.ig.jpg`],
        ["die Endung .ig.jpeg", `/media/sha256/aa/bb/${"a".repeat(64)}.ig.jpeg`],
        ["die Endung .jpg ohne ig", `/media/sha256/aa/bb/${"a".repeat(64)}.jpg`],
        ["ein zweiter Punkt", `/media/sha256/aa/bb/${"a".repeat(64)}.ig.jpg.jpg`],
        ["ein kodierter Aufstieg", "/media/sha256/aa/bb/..%2F..%2Fx.ig.jpg"],
        ["ein Aufstieg mit ..", `/media/sha256/aa/bb/../../private/source/sha256/aa/bb/${"a".repeat(64)}.ig.jpg`],
    ] as const;

    it.each(falsch)("%s wird abgewiesen", async (_, adresse) => {
        const response = await app.inject({ method: "GET", url: adresse });
        expect([400, 404]).toContain(response.statusCode);
    });

    it("die Übersetzung nennt Schlüssel, Medientyp und die WebP, neben der sie liegen muss", () => {
        expect(publishedAddressForUrl(url)).toEqual({
            sha256,
            key: instagramKey(sha256),
            mimeType: "image/jpeg",
            companionKey: storageKey("published", sha256, "webp"),
            variant: "instagram",
        });
        // Die WebP bleibt, wie sie war: keine Begleiterin, kein Sondermerkmal.
        expect(publishedAddressForUrl(publicUrl)).toEqual({
            sha256,
            key: storageKey("published", sha256, "webp"),
            mimeType: "image/webp",
        });
    });
});

describe("eine fehlende Datei", () => {
    it("🔴 ist ein 404 und kein Serverfehler: ein Asset ohne Bytes kommt vor", async () => {
        const response = await app.inject({ method: "GET", url: mediaPublicUrl("c".repeat(64)) });

        expect(response.statusCode).toBe(404);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toMatchObject({ error: { code: "not_found" } });
        expect(logLines.join("\n")).not.toContain("Mediendatei abgewiesen");
    });
});

describe("ohne MEDIA_ROOT", () => {
    it("🔴 startet der Server und sagt verständlich, dass keine Medien ausgeliefert werden", async () => {
        const bare = buildWith(undefined);
        try {
            await bare.ready();
            const response = await bare.inject({ method: "GET", url: publicUrl });

            expect(response.statusCode).toBe(503);
            expect(response.json()).toMatchObject({ error: { code: "media_not_configured" } });
            const log = logLines.join("\n");
            expect(log).toContain("MEDIA_ROOT ist nicht gesetzt");
            expect(log).toContain("C:\\\\avesmaps3d-data\\\\media");
        } finally {
            await bare.close();
        }
    });

    it("ein relativer Pfad ist unbrauchbar: 503 mit Grund im Log, kein Absturz", async () => {
        const bare = buildWith("media");
        try {
            await bare.ready();
            expect((await bare.inject({ method: "GET", url: publicUrl })).statusCode).toBe(503);
            expect(logLines.join("\n")).toContain("MEDIA_ROOT ist unbrauchbar");
        } finally {
            await bare.close();
        }
    });

    it("steht die Variable, fehlt aber der Baum, sagt der Server es einmal", async () => {
        const empty = await mkdtemp(join(tmpdir(), "avesmaps3d-media-leer-"));
        const bare = buildWith(empty);
        try {
            await bare.ready();
            expect((await bare.inject({ method: "GET", url: publicUrl })).statusCode).toBe(404);
            expect(logLines.join("\n")).toContain("fehlt: /media/ antwortet auf jede Datei mit 404");
        } finally {
            await bare.close();
            await rm(empty, { recursive: true, force: true });
        }
    });
});
