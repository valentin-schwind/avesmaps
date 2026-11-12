import { SUBJECT_REVIEW_LIMIT, sternVerteilung, type ReviewEntry } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";

/**
 * Die Sektion „Bewertung“ eines Ortes (WI-0063 P8, Vertrag `reviews.yaml`, D4; Legacy `js/community/location-reviews.js`, Mirror
 * `04a85a54f`): die öffentlichen Sternebewertungen, neueste zuerst, dazu Anzahl, Durchschnitt und Verteilung der Sterne über ALLE öffentlichen -
 * nicht über die gezeigten (Legacy `api/_internal/reviews.php`).
 *
 * 🔴 NUR ORTE haben Bewertungen (`reviews.yaml` -> `anzeige.subjects`): Weg, Landschaft, Gebiet, Gipfel und Kraftlinie bauen keine.
 *
 * 🔴 NUR ÖFFENTLICHES (WI-0269, Fachkonzept §14.3): Eine Bewertung ist öffentlich, wenn ihr Zustand `neu` oder `gesichtet` ist. Zurückgehaltene
 * (Spamverdacht) und verborgene stehen weder in der Liste noch in Anzahl, Durchschnitt oder Verteilung - und ihr Inhalt verlässt diese
 * Abfrage nie. Der Ort muss aktiv sein: Ist er entfernt, verschwinden seine Bewertungen aus der Anzeige.
 *
 * 🔴 DATENSCHUTZ AM LESEPFAD (`reviews.yaml` -> `datenschutz_am_lesepfad`): Die Antwort trägt den freien Anzeigenamen und den Text
 * genau EINES Ortes, die öffentliche Kennung der Bewertung (für Teilen, „Gefällt mir“, Melden) und die Zahl „Gefällt mir“ - sonst nichts:
 * keine Anlagezeit, keine Personenspalte (die Tabelle hat keine). Es gibt keinen Weg, Bewertungen über Orte hinweg oder nach Autor zu lesen.
 *
 * 🪤 Der Durchschnitt wird im Lesepfad gerechnet, nie gespeichert, und zwar über `numeric` (`ROUND(AVG(stars)::numeric, 1)`):
 * Gleitkomma rundete an der Grenze anders als Legacys PHP.
 */

interface SummaryRow {
    total: number;
    average: string | null;
    verteilung: number[];
}

interface ReviewRow {
    public_id: string;
    stars: number;
    author_name: string | null;
    body: string | null;
    dsa_date: string | null;
    gefaellt: number;
}

export interface ReviewsResult {
    count: number;
    average?: number;
    distribution?: number[];
    reviews: ReviewEntry[];
}

/** Die öffentlichen Bewertungen eines Ortes (`place.public_id`), höchstens `SUBJECT_REVIEW_LIMIT`, dazu Anzahl, Durchschnitt und Verteilung aller. */
export async function listReviews(database: Queryable, placePublicId: string): Promise<ReviewsResult> {
    const [summary] = await database.unsafe<SummaryRow[]>(
        `SELECT count(*)::int AS total, round(avg(v.stars)::numeric, 1)::text AS average,
                ARRAY[count(*) FILTER (WHERE v.stars = 5), count(*) FILTER (WHERE v.stars = 4), count(*) FILTER (WHERE v.stars = 3),
                      count(*) FILTER (WHERE v.stars = 2), count(*) FILTER (WHERE v.stars = 1)]::int[] AS verteilung
         FROM place_review v
         JOIN place p ON p.id = v.place_id
         WHERE p.public_id = $1::uuid AND p.is_active AND v.zustand IN ('neu', 'gesichtet')`,
        [placePublicId],
    );
    const count = summary?.total ?? 0;
    if (count === 0) return { count: 0, reviews: [] };
    const rows = await database.unsafe<ReviewRow[]>(
        `SELECT v.public_id::text, v.stars, v.author_name, v.body, v.dsa_date, v.gefaellt
         FROM place_review v
         JOIN place p ON p.id = v.place_id
         WHERE p.public_id = $1::uuid AND p.is_active AND v.zustand IN ('neu', 'gesichtet')
         ORDER BY v.eingang DESC, v.id DESC
         LIMIT $2`,
        [placePublicId, SUBJECT_REVIEW_LIMIT],
    );
    const average = summary?.average === null || summary?.average === undefined ? undefined : Number(summary.average);
    return {
        count,
        ...(average === undefined || !Number.isFinite(average) ? {} : { average }),
        distribution: summary?.verteilung ?? sternVerteilung(rows.map((row) => row.stars)),
        reviews: rows.map((row) => ({
            id: row.public_id,
            ...(row.gefaellt > 0 ? { likes: row.gefaellt } : {}),
            stars: row.stars,
            ...(row.author_name === null ? {} : { author: row.author_name }),
            ...(row.body === null ? {} : { text: row.body }),
            ...(row.dsa_date === null ? {} : { date: row.dsa_date }),
        })),
    };
}
