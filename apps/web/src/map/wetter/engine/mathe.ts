/** Kleine Rechenhilfen der Wetter-Engine; die Folge der Rechnungen ist die des Prototyps (die Simulation ist deterministisch). */

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));

export const sstep = (a: number, b: number, x: number): number => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

export const RAD = Math.PI / 180;

/** Schritt je Karteneinheit: 1 Einheit sind 3.000 Schritt. */
export const M_U = 3000;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
