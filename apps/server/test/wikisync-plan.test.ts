import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wikiNamespaceTafel, type WikisyncBereich } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    GRUND_KEIN_WIKI_STAND,
    MAX_NEUE_ARTIKEL_ZEILEN,
    bekannterTitelSchluessel,
    berechnePlan,
    gesuchteTitelAus,
    type LokalerWert,
    type Plan,
    type PlanObjekt,
    type PlanZeile,
} from "../src/wiki/abgleich/plan.ts";
import { sammleSeiten, type KandidatNeuerArtikel, type SeitenErgebnis } from "../src/wiki/dump/seiten-sammler.ts";
import { baueDump, findeBzip2, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";

/**
 * Der Plan des Abgleichs (WI-0253 C), rein: Objekte der Karte gegen die Seiten eines Fixture-Dumps (`support/wiki-dump-fixture.ts`).
 *
 * - **Soll:** die sechs Eigentümer × Wirkung am Feld; Eigenkennungen werden nie abgeglichen; Umleitung, mehrdeutig, kaputte Infobox, Artikel nicht im Dump,
 *   unbekannter Namensraum, neuer Artikel; die Abschnitte eines Wegs ergeben EINE Zeile; derselbe Dump zweimal ergibt dieselben Zeilen (Idempotenz) und
 *   verändert die Eingabe nicht.
 * - **Problemfälle (Vali 2026-10-25):** eine Kennung ohne Wiki-Adresse darf nie als „nicht im Dump“ oder „entfallen“ erscheinen; ein neuer Artikel wird
 *   nie angelegt, nur gemeldet, und nur für Orts- und Gebiets-Infoboxen in einem Einsammel-Raum; ein eigener Wert, der seit jeher vom Wiki abweicht,
 *   ist keine Nachricht.
 */

const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Gareth",
        ns: 0,
        text: [
            "{{Infobox Siedlung",
            "|Name=Gareth",
            "|Einwohner=ca. 7.400",
            "|Herrscher=Kaiserin [[Rohaja von Gareth|Rohaja]]",
            "|Region=[[Garetien]]",
            "|Staat=[[Mittelreich]]",
            "|Handelszone=[[Mittelreich]]",
            "|Verkehrswege=[[Reichsstraße 1]]",
            "}}",
            "Die '''Stadt Gareth''' ist die [[Hauptstadt]].",
        ].join("\n"),
    },
    { titel: "Reichsstadt Gareth", ns: 0, weiterleitung: "Gareth" },
    { titel: "Havena", ns: 0, text: "{{Infobox Siedlung\n|Name=Havena\n|Einwohner=5.000\n}}\nHavena." },
    { titel: "Kaputtdorf", ns: 0, text: "{{Infobox Siedlung\n|Name=Kaputtdorf\n|Einwohner=10\nText ohne Ende" },
    { titel: "Nur Prosa", ns: 0, text: "Hier steht keine Infobox." },
    { titel: "Fremd", ns: 0, text: "{{Infobox Staat\n|Name=Fremd\n}}\nEin Staat." },
    { titel: "Doppelt", ns: 0, text: "{{Infobox Siedlung\n|Name=Doppelt\n}}\nEins." },
    { titel: "Doppelt", ns: 0, text: "{{Infobox Siedlung\n|Name=Doppelt\n}}\nZwei." },
    { titel: "Kategorie:Orte", ns: 14, text: "{{Infobox Siedlung\n|Name=Orte\n}}" },
    { titel: "Nostria (Stadt)", ns: 0, text: "{{Infobox Siedlung\n|Name=Nostria\n|Einwohner=100\n}}\nNostria." },
    {
        titel: "Weidener Linie",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Weidener Linie\n|Stärke=regional\n}}\nEine Linie.",
    },
    {
        titel: "Reichsstraße 1",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Reichsstraße 1\n|Art=Reichsstraße\n|Länge=400 Meilen\n|Regionen=[[Kosch]]\n|Verlauf=\n{{Straße|[[Gareth]]}}\n{{Straße|[[Angbar]]}}\n}}\nDie Reichsstraße 1.",
    },
    {
        titel: "Koschberge",
        ns: 0,
        text: "{{Infobox Region\n|Name=Koschberge\n|Art=Gebirge\n|Region=Kosch\n|Staat=Mittelreich\n}}\nDie Koschberge.",
    },
    { titel: "Gipfelberg", ns: 0, text: "{{Infobox Region\n|Name=Gipfelberg\n|Art=Berg\n}}\nEin Berg." },
    {
        titel: "Herzogtum Weiden",
        ns: 0,
        text: "{{Infobox Staat\n|Name=Herzogtum Weiden\n|Staat=[[Mittelreich]]\n|Hauptstadt=[[Weiden]]\n|Oberhaupt=Herzog\n|Gründungsdatum={{BF|1000}}\n}}\nWeiden.",
    },
    // Neue Artikel (keine Karte kennt sie)
    { titel: "Wengenholm", ns: 0, text: "{{Infobox Siedlung\n|Name=Wengenholm\n}}\nWengenholm." },
    { titel: "Inoffiziell:Apfeldorn", ns: 222, text: "{{Infobox Siedlung\n|Name=Apfeldorn\n}}\nApfeldorn." },
    { titel: "DSK:Schwarze Katze", ns: 218, text: "{{Infobox Siedlung\n|Name=Katze\n}}\nKeine Karte aus diesem Raum." },
    { titel: "Neue Straße", ns: 0, text: "{{Infobox Straße\n|Name=Neue Straße\n}}\nStraße." },
    { titel: "Neues Reich", ns: 0, text: "{{Infobox Staat\n|Name=Neues Reich\n}}\nReich." },
    { titel: "Bekannter Ort", ns: 0, text: "{{Infobox Siedlung\n|Name=Bekannter Ort\n}}\nDie Registry kennt ihn." },
];

