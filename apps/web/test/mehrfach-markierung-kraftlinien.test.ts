import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import {
    buildMehrfachMarkierungLayers,
    createMehrfachMarkierung,
    folgeMehrfachauswahl,
    markiert,
} from "../src/map/mehrfach-markierung";

/**
 * Angehakte Kraftlinien auf der Karte (Betreiber 2026-10-20: „auf der karte, gelb markier wär auch toll“). Eine Kraftlinie hat keine
 * eigene Ebene: Sie glüht in den Bögen wie die einzeln gewählte, `app.vue` liest `markiert(stand, "powerline")`. Problemfälle: Die Art
 * zeichnet eine zweite, andersfarbige Ebene; abgehakt oder ausgeschaltet bleibt sie gemeldet.
 */
describe("Mehrfachmarkierung der Kraftlinien", () => {
    it("🔴 meldet die angehakten Anker, abgehakt und ausgeschaltet nichts mehr; eine eigene Ebene gibt es nicht", async () => {
        const markierung = createMehrfachMarkierung();
        const an = ref(true);
        const angehakt = ref<readonly string[]>(["a", "b", "c"]);
        const stop = folgeMehrfachauswahl(
            markierung,
            "kraftlinien",
            "powerline",
            () => an.value,
            () => angehakt.value,
        );
        expect(markiert(markierung.stand.value, "powerline")).toEqual(["a", "b", "c"]);
        expect(buildMehrfachMarkierungLayers(markierung.stand.value, { territoryData: true })).toEqual([]);
        angehakt.value = ["a", "b"];
        await nextTick();
        expect(markiert(markierung.stand.value, "powerline")).toEqual(["a", "b"]);
        an.value = false;
        await nextTick();
        expect(markiert(markierung.stand.value, "powerline")).toEqual([]);
        stop();
        expect(markierung.stand.value).toEqual([]);
    });
});
