/**
 * Die Regeln an Wegen und Kraftlinien, EINMAL für Editor und Server (Vali 2026-11-10, „Ja, alle drei“ auf die Frage der Koordination, ob
 * auch diese Regeln in den gemeinsamen Code sollen; Bestandsaufnahme in WI-0178). Vorher standen sie getrennt in `apps/web/src/map/geometrie`
 * (`rechnung.ts`, `arten.ts`, `kraftlinie.ts`) und am Server (`path-edit.ts`, `path-create.ts`, `kraftlinien-*.ts`), gleich gemeint, aber
 * doppelt geschrieben. Das Verhalten bleibt, wie es war.
 *
 * - **Aufeinander:** zwei Punkte, die auf fünf Nachkommastellen gleich sind (Betreiber 2026-10-10, „A, fünf Nachkommastellen“; derselbe
 *   Schlüssel wie die Wegfindung, `exactKey`). Anfang und Ende eines Wegs oder eines Kraftlinienabschnitts liegen nie aufeinander.
 * - **Am Ort:** Ein Punkt näher als `ORT_NAEHE` (je Achse) an einem Ort hängt am Ort; dort zieht beim Ziehen nichts mit (WI-0177 §5).
 * - **Derselbe Nodix:** Ein Kraftlinienabschnitt beginnt und endet nie am selben Nodix. Der Editor rastet nach Lage ein, der Server prüft die
 *   Kennung; ein Nodix hat genau eine Lage.
 */

export interface Lage {
    readonly x: number;
    readonly y: number;
}

/** Der Schlüssel eines Punktes: fünf Nachkommastellen. */
export const punktSchluessel = (x: number, y: number): string => `${x.toFixed(5)}:${y.toFixed(5)}`;

/** Was auf fünf Stellen gleich gerundet ist, liegt weniger als das auseinander: erst die Zahlen, die Zeichenketten nur für nahe Punkte. */
const DECKUNG_HOECHSTENS = 2e-5;

/**
 * Liegen zwei Punkte auf fünf Stellen aufeinander? Erst die Zahlen, die Zeichenketten nur für wirklich nahe Punkte: Beim Zeichnen läuft das
 * für jedes Paar aus Einrastziel und Ecke, auf der Stage 43.000 Ziele mal 40 Ecken (WI-0283 §7).
 */
export const aufeinander = (a: Lage, b: Lage): boolean =>
    Math.abs(a.x - b.x) <= DECKUNG_HOECHSTENS &&
    Math.abs(a.y - b.y) <= DECKUNG_HOECHSTENS &&
    punktSchluessel(a.x, a.y) === punktSchluessel(b.x, b.y);

/** So viele Stützpunkte braucht ein Weg. */
export const WEG_MINDESTENS = 2;

/** Liegen Anfang und Ende eines Linienzugs aufeinander? */
export const endenAufeinander = (punkte: readonly Lage[]): boolean => {
    const anfang = punkte[0];
    const ende = punkte.at(-1);
    return punkte.length >= 2 && anfang !== undefined && ende !== undefined && aufeinander(anfang, ende);
};

/** Wie nah ein Ort an einem Punkt liegen muss (je Achse), damit der Punkt am Ort hängt. */
export const ORT_NAEHE = 0.00001;

/** Hängt der Punkt an einem dieser Orte? Dann zieht dort nichts mit. */
export const amOrt = (punkt: Lage, orte: readonly Lage[]): boolean =>
    orte.some((ort) => Math.abs(ort.x - punkt.x) < ORT_NAEHE && Math.abs(ort.y - punkt.y) < ORT_NAEHE);

/** Beginnt und endet ein Kraftlinienabschnitt am selben Nodix (Kennungen)? */
export const selberNodix = (von: string, nach: string): boolean => von === nach;
