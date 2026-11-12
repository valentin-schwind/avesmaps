import { ref, watch, type Ref } from "vue";
import type { LandscapeSelection, MapView, ShareDisplay } from "@avesmaps3d/shared";
import { applyDisplayDeviation, displayDeviation, sameDisplay } from "./display-state";
import type { DisplayContext, MapDisplay } from "./map-display";
import { HEXRASTER_VORGABE } from "./hexraster";

/**
 * Die Vorgabe je Ansicht und die Wahl des Menschen (Betreiber 2026-10-05, Klimazonen: „sofern nicht anders vom nutzer
 * eingestellt“).
 *
 * Die Schalter des Auge-Menüs sind immer die Vorgabe des Kontexts (Ansicht, Landschaftsebene, Editor; `displayDefaults`)
 * und darüber das, was der Mensch selbst gewählt hat. Gewählt ist jeder Schalter, den er im Menü oder mit einer
 * Zifferntaste umlegt, und jeder, den die geöffnete Adresse oder ein Kurzlink nennt. Was die Seite selbst setzt (ein
 * Wechsel, eine Vorgabe), ist keine Wahl; Legacy zieht dieselbe Grenze („NUR EINE ECHTE HAND ZÄHLT“, `ecosystemAnzeigeWahl`).
 *
 * - Ein Wechsel der EBENE in den Landschaften gibt jedem nicht gewählten Schalter die Vorgabe der neuen Ebene: Wer die
 *   Klimazonen betritt, bekommt ihre Vorgabe, wer sie verlässt, wieder die der Landschaften, also den Stand vor dem
 *   Betreten. Gewähltes bleibt, in beide Richtungen.
 * - 🔴 Ein Wechsel der ANSICHT setzt wie bisher alles auf ihre Vorgabe (DIE ANSICHT GEWINNT, Legacy, Owner 12.08.2026).
 *   Nur die Wahl in den Landschaften gilt für den ganzen Besuch (Legacy, Owner 09.09.2026): Sie ist gemerkt, solange der
 *   Mensch in einer anderen Ansicht ist.
 * - Nur im Speicher, wie Legacy: Ein Neuladen beginnt mit der Vorgabe und dem, was die Adresse sagt. Die Adresse trägt
 *   die Abweichung von der Vorgabe des Kontexts (`displayDeviation`); eine Wahl, die der Vorgabe gleicht, steht nicht darin.
 * - Das Kachelraster hängt an keiner Ansicht: Es ist überall aus, bis ein Editor es einschaltet, und bleibt dann. Ebenso das
 *   Gradnetz (WI-0273), nur für alle, und das Hexraster samt Feldgröße, das das Gradnetz ausschließt.
 */

/** Die Schalter, die der Mensch selbst gewählt hat (dieselbe Form wie eine Abweichung in der Adresse). */
export type DisplayChoice = ShareDisplay;

export interface DisplayChoices {
    /** In der Ansicht, in der er gerade ist. */
    current: DisplayChoice;
    /** In den Landschaften, gemerkt, solange er in einer anderen Ansicht ist. */
    landscapes: DisplayChoice | undefined;
}

/** Die Wahl nach einem Umlegen: Jeder Schalter, der sich dabei ändert, gehört ab jetzt dem Menschen. */
export function chooseDisplay(choice: DisplayChoice, before: MapDisplay, after: MapDisplay): DisplayChoice {
    const changed = Object.entries(after).filter(([key, value]) => before[key as keyof MapDisplay] !== value);
    return { ...choice, ...(Object.fromEntries(changed) as Partial<MapDisplay>) };
}

/** Die Schalter nach einem Wechsel von Ansicht oder Ebene (`from` → `to`), und die Wahl, die danach gilt. */
export function switchDisplayContext(
    choices: DisplayChoices,
    from: DisplayContext,
    to: DisplayContext,
): { choices: DisplayChoices; display: MapDisplay } {
    let next = choices;
    if (from.view !== to.view) {
        const landscapes = from.view === "landscapes" ? choices.current : choices.landscapes;
        next = { current: to.view === "landscapes" ? { ...landscapes } : {}, landscapes };
    }
    return { choices: next, display: applyDisplayDeviation(to, next.current).display };
}

