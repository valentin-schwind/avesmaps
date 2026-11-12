import { describe, expect, it } from "vitest";
import type { CitymapEntry, LiteratureEntry } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import {
    knownYear,
    overlapsYears,
    splits,
    splittingValues,
    suchtreffer,
    yearFacet,
    yearInput,
} from "../src/catalog/catalog-filter-model.ts";
import { hasFreeWay, linkLinesOf } from "../src/catalog/catalog-link-model.ts";
import {
    bandLabel,
    citymapFacets,
    citymapFilterGroups,
    citymapFilterReduce,
    citymapMatches,
    citymapRowOf,
    citymapRowsOf,
    emptyCitymapFilter,
    factsOf,
    suffixOf,
    validityLabel,
} from "../src/catalog/citymap-window-model.ts";
import {
    emptyLiteratureFilter,
    factLine,
    literatureFacets,
    literatureFilterGroups,
    literatureFilterReduce,
    literatureMatches,
    metaLine,
    openWorks,
    sortWorks,
    workFacts,
    workRowOf,
    workRowsOf,
} from "../src/catalog/literature-window-model.ts";
import { GARETH_ID, REVISION } from "./panel-fixtures.ts";

/**
 * Die Fenster „Kartensammlung von …“ und „Literatur zu …“ als reines Modell (WI-0118): Filter erscheinen nur, wenn sie die Menge teilen,
 * „Spoiler“ ist kein Filter, die Sortierung folgt Legacy, die Beschriftung des vergrößerten Eintrags nennt ALLES, was der Bestand führt -
 * und nichts, was niemand erfasst hat.
 */

const GARETH = { kind: "place" as const, id: GARETH_ID };
let counter = 0;
const id = (): string => `80000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`;

const map = (entry: Partial<CitymapEntry> = {}): CitymapEntry => ({
    id: id(),
    title: "Stadtplan von Gareth",
    ...entry,
});
const work = (entry: Partial<LiteratureEntry> = {}): LiteratureEntry => ({
    id: id(),
    title: "Die Verschwörung von Gareth",
    productType: "gruppenabenteuer",
    role: "start",
    ...entry,
});

describe("die Links einer Zeile", () => {
    it("🔴 „(kostenpflichtig)“ gibt es nur bei einem bekannten JA; unbekannt bleibt still", () => {
        const lines = linkLinesOf([
            { label: "F-Shop", url: "https://www.f-shop.de/x", paid: true },
            { label: "Wiki Aventurica", url: "https://de.wiki-aventurica.de/wiki/X", paid: false },
            { label: "deviantArt", url: "https://www.deviantart.com/x" },
        ]);
        expect(lines.map((line) => line.paid)).toEqual([true, false, false]);
        expect(lines.map((line) => line.label)).toEqual(["F-Shop", "Wiki Aventurica", "deviantArt"]);
    });

    it("🔴 „kostenlos“ fragt den freien WEG, nicht die Karte: Laden UND Wiki-Seite ist frei erreichbar", () => {
        expect(
            hasFreeWay([
                { label: "F-Shop", url: "https://www.f-shop.de/x", paid: true },
                { label: "Wiki", url: "https://example.org/w", paid: false },
            ]),
        ).toBe(true);
        expect(hasFreeWay([{ label: "F-Shop", url: "https://www.f-shop.de/x", paid: true }])).toBe(false);
        // Unbekannt ist kein Beleg für frei.
        expect(hasFreeWay([{ label: "Karte", url: "https://example.org/w" }])).toBe(false);
        expect(hasFreeWay(undefined)).toBe(false);
    });
});

