import { pathLength, resample, type Point } from "./chordal-axis.ts";

/**
 * Aus einer rohen Mittelachse wird eine Kurve, auf der Schrift stehen kann (WI-0004, MCS-008).
 *
 * Legacy glättet **nicht** mit einem Spline und nicht mit einem Bézier, sondern mit einem
 * Least-Squares-Polynomfit dritten Grades im Hauptachsenframe. Der Unterschied ist nicht
 * akademisch: ein Spline folgt der Achse und erbt jeden Knick, ein Polynom dritten Grades kann
 * **eine** weiche Biegung, und mehr nicht. Schrift auf einem geglätteten Zickzack ist unlesbar,
 * lange bevor die Kurve „falsch" wäre.
 */

export interface PrincipalFrame {
    centre: Point;
    /** Winkel der Hauptachse gegen die x-Achse. */
    angle: number;
}

/** Schwerpunkt und Hauptachse einer Punktwolke. */
export function principalFrame(points: readonly Point[]): PrincipalFrame {
    const count = points.length;
    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
        sumX += point.x;
        sumY += point.y;
    }
    const centre = { x: sumX / count, y: sumY / count };

    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const point of points) {
        const dx = point.x - centre.x;
        const dy = point.y - centre.y;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
    }
    // Der Winkel, unter dem die Streuung am größten ist. Bei einer runden Wolke ist er beliebig,
    // und das ist in Ordnung: eine runde Fläche hat keine Richtung, in der ein Name laufen müsste.
    return { centre, angle: 0.5 * Math.atan2(2 * xy, xx - yy) };
}

