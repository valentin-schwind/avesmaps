import { afterEach, describe, expect, it, vi } from "vitest";
import {
    SPRACHENKARTE_TITEL,
    headerGraphicOf,
    pathChainKey,
    subjectDetailUrl,
    subjectKey,
    subjectSectionUrl,
    type SprachTrefferEintrag,
    type SubjectDetail,
    type SubjectSprache,
    type SubjectSprachTrefferSection,
} from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { sprachChoiceList } from "../src/controls/choice-list.ts";
import { createObjectLink } from "../src/info-panel/object-link.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import { alleZeigenOf } from "../src/info-panel/sprache-model.ts";
import { sprachTrefferGroupsOf } from "../src/info-panel/sprache-treffer.ts";
import type { PanelModel, RowModel } from "../src/info-panel/panel-types.ts";
import { presentationFromDetail } from "../src/info-panel/presentation.ts";
import { shareAddress } from "../src/info-panel/share-address.ts";
import { spracheOwner } from "../src/map/interaction/sprache-owner.ts";
import type { HitContext } from "../src/map/interaction/types.ts";
import { sprachenAnStelle } from "../src/map/sprachen-auswahl.ts";
import {
    buildSprachLayers,
    buildSprachSource,
    SPRACHE_FILL_LAYER_ID,
    SPRACHE_HOVER_FILL_LAYER_ID,
    SPRACHE_LINE_LAYER_ID,
    SPRACHE_MISCH_LAYER_ID,
} from "../src/map/sprachen-layers.ts";
import { legendenZeilen } from "../src/map/sprachen-stand.ts";
import { useSprachWahl } from "../src/map/sprachen-wahl.ts";
import { env, gareth, gebietStaatsinfobox, reichsstrasse, REVISION, shown, waldwildnis } from "./panel-fixtures.ts";

/**
 * Die Infobox einer Sprache, die Zeile „Sprachen“ der übrigen Infoboxen und die Wahl einer Sprache auf der Karte und in der Legende (WI-0261 S5b), ohne Browser.
 * Wie es aussieht, prüft die Sichtprüfung in der Wegwerf-Welt.
 */

afterEach(() => setLocale("de"));

const GARETHI = "c0de0000-0000-4000-8000-000000000001";
const ORKISCH = "c0de0000-0000-4000-8000-000000000002";
const WIKI = "https://de.wiki-aventurica.de/wiki/";
const WIKI_LINE = {
    url: `${WIKI}Thorwalsch`,
    title: "Thorwalsch",
    corpus: { key: "wiki-aventurica.de" },
    license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
    attribution: "Wiki Aventurica",
};
const prov = { kind: "wiki" as const, wikiUrl: `${WIKI}Thorwalsch` };

