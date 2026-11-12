import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import type { SeiteImDump } from "../src/wiki/dump/seiten-sammler.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import {
    baueErgebnisse,
    bauwerkartAusInfobox,
    ergaenzeBauwerkart,
    leseArtSeiten,
    leseKategorienJeSeite,
    ordneArten,
    seitenFuerKategorien,
} from "../src/wiki/kategorien/aus-datei.ts";
import { titelSchluessel } from "../src/wiki/kategorien/auswerten.ts";
import { schliesseArtenAb } from "../src/wiki/kategorien/bauwerkarten.ts";
import { WIKI_TEIL_BEREICHE, type Ergebnisse, type WikiTeilBereich } from "../src/wiki/kategorien/konstanten.ts";
import { ausgenommeneObjekte, berechneKategorienZeilen } from "../src/wiki/kategorien/plan.ts";
import {
    baueKategorienSql,
    neuerOrdner,
    schreibeKategorienDatei,
    type FixtureKategorienZeile,
} from "./support/wiki-dump-fixture.ts";

/**
 * Ortsgröße, Bauwerkart und Kontinent aus der Datei statt aus der API (WI-0294 Aufgabe 2).
 *
 * - **Soll:** die erste Klasse und die erste Art gewinnen (Legacy-Reihenfolge der Klassen, API-Reihenfolge der lebenden Arten), nur der Hauptraum; der Kontinent ist `kontinentVonSeite` über Titel und
 *   Kategorien der Seite, in jedem Namensraum.
 * - **Goldwerte statt API:** Die Werte unten (`GOLD`) sind die, die der Weg über die Kategorie-Abfragen der API für dasselbe Modell-Wiki lieferte. Bewiesen wurde das im Commit „Äquivalenztest gegen die API“ (WI-0294 Aufgabe 2), bevor der Wiki-Teil entfiel:
 *   Der Test fuhr dasselbe Modell einmal durch ein Testwiki (`fuehreSchrittAus`) und einmal durch diese Rechnung, Wert für Wert und Planzeile für Planzeile gleich; eine falsche Art-Reihenfolge machte ihn rot.
 *   Seitdem gibt es den API-Weg nicht mehr, die Werte bleiben als Festlegung stehen. Das Legacy-Orakel (`wiki-kategorien-auswerten.test.ts`) prüft die Wahl je Titel gegen die echte PHP-Funktion.
 * - **Problemfälle:** Apostroph, `ß`, Klammern im Namen; eine Seite in zwei Arten; eine Seite im Namensraum 222; eine Weiterleitung; ein Artikel, den der Dump nicht kennt; eine Seite ohne Kategorien.
 */

interface ModellSeite {
    id: number;
    titel: string;
    ns: number;
    /** Die Kategorien der Seite, mit Leerzeichen. */
    kategorien: string[];
    weiterleitung?: string;
}

/** Die lebenden Arten des Modell-Wikis (Unterkategorien von „Bauwerk nach Art“) mit der Nummer ihrer Kategorieseite. */
const ARTEN_LEBEND = [
    { name: "Palast", id: 9001 },
    { name: "Hafen", id: 9002 },
    { name: "Festung", id: 9003 },
    { name: "Festungsruine", id: 9004 },
    { name: "Mauer", id: 9005 },
    { name: "Neue Art", id: 9006 },
];