const TAFEL = wikiNamespaceTafel();
let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let dumpPfad: string;
const bzip2 = findeBzip2();

/** Der Dump, wie der Sammler ihn für diese Objekte liest. */
async function lese(objekte: readonly PlanObjekt[]): Promise<SeitenErgebnis> {
    return sammleSeiten(dumpPfad, gesuchteTitelAus(objekte), TAFEL, bzip2 === null ? {} : { bzip2 });
}

beforeAll(async () => {
    ordner = await neuerOrdner("wikisync-plan");
    dumpPfad = join(ordner.pfad, "dewa_dump_small_20261001.xml");
    await writeFile(dumpPfad, baueDump(DUMP));
});
afterAll(async () => {
    await ordner.weg();
});

const lokal = (wert: string | null, vermerk: LokalerWert["vermerk"]): LokalerWert => ({
    zustand: wert === null ? "kein" : wert === "" ? "leer" : "text",
    wert,
    vermerk,
});

function objekt(teil: Partial<PlanObjekt> & Pick<PlanObjekt, "id" | "name">): PlanObjekt {
    return {
        bereich: "ort",
        objektArt: "place",
        adresse: null,
        zustand: "zugewiesen",
        herkunft: "unknown",
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
        ...teil,
    };
}

const schnappschuss = (felder: Record<string, string | null>): ReadonlyMap<string, string | null> =>
    new Map(Object.entries(felder));

/** Alle Zeilen eines Objekts zum Feld. */
const zeilenZu = (plan: Plan, id: string, feld: string | null): PlanZeile[] =>
    plan.zeilen.filter((zeile) => zeile.objektId === id && zeile.feld === feld);

/** Ohne `neue: true` (oder eigene Kandidaten) bleiben die neuen Artikel des Fixture-Dumps außen vor: Die meisten Fälle fragen nach Objekten. */
async function planeFuer(
    objekte: readonly PlanObjekt[],
    optionen: {
        bereiche?: WikisyncBereich[];
        legacy?: WikisyncBereich[];
        bekannt?: string[];
        kandidaten?: KandidatNeuerArtikel[];
        neue?: boolean;
    } = {},
): Promise<Plan> {
    const gelesen = await lese(objekte);
    return berechnePlan({
        bereiche: optionen.bereiche ?? ["ort"],
        objekte,
        dump: {
            gefunden: gelesen.gefunden,
            kandidaten: optionen.kandidaten ?? (optionen.neue === true ? gelesen.kandidaten : []),
        },
        tafel: TAFEL,
        legacyBereiche: new Set(optionen.legacy ?? []),
        bekannteTitel: new Set((optionen.bekannt ?? []).map(bekannterTitelSchluessel)),
    });
}

