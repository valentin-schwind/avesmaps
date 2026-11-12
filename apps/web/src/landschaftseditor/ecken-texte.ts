import { formHinweis } from "../map/geometrie/formentwurf-texte";
import type { EckenMeldung } from "./ecken";

/**
 * Die Sätze von „Ecken bearbeiten“ (WI-0178 C1, C2) als Hinweis am Rand: die des gemeinsamen Formentwurfs
 * (`map/geometrie/formentwurf-texte.ts`), mit dem eigenen Satz, wenn die Landschaft sich nicht laden ließ.
 */
export function eckenHinweis(
    meldung: EckenMeldung,
    jetzt = new Date(),
): { text: string; ton: "warning" | "success" | undefined } {
    return formHinweis(meldung, { ladefehler: "landschaftseditor.ecken.ladefehler" }, jetzt);
}
