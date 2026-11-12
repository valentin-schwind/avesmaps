import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    LANDSCAPE_LAYERS,
    LANDSCAPE_SELECTIONS,
    MapPointDetail,
    MapPointQuery,
    OBJECT_LINK_ALIASES,
    OBJECT_LINK_NAMES,
    OBJECT_LINK_PARAMS,
    ResolveLinkQuery,
    ResolveLinkResponse,
    SUBJECT_DETAIL_KINDS,
    SUBJECT_KINDS,
    SourceEntry,
    SubjectDetail,
    SubjectRef,
    SubjectSourcesSection,
    isSameSubject,
    layersOfSelection,
    mapPointLayers,
    mapPointRef,
    parsePathChain,
    pathChainKey,
    readObjectLink,
    roundMapCoordinate,
    subjectDetailUrl,
    subjectKey,
    subjectSourcesUrl,
    type SubjectRef as SubjectRefType,
} from "../src/index.ts";

/**
 * Der Subject-Vertrag (WI-0063 P4): die Union der Kennungen, der kanonische Schlüssel, die Schemas ohne Zusatzfelder und
 * die Priorität der Objektlinks.
 */

const A = "11111111-2222-4333-8444-555555555551";
const B = "11111111-2222-4333-8444-555555555552";
const C = "11111111-2222-4333-8444-555555555553";
const REVISION = "0123456789ab";

const refs: Record<string, SubjectRefType> = {
    place: { kind: "place", id: A },
    pathAnchor: { kind: "path", anchor: A },
    pathAnchorWiki: { kind: "path", anchor: A, wiki: "reichsstrasse-2" },
    pathChain: { kind: "path", chain: "Reichsstrasse 2:Reichsstrasse" },
    area: { kind: "area", id: A },
    areaGroup: { kind: "area", id: A, group: [B, C] },
    territory: { kind: "territory", id: A },
    peak: { kind: "peak", id: A },
    powerline: { kind: "powerline", anchor: A },
    routeStage: { kind: "routeStage", index: 2, routeKey: "Gareth~Perricum" },
    mapPoint: { kind: "mapPoint", x: 12.34, y: 56.78 },
    climate: { kind: "climate", band: "gemaessigt" },
    loreEntry: { kind: "loreEntry", id: A },
    sprache: { kind: "sprache", id: A },
    wetterSymbol: { kind: "wetterSymbol", id: A },
};

describe("SubjectRef: eine Union, jede Art eine Form", () => {
    it("alle zehn Arten sind gültig, und jede hat genau die vereinbarte Kennung", () => {
        for (const [name, ref] of Object.entries(refs)) {
            expect(Value.Check(SubjectRef, ref), name).toBe(true);
        }
        expect(new Set(Object.values(refs).map((ref) => ref.kind))).toEqual(new Set(SUBJECT_KINDS));
        expect(SUBJECT_DETAIL_KINDS).toEqual(["place", "path", "area", "territory", "peak", "powerline"]);
    });

    it("🔴 ein Zusatzfeld, eine fremde Art und eine kaputte Kennung machen den Ref ungültig", () => {
        expect(Value.Check(SubjectRef, { kind: "place", id: A, name: "Gareth" })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "place", id: "Gareth" })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "place", id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "label", id: A })).toBe(false);
        // Der Eintrag eines Vorkommens nennt seine öffentliche Kennung, nie einen Namen (WI-0257 S3b).
        expect(Value.Check(SubjectRef, { kind: "loreEntry", id: "Baumdrache" })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "loreEntry", id: A, name: "Baumdrache" })).toBe(false);
        // Ein Weg braucht einen Anker oder einen Kettenschlüssel, nie beides fehlend.
        expect(Value.Check(SubjectRef, { kind: "path" })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "path", wiki: "x" })).toBe(false);
        // Eine Fläche nennt Kennungen, keinen Namen.
        expect(Value.Check(SubjectRef, { kind: "area", id: A, group: [] })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "area", id: A, group: ["Wald"] })).toBe(false);
        // Ein Kartenpunkt liegt auf der Karte.
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: -1, y: 5 })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 1025 })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, lat: 3 })).toBe(false);
        // Die Ebenen eines Kartenpunkts sind Landschaftsebenen, ohne Dopplung und nicht leer (Nachtrag zu WI-0083).
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, layers: ["vegetation"] })).toBe(true);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, layers: ["klima"] })).toBe(true);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, layers: [] })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, layers: ["politisch"] })).toBe(false);
        expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 5, y: 5, layers: ["klima", "klima"] })).toBe(false);
    });
});

