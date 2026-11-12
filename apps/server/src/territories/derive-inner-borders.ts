import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Innengrenzen der Herrschaftsgebiete: genau EINE Linie zwischen zwei angrenzenden Flächen (WI-0062, Feinschliff
 * 2026-09-30, Betreiber: „gibt es die möglichkeit, dass es nur 1 innengrenze zwischen 2 angrenzenden flächen gibt … zwei
 * gestrichelte grenzen übereinander, das sieht doppelgemoppelt aus“).
 *
 * 🔴 Ursache der doppelten Linie (gemessen, siehe WI-0062): Legacys Flächen benachbarter Gebiete liegen nicht überall
 * kantengleich nebeneinander, sondern überlappen sich stellenweise um einen schmalen Streifen (Band 5: 211 Paare überlappen,
 * 60 über 0,001 E², 29 über 0,05 E²; Baronie Sardosk und Baronie Keilerau auf 10,6 E Länge im Mittel 0,06 E breit). Die alte
 * Ableitung nahm je Elter die Umrisse aller Kinder und schnitt die Hüllenkante ab: In einem Überlappungsstreifen bleibt der
 * Umriss beider Flächen stehen, jeder liegt im Innern der anderen, und beide stehen als gestrichelte Linie dicht nebeneinander
 * (im Bild „übereinander“). Legacy vermeidet das, indem es nur Kanten zeichnet, die zwei Kinder BIT FÜR BIT teilen
 * (`computeInnerBoundaryMultiLineString`, Segment-Dedup mit Zähler 2); wo die Kanten nicht zusammenfallen, gibt es dort
 * keine Linie.
 *
 * Hier in drei Schritten:
 *  1. ZELLEN. Die Flächen eines Bandes werden überlappungsfrei: in jedem Überlappungsstreifen gehört der Streifen der
 *     KLEINEREN Fläche (eine Baronie in einem Gebiet mit eigener Fläche bleibt so ein Loch darin, ihr Umriss bleibt sichtbar;
 *     bei gleicher Größe entscheidet die Kennung). Die Kante der Verliererin im Streifen ist dann genau die der Gewinnerin.
 *  2. KANTEN. Jede Innengrenze ist die gemeinsame Kante zweier Zellen und steht genau einmal. Sie gehört dem tiefsten
 *     gemeinsamen Vorfahren beider (dem tiefsten Glied, das in beiden Ketten vorkommt; ist die eine Fläche der Vorfahr der
 *     anderen, ist es sie selbst: Eigenfläche gegen Kind), ihre Ebene ist dessen Tiefe. Das ist dieselbe Zuordnung wie zuvor
 *     (Innengrenze eines Elters = Kanten zwischen seinen Kindern samt seiner Eigenfläche), ohne die Doppellinien. Kanten an
 *     der Hülle zählen nicht: sie liegen nicht zwischen zwei Zellen desselben Vorfahren.
 *  3. RESTE. Wo eine Fläche eine andere bis auf einen dünnen Rest überdeckt, bleibt eine Zelle wie ein Streifen mit zwei fast
 *     gleichen Kanten, und an der Spitze eines Keils laufen zwei Kanten zusammen. Liegt ein Stück (`innerUnique` der Tafel)
 *     fast ganz dicht an einem längeren, oder eine Strecke praktisch auf ihm, entfällt es beziehungsweise sie.
 *
 * Die Linien eines Vorfahren werden zu möglichst langen Zügen verbunden (`ST_LineMerge`): die Strichfolge läuft durch, statt
 * an jedem Knoten neu zu beginnen.
 *
 * 🔴 **Teillauf (WI-0283):** Die Kanten stehen in `territory_inner_edge`, weil die Zeile `inner` eines Reichs alle seine Kanten vereinigt und das Entdoppeln über
 * alle Eigner vergleicht. Neu entstehen die Kanten jeder Zelle, die eine geänderte Form berührt: die geänderten selbst und jede Form, die eine alte oder neue
 * Fassung davon überlappt. Das Entdoppeln hängt nur an Kanten in Reichweite: Der erste Schritt liest Rohkanten bis `toleranceUnits`, der zweite überlebende
 * Kanten bis `coincidenceUnits`; darum läuft der erste in einem um `toleranceUnits` und der zweite in einem um beide Reichweiten vergrößerten Rahmen. Dieselben
 * Anweisungen wie im vollen Lauf, also dasselbe Ergebnis.
 */

