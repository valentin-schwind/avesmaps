import { watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { RouteResponse, SubjectRef } from "@avesmaps3d/shared";
import type { SubjectSelection } from "./subject-selection";

/**
 * Die Etappe als Subject (WI-0063 4.7, P5): Klick auf eine Etappenzeile oder die Routenlinie wählt die Etappe wie heute und
 * öffnet ihre Information im Infopanel. Die Etappe gehört dem Planer (`planner.selectedStage`); dieses Modul hört nur zu und
 * öffnet über dieselbe Naht wie jede andere Auswahl (`openSubject`), statt dem Planer eine zweite Auswahl aufzuzwingen.
 *
 * - **Der Schlüssel der Reise** (`routeKey`) sind die Kennungen der Wegpunkte in Reihenfolge, wie die Adresse sie führt. Eine
 *   Etappe lebt nur in der Reise, die sie gewählt hat: Wechselt sie oder verschwindet sie, ist der Subject veraltet und
 *   schließt.
 * - 🔴 **Die Wiedergabe öffnet nie.** Der Playmode wählt Etappe um Etappe, während der Pfeil läuft (`stageFromPlaymode` in
 *   `app.vue`); das Panel ginge mit jeder Etappe auf. Steht aber schon eine Etappe im Panel, folgt sie dem Pfeil.
 */

/** Was die Bindung vom Planer braucht - ein Ausschnitt des Planers, damit ein Test ohne Planer auskommt. */
export interface PlannerSelectionSource {
    selectedStage: Ref<number | null>;
    route: ShallowRef<RouteResponse | null>;
    filled: ComputedRef<readonly { id: string }[]>;
}

/** Die Reise, die die Etappen trägt: Die Kennungen der Wegpunkte, `~` dazwischen. */
export function routeKeyOf(planner: Pick<PlannerSelectionSource, "filled">): string {
    return planner.filled.value
        .map((place) => place.id)
        .join("~")
        .slice(0, 2000);
}

export function stageRefOf(planner: Pick<PlannerSelectionSource, "filled">, index: number): SubjectRef {
    return { kind: "routeStage", index, routeKey: routeKeyOf(planner) };
}

/** Hört auf die Etappe des Planers und die Route; gibt die Abmeldung zurück. */
export function bindPlannerStage(
    selection: Pick<SubjectSelection, "selected" | "openSubject" | "closeSubject">,
    planner: PlannerSelectionSource,
    /** Wählt gerade der Playmode die Etappe? Dann öffnet sie nichts, folgt aber einer offenen. */
    playmodeDriven: () => boolean = () => false,
): () => void {
    const shownStage = (): boolean => selection.selected.value?.kind === "routeStage";
    const stopStage = watch(
        planner.selectedStage,
        (stage) => {
            if (stage === null) {
                if (shownStage()) selection.closeSubject({ source: "planner" });
                return;
            }
            if (playmodeDriven() && !shownStage()) return;
            selection.openSubject(stageRefOf(planner, stage), { source: "planner", camera: "none" });
        },
        { flush: "sync" },
    );
    // 🪤 Nur die Route, nicht `planner.filled`: Ein sofort rechnender Beobachter auf den Wegpunkten läse die Liste mitten in
    // `addMapPoint` (die Zeile steht schon im Feld, ihr Ort noch nicht - sie wird dort am rohen Objekt gesetzt, das
    // Vue nicht sieht). `filled` bliebe danach auf dem alten Stand, und „Hierher reisen“ rechnete nie (gemessen 2026-10-04).
    // Eine andere Reise ersetzt die Route, und erst dann wird der Schlüssel gelesen.
    const stopRoute = watch(
        planner.route,
        () => {
            const current = selection.selected.value;
            if (current?.kind !== "routeStage") return;
            // Die Reise ist eine andere oder weg: Die Etappe gibt es so nicht mehr.
            if (planner.route.value === null || current.routeKey !== routeKeyOf(planner)) {
                selection.closeSubject({ source: "planner" });
            }
        },
        { flush: "sync" },
    );
    return () => {
        stopStage();
        stopRoute();
    };
}