/**
 * Die Abfrage einer freien Kartenstelle (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“): `layers` ist OPTIONAL, und
 * genau das ist der Vertrag - ohne den Parameter antwortet der Endpunkt wie vorher.
 */
describe("MapPointQuery: die Ebenen der aktiven Ansicht", () => {
    it("🔴 ohne `layers` gültig: alte Links und fremde Aufrufer bleiben gültig", () => {
        expect(Value.Check(MapPointQuery, { x: 12.34, y: 56.78 })).toBe(true);
        expect(mapPointLayers(undefined)).toBeUndefined();
    });

    it("die Komma-Schreibweise ist die von `/api/areas/at`, und sie wird an einer Stelle zerlegt", () => {
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "topographie" })).toBe(true);
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "derographisch,vegetation,topographie" })).toBe(true);
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "klima" })).toBe(true);
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "" })).toBe(false);
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "politisch" })).toBe(false);
        expect(Value.Check(MapPointQuery, { x: 1, y: 1, layers: "topographie," })).toBe(false);
        expect(mapPointLayers("derographisch,vegetation,topographie")).toEqual([
            "derographisch",
            "vegetation",
            "topographie",
        ]);
        // 🪤 Unbekanntes fällt weg, statt die Abfrage zu kippen; Dopplungen zählen einmal.
        expect(mapPointLayers("klima,klima")).toEqual(["klima"]);
        expect(mapPointLayers("vegetation,politisch")).toEqual(["vegetation"]);
    });

    it("🔴 die Ebenen des Punkts sind genau die der Kartenansichten - keine zweite Liste", () => {
        expect(mapPointLayers(LANDSCAPE_LAYERS.join(","))).toEqual([...LANDSCAPE_LAYERS]);
        for (const selection of LANDSCAPE_SELECTIONS) {
            const layers = layersOfSelection(selection);
            expect(mapPointLayers(layers.join(",")), selection).toEqual([...layers]);
            expect(Value.Check(SubjectRef, { kind: "mapPoint", x: 1, y: 1, layers: [...layers] }), selection).toBe(
                true,
            );
        }
    });
});

