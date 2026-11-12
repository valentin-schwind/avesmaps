import { readFile } from "node:fs/promises";
import type { Database, Queryable } from "../database.ts";
import { RasterRejection, inspectImage } from "../media/raster/inspect.ts";
import { MAX_SOURCE_BYTES, PDF_LIMITS } from "../media/raster/limits.ts";
import { profileForRole, type RasterProfile } from "../media/raster/profiles.ts";
import { sperreQuelle } from "../media/quellsperre.ts";
import { internVariante } from "../media/roles.ts";
import { MediaStorageError, sha256Of, type MediaStore } from "../media/storage.ts";
import { parseBackupStatus } from "../system/status-files.ts";
import { KARTENVORSCHLAG_QUELLSYSTEM } from "./quellsystem.ts";

/**
 * Das Original eines angenommenen Kartenvorschlags fällt weg (WI-0275, Betreiberentscheid 2026-11-04): Formular und Bedingungen sagen „Das Original wird nach der Prüfung gelöscht.“
 * Rund sieben Tage nach der Annahme, im täglichen Lauf `kartenvorschlag_aufbewahrung` (`aufbewahrung.ts`).
 *
 * Es ist kein einfaches Löschen, weil der Abgleich (`media-editor/settle.ts`) und vieles andere an der Zeile des Originals hängen:
 *
 * - **Die ZEILE bleibt** mit allen Werten und bekommt den Stempel `bytes_deleted_at`: Notaus, Zusammenführen, „gibt es schon“ und die Suche lesen Hash und Maße aus ihr.
 * - **Daneben eine Zeile der Klasse `master`:** eine Kopie der verlustfreien Fassung `citymap_full` (Pixel erhalten, `profiles.ts`). Aus ihr rechnet der Abgleich ab dem Stempel. Bei einem PDF bleibt nur Seite 1.
 * - 🔴 **Geteilte Bytes:** Die Datei fällt erst, wenn keine lebende Zeile sie mehr hält. Ein lebender Halter hält auch den Stempel zurück (`gehalten`, der nächste Lauf fragt wieder), außer er ist
 *   selbst in diesem Lauf fällig; sonst warteten zwei Fällige ewig aufeinander. Die Sperre je Hash (`media/quellsperre.ts`) schließt das Löschen gegen jedes neue Anlegen derselben Bytes aus.
 * - 🔴 **Zwei Schritte, nie im selben Lauf** (Claudio 2026-11-04, `handovers/2026-11-04-kartenvorschlag-master-sicherung-an-claudia.md`): Der erste fällige Lauf legt Datei und Zeile des Masters an und stempelt
 *   nicht. Ein späterer stempelt und entfernt erst, wenn die Master-Zeile älter ist als das, was die Sicherung belegt (`gesichertBis`). Sonst läge das Werk bis zur nächsten Nachtsicherung nur einmal auf der Platte.
 *   Die Zeile entsteht nach der Datei, ihr `created_at` sagt also: Die Datei lag schon da. Ein Werk hat höchstens eine Master-Zeile (`media_file_variant_unique`). Fehlt die Datei des Masters im zweiten
 *   Schritt, bleibt das Original, und der Fehler steht im Ergebnis (`master_fehlt`); der Lauf legt sie nicht neu an, denn eine neue Datei wäre in keiner Sicherung.
 * - Ohne Stempel ist die Master-Zeile für alle anderen nur eine Datei mehr: Der Abgleich fragt sie erst ab dem Stempel, die Aufbewahrung nimmt sie mit dem Werk, Abzug und Medienverwaltung führen sie wie jede Zeile.
 * - 🔴 **Reihenfolge im ersten Schritt:** erst die Bytes des Masters, dann in EINER Transaktion alles neu prüfen, Master-Zeile. **Im zweiten:** die Bytes des Masters prüfen, in EINER Transaktion alles neu prüfen,
 *   Stempel; zuletzt je gestempeltem Schlüssel die Datei. Der letzte Schritt ist derselbe für den Regelfall und für den Folgelauf nach einem Absturz: Er geht über ALLE gestempelten Zeilen, deren Datei noch liegt,
 *   auch über eine, die ein bytegleicher Upload wieder hat wachsen lassen.
 *
 * Es gibt keine neue Jobart und keine Sperre der Kartendomäne. Der Lauf liest höchstens eine Datei bis 50 MiB je Vorschlag in den Speicher und rechnet nichts (kein sharp im Worker).
 *
 * 🔴 **Der Schalter:** `ORIGINAL_LOESCHEN_AN`. Aus heißt: Der Lauf zählt, was fällig wäre (nur lesend), und schreibt nichts, weder Datei noch Zeile. Einschalten ist ein eigener Commit und Release.
 */
