import { ref, shallowRef, type Ref, type ShallowRef } from "vue";

/**
 * Was ein Mensch an einer Liste einstellt: Suche, Filter, Sortierung und Maske (WI-0128). Alle Bauteile derselben Liste teilen es,
 * damit es beim Öffnen eines Orts bleibt: Jeder Ort hat sein eigenes Fenster (D19, das vorige wird abgelegt), und jedes Fenster hatte
 * bisher seine eigene Liste, also stand nach jedem Klick die Suche leer und der Filter wieder auf der Vorbelegung (gefunden 2026-10-11).
 */
export interface ListenEinstellung {
    readonly suche: Ref<string>;
    readonly filter: ShallowRef<Map<string, Set<string>>>;
    readonly sortierung: Ref<string>;
    readonly maske: Ref<string>;
    /**
     * Wie weit die Liste gerollt ist. Ein Klick öffnet den Ort in einem neuen Fenster an derselben Stelle (D19); ohne die Rollposition
     * begann dessen Liste oben und rollte dann zur Wahl, die Liste „sprang nach der Auswahl“ (Betreiber 2026-10-11).
     */
    readonly oben: Ref<number>;
}

export function createListenEinstellung(start: {
    vorbelegt?: ReadonlyMap<string, ReadonlySet<string>> | undefined;
    sortierung: string;
    maske: string;
}): ListenEinstellung {
    return {
        suche: ref(""),
        filter: shallowRef(new Map([...(start.vorbelegt ?? new Map())].map(([key, werte]) => [key, new Set(werte)]))),
        sortierung: ref(start.sortierung),
        maske: ref(start.maske),
        oben: ref(0),
    };
}