describe("die Teilungsregel (Legacy Spec §4.1)", () => {
    it("🔴 ein Wert teilt die Menge nur, wenn mindestens eine Zeile ihn trägt und mindestens eine nicht", () => {
        const rows = [{ g: ["a", "b"] }, { g: ["a"] }, { g: [] }];
        expect(splittingValues(rows, (row) => row.g).sort()).toEqual(["a", "b"]);
        // Alle tragen „a“ - dann schränkt es nichts ein.
        expect(splittingValues([{ g: ["a"] }, { g: ["a", "b"] }], (row) => row.g)).toEqual(["b"]);
        expect(splittingValues([{ g: ["a"] }], (row) => row.g)).toEqual([]);
        expect(splits([1, 2, 3], (n) => n > 1)).toBe(true);
        expect(splits([1, 2, 3], (n) => n > 0)).toBe(false);
        expect(splits([1, 2, 3], (n) => n > 5)).toBe(false);
        expect(splits([], () => true)).toBe(false);
    });

    it("der Zeitraum teilt erst bei zwei Einträgen MIT Jahr und unterschiedlichen Jahren; 9999 ist keine Grenze", () => {
        expect(
            yearFacet([
                { from: 1027, to: 1045 },
                { from: null, to: null },
            ]).shown,
        ).toBe(false);
        expect(
            yearFacet([
                { from: 1027, to: 1027 },
                { from: 1027, to: 1027 },
            ]).shown,
        ).toBe(false);
        expect(
            yearFacet([
                { from: 1027, to: 9999 },
                { from: null, to: 1045 },
            ]),
        ).toEqual({
            shown: true,
            min: 1027,
            max: 1045,
        });
        expect(knownYear(9999)).toBeNull();
        expect(knownYear(0)).toBeNull();
        expect(knownYear(1027)).toBe(1027);
    });

    it("🪤 ein Eintrag überschneidet den Zeitraum, wenn er irgendwann in der Spanne galt; die fehlende Seite ist unbegrenzt", () => {
        expect(overlapsYears({ from: 1027, to: 1045 }, 1040, 1050)).toBe(true);
        expect(overlapsYears({ from: 1027, to: 1045 }, 1046, null)).toBe(false);
        expect(overlapsYears({ from: 1030, to: null }, 1100, 1200)).toBe(true);
        expect(overlapsYears({ from: null, to: 1038 }, null, 1000)).toBe(true);
        expect(overlapsYears({ from: null, to: 1038 }, 1039, null)).toBe(false);
        // 9999 ist das offene Ende.
        expect(overlapsYears({ from: 1030, to: 9999 }, 1100, 1200)).toBe(true);
        // Ohne jede Angabe passt ein Eintrag auf keinen Zeitraum - aber auf „alle“.
        expect(overlapsYears({ from: null, to: null }, 1000, null)).toBe(false);
        expect(overlapsYears({ from: null, to: null }, null, null)).toBe(true);
    });

    it("ein leeres oder unbrauchbares Zahlenfeld ist keine Grenze", () => {
        expect(yearInput("")).toBeNull();
        expect(yearInput("abc")).toBeNull();
        expect(yearInput("-5")).toBeNull();
        expect(yearInput("1027")).toBe(1027);
        expect(yearInput("1027.9")).toBe(1027);
    });
});

