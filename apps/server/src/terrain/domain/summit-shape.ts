import { SCHRITT_PER_UNIT } from "../hydrology/grid.ts";
import { MIN_CONE_RADIUS } from "../peak-cone.ts";
import { fbm, hash2, wertRauschen } from "@avesmaps3d/shared";
import type { MountainMorphology } from "./recipes.ts";

/**
 * Gipfelregel (WI-0067, Betreiber 2026-10-03): eine Regel für jeden Berggipfel und eine für jeden Vulkan,
 * unabhängig von Lage und Name. Ein Berggipfel ist ein natürlicher Einzelberg: unregelmäßiger Umriss,
 * konkaves Profil ohne Knick mit einer mittleren Neigung vom Gipfel zum Fuß, sternförmige Rücken und Täler,
 * die zum Fuß hin feiner werden. Ein Vulkan ist ein runder Kegelstumpf, oben eben auf Gipfelhöhe. Jeder Gipfel
 * zieht seine Werte (Neigung, Profil, Umriss, Zahl der Rücken, Relief, Erosionsanteil, Wiederherstellung)
 * pseudozufällig aus Generator-Seed und Position, jeweils innerhalb der Bereiche des Rezepts.
 */
export interface Summit {
    /** Gipfel in Karteneinheiten (Mitte des 2×2-Kerns). */
    x: number;
    y: number;
    height: number;
    /** Äußere Reichweite der Form (Karteneinheiten). */
    reach: number;
    /** Anteil der Erosionsrinnen und -rücken, der auf den wiederhergestellten Flanken bleibt. */
    detail: number;
    /** Ganz wiederhergestellt bis `full`, gar nicht mehr ab `none` (Anteile der Höhe unter dem Gipfel). */
    restore: { full: number; none: number };
    volcano?: { plateau: number; grade: number };
    natural?: { radius: number; profile: number; outline: number; ridges: number; relief: number; noise: number };
}

type Interior = Pick<MountainMorphology["interior"], "maximumGrade" | "alpine">;

/** Alpine share of a height (Schritt): smooth from `alpine.from` to `alpine.to`. */
export function alpineWeight(interior: Interior, height: number): number {
    const { from, to } = interior.alpine;
    const t = Math.max(0, Math.min(1, (height - from) / (to - from)));
    return t * t * (3 - 2 * t);
}

/** The summit of a known peak; `volcano` picks the volcano rule. Deterministic per seed and position. */
export function summitFor(
    interior: Interior,
    seed: number,
    x: number,
    y: number,
    height: number,
    volcano = false,
): Summit {
    const { alpine } = interior;
    const ix = Math.round(x * 64),
        iy = Math.round(y * 64);
    const draw = (salt: number, range: { minimum: number; maximum: number }) =>
        range.minimum + (range.maximum - range.minimum) * hash2(seed + 70200 + salt, ix, iy);
    const common = {
        x,
        y,
        height,
        detail: draw(1, alpine.summit.detail),
        restore: { full: draw(2, alpine.summit.restoreFull), none: draw(3, alpine.summit.restoreNone) },
    };
    if (volcano) {
        // A low volcano keeps at least two cells of cone (operator 2026-09-27) and is flatter for it.
        const run = Math.max(MIN_CONE_RADIUS, height / (draw(4, alpine.volcano.grade) * SCHRITT_PER_UNIT));
        const plateau = Math.min(draw(5, alpine.volcano.plateau), run / 4);
        return { ...common, reach: plateau + run, volcano: { plateau, grade: height / (run * SCHRITT_PER_UNIT) } };
    }
    const { ridges } = alpine.summit;
    // A low summit keeps at least two cells of radius (operator 2026-09-27) and is flatter for it.
    const radius = Math.max(MIN_CONE_RADIUS, height / (draw(6, alpine.summit.grade) * SCHRITT_PER_UNIT));
    const natural = {
        radius,
        profile: draw(7, alpine.summit.profile),
        outline: draw(8, alpine.summit.outline),
        ridges: ridges.minimum + Math.floor((ridges.maximum - ridges.minimum + 1) * hash2(seed + 70209, ix, iy)),
        relief: draw(10, alpine.summit.relief),
        noise: seed + 70300 + Math.floor(hash2(seed + 70211, ix, iy) * 1e6),
    };
    return { ...common, reach: radius * (1 + natural.outline), natural };
}

/**
 * Height of the summit's shape at a map position, never below 0. A natural mountain: the outline varies
 * around its mean radius, the concave profile `(1 − u)^profile` keeps the mean grade from summit to foot,
 * and value noise sampled on circles around the summit gives seamless radial ridges and valleys that meander
 * with the distance; twice as many finer ones join towards the foot.
 */
export function summitHeight(summit: Summit, px: number, py: number): number {
    const dx = px - summit.x,
        dy = py - summit.y;
    const r = Math.hypot(dx, dy);
    if (summit.volcano) {
        const { plateau, grade } = summit.volcano;
        return Math.max(0, summit.height - grade * Math.max(0, r - plateau) * SCHRITT_PER_UNIT);
    }
    const shape = summit.natural!;
    const cx = r > 0 ? dx / r : 1,
        cy = r > 0 ? dy / r : 0;
    const outline = shape.radius * (1 + shape.outline * fbm(shape.noise + 1, 3 + 1.2 * cx, 3 + 1.2 * cy, 1, 3, 0.5));
    const u = r / outline;
    if (!(u < 1)) return 0;
    const ring = shape.ridges / (2 * Math.PI);
    const ridge = (n: number) => 0.5 - Math.abs(n);
    const main = ridge(wertRauschen(shape.noise + 2, ring * cx + 1.5 * u, ring * cy, 1));
    const fine = ridge(wertRauschen(shape.noise + 3, 2 * ring * cx - 2 * u, 2 * ring * cy, 1));
    const relief = shape.relief * summit.height * 4 * u * (1 - u) * (main + u * fine);
    return Math.max(0, summit.height * (1 - u) ** shape.profile + relief);
}

/** How much of the shape is restored at a height of the shape: a volcano entirely, a mountain from the top. */
export function restoreShare(summit: Summit, shapeHeight: number): number {
    if (summit.volcano) return 1;
    const depth = 1 - shapeHeight / summit.height;
    const { full, none } = summit.restore;
    const s = Math.max(0, Math.min(1, (depth - full) / Math.max(1e-6, none - full)));
    return 1 - s * s * (3 - 2 * s);
}

/**
 * Raise `current` towards the summit's shape, never lower it: full effect at the summit,
 * fading smoothly to none at the reach. Used while the slopes relax, before erosion has its last say.
 */
export function raiseToSummit(summit: Summit, px: number, py: number, current: number): number {
    const distance = Math.hypot(px - summit.x, py - summit.y);
    if (!(distance < summit.reach)) return current;
    const t = distance / summit.reach;
    const fade = 1 - t * t * (3 - 2 * t);
    return current + Math.max(0, summitHeight(summit, px, py) - current) * fade;
}

/** Steepest rise from a lower summit's core: no other summit's shape may bury it there. */
export const CORE_GRADE = 1;

/**
 * Upper bound at a position from all summits: each core stays a local maximum (exact height, rising at most
 * with `CORE_GRADE` away from it), so a lower peak on a higher one's flank stands as its own shoulder.
 */
export function summitCap(summits: readonly Summit[], px: number, py: number): number {
    let cap = Infinity;
    for (const summit of summits)
        cap = Math.min(cap, summit.height + CORE_GRADE * Math.hypot(px - summit.x, py - summit.y) * SCHRITT_PER_UNIT);
    return cap;
}
