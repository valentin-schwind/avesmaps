import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { WetterEditorAnschluss } from "../map/wetter/wetter-schalter";
import type { WetterBestand } from "./wetter-editor-modell";
import type { Wettereditor, WettereditorOptionen } from "./wettereditor-steuerung";

/**
 * Der Wetter-Editor im Startpaket (WI-0288; Besucherpaket WI-0235, 2026-11-08): nur diese Hülle. Die Steuerung samt Modell, Speicher, Wiki-Suche und
 * Leseweg (`wettereditor-steuerung.ts`) lädt nach (`nachladen.ts`, `ladeWettereditor`).
 *
 * - **Editoren** haben die Steuerung schon vor dem Einhängen der Seite (`ladeEditorVor`): Die Hülle legt den Editor dann beim Aufbau an, und alles geht
 *   so gleichzeitig wie vorher (Tiefer Link `?tab=wettereditor`, Handgriffe, Fenster).
 * - **Sonst** legt das erste Öffnen ihn an (`mit`); bis dahin gibt es keinen Stand, keinen Anschluss an die Karte und kein Fenster.
 */

/** Woher die Steuerung kommt (`nachladen.ts`: `ladeWettereditor`, `wettereditorGeladen`; ein Test gibt eigene). */
export interface WettereditorQuelle {
    laden(): Promise<Pick<typeof import("./wettereditor-steuerung"), "createWettereditor">>;
    /** Die Steuerung, wenn sie schon geladen ist. */
    geladen(): Pick<typeof import("./wettereditor-steuerung"), "createWettereditor"> | undefined;
}

export interface WettereditorHuelle {
    /** Der Editor, sobald seine Steuerung da ist. */
    readonly editor: Readonly<ShallowRef<Wettereditor | undefined>>;
    /** Presets und Icons, sobald der Editor sie gelesen hat (Kachel „Wetter“ der Karteninhalte). */
    readonly bestand: ComputedRef<WetterBestand | undefined>;
    /** Der Editor an der Karte, solange sein Fenster zu sehen ist (`installWetter`). */
    readonly anschluss: ComputedRef<WetterEditorAnschluss | undefined>;
    /** Darf diese Sitzung das Wetter schreiben (`edit_weather`)? */
    readonly darf: () => boolean;
    /** Ruft `arbeit` mit dem Editor: gleich, wenn er steht, sonst nach dem Laden der Steuerung; ohne Steuerung `undefined`. */
    mit<T>(arbeit: (editor: Wettereditor) => T): Promise<Awaited<T> | undefined>;
    oeffneWerkzeug(): void;
    destroy(): void;
}

export function createWettereditorHuelle(
    optionen: WettereditorOptionen,
    quelle: WettereditorQuelle,
): WettereditorHuelle {
    const editor = shallowRef<Wettereditor | undefined>(quelle.geladen()?.createWettereditor(optionen));
    let beendet = false;

    // 🪤 Steht der Editor, läuft `arbeit` noch im selben Takt (vor dem ersten `await`): Das Fenster geht auf wie vorher, ohne Zwischenbild.
    async function mit<T>(arbeit: (editor: Wettereditor) => T): Promise<Awaited<T> | undefined> {
        let da = editor.value;
        if (da === undefined) {
            try {
                const { createWettereditor } = await quelle.laden();
                if (beendet) return undefined;
                da = editor.value ??= createWettereditor(optionen);
            } catch (fehler) {
                console.error("Der Wetter-Editor ließ sich nicht laden", fehler);
                return undefined;
            }
        }
        return await arbeit(da);
    }

    return {
        editor,
        bestand: computed(() => editor.value?.bestand.value),
        anschluss: computed(() => editor.value?.anschluss.value),
        darf: optionen.darf,
        mit,
        oeffneWerkzeug() {
            void mit((geladen) => geladen.oeffneWerkzeug());
        },
        destroy() {
            beendet = true;
            editor.value?.destroy();
        },
    };
}