describe("subjectKey: dasselbe Subject, derselbe Schlüssel", () => {
    it("die Schlüssel sind je Art lesbar und stabil", () => {
        expect(subjectKey(refs["place"] as SubjectRefType)).toBe(`place:${A}`);
        expect(subjectKey(refs["territory"] as SubjectRefType)).toBe(`territory:${A}`);
        expect(subjectKey(refs["peak"] as SubjectRefType)).toBe(`peak:${A}`);
        expect(subjectKey(refs["powerline"] as SubjectRefType)).toBe(`powerline:${A}`);
        expect(subjectKey(refs["pathAnchor"] as SubjectRefType)).toBe(`path:${A}`);
        expect(subjectKey(refs["pathAnchorWiki"] as SubjectRefType)).toBe(`path:${A}:reichsstrasse-2`);
        expect(subjectKey(refs["pathChain"] as SubjectRefType)).toBe("path:chain:Reichsstrasse 2:Reichsstrasse");
        expect(subjectKey(refs["routeStage"] as SubjectRefType)).toBe("routeStage:Gareth~Perricum#2");
        expect(subjectKey(refs["climate"] as SubjectRefType)).toBe("climate:gemaessigt");
    });

    it("🔴 eine Fläche gleicher Gruppe hat einen Schlüssel, gleich in welcher Reihenfolge ihre Kennungen stehen", () => {
        const eins = subjectKey({ kind: "area", id: A, group: [C, B] });
        const zwei = subjectKey({ kind: "area", id: C, group: [B, A] });
        expect(eins).toBe(`area:${A}+${B}+${C}`);
        expect(zwei).toBe(eins);
        expect(subjectKey({ kind: "area", id: A })).not.toBe(eins);
        expect(isSameSubject({ kind: "area", id: A, group: [B] }, { kind: "area", id: B, group: [A] })).toBe(true);
    });

    it("🔴 ein Kartenpunkt gilt auf 0,01 gerundet: zwei Druckstellen in derselben Hundertstel sind derselbe Subject", () => {
        expect(roundMapCoordinate(12.344)).toBe(12.34);
        expect(roundMapCoordinate(12.346)).toBe(12.35);
        expect(Object.is(roundMapCoordinate(-0.001), 0)).toBe(true);
        expect(mapPointRef(12.341, 56.779)).toEqual({ kind: "mapPoint", x: 12.34, y: 56.78 });
        expect(subjectKey(mapPointRef(12.341, 56.779))).toBe("mapPoint:12.34,56.78");
        expect(isSameSubject(mapPointRef(12.341, 56.779), mapPointRef(12.3449, 56.7751))).toBe(true);
        expect(isSameSubject(mapPointRef(12.34, 56.78), mapPointRef(12.36, 56.78))).toBe(false);
    });

    it("🔴 ein Kartenpunkt trennt die Ansichten: die Ebenen zählen im Schlüssel mit (Nachtrag zu WI-0083)", () => {
        // Die Antwort hängt an der Ansicht, also darf der Cache zwei Ansichten nicht verwechseln - wie `wiki` am Weg.
        expect(subjectKey(mapPointRef(12.34, 56.78, ["vegetation"]))).toBe("mapPoint:12.34,56.78@vegetation");
        expect(
            isSameSubject(mapPointRef(12.34, 56.78, ["vegetation"]), mapPointRef(12.34, 56.78, ["topographie"])),
        ).toBe(false);
        expect(isSameSubject(mapPointRef(12.34, 56.78, ["vegetation"]), mapPointRef(12.34, 56.78))).toBe(false);
        // Eine leere Liste ist keine Angabe: „alle Ebenen, wie bisher“.
        expect(mapPointRef(12.34, 56.78, [])).toEqual({ kind: "mapPoint", x: 12.34, y: 56.78 });
    });

    it("zwei Wege mit verschiedenem Wiki-Schlüssel sind zwei Subjects, auch bei gleichem Anker", () => {
        expect(isSameSubject({ kind: "path", anchor: A, wiki: "x" }, { kind: "path", anchor: A, wiki: "y" })).toBe(
            false,
        );
        expect(isSameSubject({ kind: "path", anchor: A, wiki: "x" }, { kind: "path", anchor: A, wiki: "x" })).toBe(
            true,
        );
    });
});

