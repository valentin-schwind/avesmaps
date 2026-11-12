import { describe, expect, it } from "vitest";
import type { SubjectRef } from "@avesmaps3d/shared";
import { listValueLinks, textLinks, type LinkPiece, type LinkSource } from "../src/subjects/link-pieces.ts";
import type { WikiKeyLookup, WikiKeyTarget } from "../src/subjects/wiki-key-lookup.ts";

/**
 * Ein Link an seiner Stelle im angezeigten Text (WI-0063 27.12): Die Teilstücke stammen aus Legacys Export X1 (Anzeigetext, kanonischer Key des Linkziels), das
 * Objekt aus der Zuordnung X2. Der Anzeigetext sagt nur, WO der Link steht; ein Name macht nie einen Link. Alle Fälle ohne Datenbank; die Fixtures sind
 * Legacys Beispiele (`docs/wiki-linkziele-export.md`, Gareth, Dump 08.09.2026), abgeschrieben und gekürzt.
 */

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const road = (n: number): SubjectRef => ({ kind: "path", anchor: id(n), wiki: `weg-${String(n)}` });
const place = (n: number): SubjectRef => ({ kind: "place", id: id(n) });
const area = (n: number): SubjectRef => ({ kind: "area", id: id(n) });

const ROAD_2 = road(1);
const ROAD_3 = road(2);
const GARDEL = road(3);

function source(pages: Record<string, readonly LinkPiece[]>, objects: Record<string, SubjectRef[]> = {}): LinkSource {
    const byKey = new Map<string, WikiKeyTarget[]>(
        Object.entries(objects).map(([key, refs]) => [
            key,
            refs.map((ref) => ({ kind: ref.kind as WikiKeyTarget["kind"], ref })),
        ]),
    );
    const lookup: WikiKeyLookup = { byKey, pageKeys: new Map() };
    return { lookup, pages: new Map(Object.entries(pages)) };
}

const piece = (text: string, key: string): LinkPiece => ({ text, key });

describe("Gareth: „Reichsstraßen 2 und 3, Gardel“ (der Fall des Betreibers)", () => {
    const OBJECTS = {
        "wiki:reichsstrasse-2": [ROAD_2],
        "wiki:reichsstrasse-3": [ROAD_3],
        "wiki:gardel": [GARDEL],
    };
    const TEXT = "Reichsstraßen 2 und 3, Gardel";

    it("🔴 Legacys Beispiel (anzeige „Reichsstraßen 2“, „3“, „Gardel“): jeder Link steht an seiner Stelle und trifft über SEINEN Key sein Objekt", () => {
        const links = textLinks(
            source(
                {
                    verkehrswege: [
                        piece("Reichsstraßen 2", "wiki:reichsstrasse-2"),
                        piece("3", "wiki:reichsstrasse-3"),
                        piece("Gardel", "wiki:gardel"),
                    ],
                },
                OBJECTS,
            ),
            ["verkehrswege"],
            TEXT,
        );
        expect(links).toEqual([
            { text: "Reichsstraßen 2", ref: ROAD_2, at: 0 },
            { text: "3", ref: ROAD_3, at: TEXT.indexOf("3") },
            { text: "Gardel", ref: GARDEL, at: TEXT.indexOf("Gardel") },
        ]);
        for (const link of links) expect(TEXT.startsWith(link.text, link.at)).toBe(true);
    });

    it("🔴 steht nur die Ziffer im Link („2“ → Reichsstraße 2, „3“ → Reichsstraße 3): die „2“ ist der Link, nicht „Reichsstraßen 2“", () => {
        const links = textLinks(
            source(
                {
                    verkehrswege: [
                        piece("2", "wiki:reichsstrasse-2"),
                        piece("3", "wiki:reichsstrasse-3"),
                        piece("Gardel", "wiki:gardel"),
                    ],
                },
                OBJECTS,
            ),
            ["verkehrswege"],
            TEXT,
        );
        expect(links.map((link) => [link.text, link.ref, link.at])).toEqual([
            ["2", ROAD_2, TEXT.indexOf("2")],
            ["3", ROAD_3, TEXT.indexOf("3")],
            ["Gardel", GARDEL, TEXT.indexOf("Gardel")],
        ]);
    });

    it("🔴 ein Name ohne Linkziel bleibt Text, auch wenn er genau ein Objekt der Karte heißt", () => {
        // „Gardel“ steht im Text und es gibt ein Objekt dieses Namens - aber der Quelltext nennt dafür kein Linkziel, also kein Link.
        const links = textLinks(
            source({ verkehrswege: [piece("Reichsstraßen 2", "wiki:reichsstrasse-2")] }, OBJECTS),
            ["verkehrswege"],
            TEXT,
        );
        expect(links.map((link) => link.text)).toEqual(["Reichsstraßen 2"]);
    });

    it("🔴 ein Linkziel, dessen Key kein Objekt trägt, bleibt Text; der Zeiger rückt trotzdem weiter", () => {
        const links = textLinks(
            source(
                {
                    verkehrswege: [
                        piece("Reichsstraßen 2", "wiki:reichsstrasse-2"),
                        piece("3", "wiki:reichsstrasse-99"),
                        piece("Gardel", "wiki:gardel"),
                    ],
                },
                OBJECTS,
            ),
            ["verkehrswege"],
            TEXT,
        );
        expect(links.map((link) => link.text)).toEqual(["Reichsstraßen 2", "Gardel"]);
    });

    it("🔴 ein mehrdeutiger Key (zwei Objekte) bleibt Text: nichts wird gewählt", () => {
        const links = textLinks(
            source(
                { verkehrswege: [piece("Gardel", "wiki:gardel"), piece("Reichsstraßen 2", "wiki:reichsstrasse-2")] },
                { "wiki:gardel": [GARDEL, place(9)], "wiki:reichsstrasse-2": [ROAD_2] },
            ),
            ["verkehrswege"],
            "Gardel, Reichsstraßen 2",
        );
        expect(links.map((link) => link.text)).toEqual(["Reichsstraßen 2"]);
    });
});

