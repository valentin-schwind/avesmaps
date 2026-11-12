import { describe, expect, it } from "vitest";
import { EDITORPANEL, type EditorPlaceRow } from "@avesmaps3d/shared";
import { berechne, type ListenStand } from "../src/editor-liste/liste-modell";
import { ORTE_MASKEN, ORTE_OPTIONEN, kreisVon, typVon, wertName, zeileVon } from "../src/editor-liste/orte-liste";

/**
 * Die Orte als Liste (WI-0128 E5, Blatt Fassung 3 „N1 Listenzeilen“): Unterzeile mit der Wiki-Zuordnung, rechts Ortsgröße oder Art,
 * Facetten aus dem Register, Lage und Art nur für Bauwerke und Stätten, „Nicht auf der Karte“ mit den Stätten.
 */
const GRATENFELS: EditorPlaceRow = {
    key: "11111111-0000-4000-8000-000000000001",
    origin: "karte",
    name: "Gratenfels",
    circle: "voll",
    assignment: "assigned",
    subtype: "stadt",
    kind: "Stadt",
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels" },
    x: 450,
    y: 536,
    hasCoat: true,
    imageCount: 2,
};
const KLEIN: EditorPlaceRow = {
    key: "11111111-0000-4000-8000-000000000002",
    origin: "karte",
    name: "Klein-Gratenfels",
    circle: "halb",
    assignment: "none",
    subtype: "dorf",
    x: 451,
    y: 537,
    hidden: true,
};
const TEMPEL: EditorPlaceRow = {
    key: "staette:abc",
    origin: "wiki",
    name: "Dachs Gratenfels",
    circle: "leer",
    assignment: "none",
    kind: "Immanmannschaft",
    within: "Gratenfels",
};
const FESTUNG: EditorPlaceRow = {
    key: "11111111-0000-4000-8000-000000000003",
    origin: "karte",
    name: "Burg Gratenfels",
    circle: "halb",
    assignment: "none",
    subtype: "gebaeude",
    kind: "Burg",
    x: 452,
    y: 538,
};

describe("die vier Zustände des Kreises (WI-0187)", () => {
    /*
     * Betreiber 2026-10-16, wörtlich: „platziert und dem Wiki zugewiesen ● … nur im Wiki, nicht platziert ◐ … platziert, ohne
     * Wiki-Artikel ◑ … nicht platziert, ohne Wiki-Artikel ○“. Der Server liefert noch Legacys drei Stufen; die Liste leitet die vier ab.
     */
    const OHNE_LAGE: EditorPlaceRow = {
        key: "11111111-0000-4000-8000-000000000009",
        origin: "ohne-lage",
        name: "Neu",
        circle: "leer",
        assignment: "none",
    };

    it("🔴 ● platziert und dem Wiki zugewiesen", () => expect(kreisVon(GRATENFELS)).toBe("voll"));
    it("🔴 ◑ platziert, ohne Wiki-Artikel (bisher ◐), auch mit bloßer Adresse", () => {
        expect(kreisVon(KLEIN)).toBe("halb-rechts");
        expect(kreisVon({ ...KLEIN, assignment: "address_only" })).toBe("halb-rechts");
    });
    it("🔴 ◐ nur im Wiki, nicht platziert (bisher ○): Wiki-Eintrag, Stätte, ein Ort ohne Lage mit Artikel", () => {
        expect(kreisVon(TEMPEL)).toBe("halb");
        expect(kreisVon({ ...OHNE_LAGE, assignment: "assigned" })).toBe("halb");
    });
    it("🔴 ○ nicht platziert, ohne Wiki-Artikel: etwa ein neuer Ort ohne Lage", () => {
        expect(kreisVon(OHNE_LAGE)).toBe("leer");
        expect(zeileVon(OHNE_LAGE).unter).toMatchObject({ text: "noch nicht auf der Karte" });
    });
    it("nach „Zustand“ sortiert: ○ vor ◐ vor ◑ vor ●", () => {
        const rang = (row: EditorPlaceRow) => zeileVon(row).rang?.["kreis"] ?? -1;
        expect(rang(OHNE_LAGE)).toBeLessThan(rang(TEMPEL));
        expect(rang(TEMPEL)).toBeLessThan(rang(KLEIN));
        expect(rang(KLEIN)).toBeLessThan(rang(GRATENFELS));
    });
});

