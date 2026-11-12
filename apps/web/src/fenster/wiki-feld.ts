/**
 * Die Rechnung des Wiki-Felds (WI-0225; EDIT-0003 G6, F24; Design Guide §13.8 „Ein Wiki-Feld bauen“): Welcher Zustand eine Feldzeile
 * mit Wiki-Wert hat, abgeleitet aus dem eigenen Wert, dem Wiki-Wert und der Herkunft. Kein Editor setzt einen Zustand von Hand; das
 * Bauteil `wiki-feld.vue` zeichnet nur, was diese Rechnung sagt. Reine Rechnung ohne Vue, damit Vitest sie prüft.
 *
 * - **Der Wiki-Wert hat drei Fälle** (abgestimmt mit der Wiki-Zuordnung, WI-0205, und den Gebieten, WI-0209): ein Wert (Text oder Zahl)
 *   ist bekannt; `null` heißt, das Wiki kennt keinen Wert (↺ leert das Feld); `undefined` heißt unbekannt (der Schlüssel fehlt, etwa
 *   bei Gebieten, deren Wiki-Wert Legacys Export nie lieferte): kein Durchstreichen, kein ↺.
 * - **Verglichen wird getrimmt, als Text in der Schreibweise des Felds** (`formatiere`, etwa der Tausenderpunkt einer Zahl).
 * - **Abgebildete Felder** (Wegtyp, Art einer Derographie-Fläche) vergleichen den eigenen Schlüssel mit dem zugeordneten (`zuordnung`);
 *   ohne Zuordnung steht der Wiki-Text kursiv mit „?“, und ↺ bleibt still.
 * - **Herkunft** (Modell c der Orchestrierung, 2026-10-18): ↺ setzt Wert UND Herkunft wiki, getippt ist manual. Mit Herkunft wiki heißt
 *   der gleiche Wert „folgt dem Wiki“, sonst „gleicher Wert“; beide sehen gleich aus (§13.8). Wie eine Art im EINEN Entwurf (O3) die
 *   Herkunft führt, steht unten bei `WikiFelder`: EINE Regel für alle Arten, damit kein Editor sie anders rechnet.
 */

import type { FeldHerkuenfte, FeldHerkunft, WikiArtikel, WikiFeldAenderung } from "@avesmaps3d/shared";

/** Der Wiki-Wert eines Felds: bekannt (Text, Zahl), `null` (das Wiki kennt keinen), `undefined` (unbekannt). */
export type WikiWert = string | number | null | undefined;

export type WikiFeldZustand =
    /** Herkunft wiki, der Wert ist der Wiki-Wert. */
    | "folgt"
    /** Eigener Wert gleich dem Wiki-Wert. */
    | "gleich"
    /** Eigener Wert weicht ab: Beschriftung braun, Wiki-Wert durchgestrichen hinter der Beschriftung, ↺ wach. */
    | "weicht"
    /** Das Feld hat im Wiki kein Gegenstück: kein ↺, die Spalte bleibt. */
    | "ohne"
    /** Der Wiki-Wert ist unbekannt: wie „ohne“, der Zettel an der Beschriftung sagt es. */
    | "unbekannt"
    /** Nur das Wiki führt das Feld, oder es fehlt das Schreibrecht: kein ↺, bei Abweichung bleibt der Wiki-Wert als Auskunft. */
    | "lesend"
    /** Wiki-Text ohne Zuordnung zu unserem Schlüssel: kursiv mit „?“, ↺ still. */
    | "unzugeordnet";

export interface WikiFeldLage {
    readonly zustand: WikiFeldZustand;
    /** Der eigene Wert weicht vom Wiki-Wert ab (Beschriftung braun); auch bei „lesend“. */
    readonly abweichend: boolean;
    /** Was hinter der Beschriftung steht: der Wiki-Wert als Text; `null`: „(leer)“, das Wiki kennt keinen Wert; fehlt: nichts. */
    readonly wikiText?: string | null;
    /** ↺ ist wach (nur bei „weicht“). */
    readonly zurueck: boolean;
    /** Es gibt eine ↺-Taste in der Zeile (still oder wach); ohne sie bleibt nur die leere Spalte. */
    readonly mitZurueck: boolean;
}

