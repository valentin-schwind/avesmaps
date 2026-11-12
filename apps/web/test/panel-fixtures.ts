import type { LoreRowView, MapPointDetail, SubjectDetail, SubjectFact } from "@avesmaps3d/shared";
import { panelRules, type PanelMode } from "../src/info-panel/panel-extras.ts";
import type { PanelEnv } from "../src/info-panel/panel-types.ts";
import type { ShownSubject } from "../src/info-panel/subject-selection.ts";
import type { LandscapeLines } from "../src/route-planner/route-landscapes.ts";

/**
 * Antworten des Servers, wie sie lokal für die Referenzfälle des Infopanels kommen (WI-0063 P4, Satz 161832): gekürzt, aber mit den
 * echten Feldern, Werten und der echten Form. Gemeinsam für die Tests des Panelmodells.
 */

export const REVISION = "1b1fc50153bf";
export const GARETH_ID = "80558060-4299-54aa-b520-814b10819885";
export const DORF_ID = "5acdf435-80fc-4a34-980f-41020b31a8d3";

const WIKI = { kind: "wiki" as const, wikiUrl: "https://de.wiki-aventurica.de/wiki/Gareth" };
const LICENSE = { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" };

export const territory = (id: string, name: string): { ref: { kind: "territory"; id: string }; name: string } => ({
    ref: { kind: "territory", id },
    name,
});

export const REICH = territory(
    "3359118f-bdfe-4569-8277-3f25c2d62463",
    "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
);
export const GARETIEN = territory("99dacb52-93f1-4698-8746-1dd9d4b55992", "Königreich Garetien");
export const KAISERMARK = territory("159ad4fd-54de-4459-9e89-e0344fc7670c", "Kaisermark Gareth");

export const garethFacts: SubjectFact[] = [
    {
        field: "description",
        value: "Gareth ist mit Abstand die größte Stadt Aventuriens und Hauptstadt des Mittelreichs. Sie ist seit ihrer Gründung gewachsen.",
        provenance: WIKI,
    },
    { field: "oberhaupt", value: "Kaiserin Rohaja von Gareth", provenance: WIKI },
    { field: "einwohner", value: "170000 (1040 BF)", provenance: WIKI },
    { field: "lage", value: "Herz des Kontinents · Baronie Raulsmark", provenance: WIKI },
    {
        field: "verkehrswege",
        value: "Reichsstraßen 2 und 3, Gardel",
        provenance: WIKI,
        links: [
            { text: "Reichsstraßen 2 und 3", ref: { kind: "path", chain: "Reichsstraße 2:Reichsstrasse" } },
            { text: "Gardel", ref: { kind: "path", chain: "Gardel:Flussweg" } },
        ],
    },
    { field: "handelszone", value: "GAR", provenance: WIKI },
    // Die eigenen Angaben des Orts: Legacy zeigt sie nirgends (`legacyHidden`).
    {
        field: "einwohner",
        value: "ca. 200000",
        provenance: { kind: "editorial" },
        layer: "direct",
        legacyHidden: true,
    },
    {
        field: "lage",
        value: "Mitten im Reich",
        provenance: { kind: "editorial" },
        layer: "direct",
        legacyHidden: true,
    },
];

export const gareth: SubjectDetail = {
    subject: { kind: "place", id: GARETH_ID },
    revision: REVISION,
    title: "Gareth",
    subtitle: [
        { part: "type", key: "metropole" },
        { part: "capitalOf", territory: REICH },
        { part: "capitalOf", territory: GARETIEN },
        { part: "seatOf", territory: GARETIEN },
    ],
    facts: garethFacts,
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/Gareth",
        title: "Gareth",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
        attribution: "Wiki Aventurica",
    },
    canon: { canon: "official" },
    counts: { sources: 254 },
    context: {
        territories: { relation: "lies_in", chains: [[REICH, GARETIEN, KAISERMARK, territory("a1", "Alt-Gareth")]] },
        landscapes: {
            relation: "lies_in",
            items: [
                {
                    ref: { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f846" },
                    name: "Herz des Kontinents",
                    layer: "derographisch",
                },
                {
                    ref: { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f847" },
                    name: "Aventurien",
                    type: "kontinent",
                    layer: "derographisch",
                },
            ],
        },
        climate: { relation: "lies_in", items: [{ band: "gemaessigt", label: "Gemäßigte Zone" }] },
    },
    target: { x: 551.625, y: 532.969, zoom: 5 },
};

/** Ein Dorf ohne Wikiartikel: nur Name und Art, nichts sonst (WI-0063 14). */
export const dorf: SubjectDetail = {
    subject: { kind: "place", id: DORF_ID },
    revision: REVISION,
    title: "Felden",
    subtitle: [{ part: "type", key: "dorf" }],
    target: { x: 553.9, y: 528.1, zoom: 7 },
};

export const VERBORGEN_ID = "fdc5a6c0-1f9c-4f4a-9a8c-0b7e2d6a4c11";

/**
 * Ein verborgener Ort (WI-0080): auf der Karte zu finden, in keiner Suche - und im Panel mit der Pille „Verborgen“ neben dem
 * Kanon-Etikett. Das Merkmal kommt aus dem Lesevertrag (`hidden`), nicht aus der Karte. Beispiel aus dem heutigen Satz.
 */
export const verborgenerOrt: SubjectDetail = {
    subject: { kind: "place", id: VERBORGEN_ID },
    revision: REVISION,
    title: "Der verlassene Ritualplatz der Orks",
    subtitle: [{ part: "type", key: "gebaeude" }],
    canon: { canon: "unofficial", designatorType: "briefspiel" },
    hidden: true,
    target: { x: 544.93, y: 662.26, zoom: 7 },
};

export const WALD_ID = "edeca957-c8b1-45ad-a000-c8547ac845d6";

/** Waldwildnis: eine Landschaft mit Wiki, Nachbarn und Gebieten, die sie nur teilweise deckt. */
export const waldwildnis: SubjectDetail = {
    subject: { kind: "area", id: WALD_ID },
    revision: REVISION,
    title: "Waldwildnis",
    subtitle: [
        { part: "type", key: "urwald" },
        { part: "layer", key: "vegetation" },
    ],
    facts: [
        {
            field: "description",
            value: "Waldwildnis nennt sich die Waldfläche im Herzen der Streitenden Königreiche. Ihre Grenze folgt dem Ornib.",
            provenance: { kind: "wiki", wikiUrl: "https://de.wiki-aventurica.de/wiki/Waldwildnis" },
        },
        { field: "continent", value: "Aventurien", provenance: { kind: "wiki" }, legacyHidden: true },
        { field: "regionParent", value: "Streitende Königreiche", provenance: { kind: "wiki" } },
        { field: "affiliationStaat", value: "Königreich Nostria, Königreich Andergast", provenance: { kind: "wiki" } },
        { field: "sprache", value: "Garethi (Andergastisch, Nostrisch)", provenance: { kind: "wiki" } },
        { field: "neighbors", direction: "N", values: ["Ingvaltal"], provenance: { kind: "wiki" }, legacyHidden: true },
        { field: "neighbors", direction: "O", values: ["Thuranien"], provenance: { kind: "wiki" }, legacyHidden: true },
    ],
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/Waldwildnis",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
        attribution: "Wiki Aventurica",
    },
    canon: { canon: "official" },
    counts: { sources: 23 },
    context: {
        territories: {
            relation: "overlaps",
            chains: [
                [territory("n", "Königreich Nostria"), territory("n1", "Waldgrafschaft Thuranshag")].map(
                    (entry, index) => ({
                        ...entry,
                        share: index === 0 ? 0.83 : 0.337,
                    }),
                ),
                [territory("n", "Königreich Nostria"), territory("n2", "Grenzgrafschaft Tommellande")].map(
                    (entry, index) => ({
                        ...entry,
                        share: index === 0 ? 0.83 : 0.131,
                    }),
                ),
                [territory("a", "Königreich Andergast"), territory("a1", "Freiherrschaft Thurana")].map(
                    (entry, index) => ({
                        ...entry,
                        share: index === 0 ? 0.17 : 0.046,
                    }),
                ),
            ],
        },
        landscapes: {
            relation: "lies_in",
            items: [
                { ref: { kind: "area", id: "k" }, name: "Aventurien", type: "kontinent", layer: "derographisch" },
                { ref: { kind: "area", id: "s" }, name: "Streitende Königreiche", layer: "derographisch" },
            ],
        },
        climate: { relation: "lies_in", items: [{ band: "gemaessigt", label: "Gemäßigte Zone", share: 1 }] },
    },
    target: { x: 391.5, y: 604.8, zoom: 4, bounds: [330.7, 553.2, 421.1, 620.7] },
};

export const HUEGEL_ID = "8b98caaf-4fa9-4e48-9d12-d04a7c6653bc";

/** „Hügel der Brinaskquelle“: keine eigenen Daten, aber Kontext - er darf keine leere Titelbox sein (WI-0063 5.1). */
export const huegel: SubjectDetail = {
    subject: { kind: "area", id: HUEGEL_ID },
    revision: REVISION,
    title: "Hügel der Brinaskquelle",
    subtitle: [
        { part: "type", key: "huegelland" },
        { part: "layer", key: "topographie" },
    ],
    context: {
        territories: { relation: "lies_in", chains: [[{ ...territory("o", "Orkreich"), share: 1 }]] },
        landscapes: {
            relation: "lies_in",
            items: [
                { ref: { kind: "area", id: "s" }, name: "Svelltland", layer: "derographisch" },
                { ref: { kind: "area", id: "w" }, type: "wald", layer: "vegetation" },
            ],
        },
        climate: { relation: "lies_in", items: [{ band: "boreal", label: "Boreale Zone", share: 1 }] },
    },
    target: { x: 487.8, y: 740.2, zoom: 4, bounds: [484, 736.9, 491.4, 743.5] },
};

/** Ein See ohne Artikel: nur Art und Kontext. */
export const see: SubjectDetail = {
    subject: { kind: "area", id: "5501ff62-b371-41a9-ae14-f1f1bf1a7053" },
    revision: REVISION,
    subtitle: [
        { part: "type", key: "see" },
        { part: "layer", key: "topographie" },
    ],
    context: { territories: { relation: "lies_in", chains: [[territory("o", "Orkreich")]] } },
    target: { x: 1, y: 2, zoom: 4 },
};

const STATIONS = ["Elenvina", "Klippag", "Turehall", "Taindoch", "Burg Crumold", "Traviarim", "Gratenfels"].join(" → ");

export const reichsstrasse: SubjectDetail = {
    subject: { kind: "path", anchor: "00051122-928a-44de-a4cf-b2de4f1b0999", wiki: "reichsstrasse-3" },
    revision: REVISION,
    title: "Reichsstraße 3",
    subtitle: [{ part: "type", key: "Reichsstrasse" }],
    facts: [
        {
            field: "description",
            value: "Die Reichsstraße 3 führt von Elenvina über Kyndoch nach Gratenfels. Sie ist die längste Straße des Reiches.",
            provenance: { kind: "wiki" },
        },
        { field: "art", value: "Reichsstraße", provenance: { kind: "wiki" } },
        { field: "lage", value: "Albernia, Nordmarken", provenance: { kind: "wiki" } },
        { field: "laenge", value: "1020 Meilen", provenance: { kind: "wiki" } },
        { field: "verlauf", value: STATIONS, provenance: { kind: "wiki" } },
    ],
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_3",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
    },
    canon: { canon: "official" },
    counts: { sources: 23 },
    context: {
        territories: {
            relation: "runs_through",
            chains: [
                [REICH, GARETIEN],
                [REICH, territory("alb", "Fürstentum Albernia")],
            ],
        },
        landscapes: {
            relation: "runs_through",
            items: [
                { ref: { kind: "area", id: "a" }, name: "Albernia", layer: "derographisch" },
                { ref: { kind: "area", id: "b" }, name: "Der große Fluss", type: "tal", layer: "topographie" },
                { ref: { kind: "area", id: "c" }, name: "Der große Fluss", type: "tal", layer: "vegetation" },
            ],
        },
    },
    target: { x: 505.9, y: 541.5, zoom: 5, bounds: [386.9, 457.8, 631.3, 542.3] },
};

