/**
 * Gemeinsame Hilfen der Routing-Invarianten (WI-0061, Plan 11.54, 11.55, 11.57): ein fester Zufall, damit jeder Lauf
 * dieselben Fälle zieht, und der Umfang - eine kleine Teilmenge in `npm test`, der volle Satz mit
 * `npm run gate:routing-invariants`.
 */

/** Ein kleiner, reproduzierbarer Zufall (mulberry32): dieselbe Kennzahl, dieselbe Folge, auf jedem Rechner. */
export function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
    const next = random(seed);
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        [result[index], result[other]] = [result[other] as T, result[index] as T];
    }
    return result;
}

/** Ein Element aus einer Liste, nach dem Zufall `next`. */
export function pick<T>(items: readonly T[], next: () => number): T {
    return items[Math.min(items.length - 1, Math.floor(next() * items.length))] as T;
}

/**
 * Der volle Satz läuft nur mit `AVESMAPS_INVARIANTS=full` (das setzt `npm run gate:routing-invariants`); ohne ihn
 * rechnet jeder Test die kleine Teilmenge, die zusammen in wenigen Sekunden durchläuft.
 */
export const FULL_INVARIANTS = process.env["AVESMAPS_INVARIANTS"] === "full";

/** Der Umfang eines Tests: `small` in der normalen Testsuite, `full` im Gate. */
export const scaled = <T>(small: T, full: T): T => (FULL_INVARIANTS ? full : small);
