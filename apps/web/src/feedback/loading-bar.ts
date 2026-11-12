import { reactive } from "vue";

/**
 * Legacys Ladebalken (`js/app/loading-bar.js`, `css/features/loading-bar.css`): ein schmaler
 * Streifen oben am Fenster, solange etwas lädt - hier die Rechnung der Route (MCS-020, D2).
 *
 * - **Erst nach 160 ms**, damit eine schnelle Antwort nicht blinkt; einmal sichtbar, bleibt er
 *   **mindestens 450 ms** stehen, sonst zuckt er nur.
 * - Er **kriecht** auf 90 % zu, ohne je anzukommen (alle 240 ms ein Stück), und läuft am Ende auf
 *   100 %, bevor er ausblendet. Er zeigt, dass etwas geschieht, nicht wie viel.
 * - Mehrere Aufträge teilen sich einen Balken: er geht, wenn der letzte fertig ist.
 */

export const LOADING_SHOW_DELAY_MS = 160;
export const LOADING_MIN_VISIBLE_MS = 450;
const TRICKLE_MS = 240;
const FINISH_MS = 360;

export const loadingBar = reactive({
    visible: false,
    /** 0 bis 1. */
    progress: 0,
    /** Der Rücksprung auf 0 nach dem Ausblenden läuft ohne Übergang - sonst liefe der Balken rückwärts. */
    resetting: false,
});

const pending = new Set<symbol>();
let shownAt = 0;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let trickleTimer: ReturnType<typeof setInterval> | undefined;
let completeTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function trickle(): void {
    if (loadingBar.progress < 0.9) loadingBar.progress += (0.9 - loadingBar.progress) * 0.08 + 0.004;
}

function show(): void {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    if (loadingBar.visible) return;
    loadingBar.visible = true;
    loadingBar.resetting = false;
    shownAt = Date.now();
    loadingBar.progress = Math.max(loadingBar.progress, 0.08);
    trickleTimer ??= setInterval(trickle, TRICKLE_MS);
}

function finish(): void {
    clearInterval(trickleTimer);
    trickleTimer = undefined;
    loadingBar.progress = 1;
    hideTimer = setTimeout(() => {
        loadingBar.visible = false;
        loadingBar.resetting = true;
        loadingBar.progress = 0;
    }, FINISH_MS);
}

function refresh(): void {
    if (pending.size > 0) {
        clearTimeout(completeTimer);
        completeTimer = undefined;
        if (loadingBar.visible || showTimer) return;
        showTimer = setTimeout(() => {
            showTimer = undefined;
            if (pending.size > 0) show();
        }, LOADING_SHOW_DELAY_MS);
        return;
    }
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!loadingBar.visible || completeTimer) return;
    const remaining = LOADING_MIN_VISIBLE_MS - (Date.now() - shownAt);
    if (remaining <= 0) return finish();
    completeTimer = setTimeout(() => {
        completeTimer = undefined;
        finish();
    }, remaining);
}

/** Ein Auftrag beginnt. Die zurückgegebene Funktion meldet ihn fertig; ein zweiter Aufruf tut nichts. */
export function startLoading(): () => void {
    const key = Symbol("laden");
    pending.add(key);
    refresh();
    return () => {
        if (pending.delete(key)) refresh();
    };
}
