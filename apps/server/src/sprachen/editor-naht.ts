import { AVENTURIA, EDITOR_LOCK_ERROR_STATUS, type EditorLock } from "@avesmaps3d/shared";
import type { PendingQuery, Row } from "postgres";
import type { Sql } from "../auth/session-store.ts";
import type { Queryable } from "../database.ts";
import { listEditorLocks } from "../editor/editor-lock.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die gemeinsamen Griffe der Schreibwege des Spracheditors (WI-0261 S5d; Vertrag `packages/shared/src/sprachen-editor.ts`): die Sprache sperren und gegen
 * den Stand des Entwurfs prüfen, die Sperre während der Bearbeitung verlangen, Fehlerbilder. Die Schreibwege selbst stehen in `editor-schreiben.ts`
 * (Sprache), `editor-wiki.ts` (Wiki-Artikel) und `editor-flaechen.ts` (Teilflächen).
 *
 * - 🔴 **Die Sperre wird verlangt**, nicht nur geachtet (strenger als die übrigen Editoren, die nur eine fremde Sperre abweisen): Wer eine Sprache oder ihre
 *   Teilflächen ändert, hält ihre Sperre (`editor_lock`, Art `sprache`, Herzschlag in den letzten 15 Minuten); sonst 409 `lock_required`. Hält sie ein anderer,
 *   409 `object_locked` mit der Sperre. Gezählt wird die Person, nicht der Lauf (wie bei den übrigen Editoren: Dieselbe Person in einem zweiten Fenster ist
 *   kein Fremder). Ein Agent oder das System hält nie eine Sperre; für sie gilt nur, dass kein anderer sie hält.
 * - **Eine Domäne:** Eine Sprache hat keine eigene Kartendomäne (nur ihre Teilflächen); der Spracheditor schreibt in Aventurien (`AVENTURIA.mapDomain`), wie die
 *   übrigen Inhalte (`inhalte/operation.ts`) und der Import (`migration/sprachen-import.ts`).
 */

/** So heißen eine Sprache und eine ihrer Teilflächen unter `affected` und im Verlauf. */
export const SPRACHE_ART = "sprache";
export const SPRACHFLAECHE_ART = "sprache_flaeche";
export const SPRACHEN_DOMAENE = AVENTURIA.mapDomain;

export const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

export const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

/** Eine Sprache, wie die Schreibwege sie lesen; `id` ist die interne Kennung. */
export interface SpracheZeile {
    id: string;
    public_id: string;
    schluessel: string;
    name: string;
    legende: string | null;
    farbe: string;
    reihenfolge: number;
    herkunft: string;
    is_active: boolean;
    retired_at: Date | null;
    revision: number;
    updated_at: Date;
}

/**
 * Die Spalten, die Stilllegen (`aktiv = false`) und Zurückholen einer Sprache setzen: eine Quelle für die Vorwärtswege (`editor-schreiben.ts`) und die Rücknahme
 * (`editor/ruecknahme-sprache.ts`). Stillgelegt wird von der Redaktion (`retired_origin = editor`), nie gelöscht.
 */
export const spracheStand = (tx: Queryable, aktiv: boolean): PendingQuery<Row[]> =>
    aktiv
        ? tx`state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL`
        : tx`state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor'`;

/** Dasselbe für eine Teilfläche (ohne `state`; die Tafel führt es nicht). */
export const flaechenStand = (tx: Queryable, aktiv: boolean): PendingQuery<Row[]> =>
    aktiv
        ? tx`is_active = TRUE, retired_at = NULL, retired_origin = NULL`
        : tx`is_active = FALSE, retired_at = now(), retired_origin = 'editor'`;

/** Die Sprache lesen, ohne zu sperren (vor der Transaktion); `undefined`, wenn es sie nicht gibt. */
export async function leseSpracheZeile(sql: Queryable, publicId: string): Promise<SpracheZeile | undefined> {
    const [zeile] = await sql<SpracheZeile[]>`
        SELECT id::text, public_id::text, schluessel, name, legende, farbe, reihenfolge, herkunft, is_active, retired_at,
               revision::int AS revision, updated_at
          FROM sprache WHERE public_id = ${publicId}::uuid
    `;
    return zeile;
}