describe("die Zeile der Kartensammlung (Legacy `cityMapBandLabel`, `cityMapRowSuffix`)", () => {
    it("🔴 der Band ist die erste Quelle; sonst die BALANCIERENDE Klammer des Titels; sonst der Titel", () => {
        expect(bandLabel({ title: "Stadtplan von Gareth (x)", band: "Herz des Reiches" })).toBe("Herz des Reiches");
        expect(bandLabel({ title: "Stadtplan von Gareth (Herz des Reiches)" })).toBe("Herz des Reiches");
        // Die erste Klammer lieferte hier „DSA3“.
        expect(bandLabel({ title: "Umgebungskarte von Gareth (Abenteuer Basis-Spiel (DSA3))" })).toBe(
            "Abenteuer Basis-Spiel (DSA3)",
        );
        expect(bandLabel({ title: "Gareth-Karte aus der Gareth-Box" })).toBe("Gareth-Karte aus der Gareth-Box");
        expect(bandLabel({ title: "Nur Klammer ()" })).toBe("Nur Klammer ()");
    });

    it("Typ und Farbe stehen grau dahinter, mehrere Typen mit „&“; Unbekanntes fehlt", () => {
        setLocale("de");
        expect(suffixOf({ types: ["ortsplan", "stadtplan"], colorMode: "farbig" })).toBe(
            "Ortsplan & Stadtplan · Farbig",
        );
        expect(suffixOf({ colorMode: "graustufen" })).toBe("Schwarzweiß bzw. Graustufen");
        expect(suffixOf({})).toBe("");
        // Ein Schlüssel, den die Tafel nicht kennt, bleibt, wie er ist.
        expect(suffixOf({ types: ["etwas-neues"] })).toBe("etwas-neues");
    });

    it("🔴 der Zeitraum: „von–bis“, „seit“, „bis“; 9999 liest sich „seit“, nie als Jahreszahl", () => {
        setLocale("de");
        expect(validityLabel({ validFrom: 1027, validTo: 1045 })).toBe("1027–1045 BF");
        expect(validityLabel({ validFrom: 1027 })).toBe("seit 1027 BF");
        expect(validityLabel({ validFrom: 1027, validTo: 9999 })).toBe("seit 1027 BF");
        expect(validityLabel({ validTo: 1038 })).toBe("bis 1038 BF");
        expect(validityLabel({ validTo: 9999 })).toBe("");
        expect(validityLabel({})).toBe("");
        setLocale("en");
        expect(validityLabel({ validFrom: 1027 })).toBe("since 1027 BF");
        setLocale("de");
    });

    it("🔴 der vergrößerte Eintrag nennt ALLES, was der Bestand führt - auch ein ausdrückliches NEIN", () => {
        setLocale("de");
        const facts = factsOf(
            map({
                band: "Gareth-Box",
                art: "derographisch",
                types: ["stadtplan"],
                colorMode: "farbig",
                official: true,
                labeled: false,
                multilevel: false,
                hasScale: true,
                validFrom: 1027,
                validTo: 1045,
                format: "A2",
                author: "Elwe von Gareth",
                publisher: "Ulisses",
                widthPx: 4635,
                heightPx: 3278,
                note: "Maßstab: 1:5.000",
            }),
        );
        expect(facts.map((row) => [row.label, row.value.kind === "text" ? row.value.text : ""])).toEqual([
            ["Band", "Gareth-Box"],
            ["Art", "Derographisch"],
            ["Typ", "Stadtplan"],
            ["Farbe", "Farbig"],
            ["Offiziell", "ja"],
            ["Beschriftet", "nein"],
            ["Mehrstöckig", "nein"],
            ["Maßstab", "ja"],
            ["Zeitraum", "1027–1045 BF"],
            ["Format", "A2"],
            ["Zeichner", "Elwe von Gareth"],
            ["Verlag", "Ulisses"],
            ["Auflösung", "4.635 × 3.278 px"],
            ["Notiz", "Maßstab: 1:5.000"],
        ]);
    });

    it("🔴 mehrere Publikationen stehen als „Bände“, alle in der Folge des Eintrags; eine einzige bleibt „Band“ (WI-0287)", () => {
        setLocale("de");
        const mehrere = factsOf(
            map({ band: "Reich des Horas", bands: ["Reich des Horas", "Geographia Aventurica"], art: "derographisch" }),
        );
        expect(mehrere.map((row) => [row.key, row.label, row.value.kind === "text" ? row.value.text : ""])).toEqual([
            ["bands", "Bände", "Reich des Horas · Geographia Aventurica"],
            ["art", "Art", "Derographisch"],
        ]);
        const eine = factsOf(map({ band: "Reich des Horas", bands: ["Reich des Horas"] }));
        expect(eine.map((row) => [row.key, row.label])).toEqual([["band", "Band"]]);
        // Ein älterer Server ohne `bands`: wie bisher.
        expect(factsOf(map({ band: "Gareth-Box" })).map((row) => row.label)).toEqual(["Band"]);
        setLocale("en");
        expect(factsOf(map({ band: "A", bands: ["A", "B"] }))[0]?.label).toBe("Sources");
        setLocale("de");
    });

    it("🔴 UNBEKANNT FEHLT: Eine Karte ohne Angaben hat keine einzige Zeile - nie „unbekannt“, nie „nein“", () => {
        expect(factsOf(map())).toEqual([]);
        const rows = factsOf(map({ official: false }));
        expect(rows.map((row) => row.key)).toEqual(["official"]);
    });

    it("die Zeilen stehen nach Typ, dann nach Band (Legacy): Farbe und Schwarzweiß als Paar", () => {
        setLocale("de");
        const rows = citymapRowsOf({
            subject: GARETH,
            revision: REVISION,
            maps: [
                map({ title: "C", band: "Zeta", types: ["stadtplan"] }),
                map({ title: "A", band: "Beta", types: ["ortsplan"] }),
                map({ title: "B", band: "Alpha", types: ["stadtplan"] }),
                map({ title: "D", band: "Aaa" }),
            ],
        });
        // Ohne Typ steht zuerst (leerer Schlüssel), dann „ortsplan“, dann „stadtplan“ nach Band.
        expect(rows.map((row) => row.title)).toEqual(["D", "A", "B", "C"]);
    });

    it("die Zeile trägt, was die Filter lesen: Farbe nur bei „farbig“, offiziell nur bei einem Ja, ein freier Weg nur bei `paid: false`", () => {
        const row = citymapRowOf(
            map({
                colorMode: "braun",
                official: false,
                links: [{ label: "F-Shop", url: "https://www.f-shop.de/x", paid: true }],
            }),
        );
        expect([row.colour, row.official, row.free]).toEqual([false, false, false]);
        const open = citymapRowOf(
            map({
                colorMode: "farbig",
                official: true,
                links: [{ label: "Wiki", url: "https://example.org/w", paid: false }],
            }),
        );
        expect([open.colour, open.official, open.free]).toEqual([true, true, true]);
        expect(open.bestLink).toBe("https://example.org/w");
    });

    it("🔴 WI-0287 Stufe 2: ab zwei Versionen je ein Reiter mit Bezeichnung (sonst „Version n“) und dem Vollbild, wo es öffentlich ist; eine allein bleibt `full`", () => {
        const bild = {
            id: id(),
            role: "map_full" as const,
            url: "/media/b.webp",
            width: 800,
            height: 600,
            mimeType: "image/webp",
        };
        const row = citymapRowOf(
            map({ full: bild, fulls: [{ label: "Für Spieler", view: bild }, {}, { label: "  " }] }),
        );
        expect(row.versions).toEqual([
            { name: "Für Spieler", full: { url: "/media/b.webp", width: 800, height: 600 } },
            { name: "Version 2", full: undefined },
            { name: "Version 3", full: undefined },
        ]);
        expect(row.full).toEqual({ url: "/media/b.webp", width: 800, height: 600 });
        const eine = citymapRowOf(map({ full: bild, fulls: [{ label: "Spielerversion", view: bild }] }));
        expect(eine.versions).toEqual([]);
        expect(eine.full?.url).toBe("/media/b.webp");
        expect(citymapRowOf(map()).versions).toEqual([]);
    });
});

