import { editorLandscapeCircle, pointInGeometry, type EditorGebirge, type GebirgsObjekt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Objekte hinter den Flüssen, Seen und Pässen eines Gebirges (WI-0245, Reiter „Gebirge“, Entwurf V16/V17: „Je Zeile der Kreis ●, der
 * Name als Link zum Objekt“): je Eintrag der Eingabe die öffentliche Kennung (Flüsse und Pässe: der Weg, Seen: die Landschaft) und der
 * Kreis nach der Regel der Listen (`editorLandscapeCircle`: auf der Karte, mit oder ohne Wiki-Artikel).
 *
 * 🔴 Die Eingabe selbst bleibt unberührt (sie ist Zeichen für Zeichen die des Geländes, `terrain/inputs.ts`). Darum liest diese Datei
 * dieselben Zeilen in derselben Folge noch einmal (Flüsse und Seen nach `public_id`, Teilstücke mit einem Punkt in der Fläche) und
 * ordnet sie zu. Passt die Zahl nicht zur Eingabe (die Karte änderte sich dazwischen), steht kein Objekt da, nie ein falsches.
 */

export interface GebirgsObjekte {
    fluesse: (GebirgsObjekt | null)[];
    seen: (GebirgsObjekt | null)[];
    paesse: (GebirgsObjekt | null)[];
}

const teile = (geoJson: string): [number, number][][] => {
    const g = JSON.parse(geoJson) as { type: string; coordinates: unknown };
    if (g.type === "LineString") return [g.coordinates as [number, number][]];
    if (g.type === "MultiLineString") return g.coordinates as [number, number][][];
    return [];
};

/** Gleich lang wie die Eingabe, sonst lauter `null`. */
const passend = (gefunden: GebirgsObjekt[], soll: number): (GebirgsObjekt | null)[] =>
    gefunden.length === soll ? gefunden : Array.from({ length: soll }, () => null);

export async function leseGebirgsObjekte(
    database: Queryable,
    area: string,
    eingabe: EditorGebirge["eingabe"],
): Promise<GebirgsObjekte> {
    const leer: GebirgsObjekte = {
        fluesse: eingabe.fluesse.map(() => null),
        seen: eingabe.seen.map(() => null),
        paesse: (eingabe.paesse ?? []).map(() => null),
    };
    const [ziel] = await database<{ domain: string }[]>`
        SELECT map_domain_id AS domain FROM region_area WHERE public_id = ${area}::uuid
    `;
    if (!ziel) return leer;
    const b = eingabe.bounds;
    const drin = (x: number, y: number): boolean => pointInGeometry([x, y], eingabe.geometry);

    // Flüsse wie `loadMountainJobs`: jeder Flussweg, von dem ein Stützpunkt in der Fläche liegt, je Teilstück ein Eintrag.
    const fluesse = await database<{ public_id: string; geometry: string; wiki: boolean }[]>`
        SELECT p.public_id::text AS public_id, ST_AsGeoJSON(p.geom, 15) AS geometry,
               (coalesce(s.wiki_url, w.wiki_url) IS NOT NULL) AS wiki
          FROM path p
          LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
          LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
         WHERE p.map_domain_id = ${ziel.domain} AND p.is_active AND p.subtype = 'Flussweg'
           AND p.geom && ST_MakeEnvelope(${b.min_x}, ${b.min_y}, ${b.max_x}, ${b.max_y}, 0)
         ORDER BY p.public_id
    `;
    const flussObjekte = fluesse.flatMap((zeile) =>
        teile(zeile.geometry)
            .filter((teil) => teil.length >= 2 && teil.some(([x, y]) => drin(x, y)))
            .map(() => ({ id: zeile.public_id, kreis: editorLandscapeCircle(true, zeile.wiki) })),
    );

    // Seen wie `loadMountainJobs`: jede Seefläche, deren Hüllrechteck das des Gebirges berührt; das Objekt ist die Landschaft.
    const seen = await database<{ public_id: string; wiki: boolean }[]>`
        SELECT r.public_id::text AS public_id, (r.wiki_url IS NOT NULL OR r.wiki_region_key IS NOT NULL) AS wiki
          FROM region_area l JOIN region r ON r.id = l.region_id
         WHERE l.map_domain_id = ${ziel.domain} AND l.is_active
           AND r.region_layer = 'topographie' AND r.region_type = 'see'
           AND NOT (ST_XMax(l.geom) < ${b.min_x} OR ${b.max_x} < ST_XMin(l.geom)
                 OR ST_YMax(l.geom) < ${b.min_y} OR ${b.max_y} < ST_YMin(l.geom))
         ORDER BY l.public_id
    `;
    const seeObjekte = seen.map((zeile) => ({ id: zeile.public_id, kreis: editorLandscapeCircle(true, zeile.wiki) }));

    // Pässe tragen ihre Kennung schon in der Eingabe; hier kommt nur der Wiki-Stand dazu.
    const passIds = (eingabe.paesse ?? []).map((pass) => pass.id).filter((id): id is string => id !== undefined);
    const paesse =
        passIds.length === 0
            ? []
            : await database<{ public_id: string; wiki: boolean }[]>`
                  SELECT p.public_id::text AS public_id, (coalesce(s.wiki_url, w.wiki_url) IS NOT NULL) AS wiki
                    FROM path p
                    LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
                    LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
                   WHERE p.public_id = ANY(${passIds}::uuid[])
              `;
    const passWiki = new Map(paesse.map((zeile) => [zeile.public_id, zeile.wiki]));
    return {
        fluesse: passend(flussObjekte, eingabe.fluesse.length),
        seen: passend(seeObjekte, eingabe.seen.length),
        paesse: (eingabe.paesse ?? []).map((pass) =>
            pass.id === undefined || !passWiki.has(pass.id)
                ? null
                : { id: pass.id, kreis: editorLandscapeCircle(true, passWiki.get(pass.id) === true) },
        ),
    };
}