function toFrame(point: Point, frame: PrincipalFrame): Point {
    const dx = point.x - frame.centre.x;
    const dy = point.y - frame.centre.y;
    const cos = Math.cos(-frame.angle);
    const sin = Math.sin(-frame.angle);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

function fromFrame(point: Point, frame: PrincipalFrame): Point {
    const cos = Math.cos(frame.angle);
    const sin = Math.sin(frame.angle);
    return {
        x: frame.centre.x + point.x * cos - point.y * sin,
        y: frame.centre.y + point.x * sin + point.y * cos,
    };
}

/**
 * Löst ein kleines lineares Gleichungssystem mit Gauß-Jordan und Teilpivotierung.
 * Gibt `null` zurück, wenn die Matrix singulär ist — dann wird nicht geglättet, statt zu raten.
 */
function solve(matrix: number[][], size: number): number[] | null {
    for (let column = 0; column < size; column += 1) {
        let pivotRow = column;
        for (let row = column + 1; row < size; row += 1) {
            if (
                Math.abs((matrix[row] as number[])[column] as number) >
                Math.abs((matrix[pivotRow] as number[])[column] as number)
            ) {
                pivotRow = row;
            }
        }
        const pivot = (matrix[pivotRow] as number[])[column] as number;
        if (Math.abs(pivot) < 1e-12) {
            return null;
        }
        [matrix[column], matrix[pivotRow]] = [matrix[pivotRow] as number[], matrix[column] as number[]];
        const pivotLine = matrix[column] as number[];
        for (let index = column; index <= size; index += 1) {
            pivotLine[index] = (pivotLine[index] as number) / pivot;
        }
        for (let row = 0; row < size; row += 1) {
            if (row === column) {
                continue;
            }
            const line = matrix[row] as number[];
            const factor = line[column] as number;
            if (factor === 0) {
                continue;
            }
            for (let index = column; index <= size; index += 1) {
                line[index] = (line[index] as number) - factor * (pivotLine[index] as number);
            }
        }
    }
    return Array.from({ length: size }, (_, index) => (matrix[index] as number[])[size] as number);
}

/**
 * Legacys Grad, und die Vorgabe, solange eine Region keinen eigenen trägt (WI-0019). Den Grad einer
 * Region setzen Editoren (`region.label_curve_degree`, 2..5); Legacy hatte den Regler im Fenster
 * „Darstellung“, er erreichte den Rechner nie (MCS-008).
 */
export const POLY_DEGREE = 3;

/** Ein Polynom je Koordinate, parametrisiert über die geordnete Bogenlänge. */
export function fitParametricCurve(points: readonly Point[], sampleCount: number, polyDegree = POLY_DEGREE): Point[] {
    if (points.length < 2 || sampleCount < 2) {
        return [...points];
    }
    const sampled = resample(points, sampleCount);
    const origin = sampled[0] as Point;
    const degree = Math.min(polyDegree, sampled.length - 1);
    const size = degree + 1;
    const parameters = sampled.map((_, index) => -1 + (2 * index) / (sampled.length - 1));
    const coefficients = (coordinate: "x" | "y"): number[] | null => {
        const matrix = Array.from({ length: size }, (_, row) => [
            ...Array.from({ length: size }, (_, column) =>
                parameters.reduce((sum, value) => sum + value ** (row + column), 0),
            ),
            parameters.reduce(
                (sum, value, index) =>
                    sum + value ** row * ((sampled[index] as Point)[coordinate] - origin[coordinate]),
                0,
            ),
        ]);
        return solve(matrix, size);
    };
    const x = coefficients("x");
    const y = coefficients("y");
    if (!x || !y) {
        return sampled;
    }
    const evaluate = (values: number[], parameter: number): number =>
        values.reduce((sum, value, power) => sum + value * parameter ** power, 0);
    return resample(
        parameters.map((parameter) => ({
            x: origin.x + evaluate(x, parameter),
            y: origin.y + evaluate(y, parameter),
        })),
        sampleCount,
    );
}

/**
 * Legt eine weiche Kurve durch die Punktwolke.
 *
 * Mehrere Teilflächen werden bewusst als **eine** Wolke behandelt: die Kurve überbrückt dann die
 * Lücke zwischen den Lappen und verlässt dabei die Fläche. Legacy macht das genauso, und es ist
 * gewollt — ein Name, der über eine Inselgruppe läuft, gehört über die Gruppe und nicht auf eine
 * Insel davon.
 */
export function fitCurve(points: readonly Point[], sampleCount: number, polyDegree = POLY_DEGREE): Point[] {
    if (points.length < 2) {
        return [...points];
    }
    const frame = principalFrame(points);
    const local = points.map((point) => toFrame(point, frame)).sort((a, b) => a.x - b.x);

    const first = local[0] as Point;
    const last = local[local.length - 1] as Point;
    const span = last.x - first.x;
    if (span === 0) {
        return resample(points, sampleCount);
    }
    // 🪤 Auf [-1, 1] gebracht, bevor die Normalgleichungen entstehen. `solve` erkennt „singulär“ an
    // einer FESTEN Schwelle, und die trifft in rohen Kartenkoordinaten bei kleinem Maß und hohem
    // Grad zu früh: bei ×0,001 fiel der Grad-5-Fit still auf die rohe Achse zurück (gemessen
    // 2026-09-23). Ein gemeinsamer Faktor für beide Achsen ändert die Lösung nicht, nur ihre
    // Rechenbarkeit - der Fit hängt damit nicht mehr am Kartenmaß.
    const middle = (first.x + last.x) / 2;
    const half = span / 2;
    const scaled = local.map((point) => ({ x: (point.x - middle) / half, y: point.y / half }));

    const degree = Math.min(polyDegree, local.length - 1);
    const size = degree + 1;
    // Normalgleichungen: sum(u^(i+j)) * a_j = sum(u^i * v)
    const powerSums = new Array<number>(2 * degree + 1).fill(0);
    const targets = new Array<number>(size).fill(0);
    for (const point of scaled) {
        let power = 1;
        for (let index = 0; index <= 2 * degree; index += 1) {
            powerSums[index] = (powerSums[index] as number) + power;
            power *= point.x;
        }
        let weight = 1;
        for (let index = 0; index < size; index += 1) {
            targets[index] = (targets[index] as number) + weight * point.y;
            weight *= point.x;
        }
    }
    const matrix: number[][] = [];
    for (let row = 0; row < size; row += 1) {
        const line = new Array<number>(size + 1).fill(0);
        for (let column = 0; column < size; column += 1) {
            line[column] = powerSums[row + column] as number;
        }
        line[size] = targets[row] as number;
        matrix.push(line);
    }

    const coefficients = solve(matrix, size);
    if (!coefficients) {
        // Singulär heißt: die Wolke gibt keine Kurve her. Dann bleibt die Achse, wie sie ist.
        return resample(points, sampleCount);
    }

    const fitted: Point[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
        const s = -1 + (2 * index) / (sampleCount - 1);
        let t = 0;
        let power = 1;
        for (const coefficient of coefficients) {
            t += coefficient * power;
            power *= s;
        }
        fitted.push(fromFrame({ x: middle + s * half, y: t * half }, frame));
    }
    // Gleichmäßig nach Bogenlänge, nicht nach u: sonst stehen die Punkte dort dichter, wo die Kurve
    // flach läuft, und die Glyphen bekämen ungleiche Abstände.
    return resample(fitted, sampleCount);
}

/**
 * Beruhigt eine Linie, bis kein Teilstück mehr als `maxTurnDegrees` von ihrer Sehne abweicht.
 *
 * Gemischt wird anteilig zur eigenen Sehne, die Endpunkte bleiben liegen. Im Extremfall entsteht
 * eine Gerade — was ein Kartograf bei einem stark geknickten Objekt auch tut.
 *
 * ⚠️ Beruhigen **kürzt** den Bogen. Wer danach nicht erneut prüft, ob der Name noch draufpasst,
 * verliert ihn genau dann, wenn die Kurve ruhig genug geworden ist.
 */
export function calmToChord(points: readonly Point[], maxTurnDegrees: number): Point[] {
    if (points.length < 3) {
        return [...points];
    }
    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;
    const limit = (maxTurnDegrees * Math.PI) / 180;

    // 🪤 Der Sehnenpunkt gehört zur BOGENLÄNGE des Punktes, nicht zu seiner Nummer. Bei einem
    // Fenster, das aus einer Kurve geschnitten wurde, liegen die Stützpunkte ungleich dicht - nach
    // Nummer gemischt wandert die Linie dann seitlich weg statt sich zu strecken, und der Name
    // verlässt seine Fläche. Legacy mischt nach `cum[i] / total`.
    const cumulative: number[] = [0];
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1] as Point;
        const to = points[index] as Point;
        cumulative.push((cumulative[index - 1] as number) + Math.hypot(to.x - from.x, to.y - from.y));
    }
    const total = (cumulative[cumulative.length - 1] as number) || 1;

    for (let step = 0; step <= 12; step += 1) {
        const blend = step / 12;
        const candidate = points.map((point, index) => {
            const ratio = (cumulative[index] as number) / total;
            const chordX = first.x + (last.x - first.x) * ratio;
            const chordY = first.y + (last.y - first.y) * ratio;
            return { x: point.x + (chordX - point.x) * blend, y: point.y + (chordY - point.y) * blend };
        });
        if (maxDeviationAngle(candidate) <= limit) {
            return candidate;
        }
    }
    return [first, last];
}

/** Größter Winkel, den ein Teilstück gegen die Sehne der ganzen Linie einschlägt. */
export function maxDeviationAngle(points: readonly Point[]): number {
    if (points.length < 2) {
        return 0;
    }
    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;
    const chord = Math.atan2(last.y - first.y, last.x - first.x);
    let largest = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1] as Point;
        const to = points[index] as Point;
        if (from.x === to.x && from.y === to.y) {
            continue;
        }
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        let difference = Math.abs(angle - chord);
        while (difference > Math.PI) {
            difference = Math.abs(difference - 2 * Math.PI);
        }
        largest = Math.max(largest, difference);
    }
    return largest;
}

export { pathLength, resample, type Point };
