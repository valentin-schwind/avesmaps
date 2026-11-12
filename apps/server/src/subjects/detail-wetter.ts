import {
    AVENTURIA,
    SUBJECT_LIMITS,
    istWetterSymbolArt,
    renderZoomForBand,
    wetterSymbolTyp,
    type MapBounds,
    type SubjectDetail,
    type SubjectFact,
    type WetterSymbolArt,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";
import { wetterWikiEintrag, type WetterWikiEintrag } from "../wetter/wiki.ts";
import { textFact, wikiLine, wikiProvenance } from "./facts.ts";
import type { SubjectIndex } from "./subject-index.ts";

/**
 * Das Subject „Wetter-Icon“ (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“): ein Wind, Wirbel oder eine Meeresströmung MIT Verweis auf einen Wiki-Artikel
 * (`weather_symbol.wiki_titel`, Stufe 6). Gelesen wird nur, öffentlich, ohne Personen: `changed_by` und `changed_by_label` verlassen den Server nicht.
 *
 * - **Kopf:** der Name des Icons, ohne ihn der Name des Artikels (Feld `name` seiner Infobox), sonst sein Titel; darunter der Typ (`wetterSymbolTyp`: die Art des
 *   Icons, bei einem Mahlstrom-Artikel „Mahlstrom“). Der Typ wählt das Typbild (`headerGraphicOf("wetterSymbol", typ)`).
 * - **Felder:** was der Wiki-Stand des Artikels kennt, Region (`region_parent` bzw. `region`) und Kurzbeschreibung, mit seiner Adresse und seinem Stempel. Windrichtung,
 *   Stärke und Charakter der `Infobox Wind` haben keine Spalte (Stufe 6) und fehlen.
 * - **Wikizeile** mit Korpus und Lizenz wie bei jedem Gegenstand; Quellen und Sektionen hat ein Icon nicht.
 * - **Ziel der Kamera:** die Mitte des Icons, eingepasst die Reichweite.
 *
 * 404 (`null`), wo es kein Panel gibt: unbekannt, entfernt, ausgeblendet (für Besucher nicht auf der Karte), ohne Verweis, oder der Artikel steht nicht (mehr) unter den
 * Winden, Strömungen und Mahlströmen. Die Icons des Prototyps tragen keinen Verweis; ohne Tafel (vor Migration 0326) gibt es keinen.
 *
 * 🪤 Die Revision ist die des Subject-Index (wie bei der Sprache): Eine Änderung im Wetter-Editor zählt dort nicht mit; die Antwort liegt höchstens `cacheSeconds` im Browser.
 */

/** Wie weit man an ein Icon heranfährt, wenn es keine Reichweite einzupassen gibt. */
const WETTER_SYMBOL_ZOOM = renderZoomForBand(2);

const WELT = AVENTURIA.coordinateSpace.bounds;

/**
 * Die Lage eines Icons in Kartenkoordinaten (`aventuria-v1`). Das Wetter rechnet in seiner Welt: x und z von 0 bis 1024 über die Karte, z nach Süden (die Engine bildet sie
 * auf Mercator ab, `wetter-kamera.ts` `AUF_WELT`); die Karte zählt y nach Norden.
 */
export function wetterKartenpunkt(x: number, z: number): { x: number; y: number } {
    const breite = WELT.maxX - WELT.minX;
    const hoehe = WELT.maxY - WELT.minY;
    const seite = Math.max(breite, hoehe);
    return { x: WELT.minX + (x / 1024) * seite, y: WELT.minY + seite - (z / 1024) * seite };
}

/** Der Ausschnitt der Reichweite um ein Icon, in Kartenkoordinaten und auf die Karte beschnitten. */
export function wetterReichweite(x: number, z: number, reichweite: number): MapBounds {
    const a = wetterKartenpunkt(x - reichweite, z + reichweite);
    const b = wetterKartenpunkt(x + reichweite, z - reichweite);
    const klemme = (wert: number, min: number, max: number): number => Math.min(max, Math.max(min, wert));
    return [
        klemme(a.x, WELT.minX, WELT.maxX),
        klemme(a.y, WELT.minY, WELT.maxY),
        klemme(b.x, WELT.minX, WELT.maxX),
        klemme(b.y, WELT.minY, WELT.maxY),
    ];
}

interface SymbolZeile {
    public_id: string;
    art: string;
    name: string | null;
    x: number;
    z: number;
    reichweite: number;
    wiki_titel: string;
}

interface Geladen {
    symbol: SymbolZeile;
    art: WetterSymbolArt;
    artikel: WetterWikiEintrag;
}

const text = (wert: string | null | undefined): string | null =>
    wert === null || wert === undefined || wert.trim() === "" ? null : wert;

export async function wetterSymbolDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    const lies = (): Promise<Geladen | null> =>
        withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (tx) => {
            const [symbol] = await tx<SymbolZeile[]>`
                SELECT public_id::text AS public_id, art, name, x, z, reichweite, wiki_titel
                  FROM weather_symbol
                 WHERE public_id = ${publicId}::uuid AND entfernt_at IS NULL AND sichtbar AND wiki_titel IS NOT NULL
            `;
            if (symbol === undefined || !istWetterSymbolArt(symbol.art)) return null;
            const artikel = await wetterWikiEintrag(tx, symbol.wiki_titel);
            return artikel === null ? null : { symbol, art: symbol.art, artikel };
        });
    let geladen: Geladen | null;
    try {
        geladen = await lies();
    } catch (error) {
        // Vor Migration 0326 gibt es die Tafel nicht und damit kein Icon mit Verweis. Abgefangen außerhalb der Transaktion: In ihr bräche der Fehler sie ab.
        if (isMissingTable(error)) return null;
        throw error;
    }
    if (geladen === null) return null;
    const { symbol, art, artikel } = geladen;
    const wert = (value: string | undefined) =>
        text(value) === null
            ? null
            : { value: value ?? "", provenance: wikiProvenance(artikel.wikiUrl, artikel.stand ?? null) };
    const facts: SubjectFact[] = [
        ...textFact("regionParent", wert(artikel.region)),
        ...textFact("description", wert(artikel.beschreibung)),
    ];
    const wiki = wikiLine(index, artikel.wikiUrl, artikel.titel);
    const mitte = wetterKartenpunkt(symbol.x, symbol.z);
    return {
        subject: { kind: "wetterSymbol", id: symbol.public_id },
        revision: index.revision,
        title: text(symbol.name) ?? text(artikel.name ?? null) ?? artikel.titel,
        subtitle: [{ part: "type", key: wetterSymbolTyp(art, artikel.art) }],
        ...(facts.length === 0 ? {} : { facts }),
        ...(wiki === undefined ? {} : { wiki }),
        target: {
            x: mitte.x,
            y: mitte.y,
            zoom: WETTER_SYMBOL_ZOOM,
            bounds: wetterReichweite(symbol.x, symbol.z, symbol.reichweite),
        },
    };
}
