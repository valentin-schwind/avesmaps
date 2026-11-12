import { describe, expect, it } from "vitest";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { erbeGruppenNamensraum, leiteKanonAb, type KanonQuelle } from "../src/kanon/ableitung.ts";
import { gleicheAussage } from "../src/kanon/neu-berechnen.ts";

/**
 * Die Kanon-Regel Rang 1 bis 3, rein (WI-0253 B-2; Vertrag `sources.yaml` `kanon.raenge`, Evidenz Legacy `avesmapsFeatureSourcesDeriveKanon`).
 * Benannte Fälle statt einer Tafel von Zahlen; die Messung gegen Legacys importierte Zeilen steht in `kanon-orakel.test.ts`.
 */

const tafel = wikiNamespaceTafel();
const quelle = (art: string, offiziell: boolean, publikation = false): KanonQuelle => ({ art, offiziell, publikation });
const ergebnis = (
    kanon: "official" | "unofficial",
    type: string | null = null,
    count: number | null = null,
    label: string | null = null,
) => ({
    kanon,
    designatorType: type,
    designatorCount: count,
    designatorLabel: label,
});

describe("Rang 1: die Wiki-Zuweisung entscheidet, über die Namensraum-Tafel", () => {
    it("🔴 Hauptraum: OFFIZIELL ohne Bezeichner (die ganze, runde Pille), auch gegen eine inoffizielle Quelle", () => {
        expect(leiteKanonAb({ ns: 0, quellen: [] }, tafel)).toEqual(ergebnis("official"));
        expect(leiteKanonAb({ ns: 0, quellen: [quelle("briefspiel", false)] }, tafel)).toEqual(ergebnis("official"));
    });

    it("🔴 222 (Inoffiziell:): INOFFIZIELL | Wiki Aventurica, auch gegen eine offizielle Quelle und auch ohne jede Quelle", () => {
        const erwartet = ergebnis("unofficial", null, null, "Wiki Aventurica");
        expect(leiteKanonAb({ ns: 222, quellen: [] }, tafel)).toEqual(erwartet);
        expect(leiteKanonAb({ ns: 222, quellen: [quelle("regelbuch", true)] }, tafel)).toEqual(erwartet);
        expect(leiteKanonAb({ ns: 444, quellen: [] }, tafel)).toEqual(erwartet);
    });

    it("🔴 218 (DSK) und 220 (Elf) sind offiziell, nicht „alles außer dem Hauptraum ist Fanmaterial“", () => {
        for (const ns of [218, 220])
            expect(leiteKanonAb({ ns, quellen: [] }, tafel), String(ns)).toEqual(ergebnis("official"));
    });

    it("ein Raum, den die Tafel nicht kennt (Kategorie 14, Datei 6), sagt nichts und fällt zu den Quellen durch", () => {
        expect(leiteKanonAb({ ns: 14, quellen: [] }, tafel)).toBeNull();
        expect(leiteKanonAb({ ns: 14, quellen: [quelle("roman", false)] }, tafel)).toEqual(
            ergebnis("unofficial", "roman"),
        );
    });

    it("🔴 eine Eigenkennung (Zuweisung ohne Wiki-Adresse, ns null) ist kein Rang 1: Es gelten die lokalen Daten", () => {
        expect(leiteKanonAb({ ns: null, quellen: [] }, tafel)).toBeNull();
        expect(leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false)] }, tafel)).toEqual(
            ergebnis("unofficial", "briefspiel"),
        );
    });

    it("🔴 Kanon und Bezeichner sind die der Tafel dieser Umgebung: ein Umstieg ist testbar", () => {
        const umgestellt = wikiNamespaceTafel([
            { ns: 222, praefix: "Inoffiziell", kanon: "offiziell", einsammeln: true, bezeichner: "Fanwelt" },
            { ns: 0, praefix: "", kanon: "offiziell", einsammeln: true, bezeichner: "Wiki" },
        ]);
        expect(leiteKanonAb({ ns: 222, quellen: [] }, umgestellt)).toEqual(ergebnis("official", null, null, "Fanwelt"));
        expect(leiteKanonAb({ ns: 0, quellen: [] }, umgestellt)).toEqual(ergebnis("official", null, null, "Wiki"));
        // Ein neu hinzugefügter Raum ist sofort Inhalt.
        const mehr = wikiNamespaceTafel([
            { ns: 100, praefix: "Brief", kanon: "inoffiziell", einsammeln: false, bezeichner: "" },
        ]);
        expect(leiteKanonAb({ ns: 100, quellen: [] }, mehr)).toEqual(ergebnis("unofficial"));
    });

    it("🔴 mit Wiki-Zuweisung zählen Publikationen nicht: Weder ändern sie das Etikett noch den Bezeichner", () => {
        const mitPublikation = leiteKanonAb({ ns: 222, quellen: [quelle("regionalspielhilfe", true, true)] }, tafel);
        expect(mitPublikation).toEqual(ergebnis("unofficial", null, null, "Wiki Aventurica"));
    });
});