describe("🔴 die Filter der Kartensammlung erscheinen nur, wenn sie die Liste teilen", () => {
    const rowsOf = (entries: CitymapEntry[]) => entries.map(citymapRowOf);
    const ids = (filter = emptyCitymapFilter(), entries: CitymapEntry[]): string[] =>
        rowsOf(entries)
            .filter((row) => citymapMatches(row, filter))
            .map((row) => row.title);

    it("eine Karte allein: keine Leiste (168 von 245 Orten haben genau eine)", () => {
        setLocale("de");
        const facets = citymapFacets(rowsOf([map({ colorMode: "farbig", official: true })]));
        expect(citymapFilterGroups(facets, emptyCitymapFilter())).toEqual([]);
    });

    it("gemischte Farbe, Offiziell, freier Weg und Zeitraum erscheinen - in Legacys Reihenfolge, mit Trenner vor den geteilten", () => {
        setLocale("de");
        const entries = [
            map({
                title: "A",
                colorMode: "farbig",
                official: true,
                validFrom: 1027,
                validTo: 1038,
                links: [{ label: "W", url: "https://example.org/a", paid: false }],
            }),
            map({
                title: "B",
                colorMode: "graustufen",
                official: false,
                validFrom: 1040,
                spoiler: true,
                links: [{ label: "F", url: "https://www.f-shop.de/b", paid: true }],
            }),
        ];
        const groups = citymapFilterGroups(citymapFacets(rowsOf(entries)), emptyCitymapFilter());
        expect(groups.map((group) => (group.kind === "divider" ? "|" : group.id))).toEqual([
            "colour",
            "free",
            "years",
            "|",
            "official",
            "spoiler",
        ]);
    });

    it("🔴 „Spoiler“ ist kein Filter: Er steht schon bei EINEM verdeckten Eintrag, auch wenn alle verdeckt sind, und blendet nichts aus", () => {
        setLocale("de");
        const alleVerdeckt = rowsOf([map({ spoiler: true }), map({ spoiler: true })]);
        const groups = citymapFilterGroups(citymapFacets(alleVerdeckt), emptyCitymapFilter());
        expect(groups.map((group) => (group.kind === "divider" ? "|" : group.id))).toEqual(["spoiler"]);
        const aufgedeckt = citymapFilterReduce(emptyCitymapFilter(), { kind: "toggle", id: "spoiler" });
        expect(aufgedeckt.spoilers).toBe(true);
        expect(alleVerdeckt.every((row) => citymapMatches(row, aufgedeckt))).toBe(true);
    });

    it("jeder Filter schränkt ein, und unbekannt passt auf keinen (nur auf „alle“)", () => {
        const entries = [
            map({ title: "farbig", colorMode: "farbig", official: true }),
            map({ title: "grau", colorMode: "graustufen", official: false }),
            map({ title: "unbekannt" }),
        ];
        const colour = citymapFilterReduce(emptyCitymapFilter(), { kind: "toggle", id: "colour" });
        expect(ids(colour, entries)).toEqual(["farbig"]);
        const official = citymapFilterReduce(emptyCitymapFilter(), { kind: "toggle", id: "official" });
        expect(ids(official, entries)).toEqual(["farbig"]);
        expect(ids(emptyCitymapFilter(), entries)).toEqual(["farbig", "grau", "unbekannt"]);
    });

    it("der Zeitraum schränkt nach Überschneidung ein; ein Eintrag ohne Jahr passt auf keinen Zeitraum", () => {
        const entries = [
            map({ title: "früh", validFrom: 1000, validTo: 1020 }),
            map({ title: "spät", validFrom: 1040, validTo: 1060 }),
            map({ title: "undatiert" }),
        ];
        let filter = citymapFilterReduce(emptyCitymapFilter(), {
            kind: "year",
            id: "years",
            edge: "from",
            value: 1030,
        });
        expect(ids(filter, entries)).toEqual(["spät"]);
        filter = citymapFilterReduce(filter, { kind: "year", id: "years", edge: "to", value: 1035 });
        expect(ids(filter, entries)).toEqual([]);
        filter = citymapFilterReduce(filter, { kind: "year", id: "years", edge: "from", value: null });
        expect(ids(filter, entries)).toEqual(["früh"]);
    });

    it("🔴 „kostenlos“: ein freier Weg genügt; ein reiner Laden fällt heraus, ein Unbekannter auch", () => {
        const entries = [
            map({
                title: "Laden und Wiki",
                links: [
                    { label: "F", url: "https://www.f-shop.de/a", paid: true },
                    { label: "W", url: "https://example.org/a", paid: false },
                ],
            }),
            map({ title: "nur Laden", links: [{ label: "F", url: "https://www.f-shop.de/b", paid: true }] }),
            map({ title: "unbekannt", links: [{ label: "K", url: "https://example.org/c" }] }),
        ];
        const free = citymapFilterReduce(emptyCitymapFilter(), { kind: "toggle", id: "free" });
        expect(ids(free, entries)).toEqual(["Laden und Wiki"]);
    });
});

