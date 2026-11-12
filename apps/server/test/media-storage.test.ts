import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEDIA_PUBLIC_URL_PATTERN } from "@avesmaps3d/shared";
import * as storageModule from "../src/media/storage.ts";
import {
    MediaStorageError,
    MediaStore,
    assertRelativeKey,
    extensionForMime,
    publishedUrl,
    sha256Of,
    storageKey,
} from "../src/media/storage.ts";

/** Der lokale Medienspeicher (WI-0063 MEDIA-M6): Schlüssel, Pfadwächter, atomares Schreiben, Deduplizierung, URL. */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const HASH = sha256Of(bytes("Wappen"));

describe("Speicherschlüssel", () => {
    it("entsteht aus Klasse und SHA-256, nie aus einem Namen", () => {
        expect(storageKey("published", HASH, "webp")).toBe(
            `published/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.webp`,
        );
        expect(storageKey("private_source", HASH, "png")).toBe(
            `private/source/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.png`,
        );
        expect(storageKey("master", HASH, "webp")).toBe(
            `master/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.webp`,
        );
        expect(storageKey("derivative", HASH, "webp")).toBe(
            `derivatives/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.webp`,
        );
    });

    it("weist Hash und Endung ab, die kein Hash und keine Endung sind", () => {
        expect(() => storageKey("master", "ab", "webp")).toThrow(MediaStorageError);
        expect(() => storageKey("master", HASH.toUpperCase(), "webp")).toThrow(MediaStorageError);
        expect(() => storageKey("master", HASH, "../x")).toThrow(MediaStorageError);
        expect(() => storageKey("master", HASH, "PNG")).toThrow(MediaStorageError);
        expect(() => storageKey("master", HASH, "")).toThrow(MediaStorageError);
    });

    it("eine veröffentlichte Datei ist immer WebP", () => {
        expect(() => storageKey("published", HASH, "png")).toThrow(MediaStorageError);
        expect(() => storageKey("published", HASH, "svg")).toThrow(MediaStorageError);
    });

    it("die Endung kommt aus dem erkannten Typ, nicht aus einem Dateinamen", () => {
        expect(extensionForMime("image/png")).toBe("png");
        expect(extensionForMime("image/jpeg")).toBe("jpg");
        expect(extensionForMime("image/svg+xml")).toBe("svg");
        expect(extensionForMime("text/html")).toBe("bin");
    });
});

describe("öffentliche Adresse", () => {
    it("🔴 gibt es nur für veröffentlichte Dateien: eine Funktion, ohne Klasse", () => {
        expect(publishedUrl(HASH)).toBe(`/media/sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}.webp`);
        expect(new RegExp(MEDIA_PUBLIC_URL_PATTERN).test(publishedUrl(HASH))).toBe(true);
        // Für private Klassen gibt es keine Adressfunktion, und ein privater Schlüssel sieht nie wie eine Adresse aus.
        const urlFunctions = Object.keys(storageModule).filter((name) => /url/i.test(name));
        expect(urlFunctions).toEqual(["publishedUrl"]);
        expect(new RegExp(MEDIA_PUBLIC_URL_PATTERN).test(storageKey("private_source", HASH, "webp"))).toBe(false);
        expect(() => publishedUrl("nicht-ein-hash")).toThrow();
    });
});

describe("Pfadwächter", () => {
    const root = join(tmpdir(), "avesmaps3d-media-guard");
    const store = new MediaStore(root);

    it.each([
        ["leer", ""],
        ["absolut", "/etc/passwd"],
        ["Laufwerk", "C:\\Windows\\x"],
        ["Laufwerk mit Schrägstrich", "C:/Windows/x"],
        ["Rückwärtsstrich", "published\\x"],
        ["Rückwärts hinaus", "..\\x"],
        ["Rückwärtssegment", "a/../b"],
        ["Rückwärtssegment am Anfang", "../x"],
        ["Rückwärtssegment am Ende", "a/.."],
        ["nur Rückwärts", ".."],
        ["Punktsegment", "a/./b"],
        ["leeres Segment", "a//b"],
        ["Steuerzeichen", "a/b\u0000c"],
    ])("lehnt %s ab", (_name, key) => {
        expect(() => assertRelativeKey(key)).toThrow(MediaStorageError);
        expect(() => store.pathFor(key)).toThrow(MediaStorageError);
    });

    it("lässt einen gewöhnlichen Schlüssel zu, und der Pfad liegt unter der Wurzel", () => {
        const path = store.pathFor(storageKey("published", HASH, "webp"));
        expect(path.startsWith(store.root)).toBe(true);
        expect(path.endsWith(`${HASH}.webp`)).toBe(true);
        expect(() => store.pathFor(".")).toThrow(MediaStorageError);
    });

    it("MEDIA_ROOT muss absolut sein", () => {
        expect(() => new MediaStore("media")).toThrow(MediaStorageError);
    });
});

