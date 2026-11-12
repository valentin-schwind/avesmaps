import { sampleSmoothField } from "./field.ts";
import type { HillFacing } from "./hills.ts";
import type { MaterialFields } from "./materials.ts";

/** The distance gradient points uphill; no independent ridge axis is generated. */
export function hillFacing(materials: MaterialFields, x: number, y: number): HillFacing | undefined {
    const zone = materials.foothills;
    if (!zone) return undefined;
    const m = materials.m;
    const u = (x * m) / 1024 - 0.5,
        v = ((1024 - y) * m) / 1024 - 0.5;
    const sample = (dx: number, dy: number): number =>
        sampleSmoothField({ m, values: zone.influence }, m, u + dx, v + dy);
    const amount = sample(0, 0) * zone.asymmetry;
    if (amount <= 0) return undefined;
    const dx = sample(1, 0) - sample(-1, 0);
    const dy = sample(0, -1) - sample(0, 1);
    const length = Math.hypot(dx, dy);
    return length > 1e-8 ? { dx: dx / length, dy: dy / length, amount } : undefined;
}
