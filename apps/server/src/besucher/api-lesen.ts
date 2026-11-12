import { API_DROSSEL_METRIK, type ApiWerFragt, type ApiZahlen } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseDiagnosen } from "./diagnosen.ts";

/**
 * Die Zahlen des Unterreiters „API“ (WI-0138 V12). Wie der Besucherteil: alles aus Summen, nichts Feineres vorhanden.
 *
 * 🔴 Der **Takt** wird aus den Zonen herausgerechnet und eigens genannt. In Legacy waren 28 % aller Anfragen Lebenszeichen;
 * stünden sie in einer Zone, läse sich der Ring wie eine Aussage über die Nutzung, obwohl er eine über den Takt wäre.
 */

const zahl = (wert: string | number | null): number => (wert === null ? 0 : Math.round(Number(wert)));

function liste(
    zeilen: readonly { metric: string; dimension: string; count: string }[],
    metrik: string,
    grenze = 8,
): { name: string; wert: number }[] {
    return zeilen
        .filter((zeile) => zeile.metric === metrik && zeile.dimension !== "")
        .map((zeile) => ({ name: zeile.dimension, wert: zahl(zeile.count) }))
        .sort((a, b) => b.wert - a.wert)
        .slice(0, grenze);
}

export async function leseApiZahlen(sql: Queryable, tage: number): Promise<ApiZahlen> {
    const spanne = Math.max(1, Math.min(3660, Math.round(tage)));

    const summen = await sql<{ metric: string; dimension: string; count: string }[]>`
        SELECT metric, dimension, SUM(count)::text AS count
        FROM api_metric
        WHERE day >= CURRENT_DATE - ${spanne - 1}::int
        GROUP BY metric, dimension
    `;

    const [spanneZeile] = await sql<{ von: string | null; bis: string | null }[]>`
        SELECT MIN(day)::text AS von, MAX(day)::text AS bis FROM api_metric
        WHERE day >= CURRENT_DATE - ${spanne - 1}::int
    `;

    const stundenZeilen = await sql<{ hour: string; anzahl: string }[]>`
        SELECT hour::text, SUM(count)::text AS anzahl FROM api_metric
        WHERE metric = 'stunde' AND hour < 24 AND day >= CURRENT_DATE - ${spanne - 1}::int
        GROUP BY hour
    `;
    const stunden = Array.from({ length: 24 }, () => 0);
    for (const zeile of stundenZeilen) {
        const stunde = Number(zeile.hour);
        if (stunde >= 0 && stunde < 24) stunden[stunde] = zahl(zeile.anzahl);
    }
    const hoechste = Math.max(...stunden);

    const klassen = liste(summen, "klasse", 5);
    const zonen = liste(summen, "zone", 5);
    const anfragen = klassen.reduce((summe, eintrag) => summe + eintrag.wert, 0);
    const schlecht = klassen
        .filter((eintrag) => eintrag.name !== "2xx" && eintrag.name !== "3xx")
        .reduce((summe, eintrag) => summe + eintrag.wert, 0);

    const [speicherZeile] = await sql<{ zeilen: string; bytes: string }[]>`
        SELECT (SELECT COUNT(*) FROM api_metric)::text AS zeilen,
               pg_total_relation_size('api_metric')::text AS bytes
    `;

    // Fehler im Browser (WI-0202): die Zählung wie jede Kennzahl aus `visitor_metric`, ohne Automaten; dazu die Diagnosen.
    const artZeilen = await sql<{ metric: string; dimension: string; count: string }[]>`
        SELECT 'client_fehler' AS metric, dimension, SUM(count)::text AS count
        FROM visitor_metric
        WHERE metric = 'client_fehler' AND actor_type <> 'bot' AND day >= CURRENT_DATE - ${spanne - 1}::int
        GROUP BY dimension
    `;
    const diagnosen = await leseDiagnosen(sql, spanne);
    const werFragt = await leseWerFragt(sql, spanne, summen);

    return {
        tage: spanne,
        von: spanneZeile?.von ?? "",
        bis: spanneZeile?.bis ?? "",
        kennzahlen: {
            anfragen,
            fehlerquote: anfragen > 0 ? schlecht / anfragen : 0,
            spitzenstunde: hoechste > 0 ? stunden.indexOf(hoechste) : null,
            takt: zonen.find((eintrag) => eintrag.name === "takt")?.wert ?? 0,
        },
        klassen,
        // Der Takt steht in den Kennzahlen, nicht im Ring: er ist keine Zone der Nutzung.
        zonen: zonen.filter((eintrag) => eintrag.name !== "takt"),
        wege: liste(summen, "anfrage", 8),
        fehler: liste(summen, "fehler", 6),
        stunden,
        speicher: { zeilen: zahl(speicherZeile?.zeilen ?? null), bytes: zahl(speicherZeile?.bytes ?? null) },
        browserFehler: { arten: liste(artZeilen, "client_fehler", 6), diagnosen },
        ...(werFragt === undefined ? {} : { werFragt }),
    };
}

