import type { Locale } from "../i18n/plural";

/**
 * Die Flaggen des Sprachschalters (Kanal OPS-000014, Thomas 2026-10-15: „Wie wäre es, wenn anstatt den Kürzeln bei der
 * Sprache kleine Flaggen der Länder zu sehen wären“; Betreiber 2026-10-16: Variante b, Flagge **zusätzlich** zu Kürzel
 * und Name, „für englisch - mach doch eine halbe US (links) und eine halbe GB (rechts)“).
 *
 * 🔴 **Gezeichnet, nicht geladen** (Design Guide §6): keine Bilddateien, keine Emoji-Flaggen. Emoji sähen auf jedem
 * System anders aus — Windows zeichnet sie gar nicht als Flagge, sondern als zwei Buchstaben.
 *
 * 🔴 **`Record<Locale, …>` ist der Wächter.** Eine neue Sprache ohne Flagge ist ein Typfehler, nicht ein leeres Feld,
 * das niemandem auffällt — dieselbe Regel wie bei den Sprachtafeln selbst.
 *
 * 🪤 **Eine Flagge steht für ein Land, eine Sprache nicht.** Englisch ist deshalb geteilt (USA links, Großbritannien
 * rechts), und der Name bleibt daneben stehen: Wer „Nederlands“ sucht, findet es am Wort, nicht am Tuch.
 */

/** Ein Streifen trägt sein Gewicht: Spaniens Gelb ist doppelt so breit wie jeder rote Streifen. */
export interface Streifen {
    readonly art: "streifen";
    readonly richtung: "waagerecht" | "senkrecht";
    readonly farben: readonly string[];
    /** Je Farbe ein Gewicht; ohne Angabe sind alle gleich. */
    readonly gewichte?: readonly number[];
}

/** Ein skandinavisches Kreuz: aus der Mitte nach links versetzt, wie bei allen Flaggen dieser Familie. */
export interface Kreuz {
    readonly art: "kreuz";
    readonly grund: string;
    readonly kreuz: string;
}

/** Zwei halbe Flaggen nebeneinander — für Sprachen, die kein einzelnes Land tragen. */
export interface Geteilt {
    readonly art: "geteilt";
    readonly links: Flagge;
    readonly rechts: Flagge;
}

/** Die zwei Sonderfälle, die sich nicht aus Streifen bauen lassen. */
export interface Eigen {
    readonly art: "usa" | "union";
}

export type Flagge = Streifen | Kreuz | Geteilt | Eigen;

const SCHWARZ = "#000000";
const WEISS = "#ffffff";

export const FLAGGEN: Record<Locale, Flagge> = {
    de: { art: "streifen", richtung: "waagerecht", farben: [SCHWARZ, "#dd0000", "#ffce00"] },
    en: { art: "geteilt", links: { art: "usa" }, rechts: { art: "union" } },
    fr: { art: "streifen", richtung: "senkrecht", farben: ["#002395", WEISS, "#ed2939"] },
    nl: { art: "streifen", richtung: "waagerecht", farben: ["#ae1c28", WEISS, "#21468b"] },
    it: { art: "streifen", richtung: "senkrecht", farben: ["#009246", WEISS, "#ce2b37"] },
    // 🪤 Spanien ist nicht gedrittelt: Rot, Gelb, Rot im Verhältnis 1 : 2 : 1. Gleich breit sähe es falsch aus.
    es: { art: "streifen", richtung: "waagerecht", farben: ["#aa151b", "#f1bf00", "#aa151b"], gewichte: [1, 2, 1] },
    pl: { art: "streifen", richtung: "waagerecht", farben: [WEISS, "#dc143c"] },
    // 🪤 Das skandinavische Kreuz sitzt nicht in der Mitte: Es steht nach links versetzt, bei beiden gleich.
    da: { art: "kreuz", grund: "#c8102e", kreuz: "#ffffff" },
    sv: { art: "kreuz", grund: "#006aa7", kreuz: "#fecc00" },
};

/**
 * Die Streifen als Rechtecke in einem Feld. Reine Rechnung, damit sie ohne Browser prüfbar ist: Die Gewichte teilen
 * die Länge, und der letzte Streifen bekommt den Rest — sonst bliebe bei krummen Teilungen eine Haarlinie frei.
 */
export function streifenRechtecke(
    flagge: Streifen,
    feld: { x: number; y: number; breite: number; hoehe: number },
): { x: number; y: number; breite: number; hoehe: number; farbe: string }[] {
    const laenge = flagge.richtung === "waagerecht" ? feld.hoehe : feld.breite;
    const gewichte = flagge.gewichte ?? flagge.farben.map(() => 1);
    const summe = gewichte.reduce((a, b) => a + b, 0);
    let versatz = 0;
    return flagge.farben.map((farbe, i) => {
        const teil = ((gewichte[i] ?? 1) / summe) * laenge;
        const anfang = versatz;
        versatz += teil;
        const ende = i === flagge.farben.length - 1 ? laenge : versatz;
        return flagge.richtung === "waagerecht"
            ? { x: feld.x, y: feld.y + anfang, breite: feld.breite, hoehe: ende - anfang, farbe }
            : { x: feld.x + anfang, y: feld.y, breite: ende - anfang, hoehe: feld.hoehe, farbe };
    });
}