describe("die Zeile der Literatur (Legacy `buildGameLiteratureRowMarkup`)", () => {
    it("Metazeile „Edition · Jahr · Werkart“; der vergrößerte Eintrag nennt alles, was der Bestand führt", () => {
        setLocale("de");
        const entry = work({
            edition: "DSA4",
            year: "1021 BF",
            productType: "regionalspielhilfe",
            containedIn: "Aventurische Anthologie",
            genres: ["Stadtabenteuer", "Kriegsszenario"],
            complexity: "mittel",
            role: "covers",
        });
        expect(metaLine(entry)).toBe("DSA4 · 1021 BF · Regionalspielhilfe");
        expect(workFacts(entry).map((row) => [row.label, row.value.kind === "text" ? row.value.text : ""])).toEqual([
            ["Edition", "DSA4"],
            ["Jahr", "1021 BF"],
            ["Werkart", "Regionalspielhilfe"],
            ["Enthalten in", "Aventurische Anthologie"],
            ["Schlagworte", "Stadtabenteuer, Kriegsszenario"],
            ["Schwierigkeit", "mittel"],
            ["Rolle", "beschreibt"],
        ]);
    });

    it("die Rolle `play` ist der Spoiler und zählt in der Überschrift nicht mit", () => {
        const rows = workRowsOf({
            subject: GARETH,
            revision: REVISION,
            works: [work({ role: "start" }), work({ role: "play" }), work({ role: "covers" })],
        });
        expect(rows.map((row) => row.spoiler)).toEqual([false, true, false]);
        expect(openWorks(rows)).toBe(2);
    });

    it("🔴 ein Werk ohne Angaben hat nur Art und Rolle in der Liste - nichts Erfundenes", () => {
        setLocale("de");
        const row = workRowOf(work());
        expect(row.detail.map((fact) => fact.key)).toEqual(["type", "role"]);
        expect(row.meta).toBe("Gruppenabenteuer");
        expect([row.facts, row.containedIn]).toEqual(["", ""]);
    });
});

