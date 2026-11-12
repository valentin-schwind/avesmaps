import type { EditorStatus } from "@avesmaps3d/shared";
import type { EditorAction, EditorMenuSubject } from "../editor-menu/action";
import { wetterHandgriffe, wetterSubjekt } from "../editor-menu/handgriffe-wetter";
import { wetterIconAm } from "../map/wetter/wetter-treffer";
import type { WettereditorHuelle } from "./wettereditor-huelle";
import type { Wettereditor } from "./wettereditor-steuerung";

/**
 * Die Wetter-Icons im Kartenmenü der Editoren (WI-0288, `editor-menu/handgriffe-wetter.ts`) an EINER Stelle, damit `app.vue` nur einhängt (Hausregel
 * „app.vue schmal“, wie `spracheditor/sprache-kartenmenue.ts`): das Icon unter dem Rechtsklick und die Handgriffe, gebunden an den Wetter-Editor.
 *
 * Jeder Handgriff öffnet den Wetter-Editor am Icon, auch „Verbergen“ und „Zurückholen“: Mit offenem Fenster zeigt die Karte den Stand des Editors
 * (ein verborgenes Icon grau), ohne es bliebe das Icon bis zum nächsten Lesen stehen. Gebunden ist das Menü an die Hülle (`wettereditor-huelle.ts`): Die
 * Handgriffe stehen vom Start an, die Steuerung lädt, wo sie fehlt, mit dem ersten.
 */

export interface WetterKartenmenueSeite {
    readonly editor: WettereditorHuelle;
    /** Der Stand des Bearbeitens und ob ein Modus der Seite läuft. */
    lage(): { readonly bearbeiten: EditorStatus | undefined; readonly laeuft: boolean };
    /** Die Lasche „Editor“ nach vorn (wie bei jedem Handgriff, der ein Fenster öffnet). */
    zeigeEditor(): void;
}

export interface WetterKartenmenue {
    /** Das Icon unter dem Punkt der Karte (Bildpunkte der Karte) als Gegenstand der Handgriffe; ohne Icon `undefined`. */
    am(punkt: { x: number; y: number }): EditorMenuSubject | undefined;
    /** Die Handgriffe am Wetter-Icon für das Register. */
    readonly handgriffe: readonly EditorAction[];
}

export function createWetterKartenmenue(seite: WetterKartenmenueSeite): WetterKartenmenue {
    const { editor } = seite;
    const oeffne = (id: string): Promise<Wettereditor | undefined> => {
        seite.zeigeEditor();
        return editor.mit((geladen) => geladen.oeffneFuer(id).then(() => geladen));
    };
    return {
        am(punkt) {
            const icon = wetterIconAm(punkt.x, punkt.y);
            return icon === undefined ? undefined : wetterSubjekt(icon);
        },
        handgriffe: wetterHandgriffe(
            () => ({
                ...seite.lage(),
                darf: editor.darf(),
                sichtbar: (id) => editor.bestand.value?.symbole.find((s) => s.id === id)?.sichtbar ?? true,
            }),
            {
                oeffnen: (id) => void oeffne(id),
                sichtbar: (id, ja) => void oeffne(id).then((geladen) => geladen?.setzeSichtbar(id, ja)),
                entfernen: (id) => void oeffne(id).then((geladen) => geladen?.frageEntfernen(id)),
            },
        ),
    };
}