describe("Adressen der Endpunkte", () => {
    it("jede Art mit Endpunkt hat eine Adresse, die anderen nicht", () => {
        expect(subjectDetailUrl(refs["place"] as SubjectRefType)).toBe(`/api/subjects/place/${A}`);
        expect(subjectDetailUrl(refs["area"] as SubjectRefType)).toBe(`/api/subjects/area/${A}`);
        expect(subjectDetailUrl(refs["powerline"] as SubjectRefType)).toBe(`/api/subjects/powerline/${A}`);
        expect(subjectDetailUrl(refs["pathAnchor"] as SubjectRefType)).toBe(`/api/subjects/path/${A}`);
        expect(subjectDetailUrl(refs["pathAnchorWiki"] as SubjectRefType)).toBe(
            `/api/subjects/path/${A}?wiki=reichsstrasse-2`,
        );
        expect(subjectDetailUrl(refs["pathChain"] as SubjectRefType)).toBe(
            "/api/subjects/path/Reichsstrasse%202%3AReichsstrasse",
        );
        expect(subjectDetailUrl(mapPointRef(12.341, 56.779))).toBe("/api/subjects/map-point?x=12.34&y=56.78");
        // 🔴 Die Ebenen der aktiven Ansicht reisen als optionaler Parameter mit (Nachtrag zu WI-0083).
        expect(subjectDetailUrl(mapPointRef(12.34, 56.78, ["derographisch", "vegetation", "topographie"]))).toBe(
            "/api/subjects/map-point?x=12.34&y=56.78&layers=derographisch,vegetation,topographie",
        );
        expect(subjectDetailUrl(refs["routeStage"] as SubjectRefType)).toBeNull();
        // Ein Klimaband hat einen Endpunkt mit seinem Schlüssel (WI-0063 27.12): ein Gegenstand nur mit Kopf.
        expect(subjectDetailUrl(refs["climate"] as SubjectRefType)).toBe("/api/subjects/climate/gemaessigt");
        // Der Eintrag eines Vorkommens liest `/api/search/eintrag`, keinen Detail-Endpunkt, und hat keine Sektionen (WI-0257 S3b).
        expect(subjectDetailUrl(refs["loreEntry"] as SubjectRefType)).toBeNull();
        expect(subjectSourcesUrl(refs["loreEntry"] as SubjectRefType)).toBeNull();
        expect(subjectKey(refs["loreEntry"] as SubjectRefType)).toBe(`loreEntry:${A}`);
        // Ein Wetter-Icon mit Wiki-Verweis (WI-0288): ein Detail wie die Sprache, ohne Sektionen; die Kennung ist eine UUID, nie ein Name.
        expect(subjectDetailUrl(refs["wetterSymbol"] as SubjectRefType)).toBe(`/api/subjects/wetter-symbol/${A}`);
        expect(subjectSourcesUrl(refs["wetterSymbol"] as SubjectRefType)).toBeNull();
        expect(subjectKey(refs["wetterSymbol"] as SubjectRefType)).toBe(`wetterSymbol:${A}`);
        expect(Value.Check(SubjectRef, { kind: "wetterSymbol", id: "Passat" })).toBe(false);
    });

    it("die Quellen-Sektion hängt `/sources` vor den Abfrageteil", () => {
        expect(subjectSourcesUrl(refs["place"] as SubjectRefType)).toBe(`/api/subjects/place/${A}/sources`);
        expect(subjectSourcesUrl(refs["pathAnchorWiki"] as SubjectRefType)).toBe(
            `/api/subjects/path/${A}/sources?wiki=reichsstrasse-2`,
        );
        expect(subjectSourcesUrl(refs["mapPoint"] as SubjectRefType)).toBeNull();
        expect(subjectSourcesUrl(refs["routeStage"] as SubjectRefType)).toBeNull();
    });

    it("🔴 der Kettenschlüssel ist der Name (WI-0177 Schritt 2b); alte Ketten `Name:Wegtyp` lesen sich weiter", () => {
        expect(pathChainKey("Großer Fluss")).toBe("name:Großer Fluss");
        expect(parsePathChain("name:Großer Fluss")).toEqual({ name: "Großer Fluss" });
        // Die Vorsilbe zuerst: Ein Weg, der wie ein Wegtyp heißt, ist kein alter Schlüssel „name“ mit Wegtyp „Weg“.
        expect(parsePathChain(pathChainKey("Weg"))).toEqual({ name: "Weg" });
        // Hinter der Vorsilbe gilt alles als Name, auch ein „:“ und ein Wegtyp am Ende.
        expect(parsePathChain(pathChainKey("Weg: zur Mühle:Weg"))).toEqual({ name: "Weg: zur Mühle:Weg" });
        expect(parsePathChain("name:")).toBeNull();
        expect(parsePathChain("name:  ")).toBeNull();
        // Alte Links: der Name, der Wegtyp steht nur noch da.
        expect(parsePathChain("Großer Fluss:Flussweg")).toEqual({ name: "Großer Fluss", subtype: "Flussweg" });
        // Ein Doppelpunkt im Namen: die Wegart steht hinter dem letzten.
        expect(parsePathChain("Weg: zur Mühle:Weg")).toEqual({ name: "Weg: zur Mühle", subtype: "Weg" });
        expect(parsePathChain("Reichsstrasse:Autobahn")).toBeNull();
        expect(parsePathChain("keine Kette")).toBeNull();
        expect(parsePathChain(":Weg")).toBeNull();
    });
});

