import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { mediaPublicUrl } from "@avesmaps3d/shared";

/**
 * Der lokale Medienspeicher (WI-0063 26.9, Plan MEDIA-M6, `project-control/migration/contracts/media.yaml` → `storage`).
 *
 * Unter `MEDIA_ROOT` liegt `incoming/` (untrusted, temporär), `private/source/`, `private/evidence/`, `master/`,
 * `derivatives/` und `published/`. Nur `published/` hat eine öffentliche Adresse; sie gibt es als EINE Funktion
 * (`publishedUrl`), für die privaten Klassen gibt es keine. Keine HTTP-Route in diesem Paket: die Auslieferung kommt mit
 * den ersten Dateien (MEDIA-3).
 *
 * 🔴 Der Schlüssel entsteht aus Speicherklasse und SHA-256, nie aus einem Nutzerdateinamen, Ortsnamen oder Benutzernamen:
 * `published/sha256/ab/cd/<hash>.webp`. Die Datenbank speichert nur diese relativen Schlüssel.
 *
 * 🔴 `private/kanal/` gehört dem Betreiber-Kanal (KANAL-0001 §6, WI-0124), nicht der Medienverwaltung: keine Zeile in `media_file`,
 * kein Schlüssel nach dem Hash, gelöscht wird nur über `removeChannel` nach seiner Aufbewahrung. Weder `verify:media` noch ein
 * Aufräumen der MAM (`sweepIncoming`, der Abgleich in `settle.ts`, ein späterer Waisen-Scan über `private/`) fasst ihn an (M3).
 *
 * 🔴 Dateisystem und PostgreSQL bilden keine gemeinsame Transaktion. Darum erst die Bytes (Temporärdatei im Zielordner,
 * `fsync`, atomares `rename`), DANN die Datenbanktransaktion: ein unreferenzierter Hash ist aufräumbar, eine Referenz auf
 * fehlende Bytes ist ein Defekt.
 */

export const STORAGE_CLASSES = ["private_source", "master", "derivative", "published"] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

/** Das Verzeichnis je Klasse unter der Medienwurzel; dieselbe Tafel steht als CHECK in Migration 0064. */
const CLASS_DIRECTORY: Readonly<Record<StorageClass, string>> = {
    private_source: "private/source",
    master: "master",
    derivative: "derivatives",
    published: "published",
};

/** Das Verzeichnis der privaten Belege (`media_rights_evidence.storage_key`). */
export const EVIDENCE_DIRECTORY = "private/evidence";

/**
 * Die Ablage des Betreiber-Kanals (KANAL-0001 §6.3 M1): Bildschirmfotos der Betreiber, privat, ohne Zeile der MAM. Je Bild ein Ordner
 * `private/kanal/<bild-uuid>/` mit `original.<endung>`, `ansicht.webp` und `vorschau.webp`: Zwei gleiche Fotos teilen sich keine
 * Datei, und das Löschen nach der Aufbewahrung nimmt genau einen Ordner.
 */
export const CHANNEL_DIRECTORY = "private/kanal";
export const CHANNEL_PARTS = ["original", "ansicht", "vorschau"] as const;
export type ChannelPart = (typeof CHANNEL_PARTS)[number];

