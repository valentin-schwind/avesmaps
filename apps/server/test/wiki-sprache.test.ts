import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leseSeitenFelder } from "../src/wiki/infobox/lesen.ts";
import { analysiere } from "../src/wiki/infobox/seite.ts";
import {
    SPRACHE_FELDER,
    familienNavigation,
    istAventurisch,
    leseSprache,
    sprachSchluessel,
    vorlagenNamen,
} from "../src/wiki/infobox/sprache.ts";

/**
 * Der Leser der Sprachartikel im WikiSync (WI-0261 S3) gegen neun echte Seiten aus dem lokalen Dump (`fixtures/wiki-sprache-seiten.json`, unverändert entnommen). Legacy führt keine Sprachen;
 * die Erwartung ist von Hand aus den Seiten gelesen.
 *
 * - **Aventurisch** heißt `{{Aventurien}}` ODER `{{Nav Sprachen}}`: Garethi, Thorwalsch, Horathi, Ta-Haya tragen beides, Alaani und Angram nur die Leiste, Mholurisch die Leiste und `{{Myranor}}`,
 *   Bansumitisch `{{Aventurien}}` und die myranische Leiste. Tesumurrisch ist rein myranisch und bleibt draußen.
 * - **Felder** bereinigt (Links zu ihrem Text, `{{Zahl|…}}` zu seiner Zahl), die Listenfelder zusätzlich roh mit Links; ein leeres Feld fehlt.
 * - **Familien:** nur Leisten mit „Sprachfamilie“ im Namen oder „dialekte“ am Ende, nie die Sammelleisten.
 */

interface Seite {
    titel: string;
    ns: number;
    text: string;
}

const FIXTURE = fileURLToPath(new URL("./fixtures/wiki-sprache-seiten.json", import.meta.url));
const seiten = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { seiten: Seite[] }).seiten;
const seite = (titel: string): Seite => {
    const treffer = seiten.find((kandidat) => kandidat.titel === titel);
    if (treffer === undefined) throw new Error(`Fixture ohne ${titel}`);
    return treffer;
};
const lies = (titel: string): ReturnType<typeof leseSprache> => {
    const s = seite(titel);
    return leseSprache(analysiere(s.titel, s.text));
};