describe("Rang 2 und 3: ohne Zuweisung zählen die Quellen der Editoren und die Publikationen gemeinsam", () => {
    it("🔴 eine offizielle Quelle: OFFIZIELL mit der Art als Bezeichner", () => {
        expect(leiteKanonAb({ ns: null, quellen: [quelle("regelbuch", true)] }, tafel)).toEqual(
            ergebnis("official", "regelbuch"),
        );
    });

    it("🔴 gezählt werden für OFFIZIELL nur die offiziellen: Eine inoffizielle daneben ändert weder Art noch Anzahl", () => {
        const q = [quelle("briefspiel", false), quelle("briefspiel", false), quelle("regionalspielhilfe", true)];
        expect(leiteKanonAb({ ns: null, quellen: q }, tafel)).toEqual(ergebnis("official", "regionalspielhilfe"));
    });

    it("🔴 gemischte inoffizielle Quellen: die Anzahl statt einer Art; dieselbe Art mit der Anzahl; eine einzelne ohne Anzahl", () => {
        expect(
            leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false), quelle("roman", false)] }, tafel),
        ).toEqual(ergebnis("unofficial", null, 2));
        expect(
            leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false), quelle("briefspiel", false)] }, tafel),
        ).toEqual(ergebnis("unofficial", "briefspiel", 2));
        expect(leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false)] }, tafel)).toEqual(
            ergebnis("unofficial", "briefspiel"),
        );
    });

    it("🔴 eine Publikation zählt ohne Wiki wie eine Quelle (Vali 2026-10-25), der Dommel-Fall bekommt ein Etikett", () => {
        expect(leiteKanonAb({ ns: null, quellen: [quelle("aventurischer_bote", true, true)] }, tafel)).toEqual(
            ergebnis("official", "aventurischer_bote"),
        );
        expect(
            leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false, true), quelle("roman", false)] }, tafel),
        ).toEqual(ergebnis("unofficial", null, 2));
        // Eine offizielle Publikation macht den Träger offiziell, auch neben einer inoffiziellen Quelle.
        expect(
            leiteKanonAb({ ns: null, quellen: [quelle("briefspiel", false), quelle("abenteuer", true, true)] }, tafel),
        ).toEqual(ergebnis("official", "abenteuer"));
    });

    it("🔴 Legacys Regelstand (Maßstab des Orakels): Publikationen zählen nie, OFFIZIELL bleibt rund", () => {
        expect(
            leiteKanonAb({ ns: null, quellen: [quelle("aventurischer_bote", true, true)] }, tafel, "legacy"),
        ).toBeNull();
        expect(leiteKanonAb({ ns: null, quellen: [quelle("regelbuch", true)] }, tafel, "legacy")).toEqual(
            ergebnis("official"),
        );
        expect(
            leiteKanonAb(
                {
                    ns: null,
                    quellen: [quelle("briefspiel", false), quelle("roman", false), quelle("roman", false, true)],
                },
                tafel,
                "legacy",
            ),
        ).toEqual(ergebnis("unofficial", null, 2));
    });

    it("🔴 ohne Zuweisung und ohne Verweis sagen Rang 1 bis 3 nichts (dann entscheidet beim Lesen die Tafel Rang 4)", () => {
        expect(leiteKanonAb({ ns: null, quellen: [] }, tafel)).toBeNull();
    });

    it("eine Quelle ohne Art hat keine Art als Bezeichner, nie einen Titel", () => {
        expect(leiteKanonAb({ ns: null, quellen: [quelle(" ", false)] }, tafel)).toEqual(ergebnis("unofficial"));
    });
});

