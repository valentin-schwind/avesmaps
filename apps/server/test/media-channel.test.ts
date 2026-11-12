import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectImage } from "../src/media/raster/inspect.ts";
import { CHANNEL_PROFILES } from "../src/media/raster/profiles.ts";
import { recipeVersion, renderRaster } from "../src/media/raster/render.ts";
import {
    CHANNEL_DIRECTORY,
    MediaStorageError,
    MediaStore,
    channelDirectory,
    channelKey,
    sha256Of,
} from "../src/media/storage.ts";

/**
 * Was die Medienverwaltung dem Betreiber-Kanal liefert (KANAL-0001 §6.3, Go der Koordination 2026-10-11): M1 die private Ablage je Bild,
 * M2 die Profile ohne Rolle der MAM, M3 die Zusage, dass kein Aufräumen der MAM `private/kanal/` anfasst (dazu `verify-media.test.ts`).
 */

const BILD = "6b616e61-6c00-4000-9000-000000000001";
const ANDERES = "6b616e61-6c00-4000-9000-000000000002";

let root: string;
let store: MediaStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "avesmaps-kanal-"));
    store = new MediaStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("M1: die Ablage des Kanals", () => {
    it("der Schlüssel ist der Ordner des Bildes und sein Teil, nie ein Hash oder ein Name", () => {
        expect(CHANNEL_DIRECTORY).toBe("private/kanal");
        expect(channelKey(BILD, "original", "png")).toBe(`private/kanal/${BILD}/original.png`);
        expect(channelKey(BILD, "ansicht", "webp")).toBe(`private/kanal/${BILD}/ansicht.webp`);
        expect(channelKey(BILD, "vorschau", "webp")).toBe(`private/kanal/${BILD}/vorschau.webp`);
        // Keine Kennung aus Nutzertext, kein Ausbruch, keine Fassung außer WebP.
        expect(() => channelKey("../published", "original", "png")).toThrow(MediaStorageError);
        expect(() => channelKey(BILD.toUpperCase(), "original", "png")).toThrow(MediaStorageError);
        expect(() => channelKey(BILD, "ansicht", "png")).toThrow(MediaStorageError);
        expect(() => channelKey(BILD, "original", "p/ng")).toThrow(MediaStorageError);
        expect(() => channelKey(BILD, "anderes" as never, "webp")).toThrow(MediaStorageError);
    });

    it("legt ab wie die MAM (Endname nur durch rename, sha256 dazu) und ersetzt einen Teil beim neuen Rendern", async () => {
        const bytes = Buffer.from("bildschirmfoto");
        const stored = await store.storeChannel(BILD, "original", bytes, "png");
        expect(stored).toEqual({
            key: `private/kanal/${BILD}/original.png`,
            sha256: sha256Of(bytes),
            byteSize: bytes.byteLength,
            written: true,
        });
        expect(await readFile(join(root, "private", "kanal", BILD, "original.png"))).toEqual(bytes);
        // Keine Temporärdatei bleibt liegen.
        expect(await readdir(join(root, "private", "kanal", BILD))).toEqual(["original.png"]);
        // Dieselben Bytes: nichts geschrieben. Neue Bytes: ersetzt.
        expect((await store.storeChannel(BILD, "original", bytes, "png")).written).toBe(false);
        await store.storeChannel(BILD, "ansicht", Buffer.from("alt"), "webp");
        await store.storeChannel(BILD, "ansicht", Buffer.from("neu"), "webp");
        expect(await readFile(join(root, "private", "kanal", BILD, "ansicht.webp"), "utf8")).toBe("neu");
        // Zwei gleiche Fotos teilen sich keine Datei.
        await store.storeChannel(ANDERES, "original", bytes, "png");
        expect(existsSync(join(root, "private", "kanal", ANDERES, "original.png"))).toBe(true);
        await expect(store.storeChannel(BILD, "original", new Uint8Array(0), "png")).rejects.toThrow(MediaStorageError);
    });

    it("🔴 löscht ein Bild ganz und nur dieses; ein zweites Mal ist nichts mehr da", async () => {
        for (const id of [BILD, ANDERES]) {
            await store.storeChannel(id, "original", Buffer.from(`o-${id}`), "png");
            await store.storeChannel(id, "ansicht", Buffer.from(`a-${id}`), "webp");
            await store.storeChannel(id, "vorschau", Buffer.from(`v-${id}`), "webp");
        }
        expect(await store.removeChannel(BILD)).toBe(3);
        expect(existsSync(join(root, channelDirectory(BILD)))).toBe(false);
        expect((await readdir(join(root, channelDirectory(ANDERES)))).sort()).toEqual([
            "ansicht.webp",
            "original.png",
            "vorschau.webp",
        ]);
        expect(await store.removeChannel(BILD)).toBe(0);
        await expect(store.removeChannel("../evidence")).rejects.toThrow(MediaStorageError);
    });

    it("🔴 folgt beim Löschen keinem Unterordner: dann bricht es ab, statt etwas außerhalb zu nehmen", async () => {
        await store.storeChannel(BILD, "original", Buffer.from("o"), "png");
        await mkdir(join(root, channelDirectory(BILD), "fremd"));
        await writeFile(join(root, channelDirectory(BILD), "fremd", "x.txt"), "bleibt");
        await expect(store.removeChannel(BILD)).rejects.toThrow(MediaStorageError);
        expect(await readFile(join(root, channelDirectory(BILD), "fremd", "x.txt"), "utf8")).toBe("bleibt");
    });
});

