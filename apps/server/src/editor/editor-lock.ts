import {
    EDITOR_LOCK_TIMEOUT_MINUTES,
    type EditorLock,
    type EditorLockKind,
    type EditorLockPart,
    type EditorLockTarget,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { closeEditorLockRequests } from "./editor-lock-request.ts";

/**
 * Die Sperre während der Bearbeitung am Server (EDIT-0003 §4; Vertrag `packages/shared/src/editor-lock.ts`, Tafel 0138). EINE Stelle für
 * alle Editoren; die Routen stehen in `routes/editor-locks.ts`.
 *
 * - 🔴 **Frei entscheidet die Abfrage** (Claudios Einschätzung): Hält eine andere Person die Zeile und schlug ihr Herz in den letzten
 *   15 Minuten, bekommt niemand sonst die Sperre. Danach überschreibt sie, wer sie nimmt; der alte Lauf erfährt es beim nächsten
 *   Herzschlag (`lost`). Nehmen ist EIN `INSERT … ON CONFLICT … WHERE`: Zwei, die zugleich fragen, bekommen sie nie beide.
 * - 🔴 **Niemand sperrt sich selbst** (Vali 2026-11-02: „eine fläche wird durch mich selber am verändern gehindert“): Ein zweites Fenster
 *   oder ein vergessener Tab derselben Person übernimmt die Sperre sofort; der alte Lauf erfährt es beim nächsten Herzschlag (`lost`), sein
 *   Entwurf bleibt. Die Liste nennt dieser Person die Sperre als eigene. Die Schreibwege vergleichen ohnehin die Person, nicht den Lauf.
 * - **Wegräumen:** Zeilen ohne Herzschlag seit einem Tag löscht das Nehmen selbst (über den Index, billig); einen eigenen Pflegeauftrag
 *   braucht es dafür nicht.
 * - Derselbe Lauf, der noch einmal nimmt (etwa erst die Form, dann die Felder), behält seine Zeile und sein „seit“.
 */

interface LockRow {
    object_kind: EditorLockKind;
    object_id: string;
    part: EditorLockPart;
    person_id: string;
    person_name: string;
    run_id: string;
    since: Date;
    heartbeat_at: Date;
    at_x?: number | null;
    at_y?: number | null;
    layer?: string | null;
    sections?: string[] | null;
}

const lockOf = (row: LockRow, run: string | undefined, personId?: string): EditorLock => ({
    kind: row.object_kind,
    id: row.object_id,
    part: row.part,
    person: { id: row.person_id, name: row.person_name },
    since: row.since.toISOString(),
    heartbeatAt: row.heartbeat_at.toISOString(),
    own: (run !== undefined && row.run_id === run) || (personId !== undefined && row.person_id === personId),
    ...(row.at_x === undefined || row.at_x === null || row.at_y === undefined || row.at_y === null
        ? {}
        : { at: { x: row.at_x, y: row.at_y } }),
    ...(row.layer === undefined || row.layer === null ? {} : { layer: row.layer }),
    ...(row.sections === undefined || row.sections === null ? {} : { sections: row.sections }),
});

export interface TakeLockInput {
    kind: EditorLockKind;
    id: string;
    part: EditorLockPart;
    run: string;
    personId: string;
    personName: string;
}

export type TakeLockResult = { taken: true; lock: EditorLock } | { taken: false; lock: EditorLock };

export async function takeEditorLock(db: Queryable, input: TakeLockInput): Promise<TakeLockResult> {
    await db`DELETE FROM editor_lock WHERE heartbeat_at < now() - interval '1 day'`;
    // Zweimal: Gibt der andere zwischen Nehmen und Nachsehen frei, ist die Zeile weg, und der zweite Versuch bekommt sie.
    for (let versuch = 0; versuch < 2; versuch += 1) {
        const [row] = await db<LockRow[]>`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES (${input.kind}, ${input.id}, ${input.part}, ${input.personId}, ${input.personName}, ${input.run})
            ON CONFLICT (object_kind, object_id) DO UPDATE
               SET part = EXCLUDED.part,
                   person_id = EXCLUDED.person_id,
                   person_name = EXCLUDED.person_name,
                   since = CASE WHEN editor_lock.run_id = EXCLUDED.run_id THEN editor_lock.since ELSE now() END,
                   run_id = EXCLUDED.run_id,
                   heartbeat_at = now()
             WHERE editor_lock.run_id = EXCLUDED.run_id
                OR editor_lock.person_id = EXCLUDED.person_id
                OR editor_lock.heartbeat_at < now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
            RETURNING object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at
        `;
        if (row) return { taken: true, lock: lockOf(row, input.run) };
        const [held] = await db<LockRow[]>`
            SELECT object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at
              FROM editor_lock
             WHERE object_kind = ${input.kind} AND object_id = ${input.id}
        `;
        if (held) return { taken: false, lock: lockOf(held, input.run) };
    }
    throw new Error("editor_lock: Die Sperre ließ sich weder nehmen noch lesen.");
}

/** Der Herzschlag eines Laufs für seine Sperren; zurück kommt, was er nicht mehr hält. */
export async function beatEditorLocks(
    db: Queryable,
    run: string,
    targets: readonly EditorLockTarget[],
): Promise<EditorLockTarget[]> {
    if (targets.length === 0) return [];
    const rows = await db<{ object_kind: EditorLockKind; object_id: string }[]>`
        UPDATE editor_lock
           SET heartbeat_at = now()
          FROM unnest(${targets.map((t) => t.kind)}::text[], ${targets.map((t) => t.id)}::uuid[]) AS t(kind, id)
         WHERE editor_lock.object_kind = t.kind AND editor_lock.object_id = t.id AND editor_lock.run_id = ${run}
        RETURNING editor_lock.object_kind, editor_lock.object_id
    `;
    const gehalten = new Set(rows.map((row) => `${row.object_kind}|${row.object_id}`));
    return targets.filter((target) => !gehalten.has(`${target.kind}|${target.id}`));
}

/** Gibt frei, was dieser Lauf hält; eine fremde Sperre bleibt. */
export async function releaseEditorLock(db: Queryable, run: string, target: EditorLockTarget): Promise<boolean> {
    const rows = await db`
        DELETE FROM editor_lock WHERE object_kind = ${target.kind} AND object_id = ${target.id} AND run_id = ${run}
        RETURNING 1
    `;
    // Bitten um Freigabe an diese Sperre sind damit erfüllt (WI-0262): Der Bittende liest „freigegeben“, ohne dass jemand antwortet.
    if (rows.length > 0) await closeEditorLockRequests(db, target, run);
    return rows.length > 0;
}

/** Hebt eine Sperre auf, gleich wer sie hält (ein Admin, `/lift`); `false`, wenn es keine gab. */
export async function liftEditorLock(db: Queryable, target: EditorLockTarget): Promise<boolean> {
    const rows = await db`
        DELETE FROM editor_lock WHERE object_kind = ${target.kind} AND object_id = ${target.id} RETURNING 1
    `;
    if (rows.length > 0) await closeEditorLockRequests(db, target, undefined);
    return rows.length > 0;
}

/**
 * Die geltenden Sperren einer Art (Herzschlag in den letzten 15 Minuten), die älteste zuerst. Dazu der Punkt des Schilds: bei
 * Landschaften ein Punkt in der größten aktiven Teilfläche (`ST_PointOnSurface`), damit das Schild immer auf der Landschaft steht;
 * bei Orten der Punkt des Orts (WI-0208, die Sperre am Ort sichtbar). Ein Ort ohne Lage hat keinen Punkt und kein Schild. Beim Gipfel
 * (WI-0178 P1) sein Punkt.
 * An Linien (WI-0205 K11, Anzeige; Kopf `sperren-an-linien-schnittstelle.md`): beim Weg die Mitte des Abschnitts, wie die Karte ihn
 * zeichnet (`path_visual` vor `path`); bei der Kraftlinie die Mitte ihres längsten Abschnitts. Dazu `sections`: beim Weg der eine
 * Abschnitt, bei der Kraftlinie alle Abschnitte ihrer Namensgruppe im selben Stand wie der Anker (ohne Namen der eine; wie
 * `linienAbschnitte`; Stand aus `is_active` und `off_map`, Migration 0154: eine abgenommene Linie gleichen Namens ist eine andere).
 * Bei der Sprache (WI-0261 S5d) ein Punkt in ihrer größten aktiven Teilfläche; eine Sprache ohne Fläche hat kein Schild.
 * `personId`: Wer fragt; seine Sperren aus anderen Fenstern gelten als eigene (`own`).
 */
export async function listEditorLocks(
    db: Queryable,
    kind: EditorLockKind,
    run: string | undefined,
    personId?: string,
): Promise<EditorLock[]> {
    const rows = await db<LockRow[]>`
        SELECT l.object_kind, l.object_id, l.part, l.person_id, l.person_name, l.run_id, l.since, l.heartbeat_at,
               ST_X(COALESCE(p.punkt, o.geom, w.punkt, k.punkt, g.geom, sp.punkt)) AS at_x,
               ST_Y(COALESCE(p.punkt, o.geom, w.punkt, k.punkt, g.geom, sp.punkt)) AS at_y,
               p.layer, COALESCE(w.sections, k.sections) AS sections
          FROM editor_lock l
          LEFT JOIN LATERAL (
                SELECT ST_PointOnSurface(a.geom) AS punkt, r.region_layer AS layer
                  FROM region r JOIN region_area a ON a.region_id = r.id AND a.is_active
                 WHERE l.object_kind = 'landscape' AND r.public_id = l.object_id
                 ORDER BY ST_Area(a.geom) DESC
                 LIMIT 1
          ) p ON TRUE
          LEFT JOIN place o ON l.object_kind = 'place' AND o.public_id = l.object_id
          LEFT JOIN terrain_peak g ON l.object_kind = 'peak' AND g.public_id = l.object_id
          LEFT JOIN LATERAL (
                SELECT ST_LineInterpolatePoint(COALESCE(v.geom, pa.geom), 0.5) AS punkt, ARRAY[pa.public_id::text] AS sections
                  FROM path pa LEFT JOIN path_visual v ON v.path_id = pa.id
                 WHERE l.object_kind = 'path' AND pa.public_id = l.object_id
                 LIMIT 1
          ) w ON TRUE
          LEFT JOIN LATERAL (
                SELECT (array_agg(ST_LineInterpolatePoint(s.drawn_geom, 0.5) ORDER BY ST_Length(s.drawn_geom) DESC))[1] AS punkt,
                       array_agg(s.public_id::text ORDER BY s.public_id) AS sections
                  FROM powerline anker
                  JOIN powerline s ON s.is_active = anker.is_active AND s.off_map = anker.off_map
                   AND s.map_domain_id = anker.map_domain_id
                   AND CASE WHEN btrim(anker.name) = '' THEN s.public_id = anker.public_id ELSE s.name = anker.name END
                 WHERE l.object_kind = 'powerline' AND anker.public_id = l.object_id AND (anker.is_active OR anker.off_map)
                HAVING count(*) > 0
          ) k ON TRUE
          LEFT JOIN LATERAL (
                SELECT ST_PointOnSurface(f.geom) AS punkt
                  FROM sprache s JOIN sprache_flaeche f ON f.sprache_id = s.id AND f.is_active
                 WHERE l.object_kind = 'sprache' AND s.public_id = l.object_id
                 ORDER BY ST_Area(f.geom) DESC
                 LIMIT 1
          ) sp ON TRUE
         WHERE l.object_kind = ${kind}
           AND l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
         ORDER BY l.since, l.object_id
    `;
    return rows.map((row) => lockOf(row, run, personId));
}
