import { SUBJECT_DIRECTIONS, type SubjectFact } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { LEGACY_HIDDEN, wikiFact, wikiProvenance } from "./facts.ts";
import { listValueLinks, textLinks, type LinkSource } from "./link-pieces.ts";

/**
 * Der Wiki-Schnappschuss einer Landschaft (D6, Tabelle `wiki_region_snapshot`): einmal je Artikel, gelesen über
 * `region.wiki_region_key` (Landschaft) oder `terrain_peak_wiki_assignment` (Gipfel, Vulkan). Gipfel und Landschaft teilen sich
 * dieselbe Schnappschusstabelle, also auch dieselben Feldzeilen.
 *
 * Zur Laufzeit liest niemand aus dem Wiki (WI-0063 9.5): was hier steht, ist der Stand zum Zeitpunkt `synced_at`.
 */

export interface RegionSnapshot {
    wiki_url: string;
    name: string | null;
    description: string | null;
    continent: string | null;
    region_parent: string | null;
    affiliation_staat: string | null;
    einwohner: string | null;
    sprache: string | null;
    vegetation: string | null;
    verkehrswege: string | null;
    synced_at: Date | null;
    neighbors: { direction: string; name: string }[];
    synonyms: string[];
}

/** Der aktive Schnappschuss zu einem `wiki_key` oder einer internen Id; `null`, wenn es keinen gibt. */
export async function loadRegionSnapshot(
    database: Queryable,
    by: { key: string } | { id: string },
): Promise<RegionSnapshot | null> {
    const key = "key" in by ? by.key : null;
    const id = "id" in by ? by.id : null;
    const [row] = await database<RegionSnapshot[]>`
        SELECT s.wiki_url, s.name, s.description, s.continent, s.region_parent, s.affiliation_staat, s.einwohner, s.sprache,
               s.vegetation, s.verkehrswege, s.synced_at,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('direction', n.direction, 'name', n.name)
                                          ORDER BY n.direction, n.position), '[]'::jsonb)
                FROM wiki_region_snapshot_neighbor n WHERE n.snapshot_id = s.id) AS neighbors,
               (SELECT coalesce(jsonb_agg(y.text ORDER BY y.position), '[]'::jsonb)
                FROM wiki_region_snapshot_synonym y WHERE y.snapshot_id = s.id) AS synonyms
        FROM wiki_region_snapshot s
        WHERE s.is_active
          AND (${key}::text IS NOT NULL AND s.wiki_key = ${key}::text OR ${id}::bigint IS NOT NULL AND s.id = ${id}::bigint)
    `;
    return row ?? null;
}

/**
 * Die Feldzeilen einer Landschaft aus ihrem Schnappschuss: nur Wiki-Text mit Provenienz (die Landschaft hat keine direkten
 * Textfelder), Nachbarn je Himmelsrichtung eine Zeile in Legacys Reihenfolge, Synonyme roh (Reste von Wikimarkup sind ein
 * Befund der Daten, keine Aufgabe des Servers).
 *
 * 🔴 Ein Name macht keinen Link (WI-0063 27.12, Zuordnung nur über den Wiki-Key, `wiki-key-lookup.ts`): Die Werte sind Text, bis der Artikel für das
 * Teilstück ein Linkziel nennt (Export X1, `link-pieces.ts`) und dessen Wiki-Key genau ein Objekt der Karte trägt. Region, Staat, Verkehrswege und die
 * Nachbarn je Himmelsrichtung haben Linkziele; der Kontinent hat keins (X1 führt dieses Feld nicht), Einwohner, Sprache und Vegetation sind Text.
 *
 * 🔴 Legacys Infobox der Landschaft zeigt Lage, Staat, Einwohner, Sprache, Vegetation und Beschreibung (WI-0063 27.8). Kontinent,
 * Verkehrswege, Nachbarn und Synonyme liefert der Server mit, markiert als `legacyHidden`. Die Beschreibung bleibt vollständig; den
 * ersten Satz bildet die Anzeigeregel (`displayDescription`). Das gilt auch für Gipfel und Vulkane (dieselbe Schnappschusstabelle).
 */
export function regionSnapshotFacts(
    snapshot: RegionSnapshot | null,
    wikiUrl: string | null,
    links?: LinkSource,
): SubjectFact[] {
    if (snapshot === null) return [];
    const wiki = (value: string | null): { value: string | null; wikiUrl: string | null; syncedAt: Date | null } => ({
        value,
        wikiUrl: wikiUrl ?? snapshot.wiki_url,
        syncedAt: snapshot.synced_at,
    });
    const provenance = wikiProvenance(wikiUrl ?? snapshot.wiki_url, snapshot.synced_at);
    const facts: SubjectFact[] = [
        ...wikiFact("description", wiki(snapshot.description)),
        ...wikiFact("continent", wiki(snapshot.continent), LEGACY_HIDDEN),
        ...wikiFact("regionParent", wiki(snapshot.region_parent), {
            links: textLinks(links, ["region"], snapshot.region_parent),
        }),
        ...wikiFact("affiliationStaat", wiki(snapshot.affiliation_staat), {
            links: textLinks(links, ["staat"], snapshot.affiliation_staat),
        }),
        ...wikiFact("einwohner", wiki(snapshot.einwohner)),
        ...wikiFact("sprache", wiki(snapshot.sprache)),
        ...wikiFact("vegetation", wiki(snapshot.vegetation)),
        ...wikiFact("verkehrswege", wiki(snapshot.verkehrswege), {
            ...LEGACY_HIDDEN,
            links: textLinks(links, ["verkehrswege"], snapshot.verkehrswege),
        }),
    ];
    for (const direction of SUBJECT_DIRECTIONS) {
        const values = snapshot.neighbors.filter((entry) => entry.direction === direction).map((entry) => entry.name);
        if (values.length === 0) continue;
        // Die Felder der Nachbarn heißen in Legacys Positivliste `nachbar_n`, `nachbar_no`, … wie die Himmelsrichtungen des Vertrags.
        const neighbourLinks = listValueLinks(links, `nachbar_${direction.toLowerCase()}`, values);
        facts.push({
            field: "neighbors",
            direction,
            values,
            ...(neighbourLinks.length === 0 ? {} : { links: neighbourLinks }),
            provenance,
            ...LEGACY_HIDDEN,
        });
    }
    const synonyms = snapshot.synonyms.filter((text) => text.trim() !== "");
    if (synonyms.length > 0) facts.push({ field: "synonyms", values: synonyms, provenance, ...LEGACY_HIDDEN });
    return facts;
}
