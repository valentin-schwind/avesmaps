/** Maximum profile grade in physical units; one map unit is 3,000 Schritt. */
export interface RiverValley {
    flankGrade: number;
    /**
     * Flusstäler im Gebirge (WI-0249, nur Fassung 19): Die Flanke wird mit der Höhe des Lands, in das der Fluss schneidet, steiler, bis zu
     * `grade` (die größte Gebirgssteilheit), weich von `from` bis `to` (die Hochgebirgsgrenze, wie Felsgrenzhang und Gipfel). Ohne die
     * Angabe gilt `flankGrade` überall, Zeichen für Zeichen wie zuvor.
     */
    gebirge?: { grade: number; from: number; to: number };
}

/** Cubic smoothstep has maximum derivative 1.5. */
export function valleyReach(floor: number, depth: number, flankGrade: number): number {
    return floor + (1.5 * Math.max(0, depth)) / (3000 * flankGrade);
}

/**
 * Die Flankensteigung eines Tals, dessen Fluss in Land der Höhe `height` (Schritt, Gelände am Fluss vor dem Schnitt) schneidet: in der
 * Ebene `flankGrade`, im Hochgebirge die Steilheit des Gebirges, dazwischen weich (derselbe Smoothstep wie `alpineWeight` in
 * `domain/summit-shape.ts`). Nie sanfter als `flankGrade`.
 */
export function valleyGrade(valley: RiverValley, height: number): number {
    const { flankGrade, gebirge } = valley;
    if (!gebirge || !(gebirge.grade > flankGrade)) return flankGrade;
    const t = Math.max(0, Math.min(1, (height - gebirge.from) / (gebirge.to - gebirge.from)));
    return flankGrade + (gebirge.grade - flankGrade) * t * t * (3 - 2 * t);
}

/** Lower only: flat bed, smooth flank, zero added slope at the outer boundary. */
export function valleyHeight(
    old: number,
    terrain: number,
    bed: number,
    distance: number,
    floor: number,
    flankGrade: number,
): number {
    const depth = terrain - bed;
    if (!(depth > 0)) return old;
    const width = valleyReach(0, depth, flankGrade);
    const t = Math.min(1, Math.max(0, (distance - floor) / width));
    const weight = 1 - t * t * (3 - 2 * t);
    return old - Math.min(depth, Math.max(0, old - bed)) * weight;
}
