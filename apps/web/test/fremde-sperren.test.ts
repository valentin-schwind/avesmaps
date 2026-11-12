import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorLock } from "@avesmaps3d/shared";
import {
    createFremdeSperren,
    schildLage,
    sperrDetail,
    sperrKopf,
    sperrSchild,
} from "../src/editor-sperre/fremde-sperren.ts";
import { flaecheHandgriffe, flaecheSubjekt } from "../src/editor-menu/handgriffe-flaeche.ts";
import { handgriffZeilen } from "../src/editor-menu/action.ts";
import { kartenAbschnitte } from "../src/editor-menu/kartenmenue.ts";

/**
 * Die Sperren der anderen im Browser (WI-0178 S3; EDIT-0003 §4, T27 (3)). Problemfälle: Die eigene Sperre erscheint als Schloss; ein
 * später eintreffendes, älteres Ergebnis überschreibt ein neueres; außerhalb des Editor-Modus fragt der Takt; „Gebietsform bearbeiten“
 * geht, obwohl ein anderer die Landschaft hält; der Kasten fehlt im Kartenmenü; Schild und Kasten nennen nicht wer, woran, seit wann;
 * an einer Kraftlinie findet ein Klick auf einen anderen Abschnitt als den Anker die Sperre nicht (WI-0205 K11).
 */
const FREMD: EditorLock = {
    kind: "landscape",
    id: "c1c1c1c1-0000-4000-8000-000000000001",
    part: "form",
    person: { id: "c1c1c1c1-0000-4000-8000-0000000000f1", name: "Thomas" },
    since: "2026-10-16T05:32:00.000Z",
    heartbeatAt: "2026-10-16T05:41:00.000Z",
    own: false,
};
const EIGEN: EditorLock = { ...FREMD, id: "c1c1c1c1-0000-4000-8000-000000000002", own: true };

afterEach(() => {
    vi.useRealTimers();
});

describe("fremde Sperren", () => {
    it("🔴 eigene Sperren zeigen kein Schloss; der Takt fragt nur im Editor-Modus", async () => {
        vi.useFakeTimers();
        let aktiv = true;
        const liste = vi.fn(async () => [FREMD, EIGEN]);
        const sperren = createFremdeSperren({ sperre: { liste }, art: "landscape", aktiv: () => aktiv });
        await sperren.frisch();
        expect(sperren.liste.value.map((sperre) => sperre.id)).toEqual([FREMD.id]);
        expect(sperren.von(FREMD.id)?.person.name).toBe("Thomas");
        expect(sperren.von(EIGEN.id)).toBeUndefined();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(liste).toHaveBeenCalledTimes(2);
        aktiv = false;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(liste).toHaveBeenCalledTimes(2);
        expect(sperren.liste.value).toEqual([]);
        sperren.destroy();
    });

    it("🔴 ein älteres Ergebnis, das später kommt, überschreibt das neuere nicht", async () => {
        let loese: ((wert: EditorLock[]) => void) | undefined;
        const liste = vi
            .fn<() => Promise<EditorLock[]>>()
            .mockImplementationOnce(() => new Promise((r) => (loese = r)))
            .mockImplementationOnce(async () => []);
        const sperren = createFremdeSperren({ sperre: { liste }, art: "landscape", aktiv: () => true });
        const erst = sperren.frisch();
        await sperren.frisch();
        loese!([FREMD]);
        await erst;
        expect(sperren.liste.value).toEqual([]);
        sperren.destroy();
    });

    it("🔴 am Ort steht das Schild über der Marke, an der Landschaft mittig (WI-0208)", () => {
        expect(schildLage({ kind: "place" })).toEqual({ anchor: "bottom", offset: [0, -16] });
        expect(schildLage({ kind: "landscape" })).toEqual({ anchor: "center" });
    });

    it("Schild, Kopf und Zeile darunter nennen wer, woran und die Uhrzeiten", () => {
        expect(sperrSchild(FREMD)).toMatch(/^🔒 Thomas · Form · seit \d\d:\d\d$/);
        expect(sperrKopf(FREMD)).toMatch(/^🔒 Thomas bearbeitet die Form seit \d\d:\d\d$/);
        expect(sperrDetail(FREMD)).toMatch(/^Zuletzt aktiv um \d\d:\d\d, ohne Aktivität frei ab \d\d:\d\d\.$/);
    });

    it("🔴 hält ein anderer die Landschaft: „Gebietsform bearbeiten“ gesperrt, das Kartenmenü trägt den Kasten", () => {
        const wald = flaecheSubjekt(
            { kind: "landscape", id: FREMD.id, name: "Reichsforst", type: "wald", area: 3 },
            "Reichsforst",
            "Wald",
        );
        const actions = flaecheHandgriffe(
            () => ({
                rechte: [
                    "use_editor_menu",
                    "edit_map_objects",
                    "edit_map_geometry",
                    "edit_territories",
                    "edit_landscapes",
                    "edit_territory_form",
                    "edit_landscape_form",
                    "edit_mountains",
                ],
                bearbeiten: { mapEditing: "testwelt" } as never,
                laeuft: false,
                sperreVon: (id) => (id === FREMD.id ? FREMD : undefined),
            }),
            {
                oeffnen: vi.fn(),
                beschriftung: vi.fn(),
                ecken: vi.fn(),
                platz: vi.fn(),
                klicksperre: vi.fn(),
                entfernen: vi.fn(),
                verbergen: vi.fn(),
            },
        );
        expect(handgriffZeilen(actions, wald, "karte").find((zeile) => zeile.id === "flaeche-gebietsform")?.grund).toBe(
            "sperre.grund",
        );
        const [objekt] = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "flaechen", titel: "areaChoice.count", gegenstaende: [wald] },
            anlegen: [],
            uebersetze: (key) => key,
            sperreVon: () => ({ kopf: "K", detail: "D", ziel: { kind: "landscape", id: FREMD.id } }),
        });
        expect(objekt?.sperre).toEqual({ kopf: "K", detail: "D", ziel: { kind: "landscape", id: FREMD.id } });
    });

    it("🔴 an Linien: ein Klick trifft einen Abschnitt, gesperrt ist der Anker; vonAbschnitt findet die Sperre über ihre Abschnitte", async () => {
        const linie: EditorLock = {
            ...FREMD,
            kind: "powerline",
            id: "c1c1c1c1-0000-4000-8000-0000000000a1",
            sections: ["c1c1c1c1-0000-4000-8000-0000000000a1", "c1c1c1c1-0000-4000-8000-0000000000a2"],
        };
        const liste = vi.fn(async () => [linie]);
        const sperren = createFremdeSperren({ sperre: { liste }, art: "powerline", aktiv: () => true });
        await sperren.frisch();
        expect(sperren.vonAbschnitt("c1c1c1c1-0000-4000-8000-0000000000a2")).toBe(linie);
        expect(sperren.von("c1c1c1c1-0000-4000-8000-0000000000a2")).toBeUndefined();
        expect(sperren.vonAbschnitt("c1c1c1c1-0000-4000-8000-0000000000a3")).toBeUndefined();
        sperren.destroy();
    });
});