export const ORIGINAL_LOESCHEN_AN = false;

/** Was der Lauf von der Ablage braucht (`MediaStore`). */
export type OriginalAblage = Pick<MediaStore, "read" | "store" | "exists" | "removeAfterDelete">;

export interface OriginalLoeschenErgebnis {
    /** Stand des Schalters in diesem Lauf. */
    an: boolean;
    /**
     * Was älter ist als dieser Zeitpunkt, liegt in der Sicherung (`gesichertBis`); `null`: unbekannt, dann stempelt der Lauf nichts. Auch bei ausgeschaltetem Schalter gelesen: So zeigt jeder Lauf, ob der
     * Auftrag die Statusdatei unter der Härtung seiner Unit lesen darf.
     */
    gesichertBis: string | null;
    /** Vorschläge, bei denen heute ein Schritt ansteht (bei ausgeschaltetem Schalter: was geschähe). */
    faellig: number;
    /** Heute angelegte Master: der erste Schritt. */
    masterAngelegt: number;
    /** Heute gestempelt: Master liegt in der Sicherung, die Zeile gilt als gelöscht. */
    gestempelt: number;
    /** Heute wirklich entfernte Dateien. */
    dateien: number;
    /** Die Bytes hält ein anderes lebendes Werk; der nächste Lauf fragt wieder. */
    gehalten: number;
    /** Die Fassung `citymap_full` taugt (noch) nicht, der Master liegt noch in keiner Sicherung, oder eine Bedingung fiel während des Laufs weg; der nächste Lauf fragt wieder. */
    zurueckgestellt: number;
    /** Fehler an einem Vorschlag oder einer Datei; sie brechen den Lauf nicht ab. */
    fehlgeschlagen: number;
}

export interface OriginalLoeschenLauf extends OriginalLoeschenErgebnis {
    /** Die Schlüssel der Dateien, an denen es scheiterte (nur für das Log). */
    offen: string[];
    /** Kurze Codes dazu, ohne Wiederholung, nie eine Meldung (sie kann einen Pfad nennen). */
    codes: string[];
}

/** Die Zahlen, die auf die Statusseite gehören (ohne Schlüssel und Codes). */
export function originalErgebnisVon(lauf: OriginalLoeschenLauf): OriginalLoeschenErgebnis {
    const {
        an,
        gesichertBis,
        faellig,
        masterAngelegt,
        gestempelt,
        dateien,
        gehalten,
        zurueckgestellt,
        fehlgeschlagen,
    } = lauf;
    return {
        an,
        gesichertBis,
        faellig,
        masterAngelegt,
        gestempelt,
        dateien,
        gehalten,
        zurueckgestellt,
        fehlgeschlagen,
    };
}

export interface OriginalOptionen {
    /** Überstimmt den Schalter: in Tests und für die Probe auf der Stage (`originalOptionenAus`). */
    an?: boolean;
    /** Claudios Statusdatei der Sicherung; fehlt sie, wird nichts gestempelt. */
    sicherungStatus?: string | undefined;
}

/**
 * Die Einstellungen aus der Umgebung des Auftrags. Der Pfad ist derselbe wie für die Systemsteuerung (`BACKUP_STATUS_FILE`, steht in `.env` jeder Umgebung).
 * 🔴 **Die Probe vor dem Schalter:** Solange `ORIGINAL_LOESCHEN_AN` aus steht, kann die STAGE den Lauf mit `KARTENVORSCHLAG_ORIGINAL_PROBE=an` schreiben lassen. Production kommt hier nie durch. Fällt mit dem Schalter-Commit weg.
 */
