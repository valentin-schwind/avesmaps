import { describe, expect, it } from "vitest";
import {
    aufgeloesterTitel,
    bereinigeFeld,
    linkZiele,
    merkmaleDesGlieds,
    normTitel,
    rollenImFeld,
    teileOben,
    zerlegeFeld,
    zielKlasse,
    type ZielInfo,
    type ZielWissen,
} from "../src/wiki/abgleich/ortsrolle.ts";
import { zielInfoVonSeite } from "../src/wiki/dump/ziel-info.ts";

/**
 * Die Rolle einer Ortszeile eines Vorkommens (WI-0253, Scheibe Vorkommen, §23) – reine Rechnung, ohne Datenbank und ohne Dump.
 *
 * - **Soll:** Nur ein Fundort ist `ort`. Der Nachbau der Analyse des Regelbuchs (Abschnitt 5d) stimmt mit ihr überein: am lokalen Dump (254.052 Seiten) auf allen 6.443 Links, die beide bewerten,
 *   mit 0 Abweichungen (Landschaftsart 128 Links in 110 Einträgen, Volk 96 in 90, Teil 57 in 51, verneint 12 in 6, andere Welt 724 in 531, Bezugspunkt und Endpunkt zusammen 147 in 79).
 * - **Benannte Fälle des Regelbuchs:** Wirselkraut („außer“), Aranische Wassernuss („südlich der Linie …“), Wachtel („nicht Maraskan“), Zwiebel („ausgenommen“ über drei Kommas).
 * - **Grenze, mit Absicht:** Die Verneinung gilt für das Glied, in dem sie steht (Komma, Strichpunkt, Doppelpunkt trennen). Eine Aufzählung dahinter bleibt `ort`: Bei Wirselkraut ist sie
 *   zusätzlich, bei Zwiebel ausgenommen, und der Text sagt nicht, welches gilt – das klärt die Rückfrage der nächsten Scheibe, nicht eine Vermutung hier.
 */

function wissen(seiten: Readonly<Record<string, ZielInfo>> = {}, flaechen: readonly string[] = []): ZielWissen {
    const karte = new Map(Object.entries(seiten));
    const klein = new Set(flaechen.map((titel) => titel.toLowerCase()));
    return { info: (titel) => karte.get(titel), istFlaeche: (titel) => klein.has(titel.toLowerCase()) };
}

/** Eine kleine Welt mit den Arten von Seiten, die der Dump kennt. */
const WELT = wissen({
    // Regionen mit Infobox (Aventurien als Elternkette).
    "Bornland (Region)": { infobox: "Region", eltern: ["Aventurien"] },
    Thorwal: { weiterleitung: "Thorwal (Region)" },
    "Thorwal (Region)": { infobox: "Region", eltern: ["Aventurien"] },
    Orkland: { infobox: "Region", eltern: ["Aventurien"] },
    Aranien: { infobox: "Region", eltern: ["Aventurien"] },
    Maraskan: { infobox: "Region", eltern: ["Aventurien"] },
    Meridiana: { infobox: "Region", eltern: ["Aventurien"] },
    Khôm: { infobox: "Region", eltern: ["Aventurien"] },
    // Eine Region ohne Infobox (nur {{Register Region}}): Südaventurien, Nordaventurien.
    Südaventurien: { register: "Region" },
    Mittelaventurien: { infobox: "Region", eltern: ["Aventurien"] },
    // Siedlungen und Gebiete.
    Perricum: { infobox: "Siedlung", eltern: ["Aranien"] },
    "Havena (Siedlung)": { infobox: "Siedlung", eltern: ["Aventurien"] },
    Riva: { infobox: "Siedlung", eltern: ["Aventurien"] },
    Mengbilla: { infobox: "Siedlung", eltern: ["Aventurien"] },
    Glorania: { infobox: "Staat" },
    Grimmfrostöde: { infobox: "Region", eltern: ["Aventurien"] },
    Nivesenlande: { infobox: "Region", eltern: ["Aventurien"] },
    "Der Große Fluss": { infobox: "Fluss", eltern: ["Aventurien"] },
    // Landschaftsarten: Seiten mit einer zählenden Kategorie und ohne eigene Infobox.
    Küste: { kategorien: ["Derographisches Merkmal"] },
    Wald: { kategorien: ["Vegetationszone"] },
    Meer: { kategorien: ["Gewässerart"] },
    // Ein Volk und Kulturen.
    Elfen: { infobox: "Spezies" },
    Waldmenschen: { infobox: "Kultur" },
    // Andere Welten: der Kontinent, eine Globule (Kategorie), eine Siedlung auf Myranor (Elternkette).
    Myranor: {},
    "Inseln im Nebel (Globule)": { kategorien: ["Globule"] },
    Makshapuram: { infobox: "Siedlung", eltern: ["Myranor"] },
    "Tharun-Stadt": { infobox: "Siedlung", eltern: ["Tharun"] },
    Wüste: { kategorien: ["Vegetationszone"] },
    Regenwald: { kategorien: ["Vegetationszone"] },
    // Eine Weiterleitung auf eine Landschaftsart.
    Wälder: { weiterleitung: "Wald" },
});

