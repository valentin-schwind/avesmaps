import { describe, expect, it } from "vitest";
import { landscapeCopyLayers, type EditorLandscapeDetail, type EditorLandscapeRow } from "@avesmaps3d/shared";
import {
    kopierPlan,
    loeschFolge,
    SPRACHEN_ZIEL,
    sprachPlan,
    startWahl,
    wikiSatz,
    zielEbenen,
    zielLandschaften,
} from "../src/landschaftseditor/landschaft-kopieren";
import { NEUE_FARBE } from "../src/spracheditor/sprache-felder";
import { NEUE_SPRACHE } from "../src/spracheditor/sprachflaeche-kopieren";

/**
 * „Kopieren …“ (WI-0178 Werkzeug 8, Betreiber 2026-10-19 „wie legacy B mit haken“; Legacy `ecosystem-transfer.test.js`). Problemfälle:
 * Die eigene Ebene ist vorgewählt (die Kopie läge unsichtbar auf der Quelle); eine Landschaft, die nicht auf der Karte ist, wird Ziel;
 * die Art der Quelle reist in eine fremde Ebene; eine neue ohne Namen geht zum Server; der Haken kündigt das Verschwinden der Landschaft
 * an, obwohl die Kopie in ihr landet.
 */

const zeile = (id: string, name: string, layer: EditorLandscapeRow["layer"], state?: "off_map"): EditorLandscapeRow =>
    ({ id, name, layer, circle: "halb-rechts", order: 1, ...(state ? { state } : {}) }) as EditorLandscapeRow;
const WALD = {
    id: "r-wald",
    name: "Farindel",
    layer: "vegetation",
    areas: [{ id: "a-1" }],
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Farindel" },
} as unknown as EditorLandscapeDetail;

describe("Die Zielebene", () => {
    it("🔴 der Zwilling zuerst, die eigene Ebene zuletzt; Derographie ohne Zwilling", () => {
        expect(landscapeCopyLayers("vegetation")).toEqual(["topographie", "derographisch", "vegetation"]);
        expect(landscapeCopyLayers("topographie")).toEqual(["vegetation", "derographisch", "topographie"]);
        expect(landscapeCopyLayers("derographisch")).toEqual(["vegetation", "topographie", "derographisch"]);
        expect(startWahl(WALD)).toEqual({ ebene: "topographie", ziel: "", name: "Farindel", art: "", loeschen: false });
    });
});

describe("Die Ziellandschaft", () => {
    it("🔴 nur Landschaften der Zielebene auf der Karte, nach Namen", () => {
        const zeilen = [
            zeile("1", "Windhagberge", "topographie"),
            zeile("2", "Arvepass", "topographie"),
            zeile("3", "Farindel", "vegetation"),
            zeile("4", "Alte Hügel", "topographie", "off_map"),
        ];
        expect(zielLandschaften(zeilen, "topographie", "de").map((z) => z.name)).toEqual(["Arvepass", "Windhagberge"]);
    });
});

describe("Der Plan", () => {
    it("🔴 neu: Name getrimmt, Art nur, wenn gewählt; ohne Namen der Satz statt einer Anfrage", () => {
        const wahl = startWahl(WALD);
        expect(kopierPlan({ ...wahl, name: "  Farindel  " })).toEqual({
            ziel: { layer: "topographie", name: "Farindel", deleteSource: false },
        });
        expect(kopierPlan({ ...wahl, art: "huegelland", loeschen: true })).toEqual({
            ziel: { layer: "topographie", name: "Farindel", type: "huegelland", deleteSource: true },
        });
        expect(kopierPlan({ ...wahl, name: "   " })).toEqual({ fehler: "landschaftseditor.kopieren.nameFehlt" });
    });

    it("bestehend: nur Ebene, Ziel und Haken; Name und Art zählen nicht", () => {
        expect(kopierPlan({ ...startWahl(WALD), ziel: "r-huegel", name: "", art: "gebirge" })).toEqual({
            ziel: { layer: "topographie", targetId: "r-huegel", deleteSource: false },
        });
    });
});

describe("Das Ziel „Sprachen“ (WI-0261, „Ja, bauen“)", () => {
    it("🔴 nur mit Recht an den Sprachen, als letzte Wahl hinter den Ebenen der Landschaften (deren Folge bleibt)", () => {
        expect(zielEbenen("vegetation", false)).toEqual(landscapeCopyLayers("vegetation"));
        expect(zielEbenen("vegetation", true)).toEqual([...landscapeCopyLayers("vegetation"), SPRACHEN_ZIEL]);
    });

    it("🔴 bestehende Sprache oder „Neue Sprache …“ mit Namen wie im Kopierblatt der Sprachen; nie „Originalfläche löschen“", () => {
        expect(sprachPlan({ ziel: "", name: "" })).toEqual({ fehler: "spracheditor.kopieren.zielFehlt" });
        expect(sprachPlan({ ziel: "s-garethi", name: "egal" })).toEqual({ ziel: { targetId: "s-garethi" } });
        expect(sprachPlan({ ziel: NEUE_SPRACHE, name: "  " })).toEqual({ fehler: "spracheditor.grund.name" });
        expect(sprachPlan({ ziel: NEUE_SPRACHE, name: " Waldsprache " })).toEqual({
            ziel: { neueSprache: { name: "Waldsprache", farbe: NEUE_FARBE } },
        });
    });
});

describe("Die Sätze", () => {
    it("🔴 der Wiki-Artikel reist nur unter demselben Namen, und nur in eine neue Landschaft", () => {
        const wahl = startWahl(WALD);
        expect(wikiSatz(WALD, wahl)).toBe("landschaftseditor.kopieren.wikiMit");
        expect(wikiSatz(WALD, { ...wahl, name: "Farindel-Hügel" })).toBe("landschaftseditor.kopieren.wikiOhne");
        expect(wikiSatz(WALD, { ...wahl, ziel: "r-huegel" })).toBeUndefined();
        expect(wikiSatz({ name: WALD.name }, wahl)).toBeUndefined();
    });

    it("🔴 der Haken: die letzte Teilfläche nimmt die Landschaft mit, außer die Kopie landet in ihr", () => {
        const wahl = { ...startWahl(WALD), loeschen: true };
        expect(loeschFolge(WALD, { ...wahl, loeschen: false })).toBeUndefined();
        expect(loeschFolge(WALD, wahl)).toBe("landschaftseditor.kopieren.folgeLetzte");
        expect(loeschFolge(WALD, { ...wahl, ebene: "vegetation", ziel: "r-wald" })).toBe(
            "landschaftseditor.kopieren.folge",
        );
        const zwei = { ...WALD, areas: [{ id: "a-1" }, { id: "a-2" }] } as unknown as EditorLandscapeDetail;
        expect(loeschFolge(zwei, wahl)).toBe("landschaftseditor.kopieren.folge");
    });
});
