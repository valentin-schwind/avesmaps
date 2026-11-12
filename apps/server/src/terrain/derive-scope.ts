/**
 * Der Auftrag einer Ableitung des Höhenmodells (WI-0059, 4.7): Worauf bezieht sie sich?
 *
 * Ein kleiner Typ, kein Workflow. Er wird von der Ableitung des Geländes (I11) über das Relief (I12) zu den
 * Anzeigehöhen (I13) durchgereicht und sagt jeder Stufe, was die vorige geändert hat, beziehungsweise, was ein
 * Aufrufer (später der Editor-Job, Kap. 7.15) selbst als geändert benennt.
 *
 * - `full` ist der Standard und das Verhalten von vor WI-0059: alles prüfen, was die Fingerabdrücke als veraltet
 *   zeigen. Import, Korridor und `legacy:update` rufen so auf.
 * - `bounds`: die Änderung liegt in diesem Kartenbereich (Karteneinheiten, Süden = kleines y). `bounds: null`
 *   heißt „bekanntermaßen nichts geändert“.
 * - `entities`: die Änderung betrifft diese Gebirge (`public_id` oder Name).
 *
 * 🔴 Der Bereich schränkt nie die Rechnung einer Stufe ein, deren Ergebnis er nicht sicher abgrenzt (Relief und
 * Anzeigehöhen, siehe deren Kopfkommentare): Diese Stufen rechnen dann, wenn ihre Eingaben sich geändert haben,
 * den vollen Lauf und melden nur, wie weit sich das Ergebnis vom Bereich entfernt hat. Ein Bereich ist ein Hinweis
 * mit Nachweis, keine Abkürzung auf Verdacht: Das Ergebnis bleibt bytegleich zum vollen Lauf.
 */

/** Ein Kartenbereich in Karteneinheiten. */
export interface DeriveBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export type DeriveScope =
    { kind: "full" } | { kind: "bounds"; bounds: DeriveBounds | null } | { kind: "entities"; ids: readonly string[] };

/** Der Standard: alles, was die Fingerabdrücke als veraltet zeigen. */
export const FULL_SCOPE: DeriveScope = { kind: "full" };

/** Die Vereinigung zweier Bereiche; `null` ist „nichts“. */
export function unionBounds(a: DeriveBounds | null, b: DeriveBounds | null): DeriveBounds | null {
    if (!a) return b;
    if (!b) return a;
    return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
    };
}

/** Berühren oder überlappen sich die Bereiche? Ränder zählen mit. */
export function boundsIntersect(a: DeriveBounds, b: DeriveBounds): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Der Abstand (Karteneinheiten, Chebyshev) von `inner` bis zum nächsten Rand von `outer`, den `inner` überragt,
 * also wie weit `inner` über `outer` hinausreicht. 0, wenn `inner` ganz in `outer` liegt.
 */
export function overhang(inner: DeriveBounds, outer: DeriveBounds): number {
    return Math.max(
        0,
        outer.minX - inner.minX,
        outer.minY - inner.minY,
        inner.maxX - outer.maxX,
        inner.maxY - outer.maxY,
    );
}

/**
 * Der Auftrag für die nächste Stufe aus dem, was eine Stufe geändert hat: der Bereich der geänderten Kacheln,
 * `null` darin, wenn nichts geändert wurde, und der volle Auftrag, wenn die Stufe den Bereich nicht kennt
 * (erste Revision, nichts zum Vergleichen).
 */
export function scopeOfChange(known: boolean, bounds: DeriveBounds | null): DeriveScope {
    return known ? { kind: "bounds", bounds } : FULL_SCOPE;
}

/** Bezeichnet der Auftrag dieses Gebirge (nur `entities`; `full` und `bounds` wählen darüber nicht aus)? */
export function scopeNames(scope: DeriveScope, publicId: string, name: string): boolean {
    return scope.kind === "entities" && (scope.ids.includes(publicId) || scope.ids.includes(name));
}
