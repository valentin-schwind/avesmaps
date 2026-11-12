import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { Finding } from "../src/findings.ts";
import {
    CONTINENT_KEYS,
    bareLoreKey,
    hitCells,
    isContinentKey,
    resolveLorePlace,
    resolveLorePlaceByCarriers,
    ruleKeyOf,
} from "../src/migration/lore-keys.ts";
import { lookupWikiKeyTargets, wikiKeyOfLoreKey } from "../src/subjects/wiki-key-lookup.ts";
import { bedSchluessel, ketteKennung, regelSchluessel, type Bed } from "../src/wiki/regeln/ableiten.ts";
import { importLore } from "../src/migration/lore-import.ts";
import { transformLore } from "../src/migration/lore.ts";
import { verifyLore } from "../src/migration/verify-lore.ts";
import {
    C,
    answer,
    catalogRow,
    cleanLoreFixtures,
    entry,
    fixtureWikiKeys,
    insertLoreFixtures,
    kraeuterRow,
    link,
    loreLookups,
    place,
    rule,
    sha256,
    term,
    wikiKeysOf,
    zooRow,
    type LoreIds,
} from "./support/lore-fixture.ts";

/**
 * Lore und Vorkommen (WI-0063 P3, Migration 0074, Vertrag `lore.yaml`, D5): erst die Schlüssel, die Auflösung und die reine Umwandlung der
 * Antwort mit kleinen synthetischen Antworten in der Form des Legacy-Exports (E2 und E2+), dann Import, Zustände aus der Quelle,
 * Stilllegen, Notaus je Art, Idempotenz, Auflösung gegen echte Trägertabellen und der Prüfer gegen echtes PostgreSQL.
 */

type Bag = Record<string, unknown>;

const codes = (findings: readonly Finding[]): string[] => findings.map((finding) => finding.code);
const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

describe("Schlüssel der Lore", () => {
    it("🔴 EINE Stelle für das Präfix: wikiKeyOfLoreKey setzt wiki: wo es fehlt, schneidet nie den Namensraum und faltet nichts", () => {
        expect(wikiKeyOfLoreKey("weiden")).toBe("wiki:weiden");
        expect(wikiKeyOfLoreKey("wiki:weiden")).toBe("wiki:weiden");
        expect(wikiKeyOfLoreKey("  weiden ")).toBe("wiki:weiden");
        expect(wikiKeyOfLoreKey("inoffiziell-angbar")).toBe("wiki:inoffiziell-angbar");
        expect(wikiKeyOfLoreKey("wiki:inoffiziell-angbar")).toBe("wiki:inoffiziell-angbar");
        expect(wikiKeyOfLoreKey("Weiden")).toBe("wiki:Weiden");
        expect(wikiKeyOfLoreKey("")).toBe("");
        expect(wikiKeyOfLoreKey("   ")).toBe("");
    });

    it("der Vergleichsanteil (Kontinentliste, Vergleichsmaß) ist der Key ohne wiki: und klein; der Namensraum bleibt", () => {
        expect(bareLoreKey("wiki:Weiden")).toBe("weiden");
        expect(bareLoreKey("  Weiden ")).toBe("weiden");
        expect(bareLoreKey("inoffiziell-angbar")).toBe("inoffiziell-angbar");
        expect(bareLoreKey("wiki:inoffiziell-angbar")).toBe("inoffiziell-angbar");
        expect(bareLoreKey("wiki:ehernes-schwert-kontinent")).toBe("ehernes-schwert-kontinent");
    });

    it("Kontinentbegriffe stehen in Legacys fester Liste (neun)", () => {
        expect(CONTINENT_KEYS).toHaveLength(9);
        expect(isContinentKey("Aventurien")).toBe(true);
        expect(isContinentKey("wiki:myranor")).toBe(true);
        expect(isContinentKey("mittelaventurien")).toBe(false);
        expect(isContinentKey("inoffiziell-aventurien")).toBe(false);
    });

    it("der Fingerabdruck einer Regel hängt an Beziehung und geordneter Kette, nicht an der Reihenfolge der Arten oder dem Operator der ersten Bedingung", () => {
        const base = [
            { joinOp: "und" as const, areaPublicId: "AA", climateFrom: null, climateTo: null, types: [] },
            {
                joinOp: "oder" as const,
                areaPublicId: null,
                climateFrom: "polar",
                climateTo: "tropisch",
                types: [
                    { layer: "vegetation", type: "wald" },
                    { layer: "topographie", type: "gebirge" },
                ],
            },
        ];
        const key = ruleKeyOf("e", "verbreitung", base);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        expect(ruleKeyOf("e", "verbreitung", base)).toBe(key);
        // Die Arten einer Bedingung stehen als Menge, die Fläche in Kleinschreibung, der Operator der ersten Bedingung zählt nicht.
        const reordered = [
            { ...(base[0] as (typeof base)[number]), joinOp: "oder" as const, areaPublicId: "aa" },
            {
                ...(base[1] as (typeof base)[number]),
                types: [...(base[1] as (typeof base)[number]).types].reverse(),
            },
        ];
        expect(ruleKeyOf("e", "verbreitung", reordered)).toBe(key);
        // Die Reihenfolge der Bedingungen, die Beziehung, der Eintrag und der Operator der zweiten Bedingung zählen.
        expect(ruleKeyOf("e", "verbreitung", [base[1], base[0]] as typeof base)).not.toBe(key);
        expect(ruleKeyOf("e", "vorkommen", base)).not.toBe(key);
        expect(ruleKeyOf("f", "verbreitung", base)).not.toBe(key);
        expect(
            ruleKeyOf("e", "verbreitung", [
                base[0],
                { ...(base[1] as (typeof base)[number]), joinOp: "und" },
            ] as typeof base),
        ).not.toBe(key);
    });
});

