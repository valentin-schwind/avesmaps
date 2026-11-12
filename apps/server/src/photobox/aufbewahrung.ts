import type { Database } from "../database.ts";

/**
 * Die Aufbewahrung der Reisebilder (WI-0272 S2, Fachkonzept §5.5 und §13): offene Einreichungen verfallen nach 60 Tagen, beendete werden 30 Tage
 * danach wirklich gelöscht, samt Bild, Rechten und Angaben. Ein ersetztes Bild (weder das aktuelle noch das freigegebene Medium einer Einreichung) fällt in jedem Zustand der
 * Einreichung einen Tag nach dem Ersetzen (WI-0272 S3, Fixrunde C, Migration 0293); die Einreichung bleibt.
 *
 * Der Worker ruft sie einmal am Tag als aufgezeichneten Job `photobox_aufbewahrung` (wie `community_aufbewahrung`), mit der Jobs-Rolle, die im Schema
 * nur `photobox_aufbewahren(timestamptz)` ausführen darf (`db/media-grants.psql`, Migration 0284). Die Funktion löscht NUR ZEILEN und gibt die
 * Speicherschlüssel der Dateien zurück, die danach keine Zeile mehr nennt. Die Dateien löscht dieser Lauf:
 *
 * - 🔴 **Erst die Zeilen, dann die Dateien.** Die Funktion ist eine einzelne Anweisung an der Verbindung (nie in einer Transaktion des Aufrufers): Wenn
 *   die Schlüssel hier ankommen, ist das Löschen der Zeilen festgeschrieben. Scheitert die Funktion, fällt keine Datei; ein Absturz zwischen Funktion
 *   und Dateien lässt Dateien ohne Zeile zurück (aufräumbar), nie eine Zeile ohne Datei.
 * - 🔴 **Jeder Schlüssel wird noch einmal geprüft** (wie `deleteAsset` in `media-editor/asset-delete.ts`): Hält eine lebende `media_file`-Zeile oder eine Beleg-Zeile ihn
 *   inzwischen wieder (ein bytegleicher Upload zwischen Funktion und Lauf), bleibt die Datei liegen. Eine gestempelte Zeile (`bytes_deleted_at`, WI-0275) hält nichts.
 * - **Ein einzelner Löschfehler bricht den Lauf nicht ab.** Er zählt in `fehlgeschlagen`, der Job steht dann mit `errorSummary` als gescheitert da, und
 *   die Schlüssel der übrig gebliebenen Dateien stehen im Log (`offen`), denn die Funktion nennt sie nur beim Löschen.
 */
export const PHOTOBOX_RETENTION_KIND = "photobox_aufbewahrung";

/** Was die Aufbewahrung zum Löschen der Dateien braucht (`MediaStore`); ohne `MEDIA_ROOT` darf sie gar nicht laufen. */
export interface PhotoboxAblage {
    removeAfterDelete(key: string): Promise<boolean>;
    removeQuarantined(sha256: string): Promise<boolean>;
}

export interface PhotoboxAufbewahrungErgebnis {
    /** Wie viele Schlüssel die Funktion zurückgab (Dateien, die nach dem Löschen keine Zeile mehr nennt). */
    schluessel: number;
    /** Wie viele davon wirklich als Datei lagen und gelöscht wurden (ohne die Kopien in der Quarantäne). */
    dateien: number;
    /** Wie viele eine Zeile inzwischen wieder nennt: sie bleiben liegen. */
    gehalten: number;
    /** Wie viele sich nicht löschen ließen. */
    fehlgeschlagen: number;
}

/** Das Ergebnis samt dem, was nur das Log und die Zusammenfassung des Laufs brauchen. */
export interface PhotoboxAufbewahrungLauf extends PhotoboxAufbewahrungErgebnis {
    /** Die Schlüssel der Dateien, die sich nicht löschen ließen. */
    offen: string[];
    /** Die Fehlercodes dazu (`EPERM`, `EBUSY` …), ohne Wiederholung. */
    codes: string[];
}