export const kraftlinie: SubjectDetail = {
    subject: { kind: "powerline", anchor: "669f9371-dfcd-4a05-bdd9-38de68a79ad8" },
    revision: REVISION,
    title: "Arteria Magica",
    facts: [
        {
            field: "description",
            value: "Die Arteria Magica ist eine regionale Kraftlinie. Sie verbindet orkische Ritualhöhlen mit goblinischen Orten.",
            provenance: { kind: "wiki" },
        },
        { field: "staerke", value: "regional", provenance: { kind: "wiki" } },
        { field: "regionen", value: "Blutzinnen, Svelltland", provenance: { kind: "wiki" } },
        {
            field: "verlauf",
            value: "Blutzinnen → Seminar der Verständigung → Rote Sichel",
            provenance: { kind: "wiki" },
            legacyHidden: true,
        },
    ],
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/Arteria_Magica",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
    },
    canon: { canon: "official" },
    context: {
        territories: { relation: "runs_through", chains: [[territory("o", "Orkreich")]] },
        landscapes: {
            relation: "runs_through",
            items: [{ ref: { kind: "area", id: "g" }, name: "Große Öde", type: "steppe", layer: "vegetation" }],
        },
    },
    target: { x: 558.3, y: 694.3, zoom: 5, bounds: [453.9, 688.3, 662.6, 701] },
};