/** Das Eingangsverzeichnis: untrusted, nie öffentlich, nie von der Datenbank referenziert. */
export const INCOMING_DIRECTORY = "incoming";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const EXTENSION = /^[a-z0-9]{1,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `missing`: unter dem Schlüssel liegt keine Datei. `too_large`: sie ist größer, als der Aufrufer zu lesen bereit ist. */
export type MediaStorageErrorCode = "missing" | "too_large" | "other";

export class MediaStorageError extends Error {
    readonly code: MediaStorageErrorCode;

    constructor(message: string, options?: ErrorOptions & { code?: MediaStorageErrorCode }) {
        super(message, options);
        this.name = "MediaStorageError";
        this.code = options?.code ?? "other";
    }
}

export function sha256Of(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Die Dateiendung zu einem erkannten MIME-Typ. Sie kommt aus dem Typ, den der Server aus den Bytes bestimmt hat,
 * nie aus dem Namen der Datei des Nutzers.
 */
export function extensionForMime(mimeType: string): string {
    switch (mimeType) {
        case "image/webp":
            return "webp";
        case "image/png":
            return "png";
        case "image/jpeg":
            return "jpg";
        case "image/gif":
            return "gif";
        case "image/svg+xml":
            return "svg";
        default:
            return "bin";
    }
}

/**
 * Der Schlüssel einer Datei: `<Klassenverzeichnis>/sha256/<2>/<2>/<hash>.<endung>`. Eine veröffentlichte Datei ist
 * immer eine WebP-Datei.
 */
export function storageKey(storageClass: StorageClass, sha256: string, extension: string): string {
    if (!SHA256_HEX.test(sha256)) throw new MediaStorageError("sha256 muss 64 Hexzeichen in Kleinschreibung haben");
    if (!EXTENSION.test(extension)) throw new MediaStorageError("ungültige Dateiendung");
    if (storageClass === "published" && extension !== "webp") {
        throw new MediaStorageError("eine veröffentlichte Datei ist immer eine WebP-Datei");
    }
    return `${CLASS_DIRECTORY[storageClass]}/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`;
}

/** Der Schlüssel eines privaten Belegs: `private/evidence/sha256/<2>/<2>/<hash>.<endung>` (CHECK in Migration 0064). */
export function evidenceKey(sha256: string, extension: string): string {
    if (!SHA256_HEX.test(sha256)) throw new MediaStorageError("sha256 muss 64 Hexzeichen in Kleinschreibung haben");
    if (!EXTENSION.test(extension)) throw new MediaStorageError("ungültige Dateiendung");
    return `${EVIDENCE_DIRECTORY}/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`;
}

/** Der Ordner eines Kanalbilds: `private/kanal/<bild-uuid>`. Die Kennung ist eine UUID in Kleinschreibung, nie ein Name. */
export function channelDirectory(bildId: string): string {
    if (!UUID.test(bildId))
        throw new MediaStorageError("die Kennung eines Kanalbilds ist eine UUID in Kleinschreibung");
    return `${CHANNEL_DIRECTORY}/${bildId}`;
}

/** Der Schlüssel eines Teils: `private/kanal/<bild-uuid>/<original|ansicht|vorschau>.<endung>`; die Fassungen sind immer WebP. */
/**
 * Neue Ordner unter `private/` (Quelle, Belege, Quarantäne, Kanal) und unter `master/` (die verlustfreie Fassung eines Werks, dessen Original gelöscht ist, WI-0275) entstehen
 * mit 0700, nur für den Dienstbenutzer (Claudio 2026-10-11, SYS-10: 0700 vererbt sich nicht); unter `published/` gilt die umask, damit Nginx liest. Unter Windows ohne Wirkung.
 */
function ordnerModus(key: string): { recursive: true; mode?: number } {
    return key.startsWith("private/") || key.startsWith("master/")
        ? { recursive: true, mode: 0o700 }
        : { recursive: true };
}

export function channelKey(bildId: string, part: ChannelPart, extension: string): string {
    if (!CHANNEL_PARTS.includes(part)) throw new MediaStorageError("unbekannter Teil eines Kanalbilds");
    if (!EXTENSION.test(extension)) throw new MediaStorageError("ungültige Dateiendung");
    if (part !== "original" && extension !== "webp") {
        throw new MediaStorageError("eine Fassung eines Kanalbilds ist immer eine WebP-Datei");
    }
    return `${channelDirectory(bildId)}/${part}.${extension}`;
}

/**
 * Das Verzeichnis der Quarantäne (WI-0127 SYS-10 b3, Migration 0104): Hier liegt eine veröffentlichte Datei, solange ein Inhaltsschalter
 * oder ein Notaus ihre Bytes aus der Auslieferung nimmt. Privat wie die Originale: keine Adresse, Nginx liefert nur `published/` aus.
 */
export const QUARANTINE_DIRECTORY = "private/quarantine";

/** Der Schlüssel einer veröffentlichten Datei in Quarantäne: `private/quarantine/sha256/<2>/<2>/<hash>.webp`. */
export function quarantineKey(sha256: string): string {
    return `${QUARANTINE_DIRECTORY}/${storageKey("published", sha256, "webp").slice(`${CLASS_DIRECTORY.published}/`.length)}`;
}

/** Was ein Umzug zwischen `published/` und der Quarantäne getan hat. */
export type QuarantineMove = "moved" | "already" | "missing";

/** Die öffentliche Adresse einer veröffentlichten Datei. Für private Klassen gibt es absichtlich nichts Entsprechendes. */
export function publishedUrl(sha256: string): string {
    return mediaPublicUrl(sha256);
}

/**
 * Der Schlüssel der Instagram-Fassung (WI-0268 C12b): `published/sha256/<2>/<2>/<hash>.ig.jpg`, NEBEN der WebP desselben Hashes. Instagram nimmt nur JPEG; der Social Hub erzeugt die Fassung beim Senden
 * (`community/social/instagram-ableitung.ts`). Sie hat keine Zeile in `media_file` und ist eine reine Ableitung: Sie ist nie länger öffentlich als ihre WebP (siehe `leavePublished`).
 */
export function instagramKey(sha256: string): string {
    return storageKey("published", sha256, "webp").replace(/\.webp$/u, ".ig.jpg");
}

/** Die WebP zu einer Instagram-Fassung aus deren Schlüssel; `undefined`, wenn der Schlüssel keine Instagram-Fassung ist. */
export function instagramWebpKey(key: string): string | undefined {
    const parts = /^published\/sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.ig\.jpg$/u.exec(key);
    if (parts === null) return undefined;
    const [, first, second, sha256] = parts as unknown as [string, string, string, string];
    return first === sha256.slice(0, 2) && second === sha256.slice(2, 4)
        ? storageKey("published", sha256, "webp")
        : undefined;
}

/** Der Hash einer veröffentlichten WebP-Datei aus ihrem Schlüssel; `undefined`, wenn der Schlüssel keine ist. */
export function publishedWebpHash(key: string): string | undefined {
    const parts = /^published\/sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/u.exec(key);
    if (parts === null) return undefined;
    const [, first, second, sha256] = parts as unknown as [string, string, string, string];
    return first === sha256.slice(0, 2) && second === sha256.slice(2, 4) ? sha256 : undefined;
}

/**
 * Ein Schlüssel ist relativ zur Wurzel: nicht leer, nicht absolut, kein Laufwerk, kein Rückwärtsstrich, kein `..`- oder
 * `.`-Segment, kein leeres Segment, kein Steuerzeichen. Dieselbe Regel wie `media_storage_key_is_relative` (Migration
 * 0064), nur strenger bei Segmenten.
 */
export function assertRelativeKey(key: string): void {
    const invalid = (reason: string): never => {
        throw new MediaStorageError(`ungültiger Speicherschlüssel: ${reason}`);
    };
    if (key.trim() === "") invalid("leer");
    if (key.startsWith("/")) invalid("absolut");
    if (/^[A-Za-z]:/.test(key)) invalid("Laufwerk");
    if (key.includes("\\")) invalid("Rückwärtsstrich");
    // eslint-disable-next-line no-control-regex -- genau darum geht es: Steuerzeichen in einem Pfad
    if (/[\u0000-\u001f\u007f]/.test(key)) invalid("Steuerzeichen");
    for (const segment of key.split("/")) {
        if (segment === "") invalid("leeres Segment");
        if (segment === "." || segment === "..") invalid("Pfadsegment . oder ..");
    }
}

export interface StoredMedia {
    key: string;
    sha256: string;
    byteSize: number;
    /** `false`: die Datei lag mit denselben Bytes schon da und wurde nicht neu geschrieben (physische Deduplizierung). */
    written: boolean;
}

const isInside = (root: string, candidate: string): boolean => candidate === root || candidate.startsWith(root + sep);

async function statOrNull(path: string): Promise<Stats | null> {
    try {
        return await stat(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

/**
 * Die Dateioperation, an der die Atomizität hängt. Sie ist austauschbar, damit ein Test beweisen kann, WANN der Endname
 * entsteht (nur durch `rename` einer vollständigen Datei); im Betrieb gilt immer `fs.rename`.
 */
export interface MediaFileOperations {
    rename(from: string, to: string): Promise<void>;
}

export class MediaStore {
    readonly root: string;
    private readonly operations: MediaFileOperations;

    constructor(root: string, operations: MediaFileOperations = { rename }) {
        if (!isAbsolute(root)) throw new MediaStorageError("MEDIA_ROOT muss ein absoluter Pfad sein");
        this.root = resolve(root);
        this.operations = operations;
    }

    /**
     * Der Pfad eines Schlüssels. Der aufgelöste Pfad muss UNTER der Wurzel liegen, sonst ein Fehler: ein Schlüssel kann
     * die Wurzel nie verlassen, auch nicht über `..`, einen absoluten Pfad oder ein Laufwerk.
     */
    pathFor(key: string): string {
        assertRelativeKey(key);
        const path = resolve(this.root, key);
        if (path === this.root || !path.startsWith(this.root + sep)) {
            throw new MediaStorageError("der Schlüssel liegt außerhalb der Medienwurzel");
        }
        return path;
    }

    /**
     * Auch über eine Verknüpfung oder einen Junction im Baum darf eine Datei die Wurzel nicht verlassen. Geprüft wird
     * der tiefste vorhandene Vorfahre des Zielordners, VOR `mkdir`: nichts entsteht außerhalb der Wurzel.
     *
     * `create` legt die Wurzel an, wenn sie fehlt; ein reiner Lesepfad (die Auslieferung) schreibt nichts und bekommt
     * dann den `ENOENT` der Wurzel.
     */
    private async assertRealPathInside(directory: string, create = true): Promise<void> {
        if (create) await mkdir(this.root, { recursive: true });
        const realRoot = await realpath(this.root);
        let ancestor = directory;
        for (;;) {
            try {
                const real = await realpath(ancestor);
                if (!isInside(realRoot, real)) {
                    throw new MediaStorageError(
                        "das Zielverzeichnis liegt (über eine Verknüpfung) außerhalb der Medienwurzel",
                    );
                }
                return;
            } catch (error) {
                if (error instanceof MediaStorageError) throw error;
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                const parent = dirname(ancestor);
                if (parent === ancestor) throw error;
                ancestor = parent;
            }
        }
    }

    async exists(key: string): Promise<boolean> {
        const info = await statOrNull(this.pathFor(key));
        return info?.isFile() === true;
    }

    /**
     * Der geprüfte Pfad einer vorhandenen Datei samt Größe, ohne ihre Bytes zu lesen: für die Auslieferung (MEDIA-M12),
     * die die Datei streamt statt sie in den Speicher zu holen. Dieselben Schlösser wie `read` - Schlüssel unter der
     * Wurzel, kein `..`, keine Verknüpfung aus dem Baum hinaus, eine echte Datei -, nur legt dieser Weg nichts an.
     */
    async locate(key: string): Promise<{ path: string; byteSize: number }> {
        const path = this.pathFor(key);
        try {
            await this.assertRealPathInside(dirname(path), false);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new MediaStorageError(`die Datei ${key} fehlt`, { code: "missing", cause: error });
            }
            throw error;
        }
        let info: Stats;
        try {
            info = await lstat(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new MediaStorageError(`die Datei ${key} fehlt`, { code: "missing", cause: error });
            }
            throw error;
        }
        // Keine Verknüpfung und kein Verzeichnis: nur eine Datei, die dort selbst liegt.
        if (!info.isFile()) {
            throw new MediaStorageError(`unter dem Schlüssel ${key} liegt keine Datei`, { code: "missing" });
        }
        return { path, byteSize: info.size };
    }

    /**
     * Liest die Bytes eines Schlüssels. Die Größe wird VOR dem Lesen geprüft: eine Datei über `maxBytes` kommt nie in den
     * Speicher. Eine Verknüpfung statt einer Datei und ein Zielordner außerhalb der Wurzel sind ein Fehler; `incoming/` ist
     * untrusted, dort darf nichts auf eine fremde Datei zeigen.
     */
    async read(key: string, maxBytes: number): Promise<Buffer> {
        const path = this.pathFor(key);
        await this.assertRealPathInside(dirname(path));
        let info: Stats;
        try {
            info = await lstat(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                throw new MediaStorageError(`die Datei ${key} fehlt`, { code: "missing", cause: error });
            }
            throw error;
        }
        if (!info.isFile()) {
            throw new MediaStorageError(`unter dem Schlüssel ${key} liegt keine Datei`, { code: "missing" });
        }
        if (info.size > maxBytes) {
            throw new MediaStorageError(
                `die Datei ${key} hat ${String(info.size)} Bytes, gelesen werden höchstens ${String(maxBytes)}`,
                { code: "too_large" },
            );
        }
        return readFile(path);
    }

    /**
     * Entfernt EINE Datei unter ihrem Schlüssel; `false`, wenn dort nichts lag. Nur für Dateien, die keine Zeile mehr hält und die
     * reproduzierbar sind (eine öffentliche Datei, deren Freigabe wegfiel): die authoritativen Klassen räumt ein Mensch auf. Wie
     * `read` und `store` bleibt der Schlüssel unter der Wurzel, auch über eine Verknüpfung; ein Verzeichnis wird nie gelöscht.
     */
    async remove(key: string): Promise<boolean> {
        // Nie ein Original, ein Master oder ein Beleg: nur die reproduzierbaren Klassen und das Eingangsverzeichnis.
        if (!["published/", "derivatives/", `${INCOMING_DIRECTORY}/`].some((prefix) => key.startsWith(prefix))) {
            throw new MediaStorageError("entfernt werden nur Dateien aus published/, derivatives/ und incoming/");
        }
        return this.removeFile(key, true);
    }

    /**
     * Entfernt die Kopie einer veröffentlichten Datei aus der Quarantäne (`media_settle`, Code-Review 2026-10-16 S8-04): nur, wenn
     * keine Zeile die veröffentlichte Datei mehr hält. Sonst gäbe ein späterer Rückweg der Quarantäne eine Datei ohne Zeile frei.
     */
    async removeQuarantined(sha256: string): Promise<boolean> {
        return this.removeFile(quarantineKey(sha256));
    }

    /**
     * Entfernt eine Datei eines endgültig gelöschten Werks (`media-editor/asset-delete.ts`, Recht `delete_media`): auch Original,
     * Master und Beleg, aber nur unter den Verzeichnissen der MAM und nur, nachdem die Zeilen weg sind und keine andere sie hält. Der
     * einzige Weg, auf dem ein Original verschwindet; jeder andere Aufräumer nimmt `remove`. Ebenso das Original eines angenommenen Kartenvorschlags
     * (`kartenvorschlag/original-loeschen.ts`): dort bleibt die Zeile mit Stempel, und keine lebende Zeile hält die Datei.
     */
    async removeAfterDelete(key: string): Promise<boolean> {
        const verzeichnisse = [...Object.values(CLASS_DIRECTORY), EVIDENCE_DIRECTORY].map((name) => `${name}/`);
        if (!verzeichnisse.some((prefix) => key.startsWith(prefix))) {
            throw new MediaStorageError(
                "ein gelöschtes Werk hat nur Dateien unter den Verzeichnissen der Medienverwaltung",
            );
        }
        return this.removeFile(key, true);
    }

    /**
     * Entfernt die Instagram-Fassung zu einer WebP (`false`, wenn es keine gab). Ihr Hash ist der der WebP. Wie jede Entfernung bleibt der Schlüssel unter der Wurzel, auch über eine Verknüpfung.
     */
    async removeInstagram(sha256: string): Promise<boolean> {
        return this.removeFile(instagramKey(sha256), false);
    }

    /**
     * 🔴 Eine veröffentlichte WebP verlässt `published/` (Quarantäne, Entfernen, endgültiges Löschen): Ihre Instagram-Fassung geht VORHER und NACHHER mit, damit sie nie länger öffentlich ist als die WebP.
     * Vorher, damit sie im Normalfall zuerst verschwindet; nachher, weil ein gleichzeitig laufender Versand sie zwischen beidem neu geschrieben haben kann (er prüft danach zwar, ob die WebP noch da ist, sieht sie
     * aber vielleicht vor dem Umzug). Ein Fehler beim Entfernen der Fassung hält die WebP NICHT fest (ihr Weg aus der Auslieferung hat Vorrang), wird aber danach gemeldet.
     */
    private async leavePublished<T>(sha256: string, leave: () => Promise<T>): Promise<T> {
        let unremoved: unknown;
        const withdraw = async (): Promise<void> => {
            try {
                await this.removeInstagram(sha256);
            } catch (error) {
                unremoved ??= error;
            }
        };
        await withdraw();
        let result: T;
        try {
            result = await leave();
        } finally {
            await withdraw();
        }
        if (unremoved !== undefined) {
            throw new MediaStorageError("die Instagram-Fassung der Datei konnte nicht entfernt werden", {
                cause: unremoved,
            });
        }
        return result;
    }

    private async removeFile(key: string, withInstagram = false): Promise<boolean> {
        const sha256 = withInstagram ? publishedWebpHash(key) : undefined;
        if (sha256 !== undefined) return this.leavePublished(sha256, () => this.removeFile(key, false));
        const path = this.pathFor(key);
        await this.assertRealPathInside(dirname(path));
        let info: Stats;
        try {
            info = await lstat(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw error;
        }
        if (!info.isFile()) throw new MediaStorageError(`unter dem Schlüssel ${key} liegt keine Datei`);
        await rm(path);
        return true;
    }

    /**
     * Nimmt eine veröffentlichte Datei aus der Auslieferung (WI-0127 SYS-10 b3): `published/…` → `private/quarantine/…`, ein `rename`
     * im selben Dateisystem (atomar, die Bytes bleiben unberührt). `already`: sie lag schon dort; `missing`: an keiner der beiden Stellen.
     * Liegt sie an beiden (eine öffentliche Fassung entstand neu), gewinnt die Quarantäne.
     */
    async moveToQuarantine(sha256: string): Promise<QuarantineMove> {
        // Die Instagram-Fassung geht mit (auch wenn die WebP schon fehlt: dann ist sie eine Waise und darf nicht öffentlich bleiben).
        return this.leavePublished(sha256, () =>
            this.moveFile(storageKey("published", sha256, "webp"), quarantineKey(sha256)),
        );
    }

    /** Der Rückweg: `private/quarantine/…` → `published/…`, ebenso atomar; nichts wird neu gerendert. Die Instagram-Fassung kommt NICHT zurück: Der nächste Versand erzeugt sie neu. */
    async restoreFromQuarantine(sha256: string): Promise<QuarantineMove> {
        return this.moveFile(quarantineKey(sha256), storageKey("published", sha256, "webp"));
    }

    private async moveFile(fromKey: string, toKey: string): Promise<QuarantineMove> {
        const from = this.pathFor(fromKey);
        const to = this.pathFor(toKey);
        await this.assertRealPathInside(dirname(from));
        await this.assertRealPathInside(dirname(to));
        const source = await lstat(from).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
        });
        if (source === null) {
            const target = await statOrNull(to);
            return target?.isFile() === true ? "already" : "missing";
        }
        if (!source.isFile()) throw new MediaStorageError(`unter dem Schlüssel ${fromKey} liegt keine Datei`);
        await mkdir(dirname(to), ordnerModus(toKey));
        await this.operations.rename(from, to);
        return "moved";
    }

    /**
     * Legt Bytes unter ihrem inhaltsabgeleiteten Schlüssel ab: Temporärdatei im Zielordner (gleiches Dateisystem, damit
     * `rename` atomar ist), auf die Platte geschrieben, dann an den Endnamen verschoben. Unter dem Endnamen steht nie
     * eine halbe Datei. Liegt dort schon eine Datei mit denselben Bytes, wird nichts geschrieben.
     */
    async store(storageClass: StorageClass, bytes: Uint8Array, extension: string): Promise<StoredMedia> {
        if (bytes.byteLength === 0) throw new MediaStorageError("leere Datei");
        const sha256 = sha256Of(bytes);
        return this.writeAt(storageKey(storageClass, sha256, extension), bytes, sha256);
    }

    /**
     * Legt die Instagram-Fassung zu einer veröffentlichten WebP ab (`instagramKey`): wie `store` (Temporärdatei, `fsync`, `rename`), aber unter dem Hash der WEBP, nicht der JPEG-Bytes. Liegt dort schon eine
     * Datei mit denselben Bytes, wird nichts geschrieben; andere Bytes ersetzt der atomare `rename`.
     */
    async storeInstagram(webpSha256: string, bytes: Uint8Array): Promise<StoredMedia> {
        if (bytes.byteLength === 0) throw new MediaStorageError("leere Datei");
        return this.writeAt(instagramKey(webpSha256), bytes, sha256Of(bytes));
    }

    /**
     * Legt einen privaten Rechtebeleg ab (`media_rights_evidence.storage_key`, WI-0068 P4a): wie `store`, unter
     * `private/evidence/sha256/…`. Ein Beleg hat nie eine Adresse.
     */
    async storeEvidence(bytes: Uint8Array, extension: string): Promise<StoredMedia> {
        if (bytes.byteLength === 0) throw new MediaStorageError("leere Datei");
        const sha256 = sha256Of(bytes);
        return this.writeAt(evidenceKey(sha256, extension), bytes, sha256);
    }

    /**
     * Legt einen Teil eines Kanalbilds ab (KANAL-0001 §6.3 M1): wie `store` (Temporärdatei, `fsync`, `rename`, Prüfung der echten Pfade),
     * aber unter dem Schlüssel des Bildes, nicht des Hashs. Ein zweites Schreiben desselben Teils ersetzt ihn atomar (neues Rendern).
     */
    async storeChannel(bildId: string, part: ChannelPart, bytes: Uint8Array, extension: string): Promise<StoredMedia> {
        if (bytes.byteLength === 0) throw new MediaStorageError("leere Datei");
        return this.writeAt(channelKey(bildId, part, extension), bytes, sha256Of(bytes));
    }

    /**
     * Löscht ein Kanalbild ganz, nach seiner Aufbewahrung (KANAL-0001 §6.1 Nr. 4): alle Dateien in seinem Ordner, dann den Ordner. Zahl der
     * entfernten Dateien; 0, wenn es ihn nicht (mehr) gibt. Keine Verknüpfung und kein Unterordner wird verfolgt: Liegt dort etwas anderes
     * als eine Datei, bricht es ab, statt außerhalb zu löschen. `remove` bleibt für die reproduzierbaren Klassen der MAM.
     */
    async removeChannel(bildId: string): Promise<number> {
        const directory = this.pathFor(channelDirectory(bildId));
        let names: string[];
        try {
            await this.assertRealPathInside(directory, false);
            const info = await lstat(directory);
            if (!info.isDirectory()) throw new MediaStorageError(`${channelDirectory(bildId)} ist kein Ordner`);
            names = await readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
            throw error;
        }
        let removed = 0;
        for (const name of names) {
            const path = join(directory, name);
            if (!(await lstat(path)).isFile()) {
                throw new MediaStorageError(
                    `in ${channelDirectory(bildId)} liegt etwas anderes als eine Datei: ${name}`,
                );
            }
            await rm(path);
            removed += 1;
        }
        await rmdir(directory);
        return removed;
    }

    private async writeAt(key: string, bytes: Uint8Array, sha256: string): Promise<StoredMedia> {
        const target = this.pathFor(key);
        const directory = dirname(target);
        await this.assertRealPathInside(directory);
        await mkdir(directory, ordnerModus(key));
        // Ein zweites Mal NACH dem Anlegen: zwischen Prüfung und mkdir darf niemand eine Verknüpfung gesetzt haben.
        await this.assertRealPathInside(directory);

        const result: StoredMedia = { key, sha256, byteSize: bytes.byteLength, written: true };
        if (await this.holdsBytes(target, sha256, bytes.byteLength)) return { ...result, written: false };

        // Ein Name, den kein Aufrufer wählt; beginnt mit einem Punkt und ist nie ein gültiger Endname.
        const temporary = join(directory, `.tmp-${randomUUID()}`);
        try {
            const handle = await open(temporary, "wx");
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await this.operations.rename(temporary, target);
        } catch (error) {
            await rm(temporary, { force: true });
            // Hat ein gleichzeitiger Schreiber dieselben Bytes schon an den Endnamen gebracht, ist das kein Fehler.
            if (await this.holdsBytes(target, sha256, bytes.byteLength)) return { ...result, written: false };
            throw new MediaStorageError(`die Datei ${key} konnte nicht geschrieben werden`, { cause: error });
        }
        return result;
    }

    /** Liegt unter dem Pfad eine Datei mit genau diesen Bytes? Ein vorhandenes Verzeichnis ist ein Fehler. */
    private async holdsBytes(path: string, sha256: string, byteSize: number): Promise<boolean> {
        const existing = await statOrNull(path);
        if (existing === null) return false;
        if (!existing.isFile()) throw new MediaStorageError("unter dem Schlüssel liegt keine Datei");
        return existing.size === byteSize && sha256Of(await readFile(path)) === sha256;
    }

    /**
     * Räumt `incoming/` auf: nur einfache Dateien dort, die älter als `maxAgeMs` sind. `incoming/` ist untrusted und
     * wird von keiner Datenbankzeile referenziert; die authoritativen Klassen fasst diese Funktion nie an.
     */
    async sweepIncoming(maxAgeMs: number, now: number = Date.now()): Promise<number> {
        const directory = this.pathFor(INCOMING_DIRECTORY);
        let names: string[];
        try {
            names = await readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
            throw error;
        }
        let removed = 0;
        for (const name of names) {
            const path = join(directory, name);
            const info = await lstat(path);
            // Keine Verzeichnisse, keine Verknüpfungen: nur Dateien, die dort selbst liegen.
            if (!info.isFile() || now - info.mtimeMs < maxAgeMs) continue;
            await rm(path, { force: true });
            removed += 1;
        }
        return removed;
    }
}