describe("eine Zeile der Ortsliste", () => {
    it("🔴 platziert und zugewiesen: ● „✓ Wiki: …“, rechts die Ortsgröße, unten rechts die Bilder", () => {
        expect(zeileVon(GRATENFELS)).toMatchObject({
            key: GRATENFELS.key,
            kreis: "voll",
            rechts: "Stadt",
            unter: { text: "✓ Wiki: Gratenfels", ton: "gut" },
            bilder: 2,
            facetten: {
                karte: "auf",
                typ: "stadt",
                lage: undefined,
                art: undefined,
                quelle: "wiki",
                wappen: "ja",
                bilder: "ja",
            },
        });
    });

    it("🔴 das Wappen links (E19): jede Ortszeile hält den Platz, mit Adresse das Bild, ohne leer", () => {
        const url = `/media/${"a".repeat(64)}.webp`;
        expect(zeileVon({ ...GRATENFELS, coat: url }).bild).toEqual({ url });
        expect(zeileVon(KLEIN).bild).toEqual({ url: undefined });
    });

    it("platziert ohne Artikel: ◑ „⚠ kein Wiki-Artikel“, verborgen steht dabei", () => {
        expect(zeileVon(KLEIN)).toMatchObject({
            kreis: "halb-rechts",
            rechts: "Dorf",
            unter: { text: "⚠ kein Wiki-Artikel · verborgen", ton: "warnung" },
            facetten: { quelle: "keine", wappen: "nein", bilder: "nein" },
        });
        expect(zeileVon(KLEIN)).not.toHaveProperty("bilder");
    });

    it("🔴 eine Stätte steht in „Fehlt“ als ◐ „nur Wiki“ mit ihrer Siedlung, rechts ihre Art, Lage innerorts", () => {
        expect(typVon(TEMPEL)).toBe("staette");
        expect(zeileVon(TEMPEL)).toMatchObject({
            kreis: "halb",
            rechts: "Immanmannschaft",
            unter: { text: "nur Wiki (nicht platziert) · in Gratenfels", ton: "leise" },
            facetten: { karte: "nicht", typ: "staette", lage: "innerorts", art: "Immanmannschaft" },
        });
    });

    it("ein Bauwerk auf der Karte: rechts seine Art, Lage außerorts", () => {
        expect(zeileVon(FESTUNG)).toMatchObject({
            rechts: "Burg",
            facetten: { typ: "gebaeude", lage: "ausserorts", art: "Burg" },
        });
    });

    it("🔴 Legacys Urteil vom Server: „in Khunchom“ bei innerorts, „unklar: Punin“ bei unklar; eine Stadt bekommt keine Lage", () => {
        const wiki = {
            origin: "wiki",
            circle: "leer",
            assignment: "none",
            subtype: "gebaeude",
            kind: "Tempel",
        } as const;
        expect(
            zeileVon({ ...wiki, key: "wiki:a", name: "Webergasse", within: "Khunchom", scope: "innerorts" }),
        ).toMatchObject({
            unter: { text: "nur Wiki (nicht platziert) · in Khunchom" },
            facetten: { lage: "innerorts" },
        });
        expect(
            zeileVon({ ...wiki, key: "wiki:b", name: "Burg Draustein", within: "Abagund", scope: "unklar" }),
        ).toMatchObject({
            unter: { text: "nur Wiki (nicht platziert) · unklar: Abagund" },
            facetten: { lage: "unklar" },
        });
        expect(zeileVon({ ...GRATENFELS, scope: "innerorts", within: "Gareth" }).facetten["lage"]).toBeUndefined();
        expect(wertName("lage", "innerorts")).toBe("innerorts");
        expect(wertName("lage", "unklar")).toBe("unklar");
    });

    it("die Namen der Facettenwerte", () => {
        expect(wertName("typ", "staette")).toBe("Stätte");
        expect(wertName("typ", "grossstadt")).toBe("Großstadt");
        expect(wertName("lage", "ausserorts")).toBe("außerorts");
        expect(wertName("karte", "auf")).toBe("Auf der Karte");
        expect(wertName("karte", "nicht")).toBe("Nicht auf der Karte");
        expect(wertName("wappen", "ja")).toBe("ja");
        expect(wertName("art", "Burg")).toBe("Burg");
    });
});