describe("Fingerabdruck der Regeln: Goldwerte (rückwärtsgleich, WI-0254 Lage zu einer Linie)", () => {
    /**
     * 🔴 Der Fingerabdruck (`lore_rule.rule_key`) einer Regel OHNE Lage darf sich nie ändern: Er steht in jeder gespeicherten Regel, `UNIQUE (lore_entry_id, rule_key)` und die Erkennung „gleich“ der
     * nächsten Ableitung hängen daran. Die Werte unten sind die Literale von VOR der Bedingung „Lage zu einer Linie“ (gerechnet mit dem Stand `1ebc8ed05`); eine Änderung an `ruleKeyOf`, `regelSchluessel`
     * oder `bedSchluessel`, die eine Regel ohne Lage verschiebt, macht diesen Test rot. Wer den Fingerabdruck ändern WILL, braucht eine Migration der gespeicherten Schlüssel und eine Entscheidung dazu.
     */
    const K = {
        aventurien: "b0000000-0000-4000-9000-000000000001",
        meridiana: "b0000000-0000-4000-9000-000000000002",
        orkland: "B0000000-0000-4000-9000-000000000003",
    };
    const flaeche = (name: string, kennung: string | null, titel: string | null = null, offen = false) => ({
        name,
        id: kennung === null ? null : "1",
        kennung,
        offen,
        titel,
        kandidat: null,
    });
    const bed = (
        verknuepfung: Bed["verknuepfung"],
        fl: Bed["flaeche"],
        arten: Bed["arten"] = [],
        klima: Bed["klima"] = null,
    ): Bed => ({ verknuepfung, flaeche: fl, arten, klima, woerter: [], rueckfragen: [] });

    const KETTEN: Record<string, { kette: Bed[]; schluessel: string; kennung: string; bedingungen: string[] }> = {
        ohne: {
            kette: [
                bed("und", flaeche("Aventurien", K.aventurien), [{ ebene: "vegetation", art: "wald" }]),
                bed("oder", flaeche("Meridiana", K.meridiana)),
                bed("ohne", flaeche("Orkland", K.orkland)),
            ],
            schluessel: "8dea153316dba67eaa9833c6dabb15a21865cb0b333afbaac59f599715e107bb",
            kennung: "eb7fa2dfb8887784",
            bedingungen: [
                "mit|b0000000-0000-4000-9000-000000000001|vegetation/wald|",
                "mit|b0000000-0000-4000-9000-000000000002||",
                "ohne|B0000000-0000-4000-9000-000000000003||",
            ],
        },
        wartend: {
            kette: [
                bed("und", flaeche("Der Große Fluss", null, "Der Große Fluss", true), [
                    { ebene: "topographie", art: "flussland_flusstal" },
                ]),
            ],
            schluessel: "4babbd15eaf308e003e6cd08dc80836677cce7e8af965595280fe772dc87a916",
            kennung: "0e3fdb731df459ae",
            bedingungen: ["mit|wiki:der große fluss|topographie/flussland_flusstal|"],
        },
        arten: {
            kette: [
                bed("und", null, [
                    { ebene: "vegetation", art: "steppe" },
                    { ebene: "topographie", art: "gebirge" },
                ]),
            ],
            schluessel: "affd4384076fe43fc2ef8e1e4fded4f5f43fc77d179a5a056f0a19bf727017fb",
            kennung: "27e10f924fa0e93e",
            bedingungen: ["mit||topographie/gebirge,vegetation/steppe|"],
        },
        klima: {
            kette: [bed("und", null, [], { von: "polar", bis: "boreal" })],
            schluessel: "060e6066cb47c0212fa2f5460e665ab619fabe6ba8d4030074cdafac872203db",
            kennung: "d168787ba42320a1",
            bedingungen: ["mit|||polar-boreal"],
        },
        gemischt: {
            kette: [
                bed(
                    "und",
                    flaeche("Aventurien", K.aventurien),
                    [
                        { ebene: "vegetation", art: "wald" },
                        { ebene: "vegetation", art: "dschungel" },
                    ],
                    { von: "subtropisch", bis: "tropisch" },
                ),
                bed("oder", flaeche("Meridiana", K.meridiana), [{ ebene: "topographie", art: "huegelland" }]),
                bed("ohne", null, [{ ebene: "vegetation", art: "wueste" }]),
            ],
            schluessel: "d9b7fe07c36efbd977f38519c7a383c7b97cc88e597e638453c8aba774a34970",
            kennung: "54f1daae91344a48",
            bedingungen: [
                "mit|b0000000-0000-4000-9000-000000000001|vegetation/dschungel,vegetation/wald|subtropisch-tropisch",
                "mit|b0000000-0000-4000-9000-000000000002|topographie/huegelland|",
                "ohne||vegetation/wueste|",
            ],
        },
    };

    it("🔴 fünf Ketten ohne Lage (OHNE, wartende Fläche, Arten, Klima, gemischt) haben die Fingerabdrücke und Kennungen von vor der Lage", () => {
        for (const [name, fall] of Object.entries(KETTEN)) {
            expect(regelSchluessel("wiki-eintrag", "verbreitung", fall.kette), name).toBe(fall.schluessel);
            expect(ketteKennung(fall.kette), name).toBe(fall.kennung);
            expect(fall.kette.map(bedSchluessel), name).toEqual(fall.bedingungen);
        }
    });

    it("🔴 ruleKeyOf mit dem Fingerabdruck einer Regel ohne Lage: ein Eintrag ohne Wiki-Artikel, ohne und Klima, Art der Klima-Ebene", () => {
        expect(
            ruleKeyOf("avesmaps:a0000000-0000-4000-9000-000000000001", "herkunft", [
                { joinOp: "oder", areaPublicId: K.orkland, climateFrom: null, climateTo: null, types: [] },
                {
                    joinOp: "ohne",
                    areaPublicId: "wiki:der große fluss",
                    climateFrom: "boreal",
                    climateTo: "gemaessigt",
                    types: [
                        { layer: "vegetation", type: "wald" },
                        { layer: "klima", type: "x" },
                    ],
                },
            ]),
        ).toBe("d06be6b9a9c958e7486c4dcfe09f1bcab719dc737974b0db0123104f81c39e9f");
    });

    const ORT_A = { kennung: "c0000000-0000-4000-9000-00000000000a", name: "Gareth", x: 10, y: 20 };
    const ORT_B = { kennung: "C0000000-0000-4000-9000-00000000000B", name: "Havena", x: -30, y: 40 };
    const mitLage = (richtung: "nord" | "sued" | "ost" | "west", ...orte: (typeof ORT_A)[]): Bed[] => [
        { ...(KETTEN["klima"] as { kette: Bed[] }).kette[0]!, lage: { richtung, orte } },
    ];

    it("🔴 die Lage zu einer Linie ändert den Fingerabdruck NUR, wo sie da ist: undefined, null und fehlend sind dasselbe; mit Lage ist er ein anderer", () => {
        for (const [name, fall] of Object.entries(KETTEN)) {
            const ohne = regelSchluessel("wiki-eintrag", "verbreitung", fall.kette);
            // Ein `lage: undefined` (etwa aus einem Spread) ist keine Lage; der Typ verbietet es (`exactOptionalPropertyTypes`), die Laufzeit muss es trotzdem aushalten.
            const mitUndefined = fall.kette.map((b) => ({ ...b, lage: undefined }) as unknown as Bed);
            expect(regelSchluessel("wiki-eintrag", "verbreitung", mitUndefined), name).toBe(ohne);
            expect(mitUndefined.map(bedSchluessel), name).toEqual(fall.bedingungen);
            // Ein Eintrag der Rohform ohne Lage und mit `null` oder `undefined` gleicht dem ohne das Feld.
            const roh = [{ joinOp: "und" as const, areaPublicId: "aa", climateFrom: null, climateTo: null, types: [] }];
            const ohneFeld = ruleKeyOf("e", "verbreitung", roh);
            expect(ruleKeyOf("e", "verbreitung", [{ ...roh[0]!, lage: null }])).toBe(ohneFeld);
            expect(ruleKeyOf("e", "verbreitung", [{ ...roh[0]!, lage: undefined }])).toBe(ohneFeld);
            const mit = regelSchluessel("wiki-eintrag", "verbreitung", [
                { ...fall.kette[0]!, lage: { richtung: "sued", orte: [ORT_A] } },
                ...fall.kette.slice(1),
            ]);
            expect(mit, name).not.toBe(ohne);
            expect(mit, name).toMatch(/^[0-9a-f]{64}$/);
        }
        expect(ketteKennung(mitLage("sued", ORT_A))).not.toBe(ketteKennung(KETTEN["klima"]!.kette));
        expect(bedSchluessel(mitLage("sued", ORT_A)[0]!)).toBe(
            "mit|||polar-boreal|sued:c0000000-0000-4000-9000-00000000000a",
        );
    });

    it("🔴 Richtung und Orte gehen ein; die Reihenfolge der Orte (A–B ist B–A), Groß- und Kleinschreibung der Kennung, Name und Stelle nicht", () => {
        const schluessel = (kette: Bed[]): string => regelSchluessel("e", "verbreitung", kette);
        const grund = schluessel(mitLage("sued", ORT_A, ORT_B));
        expect(schluessel(mitLage("sued", ORT_B, ORT_A))).toBe(grund);
        expect(schluessel(mitLage("sued", { ...ORT_A, kennung: ORT_A.kennung.toUpperCase() }, ORT_B))).toBe(grund);
        expect(schluessel(mitLage("sued", { ...ORT_A, name: "Anders", x: 1, y: 2 }, ORT_B))).toBe(grund);
        // Die Richtung, die Zahl der Orte und die Orte selbst zählen.
        expect(schluessel(mitLage("nord", ORT_A, ORT_B))).not.toBe(grund);
        expect(schluessel(mitLage("sued", ORT_A))).not.toBe(grund);
        expect(schluessel(mitLage("sued", ORT_B))).not.toBe(schluessel(mitLage("sued", ORT_A)));
        const vier = new Set(
            (["nord", "sued", "ost", "west"] as const).map((richtung) => schluessel(mitLage(richtung, ORT_A))),
        );
        expect(vier.size).toBe(4);
        // Das sechste Feld ist `richtung:kennungen` (klein, sortiert, Komma): ruleKeyOf über die Rohform gibt denselben Wert.
        expect(
            ruleKeyOf("e", "verbreitung", [
                {
                    joinOp: "und",
                    areaPublicId: null,
                    climateFrom: "polar",
                    climateTo: "boreal",
                    types: [],
                    lage: { richtung: "sued", orte: [ORT_B.kennung, ORT_A.kennung] },
                },
            ]),
        ).toBe(grund);
        // Die Bedingungsschlüssel der Ableitung (Dubletten) kennen die Lage ebenso, in derselben Schreibweise.
        expect(bedSchluessel(mitLage("sued", ORT_B, ORT_A)[0]!)).toBe(bedSchluessel(mitLage("sued", ORT_A, ORT_B)[0]!));
    });
});