describe("Schreiben", () => {
    let root: string;
    let store: MediaStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-media-"));
        store = new MediaStore(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    async function walk(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) files.push(...(await walk(path)));
            else files.push(path);
        }
        return files;
    }

    it("legt die Bytes unter dem Schlüssel ab, und der Hash ist der Hash der Bytes", async () => {
        const content = bytes("ein Wappen");
        const stored = await store.store("published", content, "webp");
        expect(stored).toEqual({
            key: storageKey("published", sha256Of(content), "webp"),
            sha256: sha256Of(content),
            byteSize: content.byteLength,
            written: true,
        });
        expect(new Uint8Array(await readFile(store.pathFor(stored.key)))).toEqual(content);
        expect(await store.exists(stored.key)).toBe(true);
        // Nur die eine Datei; keine Temporärdatei bleibt liegen.
        expect(await walk(root)).toEqual([store.pathFor(stored.key)]);
    });

    it("🔴 gleiche Bytes ergeben EINE physische Datei und werden nicht neu geschrieben", async () => {
        const content = bytes("zwei Werke, dieselben Bytes");
        const first = await store.store("master", content, "webp");
        const path = store.pathFor(first.key);
        const stampBefore = (await stat(path)).mtimeMs;
        await new Promise((done) => setTimeout(done, 20));
        const second = await store.store("master", content, "webp");
        expect(second.key).toBe(first.key);
        expect(second.written).toBe(false);
        expect((await stat(path)).mtimeMs).toBe(stampBefore);
        expect(await walk(root)).toHaveLength(1);
    });

    it("gleiche Bytes in verschiedenen Klassen liegen je unter der eigenen Klasse", async () => {
        const content = bytes("Quelle gleich Master");
        const source = await store.store("private_source", content, "png");
        const master = await store.store("master", content, "png");
        expect(source.key.startsWith("private/source/")).toBe(true);
        expect(master.key.startsWith("master/")).toBe(true);
        expect(await walk(root)).toHaveLength(2);
    });

    it("🔴 gleichzeitige Schreiber derselben Bytes enden mit einer vollständigen Datei", async () => {
        const content = new Uint8Array(200_000).map((_, index) => index % 251);
        const results = await Promise.all(Array.from({ length: 6 }, () => store.store("derivative", content, "webp")));
        expect(new Set(results.map((result) => result.key)).size).toBe(1);
        const files = await walk(root);
        expect(files).toHaveLength(1);
        expect(sha256Of(await readFile(files[0] as string))).toBe(sha256Of(content));
    });

    it("🔴 atomar: der Endname entsteht nur durch das Umbenennen einer vollständigen Datei", async () => {
        const content = bytes("vollständig oder gar nicht");
        const target = store.pathFor(storageKey("published", sha256Of(content), "webp"));
        const seen: { targetExisted: boolean; temporaryComplete: boolean; temporaryName: string }[] = [];
        const probing = new MediaStore(root, {
            rename: async (from, to) => {
                seen.push({
                    targetExisted: existsSync(to),
                    temporaryComplete: sha256Of(await readFile(from)) === sha256Of(content),
                    temporaryName: from,
                });
                const { rename } = await import("node:fs/promises");
                await rename(from, to);
            },
        });
        await probing.store("published", content, "webp");
        expect(seen).toHaveLength(1);
        expect(seen[0]?.targetExisted).toBe(false);
        expect(seen[0]?.temporaryComplete).toBe(true);
        expect(seen[0]?.temporaryName).toContain(".tmp-");
        expect(existsSync(target)).toBe(true);
    });

    it("🔴 scheitert das Umbenennen, steht unter dem Endnamen nichts, und die Temporärdatei ist weg", async () => {
        const content = bytes("das Umbenennen scheitert");
        const failing = new MediaStore(root, {
            rename: () => Promise.reject(new Error("Platte voll")),
        });
        await expect(failing.store("published", content, "webp")).rejects.toThrow(MediaStorageError);
        expect(existsSync(failing.pathFor(storageKey("published", sha256Of(content), "webp")))).toBe(false);
        expect(await walk(root)).toEqual([]);
    });

    it("eine leere Datei wird nicht abgelegt, ein Verzeichnis unter dem Schlüssel ist ein Fehler", async () => {
        await expect(store.store("master", new Uint8Array(0), "webp")).rejects.toThrow(MediaStorageError);
        const content = bytes("unter dem Schlüssel liegt ein Verzeichnis");
        await mkdir(store.pathFor(storageKey("master", sha256Of(content), "webp")), { recursive: true });
        await expect(store.store("master", content, "webp")).rejects.toThrow(MediaStorageError);
    });

    it("🔴 über eine Verknüpfung im Baum darf nichts außerhalb der Wurzel entstehen", async () => {
        const outside = await mkdtemp(join(tmpdir(), "avesmaps3d-media-outside-"));
        try {
            await mkdir(root, { recursive: true });
            await symlink(outside, join(root, "published"), "junction");
            await expect(store.store("published", bytes("soll draußen nicht landen"), "webp")).rejects.toThrow(
                MediaStorageError,
            );
            expect(await readdir(outside)).toEqual([]);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });
});

