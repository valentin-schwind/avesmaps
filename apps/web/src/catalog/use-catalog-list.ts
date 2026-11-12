import { ref, watch, type Ref } from "vue";
import type { CatalogTarget } from "../info-panel/panel-types";

/**
 * Was beide Katalogfenster an ihrer Liste gleich halten (WI-0118): welcher Eintrag aufgeklappt ist, welche Deckel gelüftet sind und
 * welche Bilder nicht luden. Das Fenster liefert Zeilen und Filter, hier steht das Verhalten.
 *
 * 🔴 **Ein Eintrag ist offen, die übrigen zu** (Legacy: Akkordeon). Geht das Fenster mit einem Ziel auf, das einen Eintrag nennt - ein Klick
 * auf eine Kachel im Streifen -, steht dieser Eintrag vergrößert da; ohne Eintrag steht die Liste zu. Nennt das Ziel einen Eintrag, den die
 * Liste nicht kennt (er ist inzwischen weg), bleibt sie zu, ohne Fehler.
 *
 * 🔴 **Ein Klick auf eine Kachel im Streifen hat den Deckel schon gelüftet** (der Deckel dort fängt den Klick ab, `info-spoiler.vue`): Wer
 * danach das Fenster öffnet, will den Eintrag sehen und nicht noch einmal aufdecken. Darum gilt der genannte Eintrag als gelüftet; alle
 * übrigen Deckel sind bei jedem Öffnen wieder zu (Legacy: „der Deckel ist bei jedem Öffnen wieder zu“).
 */
export interface CatalogListState {
    opened: Ref<string | undefined>;
    revealed: Ref<ReadonlySet<string>>;
    broken: Ref<readonly string[]>;
    toggle: (id: string) => void;
    reveal: (id: string) => void;
    broke: (url: string) => void;
}

export function useCatalogList<Row extends { id: string; spoiler: boolean }>(options: {
    section: CatalogTarget["section"];
    open: () => boolean;
    target: () => CatalogTarget | undefined;
    rows: () => readonly Row[];
    /** Das Fenster geht (neu) auf: seine Filter beginnen wieder leer. */
    reset: () => void;
}): CatalogListState {
    const opened = ref<string | undefined>(undefined);
    const revealed = ref<ReadonlySet<string>>(new Set());
    const broken = ref<readonly string[]>([]);
    /** Für welches Ziel ist die Liste schon eingerichtet? Ein neues Ziel richtet sie neu ein; ein Schließen vergisst es. */
    let appliedFor: CatalogTarget | undefined;

    watch(
        [options.open, options.rows, options.target],
        () => {
            if (!options.open()) {
                appliedFor = undefined;
                return;
            }
            const wanted = options.target();
            const rows = options.rows();
            if (
                wanted === undefined ||
                wanted.section !== options.section ||
                rows.length === 0 ||
                appliedFor === wanted
            ) {
                return;
            }
            appliedFor = wanted;
            options.reset();
            broken.value = [];
            const focus = rows.find((row) => row.id === wanted.focus);
            opened.value = focus?.id;
            revealed.value = new Set(focus === undefined ? [] : [focus.id]);
        },
        { immediate: true, flush: "sync" },
    );

    return {
        opened,
        revealed,
        broken,
        toggle: (id) => {
            opened.value = opened.value === id ? undefined : id;
        },
        reveal: (id) => {
            revealed.value = new Set(revealed.value).add(id);
        },
        broke: (url) => {
            if (!broken.value.includes(url)) broken.value = [...broken.value, url];
        },
    };
}
