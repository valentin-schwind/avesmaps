import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { legacyLocalPath } from "./media-manifest.ts";
import { plainFileUnder } from "./uploads-path.ts";

/**
 * Das Download-Fach der Legacy-Dateien (WI-0063 MEDIA-M9; Vertrag `media.yaml` → `import_und_idempotenz`): ein Ordner AUSSERHALB des
 * Repositorys, in dem die Bytes unverändert liegen, benannt nach ihrer SHA-256, dazu eine oder mehrere Listen `manifest-*.json`, die
 * je Adresse sagen, was Legacy geliefert hat (Status, Typ, Bytes, SHA-256, ETag, Last-Modified). Derselbe Aufbau wie der Zug vom
 * 2026-10-04 (`C:\avesmaps3d-data\legacy-media`, 582 Dateien), dessen Liste dieses Modul liest.
 *
 *   <Ordner>/sha256/<2>/<2>/<sha256>.<endung>     die Bytes, wie Legacy sie lieferte
 *   <Ordner>/manifest-<Satz>.json                 die Liste (`eintraege[]`, deutsche Schlüssel wie im ersten Zug)
 *
 * 🔴 Dieses Modul liest nur. Den Abruf übernimmt `media-fetch.ts` (gebaut, nicht ausgeführt, nur auf den Zuruf des Betreibers). Eine
 * Adresse wird hier nie aufgelöst: gefragt wird nach `local_url` aus dem Manifest, und die Datei kommt aus dem Ordner, nie aus dem Netz.
 * Der Binärimport prüft jede gelesene Datei gegen die SHA-256 der Liste: eine Datei, die nicht zu ihrem Namen passt, ist beschädigt.
 */

export interface ListingEntry {
    /** Die Adresse in Legacys Speicher, ohne `?v=`. */
    url: string;
    status: number;
    contentType: string | null;
    bytes: number;
    sha256: string;
    etag: string | null;
    lastModified: string | null;
    /** `sha256/<2>/<2>/<hash>.<endung>`, relativ zum Ordner. */
    stored: string;
    /** Wann geholt (ISO), aus dem Eintrag oder, fehlt er dort, aus der Liste. */
    fetchedAt: string | null;
}

/** Eine Datei aus dem Download-Fach, gelesen und gegen ihren Namen geprüft. */
export interface DownloadedFile {
    entry: ListingEntry;
    bytes: Buffer;
}

export type DownloadMiss =
    | { kind: "not_listed" }
    | { kind: "not_ok"; status: number }
    | { kind: "file_missing" }
    | { kind: "too_large"; size: number }
    | { kind: "hash_mismatch"; expected: string; actual: string };

export type DownloadResult = { ok: true; file: DownloadedFile } | { ok: false; miss: DownloadMiss };

/** Was `DownloadStore.remove` getan hat: Zeile und Datei weg, nur die Zeile (geteilte Bytes oder Datei fehlte), nichts. */
export type RemoveResult =
    | { kind: "removed"; bytes: number }
    | { kind: "entry_only"; sharedWith: string[] }
    | { kind: "not_listed" }
    | { kind: "refused"; reason: string };