describe("🔴 die Filter der Literatur erscheinen nur, wenn sie die Liste teilen", () => {
    const rows = (entries: LiteratureEntry[]) => entries.map(workRowOf);

    it("Art als Chips, DSA-Version, Schwierigkeit und Genre erscheinen bei gemischter Liste - Genre am Komma getrennt", () => {
        setLocale("de");
        const list = rows([
            work({
                productType: "gruppenabenteuer",
                edition: "DSA4",
                complexity: "mittel",
                genres: ["Stadtabenteuer", "Kriegsszenario"],
            }),
            work({ productType: "roman", edition: "DSA5", complexity: "niedrig", genres: ["Stadtabenteuer"] }),
        ]);
        const facets = literatureFacets(list);
        expect(facets.types).toEqual(["Gruppenabenteuer", "Roman"]);
        expect(facets.editions).toEqual(["DSA4", "DSA5"]);
        expect(facets.complexities).toEqual(["mittel", "niedrig"]);
        // „Stadtabenteuer“ tragen ALLE: Es schränkt nichts ein und steht nicht zur Wahl; „Kriegsszenario“ teilt.
        expect(facets.genres).toEqual(["Kriegsszenario"]);
        const groups = literatureFilterGroups(facets, emptyLiteratureFilter(), list.length);
        expect(groups.map((group) => (group.kind === "divider" ? "|" : group.id))).toEqual([
            "type",
            "edition",
            "complexity",
            "genre",
            "sort",
        ]);
    });

    it("eine einheitliche Liste zeigt keinen dieser Filter; „offiziell“ erscheint nie, wo alle offiziell sind", () => {
        const list = rows([
            work({ productType: "roman", edition: "DSA5", official: true }),
            work({ productType: "roman", edition: "DSA5", official: true }),
        ]);
        const facets = literatureFacets(list);
        expect(literatureFilterGroups(facets, emptyLiteratureFilter(), list.length).map((group) => group.kind)).toEqual(
            ["sort"],
        );
    });

    it("🔴 ein einzelnes Werk braucht weder Filter noch Sortierung", () => {
        const list = rows([work({ role: "start" })]);
        expect(literatureFilterGroups(literatureFacets(list), emptyLiteratureFilter(), list.length)).toEqual([]);
    });

    it("🔴 Genre vergleicht EIN Schlagwort, Art ist eine Mehrfachauswahl, Version und Schwierigkeit sind Einzelwahl", () => {
        const list = rows([
            work({ title: "A", productType: "roman", edition: "DSA5", genres: ["Stadt", "Krieg"], complexity: "hoch" }),
            work({
                title: "B",
                productType: "gruppenabenteuer",
                edition: "DSA4",
                genres: ["Stadt"],
                complexity: "mittel",
            }),
            work({ title: "C", productType: "spielhilfe", edition: "DSA5" }),
        ]);
        const titles = (filter = emptyLiteratureFilter()): string[] =>
            list.filter((row) => literatureMatches(row, filter)).map((row) => row.title);
        expect(
            titles(literatureFilterReduce(emptyLiteratureFilter(), { kind: "select", id: "genre", value: "Krieg" })),
        ).toEqual(["A"]);
        expect(
            titles(literatureFilterReduce(emptyLiteratureFilter(), { kind: "select", id: "genre", value: "Stadt" })),
        ).toEqual(["A", "B"]);
        let filter = literatureFilterReduce(emptyLiteratureFilter(), { kind: "chip", id: "type", value: "Roman" });
        filter = literatureFilterReduce(filter, { kind: "chip", id: "type", value: "Spielhilfe" });
        expect(titles(filter)).toEqual(["A", "C"]);
        filter = literatureFilterReduce(filter, { kind: "chip", id: "type", value: "Roman" });
        expect(titles(filter)).toEqual(["C"]);
        expect(
            titles(literatureFilterReduce(emptyLiteratureFilter(), { kind: "select", id: "edition", value: "DSA4" })),
        ).toEqual(["B"]);
        expect(
            titles(
                literatureFilterReduce(emptyLiteratureFilter(), { kind: "select", id: "complexity", value: "hoch" }),
            ),
        ).toEqual(["A"]);
    });

    it("der Zeitraum rechnet mit dem Jahr als Zahl; ein Werk ohne Jahr passt auf keinen Zeitraum", () => {
        const list = rows([
            work({ title: "A", bfYear: 1021 }),
            work({ title: "B", bfYear: 1044 }),
            work({ title: "C" }),
        ]);
        expect(literatureFacets(list).years).toEqual({ shown: true, min: 1021, max: 1044 });
        const filter = literatureFilterReduce(emptyLiteratureFilter(), {
            kind: "year",
            id: "years",
            edge: "from",
            value: 1030,
        });
        expect(list.filter((row) => literatureMatches(row, filter)).map((row) => row.title)).toEqual(["B"]);
    });

    it("🔴 „Spoiler“ erscheint, sobald ein Werk verdeckt ist, und ist kein Filter", () => {
        setLocale("de");
        const list = rows([work({ role: "play" })]);
        const groups = literatureFilterGroups(literatureFacets(list), emptyLiteratureFilter(), list.length);
        expect(groups.map((group) => (group.kind === "divider" ? "|" : group.id))).toEqual(["spoiler"]);
        const filter = literatureFilterReduce(emptyLiteratureFilter(), { kind: "toggle", id: "spoiler" });
        expect(filter.spoilers).toBe(true);
        expect(list.every((row) => literatureMatches(row, filter))).toBe(true);
    });
});

