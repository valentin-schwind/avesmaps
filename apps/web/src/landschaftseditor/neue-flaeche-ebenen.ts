import { ref } from "vue";
import { EDITOR_LANDSCAPE_LAYERS, type EditorLandscapeLayer } from "@avesmaps3d/shared";
import { modusGrund, type OrtLage } from "../editor-menu/handgriffe-ort";
import { GRUND_FLAECHE } from "../editor-menu/sonderrolle-grund";
import type { AnlegenEintrag } from "../editor-menu/kartenmenue";

/**
 * Die Ebenen der Derographie im Untermenü „Hier hinzufügen › Neue Fläche ›“ (WI-0178 T47; Betreiber 2026-10-18: „neue fläche als
 * untermenü der ebenen“, Probierseite „Neue Fläche und Untergrund“, Idee „Untermenü der Ebenen“). Je Ebene ein Eintrag in der Folge der
 * Ebenenleiste: Regionen · Vegetation · Topographie; die Klimazonen werden nicht gezeichnet (Legacy `index.html#L896-901`). In der Ansicht
 * Standard so entschieden (Betreiber 2026-10-18, EDIT-0003 §6); welche Ansicht das Menü sonst trägt, schaltet `ansichten`.
 *
 * - **„zuletzt“** steht an der Ebene, in die „Neue Fläche“ ohne Wahl ginge (`zielEbene`): die Ebene der Karte, wenn die Derographie
 *   eine zeichenbare zeigt, sonst die zuletzt gezeichnete (Probierseite `zielEbene`).
 * - **Gesperrt** mit Grund ohne beide Schreibrechte, ohne `MAP_EDITING` und während ein Modus läuft; ohne den gemeinsamen Ablauf C3
 *   (`starte` fehlt) mit „Kommt später.“, dann steht auch „Neue Fläche“ selbst gesperrt (`kartenmenue.ts`).
 */
export interface NeueFlaecheEbenenLage {
    readonly lage: () => OrtLage;
    /** Ansicht und Ebenenwahl der Karte. */
    readonly ansicht: () => { readonly view: string; readonly auswahl: string };
    /** Der Start des Zeichnens in der Ebene, die erste Ecke am Klickpunkt des Menüs; ohne C3 keiner. */
    readonly starte?: ((ebene: EditorLandscapeLayer, punkt: { x: number; y: number }) => void) | undefined;
}

/** Die Ebene, in der zuletzt eine Fläche begonnen wurde (für „zuletzt“), solange die Seite offen ist. */
export const zuletztGezeichnet = ref<EditorLandscapeLayer | undefined>(undefined);

/** Die Ebene, in die „Neue Fläche“ ohne Wahl ginge. */
export function zielEbene(
    view: string,
    auswahl: string,
    zuletzt: EditorLandscapeLayer | undefined,
): EditorLandscapeLayer | undefined {
    const gezeigt = EDITOR_LANDSCAPE_LAYERS.find((ebene) => ebene === auswahl);
    return view === "landscapes" && gezeigt !== undefined ? gezeigt : zuletzt;
}

export function neueFlaecheEbenen({ lage, ansicht, starte }: NeueFlaecheEbenenLage): AnlegenEintrag[] {
    return EDITOR_LANDSCAPE_LAYERS.map((ebene) => ({
        id: `neue-flaeche-${ebene}`,
        zeichen: undefined,
        label: `layer.${ebene}`,
        hinweis: () => {
            const { view, auswahl } = ansicht();
            return zielEbene(view, auswahl, zuletztGezeichnet.value) === ebene
                ? "landschaftseditor.anlegen.zuletzt"
                : undefined;
        },
        sperre: () => {
            if (starte === undefined) return "editorPanel.spaeter.satz";
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (!jetzt.rechte.includes("edit_landscape_form")) return GRUND_FLAECHE;
            if (!jetzt.rechte.includes("edit_landscapes")) return "ortseditor.handgriff.grund.recht";
            return modusGrund(jetzt.bearbeiten);
        },
        run: (punkt) => {
            if (starte === undefined) return;
            zuletztGezeichnet.value = ebene;
            starte(ebene, punkt);
        },
    }));
}