describe("die Stelle im Text", () => {
    it("🔴 der Zeiger rückt hinter JEDES gefundene Teilstück, auch hinter eines ohne Objekt: „Gareth“ steht nicht schon in „Alt-Gareth“", () => {
        const links = textLinks(
            source(
                { staat: [piece("Alt-Gareth", "wiki:alt-gareth"), piece("Gareth", "wiki:gareth")] },
                { "wiki:gareth": [place(1)] },
            ),
            ["staat"],
            "Alt-Gareth · Gareth",
        );
        expect(links).toEqual([{ text: "Gareth", ref: place(1), at: "Alt-Gareth · ".length }]);
    });

    it("🔴 ein Treffer steht auf einer Wortgrenze: „Weiden“ ist nicht in „Weidener“, nicht in „Alt-Weiden“ und nicht in „Weidenau“", () => {
        const weiden = source({ region: [piece("Weiden", "wiki:weiden")] }, { "wiki:weiden": [area(1)] });
        for (const text of ["Weidener Land", "Alt-Weiden", "Weidenau", "Nordweiden"]) {
            expect(textLinks(weiden, ["region"], text), text).toEqual([]);
        }
        expect(textLinks(weiden, ["region"], "Land Weiden, Nord")).toEqual([{ text: "Weiden", ref: area(1), at: 5 }]);
        expect(textLinks(weiden, ["region"], "(Weiden)")).toEqual([{ text: "Weiden", ref: area(1), at: 1 }]);
    });

    it("zwei Links mit DEMSELBEN Anzeigetext und verschiedenem Ziel behalten beide ihre Stelle", () => {
        const links = textLinks(
            source(
                { verkehrswege: [piece("x", "wiki:a"), piece("x", "wiki:b")] },
                { "wiki:a": [road(1)], "wiki:b": [road(2)] },
            ),
            ["verkehrswege"],
            "x und x",
        );
        expect(links).toEqual([
            { text: "x", ref: road(1), at: 0 },
            { text: "x", ref: road(2), at: 6 },
        ]);
    });

    it("🔴 der Verlauf nennt ALLE Links des Rohtexts, auch fremde Wege: nur, wessen Anzeigetext im angezeigten Verlauf steht, wird ein Link", () => {
        // Legacys Beispiel (Elementares Hexagramm): Abzweig- und Querungsziele stehen im Rohtext, nicht im angezeigten Verlauf.
        const links = textLinks(
            source(
                {
                    verlauf: [
                        piece("Unsichtbarer Turm", "wiki:unsichtbarer-turm"),
                        piece("Luft", "wiki:luft"),
                        piece("Tarf El'Hazaqur Mor", "wiki:tarf-el-hazaqur-mor"),
                        piece("Seeweg", "wiki:seeweg"),
                    ],
                },
                {
                    "wiki:unsichtbarer-turm": [place(1)],
                    "wiki:luft": [place(2)],
                    "wiki:tarf-el-hazaqur-mor": [place(3)],
                    "wiki:seeweg": [road(4)],
                },
            ),
            ["verlauf"],
            "Unsichtbarer Turm → Tarf El'Hazaqur Mor",
        );
        expect(links.map((link) => link.text)).toEqual(["Unsichtbarer Turm", "Tarf El'Hazaqur Mor"]);
    });

    it("die Lage aus Region und Staat: die Felder werden in der Reihenfolge des Textes gelesen, „Weiden“ in „Herzogtum Weiden“ ist nicht die Region", () => {
        const text = "Weiden · Herzogtum Weiden, Grafschaft Sichelwacht";
        const links = textLinks(
            source(
                {
                    region: [piece("Weiden", "wiki:weiden")],
                    staat: [
                        piece("Herzogtum Weiden", "wiki:herzogtum-weiden"),
                        piece("Grafschaft Sichelwacht", "wiki:grafschaft-sichelwacht"),
                    ],
                },
                {
                    "wiki:weiden": [area(1)],
                    "wiki:herzogtum-weiden": [area(2)],
                    "wiki:grafschaft-sichelwacht": [area(3)],
                },
            ),
            ["region", "staat"],
            text,
        );
        expect(links).toEqual([
            { text: "Weiden", ref: area(1), at: 0 },
            { text: "Herzogtum Weiden", ref: area(2), at: text.indexOf("Herzogtum") },
            { text: "Grafschaft Sichelwacht", ref: area(3), at: text.indexOf("Grafschaft") },
        ]);
    });

    it("ein Feld ohne Eintrag, eine fehlende Quelle, ein leerer Text oder kein Text ergeben keine Links", () => {
        const withPieces = source({ region: [piece("Weiden", "wiki:weiden")] }, { "wiki:weiden": [area(1)] });
        expect(textLinks(withPieces, ["staat"], "Weiden")).toEqual([]);
        expect(textLinks(undefined, ["region"], "Weiden")).toEqual([]);
        expect(textLinks(withPieces, ["region"], "")).toEqual([]);
        expect(textLinks(withPieces, ["region"], null)).toEqual([]);
        expect(listValueLinks(undefined, "nachbar_n", ["Weiden"])).toEqual([]);
        expect(listValueLinks(withPieces, "nachbar_n", [])).toEqual([]);
    });
});