export function originalOptionenAus(environment: Readonly<Record<string, string | undefined>>): OriginalOptionen {
    const probe = environment["AVESMAPS_ENV"] === "staging" && environment["KARTENVORSCHLAG_ORIGINAL_PROBE"] === "an";
    return { sicherungStatus: environment["BACKUP_STATUS_FILE"], ...(probe ? { an: true } : {}) };
}

/**
 * Was älter ist als dieser Zeitpunkt, liegt nachweislich außer Haus in der Mediensicherung; `null`, wenn die Statusdatei das nicht belegt. Claudios `last_success_at` muss dafür stehen, reicht aber allein nicht
 * (`ops/backup/avesmaps3d-backup.sh`, `run_backup`):
 *
 * - **Er ist das ENDE des Laufs.** Das Medienarchiv wird mittendrin gepackt, danach kommen noch Mail und Foundry. Maßgeblich ist deshalb der BEGINN des letzten Laufs, und nur wenn er gelang; während eines Laufs oder
 *   nach einem gescheiterten ist er nicht bekannt, dann wartet der nächste Lauf.
 * - **`media_backup` ist nie fatal.** Scheitert das Archiv, gilt der Lauf trotzdem als gelungen. Deshalb zusätzlich: Wann ging das Medienarchiv zuletzt geprüft außer Haus? Ein Archiv nur auf derselben Platte (Upload-Deckel,
 *   Dropbox gescheitert) zählt nicht. Ohne Änderung seit dem letzten Lauf baut die Sicherung kein neues Archiv, dann gilt der ältere Zeitpunkt, und das Archiv enthält ja alles, was älter ist.
 *
 * Die Datei ist hostweit und die Mediensicherung nimmt nur Production mit: Auf der Stage ist das eine Wartezeit derselben Mechanik, kein Nachweis für ihre Dateien.
 */
export async function gesichertBis(statusDatei: string | undefined): Promise<Date | null> {
    if (statusDatei === undefined || statusDatei === "") return null;
    let stand: ReturnType<typeof parseBackupStatus>;
    try {
        stand = parseBackupStatus(JSON.parse(await readFile(statusDatei, "utf8")));
    } catch {
        return null;
    }
    if (stand === null || stand.letzteErfolgreiche === null) return null;
    const { result, startedAt } = stand.letzterLauf ?? {};
    const medien = stand.teile.find((teil) => teil.kind === "media_production");
    if (result !== "ok" || !startedAt || !medien?.offsite || !medien.offsiteVerifiedAt) return null;
    return new Date(Math.min(Date.parse(startedAt), Date.parse(medien.offsiteVerifiedAt)));
}

interface Kandidat {
    quelle: string;
    asset: string;
    schluessel: string;
    sha256: string;
}

/**
 * Die Bedingungen, die die Datenbank kennt: angenommen, Entscheidung älter als 7 Tage, Quellsystem, technisch und redaktionell in Ordnung, noch nicht gestempelt, kein aktiver Notaus für die Bytes, keine
 * geltende Zusammenführung, kein offener Abgleich (Muster `photobox/kacheln.ts`). Eine aufgehobene Zusammenführung hält nichts mehr.
 */
async function faellige(q: Queryable, nurAsset?: string): Promise<Kandidat[]> {
    const nur = nurAsset === undefined ? q`` : q`AND a.id = ${nurAsset}::bigint`;
    return q<Kandidat[]>`
        SELECT f.id::text AS quelle, a.id::text AS asset, f.storage_key AS schluessel, f.sha256
          FROM citymap_suggestion s
          JOIN media_asset a ON a.id = s.media_asset_id
          JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
         WHERE s.state = 'approved'
           AND s.decided_at < now() - interval '7 days'
           AND a.source_system = ${KARTENVORSCHLAG_QUELLSYSTEM}
           AND a.technical_state = 'ok'
           AND a.moderation_state = 'approved'
           AND f.bytes_deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM media_publication_suspension n WHERE n.source_sha256 = f.sha256 AND n.lifted_at IS NULL
           )
           AND NOT EXISTS (
               SELECT 1 FROM media_merge m WHERE (m.merged_asset_id = a.id OR m.kept_asset_id = a.id) AND m.lifted_at IS NULL
           )
           AND NOT EXISTS (
               SELECT 1 FROM job j
                WHERE j.kind = 'media_settle' AND j.state IN ('QUEUED', 'RUNNING') AND j.input_ref ->> 'asset' = a.public_id::text
           )
           ${nur}
         ORDER BY f.id
    `;
}

