import { WETTER_WIKI_ARTEN, wetterWikiTitel, type WetterWikiArtikel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "../system/state-row.ts";
import { landmarkeAdresse } from "../wiki/abgleich/landmarken.ts";
import { landmarkeSchluessel } from "../wiki/infobox/landmarke.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";

/**
 * Die Wiki-Artikel, auf die ein Wetter-Icon verweisen kann (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“; Vertrag `packages/shared/src/wetter/wiki.ts`). NUR LESEN: Die Artikel
 * stehen dort, wo der Derographie-Zug sie führt, und bleiben dort.
 *
 * - **Wiki-Einträge** (`wiki_region_snapshot`, aktiv): die Winde (Art „Wind“, `wiki/infobox/wind.ts`), die Meeresströmungen und die Mahlströme mit `{{Infobox Region}}`, an einer Fläche oder ohne.
 * - **Landmarken-Artikel** (`wiki_landmarke_artikel`, aktiv): Bis zum Abgleich nach 2026-11-11 stehen dort noch die Mahlströme der Wiki-Art „Mahlstrom“ als Strudel. Seitdem sind sie Wiki-Einträge
 *   wie die Winde (Betreiber 2026-11-11, `wiki/infobox/landmarke.ts`); der Abgleich nimmt sie dort heraus. Ein gesetzter Strudel hat seinen Wiki-Stand in `wiki_region_snapshot` und steht dort.
 *
 * Jeder Titel einmal (Vergleichsform des Abgleichs), nach Titel geordnet. Fehlt eine Tafel, ist die Liste leer.
 */

type Zeile = {
    titel: string | null;
    wiki_url: string | null;
    art: string | null;
    region: string | null;
    name: string | null;
    beschreibung: string | null;
    stand: Date | string | null;
};

const text = (wert: string | null): string | undefined => (wert === null || wert.trim() === "" ? undefined : wert);

async function zeilen(db: Queryable, arten: readonly string[]): Promise<Zeile[]> {
    try {
        return await db<Zeile[]>`
            SELECT NULL::text AS titel, wiki_url, btrim(split_part(art, '|', 1)) AS art, region_parent AS region, name,
                   description AS beschreibung, synced_at AS stand
              FROM wiki_region_snapshot
             WHERE is_active AND btrim(split_part(art, '|', 1)) = ANY(${[...arten]}::text[])
            UNION ALL
            SELECT titel, NULL::text, wiki_art, region, name, kurzbeschreibung, updated_at
              FROM wiki_landmarke_artikel
             WHERE is_active AND wiki_art = ANY(${[...arten]}::text[])
        `;
    } catch (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

/**
 * Was das Infopanel eines Icons vom Artikel zeigt (WI-0288, Betreiber 2026-11-08: „ja infopanel bauen“): dazu Name und Kurzbeschreibung des Wiki-Stands und dessen Stempel.
 * Windrichtung, Stärke und Charakter der `Infobox Wind` haben keine Spalte und bleiben im Wiki.
 */
export interface WetterWikiEintrag extends WetterWikiArtikel {
    name?: string;
    beschreibung?: string;
    stand?: Date | string;
}

/** Alle Artikel mit Wiki-Stand, jeder Titel einmal (der Wiki-Eintrag vor dem Landmarken-Artikel), nach Titel geordnet. */
async function ladeEintraege(db: Queryable): Promise<WetterWikiEintrag[]> {
    const jeSchluessel = new Map<string, WetterWikiEintrag>();
    for (const zeile of await zeilen(db, WETTER_WIKI_ARTEN)) {
        const titel = zeile.titel ?? titelAusWikiAdresse(zeile.wiki_url);
        if (titel === null || titel.trim() === "") continue;
        const schluessel = landmarkeSchluessel(titel);
        if (jeSchluessel.has(schluessel)) continue;
        const region = text(zeile.region);
        const name = text(zeile.name);
        const beschreibung = text(zeile.beschreibung);
        jeSchluessel.set(schluessel, {
            titel,
            art: zeile.art ?? "",
            ...(region === undefined ? {} : { region }),
            wikiUrl: zeile.wiki_url ?? landmarkeAdresse(titel),
            ...(name === undefined ? {} : { name }),
            ...(beschreibung === undefined ? {} : { beschreibung }),
            ...(zeile.stand === null ? {} : { stand: zeile.stand }),
        });
    }
    return [...jeSchluessel.values()].sort((a, b) => a.titel.localeCompare(b.titel, "de"));
}

export async function ladeWetterWikiArtikel(db: Queryable): Promise<WetterWikiArtikel[]> {
    return (await ladeEintraege(db)).map(({ titel, art, region, wikiUrl }) => ({
        titel,
        art,
        ...(region === undefined ? {} : { region }),
        wikiUrl,
    }));
}

/** Der Artikel zu einem gespeicherten Verweis (Vergleichsform des Titels); `null`, wenn es ihn unter den Winden, Strömungen und Mahlströmen (nicht mehr) gibt. */
export async function wetterWikiEintrag(db: Queryable, titel: string): Promise<WetterWikiEintrag | null> {
    const schluessel = landmarkeSchluessel(titel);
    return (await ladeEintraege(db)).find((eintrag) => landmarkeSchluessel(eintrag.titel) === schluessel) ?? null;
}

function unbekannt(): ApiError {
    return new ApiError(
        400,
        "wiki_artikel_unbekannt",
        "Diesen Wiki-Artikel gibt es unter den Winden, Meeresströmungen und Mahlströmen nicht.",
        { feld: "wikiTitel" },
    );
}

/**
 * Der Verweis, wie er gespeichert wird (STRENG): `undefined` bleibt ungeändert, `null` und leer lösen ihn, ein Titel muss einer der Artikel sein (`ladeWetterWikiArtikel`) und wird in dessen Schreibung
 * gespeichert. Sonst 400 `wiki_artikel_unbekannt`.
 */
export async function wetterWikiVerweis(
    db: Queryable,
    eingabe: string | null | undefined,
): Promise<string | null | undefined> {
    if (eingabe === undefined) return undefined;
    const titel = wetterWikiTitel(eingabe);
    if (titel === undefined) throw unbekannt();
    if (titel === null) return null;
    const schluessel = landmarkeSchluessel(titel);
    const treffer = (await ladeWetterWikiArtikel(db)).find(
        (artikel) => landmarkeSchluessel(artikel.titel) === schluessel,
    );
    if (treffer === undefined) throw unbekannt();
    return treffer.titel;
}