export interface WikiFeldEingabe {
    /** Der Wert im Entwurf; `null` oder leer heißt kein Wert. */
    readonly eigen: string | number | null;
    readonly wiki: WikiWert;
    /** `false`: Das Feld hat im Wiki kein Gegenstück (Zustand „ohne“). Vorgabe `true`. */
    readonly mitWiki?: boolean;
    /** Woher der Wert kommt; ohne Angabe heißt der gleiche Wert „gleich“. */
    readonly herkunft?: "wiki" | "manual" | undefined;
    readonly lesend?: boolean;
    /** Abgebildete Felder: Wiki-Text → unser Schlüssel; `undefined`: keine Zuordnung. */
    readonly zuordnung?: ((wikiText: string) => string | undefined) | undefined;
    /** Wie das Feld einen Wert zeigt (Zahlen, Schlüssel); ohne Angabe der Text selbst. */
    readonly formatiere?: ((wert: string | number) => string) | undefined;
}

const OHNE: WikiFeldLage = { zustand: "ohne", abweichend: false, zurueck: false, mitZurueck: false };
const UNBEKANNT: WikiFeldLage = { zustand: "unbekannt", abweichend: false, zurueck: false, mitZurueck: false };

export function wikiLage(eingabe: WikiFeldEingabe): WikiFeldLage {
    if (eingabe.mitWiki === false) return OHNE;
    const { wiki } = eingabe;
    if (wiki === undefined) return UNBEKANNT;
    const alsText = (wert: string | number): string =>
        (eingabe.formatiere === undefined ? String(wert) : eingabe.formatiere(wert)).trim();
    const eigen = eingabe.eigen === null ? "" : alsText(eingabe.eigen);

    let soll: string;
    let wikiText: string | null;
    if (wiki === null) {
        soll = "";
        wikiText = null;
    } else if (eingabe.zuordnung !== undefined) {
        const roh = String(wiki).trim();
        const schluessel = eingabe.zuordnung(roh);
        if (schluessel === undefined) {
            return {
                zustand: "unzugeordnet",
                abweichend: false,
                wikiText: roh,
                zurueck: false,
                mitZurueck: !eingabe.lesend,
            };
        }
        soll = alsText(schluessel);
        wikiText = roh;
    } else {
        soll = alsText(wiki);
        wikiText = soll;
    }

    const abweichend = eigen !== soll;
    if (eingabe.lesend === true) {
        return abweichend
            ? { zustand: "lesend", abweichend, wikiText, zurueck: false, mitZurueck: false }
            : { zustand: "lesend", abweichend, zurueck: false, mitZurueck: false };
    }
    if (abweichend) return { zustand: "weicht", abweichend, wikiText, zurueck: true, mitZurueck: true };
    return {
        zustand: eingabe.herkunft === "wiki" ? "folgt" : "gleich",
        abweichend,
        zurueck: false,
        mitZurueck: true,
    };
}

/** Für „↺ Alles auf Wiki-Werte (n)“ (WI-0183): wie viele Felder abweichen und zurückgesetzt werden können. */
export const abweichende = (lagen: readonly WikiFeldLage[]): number => lagen.filter((lage) => lage.zurueck).length;

/**
 * Die Entwurfsfelder einer Art mit Wiki-Feldern (O3, `fenster/bearbeitung.ts`): der Artikel der Wiki-Zuordnung (`wiki`, WI-0205) und
 * die Herkunft je Feld, gelesen aus dem Detail der Art (`herkunft`, `packages/shared/src/feld-herkunft.ts`) und im Entwurf
 * fortgeschrieben. Die Regel (Modell c):
 *
 * - **Tippen** setzt Wert und Herkunft manual: `mitHerkunft(f, schluessel, wert, "manual")`, auch beim Wortlaut des Wiki.
 * - **↺** setzt Wert und Herkunft wiki: `aufWikiWert(f, schluessel)` ist der Griff `art.aufWiki`; ein abgebildetes Feld (Wegtyp, Art
 *   einer Fläche) gibt seine `zuordnung` mit.
 * - **„Fertig“** schreibt je geändertem Feld `wikiAenderung(jetzt, schluessel)`: Herkunft wiki wird `{ revert: "wiki" }` (der Server holt
 *   den Wert aus seinem Schnappschuss), sonst `{ value }`. Geändert ist ein Feld, dessen WERT sich geändert hat; die Herkunft allein
 *   schreibt nichts.
 */