/** Legt die Arbeitstafeln an; einmal je Transaktion, vor dem ersten Band. */
export async function createInnerBorderTables(tx: Queryable): Promise<void> {
    await tx`
        CREATE TEMPORARY TABLE derive_cell (
            territory_id bigint PRIMARY KEY, geom geometry NOT NULL
        ) ON COMMIT DROP
    `;
    await tx`CREATE INDEX derive_cell_geom ON derive_cell USING GIST (geom)`;
    // Die Formen vor dem Teillauf (nur dort gefüllt): Wer die ALTE Fassung einer Form überlappte, dessen Zelle ändert sich auch.
    await tx`
        CREATE TEMPORARY TABLE derive_alte_form (
            territory_id bigint PRIMARY KEY, geom geometry NOT NULL
        ) ON COMMIT DROP
    `;
}

/** Alle Kanten dieser Domäne weg; der volle Lauf schreibt sie neu. */
export async function deleteInnerEdges(tx: Queryable, mapDomainId: string): Promise<void> {
    await tx`
        DELETE FROM territory_inner_edge
        WHERE owner_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
    `;
}

/** Ein Band, das dem vorigen gleicht (`bandKeys`), bekommt dessen Kanten. */
export async function copyInnerEdges(tx: Queryable, mapDomainId: string, band: number): Promise<void> {
    await tx`
        INSERT INTO territory_inner_edge (band, a_id, b_id, part, owner_id, depth, raw_len, raw_geom, lebt, len, geom)
        SELECT ${band}, e.a_id, e.b_id, e.part, e.owner_id, e.depth, e.raw_len, e.raw_geom, e.lebt, e.len, e.geom
        FROM territory_inner_edge e
        JOIN territory t ON t.id = e.owner_id
        WHERE e.band = ${band - 1} AND t.map_domain_id = ${mapDomainId}
    `;
}

/** Die Rahmen des Entdoppelns; `null` im vollen Lauf: alles. */
function rahmenFragment(tx: Queryable, spalte: "p" | "t", rahmen: string | null, reichweite: number) {
    if (rahmen === null) return tx``;
    return spalte === "p"
        ? tx`AND p.raw_geom && ST_Expand(${rahmen}::geometry, ${reichweite}::float8)`
        : tx`AND t.raw_geom && ST_Expand(${rahmen}::geometry, ${reichweite}::float8)`;
}

/**
 * Schreibt die Innengrenzen dieses Bandes (Grenzart `inner`, je Vorfahr eine Zeile). Setzt voraus: die Formen des Bandes in `territory_shape`, die Mitglieder der
 * Hüllen in `derive_member` und die Tafeln aus `createInnerBorderTables`. Mit `geaendert` (Teillauf) nur, was diese Formen berühren; dann steht in `derive_alte_form`
 * ihre vorige Fassung. Zurück kommen die Eigner, deren Zeile neu geschrieben wurde.
 */