/** Eine Sprachgruppe mit drei Artikeln, wie der Server sie liefert (`detail-sprache.ts`). */
const thorwalsch: SubjectDetail = {
    subject: { kind: "sprache", id: GARETHI },
    revision: REVISION,
    title: "Thorwalsch",
    subtitle: [
        { part: "type", key: "sprachgruppe" },
        { part: "kind", text: "Thorwalsche Sprachen" },
    ],
    facts: [
        { field: "description", value: "Thorwalsch ist die Sprache der Thorwaler.", provenance: prov },
        { field: "sprachfamilie", value: "Thorwalsche Sprachen", provenance: prov },
        { field: "schrift", value: "Hjaldingsche Runen", provenance: prov },
        { field: "dialekte", values: ["Hjaldingsch", "Nordthorwalsch"], provenance: prov },
        {
            field: "amtssprache",
            value: "Thorwal, Svellttal",
            provenance: prov,
            links: [{ text: "Thorwal", ref: { kind: "territory", id: ORKISCH }, at: 0 }],
        },
    ],
    wiki: WIKI_LINE,
    target: { x: 300, y: 300, zoom: 3, bounds: [200, 200, 400, 400] },
    sprache: {
        schluessel: "thorwalsch",
        farbe: "#1baad4",
        artikel: [
            { titel: "Thorwalsch", url: `${WIKI}Thorwalsch` },
            { titel: "Gjalskisch", url: `${WIKI}Gjalskisch` },
            { titel: "Fjarningsch", url: `${WIKI}Fjarningsch` },
        ],
        treffer: [
            {
                art: "territory",
                anzahl: 34,
                eintraege: [
                    { ref: { kind: "territory", id: ORKISCH }, name: "Thorwal", anteil: 1 },
                    { ref: { kind: "territory", id: GARETHI }, name: "Svellttal", anteil: 0.4 },
                ],
            },
            {
                art: "place",
                anzahl: 1,
                eintraege: [{ ref: { kind: "place", id: GARETHI }, name: "Prem" }],
            },
            {
                art: "path",
                anzahl: 5,
                eintraege: [
                    { ref: { kind: "path", chain: pathChainKey("Olport-Weg") }, name: "Olport-Weg" },
                    { ref: { kind: "path", chain: pathChainKey("Küstenweg") }, name: "Küstenweg" },
                    { ref: { kind: "path", chain: pathChainKey("Fjordpfad") }, name: "Fjordpfad" },
                    { ref: { kind: "path", chain: pathChainKey("Klippenweg") }, name: "Klippenweg" },
                ],
            },
        ],
        gegenden: 23,
        herkunft: ["sprachenkarte"],
    },
};

/** Eine Fläche der Redaktion ohne Wiki-Zuordnung. */
const ohneWiki: SubjectDetail = {
    subject: { kind: "sprache", id: ORKISCH },
    revision: REVISION,
    title: "Trollisch",
    subtitle: [{ part: "type", key: "sprache" }],
    target: { x: 10, y: 10, zoom: 3, bounds: [0, 0, 20, 20] },
    sprache: {
        schluessel: "trollisch",
        farbe: "#336699",
        artikel: [],
        treffer: [],
        gegenden: 1,
        herkunft: ["redaktion"],
    },
};

const modell = (detail: SubjectDetail): PanelModel => {
    const ergebnis = panelModelOf(shown(detail), null, env("approved"));
    if (ergebnis === undefined) throw new Error("kein Modell");
    return ergebnis;
};
const labels = (rows: readonly RowModel[]): string[] => rows.map((row) => row.label);
const text = (row: RowModel | undefined): string =>
    row === undefined
        ? ""
        : row.value.kind === "parts"
          ? row.value.parts.map((part) => part.text).join("")
          : row.value.kind === "text"
            ? row.value.text
            : "";

describe("Der Vertrag kennt die Sprache als Gegenstand", () => {
    it("Schlüssel, Detail-Adresse, keine Sektionen, Kopfbild", () => {
        const ref = { kind: "sprache" as const, id: GARETHI };
        expect(subjectKey(ref)).toBe(`sprache:${GARETHI}`);
        expect(subjectDetailUrl(ref)).toBe(`/api/subjects/sprache/${GARETHI}`);
        expect(subjectSectionUrl(ref, "sources")).toBeNull();
        expect(headerGraphicOf("sprache", undefined)).toBe("sprachen");
    });

    it("die Adresse zum Teilen ist der Gruppenschlüssel; ohne Schlüssel kein Link", () => {
        const ref = { kind: "sprache" as const, id: GARETHI };
        expect(shareAddress("https://avesmaps.test/", ref, { spracheSchluessel: "garethi" })).toBe(
            "https://avesmaps.test/?sprache=garethi",
        );
        expect(shareAddress("https://avesmaps.test/", ref)).toBeUndefined();
    });

    it("eine Sprache zeigt sich in der Ebene „Sprachen“ der Derographie und steht dort gewählt", () => {
        expect(presentationFromDetail(thorwalsch)).toEqual({
            view: "landscapes",
            landscape: "sprachen",
            sprache: "thorwalsch",
        });
    });
});

