import { wikiNamespaceTafel, type WikisyncBereich } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { landmarkenArtikelObjekt } from "../src/wiki/abgleich/lokal.ts";
import {
    GRUND_LANDMARKE_AUF_DER_KARTE,
    GRUND_LANDMARKE_NEU,
    GRUND_LANDMARKE_NICHT_IM_DUMP,
    GRUND_LANDMARKE_WIEDER,
    neueLandmarkeId,
} from "../src/wiki/abgleich/landmarken.ts";
import { berechnePlan, laufIstGrundlage, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import { landmarkenArtDerSeite, landmarkeSchluessel } from "../src/wiki/infobox/landmarke.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";

/**
 * Der Plan der Kandidaten im Bereich `gipfel`, den Landmarken (WI-0271 L7), REIN: erfundene Wiki-Seiten gegen einen erfundenen Bestand. Artikelzentriert wie die Sprachen: ein Landmarken-Artikel ohne Landmarke auf der
 * Karte → Kandidat anlegen, geändert → ändern, verschwunden oder an einer Landmarke der Karte → still legen, still gelegt und zurück → beleben.
 *
 * Problemfälle: Eine Art außerhalb der Abbildung (ein Wald) wird Kandidat; eine Mehrfachart verliert ihre Landmarke, weil die erste Art keine ist; ein Artikel, der schon an einer Landmarke der
 * Karte hängt (auch einer stillgelegten), kommt als Kandidat zurück; eine Höhle bekommt eine Höhe.
 */

const seite = (titel: string, text: string): GelesenerDumpArtikel => ({ titel, ns: 0, weiterleitung: null, text });
const region = (felder: Record<string, string>, text = "Ein Absatz über den Ort."): string =>
    `{{Infobox Region\n${Object.entries(felder)
        .map(([schluessel, wert]) => `|${schluessel}=${wert}`)
        .join("\n")}\n}}\n${text}\n`;

const SEITEN: readonly GelesenerDumpArtikel[] = [
    seite(
        "Drachenhöhle",
        region({ Name: "Drachenhöhle", Art: "Höhle", Region: "Kosch" }, "Die Drachenhöhle liegt tief im Kosch."),
    ),
    seite("Feuerschlund", region({ Name: "Feuerschlund", Art: "Vulkan|Berg", Höhe: "3.200 Schritt" })),
    seite("Kaiserkopf", region({ Name: "Kaiserkopf", Art: "Wald|Hügel" })),
    seite("Frische Quelle", "Eine Quelle im Wald.\n[[Kategorie:Süßwasserquelle]]\n"),
    seite("Darpatfälle", region({ Name: "Darpatfälle", Art: "Wasserfall" })),
];

const ID = {
    hoehle: "b7000000-0000-4000-8000-000000000001",
    verschwunden: "b7000000-0000-4000-8000-000000000002",
    darpat: "b7000000-0000-4000-8000-000000000003",
    quelle: "b7000000-0000-4000-8000-000000000004",
};

/** Eine Zeile von `wiki_landmarke_artikel`, wie der Lader sie liest. */
function artikel(id: string, titel: string, werte: Record<string, unknown> = {}, aktiv = true): PlanObjekt {
    return landmarkenArtikelObjekt({
        id,
        schluessel: landmarkeSchluessel(titel),
        titel,
        is_active: aktiv,
        unbekannt: [],
        ...werte,
    });
}

function plan(
    objekte: readonly PlanObjekt[],
    aufDerKarte: readonly string[] = [],
    legacyBereiche: readonly WikisyncBereich[] = [],
): ReturnType<typeof berechnePlan> {
    return berechnePlan({
        bereiche: ["gipfel"],
        objekte,
        dump: { gefunden: new Map(), kandidaten: [], landmarken: SEITEN },
        tafel: wikiNamespaceTafel(),
        legacyBereiche: new Set(legacyBereiche),
        bekannteTitel: new Set(),
        landmarkenAufDerKarte: new Set(aufDerKarte.map(landmarkeSchluessel)),
    });
}

const zeilenVon = (zeilen: readonly PlanZeile[], name: string): PlanZeile[] =>
    zeilen.filter((zeile) => zeile.objektName === name);
const wert = (zeilen: readonly PlanZeile[], feld: string): string | null | undefined =>
    zeilen.find((zeile) => zeile.feld === feld)?.neu;

describe("WikiSync Landmarken: die Abbildung Wiki-Art → Landmarkenart", () => {
    const art = (text: string): ReturnType<typeof landmarkenArtDerSeite> =>
        landmarkenArtDerSeite(analysiere("X", text));

    it("🔴 nur Arten der Abbildung; bei Mehrfachart die erste, die sie kennt; ein Wald ist keine Landmarke", () => {
        expect(art(region({ Art: "Höhle" }))).toEqual({ art: "hoehle", wikiArt: "Höhle" });
        expect(art(region({ Art: "Berg" }))?.art).toBe("berggipfel");
        expect(art(region({ Art: "Klamm" }))?.art).toBe("schlucht");
        expect(art(region({ Art: "Sandbank" }))?.art).toBe("riff");
        expect(art(region({ Art: "Wald|Hügel" }))).toEqual({ art: "huegel", wikiArt: "Hügel" });
        expect(art(region({ Art: "Wald" }))).toBeNull();
        expect(art(region({ Art: "Gebirge" }))).toBeNull();
        // Pässe sind Wegtypen (Vali 2026-10-31), Steinkreise keine Landmarken.
        expect(art(region({ Art: "Pass" }))).toBeNull();
        expect(art(region({ Art: "Steinkreis" }))).toBeNull();
        // Eine andere Infobox mit passender Art zählt nicht; die Kategorie Süßwasserquelle schon.
        expect(art("{{Infobox Siedlung\n|Art=Höhle\n}}\n")).toBeNull();
        expect(art("Text\n[[Kategorie:Süßwasserquelle]]")).toEqual({ art: "quelle", wikiArt: "Süßwasserquelle" });
    });

    it("🔴 OPS-000110: die Art, wie das Wiki sie schreibt: mit Klammerzusatz, in der Mehrzahl", () => {
        // Andrafälle, wie die Seite im Wiki steht (Vorlagen vor der Infobox): ein Wasserfall.
        const andrafaelle =
            "{{Nicht verwechseln|[[Andrafall]]}}\n{{Nav Derographie Streitende Königreiche}}\n{{Abgeleitet|[[Andra]]}}\n==Kurzbeschreibung==\n" +
            region({
                Name: "Andrafälle",
                Bild: "",
                Art: "Wasserfall",
                Region: "[[Streitende Königreiche]], [[Steineichenwald]]",
            }) +
            "[[Kategorie:Wasserfall]]\n";
        expect(art(andrafaelle)).toEqual({ art: "wasserfall", wikiArt: "Wasserfall" });
        // Lemmata mit Klammerzusatz, die eine Landmarke meinen (Levthanquelle, Selsenquelle, Yakushi-Quellen; Weinender Stein): die Wiki-Art ohne Zusatz.
        expect(art(region({ Art: "Quelle (Gewässer)" }))).toEqual({ art: "quelle", wikiArt: "Quelle" });
        expect(art(region({ Art: "Stein (Mineral)" }))).toEqual({ art: "fels", wikiArt: "Stein" });
        // Mahlströme sind Wetter-Icons wie die Winde, keine Landmarken (Betreiber 2026-11-11, `wikisync-wind.test.ts`); ein Berg unter Wasser ist kein Gipfel der Karte.
        expect(art(region({ Art: "Mahlstrom" }))).toBeNull();
        expect(art(region({ Art: "Mahlstrom (Strömung)" }))).toBeNull();
        expect(art(region({ Art: "Berg (unter Wasser)" }))).toBeNull();
        // Mehrzahl einer Art, die einen Ort benennt (Aytan und Itzach, Säulen des Himmels).
        expect(art(region({ Art: "Klippen" }))).toEqual({ art: "klippe", wikiArt: "Klippen" });
        expect(art(region({ Art: "Felssäulen" }))?.art).toBe("fels");
        expect(art(region({ Art: "Wasserfälle" }))?.art).toBe("wasserfall");
        expect(art(region({ Art: "Quellen" }))?.art).toBe("quelle");
        expect(art(region({ Art: "Höhlen" }))?.art).toBe("hoehle");
        // Was keine Landmarke ist, bleibt keine: Berggruppen und Kämme sind Landschaften, ein Klammerzusatz macht aus einem Wald keine, ein Komma trennt nicht (Beilunker Spitze liegt als Fläche).
        expect(art(region({ Art: "Berge" }))).toBeNull();
        expect(art(region({ Art: "Berggruppe" }))).toBeNull();
        expect(art(region({ Art: "Bergkamm" }))).toBeNull();
        expect(art(region({ Art: "Nebelwald (Vegetationszone)" }))).toBeNull();
        expect(art(region({ Art: "Hügelland, Klippe" }))).toBeNull();
    });
});

describe("WikiSync Landmarken: der Plan (artikelzentriert, nie auf die Karte)", () => {
    it("🔴 ohne Bestand: jeder Landmarken-Artikel wird Kandidat, mit Art und Feldern; einer an einer Landmarke der Karte nicht", () => {
        const ergebnis = plan([], ["Darpatfälle"]);
        expect(ergebnis.zahlen.gipfel).toMatchObject({ objekte: 0, angelegt: 4, stillgelegt: 0, befunde: 0 });
        expect(zeilenVon(ergebnis.zeilen, "Darpatfälle")).toEqual([]);

        const hoehle = zeilenVon(ergebnis.zeilen, "Drachenhöhle");
        const id = neueLandmarkeId(landmarkeSchluessel("Drachenhöhle"));
        expect(hoehle.every((zeile) => zeile.objektId === id && zeile.objektArt === "landmarke_artikel")).toBe(true);
        expect(hoehle.every((zeile) => zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen")).toBe(true);
        expect(hoehle[0]).toMatchObject({ feld: "artikel", neu: "Drachenhöhle", grund: GRUND_LANDMARKE_NEU });
        expect(hoehle.map((zeile) => zeile.feld)).toEqual([
            "artikel",
            "name",
            "art",
            "wiki_art",
            "region",
            "kurzbeschreibung",
        ]);
        expect(wert(hoehle, "art")).toBe("hoehle");
        expect(wert(hoehle, "region")).toBe("Kosch");

        // Vulkan mit Höhe; die erste Art der Abbildung entscheidet.
        const vulkan = zeilenVon(ergebnis.zeilen, "Feuerschlund");
        expect([wert(vulkan, "art"), wert(vulkan, "wiki_art"), wert(vulkan, "height")]).toEqual([
            "vulkan",
            "Vulkan",
            "3200",
        ]);
        // Mehrfachart „Wald|Hügel“: der Hügel; ohne Höhe (er formt kein Gelände).
        const huegel = zeilenVon(ergebnis.zeilen, "Kaiserkopf");
        expect([wert(huegel, "art"), wert(huegel, "height")]).toEqual(["huegel", undefined]);
        // Nur über die Kategorie: Quelle, Name aus dem Titel.
        const quelle = zeilenVon(ergebnis.zeilen, "Frische Quelle");
        expect([wert(quelle, "art"), wert(quelle, "name"), wert(quelle, "wiki_art")]).toEqual([
            "quelle",
            "Frische Quelle",
            "Süßwasserquelle",
        ]);
    });

    it("🔴 mit Bestand: geändert → ändern, verschwunden → still, an einer Landmarke der Karte → still, still gelegt und zurück → beleben", () => {
        const objekte = [
            // Die Region hat sich im Wiki geändert.
            artikel(ID.hoehle, "Drachenhöhle", {
                name: "Drachenhöhle",
                art: "hoehle",
                wiki_art: "Höhle",
                region: "Nordmarken",
                kurzbeschreibung: "Die Drachenhöhle liegt tief im Kosch.",
            }),
            artikel(ID.verschwunden, "Alte Grube", { name: "Alte Grube", art: "krater" }),
            // Inzwischen auf der Karte gesetzt (die Zuordnung hängt an einer Landmarke).
            artikel(ID.darpat, "Darpatfälle", { name: "Darpatfälle", art: "wasserfall", wiki_art: "Wasserfall" }),
            // Still gelegt und wieder im Dump.
            artikel(ID.quelle, "Frische Quelle", { name: "Frische Quelle" }, false),
        ];
        const ergebnis = plan(objekte, ["Darpatfälle"]);
        expect(ergebnis.zahlen.gipfel).toMatchObject({ objekte: 3, gefunden: 1, nichtImDump: 2, stillgelegt: 2 });

        expect(
            zeilenVon(ergebnis.zeilen, "Drachenhöhle").map((zeile) => [zeile.feld, zeile.alt, zeile.neu, zeile.status]),
        ).toEqual([["region", "Nordmarken", "Kosch", "geaendert"]]);
        expect(zeilenVon(ergebnis.zeilen, "Alte Grube")).toEqual([
            expect.objectContaining({
                feld: "artikel",
                alt: "Alte Grube",
                neu: null,
                status: "zu_entfernen",
                grund: GRUND_LANDMARKE_NICHT_IM_DUMP,
            }),
        ]);
        expect(zeilenVon(ergebnis.zeilen, "Darpatfälle")).toEqual([
            expect.objectContaining({
                feld: "artikel",
                neu: null,
                status: "zu_entfernen",
                grund: GRUND_LANDMARKE_AUF_DER_KARTE,
            }),
        ]);
        expect(zeilenVon(ergebnis.zeilen, "Frische Quelle").find((zeile) => zeile.feld === "artikel")).toMatchObject({
            alt: null,
            neu: "Frische Quelle",
            grund: GRUND_LANDMARKE_WIEDER,
        });
    });

    it("🔴 Gehört der Bereich dem Legacy-Zug, ist ein Kandidat nur Befund: Nichts wird angelegt", () => {
        const zeilen = plan([], [], ["gipfel"]).zeilen.filter((zeile) => zeile.objektArt === "landmarke_artikel");
        expect(zeilen.length).toBeGreaterThan(0);
        expect(zeilen.every((zeile) => zeile.eigentuemer === "legacy" && zeile.wirkung === "befund")).toBe(true);
    });

    it("ein Lauf mit Gipfeln bleibt ab Stand 8 eine Grundlage: Die Kandidaten kommen mit dem nächsten Lauf dazu", () => {
        expect(laufIstGrundlage("gipfel", "wikisync-parser-7")).toBe(false);
        expect(laufIstGrundlage("gipfel", "wikisync-parser-10")).toBe(true);
    });
});