const rolle = (feld: string, ziel: string, w: ZielWissen = WELT): string | undefined =>
    rollenImFeld(feld, w).get(normTitel(ziel).toLowerCase())?.rolle;
const alle = (feld: string, w: ZielWissen = WELT): Record<string, string> =>
    Object.fromEntries([...rollenImFeld(feld, w)].map(([, r]) => [r.ziel, r.rolle]));

describe("WikiSync Vorkommen: die Art eines Linkziels", () => {
    it("folgt Weiterleitungen, liest Infobox, Kategorien und Elternkette, nie den Namen", () => {
        expect(aufgeloesterTitel("Thorwal", WELT)).toBe("Thorwal (Region)");
        expect(zielKlasse("Thorwal", WELT)).toBe("region_ohne_flaeche");
        expect(zielKlasse("Perricum", WELT)).toBe("siedlung");
        expect(zielKlasse("Glorania", WELT)).toBe("gebiet");
        expect(zielKlasse("Der Große Fluss", WELT)).toBe("gewaesser");
        expect(zielKlasse("Küste", WELT)).toBe("landtyp");
        expect(zielKlasse("Wälder", WELT)).toBe("landtyp");
        expect(zielKlasse("Elfen", WELT)).toBe("volk");
        expect(zielKlasse("Aventurien", WELT)).toBe("kontinent_av");
        expect(zielKlasse("Myranor", WELT)).toBe("fremd");
        expect(zielKlasse("Inseln im Nebel (Globule)", WELT)).toBe("fremd");
        // Eine Siedlung, deren Elternkette auf Myranor führt, liegt in einer anderen Welt.
        expect(zielKlasse("Makshapuram", WELT)).toBe("fremd");
        expect(zielKlasse("Tharun-Stadt", WELT)).toBe("fremd");
        // Eine Seite, die der Dump nicht kennt, ist keine Art.
        expect(zielKlasse("Nirgendwo", WELT)).toBe("fehlt");
        // Eine Fläche der Karte (Wiki-Adresse einer Landschaft) gewinnt vor jeder Infobox.
        expect(zielKlasse("Perricum", wissen({ Perricum: { infobox: "Siedlung" } }, ["Perricum"]))).toBe("flaeche");
        // Eine Region ohne Infobox gilt über {{Register Region}} als Region.
        expect(zielKlasse("Südaventurien", WELT)).toBe("region_ohne_flaeche");
    });

    it("eine Landschaftsart mit eigener Infobox ist keine: die Kategorie zählt nur ohne Infobox", () => {
        const w = wissen({ Dschungel: { infobox: "Region", kategorien: ["Vegetationszone"] } });
        expect(zielKlasse("Dschungel", w)).toBe("region_ohne_flaeche");
    });
});

describe("WikiSync Vorkommen: das Feld zerlegen", () => {
    it("bereinigt Verweise, Kommentare und Tags und trennt an Strichpunkt, Doppelpunkt und Komma – nie in Links und Klammern", () => {
        expect(bereinigeFeld("a<ref>x</ref> b<!-- c --> d<br>e<small>f</small>\ng")).toBe("a b d; e f g");
        expect(teileOben("[[A, B]], C (x, y), D", ",")).toEqual(["[[A, B]]", "C (x, y)", "D"]);
        expect(zerlegeFeld("[[Aventurien]]: [[Meridiana]], [[Orkland]]; [[Myranor]]")).toEqual([
            [["[[Aventurien]]"], ["[[Meridiana]]", "[[Orkland]]"]],
            [["[[Myranor]]"]],
        ]);
        expect(linkZiele("[[Neu_Gareth#Geschichte|Gareth]], [[Kategorie:X]], [[Datei:Y]], [[wald]]")).toEqual([
            "Neu Gareth",
            "Wald",
        ]);
    });

    it("die Merkmale eines Glieds: Linie, Richtung, Teil, früher, Verneinung", () => {
        const merk = (text: string): string[] => [...merkmaleDesGlieds(text, WELT)].sort();
        expect(merk("zwischen [[Riva]] und [[Mengbilla]]")).toEqual(["linie"]);
        expect(merk("südlich der [[Khôm]]")).toEqual(["bezugspunkt"]);
        expect(merk("nördliches [[Bornland (Region)|Bornland]]")).toEqual(["teilflaeche"]);
        expect(merk("[[Riva]] (ehemals)")).toEqual(["historisch"]);
        expect(merk("überall außer [[Wüste]]")).toEqual(["negation"]);
        // Nord vor einem Link (auch zusammengeschrieben) macht ihn zum Teil.
        expect(merk("Nord[[maraskan]]")).toEqual(["teilflaeche"]);
        expect(merk("Süd [[Maraskan]]")).toEqual(["teilflaeche"]);
        expect(merk("ganz [[Aventurien]]")).toEqual([]);
    });
});

