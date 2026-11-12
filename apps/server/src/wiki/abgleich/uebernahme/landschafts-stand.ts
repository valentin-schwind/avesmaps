import type { Queryable } from "../../../database.ts";

/** Der Wiki-Stand einer Landschafts-Infobox (`wiki_region_snapshot`): Spalten und Schreibweg, die Landschaft, Gipfel und Wiki-Eintrag ohne Fläche teilen. */

/** Die Nachbarn stehen nicht in einer Spalte, sondern in Zeilen je Richtung: `@<Richtung>`. */
const RICHTUNGEN = {
    nachbar_n: "N",
    nachbar_no: "NO",
    nachbar_o: "O",
    nachbar_so: "SO",
    nachbar_s: "S",
    nachbar_sw: "SW",
    nachbar_w: "W",
    nachbar_nw: "NW",
} as const;
const NACHBAR_SPALTEN = Object.fromEntries(
    Object.entries(RICHTUNGEN).map(([feld, richtung]) => [feld, `@${richtung}`]),
);

/** Die Spalten des Wiki-Stands einer Landschafts-Infobox (ohne den Kontinent, den der Wiki-Teil der Landschaft liefert); der Gipfel schreibt dieselben. */
export const LANDSCHAFTS_STAND: Readonly<Record<string, string>> = {
    name: "name",
    art: "art",
    region_parent: "region_parent",
    affiliation_staat: "affiliation_staat",
    einwohner: "einwohner",
    sprache: "sprache",
    vegetation: "vegetation",
    verkehrswege: "verkehrswege",
    description: "description",
    ...NACHBAR_SPALTEN,
};

/**
 * Schreibt Spalten EINES Wiki-Stands einer Landschafts-Infobox (`wiki_region_snapshot`): einfache Spalten, die Art (die erste Komponente; der Rest hinter dem ersten `|` bleibt) und die Nachbarn
 * (`@<Richtung>`: die Zeilen einer Richtung werden als Ganzes ersetzt, die Namen so getrennt, wie der Leser sie verbindet). Landschaft und Gipfel teilen diese Tafel.
 */
export async function schreibeLandschaftsStand(
    tx: Queryable,
    schnappschussId: string,
    spalten: Readonly<Record<string, string | null>>,
): Promise<void> {
    const einfach: Record<string, string | null> = {};
    const richtungen: [string, string | null][] = [];
    let art: { wert: string | null } | undefined;
    for (const [spalte, wert] of Object.entries(spalten)) {
        if (spalte.startsWith("@")) richtungen.push([spalte.slice(1), wert]);
        else if (spalte === "art") art = { wert };
        else einfach[spalte] = wert;
    }
    const namen = Object.keys(einfach);
    if (namen.length > 0) {
        await tx`
            UPDATE wiki_region_snapshot SET ${tx(einfach, ...namen)}, updated_at = now() WHERE id = ${schnappschussId}::bigint
        `;
    }
    if (art !== undefined) {
        // Die erste Komponente der Art ersetzen, den Rest hinter dem ersten `|` stehen lassen (Legacy liest die erste, die Tafel hält den Rest roh).
        await tx`
            UPDATE wiki_region_snapshot
               SET art = CASE
                       WHEN ${art.wert}::text IS NULL THEN NULL
                       ELSE ${art.wert}::text || COALESCE(CASE WHEN position('|' IN art) > 0 THEN substring(art FROM position('|' IN art)) END, '')
                   END,
                   updated_at = now()
             WHERE id = ${schnappschussId}::bigint
        `;
    }
    for (const [richtung, wert] of richtungen) {
        await tx`DELETE FROM wiki_region_snapshot_neighbor WHERE snapshot_id = ${schnappschussId}::bigint AND direction = ${richtung}`;
        const teile = (wert ?? "")
            .split(/\s*,\s*/u)
            .map((teil) => teil.trim())
            .filter((teil) => teil !== "");
        if (teile.length > 0) {
            await tx`
                INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
                SELECT ${schnappschussId}::bigint, ${richtung}, t.position - 1, t.name
                  FROM unnest(${teile}::text[]) WITH ORDINALITY AS t(name, position)
            `;
        }
        await tx`UPDATE wiki_region_snapshot SET updated_at = now() WHERE id = ${schnappschussId}::bigint`;
    }
}
