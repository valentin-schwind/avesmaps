import type { SubjectCanon, SubjectDetailKind } from "./subject.ts";
import { KANON_BEZEICHNER_MAX, WIKI_NAMESPACE_VORGABE, type WikiNamespaceZeile } from "./wiki-namespaces.ts";

/**
 * Die zwei Tafeln des Kanon-Etiketts, die jede Umgebung selbst führt (WI-0253 B-2; Vali 2026-10-25: „eine tafel je umgebung. man will
 * solche umstiege testen können“). Die Vorgabe steht in diesem Paket; die Datenbank der Umgebung hält nur die Abweichungen
 * (`apps/server/src/kanon/tafel.ts`, Migration 0223), und „zurücksetzen“ löscht die Zeile.
 *
 * 1. **Rang 1, die Namensräume** (`WikiNamespaceZeile`): Nummer, Präfix, Kanon, Kartenobjekte einsammeln, Bezeichner.
 * 2. **Rang 4, die Objektarten** (`KanonObjektartZeile`): Was weder eine Wiki-Zuweisung noch eine Quelle hat, bekommt bei „anzeigen“
 *    das Etikett INOFFIZIELL mit dem Bezeichner der Art (geteilte Pille), sonst keines (die Vorgabe, wie bisher).
 *
 * Alles hier ist rein: keine Datenbank, keine Uhr.
 */

/** Ein Text der Tafeln: Leerraum zusammengezogen und getrimmt. */
export function normalisiereBezeichner(text: string): string {
    return text.replace(/\s+/gu, " ").trim();
}

/** Zeichen eines Textes, gezählt wie PostgreSQL (`char_length`): Codepunkte. */
export function bezeichnerLaenge(text: string): number {
    return [...text].length;
}

/** Ein Fehler der Prüfung, mit dem Feld und einem festen Code (kein Text: den bildet die Oberfläche). */
export interface TafelFehler {
    /** Die Zeile: Nummer des Raums oder Objektart. */
    zeile: number | SubjectDetailKind;
    feld: "ns" | "praefix" | "kanon" | "einsammeln" | "bezeichner" | "anzeigen" | "art";
    code:
        | "ns_ungueltig"
        | "praefix_haupt_leer"
        | "praefix_fehlt"
        | "praefix_ungueltig"
        | "praefix_doppelt"
        | "praefix_fest"
        | "kanon_unbekannt"
        | "wert_kein_wahrheitswert"
        | "bezeichner_zu_lang"
        | "bezeichner_ungueltig"
        | "art_unbekannt";
}

const STEUERZEICHEN = /\p{Cc}/u;