export interface WikiFelder {
    readonly wiki?: WikiArtikel | null | undefined;
    readonly herkunft: FeldHerkuenfte;
}

/** Der Wiki-Wert eines Felds im Entwurf: bekannt, `null` (das Wiki kennt keinen) oder `undefined` (kein Artikel, kein Schlüssel). */
export const wikiWertIm = (felder: WikiFelder, schluessel: string): WikiWert => felder.wiki?.werte[schluessel];

/** Woher der Wert eines Felds im Entwurf kommt (der Griff `art.herkunft`); `undefined`: kein Vermerk. */
export const herkunftIm = (felder: WikiFelder, schluessel: string): FeldHerkunft | undefined =>
    felder.herkunft[schluessel];

/** Ein Feld setzen und seine Herkunft mit. */
export function mitHerkunft<F extends WikiFelder>(
    felder: F,
    schluessel: string,
    wert: unknown,
    herkunft: FeldHerkunft,
): F {
    return { ...felder, [schluessel]: wert, herkunft: { ...felder.herkunft, [schluessel]: herkunft } };
}

/**
 * ↺: das Feld auf seinen Wiki-Wert, Herkunft wiki. `null` leert das Feld (das Wiki kennt keinen Wert). Unbekannt oder ohne Zuordnung
 * bleibt alles, wie es ist (dort ist ↺ still).
 */
export function aufWikiWert<F extends WikiFelder>(
    felder: F,
    schluessel: string,
    zuordnung?: (wikiText: string) => string | undefined,
): F {
    const wiki = wikiWertIm(felder, schluessel);
    if (wiki === undefined) return felder;
    const wert = wiki === null || zuordnung === undefined ? wiki : zuordnung(String(wiki).trim());
    return wert === undefined ? felder : mitHerkunft(felder, schluessel, wert, "wiki");
}

/** Was „Fertig“ für ein geändertes Feld schreibt: ↺ als `{ revert: "wiki" }`, sonst der Wert. */
export function wikiAenderung<F extends WikiFelder, K extends keyof F & string>(
    jetzt: F,
    schluessel: K,
): WikiFeldAenderung<F[K]> {
    return jetzt.herkunft[schluessel] === "wiki" ? { revert: "wiki" } : { value: jetzt[schluessel] };
}

/**
 * Arten aus Abschnitten (Weg, Kraftlinie; Orchestrierung 2026-10-18): Die Herkunft steht je Abschnitt, ↺ und Getipptes schreiben sie an
 * alle Abschnitte der Straße oder Linie. Für die Zeile gilt „wiki“ nur, wenn ALLE Abschnitte wiki tragen; trägt einer manual, gilt
 * manual; sonst kein Vermerk.
 */
export function herkunftDerAbschnitte(herkuenfte: readonly (FeldHerkunft | undefined)[]): FeldHerkunft | undefined {
    if (herkuenfte.length > 0 && herkuenfte.every((herkunft) => herkunft === "wiki")) return "wiki";
    return herkuenfte.includes("manual") ? "manual" : undefined;
}

/**
 * Die Ausnahme „leer folgt dem Wiki“ (Orchestrierung 2026-10-18, WI-0225 §2): nur, wo der Leser schon „eigen, sonst Wiki“ rechnet (Ort;
 * Kraftlinie, Beschreibung). Dort führt der Entwurf ohne eigenen Wert den Wiki-Wert mit Herkunft wiki; `wikiLage` zeigt dann „folgt“,
 * ohne Sonderweg. ↺ und „Fertig“ bleiben gleich (`aufWikiWert`, `wikiAenderung`); dass `{ revert: "wiki" }` die eigene Spalte dort
 * leert statt den Text zu kopieren, entscheidet der Schreibweg der Art.
 */
export function leerFolgtDemWiki<T>(
    eigen: T | null,
    wiki: T | null | undefined,
    herkunft: FeldHerkunft | undefined,
): { readonly wert: T | null; readonly herkunft: FeldHerkunft | undefined } {
    if (eigen !== null) return { wert: eigen, herkunft };
    return wiki === null || wiki === undefined ? { wert: null, herkunft: undefined } : { wert: wiki, herkunft: "wiki" };
}
