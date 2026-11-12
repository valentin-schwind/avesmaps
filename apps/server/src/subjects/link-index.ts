import { wikiLinkKey } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { PathIndex, RegionIndex, RegionRecord, TerritoryIndex, TerritoryRecord } from "./subject-index.ts";

/**
 * Der Index der Objektlinks (WI-0063 4.6, Vertrag `subject-details.yaml`, Abschnitt `objektlinks`): Legacys
 * `?siedlung=`, `?staat=`, `?region=`, `?strasse=`, `?fluss=` vergleichen weder den Wiki-Titel noch den `wiki_key`, sondern den
 * normalisierten Seitenanteil der GESPEICHERTEN Wiki-Adresse des Trägers mit dem normalisierten Wert des Parameters
 * (`wikiLinkKey`, Zeichen für Zeichen Legacys Rechnung). Dieser Index ordnet jedem solchen Schlüssel seine Träger zu.
 *
 * ⭐ Er hängt am Datenstand und wird mit dem `SubjectIndex` je Revision im Speicher gebaut (4,9 Tsd. Orte, aber nur die
 * ~2,2 Tsd. mit Adresse), nicht je Anfrage. Der Schlüssel wird nie gespeichert: Er ist eine reine Funktion der Adresse.
 *
 * 🔴 Träger sind, was Besucher sehen dürfen: aktive Zeilen, bei Orten ohne die verborgenen. Eine Adresse darf nie auf ihren
 * Schlüssel schrumpfen - es zählt die Adresse selbst (fünf Orte tragen eine Adresse auf einem anderen Wiki).
 */

export interface PlaceCarrier {
    publicId: string;
    name: string;
    subtype: string;
}

export interface PeakCarrier {
    publicId: string;
    name: string;
    subtype: string;
}

export interface LinkCarriers {
    place: PlaceCarrier[];
    territory: TerritoryRecord[];
    /** Regionen (Landschaften) mit dieser Adresse; mehrere derselben Gruppe sind EIN Subject. */
    area: RegionRecord[];
    peak: PeakCarrier[];
    /** Abschnitte, deren Hauptzuweisung diese Adresse trägt (auch eine Adresse ohne Schnappschuss). */
    pathMain: string[];
    /** Abschnitte, die den Artikel als weitere Zuweisung tragen, mit dem `wiki_key` des Artikels. */
    pathFurther: { segment: string; key: string }[];
}

export interface LinkIndex {
    byKey: ReadonlyMap<string, LinkCarriers>;
}

function emptyCarriers(): LinkCarriers {
    return { place: [], territory: [], area: [], peak: [], pathMain: [], pathFurther: [] };
}

export async function buildLinkIndex(
    database: Database,
    parts: { territories: TerritoryIndex; paths: PathIndex; regions: RegionIndex },
    mapDomainId: string,
): Promise<LinkIndex> {
    const [places, peaks] = await Promise.all([
        database<{ public_id: string; name: string; subtype: string; wiki_url: string }[]>`
            SELECT p.public_id::text AS public_id, p.name, p.subtype, a.wiki_url
            FROM place_wiki_assignment a
            JOIN place p ON p.id = a.place_id
            WHERE a.is_active AND a.wiki_url IS NOT NULL
              AND p.is_active AND NOT p.is_hidden AND p.map_domain_id = ${mapDomainId}
            ORDER BY p.public_id
        `,
        database<{ public_id: string; name: string; subtype: string; wiki_url: string }[]>`
            SELECT t.public_id::text AS public_id, t.name, t.subtype, a.wiki_url
            FROM terrain_peak_wiki_assignment a
            JOIN terrain_peak t ON t.id = a.terrain_peak_id
            WHERE a.is_active AND a.wiki_url IS NOT NULL
              AND t.is_active AND NOT 'verborgen' = ANY (t.merkmale) AND t.map_domain_id = ${mapDomainId}
            ORDER BY t.public_id
        `,
    ]);
    const byKey = new Map<string, LinkCarriers>();
    const carriers = (url: string | null): LinkCarriers | null => {
        const key = wikiLinkKey(url);
        if (key === "") return null;
        let entry = byKey.get(key);
        if (!entry) {
            entry = emptyCarriers();
            byKey.set(key, entry);
        }
        return entry;
    };
    for (const row of places)
        carriers(row.wiki_url)?.place.push({ publicId: row.public_id, name: row.name, subtype: row.subtype });
    for (const territory of parts.territories.byId.values()) carriers(territory.wikiUrl)?.territory.push(territory);
    for (const region of parts.regions.byPublicId.values()) carriers(region.wikiUrl)?.area.push(region);
    for (const row of peaks)
        carriers(row.wiki_url)?.peak.push({ publicId: row.public_id, name: row.name, subtype: row.subtype });
    for (const segment of parts.paths.segments.values()) {
        carriers(segment.mainUrl)?.pathMain.push(segment.publicId);
        for (const further of segment.further) {
            carriers(further.url)?.pathFurther.push({ segment: segment.publicId, key: further.key });
        }
    }
    return { byKey };
}