describe("WikiSync Sprachen: der Leser an echten Seiten", () => {
    it("die Fixture trägt die neun Seiten der Abnahme", () => {
        expect(seiten.map((s) => s.titel)).toEqual([
            "Garethi",
            "Thorwalsch",
            "Horathi",
            "Ta-Haya",
            "Alaani",
            "Angram (Sprache)",
            "Mholurisch",
            "Bansumitisch",
            "Tesumurrisch",
        ]);
    });

    it("🔴 aventurisch ist, was {{Aventurien}} oder {{Nav Sprachen}} trägt; rein Myranisches bleibt draußen", () => {
        const aventurisch = Object.fromEntries(seiten.map((s) => [s.titel, istAventurisch(s.text)]));
        expect(aventurisch).toEqual({
            Garethi: true,
            Thorwalsch: true,
            Horathi: true,
            "Ta-Haya": true,
            // Nur die Leiste {{Nav Sprachen}}.
            Alaani: true,
            "Angram (Sprache)": true,
            // Grenzfälle: Die Regel ist „Aventurien ODER Nav Sprachen“, gleich was sonst dabei steht.
            Mholurisch: true,
            Bansumitisch: true,
            Tesumurrisch: false,
        });
        // Schreibweisen, die MediaWiki gleich liest: Unterstrich, Leerraum, kleiner Anfangsbuchstabe, Präfix der Vorlage, Parameter.
        expect(istAventurisch("{{ nav_Sprachen }}")).toBe(true);
        expect(istAventurisch("{{Vorlage:Aventurien|x}}")).toBe(true);
        expect(istAventurisch("{{Nav Sprachfamilie Garethi}}{{Aventurien Karte}}")).toBe(false);
        expect(istAventurisch("Text über [[Aventurien]]")).toBe(false);
    });

    it("🔴 Garethi: sieben Felder bereinigt, Listenfelder roh mit Links, Kurzbeschreibung und Leiste der Familie", () => {
        const garethi = lies("Garethi");
        expect(garethi.ok).toBe(true);
        if (!garethi.ok) return;
        expect(garethi.infobox).toBe("Sprache");
        expect(garethi.familien).toEqual(["Nav Sprachfamilie Garethi"]);
        expect(garethi.felder).toMatchObject({
            name: "Garethi",
            sprachfamilie: "Sprachfamilie Garethi",
            vorstufen: "Aureliani, Bosparano",
            schrift: "Kusliker Zeichen",
            sprecheranzahl: "Meist gesprochene Sprache Aventuriens",
            weitere_verbreitung: "Gängige Verkehrsprache in fast ganz Aventurien",
            navigation: "Nav Sprachfamilie Garethi",
            roh_vorstufen: "[[Altgüldenländisch|Aureliani]], [[Bosparano]]",
            roh_schrift: "[[Kusliker Zeichen]]",
            roh_weitere_verbreitung: "Gängige Verkehrsprache in fast ganz [[Aventurien]]",
        });
        expect(garethi.felder["offizielle_sprache"]).toMatch(
            /^Alanfanisches Imperium, Königreich Andergast, .*Bornland, /u,
        );
        // Der Linktext gilt, nicht das Ziel; roh bleibt das Ziel.
        expect(garethi.felder["roh_offizielle_sprache"]).toContain("[[Bornland (Bund)|Bornland]]");
        expect(garethi.felder["kurzbeschreibung"]).toMatch(
            /^Garethi oder Neu-Aventurisch ist die meistgesprochene Sprache Aventuriens\./u,
        );
        // Jedes Feld ist eines des Abgleichs.
        for (const feld of Object.keys(garethi.felder)) expect(SPRACHE_FELDER).toContain(feld);
    });

    it("leere Felder fehlen, „schriftlos“ ist ein Wert, die Waldmenschen-Leiste ist eine Familie (Ta-Haya, Mholurisch, Angram)", () => {
        const tahaya = lies("Ta-Haya");
        expect(tahaya.ok && tahaya.felder).toMatchObject({
            name: "Ta-Haya",
            sprachfamilie: "Waldmenschen-Sprachen",
            schrift: "schriftlos",
            weitere_verbreitung: "Meridiana",
            navigation: "Nav Waldmenschendialekte",
        });
        expect(tahaya.ok && Object.keys(tahaya.felder)).not.toContain("vorstufen");
        expect(tahaya.ok && Object.keys(tahaya.felder)).not.toContain("offizielle_sprache");

        const mholurisch = lies("Mholurisch");
        expect(mholurisch.ok && mholurisch.felder).toEqual({
            name: "Mholurisch",
            weitere_verbreitung: "Mholuren",
            kurzbeschreibung: "Als Mholurisch wird die Sprache der Mholuren bezeichnet.",
            roh_weitere_verbreitung: "[[Mholur]]en",
        });
        expect(mholurisch.ok && mholurisch.familien).toEqual([]);

        const angram = lies("Angram (Sprache)");
        expect(angram.ok && angram.felder).toMatchObject({ name: "Angram", schrift: "Angram", sprecheranzahl: "0" });
        expect(angram.ok && angram.felder["roh_schrift"]).toBe("[[Angram (Schrift)|Angram]]");
    });

    it("Familien: nur „Sprachfamilie“ und „…dialekte“, nie die Sammelleisten (Bansumitisch, Tesumurrisch, Horathi, Alaani)", () => {
        expect(familienNavigation(seite("Bansumitisch").text)).toEqual(["Nav Bansumitische Sprachfamilie"]);
        expect(familienNavigation(seite("Tesumurrisch").text)).toEqual(["Nav Bansumitische Sprachfamilie"]);
        expect(familienNavigation(seite("Horathi").text)).toEqual(["Nav Sprachfamilie Garethi"]);
        expect(familienNavigation(seite("Alaani").text)).toEqual(["Nav Sprachfamilie Tulamidya"]);
        expect(vorlagenNamen(seite("Bansumitisch").text)).toContain("Nav Myranische Sprachen");
        expect(
            familienNavigation("{{Nav Sprachen}}{{Nav Allgemeine Sonderfertigkeiten}}{{nav_Sprachfamilie Elfisch}}"),
        ).toEqual(["Nav Sprachfamilie Elfisch"]);
    });

    it("🔴 Befunde statt Raten: keine Infobox, eine fremde, eine offene Klammer", () => {
        expect(leseSprache(analysiere("X", "Nur Text {{Aventurien}}"))).toMatchObject({
            ok: false,
            grund: "keine_infobox",
        });
        expect(leseSprache(analysiere("X", "{{Infobox Siedlung\n|Name=X\n}}"))).toMatchObject({
            ok: false,
            grund: "fremde_infobox",
        });
        expect(leseSprache(analysiere("X", "{{Infobox Sprache\n|Name=X\n"))).toMatchObject({
            ok: false,
            grund: "nicht_geschlossen",
        });
        // Ohne Name gilt der Titel.
        const ohneName = leseSprache(analysiere("Neusprache", "{{Infobox Sprache\n|Name=\n|Schrift=[[Runen]]\n}}"));
        expect(ohneName.ok && ohneName.felder).toEqual({
            name: "Neusprache",
            schrift: "Runen",
            roh_schrift: "[[Runen]]",
        });
    });

    it("über den Verteiler: der Bereich `sprachen` liest dieselben Felder und sagt, ob der Artikel aventurisch ist", () => {
        const s = seite("Thorwalsch");
        const gelesen = leseSeitenFelder("sprachen", analysiere(s.titel, s.text));
        expect(gelesen.ok).toBe(true);
        if (!gelesen.ok) return;
        expect(gelesen.sprache).toEqual({ aventurisch: true, familien: ["Nav Sprachfamilie Thorwalsch"] });
        expect(gelesen.felder).toMatchObject({
            name: "Thorwalsch",
            sprecheranzahl: "über 80.000",
            offizielle_sprache: "Thorwal",
            roh_offizielle_sprache: "[[Thorwal (Staat)|Thorwal]]",
        });
        // Eine Sprachseite ist kein Kartenobjekt: Die Bereiche der Karte lesen sie nicht.
        expect(leseSeitenFelder("ort", analysiere(s.titel, s.text))).toMatchObject({
            ok: false,
            grund: "fremde_infobox",
        });
    });

    it("der Schlüssel ist der Titel in Vergleichsform", () => {
        expect(sprachSchluessel("Angram (Sprache)")).toBe("angram (sprache)");
        expect(sprachSchluessel("  Ta-Haya ")).toBe("ta-haya");
        expect(sprachSchluessel("Inoffiziell:Neu_Sprache")).toBe("inoffiziell:neu sprache");
        expect(sprachSchluessel("garethi")).toBe(sprachSchluessel("Garethi"));
    });
});