describe("Die Wegegruppe erbt (Legacy `WegGruppeErbtZuweisung`)", () => {
    const w = (gruppe: string | null, ns: number | null) => ({ gruppe, ns });

    it("🔴 ein Abschnitt ohne eigene Zuweisung erbt den Raum seiner Gruppe", () => {
        expect(erbeGruppenNamensraum([w("Fluss|Mhanadi", 0), w("Fluss|Mhanadi", null), w("Fluss|Mhanadi", 0)])).toEqual(
            [0, 0, 0],
        );
        expect(erbeGruppenNamensraum([w("Strasse|X", 222), w("Strasse|X", null)])).toEqual([222, 222]);
    });

    it("🔴 eine uneinige Gruppe erbt nichts: lieber kein Etikett als ein erfundenes", () => {
        expect(erbeGruppenNamensraum([w("Fluss|Y", 0), w("Fluss|Y", 222), w("Fluss|Y", null)])).toEqual([0, 222, null]);
    });

    it("eine eigene Aussage wird nie überschrieben, und gleiche Namen in anderer Wegart sind eine andere Gruppe", () => {
        expect(erbeGruppenNamensraum([w("Fluss|Z", 222), w("Fluss|Z", 0)])).toEqual([222, 0]);
        expect(erbeGruppenNamensraum([w("Fluss|Z", 0), w("Strasse|Z", null)])).toEqual([0, null]);
    });

    it("ein Abschnitt ohne Namen hat keine Gruppe und erbt nichts", () => {
        expect(erbeGruppenNamensraum([w(null, null), w(null, 0)])).toEqual([null, 0]);
    });
});

describe("Der Vergleich einer Zeile mit dem Ergebnis", () => {
    const zeile = (
        kanon: string,
        type: string | null = null,
        count: number | null = null,
        label: string | null = null,
    ) => ({
        kanon,
        designatorType: type,
        designatorCount: count,
        designatorLabel: label,
        derivedFrom: "legacy_feature_kanon",
    });

    it("keine Zeile und `unlabelled` sagen beide: nichts", () => {
        expect(gleicheAussage(undefined, null)).toBe(true);
        expect(gleicheAussage(zeile("unlabelled"), null)).toBe(true);
        expect(gleicheAussage(undefined, ergebnis("official"))).toBe(false);
        expect(gleicheAussage(zeile("unlabelled"), ergebnis("official"))).toBe(false);
    });

    it("jedes Feld zählt", () => {
        expect(gleicheAussage(zeile("official"), ergebnis("official"))).toBe(true);
        expect(gleicheAussage(zeile("official"), ergebnis("unofficial"))).toBe(false);
        expect(gleicheAussage(zeile("official", "regelbuch"), ergebnis("official"))).toBe(false);
        expect(gleicheAussage(zeile("unofficial", "briefspiel", 2), ergebnis("unofficial", "briefspiel", 2))).toBe(
            true,
        );
        expect(
            gleicheAussage(
                zeile("unofficial", null, null, "Wiki Aventurica"),
                ergebnis("unofficial", null, null, "Wiki Aventurica"),
            ),
        ).toBe(true);
        expect(gleicheAussage(zeile("official"), null)).toBe(false);
    });
});
