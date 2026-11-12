import { PHOTOBOX_UNENTSCHIEDEN, type PhotoboxSubmissionState } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";
import { MEDIA_USAGE_TABLES } from "./usage-sql.ts";

/**
 * Ein PhotoBox-Bild endgültig löschen (WI-0272; Vali 2026-11-08 im Entwurf „Eingänge“ Fassung 2, Antworten „B, löschbar“ und „Ja, bauen“; die Knopftexte stammen von der
 * Sitzung, sie sind keine Betreiberzitate). Die zweite Ausnahme von „A, nur eigene Uploads“ (2026-10-17), neben dem Bild aus einem Kartenvorschlag (`vorschlag-loeschen.ts`).
 *
 * Löschbar ist ein Reisebild, wenn
 * - es aus der PhotoBox stammt (Herkunft `community_upload`, Quellsystem `photobox`) und eine Einreichung hat (`media_ingest.submission_id`, sonst das freigegebene Werk);
 * - die Einreichung nicht mehr offen ist (`OFFENE_EINREICHUNGEN`, sonst `einreichung_offen`: „Erst freigeben oder ablehnen.“). Entschieden heißt freigegeben, offline
 *   genommen oder abgelehnt; zurückgezogene, verfallene und geleerte Einreichungen sind beendet und zählen ebenso;
 * - es keine Verwendung hat außer seinen eigenen Zeilen in `photobox_media` (aktiv oder zurückgezogen). Eine Galerie, ein Typbild, ein Ort hält es weiter (`in_use`).
 *
 * Legacy-Herkunft und Zusammenführung prüft `asset-delete.ts` wie bei jedem Werk; ein Notaus hindert seit 0328 kein Werk mehr.
 *
 * Im selben Schritt fallen die eigenen `photobox_media`-Zeilen. Ist das Werk das aktuelle Bild der Einreichung (das des jüngsten Eingangs) oder ihr freigegebenes, wird
 * die Einreichung gestempelt (`approved_media_asset_id = NULL`, `media_deleted_at`, Migration 0328) und bleibt ohne Datei im Verlauf. Dann fallen auch ihre ERSETZTEN
 * Fassungen (`ersetzte`): Sonst rückte die jüngste von ihnen zum aktuellen Bild einer freigegebenen Einreichung auf (Medienverwaltung, Kasten der Einreichung), und die
 * tägliche Aufbewahrung räumte sie nie mehr ab (sie löscht nur, was NICHT das aktuelle Bild ist, `photobox_aufbewahren`).
 */

/** Noch nicht entschieden: Das Bild wartet auf die Redaktion und lässt sich nicht löschen (dieselbe Liste fragt die Oberfläche). */
export const OFFENE_EINREICHUNGEN: readonly PhotoboxSubmissionState[] = PHOTOBOX_UNENTSCHIEDEN;

export interface PhotoboxBild {
    /** Die interne Kennung der Einreichung. */
    einreichung: string;
    zustand: PhotoboxSubmissionState;
    /** Das aktuelle oder freigegebene Bild der Einreichung: Die Einreichung wird gestempelt, ersetzte Fassungen fallen mit. */
    aktuell: boolean;
    /** Verwendungen in allen Tafeln außer `photobox_media`, aktiv oder zurückgezogen: Jede hält das Werk fest. */
    anderswo: number;
    /** Hat das Werk eine geltende Verwendung als Reisebild (sonst ist es schon zurückgezogen oder war nie öffentlich)? */
    aktiv: boolean;
    /** Der Name des Orts der Einreichung; `null` an freier Stelle. */
    ort: string | null;
    /** Die internen Kennungen der ersetzten Fassungen (nur beim aktuellen Bild, sonst leer). */
    ersetzte: string[];
}

/** Die Verwendungen des Werks in allen Tafeln außer den Reisebildern, aktiv oder zurückgezogen. */
const ANDERSWO_SQL = MEDIA_USAGE_TABLES.filter((table) => table !== "photobox_media")
    .map((table) => `(SELECT count(*) FROM ${table} WHERE media_asset_id = $1::bigint)`)
    .join(" + ");

interface Zeile {
    einreichung: string;
    zustand: PhotoboxSubmissionState;
    aktuell: boolean;
    anderswo: number;
    aktiv: boolean;
    ort: string | null;
    ersetzte: string[] | null;
}

/**
 * Die Fakten zu einem Reisebild (interne Kennung); `undefined`, wenn das Werk keines ist. Im Löschen nach den Sperren lesen (Einreichung, dann Werk), in der Detailsicht
 * ohne. Die Einreichung ist die des freigegebenen Werks, sonst die des jüngsten Eingangs dieses Werks.
 */
