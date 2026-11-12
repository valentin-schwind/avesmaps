import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_TERRITORY_DETAIL_FIELDS, GEBIETSEDITOR, type EditorTerritoryDetail } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { standZeile, veraltete, eigene } from "../src/fenster/wiki-box";
import { felderAus } from "../src/gebietseditor/gebiet-art.ts";
import {
    DETAIL_KAESTEN,
    DETAIL_NAMEN,
    GEBIET_SYNC_FELDER,
    gebietWikiBoxFelder,
} from "../src/gebietseditor/gebiet-detailfelder.ts";

/**
 * Das Herrschaftsgebiet an der Wiki-Box und die Aufteilung des Kastens „Wiki und Quellen“ (WI-0253; Betreiber 2026-10-26: „das bitte trennen in Wiki - Wappen gehören zu einem Bilder-Tab und Quellen in eine
 * Quellen-Tab (wie bei Orten)“).
 *
 * - **Soll:** Der Kasten „Wiki“ ist die Wiki-Box; das Wappen steht im Reiter „Bilder“ (derselbe Wappen-Kasten wie am Ort), die Quellen im Reiter „Quellen“ (dieselbe Liste wie am Ort), alle drei im
 *   Reiterbauteil des Hauses (`FensterReiter`); die Zugehörigkeit (roh) im Kasten „Im Baum“. Nichts geht verloren: Jedes der 17 Detailfelder steht in genau einem Kasten.
 * - **Problemfälle:** ein Feld, das ein Sync nicht schreibt (Handelszone, Politisch), darf „Das Wiki ist neuer“ nicht auslösen; ein eigener Wert bleibt eigen; ohne Schreibrecht rechnet die Box lesend.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const lies = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");

const ID = "b2000000-0000-4000-8000-000000000001";
const detail = (details: EditorTerritoryDetail["details"]): EditorTerritoryDetail => ({
    id: ID,
    revision: 3,
    name: "Grafschaft Albenhus",
    type: "Grafschaft",
    color: "#aabbcc",
    opacity: 0.7,
    order: 0,
    parents: [],
    children: [],
    details,
    areas: [],
    claimedBy: [],
    claims: [],
});
const namen = (feld: string): string => `n:${feld}`;

describe("Gebiet: die Felder der Wiki-Box", () => {
    it("🔴 genau die Felder, die ein Sync schreibt: die 17 Detailfelder ohne Handelszone und Politisch (der Abgleich liest sie, schreibt sie aber nicht)", () => {
        expect([...GEBIET_SYNC_FELDER].sort()).toEqual(
            [
                "blazon",
                "capital_name",
                "continent",
                "currency",
                "dissolved_text",
                "form_of_government",
                "founded_text",
                "founder",
                "geographic",
                "language",
                "population",
                "affiliation_raw",
                "ruler",
                "seat_name",
                "trade_goods",
            ].sort(),
        );
        expect(GEBIET_SYNC_FELDER).not.toContain("trade_zone");
        expect(GEBIET_SYNC_FELDER).not.toContain("political");
    });

    it("🔴 ein Feld, das dem Wiki folgt und abweicht, ist veraltet; ein eigener Wert bleibt und zählt als eigen; „Handelszone“ löst nichts aus", () => {
        const d = detail({
            ruler: { value: "Graf Alt", origin: "wiki", wiki: "Graf Neu" },
            language: { value: "Garethi", origin: "override", wiki: "Tulamidya" },
            founder: { value: "Hal", origin: "wiki", wiki: "Hal" },
            trade_zone: { value: "Nord", origin: "wiki", wiki: "Süd" },
        });
        const felder = gebietWikiBoxFelder(felderAus(d), false, namen);
        expect(felder).toHaveLength(GEBIET_SYNC_FELDER.length);
        expect(veraltete(felder).map((f) => f.id)).toEqual(["ruler"]);
        expect(eigene(felder).map((f) => f.id)).toEqual(["language"]);
        expect(standZeile(felder)).toEqual({ art: "neuer", fuellung: "halb" });
        const ruler = felder.find((f) => f.id === "ruler");
        expect(ruler).toMatchObject({ plan: ["ruler"], name: "n:ruler", folgt: true, eigen: "Graf Alt" });
        expect(ruler?.lage.wikiText).toBe("Graf Neu");
        // Lange Texte tragen den Vermerk „mehrzeilig“: Die Änderung nennt „Text geändert“ statt der Werte.
        expect(felder.find((f) => f.id === "blazon")?.mehrzeilig).toBe(true);
        expect(felder.find((f) => f.id === "ruler")?.mehrzeilig).toBe(false);
    });

    it("ohne Artikel (kein Wiki-Wert) ist nichts veraltet und nichts eigen; die Zeile ist „aktuell“", () => {
        const d = detail({ ruler: { value: "Graf Alt" } });
        const felder = gebietWikiBoxFelder(felderAus(d), false, namen);
        expect(veraltete(felder)).toEqual([]);
        expect(eigene(felder)).toEqual([]);
        expect(standZeile(felder).art).toBe("aktuell");
    });

    it("die Beschriftung kommt vom Fenster (dasselbe Feld heißt überall gleich)", () => {
        const felder = gebietWikiBoxFelder(felderAus(detail({})), true, (feld) => DETAIL_NAMEN[feld]);
        expect(felder.map((f) => f.name)).toEqual(GEBIET_SYNC_FELDER.map((f) => DETAIL_NAMEN[f]));
    });
});

describe("Gebiet: Wiki, Wappen und Quellen sind getrennt", () => {
    it("🔴 nichts geht verloren: Jedes der 17 Detailfelder steht in genau einem Kasten, die Zugehörigkeit (roh) im Kasten „Im Baum“", () => {
        const alle = Object.values(DETAIL_KAESTEN).flat();
        expect([...alle].sort()).toEqual([...EDITOR_TERRITORY_DETAIL_FIELDS].sort());
        expect(new Set(alle).size).toBe(alle.length);
        expect(DETAIL_KAESTEN.imBaum).toEqual(["affiliation_raw"]);
        expect(Object.keys(DETAIL_KAESTEN)).not.toContain("wiki");
    });

    it("🔴 die Reiter des Gebiets: Eigenschaften · Untergebiete · Hierarchie · Form · Quellen · Bilder · Verlauf, im Reiterbauteil des Hauses", () => {
        expect(GEBIETSEDITOR.eintraege.map((e) => e.id)).toEqual([
            "eigenschaften",
            "untergebiete",
            "hierarchie",
            "form",
            "quellen",
            "bilder",
            "karten",
            "verlauf",
        ]);
        const fenster = lies("apps/web/src/gebietseditor/gebietseditor-fenster.vue");
        expect(fenster).toContain("<FensterReiter");
        expect(fenster).not.toMatch(/role\s*=\s*["']tab(list)?["']/);
    });

    it("🔴 die Eigenschaften tragen die Wiki-Box (art gebiet) und kein Wappen mehr; der Kasten heißt nicht mehr „Wiki und Quellen“", () => {
        const text = lies("apps/web/src/gebietseditor/gebiet-eigenschaften.vue");
        expect(text).toContain("<WikiBox");
        expect(text).toContain('art="gebiet"');
        expect(text).not.toContain("MedienWappenKasten");
        expect(text).not.toContain("gebietseditor.abschnitt.wiki");
        expect(text).not.toContain("DETAIL_KAESTEN.wiki");
        expect(text).toContain("DETAIL_KAESTEN.imBaum");
    });

    it("🔴 das Wappen steht im Reiter „Bilder“ im selben Wappen-Kasten wie am Ort, die Quellen im Reiter „Quellen“ mit derselben Klappbox wie am Ort (WI-0254 §12)", () => {
        const bilder = lies("apps/web/src/gebietseditor/gebiet-bilder.vue");
        expect(bilder).toContain("<MedienWappenKasten");
        expect(bilder).toContain("kind: 'territory'");
        const ortBilder = lies("apps/web/src/ortseditor/ortseditor-bilder.vue");
        expect(ortBilder).toContain("<MedienWappenKasten");
        const fenster = lies("apps/web/src/gebietseditor/gebietseditor-fenster.vue");
        expect(fenster).toContain("<GebietBilder");
        expect(fenster).toContain("<TraegerQuellen");
        expect(fenster).toContain('kind="territory"');
        const ortEigenschaften = lies("apps/web/src/ortseditor/ortseditor-eigenschaften.vue");
        expect(ortEigenschaften).toContain("<TraegerQuellen");
        expect(ortEigenschaften).toContain('kind="place"');
        // Die alte Aufzählung ist weg: EINE Quellenliste für jeden Editor.
        expect(fenster).not.toContain("QuellenListe");
        expect(ortEigenschaften).not.toContain("QuellenListe");
    });

    it("die Mehrfachauswahl trägt die Zugehörigkeit (roh) auch im Kasten „Im Baum“, nicht in einem Kasten „Wiki und Quellen“", () => {
        const text = lies("apps/web/src/gebietseditor/gebiet-mehrfach.vue");
        expect(text).toContain("wikiFelder('imBaum')");
        expect(text).not.toContain("gebietseditor.abschnitt.wiki");
    });
});
