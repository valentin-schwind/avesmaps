import {
    FREIGABE_JOB_KIND,
    FREIGABE_PHASEN,
    freigabeJobRef,
    phasenFuer,
    type FreigabeFortschritt,
    type FreigabePhase,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Fortschritt einer Freigabe aus der Warteschlange (WI-0204). Claudios Abholer meldet den Lauf als aufgezeichneten Job
 * `production_freigabe` mit dem Ref `freigabe-<OPS>`; hier wird er zum Vorgang gelesen. Kein zweites Protokoll: Was nicht gemeldet
 * ist, steht als `null` da, die Oberfläche erfindet nichts.
 *
 * 🔴 Lesen ist best effort wie der Rest der Freigabe-Route: Fehlt die Tafel oder ein Recht, gibt es keinen Fortschritt, aber die
 * Ansicht bleibt. Der Fehler geht ins Log; still verschluckt hätte er eine falsche Spalte versteckt (so geschehen beim Bau).
 */

interface JobZeile {
    external_ref: string;
    state: string;
    phase: string | null;
    phase_stats: Record<string, { wallMs?: unknown } | undefined> | null;
    started_at: Date | null;
    created_at: Date;
    finished_at: Date | null;
    error_code: string | null;
    error_summary: string | null;
}

const PHASEN = new Set<string>(FREIGABE_PHASEN);
const istPhase = (name: string | null): name is FreigabePhase => name !== null && PHASEN.has(name);
/** Wie der Vertrag die Kennung erlaubt; was anders aussieht, ist keine Kennung und bleibt weg. */
const FEHLERCODE = /^[a-z_]{1,40}$/u;

/** Eine Zeile der Warteschlange als Fortschritt des Laufs `art`. Rein, damit die Regel ohne Datenbank prüfbar ist. */
export function alsFortschritt(zeile: JobZeile, art: "release" | "rollback"): FreigabeFortschritt {
    const zustand =
        zeile.state === "SUCCEEDED"
            ? "gruen"
            : zeile.state === "QUEUED" || zeile.state === "RUNNING"
              ? "laeuft"
              : "rot";
    const phase = istPhase(zeile.phase) ? zeile.phase : null;
    const stats = zeile.phase_stats ?? {};
    // In der Reihenfolge des Ablaufs, nicht in der des JSON-Objekts. Eine Phase gilt als fertig, wenn sie eine Dauer hat oder
    // vor der jetzigen liegt; die jetzige nur, wenn der Lauf grün ist.
    const reihe = phasenFuer(art);
    const jetzt = phase === null ? -1 : reihe.indexOf(phase);
    const fertig = reihe
        .map((name, stelle) => {
            const eintrag = stats[name];
            const ms =
                typeof eintrag?.wallMs === "number" && Number.isFinite(eintrag.wallMs)
                    ? Math.max(0, Math.round(eintrag.wallMs))
                    : null;
            const vorbei =
                eintrag !== undefined || (jetzt >= 0 && stelle < jetzt) || (zustand === "gruen" && stelle === jetzt);
            return vorbei ? { phase: name, ms } : null;
        })
        .filter((eintrag): eintrag is { phase: FreigabePhase; ms: number | null } => eintrag !== null);
    const beginn = zeile.started_at ?? zeile.created_at;
    // Seit wann die jetzige Phase läuft, ist nur ableitbar, wenn jede Phase davor ihre Dauer gemeldet hat.
    const davor = fertig.filter((eintrag) => eintrag.phase !== phase);
    const phaseSeit =
        zustand === "laeuft" && davor.every((eintrag) => eintrag.ms !== null)
            ? new Date(beginn.getTime() + davor.reduce((summe, eintrag) => summe + (eintrag.ms ?? 0), 0)).toISOString()
            : null;
    return {
        zustand,
        phase,
        fertig,
        beginn: beginn.toISOString(),
        phaseSeit,
        ende: zeile.finished_at?.toISOString() ?? null,
        fehlerCode: zeile.error_code !== null && FEHLERCODE.test(zeile.error_code) ? zeile.error_code : null,
        fehler: zeile.error_summary === null ? null : zeile.error_summary.slice(0, 400),
    };
}

/** Der jüngste aufgezeichnete Lauf je Vorgang. Schlüssel ist die OPS-Kennung. */
export async function fortschritteZu(
    db: Queryable,
    laeufe: readonly { ops: string; art: "release" | "rollback" }[],
    warn: (message: string) => void = () => undefined,
): Promise<Map<string, FreigabeFortschritt>> {
    const ergebnis = new Map<string, FreigabeFortschritt>();
    if (laeufe.length === 0) return ergebnis;
    const nachRef = new Map(laeufe.map((lauf) => [freigabeJobRef(lauf.ops), lauf] as const));
    const zeilen = await db<JobZeile[]>`
        SELECT DISTINCT ON (external_ref)
               external_ref, state, phase, phase_stats, started_at, queued_at AS created_at, finished_at, error_code, error_summary
          FROM job
         WHERE kind = ${FREIGABE_JOB_KIND} AND origin = 'recorded' AND external_ref = ANY(${[...nachRef.keys()]}::text[])
           -- Angekündigt, noch nicht abgeholt (WI-0248): Das ist noch kein Lauf; die Ansicht zeigt dann nur den Auftrag, wie bisher.
           AND state <> 'QUEUED'
         ORDER BY external_ref, id DESC
    `.catch((error: unknown) => {
        warn(`freigabe: Fortschritt nicht lesbar (${error instanceof Error ? error.message : String(error)})`);
        return [] as JobZeile[];
    });
    for (const zeile of zeilen) {
        const lauf = nachRef.get(zeile.external_ref);
        if (lauf !== undefined) ergebnis.set(lauf.ops, alsFortschritt(zeile, lauf.art));
    }
    return ergebnis;
}
