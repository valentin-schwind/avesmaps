import { shallowRef } from "vue";
import { ApiFailure } from "./api";

/**
 * Kurz bestätigen (WI-0120 A9, AUTH-0001 §6.8, §11.2): Verlangt eine Anfrage einen zweiten Faktor (`assurance_required`) oder eine
 * Bestätigung im Moment (`reauth_required`), fragt die Oberfläche nach und wiederholt die Anfrage danach einmal, mit derselben
 * Kennung (ADR-0019). Bestätigt wird mit Passkey oder über Discord; der Umweg über Discord verlässt die Seite, die Handlung
 * startet danach neu.
 *
 * 🔴 **Eine gemeinsame Bestätigung** (Hotfix 2026-10-10, Handover `2026-10-10-verwaltung-bestaetigung-beim-laden.md`): Beim
 * Öffnen lädt die Verwaltung mehrere Listen gleichzeitig, und jede kann abgelehnt werden. Solange ein Fenster offen ist, wartet
 * jede weitere Anfrage auf DASSELBE Fenster, statt ein eigenes zu öffnen; bestätigt, laden alle neu, abgebrochen, enden alle.
 * Verlangt eine spätere Anfrage mehr (Passkey statt Bestätigung), fragt das offene Fenster gleich danach.
 */
export type Need = "confirmation" | "passkey" | "second_factor";

/** Was eine Bestätigung abdeckt: Ein Passkey bestätigt auch und hebt die Sitzung auf den zweiten Faktor (`confirmSession`). */
const STRENGTH: Readonly<Record<Need, number>> = { confirmation: 0, second_factor: 1, passkey: 2 };

export interface PendingConfirmation {
    need: Need;
    resolve(confirmed: boolean): void;
}

export const pendingConfirmation = shallowRef<PendingConfirmation | null>(null);

/** Das offene Fenster als Versprechen: Wer fragt, solange es offen ist, bekommt dieses. */
let shared: Promise<boolean> | null = null;
/** Die gelungenen Bestätigungen, gezählt, und was die letzte abdeckt. */
let confirmed: { count: number; need: Need } = { count: 0, need: "confirmation" };

/**
 * Öffnet das Fenster „Kurz bestätigen“; `true`, wenn bestätigt, `false`, wenn abgebrochen. Ist schon eines offen, wartet die Frage
 * auf dieses (dasselbe Versprechen) und hebt es höchstens auf den strengeren Bedarf.
 */
export function requestConfirmation(need: Need): Promise<boolean> {
    const open = pendingConfirmation.value;
    if (open !== null && shared !== null) {
        if (STRENGTH[need] > STRENGTH[open.need]) pendingConfirmation.value = { ...open, need };
        return shared;
    }
    const promise = new Promise<boolean>((resolve) => {
        pendingConfirmation.value = {
            need,
            resolve: (yes) => {
                const answered = pendingConfirmation.value;
                if (answered === null || shared !== promise) return;
                if (yes) confirmed = { count: confirmed.count + 1, need: answered.need };
                pendingConfirmation.value = null;
                shared = null;
                resolve(yes);
            },
        };
    });
    shared = promise;
    return promise;
}

/** Was eine Ablehnung verlangt, oder `null`, wenn sie keine Bestätigung ist. */
export function neededConfirmation(error: unknown): Need | null {
    if (!(error instanceof ApiFailure)) return null;
    if (error.code !== "reauth_required" && error.code !== "assurance_required") return null;
    const need = error.details?.["need"];
    // Das bisherige Passwort fehlt: kein Fall für das Fenster, sondern für das Feld im Formular.
    if (need === "current_password") return null;
    if (need === "passkey" || need === "second_factor" || need === "confirmation") return need;
    return error.code === "assurance_required" ? "second_factor" : "confirmation";
}

/**
 * Führt `action` aus; verlangt der Server eine Bestätigung, fragt nach und versucht es danach genau einmal neu. Abgebrochen:
 * der ursprüngliche Fehler.
 *
 * 🪤 Kam die Ablehnung zu einer Anfrage, die VOR einer inzwischen gelungenen Bestätigung abging (parallele Ladevorgänge: die
 * Antwort war unterwegs, als die Person bestätigte), wird ohne neues Fenster einmal wiederholt.
 */
export async function withConfirmation<T>(
    action: () => Promise<T>,
    ask: (need: Need) => Promise<boolean> = requestConfirmation,
): Promise<T> {
    const before = confirmed.count;
    try {
        return await action();
    } catch (error) {
        const need = neededConfirmation(error);
        if (need === null) throw error;
        const meanwhile = confirmed.count !== before && STRENGTH[confirmed.need] >= STRENGTH[need];
        if (!meanwhile && !(await ask(need))) throw error;
        return action();
    }
}

/**
 * Die Bestätigung der Lesewege eines Fensters (Hotfix 2026-10-10): Lädt die Verwaltung, und der Server verlangt den zweiten Faktor,
 * fragt sie über das gemeinsame Fenster. 🔴 **Bricht die Person ab, fragt kein Leseweg von selbst wieder**, auch nicht das
 * Neuladen nach einer Handlung oder das Nachsehen des Betriebszustands. Die Bereiche sagen dann in einer Zeile, was fehlt, und ein
 * Knopf bietet es erneut an (`offer`): Dann lädt neu, wer sich angemeldet hat (`onOffer`), und das Fenster geht wieder auf, einmal
 * für alle.
 */
export interface ReadConfirmation {
    /** Für `withConfirmation`: fragt, solange niemand abgebrochen hat; danach `false`, ohne Fenster. */
    ask(need: Need): Promise<boolean>;
    /** Ein Abbruch, auch der einer Handlung: Das Neuladen danach fragt nicht gleich wieder. */
    decline(): void;
    /** Der Knopf in der Zeile: wieder fragen dürfen und neu laden, was auf die Bestätigung wartet. */
    offer(): void;
    /** Wer neu lädt, wenn `offer` kommt. */
    onOffer(reload: () => unknown): void;
}

export function createReadConfirmation(ask: (need: Need) => Promise<boolean> = requestConfirmation): ReadConfirmation {
    let declined = false;
    const reloads: (() => unknown)[] = [];
    return {
        async ask(need) {
            if (declined) return false;
            const yes = await ask(need);
            if (!yes) declined = true;
            return yes;
        },
        decline(): void {
            declined = true;
        },
        offer(): void {
            declined = false;
            for (const reload of reloads) void reload();
        },
        onOffer(reload): void {
            reloads.push(reload);
        },
    };
}
