import { shallowRef } from "vue";
import type { WikiBoxArt } from "@avesmaps3d/shared";

/**
 * Was mit der Wiki-Box eines Objekts geschah, ohne dass die Box es selbst schrieb (WI-0265 B8d): Der Reiter „Änderungen“ nimmt das Zuweisen und Entfernen eines Wiki-Artikels über den Server zurück, eine
 * offene Box hält aber den Stand vom letzten Lesen und zeigte den zurückgenommenen Artikel weiter. Die Meldung ist das Gegenstück zu `inhalte/inhalte-melde.ts`, `fenster/traeger-quellen-melde.ts`,
 * `wegeditor/weg-melde.ts` und `landschaftseditor/landschaft-melde.ts`: Der Reiter meldet, was die Rücknahme berührte (`affected` ihrer Quittung), und jede Box, deren Objekt dabei ist, liest ihren Stand neu
 * und meldet dem Fenster `geaendert`, damit es das Objekt neu liest (die Revision des Objekts hat gezählt). Ein Entwurf des Fensters bleibt: Dann meldet die Box nichts, und das nächste „Speichern“ ist ein
 * gewöhnlicher Konflikt (`edit_conflict`).
 */
export interface WikiBoxMeldung {
    /** Die berührten Objekte: Art, wie die Quittung sie nennt (`place`, `path`, `territory`, `landscape`, `powerline`, `peak`), und öffentliche Kennung (beim Weg und bei der Kraftlinie jeder Abschnitt). */
    readonly betroffen: readonly { readonly kind: string; readonly id: string }[];
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

/** Die Art der Quittung zur Art der Box (die Landschaft heißt dort `region`). */
const BOX_ART: Readonly<Record<string, WikiBoxArt>> = {
    place: "ort",
    path: "weg",
    territory: "gebiet",
    landscape: "region",
    powerline: "kraftlinie",
    peak: "gipfel",
};

let zaehler = 0;
export const wikiBoxMeldung = shallowRef<WikiBoxMeldung | undefined>(undefined);

/** Meldet, was eine Rücknahme berührte: nur Objekte mit einer Box; nennt die Quittung keines, entsteht keine Meldung. */
export function meldeWikiBox(betroffen: readonly { readonly kind: string; readonly id: string }[]): void {
    const meine = betroffen.filter((eines) => Object.hasOwn(BOX_ART, eines.kind));
    if (meine.length === 0) return;
    zaehler += 1;
    wikiBoxMeldung.value = { betroffen: meine.map(({ kind, id }) => ({ kind, id })), nr: zaehler };
}

/** Ob die Meldung das Objekt einer Box betrifft. */
export const betrifftWikiBox = (meldung: WikiBoxMeldung, art: WikiBoxArt, id: string): boolean =>
    meldung.betroffen.some((eines) => BOX_ART[eines.kind] === art && eines.id === id);
