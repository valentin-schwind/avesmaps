import { hash2 } from "@avesmaps3d/shared";
import type { LandformRecipe } from "./recipes.ts";

export interface HillFacing {
    dx: number;
    dy: number;
    amount: number;
}

interface HillCentre {
    x: number;
    y: number;
    radius: number;
    height: number;
    facing?: HillFacing;
}

/** Compact C1 cap, optionally skewed uphill, with zero slope at its centre and boundary. */
export function hillCap(cap: HillCentre, x: number, y: number): number {
    const dx = x - cap.x,
        dy = y - cap.y;
    let squared = (dx * dx + dy * dy) / (cap.radius * cap.radius);
    if (cap.facing) {
        const { dx: ux, dy: uy, amount } = cap.facing;
        if (squared >= (1 + amount) ** 2) return 0;
        const along = dx * ux + dy * uy;
        const across = dy * ux - dx * uy;
        const warped = along / (1 - amount * Math.tanh(along / cap.radius));
        squared = (warped * warped + across * across) / (cap.radius * cap.radius);
    }
    return squared < 1 ? cap.height * (1 - squared) ** 2 : 0;
}

/** Bounded random sequential inhibition; buckets accelerate distance checks, never place hills. */
export function createHillField(
    recipe: LandformRecipe,
    seed: number,
    extent = 1024,
    facingAt?: (x: number, y: number) => HillFacing | undefined,
): {
    centres: readonly HillCentre[];
    sample: (x: number, y: number) => number;
} {
    const settings = recipe.hills;
    if (!settings || !(extent > 0) || !(recipe.wavelength > 0)) throw new RangeError("Invalid hill field");
    const spacing = recipe.wavelength;
    const reach = (settings.radiusAtMinimum * recipe.maximum) / recipe.minimum;
    const width = extent + 2 * reach;
    const n = Math.ceil(width / spacing);
    const attempts = Math.ceil((settings.attempts * width * width) / (spacing * spacing));
    if (!Number.isSafeInteger(attempts) || attempts > 10_000_000)
        throw new RangeError("Hill distribution exceeds bounded work");
    const buckets: number[][] = Array.from({ length: n * n }, () => []);
    const centres: HillCentre[] = [];
    let searchReach = reach;
    for (let i = 0; i < attempts; i += 1) {
        const x = hash2(seed, i, 0) * width - reach;
        const y = hash2(seed, i, 1) * width - reach;
        const bx = Math.floor((x + reach) / spacing),
            by = Math.floor((y + reach) / spacing);
        let near = false;
        for (let dy = Math.max(0, by - 1); dy <= Math.min(n - 1, by + 1) && !near; dy += 1) {
            for (let dx = Math.max(0, bx - 1); dx <= Math.min(n - 1, bx + 1) && !near; dx += 1) {
                near = buckets[dy * n + dx]!.some((index) => {
                    const p = centres[index]!;
                    return (p.x - x) ** 2 + (p.y - y) ** 2 < spacing * spacing;
                });
            }
        }
        if (near) continue;
        const height =
            recipe.minimum + (recipe.maximum - recipe.minimum) * hash2(seed, i, 5) ** settings.heightExponent;
        const radius = (settings.radiusAtMinimum * height) / recipe.minimum;
        const facing = facingAt?.(x, y);
        if (facing) searchReach = Math.max(searchReach, radius * (1 + facing.amount));
        buckets[by * n + bx]!.push(centres.length);
        centres.push({
            x,
            y,
            radius,
            height,
            ...(facing ? { facing } : {}),
        });
    }
    const sample = (x: number, y: number): number => {
        let powers = 0;
        for (
            let by = Math.max(0, Math.floor((y + reach - searchReach) / spacing));
            by <= Math.min(n - 1, Math.floor((y + reach + searchReach) / spacing));
            by += 1
        ) {
            for (
                let bx = Math.max(0, Math.floor((x + reach - searchReach) / spacing));
                bx <= Math.min(n - 1, Math.floor((x + reach + searchReach) / spacing));
                bx += 1
            ) {
                for (const index of buckets[by * n + bx]!) {
                    // Most candidates lie outside their cap; 0 ** p adds exactly 0, so skip the power.
                    const cap = hillCap(centres[index]!, x, y);
                    if (cap !== 0) powers += cap ** settings.overlapPower;
                }
            }
        }
        // Smooth union preserves an isolated cap exactly; ridges arise only from overlap.
        return powers ** (1 / settings.overlapPower);
    };
    return { centres, sample };
}