describe("Felder: die sechs Eigentümer × Wirkung", () => {
    // Gareth im Dump: Einwohner „ca. 7.400“, Herrscher „Kaiserin Rohaja“, Lage „Garetien · Mittelreich“, Staat „Mittelreich“, Handelszone „Mittelreich“.
    const gareth = objekt({
        id: "o-gareth",
        name: "Gareth",
        adresse: wiki("Gareth"),
        lokal: new Map([
            ["name", lokal("Gareth", "kein")],
            // wiki: der Vermerk sagt Wiki, der Wert passt zum Schnappschuss
            ["einwohner", lokal("ca. 7.200", "wiki")],
            // manual: die Redaktion hat einen eigenen Wert; das Wiki hat sich seit dem Schnappschuss bewegt
            ["oberhaupt", lokal("Kaiser Hal", "manual")],
            // unbekannt: ein Wert ohne Vermerk
            ["lage", lokal("Garetien", "kein")],
        ]),
        schnappschuss: schnappschuss({
            name: "Gareth",
            einwohner: "ca. 7.200",
            oberhaupt: "Kaiser Hal",
            lage: "Garetien",
            region_text: "Garetien",
            staat_text: "Reich",
            handelszone: null,
            verkehrswege: "Reichsstraße 1",
            description: "Die Stadt Gareth ist die Hauptstadt.",
        }),
    });

    it("🔴 wiki -> uebernommen; manual -> eigen; unbekannt -> befund; ein Feld nur im Schnappschuss ist wiki-eigen", async () => {
        const plan = await planeFuer([gareth]);
        expect(zeilenZu(plan, "o-gareth", "einwohner")).toMatchObject([
            {
                alt: "ca. 7.200",
                neu: "ca. 7.400",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                status: "geaendert",
                artikel: "Gareth",
                namensraum: 0,
            },
        ]);
        expect(zeilenZu(plan, "o-gareth", "oberhaupt")).toMatchObject([
            { alt: "Kaiser Hal", neu: "Kaiserin Rohaja", eigentuemer: "manual", wirkung: "eigen" },
        ]);
        expect(zeilenZu(plan, "o-gareth", "lage")).toMatchObject([
            { alt: "Garetien", neu: "Garetien · Mittelreich", eigentuemer: "unbekannt", wirkung: "befund" },
        ]);
        // Nur im Schnappschuss: der Staat und die Handelszone ändern sich im Wiki; die Region nicht.
        expect(zeilenZu(plan, "o-gareth", "staat_text")).toMatchObject([
            { alt: "Reich", neu: "Mittelreich", eigentuemer: "wiki", wirkung: "uebernommen" },
        ]);
        expect(zeilenZu(plan, "o-gareth", "handelszone")).toMatchObject([
            { alt: null, altZustand: "kein", neu: "Mittelreich", status: "neu", eigentuemer: "wiki" },
        ]);
        expect(zeilenZu(plan, "o-gareth", "region_text")).toEqual([]);
        // Unverändert: der Name stimmt, die Verkehrswege auch.
        expect(zeilenZu(plan, "o-gareth", "name")).toEqual([]);
        expect(zeilenZu(plan, "o-gareth", "verkehrswege")).toEqual([]);
        expect(plan.zahlen.ort).toMatchObject({
            objekte: 1,
            mitAdresse: 1,
            gefunden: 1,
            uebernommen: 3,
            eigen: 1,
            befunde: 1,
        });
    });

    it("🔴 im Legacy-Bereich gehören die wiki-eigenen Felder dem Legacy-Zug (Befund), eigene Entscheidungen bleiben eigen", async () => {
        const plan = await planeFuer([gareth], { legacy: ["ort"] });
        expect(zeilenZu(plan, "o-gareth", "einwohner")).toMatchObject([{ eigentuemer: "legacy", wirkung: "befund" }]);
        expect(zeilenZu(plan, "o-gareth", "staat_text")).toMatchObject([{ eigentuemer: "legacy", wirkung: "befund" }]);
        expect(zeilenZu(plan, "o-gareth", "oberhaupt")).toMatchObject([{ eigentuemer: "manual", wirkung: "eigen" }]);
        expect(zeilenZu(plan, "o-gareth", "lage")).toMatchObject([{ eigentuemer: "unbekannt", wirkung: "befund" }]);
        expect(plan.zahlen.ort).toMatchObject({ uebernommen: 0, eigen: 1 });
    });

    it("ein eigener Wert, der seit jeher vom Wiki abweicht, ist keine Nachricht; bewegt sich das Wiki, erscheint er", async () => {
        const stabil = objekt({
            id: "o-stabil",
            name: "Gareth",
            adresse: wiki("Gareth"),
            // Der Schnappschuss hat schon den heutigen Wiki-Wert; der eigene Wert weicht ab.
            lokal: new Map([["oberhaupt", lokal("Kaiser Hal", "manual")]]),
            schnappschuss: schnappschuss({ oberhaupt: "Kaiserin Rohaja" }),
        });
        expect(zeilenZu(await planeFuer([stabil]), "o-stabil", "oberhaupt")).toEqual([]);
        const unbekannt = objekt({
            id: "o-unbekannt",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["oberhaupt", lokal("Kaiser Hal", "kein")]]),
            schnappschuss: schnappschuss({ oberhaupt: "Kaiserin Rohaja" }),
        });
        expect(zeilenZu(await planeFuer([unbekannt]), "o-unbekannt", "oberhaupt")).toEqual([]);
        // Ohne Schnappschuss weiß niemand, ob sich das Wiki bewegt hat: dann ist es eine Nachricht.
        const ohne = objekt({
            id: "o-ohne",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["oberhaupt", lokal("Kaiser Hal", "manual")]]),
        });
        expect(zeilenZu(await planeFuer([ohne]), "o-ohne", "oberhaupt")).toMatchObject([
            { eigentuemer: "manual", wirkung: "eigen" },
        ]);
    });

    it("🔴 der vermerkte Wiki-Wert, der dem Schnappschuss widerspricht, gilt als unbekannt (Befund, nie überschrieben)", async () => {
        const widerspruch = objekt({
            id: "o-widerspruch",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["einwohner", lokal("ca. 9.999", "wiki")]]),
            schnappschuss: schnappschuss({ einwohner: "ca. 7.200" }),
        });
        expect(zeilenZu(await planeFuer([widerspruch]), "o-widerspruch", "einwohner")).toMatchObject([
            { alt: "ca. 9.999", eigentuemer: "unbekannt", wirkung: "befund", befund: "herkunft_widerspruch" },
        ]);
        // Auch wenn das Wiki sich seit dem Schnappschuss nicht bewegt hat, bleibt der Widerspruch sichtbar: Er blockiert die Übernahme dieses Felds.
        const ruhig = objekt({
            id: "o-widerspruch-ruhig",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["einwohner", lokal("ca. 9.999", "wiki")]]),
            schnappschuss: schnappschuss({ einwohner: "ca. 7.400" }),
        });
        expect(zeilenZu(await planeFuer([ruhig]), "o-widerspruch-ruhig", "einwohner")).toMatchObject([
            { alt: "ca. 9.999", neu: "ca. 7.400", eigentuemer: "unbekannt", befund: "herkunft_widerspruch" },
        ]);
    });

    it("ein bewusst leeres Feld mit Vermerk manual bleibt eigen; ohne Vermerk ist es unbekannt – beide überstehen einen neuen Wiki-Wert", async () => {
        const eigen = objekt({
            id: "o-leer-eigen",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["oberhaupt", lokal("", "manual")]]),
            schnappschuss: schnappschuss({ oberhaupt: null }),
        });
        expect(zeilenZu(await planeFuer([eigen]), "o-leer-eigen", "oberhaupt")).toMatchObject([
            { altZustand: "leer", neu: "Kaiserin Rohaja", eigentuemer: "manual", wirkung: "eigen" },
        ]);
        const ohneEntscheidung = objekt({
            id: "o-leer-unbekannt",
            name: "Gareth",
            adresse: wiki("Gareth"),
            lokal: new Map([["oberhaupt", lokal("", "kein")]]),
            schnappschuss: schnappschuss({ oberhaupt: null }),
        });
        expect(zeilenZu(await planeFuer([ohneEntscheidung]), "o-leer-unbekannt", "oberhaupt")).toMatchObject([
            { altZustand: "leer", eigentuemer: "unbekannt", wirkung: "befund" },
        ]);
    });
});

