import { kennzeichenAusWiki, wegtypAusWiki, type EditorPathStreet } from "@avesmaps3d/shared";
import { abweichende, mitHerkunft, wikiLage, type WikiFeldLage } from "../fenster/wiki-feld";
import { mitWegartFuerAlle, nurLandwege, type WegFelder } from "./weg-art";

/**
 * Die Wiki-Felder der Straße (WI-0177; Baustein `fenster/wiki-feld`, WI-0225; Design Guide §13.8 „Ein Wiki-Feld bauen“): Name, Wegtyp
 * und Kennzeichen „Karawanenroute“ gegen den Artikel der Straße (`EditorPathStreet.artikel`). Reine Rechnung; die Zeilen zeichnet
 * `wiki-feld.vue`, ↺ ist EIN Schritt im Entwurf und geht mit „Fertig“ als gewöhnlicher Wert in `path.update`.
 *
 * - **Wegtyp** über `wegtypAusWiki` (Betreiber 2026-10-18: Kronstraße → Reichsstraße; Mischformen ohne Zuordnung). Ist die Wiki-Art
 *   „Karawanenroute“, hat der Wegtyp kein Gegenstück: Ihr ↺ setzt nur das Kennzeichen (§13.8), der Untergrund bleibt.
 * - **Kennzeichen** über `kennzeichenAusWiki`: „Karawanenroute“ setzt es, jede andere Art nimmt es weg, die Mischform „Karawanenroute,
 *   Pass“ bleibt ohne Zuordnung.
 * - Wegtyp und Kennzeichen nur an Landwegen; an einem Flussweg liest das Feld nur.
 * - **Herkunft** (Modell c, Tafel `field_origin`, WI-0225 §7): ↺ setzt den Wert UND Herkunft wiki, ein gleicher Wert mit Herkunft wiki
 *   heißt „folgt“; getippt ist manual (`wegeditor-fenster.vue`).
 */

export const WEG_WIKI_FELDER = ["name", "subtype", "mark"] as const;
export type WegWikiFeld = (typeof WEG_WIKI_FELDER)[number];

const OHNE: WikiFeldLage = wikiLage({ eigen: null, wiki: undefined, mitWiki: false });

/** Die Wiki-Art der Straße als Text, wenn das Wiki eine nennt. */
const artVon = (d: EditorPathStreet): string | undefined => {
    const art = d.artikel?.werte["subtype"];
    return typeof art === "string" ? art : undefined;
};

/** Ist die Wiki-Art die Karawanenroute? Dann gehört ihr ↺ dem Kennzeichen, nicht dem Wegtyp. */
const istKarawanenroute = (d: EditorPathStreet): boolean => {
    const art = artVon(d);
    return art !== undefined && kennzeichenAusWiki(art) === "karawanenroute";
};

/** Die Lage einer Feldzeile; `lesend`: ohne Schreibrecht oder eine gelöschte Straße. */
export function wegWikiLage(d: EditorPathStreet, f: WegFelder, feld: WegWikiFeld, lesend: boolean): WikiFeldLage {
    const werte = d.artikel?.werte;
    if (werte === undefined) return OHNE;
    switch (feld) {
        case "name":
            return wikiLage({ eigen: f.name, wiki: werte["name"], lesend, herkunft: f.herkunft["name"] });
        case "subtype":
            if (istKarawanenroute(d)) return OHNE;
            return wikiLage({
                eigen: f.subtype,
                wiki: werte["subtype"],
                lesend: lesend || !nurLandwege(d),
                zuordnung: wegtypAusWiki,
                herkunft: f.herkunft["subtype"],
            });
        case "mark":
            return wikiLage({
                eigen: f.mark ?? "",
                wiki: werte["mark"],
                lesend: lesend || !nurLandwege(d),
                zuordnung: kennzeichenAusWiki,
                herkunft: f.herkunft["mark"],
            });
    }
}

/** Das Feld im Entwurf auf seinem Wiki-Wert, Herkunft wiki; ohne Wert oder ohne Zuordnung unverändert. */
export function wegAufWiki(d: EditorPathStreet, f: WegFelder, feld: WegWikiFeld): WegFelder {
    const werte = d.artikel?.werte;
    if (werte === undefined) return f;
    if (feld === "name") {
        const name = werte["name"];
        return typeof name === "string" ? mitHerkunft(f, "name", name, "wiki") : f;
    }
    const art = artVon(d);
    if (art === undefined) return f;
    if (feld === "subtype") {
        const subtype = wegtypAusWiki(art);
        return subtype === undefined ? f : mitWegartFuerAlle(mitHerkunft(f, "subtype", subtype, "wiki"), subtype);
    }
    const mark = kennzeichenAusWiki(art);
    return mark === undefined ? f : mitHerkunft(f, "mark", mark === "" ? null : mark, "wiki");
}

/** Wie viele Felder vom Wiki abweichen (für „↺ Alles auf Wiki-Werte (n)“). */
export const wegAbweichende = (d: EditorPathStreet, f: WegFelder, lesend: boolean): number =>
    abweichende(WEG_WIKI_FELDER.map((feld) => wegWikiLage(d, f, feld, lesend)));

/** „↺ Alles auf Wiki-Werte“: jedes abweichende Feld auf seinen Wiki-Wert, als EIN Schritt. */
export function wegAllesAufWiki(d: EditorPathStreet, f: WegFelder, lesend: boolean): WegFelder {
    return WEG_WIKI_FELDER.reduce(
        (felder, feld) => (wegWikiLage(d, felder, feld, lesend).zurueck ? wegAufWiki(d, felder, feld) : felder),
        f,
    );
}