export const gebiet: SubjectDetail = {
    subject: { kind: "territory", id: GARETIEN.ref.id },
    revision: REVISION,
    title: "Königreich Garetien",
    subtitle: [{ part: "kind", text: "Königreich" }],
    facts: [
        { field: "status", value: "abhängige Provinz", provenance: { kind: "editorial" } },
        {
            field: "capital",
            value: "Gareth",
            provenance: { kind: "editorial" },
            ref: { kind: "place", id: GARETH_ID },
        },
    ],
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/K%C3%B6nigreich_Garetien",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
    },
    canon: { canon: "unofficial", designatorType: "briefspiel", designatorCount: 2 },
    counts: { sources: 54 },
    context: { territories: { relation: "lies_in", chains: [[REICH]] } },
    target: { x: 542, y: 514.7, zoom: 3, bounds: [488.9, 480.8, 601.1, 566.3] },
};

export const gipfel: SubjectDetail = {
    subject: { kind: "peak", id: "8cbde979-2133-4cf6-9601-637ac08fd137" },
    revision: REVISION,
    title: "Adlerspitze",
    subtitle: [{ part: "type", key: "berggipfel" }],
    facts: [
        {
            field: "description",
            value: "Die Adlerspitze ist der höchste Berg der Roten Sichel. Sie ragt weit auf.",
            provenance: { kind: "wiki" },
        },
        { field: "regionParent", value: "Rote Sichel", provenance: { kind: "wiki" } },
    ],
    target: { x: 652, y: 705.7, zoom: 4 },
};

