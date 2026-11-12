import type { Database } from "../database.ts";
import { loescheDateien, type PhotoboxAblage, type PhotoboxAufbewahrungLauf } from "../photobox/aufbewahrung.ts";
import {
    originalLoeschen,
    type OriginalAblage,
    type OriginalLoeschenLauf,
    type OriginalOptionen,
} from "./original-loeschen.ts";

/**
 * Die Aufbewahrung der Kartenvorschläge (WI-0275 B2, Migration 0296): einmal am Tag. Die Funktion der Datenbank löscht die Zeilen (nie hochgeladene
 * `incoming`-Vorschläge und `technical_failed` nach 7 Tagen, `rejected` und `withdrawn` nach 30 Tagen, samt Werk und Dateizeilen) und nennt die Speicherschlüssel,
 * die danach keine Zeile mehr hält; die Dateien löscht dieser Lauf. Dieselbe Reihenfolge und dieselben Vorsichtsregeln wie bei den Reisebildern
 * (`photobox/aufbewahrung.ts`), deren zweiten Teil beide teilen:
 *
 * - 🔴 **Erst die Zeilen, dann die Dateien.** Die Funktion ist eine einzelne Anweisung an der Verbindung (nie in einer Transaktion des Aufrufers).
 * - 🔴 **Jeder Schlüssel wird noch einmal geprüft:** Hält eine `media_file`- oder Beleg-Zeile ihn inzwischen wieder, bleibt die Datei liegen.
 * - Ein einzelner Löschfehler bricht den Lauf nicht ab; er zählt in `fehlgeschlagen`.
 *
 * Danach folgt das Original angenommener Vorschläge (`original-loeschen.ts`, Migration 0308), mit eigener Zählung. Name und Notiz angenommener Vorschläge nimmt die Funktion der
 * Datenbank nach 90 Tagen weg (0308).
 */
export const KARTENVORSCHLAG_RETENTION_KIND = "kartenvorschlag_aufbewahrung";

/** Gibt es die Funktion schon (Migration 0296)? Aus dem Katalog, den jede Rolle lesen darf. */
export async function kartenvorschlagAufbewahrungBereit(db: Database): Promise<boolean> {
    const [row] = await db<{ ok: boolean }[]>`
        SELECT to_regprocedure('public.kartenvorschlag_aufbewahren(timestamptz)') IS NOT NULL AS ok
    `;
    return row?.ok === true;
}

/** Was der Lauf braucht: Dateien löschen wie die Reisebilder, dazu lesen und ablegen für das Original angenommener Vorschläge. */
export type KartenvorschlagAblage = PhotoboxAblage & OriginalAblage;

/** Das Ergebnis des Laufs: die Dateien gelöschter Vorschläge, daneben das Original angenommener. */
export interface KartenvorschlagAufbewahrungLauf extends PhotoboxAufbewahrungLauf {
    original: OriginalLoeschenLauf;
}

/** Der tägliche Lauf: die Funktion der Datenbank, danach die Dateien, danach das Original angenommener Vorschläge. Wirft nur, wenn die Funktion selbst scheitert. */
export async function kartenvorschlagAufbewahrung(
    db: Database,
    ablage: KartenvorschlagAblage,
    original: OriginalOptionen = {},
): Promise<KartenvorschlagAufbewahrungLauf> {
    const rows = await db<{ storage_key: string }[]>`SELECT storage_key FROM public.kartenvorschlag_aufbewahren(now())`;
    const lauf = await loescheDateien(db, ablage, rows);
    return { ...lauf, original: await originalLoeschen(db, ablage, original) };
}
