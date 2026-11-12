import type { SubjectDetail } from "@avesmaps3d/shared";
import { REICH, REVISION, gareth, garethFacts, reichsstrasse } from "./panel-fixtures.ts";

/**
 * Antworten des Servers mit den Verweisen aus WI-0063 27.12 („anklickbar“): Werte, die genau ein Objekt der Karte sind, tragen `links`
 * (Textfakten mit Stelle, Listenfakten mit Wert und Stelle) oder ein `ref` im Kontext. Die Namen und Werte sind die Beispiele des Betreibers
 * aus dem lokalen Satz 161832 (Gareth, Koschgebirge).
 */

const WIKI = { kind: "wiki" as const, wikiUrl: "https://de.wiki-aventurica.de/wiki/Gareth" };

export const HERZ = { kind: "area" as const, id: "af1a1e78-a55c-4aa7-b958-0c65d4dda4a9" };
export const RAULSMARK = { kind: "territory" as const, id: "2e18c1cd-5d47-4a6c-ab59-3cf395ce025d" };
export const KOSCHBERGE = { kind: "area" as const, id: "052d80f0-6eb3-4a0b-8c38-d6c4d81a9cf0" };
export const KOSCHBERGE_GEBIRGE = { kind: "area" as const, id: "3e3a223f-73bc-45e5-84fd-2c12cb64b47a" };
export const GREIFENPASS = { kind: "area" as const, id: "26c398ce-b470-4721-9634-02c781b5d84b" };
export const MITTELAVENTURIEN = { kind: "area" as const, id: "6f57b61c-c685-4e6a-bb5f-99a72f02a378" };
export const AVENTURIEN = { kind: "area" as const, id: "9188801c-92e6-4fbf-a6d5-794b7433f846" };
export const NORDMARKEN = { kind: "area" as const, id: "3cf66717-8a50-453b-9134-08be11813779" };
export const GEMAESSIGT = { kind: "climate" as const, band: "gemaessigt" };

const LAGE = "Herz des Kontinents · Baronie Raulsmark; Reichsstadt (nur Alt-Gareth)";

/** Gareth mit der Lage und der Derographie, wie der Betreiber sie sah: erst weißer Text, jetzt Links. */
export const garethMitVerweisen: SubjectDetail = {
    ...gareth,
    facts: [
        ...garethFacts.filter((fact) => !(fact.field === "lage" && !("layer" in fact))),
        {
            field: "lage",
            value: LAGE,
            provenance: WIKI,
            links: [
                { text: "Herz des Kontinents", ref: HERZ, at: 0 },
                { text: "Baronie Raulsmark", ref: RAULSMARK, at: LAGE.indexOf("Baronie Raulsmark") },
            ],
        },
    ],
    context: {
        ...gareth.context,
        landscapes: {
            relation: "lies_in",
            items: [
                { ref: HERZ, name: "Herz des Kontinents", layer: "derographisch" },
                { ref: AVENTURIEN, name: "Aventurien", type: "kontinent", layer: "derographisch" },
            ],
        },
    },
};

/** „Koschgebirge, Massiv südlich des Greifenpasses“: Derographie, Topographie und Klimazone des Betreibers. */
export const koschgebirge: SubjectDetail = {
    subject: { kind: "area", id: "0e3c25ec-8329-437d-9eb9-40ae199d12ad" },
    revision: REVISION,
    title: "Koschgebirge, Massiv südlich des Greifenpasses",
    subtitle: [
        { part: "type", key: "gebirge" },
        { part: "layer", key: "topographie" },
    ],
    context: {
        territories: { relation: "overlaps", chains: [[{ ...REICH, share: 1 }]] },
        landscapes: {
            relation: "lies_in",
            items: [
                { ref: KOSCHBERGE, layer: "derographisch", name: "Koschberge", share: 1 },
                {
                    ref: GREIFENPASS,
                    layer: "topographie",
                    name: "Koschgebirge, Berge um den Greifenpass",
                    type: "gebirge",
                    share: 1,
                },
                { ref: KOSCHBERGE_GEBIRGE, layer: "topographie", name: "Koschberge", type: "gebirge", share: 1 },
                { ref: MITTELAVENTURIEN, layer: "derographisch", name: "Mittelaventurien", type: "region", share: 1 },
                { ref: AVENTURIEN, layer: "derographisch", name: "Aventurien", type: "kontinent", share: 1 },
                { ref: NORDMARKEN, layer: "derographisch", name: "Nordmarken", share: 0.06 },
            ],
        },
        climate: { relation: "lies_in", items: [{ band: "gemaessigt", label: "Gemäßigte Zone", share: 1 }] },
    },
    target: { x: 470, y: 560, zoom: 4, bounds: [440, 540, 500, 580] },
};