describe("die Sortierung der Literatur (Legacy `.avesmaps-adv__sort`)", () => {
    const list = [
        work({ title: "Beta", edition: "DSA4", productType: "roman", bfYear: 1000 }),
        work({ title: "Alpha", edition: "DSA5", productType: "spielhilfe" }),
        work({ title: "Zeta", edition: "DSA4", productType: "gruppenabenteuer", bfYear: 1021 }),
        work({ title: "Gamma", productType: "gruppenabenteuer", role: "play" }),
    ].map(workRowOf);
    const titles = (mode: Parameters<typeof sortWorks>[1]): string[] => sortWorks(list, mode).map((row) => row.title);

    it("neueste zuerst: Edition absteigend, dann Jahr absteigend, dann Titel - die Rolle geht nicht ein", () => {
        expect(titles("newest")).toEqual(["Alpha", "Zeta", "Beta", "Gamma"]);
    });

    it("nach Edition: DSA5 vor DSA4, ohne Edition zuletzt, bei Gleichstand der Titel", () => {
        expect(titles("edition")).toEqual(["Alpha", "Beta", "Zeta", "Gamma"]);
    });

    it("alphabetisch und nach Art (dann Jahr absteigend, dann Titel)", () => {
        expect(titles("alpha")).toEqual(["Alpha", "Beta", "Gamma", "Zeta"]);
        expect(titles("type")).toEqual(["Zeta", "Gamma", "Beta", "Alpha"]);
    });

    it("sortiert eine Kopie: Die Liste des Servers bleibt, wie sie ist", () => {
        const before = list.map((row) => row.title);
        sortWorks(list, "alpha");
        expect(list.map((row) => row.title)).toEqual(before);
    });

    it("🪤 die Leiste kennt unbekannte Sortierwünsche nicht: Sie bleiben ohne Wirkung", () => {
        expect(
            literatureFilterReduce(emptyLiteratureFilter(), { kind: "sort", id: "sort", value: "zufall" }).sort,
        ).toBe("newest");
        expect(literatureFilterReduce(emptyLiteratureFilter(), { kind: "sort", id: "sort", value: "alpha" }).sort).toBe(
            "alpha",
        );
    });
});