/**
 * Die Vorkommen, die ein Kartenpunkt MITBRINGT (WI-0110) - gekürzt nach dem, was der echte Punkt bei 551,6/520,5 liefert:
 * nur „Aus der Region“, nie „Direkt von hier“, und die Linkzeile auch dort, wo gar nichts Eigenes steht (Flora, Satz 0).
 */
export const AVENTURIEN_REF = { kind: "area" as const, id: "9188801c-92e6-4fbf-a6d5-794b7433f846" };

export const punktLore: LoreRowView[] = [
    {
        kind: "ware",
        count: 2,
        groups: [
            {
                group: "region",
                entries: [{ name: "Garether Bier" }, { name: "Quitte", ref: { kind: "place", id: "q" } }],
            },
        ],
        everywhere: { ref: AVENTURIEN_REF, count: 302 },
    },
    {
        kind: "fauna",
        count: 1,
        groups: [{ group: "region", entries: [{ name: "Fasan" }] }],
        everywhere: { ref: AVENTURIEN_REF, count: 383 },
    },
    // 🔴 Die Zeile, deren ganzer Inhalt der Link ist: Satz 0, und sie steht trotzdem (WI-0104).
    { kind: "flora", count: 0, groups: [], everywhere: { ref: AVENTURIEN_REF, count: 445 } },
    { kind: "spezies", count: 1, groups: [{ group: "region", entries: [{ name: "Ork" }] }] },
];