describe("Auflösung der Ortszeilen (derselbe Lookup wie die Objektlinks, nur über den Wiki-Schlüssel)", () => {
    const lookups = loreLookups();
    const resolve = (key: string, over: Partial<typeof lookups> = {}) => {
        const merged = { ...lookups, ...over };
        return resolveLorePlace(key, merged.wikiKeys, merged.carrierIds);
    };

    it("ein Treffer ist resolved, mehrere sind ambiguous (alle gespeichert), keiner ist unmatched", () => {
        expect(resolve("p68t-ort-a")).toMatchObject({
            keyClass: "other",
            state: "resolved",
            hits: [{ column: "place_id", id: "1" }],
        });
        expect(resolve("p68t-ort-geteilt")).toMatchObject({
            state: "ambiguous",
            hits: [
                { column: "place_id", id: "2" },
                { column: "place_id", id: "3" },
            ],
        });
        expect(resolve("p68t-gibtesnicht")).toMatchObject({ state: "unmatched", hits: [] });
        expect(resolve("")).toMatchObject({ state: "unmatched", hits: [] });
    });

    it("🔴 die Ortszeile geht durch DIESELBE Schleuse wie der Linkpfad: lookupWikiKeyTargets über wikiKeyOfLoreKey, wörtlich verglichen", () => {
        const keys = fixtureWikiKeys();
        expect(lookupWikiKeyTargets(keys, wikiKeyOfLoreKey("p68t-ort-a")).map((target) => target.kind)).toEqual([
            "place",
        ]);
        expect(lookupWikiKeyTargets(keys, wikiKeyOfLoreKey("wiki:p68t-ort-a")).map((target) => target.kind)).toEqual([
            "place",
        ]);
        // Der Lookup normalisiert nicht: andere Schreibweisen treffen nicht, auch nicht über die Lore.
        for (const spelling of ["P68T-Ort-A", "p68t ort a", "p68t-ort-a-"]) {
            expect(resolve(spelling).hits, spelling).toEqual([]);
        }
    });

    it("Orte, Gebiete, Landschaften und Gipfel sind die Ziele; eine Landschaft ist EIN Subject, ihr Ziel der Anker", () => {
        expect(resolve("wiki:p68t-gebiet-a").hits).toEqual([{ column: "territory_id", id: "10" }]);
        expect(resolve("p68t-gebiet-a").hits).toEqual([{ column: "territory_id", id: "10" }]);
        expect(resolve("p68t-region-a").hits).toEqual([{ column: "region_id", id: "20" }]);
        expect(resolve("p68t-gipfel-a").hits).toEqual([{ column: "terrain_peak_id", id: "30" }]);
        // Eine Gruppe gleichnamiger Regionen: der Lookup nennt den Anker (kleinste Kennung), die übrigen hängen als group an.
        const group = wikiKeysOf({
            "wiki:p68t-wald": [["area", { kind: "area", id: C.regionA, group: [C.regionInaktiv] }]],
        });
        expect(resolve("p68t-wald", { wikiKeys: group }).hits).toEqual([{ column: "region_id", id: "20" }]);
        // Ein Schlüssel, den Ort und Gebiet tragen, ist mehrdeutig (Art für Art in fester Reihenfolge, nie gewählt).
        const both = wikiKeysOf({
            "wiki:fasar": [
                ["territory", { kind: "territory", id: C.gebietA }],
                ["place", { kind: "place", id: C.ortA }],
            ],
        });
        const fasar = resolve("fasar", { wikiKeys: both });
        expect(fasar.state).toBe("ambiguous");
        expect(fasar.hits.map(hitCells)).toEqual([
            ["1", null, null, null],
            [null, "10", null, null],
        ]);
        // Ein Träger, dessen Kennung nicht zu den aktiven Zeilen gehört, ist kein Ziel.
        const unknown = wikiKeysOf({
            "wiki:fremd": [["place", { kind: "place", id: "00000000-0000-4000-8000-0000000000ff" }]],
        });
        expect(resolve("fremd", { wikiKeys: unknown })).toMatchObject({ state: "unmatched", hits: [] });
    });

    it("🔴 der Namensraum gehört zum Schlüssel: inoffiziell-… ist ein anderer Artikel, kein Treffer ohne eigenen Träger", () => {
        expect(resolve("inoffiziell-p68t-ort-a")).toMatchObject({ state: "unmatched", hits: [] });
        expect(resolve("p68t-inoffiziell-ort-a").hits).toEqual([{ column: "place_id", id: "9" }]);
        // Ein Präfix wiki: an der Ortszeile ändert den Artikel nicht, ein Namensraum davor sehr wohl.
        expect(resolve("wiki:p68t-ort-a").hits).toEqual([{ column: "place_id", id: "1" }]);
        // Trägt nur der inoffizielle Artikel ein Objekt, trifft der offizielle Schlüssel NICHT dieses.
        const onlyUnofficial = wikiKeysOf({ "wiki:inoffiziell-fasar": [["place", { kind: "place", id: C.ortA }]] });
        expect(resolve("fasar", { wikiKeys: onlyUnofficial }).hits).toEqual([]);
        expect(resolve("inoffiziell-fasar", { wikiKeys: onlyUnofficial }).hits).toEqual([
            { column: "place_id", id: "1" },
        ]);
    });

    it("ein Kontinentbegriff ohne Träger ist unresolved (kein Objekt gemeint), mit Träger behält er seine Ziele", () => {
        expect(resolve("aventurien")).toMatchObject({ keyClass: "continent", state: "unresolved", hits: [] });
        const withRegion = wikiKeysOf({ "wiki:aventurien": [["area", { kind: "area", id: C.regionA }]] });
        expect(resolve("aventurien", { wikiKeys: withRegion })).toMatchObject({
            keyClass: "continent",
            state: "resolved",
            hits: [{ column: "region_id", id: "20" }],
        });
    });

    it("ein Weg und eine Kraftlinie sind kein Zielraum: der Schlüssel bleibt unmatched und wird nur vermerkt", () => {
        expect(resolve("p68t-weg-a")).toMatchObject({ state: "unmatched", hits: [], pathOnly: true });
        const line = wikiKeysOf({ "wiki:p68t-linie": [["powerline", { kind: "powerline", anchor: C.wegA2 }]] });
        expect(resolve("p68t-linie", { wikiKeys: line })).toMatchObject({
            state: "unmatched",
            hits: [],
            pathOnly: true,
        });
        // Trägt ein Schlüssel einen Ort UND einen Weg, zählt nur der Ort (der Weg macht ihn nicht mehrdeutig).
        const mixed = wikiKeysOf({
            "wiki:p68t-doppelt": [
                ["place", { kind: "place", id: C.ortA }],
                ["path", { kind: "path", anchor: C.wegA1, wiki: "p68t-doppelt" }],
            ],
        });
        expect(resolve("p68t-doppelt", { wikiKeys: mixed })).toMatchObject({ state: "resolved", pathOnly: false });
    });

    it("kein Treffer über einen Namen: weder Titel noch Name noch match_key kommen im Lookup vor", () => {
        // Ein Ort mit dem NAMEN „C68T Ort A“ trägt keinen Schlüssel dieses Namens: der Lookup kennt nur Keys.
        expect(resolve("C68T Ort A").state).toBe("unmatched");
        expect(resolve("c68t-ort-a").state).toBe("unmatched");
    });

    it("das Vergleichsmaß (D6 und territory.wiki_key) bleibt für den Befund: es trifft ein Gebiet auch ohne Form", () => {
        const carriers = resolveLorePlaceByCarriers("wiki:p68t-gebiet-b", lookups.targets);
        expect(carriers.hits).toEqual([{ column: "territory_id", id: "11" }]);
        expect(resolve("wiki:p68t-gebiet-b").hits).toEqual([]);
    });
});

