import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { MapHistoryEntry, MapHistorySeries } from "@avesmaps3d/shared";
import {
    LEERER_FILTER,
    gruppiere,
    personenAus,
    zaehle,
    type AenderungenFilter,
    type ListenZeile,
    type Zaehlung,
} from "./aenderung-modell";
import type { AenderungenDaten } from "./aenderungen-daten";

/**
 * Der Stand des Reiters „Änderungen“ (WI-0265 B5a): die gelieferten Einträge, wie sie der Server schickt (neueste zuerst, Seite um Seite
 * über `before`), die Arbeitsserien dazu, die Filter und was eine Seite gerade tut. Reine Rechnung mit Vue-Refs, ohne Bauteil.
 *
 * - **Alle Filter wirken auf dem Server.** Ändert sich einer, beginnt die Liste von vorn; die Antwort einer älteren Frage wird verworfen.
 * - **Eine Seite kann länger sein als `limit`** (eine Serie am unteren Rand wird bis zu ihrem ältesten Mitglied nachgeladen); der Cursor
 *   `next` ist die kleinste gelieferte `seq`. Die Liste hängt die nächste Seite an und gruppiert über ALLE geladenen Einträge, eine Serie
 *   bleibt also auch über Seiten hinweg EINE Gruppe.
 * - Die Personen für den Trichter sind die, die in den geladenen Einträgen handeln; wer einmal da war, bleibt im Trichter, auch wenn ein
 *   Filter die Liste auf eine andere Person verengt.
 */
export interface AenderungenListe {
    readonly filter: Readonly<Ref<AenderungenFilter>>;
    readonly eintraege: Readonly<ShallowRef<readonly MapHistoryEntry[]>>;
    readonly zeilen: ComputedRef<ListenZeile[]>;
    readonly zaehlung: ComputedRef<Zaehlung>;
    readonly laedt: Readonly<Ref<boolean>>;
    readonly fehler: Readonly<Ref<boolean>>;
    readonly mehrDa: ComputedRef<boolean>;
    readonly personen: Readonly<ShallowRef<ReadonlyMap<string, string>>>;
    /** Setzt Filter und liest von vorn. */
    setze(teil: Partial<AenderungenFilter>): void;
    /** Liest die erste Seite (`mehr` falsch) oder hängt die nächste an. */
    lade(mehr?: boolean): Promise<void>;
    /** Lädt Seiten nach, bis die Operation in der Liste steht (höchstens `seiten`); `true`, wenn sie da ist. */
    ladeBis(operationId: string, seiten?: number): Promise<boolean>;
    destroy(): void;
}

/** So viele Seiten lädt ein Sprung höchstens nach, bevor er aufgibt (50 je Seite). */
export const SPRUNG_SEITEN = 10;

export function createAenderungenListe(
    daten: AenderungenDaten,
    start: Partial<AenderungenFilter> = {},
): AenderungenListe {
    const filter = ref<AenderungenFilter>({ ...LEERER_FILTER, ...start });
    const eintraege = shallowRef<readonly MapHistoryEntry[]>([]);
    const serien = shallowRef<ReadonlyMap<string, MapHistorySeries>>(new Map());
    const personen = shallowRef<ReadonlyMap<string, string>>(new Map());
    const laedt = ref(false);
    const fehler = ref(false);
    const weiter = ref<number | undefined>(undefined);
    let abbruch: AbortController | undefined;

    const zeilen = computed(() => gruppiere(eintraege.value, serien.value));

    async function lade(mehr = false): Promise<void> {
        if (mehr && weiter.value === undefined) return;
        abbruch?.abort();
        const eigene = new AbortController();
        abbruch = eigene;
        laedt.value = true;
        fehler.value = false;
        try {
            const seite = await daten.seite(filter.value, mehr ? weiter.value : undefined, eigene.signal);
            if (eigene.signal.aborted) return;
            const neu = mehr ? [...eintraege.value, ...seite.entries] : seite.entries;
            eintraege.value = neu;
            const gesamt = new Map(mehr ? serien.value : []);
            for (const serie of seite.series ?? []) gesamt.set(serie.id, serie);
            serien.value = gesamt;
            personen.value = personenAus(seite.entries, personen.value);
            weiter.value = seite.next;
        } catch {
            if (!eigene.signal.aborted) fehler.value = true;
        } finally {
            if (abbruch === eigene) laedt.value = false;
        }
    }

    return {
        filter,
        eintraege,
        zeilen,
        zaehlung: computed(() => zaehle(eintraege.value, zeilen.value)),
        laedt,
        fehler,
        mehrDa: computed(() => weiter.value !== undefined),
        personen,
        setze(teil) {
            filter.value = { ...filter.value, ...teil };
            void lade();
        },
        lade,
        async ladeBis(operationId, seiten = SPRUNG_SEITEN) {
            const da = (): boolean => eintraege.value.some((eintrag) => eintrag.operationId === operationId);
            for (let i = 0; !da() && weiter.value !== undefined && i < seiten; i += 1) {
                await lade(true);
                if (fehler.value) break;
            }
            return da();
        },
        destroy() {
            abbruch?.abort();
        },
    };
}