export async function deriveInnerBorders(
    tx: Queryable,
    mapDomainId: string,
    band: number,
    geaendert: readonly number[] | null = null,
): Promise<number[]> {
    const unique = AVENTURIA_POLITICAL_CARTOGRAPHY.innerUnique;
    await tx`DELETE FROM derive_cell`;

    // Der Teillauf bestimmt zuerst, welche Zellen sich ändern (`betroffen`) und welche Nachbarn dafür gebraucht werden (`zellen`).
    let betroffen: number[] | null = null;
    let zellen: number[] | null = null;
    if (geaendert !== null) {
        const [zeile] = await tx<{ ids: string[] | null }[]>`
            WITH formen AS (
                SELECT geom FROM derive_alte_form
                UNION ALL
                SELECT s.geom FROM territory_shape s WHERE s.band = ${band} AND s.territory_id = ANY(${geaendert as number[]}::bigint[])
            )
            SELECT array_agg(DISTINCT s.territory_id::text) AS ids
            FROM territory_shape s
            JOIN formen f ON f.geom && s.geom AND ST_Relate(f.geom, s.geom, 'T********')
            WHERE s.band = ${band}
        `;
        betroffen = [...new Set([...geaendert, ...(zeile?.ids ?? []).map(Number)])];
        const [nachbarn] = await tx<{ ids: string[] | null }[]>`
            SELECT array_agg(DISTINCT n.territory_id::text) AS ids
            FROM territory_shape c
            JOIN territory_shape n ON n.band = c.band AND n.geom && c.geom AND ST_Intersects(n.geom, c.geom)
            WHERE c.band = ${band} AND c.territory_id = ANY(${betroffen}::bigint[])
        `;
        zellen = [...new Set([...betroffen, ...(nachbarn?.ids ?? []).map(Number)])];
    }

    // 1. Zellen: jede Form ohne die Streifen, in denen eine kleinere Form (bei gleicher Größe die mit der kleineren Kennung)
    // sie überdeckt. Die Kante der Zelle im Streifen ist dann genau die Kante der überdeckenden Form.
    await tx`
        INSERT INTO derive_cell (territory_id, geom)
        SELECT s.territory_id, c.geom
        FROM territory_shape s
        CROSS JOIN LATERAL (
            SELECT CASE WHEN n.covers = 0 THEN s.geom
                        ELSE ST_CollectionExtract(ST_Difference(s.geom, n.geom), 3) END AS geom
            FROM (
                SELECT count(*) AS covers, ST_UnaryUnion(ST_Collect(o.geom ORDER BY o.territory_id)) AS geom
                FROM territory_shape o
                WHERE o.band = s.band AND o.territory_id <> s.territory_id
                  AND o.geom && s.geom
                  AND ST_Relate(o.geom, s.geom, 'T********')
                  AND (o.area < s.area OR (o.area = s.area AND o.territory_id < s.territory_id))
            ) n
        ) c
        WHERE s.band = ${band} AND NOT ST_IsEmpty(c.geom)
        ${zellen === null ? tx`` : tx`AND s.territory_id = ANY(${zellen}::bigint[])`}
    `;

    // Im Teillauf weg, was eine betroffene Zelle berührt; was dabei und danach entsteht, bestimmt den Rahmen des Entdoppelns und die Eigner.
    let rahmen: string | null = null;
    const eigner = new Set<number>();
    const merke = (zeile: { eigner: string[] | null; rahmen: string | null } | undefined): string | null => {
        for (const id of zeile?.eigner ?? []) eigner.add(Number(id));
        return zeile?.rahmen ?? null;
    };
    let rahmenAlt: string | null = null;
    if (betroffen !== null) {
        const [weg] = await tx<{ eigner: string[] | null; rahmen: string | null }[]>`
            WITH weg AS (
                DELETE FROM territory_inner_edge
                WHERE band = ${band} AND (a_id = ANY(${betroffen}::bigint[]) OR b_id = ANY(${betroffen}::bigint[]))
                RETURNING owner_id, raw_geom
            )
            SELECT array_agg(DISTINCT owner_id::text) AS eigner, ST_AsEWKT(ST_Extent(raw_geom)::geometry) AS rahmen FROM weg
        `;
        rahmenAlt = merke(weg);
    }

    // 2. Kanten: die gemeinsame Kante je Paar benachbarter Zellen, zu Zügen verbunden, dem tiefsten gemeinsamen Vorfahren
    // zugeordnet (dem, der in beiden Ketten vorkommt).
    const [neu] = await tx<{ eigner: string[] | null; rahmen: string | null }[]>`
        WITH neu AS (
            INSERT INTO territory_inner_edge (band, a_id, b_id, part, owner_id, depth, raw_len, raw_geom, lebt, len, geom)
            SELECT ${band}, a.territory_id, b.territory_id, COALESCE(p.path[1], 0), lca.owner_id, lca.depth,
                   ST_Length(p.geom), p.geom, TRUE, ST_Length(p.geom), p.geom
            FROM derive_cell a
            JOIN derive_cell b ON a.territory_id < b.territory_id AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
            CROSS JOIN LATERAL (
                SELECT ST_CollectionExtract(ST_Intersection(ST_Boundary(a.geom), ST_Boundary(b.geom)), 2) AS ln
            ) e
            CROSS JOIN LATERAL ST_Dump(ST_LineMerge(e.ln)) p
            JOIN LATERAL (
                SELECT ma.owner_id, ma.depth
                FROM derive_member ma
                JOIN derive_member mb ON mb.band = ma.band AND mb.owner_id = ma.owner_id AND mb.member_id = b.territory_id
                WHERE ma.band = ${band} AND ma.member_id = a.territory_id
                ORDER BY ma.depth DESC
                LIMIT 1
            ) lca ON TRUE
            WHERE NOT ST_IsEmpty(e.ln)
            ${betroffen === null ? tx`` : tx`AND (a.territory_id = ANY(${betroffen}::bigint[]) OR b.territory_id = ANY(${betroffen}::bigint[]))`}
            RETURNING owner_id, raw_geom
        )
        SELECT array_agg(DISTINCT owner_id::text) AS eigner, ST_AsEWKT(ST_Extent(raw_geom)::geometry) AS rahmen FROM neu
    `;
    const rahmenNeu = merke(neu);
    if (betroffen !== null) {
        if (rahmenAlt === null && rahmenNeu === null) return [];
        const [gemeinsam] = await tx<{ rahmen: string }[]>`
            SELECT ST_AsEWKT(ST_Envelope(ST_Collect(g))) AS rahmen
            FROM unnest(ARRAY[${rahmenAlt}::geometry, ${rahmenNeu}::geometry]) AS g
            WHERE g IS NOT NULL
        `;
        rahmen = gemeinsam!.rahmen;
    }

    // 3. Reste: ein Stück, das fast ganz dicht an einem längeren liegt, ist dieselbe Grenze (zwei Kanten eines dünnen Restes).
    // Der Gleichstand folgt dem Paar und dem Stück, nicht dem Plan (WI-0229 S1).
    const reichweite = unique.toleranceUnits + unique.coincidenceUnits;
    if (rahmen !== null) {
        // Der Teillauf setzt seinen Rahmen zurück; frisch geschriebene Kanten im vollen Lauf stehen schon so.
        await tx`
            UPDATE territory_inner_edge p SET lebt = TRUE
            WHERE p.band = ${band} AND NOT p.lebt ${rahmenFragment(tx, "p", rahmen, unique.toleranceUnits)}
        `;
        const zurueck = await tx<{ owner_id: string }[]>`
            UPDATE territory_inner_edge t SET geom = t.raw_geom, len = t.raw_len
            WHERE t.band = ${band} ${rahmenFragment(tx, "t", rahmen, reichweite)}
            RETURNING t.owner_id::text AS owner_id
        `;
        for (const zeile of zurueck) eigner.add(Number(zeile.owner_id));
    }
    await tx`
        UPDATE territory_inner_edge p
        SET lebt = FALSE
        WHERE p.band = ${band} AND p.raw_len >= ${unique.minLengthUnits}::float8
          ${rahmenFragment(tx, "p", rahmen, unique.toleranceUnits)}
          AND EXISTS (
              SELECT 1
              FROM territory_inner_edge q
              WHERE q.band = p.band AND (q.a_id, q.b_id, q.part) <> (p.a_id, p.b_id, p.part)
                AND (q.raw_len > p.raw_len OR (q.raw_len = p.raw_len AND (q.a_id, q.b_id, q.part) < (p.a_id, p.b_id, p.part)))
                AND ST_DWithin(p.raw_geom, q.raw_geom, ${unique.toleranceUnits}::float8)
                AND ST_Length(ST_Intersection(p.raw_geom, ST_Buffer(q.raw_geom, ${unique.toleranceUnits}::float8)))
                    >= ${unique.share}::float8 * p.raw_len
          )
    `;
    // ... und eine Strecke von mindestens `minLengthUnits`, die praktisch auf einem längeren Stück liegt (die Spitze eines Keils),
    // wird aus dem kürzeren geschnitten. Kürzere Strecken bleiben: am Knoten laufen Linien immer ein Stück eng zusammen.
    await tx`
        UPDATE territory_inner_edge p
        SET geom = c.geom, len = ST_Length(c.geom)
        FROM (
            SELECT t.a_id, t.b_id, t.part,
                   ST_CollectionExtract(ST_Difference(t.raw_geom, ST_Buffer(ST_Collect(s.geom ORDER BY q.a_id, q.b_id, q.part, s.path), 0.0005)), 2) AS geom
            FROM territory_inner_edge t
            JOIN territory_inner_edge q
              ON q.band = t.band AND q.lebt AND (q.a_id, q.b_id, q.part) <> (t.a_id, t.b_id, t.part)
             AND (q.raw_len > t.raw_len OR (q.raw_len = t.raw_len AND (q.a_id, q.b_id, q.part) < (t.a_id, t.b_id, t.part)))
             AND ST_DWithin(t.raw_geom, q.raw_geom, ${unique.coincidenceUnits}::float8)
            CROSS JOIN LATERAL (
                SELECT d.geom, d.path
                FROM ST_Dump(ST_Intersection(t.raw_geom, ST_Buffer(q.raw_geom, ${unique.coincidenceUnits}::float8))) d
                WHERE ST_Length(d.geom) >= ${unique.minLengthUnits}::float8
            ) s
            WHERE t.band = ${band} AND t.lebt AND t.raw_len >= ${unique.minLengthUnits}::float8
              ${rahmenFragment(tx, "t", rahmen, reichweite)}
            GROUP BY t.a_id, t.b_id, t.part, t.raw_geom
        ) c
        WHERE p.band = ${band} AND p.a_id = c.a_id AND p.b_id = c.b_id AND p.part = c.part
    `;

    const liste = [...eigner].sort((a, b) => a - b);
    if (betroffen !== null) {
        await tx`
            DELETE FROM territory_border
            WHERE band = ${band} AND kind = 'inner' AND territory_id = ANY(${liste}::bigint[])
        `;
    }
    await tx`
        INSERT INTO territory_border (band, kind, level, territory_id, geom, render_geom)
        SELECT ${band}, 'inner', g.depth, g.owner_id, m.ln,
               map_domain_to_render(${mapDomainId}, m.ln)::geometry(MultiLineString, 3857)
        FROM (
            SELECT owner_id, depth, ST_UnaryUnion(ST_Collect(geom ORDER BY a_id, b_id, part)) AS lines
            FROM territory_inner_edge
            WHERE band = ${band} AND lebt AND NOT ST_IsEmpty(geom) AND len >= 1e-6
            ${betroffen === null ? tx`` : tx`AND owner_id = ANY(${liste}::bigint[])`}
            GROUP BY owner_id, depth
        ) g
        CROSS JOIN LATERAL (SELECT ST_Multi(ST_CollectionExtract(ST_LineMerge(g.lines), 2)) AS ln) m
        WHERE NOT ST_IsEmpty(m.ln)
    `;
    return liste;
}
