import type { WikisyncEigentuemer, WikisyncWirkung } from "@avesmaps3d/shared";

/**
 * Wem ein Feld gehört und was eine Übernahme damit täte (WI-0253 C; Work Item §3 Punkt 3 und 4). Die Herkunft liegt in der Datenbank an DREI Stellen
 * mit verschiedenen Wörtern:
 *
 * - `field_origin` (Migration 0183): `wiki` | `manual`, ein Vermerk je Objekt und Feld; ein fehlender Vermerk heißt „kein Vermerk“;
 * - `place_detail.einwohner_origin` / `lage_origin` / `oberhaupt_origin`: `wiki` | `manual` | NULL (NULL: nicht bekannt, nie als Wiki gelesen);
 * - `territory_detail_field_origin` (Migration 0076): `wiki` | `override` (`override` ist Legacys Wort für eine Redaktionsentscheidung, bei uns `manual`).
 *
 * Dazu kommt die Zuordnung des Objekts zum Artikel (`*_wiki_assignment.assignment_state` / `assignment_origin`, `territory_detail.state`): getrennt oder
 * unterdrückt, bewusst von der Redaktion. Diese Datei bildet alle diese Quellen auf EINE Sprache ab (die sechs Eigentümer) und legt in einer Tabelle fest,
 * was jeder Eigentümer für die Wirkung bedeutet. Die Tabelle ist die einzige Stelle; Plan, Bericht und spätere Übernahme lesen sie hier.
 *
 * 🔴 „Unbekannt“ ist weder NULL noch leer: Ein Wert ist da, aber nichts belegt, woher er stammt (oder der Vermerk widerspricht dem Schnappschuss). Er wird
 * nie überschrieben; er ist ein Befund. Ein Feld ohne Wert (NULL) hat nichts zu schützen und folgt dem Wiki. Ein BEWUSST leeres Feld (`""`) ist eine eigene
 * Entscheidung und gilt nur mit dem Vermerk `manual`.
 */

/** Der Zustand der Zuordnung des Objekts zum Artikel (`assignment_state`: assigned, address_only, separated, suppressed). */
export type Zuweisungszustand = "zugewiesen" | "nur_adresse" | "getrennt" | "unterdrueckt";

/** Wer die Zuordnung gesetzt hat (`assignment_origin`). `editor` und `wiki_sync` sind für die spätere Redaktion und die Übernahme reserviert. */
export type ZuweisungsHerkunft = "legacy_editor" | "legacy_verlauf_sync" | "unknown" | "editor" | "wiki_sync" | "bulk";

/**
 * Der Vermerk zum Feld, vereinheitlicht: `wiki` und `manual` wie gespeichert; `kein`: das Feld führt Vermerke, dieses hat keinen; `ungefuehrt`: das Feld
 * führt gar keine Herkunft (es steht nur im Wiki-Schnappschuss und ist nach Bau wiki-eigen).
 */
export type Vermerk = "wiki" | "manual" | "kein" | "ungefuehrt";

export type FeldWertZustand = "kein" | "leer" | "text";

export interface HerkunftsEingabe {
    zuweisung: Zuweisungszustand;
    wert: FeldWertZustand;
    vermerk: Vermerk;
    /** Liefert der Legacy-Zug diesen Bereich noch? Dann gehören seine wiki-eigenen Felder ihm, nicht dem WikiSync (§3 Punkt 7). */
    bereichBeiLegacy: boolean;
}

/**
 * Der Eigentümer eines Felds. Die erste zutreffende Zeile gilt:
 *
 * | # | Bedingung                                         | Eigentümer                         |
 * |---|---------------------------------------------------|------------------------------------|
 * | 1 | Zuordnung getrennt                                | `getrennt`                         |
 * | 2 | Zuordnung unterdrückt                             | `unterdrueckt`                     |
 * | 3 | Wert bewusst leer, Vermerk `manual`               | `manual`                           |
 * | 4 | Wert bewusst leer, anderer Vermerk                | `unbekannt` (ein Leerwert ohne Entscheidung) |
 * | 5 | Vermerk `manual`                                  | `manual`                           |
 * | 6 | Vermerk `wiki` oder `ungefuehrt`                  | `legacy` bei Legacy-Bereich, sonst `wiki` |
 * | 7 | kein Vermerk, kein Wert                           | `legacy` bei Legacy-Bereich, sonst `wiki` (nichts zu schützen) |
 * | 8 | kein Vermerk, Wert da                             | `unbekannt`                        |
 */