const MODELL: ModellSeite[] = [
    { id: 101, titel: "Gareth", ns: 0, kategorien: ["Metropole (Siedlungsgröße)", "Aventurien", "Hafen"] },
    {
        id: 102,
        titel: "Al'Anfa",
        ns: 0,
        kategorien: ["Metropole (Siedlungsgröße)", "Aventurien", "Kolonie von Uthuria"],
    },
    { id: 103, titel: "Straße des Lichts", ns: 0, kategorien: ["Dorf", "Kleinstadt", "Aventurien"] },
    { id: 104, titel: "Burg Eisenstein", ns: 0, kategorien: ["Festungsruine", "Festung", "Aventurien"] },
    { id: 105, titel: "Hafenpalast", ns: 0, kategorien: ["Palast", "Hafen"] },
    { id: 106, titel: "Stadtmauer", ns: 0, kategorien: ["Mauer"] },
    { id: 107, titel: "Mauerturm", ns: 0, kategorien: ["Mauer", "Turm"] },
    { id: 108, titel: "Fremdhafen", ns: 0, kategorien: ["Neue Art", "Hafen"] },
    { id: 109, titel: "Neuwerk", ns: 0, kategorien: ["Neue Art"] },
    { id: 110, titel: "Mittelstadt", ns: 0, kategorien: ["Großstadt", "Mittelgroße Stadt"] },
    { id: 111, titel: "Inoffiziell:Apfeldorn", ns: 222, kategorien: ["Dorf"] },
    { id: 112, titel: "Reichsstadt Gareth", ns: 0, kategorien: [], weiterleitung: "Gareth" },
    { id: 113, titel: "Kategorielos", ns: 0, kategorien: [] },
    { id: 114, titel: "Mittelreich", ns: 0, kategorien: ["Aventurien", "Staat"] },
    {
        id: 115,
        titel: "Horasreich (Myranor)",
        ns: 0,
        kategorien: ["Myranor", "Staat", "Abgeleitet von Horas (Myranor)"],
    },
    { id: 116, titel: "Neue Heimat", ns: 0, kategorien: ["Abgeleitet von Horas (Myranor)", "Staat"] },
    { id: 117, titel: "Raschtulswall", ns: 0, kategorien: ["Gebirge", "Aventurien"] },
    { id: 118, titel: "Uthuria-Gebirge", ns: 0, kategorien: ["Gebirge"] },
];

const adresse = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

let nummer = 0;
function objekt(bereich: PlanObjekt["bereich"], titel: string | null, teil: Partial<PlanObjekt> = {}): PlanObjekt {
    nummer += 1;
    return {
        bereich,
        objektArt: bereich === "ort" ? "place" : bereich === "gebiet" ? "territory" : "region",
        id: `o-${String(1000 + nummer)}`,
        name: titel ?? "ohne Adresse",
        adresse: titel === null ? null : adresse(titel),
        zustand: "zugewiesen",
        herkunft: "unknown",
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
        ...teil,
    };
}

const OBJEKTE: PlanObjekt[] = [
    ...[
        "Gareth",
        "Al'Anfa",
        "Straße des Lichts",
        "Burg Eisenstein",
        "Hafenpalast",
        "Stadtmauer",
        "Mauerturm",
        "Fremdhafen",
        "Neuwerk",
        "Mittelstadt",
        "Inoffiziell:Apfeldorn",
        "Reichsstadt Gareth",
        "Gibt es nicht",
    ].map((titel) => objekt("ort", titel)),
    ...["Kategorielos", "Mittelreich", "Horasreich (Myranor)", "Neue Heimat", "Gibt es auch nicht"].map((titel) =>
        objekt("gebiet", titel),
    ),
    ...["Raschtulswall", "Uthuria-Gebirge"].map((titel) => objekt("region", titel)),
    objekt("ort", "Gareth", { id: "o-doppelt", zustand: "getrennt" }),
    objekt("ort", null),
];

/** Was der Dump kennt: Titel → Seite (Nummer, Namensraum, Weiterleitung). */
const SEITE_JE_TITEL: ReadonlyMap<string, SeiteImDump> = new Map(
    MODELL.map((seite) => [
        seite.titel,
        { id: seite.id, ns: seite.ns, weiterleitung: seite.weiterleitung !== undefined },
    ]),
);

/** Die Kategorieseiten der Arten im XML-Dump (Namensraum 14). */
const TITEL_JE_ID: ReadonlyMap<number, string> = new Map(ARTEN_LEBEND.map((art) => [art.id, `Kategorie:${art.name}`]));

/** Die Datei, die zum Modell-Wiki gehört: je Seite und Kategorie eine Zeile, dazu die Unterkategorien von „Bauwerk nach Art“ und Rauschen. */
function modellZeilen(): FixtureKategorienZeile[] {
    const zeilen: FixtureKategorienZeile[] = [
        ...MODELL.flatMap((seite) =>
            seite.kategorien.map((kategorie) => ({ von: seite.id, nach: kategorie.replaceAll(" ", "_") })),
        ),
        ...ARTEN_LEBEND.map((art) => ({
            von: art.id,
            nach: "Bauwerk_nach_Art",
            art: "subcat" as const,
            sortierschluessel: art.name.toUpperCase(),
        })),
        { von: 99_999, nach: "Dorf" },
        { von: 99_998, nach: "Bauwerk_nach_Art" },
        { von: 9006, nach: "Aventurien", art: "subcat" },
    ];
    // Die Reihenfolge in der Datei ist beliebig: Das Ergebnis darf nicht an ihr hängen.
    return zeilen.reverse();
}

