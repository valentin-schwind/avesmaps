import { INTERACTION_PRIORITY } from "../interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator, Screen } from "../interaction/types";
import type { Symbolebene, WetterSymbol } from "./wetter-symbole";

/**
 * Das Infopanel eines Wetter-Icons auf der Karte (WI-0288; Betreiber 2026-11-08 auf die Frage, ob ein Klick auf ein verknüpftes Icon für Besucher ein Infopanel
 * öffnen soll: „ja infopanel bauen.“): der Besitzer `wetter-info` im Koordinator.
 *
 * - **Klick** auf ein Icon MIT Wiki-Verweis öffnet sein Infopanel (Subject `wetterSymbol`), über dieselbe Naht wie jeder Klick (`subjects.openSubject`), und fällt
 *   nicht auf einen Ort oder eine Fläche darunter durch. Ein Icon ohne Verweis beansprucht nichts: Der Klick gehört der Karte darunter, wie bisher.
 * - **Zeigen** zeigt die Hand und das Zeiger-Schild mit Name und Art, wie an jedem Gegenstand der Karte (Guide P8).
 * - Treffen kann nur, was gerade zu sehen ist: Die Icons stehen nur, solange Wind oder Meeresströmungen im Auge an sind (Ansicht „Standard“, am Rechner).
 * - 🔴 Bei offenem Wetter-Editor schweigt der Besitzer (`enabled`): Dann ist der Klick das Wählen und Ziehen des Editors (`wetter-griffe.ts`, Rang 88).
 */

/** Was die Karte zum Öffnen braucht; `app.vue` hängt es an die Auswahl und das Zeiger-Schild. */
export interface WetterInfoAnschluss {
    /** Öffnet das Infopanel des Icons; `at` ist die Stelle des Klicks (Fensterkoordinaten). */
    oeffne(symbol: WetterSymbol, at: Screen): void;
    /** Das Zeiger-Schild für dieses Icon, `undefined` nimmt es weg. */
    zeige(symbol: WetterSymbol | undefined, at: Screen | undefined): void;
    /** Die Kennung des Icons, dessen Infopanel gerade offen ist (es trägt den Ton der Auswahl). */
    offen(): string | undefined;
}

type Anspruch = Claim & { readonly symbol: WetterSymbol };

export function installWetterInfo(
    interaction: MapInteractionCoordinator,
    symbole: Symbolebene,
    editorOffen: () => boolean,
    info: WetterInfoAnschluss,
): () => void {
    const owner: InteractionOwner<Anspruch> = {
        id: "wetter-info",
        priority: INTERACTION_PRIORITY["wetter-info"],
        kinds: ["click", "hover"],
        layers: () => [],
        enabled: () => !editorOffen(),
        hit(context) {
            const symbol = symbole.infoTreffer(context.point.x, context.point.y);
            return symbol === undefined ? undefined : { cursor: "pointer", symbol };
        },
        apply(kind, anspruch, context) {
            if (kind === "hover") info.zeige(anspruch.symbol, context.screen);
            else if (kind === "click") info.oeffne(anspruch.symbol, context.screen);
        },
        lost() {
            info.zeige(undefined, undefined);
        },
    };
    return interaction.register(owner as InteractionOwner);
}
