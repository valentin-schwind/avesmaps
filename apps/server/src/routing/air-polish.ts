/**
 * Das Feilen am Weg des Flugs (WI-0051 F4b): Die Suche über dem Kostenfeld (`air-field.ts`) findet, auf welcher Seite der
 * Gebirge der Flug geht; das Kostenfeld ist aber nur eine Näherung der Bahn (Zellen, vier Achsen), und der gerade
 * Abschnitt hat jede Richtung. Darum werden die Knicke am Ende an der EXAKTEN Bahn nachgezogen (`flightTrack`): jede
 * Änderung wird an den Kosten des ganzen Wegs gemessen, nicht am Feld.
 *
 * - **Ecken entfernen**, wo es nicht teurer wird: Das Straffziehen des Felds hat den Weg nach dem Preis des Felds gerade
 *   gezogen, hier nach dem wirklichen.
 * - **Ecken einfügen**, einmal vor der gröbsten Schrittweite: In jedes lange Stück kommt an einem Drittel und an zwei Dritteln
 *   probeweise eine Ecke, seitlich versetzt, und bleibt, wo sie den Weg verbilligt. Die Suche über dem Kostenfeld findet,
 *   auf welcher Seite der Gebirge der Flug geht, aber nicht die kleine Beuge, mit der ein Weg an einem einzelnen Gipfel
 *   vorbeikommt; und ein Weg ohne innere Ecke hätte sonst nichts, das sich verschieben ließe.
 * - **Ecken verschieben** (Mustersuche): Jede innere Ecke wird längs und quer zu ihrer Sehne (von der vorigen zur nächsten
 *   Ecke) um `radius` verschoben und wandert dorthin, wo der Weg am billigsten wird. Radius für Radius, jeder in wenigen
 *   Durchgängen, bis nichts besser wird. Dann noch einmal Ecken entfernen.
 * - **Nur besser, nie anders im Ergebnis des Aufrufers:** Ein Schritt wird nur genommen, wenn die Kosten sinken (die Ecken
 *   entfernt auch bei Gleichstand, ein Weg mit weniger Knicken). Der Weg wird so nie teurer. Die Enden bleiben auf den
 *   Wegpunkten. `allowed` hält Wege fern, die nicht gelten dürfen (Gelände über der Höchstflughöhe, länger als der
 *   Umweg-Deckel).
 * - **Deterministisch:** feste Reihenfolge der Ecken und Richtungen, keine Uhr, keine Zufallszahl. Wie viele Bewertungen
 *   höchstens gerechnet werden, bestimmt der Aufrufer (`maxEvaluations`): Es ist seine Rechenzeit.
 */

type Point = [number, number];

/** Wo im Stück probeweise eine Ecke eingefügt wird (Anteil der Länge) und wie weit sie seitlich sitzt (Anteil der Länge). */
const INSERT_AT: readonly number[] = [1 / 3, 2 / 3];
const INSERT_OFFSET = 0.08;

export interface PolishOptions {
    /** Die Schrittweiten der Verschiebung in Karteneinheiten, grob zuerst. */
    radii: readonly number[];
    /** So viele Durchgänge über alle Ecken je Schrittweite höchstens. */
    passes: number;
    /** So viele Bewertungen (Aufrufe von `cost`) höchstens; danach bleibt der Weg, wie er ist. */
    maxEvaluations: number;
}

export interface PolishResult {
    line: Point[];
    /** Die Kosten des gefeilten Wegs (wie `cost` sie meldet). */
    cost: number;
    /** So viele Bewertungen wurden gerechnet. */
    evaluations: number;
}

/**
 * Feilt an `line`: `cost` bewertet einen ganzen Weg (kleiner ist besser), `allowed` fragt, ob ein Weg gelten darf (nur
 * für Wege gerufen, die billiger wären). `start` sind die Kosten von `line`, wenn der Aufrufer sie schon kennt.
 */