let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let dateiPfad: string;

beforeAll(async () => {
    ordner = await neuerOrdner("kategorien-aus-datei");
    dateiPfad = join(ordner.pfad, "dump_categorylinks.sql.gz");
    await schreibeKategorienDatei(dateiPfad, baueKategorienSql(modellZeilen()));
});
afterAll(async () => {
    await ordner.weg();
});

/** Der Weg der Vorschau: die Datei, die Titel und Nummern des Dumps, die reine Rechnung. */
async function ergebnisseUeberDatei(pfad = dateiPfad): Promise<Record<WikiTeilBereich, Ergebnisse>> {
    const artSeiten = await leseArtSeiten(pfad);
    const { arten } = ordneArten(artSeiten, TITEL_JE_ID);
    const ids = seitenFuerKategorien(OBJEKTE, SEITE_JE_TITEL);
    const kategorienJeSeite = await leseKategorienJeSeite(pfad, ids);
    return baueErgebnisse({ objekte: OBJEKTE, seiteJeTitel: SEITE_JE_TITEL, kategorienJeSeite, arten });
}

/** Eine Karte als Liste in fester Reihenfolge, damit ein Vergleich lesbar ist. */
const alsListe = (karte: ReadonlyMap<string, string> | undefined): [string, string][] =>
    [...(karte ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : 1));

/**
 * Die Werte, die der Weg über die API für dieses Modell-Wiki lieferte (Schlüssel: `titelSchluessel`, also der erste Buchstabe klein). Ohne Eintrag: „nicht in der Kategorie“. Die Weiterleitung
 * („Reichsstadt Gareth“) und der Artikel, den der Dump nicht kennt, tauchen auf dem Weg über die Datei nicht auf; der Plan nimmt sie ohnehin aus (Befund zum Artikel).
 */
const GOLD = {
    ortsgroesse: [
        ["al'Anfa", "metropole"],
        ["gareth", "metropole"],
        ["mittelstadt", "stadt"],
        ["straße des Lichts", "dorf"],
    ],
    bauwerkart: [
        ["burg Eisenstein", "Festung"],
        ["fremdhafen", "Hafen"],
        ["gareth", "Hafen"],
        ["hafenpalast", "Hafen"],
        ["mauerturm", "Turm"],
        ["neuwerk", "Neue Art"],
    ],
    gebiet: [
        ["horasreich (Myranor)", "Myranor / Güldenland"],
        ["kategorielos", "Aventurien"],
        ["mittelreich", "Aventurien"],
        ["neue Heimat", "Aventurien"],
    ],
    region: [
        ["raschtulswall", "Aventurien"],
        ["uthuria-Gebirge", "Uthuria"],
    ],
};