describe("Objektlinks: Legacys Schlüssel, englische Aliase, feste Priorität", () => {
    const of = (query: string) => {
        const params = new URLSearchParams(query);
        return readObjectLink((name) => params.get(name));
    };

    it("jeder Schlüssel und jeder Alias führt auf die deutsche Bedeutung", () => {
        expect(of("siedlung=Gareth")).toEqual({ param: "siedlung", name: "siedlung", value: "Gareth" });
        expect(of("settlement=Gareth")).toEqual({ param: "siedlung", name: "settlement", value: "Gareth" });
        expect(of("staat=Punin")).toMatchObject({ param: "staat", name: "staat" });
        expect(of("state=Punin")).toMatchObject({ param: "staat", name: "state" });
        expect(of("region=Weiden")).toMatchObject({ param: "region" });
        expect(of("strasse=Reichsstrasse_1")).toMatchObject({ param: "strasse", name: "strasse" });
        expect(of("road=Reichsstrasse_1")).toMatchObject({ param: "strasse", name: "road" });
        expect(of("fluss=Gro%C3%9Fer_Fluss")).toMatchObject({ param: "fluss", name: "fluss" });
        expect(of("river=Gro%C3%9Fer_Fluss")).toMatchObject({ param: "fluss", name: "river" });
        expect(of(`place=${A}`)).toMatchObject({ param: "place" });
        expect(of("pin=1,2")).toBeNull();
        expect(of("")).toBeNull();
        expect(Object.values(OBJECT_LINK_ALIASES).every((param) => OBJECT_LINK_PARAMS.includes(param))).toBe(true);
        expect(OBJECT_LINK_NAMES.every((name) => name in OBJECT_LINK_ALIASES)).toBe(true);
    });

    it("🔴 gleichzeitig deutsch und englisch gleicher Bedeutung: der deutsche Schlüssel gewinnt", () => {
        expect(of("settlement=Punin&siedlung=Gareth")).toEqual({
            param: "siedlung",
            name: "siedlung",
            value: "Gareth",
        });
        expect(of("road=B&strasse=A")).toMatchObject({ name: "strasse", value: "A" });
        expect(of("river=B&fluss=A")).toMatchObject({ name: "fluss", value: "A" });
        expect(of("state=B&staat=A")).toMatchObject({ name: "staat", value: "A" });
    });

    it("🔴 die Priorität ist Legacys: place, siedlung, staat, region, strasse, fluss - der erste vorhandene gewinnt", () => {
        expect(of(`fluss=F&strasse=S&region=R&staat=T&siedlung=O&place=${A}`)?.param).toBe("place");
        expect(of("fluss=F&strasse=S&region=R&staat=T&siedlung=O")?.param).toBe("siedlung");
        expect(of("fluss=F&strasse=S&region=R&staat=T")?.param).toBe("staat");
        expect(of("fluss=F&strasse=S&region=R")?.param).toBe("region");
        expect(of("fluss=F&strasse=S")?.param).toBe("strasse");
        expect(of("fluss=F")?.param).toBe("fluss");
    });

    it("ein leerer Wert ist nicht vorhanden; der Wert wird getrimmt, aber nicht dekodiert", () => {
        expect(of("siedlung=&staat=Punin")).toMatchObject({ param: "staat" });
        expect(of("siedlung=%20%20&staat=Punin")).toMatchObject({ param: "staat" });
        expect(of("siedlung=%20Gareth%20")).toMatchObject({ value: "Gareth" });
        expect(of("staat=F%C3%BCrstentum_Kosch")).toMatchObject({ value: "Fürstentum_Kosch" });
        expect(readObjectLink(() => undefined)).toBeNull();
    });

    it("die Anfrage nimmt alle zehn Namen, mindestens einen, und nichts sonst", () => {
        expect(Value.Check(ResolveLinkQuery, { siedlung: "Gareth" })).toBe(true);
        expect(Value.Check(ResolveLinkQuery, { river: "Großer Fluss", settlement: "Gareth" })).toBe(true);
        expect(Value.Check(ResolveLinkQuery, {})).toBe(false);
        expect(Value.Check(ResolveLinkQuery, { siedlung: "" })).toBe(false);
        expect(Value.Check(ResolveLinkQuery, { siedlung: "x".repeat(601) })).toBe(false);
        expect(Value.Check(ResolveLinkQuery, { pin: "1,2" })).toBe(false);
    });
});