describe("🔴 die Schwierigkeit: Schreibweisen zusammen, Wiki-Auszeichnung weg (Befund 2026-10-11)", () => {
    // Die Werte sind Freitext aus der Infobox von Wiki Aventurica (KompM, KompSp), ungeglättet wie in Legacy
    // (publication-parsing.php:531-532 an avesmaps@13d0183ab): „mittel“ 379-mal neben „Mittel“ 6-mal, und
    // „Hoch <small>(lt. Klappentext)</small>“ stand wörtlich mit Tags in Auswahl und Faktenzeile.
    const rows = (entries: LiteratureEntry[]) => entries.map(workRowOf);

    it("🔴 Schreibweisen, die sich nur in Groß- und Kleinschreibung unterscheiden, sind EIN Eintrag, in der häufigsten Form", () => {
        setLocale("de");
        const list = rows([
            work({ complexity: "mittel" }),
            work({ complexity: "mittel" }),
            work({ complexity: "Mittel" }),
            work({ complexity: "hoch" }),
        ]);
        expect(literatureFacets(list).complexities).toEqual(["hoch", "mittel"]);
        const filter = { ...emptyLiteratureFilter(), complexity: "mittel" };
        expect(list.filter((row) => literatureMatches(row, filter))).toHaveLength(3);
    });

    it("🔴 die Wiki-Auszeichnung fällt beim Anzeigen weg: in Auswahl, Faktenzeile und vergrößertem Eintrag", () => {
        setLocale("de");
        const list = rows([
            work({ complexity: "Hoch <small>(lt. Klappentext)</small>" }),
            work({ complexity: "niedrig" }),
        ]);
        expect(literatureFacets(list).complexities).toEqual(["Hoch (lt. Klappentext)", "niedrig"]);
        expect(list[0]?.facts).toBe("Hoch (lt. Klappentext)");
        expect(list[0]?.detail.find((fact) => fact.key === "complexity")?.value).toEqual({
            kind: "text",
            text: "Hoch (lt. Klappentext)",
        });
        expect(factLine({ complexity: "Experte <small>(lt. Klappentext)</small>" })).toBe("Experte (lt. Klappentext)");
    });
});

describe("🔴 die Freitextsuche der Kataloge (Betreiber 2026-10-11: „idealerweise ist auch immer eine suchmaske nach freitext“)", () => {
    it("🔴 jedes Wort muss vorkommen, gleich in welcher Schreibweise; leer trifft alles", () => {
        expect(suchtreffer("Das Tal der Finsternis Jahr des Greifen", "tal GREIF")).toBe(true);
        expect(suchtreffer("Das Tal der Finsternis", "tal gareth")).toBe(false);
        expect(suchtreffer("Das Tal der Finsternis", "  ")).toBe(true);
    });

    it("🔴 gesucht wird in Titel und Reihe (Literatur), in Titel, Zeichner und Verlag (Kartensammlung)", () => {
        const werk = workRowOf(work({ title: "Tal der Finsternis", containedIn: "Jahr des Greifen" }));
        expect(suchtreffer(werk.suchtext, "greifen")).toBe(true);
        const karte = citymapRowOf(map({ title: "Gareth", author: "Alrik Zeichner", publisher: "Ulisses" }));
        expect(suchtreffer(karte.suchtext, "alrik")).toBe(true);
        expect(suchtreffer(karte.suchtext, "ulisses")).toBe(true);
    });
});
