import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoarseState } from "./coarse-local.ts";
import { fineCacheDir } from "./fine-cache.ts";

/**
 * Der Stand der groben Stufe auf der Platte (WI-0223 Schritt 2), neben dem Zwischenspeicher der feinen Stufe (`TERRAIN_CACHE_DIR`).
 *
 * - **Wer schreibt:** der volle Lauf (`derive:terrain`, `terrain_full`) nach dem Speichern seines Masters, und `dem_publish` für den
 *   Kandidaten eines lokalen Laufs, wenn er ihn ohne Umbasieren auf genau den Master setzt, auf dem gerechnet wurde. Sonst entfernt
 *   `dem_publish` den Stand: Er gehörte nicht mehr zum Master.
 * - **Wer liest:** `terrain_local`, nur wenn `master` der geltende Master ist. Fehlt der Stand oder passt er nicht, rechnet die grobe
 *   Stufe voll (wie Schritt 1) und gibt danach wieder einen gültigen Stand weiter.
 * - **Form:** `<domäne>-coarse.bin` (Anfangsgelände float32, dann Gebirgsinneres uint16; bei 4096² rund 100 MB) und
 *   `<domäne>-coarse.json` mit Master, Größe und SHA-256. Erst beiseite geschrieben, dann umbenannt, der Kopf zuletzt; ein Leser prüft
 *   den Hash, ein halbes Paar wird nie gelesen.
 */

/** 2: nur Anfangsgelände und Gebirgsinneres (WI-0223 nach der Messung). */
export const COARSE_CACHE_VERSION = 2;

export interface CoarseHead {
    version: number;
    size: number;
    /** Der Master, zu dem der Stand gehört; im Kandidaten noch `null`. */
    master: string | null;
    sha256: string;
}

const bytesOf = (array: Uint16Array | Float32Array | Uint8Array): Buffer =>
    Buffer.from(array.buffer, array.byteOffset, array.byteLength);

function encode(state: CoarseState): Buffer {
    return Buffer.concat([bytesOf(state.initial), bytesOf(state.interior)]);
}

function decode(bytes: Buffer, size: number): CoarseState | undefined {
    const cells = size * size;
    if (bytes.byteLength !== cells * 6) return undefined;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
        initial: new Float32Array(copy.buffer, 0, cells),
        interior: new Uint16Array(copy.buffer, cells * 4, cells),
    };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Schreibt einen Stand als `<name>.bin` und `<name>.json` in `dir`. */
export async function writeCoarseState(
    dir: string,
    name: string,
    state: CoarseState,
    master: string | null,
): Promise<void> {
    const bytes = encode(state);
    const size = Math.round(Math.sqrt(state.interior.length));
    const head: CoarseHead = { version: COARSE_CACHE_VERSION, size, master, sha256: sha256(bytes) };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.bin.part`), bytes);
    await writeFile(join(dir, `${name}.json.part`), JSON.stringify(head));
    await rename(join(dir, `${name}.bin.part`), join(dir, `${name}.bin`));
    await rename(join(dir, `${name}.json.part`), join(dir, `${name}.json`));
}

/** Liest einen Stand; ohne Datei, mit falschem Hash oder falscher Größe `undefined`. */
export async function readCoarseState(
    dir: string,
    name: string,
    size: number,
): Promise<{ head: CoarseHead; state: CoarseState } | undefined> {
    try {
        const head = JSON.parse(await readFile(join(dir, `${name}.json`), "utf8")) as CoarseHead;
        if (head.version !== COARSE_CACHE_VERSION || head.size !== size) return undefined;
        const bytes = await readFile(join(dir, `${name}.bin`));
        if (sha256(bytes) !== head.sha256) return undefined;
        const state = decode(bytes, size);
        return state ? { head, state } : undefined;
    } catch {
        return undefined;
    }
}

export const coarseCacheName = (domain: string): string => `${domain}-coarse`;

/** Der Stand zum geltenden Master, sonst `undefined`. */
export async function readCurrentCoarseState(
    domain: string,
    master: string,
    size: number,
    dir: string = fineCacheDir(),
): Promise<CoarseState | undefined> {
    const read = await readCoarseState(dir, coarseCacheName(domain), size);
    return read?.head.master === master ? read.state : undefined;
}

/**
 * Der volle Lauf gibt seinen Stand ab, bevor die feine Stufe Speicher braucht: synchron und noch ohne Master (`<domäne>-coarse-next`).
 * Nach dem Speichern des Masters macht `promoteCoarseState` ihn zum Stand dieses Masters.
 */
export function writeNextCoarseState(domain: string, state: CoarseState, dir: string = fineCacheDir()): void {
    const bytes = encode(state);
    const size = Math.round(Math.sqrt(state.interior.length));
    const head: CoarseHead = { version: COARSE_CACHE_VERSION, size, master: null, sha256: sha256(bytes) };
    const name = `${coarseCacheName(domain)}-next`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.bin.part`), bytes);
    writeFileSync(join(dir, `${name}.json.part`), JSON.stringify(head));
    renameSync(join(dir, `${name}.bin.part`), join(dir, `${name}.bin`));
    renameSync(join(dir, `${name}.json.part`), join(dir, `${name}.json`));
}

/**
 * Ein abgelegter Stand (`from`: Ordner und Name) wird der Stand von `master`: der des vollen Laufs (`<domäne>-coarse-next`, verschoben)
 * oder der aus dem Kandidaten eines lokalen Laufs (`coarse`, kopiert: Kandidatenablage und Zwischenspeicher dürfen auf verschiedenen
 * Platten liegen). Ohne lesbaren Kopf `false`.
 */
export async function promoteCoarseState(
    from: { dir: string; name: string; move?: boolean },
    domain: string,
    master: string,
    dir: string = fineCacheDir(),
): Promise<boolean> {
    const name = coarseCacheName(domain);
    try {
        const head = JSON.parse(await readFile(join(from.dir, `${from.name}.json`), "utf8")) as CoarseHead;
        if (head.version !== COARSE_CACHE_VERSION) return false;
        await mkdir(dir, { recursive: true });
        const bin = join(from.dir, `${from.name}.bin`);
        if (from.move) await rename(bin, join(dir, `${name}.bin.part`));
        else await copyFile(bin, join(dir, `${name}.bin.part`));
        await writeFile(join(dir, `${name}.json.part`), JSON.stringify({ ...head, master }));
        await rename(join(dir, `${name}.bin.part`), join(dir, `${name}.bin`));
        await rename(join(dir, `${name}.json.part`), join(dir, `${name}.json`));
        if (from.move) await rm(join(from.dir, `${from.name}.json`), { force: true });
        return true;
    } catch {
        return false;
    }
}

/** Der Stand gehört zu keinem Master mehr (Umbasieren, fehlender Stand im Kandidaten). */
export async function dropCoarseState(domain: string, dir: string = fineCacheDir()): Promise<void> {
    const name = coarseCacheName(domain);
    await rm(join(dir, `${name}.json`), { force: true });
    await rm(join(dir, `${name}.bin`), { force: true });
}
