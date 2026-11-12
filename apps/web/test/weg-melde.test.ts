import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { EditorPathList, EditorPathStreet } from "@avesmaps3d/shared";
import type { Werkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { meldeWege } from "../src/wegeditor/weg-melde";
import { createWegeditorSteuerung } from "../src/wegeditor/wegeditor-steuerung";

/**
 * Wege, die der Reiter „Änderungen“ zurücknimmt (WI-0265 B6a2): Ein offenes Wege-Fenster hält die Revisionen vom letzten Lesen. Problemfälle: Das Fenster zeigt nach dem ↺ die alte
 * Straße und schreibt mit einer veralteten Revision (409 beim nächsten „Fertig“); die Kacheln der Karte ziehen nicht nach; ein Fenster mit laufender Bearbeitung verliert sein
 * Ungeschriebenes.
 */

const A = "0e0e0e0e-0000-4000-8000-0000000000a1";
const STRASSE: EditorPathStreet = {
    id: A,
    name: "Halwartsstieg",
    subtype: "Strasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [{ id: A, revision: 4, labelVisible: true, wiki: false, points: 4 }],
};
const LISTE: EditorPathList = {
    rows: [{ id: A, name: "Halwartsstieg", subtype: "Strasse", isBach: false, circle: "halb-rechts", segments: 1 }],
};

const ruhe = () => new Promise((r) => setTimeout(r, 0));

function aufbau() {
    const fenster = ref([
        { id: "f1", werkzeug: "wegeditor", gegenstand: A as string | undefined, lage: "angedockt", vorn: 1 },
    ]);
    const werkzeugfenster = {
        stand: computed(() => ({ fenster: fenster.value })),
        hervorholen: vi.fn(),
        markiere: vi.fn(),
        setzeLage: vi.fn(),
        oeffne: vi.fn(),
        oeffneAnStelle: vi.fn(),
    } as unknown as Werkzeugfenster;
    const aufrufe = { liste: 0, strasse: 0 };
    const fetcher = vi.fn(async (url: string) => {
        if (url.endsWith("/api/editor/paths")) {
            aufrufe.liste += 1;
            return new Response(JSON.stringify(LISTE));
        }
        aufrufe.strasse += 1;
        return new Response(JSON.stringify(STRASSE));
    });
    const geaendert = vi.fn();
    const s = createWegeditorSteuerung(werkzeugfenster, fetcher as never, undefined, {
        sperre: { nimm: vi.fn(), gib: vi.fn(), beiVerlust: () => () => undefined } as never,
        geaendert,
        darfSchreiben: () => true,
    });
    return { s, aufrufe, geaendert };
}

describe("Wege-Fenster nach einer Rücknahme im Reiter „Änderungen“", () => {
    it("🔴 die Kacheln ziehen mit der Revision der Rücknahme nach, Liste und Straße lesen neu, die Bearbeitung des Fensters ist eine neue", async () => {
        const { s, aufrufe, geaendert } = aufbau();
        s.ladeListe();
        await ruhe();
        await ruhe();
        const vorher = s.bearbeitungVon(A);
        expect(vorher).toBeDefined();
        const listeVorher = aufrufe.liste;

        meldeWege([A], 4711);
        await ruhe();
        await ruhe();

        expect(geaendert).toHaveBeenCalledWith(4711);
        expect(aufrufe.liste).toBe(listeVorher + 1);
        expect(s.bearbeitungVon(A)).toBeDefined();
        expect(s.bearbeitungVon(A)).not.toBe(vorher);
        s.destroy();
    });

    it("🔴 eine zweite Meldung mit gleichem Inhalt wirkt wieder; nach `destroy` hört die Steuerung nicht mehr zu", async () => {
        const { s, geaendert } = aufbau();
        meldeWege([A], 5000);
        await ruhe();
        meldeWege([A], 5000);
        await ruhe();
        expect(geaendert).toHaveBeenCalledTimes(2);
        s.destroy();
        meldeWege([A], 5001);
        await ruhe();
        expect(geaendert).toHaveBeenCalledTimes(2);
    });
});
