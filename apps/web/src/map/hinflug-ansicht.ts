import type { LandscapeLayer, LandscapeSelection, MapView } from "@avesmaps3d/shared";
import { watch, type Ref } from "vue";

/**
 * In welche Ansicht ein Hinflug der Editoren die Karte stellt (EDIT-0003 T32 (1), G3; WI-0190).
 *
 * 🔴 Betreiber 2026-10-16, wörtlich: „Doppelklick auf einen Eintrag in den Listen … sollte nicht nur an die Stelle, sondern auch auf
 * die Ansicht wechseln. Landschaften (Derographie, Vegetation, Topographie) -> Landschaften (Derographie, Vegetation, Topographie
 * respektive) Wege und Orte -> Standard Herrschaftsgebiete -> Politisch Kraftlinien -> Kraftlinien“. EINE Zuordnung für jeden
 * Hinflug aus einer Editor-Liste; ein Editor nennt nur die Art seines Objekts (und bei einer Landschaft deren Ebene).
 *
 * 🪤 Die Suche und ein geteilter Link schalten eine Landschaft weiter auf die Standardkarte (`search/search-focus.ts`,
 * `info-panel/presentation.ts`, Betreiber 2026-09-23): Dort ist der Treffer eine Beschriftung, und die stehen auf der Standardkarte
 * vollständig. Wer dagegen im Editor eine Fläche anfliegt, will die Fläche sehen - und Flächen zeichnet nur ihre Ebene.
 */
export type HinflugObjekt =
    | { art: "ort" }
    | { art: "weg" }
    /**
     * Eine Landschaft mit ihrer Ebene; ohne Ebene die Landschaften als Ganzes (die Kachel „Landschaften“ im Editorpanel, WI-0212). Dann
     * bleibt die gemerkte Ebene des Kartenfächers.
     */
    | { art: "landschaft"; ebene?: LandscapeLayer | undefined }
    | { art: "herrschaftsgebiet" }
    | { art: "kraftlinie" }
    /** Eine Sprache (WI-0261 S5d2): Derographie › Sprachen, die Ebene, in der allein die Sprachflächen stehen. */
    | { art: "sprache" }
    /** Das Wetter (WI-0288 Stufe 3): Es gibt es nur in der Ansicht „Standard“. */
    | { art: "wetter" };

/** Die Ansicht eines Hinflugs, dazu die Landschaftsebene, nur wo die Ansicht eine braucht. */
export interface HinflugAnsicht {
    view: MapView;
    landscape?: LandscapeSelection;
}

/**
 * 💣 Ohne `default`-Zweig, wie `search-focus.ts` ohne ihn auskommt: Kommt eine Art dazu, bricht die Typprüfung hier, bis sie ihre
 * Ansicht hat. Ein `default` ließe sie still auf irgendeiner Ansicht landen.
 */
export function ansichtFuerHinflug(objekt: HinflugObjekt): HinflugAnsicht {
    switch (objekt.art) {
        case "ort":
        case "weg":
        case "wetter":
            return { view: "standard" };
        case "landschaft":
            return objekt.ebene === undefined
                ? { view: "landscapes" }
                : { view: "landscapes", landscape: objekt.ebene };
        case "herrschaftsgebiet":
            return { view: "political" };
        case "kraftlinie":
            return { view: "powerlines" };
        case "sprache":
            return { view: "landscapes", landscape: "sprachen" };
    }
}

export interface AnsichtWechselStand {
    /** Die Ansicht des Kartenfächers. */
    view: Ref<MapView>;
    /** Seine Landschaftsebene; sie bleibt gemerkt, wenn eine andere Ansicht kommt. */
    landscape: Ref<LandscapeSelection>;
    /** Sind die Herrschaftsgebiete geladen? Ohne sie ist „Politisch“ gesperrt (wie im Fächer), und die Ansicht bleibt. */
    politischBereit: () => boolean;
}

/**
 * Stellt die Ansicht eines Hinflugs ein, mit derselben Sperre wie die Auswahl (`present` in `app.vue`): „Politisch“ nur mit Gebieten.
 * Die Ebene folgt nach der Ansicht, wie dort: Ein Ansichtswechsel setzt die Schalter auf ihre Vorgaben zurück.
 *
 * 🔴 **Derographie ohne Ebene heißt die letzte Derographie-Ebene, nie „Sprachen“** (Betreiber 2026-10-31, wörtlich: „wieder dafür sorgen, dass man
 * bei einem klick auf "Derographie" im Editor wieder in den (letzten) Derographie-Ansicht kommt. Derzeit geht er nicht zurück.“): Die Sprachen sind
 * eine Ebene der Derographie nur im Kartenfächer; wer aus dem Spracheditor kommt und die Kachel „Derographie“ wählt, landet in der Ebene, in der er
 * zuletzt außerhalb der Sprachen war (anfangs „Alle“).
 */
export function createAnsichtWechsel(stand: AnsichtWechselStand): (ziel: HinflugAnsicht) => void {
    let letzteDerographie: LandscapeSelection = stand.landscape.value === "sprachen" ? "alle" : stand.landscape.value;
    watch(
        stand.landscape,
        (ebene) => {
            if (ebene !== "sprachen") letzteDerographie = ebene;
        },
        { flush: "sync" },
    );
    return (ziel) => {
        if (ziel.view === "political" && !stand.politischBereit()) return;
        stand.view.value = ziel.view;
        if (ziel.landscape !== undefined) stand.landscape.value = ziel.landscape;
        else if (ziel.view === "landscapes" && stand.landscape.value === "sprachen")
            stand.landscape.value = letzteDerographie;
    };
}