describe("die Rechnung aus der Datei", () => {
    it("Ortsgröße: die erste Klasse gewinnt, nur der Hauptraum", async () => {
        const ergebnisse = await ergebnisseUeberDatei();
        const klasse = ergebnisse.ort.ortsgroesse;
        expect(alsListe(klasse)).toEqual(GOLD.ortsgroesse);
        // Der Hauptraum zählt allein: Eine Seite im Namensraum 222 bekommt keine Klasse.
        expect(klasse?.has(titelSchluessel("Inoffiziell:Apfeldorn"))).toBe(false);
        // „Nicht in der Kategorie“ ist kein Wert.
        expect(klasse?.has(titelSchluessel("Burg Eisenstein"))).toBe(false);
    });

    it("Bauwerkart: die erste lebende Art gewinnt, dann Legacys Liste; Linien und Mauern fehlen", async () => {
        const art = (await ergebnisseUeberDatei()).ort.bauwerkart;
        // Liste der API: Festung, Festungsruine, Hafen, Neue Art, Palast (Sortierschlüssel, nicht Legacys Reihenfolge), dann Legacys Rest; die Mauer ist ausgeschlossen.
        expect(alsListe(art)).toEqual(GOLD.bauwerkart);
        expect(art?.has(titelSchluessel("Stadtmauer"))).toBe(false);
    });

    it("Kontinent: dieselbe Rechnung wie kontinentVonSeite, auch für eine Seite ohne Kategorien", async () => {
        const ergebnisse = await ergebnisseUeberDatei();
        expect(alsListe(ergebnisse.gebiet.kontinent)).toEqual(GOLD.gebiet);
        expect(alsListe(ergebnisse.region.kontinent)).toEqual(GOLD.region);
        // Eine Seite, die der Dump nicht kennt, hat keinen Wert.
        expect(ergebnisse.gebiet.kontinent?.has(titelSchluessel("Gibt es auch nicht"))).toBe(false);
    });

    it("liest nur die Kategorien der verlangten Seiten und kennt die Reihenfolge der Arten", async () => {
        const jeSeite = await leseKategorienJeSeite(dateiPfad, new Set([101, 113]));
        expect([...jeSeite.keys()]).toEqual([101]);
        expect(jeSeite.get(101)).toEqual(expect.arrayContaining(["Metropole (Siedlungsgröße)", "Aventurien", "Hafen"]));
        expect((await leseKategorienJeSeite(dateiPfad, new Set())).size).toBe(0);
        const { arten, ohneTitel } = ordneArten(await leseArtSeiten(dateiPfad), TITEL_JE_ID);
        expect(ohneTitel).toBe(0);
        expect(arten.slice(0, 5)).toEqual(["Festung", "Festungsruine", "Hafen", "Neue Art", "Palast"]);
        // Danach Legacys Liste, soweit sie fehlt, ohne die linearen Anlagen.
        expect(arten).toContain("Turm");
        expect(arten).not.toContain("Mauer");
        expect(arten).toEqual(schliesseArtenAb(["Festung", "Festungsruine", "Hafen", "Mauer", "Neue Art", "Palast"]));
        // Eine Kategorieseite, die der Dump nicht kennt, wird gezählt.
        expect(ordneArten(await leseArtSeiten(dateiPfad), new Map([[9001, "Kategorie:Palast"]])).ohneTitel).toBe(5);
    });
});

describe("die Planzeilen aus den Werten der Datei", () => {
    it("liefern je Objekt mit Wert eine Zeile, in der festen Reihenfolge des Plans, und nehmen Objekte mit Befund zum Artikel aus", async () => {
        const ergebnisse = await ergebnisseUeberDatei();
        const ausgenommen = new Set(
            OBJEKTE.filter((eintrag) =>
                ["Reichsstadt Gareth", "Gibt es nicht", "Gibt es auch nicht"].includes(eintrag.name),
            ).map((eintrag) => eintrag.id),
        );
        const zeilenVon = (bereich: WikiTeilBereich): [string | null, string | null, string | null][] =>
            berechneKategorienZeilen({
                bereich,
                objekte: OBJEKTE,
                ergebnisse: ergebnisse[bereich],
                ausgenommen,
                bereichBeiLegacy: false,
            }).zeilen.map((zeile) => [zeile.objektName, zeile.feld, zeile.neu]);
        expect(zeilenVon("ort")).toEqual([
            ["Al'Anfa", "settlement_class", "metropole"],
            ["Burg Eisenstein", "building_type", "Festung"],
            ["Fremdhafen", "building_type", "Hafen"],
            ["Gareth", "settlement_class", "metropole"],
            ["Gareth", "building_type", "Hafen"],
            ["Hafenpalast", "building_type", "Hafen"],
            ["Mauerturm", "building_type", "Turm"],
            ["Mittelstadt", "settlement_class", "stadt"],
            ["Neuwerk", "building_type", "Neue Art"],
            ["Straße des Lichts", "settlement_class", "dorf"],
        ]);
        expect(zeilenVon("gebiet")).toEqual([
            ["Horasreich (Myranor)", "continent", "Myranor / Güldenland"],
            ["Kategorielos", "continent", "Aventurien"],
            ["Mittelreich", "continent", "Aventurien"],
            ["Neue Heimat", "continent", "Aventurien"],
        ]);
        expect(zeilenVon("region")).toEqual([
            ["Raschtulswall", "continent", "Aventurien"],
            ["Uthuria-Gebirge", "continent", "Uthuria"],
        ]);
        expect([...WIKI_TEIL_BEREICHE]).toEqual(["ort", "gebiet", "region"]);
    });

    it("ausgenommeneObjekte liest die Befunde zum Artikel aus dem Plan: Umleitung, nicht im Dump, mehrdeutig, gesperrt", () => {
        const zeile = (befund: string | null, feld: string | null, ids: string[], bereich = "ort") =>
            ({ bereich, feld, befund, objektIds: ids, objektId: ids[0] ?? null }) as never;
        const ausgenommen = ausgenommeneObjekte(
            [
                zeile("umleitung", null, ["a"]),
                zeile("artikel_nicht_im_dump", null, ["b", "c"]),
                zeile("zuordnung_gesperrt", null, ["d"]),
                zeile("herkunft_widerspruch", "settlement_class", ["e"]),
                zeile("umleitung", null, ["f"], "gebiet"),
                zeile("neuer_artikel", null, ["g"]),
            ],
            "ort",
        );
        expect([...ausgenommen].sort()).toEqual(["a", "b", "c", "d"]);
    });
});