describe("transformLore: die Antwort", () => {
    const lookups = loreLookups();

    it("eine unbrauchbare Antwort schreibt nichts und meldet source_block_missing (kein Tor)", () => {
        for (const payload of [
            null,
            "x",
            {},
            { ok: false, entries: [] },
            { ok: true },
            { ok: true, entries: {}, places: [], rules: [], sources: [], links: [] },
            { ok: true, entries: [], places: [], rules: [], sources: [] },
        ]) {
            const result = transformLore(payload, lookups);
            expect(result.skipped).toBe(true);
            expect(codes(result.findings)).toEqual(["source_block_missing"]);
        }
    });

    it("keine Einträge: leer ohne Notaus ist source_empty_catalog, mit abgeschalteten Arten source_switched_off", () => {
        expect(codes(transformLore(answer({ entries: [] }), lookups).findings)).toEqual(["source_empty_catalog"]);
        const off = transformLore(
            answer({ entries: [], kinds: { flora: false, fauna: false, spezies: false, ware: false }, withheld: 40 }),
            lookups,
        );
        expect(off.skipped).toBe(true);
        expect(codes(off.findings)).toEqual(["source_switched_off"]);
        expect(off.withheldKinds).toEqual(["fauna", "flora", "spezies", "ware"]);
    });

    it("ein Kopfzähler, der nicht zur Liste passt, ist eine unvollständige Quelle: nichts wird geschrieben", () => {
        const good = answer({ entries: [entry("p74t-a", "flora")], places: [place("p74t-a", "p68t-ort-a")] });
        expect(transformLore(good, lookups).skipped).toBe(false);
        for (const counts of ["entries", "places", "rules", "rule_terms", "rule_term_types", "sources", "links"]) {
            const broken = { ...good, counts: { ...(good["counts"] as Bag), [counts]: 99 } };
            const result = transformLore(broken, lookups);
            expect(result.skipped, counts).toBe(true);
            expect(codes(result.findings)).toEqual(["source_counts_disagree"]);
        }
        const withoutCounts = { ...good, counts: undefined };
        expect(codes(transformLore(withoutCounts, lookups).findings)).toEqual(["source_counts_disagree"]);
    });

    it("übernimmt Felder wörtlich, ein leerer Wert ist NULL, der Zustand folgt dem Status der Quelle", () => {
        const result = transformLore(
            answer({
                entries: [
                    entry("p74t-a", "flora", {
                        name: "P74T Alraune",
                        wiki_title: "Alraune",
                        wiki_url: "https://de.wiki-aventurica.de/wiki/Alraune",
                        gruppe: "Heilpflanze",
                        typ: "",
                        lebensraum: "  ",
                        synonyme: "Mandragora",
                        continent: "Aventurien",
                        origin: "manual",
                        match_key: "alraune",
                    }),
                    entry("p74t-b", "ware", { status: "suppressed" }),
                    entry("p74t-c", "fauna", { status: "retired", origin: "irgendwas" }),
                ],
            }),
            lookups,
        );
        expect(result.entries).toHaveLength(3);
        expect(result.entries[0]).toMatchObject({
            wikiKey: "p74t-a",
            kind: "flora",
            wikiTitle: "Alraune",
            gruppe: "Heilpflanze",
            typ: null,
            lebensraum: null,
            synonyme: "Mandragora",
            continent: "Aventurien",
            legacyOrigin: "manual",
            matchKey: "alraune",
            state: "active",
        });
        expect(result.entries.map((row) => row.state)).toEqual(["active", "suppressed", "retired"]);
        expect(result.entries[2]?.legacyOrigin).toBe("unknown");
        expect(find(result.findings, "origin_value_unknown")?.objectCount).toBe(1);
        expect(Object.keys(result.entries[0] as object)).not.toContain("merkmale");
    });

    it("Einträge ohne Schlüssel, Art, Status oder Namen sind nicht speicherbar; ein doppelter Schlüssel: der erste gilt", () => {
        const result = transformLore(
            answer({
                entries: [
                    entry("p74t-a", "flora"),
                    entry("", "flora"),
                    entry("p74t-b", "pilz"),
                    entry("p74t-c", "fauna", { status: "geloescht" }),
                    entry("p74t-d", "fauna", { name: "  " }),
                    entry("p74t-a", "fauna", { name: "P74T Zweit" }),
                ],
            }),
            lookups,
        );
        expect(result.entries.map((row) => row.wikiKey)).toEqual(["p74t-a"]);
        expect(find(result.findings, "entry_wiki_key_invalid")?.objectCount).toBe(1);
        expect(find(result.findings, "kind_unknown")?.objectCount).toBe(1);
        expect(find(result.findings, "status_value_unknown")?.objectCount).toBe(1);
        expect(find(result.findings, "entry_name_invalid")?.objectCount).toBe(1);
        expect(find(result.findings, "entry_duplicate_key")?.objectCount).toBe(1);
        expect(result.entries[0]?.name).toBe("P74T p74t-a");
    });

    it("die Herkunft je Feld kommt als Objekt oder als JSON-Text; merkmale_json heißt merkmale; ein Wert ausserhalb wird nicht gespeichert", () => {
        const result = transformLore(
            answer({
                entries: [
                    entry("p74t-a", "flora", {
                        field_origins: { gruppe: "manual", merkmale_json: "wiki", name: "kaputt", unbekannt: "wiki" },
                    }),
                    entry("p74t-b", "flora", { field_origins: JSON.stringify({ lebensraum: "manual" }) }),
                    entry("p74t-c", "flora", { field_origins: null }),
                ],
            }),
            lookups,
        );
        expect(result.entries[0]?.fieldOrigins).toEqual([
            { field: "gruppe", origin: "manual" },
            { field: "merkmale", origin: "wiki" },
        ]);
        expect(result.entries[1]?.fieldOrigins).toEqual([{ field: "lebensraum", origin: "manual" }]);
        expect(result.entries[2]?.fieldOrigins).toEqual([]);
        expect(find(result.findings, "field_origin_unknown")?.objectCount).toBe(1);
    });

    it("Adressen ohne http oder https, Namen mit Wikimarkup und zu lange Texte sind Befunde, nichts wird repariert", () => {
        const result = transformLore(
            answer({
                entries: [
                    entry("p74t-a", "flora", { wiki_url: "ftp://x.example/a", name: "P74T [[Alraune]]" }),
                    entry("p74t-b", "flora", { lebensraum: "x".repeat(501) }),
                ],
            }),
            lookups,
        );
        expect(result.entries[0]).toMatchObject({ wikiUrl: null, name: "P74T [[Alraune]]" });
        expect(find(result.findings, "link_scheme_rejected")?.objectCount).toBe(1);
        expect(find(result.findings, "entry_name_markup")?.objectCount).toBe(1);
        expect(find(result.findings, "text_exceeds_legacy_limit")?.objectCount).toBe(1);
        expect(result.entries[1]?.lebensraum).toHaveLength(501);
    });

    it("Merkmale werden nicht übernommen, nur gezählt; Negationen und Doppellinks im Rohtext sind Information", () => {
        const result = transformLore(
            answer({
                entries: [
                    entry("p74t-a", "flora", {
                        merkmale: { verbreitung: "[[Weiden]] außer [[Kosch]]", groesse: "klein" },
                    }),
                    entry("p74t-b", "fauna", { merkmale: { herkunft: "[[Schaf]]s[[wolle]]" } }),
                    entry("p74t-c", "fauna", { merkmale: { verbreitung: "[[Weiden]], [[Kosch]]" } }),
                ],
            }),
            lookups,
        );
        const census = find(result.findings, "merkmale_census");
        expect(census?.numbers).toMatchObject({ flora: 1, fauna: 2, schluessel: 4 });
        expect(find(result.findings, "negation_in_source_text")?.objectCount).toBe(1);
        expect(find(result.findings, "double_link_in_source_text")?.objectCount).toBe(1);
    });

    it("eine Personenspalte steht nur als Name im Befund, nie als Wert, und wird nie gelesen", () => {
        const result = transformLore(
            answer({
                entries: [entry("p74t-a", "flora")],
                rules: [
                    rule("p74t-a", [term(0, { region_types: [{ kind: "vegetation", region_type: "wald" }] })], {
                        created_by: 4242,
                    }),
                ],
            }),
            lookups,
        );
        const finding = find(result.findings, "personal_column_in_export");
        expect(finding?.numbers["schluessel"]).toBe("created_by");
        expect(JSON.stringify(finding)).not.toContain("4242");
        expect(JSON.stringify(result.rules)).not.toContain("4242");
    });

    it("die Revision der Antwort gegen die der Karte desselben Zuges: Abweichung ist Information", () => {
        const payload = answer({ entries: [entry("p74t-a", "flora")] });
        expect(codes(transformLore(payload, lookups, 812).findings)).not.toContain("source_revision_differs");
        expect(codes(transformLore(payload, lookups, 900).findings)).toContain("source_revision_differs");
        expect(codes(transformLore(payload, lookups, null).findings)).not.toContain("source_revision_differs");
    });

    it("Notaus je Art: die abgeschaltete Art wird gemeldet und ist in withheldKinds, die Antwort bleibt brauchbar", () => {
        const result = transformLore(
            answer({
                entries: [entry("p74t-a", "flora")],
                kinds: { flora: true, fauna: true, spezies: false, ware: true },
                withheld: 3,
            }),
            lookups,
        );
        expect(result.skipped).toBe(false);
        expect(result.withheldKinds).toEqual(["spezies"]);
        expect(find(result.findings, "kind_withheld")?.numbers).toMatchObject({ zurueckgehalten: 3, arten: "spezies" });
    });

    describe("Ortszeilen", () => {
        const entries = [entry("p74t-a", "flora"), entry("p74t-b", "ware")];

        it("löst jede Zeile über den Schlüssel auf; der Zustand je Zeile folgt der Quelle, Grabsteine bleiben stehen", () => {
            const result = transformLore(
                answer({
                    entries,
                    places: [
                        place("p74t-a", "p68t-ort-a"),
                        place("p74t-a", "wiki:p68t-gebiet-a", { sort_order: 1 }),
                        place("p74t-a", "p68t-ort-geteilt", { sort_order: 2 }),
                        place("p74t-a", "aventurien", { sort_order: 3 }),
                        place("p74t-a", "p68t-kosch", { sort_order: 4, status: "suppressed" }),
                        place("p74t-a", "inoffiziell-p68t-ort-a", {
                            sort_order: 9999,
                            origin: "manual",
                            relation: "vorkommen",
                        }),
                        place("p74t-b", "p68t-region-a", { relation: "herkunft" }),
                    ],
                }),
                lookups,
            );
            expect(result.places.map((row) => [row.placeWikiKey, row.targetState, row.hits.length, row.state])).toEqual(
                [
                    ["p68t-ort-a", "resolved", 1, "active"],
                    ["wiki:p68t-gebiet-a", "resolved", 1, "active"],
                    ["p68t-ort-geteilt", "ambiguous", 2, "active"],
                    ["aventurien", "unresolved", 0, "active"],
                    ["p68t-kosch", "unmatched", 0, "suppressed"],
                    ["inoffiziell-p68t-ort-a", "unmatched", 0, "active"],
                    ["p68t-region-a", "resolved", 1, "active"],
                ],
            );
            expect(result.places[5]).toMatchObject({
                keyClass: "other",
                legacyOrigin: "manual",
                relation: "vorkommen",
                sortOrder: 9999,
            });
            expect(result.places[3]?.keyClass).toBe("continent");
            expect(result.totals).toEqual({
                places: { resolved: 3, ambiguous: 1, unresolved: 1, unmatched: 2 },
                targets: 5,
            });
            expect(find(result.findings, "place_tombstone")?.numbers).toEqual({ flora: 1 });
            expect(find(result.findings, "place_manual_row")?.objectCount).toBe(1);
            expect(find(result.findings, "place_unresolved_continent")?.numbers).toEqual({ zeilen: 1 });
            expect(find(result.findings, "place_target_ambiguous")?.message).toContain("Ort (mehrere) 1");
            expect(find(result.findings, "place_unmatched")?.objectCount).toBe(2);
            expect(find(result.findings, "place_key_space_probe")?.numbers).toMatchObject({ zeilen: 6, treffer: 4 });
        });

        it("eine unbekannte Beziehung wird verbreitung, eine Dublette ist eine Zeile, ohne Eintrag oder Schlüssel nicht speicherbar", () => {
            const result = transformLore(
                answer({
                    entries,
                    places: [
                        place("p74t-a", "p68t-ort-a", { relation: "sonstwo" }),
                        place("p74t-a", "p68t-ort-a", { relation: "verbreitung" }),
                        place("p74t-a", "p68t-ort-a", { relation: "herkunft" }),
                        place("p74t-fehlt", "p68t-ort-a"),
                        place("p74t-a", "  "),
                        place("p74t-a", "p68t-ort-a", { sort_order: "x", relation: "regionen" }),
                        place("p74t-a", "p68t-ort-a", { status: "geloescht", relation: "vorkommen" }),
                    ],
                }),
                lookups,
            );
            expect(result.places.map((row) => row.relation)).toEqual(["verbreitung", "herkunft"]);
            expect(find(result.findings, "relation_unknown")?.objectCount).toBe(1);
            expect(find(result.findings, "place_duplicate_key")?.objectCount).toBe(1);
            expect(find(result.findings, "place_without_entry")?.objectCount).toBe(1);
            expect(find(result.findings, "place_key_invalid")?.objectCount).toBe(1);
            expect(find(result.findings, "place_row_unusable")?.objectCount).toBe(2);
        });

        it("🔴 wo der Lookup anders auflöst als das Vergleichsmaß (D6 und territory.wiki_key), steht ein Befund; gespeichert ist der Lookup, nichts wird angeglichen", () => {
            const base = fixtureWikiKeys();
            const extra = wikiKeysOf({
                // Nur der Lookup kennt diesen Ort (das Vergleichsmaß hat keinen Schnappschuss dazu).
                "wiki:p68t-nur-lookup": [["place", { kind: "place", id: C.ortA }]],
            });
            const keys = { ...base, byKey: new Map([...base.byKey, ...extra.byKey]) };
            const result = transformLore(
                answer({
                    entries,
                    places: [
                        // Das Gebiet B hat keine abgeleitete Form (nicht im Lookup), das Vergleichsmaß trifft es über territory.wiki_key.
                        place("p74t-a", "wiki:p68t-gebiet-b"),
                        place("p74t-a", "p68t-nur-lookup", { sort_order: 1 }),
                        // Beide Wege treffen dasselbe: kein Befund.
                        place("p74t-a", "p68t-ort-a", { sort_order: 2 }),
                    ],
                }),
                loreLookups({ wikiKeys: keys }),
            );
            expect(result.places.map((row) => [row.placeWikiKey, row.targetState, row.hits.length])).toEqual([
                ["wiki:p68t-gebiet-b", "unmatched", 0],
                ["p68t-nur-lookup", "resolved", 1],
                ["p68t-ort-a", "resolved", 1],
            ]);
            const finding = find(result.findings, "place_target_differs_from_carriers");
            expect(finding?.numbers).toMatchObject({ zeilen: 2, nur_traegermodell_Gebiet: 1, nur_lookup_Ort: 1 });
            expect(finding?.objectCount).toBe(2);
            expect(finding?.message).toContain("nichts wird angeglichen");
        });

        it("ein leerer Lookup (die Zuordnung X2, Schritt I24, fehlt) lässt jede Ortszeile ohne Ziel und sagt es: wiki_key_lookup_empty", () => {
            const result = transformLore(
                answer({
                    entries,
                    places: [place("p74t-a", "p68t-ort-a"), place("p74t-a", "aventurien", { sort_order: 1 })],
                }),
                loreLookups({ wikiKeys: wikiKeysOf({}) }),
            );
            expect(result.places.map((row) => [row.targetState, row.hits.length])).toEqual([
                ["unmatched", 0],
                ["unresolved", 0],
            ]);
            expect(find(result.findings, "wiki_key_lookup_empty")?.numbers).toEqual({ zeilen: 2 });
            // Das Vergleichsmaß trifft den Ort noch, der Unterschied liegt an der fehlenden Zuordnung: kein zweiter Befund darüber.
            expect(codes(result.findings)).not.toContain("place_target_differs_from_carriers");
        });

        it("ein Schlüssel, der nur eine Wegegruppe trifft, wird vermerkt und bleibt unmatched", () => {
            const result = transformLore(answer({ entries, places: [place("p74t-a", "p68t-weg-a")] }), lookups);
            expect(result.places[0]).toMatchObject({ targetState: "unmatched", hits: [] });
            expect(find(result.findings, "place_key_matches_path_only")?.objectCount).toBe(1);
        });
    });

    describe("Regeln", () => {
        const entries = [entry("p74t-a", "flora")];
        const wald = { kind: "vegetation", region_type: "wald" };

        it("die Bedingungen stehen in der Reihenfolge von seq, Fläche und Klima sind aufgelöst, die Legacy-Werte bleiben als Text", () => {
            const result = transformLore(
                answer({
                    entries,
                    rules: [
                        rule("p74t-a", [
                            term(1, { join_op: "oder", climate_from: "gemaessigt", climate_to: "subtropisch" }),
                            term(0, { area_public_id: C.regionA.toUpperCase(), region_types: [wald, wald] }),
                        ]),
                    ],
                }),
                lookups,
            );
            expect(result.rules).toHaveLength(1);
            const [first, second] = result.rules[0]?.terms ?? [];
            expect(first).toMatchObject({
                seq: 0,
                joinOp: "und",
                areaRegionId: "20",
                legacyAreaPublicId: C.regionA.toUpperCase(),
                types: [{ layer: "vegetation", type: "wald" }],
            });
            expect(second).toMatchObject({
                seq: 1,
                joinOp: "oder",
                areaRegionId: null,
                climateFrom: "gemaessigt",
                climateTo: "subtropisch",
                legacyClimateFrom: "gemaessigt",
            });
            expect(result.rules[0]?.ruleKey).toMatch(/^[0-9a-f]{64}$/);
        });

        it("eine inaktive oder fehlende Fläche lässt die Bedingung stehen; ein unbekannter Klimaendpunkt gibt beide NULL; eine unbekannte Art ist ein Befund", () => {
            const result = transformLore(
                answer({
                    entries,
                    rules: [
                        rule("p74t-a", [
                            term(0, { area_public_id: C.regionInaktiv }),
                            term(1, { join_op: "oder", area_public_id: "00000000-0000-4000-8000-0000000000aa" }),
                            term(2, { join_op: "oder", climate_from: "gemaessigt", climate_to: "nirgends" }),
                            term(3, { join_op: "oder", climate_from: "polar" }),
                            term(4, {
                                join_op: "oder",
                                region_types: [{ kind: "vegetation", region_type: "p74t-art" }],
                            }),
                            term(5, { join_op: "oder" }),
                        ]),
                    ],
                }),
                lookups,
            );
            const terms = result.rules[0]?.terms ?? [];
            expect(terms[0]).toMatchObject({ areaRegionId: null, legacyAreaPublicId: C.regionInaktiv });
            expect(terms[1]).toMatchObject({ areaRegionId: null });
            expect(terms[2]).toMatchObject({
                climateFrom: null,
                climateTo: null,
                legacyClimateFrom: "gemaessigt",
                legacyClimateTo: "nirgends",
            });
            expect(terms[3]).toMatchObject({
                climateFrom: null,
                climateTo: null,
                legacyClimateFrom: "polar",
                legacyClimateTo: null,
            });
            expect(find(result.findings, "rule_area_unmatched")?.objectCount).toBe(2);
            expect(find(result.findings, "rule_climate_unknown_key")?.objectCount).toBe(2);
            expect(find(result.findings, "rule_type_unknown")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_term_empty")?.objectCount).toBe(1);
        });

        it("Regeln ohne Bedingung, ohne Eintrag oder nicht aktiv werden nicht gespeichert; gleicher Inhalt ist eine Regel; über 25 Bedingungen bleiben stehen", () => {
            const many = Array.from({ length: 26 }, (_, n) =>
                term(n, { join_op: "oder", climate_from: "polar", climate_to: "tropisch" }),
            );
            const result = transformLore(
                answer({
                    entries,
                    rules: [
                        rule("p74t-a", [term(0, { region_types: [wald] })]),
                        rule("p74t-a", [term(0, { region_types: [wald] })], { origin: "wiki_verbreitung" }),
                        rule("p74t-a", []),
                        rule("p74t-fehlt", [term(0, { region_types: [wald] })]),
                        rule("p74t-a", [term(0, { region_types: [wald] })], { status: "retired" }),
                        rule("p74t-a", many),
                    ],
                }),
                lookups,
            );
            expect(result.rules).toHaveLength(2);
            expect(find(result.findings, "rule_duplicate_content")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_without_terms")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_without_entry")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_status_not_active")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_too_many_terms")?.objectCount).toBe(1);
            expect(find(result.findings, "rule_gain_measurement")?.numbers).toMatchObject({ regeln: 2, ketten: 1 });
        });

        it("die Identität ändert sich mit dem Inhalt, nicht mit Herkunft, Reihenfolge der Arten oder Kennung der Regel", () => {
            const keyOf = (over: Bag, terms: Bag[]): string | undefined =>
                transformLore(answer({ entries, rules: [rule("p74t-a", terms, over)] }), lookups).rules[0]?.ruleKey;
            const base = [term(0, { region_types: [wald, { kind: "vegetation", region_type: "sumpf" }] })];
            const a = keyOf({ id: 1, origin: "manual", sort_order: 0 }, base);
            expect(keyOf({ id: 99, origin: "wiki_verbreitung", sort_order: 5 }, base)).toBe(a);
            expect(keyOf({}, [term(0, { region_types: [{ kind: "vegetation", region_type: "sumpf" }, wald] })])).toBe(
                a,
            );
            expect(keyOf({}, [term(0, { region_types: [wald] })])).not.toBe(a);
        });
    });

    describe("Quellenverknüpfungen", () => {
        const entries = [entry("p74t-a", "flora"), entry("p74t-b", "ware")];
        const sources = [
            zooRow(1),
            kraeuterRow(2),
            catalogRow(3, { url: "https://p74test.example/fehlt", url_hash: sha256("https://p74test.example/fehlt") }),
        ];

        it("löst die Quelle über die Identität der Katalogzeile auf (Adresse oder wiki_key), nicht über die Nummer", () => {
            const result = transformLore(
                answer({
                    entries,
                    sources,
                    links: [
                        link("p74t-a", 1, { status: "suppressed", pages: "88", position: 0 }),
                        link("p74t-a", 2, {
                            origin: "manual",
                            reference_kind: null,
                            position: 1,
                            note: "{{R5}} Seite 3",
                        }),
                        link("p74t-b", 3),
                    ],
                }),
                lookups,
            );
            expect(
                result.links.map((row) => [
                    row.entryWikiKey,
                    row.sourceId,
                    row.state,
                    row.legacyOrigin,
                    row.referenceKind,
                    row.position,
                ]),
            ).toEqual([
                ["p74t-a", "501", "suppressed", "wiki_publication", "ausfuehrlich", 0],
                ["p74t-a", "502", "active", "manual", null, 1],
            ]);
            expect(find(result.findings, "lore_source_unresolved")?.objectCount).toBe(1);
            expect(find(result.findings, "lore_source_kind_unexpected")?.objectCount).toBe(1);
            expect(find(result.findings, "source_note_markup")?.objectCount).toBe(1);
        });

        it("Dubletten desselben (Eintrag, Quelle) werden eine Zeile; ohne Eintrag oder mit unbekanntem Status nicht gespeichert; die Art ausserhalb der Liste ist eine echte Quelle", () => {
            const result = transformLore(
                answer({
                    entries,
                    sources,
                    links: [
                        link("p74t-a", 1),
                        link("p74t-a", 1, { position: 7 }),
                        link("p74t-fehlt", 1),
                        link("p74t-b", 2, { status: "offen" }),
                        link("p74t-b", 2, { reference_kind: "kapitel", position: undefined }),
                        { entity_type: "settlement", entity_public_id: "p74t-a", source_id: 2, status: "approved" },
                    ],
                }),
                lookups,
            );
            expect(result.links).toHaveLength(2);
            expect(find(result.findings, "lore_source_links_collapsed")?.objectCount).toBe(1);
            expect(find(result.findings, "lore_link_orphan")?.objectCount).toBe(1);
            expect(find(result.findings, "link_status_unknown")?.objectCount).toBe(1);
            expect(find(result.findings, "lore_link_unusable")?.objectCount).toBe(1);
            expect(find(result.findings, "reference_kind_unknown")?.objectCount).toBe(1);
            expect(result.links[1]).toMatchObject({ referenceKind: null, position: 0 });
        });

        it("ein url_hash, der nicht zu Adresse oder wiki_key passt, ist Information; die Identität folgt Adresse und wiki_key", () => {
            const result = transformLore(
                answer({
                    entries,
                    sources: [zooRow(1), catalogRow(2, { url: "https://p74test.example/kraeuter", url_hash: "00" })],
                    links: [link("p74t-a", 1), link("p74t-a", 2)],
                }),
                lookups,
            );
            expect(find(result.findings, "lore_source_hash_mismatch")?.objectCount).toBe(1);
            expect(result.links).toHaveLength(2);
        });

        it("eine Quelle ohne Adresse und ohne wiki_key trägt nur die vorläufige Identität (Befund), bleibt aber auflösbar", () => {
            const result = transformLore(
                answer({
                    entries,
                    sources: [catalogRow(7)],
                    links: [link("p74t-a", 7)],
                }),
                loreLookups({ sources: new Map([["legacy-id:7", "507"]]) }),
            );
            expect(result.links[0]?.sourceId).toBe("507");
            expect(find(result.findings, "lore_source_provisional")?.objectCount).toBe(1);
        });
    });
});

