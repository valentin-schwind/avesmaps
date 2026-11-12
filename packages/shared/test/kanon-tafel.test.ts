import { describe, expect, it } from "vitest";
import {
    KANON_OBJEKTART_VORGABE,
    KANON_OBJEKTARTEN,
    istNamespaceVorgabe,
    istObjektartVorgabe,
    kanonMitRang4,
    kanonObjektartTafel,
    normalisiereBezeichner,
    pruefeNamespaceTafel,
    pruefeNamespaceZeile,
    pruefeObjektartZeile,
    wikiNamespaceAusTitel,
    wikiNamespaceName,
    wikiNamespaceTafel,
    wikiNamespaceZeile,
} from "../src/kanon-tafel.ts";
import { WIKI_NAMESPACE_VORGABE } from "../src/wiki-namespaces.ts";

/**
 * Die Tafeln des Kanon-Etiketts (WI-0253 B-2): Namensräume (Rang 1) und Objektarten (Rang 4). Rein, ohne Datenbank.
 */
describe("Tafel der Namensräume", () => {
    it("🔴 die Vorgabe trägt den Bezeichner: 222 und 444 „Wiki Aventurica“, die übrigen leer", () => {
        const bezeichner = Object.fromEntries(WIKI_NAMESPACE_VORGABE.map((zeile) => [zeile.ns, zeile.bezeichner]));
        expect(bezeichner).toEqual({ 0: "", 218: "", 220: "", 222: "Wiki Aventurica", 444: "Wiki Aventurica" });
        expect(wikiNamespaceTafel()).toEqual(WIKI_NAMESPACE_VORGABE);
        expect(pruefeNamespaceTafel(wikiNamespaceTafel())).toEqual([]);
    });

    it("eine Abweichung überdeckt die Vorgabe, ein neuer Raum kommt hinzu, die Reihenfolge folgt der Nummer", () => {
        const tafel = wikiNamespaceTafel([
            { ns: 444, praefix: "Ilaris", kanon: "inoffiziell", einsammeln: true, bezeichner: "Regelwerk" },
            { ns: 100, praefix: "Briefspiel", kanon: "inoffiziell", einsammeln: false, bezeichner: "" },
        ]);
        expect(tafel.map((zeile) => zeile.ns)).toEqual([0, 100, 218, 220, 222, 444]);
        expect(wikiNamespaceZeile(tafel, 444)).toMatchObject({ einsammeln: true, bezeichner: "Regelwerk" });
        expect(istNamespaceVorgabe(wikiNamespaceZeile(tafel, 444)!)).toBe(false);
        expect(istNamespaceVorgabe(wikiNamespaceZeile(tafel, 222)!)).toBe(true);
        // Ein hinzugefügter Raum ist nie die Vorgabe.
        expect(istNamespaceVorgabe(wikiNamespaceZeile(tafel, 100)!)).toBe(false);
        expect(wikiNamespaceName(tafel, 222)).toBe("Inoffiziell");
        expect(wikiNamespaceName(tafel, 0)).toBe("");
        expect(wikiNamespaceName(tafel, 14)).toBeNull();
    });

    it("🔴 der Raum eines Titels kommt aus dem Präfix, nie aus „allem vor dem Doppelpunkt“", () => {
        const tafel = wikiNamespaceTafel();
        expect(wikiNamespaceAusTitel("Gareth", tafel)).toBe(0);
        expect(wikiNamespaceAusTitel("Inoffiziell:Apfeldorn", tafel)).toBe(222);
        expect(wikiNamespaceAusTitel("inoffiziell:Apfeldorn", tafel)).toBe(222);
        expect(wikiNamespaceAusTitel("Inoffiziell:Trutzbach/Zollhaus", tafel)).toBe(222);
        expect(wikiNamespaceAusTitel("DSK:Die Schwarze Katze", tafel)).toBe(218);
        expect(wikiNamespaceAusTitel("Ilaris:Angepasst I", tafel)).toBe(444);
        expect(wikiNamespaceAusTitel("Elf:Volk", tafel)).toBe(220);
        // Aventurische Titel tragen Doppelpunkte, die keine Räume sind.
        expect(wikiNamespaceAusTitel("Aventurien: Das Lexikon des Schwarzen Auges", tafel)).toBe(0);
        expect(wikiNamespaceAusTitel(":Inoffiziell:Apfeldorn", tafel)).toBe(0);
        // Ein hinzugefügter Raum wird erkannt, ein entfernter Name nicht mehr.
        const mehr = wikiNamespaceTafel([
            { ns: 100, praefix: "Briefspiel", kanon: "inoffiziell", einsammeln: false, bezeichner: "" },
        ]);
        expect(wikiNamespaceAusTitel("Briefspiel:Garetien", mehr)).toBe(100);
        expect(wikiNamespaceAusTitel("Briefspiel:Garetien", tafel)).toBe(0);
    });

    it("🔴 der Bezeichner: frei, höchstens 40 Zeichen, ohne Steuerzeichen, leer erlaubt", () => {
        const zeile = { ns: 222, praefix: "Inoffiziell", kanon: "inoffiziell" as const, einsammeln: true };
        expect(pruefeNamespaceZeile({ ...zeile, bezeichner: "" })).toEqual([]);
        expect(pruefeNamespaceZeile({ ...zeile, bezeichner: "x".repeat(40) })).toEqual([]);
        expect(pruefeNamespaceZeile({ ...zeile, bezeichner: "x".repeat(41) })).toEqual([
            { zeile: 222, feld: "bezeichner", code: "bezeichner_zu_lang" },
        ]);
        // Zeichen zählen als Codepunkte: 40 Emoji sind 40, nicht 80.
        expect(pruefeNamespaceZeile({ ...zeile, bezeichner: "🙂".repeat(40) })).toEqual([]);
        for (const roh of [" vorn", "hinten ", "zwei  Blanks", "Zeile\numbruch", "tab\there", "\u0007"]) {
            expect(pruefeNamespaceZeile({ ...zeile, bezeichner: roh }), JSON.stringify(roh)).toEqual([
                { zeile: 222, feld: "bezeichner", code: "bezeichner_ungueltig" },
            ]);
        }
        expect(normalisiereBezeichner("  Wiki \n Aventurica ")).toBe("Wiki Aventurica");
    });

    it("das Präfix: im Hauptraum leer, sonst ein Wort ohne Doppelpunkt; ein Raum der Vorgabe behält seinen Namen; kein Präfix zweimal", () => {
        const basis = { kanon: "offiziell" as const, einsammeln: false, bezeichner: "" };
        expect(pruefeNamespaceZeile({ ns: 0, praefix: "Haupt", ...basis })).toEqual([
            { zeile: 0, feld: "praefix", code: "praefix_haupt_leer" },
        ]);
        expect(pruefeNamespaceZeile({ ns: 100, praefix: "", ...basis })).toEqual([
            { zeile: 100, feld: "praefix", code: "praefix_fehlt" },
        ]);
        expect(pruefeNamespaceZeile({ ns: 100, praefix: "A:B", ...basis })[0]?.code).toBe("praefix_ungueltig");
        expect(pruefeNamespaceZeile({ ns: 222, praefix: "Fan", ...basis })).toEqual([
            { zeile: 222, feld: "praefix", code: "praefix_fest" },
        ]);
        const doppelt = wikiNamespaceTafel([{ ns: 100, praefix: "inoffiziell", ...basis }]);
        expect(pruefeNamespaceTafel(doppelt)).toEqual([{ zeile: 222, feld: "praefix", code: "praefix_doppelt" }]);
        for (const ns of [-1, 1.5, 2_147_483_648, Number.NaN]) {
            expect(pruefeNamespaceZeile({ ns, praefix: "X", ...basis })[0]?.code, String(ns)).toBe("ns_ungueltig");
        }
        expect(
            pruefeNamespaceZeile({
                ns: 100,
                praefix: "X",
                kanon: "egal" as never,
                einsammeln: "ja" as never,
                bezeichner: "",
            }).map((f) => f.code),
        ).toEqual(["kanon_unbekannt", "wert_kein_wahrheitswert"]);
    });
});

