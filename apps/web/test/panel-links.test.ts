import { afterEach, describe, expect, it } from "vitest";
import { subjectKey, type SubjectRef } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { PanelModel, RowModel, RowValue } from "../src/info-panel/panel-types.ts";
import { env, kraftlinie, punkt, reichsstrasse, shown, waldwildnis } from "./panel-fixtures.ts";
import {
    AVENTURIEN,
    GEMAESSIGT,
    GREIFENPASS,
    HERZ,
    KOSCHBERGE,
    KOSCHBERGE_GEBIRGE,
    MITTELAVENTURIEN,
    NORDMARKEN,
    RAULSMARK,
    garethMitVerweisen,
    klimaband,
    koschgebirge,
    landschaftMitVerweisen,
    wegMitVerweisen,
} from "./panel-link-fixtures.ts";

/**
 * „Was auf der Karte ist, ist anklickbar“ (Betreiber 2026-10-04, AGENTS.md „Karteninteraktion“, Design Guide P8, WI-0063 27.12): Werte der
 * Fakten- und Kontexttafel, die genau ein Objekt der Karte sind, sind Links - dieselben wie in „Liegt in“. Das Modell zeigt, WELCHE Stücke
 * einer Zeile Links sind und wohin sie zeigen; ob ein Klick fliegt und das Panel des Objekts öffnet, prüft `e2e/info-panel-links.spec.ts`.
 */

afterEach(() => setLocale("de"));

const model = (...args: Parameters<typeof shown>): PanelModel => {
    const result = panelModelOf(shown(...args), null, env("all"));
    if (result === undefined) throw new Error("kein Modell");
    return result;
};

const row = (m: PanelModel, key: string): RowModel => {
    const found = m.rows.find((entry) => entry.key.startsWith(key));
    if (found === undefined) throw new Error(`keine Zeile ${key}: ${m.rows.map((entry) => entry.key).join(", ")}`);
    return found;
};

const textOf = (value: RowValue): string =>
    value.kind === "text" ? value.text : value.kind === "parts" ? value.parts.map((part) => part.text).join("") : "";

/** Die Links einer Zeile: Text und Ziel in der Reihenfolge des Textes. */
const linksOf = (value: RowValue): [string, SubjectRef][] =>
    value.kind === "parts"
        ? value.parts.flatMap((part): [string, SubjectRef][] => (part.ref === undefined ? [] : [[part.text, part.ref]]))
        : [];

describe("🔴 Gareth: Lage und Derographie, die der Betreiber als weißen Text sah", () => {
    const m = model(garethMitVerweisen);

    it("Lage: Region und Staat sind Links, „Reichsstadt“ und „(nur Alt-Gareth)“ bleiben Text, der Wortlaut ändert sich nicht", () => {
        const lage = m.rows.find((entry) => entry.key.startsWith("lage:") && !entry.key.includes("direct"));
        if (lage === undefined) throw new Error("keine Lage des Wiki-Nests");
        expect(textOf(lage.value)).toBe("Herz des Kontinents · Baronie Raulsmark; Reichsstadt (nur Alt-Gareth)");
        expect(linksOf(lage.value)).toEqual([
            ["Herz des Kontinents", HERZ],
            ["Baronie Raulsmark", RAULSMARK],
        ]);
    });

    it("Derographie: Name als Link, die Art als Text daneben: „Aventurien (Kontinent)“", () => {
        const derographie = row(m, "ctx:derographisch");
        expect(textOf(derographie.value)).toBe("Herz des Kontinents · Aventurien (Kontinent)");
        expect(linksOf(derographie.value)).toEqual([
            ["Herz des Kontinents", HERZ],
            ["Aventurien", AVENTURIEN],
        ]);
        const parts = derographie.value.kind === "parts" ? derographie.value.parts : [];
        expect(parts.map((part) => part.text)).toEqual(["Herz des Kontinents", " · ", "Aventurien", " (Kontinent)"]);
    });

    it("Klimazone: ein Link auf das Klimaband", () => {
        const klima = row(m, "ctx:climate");
        expect(textOf(klima.value)).toBe("Gemäßigte Zone");
        expect(linksOf(klima.value)).toEqual([["Gemäßigte Zone", GEMAESSIGT]]);
    });

    it("die eigene Angabe des Orts („Mitten im Reich“) ist Freitext ohne Verweise und bleibt Text", () => {
        const direct = m.rows.find((entry) => entry.key.startsWith("lage:direct"));
        expect(direct?.value.kind).toBe("text");
    });
});

