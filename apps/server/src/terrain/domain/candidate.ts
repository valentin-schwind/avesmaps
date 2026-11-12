import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "../../findings.ts";
import { writeCoarseState } from "./coarse-cache.ts";
import type { CoarseState } from "./coarse-local.ts";
import type { InputIndex } from "./input-index.ts";

/**
 * Die Kandidatenablage (JOBS-0001 Q8, MS17, WI-0125): Ein `terrain_local` legt sein Ergebnis hier ab, `dem_publish` holt es und
 * veröffentlicht. Nichts davon ist für andere sichtbar, bis `dem_publish` den Zeiger wechselt.
 *
 * - **Ort:** `TERRAIN_CANDIDATE_DIR`; auf dem VPS das Arbeitsverzeichnis des Workers (Claudio Q8: `/var/lib/avesmaps3d-jobs/<env>/candidates`,
 *   Besitz der Worker-Rolle). Ohne Variable lokal unter `C:\avesmaps3d-data\work\terrain-candidates` (neben den übrigen
 *   Arbeitsdaten), anderswo im temporären Verzeichnis.
 * - **Form:** je Job ein Ordner `<domäne>/<job>/` mit `candidate.json` (Kopf) und `tiles.u16` (die Kerne der Rechenkacheln des
 *   Fußabdrucks, je 1024² uint16, Zeile 0 im Süden, in der Reihenfolge von `tiles`). Der Kopf nennt den SHA-256 der Kacheln; wer
 *   liest, prüft ihn. Geschrieben wird erst beiseite, dann umbenannt: Ein halber Kandidat wird nie gelesen. Dazu der neue Stand der
 *   groben Stufe (`coarse.bin`, `coarse.json`, WI-0223); `dem_publish` macht ihn zum Stand des neuen Masters.
 * - **Aufräumen:** beim Veröffentlichen, sonst nach 24 Stunden (Q8), bei jedem `terrain_local` und `dem_publish`.
 */

export const CANDIDATE_VERSION = 1;
export const CANDIDATE_MAX_AGE_MS = 24 * 3_600_000;

export interface CandidateHead {
    version: number;
    domain: string;
    job: string;
    createdAt: string;
    /** Der Master und die Revision, auf die gerechnet wurde. */
    base: { fingerprint: string; revision: string };
    /** `domainInputFingerprint` der Eingaben, mit denen gerechnet wurde. */
    inputFingerprint: string;
    /** Der Eingabeindex derselben Eingaben (geht an den vorläufigen Master). */
    inputIndex: InputIndex;
    /** Die Rechenkacheln (Index ty * per + tx) in der Reihenfolge der Kacheldatei. */
    tiles: number[];
    tilesPerSide: number;
    /** Kantenlänge des Masters (8192). */
    size: number;
    sha256: string;
    /** Was der Job erkannt hat (Schlüssel und Art), für Bericht und Ereignis. */
    changes: { key: string; kind: string }[];
    findings: Finding[];
}

export interface Candidate {
    head: CandidateHead;
    /** Je Rechenkachel ihr Kern, in der Reihenfolge von `head.tiles`. */
    tiles: Uint16Array[];
}

export function candidateRoot(environment: NodeJS.ProcessEnv = process.env): string {
    const configured = environment["TERRAIN_CANDIDATE_DIR"];
    if (configured) return configured;
    return process.platform === "win32"
        ? "C:\\avesmaps3d-data\\work\\terrain-candidates"
        : join(tmpdir(), "avesmaps3d-terrain-candidates");
}

const safe = (part: string): string => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(part)) throw new Error(`Ungültiger Teil eines Kandidatenpfads: ${part}`);
    return part;
};

export function candidateDir(domain: string, job: string, root: string = candidateRoot()): string {
    return join(root, safe(domain), safe(job));
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Legt einen Kandidaten ab und gibt seinen Ordner zurück. */
export async function writeCandidate(
    head: Omit<CandidateHead, "sha256" | "version">,
    tiles: readonly Uint16Array[],
    root: string = candidateRoot(),
    coarse?: CoarseState,
): Promise<string> {
    if (tiles.length !== head.tiles.length) throw new Error("Kandidat: Zahl der Kacheln passt nicht zum Kopf");
    const bytes = Buffer.concat(tiles.map((tile) => Buffer.from(tile.buffer, tile.byteOffset, tile.byteLength)));
    const dir = candidateDir(head.domain, head.job, root);
    const part = `${dir}.part`;
    await rm(part, { recursive: true, force: true });
    await mkdir(part, { recursive: true });
    await writeFile(join(part, "tiles.u16"), bytes);
    const full: CandidateHead = { ...head, version: CANDIDATE_VERSION, sha256: sha256(bytes) };
    await writeFile(join(part, "candidate.json"), JSON.stringify(full));
    if (coarse) await writeCoarseState(part, "coarse", coarse, null);
    await rm(dir, { recursive: true, force: true });
    await rename(part, dir);
    return dir;
}

/** Liest einen Kandidaten und prüft ihn gegen seinen Kopf; ein beschädigter oder halber Kandidat wirft. */
export async function readCandidate(domain: string, job: string, root: string = candidateRoot()): Promise<Candidate> {
    const dir = candidateDir(domain, job, root);
    const head = JSON.parse(await readFile(join(dir, "candidate.json"), "utf8")) as CandidateHead;
    if (head.version !== CANDIDATE_VERSION) throw new Error(`Kandidat in Fassung ${String(head.version)}`);
    const bytes = await readFile(join(dir, "tiles.u16"));
    if (sha256(bytes) !== head.sha256) throw new Error("Kandidat beschädigt: SHA-256 passt nicht");
    const side = head.size / head.tilesPerSide;
    const count = side * side;
    if (bytes.byteLength !== head.tiles.length * count * 2) throw new Error("Kandidat: falsche Länge");
    const all = new Uint16Array(bytes.byteLength / 2);
    new Uint8Array(all.buffer).set(bytes);
    return { head, tiles: head.tiles.map((_, i) => all.subarray(i * count, (i + 1) * count)) };
}

export async function removeCandidate(domain: string, job: string, root: string = candidateRoot()): Promise<void> {
    await rm(candidateDir(domain, job, root), { recursive: true, force: true });
}

/** Entfernt Kandidaten (und halbe Ablagen), die älter als `maxAgeMs` sind; gibt ihre Zahl zurück. */
export async function pruneCandidates(
    domain: string,
    now: number = Date.now(),
    maxAgeMs: number = CANDIDATE_MAX_AGE_MS,
    root: string = candidateRoot(),
): Promise<number> {
    const base = join(root, safe(domain));
    let entries: string[];
    try {
        entries = await readdir(base);
    } catch {
        return 0;
    }
    let removed = 0;
    for (const entry of entries) {
        const path = join(base, entry);
        try {
            if (now - (await stat(path)).mtimeMs <= maxAgeMs) continue;
            await rm(path, { recursive: true, force: true });
            removed += 1;
        } catch {
            // Gleichzeitig entfernt: nichts zu tun.
        }
    }
    return removed;
}