describe("Die Infobox einer Sprache (Bauvorlage Zustand 2)", () => {
    it("Kopf: Name, Sprachgruppe · Familie, Typbild und die Sprechblase in der Farbe der Karte", () => {
        const { header } = modell(thorwalsch);
        expect(header.title).toBe("Thorwalsch");
        expect(header.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toEqual([
            "Sprachgruppe",
            "Thorwalsche Sprachen",
        ]);
        expect(header.graphic).toBe("sprachen");
        expect(header.sprachfarbe).toBe("#1baad4");
    });

    it("Band: Anzeigen und Link teilen mit dem Gruppenschlüssel", () => {
        const { actions } = modell(thorwalsch);
        expect(actions.map((action) => action.id)).toEqual(["show", "share"]);
        expect(actions[1]?.run).toEqual({
            type: "share",
            url: "https://avesmaps.test/?sprache=thorwalsch",
            what: "place",
        });
    });

    it("Feldtafel in der Reihenfolge der Vorlage, Amtssprache mit Verweis, Dialekte als Liste", () => {
        const { rows } = modell(thorwalsch);
        expect(labels(rows)).toEqual(["Beschreibung", "Sprachfamilie", "Schrift", "Dialekte", "Amtssprache in"]);
        expect(text(rows[3])).toBe("Hjaldingsch, Nordthorwalsch");
        const amt = rows[4];
        expect(amt?.value.kind === "parts" && amt.value.parts[0]).toMatchObject({
            text: "Thorwal",
            ref: { kind: "territory", id: ORKISCH },
        });
    });

    it("unter der Tafel: Text mit Lizenz wie bei den Vorkommen, dann die weiteren Wiki-Artikel der Gruppe", () => {
        const { lizenz } = modell(thorwalsch);
        expect(lizenz?.map((zeile) => zeile.map((teil) => teil.text).join(""))).toEqual([
            "Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0",
            "Weitere Wiki-Artikel: Gjalskisch · Fjarningsch",
        ]);
        expect(lizenz?.[1]?.filter((teil) => teil.href !== undefined).map((teil) => teil.href)).toEqual([
            `${WIKI}Gjalskisch`,
            `${WIKI}Fjarningsch`,
        ]);
    });

    it("„Wo sie gesprochen wird“: je Art eine Zeile wie die Vorkommen - der Zählsatz, die Namen holt sie beim Aufklappen (Betreiber 2026-10-31)", () => {
        const m = modell(thorwalsch);
        const { gesprochen } = m;
        expect(gesprochen?.heading).toBe("Wo sie gesprochen wird");
        expect(labels(gesprochen?.rows ?? [])).toEqual(["Herrschaftsgebiete", "Orte", "Wege"]);
        const [gebiete, orte, wege] = gesprochen?.rows ?? [];
        // Die Zahl ist die der Detailantwort, nicht die Länge der mitgelieferten Liste; ohne Vorschau der Namen.
        expect(gebiete?.value).toEqual({
            kind: "sprachTreffer",
            ref: { kind: "sprache", id: GARETHI },
            art: "territory",
            count: 34,
            sentence: "34 Gebiete",
            shortSentence: "34 Gebiete",
        });
        expect(orte?.value).toMatchObject({ kind: "sprachTreffer", art: "place", count: 1, sentence: "1 Ort" });
        expect(wege?.value).toMatchObject({ kind: "sprachTreffer", art: "path", count: 5, sentence: "5 Wege" });
    });

    it("aufgeklappt: Gebiete nach Anteil gegliedert (ganz, teilweise), Orte und Wege in einer Gruppe, die Köpfe stehen immer", () => {
        const abschnitt = (
            art: "territory" | "place",
            eintraege: SprachTrefferEintrag[],
        ): SubjectSprachTrefferSection => ({
            subject: { kind: "sprache", id: GARETHI },
            revision: "r1",
            art,
            anzahl: eintraege.length,
            eintraege,
        });
        const gebiete = sprachTrefferGroupsOf(
            abschnitt("territory", [
                { ref: { kind: "territory", id: ORKISCH }, name: "Thorwal", anteil: 1 },
                { ref: { kind: "territory", id: GARETHI }, name: "Svellttal", anteil: 0.4 },
            ]),
        );
        expect(gebiete.map((gruppe) => [gruppe.heading, gruppe.count, gruppe.collapsible])).toEqual([
            ["Ganz im Sprachgebiet", 1, false],
            ["Teilweise im Sprachgebiet", 1, false],
        ]);
        const orte = sprachTrefferGroupsOf(abschnitt("place", [{ ref: { kind: "place", id: ORKISCH }, name: "Prem" }]));
        expect(orte.map((gruppe) => gruppe.heading)).toEqual(["Im Sprachgebiet"]);
        expect(orte[0]?.names.blocks[0]?.entries[0]).toMatchObject({
            text: "Prem",
            ref: { kind: "place", id: ORKISCH },
        });
    });

    it("Quellenkasten: die Wikizeile des ersten Artikels und die Referenzkarte als offizielle Quelle der Flächen", () => {
        const m = modell(thorwalsch);
        expect(m.wiki?.url).toBe(`${WIKI}Thorwalsch`);
        expect(m.quellen).toEqual([
            { title: SPRACHENKARTE_TITEL, type: "sonstiges", official: true, note: "Gegenden auf der Karte" },
        ]);
    });

    it("ohne Wiki-Zuordnung: nur Name, Art, Quelle der Flächen (Redaktion); keine Tafel, keine Lizenzzeile", () => {
        const m = modell(ohneWiki);
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Sprache"]);
        expect(m.rows).toEqual([]);
        expect(m.lizenz).toBeUndefined();
        // Seit S5c steht dort „Alle zeigen“ (die Sprache hat eine Fläche); Treffer gibt es keine.
        expect(m.gesprochen?.rows).toEqual([]);
        expect(m.gesprochen?.alleZeigen).toMatchObject({ schluessel: "trollisch", gegenden: 1 });
        expect(m.wiki).toBeUndefined();
        expect(m.quellen).toEqual([
            { title: "Redaktion Avesmaps", type: "sonstiges", official: false, note: "Gegenden auf der Karte" },
        ]);
    });
});

describe("🔴 Die Zeile „Sprachen“ zwischen „Regionen“ und „Topographie“", () => {
    const sprachen: SubjectSprache[] = [
        { ref: { kind: "sprache", id: GARETHI }, name: "Garethi", farbe: "#ffb901", anteil: 0.62 },
        { ref: { kind: "sprache", id: ORKISCH }, name: "Orkisch", farbe: "#604c34", anteil: 0.38 },
    ];
    const mitTopographie = (detail: SubjectDetail): SubjectDetail => ({
        ...detail,
        sprachen,
        context: {
            ...detail.context,
            landscapes: {
                relation: "lies_in",
                items: [
                    ...(detail.context?.landscapes?.items ?? []),
                    {
                        ref: { kind: "area", id: "9188801c-92e6-4fbf-a6d5-794b7433f848" },
                        name: "Raschtulswall",
                        type: "gebirge",
                        layer: "topographie",
                    },
                ],
            },
        },
    });

    it("am Ort: verlinkt, mit Farbe, ohne Anteil (Punkt in Fläche), zwischen den beiden Zeilen", () => {
        const rows = modell(mitTopographie(gareth)).rows;
        const namen = labels(rows);
        const sprachZeile = rows.find((row) => row.label === "Sprachen");
        expect(namen.indexOf("Regionen")).toBeGreaterThanOrEqual(0);
        expect(namen.indexOf("Regionen")).toBeLessThan(namen.indexOf("Sprachen"));
        expect(namen.indexOf("Sprachen")).toBeLessThan(namen.indexOf("Topographie"));
        expect(text(sprachZeile)).toBe("Garethi · Orkisch");
        expect(sprachZeile?.value.kind === "parts" && sprachZeile.value.parts[0]).toMatchObject({
            ref: { kind: "sprache", id: GARETHI },
            swatch: "#ffb901",
        });
    });

    it("an einer Landschaft mit Anteil, und die Textzeile „Sprache“ des Wikis entfällt (O3: nur „Sprachen“)", () => {
        const mitWikiSprache: SubjectDetail = {
            ...mitTopographie(waldwildnis),
            facts: [...(waldwildnis.facts ?? []), { field: "sprache", value: "Garethi", provenance: { kind: "wiki" } }],
        };
        const rows = modell(mitWikiSprache).rows;
        expect(labels(rows)).not.toContain("Sprache");
        expect(text(rows.find((row) => row.label === "Sprachen"))).toBe("Garethi (62 %) · Orkisch (38 %)");
        // Ohne Sprachflächen bleibt die Textzeile (vor dem Einspielen, S6).
        const ohneSprachen: SubjectDetail = { ...mitWikiSprache };
        delete ohneSprachen.sprachen;
        const ohne = modell(ohneSprachen).rows;
        expect(labels(ohne)).toContain("Sprache");
        expect(labels(ohne)).not.toContain("Sprachen");
    });

    it("am Weg hinter „Führt durch“, am Gebiet ohne Landschaften trotzdem", () => {
        const weg = labels(modell({ ...reichsstrasse, sprachen }).rows);
        expect(weg.indexOf("Sprachen")).toBe(weg.indexOf("Führt durch") + 1);
        expect(labels(modell({ ...gebietStaatsinfobox, sprachen }).rows)).toContain("Sprachen");
        expect(labels(modell(gareth).rows)).not.toContain("Sprachen");
    });
});

const feature = (id: string, schluessel: string, name: string, area: number) => ({
    properties: { sprache_public_id: id, schluessel, name, farbe: "#aa0000", area },
});

describe("Die Wahl einer Sprache auf der Karte", () => {
    it("je Sprache einmal, die mit der kleinsten Teilfläche an der Stelle zuerst", () => {
        expect(
            sprachenAnStelle([
                feature(GARETHI, "garethi", "Garethi", 9000),
                feature(ORKISCH, "orkisch", "Orkisch", 400),
                feature(GARETHI, "garethi", "Garethi", 50),
                { properties: { name: "kaputt" } },
            ]).map((sprache) => [sprache.schluessel, sprache.flaeche]),
        ).toEqual([
            ["garethi", 50],
            ["orkisch", 400],
        ]);
    });

    const kontext = (features: ReturnType<typeof feature>[], kind: HitContext["kind"]): HitContext =>
        ({
            kind,
            screen: { x: 10, y: 20 },
            features: () => features,
        }) as unknown as HitContext;

    it("🔴 eine Sprache wählt der Klick sofort, zwei öffnen erst das Menü am Zeiger; Zeigen hebt die kleinste hervor", () => {
        const select = vi.fn();
        const choose = vi.fn();
        const hover = vi.fn();
        const owner = spracheOwner({ select, choose, hover });
        const eine = kontext([feature(GARETHI, "garethi", "Garethi", 9000)], "click");
        owner.apply("click", owner.hit(eine) as never, eine);
        expect(select).toHaveBeenCalledWith(expect.objectContaining({ schluessel: "garethi" }), { x: 10, y: 20 });
        const zwei = kontext(
            [feature(GARETHI, "garethi", "Garethi", 9000), feature(ORKISCH, "orkisch", "Orkisch", 400)],
            "click",
        );
        owner.apply("click", owner.hit(zwei) as never, zwei);
        expect(choose).toHaveBeenCalledTimes(1);
        expect(choose.mock.calls[0]?.[0].map((sprache: { name: string }) => sprache.name)).toEqual([
            "Orkisch",
            "Garethi",
        ]);
        owner.apply("hover", owner.hit(zwei) as never, { ...zwei, kind: "hover" });
        expect(hover.mock.calls[0]?.[0][0].schluessel).toBe("orkisch");
        expect(owner.hit(kontext([], "click"))).toBeUndefined();
    });

    it("das Menü nennt die Sprachen mit ihrer Farbe; ein Eintrag öffnet die Infobox, die Kamera fliegt, die Fläche steht gewählt", () => {
        const open = vi.fn();
        const wahl = useSprachWahl({ open, hint: () => undefined });
        const owner = wahl.owner();
        const zwei = kontext(
            [feature(GARETHI, "garethi", "Garethi", 9000), feature(ORKISCH, "orkisch", "Orkisch", 400)],
            "click",
        );
        owner.apply("click", owner.hit(zwei) as never, zwei);
        expect(wahl.menu.value?.title).toBe("An dieser Stelle: 2 Sprachen");
        expect(wahl.menu.value?.entries.map((entry) => [entry.name, entry.swatch])).toEqual([
            ["Orkisch", "#aa0000"],
            ["Garethi", "#aa0000"],
        ]);
        wahl.choose(GARETHI);
        expect(open).toHaveBeenCalledWith(
            { kind: "sprache", id: GARETHI },
            {
                source: "map",
                camera: "target",
                known: { title: "Garethi", presentation: { sprache: "garethi" } },
                anchor: { x: 10, y: 20 },
            },
        );
        wahl.close();
        expect(wahl.menu.value).toBeUndefined();
        // Die Legende öffnet ebenso, ohne Klickpunkt.
        wahl.waehle({ id: ORKISCH, schluessel: "orkisch", name: "Orkisch", farbe: "#604c34" });
        expect(open).toHaveBeenLastCalledWith(
            { kind: "sprache", id: ORKISCH },
            { source: "context", camera: "target", known: { title: "Orkisch", presentation: { sprache: "orkisch" } } },
        );
    });

    it("die Liste der Sprachen markiert die gewählte", () => {
        const liste = sprachChoiceList([{ id: GARETHI, name: "Garethi", farbe: "#ffb901" }], { x: 1, y: 2 }, GARETHI);
        expect(liste.selected).toBe(GARETHI);
        expect(liste.entries[0]).toEqual({ id: GARETHI, name: "Garethi", type: "Sprache", swatch: "#ffb901" });
    });

    it("Stil: Lasur zwischen Schraffur und Kontur, Kennung als Feature-Id (die gewählte leuchtet über `sprachen-leuchten.ts`)", () => {
        const ids = buildSprachLayers().map((layer) => layer.id);
        expect(ids).toEqual([
            SPRACHE_FILL_LAYER_ID,
            SPRACHE_MISCH_LAYER_ID,
            SPRACHE_HOVER_FILL_LAYER_ID,
            SPRACHE_LINE_LAYER_ID,
        ]);
        expect(buildSprachSource("/t/{z}/{x}/{y}")).toMatchObject({
            promoteId: { sprache_flaeche_render: "public_id" },
        });
    });

    it("die Legende kennt die Kennung jeder Sprache (ein Klick öffnet ihre Infobox)", () => {
        expect(
            legendenZeilen({
                sprachen: [{ id: GARETHI, schluessel: "garethi", name: "Garethi", legende: null, farbe: "#ffb901" }],
            }),
        ).toEqual([{ id: GARETHI, schluessel: "garethi", name: "Garethi", farbe: "#ffb901" }]);
    });
});

describe("Der Link `?sprache=` öffnet die Infobox über den Gruppenschlüssel", () => {
    it("bekannt: geöffnet mit Flug; unbekannt oder unlesbar: Meldung", async () => {
        const openSubject = vi.fn();
        const notify = vi.fn();
        const link = createObjectLink({
            selection: { openSubject },
            client: { resolveLink: vi.fn() },
            notify,
            spracheId: async (schluessel) => (schluessel === "garethi" ? GARETHI : null),
        });
        await link.open("?sprache=Garethi");
        expect(openSubject).toHaveBeenCalledWith(
            { kind: "sprache", id: GARETHI },
            { source: "link", camera: "target" },
        );
        await link.open("?sprache=gibtsnicht");
        await link.open("?sprache=Gro%C3%9F");
        expect(notify).toHaveBeenCalledTimes(2);
    });
});

describe("„Alle zeigen“ in der Infobox einer Sprache (WI-0261 S5c, Bauvorlage `ib-alle`)", () => {
    it("steht über den Treffern und trägt Schlüssel, Zahl der Gegenden, Gegenstand und Ziel der Kamera", () => {
        const { gesprochen } = modell(thorwalsch);
        expect(gesprochen?.alleZeigen).toEqual({
            schluessel: "thorwalsch",
            gegenden: 23,
            ref: { kind: "sprache", id: GARETHI },
            target: { x: 300, y: 300, zoom: 3, bounds: [200, 200, 400, 400] },
        });
        // Die Treffer bleiben, wie sie waren.
        expect(gesprochen?.rows.map((zeile) => zeile.label)).toEqual(["Herrschaftsgebiete", "Orte", "Wege"]);
    });

    it("eine Sprache mit Fläche, aber ohne Treffer hat den Abschnitt trotzdem (nur mit „Alle zeigen“)", () => {
        const { gesprochen } = modell(ohneWiki);
        expect(gesprochen?.rows).toEqual([]);
        expect(gesprochen?.alleZeigen).toMatchObject({ schluessel: "trollisch", gegenden: 1 });
    });

    it("ohne Fläche gibt es nichts zu zeigen: kein „Alle zeigen“, und ohne Treffer auch keinen Abschnitt", () => {
        const leer: SubjectDetail = {
            ...ohneWiki,
            sprache: { ...(ohneWiki.sprache as NonNullable<SubjectDetail["sprache"]>), gegenden: 0 },
        };
        expect(modell(leer).gesprochen).toBeUndefined();
        expect(alleZeigenOf(leer)).toBeUndefined();
    });

    it("ohne Ziel der Antwort fliegt die Kamera nirgends hin, das Leuchten bleibt möglich", () => {
        const ohneZiel = Object.fromEntries(Object.entries(ohneWiki).filter(([schluessel]) => schluessel !== "target"));
        expect(alleZeigenOf(ohneZiel as SubjectDetail)).toEqual({
            schluessel: "trollisch",
            gegenden: 1,
            ref: { kind: "sprache", id: ORKISCH },
        });
    });
});

describe("Die Wahl aus der Suche (WI-0261 S5c)", () => {
    const treffer = { id: GARETHI, schluessel: "garethi", name: "Garethi" } as const;

    it("öffnet die Infobox mit Flug auf die Hauptteile, wechselt die Ansicht gleich in die Ebene „Sprachen“ und lässt die Flächen leuchten", () => {
        const open = vi.fn();
        const leuchte = vi.fn();
        useSprachWahl({ open, hint: () => undefined, leuchte }).waehleAusSuche(treffer);
        expect(open).toHaveBeenCalledWith(
            { kind: "sprache", id: GARETHI },
            {
                source: "search",
                camera: "target",
                known: {
                    title: "Garethi",
                    presentation: { view: "landscapes", landscape: "sprachen", sprache: "garethi" },
                },
            },
        );
        expect(leuchte).toHaveBeenCalledWith("garethi");
    });

    it("über einen Dialekt gefunden, heißt die Infobox von Anfang an wie die Sprache", () => {
        const open = vi.fn();
        useSprachWahl({ open, hint: () => undefined }).waehleAusSuche({
            ...treffer,
            name: "Horathi",
            dialektVon: "Garethi",
        });
        expect(open.mock.calls[0]?.[1].known.title).toBe("Garethi");
    });

    it("jede bewusste Wahl lässt leuchten: Karte, Menü, Legende (auch erneut dieselbe)", () => {
        const open = vi.fn();
        const leuchte = vi.fn();
        const wahl = useSprachWahl({ open, hint: () => undefined, leuchte });
        wahl.waehle({ id: ORKISCH, schluessel: "orkisch", name: "Orkisch", farbe: "#604c34" });
        wahl.waehle({ id: ORKISCH, schluessel: "orkisch", name: "Orkisch", farbe: "#604c34" });
        expect(leuchte.mock.calls).toEqual([["orkisch"], ["orkisch"]]);
    });
});