export async function photoboxBild(q: Queryable, assetId: string): Promise<PhotoboxBild | undefined> {
    const [zeile] = await q.unsafe<Zeile[]>(
        `WITH werk AS (
             SELECT a.id FROM media_asset a WHERE a.id = $1::bigint AND a.origin = 'community_upload' AND a.source_system = $2
         ), einreichung AS (
             SELECT s.id, s.state, s.place_id, s.approved_media_asset_id
               FROM media_submission s
              WHERE s.id = COALESCE(
                        (SELECT f.id FROM media_submission f JOIN werk w ON f.approved_media_asset_id = w.id ORDER BY f.id LIMIT 1),
                        (SELECT i.submission_id FROM media_ingest i JOIN werk w ON w.id = i.media_asset_id
                          WHERE i.submission_id IS NOT NULL ORDER BY i.id DESC LIMIT 1)
                    )
         ), aktuell AS (
             SELECT e.approved_media_asset_id IS NOT DISTINCT FROM $1::bigint
                    OR COALESCE(
                           (SELECT i.media_asset_id FROM media_ingest i WHERE i.submission_id = e.id ORDER BY i.id DESC LIMIT 1) = $1::bigint,
                           false
                       ) AS ja
               FROM einreichung e
         )
         SELECT e.id::text AS einreichung, e.state AS zustand, (SELECT ja FROM aktuell) AS aktuell,
                (${ANDERSWO_SQL})::int AS anderswo,
                EXISTS (SELECT 1 FROM photobox_media m WHERE m.media_asset_id = $1::bigint AND m.retired_at IS NULL) AS aktiv,
                p.name AS ort,
                CASE WHEN (SELECT ja FROM aktuell) THEN (
                    SELECT array_agg(DISTINCT i.media_asset_id::text ORDER BY i.media_asset_id::text)
                      FROM media_ingest i WHERE i.submission_id = e.id AND i.media_asset_id <> $1::bigint
                ) END AS ersetzte
           FROM einreichung e
           LEFT JOIN place p ON p.id = e.place_id`,
        [assetId, PHOTOBOX_QUELLSYSTEM],
    );
    if (zeile === undefined) return undefined;
    return {
        einreichung: zeile.einreichung,
        zustand: zeile.zustand,
        aktuell: zeile.aktuell,
        anderswo: zeile.anderswo,
        aktiv: zeile.aktiv,
        ort: zeile.ort,
        ersetzte: zeile.ersetzte ?? [],
    };
}

/**
 * Sperrt die Einreichungen hinter einem Werk (öffentliche Kennung), BEVOR das Werk gesperrt wird: dieselbe Reihenfolge wie Redaktion und Einsender (erst die Einreichung,
 * dann ihr Asset, `photobox/redaktion.ts` `sperre`, `photobox/status.ts`). Sonst warteten Löschen und „Offline nehmen“ im Kreis aufeinander.
 */
export async function sperreEinreichungen(q: Queryable, assetPublicId: string): Promise<void> {
    await q`
        SELECT 1 FROM media_submission s
         WHERE s.id IN (
                   SELECT i.submission_id FROM media_ingest i JOIN media_asset a ON a.id = i.media_asset_id
                    WHERE a.public_id = ${assetPublicId}::uuid AND i.submission_id IS NOT NULL
                   UNION
                   SELECT f.id FROM media_submission f JOIN media_asset a ON a.id = f.approved_media_asset_id
                    WHERE a.public_id = ${assetPublicId}::uuid
               )
         ORDER BY s.id
           FOR UPDATE OF s
    `;
}

/**
 * Die Reisebild-Zeilen des Werks löschen (aktiv und zurückgezogen) und, beim aktuellen Bild, die Einreichung stempeln. Gibt zurück, wie viele Zeilen fielen, und die neue
 * Revision der Einreichung (`undefined`, wenn sie nicht gestempelt wurde).
 */
export async function loesePhotobox(
    tx: Queryable,
    assetId: string,
    bild: PhotoboxBild,
): Promise<{ zeilen: number; revision: number | undefined }> {
    const zeilen = await tx<{ id: string }[]>`
        DELETE FROM photobox_media WHERE media_asset_id = ${assetId}::bigint RETURNING id::text AS id
    `;
    if (!bild.aktuell) return { zeilen: zeilen.length, revision: undefined };
    const [gestempelt] = await tx<{ revision: number }[]>`
        UPDATE media_submission SET approved_media_asset_id = NULL, media_deleted_at = now()
         WHERE id = ${bild.einreichung}::bigint
        RETURNING revision::int AS revision
    `;
    return { zeilen: zeilen.length, revision: gestempelt?.revision };
}
