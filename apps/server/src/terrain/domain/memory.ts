/**
 * Hint a full collection right after large whole-grid intermediates became unreachable (WI-0067 P8).
 *
 * Typed-array memory is only returned when the collector runs; without a hint, several dead 64-MiB fields
 * pile up and raise the peak RSS of a derivation. Derivations run with `--expose-gc`; elsewhere this is a
 * no-op. It never replaces ending a reference early: callers end their references first.
 */
export function releaseIntermediates(): void {
    globalThis.gc?.();
}