/**
 * Wer fragt (WI-0307): Herkunft, Absender von außen, Route von Dritten, alte Legacy-Pfade und die Drossel von Nginx (Teil B). Ohne
 * eine einzige Zeile dazu im Zeitraum (ein Server vor WI-0307, kein Teil B) kommt nichts, und die Oberfläche lässt den Abschnitt weg.
 */
async function leseWerFragt(
    sql: Queryable,
    spanne: number,
    summen: readonly { metric: string; dimension: string; count: string }[],
): Promise<ApiWerFragt | undefined> {
    const [beginn] = await sql<{ tag: string | null }[]>`
        SELECT MIN(day)::text AS tag FROM api_metric
        WHERE metric IN ('herkunft', 'legacy', ${API_DROSSEL_METRIK}) AND day >= CURRENT_DATE - ${spanne - 1}::int
    `;
    if (beginn?.tag === null || beginn?.tag === undefined) return undefined;

    // Die Achse beginnt am ersten gezählten Tag: Vor WI-0307 fragte nicht niemand, es zählte nur keiner. „Route von Dritten“ ist
    // `/api/route` und alles darunter, nicht `/api/routenplaner`.
    const tagZeilen = await sql<{ tag: string; route: string; legacy: string; drossel: string }[]>`
        SELECT achse.tag::date::text AS tag,
            COALESCE(SUM(m.count) FILTER (
                WHERE m.metric = 'weg_herkunft' AND split_part(m.dimension, '|', 2) <> 'eigene_seite'
                  AND (split_part(m.dimension, '|', 1) = '/api/route' OR split_part(m.dimension, '|', 1) LIKE '/api/route/%')
            ), 0)::text AS route,
            COALESCE(SUM(m.count) FILTER (WHERE m.metric = 'legacy'), 0)::text AS legacy,
            COALESCE(SUM(m.count) FILTER (WHERE m.metric = ${API_DROSSEL_METRIK} AND position('|' in m.dimension) = 0), 0)::text
                AS drossel
        FROM generate_series(${beginn.tag}::date, CURRENT_DATE, interval '1 day') AS achse(tag)
        LEFT JOIN api_metric m
            ON m.day = achse.tag::date AND m.metric IN ('weg_herkunft', 'legacy', ${API_DROSSEL_METRIK})
        GROUP BY achse.tag
        ORDER BY achse.tag
    `;

    const absenderZeilen = await sql<{ name: string; wert: string; erster: string; letzter: string }[]>`
        SELECT dimension AS name, SUM(count)::text AS wert, MIN(day)::text AS erster, MAX(day)::text AS letzter
        FROM api_metric
        WHERE metric = 'absender' AND day >= CURRENT_DATE - ${spanne - 1}::int
        GROUP BY dimension
        ORDER BY SUM(count) DESC, dimension
        LIMIT 12
    `;

    // Wege von außen: `<weg>|<herkunft>` ohne die eigene Seite, je Weg zusammengezählt.
    const vonAussen = new Map<string, number>();
    for (const zeile of summen) {
        if (zeile.metric !== "weg_herkunft") continue;
        const trenner = zeile.dimension.lastIndexOf("|");
        if (trenner < 0 || zeile.dimension.slice(trenner + 1) === "eigene_seite") continue;
        const weg = zeile.dimension.slice(0, trenner);
        vonAussen.set(weg, (vonAussen.get(weg) ?? 0) + zahl(zeile.count));
    }
    const drossel = summen.filter((zeile) => zeile.metric === API_DROSSEL_METRIK);

    return {
        herkunft: liste(summen, "herkunft", 3),
        fremdeSeiten: liste(summen, "fremde_seite", 8),
        absender: absenderZeilen.map((zeile) => ({
            name: zeile.name,
            wert: zahl(zeile.wert),
            erster: zeile.erster,
            letzter: zeile.letzter,
        })),
        wegeVonAussen: [...vonAussen]
            .map(([name, wert]) => ({ name, wert }))
            .sort((a, b) => b.wert - a.wert)
            .slice(0, 8),
        tage: tagZeilen.map((zeile) => zeile.tag),
        routeVonDritten: tagZeilen.map((zeile) => zahl(zeile.route)),
        legacy: tagZeilen.map((zeile) => zahl(zeile.legacy)),
        legacyPfade: liste(summen, "legacy", 8),
        drossel: tagZeilen.map((zeile) => zahl(zeile.drossel)),
        drosselZonen: liste(
            drossel.filter((zeile) => !zeile.dimension.includes("|")),
            API_DROSSEL_METRIK,
            8,
        ),
        drosselAbsender: liste(
            drossel.filter((zeile) => zeile.dimension.includes("|")),
            API_DROSSEL_METRIK,
            8,
        ),
    };
}
