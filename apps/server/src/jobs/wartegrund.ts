import type { WaitReason, WarteschlangeUmgebung } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseEigeneAnweisung, standAuftraege, type EigeneAnweisung, type StandAuftraege } from "./gemeinsame-reihe.ts";
import type { StandLage } from "./stand-datei.ts";

/**
 * Warum eine wartende Zeile wartet — die EINE Stelle, die es ausrechnet (WI-0160; Claudios Entwurf §5: „Wartende Zeilen zeigen
 * einen Grund … statt stumm zu warten. In Production gibt es keinen Planer, der den Wartegrund schreibt; deshalb steht er heute
 * leer.“).
 *
 * 🔴 **Der Grund entsteht beim LESEN, nicht beim Schreiben.** Die Spalte `job.wait_reason` füllt der PLANER, und in Production läuft
 * keiner — genau dort stand eine wartende Zeile deshalb stumm da, und genau das war der Ärger des Betreibers. Ein Schreiber eigens
 * dafür wäre ein halber Worker; eine reine Funktion über den Umstand der Instanz ist billiger und kann nicht veralten.
 *
 * Die Reihenfolge, erster Treffer gewinnt:
 *
 * 1. **pausiert** — und zwar VOR dem geschriebenen Grund: „wartet auf Speicher“ wäre im pausierten Zustand eine Lüge.
 * 2. **der geschriebene Grund**, wenn einer in der Zeile steht. Er kommt vom Planer (`WAIT_REASONS`) oder als Freitext von einem
 *    aufgezeichneten Ablauf (`stage_rollout`, WI-0143) und ist immer genauer als jede Ableitung.
 * 3. **ein Auftrag derselben Art läuft** — Abholer wie Worker nehmen immer nur einen; dieser hier wartet auf jenen.
 * 4. **eine Abholart** (`ABGLEICHE=korridor`): Claudios Abholer kommt jede Minute.
 * 5. **kein Planer** und keine Abholart: Hier nimmt niemand diese Art an.
 * 6. sonst `null` — die Oberfläche sagt dann „Wartet auf den nächsten Takt des Planers“.
 *
 * 🔴 **Mit frischem Stand des Dirigenten** (WI-0163, `umstandMitStand`) gilt dessen Grund je Auftrag (Umgebung und Kennung) und die
 * WIRKSAME Pause über alle Umgebungen; die Schritte 2 bis 5 entfallen. Steht ein Auftrag noch nicht im Stand (eben eingereiht), gilt
 * der geschriebene Grund, sonst keiner. Ohne Stand bleibt die Ableitung oben: `waits_pickup` und `waits_no_worker` sind dann wahr.
 *
 * 🪤 Nur eine WARTENDE Zeile bekommt einen Grund; alles andere `null`. Das ist das Verhalten, das `toSummary` seit WI-0074 hat, und
 * es bleibt hier unverändert. (🔎 Nebenfund, nicht in diesem Scope: `apps/web/src/status/job-view.ts` beschreibt einen laufenden
 * aufgezeichneten Ablauf, der seinen eigenen Wartegrund meldet — `stage_rollout` hinter der Geländerechnung, WI-0143. Dieser Grund
 * steht in der Spalte, kommt aber bis heute nicht durch `toSummary` hinaus; nur der Test der Oberfläche prüft ihn, mit selbst
 * gebauten Daten.)
 */

export interface Warteumstand {
    /** Die Warteschlange dieser Umgebung ist pausiert (`system_state.queue_paused`). */
    queuePaused: boolean;
    /** Lebt ein Planer (ein Worker hält den Advisory Lock)? */
    plannerActive: boolean;
    /** Die Jobarten, die Claudios Abholer übernimmt (`ABGLEICHE=korridor`, `abgleiche/ausfuehrung.ts`). */
    pickupKinds: ReadonlySet<string>;
    /** Die Arten, von denen gerade ein Auftrag läuft. */
    runningKinds: ReadonlySet<string>;
    /** Der frische Stand des Dirigenten für die eigenen Aufträge (WI-0163); ohne ihn die Ableitung oben. */
    stand?: StandAuftraege | undefined;
    /** Die letzte Anweisung dieser Umgebung samt Zeitpunkt; mit ihr zählt eine eben geschaltete Pause sofort (WI-0163). */
    eigene?: EigeneAnweisung | undefined;
}

export interface Wartezeile {
    kind: string;
    state: string;
    waitReason: string | null;
    /** Die öffentliche Kennung: Über sie findet sich der Auftrag im Stand des Dirigenten. */
    publicId?: string | undefined;
}

/** Der Umstand einer Instanz, in der niemand etwas weiß: nichts pausiert, kein Planer, keine Abholart, nichts läuft. */
export const KEIN_UMSTAND: Warteumstand = {
    queuePaused: false,
    plannerActive: false,
    pickupKinds: new Set(),
    runningKinds: new Set(),
};

/**
 * Den Umstand aus der Datenbank lesen, für Lesewege, die ihn nicht schon haben (`abgleiche/lesen.ts`). Wirft nie: Jeder Teil hat
 * einen harmlosen Standardwert, denn ein fehlender Grund ist ein kleineres Übel als eine Antwort, die ausfällt.
 *
 * `plannerActive` kommt vom Aufrufer, weil nur er den Schlüssel der Planersperre kennt (Tests nehmen einen eigenen).
 */
export async function leseWarteumstand(
    db: Queryable,
    options: { plannerActive: boolean; pickupKinds: ReadonlySet<string> },
): Promise<Warteumstand> {
    const [pause, laufend] = await Promise.all([
        leseEigeneAnweisung(db),
        db<{ kind: string }[]>`SELECT DISTINCT kind FROM job WHERE state = 'RUNNING'`.catch(() => []),
    ]);
    return {
        queuePaused: pause.paused,
        plannerActive: options.plannerActive,
        pickupKinds: options.pickupKinds,
        runningKinds: new Set(laufend.map((row) => row.kind)),
        eigene: pause,
    };
}

/**
 * Der Umstand mit dem frischen Stand des Dirigenten (WI-0163): Die Pause ist dann die WIRKSAME über alle Umgebungen, und je eigenem
 * Auftrag gilt der Grund aus dem Stand. Ohne frischen Stand bleibt der Umstand, wie er ist.
 */
export function umstandMitStand(umstand: Warteumstand, lage: StandLage, umgebung: WarteschlangeUmgebung): Warteumstand {
    const stand = standAuftraege(lage, umgebung, umstand.eigene ?? null);
    return stand === undefined ? umstand : { ...umstand, queuePaused: stand.paused, stand };
}

export function wartegrund(zeile: Wartezeile, umstand: Warteumstand): string | null {
    if (zeile.state !== "QUEUED") return null;
    if (umstand.queuePaused) return "waits_queue_paused" satisfies WaitReason;
    const stand = umstand.stand;
    if (stand !== undefined) {
        const ausStand = zeile.publicId === undefined ? undefined : stand.gruende.get(zeile.publicId);
        return ausStand !== undefined ? ausStand : zeile.waitReason;
    }
    if (zeile.waitReason !== null) return zeile.waitReason;
    if (umstand.runningKinds.has(zeile.kind)) return "waits_running_kind" satisfies WaitReason;
    if (umstand.pickupKinds.has(zeile.kind)) return "waits_pickup" satisfies WaitReason;
    return umstand.plannerActive ? null : ("waits_no_worker" satisfies WaitReason);
}