export function leiteEigentuemerAb(eingabe: HerkunftsEingabe): WikisyncEigentuemer {
    if (eingabe.zuweisung === "getrennt") return "getrennt";
    if (eingabe.zuweisung === "unterdrueckt") return "unterdrueckt";
    if (eingabe.wert === "leer") return eingabe.vermerk === "manual" ? "manual" : "unbekannt";
    if (eingabe.vermerk === "manual") return "manual";
    const folgtDemWiki = eingabe.bereichBeiLegacy ? "legacy" : "wiki";
    if (eingabe.vermerk === "wiki" || eingabe.vermerk === "ungefuehrt") return folgtDemWiki;
    return eingabe.wert === "kein" ? folgtDemWiki : "unbekannt";
}

/**
 * Wem die ZUORDNUNG selbst gehört (die Zeile „Wiki-Zuordnung“ eines Befunds): getrennt und unterdrückt nach dem Zustand, sonst nach dem, der sie gesetzt
 * hat. Eine Zuordnung aus dem Legacy-Editor oder dem Verlauf-Sync ist Legacys Entscheidung; `editor` ist eine eigene Entscheidung; `wiki_sync` stammt vom
 * Wiki; `unknown` und `bulk` sind nicht belegt.
 */
export function leiteZuweisungsEigentuemerAb(
    zustand: Zuweisungszustand,
    herkunft: ZuweisungsHerkunft | null,
): WikisyncEigentuemer {
    if (zustand === "getrennt") return "getrennt";
    if (zustand === "unterdrueckt") return "unterdrueckt";
    switch (herkunft) {
        case "legacy_editor":
        case "legacy_verlauf_sync":
            return "legacy";
        case "editor":
            return "manual";
        case "wiki_sync":
            return "wiki";
        default:
            return "unbekannt";
    }
}

/**
 * Was eine Übernahme mit dem Feld täte, je Eigentümer:
 *
 * | Eigentümer                              | Wirkung        | warum                                                         |
 * |-----------------------------------------|----------------|---------------------------------------------------------------|
 * | `wiki`                                  | `uebernommen`  | der Wert folgt dem Wiki                                       |
 * | `manual`                                | `eigen`        | die eigene Entscheidung gewinnt immer                         |
 * | `legacy`                                | `befund`       | der Legacy-Zug schreibt den Bereich noch                      |
 * | `unterdrueckt`, `getrennt`              | `befund`       | eine bewusste Entscheidung bleibt; kein Wiederbeleben          |
 * | `unbekannt`                             | `befund`       | die Herkunft ist nicht belegt; im Zweifel gilt die vorsichtige Seite |
 */
export function leiteWirkungAb(eigentuemer: WikisyncEigentuemer): WikisyncWirkung {
    switch (eigentuemer) {
        case "wiki":
            return "uebernommen";
        case "manual":
            return "eigen";
        default:
            return "befund";
    }
}

/** Der Zustand einer Zuordnung aus der Spalte `assignment_state`; ein unbekanntes Wort ist ein Programmierfehler der Tafel und gilt als gesperrt. */
export function zuweisungszustandAus(wert: string): Zuweisungszustand {
    switch (wert) {
        case "assigned":
            return "zugewiesen";
        case "address_only":
            return "nur_adresse";
        case "separated":
            return "getrennt";
        default:
            return "unterdrueckt";
    }
}

export function zuweisungsHerkunftAus(wert: string | null): ZuweisungsHerkunft | null {
    switch (wert) {
        case "legacy_editor":
        case "legacy_verlauf_sync":
        case "unknown":
        case "editor":
        case "wiki_sync":
        case "bulk":
            return wert;
        default:
            return null;
    }
}

/** Der Vermerk aus dem Wort einer Herkunftstafel: `wiki`, `manual`, bei den Gebieten `override` (Legacys Redaktionstext); alles andere (NULL) heißt kein Vermerk. */
export function vermerkAus(wert: string | null | undefined): Vermerk {
    if (wert === "wiki") return "wiki";
    if (wert === "manual" || wert === "override") return "manual";
    return "kein";
}