export function polishWay(
    line: readonly Point[],
    cost: (line: readonly Point[]) => number,
    allowed: (line: readonly Point[], changed: number) => boolean,
    options: PolishOptions,
    start?: number,
): PolishResult {
    let current: Point[] = line.map((point) => [point[0], point[1]]);
    let evaluations = 0;
    const evaluate = (trial: readonly Point[]): number => {
        evaluations += 1;
        return cost(trial);
    };
    const spent = (): boolean => evaluations >= options.maxEvaluations;
    let best = start ?? evaluate(current);

    /** Entfernt jede innere Ecke, bei der der Weg nicht teurer wird. */
    const drop = (): void => {
        for (let changed = true; changed && !spent();) {
            changed = false;
            for (let index = 1; index + 1 < current.length && !spent(); index += 1) {
                const trial = current.filter((_, k) => k !== index);
                const price = evaluate(trial);
                if (price <= best + 1e-9 && allowed(trial, index - 1)) {
                    current = trial;
                    best = price;
                    changed = true;
                    index -= 1;
                }
            }
        }
    };

    /** Probiert in jedem Stück von mindestens `4 × radius` an Drittel und Zweidrittel eine seitlich versetzte Ecke. */
    const insert = (radius: number): void => {
        for (let segment = 0; segment + 1 < current.length && !spent(); segment += 1) {
            const from = current[segment] as Point;
            const to = current[segment + 1] as Point;
            const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
            if (length < 4 * radius) continue;
            // Seitlich um ein Zwölftel der Länge, nicht weniger als `radius`, nicht mehr als das Vierfache.
            const offset = Math.min(4 * radius, Math.max(radius, length * INSERT_OFFSET));
            const nx = -(to[1] - from[1]) / length;
            const ny = (to[0] - from[0]) / length;
            let bestTrial: Point[] | null = null;
            let bestPrice = best;
            for (const fraction of INSERT_AT) {
                for (const side of [1, -1]) {
                    if (spent()) break;
                    const inserted: Point = [
                        from[0] + (to[0] - from[0]) * fraction + nx * offset * side,
                        from[1] + (to[1] - from[1]) * fraction + ny * offset * side,
                    ];
                    const trial = [...current.slice(0, segment + 1), inserted, ...current.slice(segment + 1)];
                    const price = evaluate(trial);
                    if (price < bestPrice - 1e-9 && allowed(trial, segment)) {
                        bestPrice = price;
                        bestTrial = trial;
                    }
                }
            }
            if (bestTrial) {
                current = bestTrial;
                best = bestPrice;
                // Die neue Ecke gehört zum Weg; weiter mit dem Stück dahinter.
                segment += 1;
            }
        }
    };

    drop();
    let first = true;
    for (const radius of options.radii) {
        if (first) insert(radius);
        first = false;
        for (let pass = 0; pass < options.passes && !spent(); pass += 1) {
            let improved = false;
            for (let index = 1; index + 1 < current.length && !spent(); index += 1) {
                const before = current[index - 1] as Point;
                const here = current[index] as Point;
                const after = current[index + 1] as Point;
                const run = Math.hypot(after[0] - before[0], after[1] - before[1]);
                // Längs und quer zur Sehne der Nachbarn; bei zusammenfallenden Nachbarn die Achsen der Karte.
                const tx = run > 1e-9 ? (after[0] - before[0]) / run : 1;
                const ty = run > 1e-9 ? (after[1] - before[1]) / run : 0;
                const moves: readonly Point[] = [
                    [tx, ty],
                    [-tx, -ty],
                    [-ty, tx],
                    [ty, -tx],
                ];
                let bestMove: Point | null = null;
                let bestPrice = best;
                for (const [dx, dy] of moves) {
                    if (spent()) break;
                    const moved: Point = [here[0] + dx * radius, here[1] + dy * radius];
                    const trial = current.map((point, k) => (k === index ? moved : point));
                    const price = evaluate(trial);
                    if (price < bestPrice - 1e-9 && allowed(trial, index - 1)) {
                        bestPrice = price;
                        bestMove = moved;
                    }
                }
                if (bestMove) {
                    current[index] = bestMove;
                    best = bestPrice;
                    improved = true;
                }
            }
            if (!improved) break;
        }
    }
    drop();
    return { line: current, cost: best, evaluations };
}