describe("die Ortsliste im Modell", () => {
    const zeilen = [GRATENFELS, KLEIN, TEMPEL, FESTUNG].map(zeileVon);
    const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "orte") as { facetten: readonly string[] }).facetten;
    const stand = (teil: Partial<ListenStand> = {}): ListenStand => ({
        suche: "",
        filter: new Map(),
        sortierung: "name",
        offen: new Set(),
        ...teil,
    });

    it("🔴 die Facetten kommen aus dem Register (T1.6); „Karte“ zählt wie die Reiter vorher: 3 auf, 1 nicht auf der Karte", () => {
        const ergebnis = berechne(zeilen, stand(), { ...ORTE_OPTIONEN, facetten });
        expect(ergebnis.treffer).toHaveLength(4);
        expect(ergebnis.facettenOptionen["karte"]).toEqual([
            { wert: "auf", zahl: 3 },
            { wert: "nicht", zahl: 1 },
        ]);
        // Mit „Nicht auf der Karte“ bleibt die eine Stätte; die anderen Facetten zählen unter diesem Filter.
        const fehlt = berechne(zeilen, stand({ filter: new Map([["karte", new Set(["nicht"])]]) }), {
            ...ORTE_OPTIONEN,
            facetten,
        });
        expect(fehlt.treffer.map((zeile) => zeile.name)).toEqual(["Dachs Gratenfels"]);
        expect(fehlt.facettenOptionen["karte"]).toEqual([
            { wert: "auf", zahl: 3 },
            { wert: "nicht", zahl: 1 },
        ]);
        // Kontinent kennt der Vertrag noch nicht: keine Werte, die Facette erscheint nicht.
        expect(ergebnis.facettenOptionen["kontinent"]).toEqual([]);
        expect(ergebnis.facettenOptionen["lage"]).toEqual([
            { wert: "ausserorts", zahl: 1 },
            { wert: "innerorts", zahl: 1 },
        ]);
    });

    it("🔴 vorbelegt wie Legacy „außerorts + unklar“: Stätten und Bauwerke innerorts sind ausgeblendet, Städte bleiben, „innerorts“ bleibt wählbar", () => {
        expect(ORTE_OPTIONEN.vorbelegt).toEqual(new Map([["lage", new Set(["ausserorts", "unklar"])]]));
        const ergebnis = berechne(zeilen, stand({ filter: new Map(ORTE_OPTIONEN.vorbelegt) }), {
            ...ORTE_OPTIONEN,
            facetten,
        });
        expect(ergebnis.treffer.map((x) => x.name)).toEqual(["Burg Gratenfels", "Gratenfels", "Klein-Gratenfels"]);
        expect(ergebnis.filterAnzahl).toBe(2);
        expect(ergebnis.facettenOptionen["lage"]).toEqual([
            { wert: "ausserorts", zahl: 1 },
            { wert: "innerorts", zahl: 1 },
        ]);
    });

    it("Sortierung nach Ortsgröße: Stadt, Dorf, Gebäude, Stätte", () => {
        const ergebnis = berechne(zeilen, stand({ sortierung: "groesse" }), { ...ORTE_OPTIONEN, facetten });
        expect(ergebnis.treffer.map((x) => x.name)).toEqual([
            "Gratenfels",
            "Klein-Gratenfels",
            "Burg Gratenfels",
            "Dachs Gratenfels",
        ]);
    });

    it("die Masken: Siedlungen, Bauwerke und Stätten", () => {
        const optionen = { ...ORTE_OPTIONEN, facetten };
        expect(berechne(zeilen, stand({ maske: ORTE_MASKEN.siedlungen }), optionen).treffer.map((x) => x.name)).toEqual(
            ["Gratenfels", "Klein-Gratenfels"],
        );
        expect(berechne(zeilen, stand({ maske: ORTE_MASKEN.bauwerke }), optionen).treffer.map((x) => x.name)).toEqual([
            "Burg Gratenfels",
            "Dachs Gratenfels",
        ]);
    });
});