describe("🔴 Koschgebirge, Massiv südlich des Greifenpasses: Derographie, Topographie, Klimazone", () => {
    const m = model(koschgebirge);

    it("Derographie: vier Namen, drei mit Art in Klammern daneben, jeder ein Link", () => {
        const derographie = row(m, "ctx:derographisch");
        expect(textOf(derographie.value)).toBe(
            "Koschberge · Mittelaventurien (Region) · Aventurien (Kontinent) · Nordmarken",
        );
        expect(linksOf(derographie.value)).toEqual([
            ["Koschberge", KOSCHBERGE],
            ["Mittelaventurien", MITTELAVENTURIEN],
            ["Aventurien", AVENTURIEN],
            ["Nordmarken", NORDMARKEN],
        ]);
    });

    it("🔴 Topographie: ein Name mit eigenem Komma bleibt EIN Link", () => {
        const topographie = row(m, "ctx:topographie");
        expect(textOf(topographie.value)).toBe(
            "Koschgebirge, Berge um den Greifenpass (Gebirge) · Koschberge (Gebirge)",
        );
        expect(linksOf(topographie.value)).toEqual([
            ["Koschgebirge, Berge um den Greifenpass", GREIFENPASS],
            ["Koschberge", KOSCHBERGE_GEBIRGE],
        ]);
    });

    it("Klimazone", () => {
        expect(linksOf(row(m, "ctx:climate").value)).toEqual([["Gemäßigte Zone", GEMAESSIGT]]);
    });
});

describe("Mehrdeutig oder ohne Namen bleibt Text, nie raten", () => {
    it("„Führt durch“ eines Wegs: derselbe Name zweier Flächen ist keine eindeutige Stelle; ein Name, der nur eine Fläche trägt, ist ein Link", () => {
        const m = model(reichsstrasse);
        const runs = row(m, "ctx:landscapes");
        // „Der große Fluss“ ist das Tal der Topographie UND der Vegetation: zwei Objekte unter einer Anzeige.
        expect(textOf(runs.value)).toBe("Albernia · Der große Fluss");
        expect(linksOf(runs.value)).toEqual([["Albernia", { kind: "area", id: "a" }]]);
    });

    it("eine Fläche ohne eigenen Namen („Wald-925“ heißt „Wald“) ist kein Ziel: Es gäbe keine Auskunft, welcher Wald", () => {
        const m = model({
            ...waldwildnis,
            context: {
                landscapes: {
                    relation: "lies_in",
                    items: [
                        { ref: { kind: "area", id: "w1" }, type: "wald", layer: "vegetation" },
                        { ref: { kind: "area", id: "w2" }, name: "Waldwildnis", type: "urwald", layer: "vegetation" },
                    ],
                },
            },
        });
        const vegetation = row(m, "ctx:vegetation");
        // WI-0105: Der Satz der Art (seit OPS-073 nur die Art, ohne „Unbezeichneter“); ein Ziel ist sie weiter nicht.
        expect(textOf(vegetation.value)).toBe("Wald · Waldwildnis (Urwald)");
        expect(linksOf(vegetation.value)).toEqual([["Waldwildnis", { kind: "area", id: "w2" }]]);
    });

    it("ohne einen einzigen Link bleibt die Zeile ein Text (kein Bauteil ohne Zweck)", () => {
        const m = model({
            ...waldwildnis,
            context: {
                landscapes: {
                    relation: "lies_in",
                    items: [{ ref: { kind: "area", id: "w1" }, type: "wald", layer: "vegetation" }],
                },
            },
        });
        expect(row(m, "ctx:vegetation").value).toEqual({ kind: "text", text: "Wald" });
    });

    it("jeder Link trägt einen Ref, der sich über dieselbe Naht öffnen lässt (`subjectKey`, eine Art mit Kennung)", () => {
        const m = model(koschgebirge);
        for (const rowModel of m.rows) {
            for (const [, ref] of linksOf(rowModel.value))
                expect(subjectKey(ref)).toMatch(/^(area|territory|climate|path|place):/);
        }
    });
});

describe("Landschaft: Kontinent, Region und die Nachbarn in EINER Zeile", () => {
    const m = model(landschaftMitVerweisen);

    it("Kontinent und Regionszugehörigkeit: der Name ist ein Link, der Rest der Hierarchie bleibt Text", () => {
        const continent = row(m, "continent");
        expect(linksOf(continent.value)).toEqual([["Aventurien", AVENTURIEN]]);
        const parent = row(m, "regionParent");
        expect(textOf(parent.value)).toBe("Mittelaventurien: Unbekanntes Land");
        expect(linksOf(parent.value)).toEqual([["Mittelaventurien", MITTELAVENTURIEN]]);
    });

    it("🔴 Nachbarn: die gruppierte Zeile behält ihre Form (Name, Richtungen in Klammern, Komma); Namen mit Verweis sind Links", () => {
        const neighbors = row(m, "neighbors");
        // Form wie vom Betreiber abgenommen: jeder Name einmal, die Richtungen in Klammern, ein Zusatz im Namen bleibt Text.
        expect(textOf(neighbors.value)).toBe("Koschberge (N, NO), Unbekannt (N, S), Nordmarken (Region) (NO)");
        expect(linksOf(neighbors.value)).toEqual([
            ["Koschberge", KOSCHBERGE],
            ["Nordmarken", NORDMARKEN],
        ]);
    });

    it("ohne einen einzigen Verweis bleibt die Nachbarzeile ein Text wie vorher", () => {
        const none = model({
            ...landschaftMitVerweisen,
            facts: (landschaftMitVerweisen.facts ?? []).filter(
                (fact) => fact.field === "neighbors" && "direction" in fact && fact.direction === "S",
            ),
        });
        expect(row(none, "neighbors").value).toEqual({ kind: "text", text: "Unbekannt (S)" });
    });
});

