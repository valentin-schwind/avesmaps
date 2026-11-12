/**
 * Die Regeln des Menüknopfs (`avm-menueknopf.vue`, WI-0122 zweiter Nachtrag), ohne Vue und ohne Browser: welcher Eintrag beim
 * Öffnen den Fokus bekommt und was eine Taste im offenen Menü tut. Die Tasten sind die der Auswahlliste des Hauses
 * (`area-choice-menu.vue`: Pfeile wandern und laufen um) und die des Menümusters der WAI (Pos1/Ende, Esc schließt, Tab
 * verlässt das Menü). Enter und Leertaste braucht es hier nicht: Ein Eintrag ist ein `<button>`, der Browser klickt ihn.
 */

/** Ein Eintrag des Menüs: der Wert, den er setzt, und das Wort, das er zeigt. */
export interface MenueOption {
    wert: string;
    text: string;
}

/** Was eine Taste im offenen Menü bewirkt. */
export type MenueSchritt =
    | { art: "fokus"; index: number }
    /** Schließen; `zurueck` gibt den Fokus an den Knopf (Esc), sonst geht er seinen eigenen Weg (Tab). */
    | { art: "schliessen"; zurueck: boolean }
    | { art: "nichts" };

/** Beim Öffnen steht der Fokus auf der aktiven Wahl - so sieht und hört man zuerst, was gilt. */
export function startIndex(optionen: readonly MenueOption[], wert: string): number {
    const at = optionen.findIndex((option) => option.wert === wert);
    return at === -1 ? 0 : at;
}

/** Eine Taste im offenen Menü, ausgehend vom Eintrag mit dem Fokus (`index`, -1 heißt keiner). */
export function menueTaste(taste: string, index: number, anzahl: number): MenueSchritt {
    if (anzahl <= 0) return taste === "Escape" ? { art: "schliessen", zurueck: true } : { art: "nichts" };
    switch (taste) {
        case "ArrowDown":
            return { art: "fokus", index: (index + 1 + anzahl) % anzahl };
        case "ArrowUp":
            return { art: "fokus", index: index <= 0 ? anzahl - 1 : index - 1 };
        case "Home":
            return { art: "fokus", index: 0 };
        case "End":
            return { art: "fokus", index: anzahl - 1 };
        case "Escape":
            return { art: "schliessen", zurueck: true };
        case "Tab":
            return { art: "schliessen", zurueck: false };
        default:
            return { art: "nichts" };
    }
}

/**
 * Wo das Menü aufgeht, in Fensterkoordinaten: unter dem Knopf, rechtsbündig mit ihm (`ausrichtung` `links`: linksbündig); reicht der
 * Platz unten nicht, darüber; nie über den Rand (`rand`). Gerechnet aus den Maßen, damit es ohne Browser prüfbar ist.
 */
export function menueLage(
    knopf: { top: number; bottom: number; right: number; left?: number },
    menue: { width: number; height: number },
    fenster: { width: number; height: number },
    abstand: number,
    rand: number,
    ausrichtung: "rechts" | "links" = "rechts",
): { top: number; left: number } {
    const unten = knopf.bottom + abstand;
    const top = unten + menue.height > fenster.height - rand ? knopf.top - abstand - menue.height : unten;
    const wunsch = ausrichtung === "links" && knopf.left !== undefined ? knopf.left : knopf.right - menue.width;
    const left = Math.min(wunsch, fenster.width - rand - menue.width);
    return { top: Math.max(rand, top), left: Math.max(rand, left) };
}

/**
 * Auf welcher Seite ein Knopf steht (Betreiber 2026-10-10: „der filter soll linksbündig sein, wenn er links ist und rechtsbündig wenn er
 * rechts ist“): links der Mitte seines Bereichs (etwa des Fensters) geht das Menü linksbündig auf, sonst rechtsbündig.
 */
export function menueSeite(
    knopf: { left: number; width: number },
    bereich: { left: number; width: number },
): "links" | "rechts" {
    return knopf.left + knopf.width / 2 < bereich.left + bereich.width / 2 ? "links" : "rechts";
}

/**
 * Wie `menueLage`, aber ein Blatt, das weder unter noch über den Knopf passt, wird nicht an den Rand geklemmt (es deckte sonst den Kopf
 * des Fensters; Befund 2026-10-11 am Trichter der Literatur mit dreißig Genres): Es geht auf der Seite mit mehr Platz auf, und `hoehe`
 * begrenzt es auf diesen Platz; das Blatt rollt dann in sich. Passt es, bleibt `hoehe` leer.
 */
export function menueLageBegrenzt(
    knopf: { top: number; bottom: number; right: number; left?: number },
    menue: { width: number; height: number },
    fenster: { width: number; height: number },
    abstand: number,
    rand: number,
    ausrichtung: "rechts" | "links" = "rechts",
): { top: number; left: number; hoehe: number | undefined } {
    const unten = fenster.height - rand - (knopf.bottom + abstand);
    const oben = knopf.top - abstand - rand;
    if (menue.height <= unten || menue.height <= oben) {
        return { ...menueLage(knopf, menue, fenster, abstand, rand, ausrichtung), hoehe: undefined };
    }
    const hoehe = Math.max(unten, oben);
    const { left } = menueLage(knopf, { width: menue.width, height: hoehe }, fenster, abstand, rand, ausrichtung);
    return { top: unten >= oben ? knopf.bottom + abstand : rand, left, hoehe };
}
