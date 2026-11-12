import type { Queryable } from "../database.ts";

/**
 * Innerorts, außerorts oder unklar für Bauwerke der Ortsliste (WI-0128; Betreiber 2026-10-11: „kannst du bei den filtern - analog zu
 * "außerorts" - innerorts bei der Lage machen?“ und „können wir dann die berechnung von innerorts nicht auch wie legacy machen?“):
 * **Legacys Regel 1:1** (`api/_internal/wiki/place-scope.php`, Mirror `13d0183ab`, `avesmapsPlaceScopeClassify`), nur der Abgleich läuft
 * über Wiki-Keys statt über Namen (Betreiber 2026-10-05, Design-Guide P8). Ein Urteil ist ein Filterwert, keine gespeicherte Beziehung
 * (F1 = B): Das Bauwerk wird damit keiner Siedlung zugeordnet.
 *
 * Die Regel, in Legacys Reihenfolge:
 * 1. Kein `standort` → außerorts (Legacy: nie auf fehlende Evidenz filtern; die Zeile bleibt sichtbar).
 * 2. Die Kette von grob nach fein, je Link:
 *    a. ein Umland-Hinweis direkt am Link („bei [[Punin]]“, „[[Fairnhain]] (Umland)“) → nur dieser Link zählt nicht;
 *    b. das Ziel ist eine Siedlung UND ein Gebiet (Stadtstaaten) → vorn in der Kette und ohne folgendes Gebiet innerorts, sonst unklar;
 *    c. das Ziel ist eine Siedlung → innerorts, und zwar in genau dieser (die gröbste gewinnt: „[[Gareth]]: [[Arenaviertel]]“ → Gareth).
 * 3. Keine Siedlung in der Kette → außerorts.
 *
 * Key statt Name:
 * - **Siedlung** ist ein Key, den Legacys Zuordnung X2 (`wiki_key_assignment`, Art `siedlung`) einem aktiven Ort der Domäne mit einer
 *   Siedlungsgröße zuweist (Legacy: die Namen der Orte auf der Karte mit `AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES`).
 * - **Gebiet** ist ein Key, den X2 einer Region, Landschaft oder einem Gebiet zuweist (Legacy: `region`, `label`, `political_territory`).
 * - **Den Key eines Links** liefert Legacy (X3 `standort_links` seit WI-0134, Tabelle `wiki_settlement_registry_named_place`, 0099). Die
 *   Umland-Hinweise stehen im rohen Text; Link und Key werden in Reihenfolge über das geschriebene Linkziel einander zugeordnet (dasselbe
 *   Ziel zweimal geschrieben, nie ein Name gegen ein Objekt). Ein Link ohne Key zählt wie bei Legacy ein unbekannter Name: gar nicht.
 * - 🪤 Ein Stadtviertel, das im Wiki auf seine Stadt weiterleitet („[[Fasar]]: [[Unterfeld]]“), trägt den Key der Stadt. Ein späterer
 *   Link mit DEMSELBEN Key ist darum kein „folgendes Gebiet“: Sonst fielen 405 Bauwerke der Stadtstaaten (Festum, Punin, Havena …) auf
 *   „unklar“ (gemessen 2026-10-11 auf dev), die Legacy über den Namen nicht trifft und innerorts nennt.
 * - Das Umfeld eines Links zählt Legacy in Bytes (PHP `substr`), hier in Zeichen; bei Umlauten ist das Fenster hier etwas weiter.
 */

export type Lage = "innerorts" | "ausserorts" | "unklar";

/** Das Urteil über ein Bauwerk; `siedlung` ist der Key der Siedlung bei innerorts und unklar. */
export interface LageUrteil {
    lage: Lage;
    siedlung?: string;
}

/** Wie weit vor und nach einem Link ein Hinweis gesucht wird (Legacy `AVESMAPS_PLACE_SCOPE_MARKER_WINDOW`, das Doppelte davon). */
const FENSTER = 24 * 2;

/** Hinweise VOR einem Link, die „nahe, nicht darin“ heißen (Legacy `AVESMAPS_PLACE_SCOPE_OUTSKIRTS_MARKERS`). */
const HINWEISE_VOR = [
    "bei",
    "nahe",
    "unweit",
    "ausserhalb",
    "außerhalb",
    "vor den toren",
    "vor der stadt",
    "nördlich von",
    "noerdlich von",
    "südlich von",
    "suedlich von",
    "östlich von",
    "oestlich von",
    "westlich von",
    "nordöstlich von",
    "nordwestlich von",
    "südöstlich von",
    "südwestlich von",
    "in der nähe von",
    "in der naehe von",
    "umgebung von",
    "umland von",
    "nahe bei",
] as const;

