import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { landmarkeAdresse } from "../src/wiki/abgleich/landmarken.ts";
import { ortArtikelObjekt } from "../src/wiki/abgleich/lokal.ts";
import {
    GRUND_ORT_ARTIKEL_BEKANNT,
    GRUND_ORT_ARTIKEL_NEU,
    GRUND_ORT_ARTIKEL_NICHT_IM_DUMP,
    GRUND_ORT_ARTIKEL_WIEDER,
    genannteOrte,
    leseStandortOrte,
    neueOrtArtikelId,
    ORT_ARTIKEL_ART,
    ortArtikelSchluessel,
    standortOrteWert,
} from "../src/wiki/abgleich/ort-artikel.ts";
import type { ZielInfo } from "../src/wiki/abgleich/ortsrolle.ts";
import { berechnePlan, laufIstGrundlage, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import type { KandidatNeuerArtikel, OrtArtikelSeite } from "../src/wiki/dump/seiten-sammler.ts";
import { schliesseArtenAb } from "../src/wiki/kategorien/bauwerkarten.ts";

/**
 * Der Plan der Orts- und Bauwerk-Artikel ohne Ort im Bereich `ort` (WI-0295 Teil 2), REIN. Auslöser: Seit dem Cutoff kommen neue Wiki-Artikel nicht mehr in Ortsliste und Wiki-Box (Burg Trollhammer, Burg Wandleth,
 * die Magiekundliche Investigations-Cammer in Rommilys); der Lauf vom 08.11. zählte 1.114 neue Artikel nur.
 *
 * Prüffälle aus dem Work Item: Trollhammer → Festung (Kategorie vor `Art=`); die Cammer → Lager, Standort Rommilys; Wandleth gehört über die Kategorie „Aventurien-Artikel“ dazu; Viererlen → Ortsklasse und Art aus
 * den Kategorien; ein Artikel aus Myranor bleibt draußen; ein Titel aus Legacys Registry wird keine zweite Zeile; ein Tempel ohne passende Kategorie bekommt `Art=Tempel`.
 * Problemfälle: Die eigenen Zeilen legt der nächste Lauf still; eine lineare Anlage (Mauer) wird ein Punkt; ein Artikel zählt doppelt (Zeile und „neuer Artikel“).
 */

const seite = (id: number, titel: string, text: string, ns = 0): OrtArtikelSeite => ({
    id,
    titel,
    ns,
    weiterleitung: null,
    text,
});

const SEITEN: readonly OrtArtikelSeite[] = [
    seite(
        1,
        "Burg Trollhammer",
        "{{Infobox Bauwerk\n|Name=Burg Trollhammer\n|Art=[[Burg (Architektur)|Burg]]\n|Standort=[[Kosch]]: [[Schlossviertel]]\n}}\n'''Burg Trollhammer''' ist eine [[Burg]] im [[Kosch]].",
    ),
    seite(
        2,
        "Magiekundliche Investigations-Cammer",
        "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=[[Lager]]\n|Standort=[[Rommilys]]\n}}\nDie Cammer ist ein Lager in [[Rommilys]].",
    ),
    seite(
        3,
        "Burg Wandleth",
        "{{Infobox Bauwerk\n|Name=Burg Wandleth\n|Art=Burg\n|Region=[[Dragestan]]\n}}\nEine Burg.",
    ),
    seite(
        4,
        "Viererlen",
        "{{Aventurien}}\n{{Infobox Siedlung\n|Name=Viererlen\n|Siedlungsart=[[Gut]]\n|Region=[[Nordmarken]]\n|Staat=[[Mittelreich]]\n}}\nDas [[Gut]] '''Viererlen''' liegt in der [[Baronie Kranick]].",
    ),
    seite(5, "Askanaz", "{{Myranor}}\n{{Infobox Bauwerk\n|Art=Tempel\n}}\nEin Tempel in Myranor."),
    seite(
        6,
        "Praios-Tempel zu Grangor",
        "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=Tempel\n|Standort=[[Grangor]]\n}}\nEin Tempel.",
    ),
    seite(7, "Wehrmauer von Winhall", "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=[[Mauer]]\n}}\nEine Mauer."),
    seite(8, "Alte Burg Legacy", "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=Burg\n}}\nSchon in Legacys Registry."),
    seite(9, "Drachenturm (Dragestan)", "{{Infobox Bauwerk\n|Art=Turm\n|Region=[[Dragestan]]\n}}\nEin Turm."),
    seite(10, "Inoffiziell:Kleinhof", "{{Infobox Siedlung\n|Name=Kleinhof\n}}\nEin Hof.", 222),
];

const KATEGORIEN = new Map<string, readonly string[]>([
    ["Burg Trollhammer", ["Festung", "Aventurien-Artikel"]],
    ["Magiekundliche Investigations-Cammer", []],
    ["Burg Wandleth", ["Aventurien-Artikel"]],
    ["Viererlen", ["Gut", "Dorf", "Aventurien-Artikel"]],
    ["Askanaz", ["Myranor-Artikel"]],
    ["Praios-Tempel zu Grangor", ["Praios-Tempel", "Aventurien-Artikel"]],
    ["Wehrmauer von Winhall", ["Aventurien-Artikel"]],
    ["Alte Burg Legacy", ["Festung", "Aventurien-Artikel"]],
    ["Drachenturm (Dragestan)", ["Turm"]],
    ["Inoffiziell:Kleinhof", ["Dorf"]],
]);

/** Was der Dump über Linkziele weiß: eine Weiterleitung (Stadtteil → Stadt) und eine Elternkette nach Myranor. */
const ZIELE = new Map<string, ZielInfo>([
    ["Schlossviertel", { weiterleitung: "Alt-Gareth" }],
    ["Dragestan", { infobox: "Region", eltern: ["Myranor"] }],
    ["Burg Wandleth", { infobox: "Bauwerk", eltern: ["Dragestan"] }],
    ["Drachenturm (Dragestan)", { infobox: "Bauwerk", eltern: ["Dragestan"] }],
]);

/** Die neuen Artikel, wie der Sammler sie als Kandidaten führt (für die Zahl „neuer Artikel“). */
const KANDIDATEN: readonly KandidatNeuerArtikel[] = SEITEN.map((eintrag) => ({
    titel: eintrag.titel,
    ns: eintrag.ns,
    infobox: eintrag.text.includes("Infobox Siedlung") ? "Siedlung" : "Bauwerk",
    art: eintrag.text.includes("Infobox Siedlung") ? ("ort" as const) : ("bauwerk" as const),
}));

const ID = {
    trollhammer: "c1000000-0000-4000-8000-000000000001",
    verschwunden: "c1000000-0000-4000-8000-000000000002",
    still: "c1000000-0000-4000-8000-000000000003",
};

/** Eine Zeile der Registry (WikiSync) samt Wiki-Stand, wie der Lader sie liest. */
function eintrag(id: string, titel: string, werte: Record<string, unknown> = {}, aktiv = true): PlanObjekt {
    return ortArtikelObjekt({
        id,
        wiki_key: ortArtikelSchluessel(titel),
        title: titel,
        wiki_url: landmarkeAdresse(titel),
        is_active: aktiv,
        hat_stand: true,
        ...werte,
    });
}

function plan(
    objekte: readonly PlanObjekt[],
    optionen: { bekannt?: readonly string[]; ohneKategorien?: boolean } = {},
): ReturnType<typeof berechnePlan> {
    return berechnePlan({
        bereiche: ["ort"],
        objekte,
        dump: { gefunden: new Map(), kandidaten: KANDIDATEN, ortArtikel: SEITEN, ziele: ZIELE },
        tafel: wikiNamespaceTafel(),
        bekannteTitel: new Set((optionen.bekannt ?? []).map((titel) => titel.toLowerCase())),
        ...(optionen.ohneKategorien === true
            ? {}
            : {
                  ortArtikel: {
                      kategorien: KATEGORIEN,
                      arten: schliesseArtenAb([]),
                      bekannt: new Set((optionen.bekannt ?? []).map(ortArtikelSchluessel)),
                  },
              }),
    });
}

const ortArtikelZeilen = (zeilen: readonly PlanZeile[]): PlanZeile[] =>
    zeilen.filter((zeile) => zeile.objektArt === ORT_ARTIKEL_ART);
const felderVon = (zeilen: readonly PlanZeile[], titel: string): Record<string, string | null> =>
    Object.fromEntries(
        ortArtikelZeilen(zeilen)
            .filter((zeile) => zeile.artikel === titel)
            .map((zeile) => [zeile.feld, zeile.neu]),
    );
const titelDer = (zeilen: readonly PlanZeile[]): string[] =>
    [...new Set(ortArtikelZeilen(zeilen).map((zeile) => zeile.artikel as string))].sort();

describe("Welche Artikel ein Eintrag werden", () => {
    const { zeilen } = plan([], { bekannt: ["Alte Burg Legacy"] });

    it("🔴 nimmt Bauwerke und Siedlungen, Wandleth über die Kategorie, lässt Myranor, die Mauer und Legacys Registry draußen", () => {
        expect(titelDer(zeilen)).toEqual([
            "Burg Trollhammer",
            "Burg Wandleth",
            "Inoffiziell:Kleinhof",
            "Magiekundliche Investigations-Cammer",
            "Praios-Tempel zu Grangor",
            "Viererlen",
        ]);
    });

    it("Ohne die Kategorie entscheidet die Elternkette: Der Drachenturm führt nach Myranor und bleibt draußen", () => {
        expect(titelDer(zeilen)).not.toContain("Drachenturm (Dragestan)");
        // Dieselbe Kette mit der Kategorie: Wandleth bleibt.
        expect(titelDer(zeilen)).toContain("Burg Wandleth");
    });

    it("zählt nur, was keine Zeile wird, als neuen Artikel: Myranor, Mauer und Drachenturm; Legacys Titel nicht", () => {
        const neu = zeilen.filter((zeile) => zeile.befund === "neuer_artikel").map((zeile) => zeile.artikel);
        expect(neu.sort()).toEqual(["Askanaz", "Drachenturm (Dragestan)", "Wehrmauer von Winhall"]);
    });

    it("rechnet ohne die Kategorien-Datei nichts, auch kein Stilllegen", () => {
        const ohne = plan([eintrag(ID.verschwunden, "Verschwundene Burg")], { ohneKategorien: true });
        expect(ortArtikelZeilen(ohne.zeilen)).toEqual([]);
    });
});

describe("Die Felder eines neuen Eintrags", () => {
    const { zeilen, zahlen } = plan([], { bekannt: ["Alte Burg Legacy"] });

    it("🔴 Burg Trollhammer: Festung aus der Kategorie (nicht „Burg“ aus Art=), Gebäude, Standort mit aufgelöster Weiterleitung", () => {
        expect(felderVon(zeilen, "Burg Trollhammer")).toMatchObject({
            artikel: "Burg Trollhammer",
            name: "Burg Trollhammer",
            settlement_class: "gebaeude",
            building_type: "Festung",
            standort: "[[Kosch]]: [[Schlossviertel]]",
            standort_orte: "Kosch → wiki:kosch\nSchlossviertel → wiki:alt-gareth",
        });
        const kopf = ortArtikelZeilen(zeilen).find(
            (zeile) => zeile.artikel === "Burg Trollhammer" && zeile.feld === "artikel",
        );
        expect(kopf).toMatchObject({
            objektId: neueOrtArtikelId(ortArtikelSchluessel("Burg Trollhammer")),
            status: "neu",
            wirkung: "uebernommen",
            grund: GRUND_ORT_ARTIKEL_NEU,
        });
    });

    it("🔴 die Cammer: Lager aus Art=, Standort Rommilys", () => {
        expect(felderVon(zeilen, "Magiekundliche Investigations-Cammer")).toMatchObject({
            building_type: "Lager",
            standort_orte: "Rommilys → wiki:rommilys",
        });
    });

    it("🔴 ein Tempel ohne passende Kategorie bekommt Art=Tempel", () => {
        expect(felderVon(zeilen, "Praios-Tempel zu Grangor")["building_type"]).toBe("Tempel");
    });

    it("🔴 Viererlen: Ortsklasse und Art aus den Kategorien, Lage aus Region und Staat, kein Standort", () => {
        const felder = felderVon(zeilen, "Viererlen");
        expect(felder).toMatchObject({
            settlement_class: "dorf",
            building_type: "Gut",
            lage: "Nordmarken · Mittelreich",
        });
        expect(felder["standort"]).toBeUndefined();
    });

    it("eine Siedlung außerhalb des Hauptraums bekommt keine Klasse aus der Kategorie (sie gilt als geraten)", () => {
        expect(felderVon(zeilen, "Inoffiziell:Kleinhof")["settlement_class"]).toBeUndefined();
    });

    it("zählt angelegt, und die Zeilen sind Übernahmen", () => {
        expect(zahlen.ort?.angelegt).toBe(6);
        expect(ortArtikelZeilen(zeilen).every((zeile) => zeile.wirkung === "uebernommen")).toBe(true);
    });
});

describe("Der Lebenslauf eines Eintrags", () => {
    const trollhammer = (werte: Record<string, unknown> = {}, aktiv = true): PlanObjekt =>
        eintrag(
            ID.trollhammer,
            "Burg Trollhammer",
            {
                wiki_name: "Burg Trollhammer",
                r_settlement_class: "gebaeude",
                s_settlement_class: "gebaeude",
                building_type: "Festung",
                standort: "[[Kosch]]: [[Schlossviertel]]",
                standort_orte: "Kosch → wiki:kosch\nSchlossviertel → wiki:alt-gareth",
                description: "Burg Trollhammer ist eine Burg im Kosch.",
                ...werte,
            },
            aktiv,
        );

    it("🔴 ein unveränderter Eintrag ergibt keine Zeile; der nächste Lauf legt die eigenen nicht still", () => {
        const { zeilen } = plan([trollhammer()]);
        expect(ortArtikelZeilen(zeilen).filter((zeile) => zeile.artikel === "Burg Trollhammer")).toEqual([]);
    });

    it("ein geändertes Feld folgt dem Wiki", () => {
        const { zeilen } = plan([trollhammer({ building_type: "Burg" })]);
        const zeile = ortArtikelZeilen(zeilen).find(
            (eintrag) => eintrag.objektId === ID.trollhammer && eintrag.feld === "building_type",
        );
        expect(zeile).toMatchObject({ objektId: ID.trollhammer, alt: "Burg", neu: "Festung", wirkung: "uebernommen" });
    });

    it("ein verschwundener Artikel wird still gelegt, ein still gelegter lebt wieder auf", () => {
        const { zeilen } = plan([eintrag(ID.verschwunden, "Verschwundene Burg"), trollhammer({}, false)]);
        const still = ortArtikelZeilen(zeilen).find((zeile) => zeile.objektId === ID.verschwunden);
        expect(still).toMatchObject({
            feld: "artikel",
            status: "zu_entfernen",
            grund: GRUND_ORT_ARTIKEL_NICHT_IM_DUMP,
        });
        const wieder = ortArtikelZeilen(zeilen).find(
            (zeile) => zeile.objektId === ID.trollhammer && zeile.feld === "artikel",
        );
        expect(wieder).toMatchObject({ neu: "Burg Trollhammer", grund: GRUND_ORT_ARTIKEL_WIEDER });
    });

    it("kennt die Karte den Artikel inzwischen, wird der Eintrag still gelegt", () => {
        const { zeilen } = plan([trollhammer()], { bekannt: ["Burg Trollhammer"] });
        const zeile = ortArtikelZeilen(zeilen).find((eintrag) => eintrag.objektId === ID.trollhammer);
        expect(zeile).toMatchObject({ feld: "artikel", status: "zu_entfernen", grund: GRUND_ORT_ARTIKEL_BEKANNT });
    });

    it("ein Lauf von vor Stand 15 ist für die Orte keine Grundlage mehr", () => {
        expect(laufIstGrundlage("ort", "wikisync-parser-14")).toBe(false);
        expect(laufIstGrundlage("ort", "wikisync-parser-15")).toBe(true);
    });
});

describe("Die genannten Orte", () => {
    it("folgen Legacys Linkzielen: Abschnitt weg, Anzeige egal, Weiterleitung aufgelöst; der Wert liest sich zurück", () => {
        const wissen = { info: (titel: string) => ZIELE.get(titel), istFlaeche: () => false };
        const orte = genannteOrte("[[Gareth#Alt-Gareth|Alt-Gareth]]: [[Schlossviertel]], [[Burg]]", wissen);
        expect(orte).toEqual([
            { ziel: "Gareth", schluessel: "wiki:gareth" },
            { ziel: "Schlossviertel", schluessel: "wiki:alt-gareth" },
            { ziel: "Burg", schluessel: "wiki:burg" },
        ]);
        expect(leseStandortOrte(standortOrteWert(orte))).toEqual(orte);
        expect(genannteOrte("bei der Stadt", wissen)).toEqual([]);
    });
});