export const punkt: MapPointDetail = {
    subject: { kind: "mapPoint", x: 551.6, y: 520.5 },
    revision: REVISION,
    lore: punktLore,
    context: {
        territories: { relation: "at_point", chains: [[REICH, GARETIEN]] },
        landscapes: {
            relation: "at_point",
            items: [
                { ref: { kind: "area", id: "g" }, name: "Goldene Au", type: "kulturlandschaft", layer: "vegetation" },
                { ref: { kind: "area", id: "h" }, name: "Herz des Kontinents", layer: "derographisch" },
                { ref: { kind: "area", id: "k" }, name: "Aventurien", type: "kontinent", layer: "derographisch" },
            ],
        },
        climate: { relation: "at_point", items: [{ band: "gemaessigt", label: "Gemäßigte Zone" }] },
        rivers: [
            {
                ref: { kind: "path", chain: "Finkenbach:Flussweg" },
                name: "Finkenbach",
                subtype: "Flussweg",
                isBach: true,
                distance: 0.98,
            },
        ],
    },
};

export const shown = (answer: SubjectDetail | MapPointDetail | undefined, title?: string): ShownSubject => ({
    ref: answer?.subject ?? { kind: "place", id: GARETH_ID },
    key: "k",
    title,
    status: answer === undefined ? "loading" : "ready",
    answer,
});

export const env = (
    mode: PanelMode = "legacy",
    destinations: readonly string[] = [],
    /** Die Landschaften und Gebiete, die der Planer schon abgefragt hat (WI-0063 27.13); `null`, solange die Abfrage läuft. */
    landscapes: LandscapeLines | null = null,
    customAirName = "",
    /** Wie die Kartenpunkte der Reise im Planer heißen, nach Kennung (WI-0087 P9). */
    pointNames: ReadonlyMap<string, string> = new Map(),
    /** Die Vorkommen je Etappe, wie das Panel sie abgefragt hat (WI-0106); ohne Eintrag hat die Etappe keine vier Zeilen. */
    stageLore: ReadonlyMap<number, { rows: readonly LoreRowView[] }> = new Map(),
): PanelEnv => ({
    rules: panelRules(mode),
    pageUrl: "https://avesmaps.test/",
    isDestination: (id) => destinations.includes(id),
    landscapes: () => landscapes,
    stageLore: (index) => stageLore.get(index) ?? null,
    customAirName: () => customAirName,
    pointNames: () => pointNames,
});

// ---------------------------------------------------------------------------------------------------------------
// WI-0063 P7: „Weg als Route“, „Ganze Straße“, Gestalt einer Kraftlinie, Anspruchsteller und Klima eines Gebiets
// ---------------------------------------------------------------------------------------------------------------

