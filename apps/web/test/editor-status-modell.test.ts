import { describe, expect, it } from "vitest";
import { hauptGegenstand, type MapHistoryEntry, type MapHistoryObject } from "@avesmaps3d/shared";
import { editorKreis, letzteZeilen, seitText, siegelVon } from "../src/editor-panel/editor-status-modell";

/**
 * Die Editorenliste (WI-0276). Problemfälle: Eine Teilfläche steht ohne ihr Ganzes da und lässt sich nicht anfliegen; drei Griffe am selben Weg füllen die ganze Karte; eine
 * neue Sperre zeigt „seit 0 Min.“; ein Name, der mit einem Zeichen außerhalb der BMP beginnt, zerfällt im Siegel.
 */

const gegenstand = (teil: Partial<MapHistoryObject> & Pick<MapHistoryObject, "kind" | "id">): MapHistoryObject => ({
    action: "place.updated",
    revisionBefore: 1,
    revisionAfter: 2,
    changes: {},
    ...teil,
});
const eintrag = (n: number, objects: readonly MapHistoryObject[], summary?: string): MapHistoryEntry => ({
    operationId: `op-${String(n)}`,
    seq: n,
    at: `2026-10-28T13:5${String(n)}:00.000Z`,
    operation: "place.update",
    source: "editor",
    actor: { kind: "person", id: "p", name: "Thomas" },
    objects: [...objects],
    ...(summary === undefined ? {} : { summary }),
});
const weg = (id: string, name: string): MapHistoryObject => gegenstand({ kind: "path", id, name });

describe("Der Kreis einer Person", () => {
    const sperre = { art: "path", id: "a", name: "Tarle", woran: "form", seit: "2026-11-02T20:00:00.000Z" } as const;

    it("🔴 ● bearbeitet, auch wenn die Sitzung gerade nichts meldet; ◐ online; ○ nicht da", () => {
        expect(editorKreis({ bearbeitet: sperre, online: true })).toBe("voll");
        expect(editorKreis({ bearbeitet: sperre, online: false })).toBe("voll");
        expect(editorKreis({ bearbeitet: null, online: true })).toBe("halb");
        expect(editorKreis({ bearbeitet: null, online: false })).toBe("leer");
    });
});

describe("Seit wann eine Sperre gilt", () => {
    const jetzt = new Date("2026-11-02T21:00:00.000Z");

    it("nie „seit 0 Min.“; Minuten bis zur Stunde, danach Stunden", () => {
        expect(seitText("2026-11-02T20:59:40.000Z", jetzt)).toBe("seit 1 Min.");
        expect(seitText("2026-11-02T20:48:00.000Z", jetzt)).toBe("seit 12 Min.");
        expect(seitText("2026-11-02T20:00:30.000Z", jetzt)).toBe("seit 59 Min.");
        expect(seitText("2026-11-02T18:55:00.000Z", jetzt)).toBe("seit 2 Std.");
    });
});

describe("Das Siegel", () => {
    it("trägt den ersten Buchstaben groß, auch ohne Leerzeichen davor und außerhalb der BMP", () => {
        expect(siegelVon("  thomas", "de")).toBe("T");
        expect(siegelVon("Ärger", "de")).toBe("Ä");
        expect(siegelVon("𝔸lrik", "de")).toBe("𝔸");
        expect(siegelVon("", "de")).toBe("");
    });
});

describe("Wofür eine Operation steht", () => {
    it("🔴 eine Teilfläche steht für ihr Ganzes: Nur das lässt sich anfliegen", () => {
        expect(
            hauptGegenstand([
                gegenstand({
                    kind: "territory_area",
                    id: "flaeche",
                    name: "Baronie Uhdenwald",
                    territory: { id: "gebiet", name: "Baronie Uhdenwald" },
                }),
            ]),
        ).toMatchObject({ kind: "territory", id: "gebiet", name: "Baronie Uhdenwald" });
        expect(
            hauptGegenstand([
                gegenstand({ kind: "area", id: "teil", landscape: { id: "flaeche", name: "Raschtulswall" } }),
            ]),
        ).toMatchObject({ kind: "landscape", id: "flaeche", name: "Raschtulswall" });
        expect(
            hauptGegenstand([
                gegenstand({ kind: "sprache_flaeche", id: "teil", sprache: { id: "s", name: "Rssahh" } }),
            ]),
        ).toMatchObject({ kind: "sprache", id: "s", name: "Rssahh" });
    });

    it("der erste Gegenstand mit Namen gewinnt; ohne Namen der erste; ohne Gegenstand nichts", () => {
        expect(hauptGegenstand([gegenstand({ kind: "nodix", id: "n" }), weg("w", "Tarle")])).toMatchObject({ id: "w" });
        expect(hauptGegenstand([gegenstand({ kind: "nodix", id: "n" })])).toMatchObject({ id: "n" });
        expect(hauptGegenstand([])).toBeUndefined();
    });
});

describe("Die letzten Änderungen einer Person", () => {
    it("🔴 Änderungen in Folge am selben Objekt sind eine Zeile mit ihrer Zahl; die jüngste Zeit gilt", () => {
        const zeilen = letzteZeilen(
            [
                eintrag(3, [weg("a", "Tarle")]),
                eintrag(2, [weg("a", "Tarle")]),
                eintrag(1, [weg("a", "Tarle")]),
                eintrag(0, [gegenstand({ kind: "place", id: "o", name: "Luring" })], "Luring verschoben"),
            ],
            3,
        );
        expect(zeilen).toHaveLength(2);
        expect(zeilen[0]).toMatchObject({ art: "path", id: "a", name: "Tarle", was: "3 Änderungen" });
        expect(zeilen[0]!.am).toBe("2026-10-28T13:53:00.000Z");
        expect(zeilen[1]).toMatchObject({ art: "place", id: "o", was: "Luring verschoben" });
    });

    it("kehrt jemand zum selben Objekt zurück, ist das eine neue Zeile; nach der Grenze hört die Liste auf", () => {
        const zeilen = letzteZeilen(
            [
                eintrag(4, [weg("a", "Tarle")]),
                eintrag(3, [weg("b", "Ferdok")]),
                eintrag(2, [weg("a", "Tarle")]),
                eintrag(1, [weg("c", "Punin")]),
            ],
            3,
        );
        expect(zeilen.map((zeile) => zeile.id)).toEqual(["a", "b", "a"]);
    });

    it("eine Operation ohne Gegenstand bleibt eine eigene Zeile", () => {
        const zeilen = letzteZeilen([eintrag(2, [], "Zwei"), eintrag(1, [], "Eins")], 3);
        expect(zeilen.map((zeile) => zeile.was)).toEqual(["Zwei", "Eins"]);
        expect(zeilen[0]!.art).toBeUndefined();
    });
});