describe("Lesen", () => {
    let root: string;
    let store: MediaStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-media-read-"));
        store = new MediaStore(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("liest die Bytes eines Schlüssels", async () => {
        const stored = await store.store("private_source", bytes("ein Original"), "png");
        expect(new Uint8Array(await store.read(stored.key, 1024))).toEqual(bytes("ein Original"));
    });

    it("🔴 prüft die Größe VOR dem Lesen: eine Datei über der Grenze kommt nie in den Speicher", async () => {
        const stored = await store.store("private_source", new Uint8Array(2048).fill(7), "png");
        await expect(store.read(stored.key, 2047)).rejects.toMatchObject({
            name: "MediaStorageError",
            code: "too_large",
        });
        expect((await store.read(stored.key, 2048)).length).toBe(2048);
    });

    it("eine fehlende Datei und ein Verzeichnis unter dem Schlüssel sind `missing`", async () => {
        await expect(store.read("incoming/gibt-es-nicht", 10)).rejects.toMatchObject({ code: "missing" });
        await mkdir(join(root, "incoming", "ordner"), { recursive: true });
        await expect(store.read("incoming/ordner", 10)).rejects.toMatchObject({ code: "missing" });
    });

    it("weist einen Schlüssel ab, der die Wurzel verlassen will", async () => {
        await expect(store.read("../außerhalb", 10)).rejects.toThrow(MediaStorageError);
        await expect(store.read("/etc/passwd", 10)).rejects.toThrow(MediaStorageError);
        await expect(store.read("incoming\\x", 10)).rejects.toThrow(MediaStorageError);
    });

    it("🔴 über eine Verknüpfung im Baum wird nichts außerhalb der Wurzel gelesen", async () => {
        const outside = await mkdtemp(join(tmpdir(), "avesmaps3d-media-outside-"));
        try {
            await writeFile(join(outside, "geheim.bin"), "nicht für das Netz");
            await symlink(outside, join(root, "incoming"), "junction");
            await expect(store.read("incoming/geheim.bin", 1024)).rejects.toThrow(MediaStorageError);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it("das Fehlerobjekt trägt einen Code, die übrigen Fehler sind `other`", () => {
        expect(new MediaStorageError("x").code).toBe("other");
        expect(new MediaStorageError("x", { code: "missing" }).code).toBe("missing");
    });
});

describe("Eingang aufräumen", () => {
    let root: string;
    let store: MediaStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-media-sweep-"));
        store = new MediaStore(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("entfernt nur alte Dateien in incoming/, nie authoritative Klassen", async () => {
        const keep = await store.store("private_source", bytes("authoritativ"), "png");
        await mkdir(join(root, "incoming"), { recursive: true });
        const old = join(root, "incoming", "alt.bin");
        const fresh = join(root, "incoming", "neu.bin");
        await writeFile(old, "alt");
        await writeFile(fresh, "neu");
        const longAgo = new Date(Date.now() - 3_600_000);
        await utimes(old, longAgo, longAgo);
        await mkdir(join(root, "incoming", "ordner"));

        expect(await store.sweepIncoming(60_000)).toBe(1);
        expect(existsSync(old)).toBe(false);
        expect(existsSync(fresh)).toBe(true);
        expect(existsSync(join(root, "incoming", "ordner"))).toBe(true);
        expect(await store.exists(keep.key)).toBe(true);
    });

    it("ohne incoming/ gibt es nichts zu tun", async () => {
        expect(await store.sweepIncoming(0)).toBe(0);
    });
});