function bezeichnerFehler(text: unknown, zeile: TafelFehler["zeile"]): TafelFehler | null {
    if (typeof text !== "string") return { zeile, feld: "bezeichner", code: "bezeichner_ungueltig" };
    if (text !== normalisiereBezeichner(text) || STEUERZEICHEN.test(text))
        return { zeile, feld: "bezeichner", code: "bezeichner_ungueltig" };
    if (bezeichnerLaenge(text) > KANON_BEZEICHNER_MAX) return { zeile, feld: "bezeichner", code: "bezeichner_zu_lang" };
    return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rang 1: die Namensräume
// ---------------------------------------------------------------------------------------------------------------------

/** Die Tafel der Namensräume einer Umgebung, aufsteigend nach Nummer: die Vorgabe, überdeckt von den Zeilen der Datenbank. */
export type WikiNamespaceTafel = readonly WikiNamespaceZeile[];

/** Die Vorgabe überdeckt von den gespeicherten Zeilen; weitere Nummern kommen hinzu. */
export function wikiNamespaceTafel(abweichungen: readonly WikiNamespaceZeile[] = []): WikiNamespaceTafel {
    const zeilen = new Map<number, WikiNamespaceZeile>(WIKI_NAMESPACE_VORGABE.map((zeile) => [zeile.ns, { ...zeile }]));
    for (const abweichung of abweichungen) zeilen.set(abweichung.ns, { ...abweichung });
    return [...zeilen.values()].sort((links, rechts) => links.ns - rechts.ns);
}

/** Die Vorgabezeile einer Nummer; `undefined` bei einem hinzugefügten Raum. */
export function wikiNamespaceVorgabeZeile(ns: number): WikiNamespaceZeile | undefined {
    return WIKI_NAMESPACE_VORGABE.find((zeile) => zeile.ns === ns);
}

/** Ist die Zeile genau die Vorgabe (dann braucht die Datenbank keine Zeile)? */
export function istNamespaceVorgabe(zeile: WikiNamespaceZeile): boolean {
    const vorgabe = wikiNamespaceVorgabeZeile(zeile.ns);
    return (
        vorgabe !== undefined &&
        vorgabe.praefix === zeile.praefix &&
        vorgabe.kanon === zeile.kanon &&
        vorgabe.einsammeln === zeile.einsammeln &&
        vorgabe.bezeichner === zeile.bezeichner
    );
}

/** Die Prüfung EINER Zeile für sich (die Eindeutigkeit der Präfixe prüft `pruefeNamespaceTafel`). */
export function pruefeNamespaceZeile(zeile: WikiNamespaceZeile): TafelFehler[] {
    const fehler: TafelFehler[] = [];
    const nr = zeile.ns;
    if (!Number.isInteger(nr) || nr < 0 || nr > 2_147_483_647) {
        return [{ zeile: nr, feld: "ns", code: "ns_ungueltig" }];
    }
    const praefix: unknown = zeile.praefix;
    if (
        typeof praefix !== "string" ||
        praefix !== praefix.trim() ||
        STEUERZEICHEN.test(praefix) ||
        praefix.includes(":")
    ) {
        fehler.push({ zeile: nr, feld: "praefix", code: "praefix_ungueltig" });
    } else if (nr === 0 && praefix !== "") {
        fehler.push({ zeile: nr, feld: "praefix", code: "praefix_haupt_leer" });
    } else if (nr !== 0 && praefix === "") {
        fehler.push({ zeile: nr, feld: "praefix", code: "praefix_fehlt" });
    } else if (bezeichnerLaenge(praefix) > KANON_BEZEICHNER_MAX) {
        fehler.push({ zeile: nr, feld: "praefix", code: "praefix_ungueltig" });
    } else {
        // Das Wort eines Raums der Vorgabe ist der Name im Wiki, kein Anzeigetext: Ändert man es, fände kein Titel seinen Raum mehr.
        const vorgabe = wikiNamespaceVorgabeZeile(nr);
        if (vorgabe !== undefined && vorgabe.praefix !== praefix)
            fehler.push({ zeile: nr, feld: "praefix", code: "praefix_fest" });
    }
    if (zeile.kanon !== "offiziell" && zeile.kanon !== "inoffiziell")
        fehler.push({ zeile: nr, feld: "kanon", code: "kanon_unbekannt" });
    if (typeof zeile.einsammeln !== "boolean")
        fehler.push({ zeile: nr, feld: "einsammeln", code: "wert_kein_wahrheitswert" });
    const bezeichner = bezeichnerFehler(zeile.bezeichner, nr);
    if (bezeichner !== null) fehler.push(bezeichner);
    return fehler;
}

/** Die Prüfung der ganzen Tafel: jede Zeile, dazu kein Präfix zweimal (ohne Rücksicht auf Groß- und Kleinschreibung). */
export function pruefeNamespaceTafel(tafel: WikiNamespaceTafel): TafelFehler[] {
    const fehler = tafel.flatMap((zeile) => pruefeNamespaceZeile(zeile));
    const gesehen = new Map<string, number>();
    const nummern = new Set<number>();
    for (const zeile of tafel) {
        if (nummern.has(zeile.ns)) fehler.push({ zeile: zeile.ns, feld: "ns", code: "ns_ungueltig" });
        nummern.add(zeile.ns);
        if (zeile.praefix === "") continue;
        const schluessel = zeile.praefix.toLowerCase();
        if (gesehen.has(schluessel)) fehler.push({ zeile: zeile.ns, feld: "praefix", code: "praefix_doppelt" });
        gesehen.set(schluessel, zeile.ns);
    }
    return fehler;
}

/** Die Zeile einer Nummer; `undefined`: für diesen Raum gibt es keine (er ist kein Inhalt, die Frage stellt sich nicht). */
export function wikiNamespaceZeile(tafel: WikiNamespaceTafel, ns: number): WikiNamespaceZeile | undefined {
    return tafel.find((zeile) => zeile.ns === ns);
}

/**
 * Der Namensraum, den ein TITEL im Wort trägt (Legacy `avesmapsWikiTitleNamespace`, hier mit dem Hauptraum als Ergebnis): 0, wenn der Titel
 * kein bekanntes Präfix trägt, sonst die Nummer dieses Raums.
 *
 * 🔴 NUR BEKANNTE PRÄFIXE ZÄHLEN, nie „alles vor dem ersten Doppelpunkt“: Aventurische Titel tragen reichlich Doppelpunkte, die keine Räume
 * sind („Aventurien: Das Lexikon des Schwarzen Auges“). Der Vergleich ist fallunabhängig (MediaWiki stellt den ersten Buchstaben frei). Ein
 * Raum, den die Tafel nicht kennt (Kategorie, Datei …), ergibt 0: Der Aufrufer fragt für den Titel eines ZUGEWIESENEN Artikels, nie für eine
 * beliebige Seite. Ein Namensraum wird nie aus dem Slug eines Schlüssels geraten.
 */
export function wikiNamespaceAusTitel(titel: string, tafel: WikiNamespaceTafel = wikiNamespaceTafel()): number {
    const stelle = titel.indexOf(":");
    if (stelle <= 0) return 0;
    const wort = titel.slice(0, stelle).trim().toLowerCase();
    if (wort === "") return 0;
    return tafel.find((zeile) => zeile.praefix !== "" && zeile.praefix.toLowerCase() === wort)?.ns ?? 0;
}

/** Das Wort eines Raums (`ns_name`): das Präfix der Tafel, im Hauptraum leer; `null` für einen Raum, den die Tafel nicht kennt. */
export function wikiNamespaceName(tafel: WikiNamespaceTafel, ns: number): string | null {
    return wikiNamespaceZeile(tafel, ns)?.praefix ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rang 4: die Objektarten
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Die Objektarten der Tafel, in der Reihenfolge der Oberfläche: Orte, Wege, Landschaften, Herrschaftsgebiete, Kraftlinien, Gipfel. Es
 * sind die Träger des Kanons (`SubjectDetailKind`); eine Art ohne Zeile gibt es nicht.
 */
export const KANON_OBJEKTARTEN = [
    "place",
    "path",
    "area",
    "territory",
    "powerline",
    "peak",
] as const satisfies readonly SubjectDetailKind[];
export type KanonObjektart = (typeof KANON_OBJEKTARTEN)[number];

/** Eine Zeile der Tafel Rang 4. */
export interface KanonObjektartZeile {
    art: KanonObjektart;
    /** Bekommt ein Objekt dieser Art ohne Wiki-Zuweisung und ohne Quelle das Etikett INOFFIZIELL? Vorgabe nein: kein Etikett, wie bisher. */
    anzeigen: boolean;
    /** Der Bezeichner rechts in der Pille (Vorschlag „Avesmaps“); leer = runde Pille. */
    bezeichner: string;
}

/** Der Vorschlag für den Bezeichner (Vali 2026-10-25). */
export const KANON_OBJEKTART_BEZEICHNER = "Avesmaps";

export const KANON_OBJEKTART_VORGABE: readonly KanonObjektartZeile[] = KANON_OBJEKTARTEN.map((art) => ({
    art,
    anzeigen: false,
    bezeichner: KANON_OBJEKTART_BEZEICHNER,
}));

/** Die Tafel Rang 4 einer Umgebung: eine Zeile je Art, die Vorgabe überdeckt von den gespeicherten Zeilen. */
export function kanonObjektartTafel(abweichungen: readonly KanonObjektartZeile[] = []): readonly KanonObjektartZeile[] {
    const zeilen = new Map<KanonObjektart, KanonObjektartZeile>(
        KANON_OBJEKTART_VORGABE.map((zeile) => [zeile.art, { ...zeile }]),
    );
    for (const abweichung of abweichungen) zeilen.set(abweichung.art, { ...abweichung });
    return KANON_OBJEKTARTEN.map((art) => zeilen.get(art)!);
}

/** Die Vorgabezeile einer Art. */
export function kanonObjektartVorgabe(art: KanonObjektart): KanonObjektartZeile {
    return KANON_OBJEKTART_VORGABE.find((zeile) => zeile.art === art)!;
}

/** Ist die Zeile genau die Vorgabe (dann braucht die Datenbank keine Zeile)? */
export function istObjektartVorgabe(zeile: KanonObjektartZeile): boolean {
    const vorgabe = KANON_OBJEKTART_VORGABE.find((kandidat) => kandidat.art === zeile.art);
    return vorgabe !== undefined && vorgabe.anzeigen === zeile.anzeigen && vorgabe.bezeichner === zeile.bezeichner;
}

export function istKanonObjektart(wert: unknown): wert is KanonObjektart {
    return typeof wert === "string" && (KANON_OBJEKTARTEN as readonly string[]).includes(wert);
}

export function pruefeObjektartZeile(zeile: KanonObjektartZeile): TafelFehler[] {
    const art: unknown = zeile.art;
    if (!istKanonObjektart(art)) return [{ zeile: art as SubjectDetailKind, feld: "art", code: "art_unbekannt" }];
    const fehler: TafelFehler[] = [];
    if (typeof zeile.anzeigen !== "boolean")
        fehler.push({ zeile: art, feld: "anzeigen", code: "wert_kein_wahrheitswert" });
    const bezeichner = bezeichnerFehler(zeile.bezeichner, art);
    if (bezeichner !== null) fehler.push(bezeichner);
    return fehler;
}

/**
 * Rang 4 zur Lesezeit (Koordination 2026-10-25: aufgelöst beim Lesen, die Kanon-Zeilen werden dafür nicht umgeschrieben): Hat ein Objekt
 * KEINE Kanon-Zeile, also weder eine Wiki-Zuweisung noch eine Quelle noch eine Publikation, entscheidet die Tafel seiner Art. Bei
 * „anzeigen“ ist es INOFFIZIELL mit dem Bezeichner der Art (leer: runde Pille), sonst bleibt es ohne Etikett.
 *
 * 🔴 Eine Zeile gewinnt immer, auch `unlabelled`: Sie heißt „Verweise da, aber nichts zu sagen“ (Legacys Stand für ein Objekt mit nur
 * Publikationen, der Dommel-Fall). Mit der Entscheidung vom 2026-10-25 (ohne Wiki zählen Publikationen wie Quellen, Rang 2/3) bekommt es
 * beim Neuberechnen ein Etikett; bis dahin darf Rang 4 es nicht überdecken, denn es HAT Publikationen.
 */
export function kanonMitRang4(zeile: SubjectCanon | undefined, art: KanonObjektartZeile): SubjectCanon | undefined {
    if (zeile !== undefined) return zeile;
    if (!art.anzeigen) return undefined;
    return { canon: "unofficial", ...(art.bezeichner === "" ? {} : { designatorLabel: art.bezeichner }) };
}
