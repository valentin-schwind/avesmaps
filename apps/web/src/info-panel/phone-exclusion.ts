import { watch, type Ref } from "vue";
import type { SubjectSelection } from "./subject-selection";

/**
 * Am Telefon schließen Planer und rechter Slot einander aus, in beide Richtungen (WI-0063 4.3, Legacy: `avesmapsIsPhoneViewport`):
 * Beide laufen von Kante zu Kante, neben dem einen bliebe nur ein Streifen Karte. Geht das Infopanel oder das Editorpanel auf
 * (WI-0128 E3), fährt der Planer zu; geht der Planer auf, klappt das Infopanel ein (die Auswahl bleibt, wie bei der Randlasche)
 * und das Editorpanel geht zu.
 *
 * Am Rechner stehen beide nebeneinander, links der Planer, rechts das Panel.
 *
 * `flush: "sync"`: Die Gegenrichtung gilt im selben Zug, nicht erst im nächsten Bild - sonst stünden beide kurz zugleich da.
 */
export function keepPlannerAndPanelApart(
    selection: Pick<SubjectSelection, "slotOpen" | "collapsePanel" | "closeEditor">,
    plannerOpen: Ref<boolean>,
    phone: Ref<boolean>,
): () => void {
    const stopPanel = watch(
        selection.slotOpen,
        (open) => {
            if (open && phone.value) plannerOpen.value = false;
        },
        { flush: "sync" },
    );
    const stopPlanner = watch(
        plannerOpen,
        (open) => {
            if (!open || !phone.value) return;
            selection.collapsePanel();
            selection.closeEditor();
        },
        { flush: "sync" },
    );
    return () => {
        stopPanel();
        stopPlanner();
    };
}