/** Hält eine lebende Zeile die Datei, außer den genannten? */
async function gehaltenAusser(q: Queryable, schluessel: string, ausser: readonly string[]): Promise<boolean> {
    const [zeile] = await q<{ gehalten: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM media_file
             WHERE storage_key = ${schluessel} AND bytes_deleted_at IS NULL AND NOT (id = ANY(${ausser as string[]}::bigint[]))
        ) AS gehalten
    `;
    return zeile?.gehalten === true;
}

/** Ist das Rezept der Kartensammlung eines, das keine Pixel ändert? Sonst dürfte keine Fassung das Original ersetzen. */
export function profilVerlustfrei(profil: RasterProfile): boolean {
    return profil.encoding.mode === "lossless" && profil.geometry.kind === "native";
}

interface FassungZeile {
    id: string;
    storage_key: string;
    sha256: string;
    mime_type: string;
    width: number | null;
    height: number | null;
    recipe_version: string | null;
}

interface Fassung {
    id: string;
    sha256: string;
    mime_type: string;
    width: number;
    height: number;
    bytes: Uint8Array;
}

/**
 * Die verlustfreie Fassung des Werks, öffentlich oder intern, gelesen und gegen ihren Hash geprüft; `null`, wenn keine taugt. Sie muss aus der geltenden Revision des Rezepts stammen (die Revision steht vorn in
 * `recipe_version`, die Versionen der Bibliothek ändern an den Pixeln nichts) und später wieder durch den Abgleich gehen: dieselbe Vorprüfung, dieselbe Grenze wie dort.
 */
async function leseFassung(db: Queryable, ablage: OriginalAblage, asset: string): Promise<Fassung | null> {
    const profil = profileForRole("map_full");
    if (!profilVerlustfrei(profil)) return null;
    const zeilen = await db<FassungZeile[]>`
        SELECT id::text AS id, storage_key, sha256, mime_type, width, height, recipe_version
          FROM media_file
         WHERE media_asset_id = ${asset}::bigint
           AND ((storage_class = 'published' AND variant = ${profil.variant})
             OR (storage_class = 'derivative' AND variant = ${internVariante(profil.variant)}))
         ORDER BY (storage_class = 'published') DESC, id DESC
    `;
    for (const zeile of zeilen) {
        const { id, sha256, mime_type, width, height } = zeile;
        if (mime_type !== "image/webp" || width === null || height === null) continue;
        if (zeile.recipe_version?.startsWith(`${String(profil.revision)} / `) !== true) continue;
        try {
            const bytes = await ablage.read(zeile.storage_key, MAX_SOURCE_BYTES);
            if (sha256Of(bytes) !== sha256) continue;
            inspectImage(bytes, { maxRasterBytes: PDF_LIMITS.maxBytes });
            return { id, sha256, mime_type, width, height, bytes };
        } catch (error) {
            if (error instanceof MediaStorageError || error instanceof RasterRejection) continue;
            throw error;
        }
    }
    return null;
}

const fehlerCode = (error: unknown): string => {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code !== "") return code;
    return error instanceof Error ? error.name : "unbekannt";
};

function vermerke(lauf: OriginalLoeschenLauf, schluessel: string, code: string): void {
    lauf.fehlgeschlagen += 1;
    lauf.offen.push(schluessel);
    if (!lauf.codes.includes(code)) lauf.codes.push(code);
}

interface MasterZeile {
    storage_key: string;
    sha256: string;
    created_at: Date;
}

async function masterZeile(q: Queryable, asset: string): Promise<MasterZeile | undefined> {
    const [zeile] = await q<MasterZeile[]>`
        SELECT storage_key, sha256, created_at FROM media_file WHERE media_asset_id = ${asset}::bigint AND storage_class = 'master'
    `;
    return zeile;
}

/** Liegt die Datei des Masters lesbar und unverändert da? */
function masterLiegt(ablage: OriginalAblage, schluessel: string, sha256: string): Promise<boolean> {
    return ablage
        .read(schluessel, MAX_SOURCE_BYTES)
        .then((bytes) => sha256Of(bytes) === sha256)
        .catch(() => false);
}

/** Erster Schritt: Bytes des Masters, Prüfung, Master-Zeile. `false`: Eine Bedingung fiel inzwischen weg, nichts ist geschehen. */
async function legeMasterAn(
    db: Database,
    ablage: OriginalAblage,
    kandidat: Kandidat,
    fassung: Fassung,
    alleFaelligen: readonly string[],
): Promise<boolean> {
    const master = await ablage.store("master", fassung.bytes, "webp");
    const angelegt = await db.begin(async (tx) => {
        await tx`SELECT 1 FROM media_asset WHERE id = ${kandidat.asset}::bigint FOR UPDATE`;
        await sperreQuelle(tx, kandidat.sha256);
        const [noch] = await faellige(tx, kandidat.asset);
        if (noch?.quelle !== kandidat.quelle) return false;
        if (await gehaltenAusser(tx, kandidat.schluessel, alleFaelligen)) return false;
        if ((await masterZeile(tx, kandidat.asset)) !== undefined) return false;
        const [fassungNoch] = await tx<{ ok: boolean }[]>`
            SELECT sha256 = ${fassung.sha256} AS ok FROM media_file WHERE id = ${fassung.id}::bigint
        `;
        if (fassungNoch?.ok !== true) return false;
        await tx`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            VALUES (${kandidat.asset}::bigint, 'master', 'master', ${master.key}, ${fassung.mime_type}, ${fassung.width}, ${fassung.height},
                    ${master.byteSize}, ${master.sha256})
        `;
        return true;
    });
    // Eine frisch abgelegte Kopie, die nun keine Zeile bekam, ist eine private Datei zu viel.
    if (!angelegt && master.written) {
        const [zeile] = await db<{ da: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM media_file WHERE storage_key = ${master.key}) AS da
        `;
        if (zeile?.da !== true) await ablage.removeAfterDelete(master.key);
    }
    return angelegt;
}

