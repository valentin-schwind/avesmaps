import { describe, expect, it } from "vitest";
import { VORSCHAU_TEXT_MAX } from "../src/wiki/abgleich/ablage.ts";
import type { LokalerWert, PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import { entscheideZeile, entscheideZeilen } from "../src/wiki/abgleich/uebernahme/entscheiden.ts";
import { kraftlinieSchreiber } from "../src/wiki/abgleich/uebernahme/kraftlinie.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import { auditSchluessel } from "../src/wiki/abgleich/uebernahme/schreiber.ts";

/**
 * Was die Übernahme mit einer Zeile der Vorschau tut (WI-0253 D-1; `entscheiden.ts`), rein: Eigentümer wiki heißt die wirksame Spalte nur bei Herkunft wiki
 * (ein EIGENER Wert mit dem Vermerk „wiki“), der Wiki-Wert hinter ↺ immer; ein Wert, der seit der Vorschau anders ist, ein Befund; nichts zu tun ist kein Schritt.
 */

const ID = [
    "a1000000-0000-4000-8000-000000000001",
    "a1000000-0000-4000-8000-000000000002",
    "a1000000-0000-4000-8000-000000000003",
] as const;

function objekt(
    id: string,
    optionen: { lokal?: LokalerWert | null; schnappschuss?: Record<string, string | null> | null } = {},
): PlanObjekt {
    const lokal = new Map<string, LokalerWert>([["name", { zustand: "text", wert: "Linie", vermerk: "kein" }]]);
    if (optionen.lokal !== undefined && optionen.lokal !== null) lokal.set("description", optionen.lokal);
    return {
        bereich: "kraftlinie",
        objektArt: "powerline",
        id,
        name: "Linie",
        adresse: "https://de.wiki-aventurica.de/wiki/Linie",
        zustand: "zugewiesen",
        herkunft: "legacy_editor",
        hauptzuweisung: true,
        lokal,
        schnappschuss:
            optionen.schnappschuss === null
                ? null
                : new Map(Object.entries({ description: null, ...optionen.schnappschuss })),
        schnappschussUnbekannt: new Set(),
    };
}

function zeile(extra: Partial<VorschauZeile> = {}): VorschauZeile {
    return {
        id: 1,
        bereich: "kraftlinie",
        objektArt: "powerline",
        objektId: ID[0],
        objektName: "Linie",
        objekte: 1,
        objektIds: [ID[0]],
        artikel: "Linie",
        feld: "description",
        alt: "Alt",
        altZustand: "text",
        neu: "Neu",
        neuZustand: "text",
        eigentuemer: "wiki",
        wirkung: "uebernommen",
        ...extra,
    };
}

const karte = (...objekte: PlanObjekt[]): Map<string, PlanObjekt> => new Map(objekte.map((o) => [o.id, o]));
const ENTSCHEIDE = (z: VorschauZeile, objekte: Map<string, PlanObjekt>) =>
    entscheideZeile("kraftlinie", z, objekte, kraftlinieSchreiber);

describe("Übernahme: die Entscheidung je Zeile (rein)", () => {
    it("🔴 Eigentümer wiki, leeres Feld ohne Wiki-Stand davor: nur der Wiki-Wert hinter ↺ (leer heißt: folgt dem Wiki), keine wirksame Spalte", () => {
        const ergebnis = ENTSCHEIDE(
            zeile({ alt: null, altZustand: "kein" }),
            karte(objekt(ID[0], { schnappschuss: { description: null } })),
        );
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte).toHaveLength(1);
        expect(ergebnis.schritte[0]).toMatchObject({
            feld: "description",
            schnappschuss: { vorher: null, nachher: "Neu" },
        });
        expect(ergebnis.schritte[0]!.wirksam).toBeUndefined();
    });

    it("🔴 Leeres Feld, aber der Wiki-Stand davor zeigt einen Wert (die Vorschau nennt ihn unbekannt, nicht wiki): nur der Wiki-Wert hinter ↺, nichts Wirksames", () => {
        const ergebnis = ENTSCHEIDE(
            zeile({ eigentuemer: "unbekannt", wirkung: "befund" }),
            karte(objekt(ID[0], { schnappschuss: { description: "Alt" } })),
        );
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte).toHaveLength(1);
        expect(ergebnis.schritte[0]).toMatchObject({ schnappschuss: { vorher: "Alt", nachher: "Neu" } });
        expect(ergebnis.schritte[0]!.wirksam).toBeUndefined();
    });

    it("🔴 Eigentümer wiki, eigener Wert mit Vermerk wiki: die wirksame Spalte folgt dem Wiki, und der Wiki-Wert auch", () => {
        const eigener: LokalerWert = { zustand: "text", wert: "Alt", vermerk: "wiki" };
        const ergebnis = ENTSCHEIDE(
            zeile(),
            karte(objekt(ID[0], { lokal: eigener, schnappschuss: { description: "Alt" } })),
        );
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte[0]).toMatchObject({
            wirksam: { vorher: "Alt", nachher: "Neu" },
            schnappschuss: { vorher: "Alt", nachher: "Neu" },
        });
    });

    it("🔴 Hat die Wiki-Seite das Feld verloren, folgt der eigene Wert mit Vermerk wiki mit: leer", () => {
        const eigener: LokalerWert = { zustand: "text", wert: "Alt", vermerk: "wiki" };
        const ergebnis = ENTSCHEIDE(
            zeile({ neu: null, neuZustand: "kein" }),
            karte(objekt(ID[0], { lokal: eigener, schnappschuss: { description: "Alt" } })),
        );
        expect(ergebnis.schritte[0]).toMatchObject({
            wirksam: { vorher: "Alt", nachher: null },
            schnappschuss: { vorher: "Alt", nachher: null },
        });
    });

    it("🔴 Eigener Wert (manual): der Wert bleibt, der Wiki-Wert hinter ↺ ist trotzdem neu", () => {
        const eigen: LokalerWert = { zustand: "text", wert: "Meine", vermerk: "manual" };
        const ergebnis = ENTSCHEIDE(
            zeile({ alt: "Meine", eigentuemer: "manual", wirkung: "eigen" }),
            karte(objekt(ID[0], { lokal: eigen, schnappschuss: { description: "Wiki alt" } })),
        );
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte[0]).toMatchObject({ schnappschuss: { vorher: "Wiki alt", nachher: "Neu" } });
        expect(ergebnis.schritte[0]!.wirksam).toBeUndefined();
    });

    it("🔴 Istwert ungleich alt: ein Befund statt Überschreiben – ob der Wert sich oder sein Eigentümer sich geändert hat", () => {
        const geaendert: LokalerWert = { zustand: "text", wert: "Editor-Text", vermerk: "manual" };
        const wert = ENTSCHEIDE(
            zeile(),
            karte(objekt(ID[0], { lokal: geaendert, schnappschuss: { description: "Alt" } })),
        );
        expect(wert.schritte).toEqual([]);
        expect(wert.befunde).toEqual([
            expect.objectContaining({ objektId: ID[0], feld: "description", befund: "seit_vorschau_geaendert" }),
        ]);
        // Der Wert ist derselbe, aber der Vermerk ist nicht mehr „wiki“ (jemand hat ihn zur eigenen Entscheidung gemacht).
        const eigentuemer: LokalerWert = { zustand: "text", wert: "Alt", vermerk: "manual" };
        const entscheidung = ENTSCHEIDE(
            zeile(),
            karte(objekt(ID[0], { lokal: eigentuemer, schnappschuss: { description: "Alt" } })),
        );
        expect(entscheidung.schritte).toEqual([]);
        expect(entscheidung.befunde[0]).toMatchObject({ befund: "seit_vorschau_geaendert" });
    });

    it("🔴 Idempotent: Istwert und Wiki-Wert stimmen schon – weder Schritt noch Befund", () => {
        const eigener: LokalerWert = { zustand: "text", wert: "Neu", vermerk: "wiki" };
        const ergebnis = ENTSCHEIDE(
            zeile(),
            karte(objekt(ID[0], { lokal: eigener, schnappschuss: { description: "Neu" } })),
        );
        expect(ergebnis).toEqual({ schritte: [], befunde: [], schonGleich: 1 });
    });

    it("🔴 Ohne Wiki-Stand (nur eine Adresse): Wo etwas zu übernehmen wäre, ein Befund und nichts angelegt; ein eigener Wert hätte ohnehin geblieben", () => {
        const wiki = ENTSCHEIDE(
            zeile({ alt: null, altZustand: "kein" }),
            karte(objekt(ID[0], { schnappschuss: null })),
        );
        expect(wiki.schritte).toEqual([]);
        expect(wiki.befunde).toEqual([expect.objectContaining({ befund: "kein_schnappschuss" })]);
        const eigen = ENTSCHEIDE(
            zeile({ eigentuemer: "manual", wirkung: "eigen" }),
            karte(objekt(ID[0], { lokal: { zustand: "text", wert: "Alt", vermerk: "manual" }, schnappschuss: null })),
        );
        expect(eigen).toEqual({ schritte: [], befunde: [], schonGleich: 0 });
    });

    it("Ein Objekt, das es nicht mehr gibt, und ein Wert in der Länge des Schnitts sind Befunde", () => {
        expect(ENTSCHEIDE(zeile(), karte()).befunde).toEqual([
            expect.objectContaining({ objektId: ID[0], befund: "seit_vorschau_geaendert" }),
        ]);
        const lang = "x".repeat(VORSCHAU_TEXT_MAX);
        const gekuerzt = ENTSCHEIDE(
            zeile({ neu: lang }),
            karte(objekt(ID[0], { schnappschuss: { description: "Alt" } })),
        );
        expect(gekuerzt.schritte).toEqual([]);
        expect(gekuerzt.befunde).toEqual([expect.objectContaining({ befund: "wert_gekuerzt" })]);
    });

    it("🔴 Eine Zeile für mehrere Objekte: jedes für sich; berührt werden alle Objekte der Zeile, wo irgendeines etwas zu schreiben hat", () => {
        const eigener: LokalerWert = { zustand: "text", wert: "Alt", vermerk: "wiki" };
        const geaendert: LokalerWert = { zustand: "text", wert: "Anders", vermerk: "manual" };
        const objekte = karte(
            objekt(ID[0], { lokal: eigener, schnappschuss: { description: "Alt" } }),
            objekt(ID[1], { lokal: geaendert, schnappschuss: { description: "Alt" } }),
            objekt(ID[2], { lokal: eigener, schnappschuss: { description: "Alt" } }),
        );
        const gesamt = entscheideZeilen(
            "kraftlinie",
            [zeile({ objekte: 3, objektIds: [...ID] })],
            objekte,
            kraftlinieSchreiber,
        );
        expect(gesamt.schritte.map((s) => s.objekt.id)).toEqual([ID[0], ID[2]]);
        expect(gesamt.befunde.map((b) => b.objektId)).toEqual([ID[1]]);
        expect(gesamt.beruehrt).toEqual([...ID]);
        // Ohne irgendeinen Schritt wird nichts berührt.
        const nichts = entscheideZeilen(
            "kraftlinie",
            [zeile({ objekte: 1, objektIds: [ID[1]] })],
            objekte,
            kraftlinieSchreiber,
        );
        expect(nichts.beruehrt).toEqual([]);
    });

    it("Der Schlüssel im Fachprotokoll: das Feld selbst, der Wiki-Wert als wiki<Feld>", () => {
        expect(auditSchluessel("description", "wirksam")).toBe("description");
        expect(auditSchluessel("description", "schnappschuss")).toBe("wikiDescription");
        expect(auditSchluessel("region_text", "schnappschuss")).toBe("wikiRegionText");
    });
});