/** Eine Landschaft mit Verweisen in ihren Wiki-Feldern: Kontinent, Region und Nachbarn. */
export const landschaftMitVerweisen: SubjectDetail = {
    subject: { kind: "area", id: "8f6e0c36-1c3e-4a64-8d0a-5a2f4d1a9e10" },
    revision: REVISION,
    title: "Hochland",
    subtitle: [{ part: "type", key: "gebirge" }],
    facts: [
        {
            field: "continent",
            value: "Aventurien",
            provenance: { kind: "wiki" },
            legacyHidden: true,
            links: [{ text: "Aventurien", ref: AVENTURIEN, at: 0 }],
        },
        {
            field: "regionParent",
            value: "Mittelaventurien: Unbekanntes Land",
            provenance: { kind: "wiki" },
            links: [{ text: "Mittelaventurien", ref: MITTELAVENTURIEN, at: 0 }],
        },
        {
            field: "neighbors",
            direction: "N",
            values: ["Koschberge", "Unbekannt"],
            provenance: { kind: "wiki" },
            legacyHidden: true,
            links: [{ value: 0, text: "Koschberge", ref: KOSCHBERGE, at: 0 }],
        },
        {
            field: "neighbors",
            direction: "NO",
            values: ["Koschberge", "Nordmarken (Region)"],
            provenance: { kind: "wiki" },
            legacyHidden: true,
            links: [
                { value: 0, text: "Koschberge", ref: KOSCHBERGE, at: 0 },
                { value: 1, text: "Nordmarken", ref: NORDMARKEN, at: 0 },
            ],
        },
        { field: "neighbors", direction: "S", values: ["Unbekannt"], provenance: { kind: "wiki" }, legacyHidden: true },
    ],
    target: { x: 1, y: 2, zoom: 4 },
};

const VERLAUF = "Elenvina → Klippag → Niemandsland → Taindoch → Burg Crumold → Traviarim → Gratenfels";
const station = (n: number): { kind: "place"; id: string } => ({
    kind: "place",
    id: `70000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
});

/** Ein Weg mit Lage und Verlauf (sieben Stationen, also im Deckel), deren Namen teils Objekte der Karte sind. */
export const wegMitVerweisen: SubjectDetail = {
    ...reichsstrasse,
    facts: [
        {
            field: "lage",
            value: "Albernia, Unbekannt",
            provenance: { kind: "wiki" },
            links: [{ text: "Albernia", ref: { kind: "area", id: "a" }, at: 0 }],
        },
        {
            field: "verlauf",
            value: VERLAUF,
            provenance: { kind: "wiki" },
            links: [
                { text: "Elenvina", ref: station(0xe01), at: 0 },
                { text: "Klippag", ref: station(0xe02), at: VERLAUF.indexOf("Klippag") },
                { text: "Gratenfels", ref: station(0xe03), at: VERLAUF.indexOf("Gratenfels") },
            ],
        },
    ],
};

/** Ein Klimaband, wie der Server es als Gegenstand nur mit Kopf liefert. */
export const klimaband: SubjectDetail = {
    subject: GEMAESSIGT,
    revision: REVISION,
    title: "Gemäßigte Zone",
    subtitle: [{ part: "layer", key: "klima" }],
    target: { x: 512, y: 560, zoom: 3 },
};
