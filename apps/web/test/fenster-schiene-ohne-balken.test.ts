import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * In den Listen der Editoren kein linker Balken (WI-0184; EDIT-0003 §6, T26 (4); Regel in `docs/regeln/oberflaeche.md`). Betreiber
 * 2026-10-16, wörtlich: „erstmal nur in den editor listen, z.b. in der systemsteuerung find ichs super“; Anlass: „achtung bei den listen
 * ist manchmal links eines menü items ein gelber balken, der ist unnötig - du machst den hin und wieder rein, lass das“.
 *
 * Geprüft an den Quellen, weil die Regel eine Grenze zieht: Die Liste der Editoren und die Kacheln des Editorpanels (seit WI-0212 statt
 * der Schiene) zeigen die Wahl nur mit der Fläche; Systemsteuerung, Verwaltung und Medienverwaltung behalten den Balken („erstmal“ heißt,
 * der Betreiber entscheidet weitere Stellen später). Wie es gezeichnet aussieht, misst `e2e/editor-panel-ohne-balken.spec.ts`.
 */
const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const datei = (pfad: string): string => readFileSync(join(wurzel, pfad), "utf8");

/** Der Rumpf einer CSS-Regel, deren Selektorliste mit `kopf` beginnt. */
function regel(quelle: string, kopf: string): string {
    const anfang = quelle.indexOf(kopf);
    if (anfang < 0) throw new Error(`Regel ${kopf} fehlt`);
    const auf = quelle.indexOf("{", anfang);
    return quelle.slice(auf + 1, quelle.indexOf("}", auf));
}

describe("Die Listen der Editoren zeigen die Wahl ohne Balken", () => {
    it("🔴 die Editorliste: die gewählte Zeile färbt nur die Fläche, nicht den linken Rand", () => {
        const rumpf = regel(datei("editor-liste/editor-liste.vue"), ".liste__eintrag.is-gewaehlt,");
        expect(rumpf).toContain("background: var(--color-panel-active)");
        expect(rumpf).not.toContain("border-left-color");
    });

    it("🔴 die Kacheln des Editorpanels: die gewählte zeigt Fläche und Rand ringsum, keinen eigenen linken Rand (WI-0212)", () => {
        const kacheln = datei("editor-panel/editor-karteninhalte.vue");
        const gewaehlt = regel(kacheln, ".kachel.is-gewaehlt,");
        expect(gewaehlt).toContain("background-color: var(--color-panel-active)");
        expect(gewaehlt).toContain("border-color: var(--color-border-strong)");
        expect(kacheln).not.toMatch(/border-left(-color|-width)?\s*:/);
        // Die Schiene steht nicht mehr im Editorpanel; ihre Wahl ohne Balken ist mit ihr gegangen.
        expect(kacheln).not.toContain("<FensterSchiene");
        expect(datei("fenster/fenster-schiene.vue")).not.toMatch(/ohne-balken|ohneBalken/);
    });

    it("🔴 Systemsteuerung, Verwaltung und Medienverwaltung behalten den Balken", () => {
        expect(regel(datei("fenster/fenster-schiene.vue"), ".fenster-schiene__eintrag.is-aktiv,")).toContain(
            "border-left-color: var(--color-accent)",
        );
        for (const pfad of ["auth/verwaltung-fenster.vue", "medien/medien-arten.vue"]) {
            const quelle = datei(pfad);
            expect(quelle, pfad).toContain("<FensterSchiene");
            expect(quelle, pfad).not.toMatch(/ohne-balken|ohneBalken/);
        }
    });
});
