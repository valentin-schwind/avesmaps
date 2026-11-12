import {
    foldName,
    istLandmarkenArt,
    LANDMARKEN_KATALOG,
    landmarkWaypointId,
    parseLandmarkWaypointId,
    SEARCH_MIN_LENGTH,
    type LandmarkenArt,
    type WaypointHit,
    type WaypointNearestResponse,
    type WaypointResponse,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";

/**
 * Die Wegpunktsuche des Routenplaners (WI-0017, Schritt 2, B2/B3): ein Ort je Vorschlag, auch
 * versteckte, in Legacys Rangfolge.
 *
 * ⭐ **Im Speicher, nicht als Abfrage je Tastendruck.** Es sind 3.426 Orte; sie werden einmal geladen
 * und neu, sobald sich der Ortsbestand ändert (höchstens alle 5 s gefragt, wie der Rechendienst der
 * Route). Der Vergleich im Speicher kann, was `ILIKE` nicht kann: **Akzente und ß egal** - „Garen"
 * findet „Garèn", „Strasse" findet „Straße". Legacy verglich exakt (MCS-020, B2).
 *
 * 🪤 Nicht die Spotlightsuche (`search/search.ts`): Die kennt vier Domänen, blendet versteckte Orte
 * aus und ordnet nach Klasse. Ein Wegpunktfeld braucht einen Ort, auch einen versteckten, und ordnet
 * wie Legacys Planer: exakt vor Anfang vor Wortanfang vor „enthält", dann alphabetisch.
 *
 * ⭐ **Orte und Landmarken** (WI-0271 L6, §4.3): Eine aktive Landmarke, deren Art Reiseziel sein darf (`LANDMARKEN_KATALOG`), ist
 * ein Wegpunkt `l:<uuid>` wie ein Ort, in derselben Rangfolge. Sie steht in einer eigenen Liste neben den Orten: Der nächste Ort
 * zu einem Kartenpunkt („Kartenpunkt bei Gareth“) und die Namen eines Links bleiben Orte. Diese Liste ist auch die Stelle, an der
 * die Route eine Landmarke auflöst (`routes/route.ts`): EINE Regel dafür, was Reiseziel ist.
 */

export interface WaypointPlace {
    id: string;
    name: string;
    subtype: string;
    hidden: boolean;
    x: number;
    y: number;
    /** Nur bei einer Landmarke: ihre Art (`subtype` trägt dieselbe); ein Ort hat das Feld nicht. */
    landmark?: LandmarkenArt;
}

/** 0 exakt, 1 Anfang, 2 Wortanfang, 3 enthält, sonst null (Legacy `map-features-waypoints.js`). */
function matchRank(folded: string, query: string): number | null {
    if (folded === query) return 0;
    if (folded.startsWith(query)) return 1;
    const at = folded.indexOf(query);
    if (at < 0) return null;
    // Wortanfang: nach Leerzeichen, Bindestrich, Apostroph oder Klammer („Alt-Garnelen", „(Ragath)").
    for (let index = at; index >= 0; index = folded.indexOf(query, index + 1)) {
        if (/[\s\-'’(]/.test(folded.charAt(index - 1))) return 2;
    }
    return 3;
}

const COLLATOR = new Intl.Collator("de");

/** Die Vorschläge zu einer Eingabe, höchstens `limit`, und ob es mehr gäbe. */
export function rankWaypoints(
    places: readonly WaypointPlace[],
    rawQuery: string,
    limit: number,
): { hits: WaypointHit[]; truncated: boolean } {
    const query = foldName(rawQuery);
    if (query.length < SEARCH_MIN_LENGTH) return { hits: [], truncated: false };
    const matches: { place: WaypointPlace; rank: number }[] = [];
    for (const place of places) {
        const rank = matchRank(foldName(place.name), query);
        if (rank !== null) matches.push({ place, rank });
    }
    matches.sort((a, b) => a.rank - b.rank || COLLATOR.compare(a.place.name, b.place.name));
    return {
        hits: matches.slice(0, limit).map(({ place }) => ({ ...place })),
        truncated: matches.length > limit,
    };
}

/**
 * Die Orte zu Namen aus einem Link (`?route=Gareth~Perricum`, Legacys `?route=Gareth&route=…`), in
 * derselben Reihenfolge; null, wo kein Ort EINDEUTIG passt.
 *
 * Zuerst gilt der Name genau so, wie er geschrieben ist - Legacy hält Ortsnamen eindeutig (MCS-020,
 * B7). Sonst der Name ohne Akzente und Großschreibung, aber nur, wenn genau ein Ort so heißt.
 * 🔴 Lieber null als ein Treffer, der vielleicht der falsche ist: Kap. 9.57 verbietet, dass ein alter
 * Link still eine andere Route öffnet. Die Oberfläche sagt dann, welcher Ort nicht gefunden wurde.
 */
export function resolveWaypoints(
    places: readonly WaypointPlace[],
    names: readonly string[],
    landmarks: readonly WaypointPlace[] = [],
): (WaypointHit | null)[] {
    const exact = new Map<string, WaypointPlace>();
    const folded = new Map<string, WaypointPlace[]>();
    for (const place of places) {
        exact.set(place.name, place);
        const key = foldName(place.name);
        folded.set(key, [...(folded.get(key) ?? []), place]);
    }
    // Eine Landmarke steht im Link als ihre Kennung (`l:<uuid>`, WI-0271 L6), nie als Name: Ein Name könnte auch ein Ort sein.
    const byId = new Map(landmarks.map((landmark) => [landmark.id, landmark]));
    return names.map((name) => {
        const landmark = parseLandmarkWaypointId(name.trim());
        if (landmark !== null) {
            const found = byId.get(landmarkWaypointId(landmark));
            return found ? { ...found } : null;
        }
        const direct = exact.get(name.trim());
        if (direct) return { ...direct };
        const candidates = folded.get(foldName(name)) ?? [];
        return candidates.length === 1 && candidates[0] ? { ...candidates[0] } : null;
    });
}

/**
 * Die Orte hinter festen Kennungen (`public_id`), in Reihenfolge - für einen Kurzlink (WI-0034). Eine Landmarke steht mit
 * ihrer Kennung `l:<uuid>` in derselben Liste (WI-0271 L6).
 * `null`, wo es den Ort nicht mehr gibt; die Oberfläche sagt das, statt ihn still auszulassen.
 */
export function waypointsById(places: readonly WaypointPlace[], ids: readonly string[]): (WaypointHit | null)[] {
    const byId = new Map(places.map((place) => [place.id, place]));
    return ids.map((id) => {
        const place = byId.get(id.toLowerCase());
        return place ? { ...place } : null;
    });
}

/**
 * Der nächste SICHTBARE Ort zu einem Punkt - ein versteckter wird nicht verraten (Legacy
 * „Nächsten Ort finden“ zeigt nur, was auf der Karte steht).
 */
export function nearestWaypoint(places: readonly WaypointPlace[], x: number, y: number): WaypointNearestResponse {
    let best: WaypointPlace | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const place of places) {
        if (place.hidden) continue;
        const distance = Math.hypot(place.x - x, place.y - y);
        if (distance < bestDistance) {
            best = place;
            bestDistance = distance;
        }
    }
    return best ? { place: { ...best }, distance: bestDistance } : { place: null, distance: null };
}

export interface WaypointIndex {
    lookup(query: string, limit: number): Promise<WaypointResponse>;
    resolve(names: readonly string[]): Promise<(WaypointHit | null)[]>;
    byIds(ids: readonly string[]): Promise<(WaypointHit | null)[]>;
    nearest(x: number, y: number): Promise<WaypointNearestResponse>;
}

export interface WaypointIndexOptions {
    mapDomainId?: string;
    recheckMs?: number;
    now?: () => number;
}

/** Die Arten, die Reiseziel sein dürfen (`LANDMARKEN_KATALOG`); Riff und Strudel nicht. */
const REISEZIEL_ARTEN: ReadonlySet<string> = new Set(
    Object.entries(LANDMARKEN_KATALOG).flatMap(([art, eintrag]) => (eintrag.reiseziel ? [art] : [])),
);

/** Ist diese Zeile von `terrain_peak` ein Wegpunkt? Nur eine bekannte Art, die Reiseziel sein darf (WI-0271 L6). */
export function isWaypointLandmark(subtype: string): subtype is LandmarkenArt {
    return istLandmarkenArt(subtype) && REISEZIEL_ARTEN.has(subtype);
}

interface Bestand {
    places: WaypointPlace[];
    /** Die Landmarken, die Wegpunkt sein dürfen (WI-0271 L6); Kennung `l:<uuid>`. */
    landmarks: WaypointPlace[];
    /** Beide zusammen, Orte zuerst: Bei gleichem Rang und Namen steht der Ort vorn (die Sortierung ist stabil). */
    all: WaypointPlace[];
}

/** Die Orte und Landmarken aus der Datenbank, im Speicher gehalten und bei jeder Änderung neu geladen. */
export function databaseWaypointIndex(database: Database, options: WaypointIndexOptions = {}): WaypointIndex {
    const mapDomainId = options.mapDomainId ?? "aventuria";
    const recheckMs = options.recheckMs ?? 5000;
    const now = options.now ?? (() => Date.now());
    let bestand: Bestand | undefined;
    let revision = "";
    let lastCheck = Number.NEGATIVE_INFINITY;

    const current = async (): Promise<Bestand> => {
        if (bestand && now() - lastCheck < recheckMs) return bestand;
        lastCheck = now();
        // Je Tabelle die Zahl der aktiven Zeilen und die letzte Änderung; am Gipfel setzt der Trigger `revision_bump` `updated_at`.
        const [state] = await database<{ state: string }[]>`
            SELECT (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                      FROM place WHERE map_domain_id = ${mapDomainId})
                   || '|' ||
                   (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                      FROM terrain_peak WHERE map_domain_id = ${mapDomainId}) AS state
        `;
        if (!bestand || state?.state !== revision) {
            const rows = await database<
                { id: string; name: string; subtype: string; hidden: boolean; x: number; y: number }[]
            >`
                SELECT public_id::text AS id, name, subtype, COALESCE(is_hidden, FALSE) AS hidden,
                       ST_X(geom) AS x, ST_Y(geom) AS y
                FROM place
                WHERE is_active AND map_domain_id = ${mapDomainId}
            `;
            const places = rows.map((row) => ({ ...row, x: Number(row.x), y: Number(row.y) }));
            // Die aktiven Landmarken, die auf der Karte stehen; welche Art Reiseziel ist, sagt der Katalog (`isWaypointLandmark`), keine zweite
            // Liste in SQL. 🔴 Mit dem Merkmal „nur Gelände“ ist eine Landmarke kein Reiseziel (wie in der Spotlight-Suche, `search/landmarken-suche.ts`): Sie
            // steht nicht auf der Karte, oft ist sie ein Hilfspunkt des Geländes aus Legacy. „Auf der Karte anzeigen“ aus nimmt nur den Text (WI-0271 §18). Eine verborgene Landmarke (`hidden`, WI-0271 §17) ist dagegen gewollt verborgen wie ein Ort: Sie lässt sich über ihre Kennung bereisen, wenn man sie entdeckt hat, und taucht nie in einer Liste auf.
            const peaks = await database<
                { id: string; name: string; subtype: string; hidden: boolean; x: number; y: number }[]
            >`
                SELECT public_id::text AS id, name, subtype, 'verborgen' = ANY (merkmale) AS hidden, ST_X(geom) AS x, ST_Y(geom) AS y
                FROM terrain_peak
                WHERE is_active AND NOT 'nur_gelaende' = ANY (merkmale) AND map_domain_id = ${mapDomainId}
            `;
            const landmarks = peaks.flatMap((row): WaypointPlace[] =>
                isWaypointLandmark(row.subtype)
                    ? [
                          {
                              id: landmarkWaypointId(row.id),
                              name: row.name,
                              subtype: row.subtype,
                              hidden: row.hidden,
                              x: Number(row.x),
                              y: Number(row.y),
                              landmark: row.subtype,
                          },
                      ]
                    : [],
            );
            bestand = { places, landmarks, all: [...places, ...landmarks] };
            revision = state?.state ?? "";
        }
        return bestand;
    };

    return {
        async lookup(rawQuery, limit) {
            const query = rawQuery.trim();
            // Eine verborgene Landmarke steht nie unter den Vorschlägen, nur über ihre Kennung (`byIds`, `resolve`).
            const { all } = await current();
            const sichtbar = all.filter((eintrag) => eintrag.landmark === undefined || !eintrag.hidden);
            return { query, ...rankWaypoints(sichtbar, query, limit) };
        },
        async resolve(names) {
            const { places, landmarks } = await current();
            return resolveWaypoints(places, names, landmarks);
        },
        async byIds(ids) {
            return waypointsById((await current()).all, ids);
        },
        async nearest(x, y) {
            // Nur Orte: Ein Kartenpunkt heißt nach dem nächsten Ort, nicht nach einer Landmarke.
            return nearestWaypoint((await current()).places, x, y);
        },
    };
}