/**
 * Der Rückfall der Bauwerkart auf die Infobox (WI-0295 T1): erst die Kategorie (`waehleArt`, unverändert), sonst `Art=`/`Typ=` der Infobox Bauwerk. Problemfall: 135 von 296 Bauwerk-Artikeln (Stichprobe 09.11.) hatten
 * keine passende Kategorie, vor allem Tempel, die nur in Unterkategorien wie „Praios-Tempel“ stehen.
 */
const RUECKFALL_SEITEN: (ModellSeite & { text: string })[] = [
    {
        id: 201,
        titel: "Burg Trollhammer",
        ns: 0,
        kategorien: ["Festung", "Aventurien-Artikel"],
        text: "{{Infobox Bauwerk\n|Name=Burg Trollhammer\n|Art=[[Burg (Architektur)|Burg]]\n|Standort=[[Kosch]]\n}}\nEine Burg.",
    },
    {
        id: 202,
        titel: "Magiekundliche Investigations-Cammer",
        ns: 0,
        kategorien: [],
        text: "{{Infobox Bauwerk\n|Art=[[Lager]]\n|Standort=[[Rommilys]]\n}}\nEin Lager.",
    },
    {
        id: 203,
        titel: "Praios-Tempel zu Grangor",
        ns: 0,
        kategorien: ["Praios-Tempel"],
        text: "{{Infobox Bauwerk\n|Art=Tempel\n}}\nEin Tempel.",
    },
    { id: 204, titel: "Wehrgang am Fluss", ns: 0, kategorien: [], text: "{{Infobox Bauwerk\n|Art=[[Mauer]]\n}}\n" },
    {
        id: 205,
        titel: "Viererlen",
        ns: 0,
        kategorien: [],
        text: "{{Infobox Siedlung\n|Name=Viererlen\n|Siedlungsart=[[Gut]]\n|Art=Gut\n}}\nEin Gut.",
    },
    { id: 206, titel: "Namenloser Bau", ns: 0, kategorien: [], text: "{{Infobox Bauwerk\n|Art=Gebäude\n}}\n" },
    { id: 207, titel: "Doppelturm", ns: 0, kategorien: [], text: "{{Infobox Bauwerk\n|Typ=Turm|Ruine\n}}\n" },
];

const GOLD_RUECKFALL = {
    // Die Kategorie gewinnt (Burg Trollhammer: Festung, nicht „Burg“); ohne passende Kategorie die Infobox.
    bauwerkart: [
        ["burg Trollhammer", "Festung"],
        ["doppelturm", "Turm"],
        ["magiekundliche Investigations-Cammer", "Lager"],
        ["praios-Tempel zu Grangor", "Tempel"],
    ],
};

