import { SPRACHE_FILL_LAYER_ID } from "../sprachen-layers";
import { sprachenAnStelle, type SpracheAnStelle } from "../sprachen-auswahl";
import { INTERACTION_PRIORITY } from "./priorities";
import type { Claim, InteractionOwner, Screen } from "./types";

/**
 * Die Sprache unter dem Zeiger (WI-0261 S5b; Bauvorlage: die Probierseite vom 2026-10-30, `karte.js` `hoverPruefen` und `klick`, `app.js` `karteKlick`).
 *
 * - **Zeigen** hebt die Sprache mit der kleinsten Teilfläche an dieser Stelle hervor (`sprachen-auswahl.ts`) und zeigt die Hand; das Schild nennt sie und, wo
 *   eine zweite darunter liegt, das Mischgebiet.
 * - **Klick** auf EINE Sprache wählt sie: Infobox auf, die Kamera fliegt auf ihre Hauptteile, die Fläche steht gewählt. Liegen an der Stelle MEHRERE (ein
 *   Mischgebiet, E2), öffnet der Klick erst das kleine Menü am Zeiger mit allen (Hausregel „Menü klein am Zeiger“). Abweichung von der Bauvorlage, bewusst: Dort
 *   ging das Menü auch über einer einzigen Sprache auf; ein Menü mit einem Eintrag ist ein Klick mehr ohne Wahl.
 *
 * Sprachflächen gibt es nur in der Ebene „Sprachen“; wo keine gezeichnet sind, trifft der Besitzer nichts und braucht keine eigene Bedingung (wie das Klimaband).
 */

interface SprachClaim extends Claim {
    sprachen: readonly SpracheAnStelle[];
}

export function spracheOwner(input: {
    /** Eine Sprache an der Stelle: sie wählen. `at` ist die Stelle des Klicks (Fensterkoordinaten). */
    select: (sprache: SpracheAnStelle, at: Screen) => void;
    /** Mehrere Sprachen an der Stelle: das Menü am Zeiger. */
    choose: (sprachen: readonly SpracheAnStelle[], at: Screen) => void;
    /** Die gezeigte Sprache samt allen an dieser Stelle; `undefined` nimmt Hervorhebung und Schild weg. */
    hover?: (sprachen: readonly SpracheAnStelle[] | undefined, at: Screen | undefined) => void;
}): InteractionOwner<SprachClaim> {
    return {
        id: "sprache",
        priority: INTERACTION_PRIORITY.sprache,
        kinds: ["click", "hover"],
        layers: () => [SPRACHE_FILL_LAYER_ID],
        hit(context) {
            const sprachen = sprachenAnStelle(context.features([SPRACHE_FILL_LAYER_ID]));
            return sprachen.length === 0 ? undefined : { sprachen, cursor: "pointer" };
        },
        apply(kind, { sprachen }, context) {
            if (kind === "hover") {
                input.hover?.(sprachen, context.screen);
                return;
            }
            if (kind !== "click") return;
            const [erste] = sprachen;
            if (erste === undefined) return;
            if (sprachen.length === 1) input.select(erste, context.screen);
            else input.choose(sprachen, context.screen);
        },
        lost() {
            input.hover?.(undefined, undefined);
        },
    };
}