describe("Listen: die Nachbarn je Himmelsrichtung (listValueLinks)", () => {
    const OBJECTS = {
        "wiki:gashoker-steppe": [area(1)],
        "wiki:svalltermoor": [area(2)],
        "wiki:winhaller-land": [area(3)],
        "wiki:farindelwald": [area(4)],
    };

    it("jeder Wert ist ein eigener Text: der Link nennt den Wert und die Stelle IM Wert", () => {
        const links = listValueLinks(
            source(
                {
                    nachbar_n: [
                        piece("Gashoker Steppe", "wiki:gashoker-steppe"),
                        piece("Svalltermoor", "wiki:svalltermoor"),
                    ],
                },
                OBJECTS,
            ),
            "nachbar_n",
            ["Gashoker Steppe", "Svalltermoor (Region)"],
        );
        expect(links).toEqual([
            { value: 0, text: "Gashoker Steppe", ref: area(1), at: 0 },
            { value: 1, text: "Svalltermoor", ref: area(2), at: 0 },
        ]);
    });

    it("ein Wert kann mehrere Namen tragen („Winhaller Land / Farindelwald“): beide sind Links in demselben Wert", () => {
        const links = listValueLinks(
            source(
                {
                    nachbar_o: [
                        piece("Winhaller Land", "wiki:winhaller-land"),
                        piece("Farindelwald", "wiki:farindelwald"),
                    ],
                },
                OBJECTS,
            ),
            "nachbar_o",
            ["Winhaller Land / Farindelwald"],
        );
        expect(links).toEqual([
            { value: 0, text: "Winhaller Land", ref: area(3), at: 0 },
            { value: 0, text: "Farindelwald", ref: area(4), at: "Winhaller Land / ".length },
        ]);
    });

    it("🔴 ein Wert, den die Links nicht nennen, und ein Name ohne Linkziel bleiben Text", () => {
        const links = listValueLinks(
            source({ nachbar_n: [piece("Svalltermoor", "wiki:svalltermoor")] }, OBJECTS),
            "nachbar_n",
            ["Unbekannt", "Gashoker Steppe", "Svalltermoor"],
        );
        // „Gashoker Steppe“ ist ein Objekt der Karte, hat hier aber kein Linkziel.
        expect(links).toEqual([{ value: 2, text: "Svalltermoor", ref: area(2), at: 0 }]);
    });

    it("die Richtung ist das Feld: Links einer anderen Richtung gehören nicht dazu", () => {
        const links = listValueLinks(
            source({ nachbar_s: [piece("Svalltermoor", "wiki:svalltermoor")] }, OBJECTS),
            "nachbar_n",
            ["Svalltermoor"],
        );
        expect(links).toEqual([]);
    });
});
