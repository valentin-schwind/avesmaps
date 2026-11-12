import { formatNumber } from "../i18n/i18n";

/**
 * Was die Schiene eines Fensters rechnet (Guide §13.12, WI-0127 SYS-1; Bauteil `fenster-schiene.vue`). Reine Funktionen, damit
 * Vitest sie ohne Browser prüft.
 */

/**
 * - `ansicht`: wählt, was der Rumpf zeigt.
 * - `verweis`: öffnet eine eigene Seite in einem neuen Tab (die Statusseite, WI-0119 E6), mit ↗.
 * - `spaeter`: steht gestrichelt und gedämpft da und lässt sich nicht wählen („Claudio“ bis WI-0124).
 */
export type SchienenArt = "ansicht" | "verweis" | "spaeter";

export interface SchienenEintrag {
    id: string;
    name: string;
    art: SchienenArt;
    /** Eine Zählung gehört in die Beschriftung, die sie zählt (Guide §13.12): „Personen (7)“. */
    zahl?: number | undefined;
    /** Der Stand rechts in der festen Spalte („Normal“, „2 aus“, „später“). */
    wert?: string | undefined;
    /** Nur `verweis`. */
    href?: string | undefined;
}

export interface SchienenBereich {
    id: string;
    name: string;
    eintraege: readonly SchienenEintrag[];
}

export interface AuswahlOption {
    wert: string;
    text: string;
    gesperrt?: boolean;
}

/** Die Beschriftung eines Eintrags, mit Zählung in Klammern, wenn er eine hat. */
export function eintragName(eintrag: SchienenEintrag): string {
    return eintrag.zahl === undefined ? eintrag.name : `${eintrag.name} (${formatNumber(eintrag.zahl, 0)})`;
}

/** Die Unterzeile eines zugeklappten Bereichs: was darin steht, ohne Zählung („Personen, Einladungen, …“). */
export function unterzeile(bereich: SchienenBereich): string {
    return bereich.eintraege.map((eintrag) => eintrag.name).join(", ");
}

/** Der Bereich, in dem ein Eintrag steht; er ist beim Öffnen aufgeklappt. */
export function bereichVon(bereiche: readonly SchienenBereich[], id: string): string | undefined {
    return bereiche.find((bereich) => bereich.eintraege.some((eintrag) => eintrag.id === id))?.id;
}

/**
 * Am Telefon wird die Schiene eine Auswahl (Blatt A4: „System & Betrieb › Betriebszustand“). Ein späterer Eintrag steht
 * gesperrt mit seinem Stand darin; ein Verweis fehlt, er steht als Link neben der Auswahl: Einen neuen Tab aus der Wahl in einer
 * Auswahl heraus zu öffnen, hält mancher Popup-Sperrer an, ein Link nie.
 *
 * 🔴 `ohneKopf` lässt den Bereich auch hier weg. Wo die Schiene keine Bereichsköpfe zeigt, benennt die Auswahl sonst eine
 * Gliederung, die es auf dem Bildschirm gar nicht gibt (Betreiber 2026-10-14 zur Systemsteuerung).
 */
export function auswahlOptionen(bereiche: readonly SchienenBereich[], ohneKopf = false): AuswahlOption[] {
    return bereiche.flatMap((bereich) =>
        bereich.eintraege
            .filter((eintrag) => eintrag.art !== "verweis")
            .map((eintrag) =>
                eintrag.art === "spaeter"
                    ? {
                          wert: eintrag.id,
                          text: `${ohneKopf ? "" : `${bereich.name} › `}${eintrag.name}${eintrag.wert ? ` (${eintrag.wert})` : ""}`,
                          gesperrt: true,
                      }
                    : { wert: eintrag.id, text: `${ohneKopf ? "" : `${bereich.name} › `}${eintragName(eintrag)}` },
            ),
    );
}

/** Die Verweise aller Bereiche, für die Leiste am Telefon. */
export function verweise(bereiche: readonly SchienenBereich[]): SchienenEintrag[] {
    return bereiche.flatMap((bereich) => bereich.eintraege.filter((eintrag) => eintrag.art === "verweis"));
}

/**
 * Pfeiltasten in der Schiene (SYS-0001 §6.8: „Schiene mit Pfeiltasten und Enter“): ↓ und ↑ wandern über alles, was sich
 * bedienen lässt (Bereichsköpfe, Einträge, Verweise), an den Enden im Kreis; Pos1 und Ende springen an die Ränder. Enter und
 * Leertaste übernimmt der Knopf selbst.
 */
export function naechsterFokus(taste: string, index: number, anzahl: number): number | null {
    if (anzahl === 0) return null;
    if (taste === "ArrowDown") return index < 0 ? 0 : (index + 1) % anzahl;
    if (taste === "ArrowUp") return index < 0 ? anzahl - 1 : (index + anzahl - 1) % anzahl;
    if (taste === "Home") return 0;
    if (taste === "End") return anzahl - 1;
    return null;
}
