import type * as Rezepte from "../../src/terrain/domain/recipes.ts";

/**
 * Eine gedachte offene Fassung 19 für die Tests der Werkstatt „19 (Test)“ (WI-0240). Fassung 19 ist seit 2026-11-07 abgenommen
 * (`accepted` in `config/terrain/aventuria.json`); bis eine Fassung 20 offen ist, gibt es keine offene Fassung, und die Werkstatt
 * antwortet `terrain_test_closed`. Wer ihren Schreibweg prüft, stellt die Auswahl so zurück, wie sie vor der Abnahme war (17 und 18); die
 * Rezepte selbst bleiben die echten Dateien. Gebrauch, in der Testdatei (vi.mock wird nach oben gehoben):
 *
 *     vi.mock("../src/terrain/domain/recipes.ts", async (importOriginal) =>
 *         (await import("./support/offene-fassung.ts")).mitOffenerFassung19(await importOriginal()),
 *     );
 */
export function mitOffenerFassung19(echt: typeof Rezepte): typeof Rezepte {
    const accepted = [17, 18];
    return {
        ...echt,
        AVENTURIA_TERRAIN_SELECTION: { ...echt.AVENTURIA_TERRAIN_SELECTION, accepted },
        fassungsName: (version: number, liste: readonly number[] = accepted) => echt.fassungsName(version, liste),
    };
}
