/**
 * Wann der eintreffende Inhalt EINGEBLENDET wird (WI-0088 P1, Betreiber 2026-10-06: „du lässt es aufgehen, lädst parellel die inhalte
 * und fadest sie ein, damit das infopanel responsiv bleibt“).
 *
 * 🔴 Eingeblendet wird nur, was **neu hinzukommt**, und nur, wo das Panel vorher **sichtbar gewartet** hat. Eine Antwort aus dem
 * kurzen Cache steht schon im ersten Bild; sie hat keinen Sprung überbrückt, und eine Bewegung hielte den Betrachter nur auf
 * (Design Guide §30.8: bewegt erscheint, was von selbst kommt - ein Fenster, das man selbst öffnet, ist einfach da). Der Name, den
 * die Karte schon kannte, steht in beiden Fällen unverändert da; er wird nie ausgeblendet und neu eingeblendet.
 *
 * 🔴 Der Übergang ist eine reine Deckkraft von 0 auf 1 und endet dort. Eine Fläche, die auf einem Zwischenwert stehen bleibt, hieße
 * in diesem Haus „geht gerade nicht“ (§30.2) - genau das Gegenteil von „ist gerade angekommen“.
 *
 * Die Regel ist bewusst vom Bauteil getrennt: Sie ist eine Zustandsfolge, und eine Zustandsfolge prüft man ohne Browser.
 */

import { ref, watchEffect, type Ref } from "vue";

/** Woran der Inhalt hängt und ob gerade sichtbar gewartet wird. */
export interface ArrivalState {
    /** Der Schlüssel des Inhalts. Wechselt er, beginnt die Beobachtung von vorn. */
    key: string;
    /** Wartet das Panel gerade sichtbar auf diesen Inhalt? */
    loading: boolean;
}

/**
 * Ein Beobachter je Bauteil: Er merkt sich, für welchen Schlüssel sichtbar gewartet wurde, und sagt danach genau einmal je
 * Schlüssel „der Inhalt trifft ein“. `undefined` heißt: Es gibt nichts zu zeigen.
 */
export function createArrivalTracker(): (state: ArrivalState | undefined) => boolean {
    /** Der Schlüssel, für den eine Wartezeile zu sehen war. */
    let waitedFor: string | undefined;
    return (state) => {
        if (state === undefined) return false;
        if (state.loading) {
            waitedFor = state.key;
            return false;
        }
        return waitedFor === state.key;
    };
}

/**
 * Die Bindung für ein Bauteil. 💣 Sie muss **eifrig** sein, und darum steht sie hier statt in jedem Bauteil:
 *
 * Der Beobachter merkt sich Zustände, also muss er JEDEN sehen. Ein `computed` sieht nur die Zustände, in denen die Vorlage ihn
 * auch liest - und genau das ging am 2026-10-06 schief: Der Katalogabschnitt las die Marke nur am Baustein der fertigen Liste,
 * also nie während des Ladens. Der Beobachter erfuhr vom Warten nichts und meldete beim Eintreffen „nichts Neues“; die Liste
 * stand ohne Einblendung da. Mit `watchEffect` läuft die Regel bei jeder Änderung, auch wenn niemand hinsieht - und wegen
 * `flush: "pre"` steht die Marke, bevor die neuen Elemente gezeichnet werden.
 */
export function useArrival(state: () => ArrivalState | undefined): Readonly<Ref<boolean>> {
    const tracker = createArrivalTracker();
    const arriving = ref(false);
    watchEffect(() => {
        arriving.value = tracker(state());
    });
    return arriving;
}