/** Zweiter Schritt: Prüfung, Stempel. `false`: Eine Bedingung fiel inzwischen weg, nichts ist geschehen. */
function stemple(
    db: Database,
    kandidat: Kandidat,
    master: MasterZeile,
    alleFaelligen: readonly string[],
): Promise<boolean> {
    return db.begin(async (tx) => {
        await tx`SELECT 1 FROM media_asset WHERE id = ${kandidat.asset}::bigint FOR UPDATE`;
        await sperreQuelle(tx, kandidat.sha256);
        const [noch] = await faellige(tx, kandidat.asset);
        if (noch?.quelle !== kandidat.quelle) return false;
        if (await gehaltenAusser(tx, kandidat.schluessel, alleFaelligen)) return false;
        if ((await masterZeile(tx, kandidat.asset))?.storage_key !== master.storage_key) return false;
        await tx`UPDATE media_file SET bytes_deleted_at = now() WHERE id = ${kandidat.quelle}::bigint`;
        return true;
    });
}

/** Entscheidet und entfernt unter der Sperre: Keine lebende Zeile hält die Datei, und jeder Master, der sie ersetzt, liegt lesbar da. */
async function entferneWennFrei(
    db: Database,
    ablage: OriginalAblage,
    schluessel: string,
    sha256: string,
    lauf: OriginalLoeschenLauf,
): Promise<void> {
    await db.begin(async (tx) => {
        await sperreQuelle(tx, sha256);
        if (await gehaltenAusser(tx, schluessel, [])) {
            lauf.gehalten += 1;
            return;
        }
        const ersatz = await tx<{ schluessel: string | null; sha256: string | null }[]>`
            SELECT m.storage_key AS schluessel, m.sha256
              FROM media_file q
              LEFT JOIN media_file m ON m.media_asset_id = q.media_asset_id AND m.storage_class = 'master'
             WHERE q.storage_key = ${schluessel} AND q.bytes_deleted_at IS NOT NULL
        `;
        for (const master of ersatz) {
            const gut =
                master.schluessel !== null &&
                master.sha256 !== null &&
                (await masterLiegt(ablage, master.schluessel, master.sha256));
            if (!gut) {
                vermerke(lauf, schluessel, "master_fehlt");
                return;
            }
        }
        if (await ablage.removeAfterDelete(schluessel)) lauf.dateien += 1;
    });
}

