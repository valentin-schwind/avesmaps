import { FREIGABE_JOB_KIND, RELEASE_TEST_JOB_KIND, UUID_PATTERN, istAbgleichJobart } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Der Halt der Editor-Jobs (WI-0127 SYS-4, SYS-0001 §3.3; Claudio 2026-10-09 Punkt 5: „Über den Wert in der Datenbank, nicht über
 * `rollout`“). Der Worker liest die Zeile `system_state` (Migration 0087) mit der Jobs-Rolle in jeder Zulassungsrunde; die Marke
 * `rollout` bleibt Claudios Deploy-Signal mit eigenem Lebenszyklus.
 *
 * - **Editor-Job** ist ein Job, den eine Person ausgelöst hat: `actor_ref` ist ihre pseudonyme `person.id` (eine UUID). Abläufe ohne
 *   Person (`import`, `rollout`, die Kommandozeile mit `jobs-cli`, Ketten eines Zugs ohne Auslöser) sind keine; sie laufen weiter
 *   (Betreiber 2026-10-10, SYS-0001 §9a Frage 3: „nein auf keinen fall“).
 * - **Halt** gilt unter Kartensperre und im eingeschränkten Betrieb. Fehlt die Tabelle (ein Worker vor `migrate`), gilt Normal wie vor
 *   SYS-2. Lässt sich die Zeile sonst nicht lesen (Recht fehlt, Zeile fehlt), warten neue Editor-Jobs (fail-closed), laufende nicht.
 * - `heldForS` rechnet die Datenbank (`now()` gegen den Zeitpunkt der Sperre), nicht die Uhr des Workers: Ein Neustart des Workers
 *   setzt die Frist `drainMaxS` nicht zurück.
 */

export type FreezeCause = "map_lock" | "restricted" | "unknown";

export interface EditorFreeze {
    /** Warten neue Editor-Jobs? */
    held: boolean;
    cause: FreezeCause | null;
    /** Seit wie vielen Sekunden der Halt gilt; `null` ohne Halt oder bei unbekanntem Zustand (dann rechnet Laufendes weiter). */
    heldForS: number | null;
    /** Die Kartensperre, wenn sie gesetzt ist (für die WARN-Zeile der Importe). */
    mapLockSince: Date | null;
}

export const NOT_HELD: EditorFreeze = { held: false, cause: null, heldForS: null, mapLockSince: null };
const UNKNOWN: EditorFreeze = { held: true, cause: "unknown", heldForS: null, mapLockSince: null };

const PERSON_REF = new RegExp(UUID_PATTERN, "u");

/**
 * Aufträge mit Person, die keine Kartenarbeit sind (WI-0248): der Release-Test des Entwicklungsrechners und die angekündigte Production-Freigabe.
 * Keine Kartensperre hält sie an, und sie gehören zu keiner Folge der Glocke („Warteschlange fertig“, `folge-fertig.ts`).
 */
export const OHNE_KARTENBEZUG: ReadonlySet<string> = new Set([RELEASE_TEST_JOB_KIND, FREIGABE_JOB_KIND]);

/**
 * Hat eine Person den Job ausgelöst, und hält eine Sperre ihn an? Ein Auftrag der Abgleiche (`legacy_pull`, `legacy_media`; WI-0127
 * SYS-14) trägt zwar die Person, ist aber ein Import: Die Kartensperre hält ihn nicht an (Betreiber 2026-10-10, SYS-0001 §9a Frage 3:
 * „nein auf keinen fall“). Ohne `kind` zählt nur der Auslöser.
 */
export function isEditorJob(actorRef: string | null, kind?: string): boolean {
    if (kind !== undefined && (istAbgleichJobart(kind) || OHNE_KARTENBEZUG.has(kind))) return false;
    return actorRef !== null && PERSON_REF.test(actorRef);
}

/**
 * Die Warnzeile eines Imports unter Kartensperre (SYS-4): Er läuft weiter und lässt die Sperre stehen. Ohne den Grund (Freitext mit
 * möglichem Personenbezug). `null`, wenn keine Kartensperre gesetzt ist. Liest nur, wirft nie.
 */
export async function mapLockWarning(db: Queryable): Promise<string | null> {
    const { mapLockSince } = await readEditorFreeze(db);
    if (mapLockSince === null) return null;
    return `WARN Kartensperre gesetzt seit ${mapLockSince.toISOString()}: der Import läuft trotzdem weiter und lässt die Sperre stehen (Betreiber 2026-10-10)`;
}

/** Liest den Halt; wirft nie (ein Fehler ist `unknown`, eine fehlende Tabelle Normal). */
export async function readEditorFreeze(db: Queryable): Promise<EditorFreeze> {
    try {
        const [row] = await db<
            { mode: string; map_lock: boolean; map_lock_since: Date | null; held_for_s: number | null }[]
        >`
            SELECT mode, map_lock, map_lock_since,
                   EXTRACT(EPOCH FROM now() - LEAST(CASE WHEN map_lock THEN map_lock_since END,
                                                    CASE WHEN mode = 'restricted' THEN mode_since END))::float8 AS held_for_s
              FROM system_state
             WHERE id = 1
        `;
        if (row === undefined) return UNKNOWN;
        const cause: FreezeCause | null = row.map_lock ? "map_lock" : row.mode === "restricted" ? "restricted" : null;
        if (cause === null) return NOT_HELD;
        return {
            held: true,
            cause,
            heldForS: Math.max(0, row.held_for_s ?? 0),
            mapLockSince: row.map_lock ? row.map_lock_since : null,
        };
    } catch (error) {
        return isMissingTable(error) ? NOT_HELD : UNKNOWN;
    }
}
