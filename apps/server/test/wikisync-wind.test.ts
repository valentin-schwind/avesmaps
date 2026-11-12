import { WETTER_WIKI_ARTEN, WIKI_ART_WIND, wikiNamespaceTafel } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { ebeneDerWikiArt } from "../src/editor/wiki-eintraege.ts";
import { berechnePlan, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { leseSeitenFelder } from "../src/wiki/infobox/lesen.ts";
import { landmarkenArtDerSeite } from "../src/wiki/infobox/landmarke.ts";
import { gehoertZurFlaechenliste } from "../src/wiki/infobox/region-artikel.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import { istWindArtikel, koennteWindSein } from "../src/wiki/infobox/wind.ts";

/**
 * Die Wind-Artikel als Wiki-Einträge ohne Fläche (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“), REIN. Die Texte sind erfunden.
 *
 * Problemfälle: Ein Wind ohne Infobox (nur Kategorie) fehlt; die Kategorie `Strömung` (Glaubensströmungen der Kirchen) kommt als Wind oder Strömung in die Liste; ein Verweis `[[:Kategorie:Wind]]` macht den
 * Begriffsartikel zum Wind; ein Artikel mit `{{Infobox Region}}` und der Kategorie verliert seine Art; ein Wind trägt eine Fläche, eine Landmarke oder ein Icon.
 */

const seite = (titel: string, text: string): GelesenerDumpArtikel => ({ titel, ns: 0, weiterleitung: null, text });

const MIT_INFOBOX = seite(
    "Probewind (Wind)",
    "{{Aventurien}}\n{{Infobox Wind\n|Name=Probewind\n|Region=[[Probeküste]]\n|Windrichtung=Aus Nordwest\n|Stärke=kräftig\n|Charakter=kalt\n}}\nDer '''Probewind''' weht über die [[Probeküste]].\n",
);
const NUR_KATEGORIE = seite(
    "Probebrise",
    "{{Aventurien}}\nDie '''Probebrise''' ist ein warmer Wind im Süden.\n\n[[Kategorie:Wind]]\n[[Kategorie:Umwelt]]\n",
);
const GLAUBENSSTROEMUNG = seite(
    "Probelehre",
    "{{Aventurien}}\nDie '''Probelehre''' ist eine Strömung innerhalb einer Kirche.\n\n[[Kategorie:Strömung]]\n",
);
const NUR_VERWEIS = seite(
    "Probewetter",
    "{{Aventurien}}\nWetter, Wind und Wolken.\n:<small>[[:Kategorie:Wind]]</small>\n[[Kategorie:Wetter]]\n",
);
const REGION_MIT_KATEGORIE = seite(
    "Probesund",
    "{{Infobox Region\n|Name=Probesund\n|Art=Meerenge\n|Region=[[Probemeer]]\n}}\nEin Sund mit beständigem Wind.\n[[Kategorie:Wind]]\n",
);
const MYRANISCHER_WIND = seite(
    "Fernwind",
    "{{Myranor}}\n{{Infobox Wind\n|Name=Fernwind\n|Region=[[Fernküste]]\n}}\nEin Wind fern von Aventurien.\n",
);

const gelesen = (eintrag: GelesenerDumpArtikel) => leseSeitenFelder("region", analysiere(eintrag.titel, eintrag.text));

describe("Welche Seiten Wind-Artikel sind", () => {
    it("🔴 die Infobox Wind und die Kategorie Wind allein, beide in der Liste der Derographie", () => {
        for (const eintrag of [MIT_INFOBOX, NUR_KATEGORIE]) {
            const zerlegt = analysiere(eintrag.titel, eintrag.text);
            expect(koennteWindSein(eintrag.text), eintrag.titel).toBe(true);
            expect(istWindArtikel(zerlegt), eintrag.titel).toBe(true);
            expect(gehoertZurFlaechenliste(zerlegt), eintrag.titel).toBe(true);
        }
    });

    it("🔴 die Kategorie Strömung ist keine: Glaubensströmungen bleiben draußen", () => {
        const zerlegt = analysiere(GLAUBENSSTROEMUNG.titel, GLAUBENSSTROEMUNG.text);
        expect(istWindArtikel(zerlegt)).toBe(false);
        expect(gehoertZurFlaechenliste(zerlegt)).toBe(false);
        expect(gelesen(GLAUBENSSTROEMUNG).ok).toBe(false);
    });

    it("ein Verweis auf die Kategorie ordnet nicht ein; eine Region mit der Kategorie bleibt eine Region", () => {
        expect(istWindArtikel(analysiere(NUR_VERWEIS.titel, NUR_VERWEIS.text))).toBe(false);
        expect(gehoertZurFlaechenliste(analysiere(NUR_VERWEIS.titel, NUR_VERWEIS.text))).toBe(false);
        const region = analysiere(REGION_MIT_KATEGORIE.titel, REGION_MIT_KATEGORIE.text);
        expect(istWindArtikel(region)).toBe(false);
        expect(gehoertZurFlaechenliste(region)).toBe(true);
        expect(gelesen(REGION_MIT_KATEGORIE)).toMatchObject({ ok: true, felder: { art: "Meerenge" } });
    });

    it("ein Wind eines anderen Kontinents bleibt draußen wie jede Region", () => {
        expect(gehoertZurFlaechenliste(analysiere(MYRANISCHER_WIND.titel, MYRANISCHER_WIND.text))).toBe(false);
    });
});

describe("Was der Leser einträgt", () => {
    it("🔴 mit Infobox: Name, Art „Wind“, Region und Kurzbeschreibung, nichts von Richtung, Stärke, Charakter", () => {
        const ergebnis = gelesen(MIT_INFOBOX);
        expect(ergebnis.ok).toBe(true);
        if (!ergebnis.ok) return;
        expect(ergebnis.felder).toEqual({
            name: "Probewind",
            art: WIKI_ART_WIND,
            region_parent: "Probeküste",
            description: "Der Probewind weht über die Probeküste.",
        });
    });

    it("nur mit der Kategorie: der Titel als Name, ohne Region", () => {
        const ergebnis = gelesen(NUR_KATEGORIE);
        expect(ergebnis).toMatchObject({ ok: true, felder: { name: "Probebrise", art: WIKI_ART_WIND } });
        if (ergebnis.ok) expect(ergebnis.felder).not.toHaveProperty("region_parent");
    });

    it("die Art „Wind“ hat keine Flächenart und steht unter Regionen", () => {
        expect(ebeneDerWikiArt(WIKI_ART_WIND)).toEqual({ layer: "derographisch", type: null });
    });
});

describe("Der Plan legt Wind-Einträge an, sonst nichts", () => {
    const plan = (): PlanZeile[] =>
        berechnePlan({
            bereiche: ["region"],
            objekte: [],
            dump: {
                gefunden: new Map(),
                kandidaten: [],
                regionArtikel: [MIT_INFOBOX, NUR_KATEGORIE, GLAUBENSSTROEMUNG],
            },
            tafel: wikiNamespaceTafel(),
            legacyBereiche: new Set(),
            bekannteTitel: new Set(),
            belegteRegionArtikel: new Set(),
        }).zeilen;

    it("🔴 je Wind ein Eintrag des Bereichs region (Objektart region_artikel); keine Fläche, keine Landmarke, kein Icon", () => {
        const zeilen = plan();
        const neu = zeilen.filter((zeile) => zeile.feld === "artikel").map((zeile) => zeile.artikel);
        expect(neu.sort()).toEqual(["Probebrise", "Probewind (Wind)"]);
        expect(new Set(zeilen.map((zeile) => `${zeile.bereich}/${zeile.objektArt}`))).toEqual(
            new Set(["region/region_artikel"]),
        );
        expect(zeilen.find((zeile) => zeile.artikel === "Probewind (Wind)" && zeile.feld === "art")?.neu).toBe("Wind");
    });
});

describe("🔴 Mahlströme wie die Winde (Betreiber 2026-11-11: „mach das icon aber so wie winde - nicht wie landmarken“)", () => {
    it("jede Schreibweise wird ein Wiki-Eintrag für das Wetter-Icon, keine Landmarke Strudel", () => {
        // Der Wiki-Eintrag trägt die erste Art; beide Arten stehen in `WETTER_WIKI_ARTEN`.
        for (const [titel, artFeld, art] of [
            ["Probestrudel", "Mahlstrom", "Mahlstrom"],
            ["Probewirbel", "Mahlstrom (Strömung)|Mahlstrom", "Mahlstrom (Strömung)"],
            ["Probesog", "Mahlstrom (Strömung)", "Mahlstrom (Strömung)"],
        ] as const) {
            const seite = analysiere(
                titel,
                `{{Infobox Region\n|Name=${titel}\n|Art=${artFeld}\n|Region=[[Probemeer]]\n}}\nEin Sog.`,
            );
            expect(landmarkenArtDerSeite(seite), titel).toBeNull();
            expect(gehoertZurFlaechenliste(seite), titel).toBe(true);
            expect(leseSeitenFelder("region", seite), titel).toMatchObject({ ok: true, felder: { art } });
            expect(WETTER_WIKI_ARTEN as readonly string[], titel).toContain(art);
        }
    });
});
