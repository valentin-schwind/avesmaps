import { describe, expect, it } from "vitest";
import type { EditorPathStreet } from "@avesmaps3d/shared";
import { felderAus } from "../src/wegeditor/weg-art";
import { wegAbweichende, wegAllesAufWiki, wegAufWiki, wegWikiLage } from "../src/wegeditor/weg-wiki";

/**
 * Die Wiki-Felder der Straße (WI-0177, Baustein WI-0225, Design Guide §13.8). Problemfälle: Die Karawanenroute bekommt am Wegtyp ein
 * ↺, das den Untergrund und damit die Reisezeit ändert; eine Kronstraße wird nicht als Reichsstraße erkannt; die Mischform bekommt still
 * ein Kennzeichen; ein Flussweg bekommt ↺ am Wegtyp; „Alles auf Wiki-Werte“ zählt oder setzt mehr als die abweichenden Felder.
 */

const A = "0c0c0c0c-0000-4000-8000-0000000000a1";
const B = "0c0c0c0c-0000-4000-8000-0000000000a2";
const strasse = (zusatz: Partial<EditorPathStreet>, art?: string, titel = "Keft–Rashdul"): EditorPathStreet => ({
    id: A,
    name: "Keft–Rashdul",
    subtype: "Pfad",
    isBach: false,
    circle: "voll",
    labelVisible: true,
    segments: [
        { id: A, revision: 3, labelVisible: true, wiki: true, points: 4 },
        { id: B, revision: 5, labelVisible: true, wiki: true, points: 3 },
    ],
    artikel: {
        key: "keft-rashdul",
        url: "https://de.wiki-aventurica.de/wiki/Keft",
        name: titel,
        werte: { name: titel, ...(art === undefined ? {} : { subtype: art, mark: art }) },
    },
    ...zusatz,
});

describe("Wiki-Felder der Straße", () => {
    it("🔴 Karawanenroute: das ↺ gehört dem Kennzeichen; der Wegtyp hat kein Gegenstück und bleibt der Untergrund", () => {
        const d = strasse({}, "Karawanenroute");
        const f = felderAus(d);
        expect(wegWikiLage(d, f, "subtype", false).zustand).toBe("ohne");
        expect(wegWikiLage(d, f, "mark", false)).toMatchObject({ zustand: "weicht", zurueck: true });
        expect(wegAufWiki(d, f, "mark")).toEqual({ ...f, mark: "karawanenroute", herkunft: { mark: "wiki" } });
        expect(wegAufWiki(d, f, "subtype")).toBe(f);
        // Mit Kennzeichen steht es gleich.
        expect(wegWikiLage(d, { ...f, mark: "karawanenroute" }, "mark", false).zustand).toBe("gleich");
    });

    it("🔴 Kronstraße ist Reichsstraße; jede andere Art nimmt das Kennzeichen weg", () => {
        const d = strasse({}, "Kronstraße");
        const f = { ...felderAus(d), mark: "karawanenroute" as const };
        expect(wegWikiLage(d, f, "subtype", false)).toMatchObject({ zustand: "weicht", wikiText: "Kronstraße" });
        expect(wegAufWiki(d, f, "subtype").subtype).toBe("Reichsstrasse");
        expect(wegWikiLage(d, f, "mark", false).zustand).toBe("weicht");
        expect(wegAufWiki(d, f, "mark").mark).toBeNull();
    });

    it("🔴 die Mischform bleibt ohne Zuordnung, an Wegtyp und Kennzeichen; ↺ still", () => {
        const d = strasse({}, "Karawanenroute, Pass");
        const f = felderAus(d);
        expect(wegWikiLage(d, f, "subtype", false)).toMatchObject({ zustand: "unzugeordnet", zurueck: false });
        expect(wegWikiLage(d, f, "mark", false)).toMatchObject({ zustand: "unzugeordnet", zurueck: false });
        expect(wegAufWiki(d, f, "mark")).toBe(f);
    });

    it("🔴 ein Flussweg liest Wegtyp und Kennzeichen nur; ohne Artikel hat kein Feld ein Gegenstück", () => {
        const fluss = strasse({ subtype: "Flussweg" }, "Fluss");
        expect(wegWikiLage(fluss, felderAus(fluss), "subtype", false).zustand).toBe("lesend");
        const ohne: EditorPathStreet = { ...strasse({}) };
        delete ohne.artikel;
        expect(WEG_ZUSTAENDE(ohne)).toEqual(["ohne", "ohne", "ohne"]);
    });

    it("🔴 gemischter Untergrund weicht vom Wiki-Wegtyp ab; ↺ setzt alle Abschnitte auf ihn", () => {
        const d = strasse({ subtypes: ["Pfad", "Wuestenpfad"] }, "Pfad");
        const f = felderAus(d);
        expect(f.subtype).toBe("");
        expect(wegWikiLage(d, f, "subtype", false).zustand).toBe("weicht");
        expect(wegAufWiki(d, f, "subtype").subtype).toBe("Pfad");
    });

    it("„Alles auf Wiki-Werte“ zählt und setzt nur die abweichenden Felder, als EIN Schritt", () => {
        const d = strasse({}, "Karawanenroute", "Karawanenroute von Keft nach Rashdul");
        const f = { ...felderAus(d), name: "Eigener Name" };
        expect(wegAbweichende(d, f, false)).toBe(2);
        expect(wegAbweichende(d, f, true)).toBe(0);
        const neu = wegAllesAufWiki(d, f, false);
        expect(neu).toEqual({
            ...f,
            name: "Karawanenroute von Keft nach Rashdul",
            mark: "karawanenroute",
            herkunft: { name: "wiki", mark: "wiki" },
        });
        expect(wegAbweichende(d, neu, false)).toBe(0);
    });
});

describe("Herkunft der Wiki-Felder (WI-0225 §7)", () => {
    it("🔴 nach ↺ folgt das Feld dem Wiki; ein getippter gleicher Wert ist nur gleich; die Abschnitte bringen sie mit", () => {
        const d = strasse({}, "Kronstraße", "Kronweg");
        const zurueck = wegAufWiki(d, felderAus(d), "name");
        expect(zurueck).toMatchObject({ name: "Kronweg", herkunft: { name: "wiki" } });
        expect(wegWikiLage(d, zurueck, "name", false).zustand).toBe("folgt");
        expect(wegWikiLage(d, { ...zurueck, herkunft: { name: "manual" } }, "name", false).zustand).toBe("gleich");
        const gelesen = strasse(
            {
                subtype: "Reichsstrasse",
                segments: [
                    { id: A, revision: 3, labelVisible: true, wiki: true, points: 4, herkunft: { subtype: "wiki" } },
                    { id: B, revision: 5, labelVisible: true, wiki: true, points: 3, herkunft: { subtype: "wiki" } },
                ],
            },
            "Kronstraße",
        );
        expect(wegWikiLage(gelesen, felderAus(gelesen), "subtype", false).zustand).toBe("folgt");
    });
});

/** Die Zustände der drei Wiki-Felder einer Straße, wie gelesen. */
function WEG_ZUSTAENDE(d: EditorPathStreet): string[] {
    const f = felderAus(d);
    return (["name", "subtype", "mark"] as const).map((feld) => wegWikiLage(d, f, feld, false).zustand);
}
