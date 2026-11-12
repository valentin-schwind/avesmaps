import { ref, type Ref } from "vue";
import { SHARE_CODE_PATTERN, type ShareCreated, type SharePayload, type ShareResolved } from "@avesmaps3d/shared";
import type { ToastTone } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { melde } from "../besuch/besuch-melden";
import type { Planner } from "./use-planner";

/**
 * Der Kurzlink `?s=<code>` im Browser (WI-0034, Legacy `js/app/share-link.js`).
 *
 * - **Teilen:** 🔗 legt den Zustand an und `…/?s=<code>` in die Zwischenablage. Die Meldung sagt,
 *   was geschah, mit Legacys Wortlaut - und trägt den Link greifbar, auch wenn die Zwischenablage nicht
 *   mitspielt (Betreiber 2026-09-24: „kanns nicht rauskopieren“).
 * - 🪤 **Die Zwischenablage wird im Klick angestoßen,** nicht erst nach dem POST: Safari und Firefox
 *   erlauben das Schreiben nur in der Nutzergeste, und die ist nach dem awaited POST verbraucht. Der
 *   Link folgt als Promise (`copyToClipboard`). Legacy schrieb erst danach.
 * - **Öffnen:** Die Reise kommt aus dem Speicher und wird eingepasst. Danach schreibt der Planer die
 *   lesbare Form in die Adresse, `s` verschwindet (es ist ein Parameter des Planers).
 * - 🔴 **Nie still etwas anderes** (Kap. 9.57): Ein unbekannter Code und ein Ort, den es nicht mehr
 *   gibt, werden gemeldet, der Code mit Namen - ein Tippfehler fällt so auf. Legacy verwarf einen
 *   unbekannten Code wortlos.
 */

/**
 * Was die Karte zeigt - reist mit, der Ausschnitt nicht (wie Legacy): Serie, Ansicht, Ebene und seit WI-0072 die
 * Unterwahl der Topographie (`topo`) und die Schalter des Auge-Menüs, die von der Vorgabe abweichen (`display`).
 */
export type ShareView = SharePayload["view"];

export interface ShareLinkEffects {
    planner: Planner;
    currentView(): ShareView;
    /** Serie, Ansicht, Ebene und Schalter aus einem geteilten Link setzen; was der Betrachter nicht wählen darf, bleibt. */
    applyView(view: ShareView): void;
    /** Eine Meldung; mit `link` steht der Link darin greifbar. */
    notify(text: string, tone: ToastTone, link?: string): void;
    /** Die Seite ohne Query und Hash; der Kurzlink hängt `?s=<code>` an. */
    pageUrl(): string;
    /** In die Zwischenablage - aufgerufen noch im Klick, der Text folgt, sobald der Link feststeht. */
    copy(text: Promise<string>): Promise<boolean>;
    /** Ein unbekannter Code verschwindet aus der Adresse, damit ein Neuladen nicht dieselbe Meldung bringt. */
    dropCode(): void;
}

export interface ShareLink {
    sharing: Ref<boolean>;
    share(): Promise<void>;
    open(code: string): Promise<void>;
}

const CODE = new RegExp(SHARE_CODE_PATTERN);

/** Der Code aus `?s=`, so wie er dasteht; ob er taugt, entscheidet `open`. */
export function readShareCode(search: string): string | null {
    const code = new URLSearchParams(search).get("s");
    return code === null || code.trim() === "" ? null : code.trim();
}

/**
 * In die Zwischenablage, angestoßen im Klick, auch wenn der Text erst später feststeht. `false`, wo der
 * Browser es nicht erlaubt oder kein Text kommt.
 *
 * 1. `clipboard.write` mit einem `ClipboardItem`, dessen Inhalt ein Promise ist: Der Browser hält die
 *    Nutzergeste fest und schreibt, sobald der Link da ist. Safari verlangt das, Firefox und Chrome können es.
 * 2. Sonst `writeText`, sobald der Text da ist (Chrome hält die Geste einige Sekunden).
 * 3. Sonst Legacys Weg (`fallbackCopyTextToClipboard`): ein markiertes Textfeld und `execCommand("copy")` -
 *    der geht auch ohne sichere Verbindung, etwa am Telefon über die Adresse des Rechners im Heimnetz.
 */