describe("Tafel der Objektarten (Rang 4)", () => {
    it("🔴 die Vorgabe: sechs Arten, anzeigen nein, Bezeichner „Avesmaps“", () => {
        expect(KANON_OBJEKTARTEN).toEqual(["place", "path", "area", "territory", "powerline", "peak"]);
        expect(KANON_OBJEKTART_VORGABE.every((zeile) => !zeile.anzeigen && zeile.bezeichner === "Avesmaps")).toBe(true);
        expect(kanonObjektartTafel()).toEqual(KANON_OBJEKTART_VORGABE);
        const tafel = kanonObjektartTafel([{ art: "place", anzeigen: true, bezeichner: "" }]);
        expect(tafel.find((z) => z.art === "place")).toEqual({ art: "place", anzeigen: true, bezeichner: "" });
        expect(tafel.map((z) => z.art)).toEqual([...KANON_OBJEKTARTEN]);
        expect(istObjektartVorgabe(tafel[0]!)).toBe(false);
        expect(istObjektartVorgabe(tafel[1]!)).toBe(true);
    });

    it("die Prüfung: bekannte Art, Wahrheitswert, Bezeichner wie bei den Namensräumen", () => {
        expect(pruefeObjektartZeile({ art: "peak", anzeigen: true, bezeichner: "Avesmaps" })).toEqual([]);
        expect(pruefeObjektartZeile({ art: "peak", anzeigen: true, bezeichner: "y".repeat(41) })[0]?.code).toBe(
            "bezeichner_zu_lang",
        );
        expect(pruefeObjektartZeile({ art: "weg" as never, anzeigen: true, bezeichner: "" })[0]?.code).toBe(
            "art_unbekannt",
        );
        expect(pruefeObjektartZeile({ art: "place", anzeigen: "ja" as never, bezeichner: "" })[0]?.code).toBe(
            "wert_kein_wahrheitswert",
        );
    });

    it("🔴 Rang 4 bei „nein“: kein Etikett, eine Zeile bleibt, wie sie ist", () => {
        const nein = { art: "place" as const, anzeigen: false, bezeichner: "Avesmaps" };
        expect(kanonMitRang4(undefined, nein)).toBeUndefined();
        expect(kanonMitRang4({ canon: "unlabelled" }, nein)).toEqual({ canon: "unlabelled" });
        expect(kanonMitRang4({ canon: "official" }, nein)).toEqual({ canon: "official" });
    });

    it("🔴 Rang 4 bei „ja“: INOFFIZIELL | Avesmaps, aber nur für ein Objekt OHNE Kanon-Zeile (weder Wiki noch Quelle noch Publikation)", () => {
        const ja = { art: "place" as const, anzeigen: true, bezeichner: "Avesmaps" };
        expect(kanonMitRang4(undefined, ja)).toEqual({ canon: "unofficial", designatorLabel: "Avesmaps" });
        // Ein Etikett nach Rang 1 bis 3 bleibt, auch bei „ja“.
        expect(kanonMitRang4({ canon: "official" }, ja)).toEqual({ canon: "official" });
        const briefspiel = { canon: "unofficial" as const, designatorType: "briefspiel", designatorCount: 2 };
        expect(kanonMitRang4(briefspiel, ja)).toEqual(briefspiel);
        // 🔴 Eine `unlabelled`-Zeile (Verweise, nur Publikationen: Legacys Dommel-Fall) hat Publikationen: Rang 4 überdeckt sie nie.
        expect(kanonMitRang4({ canon: "unlabelled" }, ja)).toEqual({ canon: "unlabelled" });
        // Ohne Bezeichner ist die Pille rund.
        expect(kanonMitRang4(undefined, { ...ja, bezeichner: "" })).toEqual({ canon: "unofficial" });
    });
});