describe("Zuordnungen: getrennt, unterdrückt, Eigenkennungen", () => {
    it("🔴 eine getrennte oder unterdrückte Zuordnung wird nicht abgeglichen: ein Befund, der nichts wiederbelebt", async () => {
        const nostria = objekt({
            id: "o-nostria",
            name: "Nostria",
            adresse: wiki("Nostria (Stadt)"),
            zustand: "unterdrueckt",
            lokal: new Map([["einwohner", lokal("1", "wiki")]]),
        });
        const linie = objekt({
            id: "k-weidener",
            name: "Weidener Linie",
            bereich: "kraftlinie",
            objektArt: "powerline",
            adresse: wiki("Weidener Linie"),
            zustand: "getrennt",
        });
        const plan = await planeFuer([nostria, linie], { bereiche: ["ort", "kraftlinie"] });
        expect(plan.zeilen.filter((zeile) => zeile.objektId === "o-nostria")).toMatchObject([
            {
                feld: null,
                befund: "zuordnung_gesperrt",
                eigentuemer: "unterdrueckt",
                wirkung: "befund",
                status: "unterdrueckt",
                grund: "unterdrückt",
            },
        ]);
        expect(plan.zeilen.filter((zeile) => zeile.objektId === "k-weidener")).toMatchObject([
            { feld: null, befund: "zuordnung_gesperrt", eigentuemer: "getrennt", wirkung: "befund", grund: "getrennt" },
        ]);
        expect(plan.zahlen.ort).toMatchObject({ gesperrt: 1, mitAdresse: 0, gefunden: 0 });
        expect(plan.zahlen.kraftlinie).toMatchObject({ gesperrt: 1, mitAdresse: 0 });
    });

    it("🔴 Eigenkennungen ohne Wiki-Adresse werden NIE abgeglichen: gezählt, übersprungen, kein Befund – auch wenn eine gleichnamige Seite im Dump steht", async () => {
        const eigenkennungen = [
            objekt({ id: "o-keine", name: "Gareth", adresse: null }),
            objekt({ id: "o-fremd", name: "Gareth", adresse: "https://www.garetien.de/wiki/Gareth" }),
            objekt({
                id: "o-angreifer",
                name: "Gareth",
                adresse: "https://de.wiki-aventurica.de.angreifer.example/wiki/Gareth",
            }),
            objekt({ id: "o-nur-titel", name: "Gibt es nicht", adresse: "Gibt es nicht" }),
            objekt({ id: "o-nicht-im-wiki", name: "Eigener Ort", adresse: "https://example.invalid/wiki/Eigener_Ort" }),
        ];
        const echt = objekt({ id: "o-echt", name: "Havena", adresse: wiki("Havena") });
        const plan = await planeFuer([...eigenkennungen, echt]);
        expect(plan.zahlen.ort).toMatchObject({
            objekte: 6,
            mitAdresse: 1,
            kennungOhneWikiAdresse: 5,
            nichtImDump: 0,
            gefunden: 1,
        });
        for (const kennung of eigenkennungen)
            expect(
                plan.zeilen.filter((zeile) => zeile.objektId === kennung.id),
                kennung.id,
            ).toEqual([]);
        expect(gesuchteTitelAus(eigenkennungen).size).toBe(0);
    });

    it("eine Adresse mit gespeichertem Titel in anderer Schreibweise des ersten Buchstabens findet die Seite (MediaWiki stellt ihn frei)", async () => {
        const klein = objekt({
            id: "o-klein",
            name: "Havena",
            adresse: "https://de.wiki-aventurica.de/wiki/havena",
            lokal: new Map([["name", lokal("Havenau", "kein")]]),
        });
        const plan = await planeFuer([klein]);
        expect(plan.zahlen.ort).toMatchObject({ gefunden: 1, nichtImDump: 0 });
        expect(zeilenZu(plan, "o-klein", "name")).toMatchObject([
            { alt: "Havenau", neu: "Havena", eigentuemer: "unbekannt" },
        ]);
    });
});

