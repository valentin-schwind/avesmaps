import type { LakeBody } from "./lake-bodies.ts";

/**
 * Der Spiegel eines Sees (WI-0067, Betreiber 2026-10-04: „der tiefste zufluss bestimmt die seehöhe, ansonsten liegt der see
 * auf der niedrigsten landstelle unter ihm“).
 *
 * 🔴 Die Regel, je Gewässer (`lakeBodies`, nie eine ganze Mehrfachfläche):
 * - **Ohne Zufluss** liegt der See auf der niedrigsten Landstelle unter ihm: dem tiefsten Gelände seiner eigenen Zellen vor dem
 *   Setzen des Spiegels. Der Wert ist ein niedriges Quantil (`generator.lakes.bedQuantile`, 5 %), kein Minimum: Das Minimum
 *   einer großen Fläche ist ein Extremwert einzelner Zellen; das Quantil trifft dieselbe Stelle und bleibt gegen Ausreißer
 *   stabil. Ein See mit höchstens 19 Zellen liegt auf seinem Minimum.
 * - **Mit Zufluss** bestimmt der tiefste Zufluss die Höhe, wenn er tiefer liegt (`burnRivers`, `lakePull`): das tiefste Gelände
 *   auf den letzten `generator.lakes.mouthReach` Karteneinheiten vor der Mündung. Nicht das tiefste Bett irgendwo flussauf: Das
 *   zog den Neunaugensee wegen des Gipfels „Der Daumen“ (50 Schritt in 510 Schritt hohem Gelände, 9 E flussauf) auf 54 Schritt.
 *
 * Vorher (Generator 17) war es das Minimum der ganzen Fläche, auch einer Mehrfachfläche aus 49 Teilen (Seen des Totenmoors, 201
 * Schritt unter dem Ufer im Median), dazu der Zug des tiefsten Betts flussauf und ein Uferschnitt bis zum Spiegel.
 */

/** Der Wert beim Anteil `quantile` der Werte (0 ist das Minimum, 0,5 der Median); höchstens 19 Werte bei 0,05: das Minimum. */
export function quantileOf(values: Float64Array, quantile: number): number {
    const sorted = Float64Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] as number;
}

/** Die niedrigste Landstelle jedes Sees: das Quantil der Höhen seiner Zellen; `at` liest die Höhe einer Zelle des Gitters. */
export function bedLevels(bodies: readonly LakeBody[], at: (k: number) => number, quantile: number): Float64Array {
    return Float64Array.from(bodies, (body) => quantileOf(Float64Array.from(body.cells, at), quantile));
}
