import type { EditorPowerlineDetail, FeldHerkuenfte, WikiArtikel } from "@avesmaps3d/shared";
import {
    abweichende,
    aufWikiWert,
    herkunftDerAbschnitte,
    herkunftIm,
    leerFolgtDemWiki,
    wikiLage,
    wikiWertIm,
    type WikiFeldLage,
    type WikiWert,
} from "../fenster/wiki-feld";
import type { KraftlinieFelder } from "./kraftlinie-art";

/**
 * Die Felder der Kraftlinie mit Wiki-Wert (WI-0205 an WI-0225; Design Guide §13.8; Kopf `wiki-feld-schnittstelle.md` §3 und §7). Der
 * Wiki-Wert kommt allein aus dem Artikel im Entwurf (`felder.wiki.werte`): Wird ein anderer Artikel gewählt, zeigen die Felder sofort
 * dessen Werte. Die Herkunft (Modell c) steht je Abschnitt (`segments[].herkunft`); die Linie folgt dem Wiki nur, wenn alle Abschnitte
 * wiki tragen (`herkunftDerAbschnitte`).
 *
 * - **Name:** der eigene Wert gegen `werte.name`. Kennt das Wiki keinen Namen, ist er unbekannt: Ein leerer Name wird nie geschrieben
 *   (Legacy verlangt einen), ↺ hätte also nichts zu setzen.
 * - **Beschreibung:** Legacys Regel „Handgetipptes schlägt Wiki“ (Mirror a7f2dac8, `js/map-features/map-features-powerlines.js:382`;
 *   Orchestrierung 2026-10-18, Ausnahme von Modell c): Eine leere eigene Beschreibung folgt dem Wiki. Der Entwurf führt dann den Wiki-Text
 *   mit Herkunft wiki (`leerFolgtDemWiki`), Getipptes ist manual, ↺ geht als `{ revert: "wiki" }` und leert am Server die eigene.
 * - **Stärke, Affinität, Länge, Regionen** führt nur das Wiki: lesend, nur mit Artikel und Wert (`nurWiki`).
 * - Ohne Artikel haben Name und Beschreibung kein Gegenstück (Zustand „ohne“), die Zeilen fluchten trotzdem.
 */

export const KRAFTLINIE_WIKI_FELDER = ["name", "description"] as const;
export type KraftlinieWikiFeld = (typeof KRAFTLINIE_WIKI_FELDER)[number];

/** Die Werte, die nur das Wiki führt, in der Reihenfolge des Infopanels. */
export const KRAFTLINIE_NUR_WIKI = ["staerke", "affinitaet", "laenge", "regionen"] as const;
export type KraftlinieNurWiki = (typeof KRAFTLINIE_NUR_WIKI)[number];

/** Der Wiki-Wert eines Schlüssels: ein leerer Text heißt wie `null`, das Wiki kennt keinen. */
function wikiWert(felder: Pick<KraftlinieFelder, "wiki" | "herkunft">, schluessel: string): WikiWert {
    const wert = wikiWertIm(felder, schluessel);
    if (typeof wert === "string" && wert.trim() === "") return null;
    return wert;
}

/** Die Herkunft der Linie aus ihren Abschnitten, je Feld. */
export function herkunftDerLinie(linie: EditorPowerlineDetail): FeldHerkuenfte {
    const raus: Record<string, "wiki" | "manual"> = {};
    for (const feld of KRAFTLINIE_WIKI_FELDER) {
        const herkunft = herkunftDerAbschnitte(linie.segments.map((a) => a.herkunft?.[feld]));
        if (herkunft !== undefined) raus[feld] = herkunft;
    }
    return raus;
}

/**
 * Name, Beschreibung und Herkunft im Entwurf aus dem gelesenen Stand: die Beschreibung nach „leer folgt dem Wiki“, die Herkunft je Feld
 * aus den Abschnitten.
 */
export function wikiFelderAus(
    linie: EditorPowerlineDetail,
): Pick<KraftlinieFelder, "name" | "description" | "wiki" | "herkunft"> {
    const wiki: WikiArtikel | null = linie.article ?? null;
    const herkunft = herkunftDerLinie(linie);
    const eigen = linie.description?.trim() ? linie.description : null;
    const wikiText = wikiWert({ wiki, herkunft }, "description");
    const beschreibung = leerFolgtDemWiki(
        eigen,
        typeof wikiText === "string" ? wikiText : undefined,
        herkunft["description"],
    );
    const { description: _alt, ...ohne } = herkunft;
    void _alt;
    return {
        name: linie.name,
        description: beschreibung.wert ?? "",
        wiki,
        herkunft: beschreibung.herkunft === undefined ? ohne : { ...ohne, description: beschreibung.herkunft },
    };
}

/** Die Zeile eines Felds mit eigenem Wert; `lesend` ohne Schreibrecht. */
export function kraftlinieWikiLage(felder: KraftlinieFelder, feld: KraftlinieWikiFeld, lesend = false): WikiFeldLage {
    const wiki = wikiWert(felder, feld);
    return wikiLage({
        eigen: felder[feld],
        // Kennt das Wiki keinen Namen, ist er unbekannt: Ein leerer Name wird nie geschrieben.
        wiki: feld === "name" ? (wiki ?? undefined) : wiki,
        mitWiki: felder.wiki !== null,
        herkunft: herkunftIm(felder, feld),
        lesend,
    });
}

/** ↺ im Entwurf (`art.aufWiki`): das Feld auf den Wiki-Wert, Herkunft wiki; die Beschreibung ohne Wiki-Text leer. */
export function aufWiki(felder: KraftlinieFelder, feld: string): KraftlinieFelder {
    if (feld !== "name" && feld !== "description") return felder;
    if (!kraftlinieWikiLage(felder, feld).zurueck) return felder;
    const zurueck = aufWikiWert(felder, feld);
    // `null` hieße „das Wiki kennt keinen“: Die Beschreibung ist dann leer (sie folgt dem Wiki); einen Namen setzt ↺ dann nie.
    return zurueck.description === null ? { ...zurueck, description: "" } : zurueck;
}

/** „↺ Alles auf Wiki-Werte (n)“: wie viele Felder abweichen. */
export const eigeneWerte = (felder: KraftlinieFelder): number =>
    abweichende(KRAFTLINIE_WIKI_FELDER.map((feld) => kraftlinieWikiLage(felder, feld)));

/** „↺ Alles auf Wiki-Werte“ als EIN Schritt. */
export const allesAufWiki = (felder: KraftlinieFelder): KraftlinieFelder =>
    KRAFTLINIE_WIKI_FELDER.reduce((stand, feld) => aufWiki(stand, feld), felder);

/** Die Werte, die nur das Wiki führt, mit ihrer lesenden Zeile; ohne Artikel oder ohne Wert keine. */
export function nurWiki(
    felder: KraftlinieFelder,
): readonly { readonly schluessel: KraftlinieNurWiki; readonly wert: string; readonly lage: WikiFeldLage }[] {
    return KRAFTLINIE_NUR_WIKI.flatMap((schluessel) => {
        const wert = wikiWert(felder, schluessel);
        if (wert === null || wert === undefined) return [];
        const text = String(wert);
        return [{ schluessel, wert: text, lage: wikiLage({ eigen: text, wiki: text, lesend: true }) }];
    });
}
