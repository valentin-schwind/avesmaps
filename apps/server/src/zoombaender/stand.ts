import { zoombandSpur, zoomspanneGueltig, type AdminZoombaender, type Zoomspanne } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Die Zoombänder auf dem Server (WI-0221, Migration 0168): lesen, ins Lesemodell bringen, verstellen und zurücksetzen. Den Katalog
 * samt Vorgaben führt das geteilte Paket (`packages/shared/src/system/zoombaender.ts`); hier liegt keine zweite Liste. Vorbild ist
 * `system/karteneinstellungen.ts`.
 *
 * - **Fehlerrichtung:** Fehlt die Tafel (vor 0168) oder die Datenbank, gelten die Vorgaben (`unprovisioned`).
 * - Ein Schlüssel, den der Katalog nicht kennt, oder eine Spur nur zur Ansicht (Herrschaftsgebiete, Seewege) wird übergangen und
 *   gemeldet (`unknownKeys`).
 */

export interface Zoombandstand {
    source: "database" | "unprovisioned";
    revision: number | null;
    zeilen: { id: string; spanne: Zoomspanne; changedAt: Date; changedBy: string | null }[];
    unknownKeys: string[];
}

const OHNE: Zoombandstand = { source: "unprovisioned", revision: null, zeilen: [], unknownKeys: [] };

export async function leseZoombaender(
    db: Queryable | undefined,
    { personen = true }: { personen?: boolean } = {},
): Promise<Zoombandstand> {
    if (db === undefined) return OHNE;
    let revision: number | null;
    let rows: { key: string; von: number; bis: number; changed_at: Date; changed_by: string | null }[];
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM zoom_band_state WHERE id = 1`;
        revision = state?.revision ?? null;
        rows = personen
            ? await db`
                SELECT z.key, z.von, z.bis, z.changed_at, COALESCE(p.display_name, z.changed_by_label) AS changed_by
                  FROM zoom_band_setting z
                  LEFT JOIN avesmaps_auth.person p ON p.id = z.changed_by
                 ORDER BY z.key
            `
            : await db`SELECT key, von, bis, changed_at, NULL::text AS changed_by FROM zoom_band_setting ORDER BY key`;
    } catch (error) {
        if (isMissingTable(error)) return OHNE;
        throw error;
    }
    const zeilen: Zoombandstand["zeilen"] = [];
    const unknownKeys: string[] = [];
    for (const row of rows) {
        const spur = zoombandSpur(row.key);
        const spanne = { von: row.von, bis: row.bis };
        if (spur === undefined || spur.nurAnsicht !== undefined || !zoomspanneGueltig(spanne))
            unknownKeys.push(row.key);
        else zeilen.push({ id: row.key, spanne, changedAt: row.changed_at, changedBy: row.changed_by });
    }
    return { source: "database", revision, zeilen, unknownKeys };
}

/** Die Abweichungen als Tafel `id → Spanne` (der öffentliche Leseweg). */
export function abweichungenVon(stand: Zoombandstand): Record<string, Zoomspanne> {
    return Object.fromEntries(stand.zeilen.map((z) => [z.id, z.spanne]));
}

export function zoombaenderModell(stand: Zoombandstand, now: Date): AdminZoombaender {
    return {
        now: now.toISOString(),
        revision: stand.revision,
        source: stand.source,
        zeilen: stand.zeilen.map((z) => ({
            id: z.id,
            spanne: z.spanne,
            changedAt: z.changedAt.toISOString(),
            changedBy: z.changedBy,
        })),
        unknownKeys: [...stand.unknownKeys].sort(),
    };
}

export const ZOOMBAENDER_SPERRE = "zoom_band:schreiben";

export interface Verstellen {
    aenderungen: { id: string; spanne: Zoomspanne | null }[];
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

/**
 * Verstellt mehrere Spuren auf einmal („Übernehmen“), in der Transaktion des Aufrufers. `spanne: null` oder genau die Vorgabe setzt
 * zurück (die Zeile fällt weg). Unbekannte Spur 400 `unknown_zoom_band`; Spur nur zur Ansicht 409 `zoom_band_view_only`; ungültige
 * Spanne 400 `zoom_band_out_of_range`; nichts geändert 409 `no_change`; veraltet 409 `edit_conflict`.
 */
export async function verstelleZoombaender(
    tx: Queryable,
    input: Verstellen,
): Promise<{ geaendert: string[]; revision: number }> {
    for (const { id, spanne } of input.aenderungen) {
        const spur = zoombandSpur(id);
        if (spur === undefined) throw new ApiError(400, "unknown_zoom_band", "Diese Spur gibt es nicht.", { id });
        if (spur.nurAnsicht !== undefined) {
            throw new ApiError(
                409,
                "zoom_band_view_only",
                "Diese Spanne bleibt, wie sie ist; der Reiter zeigt sie nur.",
                { id },
            );
        }
        if (spanne !== null && !zoomspanneGueltig(spanne)) {
            throw new ApiError(
                400,
                "zoom_band_out_of_range",
                "Eine Spanne geht von Band 0 bis 8, und von nicht hinter bis.",
                { id },
            );
        }
    }
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ZOOMBAENDER_SPERRE}))`;
    const [state] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM zoom_band_state WHERE id = 1
    `;
    if (state === undefined) {
        throw new ApiError(503, "zoombaender_unprovisioned", "Die Tafel der Zoombänder fehlt noch in dieser Umgebung.");
    }
    if (state.revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    const vorher = new Map(
        (await tx<{ key: string; von: number; bis: number }[]>`SELECT key, von, bis FROM zoom_band_setting`).map(
            (r) => [r.key, { von: r.von, bis: r.bis }],
        ),
    );
    const geaendert: string[] = [];
    for (const { id, spanne } of input.aenderungen) {
        const spur = zoombandSpur(id)!;
        const ziel =
            spanne !== null && (spanne.von !== spur.vorgabe.von || spanne.bis !== spur.vorgabe.bis) ? spanne : null;
        const alt = vorher.get(id) ?? null;
        const gleich = alt === null ? ziel === null : ziel !== null && alt.von === ziel.von && alt.bis === ziel.bis;
        if (gleich) continue;
        if (ziel === null) await tx`DELETE FROM zoom_band_setting WHERE key = ${id}`;
        else
            await tx`
                INSERT INTO zoom_band_setting (key, von, bis, changed_at, changed_by, changed_by_label)
                VALUES (${id}, ${ziel.von}, ${ziel.bis}, now(), ${input.actor.personId}::uuid, ${input.actor.label})
                ON CONFLICT (key) DO UPDATE SET
                    von = EXCLUDED.von, bis = EXCLUDED.bis, changed_at = now(), changed_by = EXCLUDED.changed_by,
                    changed_by_label = EXCLUDED.changed_by_label
            `;
        geaendert.push(id);
    }
    if (geaendert.length === 0) throw new ApiError(409, "no_change", "Die Spannen stehen schon so.");
    const [neu] = await tx<{ revision: number }[]>`SELECT revision::int AS revision FROM zoom_band_state WHERE id = 1`;
    return { geaendert, revision: neu!.revision };
}