describe("WikiSync Vorkommen: die Rolle der Links", () => {
    it("🔴 Wirselkraut: ‚außer‘ verneint nur sein Glied; die Aufzählung dahinter, Myranor und die Globule sind bestimmt", () => {
        const feld =
            "ganz [[Aventurien]] außer [[Wüste]] und [[Regenwald]], entlang des [[Der Große Fluss|Großen Flusses]], [[Bornland (Region)|Bornland]], [[Orkland]], [[Thorwal (Region)|Thorwal]]; [[Myranor]]; [[Inseln im Nebel (Globule)|Inseln im Nebel]]";
        expect(alle(feld)).toEqual({
            Aventurien: "ort",
            Wüste: "ausgenommen",
            Regenwald: "ausgenommen",
            "Der Große Fluss": "ort",
            "Bornland (Region)": "ort",
            Orkland: "ort",
            "Thorwal (Region)": "ort",
            Myranor: "andere_welt",
            "Inseln im Nebel (Globule)": "andere_welt",
        });
        // Die Rolle der Verneinung steht vor der Landschaftsart: „Wüste“ ist hier verneint, nicht Landschaftsart.
        expect(rollenImFeld(feld, WELT).get("wüste")?.grund).toContain("ausgenommen");
    });

    it("🔴 Aranische Wassernuss: Aranien ist ein Ort, die Endpunkte der Linie Perricum und Havena sind Bezugspunkte", () => {
        expect(
            alle("häufig in [[Aranien]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]] gelegentlich"),
        ).toEqual({ Aranien: "ort", Perricum: "bezugspunkt", "Havena (Siedlung)": "bezugspunkt" });
        const grund = rollenImFeld("südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]]", WELT).get(
            "perricum",
        )?.grund;
        expect(grund).toContain("Linie");
    });

    it("🔴 Wachtel: ‚nicht Maraskan‘ ist ausgenommen, Aventurien ein Ort", () => {
        expect(alle("[[Aventurien]], nicht [[Maraskan]]")).toEqual({ Aventurien: "ort", Maraskan: "ausgenommen" });
    });

    it("🔴 Zwiebel: Die Verneinung gilt für ihr Glied (Glorania); die Aufzählung dahinter bleibt ein Ort – die Rückfrage der nächsten Scheibe, keine Vermutung", () => {
        expect(alle("überall, ausgenommen [[Glorania]], [[Grimmfrostöde]], [[Nivesenlande]]")).toEqual({
            Glorania: "ausgenommen",
            Grimmfrostöde: "ort",
            Nivesenlande: "ort",
        });
    });

    it("Teil, Richtung, Linie, Landschaftsart, Volk, früher, andere Welt", () => {
        expect(rolle("nördliches [[Bornland (Region)|Bornland]]", "Bornland (Region)")).toBe("teil");
        expect(rolle("östlicher [[Orkland]]", "Orkland")).toBe("teil");
        expect(rolle("Süd[[maraskan]] und umgebende Inseln", "Maraskan")).toBe("teil");
        expect(rolle("[[Aventurien]] nördlich der [[Khôm]]", "Khôm")).toBe("bezugspunkt");
        expect(rolle("[[Aventurien]] nördlich der [[Khôm]]", "Aventurien")).toBe("ort");
        expect(rolle("ganz [[Aventurien]] zwischen [[Riva]] und [[Mengbilla]]", "Riva")).toBe("bezugspunkt");
        expect(rolle("ganz [[Aventurien]] zwischen [[Riva]] und [[Mengbilla]]", "Mengbilla")).toBe("bezugspunkt");
        expect(rolle("ganz [[Aventurien]] zwischen [[Riva]] und [[Mengbilla]]", "Aventurien")).toBe("ort");
        expect(rolle("[[Küste]]", "Küste")).toBe("landschaftsart");
        expect(rolle("alle [[Meer]]e [[Aventurien]]s", "Meer")).toBe("landschaftsart");
        expect(rolle("[[Wälder]] im Norden", "Wälder")).toBe("landschaftsart");
        expect(rolle("[[Elfen]]", "Elfen")).toBe("volk");
        expect(rolle("Gebiete der [[Waldmenschen]]", "Waldmenschen")).toBe("volk");
        expect(rolle("[[Riva]] (ehemals)", "Riva")).toBe("frueher");
        expect(rolle("vormals [[Aventurien]]", "Aventurien")).toBe("frueher");
        expect(rolle("[[Myranor]]", "Myranor")).toBe("andere_welt");
        expect(rolle("[[Makshapuram]], [[Perricum]]", "Makshapuram")).toBe("andere_welt");
        expect(rolle("[[Makshapuram]], [[Perricum]]", "Perricum")).toBe("ort");
        // Ein Ort ohne Zusatz ist ein Ort.
        expect(rolle("[[Aranien]]", "Aranien")).toBe("ort");
    });

    it("eine Region ohne Infobox (Register Region) bekommt ihre Rolle wie jede Region", () => {
        expect(rolle("nördliches [[Südaventurien]]", "Südaventurien")).toBe("teil");
        expect(rolle("[[Südaventurien]] ab der Linie [[Perricum]]-[[Riva]]", "Südaventurien")).toBe("bezugspunkt");
    });

    it("ein Link, der mehrmals vorkommt, hat EINE Rolle: ein Ort gewinnt; eine Nennung im Rahmen sagt nichts", () => {
        // Zweimal derselbe Link: einmal plain, einmal als Teil → ein Ort.
        expect(rolle("[[Orkland]], nördliches [[Orkland]]", "Orkland")).toBe("ort");
        // Der Rahmen vor dem Doppelpunkt ist eine Nennung ohne eigene Einschränkung: Die bestimmte Nennung gilt (Federschlange).
        expect(rolle("[[Myranor]]: [[Meralis]], selten in ganz [[Myranor]]", "Myranor")).toBe("andere_welt");
        // Ein Rahmen allein ist ein Ort.
        expect(rolle("[[Orkland]]: [[Ohort]]", "Orkland")).toBe("ort");
    });

    it("die Rolle einer Landschaftsart schlägt die Verneinung nicht: ‚überall außer Regenwald‘ nimmt den Regenwald aus", () => {
        expect(alle("überall außer [[Regenwald]] und [[Wüste]]")).toEqual({
            Regenwald: "ausgenommen",
            Wüste: "ausgenommen",
        });
        expect(rolle("[[Regenwald]]", "Regenwald")).toBe("landschaftsart");
    });
});

