import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITORPANEL, type SpracheEditorListe } from "@avesmaps3d/shared";
import { berechne } from "../src/editor-liste/liste-modell.ts";
import { ORTE_LEGENDE } from "../src/editor-liste/orte-liste.ts";
import { quellenFuer } from "../src/map/edit-revision.ts";
import { ansichtFuerHinflug } from "../src/map/hinflug-ansicht.ts";
import { SPRACHE_MISCH_SOURCE_ID, SPRACHE_SOURCE_ID, SPRACHEN_QUELLEN_NACH_ART } from "../src/map/sprachen-layers.ts";
import {
    artikelSchluessel,
    artikelVon,
    KREIS_VON_ZUSTAND,
    SPRACHEN_LEGENDE,
    SPRACHEN_OPTIONEN,
    wertName,
    wikiStand,
    zaehlungAusSprachen,
    zeilenVon,
} from "../src/spracheditor/sprachen-liste.ts";

/**
 * Die Liste des Spracheditors (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` Zustand 5 und 6): Sprachen und freie Wiki-Artikel mit den vier
 * Zuständen aller Editor-Listen, Farbpunkt, knappe Zahlen, Trichter (Zustand, Stand) und Sortierung. Dazu, was die Karte nach dem Speichern
 * neu lädt (`QUELLEN_NACH_ART`), und wohin ein Klick die Karte stellt.
 */