/**
 * Die Sprache für eine Operation: gesperrt (`FOR UPDATE`), gegen `baseRevision` geprüft (409 `edit_conflict` mit wer und wann) und im erwarteten Stand
 * (`aktiv`: nicht stillgelegt; `stillgelegt`: zum Zurückholen). Fehlt sie, 404.
 */
export async function spracheZumSchreiben(
    tx: Sql,
    publicId: string,
    baseRevision: number,
    erwartet: "aktiv" | "stillgelegt" = "aktiv",
): Promise<SpracheZeile> {
    const [zeile] = await tx<SpracheZeile[]>`
        SELECT id::text, public_id::text, schluessel, name, legende, farbe, reihenfolge, herkunft, is_active, retired_at,
               revision::int AS revision, updated_at
          FROM sprache WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diese Sprache gibt es nicht.");
    if (zeile.revision !== baseRevision) {
        throw await mapEditConflict(
            tx,
            { kind: "sprache", publicId },
            { revision: zeile.revision, changedAt: zeile.updated_at },
        );
    }
    if (erwartet === "aktiv" && !zeile.is_active)
        throw ungueltig("Diese Sprache ist stillgelegt; erst zurückholen, dann ändern.", { field: "state" });
    if (erwartet === "stillgelegt" && zeile.is_active)
        throw ungueltig("Diese Sprache ist nicht stillgelegt.", { field: "state" });
    return zeile;
}

/** Die geltenden Sperren dieser Sprachen; `fremd`: die erste, die nicht der handelnden Person gehört. */
async function sperrenVon(
    tx: Queryable,
    actor: MapActor,
    sprachen: readonly string[],
): Promise<{ fremd: EditorLock | undefined; eigen: EditorLock[] }> {
    const sperren = (await listEditorLocks(tx, "sprache", undefined)).filter((sperre) => sprachen.includes(sperre.id));
    const istEigen = (sperre: EditorLock): boolean => actor.kind === "person" && sperre.person.id === actor.personId;
    return { fremd: sperren.find((sperre) => !istEigen(sperre)), eigen: sperren.filter(istEigen) };
}

const gesperrt = (sperre: EditorLock): ApiError =>
    new ApiError(
        EDITOR_LOCK_ERROR_STATUS.object_locked,
        "object_locked",
        `${sperre.person.name} bearbeitet das gerade.`,
        {
            lock: sperre,
        },
    );

/** Hält ein anderer eine dieser Sprachen? Dann 409 `object_locked` mit seiner Sperre; die eigene zählt nicht. */
export async function pruefeFremdeSprachSperre(
    tx: Queryable,
    actor: MapActor,
    sprachen: readonly string[],
): Promise<void> {
    if (sprachen.length === 0) return;
    const { fremd } = await sperrenVon(tx, actor, sprachen);
    if (fremd !== undefined) throw gesperrt(fremd);
}

/**
 * Die Person hält die Sperre dieser Sprache (Herzschlag in den letzten 15 Minuten), sonst 409 `lock_required`; hält sie ein anderer, 409 `object_locked`.
 * Ein Agent oder das System braucht nur, dass kein anderer sie hält.
 */
export async function verlangeSprachSperre(tx: Queryable, actor: MapActor, sprache: string): Promise<void> {
    const { fremd, eigen } = await sperrenVon(tx, actor, [sprache]);
    if (fremd !== undefined) throw gesperrt(fremd);
    if (actor.kind !== "person") return;
    if (eigen.length === 0)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.lock_required,
            "lock_required",
            "Erst die Sprache zum Bearbeiten öffnen: Ohne ihre Sperre schreibt der Spracheditor nicht.",
        );
}