describe("WikiSync Vorkommen: die Auskunft über Linkziele aus dem Dump", () => {
    it("liest Weiterleitung, zählende Kategorien (die ersten 15), Infobox, Elternkette und Register", () => {
        expect(zielInfoVonSeite({ weiterleitung: "Thorwal (Region)", text: "" })).toEqual({
            weiterleitung: "Thorwal (Region)",
        });
        expect(
            zielInfoVonSeite({
                weiterleitung: null,
                text: "Text\n[[Kategorie:Vegetationszone]]\n[[Kategorie:Pflanzen]]",
            }),
        ).toEqual({ kategorien: ["Vegetationszone"] });
        expect(
            zielInfoVonSeite({
                weiterleitung: null,
                text: "{{Infobox Siedlung\n|Name=Makshapuram\n|Region=[[Myranor]], {{Reg|Tharun}}\n}}",
            }),
        ).toEqual({ infobox: "Siedlung", eltern: ["Myranor", "Tharun"] });
        expect(
            zielInfoVonSeite({ weiterleitung: null, text: "<onlyinclude>{{Register Region}}</onlyinclude>\nText" }),
        ).toEqual({
            register: "Region",
        });
        // Eine Seite, die nichts Zählendes sagt, fehlt.
        expect(zielInfoVonSeite({ weiterleitung: null, text: "Ein Artikel.\n[[Kategorie:Tiere]]" })).toBeUndefined();
        // Nur die ersten 15 Kategorien zählen (wie die Analyse).
        const viele = Array.from({ length: 15 }, (_, i) => `[[Kategorie:K${String(i)}]]`).join("\n");
        expect(
            zielInfoVonSeite({ weiterleitung: null, text: `${viele}\n[[Kategorie:Vegetationszone]]` }),
        ).toBeUndefined();
    });
});
