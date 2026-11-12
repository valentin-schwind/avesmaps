import type { AnlegenArt } from "./anlegen";
import { deckungsgleich } from "./rechnung";

/**
 * Die neue Kraftlinie im Modus „Anlegen“ (WI-0205 K9; Spalte „Kraftlinie“ der Tafel im Kopf von `anlegen.ts`; Blatt Kraftlinien R4,
 * Legacy `create_powerline`): ein gerader Abschnitt von Nodix zu Nodix.
 *
 * - **Nur Nodices** sind Ziele: Orte und Beschriftungen mit dem Merkmal (`ort`, `label`) und Kraftlinienpunkte (`ecke`, wie beim
 *   Umhängen eines Endes, `kraftlinieneditor/kraftlinie-art.ts`). Ein Klick daneben setzt nichts (`nurZiele`, R4: kein
 *   Zwischenpunkt, kein freies Ende); Strg löst nichts (`loesen: false`, G4).
 * - **Am Nodix beendet** der Klick: Der zweite Nodix schließt ab, nie der, an dem es begann.
 * - Gezeichnet gerade, wie die Linie gespeichert wird (kein Bogen; den gibt „Kurve bearbeiten“ danach).
 */
export const KRAFTLINIE_ANLEGEN: AnlegenArt = {
    id: "kraftlinie",
    teilart: "linie",
    rundung: (punkte) => [...punkte],
    ziele: () => ["ort", "label", "ecke"],
    amZiel: () => "beenden",
    zielErlaubt: (ziel, punkte) => punkte[0] === undefined || !deckungsgleich(ziel.at, punkte[0]),
    nurZiele: true,
    mindestens: 2,
    pruefe(punkte) {
        const anfang = punkte[0];
        const ende = punkte.at(-1);
        if (punkte.length < 2 || anfang === undefined || ende === undefined) return "zuWenig";
        return deckungsgleich(anfang, ende) ? "aufeinander" : undefined;
    },
    loesen: false,
};