export interface DisplayChoicesState {
    /** Die Schalter, wie die Karte sie zeichnet. Geändert wird nur über `choose` und `adopt`. */
    display: Readonly<Ref<MapDisplay>>;
    /** Das Rechenraster des Höhenmodells (WI-0070), ein Editor-Schalter unabhängig von der Ansicht. */
    tileGrid: Ref<boolean>;
    /** Das Gradnetz (WI-0273), für alle und unabhängig von der Ansicht. */
    gradnetz: Ref<boolean>;
    /** Das Hexraster (WI-0273), für alle; an schließt es das Gradnetz aus (das Menü legt beide zugleich um). */
    hexraster: Ref<boolean>;
    /** Die Feldgröße des Hexrasters in Meilen; sie bleibt gemerkt, solange es aus ist. */
    hexMeilen: Ref<number>;
    /** Der Mensch legt im Menü oder mit einer Taste um. */
    choose(next: MapDisplay): void;
    /** Ein Kurzlink nennt die Schalter: Sie gelten als gewählt, alles andere ist die Vorgabe (WI-0072). */
    adopt(deviation: ShareDisplay | undefined): void;
    /** Was von den Schaltern die Vorgabe des Kontexts verlässt: das, was Adresse und Kurzlink tragen (WI-0072). */
    deviation(): ShareDisplay;
}

/**
 * Die Schalter samt Vorgabe je Ansicht und Wahl des Menschen. `view` und `layer` gehören dem Kartenfächer; ihr Wechsel
 * setzt die Schalter im selben Zug (`flush: "sync"`), BEVOR der Stil neu gebaut wird, sonst baute er zweimal.
 */
export function useDisplayChoices(input: {
    view: Ref<MapView>;
    layer: Ref<LandscapeSelection>;
    /** Schaut ein Editor (`view_flow_directions`)? */
    editor: boolean;
    /** Die Schalter, die die geöffnete Adresse nennt (WI-0072). */
    linked: ShareDisplay | undefined;
}): DisplayChoicesState {
    const { editor } = input;
    const context = (): DisplayContext => ({ view: input.view.value, layer: input.layer.value, editor });
    const opened = applyDisplayDeviation(context(), input.linked);
    const display = ref<MapDisplay>(opened.display);
    const tileGrid = ref(opened.tileGrid);
    const gradnetz = ref(opened.gradnetz);
    const hexraster = ref(opened.hexraster !== undefined);
    const hexMeilen = ref(opened.hexraster ?? HEXRASTER_VORGABE);
    let choices: DisplayChoices = { current: { ...input.linked }, landscapes: undefined };

    const show = (next: MapDisplay): void => {
        // Jede neue Belegung baut den Stil neu auf; gleiche Schalter lassen ihn stehen.
        if (!sameDisplay(display.value, next)) display.value = next;
    };

    watch(
        [input.view, input.layer],
        ([view, layer], [fromView, fromLayer]) => {
            const switched = switchDisplayContext(
                choices,
                { view: fromView, layer: fromLayer, editor },
                { view, layer, editor },
            );
            choices = switched.choices;
            show(switched.display);
        },
        { flush: "sync" },
    );

    return {
        display,
        tileGrid,
        gradnetz,
        hexraster,
        hexMeilen,
        choose(next) {
            choices = { ...choices, current: chooseDisplay(choices.current, display.value, next) };
            show(next);
        },
        adopt(deviation) {
            choices = { ...choices, current: { ...deviation } };
            const applied = applyDisplayDeviation(context(), deviation);
            show(applied.display);
            tileGrid.value = applied.tileGrid;
            gradnetz.value = applied.gradnetz;
            hexraster.value = applied.hexraster !== undefined;
            if (applied.hexraster !== undefined) hexMeilen.value = applied.hexraster;
        },
        deviation: () =>
            displayDeviation(
                context(),
                display.value,
                tileGrid.value && editor,
                gradnetz.value,
                hexraster.value ? hexMeilen.value : undefined,
            ),
    };
}
