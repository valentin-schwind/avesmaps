import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FineCache } from "./fine.ts";

/**
 * Zwischenspeicher der feinen Komposition (WI-0070): die Kachel-Fingerabdrücke und die Höhe vor den globalen
 * Schlussschritten. Er ist nur eine Abkürzung - fehlt er oder passt er nicht, rechnet die Ableitung alle Kacheln.
 * Ort: `TERRAIN_CACHE_DIR`, sonst ein Ordner im temporären Verzeichnis des Systems.
 */
export function fineCacheDir(environment: NodeJS.ProcessEnv = process.env): string {
    return environment["TERRAIN_CACHE_DIR"] ?? join(tmpdir(), "avesmaps3d-terrain-cache");
}

export async function readFineCache(domain: string, dir: string = fineCacheDir()): Promise<FineCache | undefined> {
    try {
        const head = JSON.parse(await readFile(join(dir, `${domain}-fine.json`), "utf8")) as {
            size: number;
            fingerprints: string[];
            sha256: string;
        };
        const bytes = await readFile(join(dir, `${domain}-fine.u16`));
        // Head and raster are renamed one after the other: a reader in between sees a mismatch and recomputes.
        if (bytes.byteLength !== head.size * head.size * 2) return undefined;
        if (createHash("sha256").update(bytes).digest("hex") !== head.sha256) return undefined;
        const composite = new Uint16Array(head.size * head.size);
        new Uint8Array(composite.buffer).set(bytes);
        return { size: head.size, fingerprints: head.fingerprints, composite };
    } catch {
        return undefined;
    }
}

/**
 * Written beside and then renamed; the head names the raster by its hash, so a torn pair is never used. Synchronous:
 * the generator hands the composition over right after the tiles and drops it before the final constraints.
 */
export function writeFineCache(domain: string, cache: FineCache, dir: string = fineCacheDir()): void {
    mkdirSync(dir, { recursive: true });
    const raster = join(dir, `${domain}-fine.u16`);
    const head = join(dir, `${domain}-fine.json`);
    const bytes = new Uint8Array(cache.composite.buffer, cache.composite.byteOffset, cache.composite.byteLength);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(`${raster}.part`, bytes);
    writeFileSync(`${head}.part`, JSON.stringify({ size: cache.size, fingerprints: cache.fingerprints, sha256 }));
    renameSync(`${raster}.part`, raster);
    renameSync(`${head}.part`, head);
}