describe("SubjectDetail und die anderen Antworten: keine Zusatzfelder, keine leeren Teile", () => {
    const coat = {
        id: A,
        role: "coat",
        url: `/media/sha256/ab/ab/${"ab".repeat(32)}.webp`,
        width: 256,
        height: 256,
        mimeType: "image/webp",
    };
    const detail = {
        subject: refs["place"],
        revision: REVISION,
        title: "Gareth",
        subtitle: [{ part: "type", key: "metropole" }, { part: "ruin" }],
        media: { coat, header: [{ ...coat, role: "header", width: 1600, height: 900 }] },
        facts: [
            {
                field: "description",
                value: "Eine Stadt.",
                provenance: { kind: "wiki", wikiUrl: "https://w/x", syncedAt: "2026-06-06T21:01:40.000Z" },
            },
            { field: "synonyms", values: ["Alte Stadt"], provenance: { kind: "wiki" } },
            { field: "capital", value: "Gareth", ref: refs["place"], provenance: { kind: "editorial" } },
            {
                field: "verkehrswege",
                value: "Reichsstraße 1",
                links: [{ text: "Reichsstraße 1", ref: refs["pathChain"] }],
                provenance: { kind: "wiki" },
            },
        ],
        wiki: {
            url: "https://de.wiki-aventurica.de/wiki/Gareth",
            title: "Gareth",
            corpus: { key: "wiki-aventurica.de", label: "Wiki Aventurica" },
            license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
        },
        context: {
            territories: {
                relation: "lies_in",
                chains: [[{ ref: refs["territory"], name: "Mittelreich", type: "Kaiserreich" }]],
            },
            landscapes: {
                relation: "lies_in",
                items: [{ ref: refs["area"], type: "wald", layer: "vegetation", share: 1 }],
            },
            climate: { relation: "at_point", items: [{ band: "gemaessigt", label: "Gemäßigte Zone" }] },
        },
        canon: {
            canon: "unofficial",
            designatorType: "briefspiel",
            designatorCount: 3,
            designatorLabel: "Wiki Aventurica",
        },
        counts: { sources: 12 },
        target: { x: 1, y: 2, zoom: 6, bounds: [0, 0, 2, 2] },
    };

    it("die volle Antwort ist gültig", () => {
        expect(Value.Check(SubjectDetail, detail)).toBe(true);
        expect(Value.Check(SubjectDetail, { subject: refs["place"], revision: REVISION })).toBe(true);
    });

    it("🔴 jedes weitere Feld macht die Antwort ungültig, auch tief darin; die Revision ist ein Kurzschlüssel", () => {
        for (const bad of [
            { ...detail, html: "<b>" },
            { ...detail, media: { ...detail.media, storageKey: "x" } },
            { ...detail, wiki: { ...detail.wiki, text: "x" } },
            { ...detail, facts: [{ ...detail.facts[0], extra: 1 }] },
            { ...detail, context: { ...detail.context, nearby: [] } },
            { ...detail, canon: { ...detail.canon, note: "x" } },
            // `literature`, `citymaps` und `reviews` sind seit P8 echte Zähler; ein erfundener ist weiter verboten.
            { ...detail, counts: { sources: 1, buecher: 2 } },
            { ...detail, revision: "nicht hex" },
        ]) {
            expect(Value.Check(SubjectDetail, bad)).toBe(false);
        }
    });

    it("🔴 `legacyHidden` und `layer` sind optionale Markierungen der Fakten (WI-0063 27.8), sonst nichts anderes", () => {
        const wiki = { kind: "wiki" } as const;
        for (const good of [
            {
                field: "einwohner",
                value: "60000",
                provenance: { kind: "editorial" },
                layer: "direct",
                legacyHidden: true,
            },
            { field: "description", value: "Eine Stadt.", provenance: { kind: "editorial" }, layer: "direct" },
            { field: "synonyms", values: ["Alter Wald"], provenance: wiki, legacyHidden: true },
            { field: "neighbors", direction: "O", values: ["Ostland"], provenance: wiki, legacyHidden: true },
        ]) {
            expect(Value.Check(SubjectDetail, { ...detail, facts: [good] }), JSON.stringify(good)).toBe(true);
        }
        for (const bad of [
            // `legacyHidden` heißt wahr oder fehlt; `false` wäre ein zweiter Weg zu „sichtbar“.
            { field: "einwohner", value: "60000", provenance: wiki, legacyHidden: false },
            { field: "einwohner", value: "60000", provenance: wiki, legacyHidden: "ja" },
            { field: "synonyms", values: ["Alter Wald"], provenance: wiki, legacyHidden: false },
            // Es gibt nur die Schicht `direct`; Listenfakten haben keine Schicht.
            { field: "einwohner", value: "60000", provenance: wiki, layer: "nest" },
            { field: "synonyms", values: ["Alter Wald"], provenance: wiki, layer: "direct" },
        ]) {
            expect(Value.Check(SubjectDetail, { ...detail, facts: [bad] }), JSON.stringify(bad)).toBe(false);
        }
    });

    it("🔴 Verweise in Wiki-Texten (WI-0063 27.12): `links` mit Stelle am Textfakt, `links` mit Wert und Stelle an der Liste, sonst nichts", () => {
        const wiki = { kind: "wiki" } as const;
        const ref = refs["area"];
        for (const good of [
            {
                field: "lage",
                value: "Herz des Kontinents",
                provenance: wiki,
                links: [{ text: "Herz des Kontinents", ref }],
            },
            { field: "lage", value: "A · B", provenance: wiki, links: [{ text: "B", ref, at: 4 }] },
            {
                field: "neighbors",
                direction: "N",
                values: ["Nordland", "Ostmark (Teil)"],
                provenance: wiki,
                links: [{ value: 1, text: "Ostmark", ref, at: 0 }],
            },
        ]) {
            expect(Value.Check(SubjectDetail, { ...detail, facts: [good] }), JSON.stringify(good)).toBe(true);
        }
        for (const bad of [
            // Ein Verweis ohne Text, mit negativer oder gebrochener Stelle, mit fremdem Feld oder eine leere Liste.
            { field: "lage", value: "A", provenance: wiki, links: [{ text: "", ref }] },
            { field: "lage", value: "A", provenance: wiki, links: [{ text: "A", ref, at: -1 }] },
            { field: "lage", value: "A", provenance: wiki, links: [{ text: "A", ref, at: 0.5 }] },
            { field: "lage", value: "A", provenance: wiki, links: [{ text: "A", ref, html: "<a>" }] },
            { field: "lage", value: "A", provenance: wiki, links: [] },
            // Ein Wert der Liste braucht seine Stelle in der Liste und die Stelle im Wert.
            { field: "neighbors", values: ["A"], provenance: wiki, links: [{ text: "A", ref }] },
            { field: "neighbors", values: ["A"], provenance: wiki, links: [{ value: 0, text: "A", ref }] },
            { field: "neighbors", values: ["A"], provenance: wiki, links: [] },
        ]) {
            expect(Value.Check(SubjectDetail, { ...detail, facts: [bad] }), JSON.stringify(bad)).toBe(false);
        }
    });

    it("🔴 leere Teile gibt es nicht: keine leere Liste, kein leerer Wert, kein Zähler 0", () => {
        for (const bad of [
            { ...detail, title: "" },
            { ...detail, subtitle: [] },
            { ...detail, facts: [] },
            { ...detail, facts: [{ field: "description", value: "", provenance: { kind: "editorial" } }] },
            { ...detail, facts: [{ field: "synonyms", values: [], provenance: { kind: "wiki" } }] },
            { ...detail, media: { header: [] } },
            { ...detail, counts: { sources: 0 } },
            { ...detail, context: { landscapes: { relation: "lies_in", items: [] } } },
            { ...detail, context: { territories: { relation: "lies_in", chains: [[]] } } },
        ]) {
            expect(Value.Check(SubjectDetail, bad)).toBe(false);
        }
    });

    it("die Auskunft über einen Kartenpunkt trägt den gerundeten Punkt und seinen Kontext", () => {
        expect(
            Value.Check(MapPointDetail, {
                subject: { kind: "mapPoint", x: 1.5, y: 2.5 },
                revision: REVISION,
                context: {
                    rivers: [
                        { ref: refs["pathChain"], name: "Fluss", subtype: "Flussweg", isBach: false, distance: 1.5 },
                    ],
                },
            }),
        ).toBe(true);
        expect(Value.Check(MapPointDetail, { subject: refs["place"], revision: REVISION })).toBe(false);
        expect(
            Value.Check(MapPointDetail, { subject: { kind: "mapPoint", x: 1, y: 2 }, revision: REVISION, lat: 1 }),
        ).toBe(false);
    });

    it("die Quellen-Sektion kennt Lizenz und Namensnennung getrennt, aber keine interne Kennung", () => {
        const source = {
            title: "Regionalspielhilfe",
            url: "https://example.org/x",
            type: "briefspiel",
            official: false,
            referenceKind: "ausfuehrlich",
            pages: "S. 12",
            note: "Gareth ausführlich",
            license: {
                statement: "license",
                name: "CC BY-NC-SA 3.0",
                uri: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
            },
            attribution: "VolkoV / garetien.de",
            corpus: { key: "garetien.de", label: "Garetien" },
        };
        expect(Value.Check(SourceEntry, source)).toBe(true);
        expect(
            Value.Check(SubjectSourcesSection, { subject: refs["place"], revision: REVISION, sources: [source] }),
        ).toBe(true);
        for (const forbidden of ["sourceKey", "legacySourceId", "legacyOrigin", "urlHash", "id", "state"]) {
            expect(Value.Check(SourceEntry, { ...source, [forbidden]: "x" }), forbidden).toBe(false);
        }
        expect(Value.Check(SourceEntry, { ...source, license: { statement: "unrecorded" } })).toBe(false);
    });

    it("die Auflösung eines Objektlinks ist genau eines von: Ref, Kandidaten (mindestens zwei), nichts gefunden", () => {
        expect(Value.Check(ResolveLinkResponse, { ref: refs["place"], param: "siedlung", via: "wiki" })).toBe(true);
        expect(
            Value.Check(ResolveLinkResponse, {
                candidates: [
                    { ref: refs["place"], title: "A" },
                    { ref: refs["territory"], title: "B", type: "Reich" },
                ],
                param: "region",
                via: "wiki",
            }),
        ).toBe(true);
        expect(Value.Check(ResolveLinkResponse, { notFound: { param: "staat", value: "Nirgendwo" } })).toBe(true);
        // Ein einzelner Kandidat ist ein Ref, keine Auswahl.
        expect(
            Value.Check(ResolveLinkResponse, { candidates: [{ ref: refs["place"] }], param: "region", via: "wiki" }),
        ).toBe(false);
        expect(Value.Check(ResolveLinkResponse, { ref: refs["place"], param: "settlement", via: "wiki" })).toBe(false);
        expect(Value.Check(ResolveLinkResponse, {})).toBe(false);
    });
});
