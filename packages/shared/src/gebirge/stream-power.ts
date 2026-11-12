/** Implicit stream power; operation order preserves the existing V12 path. */
export function streamPowerHeight(
    height: number,
    receiver: number,
    area: number,
    erodibility: number,
    exponent: number,
    timeStep: number,
    distance: number,
): number {
    if (height <= receiver) return height;
    const factor = (erodibility * timeStep * Math.pow(area, exponent)) / distance;
    return (height + factor * receiver) / (1 + factor);
}