/** Hinweise NACH einem Link („[[Fairnhain]] (Umland)“); „bei“ fehlt mit Absicht („[[Gareth]] bei Nacht“). */
const HINWEISE_NACH = [
    "umland",
    "umgebung",
    "umgegend",
    "unweit",
    "nahe",
    "außerhalb",
    "ausserhalb",
    "vor den toren",
    "vor der stadt",
] as const;

/** Ein Link der Kette mit dem Text unmittelbar davor und danach. */
export interface KettenLink {
    ziel: string;
    vor: string;
    nach: string;
    /** Der Key, den Legacy für dieses Linkziel geliefert hat; fehlt, wenn keiner kam. */
    key?: string;
}

/** Die Links des rohen Felds in Reihenfolge, je mit Umfeld (Legacy `avesmapsPlaceScopeExtractLinksWithContext`). */
export function linksMitUmfeld(raw: string): KettenLink[] {
    if (raw.trim() === "") return [];
    const links: KettenLink[] = [];
    let vorigesEnde = 0;
    for (const treffer of raw.matchAll(/\[\[\s*([^\]|#]+)[^\]]*\]\]/gu)) {
        const ziel = (treffer[1] ?? "").trim();
        if (ziel === "") continue;
        const anfang = treffer.index;
        const ende = anfang + treffer[0].length;
        // Das Umfeld davor endet am vorigen Link: Ein Hinweis eines früheren Glieds darf nicht auf dieses überspringen.
        const von = Math.max(vorigesEnde, anfang - FENSTER);
        links.push({ ziel, vor: raw.slice(von, Math.max(von, anfang)), nach: raw.slice(ende, ende + FENSTER) });
        vorigesEnde = ende;
    }
    return links;
}

/** Trägt dieser Link einen Umland-Hinweis (Legacy `avesmapsPlaceScopeLinkHasOutskirtsMarker`)? */
export function hatUmlandHinweis(vor: string, nach: string): boolean {
    const schluss = vor
        .trim()
        .toLowerCase()
        .replace(/[\s,;:()\-–]+$/u, "");
    for (const hinweis of HINWEISE_VOR) {
        if (!schluss.endsWith(hinweis)) continue;
        // Der Hinweis ist das ganze Davor („bei [[Punin]]“), oder er steht als eigenes Wort („Rabei“ endet nicht auf „bei“).
        if (schluss.length === hinweis.length) return true;
        if (!/\p{L}/u.test(schluss[schluss.length - hinweis.length - 1] ?? "")) return true;
    }
    const anfang = nach
        .trim()
        .toLowerCase()
        .replace(/^[\s,;:()\-–]+/u, "");
    return HINWEISE_NACH.some((hinweis) => anfang.startsWith(hinweis));
}

const falte = (ziel: string): string => ziel.replace(/_/g, " ").replace(/\s+/gu, " ").trim().toLowerCase();

/**
 * Die Links des rohen Felds mit dem Key, den Legacy für dasselbe Linkziel geliefert hat: in Reihenfolge, ein gelieferter Link je Link
 * des Textes. Was Legacy mehr liefert (Vorlagen wie `{{Reg|…}}`, die Legacys Regel nicht liest), wird übersprungen.
 */
export function verknuepfe(raw: string, geliefert: readonly { ziel: string; key: string | null }[]): KettenLink[] {
    let ab = 0;
    return linksMitUmfeld(raw).map((link) => {
        const gesucht = falte(link.ziel);
        for (let i = ab; i < geliefert.length; i += 1) {
            const kandidat = geliefert[i]!;
            if (falte(kandidat.ziel) !== gesucht) continue;
            ab = i + 1;
            return kandidat.key ? { ...link, key: kandidat.key } : link;
        }
        return link;
    });
}

export interface LageIndex {
    istSiedlung(key: string): boolean;
    istGebiet(key: string): boolean;
}

/** Das Urteil über eine Kette (Legacy `avesmapsPlaceScopeClassify`, über Keys). */
export function lageAus(kette: readonly KettenLink[], index: LageIndex): LageUrteil {
    for (let i = 0; i < kette.length; i += 1) {
        const link = kette[i]!;
        const key = link.key;
        if (key === undefined || !index.istSiedlung(key)) continue;
        if (hatUmlandHinweis(link.vor, link.nach)) continue;
        if (index.istGebiet(key)) {
            // Beginnt die Kette mit dem Namen, ist er die Hauptangabe (ein Bauwerk liegt in einer Stadt, nicht in einer Grafschaft);
            // folgt noch ein Gebiet, ist die Kette geografisch zu lesen.
            const folgtGebiet = kette
                .slice(i + 1)
                .some((spaeter) => spaeter.key !== undefined && spaeter.key !== key && index.istGebiet(spaeter.key));
            return { lage: i === 0 && !folgtGebiet ? "innerorts" : "unklar", siedlung: key };
        }
        return { lage: "innerorts", siedlung: key };
    }
    return { lage: "ausserorts" };
}

/** Die Größen, die eine Siedlung machen (Legacy `AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES`). */
export const SIEDLUNGSGROESSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf"] as const;

/** Innerorts oder unklar je Wiki-Artikel eines Bauwerks, mit dem Namen der Siedlung; außerorts steht nicht darin. */
export type LageJeArtikel = ReadonlyMap<string, { lage: Exclude<Lage, "ausserorts">; siedlung: string }>;

/** Rechnet das Urteil für alle Bauwerke der Registry (Legacy: einmal je Liste, nie je Zeile). */
export async function lageJeArtikel(database: Queryable, mapDomainId: string): Promise<LageJeArtikel> {
    // Der Name der Siedlung ist der Titel ihres Artikels (Legacy zeigt das Linkziel), sonst der größte Ort mit diesem Key: Ein Key kann an
    // mehreren Orten hängen (Gareth und Alt-Gareth tragen beide den Artikel Gareth).
    const siedlungen = await database<{ wiki_key: string; name: string }[]>`
        SELECT a.wiki_key,
               coalesce(min(r.title), (array_agg(p.name ORDER BY array_position(${[...SIEDLUNGSGROESSEN]}::text[], p.subtype), p.name))[1]) AS name
          FROM wiki_key_assignment a
          JOIN place p ON p.public_id = a.object_public_id
          LEFT JOIN wiki_settlement_registry r ON r.is_active AND r.wiki_key = a.wiki_key
         WHERE a.is_active AND a.legacy_art = 'siedlung'
           AND p.is_active AND p.map_domain_id = ${mapDomainId} AND p.subtype = ANY(${[...SIEDLUNGSGROESSEN]}::text[])
         GROUP BY a.wiki_key
    `;
    const gebiete = await database<{ wiki_key: string }[]>`
        SELECT DISTINCT wiki_key FROM wiki_key_assignment WHERE is_active AND legacy_art IN ('region', 'landschaft', 'gebiet')
    `;
    const glieder = await database<{ wiki_key: string; standort: string; ziel: string; key: string | null }[]>`
        SELECT r.wiki_key, r.standort, n.target_raw AS ziel, n.target_key AS key
          FROM wiki_settlement_registry r
          JOIN wiki_settlement_registry_named_place n ON n.registry_id = r.id
         WHERE r.is_active AND r.standort IS NOT NULL AND NOT (r.settlement_class = ANY(${[...SIEDLUNGSGROESSEN]}::text[]))
         ORDER BY r.wiki_key, n.position
    `;
    const namen = new Map(siedlungen.map((zeile) => [zeile.wiki_key, zeile.name]));
    const gebietsKeys = new Set(gebiete.map((zeile) => zeile.wiki_key));
    const index: LageIndex = { istSiedlung: (key) => namen.has(key), istGebiet: (key) => gebietsKeys.has(key) };

    const ketten = new Map<string, { standort: string; geliefert: { ziel: string; key: string | null }[] }>();
    for (const glied of glieder) {
        const kette = ketten.get(glied.wiki_key) ?? { standort: glied.standort, geliefert: [] };
        kette.geliefert.push({ ziel: glied.ziel, key: glied.key });
        ketten.set(glied.wiki_key, kette);
    }
    const ergebnis = new Map<string, { lage: Exclude<Lage, "ausserorts">; siedlung: string }>();
    for (const [artikel, kette] of ketten) {
        const urteil = lageAus(verknuepfe(kette.standort, kette.geliefert), index);
        if (urteil.lage === "ausserorts" || urteil.siedlung === undefined) continue;
        ergebnis.set(artikel, { lage: urteil.lage, siedlung: namen.get(urteil.siedlung) ?? urteil.siedlung });
    }
    return ergebnis;
}