describe("Befunde zum Artikel", () => {
    const mit = (id: string, titel: string, name = titel): PlanObjekt => objekt({ id, name, adresse: wiki(titel) });

    it("🔴 Umleitung, mehrdeutig, kaputte Infobox, Artikel nicht im Dump und unbekannter Namensraum – je mit Befund, Status und Grund", async () => {
        const objekte = [
            mit("o-umleitung", "Reichsstadt Gareth"),
            mit("o-doppelt", "Doppelt"),
            mit("o-kaputt", "Kaputtdorf"),
            mit("o-prosa", "Nur Prosa"),
            mit("o-fremd", "Fremd"),
            mit("o-selem", "Selem"),
            mit("o-kategorie", "Kategorie:Orte"),
            mit("o-havena", "Havena"),
        ];
        const plan = await planeFuer(objekte);
        const befund = (id: string): PlanZeile | undefined =>
            plan.zeilen.find((zeile) => zeile.objektId === id && zeile.feld === null);
        expect(befund("o-umleitung")).toMatchObject({
            befund: "umleitung",
            status: "geaendert",
            grund: "Gareth",
            wirkung: "befund",
        });
        expect(befund("o-doppelt")).toMatchObject({ befund: "mehrdeutig", status: "mehrdeutig", grund: "2 Seiten" });
        expect(befund("o-kaputt")).toMatchObject({
            befund: "infobox_kaputt",
            status: "fehlerhaft",
            grund: "nicht_geschlossen",
        });
        expect(befund("o-prosa")).toMatchObject({ befund: "infobox_kaputt", grund: "keine_infobox" });
        expect(befund("o-fremd")).toMatchObject({ befund: "infobox_kaputt", grund: "fremde_infobox" });
        expect(befund("o-selem")).toMatchObject({
            befund: "artikel_nicht_im_dump",
            status: "zu_entfernen",
            artikel: "Selem",
        });
        expect(befund("o-kategorie")).toMatchObject({
            befund: "namensraum_unbekannt",
            status: "fehlerhaft",
            namensraum: 14,
            grund: "ns 14",
        });
        // Havena ist heil: keine Befund-Zeile zum Artikel.
        expect(befund("o-havena")).toBeUndefined();
        expect(plan.zahlen.ort).toMatchObject({
            mitAdresse: 8,
            gefunden: 5,
            umgeleitet: 1,
            nichtImDump: 1,
            mehrdeutig: 1,
        });
        // 🔴 Mitgezählt: mitAdresse = gefunden + umgeleitet + nichtImDump + mehrdeutig.
        const z = plan.zahlen.ort!;
        expect(z.mitAdresse).toBe(z.gefunden + z.umgeleitet + z.nichtImDump + z.mehrdeutig);
        // Eine Zuordnung ändert dieser Plan nie: Jeder Artikelbefund hat die Wirkung „Befund“, gleich wem die Zuordnung gehört.
        expect(plan.zeilen.filter((zeile) => zeile.feld === null).every((zeile) => zeile.wirkung === "befund")).toBe(
            true,
        );
    });

    it("der Eigentümer der Zeile ist der der Zuordnung (aus Legacys Editor: legacy; aus dem Editor: manual; Herkunft unbekannt: unbekannt)", async () => {
        const plan = await planeFuer([
            objekt({ id: "a", name: "A", adresse: wiki("Selem"), herkunft: "legacy_editor" }),
            objekt({ id: "b", name: "B", adresse: wiki("Selem 2"), herkunft: "editor" }),
            objekt({ id: "c", name: "C", adresse: wiki("Selem 3"), herkunft: "unknown" }),
            objekt({ id: "d", name: "D", adresse: wiki("Selem 4"), herkunft: "wiki_sync" }),
        ]);
        expect(plan.zeilen.map((zeile) => [zeile.objektId, zeile.eigentuemer])).toEqual([
            ["a", "legacy"],
            ["b", "manual"],
            ["c", "unbekannt"],
            ["d", "wiki"],
        ]);
    });
});