const ID = (n: number): string => `5d2c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LISTE: SpracheEditorListe = {
    zeilen: [
        {
            art: "sprache",
            id: ID(1),
            schluessel: "garethi",
            name: "Garethi",
            legende: null,
            farbe: "#ffb901",
            reihenfolge: 1,
            herkunft: "sprachenkarte",
            revision: 3,
            aktiv: true,
            teilflaechen: 12,
            flaeche: 15200.5,
            wikiArtikel: 1,
            ersterArtikel: "Garethi",
            zustand: "platziert_wiki",
        },
        {
            art: "sprache",
            id: ID(2),
            schluessel: "tahaya",
            name: "Tahaya",
            legende: "Tahaya (Waldmenschen und Utulus)",
            farbe: "#78373d",
            reihenfolge: 2,
            herkunft: "sprachenkarte",
            revision: 1,
            aktiv: true,
            teilflaechen: 1,
            flaeche: 9000,
            wikiArtikel: 0,
            ersterArtikel: null,
            zustand: "platziert_ohne_wiki",
        },
        {
            art: "sprache",
            id: ID(3),
            schluessel: "kemi",
            name: "Kemi",
            legende: null,
            farbe: "#8f6fb3",
            reihenfolge: 3,
            herkunft: "redaktion",
            revision: 1,
            aktiv: true,
            teilflaechen: 0,
            flaeche: 0,
            wikiArtikel: 0,
            ersterArtikel: null,
            zustand: "leer",
        },
        {
            art: "sprache",
            id: ID(4),
            schluessel: "alt",
            name: "Alt",
            legende: null,
            farbe: "#7f7774",
            reihenfolge: 4,
            herkunft: "redaktion",
            revision: 2,
            aktiv: false,
            teilflaechen: 3,
            flaeche: 400,
            wikiArtikel: 2,
            ersterArtikel: "Alt-A",
            zustand: "platziert_wiki",
        },
        {
            art: "artikel",
            id: ID(9),
            titel: "Alaani",
            name: null,
            kurzbeschreibung: "Sprache der Norbarden",
            sprachfamilie: "Nivesische Sprachen",
            zustand: "nur_wiki",
        },
    ],
    zahlen: { platziertWiki: 1, nurWiki: 1, platziertOhneWiki: 1, leer: 1 },
};

const stand = (filter: Map<string, Set<string>>, sortierung = "name", suche = "") => ({
    suche,
    filter,
    sortierung,
    offen: new Set<string>(),
});
const vorbelegt = (): Map<string, Set<string>> =>
    new Map([...(SPRACHEN_OPTIONEN.vorbelegt ?? new Map())].map(([k, v]) => [k, new Set(v)]));

describe("Die Liste der Sprachen (WI-0261 S5d2)", () => {
    const zeilen = zeilenVon(LISTE);

    it("🔴 die vier Zustände wie in allen Editor-Listen: ● ◐ ◑ ○, freie Artikel ◐, dieselbe Legende wie unter der Ortsliste", () => {
        expect(KREIS_VON_ZUSTAND).toEqual({
            platziert_wiki: "voll",
            nur_wiki: "halb",
            platziert_ohne_wiki: "halb-rechts",
            leer: "leer",
        });
        expect(zeilen.map((z) => z.kreis)).toEqual(["voll", "halb-rechts", "leer", "voll", "halb"]);
        expect(SPRACHEN_LEGENDE).toBe(ORTE_LEGENDE);
        expect(SPRACHEN_LEGENDE()).toEqual({
            voll: "platziert und dem Wiki zugewiesen",
            halb: "nur im Wiki, nicht platziert",
            "halb-rechts": "platziert, ohne Wiki-Artikel",
            leer: "nicht platziert, ohne Wiki-Artikel",
        });
    });

    it("Farbpunkt, Name, knappe Unterzeile; ein freier Artikel unter eigenem Schlüssel und ohne Farbe", () => {
        expect(zeilen[0]).toMatchObject({
            key: ID(1),
            name: "Garethi",
            farbe: "#ffb901",
            unter: { text: "✓ Wiki: Garethi · 12 Teilflächen", ton: "gut" },
        });
        expect(zeilen[1]?.unter).toEqual({ text: "⚠ kein Wiki-Artikel · 1 Teilfläche", ton: "warnung" });
        expect(zeilen[3]).toMatchObject({ unter: { text: "Stillgelegt", ton: "warnung" }, zaehltNicht: true });
        const artikel = zeilen[4]!;
        expect(artikel.key).toBe(artikelSchluessel(ID(9)));
        expect(artikelVon(artikel.key)).toBe(ID(9));
        expect(artikelVon(ID(1))).toBeUndefined();
        expect(artikel.farbe).toBeUndefined();
        expect(artikel).toMatchObject({
            name: "Alaani",
            rechts: "Wiki-Artikel",
            unter: { text: "Nivesische Sprachen" },
        });
        expect(wikiStand({ wikiArtikel: 3, ersterArtikel: "Thorwalsch" })).toBe("✓ Wiki: 3 Artikel");
    });

    it("🔴 Trichter: vorbelegt nur Aktives, Stillgelegtes zählt in keiner Legende; „Zustand“ filtert die Kreise", () => {
        const ergebnis = berechne(zeilen, stand(vorbelegt()), SPRACHEN_OPTIONEN);
        expect(ergebnis.treffer.map((z) => z.name)).toEqual(["Alaani", "Garethi", "Kemi", "Tahaya"]);
        const still = berechne(zeilen, stand(new Map([["stand", new Set(["stillgelegt"])]])), SPRACHEN_OPTIONEN);
        expect(still.treffer.map((z) => z.name)).toEqual(["Alt"]);
        expect(still.bilanz.voll).toBe(0);
        const nurWiki = berechne(
            zeilen,
            stand(new Map([...vorbelegt(), ["zustand", new Set(["nur_wiki"])]])),
            SPRACHEN_OPTIONEN,
        );
        expect(nurWiki.treffer.map((z) => z.name)).toEqual(["Alaani"]);
        expect(wertName("zustand", "platziert_ohne_wiki")).toBe("platziert, ohne Wiki-Artikel");
        expect(wertName("stand", "stillgelegt")).toBe("Stillgelegt");
        expect(EDITORPANEL.eintraege.find((x) => x.id === "sprachen")).toMatchObject({
            facetten: ["zustand", "stand"],
            verb: { werkzeug: "spracheditor", schreiben: ["edit_languages"] },
        });
    });

    it("Sortierung: nach Fläche die größte zuerst, nach Zustand ○ zuerst, die Suche faltet Akzente", () => {
        const flaeche = berechne(zeilen, stand(vorbelegt(), "flaeche"), SPRACHEN_OPTIONEN);
        expect(flaeche.treffer.map((z) => z.name).slice(0, 2)).toEqual(["Garethi", "Tahaya"]);
        const kreis = berechne(zeilen, stand(vorbelegt(), "kreis"), SPRACHEN_OPTIONEN);
        expect(kreis.treffer[0]?.name).toBe("Kemi");
        expect(berechne(zeilen, stand(vorbelegt(), "name", "garéthi"), SPRACHEN_OPTIONEN).treffer).toHaveLength(1);
    });

    it("die Kachel „Sprachen“ zählt die Zahlen des Servers je Zustand", () => {
        expect(zaehlungAusSprachen({ platziertWiki: 9, nurWiki: 80, platziertOhneWiki: 2, leer: 1 })).toEqual({
            gesamt: 92,
            kreise: { voll: 9, halb: 80, "halb-rechts": 2, leer: 1 },
        });
    });
});

describe("Karte und Ansicht (WI-0261 S5d2)", () => {
    it("🔴 QUELLEN_NACH_ART: Sprache und Teilfläche laden nur die Kacheln der Sprachen; gemischt mit einem Ort alles", () => {
        const sprachen = [SPRACHE_SOURCE_ID, SPRACHE_MISCH_SOURCE_ID];
        expect(quellenFuer([{ kind: "sprache_flaeche", id: "x", revision: 2 }], SPRACHEN_QUELLEN_NACH_ART)).toEqual(
            sprachen,
        );
        expect(
            quellenFuer([{ kind: "sprache" }, { kind: "sprache_flaeche" }], { ...SPRACHEN_QUELLEN_NACH_ART }),
        ).toEqual(sprachen);
        expect(quellenFuer([{ kind: "sprache" }, { kind: "place" }], SPRACHEN_QUELLEN_NACH_ART)).toBeUndefined();
        expect(Object.keys(SPRACHEN_QUELLEN_NACH_ART).sort()).toEqual(["sprache", "sprache_flaeche"]);
        // `app.vue` spreizt die Tafel in `QUELLEN_NACH_ART`: Fehlte sie dort, lüde jede Teilfläche alle Quellen neu.
        const app = readFileSync(resolve(import.meta.dirname, "../src/app.vue"), "utf8");
        expect(/const QUELLEN_NACH_ART = \{[^}]*\.\.\.SPRACHEN_QUELLEN_NACH_ART,/u.test(app)).toBe(true);
    });

    it("ein Klick in der Liste stellt die Karte auf Derographie › Sprachen", () => {
        expect(ansichtFuerHinflug({ art: "sprache" })).toEqual({ view: "landscapes", landscape: "sprachen" });
    });
});
