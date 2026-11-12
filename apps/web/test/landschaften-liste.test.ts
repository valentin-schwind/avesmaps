import { describe, expect, it } from "vitest";
import { EDITOR_LANDSCAPES_URL, type EditorLandscapePeakRow, type EditorLandscapeRow } from "@avesmaps3d/shared";
import { berechne, type ListenStand } from "../src/editor-liste/liste-modell";
import {
    LANDSCHAFTEN_LEGENDE,
    LANDSCHAFTEN_OPTIONEN,
    artName,
    ebenenMaske,
    ebenenZaehlung,
    gipfelVon,
    gipfelZeileVon,
    kandidatVon,
    kandidatZeileVon,
    LANDSCHAFTEN_MASKEN,
    maskenName,
    ladeLandschaften,
    wertName,
    zeileVon,
} from "../src/landschaftseditor/landschaften-liste";

/**
 * Die Landschaften als Liste (WI-0178 Paket A2, EDIT-0004 §2.2): Kreis in vier Zuständen mit den Wörtern aller Listen, die Ebene der
 * Karte als Maske ohne eigene Reiter (T27 (1)), Facetten Wiki, Darstellung und Art wie Legacy, Unterzeile mit Wiki, Beschriftungen,
 * „nicht auf der Karte“ und Klicksperre. Problemfälle: Die Ebene filtert nicht; die Legende zählt nur drei Zustände; „Name ≠ Artikel“
 * fehlt; eine Art ohne Text in der Tafel bleibt leer statt roh.
 */
const BECKEN: EditorLandscapeRow = {
    id: "a2a2a2a2-0000-4000-8000-000000000001",
    name: "Gratenfelser Becken",
    layer: "topographie",
    type: "tal",
    circle: "voll",
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfelser_Becken", title: "Gratenfelser Becken" },
    areas: 1,
    labels: 1,
    order: 740,
    bounds: [430, 500, 470, 540],
};
const VORGEBIRGE: EditorLandscapeRow = {
    id: "a2a2a2a2-0000-4000-8000-000000000002",
    name: "Vorgebirge des Kosch",
    layer: "topographie",
    type: "huegelland",
    circle: "halb-rechts",
    areas: 3,
    order: 280,
};
const NORDMARKEN: EditorLandscapeRow = {
    id: "a2a2a2a2-0000-4000-8000-000000000003",
    name: "Nordmarken",
    layer: "derographisch",
    circle: "halb",
    wiki: { url: "https://de.wiki-aventurica.de/wiki/Nordmarken", title: "Herzogtum Nordmarken" },
    labels: 2,
    clickLocked: true,
    order: 160,
};
const NICHTS: EditorLandscapeRow = {
    id: "a2a2a2a2-0000-4000-8000-000000000004",
    name: "Wald-0001",
    layer: "vegetation",
    type: "unbekannt-xy",
    circle: "leer",
    order: 0,
};
const ALLE = [BECKEN, VORGEBIRGE, NORDMARKEN, NICHTS].map(zeileVon);
const stand = (teil: Partial<ListenStand> = {}): ListenStand => ({
    suche: "",
    filter: new Map(),
    sortierung: "name",
    offen: new Set(),
    ...teil,
});