const STORED_PATTERN = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})\.[a-z0-9]{1,8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** Eine Zeile der Liste in unsere Form; `null`, wenn sie unbrauchbar ist (dann ist die Adresse „nicht gelistet“). */
function readEntry(raw: unknown, listFetchedAt: string | null): ListingEntry | null {
    if (typeof raw !== "object" || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const url = legacyLocalPath(record["url"]);
    const sha256 = asString(record["sha256"]);
    const stored = asString(record["stored"]);
    if (url === null || sha256 === null || !SHA256.test(sha256) || stored === null) return null;
    const match = STORED_PATTERN.exec(stored);
    // Der Ablageort ist aus dem Hash abgeleitet: ein Pfad, der das nicht ist (oder aus dem Ordner hinauswill), ist keiner.
    if (match === null || match[1] !== sha256) return null;
    return {
        url,
        status: typeof record["status"] === "number" ? record["status"] : 0,
        contentType: asString(record["content_type"]),
        bytes: typeof record["bytes"] === "number" ? record["bytes"] : 0,
        sha256,
        etag: asString(record["etag"]),
        lastModified: asString(record["last_modified"]),
        stored,
        fetchedAt: asString(record["abgerufen_am"]) ?? listFetchedAt,
    };
}

export class DownloadStore {
    readonly directory: string;
    private readonly entries: Map<string, ListingEntry>;

    constructor(directory: string, entries: Map<string, ListingEntry>) {
        this.directory = resolve(directory);
        this.entries = entries;
    }

    /** Liest alle Listen `manifest-*.json` des Ordners; bei derselben Adresse gilt der spätere Abruf. */
    static async open(directory: string): Promise<DownloadStore> {
        const entries = new Map<string, ListingEntry>();
        let names: string[] = [];
        try {
            names = (await readdir(directory)).filter((name) => /^manifest-.+\.json$/.test(name)).sort();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        for (const name of names) {
            const list = JSON.parse(await readFile(join(directory, name), "utf8")) as Record<string, unknown>;
            const listFetchedAt = asString(list["abgerufen_am"]);
            const rows = Array.isArray(list["eintraege"]) ? list["eintraege"] : [];
            for (const row of rows) {
                const entry = readEntry(row, listFetchedAt);
                if (entry === null) continue;
                const previous = entries.get(entry.url);
                if (previous === undefined || (entry.fetchedAt ?? "") >= (previous.fetchedAt ?? ""))
                    entries.set(entry.url, entry);
            }
        }
        return new DownloadStore(directory, entries);
    }

    size(): number {
        return this.entries.size;
    }

    entryFor(localUrl: string): ListingEntry | undefined {
        return this.entries.get(localUrl);
    }

    /** Alle gelisteten Adressen (für den Abruf: was schon da ist, wird nicht noch einmal geholt). */
    urls(): string[] {
        return [...this.entries.keys()];
    }

    private pathOf(entry: ListingEntry): string {
        const path = resolve(this.directory, entry.stored);
        // Doppelt gesichert: der Name passt zu STORED_PATTERN, und der Pfad liegt dennoch unter dem Ordner.
        if (!path.startsWith(this.directory + sep)) throw new Error("der Ablageort liegt außerhalb des Download-Fachs");
        return path;
    }

    /**
     * Die Datei zu einer Adresse, gegen ihre SHA-256 geprüft. Die Größe wird VOR dem Lesen geprüft (`maxBytes`): eine Datei über der
     * Grenze kommt nie in den Speicher (der Binärimport weist sie nach D2 ab).
     */
    async read(localUrl: string, maxBytes: number): Promise<DownloadResult> {
        const entry = this.entries.get(localUrl);
        if (entry === undefined) return { ok: false, miss: { kind: "not_listed" } };
        if (entry.status !== 200) return { ok: false, miss: { kind: "not_ok", status: entry.status } };
        const path = this.pathOf(entry);
        let size: number;
        try {
            const info = await lstat(path);
            if (!info.isFile()) return { ok: false, miss: { kind: "file_missing" } };
            size = info.size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return { ok: false, miss: { kind: "file_missing" } };
            throw error;
        }
        if (size > maxBytes) return { ok: false, miss: { kind: "too_large", size } };
        const bytes = await readFile(path);
        const actual = sha256Hex(bytes);
        if (actual !== entry.sha256)
            return { ok: false, miss: { kind: "hash_mismatch", expected: entry.sha256, actual } };
        return { ok: true, file: { entry, bytes } };
    }

    /** Legt Bytes unter ihrem Namen ab (Temporärdatei, dann atomar umbenannt) und trägt die Zeile ein. Für den Abruf. */
    async put(
        entry: Omit<ListingEntry, "stored" | "sha256" | "bytes">,
        bytes: Uint8Array,
        extension: string,
    ): Promise<ListingEntry> {
        if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error("ungültige Dateiendung");
        const sha256 = sha256Hex(bytes);
        const stored = `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`;
        const full: ListingEntry = { ...entry, sha256, bytes: bytes.byteLength, stored };
        const path = this.pathOf(full);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp-${String(process.pid)}`;
        try {
            await writeFile(temporary, bytes);
            await rename(temporary, path);
        } catch (error) {
            await rm(temporary, { force: true });
            throw error;
        }
        this.entries.set(full.url, full);
        return full;
    }

    /**
     * Nimmt eine Adresse aus dem Fach (WI-0086 `--prune`: Legacy nennt sie nicht mehr). Die Zeile verschwindet immer, die Datei nur,
     * wenn keine andere Adresse auf dieselben Bytes zeigt.
     *
     * 💣 **Das Fach ist inhaltsadressiert, und es entdoppelt.** Am 2026-10-04 lagen 582 Adressen auf 525 verschiedenen Dateien: 18
     * Inhalte standen unter mehreren Adressen. Wer beim Aufräumen einer verwaisten Adresse blind ihre Datei löscht, nimmt einer noch
     * gültigen Adresse die Bytes weg - und der Binärimport findet danach `hash_mismatch` oder `file_missing` an einer Stelle, an der
     * niemand etwas aufgeräumt hat.
     *
     * 🔴 Gelöscht wird nur unterhalb des Fachs und nie über eine Verknüpfung hinaus: `pathOf` prüft den Namen, `plainFileUnder`
     * (dieselbe Probe wie die Kopie von `uploads/`) prüft die Platte mit `lstat`, folgt also keiner Verknüpfung.
     */
    async remove(localUrl: string): Promise<RemoveResult> {
        const entry = this.entries.get(localUrl);
        if (entry === undefined) return { kind: "not_listed" };
        const path = this.pathOf(entry);
        const sharedWith = [...this.entries.values()].filter(
            (other) => other.url !== localUrl && other.stored === entry.stored,
        );
        this.entries.delete(localUrl);
        if (sharedWith.length > 0) return { kind: "entry_only", sharedWith: sharedWith.map((other) => other.url) };
        const probe = await plainFileUnder(this.directory, relative(this.directory, path));
        if (probe.kind === "refused") return { kind: "refused", reason: probe.reason };
        if (probe.kind === "missing") return { kind: "entry_only", sharedWith: [] };
        await rm(probe.file, { force: true });
        return { kind: "removed", bytes: probe.size };
    }

    /**
     * Die Liste dieses Zuges schreiben: alle Zeilen, deutsche Schlüssel wie im ersten Zug, sortiert (reproduzierbar).
     *
     * 💣 **`replacesOlderLists` braucht, wer Zeilen ENTFERNT hat.** `open()` liest ALLE `manifest-*.json` und vereinigt sie; eine
     * gelöschte Zeile stünde sonst in der alten Liste weiter da und wäre beim nächsten Öffnen wieder im Fach - mit einer Datei,
     * die es nicht mehr gibt. Mit dem Schalter wird die neue Liste geschrieben und jede ANDERE `manifest-*.json` des Ordners
     * danach entfernt; sie ist dann die ganze Wahrheit über das Fach (WI-0086 `--prune`).
     */
    async writeListing(
        name: string,
        meta: { zug: string; basis: string; fetchedAt: string },
        options: { replacesOlderLists?: boolean } = {},
    ): Promise<string> {
        const rows = [...this.entries.values()].sort((a, b) => a.url.localeCompare(b.url));
        const document = {
            zug: meta.zug,
            satz: name,
            abgerufen_am: meta.fetchedAt,
            basis: meta.basis,
            anzahl: rows.length,
            ok: rows.filter((row) => row.status === 200).length,
            fehler: rows.filter((row) => row.status !== 200).length,
            eintraege: rows.map((row) => ({
                url: row.url,
                status: row.status,
                content_type: row.contentType,
                bytes: row.bytes,
                sha256: row.sha256,
                etag: row.etag,
                last_modified: row.lastModified,
                stored: row.stored,
                abgerufen_am: row.fetchedAt,
            })),
        };
        const file = `manifest-${name}.json`;
        const path = join(this.directory, file);
        await mkdir(this.directory, { recursive: true });
        await writeFile(path, `${JSON.stringify(document, null, 1)}\n`, "utf8");
        if (options.replacesOlderLists === true) {
            // Nur Listen desselben Ordners, nie die eben geschriebene, nie etwas anderes als `manifest-*.json`.
            for (const name of await readdir(this.directory)) {
                if (name !== file && /^manifest-.+\.json$/.test(name)) await rm(join(this.directory, name));
            }
        }
        return path;
    }
}
