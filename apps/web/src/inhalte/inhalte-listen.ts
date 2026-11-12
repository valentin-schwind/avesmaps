import { shallowRef, watch, type Ref } from "vue";
import type {
    InhalteKorporaListe,
    InhalteQuellenListe,
    InhalteVorkommenListe,
    InhalteWerkListe,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";
import { t } from "../i18n/i18n";

/**
 * Die Listen des Fensters „Inhalte bearbeiten“, die das Editorpanel mitliest (WI-0212): Die Kacheln „Nachschlagen“ (Quellen, Literatur,
 * Vorkommen, Korpora) zeigen die Zahl der Einträge und die Zählung der Kreise aus dem `zahlen` dieser Listen
 * (`editor-panel/karteninhalte-zahlen.ts`), nicht aus einem eigenen Lesepfad.
 *
 * - **Was das Fenster geladen hat, gilt zuerst.** Seine Steuerungen leben im Fenster, das nur steht, solange es offen ist; außerhalb des
 *   Fensters sieht sie niemand. Das Fenster reicht sie deshalb in diese Refs weiter (`teileInhalteListen`), und `app.vue` gibt sie dem
 *   Panel wie die Listen der Editoren (`ortseditor.liste` …). So bleiben die Zahlen nach jedem Speichern im Fenster frisch (Speichern und
 *   Anlegen laden die Liste neu), auch wenn das Fenster danach zu ist.
 * - **Nichts wird zurückgesetzt:** Ein geschlossenes Fenster lässt seine letzte Liste hier stehen; sie ist der jüngste Stand, den es gibt.
 *   Hat das Fenster nie offen gestanden, holt das Panel die Zahlen selbst.
 * - Ein einziger Satz Refs, wie `inhalteReiterWunsch` (`inhalte-oeffnen.ts`): Es gibt genau EIN Fenster „Inhalte bearbeiten“.
 */
export const inhalteListen = {
    quellen: shallowRef<InhalteQuellenListe | undefined>(undefined),
    literatur: shallowRef<InhalteWerkListe | undefined>(undefined),
    vorkommen: shallowRef<InhalteVorkommenListe | undefined>(undefined),
    korpora: shallowRef<InhalteKorporaListe | undefined>(undefined),
};

/** Die Listen der Steuerungen des Fensters, so wie `createQuellenSteuerung` und ihre Geschwister sie halten. */
export interface InhalteFensterListen {
    readonly quellen: Readonly<Ref<InhalteQuellenListe | undefined>>;
    readonly literatur: Readonly<Ref<InhalteWerkListe | undefined>>;
    readonly vorkommen: Readonly<Ref<InhalteVorkommenListe | undefined>>;
    readonly korpora: Readonly<Ref<InhalteKorporaListe | undefined>>;
}

/** Das Fenster reicht seine Listen weiter, sobald sie da sind und bei jeder neuen (im `setup` des Fensters: der Wächter endet mit ihm). */
export function teileInhalteListen(listen: InhalteFensterListen): void {
    const teile = <L>(von: Readonly<Ref<L | undefined>>, nach: Ref<L | undefined>): void => {
        watch(
            von,
            (liste) => {
                if (liste !== undefined) nach.value = liste;
            },
            { immediate: true },
        );
    };
    teile(listen.quellen, inhalteListen.quellen);
    teile(listen.literatur, inhalteListen.literatur);
    teile(listen.vorkommen, inhalteListen.vorkommen);
    teile(listen.korpora, inhalteListen.korpora);
}

/**
 * Die Namen der Kreise unter diesen Listen im Fenster (`inhalte-katalog-liste.vue`): Quellen, Literatur und Vorkommen kennen alle drei
 * Zustände. Dieselben Worte stehen im Steckbrief der Kachel, damit Panel und Fenster einander nicht widersprechen.
 */
export const INHALTE_LEGENDE = (): Partial<Record<Kreis, string>> => ({
    voll: t("inhalte.kreis.voll"),
    halb: t("inhalte.kreis.halb"),
    leer: t("inhalte.kreis.leer"),
});

/** Die Korpora kennen keine stillgelegten (`inhalte-korpora-liste.vue`): zwei Kreise. */
export const KORPORA_LEGENDE = (): Partial<Record<Kreis, string>> => ({
    voll: t("inhalte.kreis.voll"),
    halb: t("inhalte.kreis.halb"),
});