describe("Landschaften als Liste (WI-0178 A2)", () => {
    it("🔴 der Kreis kommt vom Server in vier Zuständen; die Legende nennt alle vier mit den Wörtern der Ortsliste", () => {
        expect(ALLE.map((z) => z.kreis)).toEqual(["voll", "halb-rechts", "halb", "leer"]);
        expect(LANDSCHAFTEN_LEGENDE()).toEqual({
            voll: "platziert und dem Wiki zugewiesen",
            halb: "nur im Wiki, nicht platziert",
            "halb-rechts": "platziert, ohne Wiki-Artikel",
            leer: "nicht platziert, ohne Wiki-Artikel",
        });
        const { bilanz } = berechne(ALLE, stand(), LANDSCHAFTEN_OPTIONEN);
        expect([bilanz.voll, bilanz.halb, bilanz["halb-rechts"], bilanz.leer]).toEqual([1, 1, 1, 1]);
    });

    it("🔴 die Ebene der Karte ist die Maske: in einer Ebene nur ihre Landschaften, in „Alle“ alle; kein Reiter, keine Ebenen-Facette", () => {
        const topo = berechne(ALLE, stand({ maske: ebenenMaske("topographie") }), LANDSCHAFTEN_OPTIONEN);
        expect(topo.treffer.map((z) => z.name)).toEqual(["Gratenfelser Becken", "Vorgebirge des Kosch"]);
        expect(berechne(ALLE, stand({ maske: ebenenMaske("alle") }), LANDSCHAFTEN_OPTIONEN).treffer).toHaveLength(4);
        expect(ebenenMaske(undefined)).toBeUndefined();
        expect(LANDSCHAFTEN_OPTIONEN.facetten).toEqual([
            "wiki",
            "darstellung",
            "flaechenart",
            "landmarkenart",
            "stand",
            "sichtbarkeit",
            "gefahrenlage",
        ]);
    });

    it("🔴 Facetten wie Legacy: Wiki mit, ohne und Name ≠ Artikel; Darstellung je nach Fläche und Beschriftung; Art", () => {
        expect(ALLE.map((z) => z.facetten["wiki"])).toEqual(["mit", "ohne", "abweichend", "ohne"]);
        expect(ALLE.map((z) => z.facetten["darstellung"])).toEqual(["beides", "flaeche", "beschriftung", "keine"]);
        expect(wertName("wiki", "abweichend")).toBe("Name ≠ Artikel");
        expect(wertName("darstellung", "flaeche")).toBe("nur Fläche");
        expect(wertName("flaechenart", "tal")).toBe("Tal");
        const ohneWiki = berechne(
            ALLE,
            stand({ filter: new Map([["wiki", new Set(["ohne"])]]) }),
            LANDSCHAFTEN_OPTIONEN,
        );
        expect(ohneWiki.treffer.map((z) => z.name)).toEqual(["Vorgebirge des Kosch", "Wald-0001"]);
    });

    it("die Unterzeile: ✓ Wiki oder ⚠, die Beschriftungen gezählt, ohne Fläche „nicht auf der Karte“, ⊘ für Klicks gesperrt", () => {
        expect(ALLE.map((z) => z.unter)).toEqual([
            { text: "✓ Wiki: Gratenfelser Becken · 1 Beschriftung", ton: "gut" },
            { text: "⚠ kein Wiki-Artikel · ohne Beschriftung", ton: "warnung" },
            {
                text: "✓ Wiki: Herzogtum Nordmarken · 2 Beschriftungen · nicht auf der Karte · ⊘ für Klicks gesperrt",
                ton: "gut",
            },
            { text: "⚠ kein Wiki-Artikel · ohne Beschriftung · nicht auf der Karte", ton: "warnung" },
        ]);
        expect(ALLE.map((z) => z.rechts)).toEqual(["Tal", "Hügelland", "ohne Art", "unbekannt-xy"]);
        expect(artName(undefined)).toBe("ohne Art");
    });

    it("sortiert nach Reihenfolge (kleiner zuerst) und nach Zustand von ○ zu ●", () => {
        expect(
            berechne(ALLE, stand({ sortierung: "reihenfolge" }), LANDSCHAFTEN_OPTIONEN).treffer.map((z) => z.name),
        ).toEqual(["Wald-0001", "Nordmarken", "Vorgebirge des Kosch", "Gratenfelser Becken"]);
        expect(
            berechne(ALLE, stand({ sortierung: "kreis" }), LANDSCHAFTEN_OPTIONEN).treffer.map((z) => z.kreis),
        ).toEqual(["leer", "halb", "halb-rechts", "voll"]);
    });

    it("🔴 lädt mit „no-cache“ (ETag, 304 aus dem Browser) und meldet einen Fehler des Servers mit seinem Code", async () => {
        const anfragen: [string, RequestInit | undefined][] = [];
        const liste = await ladeLandschaften(new AbortController().signal, async (url, init) => {
            anfragen.push([String(url), init]);
            return new Response(JSON.stringify({ rows: [BECKEN] }), { status: 200 });
        });
        expect(liste.rows).toHaveLength(1);
        expect(anfragen[0]?.[0]).toBe(EDITOR_LANDSCAPES_URL);
        expect(anfragen[0]?.[1]?.cache).toBe("no-cache");
        await expect(
            ladeLandschaften(
                new AbortController().signal,
                async () =>
                    new Response(JSON.stringify({ error: { code: "forbidden", message: "Kein Recht" } }), {
                        status: 403,
                    }),
            ),
        ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    });
    it("🔴 T41: eine verborgene Landschaft trägt das durchgestrichene Auge hinter dem Namen, die Unterzeile endet mit „verborgen“", () => {
        const zeile = zeileVon({ ...NORDMARKEN, hidden: true });
        expect(zeile.zeichen).toEqual({ name: "verbergen", titel: "für Besucher verborgen" });
        expect(zeile.unter?.text.endsWith("verborgen")).toBe(true);
        expect(zeile.facetten["sichtbarkeit"]).toBe("verborgen");
        expect(zeileVon(NORDMARKEN).zeichen).toBeUndefined();
        expect(zeileVon(NORDMARKEN).facetten["sichtbarkeit"]).toBe("sichtbar");
    });

    it("🔴 WI-0308: eine gefährliche Fläche nennt ihre Arten in einer roten Zeile; die Facette „Gefahrenlage“ trennt gefährlich und ungefährlich", () => {
        const zeile = zeileVon({ ...VORGEBIRGE, hazards: ["kriminalitaet", "kreaturen"] });
        expect(zeile.gefahr).toEqual({ text: "⚠︎ Kriminalität, Gefährliche Kreaturen und Monster" });
        expect(zeile.facetten["gefahrenlage"]).toBe("gefaehrlich");
        expect(zeileVon(VORGEBIRGE).gefahr).toBeUndefined();
        expect(zeileVon(VORGEBIRGE).facetten["gefahrenlage"]).toBe("ungefaehrlich");
        expect(wertName("gefahrenlage", "gefaehrlich")).toBe("Gefährlich");
        expect(wertName("gefahrenlage", "ungefaehrlich")).toBe("ungefährlich");
        // Landmarken tragen keine Gefahrenlage: Die Facette gilt dort nicht.
        const gipfel: EditorLandscapePeakRow = {
            id: "a2a2a2a2-0000-4000-8000-0000000000f1",
            name: "Rondrakamm",
            subtype: "berggipfel",
            circle: "voll",
            position: [1, 2],
        };
        expect(gipfelZeileVon(gipfel).facetten["gefahrenlage"]).toBeUndefined();
    });

    it("🔴 T41 (2): die Ebenenleiste zählt gesperrte und verborgene der gewählten Ebene, „Alle“ über alle; Abgenommenes und Gelöschtes nicht", () => {
        const zeilen: EditorLandscapeRow[] = [
            BECKEN,
            { ...VORGEBIRGE, clickLocked: true, hidden: true },
            NORDMARKEN,
            { ...NICHTS, hidden: true },
            { ...NICHTS, id: "a2a2a2a2-0000-4000-8000-000000000005", hidden: true, state: "off_map" },
            { ...NICHTS, id: "a2a2a2a2-0000-4000-8000-000000000006", clickLocked: true, state: "retired" },
        ];
        expect(ebenenZaehlung(zeilen, "topographie")).toEqual({ gesperrt: 1, verborgen: 1 });
        expect(ebenenZaehlung(zeilen, "derographisch")).toEqual({ gesperrt: 1, verborgen: 0 });
        expect(ebenenZaehlung(zeilen, "vegetation")).toEqual({ gesperrt: 0, verborgen: 1 });
        expect(ebenenZaehlung(zeilen, "alle")).toEqual({ gesperrt: 2, verborgen: 2 });
        expect(ebenenZaehlung(zeilen, "klima")).toEqual({ gesperrt: 0, verborgen: 0 });
    });

    it("🔴 P3: Gipfel und Vulkane stehen als Zeilen der Topographie mit Art, Höhe und „verborgen“; der Klick öffnet `gipfel:<Kennung>`", () => {
        const zinne: EditorLandscapePeakRow = {
            id: "c8c8c8c8-0000-4000-8000-000000000001",
            name: "Probezinne",
            subtype: "berggipfel",
            height: 3200,
            circle: "halb-rechts",
            position: [530, 515],
        };
        const schlund: EditorLandscapePeakRow = {
            id: "c8c8c8c8-0000-4000-8000-000000000002",
            name: "Probeschlund",
            subtype: "vulkan",
            circle: "voll",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Probeschlund" },
            merkmale: ["verborgen"],
            hidden: true,
            position: [540, 520],
        };
        const z = gipfelZeileVon(zinne);
        const s = gipfelZeileVon(schlund);
        expect(gipfelVon(z.key)).toBe(zinne.id);
        expect(gipfelVon(BECKEN.id)).toBeUndefined();
        expect(z.facetten).toMatchObject({
            ebene: "topographie",
            landmarkenart: "berggipfel",
            stand: "aufDerKarte",
            wiki: "ohne",
        });
        // Keine Fläche, keine Darstellung: Der Filter „Darstellung“ lässt Gipfel durch, die Reihenfolge stellt sie zuletzt.
        expect(z.facetten["darstellung"]).toBeUndefined();
        expect(z.rang?.["reihenfolge"]).toBeUndefined();
        expect([z.rechts, s.rechts]).toEqual(["Berggipfel", "Vulkan"]);
        expect(wertName("landmarkenart", "vulkan")).toBe("Vulkan");
        expect(z.unter).toEqual({ text: "⚠ kein Wiki-Artikel · 3.200 Schritt", ton: "warnung" });
        expect(s.unter?.text).toMatch(/^verborgen · ✓ Wiki: Probeschlund · ohne Höhe /);
        expect(s.zeichen?.name).toBe("verbergen");
        expect(s.facetten["sichtbarkeit"]).toBe("verborgen");
        // In der Topographie stehen sie, in anderen Ebenen nicht.
        expect(ebenenMaske("topographie")!(z)).toBe(true);
        expect(ebenenMaske("vegetation")!(z)).toBe(false);
        const ergebnis = berechne([...ALLE, z, s], stand({ sortierung: "reihenfolge" }), LANDSCHAFTEN_OPTIONEN);
        expect(ergebnis.treffer.slice(-2).map((zeile) => zeile.name)).toEqual(["Probeschlund", "Probezinne"]);
        expect(ergebnis.facettenOptionen["landmarkenart"]?.map((o) => o.wert)).toEqual(
            expect.arrayContaining(["berggipfel", "vulkan"]),
        );
        // Die Flächenart gilt nur an Flächen: Ein Gipfel trägt keine.
        expect(z.facetten["flaechenart"]).toBeUndefined();
    });

    it("🔴 WI-0271 L4: jede Landmarkenart als Zeile; Merkmale in der Unterzeile, Höhe nur bei Berg und Vulkan; „Objekte“ trennt Flächen und Landmarken", () => {
        const hoehle: EditorLandscapePeakRow = {
            id: "c8c8c8c8-0000-4000-8000-000000000003",
            name: "Probehöhle",
            subtype: "hoehle",
            merkmale: ["heilig", "verborgen"],
            circle: "halb-rechts",
            position: [531, 516],
        };
        const z = gipfelZeileVon(hoehle);
        expect(z.rechts).toBe("Höhle");
        expect(z.facetten).toMatchObject({ ebene: "topographie", landmarkenart: "hoehle" });
        expect(z.unter).toEqual({ text: "heilig, verborgen · ⚠ kein Wiki-Artikel", ton: "warnung" });
        expect(wertName("landmarkenart", "riff")).toBe("Riff, Sandbank");
        const zeilen = [...ALLE, z];
        expect(zeilen.filter(LANDSCHAFTEN_MASKEN.landmarken).map((zeile) => zeile.name)).toEqual(["Probehöhle"]);
        expect(zeilen.filter(LANDSCHAFTEN_MASKEN.flaechen)).toHaveLength(ALLE.length);
        expect(maskenName("landmarken")).toBe("Landmarken");
    });

    it("🔴 WI-0271 L7: ein Wiki-Kandidat ist eine ◐-Zeile der Topographie mit Art und Region; unterdrückt steht er unter „Unterdrückt“, das zu Beginn aus ist", () => {
        const kandidat = {
            id: "b7000000-0000-4000-8000-000000000001",
            titel: "Drachenhöhle",
            name: "Drachenhöhle",
            art: "hoehle" as const,
            region: "Kosch",
            wikiUrl: "https://de.wiki-aventurica.de/wiki/Drachenh%C3%B6hle",
            revision: 1,
        };
        const z = kandidatZeileVon(kandidat);
        expect(kandidatVon(z.key)).toBe(kandidat.id);
        expect(gipfelVon(z.key)).toBeUndefined();
        expect(z.kreis).toBe("halb");
        expect(z.rechts).toBe("Höhle");
        expect(z.facetten).toMatchObject({ ebene: "topographie", landmarkenart: "hoehle", stand: "nichtAufDerKarte" });
        expect(z.unter).toEqual({ text: "nur Wiki (nicht platziert) · Kosch", ton: "warnung" });
        const zeilen = [...ALLE, z];
        expect(zeilen.filter(LANDSCHAFTEN_MASKEN.landmarken).map((zeile) => zeile.name)).toEqual(["Drachenhöhle"]);
        expect(zeilen.filter(LANDSCHAFTEN_MASKEN.flaechen)).toHaveLength(ALLE.length);

        const weg = kandidatZeileVon({ ...kandidat, unterdrueckt: true });
        expect(weg.facetten["stand"]).toBe("unterdrueckt");
        expect(weg.unter).toEqual({ text: "Unterdrückt", ton: "warnung" });
        expect(wertName("stand", "unterdrueckt")).toBe("Unterdrückt");
        // Zu Beginn zeigt die Liste nur „Auf der Karte“ und „Nicht auf der Karte“: Der unterdrückte steht nicht da.
        const stand = LANDSCHAFTEN_OPTIONEN.vorbelegt?.get("stand");
        expect(stand?.has("nichtAufDerKarte")).toBe(true);
        expect(stand?.has("unterdrueckt")).toBe(false);
    });
});
