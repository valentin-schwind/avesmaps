import type { EditorPlaceDetail } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { eigene, standZeile, veraltete } from "../src/fenster/wiki-box";
import { entwurfAus, setzeText } from "../src/ortseditor/entwurf.ts";
import { ortWikiBoxFelder } from "../src/ortseditor/ort-wiki-box.ts";

/**
 * Die Felder des Orts für die Wiki-Box (WI-0253): dieselbe Rechnung wie das Formular (`entwurf.ts`), dazu der Vermerk, ob der Wert dem Wiki folgt. Daraus rechnet die Box „Das Wiki ist neuer“ und „n von m Feldern
 * folgen dem Wiki“.
 */

function ort(ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: "7527ed5b-303a-57af-926e-ed41a8b82dfc",
        revision: 7,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450.2, y: 535.64 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: "Eine Stadt am Fluss.", origin: "manual", wiki: "Hauptstadt der Grafschaft." },
            einwohner: { value: "2.000", origin: "wiki", wiki: "2.200" },
            lage: { value: "Kosch", origin: "wiki", wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        nameWiki: "Gratenfels",
        pathEnds: [],
        ...ueber,
    };
}

const NAMEN = {
    name: "Name",
    subtype: "Ortsgröße",
    description: "Beschreibung",
    einwohner: "Einwohner",
    lage: "Lage",
    oberhaupt: "Herrscher",
} as const;

describe("Ort: die Felder der Wiki-Box", () => {
    it("nennt Name, Ortsgröße und die vier Texte, je mit dem Plan-Feld des Servers (Ortsgröße = settlement_class)", () => {
        const felder = ortWikiBoxFelder(ort(), entwurfAus(ort()), NAMEN, (wert) => wert);
        expect(felder.map((f) => [f.id, f.plan[0]])).toEqual([
            ["name", "name"],
            ["subtype", "settlement_class"],
            ["description", "description"],
            ["einwohner", "einwohner"],
            ["lage", "lage"],
            ["oberhaupt", "oberhaupt"],
        ]);
        expect(felder.find((f) => f.id === "description")?.mehrzeilig).toBe(true);
    });

    it("🔴 ein Wert mit Vermerk „wiki“, der vom Wiki abweicht, ist veraltet (der Sync änderte ihn); ein eigener Wert bleibt und zählt als eigen", () => {
        const felder = ortWikiBoxFelder(ort(), entwurfAus(ort()), NAMEN, (wert) => wert);
        expect(veraltete(felder).map((f) => f.id)).toEqual(["einwohner"]);
        expect(eigene(felder).map((f) => f.id)).toEqual(["description"]);
        expect(standZeile(felder)).toEqual({ art: "neuer", fuellung: "halb" });
        // Die Zeile „vorher → nachher“ nimmt den Wert des Fensters und den Wiki-Wert.
        const einwohner = felder.find((f) => f.id === "einwohner");
        expect(einwohner).toMatchObject({ eigen: "2.000", folgt: true });
        expect(einwohner?.lage.wikiText).toBe("2.200");
    });

    it("ein getippter Wert folgt dem Wiki nicht mehr, auch wenn er wie der Wiki-Wert lautet", () => {
        const felder = ortWikiBoxFelder(
            ort(),
            setzeText(entwurfAus(ort()), "einwohner", "2.200"),
            NAMEN,
            (wert) => wert,
        );
        expect(felder.find((f) => f.id === "einwohner")).toMatchObject({ folgt: false });
        expect(veraltete(felder)).toEqual([]);
    });

    it("ohne Artikel haben die Felder kein Gegenstück: weder veraltet noch eigen, die Zeile ist „aktuell“", () => {
        const ohne = ort({ wiki: null });
        const felder = ortWikiBoxFelder(ohne, entwurfAus(ohne), NAMEN, (wert) => wert);
        expect(veraltete(felder)).toEqual([]);
        expect(eigene(felder)).toEqual([]);
        expect(standZeile(felder).art).toBe("aktuell");
    });
});