describe("Gruppen: die Abschnitte eines Wegs", () => {
    const abschnitt = (id: string, name: string, extra: Partial<PlanObjekt> = {}): PlanObjekt =>
        objekt({
            id,
            name,
            bereich: "weg",
            objektArt: "path",
            adresse: wiki("Reichsstraße 1"),
            lokal: new Map([["name", lokal(name, "kein")]]),
            // Der Name im Schnappschuss war „Reichsstraße I“: Das Wiki hat ihn seither geändert (das ist die Nachricht).
            schnappschuss: schnappschuss({
                name: "Reichsstraße I",
                kind: "strasse",
                art: "Reichsstraße",
                lage: "Kosch",
                laenge: "400 Meilen",
                verlauf: "Gareth",
                description: null,
            }),
            ...extra,
        });

    it("🔴 fünf Abschnitte eines Artikels: EINE Zeile je Zustand mit der Zahl der Abschnitte, ein Feld nur im Schnappschuss genau einmal", async () => {
        const abschnitte = [
            abschnitt("w1", "Reichsstr. 1"),
            abschnitt("w2", "Reichsstr. 1"),
            abschnitt("w3", "Reichsstr. 1"),
            abschnitt("w4", "Reichsstraße 1"),
            // eine weitere Zuweisung (nicht die Hauptzuweisung) bestimmt den Namen nicht
            abschnitt("w5", "Andere Straße", { hauptzuweisung: false }),
        ];
        const plan = await planeFuer(abschnitte, { bereiche: ["weg"] });
        const namen = plan.zeilen.filter((zeile) => zeile.feld === "name");
        expect(namen).toMatchObject([
            {
                objektId: "w1",
                objekte: 3,
                alt: "Reichsstr. 1",
                neu: "Reichsstraße 1",
                eigentuemer: "unbekannt",
                wirkung: "befund",
            },
        ]);
        const verlauf = plan.zeilen.filter((zeile) => zeile.feld === "verlauf");
        expect(verlauf).toHaveLength(1);
        expect(verlauf[0]).toMatchObject({
            objekte: 5,
            alt: "Gareth",
            neu: "Gareth → Angbar",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        expect(plan.zahlen.weg).toMatchObject({ objekte: 5, mitAdresse: 5, gefunden: 5 });
    });

    it("ein Artikel nicht im Dump: eine Befund-Zeile für alle Abschnitte", async () => {
        const abschnitte = ["w1", "w2", "w3"].map((id) => abschnitt(id, "Weg", { adresse: wiki("Gibt es nicht") }));
        const plan = await planeFuer(abschnitte, { bereiche: ["weg"] });
        expect(plan.zeilen).toMatchObject([{ objekte: 3, befund: "artikel_nicht_im_dump", feld: null }]);
        expect(plan.zahlen.weg).toMatchObject({ nichtImDump: 3 });
    });
});

describe("Landschaft, Gipfel, Kraftlinie, Gebiet", () => {
    it("🔴 Gipfel lesen die Felder ihrer Landschafts-Infobox in den Wiki-Stand (nie an den Gipfel); ohne Wiki-Stand ein Befund; eine fremde Infobox oder kein Artikel wie bisher", async () => {
        const gipfel = [
            objekt({
                id: "g-ok",
                name: "Gipfel auf der Karte",
                bereich: "gipfel",
                objektArt: "peak",
                adresse: wiki("Gipfelberg"),
                schnappschuss: schnappschuss({ name: "Gipfelberg", art: "Berggipfel", description: "Alt." }),
            }),
            objekt({
                id: "g-ohne",
                name: "Ohne Stand",
                bereich: "gipfel",
                objektArt: "peak",
                zustand: "nur_adresse",
                adresse: wiki("Gipfelberg"),
            }),
            objekt({ id: "g-weg", name: "Weg", bereich: "gipfel", objektArt: "peak", adresse: wiki("Selem") }),
            objekt({ id: "g-falsch", name: "Falsch", bereich: "gipfel", objektArt: "peak", adresse: wiki("Havena") }),
        ];
        const plan = await planeFuer(gipfel, { bereiche: ["gipfel"] });
        expect(
            plan.zeilen.filter((zeile) => zeile.feld === null).map((zeile) => [zeile.objektId, zeile.befund]),
        ).toEqual([
            ["g-falsch", "infobox_kaputt"],
            ["g-weg", "artikel_nicht_im_dump"],
        ]);
        // Ein Artikel, zwei Gipfel: EINE Zeile je Feld des Wiki-Stands, für beide; der Vertreter ist der mit Stand. Der Name des Gipfels selbst wird nie verglichen.
        expect(plan.zeilen.filter((zeile) => zeile.feld !== null)).toMatchObject([
            {
                objektId: "g-ok",
                objektIds: ["g-ohne", "g-ok"],
                feld: "description",
                alt: "Alt.",
                neu: "Ein Berg.",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
            },
        ]);
        expect(plan.zahlen.gipfel).toMatchObject({ objekte: 4, gefunden: 3 });
    });

    it("🔴 ein Gipfel ohne Wiki-Stand (nur eine Adresse): jede Feldzeile ist ein Befund mit Grund, nie eine Übernahme", async () => {
        const plan = await planeFuer(
            [
                objekt({
                    id: "g-ohne",
                    name: "Ohne Stand",
                    bereich: "gipfel",
                    objektArt: "peak",
                    zustand: "nur_adresse",
                    adresse: wiki("Gipfelberg"),
                }),
            ],
            { bereiche: ["gipfel"] },
        );
        const felder = plan.zeilen.filter((zeile) => zeile.feld !== null);
        expect(felder.map((zeile) => zeile.feld)).toEqual(["name", "art", "description"]);
        expect(felder.every((zeile) => zeile.wirkung === "befund" && zeile.grund === GRUND_KEIN_WIKI_STAND)).toBe(true);
    });

    it("Kraftlinie: Name und Beschreibung stehen an der Linie, Stärke und Länge im Schnappschuss", async () => {
        const linie = objekt({
            id: "k-1",
            name: "Weidener Linie",
            bereich: "kraftlinie",
            objektArt: "powerline",
            adresse: wiki("Weidener Linie"),
            lokal: new Map([
                ["name", lokal("Weiden-Linie", "manual")],
                ["description", lokal(null, "kein")],
            ]),
            schnappschuss: schnappschuss({
                name: "Weidener Linie",
                staerke: "lokal",
                affinitaet: null,
                laenge: null,
                regionen: null,
                verlauf: null,
                description: "Eine Linie.",
            }),
        });
        const plan = await planeFuer([linie], { bereiche: ["kraftlinie"] });
        // Das Wiki hat sich bewegt (Stärke), der eigene Name bleibt (der Name im Wiki ist derselbe wie im Schnappschuss: keine Nachricht).
        expect(zeilenZu(plan, "k-1", "name")).toEqual([]);
        expect(zeilenZu(plan, "k-1", "staerke")).toMatchObject([
            { alt: "lokal", neu: "regional", eigentuemer: "wiki" },
        ]);
        // Die Beschreibung am Objekt fehlt: Die Karte zeigt den Schnappschuss, und der Dump nennt dieselbe Prosa – nichts zu sagen.
        expect(zeilenZu(plan, "k-1", "description")).toEqual([]);
    });

    it("Gebiet: die Detailfelder mit dem Vermerk override sind eigene Entscheidungen; ‚unbekannt im Schnappschuss‘ ist eine Nachricht", async () => {
        const weiden = objekt({
            id: "t-weiden",
            name: "Herzogtum Weiden",
            bereich: "gebiet",
            objektArt: "territory",
            adresse: wiki("Herzogtum Weiden"),
            lokal: new Map([
                ["capital_name", lokal("Weidener Hauptstadt", "manual")],
                ["ruler", lokal("Herzogin", "wiki")],
                ["form_of_government", lokal("Erbmonarchie", "kein")],
                ["founded_text", lokal("1000 BF", "wiki")],
            ]),
            schnappschuss: schnappschuss({
                capital_name: "Weiden",
                ruler: "Herzogin",
                form_of_government: null,
                founded_text: "1000 BF",
                dissolved_text: "besteht",
            }),
            // Legacy lieferte den Wiki-Wert der Hauptstadt nie: Der Schnappschuss kann nicht sagen, ob sich das Wiki bewegt hat.
            schnappschussUnbekannt: new Set(["capital_name"]),
        });
        const plan = await planeFuer([weiden], { bereiche: ["gebiet"] });
        expect(zeilenZu(plan, "t-weiden", "capital_name")).toMatchObject([
            { alt: "Weidener Hauptstadt", neu: "Weiden", eigentuemer: "manual", wirkung: "eigen" },
        ]);
        expect(zeilenZu(plan, "t-weiden", "ruler")).toMatchObject([
            { alt: "Herzogin", neu: "Herzog", eigentuemer: "wiki", wirkung: "uebernommen" },
        ]);
        // kein Vermerk, Wiki-Wert der Form fehlt im Dump: gleich leer gegen „Erbmonarchie“ -> unbekannt, aber das Wiki hat sich nicht bewegt (null = null)
        expect(zeilenZu(plan, "t-weiden", "form_of_government")).toEqual([]);
        expect(zeilenZu(plan, "t-weiden", "founded_text")).toEqual([]);
        // Der Kontinent gehört nicht zu den Feldern des Abgleichs (C-2).
        expect(zeilenZu(plan, "t-weiden", "continent")).toEqual([]);
    });
});

describe("Neue Artikel", () => {
    it("🔴 nur Seiten mit Orts- oder Gebiets-Infobox in einem Einsammel-Raum werden Befund-Zeilen; alle anderen nur eine Zahl; angelegt wird nichts", async () => {
        const bekannt = [wiki("Gareth"), wiki("Havena")].map((adresse) =>
            decodeURIComponent(adresse.split("/wiki/")[1] ?? "").replaceAll("_", " "),
        );
        const plan = await planeFuer([], {
            bereiche: ["ort", "gebiet", "weg", "region", "kraftlinie"],
            bekannt: [...bekannt, "Bekannter Ort"],
            neue: true,
        });
        const neu = (bereich: WikisyncBereich): string[] =>
            plan.zeilen
                .filter((zeile) => zeile.bereich === bereich && zeile.befund === "neuer_artikel")
                .map((zeile) => zeile.artikel ?? "");
        // ns 0 und 222 sammeln ein (Vorgabe der Tafel); ns 218 (DSK) nicht. Bekannte Titel und Weiterleitungen fehlen.
        expect(neu("ort")).toEqual([
            "Doppelt",
            "Doppelt",
            "Inoffiziell:Apfeldorn",
            "Kaputtdorf",
            "Nostria (Stadt)",
            "Wengenholm",
        ]);
        expect(neu("gebiet")).toEqual(["Fremd", "Herzogtum Weiden", "Neues Reich"]);
        // Die anderen Arten: nur die Zahl, keine Zeile.
        expect(neu("weg")).toEqual([]);
        expect(plan.zahlen.weg?.neueArtikelNurZahl).toBe(2);
        expect(plan.zahlen.kraftlinie?.neueArtikelNurZahl).toBe(1);
        expect(plan.zahlen.region?.neueArtikelNurZahl).toBe(2);
        const zeile = plan.zeilen.find((z) => z.artikel === "Wengenholm");
        expect(zeile).toMatchObject({
            objektArt: "article",
            objektId: null,
            feld: null,
            eigentuemer: "unbekannt",
            wirkung: "befund",
            status: "neu",
            namensraum: 0,
            grund: "Infobox Siedlung",
        });
    });

    it("die Zeilen sind gekappt, die Zahl daneben nicht; die Namensräume ohne Einsammeln kommen nie vor", async () => {
        const viele: KandidatNeuerArtikel[] = Array.from({ length: MAX_NEUE_ARTIKEL_ZEILEN + 250 }, (_wert, index) => ({
            titel: `Neuer Ort ${String(index).padStart(5, "0")}`,
            ns: 0,
            infobox: "Siedlung",
            art: "ort",
        }));
        const plan = await planeFuer([], { kandidaten: viele });
        expect(plan.zeilen).toHaveLength(MAX_NEUE_ARTIKEL_ZEILEN);
        expect(plan.zahlen.ort?.neueArtikel).toBe(MAX_NEUE_ARTIKEL_ZEILEN + 250);
        expect(plan.zeilen[0]?.artikel).toBe("Neuer Ort 00000");
    });

    it("der Sammler hält nur die gesuchten Texte; der Dump bleibt vollständig gezählt", async () => {
        const gelesen = await lese([objekt({ id: "x", name: "Gareth", adresse: wiki("Gareth") })]);
        expect(gelesen.vollstaendig).toBe(true);
        expect([...gelesen.gefunden.keys()]).toEqual(["Gareth"]);
        expect(gelesen.gefunden.get("Gareth")?.[0]?.text).toContain("{{Infobox Siedlung");
        expect(gelesen.seiten).toBe(DUMP.length);
        expect(gelesen.namensraeume.get(0)).toBeGreaterThan(10);
        // ns 218 sammelt nicht ein; die Weiterleitung ist keine Kandidatin.
        expect(gelesen.kandidaten.some((k) => k.titel.startsWith("DSK:"))).toBe(false);
        expect(gelesen.kandidaten.some((k) => k.titel === "Reichsstadt Gareth")).toBe(false);
    });
});

describe("Idempotenz und Reinheit", () => {
    it("🔴 derselbe Dump und dieselben Objekte ergeben dieselben Zeilen in derselben Reihenfolge und verändern die Eingabe nicht", async () => {
        const objekte = [
            objekt({
                id: "o-gareth",
                name: "Gareth",
                adresse: wiki("Gareth"),
                lokal: new Map([
                    ["einwohner", lokal("ca. 7.200", "wiki")],
                    ["oberhaupt", lokal("Kaiser Hal", "manual")],
                ]),
                schnappschuss: schnappschuss({ einwohner: "ca. 7.200", oberhaupt: "Kaiser Hal", staat_text: "Reich" }),
            }),
            objekt({ id: "o-selem", name: "Selem", adresse: wiki("Selem") }),
            objekt({ id: "o-umleitung", name: "Reichsstadt", adresse: wiki("Reichsstadt Gareth") }),
        ];
        const vorher = JSON.stringify(
            objekte.map((o) => ({
                ...o,
                lokal: [...o.lokal],
                schnappschuss: o.schnappschuss === null ? null : [...o.schnappschuss],
            })),
        );
        const erster = await planeFuer(objekte, { bekannt: ["Gareth"] });
        const zweiter = await planeFuer(objekte, { bekannt: ["Gareth"] });
        expect(JSON.stringify(zweiter)).toBe(JSON.stringify(erster));
        expect(erster.zeilen.length).toBeGreaterThan(3);
        const nachher = JSON.stringify(
            objekte.map((o) => ({
                ...o,
                lokal: [...o.lokal],
                schnappschuss: o.schnappschuss === null ? null : [...o.schnappschuss],
            })),
        );
        expect(nachher).toBe(vorher);
        // Die Eingabe in anderer Reihenfolge ergibt dieselben Zeilen.
        const umgekehrt = await planeFuer([...objekte].reverse(), { bekannt: ["Gareth"] });
        expect(JSON.stringify(umgekehrt)).toBe(JSON.stringify(erster));
    });
});