/**
 * Der Lauf. `db` ist die Verbindung (Jobs-Rolle), keine Transaktion. Wirft nie: Ein Fehler zählt in `fehlgeschlagen`, damit die Aufbewahrung der übrigen Vorschläge ihr Ergebnis behält.
 */
export async function originalLoeschen(
    db: Database,
    ablage: OriginalAblage,
    optionen: OriginalOptionen = {},
): Promise<OriginalLoeschenLauf> {
    const an = optionen.an ?? ORIGINAL_LOESCHEN_AN;
    const gesichert = await gesichertBis(optionen.sicherungStatus);
    const lauf: OriginalLoeschenLauf = {
        an,
        gesichertBis: gesichert?.toISOString() ?? null,
        faellig: 0,
        masterAngelegt: 0,
        gestempelt: 0,
        dateien: 0,
        gehalten: 0,
        zurueckgestellt: 0,
        fehlgeschlagen: 0,
        offen: [],
        codes: [],
    };
    try {
        const kandidaten = await faellige(db);
        const alleFaelligen = kandidaten.map((kandidat) => kandidat.quelle);
        for (const kandidat of kandidaten) {
            try {
                if (await gehaltenAusser(db, kandidat.schluessel, alleFaelligen)) {
                    lauf.gehalten += 1;
                    continue;
                }
                const master = await masterZeile(db, kandidat.asset);
                if (master === undefined) {
                    const fassung = await leseFassung(db, ablage, kandidat.asset);
                    if (fassung === null) {
                        lauf.zurueckgestellt += 1;
                        continue;
                    }
                    lauf.faellig += 1;
                    if (!an) continue;
                    if (await legeMasterAn(db, ablage, kandidat, fassung, alleFaelligen)) {
                        lauf.masterAngelegt += 1;
                    } else {
                        lauf.faellig -= 1;
                        lauf.zurueckgestellt += 1;
                    }
                    continue;
                }
                if (gesichert === null || master.created_at >= gesichert) {
                    lauf.zurueckgestellt += 1;
                    continue;
                }
                if (!(await masterLiegt(ablage, master.storage_key, master.sha256))) {
                    vermerke(lauf, kandidat.schluessel, "master_fehlt");
                    continue;
                }
                lauf.faellig += 1;
                if (!an) continue;
                if (await stemple(db, kandidat, master, alleFaelligen)) {
                    lauf.gestempelt += 1;
                } else {
                    lauf.faellig -= 1;
                    lauf.zurueckgestellt += 1;
                }
            } catch (error) {
                vermerke(lauf, kandidat.schluessel, fehlerCode(error));
            }
        }
        if (!an) return lauf;

        // Je gestempeltem Schlüssel, dessen Datei noch liegt: aus diesem Lauf, aus einem abgestürzten oder von einem bytegleichen Upload nachgewachsen.
        const gestempelte = await db<{ storage_key: string; sha256: string }[]>`
            SELECT DISTINCT storage_key, sha256 FROM media_file WHERE bytes_deleted_at IS NOT NULL ORDER BY storage_key
        `;
        for (const { storage_key: schluessel, sha256 } of gestempelte) {
            try {
                if (await ablage.exists(schluessel)) await entferneWennFrei(db, ablage, schluessel, sha256, lauf);
            } catch (error) {
                vermerke(lauf, schluessel, fehlerCode(error));
            }
        }
    } catch (error) {
        const code = fehlerCode(error);
        lauf.fehlgeschlagen += 1;
        if (!lauf.codes.includes(code)) lauf.codes.push(code);
    }
    return lauf;
}