/** Gibt es die Funktion schon (Migration 0284)? Aus dem Katalog, den jede Rolle lesen darf. */
export async function photoboxAufbewahrungBereit(db: Database): Promise<boolean> {
    const [row] = await db<{ ok: boolean }[]>`
        SELECT to_regprocedure('public.photobox_aufbewahren(timestamptz)') IS NOT NULL AS ok
    `;
    return row?.ok === true;
}

const VEROEFFENTLICHT = /^published\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})\.webp$/;

/** Der Hash einer veröffentlichten Datei aus ihrem Schlüssel (`storageKey("published", …)`); `undefined` für jeden anderen Schlüssel. */
export function veroeffentlichterHash(key: string): string | undefined {
    return VEROEFFENTLICHT.exec(key)?.[1];
}

/** Ein kurzer Code für die Zusammenfassung, nie die Meldung (sie kann einen Pfad nennen). */
function fehlerCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code !== "") return code;
    return error instanceof Error ? error.name : "unbekannt";
}

/**
 * Der tägliche Lauf: die Funktion der Datenbank, danach die Dateien. `db` ist die Verbindung, keine Transaktion (siehe oben). Wirft nur, wenn die Funktion
 * selbst scheitert; ein Fehler an einer Datei zählt in `fehlgeschlagen`.
 */
export async function photoboxAufbewahrung(db: Database, ablage: PhotoboxAblage): Promise<PhotoboxAufbewahrungLauf> {
    const rows = await db<{ storage_key: string }[]>`SELECT storage_key FROM public.photobox_aufbewahren(now())`;
    return loescheDateien(db, ablage, rows);
}

/**
 * Der zweite Teil jedes Laufs, gemeinsam mit den Kartenvorschlägen (`kartenvorschlag/aufbewahrung.ts`): die Dateien zu den Schlüsseln, die die Funktion der
 * Datenbank nach dem Löschen der Zeilen nannte. Jeder Schlüssel wird noch einmal gegen die Tafeln geprüft; ein Fehler an einer Datei zählt, bricht aber nichts ab.
 */
export async function loescheDateien(
    db: Database,
    ablage: PhotoboxAblage,
    rows: readonly { storage_key: string }[],
): Promise<PhotoboxAufbewahrungLauf> {
    const lauf: PhotoboxAufbewahrungLauf = {
        schluessel: rows.length,
        dateien: 0,
        gehalten: 0,
        fehlgeschlagen: 0,
        offen: [],
        codes: [],
    };
    for (const { storage_key: key } of rows) {
        try {
            const [gehalten] = await db<{ held: boolean }[]>`
                SELECT EXISTS (SELECT 1 FROM media_file WHERE storage_key = ${key} AND bytes_deleted_at IS NULL)
                    OR EXISTS (SELECT 1 FROM media_rights_evidence WHERE storage_key = ${key}) AS held
            `;
            if (gehalten?.held === true) {
                lauf.gehalten += 1;
                continue;
            }
            if (await ablage.removeAfterDelete(key)) lauf.dateien += 1;
            // Eine veröffentlichte Datei kann zusätzlich als Kopie in der Quarantäne liegen (Inhaltsschalter, Notaus); sie fällt mit ihr.
            const hash = veroeffentlichterHash(key);
            if (hash !== undefined) await ablage.removeQuarantined(hash);
        } catch (error) {
            lauf.fehlgeschlagen += 1;
            lauf.offen.push(key);
            const code = fehlerCode(error);
            if (!lauf.codes.includes(code)) lauf.codes.push(code);
        }
    }
    return lauf;
}

/** Die Zahlen, die auf die Statusseite gehören (ohne Schlüssel und Codes). */
export function ergebnisVon({
    schluessel,
    dateien,
    gehalten,
    fehlgeschlagen,
}: PhotoboxAufbewahrungLauf): PhotoboxAufbewahrungErgebnis {
    return { schluessel, dateien, gehalten, fehlgeschlagen };
}
