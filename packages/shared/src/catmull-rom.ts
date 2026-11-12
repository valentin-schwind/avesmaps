/**
 * Die gezeichnete Kurve eines Weges (WI-0010, Betreiberauftrag 2026-09-22).
 *
 * 🔴 DIES IST DARSTELLUNG, NICHT GEOMETRIE. `path.geom` bleibt authoritativ und unverändert;
 * Routing und Topologie rechnen weiter darauf. Was hier entsteht, ist eine **abgeleitete visuelle
 * Geometrie** — und sie ist es für BEIDE Zwecke: die sichtbare Linie und den Schriftlauf. Es darf
 * nicht passieren, dass die Straße geglättet wird und ihr Name auf der Rohgeometrie liegen bleibt.
 *
 * ⭐ Eine Implementierung, kein Zwilling. Legacy hat denselben Satz gelernt und schreibt ihn über
 * seine Datei: „A second copy of these ~30 lines would be two curves free to drift apart."
 *
 * 💣 DIE KURVE ÜBERSCHWINGT AN ECKEN, UND DAS IST GEWOLLT. Legacy hat es an einem rechten Winkel
 * gemessen: die Kurve taucht **0,732 Karteneinheiten** unter den einlaufenden Schenkel und
 * schwingt ebenso weit über den auslaufenden hinaus. Sein Kommentar dazu, wörtlich: *„That is not
 * a defect to damp out; it is what the map draws."* Wer das wegdämpft, zeichnet eine andere Karte.
 *
 * 🪤 Zoomunabhängig. Legacy hält die Kurve ausdrücklich über alle Stufen gleich; eine je Zoom neu
 * berechnete Spline wäre eine andere Linie pro Stufe und ein Name, der beim Zoomen von seinem Weg
 * rutscht. Wird Generalisierung nötig, wird DIESE Kurve vereinfacht — nicht eine neue gerechnet.
 */

export interface CatmullConfig {
    /** Zwischenpunkte je Segment. */
    samples: number;
    /** Skaliert beide Tangenten; 0 legt die Kurve auf den Polygonzug zurück. */
    tension: number;
}

/**
 * Legacys ausgelieferte Werte (`map-features-line-catmull.js`).
 *
 * 🪤 Als EVIDENZ übernommen, nicht als Produktkonstante festgeschrieben — sie sind gegen reale
 * Wege zu messen, bevor sie endgültig gelten (Betreiberauftrag).
 */
export const LEGACY_CATMULL: CatmullConfig = { samples: 8, tension: 0.5 };

export interface CurvePoint {
    x: number;
    y: number;
}

/**
 * Ein abgetasteter Punkt des Abschnitts `current → next`.
 *
 * Kubisches Hermite; `previous` und `following` sind die Nachbarn, aus denen die Tangenten
 * entstehen. Mit `tension = 0.5` ist das das gewöhnliche uniforme Catmull-Rom.
 */
export function catmullRomPoint(
    previous: CurvePoint,
    current: CurvePoint,
    next: CurvePoint,
    following: CurvePoint,
    t: number,
    tension: number,
): CurvePoint {
    const t2 = t * t;
    const t3 = t2 * t;
    const tangentStartX = (next.x - previous.x) * tension;
    const tangentStartY = (next.y - previous.y) * tension;
    const tangentEndX = (following.x - current.x) * tension;
    const tangentEndY = (following.y - current.y) * tension;
    const basisStart = 2 * t3 - 3 * t2 + 1;
    const basisTangentStart = t3 - 2 * t2 + t;
    const basisEnd = -2 * t3 + 3 * t2;
    const basisTangentEnd = t3 - t2;

    return {
        x:
            basisStart * current.x +
            basisTangentStart * tangentStartX +
            basisEnd * next.x +
            basisTangentEnd * tangentEndX,
        y:
            basisStart * current.y +
            basisTangentStart * tangentStartY +
            basisEnd * next.y +
            basisTangentEnd * tangentEndY,
    };
}

/**
 * Die ganze Linie: der erste Stützpunkt, dann `samples` Punkte je Abschnitt.
 *
 * 🪤 Der letzte Abtastwert eines Abschnitts trägt `t = 1` und landet damit exakt auf dem nächsten
 * Stützpunkt. Anfang und Ende bewegen sich deshalb nie, und der gemeinsame Punkt zweier Abschnitte
 * erscheint einmal statt doppelt — sonst hätte die Kurve an jeder Ecke einen Doppelpunkt, und
 * `ST_LineMerge` bräche daran.
 */
export function catmullRomLine(points: readonly CurvePoint[], config: CatmullConfig = LEGACY_CATMULL): CurvePoint[] {
    if (points.length < 2) {
        return [...points];
    }
    const sampleCount = Math.max(1, Math.trunc(config.samples) || 8);
    const tension = Math.max(0, Math.min(1, config.tension));
    const smoothed: CurvePoint[] = [points[0] as CurvePoint];

    for (let index = 0; index < points.length - 1; index += 1) {
        const previous = points[Math.max(0, index - 1)] as CurvePoint;
        const current = points[index] as CurvePoint;
        const next = points[index + 1] as CurvePoint;
        const following = points[Math.min(points.length - 1, index + 2)] as CurvePoint;

        for (let sample = 1; sample <= sampleCount; sample += 1) {
            smoothed.push(catmullRomPoint(previous, current, next, following, sample / sampleCount, tension));
        }
    }
    return smoothed;
}