/**
 * Die Beispielantwort, die Legacy mit dem Export mitliefert (`docs/legacy-exporte/lore-export.beispiel.json`, Mirror `024e3af3d`): zwei
 * Einträge, einer davon von Hand unterdrückt, ein Grabstein und ein von Hand hinzugefügter Ort im Namensraum „Inoffiziell:“, zwei
 * Regeln samt Bedingungen und Regionstypen, zwei Quellenverknüpfungen mit Herkunft und Zustand, eine abgeschaltete Art (spezies).
 * Einzige Änderung: Legacys Kopfzähler nennen die ungekürzte Antwort, sie sind hier an die gekürzten Listen angepasst.
 */
const legacySample = (): Bag =>
    JSON.parse(readFileSync(new URL("./fixtures/lore-export-beispiel.json", import.meta.url), "utf8")) as Bag;
const SAMPLE_AREA = "8d0c2a3e-0000-4000-8000-000000000001";
const SAMPLE_ZOO_KEY = "wikipub:wiki:zoo-botanica-aventurica";
const SAMPLE_KRAEUTER_KEY = `url:${sha256("https://example.org/kraeuterkunde")}`;

describe("die Beispielantwort von Legacy (E2 und E2+, gekürzt)", () => {
    const lookups = loreLookups({
        regions: new Map([[SAMPLE_AREA, { id: "20", active: true }]]),
        regionTypes: new Set(["vegetation|wald", "vegetation|auwald", "vegetation|sumpf"]),
        sources: new Map([
            [SAMPLE_ZOO_KEY, "701"],
            [SAMPLE_KRAEUTER_KEY, "702"],
        ]),
    });
    const result = transformLore(legacySample(), lookups, 812);

    it("ist brauchbar: die Kopfzähler passen, die Revision stimmt, die abgeschaltete Art ist vermerkt", () => {
        expect(result.skipped).toBe(false);
        expect(result.revision).toEqual({ map: 812, lore: "lore-3b9e1d7c50a2f846" });
        expect(result.withheldKinds).toEqual(["spezies"]);
        expect(find(result.findings, "kind_withheld")?.numbers).toMatchObject({ zurueckgehalten: 1, arten: "spezies" });
        expect(codes(result.findings)).not.toContain("source_revision_differs");
        expect(codes(result.findings)).not.toContain("personal_column_in_export");
        expect(codes(result.findings)).not.toContain("lore_source_hash_mismatch");
    });

    it("die Einträge: Felder wörtlich, der unterdrückte Eintrag bleibt stehen, die Herkunft je Feld und match_key kommen mit", () => {
        expect(result.entries.map((row) => [row.wikiKey, row.kind, row.state, row.legacyOrigin])).toEqual([
            ["wiki:alraune", "flora", "active", "wiki"],
            ["wiki:leinoel", "ware", "suppressed", "wiki"],
        ]);
        expect(result.entries[0]).toMatchObject({
            name: "Alraune",
            wikiTitle: "Alraune",
            wikiUrl: "https://de.wiki-aventurica.de/wiki/Alraune",
            gruppe: "Heilpflanze",
            typ: "Kraut",
            lebensraum: "Wald",
            synonyme: "Mandragora",
            continent: "Aventurien",
            matchKey: "alraune",
            fieldOrigins: [{ field: "gruppe", origin: "manual" }],
        });
        // Legacys gespeicherter Vergleichsschlüssel wird wörtlich übernommen, auch wenn er nach einer Umbenennung veraltet sein kann.
        expect(result.entries[1]).toMatchObject({ wikiUrl: null, gruppe: null, matchKey: "leinl", fieldOrigins: [] });
        expect(find(result.findings, "merkmale_census")?.numbers).toMatchObject({ flora: 1, schluessel: 1 });
    });

    it("die Ortszeilen: der Grabstein bleibt, die Handarbeit im Namensraum Inoffiziell: trifft nur ihren eigenen Schlüssel", () => {
        expect(
            result.places.map((row) => [row.placeWikiKey, row.relation, row.sortOrder, row.legacyOrigin, row.state]),
        ).toEqual([
            ["wiki:kosch", "verbreitung", 1, "wiki", "suppressed"],
            ["wiki:inoffiziell-angbarer-kraeutergarten", "vorkommen", 9999, "manual", "active"],
        ]);
        // Der Titel ist nur Anzeige: „Inoffiziell:Angbarer Kräutergarten“ löst nie über seinen Namen auf.
        expect(result.places[1]).toMatchObject({
            placeTitle: "Inoffiziell:Angbarer Kräutergarten",
            targetState: "unmatched",
            hits: [],
        });
        expect(find(result.findings, "place_tombstone")?.numbers).toEqual({ flora: 1 });
    });

    it("die Regeln: Bedingungen in Reihenfolge, Fläche aufgelöst, Klimaspanne als Paar, Arten als Menge; die Regelnummer wird nicht übernommen", () => {
        expect(result.rules.map((row) => [row.legacyOrigin, row.relation, row.terms.length])).toEqual([
            ["manual", "verbreitung", 2],
            ["wiki_verbreitung", "verbreitung", 1],
        ]);
        expect(result.rules[0]?.terms[0]).toMatchObject({
            seq: 0,
            areaRegionId: "20",
            legacyAreaPublicId: SAMPLE_AREA,
            types: [{ layer: "vegetation", type: "wald" }],
        });
        expect(result.rules[0]?.terms[1]).toMatchObject({
            seq: 1,
            joinOp: "oder",
            climateFrom: "gemaessigt",
            climateTo: "subtropisch",
        });
        expect(result.rules[1]?.terms[0]?.types).toEqual([
            { layer: "vegetation", type: "auwald" },
            { layer: "vegetation", type: "sumpf" },
        ]);
        expect(JSON.stringify(result.rules)).not.toContain('"id"');
    });

    it("die Quellenverknüpfungen: die unterdrückte Publikation und die Handarbeit, Reihenfolge und Herkunft von Legacy", () => {
        expect(
            result.links.map((row) => [
                row.entryWikiKey,
                row.sourceId,
                row.state,
                row.legacyOrigin,
                row.referenceKind,
                row.pages,
                row.position,
            ]),
        ).toEqual([
            ["wiki:alraune", "701", "suppressed", "wiki_publication", "ausfuehrlich", "88", 0],
            ["wiki:alraune", "702", "active", "manual", null, null, 1],
        ]);
    });
});
// ======================================================================================================================================
// Datenbank
// ======================================================================================================================================

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const A = "p74t-alraune";
const B = "p74t-leinoel";
const G = "p74t-goblin";
const W = "p74t-weizen";
const S = "p74t-ork";