describe("der Rückfall der Bauwerkart auf die Infobox (WI-0295 T1)", () => {
    const objekte = RUECKFALL_SEITEN.map((seite) => objekt("ort", seite.titel));
    const seiteJeTitel = new Map(
        RUECKFALL_SEITEN.map((seite) => [seite.titel, { id: seite.id, ns: seite.ns, weiterleitung: false }]),
    );
    const kategorienJeSeite = new Map(RUECKFALL_SEITEN.map((seite) => [seite.id, seite.kategorien]));
    const gefunden = new Map(
        RUECKFALL_SEITEN.map((seite) => [
            seite.titel,
            [{ titel: seite.titel, ns: seite.ns, weiterleitung: null, text: seite.text }],
        ]),
    );
    const arten = schliesseArtenAb([]);

    it("erst die Kategorie, sonst Art= oder Typ= der Infobox Bauwerk: Linktext, erster Wert, keine Mauer, kein Klassenwort, keine Siedlung", () => {
        const ausDatei = baueErgebnisse({ objekte, seiteJeTitel, kategorienJeSeite, arten });
        expect(alsListe(ausDatei.ort.bauwerkart)).toEqual([["burg Trollhammer", "Festung"]]);
        expect(alsListe(ergaenzeBauwerkart(ausDatei.ort.bauwerkart, objekte, gefunden))).toEqual(
            GOLD_RUECKFALL.bauwerkart,
        );
    });

    it("lässt die Werte aus der Datei unverändert: GOLD des Modell-Wikis bleibt, die alte Karte wird nicht verändert", async () => {
        const ergebnisse = await ergebnisseUeberDatei();
        const vorher = alsListe(ergebnisse.ort.bauwerkart);
        // Die Seiten des Modells haben keinen Text mit Infobox: Der Rückfall findet nichts dazu.
        const ohneText = new Map(
            MODELL.map((seite) => [
                seite.titel,
                [{ titel: seite.titel, ns: seite.ns, weiterleitung: seite.weiterleitung ?? null, text: "" }],
            ]),
        );
        expect(alsListe(ergaenzeBauwerkart(ergebnisse.ort.bauwerkart, OBJEKTE, ohneText))).toEqual(GOLD.bauwerkart);
        expect(alsListe(ergebnisse.ort.bauwerkart)).toEqual(vorher);
    });

    it("die Art der Infobox allein: Lehreinrichtung zählt, eine offene Klammer nicht", () => {
        expect(bauwerkartAusInfobox(analysiere("Schule", "{{Infobox Lehreinrichtung\n|Art=Magierakademie\n}}"))).toBe(
            "Magierakademie",
        );
        expect(bauwerkartAusInfobox(analysiere("Offen", "{{Infobox Bauwerk\n|Art=Tempel\n"))).toBeUndefined();
        expect(bauwerkartAusInfobox(analysiere("Leer", "{{Infobox Bauwerk\n|Art=\n}}"))).toBeUndefined();
    });
});

describe("Hilfen", () => {
    it("die Seiten für die Kategorien sind die Seiten der Objekte der drei Bereiche, ohne getrennte und Weiterleitungen", () => {
        const ids = seitenFuerKategorien(OBJEKTE, SEITE_JE_TITEL);
        expect(ids.has(101)).toBe(true);
        expect(ids.has(112)).toBe(false);
        expect(ids.has(99_999)).toBe(false);
        // Eine getrennte Zuordnung allein trägt nichts bei, und ein Objekt eines Bereichs ohne Kategorien auch nicht.
        expect(seitenFuerKategorien([objekt("ort", "Gareth", { zustand: "getrennt" })], SEITE_JE_TITEL).size).toBe(0);
        expect(seitenFuerKategorien([objekt("weg", "Gareth")], SEITE_JE_TITEL).size).toBe(0);
    });

    it("schreibt mit dem Anfangsbuchstaben klein gefundene Adressen auf dieselbe Seite", () => {
        const klein = objekt("ort", "gareth");
        const ergebnisse = baueErgebnisse({
            objekte: [klein],
            seiteJeTitel: SEITE_JE_TITEL,
            kategorienJeSeite: new Map([[101, ["Dorf"]]]),
            arten: [],
        });
        expect(ergebnisse.ort.ortsgroesse?.get(titelSchluessel("gareth"))).toBe("dorf");
    });

    it("eine leere Datei liefert nichts: Der Strom endet mit kategorien_unvollstaendig", async () => {
        const pfad = join(ordner.pfad, "leer.sql.gz");
        await writeFile(pfad, "");
        await expect(leseKategorienJeSeite(pfad, new Set([1]))).rejects.toMatchObject({
            code: "kategorien_unvollstaendig",
        });
    });
});