const place = (
    n: number,
    name: string,
    x: number,
    y: number,
): { id: string; name: string; subtype: string; x: number; y: number } => ({
    id: `70000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    name,
    subtype: "stadt",
    x,
    y,
});

export const ROUTE_PLACES = [
    place(1, "Elenvina", 400.5, 457.8),
    place(2, "Kyndoch", 450.1, 480.2),
    place(3, "Gratenfels", 631.3, 542.3),
];

/** Eine Straße mit Wiki-Artikel, die drei Orte verbindet: Der Server nennt sie in Reihenfolge, dazu „Von – Bis“. */
export const reichsstrasseMitRoute: SubjectDetail = {
    ...reichsstrasse,
    routePlaces: ROUTE_PLACES,
    stretch: { from: "Elenvina", to: "Gratenfels" },
};

/** Die Gestalt einer verzweigten Kraftlinie mit gekürzter Stationsliste, die sich zum Ring schließt. */
export const kraftlinieMitGestalt: SubjectDetail = {
    ...kraftlinie,
    lineShape: {
        ends: [
            { ref: { kind: "place", id: ROUTE_PLACES[0]?.id ?? "" }, name: "Blutzinnen" },
            { ref: { kind: "place", id: ROUTE_PLACES[2]?.id ?? "" }, name: "Rote Sichel" },
        ],
        via: [{ ref: { kind: "place", id: ROUTE_PLACES[1]?.id ?? "" }, name: "Seminar der Verständigung" }],
        viaMore: true,
        segments: 14,
        ring: true,
    },
};

/** Eine freie Kartenstelle mit ihrer Nachbarschaft: ein Weg ohne Namen, ein Ort, ein Fluss mit Namen - nach Entfernung. */
export const punktMitNachbarn: MapPointDetail = {
    ...punkt,
    nearby: [
        {
            ref: { kind: "path", anchor: "d112ca2d-87a9-4475-8fe3-bc2ac7278461" },
            type: "Strasse",
            miles: 1.1,
            bearing: 210.3,
        },
        {
            ref: { kind: "place", id: "0410d1ce-f5d2-45e9-aa7a-b04b957bc919" },
            type: "gebaeude",
            name: "Schloss Finkenschlag",
            miles: 1.64,
            bearing: 287.8,
        },
        {
            ref: { kind: "path", anchor: "2eb12c0a-57a7-4d8e-8c26-02a844516361" },
            type: "Flussweg",
            name: "Finkenbach",
            miles: 2.95,
            bearing: 359.9,
        },
    ],
};

const TOBRIEN_WIKI = { kind: "wiki" as const, wikiUrl: "https://de.wiki-aventurica.de/wiki/Herzogtum_Tobrien" };
const EDITORIAL = { kind: "editorial" as const };

export const TOBRIEN_ID = "ecba0ad4-bed6-4d24-be5c-0b6e5dc2b65d";
const YSILIA_ID = "0cf5714d-0417-4096-aa2a-f5a631f94613";
const PERAINEFURTEN_ID = "402aba7a-df0a-5570-acc3-ab7df44d6208";

/**
 * Das Herzogtum Tobrien, wie der Server es seit WI-0063 27.18 antwortet (gekürzt aus dem Bestand, Wortlaut der Felder echt): dreizehn
 * Zeilen der Staatsinfobox, die Hauptstadt mit dem Text des Gebietsexports und dem Link auf den Ort, dahinter die vier verborgenen
 * Zusatzfelder. 🔴 Die Folge der Fakten ist HIER absichtlich nicht die Legacys: Das Panel ordnet nach seiner Tabelle, nicht nach dem
 * Server.
 */
export const gebietStaatsinfobox: SubjectDetail = {
    subject: { kind: "territory", id: TOBRIEN_ID },
    revision: REVISION,
    title: "Herzogtum Tobrien",
    subtitle: [{ part: "kind", text: "Herzogtum" }],
    facts: [
        { field: "handelswaren", value: "Holz, Vieh, Pferde, Pflaumen, Kupfer", provenance: TOBRIEN_WIKI },
        { field: "politisch", value: "Mittelreich", provenance: EDITORIAL, legacyHidden: true },
        { field: "geographisch", value: "Tobrien", provenance: TOBRIEN_WIKI },
        { field: "validity", value: "besteht seit 590 BF", provenance: EDITORIAL },
        { field: "einwohnerzahl", value: "80000 (1040 BF)", provenance: TOBRIEN_WIKI },
        { field: "waehrung", value: "Dukaten", provenance: TOBRIEN_WIKI },
        { field: "sprache", value: "Garethi", provenance: TOBRIEN_WIKI },
        {
            field: "seat",
            value: "Perainefurten",
            provenance: TOBRIEN_WIKI,
            ref: { kind: "place", id: PERAINEFURTEN_ID },
        },
        {
            field: "capital",
            value: "Ysilia (nominell)",
            provenance: TOBRIEN_WIKI,
            ref: { kind: "place", id: YSILIA_ID },
        },
        { field: "gruender", value: "Herzog Yerodin der Große", provenance: TOBRIEN_WIKI },
        { field: "aufloesung", value: "besteht", provenance: TOBRIEN_WIKI },
        { field: "gruendung", value: "590 BF", provenance: TOBRIEN_WIKI },
        { field: "oberhaupt", value: "Herzog Bernfried von Ehrenstein", provenance: TOBRIEN_WIKI },
        { field: "herrschaftsform", value: "Feudalherrschaft", provenance: TOBRIEN_WIKI },
        { field: "status", value: "abhängige Provinz", provenance: EDITORIAL },
        { field: "continent", value: "Aventurien", provenance: TOBRIEN_WIKI, legacyHidden: true },
        { field: "zugehoerigkeitRoh", value: "Mittelreich", provenance: TOBRIEN_WIKI, legacyHidden: true },
        {
            field: "wappenbeschreibung",
            value: "Gespalten von Rot und Schwarz",
            provenance: TOBRIEN_WIKI,
            legacyHidden: true,
        },
    ],
    wiki: {
        url: "https://de.wiki-aventurica.de/wiki/Herzogtum_Tobrien",
        corpus: { key: "wiki-aventurica.de" },
        license: LICENSE,
    },
    context: {
        territories: { relation: "lies_in", chains: [[REICH]] },
        climate: { relation: "overlaps", items: [{ band: "gemaessigt", label: "Gemäßigte Zone", share: 1 }] },
    },
    target: { x: 542, y: 514.7, zoom: 3, bounds: [488.9, 480.8, 601.1, 566.3] },
};

/** Ein eigener Knoten ohne Wiki-Artikel (Alt-Gareth): zwei Overrides, davon ein Zusatzfeld, keine Wikizeile. */
export const gebietEigenerKnoten: SubjectDetail = {
    subject: { kind: "territory", id: "de38a3d0-2f1f-4f64-9a1d-2c304add3672" },
    revision: REVISION,
    title: "Alt-Gareth",
    facts: [
        { field: "sprache", value: "Garethi", provenance: EDITORIAL },
        { field: "politisch", value: "Mittelreich", provenance: EDITORIAL, legacyHidden: true },
    ],
    context: { climate: { relation: "overlaps", items: [{ band: "gemaessigt", label: "Gemäßigte Zone", share: 1 }] } },
};

/** Ein Gebiet, dessen Detailzeile nur Zusatzfelder trägt: Legacy zeigt davon nichts, also bleibt die Tabelle leer. */
export const gebietNurZusatzfelder: SubjectDetail = {
    subject: { kind: "territory", id: "12d33897-fc56-493a-97b0-153828ffa904" },
    revision: REVISION,
    title: "Baronie Jandraskan (Teilgebiet)",
    facts: [
        { field: "continent", value: "Aventurien", provenance: TOBRIEN_WIKI, legacyHidden: true },
        { field: "zugehoerigkeitRoh", value: "Mittelreich", provenance: TOBRIEN_WIKI, legacyHidden: true },
    ],
};

/** Ein umstrittenes Gebiet: zwei Anspruchsteller mit der Farbe ihres Gebiets, dazu Sitz, Kartenzeitraum und das Klima seiner Form. */
export const gebietUmstritten: SubjectDetail = {
    ...gebiet,
    claimants: [
        {
            ref: { kind: "territory", id: "22119a37-632d-4b20-a297-1af281d45315" },
            name: "Markgrafschaft Perricum",
            color: "#a9b263",
        },
        {
            ref: { kind: "territory", id: "e5727ed3-dd73-4e21-a512-b369a46edfa1" },
            name: "Bergkönigreich Tosch Mur",
            color: "#c34141",
        },
    ],
    facts: [
        ...(gebiet.facts ?? []),
        { field: "validity", value: "ab 1000 BF", provenance: { kind: "editorial" } },
        { field: "seat", value: "Gareth", provenance: { kind: "editorial" }, ref: { kind: "place", id: GARETH_ID } },
    ],
    context: {
        ...gebiet.context,
        climate: {
            relation: "overlaps",
            items: [
                { band: "gemaessigt", label: "Gemäßigte Zone", share: 0.871 },
                { band: "subtropen_winterfeucht", label: "Winterfeuchte Subtropen", share: 0.113 },
            ],
        },
    },
};
