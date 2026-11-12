import { shallowRef } from "vue";

/**
 * Der Toast (Design Guide §15.1): EINE Meldung zur Zeit, unten mittig, und sie verschwindet von selbst.
 *
 * ⭐ Kein Grün, kein Rot, kein Symbol - drei Nuancen desselben warmen Tons. Ein Toast meldet, dass
 * etwas geschehen ist; der Satz selbst sagt, was.
 *
 * 🪤 Die Meldungen des Routenplaners stehen 5 s (Legacy, Owner 14.09.2026: „ein Toast, kein alert()",
 * „5 s statt 2,2 s"). Zwei Meldungen derselben Handlung werden mit „ · " aneinandergereiht, solange die
 * erste noch steht - dieselbe wird nicht doppelt angehängt (Legacy `showRouteNotice`).
 *
 * 🔗 Eine Meldung mit Link (der Kurzlink, WI-0034) trägt ihn greifbar: Er lässt sich markieren und per
 * langem Druck kopieren, die Meldung steht 12 s und geht nicht, solange Zeiger oder Fokus auf dem Link
 * liegen (Betreiber 2026-09-24: „kanns nicht rauskopieren“). Wer einen Link mitnehmen soll, braucht
 * länger als zum Lesen - Legacy ließ ihn nach 2,2 s verschwinden.
 */

export type ToastTone = "normal" | "success" | "warning";

/** Ein Knopf in der Meldung (der Screenshot, WI-0274: „Ansehen“, „Speichern unter …“). */
export interface ToastAktion {
    text: string;
    tun: () => void;
    /** Die eine Hauptaktion der Meldung. */
    haupt?: boolean;
}

export interface ToastMessage {
    id: number;
    text: string;
    tone: ToastTone;
    /** Ein Link im Text, den man greifen können muss. */
    link?: string;
    /** Ein Bild links in der Meldung; ein Klick darauf tut, was die erste Aktion tut. */
    bild?: { url: string; alt: string };
    /** Knöpfe: Dann nimmt die Meldung Klicks an und steht wie eine mit Link. */
    aktionen?: readonly ToastAktion[];
}

export const ROUTE_NOTICE_MS = 5000;
export const LINK_NOTICE_MS = 12000;

export const currentToast = shallowRef<ToastMessage | null>(null);

let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;

function hideAfter(durationMs: number): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
        currentToast.value = null;
    }, durationMs);
}

export function showToast(text: string, tone: ToastTone = "normal", durationMs = ROUTE_NOTICE_MS): void {
    const shown = currentToast.value;
    if (shown && shown.tone === tone && shown.link === undefined && shown.aktionen === undefined) {
        // Dieselbe Meldung nicht doppelt; eine neue hinten an - ohne dass der Toast neu aufsteigt.
        const parts = shown.text.split(" · ");
        currentToast.value = { ...shown, text: parts.includes(text) ? shown.text : `${shown.text} · ${text}` };
    } else {
        currentToast.value = { id: nextId++, text, tone };
    }
    hideAfter(durationMs);
}

/** Eine Meldung mit Link: Sie ersetzt, was steht - an einen Link wird nichts angehängt. */
export function showLinkToast(text: string, link: string, tone: ToastTone = "normal"): void {
    currentToast.value = { id: nextId++, text, tone, link };
    hideAfter(LINK_NOTICE_MS);
}

/** Eine Meldung mit Knöpfen und wahlweise Bild: Sie ersetzt, was steht, und bleibt so lange wie eine mit Link. */
export function showAktionToast(
    text: string,
    zusatz: { bild?: NonNullable<ToastMessage["bild"]>; aktionen: readonly ToastAktion[] },
    tone: ToastTone = "normal",
): void {
    currentToast.value = { id: nextId++, text, tone, ...zusatz };
    hideAfter(LINK_NOTICE_MS);
}

/** Zeiger oder Fokus auf dem Link oder den Knöpfen: Die Meldung bleibt stehen. */
export function holdToast(): void {
    clearTimeout(timer);
}

/** Zeiger oder Fokus gehen: noch einmal die volle Zeit, um den Link einzufügen oder zurückzukommen. */
export function releaseToast(): void {
    const toast = currentToast.value;
    if (toast?.link !== undefined || toast?.aktionen !== undefined) hideAfter(LINK_NOTICE_MS);
}

export function hideToast(): void {
    clearTimeout(timer);
    currentToast.value = null;
}
