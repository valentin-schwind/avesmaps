import { shallowRef, watch, type WatchHandle } from "vue";
import type { InhalteTraegerQuellenArt } from "@avesmaps3d/shared";

/**
 * Was mit den Quellen eines Kartenobjekts geschah, ohne dass die Klappbox es selbst schrieb (WI-0265 B6g3): Der Reiter „Änderungen“ nimmt die Quellen eines Orts, Gebiets, einer Landschaft oder eines Wegs (eines Gipfels, sobald die Rücknahme ihn kennt)
 * über den Server zurück (und die Verwendungen einer Quelle, `source.update` mit `links`), eine offene Klappbox hält aber den Stand vom letzten Lesen und zeigte die zurückgenommenen Quellen weiter.
 * Die Meldung ist das Gegenstück zu `inhalte/inhalte-melde.ts` (Quelle, Werk, Vorkommen, Korpus), `wegeditor/weg-melde.ts` und `landschaftseditor/landschaft-melde.ts`: Der Reiter meldet, was die Rücknahme
 * berührte (`affected` ihrer Quittung), und jede Klappbox, deren Objekt dabei ist, liest ihre Quellen neu (`traeger-quellen.vue`). Was in einem Feld steht und noch nicht gespeichert ist, bleibt stehen.
 */
export interface TraegerQuellenMeldung {
    /** Die berührten Objekte: Art, wie die Quittung sie nennt (`place`, `territory`, `landscape`, `peak`, `path`), und öffentliche Kennung (beim Weg jeder Abschnitt der Straße). */
    readonly betroffen: readonly { readonly kind: string; readonly id: string }[];
    /** Jede Meldung ist neu, auch bei gleichem Inhalt. */
    readonly nr: number;
}

/** Die Arten in `affected` einer Quittung, deren Quellen eine Klappbox zeigt, und die Art der Klappbox dazu (die Landschaft heißt dort `area`). */
const KLAPPBOX_ART: Readonly<Record<string, InhalteTraegerQuellenArt>> = {
    place: "place",
    territory: "territory",
    landscape: "area",
    peak: "peak",
    path: "path",
};

let zaehler = 0;
export const traegerQuellenMeldung = shallowRef<TraegerQuellenMeldung | undefined>(undefined);

/** Meldet, was eine Rücknahme berührte: nur Objekte mit einer Klappbox; nennt die Quittung keines, entsteht keine Meldung. */
export function meldeTraegerQuellen(betroffen: readonly { readonly kind: string; readonly id: string }[]): void {
    const meine = betroffen.filter((eines) => Object.hasOwn(KLAPPBOX_ART, eines.kind));
    if (meine.length === 0) return;
    zaehler += 1;
    traegerQuellenMeldung.value = { betroffen: meine.map(({ kind, id }) => ({ kind, id })), nr: zaehler };
}

/** Ob die Meldung das Objekt einer Klappbox betrifft. */
export const betrifftKlappbox = (meldung: TraegerQuellenMeldung, kind: InhalteTraegerQuellenArt, id: string): boolean =>
    meldung.betroffen.some((eines) => KLAPPBOX_ART[eines.kind] === kind && eines.id === id);

/**
 * Die Klappbox eines Objekts liest ihre Quellen neu, sobald eine Meldung ihr Objekt nennt (`traeger-quellen.vue`). Gibt den Wächter zurück; er endet mit dem Bereich der Klappbox. `lesen` ist das Neulesen
 * der Steuerung (`neuLesen`): Was in einem Feld steht und noch nicht gespeichert ist, bleibt.
 */
export function liesNeuBeiMeldung(
    objekt: () => { readonly kind: InhalteTraegerQuellenArt; readonly id: string },
    lesen: () => unknown,
): WatchHandle {
    return watch(traegerQuellenMeldung, (meldung) => {
        const eigenes = objekt();
        if (meldung !== undefined && betrifftKlappbox(meldung, eigenes.kind, eigenes.id)) void lesen();
    });
}
