/**
 * Tor „Grat“ (Hauptorchestrierung 2026-10-20: „Sobald der Betreiber zeichnet, muss jede gezeichnete Kante als Grat erkennbar sein“):
 * je gezeichneter Kante Proben im Abstand 0,25 E, ohne die Messweite an den Enden und ohne den Randauslauf des Typs (Randbreite,
 * 1 bis 2 E; der Auslauf drückt den Grat, nicht die Flanke nach innen). Grat = Höhe auf der Kante − Mittel der Höhen eine Messweite quer zu beiden Seiten (quer konvex: ein
 * Sporn am Hang hat eine höhere Flanke und ist trotzdem ein Grat), als Anteil der Höchsthöhe der Fläche
 * (wie das HI; die Kammhöhe wird nicht immer erreicht: Trollzacken Kamm 3200, höchster Gipfel 2420). Seiten näher als die Messweite an einer
 * anderen Kante zählen nicht (sonst misst man den Nachbargrat).
 */
export interface GratFeld {
    w: number;
    hh: number;
    cell: number;
    bounds: { min_x: number; min_y: number };
    eigen: ArrayLike<number>;
    h: ArrayLike<number>;
}
export interface GratKante {
    id?: string;
    punkte: readonly (readonly [number, number])[];
}
export interface GratErgebnis {
    /** Median je Kante (nur Kanten mit Proben), aufsteigend. */
    jeKante: { id: string; median: number; proben: number }[];
    /** Alle Proben, aufsteigend. */
    alle: number[];
    /** Anteil der Proben, die am Umriss liegen und nicht zählen. */
    randAnteil: number;
}

/** VORSCHLAG: Mindestgrat je Typ (Median aller Proben, Anteil der Höchsthöhe, Messweite 1,5 E). */
export const GRAT_MIN_VORSCHLAG: Readonly<Record<string, number>> = {
    kammgebirge: 0.15,
    gratgebirge: 0.2,
    kettengebirge: 0.2,
    kuppengebirge: 0.1,
    massengebirge: 0.08,
    plateaugebirge: 0.05, // flache Hochfläche: eine gezeichnete Kante ist dort eine niedrige Schwelle
    rumpfgebirge: 0.08,
    schild: 0.05,
    inselberg: 0.25,
    karst: 0.12,
    bergland: 0.1,
};
/** Eine Kante zählt einzeln erst ab so vielen Proben (1 E Messlänge). */
export const GRAT_PROBEN_JE_KANTE = 4;

export const quantil = (v: readonly number[], p: number): number =>
    v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;

export function messeGrat(
    f: GratFeld,
    kaemme: readonly GratKante[],
    _kammhoehe: number,
    quer = 1.5,
    randStreifen = 1,
): GratErgebnis {
    // Höchstens 2 E: Bei Schild (5 E) und Massen (4 E) bliebe an schmalen Flächen sonst keine Probe (Blutzinnen).
    const streifen = Math.min(2, Math.max(1, randStreifen));
    let hoechste = 0;
    for (let k = 0; k < f.h.length; k++) if (f.eigen[k] && (f.h[k] as number) > hoechste) hoechste = f.h[k] as number;
    const bezug = hoechste > 0 ? hoechste : 1;
    const lies = (x: number, y: number): number | null => {
        const i = Math.round((x - f.bounds.min_x) / f.cell);
        const j = Math.round((y - f.bounds.min_y) / f.cell);
        if (i < 0 || j < 0 || i >= f.w || j >= f.hh || !f.eigen[j * f.w + i]) return null;
        return f.h[j * f.w + i] as number;
    };
    const abstandAndere = (x: number, y: number, ausser: number): number => {
        let best = Infinity;
        kaemme.forEach((k, n) => {
            if (n === ausser) return;
            for (let s = 1; s < k.punkte.length; s++) {
                const [ax, ay] = k.punkte[s - 1]!;
                const [bx, by] = k.punkte[s]!;
                const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
                const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
                best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
            }
        });
        return best;
    };
    const jeKante: GratErgebnis["jeKante"] = [];
    const alle: number[] = [];
    let proben = 0;
    let randProben = 0;
    for (const [nr, k] of kaemme.entries()) {
        const werte: number[] = [];
        let gesamt = 0;
        for (let s = 1; s < k.punkte.length; s++)
            gesamt += Math.hypot(k.punkte[s]![0] - k.punkte[s - 1]![0], k.punkte[s]![1] - k.punkte[s - 1]![1]);
        let lauf = 0;
        for (let s = 1; s < k.punkte.length; s++) {
            const [ax, ay] = k.punkte[s - 1]!;
            const [bx, by] = k.punkte[s]!;
            const l = Math.hypot(bx - ax, by - ay);
            if (!(l > 0)) continue;
            const nx = -(by - ay) / l;
            const ny = (bx - ax) / l;
            for (let u = 0; u < l; u += 0.25) {
                const t = lauf + u;
                if (t < quer || gesamt - t < quer) continue;
                const x = ax + ((bx - ax) * u) / l;
                const y = ay + ((by - ay) * u) / l;
                proben++;
                let amRand = false;
                for (let a = 0; a < 16 && !amRand; a++)
                    for (let rr = 0.5; rr <= streifen && !amRand; rr += 0.5)
                        if (lies(x + rr * Math.cos((a * Math.PI) / 8), y + rr * Math.sin((a * Math.PI) / 8)) === null)
                            amRand = true;
                if (amRand) {
                    randProben++;
                    continue;
                }
                const mitte = lies(x, y);
                const seiten = [1, -1]
                    .map((v) => [x + v * nx * quer, y + v * ny * quer] as const)
                    .filter(([sx, sy]) => abstandAndere(sx, sy, nr) >= quer)
                    .map(([sx, sy]) => lies(sx, sy))
                    .filter((h): h is number => h !== null);
                if (mitte === null || seiten.length < 2) continue;
                werte.push((mitte - (seiten[0]! + seiten[1]!) / 2) / bezug);
            }
            lauf += l;
        }
        if (!werte.length) continue;
        werte.sort((p, q) => p - q);
        jeKante.push({ id: k.id ?? `#${nr}`, median: quantil(werte, 0.5), proben: werte.length });
        alle.push(...werte);
    }
    alle.sort((p, q) => p - q);
    jeKante.sort((p, q) => p.median - q.median);
    return { jeKante, alle, randAnteil: randProben / Math.max(1, proben) };
}

/** Befunde des Tors für einen Typ (leer = grün). */
export function gratBefunde(g: GratErgebnis, typ: string): string[] {
    const befunde: string[] = [];
    const min = GRAT_MIN_VORSCHLAG[typ] ?? 0.1;
    const median = quantil(g.alle, 0.5);
    if (!g.alle.length) return [`Grat nicht messbar (${(100 * g.randAnteil).toFixed(0)} % der Proben im Randauslauf)`];
    if (g.alle.length && median < min)
        befunde.push(`Grat ${(100 * median).toFixed(1)} % unter ${(100 * min).toFixed(0)} %`);
    const flach = g.jeKante.filter((k) => k.proben >= GRAT_PROBEN_JE_KANTE && k.median < 0);
    if (flach.length)
        befunde.push(`Kanten ohne Grat: ${flach.map((k) => `${k.id} ${(100 * k.median).toFixed(1)} %`).join(", ")}`);
    return befunde;
}
