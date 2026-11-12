import {
    wirksamePause,
    type GemeinsameWarteschlange,
    type GemeinsamerAuftrag,
    type QueuePauseView,
    type WaitReason,
    type WarteschlangeAuftrag,
    type WarteschlangePause,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { bekannteArt } from "./ausloeser.ts";
import type { StandLage } from "./stand-datei.ts";
import { QUEUE_RUNNING, queuePauseView, readQueuePause, type QueuePause } from "./warteschlange-pause.ts";

/**
 * Die gemeinsame Reihe aus dem Stand des Dirigenten (WI-0163 §1.6, §1.7): EINE Stelle, die aus der Datei macht, was Statusseite,
 * Kurzstatus, Verwaltung und Abgleiche zeigen. Ohne Fastify, damit die Kommandozeile sie lädt.
 *
 * - **Die eigenen Aufträge** stehen wie bis heute mit Einzelheiten in den Listen der eigenen Tafel; hier tragen sie nur ihre Kennung,
 *   ihren Platz und ihren Grund aus dem Stand.
 * - 🔴 **Die der anderen Umgebung** stehen mit Umgebung, Art, Bezeichnung, Platz, Zustand und Grund da, **ohne Kennung**: Die ließe
 *   sich hier nicht auflösen. Vom Auslöser stehen die Art und bei einer Person ihr Anzeigename da, so wie der Dirigent ihn in der
 *   Umgebung des Auftrags gelesen hat (WI-0293; Betreiber 2026-11-09: „Ja, Namen zeigen“). Darf er ihn nicht lesen, steht „von einer
 *   Person“.
 * - 🔴 **Die Person einer Pause** wird nur in der Umgebung zum Namen, in der geschaltet wurde. Sonst steht dort die Umgebung
 *   (`anderswo`, „auf der Stage“).
 * - **Die wirksame Pause** ist die jüngste Anweisung über alle Umgebungen (`wirksamePause`). Der Stand trägt sie so, wie der Dirigent
 *   sie im letzten Takt sah; die eigene Zeile kann jünger sein (eben geschaltet, der nächste Takt steht noch aus). Deshalb gilt die
 *   jüngere von beiden: Wer gerade pausiert hat, sieht es sofort, und die Route vergleicht mit demselben Wert.
 */

/** Plant der Dirigent diese Umgebung? `undefined` ohne Stand-Datei: Dann fragt der Aufrufer die Planersperre wie bis WI-0163. */
export function dirigentPlant(lage: StandLage, umgebung: WarteschlangeUmgebung): boolean | undefined {
    if (lage.zustand === "nicht_eingerichtet") return undefined;
    if (lage.zustand !== "ok") return false;
    return lage.stand.umgebungen.some((quelle) => quelle.name === umgebung && quelle.planer);
}

/** Die letzte Anweisung DIESER Umgebung mit ihrem Zeitpunkt (`queue_changed_at`, Migration 0133). */
export interface EigeneAnweisung extends QueuePause {
    /** Wann hier zuletzt pausiert oder fortgesetzt wurde; `null`: nie (oder vor 0133). */
    changedAt: Date | null;
}

/**
 * Liest die eigene Anweisung; wirft nie. Fehlt die Spalte (eine Datenbank vor 0133), gilt die Pause wie bis WI-0163 ohne Zeitpunkt:
 * Sie zählt dann im Vergleich der Umgebungen nicht, wirkt aber hier weiter.
 */
export async function leseEigeneAnweisung(db: Queryable): Promise<EigeneAnweisung> {
    try {
        const [row] = await db<
            {
                queue_paused: boolean;
                queue_paused_since: Date | null;
                queue_paused_by: string | null;
                queue_paused_by_label: string | null;
                queue_paused_reason: string | null;
                queue_changed_at: Date | null;
            }[]
        >`
            SELECT queue_paused, queue_paused_since, queue_paused_by, queue_paused_by_label, queue_paused_reason, queue_changed_at
              FROM system_state
             WHERE id = 1
        `;
        if (row === undefined) return { ...QUEUE_RUNNING, changedAt: null };
        if (!row.queue_paused) return { ...QUEUE_RUNNING, changedAt: row.queue_changed_at };
        return {
            paused: true,
            since: row.queue_paused_since,
            by: row.queue_paused_by,
            byLabel: row.queue_paused_by_label,
            reason: row.queue_paused_reason,
            changedAt: row.queue_changed_at,
        };
    } catch {
        return { ...(await readQueuePause(db)), changedAt: null };
    }
}

/**
 * Die wirksame Pause: die jüngere aus dem Stand des Dirigenten und der eigenen Anweisung. `undefined` ohne frischen Stand, dann gilt
 * die eigene Zeile allein (wie bis WI-0163).
 */
export function wirksam(
    lage: StandLage,
    umgebung: WarteschlangeUmgebung,
    eigene: EigeneAnweisung | null,
): WarteschlangePause | undefined {
    if (lage.zustand !== "ok") return undefined;
    const ausStand = lage.stand.pause;
    const anweisungen: Parameters<typeof wirksamePause>[0][number][] = [];
    if (ausStand.umgebung !== null) anweisungen.push({ ...ausStand, umgebung: ausStand.umgebung });
    if (eigene !== null && eigene.changedAt !== null) {
        anweisungen.push({
            paused: eigene.paused,
            umgebung,
            changedAt: eigene.changedAt.toISOString(),
            since: eigene.since?.toISOString() ?? null,
            by: eigene.by,
            byLabel: eigene.byLabel,
            reason: eigene.reason,
        });
    }
    return wirksamePause(anweisungen);
}

/**
 * Der Grund eines Auftrags aus dem Stand. 🔴 Hängt er (WI-0179: der Ausführer weist ihn immer wieder gleich ab), heißt er
 * `waits_executor_stuck`, auch wenn der Dirigent `waits_executor` schreibt: Der Grund entsteht hier, beim LESEN, damit ein älterer
 * Leser des Stands nichts Unbekanntes bekommt. Jede Ansicht, die Gründe aus dem Stand nimmt, geht über diese Funktion.
 */
export function grundAusStand(auftrag: WarteschlangeAuftrag): string | null {
    return auftrag.haengt !== undefined && auftrag.state === "QUEUED"
        ? ("waits_executor_stuck" satisfies WaitReason)
        : auftrag.wartegrund;
}

/** Die eigenen Aufträge im frischen Stand: Grund und Platz je öffentlicher Kennung. Ohne frischen Stand `undefined`. */
export interface StandAuftraege {
    /** Der Grund des Dirigenten; `null` heißt: keiner (er läuft oder ist als Nächstes dran). */
    gruende: ReadonlyMap<string, string | null>;
    /** Der Platz in der gemeinsamen Reihe; `null` bei laufenden. */
    plaetze: ReadonlyMap<string, number | null>;
    /** Wirkt die gemeinsame Pause? */
    paused: boolean;
}

export function standAuftraege(
    lage: StandLage,
    umgebung: WarteschlangeUmgebung,
    eigene: EigeneAnweisung | null = null,
): StandAuftraege | undefined {
    if (lage.zustand !== "ok") return undefined;
    const eigeneAuftraege = lage.stand.auftraege.filter((auftrag) => auftrag.umgebung === umgebung);
    return {
        gruende: new Map(eigeneAuftraege.map((auftrag) => [auftrag.publicId, grundAusStand(auftrag)])),
        plaetze: new Map(eigeneAuftraege.map((auftrag) => [auftrag.publicId, auftrag.platz])),
        paused: wirksam(lage, umgebung, eigene)?.paused ?? lage.stand.pause.paused,
    };
}

/**
 * Die Pause, wie Statusseite und Verwaltung sie zeigen. Mit frischem Stand die WIRKSAME (die jüngste Anweisung über alle Umgebungen),
 * sonst die eigene Zeile wie bis WI-0163. Der Grund nur in der vollen Sicht (`full`), wie bisher.
 */
export async function pauseAnsicht(
    db: Queryable,
    lage: StandLage,
    umgebung: WarteschlangeUmgebung,
    eigene: EigeneAnweisung,
    options: { full: boolean },
): Promise<QueuePauseView> {
    const pause = wirksam(lage, umgebung, eigene);
    if (pause === undefined) return queuePauseView(db, eigene, options);
    if (!pause.paused) return { paused: false, since: null, by: null, reason: null, anderswo: null };
    if (pause.umgebung !== null && pause.umgebung !== umgebung) {
        // 🔴 Die Person der anderen Umgebung bleibt dort; hier steht, WO pausiert wurde.
        return {
            paused: true,
            since: pause.since,
            by: null,
            reason: options.full ? pause.reason : null,
            anderswo: pause.umgebung,
        };
    }
    // Hier geschaltet: derselbe Weg wie bisher, mit dem Namen aus dieser Umgebung.
    const hier = await queuePauseView(
        db,
        {
            paused: true,
            since: pause.since === null ? null : new Date(pause.since),
            by: pause.by,
            byLabel: pause.byLabel,
            reason: pause.reason,
        },
        options,
    );
    return { ...hier, anderswo: null };
}

function auftragAusStand(
    auftrag: WarteschlangeAuftrag,
    umgebung: WarteschlangeUmgebung,
    paused: boolean,
): GemeinsamerAuftrag {
    const eigen = auftrag.umgebung === umgebung;
    const wartet = auftrag.state === "QUEUED";
    // Die Art und bei einer Person ihr Name (WI-0293); ohne Angabe im Stand (älterer Dirigent) fehlt das Feld.
    const art = bekannteArt(auftrag.ausloeser);
    const name = art === "person" ? (auftrag.ausloeserName ?? null) : null;
    return {
        umgebung: auftrag.umgebung,
        eigen,
        jobId: eigen ? auftrag.publicId : null,
        kind: auftrag.kind,
        label: auftrag.label,
        state: auftrag.state,
        platz: wartet ? auftrag.platz : null,
        phase: auftrag.phase,
        progress: auftrag.progress,
        // Die Pause übersteuert jeden Grund (WI-0160): „wartet auf Speicher“ wäre im pausierten Zustand eine Lüge.
        waitReason: !wartet ? null : paused ? ("waits_queue_paused" satisfies WaitReason) : grundAusStand(auftrag),
        queuedAt: auftrag.queuedAt,
        startedAt: auftrag.startedAt,
        ...(art === undefined ? {} : { ausgeloest: { art, name } }),
        ...(auftrag.notBefore === undefined ? {} : { notBefore: auftrag.notBefore }),
    };
}

/**
 * Die gemeinsame Warteschlange für eine Antwort; `undefined` ohne Stand-Datei (dann fehlt das Feld, wie bis WI-0163). Ohne frischen
 * Stand steht der Zustand da, keine Pause und keine Reihe: „Zustand unbekannt“.
 *
 * `nurEigene` ist die eigene Sicht eines Editors (WI-0120 A11): nur seine Aufträge, über die öffentlichen Kennungen.
 */
export function gemeinsameWarteschlange(
    lage: StandLage,
    umgebung: WarteschlangeUmgebung,
    pause: QueuePauseView | null,
    options: { nurEigene?: ReadonlySet<string> } = {},
): GemeinsameWarteschlange | undefined {
    if (lage.zustand === "nicht_eingerichtet") return undefined;
    if (lage.zustand !== "ok") {
        return { zustand: lage.zustand, umgebung, stand: lage.stand?.at ?? null, pause: null, reihe: [] };
    }
    const paused = pause?.paused ?? lage.stand.pause.paused;
    const reihe = lage.stand.auftraege.map((auftrag) => auftragAusStand(auftrag, umgebung, paused));
    const nurEigene = options.nurEigene;
    return {
        zustand: "ok",
        umgebung,
        stand: lage.stand.at,
        pause,
        reihe:
            nurEigene === undefined
                ? reihe
                : reihe.filter((auftrag) => auftrag.jobId !== null && nurEigene.has(auftrag.jobId)),
    };
}

/** Laufende und wartende Aufträge der gemeinsamen Reihe für den Kurzstatus; ohne frischen Stand `null` („unbekannt“). */
export function reiheZaehlen(lage: StandLage): { running: number; queued: number } | null {
    if (lage.zustand !== "ok") return null;
    const running = lage.stand.auftraege.filter((auftrag) => auftrag.state === "RUNNING").length;
    return { running, queued: lage.stand.auftraege.length - running };
}