export async function copyToClipboard(text: Promise<string>): Promise<boolean> {
    const clipboard = globalThis.navigator?.clipboard;
    if (typeof clipboard?.write === "function" && typeof ClipboardItem === "function") {
        try {
            const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
            await clipboard.write([new ClipboardItem({ "text/plain": blob })]);
            return true;
        } catch {
            // weiter mit dem Text selbst
        }
    }
    let value: string;
    try {
        value = await text;
    } catch {
        return false;
    }
    if (typeof clipboard?.writeText === "function") {
        try {
            await clipboard.writeText(value);
            return true;
        } catch {
            // weiter mit Legacys Weg
        }
    }
    return copyBySelection(value);
}

function copyBySelection(value: string): boolean {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
    const focused = document.activeElement;
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        field.remove();
        // Der Fokus kehrt zum 🔗 zurück, wer mit der Tastatur kam, steht wieder dort.
        if (focused instanceof HTMLElement) focused.focus();
    }
}

/** Der Link, der erst nach dem POST feststeht - abgewiesen, wenn keiner kommt. */
function pendingLink(): { promise: Promise<string>; resolve(url: string): void; reject(): void } {
    let resolve: (url: string) => void = () => undefined;
    let reject: (reason: Error) => void = () => undefined;
    const promise = new Promise<string>((ok, fail) => {
        resolve = ok;
        reject = fail;
    });
    // Kein Link ist ein erwarteter Ausgang (die Meldung sagt, warum), keine unbehandelte Ablehnung.
    promise.catch(() => undefined);
    return { promise, resolve, reject: () => reject(new Error("kein Kurzlink")) };
}

/** Ein Code aus der Adresse, gekürzt, falls jemand dort einen Roman abgelegt hat. */
function codeForMessage(code: string): string {
    return code.length > 24 ? `${code.slice(0, 24)}…` : code;
}

export function useShareLink(effects: ShareLinkEffects): ShareLink {
    const sharing = ref(false);

    async function share(): Promise<void> {
        if (sharing.value) return;
        const state = effects.planner.shareState();
        if (!state) {
            effects.notify(t("share.nothingToShare"), "normal");
            return;
        }
        sharing.value = true;
        // Noch im Klick: Die Zwischenablage wartet auf den Link (siehe oben).
        const link = pendingLink();
        const copied = effects.copy(link.promise);
        try {
            const payload: SharePayload = { v: 1, ...state, view: effects.currentView() };
            melde("share_create");
            const response = await fetch("/api/share", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (response.status === 429) {
                effects.notify(t("share.rateLimited"), "warning");
                return;
            }
            if (!response.ok) {
                effects.notify(t("share.createFailed"), "warning");
                return;
            }
            const { code } = (await response.json()) as ShareCreated;
            const url = `${effects.pageUrl()}?s=${code}`;
            link.resolve(url);
            const done = await copied;
            effects.notify(t(done ? "share.copied" : "share.copyFailed", { url }), done ? "success" : "warning", url);
        } catch {
            effects.notify(t("share.createFailed"), "warning");
        } finally {
            // Kam kein Link, gibt das die Zwischenablage frei; nach resolve ändert es nichts.
            link.reject();
            sharing.value = false;
        }
    }

    async function open(code: string): Promise<void> {
        const unknown = (): void => {
            effects.notify(t("share.unknown", { code: codeForMessage(code) }), "warning");
            effects.dropCode();
        };
        if (!CODE.test(code)) {
            unknown();
            return;
        }
        let response: Response;
        try {
            response = await fetch(`/api/share/${encodeURIComponent(code)}`);
        } catch {
            // Das Netz fehlt, nicht der Code: `s` bleibt stehen, ein Neuladen versucht es wieder.
            effects.notify(t("share.loadFailed"), "warning");
            return;
        }
        if (response.status === 404) {
            unknown();
            return;
        }
        if (!response.ok) {
            effects.notify(t("share.loadFailed"), "warning");
            return;
        }
        const shared = (await response.json()) as ShareResolved;
        effects.applyView(shared.payload.view);
        await effects.planner.restoreShared(shared, true);
    }

    return { sharing, share, open };
}
