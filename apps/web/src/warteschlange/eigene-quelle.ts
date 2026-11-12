import { computed, type ComputedRef } from "vue";
import { createStatusStore, type StatusStore } from "../status/status-store";
import {
    eigeneAuftraege,
    neuesGedaechtnis,
    quittiere,
    type EigenerAuftrag,
    type Gedaechtnis,
} from "./eigene-auftraege";

/**
 * Der eine Abruf der eigenen Aufträge für alle, die sie zeigen (WI-0230): die Warteschlange im Kopf und das „wird berechnet“ im Fenster
 * eines Objekts. Derselbe Zustand wie die Statusseite (`createStatusStore`: HTTP ist die Wahrheit, `/ws` nur der Weckruf, ohne `/ws`
 * alle paar Sekunden, verborgen gar nicht), nur mit `?eigene=true`: Auch ein Admin sieht hier nur, was er selbst ausgelöst hat.
 *
 * Wer liest, meldet sich an (`beziehe`) und wieder ab; der Abruf läuft, solange einer liest. Unangemeldete fragen nie: Die Kopfleiste
 * bindet die Leiste nur mit Person ein, und die Route antwortet ohne Anmeldung 401.
 */
export interface EigeneQuelle {
    liste: ComputedRef<EigenerAuftrag[]>;
    /** „Jetzt“ in Serverzeit, jede Sekunde neu (für die Restzeit). */
    nowMs: ComputedRef<number>;
    /** Die Warteschlange wurde geöffnet: Fehlschläge gelten als gesehen. */
    quittieren(): void;
}

let store: StatusStore | null = null;
let gedaechtnis: Gedaechtnis = neuesGedaechtnis();
let leser = 0;
let quelle: EigeneQuelle | null = null;

const eigeneFetch = async (path: string): Promise<{ status: number; body: unknown }> => {
    const ziel = path === "/api/jobs/overview" ? `${path}?eigene=true` : path;
    const response = await fetch(ziel, { headers: { accept: "application/json" }, cache: "no-store" });
    try {
        return { status: response.status, body: (await response.json()) as unknown };
    } catch {
        return { status: response.status, body: null };
    }
};

function zustand(): StatusStore {
    store ??= createStatusStore({ fetchJson: eigeneFetch });
    return store;
}

/** Meldet einen Leser an; zurück kommen die Quelle und das Abmelden. */
export function beziehe(): { quelle: EigeneQuelle; abmelden(): void } {
    const s = zustand();
    leser += 1;
    if (leser === 1) s.start();
    quelle ??= {
        liste: computed(() =>
            s.queueFailure.value === null ? eigeneAuftraege(s.overview.value, s.nowMs.value, gedaechtnis) : [],
        ),
        nowMs: computed(() => s.nowMs.value),
        quittieren: () => quittiere(quelle?.liste.value ?? [], gedaechtnis),
    };
    let ab = false;
    return {
        quelle,
        abmelden: () => {
            if (ab) return;
            ab = true;
            leser -= 1;
            if (leser === 0) s.stop();
        },
    };
}

/** Nur für Tests: alles auf Anfang. */
export function setzeQuelleZurueck(): void {
    store?.stop();
    store = null;
    quelle = null;
    leser = 0;
    gedaechtnis = neuesGedaechtnis();
}