describe("Weg: Lage und der Verlauf im Deckel", () => {
    const m = model(wegMitVerweisen);

    it("Lage: ein bekannter Name ist ein Link, „Unbekannt“ nicht", () => {
        const lage = row(m, "lage");
        expect(textOf(lage.value)).toBe("Albernia, Unbekannt");
        expect(linksOf(lage.value)).toEqual([["Albernia", { kind: "area", id: "a" }]]);
    });

    it("🔴 der Verlauf: die Vorschau auf dem Knopf bleibt Text, im aufgeklappten Text sind die Stationen mit Verweis Links", () => {
        const verlauf = row(m, "verlauf").value;
        expect(verlauf.kind).toBe("lid");
        if (verlauf.kind !== "lid") return;
        expect(verlauf.preview).toBe("Elenvina → … → Gratenfels");
        expect(verlauf.count).toBe(7);
        const parts = verlauf.fullParts ?? [];
        expect(parts.map((part) => part.text).join("")).toBe(
            "Elenvina → Klippag → Niemandsland → Taindoch → Burg Crumold → Traviarim → Gratenfels",
        );
        expect(parts.filter((part) => part.ref !== undefined).map((part) => part.text)).toEqual([
            "Elenvina",
            "Klippag",
            "Gratenfels",
        ]);
    });
});

describe("Kartenpunkt: Flüsse und Klimazone sind Links", () => {
    it("die Gegend: Derographie, Vegetation, Klimazone und der Bach in der Nähe", () => {
        const m = model(punkt);
        expect(linksOf(row(m, "ctx:climate").value)).toEqual([["Gemäßigte Zone", GEMAESSIGT]]);
        const rivers = row(m, "ctx:rivers");
        expect(textOf(rivers.value)).toBe("Finkenbach (Bach)");
        expect(linksOf(rivers.value)).toEqual([["Finkenbach", { kind: "path", chain: "Finkenbach:Flussweg" }]]);
        expect(linksOf(row(m, "ctx:derographisch").value).map(([text]) => text)).toEqual([
            "Herz des Kontinents",
            "Aventurien",
        ]);
    });

    it("mehrere Klimabänder: die Anteile bleiben Text neben dem Namen", () => {
        const m = model({
            ...punkt,
            context: {
                climate: {
                    relation: "at_point",
                    items: [
                        { band: "gemaessigt", label: "Gemäßigte Zone", share: 0.8 },
                        { band: "boreal", label: "Boreale Zone", share: 0.2 },
                    ],
                },
            },
        });
        const klima = row(m, "ctx:climate");
        expect(textOf(klima.value)).toBe("Gemäßigte Zone (80 %) · Boreale Zone (20 %)");
        expect(linksOf(klima.value)).toEqual([
            ["Gemäßigte Zone", GEMAESSIGT],
            ["Boreale Zone", { kind: "climate", band: "boreal" }],
        ]);
    });
});

describe("Kraftlinie: „Führt durch“ trägt Verweise nur auf Flächen mit Namen", () => {
    it("Große Öde ist eine Steppe mit Namen und ein Link", () => {
        const m = model(kraftlinie);
        const runs = row(m, "ctx:landscapes");
        expect(linksOf(runs.value)).toEqual([["Große Öde", { kind: "area", id: "g" }]]);
    });
});

describe("Klimaband: ein Gegenstand nur mit Kopf (Legacy `showEcosystemAreaInfopanel`)", () => {
    it("🔴 Name, „Klimazonen“ und das Bild der Art - keine Felder, keine Aktion, keine Quellen, kein Kanon", () => {
        const m = model(klimaband);
        expect(m.header.title).toBe("Gemäßigte Zone");
        expect(m.header.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toEqual(["Klimazonen"]);
        expect(m.header.graphic).toBe("region");
        expect(m.header.canon).toBeUndefined();
        expect(m.actions).toEqual([]);
        expect(m.rows).toEqual([]);
        expect(m.liesIn).toBeUndefined();
        expect(m.wiki).toBeUndefined();
        expect(m.sources).toBeUndefined();
    });

    it("bis die Antwort da ist, steht der Name, den der Link kannte; der Kopf ist englisch in der englischen Seite", () => {
        setLocale("en");
        const m = model(klimaband);
        expect(m.header.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toEqual([
            "Climate zones",
        ]);
    });
});