describeWithDatabase("Lore: Import, Zustände, Notaus, Idempotenz und Prüfer gegen PostgreSQL (Migration 0074)", () => {
    let database: Database;
    let ids: LoreIds;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanLoreFixtures(database);
    }, 180_000);

    afterAll(async () => {
        await cleanLoreFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanLoreFixtures(database);
        ids = await insertLoreFixtures(database);
    });

    const wald = { kind: "vegetation", region_type: "wald" };

    /** Eine Antwort, die jeden Fall trägt: alle vier Zustände der Auflösung, Grabstein, Namensraum, Regeln, Quellen. */
    function fullAnswer(
        over: { entries?: Bag[]; kinds?: Record<string, boolean>; withheld?: number; links?: Bag[] } = {},
    ): Bag {
        return answer({
            entries: over.entries ?? [
                entry(A, "flora", {
                    name: "P74T Alraune",
                    wiki_title: "Alraune",
                    wiki_url: "https://de.wiki-aventurica.de/wiki/Alraune",
                    gruppe: "Heilpflanze",
                    typ: "Kraut",
                    lebensraum: "Wald",
                    synonyme: "Mandragora",
                    continent: "Aventurien",
                    merkmale: { verbreitung: "[[Weiden]], [[Kosch]]" },
                    field_origins: { gruppe: "manual", merkmale_json: "wiki" },
                }),
                entry(B, "ware", { status: "suppressed", name: "P74T Leinöl" }),
                entry(G, "fauna", { status: "retired" }),
                entry(W, "ware", { name: "P74T Weizen" }),
                entry(S, "spezies", { name: "P74T Ork" }),
            ],
            places: [
                place(A, "p68t-ort-a", { sort_order: 0 }),
                place(A, "wiki:p68t-gebiet-b", { sort_order: 1 }),
                place(A, "p68t-ort-geteilt", { sort_order: 2 }),
                place(A, "aventurien", { sort_order: 3 }),
                place(A, "p68t-region-a", { sort_order: 0, relation: "regionen" }),
                place(A, "p68t-gipfel-a", { sort_order: 1, relation: "regionen" }),
                place(A, "p68t-weg-a", { sort_order: 4 }),
                place(A, "p68t-gibtesnicht", { sort_order: 0, relation: "herkunft" }),
                place(A, "p68t-kosch", { sort_order: 5, status: "suppressed" }),
                place(A, "inoffiziell-p68t-ort-a", { sort_order: 9999, origin: "manual", relation: "vorkommen" }),
                place(A, "p68t-inoffiziell-ort-a", { sort_order: 9999, origin: "manual", relation: "vorkommen" }),
                place(A, "p68t-ort-a", { sort_order: 6 }),
                place(B, "p68t-ort-a"),
                place(W, "aventurien"),
                place(S, "p68t-ort-a", { relation: "vorkommen" }),
            ],
            rules: [
                rule(A, [
                    term(1, { join_op: "oder", climate_from: "gemaessigt", climate_to: "subtropisch" }),
                    term(0, { area_public_id: C.regionA, region_types: [wald] }),
                ]),
                rule(
                    A,
                    [
                        term(0, {
                            region_types: [
                                { kind: "vegetation", region_type: "sumpf" },
                                { kind: "vegetation", region_type: "auwald" },
                            ],
                        }),
                    ],
                    { origin: "wiki_verbreitung", id: 8 },
                ),
                rule(
                    A,
                    [
                        term(0, {
                            region_types: [
                                { kind: "vegetation", region_type: "auwald" },
                                { kind: "vegetation", region_type: "sumpf" },
                            ],
                        }),
                    ],
                    { origin: "wiki_verbreitung", id: 9 },
                ),
                rule(A, [
                    term(0, {
                        area_public_id: "00000000-0000-4000-8000-0000000000aa",
                        climate_from: "gemaessigt",
                        region_types: [{ kind: "vegetation", region_type: "p74t-art" }],
                    }),
                ]),
                rule(A, [term(0, { region_types: [wald] })], { status: "retired" }),
            ],
            sources: [
                zooRow(1),
                kraeuterRow(2),
                catalogRow(3, {
                    url: "https://p74test.example/fehlt",
                    url_hash: sha256("https://p74test.example/fehlt"),
                }),
            ],
            links: over.links ?? [
                link(A, 1, { status: "suppressed", pages: "88", position: 0 }),
                link(A, 2, { origin: "manual", reference_kind: null, position: 1 }),
                link(A, 2, { position: 2 }),
                link(W, 3),
                link("p74t-unbekannt", 1),
            ],
            ...(over.kinds === undefined ? {} : { kinds: over.kinds }),
            ...(over.withheld === undefined ? {} : { withheld: over.withheld }),
        });
    }

    const one = async <T>(sql: string): Promise<T> => {
        const [row] = await database.unsafe<{ v: T }[]>(`SELECT (${sql}) AS v`);
        return (row as { v: T }).v;
    };
    const rows = <T extends object>(sql: string): Promise<T[]> => database.unsafe<T[]>(sql);

    it("🔴 der Legacy-Import lässt die Vorkommen aus, solange sie dem WikiSync gehören: skipped, Befund bereich_wikisync, nichts geschrieben", async () => {
        const report = await importLore(database, fullAnswer());
        expect(report.skipped).toBe(true);
        expect(report.changed).toBe(false);
        expect(codes(report.findings)).toEqual(["bereich_wikisync"]);
        expect(await one<number>(`SELECT count(*)::int FROM lore_entry`)).toBe(0);
        expect(await one<number>(`SELECT count(*)::int FROM lore_place`)).toBe(0);
        expect(await one<number>(`SELECT count(*)::int FROM lore_rule`)).toBe(0);
        expect(await one<number>(`SELECT count(*)::int FROM migration_run WHERE data_domain = 'lore'`)).toBe(0);
    });

    describe("Prüfer", () => {
        // Der Prüfer gilt unabhängig vom Besitz des Bereichs; die Daten legt der Schreibweg des Imports an.
        beforeEach(() => legacyImportOffen());
        afterEach(() => vi.restoreAllMocks());

        it("besteht nach dem Import; jede Prüfung meldet nur (kein Tor)", async () => {
            const payload = fullAnswer();
            await importLore(database, payload);
            const report = await verifyLore(database, payload);
            expect(report.skipped).toBe(false);
            const failed = report.checks
                .filter((check) => !check.passed)
                .map((check) => `${check.name}: ${check.detail} ${(check.offenders ?? []).join("; ")}`);
            expect(failed).toEqual([]);
            expect(report.passed).toBe(true);
            expect(report.checks.map((check) => check.name)).toEqual([
                "counts",
                "entry_parity",
                "field_origins",
                "place_parity",
                "place_targets",
                "place_resolution",
                "rules",
                "source_links",
                "structure",
            ]);
            expect(codes(report.findings)).toContain("contract_numbers");
            const probe = find(report.findings, "contract_numbers");
            expect(probe?.numbers).toMatchObject({ eintraege: 5, ortszeilen: 14, verknuepfungen: 2 });
        });

        it("meldet eine Abweichung als Befund und hält nicht an (BLOCKING_CHECKS ist leer)", async () => {
            const payload = fullAnswer();
            await importLore(database, payload);
            // Ein Ziel, das nicht zur Treffermenge passt, und ein verändertes Feld.
            await database.unsafe(
                `DELETE FROM lore_place_target WHERE lore_place_id = (SELECT id FROM lore_place WHERE place_wiki_key = 'p68t-ort-geteilt') AND place_id = ${ids.carriers[C.ortC]}`,
            );
            await database.unsafe(`UPDATE lore_entry SET gruppe = 'verändert' WHERE wiki_key = '${A}'`);
            const report = await verifyLore(database, payload);
            expect(report.passed).toBe(true);
            const failed = report.checks.filter((check) => !check.passed).map((check) => check.name);
            expect(failed).toEqual(expect.arrayContaining(["entry_parity", "place_targets", "place_resolution"]));
        });

        it("rechnet den rule_key aus den gespeicherten Legacy-Werten nach und findet eine geänderte Bedingung", async () => {
            const payload = fullAnswer();
            await importLore(database, payload);
            await database.unsafe(`UPDATE lore_rule_term SET legacy_climate_to = 'tropisch' WHERE seq = 1`);
            const report = await verifyLore(database, payload);
            const rules = report.checks.find((check) => check.name === "rules");
            expect(rules?.passed).toBe(false);
            expect(rules?.offenders?.join(" ")).toContain("rule_key");
        });

        it("trägt den Abnahmefall Weiden und die Katalogzeilen ohne Verknüpfung als Befund", async () => {
            const payload = answer({
                entries: [entry("p74t-w1", "fauna"), entry("p74t-w2", "flora"), entry("p74t-w3", "spezies")],
                places: [place("p74t-w1", "weiden"), place("p74t-w2", "wiki:weiden"), place("p74t-w3", "weiden")],
                sources: [zooRow(1)],
                links: [link("p74t-w1", 1)],
            });
            await importLore(database, payload);
            const report = await verifyLore(database, payload);
            expect(find(report.findings, "contract_numbers")?.numbers).toMatchObject({
                weiden_fauna: 1,
                weiden_flora: 1,
                weiden_spezies: 1,
            });
            // Die Kräuterkunde hängt an keinem Träger und keiner Lore-Verknüpfung dieses Satzes.
            const unlinked = find(report.findings, "catalog_row_without_link_after_lore");
            expect(unlinked?.objects.map((object) => object.name)).toContain("P74T Kräuterkunde");
        });

        it("trägt den Befund, wenn ein Schlüssel in der Zuordnung X2 steht, aber keinen auflösbaren Träger trifft (hier: ein stillgelegter Ort)", async () => {
            const payload = answer({
                entries: [entry(A, "flora")],
                // Der Ort „inaktiv“ hat einen Eintrag in X2, ist aber stillgelegt; der Weg ist kein Zielraum und kein Befund.
                places: [place(A, "p68t-ort-inaktiv"), place(A, "p68t-weg-a", { sort_order: 1 })],
            });
            await importLore(database, payload);
            const report = await verifyLore(database, payload);
            expect(report.passed).toBe(true);
            const finding = find(report.findings, "place_target_carrier_unusable");
            expect(finding?.objectCount).toBe(1);
            expect(finding?.objects[0]?.name).toBe("p68t-ort-inaktiv (siedlung)");
        });

        it("bei einer unbrauchbaren Antwort gibt es nichts zu prüfen", async () => {
            const report = await verifyLore(database, { ok: false });
            expect(report).toMatchObject({ passed: true, skipped: true, checks: [] });
        });

        it("die Tabellen von D5 tragen keine verbotene Spalte (kein entity_type, JSON, place_kind, created_by, Merkmale, Bilder)", async () => {
            const columns = await rows<{ table_name: string; column_name: string }>(
                `SELECT table_name, column_name FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = ANY(ARRAY['lore_entry','lore_entry_field_origin','lore_place','lore_place_target','lore_rule','lore_rule_term','lore_rule_term_type','lore_entry_source'])
                    AND (column_name IN ('entity_type','place_kind','created_by','merkmale','merkmale_json','raw_json','image_url','synced_at','territory_path') OR data_type IN ('json','jsonb'))`,
            );
            expect(columns).toEqual([]);
        });
    });

    it("die Beispielantwort von Legacy lässt sich prüfen", async () => {
        legacyImportOffen();
        try {
            await database`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
                VALUES (${SAMPLE_ZOO_KEY}, 'final', NULL, 'P74T Beispiel Zoo-Botanica', 'regionalspielhilfe', TRUE)
            `;
            await database`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
                VALUES (${SAMPLE_KRAEUTER_KEY}, 'final', 'https://example.org/kraeuterkunde', 'P74T Beispiel Kräuterkunde', 'sonstiges', FALSE)
            `;
            await importLore(database, legacySample(), { mapRevision: 812 });
            const verified = await verifyLore(database, legacySample(), { mapRevision: 812 });
            expect(verified.passed).toBe(true);
            expect(verified.checks.filter((check) => !check.passed)).toEqual([]);
        } finally {
            vi.restoreAllMocks();
        }
    });
});
