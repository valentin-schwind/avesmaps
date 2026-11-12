import { shallowRef, type ShallowRef } from "vue";
import type { MapHistoryObjectKind } from "@avesmaps3d/shared";

/**
 * Der Sprung zwischen den „Änderungen“ und dem Verlauf eines Objekts (WI-0265 B5a; Probierseite Szene 5): Von dort, wo man steht, zu der
 * Stelle, an der DIESELBE Operation (dieselbe `operationId`) ausgewählt ist. Beide Seiten sind eigene Bauteile, die sich nicht kennen
 * (der Reiter im Editorpanel, der Verlauf in einem Editorfenster); sie verabreden sich über diese kleine Ablage.
 *
 * - **Ein Sprung ist ein Wunsch mit Verfallszeit.** Wer springt, legt ihn ab und öffnet das Ziel; das Ziel liest ihn, sobald es da ist, und
 *   räumt ihn weg. Kommt das Ziel nie (das Fenster hat keinen Verlauf), verfällt er, statt später in einem fremden Fenster zu wirken.
 * - **Reiterwunsch:** Ein Editorfenster öffnet auf seinen Eigenschaften. Damit der Verlauf auch zu sehen ist, legt der Sprung zugleich
 *   den Wunsch ab, im Fenster dieses Werkzeugs den Reiter „Verlauf“ zu wählen (`fenster-reiter.vue` liest ihn).
 */

/** So lange gilt ein Sprung, bis sein Ziel ihn aufnimmt (Millisekunden). */
export const SPRUNG_GILT_MS = 20_000;

export interface Sprung {
    readonly operationId: string;
    /** Der Gegenstand, dessen Verlauf gemeint ist (für den Filter „Objekt“ in den Änderungen). */
    readonly objekt?: { readonly kind: MapHistoryObjectKind; readonly id: string; readonly name?: string | undefined };
    /** Wann er abgelegt wurde (`Date.now()`). */
    readonly seit: number;
}

/** Der Sprung in den Reiter „Änderungen“: eine Operation zeigen (`operationId`), oder nur die Liste auf eine Person filtern (`person`, WI-0276, Editorenliste). */
export interface SprungZuAenderungen {
    readonly operationId?: string;
    readonly objekt?: Sprung["objekt"];
    /** Die Kennung der Person (`actor.id`). */
    readonly person?: string;
    readonly seit: number;
}

export interface ReiterWunsch {
    /** Das Werkzeug, dessen Fenster den Reiter wählt (`landschaftseditor`); sein Fenster heißt `<werkzeug>-<nummer>`. */
    readonly werkzeug: string;
    readonly reiter: string;
    readonly seit: number;
}

const zumObjektverlauf: ShallowRef<Sprung | undefined> = shallowRef(undefined);
const zuAenderungen: ShallowRef<SprungZuAenderungen | undefined> = shallowRef(undefined);
const reiterWunsch: ShallowRef<ReiterWunsch | undefined> = shallowRef(undefined);

export const sprungZumObjektverlauf: Readonly<ShallowRef<Sprung | undefined>> = zumObjektverlauf;
export const sprungZuAenderungen: Readonly<ShallowRef<SprungZuAenderungen | undefined>> = zuAenderungen;
export const sprungReiterWunsch: Readonly<ShallowRef<ReiterWunsch | undefined>> = reiterWunsch;

export const gilt = (seit: number, jetzt: number = Date.now()): boolean => jetzt - seit <= SPRUNG_GILT_MS;

/** „Im Objektverlauf zeigen“: legt den Sprung ab; das Öffnen des Werkzeugs besorgt der Aufrufer. */
export function springeZumObjektverlauf(sprung: Omit<Sprung, "seit">, werkzeug?: string): void {
    const seit = Date.now();
    zumObjektverlauf.value = { ...sprung, seit };
    reiterWunsch.value = werkzeug === undefined ? undefined : { werkzeug, reiter: "verlauf", seit };
}

/** „In Änderungen zeigen“: legt den Sprung ab; der Reiter im Editorpanel wählt und markiert die Operation. */
export function springeZuAenderungen(sprung: Omit<SprungZuAenderungen, "seit">): void {
    zuAenderungen.value = { ...sprung, seit: Date.now() };
}

/** Nimmt den Sprung zum Objektverlauf auf, wenn er noch gilt (und räumt ihn weg). */
export function nimmZumObjektverlauf(): Sprung | undefined {
    const sprung = zumObjektverlauf.value;
    if (sprung === undefined) return undefined;
    zumObjektverlauf.value = undefined;
    reiterWunsch.value = undefined;
    return gilt(sprung.seit) ? sprung : undefined;
}

/** Nimmt den Sprung zu den Änderungen auf, wenn er noch gilt (und räumt ihn weg). */
export function nimmZuAenderungen(): SprungZuAenderungen | undefined {
    const sprung = zuAenderungen.value;
    if (sprung === undefined) return undefined;
    zuAenderungen.value = undefined;
    return gilt(sprung.seit) ? sprung : undefined;
}

/** Gilt ein ausstehender Sprung noch (ohne ihn aufzunehmen)? */
export const wartetZuAenderungen = (): boolean => {
    const sprung = zuAenderungen.value;
    return sprung !== undefined && gilt(sprung.seit);
};

/** Ein Test setzt die Ablage zurück. */
export function leereSprung(): void {
    zumObjektverlauf.value = undefined;
    zuAenderungen.value = undefined;
    reiterWunsch.value = undefined;
}
