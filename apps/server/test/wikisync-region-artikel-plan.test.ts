import { wikiNamespaceTafel, type WikisyncBereich } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { ebeneDerWikiArt } from "../src/editor/wiki-eintraege.ts";
import { regionArtikelObjekt } from "../src/wiki/abgleich/lokal.ts";
import type { ZielInfo } from "../src/wiki/abgleich/ortsrolle.ts";
import { berechnePlan, laufIstGrundlage, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import {
    GRUND_REGION_ARTIKEL_KEINER,
    GRUND_REGION_ARTIKEL_NEU,
    GRUND_REGION_ARTIKEL_NICHT_IM_DUMP,
    GRUND_REGION_ARTIKEL_WIEDER,
    neueRegionArtikelId,
} from "../src/wiki/abgleich/region-artikel.ts";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { landmarkeAdresse } from "../src/wiki/abgleich/landmarken.ts";
import { landmarkeSchluessel } from "../src/wiki/infobox/landmarke.ts";
import { gehoertZurFlaechenliste } from "../src/wiki/infobox/region-artikel.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";

/**
 * Der Plan der Wiki-Einträge ohne Fläche im Bereich `region` (WI-0284), REIN. Auslöser: Frühlingsstrand steht im Wiki, die Fläche auf der Karte, aber der Artikel ließ sich nicht zuweisen.
 *
 * Problemfälle: Ein Artikel, der schon an einer Fläche hängt, kommt doppelt in die Liste oder wird still gelegt (dann verlöre die Fläche ihren Wiki-Stand); Berge und Höhlen stehen zweimal in der Liste; Myranor füllt
 * die Liste; ein Artikel ohne Vorlage `{{Aventurien}}` fehlt, obwohl er aventurisch ist.
 */

const seite = (titel: string, text: string): GelesenerDumpArtikel => ({ titel, ns: 0, weiterleitung: null, text });
const FRUEHLINGSSTRAND =
    "{{Aventurien}}{{Heiligtum|Peraine}}\n{{Infobox Region\n|Name=Frühlingsstrand\n|Art=Insel\n|Region=[[Perlenmeer]]: [[Blutige See (Meer)|Blutige See]]\n|SÜD=[[Rulat]]\n}}\n'''Frühlingsstrand''' ist eine [[Insel]] nördlich von [[Rulat]].\n";
const SEITEN: readonly GelesenerDumpArtikel[] = [
    seite("Frühlingsstrand", FRUEHLINGSSTRAND),
    seite("Ilramwald", "{{Infobox Region\n|Name=Ilramwald\n|Art=Wald\n|Region=[[Tobrien]]\n}}\nEin Wald."),
    seite("Drachenhöhle", "{{Aventurien}}{{Infobox Region\n|Name=Drachenhöhle\n|Art=Höhle\n}}\nEine Höhle."),
    seite("Valantisches Meer", "{{Myranor}}{{Infobox Region\n|Name=Valantisches Meer\n|Art=Meer\n}}\nEin Meer."),
];

const ID = {
    ilramwald: "b8000000-0000-4000-8000-000000000001",
    verschwunden: "b8000000-0000-4000-8000-000000000002",
};

/** Eine Zeile von `wiki_region_snapshot`, wie der Lader sie liest. */
function eintrag(id: string, titel: string, werte: Record<string, unknown> = {}, aktiv = true): PlanObjekt {
    return regionArtikelObjekt({
        id,
        wiki_key: landmarkeSchluessel(titel),
        wiki_url: landmarkeAdresse(titel),
        is_active: aktiv,
        ...werte,
    });
}

function plan(
    objekte: readonly PlanObjekt[],
    belegt: readonly string[] = [],
    legacyBereiche: readonly WikisyncBereich[] = [],
): ReturnType<typeof berechnePlan> {
    return berechnePlan({
        bereiche: ["region"],
        objekte,
        dump: { gefunden: new Map(), kandidaten: [], regionArtikel: SEITEN },
        tafel: wikiNamespaceTafel(),
        legacyBereiche: new Set(legacyBereiche),
        bekannteTitel: new Set(),
        belegteRegionArtikel: new Set(belegt.map(landmarkeSchluessel)),
    });
}

const felderVon = (zeilen: readonly PlanZeile[], titel: string): Record<string, string | null> =>
    Object.fromEntries(zeilen.filter((zeile) => zeile.artikel === titel).map((zeile) => [zeile.feld, zeile.neu]));

describe("Welche Artikel in die Liste gehören", () => {
    const gehoert = (titel: string): boolean => {
        const treffer = SEITEN.find((kandidat) => kandidat.titel === titel)!;
        return gehoertZurFlaechenliste(analysiere(treffer.titel, treffer.text));
    };

    it("nimmt Frühlingsstrand und einen aventurischen Artikel ohne die Vorlage", () => {
        expect(gehoert("Frühlingsstrand")).toBe(true);
        expect(gehoert("Ilramwald")).toBe(true);
    });

    it("lässt Landmarken und andere Kontinente weg", () => {
        expect(gehoert("Drachenhöhle")).toBe(false);
        expect(gehoert("Valantisches Meer")).toBe(false);
    });

    it("lässt eine Seite ohne Infobox Region weg", () => {
        expect(gehoertZurFlaechenliste(analysiere("Rulat", "{{Infobox Siedlung\n|Name=Rulat\n}}"))).toBe(false);
    });
});

describe("Der Plan der Wiki-Einträge", () => {
    it("🔴 legt einen neuen Artikel mit seinen Feldern an, an einer stabilen Platzhalter-Kennung", () => {
        const { zeilen, zahlen } = plan([]);
        const felder = felderVon(zeilen, "Frühlingsstrand");
        expect(felder).toMatchObject({
            artikel: "Frühlingsstrand",
            name: "Frühlingsstrand",
            art: "Insel",
            nachbar_s: "Rulat",
        });
        expect(felder["region_parent"]).toContain("Perlenmeer");
        const kopf = zeilen.find((zeile) => zeile.artikel === "Frühlingsstrand" && zeile.feld === "artikel")!;
        expect(kopf).toMatchObject({
            bereich: "region",
            objektArt: "region_artikel",
            objektId: neueRegionArtikelId(landmarkeSchluessel("Frühlingsstrand")),
            wirkung: "uebernommen",
            eigentuemer: "wiki",
            grund: GRUND_REGION_ARTIKEL_NEU,
        });
        expect(zahlen.region?.angelegt).toBe(2);
    });

    it("🔴 ein Artikel, der an einer Fläche hängt, wird kein Eintrag", () => {
        const { zeilen, zahlen } = plan([], ["Frühlingsstrand"]);
        expect(zeilen.some((zeile) => zeile.artikel === "Frühlingsstrand")).toBe(false);
        expect(zahlen.region?.angelegt).toBe(1);
    });

    it("zieht einen geänderten Eintrag nach und meldet einen unveränderten nicht", () => {
        const stand = { s_name: "Ilramwald", s_art: "Wald", region_parent: "Tobrien", s_description: "Ein Wald." };
        expect(plan([eintrag(ID.ilramwald, "Ilramwald", stand)]).zeilen.some((z) => z.objektId === ID.ilramwald)).toBe(
            false,
        );
        const geaendert = plan([eintrag(ID.ilramwald, "Ilramwald", { ...stand, region_parent: "Maraskan" })]);
        expect(geaendert.zeilen.find((z) => z.objektId === ID.ilramwald && z.feld === "region_parent")).toMatchObject({
            alt: "Maraskan",
            neu: "Tobrien",
            wirkung: "uebernommen",
        });
    });

    it("legt einen Eintrag still, dessen Artikel verschwand oder nicht mehr in die Liste gehört, und belebt ihn, wenn er zurückkommt", () => {
        const weg = plan([eintrag(ID.verschwunden, "Alte Insel", { s_name: "Alte Insel", s_art: "Insel" })]);
        expect(weg.zeilen.find((z) => z.objektId === ID.verschwunden)).toMatchObject({
            feld: "artikel",
            status: "zu_entfernen",
            grund: GRUND_REGION_ARTIKEL_NICHT_IM_DUMP,
        });
        const myranor = plan([
            eintrag(ID.verschwunden, "Valantisches Meer", { s_name: "Valantisches Meer", s_art: "Meer" }),
        ]);
        expect(myranor.zeilen.find((z) => z.objektId === ID.verschwunden)).toMatchObject({
            feld: "artikel",
            grund: GRUND_REGION_ARTIKEL_KEINER,
        });
        const zurueck = plan([
            eintrag(
                ID.ilramwald,
                "Ilramwald",
                { s_name: "Ilramwald", s_art: "Wald", region_parent: "Tobrien", s_description: "Ein Wald." },
                false,
            ),
        ]);
        expect(zurueck.zeilen.find((z) => z.objektId === ID.ilramwald && z.feld === "artikel")).toMatchObject({
            neu: "Ilramwald",
            grund: GRUND_REGION_ARTIKEL_WIEDER,
        });
    });

    it("gehört der Bereich dem Legacy-Zug, ist alles nur Befund", () => {
        const { zeilen } = plan([], [], ["region"]);
        const kopf = zeilen.find((zeile) => zeile.artikel === "Frühlingsstrand" && zeile.feld === "artikel")!;
        expect(kopf).toMatchObject({ eigentuemer: "legacy", wirkung: "befund" });
    });

    it("ein Lauf von vor Stand 14 (Winde, WI-0288) ist für die Landschaften keine Grundlage, für andere Bereiche schon", () => {
        expect(laufIstGrundlage("region", "wikisync-parser-13")).toBe(false);
        expect(laufIstGrundlage("region", "wikisync-parser-14")).toBe(true);
        expect(laufIstGrundlage("sprachen", "wikisync-parser-11")).toBe(true);
    });
});

describe("🔴 Die Elternkette entscheidet über die Welt (erster Lauf auf der Stage: rund 190 Artikel aus Myranor und Uthuria)", () => {
    const WELT_SEITEN: readonly GelesenerDumpArtikel[] = [
        seite("Frühlingsstrand", FRUEHLINGSSTRAND),
        seite(
            "Delaran",
            "{{Infobox Region\n|Name=Delaran\n|Art=Insel\n|Region=[[Myranor]]: [[Delaranische Inseln]]\n}}",
        ),
        seite("Dragestan", "{{Infobox Region\n|Name=Dragestan\n|Art=Wald\n|Region=[[Lande der Bansumiter]]\n}}"),
        seite(
            "Goldener Wald",
            "{{Aventurien}}{{Infobox Region\n|Name=Goldener Wald\n|Art=Wald\n|Region=[[Myranor]]\n}}",
        ),
        seite("Ohne Link", "{{Infobox Region\n|Name=Ohne Link\n|Art=Wald\n|Region=unbekannt\n}}"),
    ];
    const ZIELE = new Map<string, ZielInfo>([
        ["Frühlingsstrand", { infobox: "Region", eltern: ["Perlenmeer"] }],
        ["Perlenmeer", { infobox: "Region", eltern: ["Aventurien"] }],
        ["Delaran", { infobox: "Region", eltern: ["Myranor", "Delaranische Inseln"] }],
        ["Dragestan", { infobox: "Region", eltern: ["Lande der Bansumiter"] }],
        ["Lande der Bansumiter", { infobox: "Region", eltern: ["Myranor"] }],
        ["Goldener Wald", { infobox: "Region", eltern: ["Myranor"] }],
        ["Ohne Link", { infobox: "Region" }],
    ]);
    const mitWelt = (objekte: readonly PlanObjekt[] = []): ReturnType<typeof berechnePlan> =>
        berechnePlan({
            bereiche: ["region"],
            objekte,
            dump: { gefunden: new Map(), kandidaten: [], regionArtikel: WELT_SEITEN, ziele: ZIELE },
            tafel: wikiNamespaceTafel(),
            legacyBereiche: new Set(),
            bekannteTitel: new Set(),
            belegteRegionArtikel: new Set(),
        });
    const neu = (titel: string): boolean =>
        mitWelt().zeilen.some((zeile) => zeile.artikel === titel && zeile.feld === "artikel");

    it("lässt Artikel weg, deren Kette in eine andere Welt führt, auch über eine Region und trotz {{Aventurien}}", () => {
        expect(neu("Delaran")).toBe(false);
        expect(neu("Dragestan")).toBe(false);
        expect(neu("Goldener Wald")).toBe(false);
    });

    it("behält Frühlingsstrand und einen Artikel, dessen Kette nichts sagt", () => {
        expect(neu("Frühlingsstrand")).toBe(true);
        expect(neu("Ohne Link")).toBe(true);
    });

    it("legt einen schon angelegten Eintrag aus Myranor beim nächsten Lauf still", () => {
        const { zeilen } = mitWelt([eintrag(ID.verschwunden, "Delaran", { s_name: "Delaran", s_art: "Insel" })]);
        expect(zeilen.find((zeile) => zeile.objektId === ID.verschwunden)).toMatchObject({
            feld: "artikel",
            status: "zu_entfernen",
            grund: GRUND_REGION_ARTIKEL_KEINER,
        });
    });
});

describe("Die Ebene aus der Art des Artikels", () => {
    it("liest Insel, Wald und Gebirge aus der Begriffstafel", () => {
        expect(ebeneDerWikiArt("Insel")).toEqual({ layer: "topographie", type: "insel" });
        expect(ebeneDerWikiArt("Gebirge")).toEqual({ layer: "topographie", type: "gebirge" });
        expect(ebeneDerWikiArt("Wald|Hügelland").layer).toBe("vegetation");
    });

    it("stellt eine Art ohne Abbildung unter Regionen, ohne Flächenart", () => {
        expect(ebeneDerWikiArt("Schlachtfeld")).toEqual({ layer: "derographisch", type: null });
        expect(ebeneDerWikiArt(null)).toEqual({ layer: "derographisch", type: null });
    });
});
