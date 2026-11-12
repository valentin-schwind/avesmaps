import {
    AVENTURIA,
    SERIES_SWITCH_PREFIX,
    contentSwitchSpec,
    type AdminContentSwitches,
    type DerivedWork,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { QuarantineReason } from "../media/quarantine.ts";
import { alleSchalter, bekannteSchalter, istAus, type Inhaltsstand } from "./inhaltsstand.ts";
import { systemStateUnknown } from "./write-guard.ts";

export {
    InhaltsschalterStore,
    SCHALTBARE_SERIEN,
    alleSchalter,
    ausgeschaltet,
    bekannteSchalter,
    inhaltsstandFuer,
    istAus,
    leseInhaltsstand,
    schalterVon,
    type Bekannt,
    type Inhaltsstand,
    type SchalterZeile,
} from "./inhaltsstand.ts";

/**
 * Die Inhaltsschalter auf dem Server (WI-0127 SYS-10, SYS-0001 §3.4): das Umschalten (eine Stelle für Route und künftige Kommandozeile),
 * das Einreihen des Quarantäne-Abgleichs und das Lesemodell des Eintrags. Den Stand selbst liest `inhaltsstand.ts` (ohne Fastify, für
 * Werkzeuge); diese Datei reicht ihn weiter, damit Aufrufer eine Adresse behalten.
 */

/** Die Jobart des Quarantäne-Abgleichs (b3, `jobs/media-quarantine-job.ts`). */
export const MEDIA_QUARANTINE_KIND = "media_quarantine";

/**
 * Reiht den Quarantäne-Abgleich ein, in der Transaktion der Umschaltung bzw. des Notaus (`media-editor/suspension.ts`), über die einzige
 * Tür der App-Rolle (`job_enqueue`, 0104). Ohne Person als Auslöser (`inhaltsschalter`, `notaus`): Sonst hielte die Kartensperre ihn an
 * (SYS-4), und was schützt, muss gerade dann wirken. Der Job gleicht immer beide Gründe ab (`jobs/media-quarantine-job.ts`); `grund`
 * sagt nur, wer ihn wollte. Ein zweiter Job schadet nicht: Der Abgleich rechnet die ganze Menge und tut nichts, wenn alles liegt, wo es soll.
 */
export async function reiheQuarantaeneEin(
    tx: Queryable,
    grund: QuarantineReason = "content_switch",
): Promise<DerivedWork> {
    const ausloeser = grund === "content_switch" ? "inhaltsschalter" : "notaus";
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${MEDIA_QUARANTINE_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, ${ausloeser}, ${tx.json({ grund })})
    `;
    return { kind: MEDIA_QUARANTINE_KIND, jobId: job!.public_id, state: "queued" };
}

export interface Umschalten {
    key: string;
    enabled: boolean;
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

/**
 * Schaltet einen Schalter um, in der Transaktion des Aufrufers (der das Protokoll im selben Zug schreibt). `baseRevision` ist die
 * Inhaltsrevision, die die Oberfläche gesehen hat; veraltet: 409 `edit_conflict`. Unbekannt: 400 `unknown_switch`. Ohne Betriebszustand:
 * 503 `system_state_unknown`. Gibt die neue Inhaltsrevision und den vorigen Stand zurück.
 */
export async function schalteUm(
    tx: Queryable,
    input: Umschalten,
): Promise<{ from: boolean; to: boolean; revision: number }> {
    const bekannt = await bekannteSchalter(tx);
    if (contentSwitchSpec(input.key, bekannt) === undefined) {
        throw new ApiError(400, "unknown_switch", "Diesen Schalter gibt es nicht.");
    }
    const [state] = await tx<{ content_revision: number; updated_at: Date }[]>`
        SELECT content_revision::int AS content_revision, updated_at FROM system_state WHERE id = 1 FOR UPDATE
    `;
    if (state === undefined) throw systemStateUnknown();
    if (state.content_revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.content_revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    const [vorher] = await tx<{ enabled: boolean }[]>`SELECT enabled FROM content_switch WHERE key = ${input.key}`;
    const from = vorher?.enabled ?? true;
    if (from === input.enabled) throw new ApiError(409, "no_change", "Der Schalter steht schon so.");
    if (!input.enabled && input.key.startsWith(SERIES_SWITCH_PREFIX)) {
        const aus = await tx<
            { key: string }[]
        >`SELECT key FROM content_switch WHERE NOT enabled AND key LIKE 'map.series.%'`;
        const bleiben = (bekannt.oeffentlicheSerien ?? bekannt.series).filter(
            (id) =>
                `${SERIES_SWITCH_PREFIX}${id}` !== input.key &&
                !aus.some((row) => row.key === `${SERIES_SWITCH_PREFIX}${id}`),
        );
        if (bleiben.length === 0) {
            throw new ApiError(409, "last_series", "Eine Kartenserie muss für Besucher sichtbar bleiben.");
        }
    }
    await tx`
        INSERT INTO content_switch (key, enabled, changed_at, changed_by, changed_by_label)
        VALUES (${input.key}, ${input.enabled}, now(), ${input.actor.personId}::uuid, ${input.actor.label})
        ON CONFLICT (key) DO UPDATE SET
            enabled = EXCLUDED.enabled, changed_at = now(), changed_by = EXCLUDED.changed_by,
            changed_by_label = EXCLUDED.changed_by_label, revision = content_switch.revision + 1
    `;
    // Ein Bilder-Schalter nimmt auch die Dateien aus der Auslieferung (Frage 1 B): der Abgleich im Worker, in dieser Transaktion eingereiht.
    if (input.key.startsWith("media.")) await reiheQuarantaeneEin(tx);
    const [neu] = await tx<
        { content_revision: number }[]
    >`SELECT content_revision::int AS content_revision FROM system_state WHERE id = 1`;
    return { from, to: input.enabled, revision: neu!.content_revision };
}

const EMPTY_COUNT = { sichtbar: 0, ausgeblendet: 0 } as const;

/**
 * Das Lesemodell des Eintrags „Inhalte“. `zahlen`: je Bilder-Schalter sichtbare und zurückgehaltene Bilder (`media/quarantine.ts`,
 * `zahlenJeSchalter`); ohne sie `visible: null`. `pending`: ein Quarantäne-Abgleich wartet oder läuft.
 */
export function inhaltsModell(
    stand: Inhaltsstand,
    now: Date,
    extra: { zahlen?: ReadonlyMap<string, { sichtbar: number; ausgeblendet: number }>; pending?: boolean } = {},
): AdminContentSwitches {
    const { zahlen, pending } = extra;
    return {
        now: now.toISOString(),
        revision: stand.revision,
        source: stand.source,
        rows: alleSchalter(stand.bekannt).map((spec) => {
            const zeile = stand.zeilen.get(spec.key);
            const enabled = !istAus(stand, spec.key);
            const zahl =
                zahlen !== undefined && spec.key.startsWith("media.") ? (zahlen.get(spec.key) ?? EMPTY_COUNT) : null;
            return {
                key: spec.key,
                group: spec.group,
                enabled,
                changedAt: zeile?.changedAt.toISOString() ?? null,
                changedBy: zeile?.changedBy ?? null,
                visible: zahl?.sichtbar ?? null,
                ...(zahl !== null && !enabled ? { hidden: zahl.ausgeblendet } : {}),
            };
        }),
        unknownKeys: stand.unknownKeys,
        ...(pending === undefined ? {} : { pending }),
    };
}