describe("M3: kein Aufräumen der MAM fasst private/kanal/ an", () => {
    it("remove der MAM verweigert einen Schlüssel des Kanals; sweepIncoming lässt ihn liegen", async () => {
        const stored = await store.storeChannel(BILD, "original", Buffer.from("o"), "png");
        await expect(store.remove(stored.key)).rejects.toThrow(MediaStorageError);
        const alt = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        await utimes(join(root, stored.key), alt, alt);
        await mkdir(join(root, "incoming"), { recursive: true });
        expect(await store.sweepIncoming(1000)).toBe(0);
        expect(existsSync(join(root, stored.key))).toBe(true);
    });
});

describe("M2: die Profile des Kanals, ohne Rolle der MAM", () => {
    it("rendert ein großes Bildschirmfoto auf 2560 und 480, WebP, ohne EXIF, ICC oder XMP", async () => {
        const original = await sharp({
            create: { width: 3000, height: 1800, channels: 3, background: { r: 40, g: 90, b: 160 } },
        })
            .withExif({ IFD0: { Copyright: "Betreiber", Software: "Bildschirmfoto" } })
            .png()
            .toBuffer();
        expect((await sharp(original).metadata()).exif).toBeDefined();
        const inspection = inspectImage(original);
        for (const [profil, breite, hoehe] of [
            [CHANNEL_PROFILES.ansicht, 2560, 1536],
            [CHANNEL_PROFILES.vorschau, 480, 288],
        ] as const) {
            const rendered = await renderRaster(original, inspection, profil);
            const meta = await sharp(rendered.bytes).metadata();
            expect(meta.format, profil.variant).toBe("webp");
            expect([meta.width, meta.height], profil.variant).toEqual([breite, hoehe]);
            expect(meta.exif, profil.variant).toBeUndefined();
            expect(meta.icc, profil.variant).toBeUndefined();
            expect(meta.xmp, profil.variant).toBeUndefined();
        }
        expect(recipeVersion(CHANNEL_PROFILES.ansicht)).toMatch(/^1 \/ sharp /);
        expect(CHANNEL_PROFILES.ansicht.variant).toBe("kanal_ansicht");
        expect(CHANNEL_PROFILES.vorschau.variant).toBe("kanal_vorschau");
        expect("role" in CHANNEL_PROFILES.ansicht).toBe(false);
    });

    it("vergrößert nie: ein kleines Bildschirmfoto bleibt in seiner Größe", async () => {
        const klein = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#808080" } })
            .png()
            .toBuffer();
        const rendered = await renderRaster(klein, inspectImage(klein), CHANNEL_PROFILES.ansicht);
        const meta = await sharp(rendered.bytes).metadata();
        expect([meta.width, meta.height]).toEqual([400, 300]);
    });
});
