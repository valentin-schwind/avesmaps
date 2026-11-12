import type { Dirent } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_PUBLIC_URL_PATTERN, mediaPublicUrl } from "@avesmaps3d/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestImage, type IngestStep } from "../src/media/raster/ingest.ts";
import { RasterRejection } from "../src/media/raster/inspect.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import { MediaStore, sha256Of } from "../src/media/storage.ts";
import { GRADIENT_SVG, jpegWithExif, minimalGif, patternImage, png, halvesImage } from "./support/media-fixtures.ts";

// Das erste Bild einer Datei lädt die Bildbibliothek; unter Last (andere Sitzungen, Volllauf) reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Die Aufnahme eines Bildes (WI-0063 MEDIA-M7): privates Original unter `private/source`, öffentliche WebP-Datei unter
 * `published/sha256/…`, nichts bei einer Abweisung, kein Name des Nutzers im Schlüssel.
 */

describe("Aufnahme", () => {
    let root: string;
    let store: MediaStore;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "avesmaps3d-raster-"));
        store = new MediaStore(root);
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    async function files(): Promise<string[]> {
        const found: string[] = [];
        async function walk(directory: string): Promise<void> {
            let entries: Dirent[];
            try {
                entries = await readdir(directory, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) await walk(path);
                else found.push(path.slice(root.length + 1).replaceAll("\\", "/"));
            }
        }
        await walk(root);
        return found.sort();
    }

    it("legt das Original privat und die WebP-Datei unter published/ ab, mit Hash, Größe und Maßen für media_file", async () => {
        const original = await png(patternImage(640, 480, 4));
        const result = await ingestImage(store, { bytes: original, role: "coat", publish: true });

        expect(result.format).toBe("png");
        expect(result.source).toMatchObject({
            variant: "source",
            storageClass: "private_source",
            mimeType: "image/png",
            width: 640,
            height: 480,
            byteSize: original.length,
            sha256: sha256Of(original),
            derivativeRecipe: null,
            recipeVersion: null,
            written: true,
        });
        expect(result.source.key).toBe(
            `private/source/sha256/${sha256Of(original).slice(0, 2)}/${sha256Of(original).slice(2, 4)}/${sha256Of(original)}.png`,
        );

        expect(result.derivatives).toHaveLength(1);
        const [derivative] = result.derivatives;
        expect(derivative).toMatchObject({
            variant: PUBLISHED_VARIANT.coat,
            storageClass: "published",
            mimeType: "image/webp",
            derivativeRecipe: "coat",
            written: true,
        });
        expect(derivative?.recipeVersion).toMatch(/^1 \/ sharp \d+\.\d+\.\d+ \/ libvips \S+ \/ libwebp \S+$/);
        expect([derivative?.width, derivative?.height]).toEqual([512, 384]);

        // Hash, Größe und Schlüssel stimmen mit den abgelegten Bytes überein; die Adresse ist die öffentliche.
        const stored = await readFile(join(root, derivative?.key ?? ""));
        expect(sha256Of(stored)).toBe(derivative?.sha256);
        expect(stored.length).toBe(derivative?.byteSize);
        expect(derivative?.key).toBe(
            `published/sha256/${derivative?.sha256.slice(0, 2)}/${derivative?.sha256.slice(2, 4)}/${derivative?.sha256}.webp`,
        );
        expect(mediaPublicUrl(derivative?.sha256 ?? "")).toMatch(new RegExp(MEDIA_PUBLIC_URL_PATTERN));
        expect(new Uint8Array(await readFile(join(root, result.source.key)))).toEqual(new Uint8Array(original));
        expect(await files()).toEqual([derivative?.key, result.source.key].sort());
    });

    it("🔴 ohne Freigabe (publish: false) entsteht nichts unter published/, das Original bleibt privat", async () => {
        const original = await png(patternImage(120, 90));
        const result = await ingestImage(store, { bytes: original, role: "header", publish: false, preview: true });
        expect(result.derivatives).toEqual([]);
        const written = await files();
        expect(written).toHaveLength(2);
        expect(written).toContain(result.source.key);
        expect(written.some((path) => path.startsWith("published/"))).toBe(false);
        // Die private Vorschau (WI-0068 P4b): dieselbe gerechnete Fassung, aber unter derivatives/ (ohne öffentliche Adresse).
        expect(result.preview).toMatchObject({
            variant: `intern_${PUBLISHED_VARIANT.header}`,
            storageClass: "derivative",
            mimeType: "image/webp",
            derivativeRecipe: PUBLISHED_VARIANT.header,
        });
        expect(result.preview?.key.startsWith("derivatives/")).toBe(true);
        expect(written).toContain(result.preview?.key);
    });

    it("darf der Prozess nicht nach derivatives/ schreiben, fehlt nur die Vorschau (Befund), die Aufnahme gilt", async () => {
        const original = await png(patternImage(120, 90));
        const ohneRecht = Object.create(store) as MediaStore;
        ohneRecht.store = async (storageClass, bytes, extension) => {
            if (storageClass === "derivative") throw Object.assign(new Error("verweigert"), { code: "EACCES" });
            return store.store(storageClass, bytes, extension);
        };
        const result = await ingestImage(ohneRecht, { bytes: original, role: "header", publish: false, preview: true });
        expect(result.preview).toBeUndefined();
        expect(result.findings.map((finding) => finding.code)).toContain("private_preview_not_stored");
        expect(await files()).toEqual([result.source.key]);
    });

    it("mit Freigabe oder ohne Bitte (media_derive schreibt keine Zeilen) entsteht keine private Vorschau", async () => {
        const original = await png(patternImage(120, 90));
        const result = await ingestImage(store, { bytes: original, role: "header", publish: true, preview: true });
        expect(result.derivatives).toHaveLength(1);
        expect(result.preview).toBeUndefined();
        const ohneBitte = await ingestImage(store, { bytes: original, role: "coat", publish: false });
        expect(ohneBitte.preview).toBeUndefined();
        expect((await files()).some((path) => path.startsWith("derivatives/"))).toBe(false);
    });

    it("jede Rolle wählt ihr Profil und ihren Variantennamen", async () => {
        const original = await png(patternImage(900, 600, 3, false));
        for (const [role, expected] of [
            ["coat", [512, 341]],
            ["header", [800, 450]],
            ["map_full", [900, 600]],
            ["map_preview", [400, 267]],
            ["literature_cover", [600, 400]],
        ] as const) {
            const result = await ingestImage(store, { bytes: original, role, publish: true });
            const [derivative] = result.derivatives;
            expect(derivative?.variant, role).toBe(PUBLISHED_VARIANT[role]);
            expect(derivative?.derivativeRecipe, role).toBe(PUBLISHED_VARIANT[role]);
            expect([derivative?.width, derivative?.height], role).toEqual(expected);
        }
        // Dasselbe Original ist EINE Datei unter private/source; die fünf Derivate sind fünf Dateien.
        const all = await files();
        expect(all.filter((path) => path.startsWith("private/source/"))).toHaveLength(1);
        expect(all.filter((path) => path.startsWith("published/"))).toHaveLength(5);
    });

    it("🔴 der zweite Lauf ergibt dieselben Schlüssel und Hashes und schreibt nichts neu", async () => {
        const original = await jpegWithExif(patternImage(300, 200), 1);
        const first = await ingestImage(store, { bytes: original, role: "header", publish: true });
        const before = await files();
        const second = await ingestImage(store, { bytes: original, role: "header", publish: true });
        expect(second.source.key).toBe(first.source.key);
        expect(second.derivatives[0]?.key).toBe(first.derivatives[0]?.key);
        expect(second.derivatives[0]?.sha256).toBe(first.derivatives[0]?.sha256);
        expect(second.source.written).toBe(false);
        expect(second.derivatives[0]?.written).toBe(false);
        expect(await files()).toEqual(before);
    });

    it("der Name der Datei des Nutzers beeinflusst keinen Speicherpfad: es gibt keinen Namen in der Schnittstelle", async () => {
        const original = await png(patternImage(64, 64));
        const result = await ingestImage(store, { bytes: original, role: "coat", publish: true });
        for (const file of await files()) {
            expect(file).toMatch(
                /^(private\/source|published)\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.(png|webp)$/,
            );
        }
        expect(Object.keys(result.source).sort()).not.toContain("name");
    });

    it("🔴 eine abgewiesene Datei hinterlässt nichts im Speicher", async () => {
        const cases: [Uint8Array, string][] = [
            [new TextEncoder().encode("<html>kein Bild</html>"), "unsupported_format"],
            [minimalGif(2), "animated_or_multiframe"],
            [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>'), "svg_has_text"],
        ];
        for (const [bytes, code] of cases) {
            await expect(ingestImage(store, { bytes, role: "coat", publish: true })).rejects.toMatchObject({ code });
        }
        const full = await png(patternImage(200, 150));
        const truncated = full.subarray(0, Math.floor(full.length / 2));
        await expect(ingestImage(store, { bytes: truncated, role: "coat", publish: true })).rejects.toBeInstanceOf(
            RasterRejection,
        );
        expect(await files()).toEqual([]);
    });

    it("ein SVG bleibt privates Quellartefakt, öffentlich ist nur sein Raster", async () => {
        const svg = new TextEncoder().encode(GRADIENT_SVG);
        const result = await ingestImage(store, { bytes: svg, role: "coat", publish: true });
        expect(result.format).toBe("svg");
        expect(result.source).toMatchObject({ mimeType: "image/svg+xml", width: null, height: null });
        expect(result.source.key.startsWith("private/source/")).toBe(true);
        expect(result.source.key.endsWith(".svg")).toBe(true);
        expect(result.findings).toEqual([{ code: "svg_source", detail: expect.any(String) }]);
        expect(result.derivatives[0]?.mimeType).toBe("image/webp");
        const all = await files();
        expect(all.filter((path) => path.endsWith(".svg"))).toEqual([result.source.key]);
        expect(all.filter((path) => path.startsWith("published/")).every((path) => path.endsWith(".webp"))).toBe(true);
    });

    it("meldet die Schritte der Reihe nach (der Job zeichnet daraus seine Phasen auf)", async () => {
        const steps: IngestStep[] = [];
        await ingestImage(store, { bytes: await png(halvesImage(40, 30)), role: "coat", publish: true }, (step) => {
            steps.push(step);
        });
        expect(steps).toEqual(["inspect", "render", "store"]);
    });

    it("EXIF, GPS und Kamerakennung stehen weder im veröffentlichten Derivat noch in dessen Schlüssel", async () => {
        const original = await jpegWithExif(patternImage(120, 90), 6);
        const result = await ingestImage(store, { bytes: original, role: "header", publish: true });
        const published = await readFile(join(root, result.derivatives[0]?.key ?? ""));
        expect(published.includes("FixtureCam")).toBe(false);
        // Das private Original behält seine Metadaten: es ist die authoritative Quelle.
        const privateSource = await readFile(join(root, result.source.key));
        expect(privateSource.includes("FixtureCam")).toBe(true);
    });

    it("zwei Aufnahmen derselben Bytes in verschiedenen Rollen teilen sich das Original physisch", async () => {
        const original = await png(patternImage(100, 100));
        const a = await ingestImage(store, { bytes: original, role: "coat", publish: false });
        const b = await ingestImage(store, { bytes: original, role: "map_preview", publish: false });
        expect(a.source.key).toBe(b.source.key);
        expect(b.source.written).toBe(false);
    });
});
