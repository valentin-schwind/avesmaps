import { describe, expect, it } from "vitest";
import { INHALTE_VORKOMMEN_ARTEN } from "@avesmaps3d/shared";
import type {
    InhalteVorkommen,
    InhalteVorkommenOrt,
    InhalteVorkommenQuelle,
    InhalteVorkommenZiel,
} from "@avesmaps3d/shared";
import { loescheRegel, regelAusEditor } from "../src/inhalte/inhalte-vorkommen-regeln-modell.ts";
import {
    aktiveOrte,
    aktiveQuellen,
    aendereQuelle,
    entwurfAlsKoerper,
    haengeNamenAn,
    haengeOrtAn,
    haengeQuelleAn,
    kreisDesEintrags,
    loeseOrt,
    loeseQuelle,
    setzeFeld,
    standAusVorkommen,
    stelleOrtWiederHer,
    stelleQuelleWiederHer,
    trifftAufDerKarte,
    zaehleAenderungen,
    zeichenDerArt,
} from "../src/inhalte/inhalte-vorkommen-modell.ts";

/**
 * Die Entwurfsrechnung des Reiters „Vorkommen“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 3): was „Speichern“ aus dem Unterschied zwischen
 * dem Stand des Servers und dem Entwurf macht. Dass der Server den Körper annimmt, belegt `apps/server/test/inhalte-vorkommen.test.ts`; hier
 * steht nur die reine Rechnung.
 */
const ort = (n: number, teil: Partial<InhalteVorkommenOrt> = {}): InhalteVorkommenOrt => ({
    rowId: String(n),
    relation: "verbreitung",
    wikiKey: `ort-${String(n)}`,
    name: `Ort ${String(n)}`,
    keyClass: "other",
    targetState: "resolved",
    rolle: "ort",
    treffer: [
        { kind: "place", carrierId: `00000000-0000-4000-8000-00000000000${String(n)}`, name: `Ort ${String(n)}` },
    ],
    trefferGesamt: 1,
    state: "active",
    ursprung: "wiki",
    herkunft: "legacy",
    ...teil,
});

const quelle = (n: number, teil: Partial<InhalteVorkommenQuelle> = {}): InhalteVorkommenQuelle => ({
    sourceId: `00000000-0000-4000-8000-00000000050${String(n)}`,
    title: `Quelle ${String(n)}`,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    referenceKind: null,
    pages: null,
    note: null,
    state: "active",
    ursprung: "wiki",
    herkunft: "legacy",
    ...teil,
});

const eintrag = (teil: Partial<InhalteVorkommen> = {}): InhalteVorkommen => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    revision: 3,
    wikiKey: "aal",
    name: "Aal",
    art: "fauna",
    gruppe: "Fisch",
    lebensraum: null,
    synonyme: null,
    editorNote: null,
    ursprung: "wiki",
    herkunft: "legacy",
    aktiv: true,
    feldUrsprung: {},
    orte: [ort(1), ort(2)],
    regeln: [],
    quellen: [quelle(1)],
    ...teil,
});

const ziel = (
    n: number,
    teil: Partial<Extract<InhalteVorkommenZiel, { kind: string }>> = {},
): InhalteVorkommenZiel => ({
    kind: "place",
    carrierId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    name: `Ziel ${String(n)}`,
    wikiKey: `ziel-${String(n)}`,
    ...teil,
});

describe("Stand und Körper", () => {
    it("ein unveränderter Entwurf hat keinen Körper und keine Änderung", () => {
        const start = standAusVorkommen(eintrag());
        expect(entwurfAlsKoerper(start, start)).toBeUndefined();
        expect(zaehleAenderungen(start, start)).toBe(0);
    });

    it("🔴 nur geänderte Felder gehen in den Körper; Leeres wird zu null", () => {
        const start = standAusVorkommen(eintrag());
        let jetzt = setzeFeld(start, "name", "Aal, neu");
        jetzt = setzeFeld(jetzt, "gruppe", "   ");
        jetzt = setzeFeld(jetzt, "lebensraum", " Flüsse ");
        jetzt = setzeFeld(jetzt, "art", "ware");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            fields: { name: "Aal, neu", art: "ware", gruppe: null, lebensraum: "Flüsse" },
        });
        expect(zaehleAenderungen(start, jetzt)).toBe(4);
    });

    it("dasselbe Feld mit gleichem Wert ändert nichts; Leerraum um den Wert zählt nicht als Änderung", () => {
        const start = standAusVorkommen(eintrag());
        expect(setzeFeld(start, "name", "Aal")).toBe(start);
        expect(entwurfAlsKoerper(start, setzeFeld(start, "gruppe", " Fisch "))).toBeUndefined();
    });

    it("Unterdrücken und Zurückholen sind das Feld „aktiv“", () => {
        const start = standAusVorkommen(eintrag());
        expect(entwurfAlsKoerper(start, setzeFeld(start, "aktiv", false))).toEqual({ fields: { aktiv: false } });
    });
});

describe("Ortszeilen", () => {
    it("🔴 ein Kartenobjekt wird angehängt und geht als „add“ mit Kennung und Beziehung in den Körper, ohne Treffer", () => {
        const start = standAusVorkommen(eintrag());
        const jetzt = haengeOrtAn(start, ziel(1), "herkunft");
        expect(aktiveOrte(jetzt)).toHaveLength(3);
        const neu = jetzt.orte[2]!;
        expect(neu.neu).toBe(true);
        expect(neu.treffer).toEqual([]);
        expect(neu.wikiKey).toBe("ziel-1");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            orte: [
                { op: "add", kind: "place", carrierId: "00000000-0000-4000-8000-000000000101", relation: "herkunft" },
            ],
        });
    });

    it("ein Kontinentbegriff geht als „add“ mit dem Begriff in den Körper", () => {
        const start = standAusVorkommen(eintrag());
        const jetzt = haengeOrtAn(
            start,
            { kontinent: "aventurien", name: "Aventurien", wikiKey: "aventurien" },
            "verbreitung",
        );
        expect(jetzt.orte[2]!.keyClass).toBe("continent");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            orte: [{ op: "add", kontinent: "aventurien", relation: "verbreitung" }],
        });
    });

    it("dasselbe Ziel in derselben Beziehung ein zweites Mal ist keine Änderung; eine andere Beziehung ist eine zweite Zeile", () => {
        const start = standAusVorkommen(eintrag());
        const einmal = haengeOrtAn(start, ziel(1), "verbreitung");
        expect(haengeOrtAn(einmal, ziel(1), "verbreitung")).toBe(einmal);
        const zweimal = haengeOrtAn(einmal, ziel(1), "herkunft");
        expect(aktiveOrte(zweimal)).toHaveLength(4);
        // Ein Ziel, das eine Zeile des Servers schon führt (gleicher Wiki-Schlüssel, gleiche Beziehung), wird nicht doppelt.
        expect(haengeOrtAn(start, ziel(1, { wikiKey: "ort-1" }), "verbreitung")).toBe(start);
    });

    it("🔴 eine im Entwurf angehängte Zeile verschwindet beim Lösen ganz; eine des Servers wird unterdrückt (Legacy) und geht als „remove“", () => {
        const start = standAusVorkommen(eintrag());
        const mit = haengeOrtAn(start, ziel(1), "verbreitung");
        const ohne = loeseOrt(mit, mit.orte[2]!.schluessel);
        expect(ohne.orte).toHaveLength(2);
        expect(entwurfAlsKoerper(start, ohne)).toBeUndefined();

        const geloest = loeseOrt(start, "1");
        expect(geloest.orte[0]!.state).toBe("suppressed");
        expect(entwurfAlsKoerper(start, geloest)).toEqual({ orte: [{ op: "remove", rowId: "1" }] });
        // Eine eigene Zeile wird „gelöst“, nicht „unterdrückt“.
        const eigen = standAusVorkommen(eintrag({ orte: [ort(1, { herkunft: "editor", ursprung: "manual" })] }));
        expect(loeseOrt(eigen, "1").orte[0]!.state).toBe("retired");
    });

    it("eine stille Zeile des Servers kommt zurück: als „restore“; Lösen und Zurückholen im Entwurf heben sich auf", () => {
        const start = standAusVorkommen(eintrag({ orte: [ort(1), ort(2, { state: "suppressed" })] }));
        expect(aktiveOrte(start)).toHaveLength(1);
        const zurueck = stelleOrtWiederHer(start, "2");
        expect(entwurfAlsKoerper(start, zurueck)).toEqual({ orte: [{ op: "restore", rowId: "2" }] });
        expect(entwurfAlsKoerper(start, stelleOrtWiederHer(loeseOrt(start, "1"), "1"))).toBeUndefined();
        // Dasselbe Ziel noch einmal anhängen holt die stille Zeile zurück, statt eine zweite anzulegen.
        const angehaengt = haengeOrtAn(start, ziel(2, { wikiKey: "ort-2" }), "verbreitung");
        expect(angehaengt.orte).toHaveLength(2);
        expect(entwurfAlsKoerper(start, angehaengt)).toEqual({ orte: [{ op: "restore", rowId: "2" }] });
    });

    it("Lösen einer Zeile, die schon still ist, und Zurückholen einer aktiven ändern nichts", () => {
        const start = standAusVorkommen(eintrag({ orte: [ort(1), ort(2, { state: "retired" })] }));
        expect(loeseOrt(start, "2")).toBe(start);
        expect(stelleOrtWiederHer(start, "1")).toBe(start);
        expect(loeseOrt(start, "gibt-es-nicht")).toBe(start);
    });
});

describe("Rolle der Ortszeile (Migration 0247, WI-0253 §23)", () => {
    /** Eine Zeile, die der WikiSync als Bezugspunkt einer Richtung bestimmte: Link gespeichert, nie ein Treffer. */
    const bezugspunkt = ort(3, { rolle: "bezugspunkt", targetState: "unmatched", treffer: [], trefferGesamt: 0 });

    it("🔴 die Rolle kommt vom Server in den Entwurf; nur „ort“ trifft auf der Karte, jede andere Rolle nicht", () => {
        const start = standAusVorkommen(eintrag({ orte: [ort(1), bezugspunkt] }));
        expect(start.orte.map((o) => o.rolle)).toEqual(["ort", "bezugspunkt"]);
        expect(start.orte.map(trifftAufDerKarte)).toEqual([true, false]);
        for (const rolle of ["ausgenommen", "teil", "landschaftsart", "volk", "frueher", "andere_welt"] as const) {
            expect(trifftAufDerKarte(standAusVorkommen(eintrag({ orte: [ort(1, { rolle })] })).orte[0]!)).toBe(false);
        }
    });

    it("eine neu angehängte Zeile ist immer ein Ort (Kartenobjekt, Kontinent, Name); die Treffer rechnet erst der Server", () => {
        const start = standAusVorkommen(eintrag({ orte: [bezugspunkt] }));
        const mitObjekt = haengeOrtAn(start, ziel(1), "verbreitung");
        const mitKontinent = haengeOrtAn(
            mitObjekt,
            { kontinent: "aventurien", name: "Aventurien", wikiKey: "aventurien" },
            "herkunft",
        );
        const jetzt = haengeNamenAn(mitKontinent, "Ein Dorf", "vorkommen");
        expect(jetzt.orte.slice(1).map((o) => o.rolle)).toEqual(["ort", "ort", "ort"]);
    });

    it("🔴 der Editor schreibt die Rolle nie: eine Zeile mit Rolle ohne Änderung hat keinen Körper; Lösen und Zurückholen schicken nur Zeile und Handlung, keine Rolle", () => {
        const start = standAusVorkommen(eintrag({ orte: [ort(1), bezugspunkt] }));
        expect(entwurfAlsKoerper(start, start)).toBeUndefined();
        const geloest = loeseOrt(start, "3");
        expect(geloest.orte[1]).toMatchObject({ state: "suppressed", rolle: "bezugspunkt" });
        expect(entwurfAlsKoerper(start, geloest)).toEqual({ orte: [{ op: "remove", rowId: "3" }] });
        // Zurückgeholt behält die Zeile ihre Rolle (nur der WikiSync ändert sie).
        const zurueck = stelleOrtWiederHer(geloest, "3");
        expect(zurueck.orte[1]!.rolle).toBe("bezugspunkt");
        expect(entwurfAlsKoerper(start, zurueck)).toBeUndefined();
    });
});

describe("Ungeklärter Name als Ziel (Vali wählte B, Migration 0235)", () => {
    it("🔴 ein Name wird angehängt und geht als „add“ mit dem Namen in den Körper; ohne Schlüssel, ohne Treffer, nie als Kartenobjekt", () => {
        const start = standAusVorkommen(eintrag());
        const jetzt = haengeNamenAn(start, "  Ein Dorf im Norden ", "herkunft");
        expect(aktiveOrte(jetzt)).toHaveLength(3);
        const neu = jetzt.orte[2]!;
        expect(neu).toMatchObject({
            neu: true,
            wikiKey: null,
            name: "Ein Dorf im Norden",
            keyClass: "other",
            targetState: "unresolved",
            treffer: [],
            trefferGesamt: 0,
            ursprung: "manual",
            herkunft: "editor",
        });
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            orte: [{ op: "add", name: "Ein Dorf im Norden", relation: "herkunft" }],
        });
        expect(zaehleAenderungen(start, jetzt)).toBe(1);
    });

    it("derselbe Name in derselben Beziehung (auch anders geschrieben) ist keine Änderung; eine andere Beziehung ist eine zweite Zeile; ein leerer Name nichts", () => {
        const start = standAusVorkommen(eintrag());
        const einmal = haengeNamenAn(start, "Ein Dorf", "verbreitung");
        expect(haengeNamenAn(einmal, "  EIN dorf ", "verbreitung")).toBe(einmal);
        expect(aktiveOrte(haengeNamenAn(einmal, "Ein Dorf", "herkunft"))).toHaveLength(4);
        expect(haengeNamenAn(start, "   ", "verbreitung")).toBe(start);
        // Ein Name, der wie das Ziel einer Zeile des Servers aussieht, bleibt ein Name: nie ein Schlüssel.
        expect(aktiveOrte(haengeNamenAn(start, "ort-1", "verbreitung"))).toHaveLength(3);
    });

    it("eine im Entwurf angehängte Namenszeile verschwindet beim Lösen ganz; eine des Servers wird gelöst und kommt als „restore“ zurück", () => {
        const start = standAusVorkommen(
            eintrag({
                orte: [
                    ort(1),
                    ort(2, {
                        wikiKey: null,
                        name: "Ein Dorf",
                        keyClass: "other",
                        targetState: "unresolved",
                        ursprung: "manual",
                        herkunft: "editor",
                    }),
                ],
            }),
        );
        const mit = haengeNamenAn(start, "Noch ein Dorf", "vorkommen");
        expect(entwurfAlsKoerper(start, loeseOrt(mit, mit.orte[2]!.schluessel))).toBeUndefined();
        const geloest = loeseOrt(start, "2");
        expect(geloest.orte[1]!.state).toBe("retired");
        expect(entwurfAlsKoerper(start, geloest)).toEqual({ orte: [{ op: "remove", rowId: "2" }] });
        expect(entwurfAlsKoerper(start, stelleOrtWiederHer(geloest, "2"))).toBeUndefined();
        // Dasselbe Wort noch einmal angehängt holt die stille Zeile zurück, statt eine zweite anzulegen.
        const still = standAusVorkommen(
            eintrag({
                orte: [
                    ort(1),
                    ort(2, {
                        wikiKey: null,
                        name: "Ein Dorf",
                        targetState: "unresolved",
                        state: "retired",
                        herkunft: "editor",
                    }),
                ],
            }),
        );
        const zurueck = haengeNamenAn(still, "ein dorf", "verbreitung");
        expect(zurueck.orte).toHaveLength(2);
        expect(entwurfAlsKoerper(still, zurueck)).toEqual({ orte: [{ op: "restore", rowId: "2" }] });
    });
});

describe("Quellen des Eintrags", () => {
    it("🔴 eine Quelle des Katalogs wird angehängt und geht als „add“ in den Körper; vor dem Speichern wieder gelöst verschwindet sie ganz", () => {
        const start = standAusVorkommen(eintrag());
        const id = "00000000-0000-4000-8000-000000000999";
        const mit = haengeQuelleAn(start, { sourceId: id, title: "Neue Quelle" });
        expect(aktiveQuellen(mit)).toHaveLength(2);
        expect(entwurfAlsKoerper(start, mit)).toEqual({
            quellen: [{ op: "add", sourceId: id, referenceKind: null, pages: null, note: null }],
        });
        expect(entwurfAlsKoerper(start, loeseQuelle(mit, id))).toBeUndefined();
        // Dieselbe Quelle noch einmal ist keine Änderung.
        expect(haengeQuelleAn(mit, { sourceId: id, title: "Neue Quelle" })).toBe(mit);
    });

    it("Typ, „offiziell“ und Adresse der Quelle kommen mit dem Stand und mit dem Anhängen, gehen aber nie in den Körper (sie gehören der Quelle im Katalog)", () => {
        const start = standAusVorkommen(
            eintrag({
                quellen: [quelle(1, { sourceType: "roman", offiziell: false, url: "https://shop.example/buch" })],
            }),
        );
        expect(start.quellen[0]).toMatchObject({
            sourceType: "roman",
            offiziell: false,
            url: "https://shop.example/buch",
        });
        // Ohne Adresse (Buchquelle) bleibt sie leer, nicht "".
        expect(standAusVorkommen(eintrag()).quellen[0]).toMatchObject({
            sourceType: "regionalspielhilfe",
            offiziell: true,
            url: null,
        });
        // Die Suche im Katalog kennt Typ und Adresse; ob die Quelle offiziell ist, weiß erst der Server.
        const id = "00000000-0000-4000-8000-000000000998";
        const mit = haengeQuelleAn(start, {
            sourceId: id,
            title: "Aus dem Katalog",
            sourceType: "abenteuer",
            url: "https://a.example/x",
        });
        expect(mit.quellen.at(-1)).toMatchObject({
            sourceType: "abenteuer",
            offiziell: null,
            url: "https://a.example/x",
            neu: true,
        });
        // Der Weg über den Konflikt kennt keine Katalogzeile: alles bleibt leer.
        expect(haengeQuelleAn(start, { sourceId: id, title: "Ohne Zeile" }).quellen.at(-1)).toMatchObject({
            sourceType: null,
            offiziell: null,
            url: null,
        });
        expect(JSON.stringify(entwurfAlsKoerper(start, mit))).not.toMatch(/sourceType|offiziell|url/);
    });

    it("Fundstelle, Art und Notiz einer Quelle gehen als „update“, Leeres als null", () => {
        const start = standAusVorkommen(eintrag());
        const id = start.quellen[0]!.sourceId;
        let jetzt = aendereQuelle(start, id, { pages: "129–141" });
        jetzt = aendereQuelle(jetzt, id, { referenceKind: "ausfuehrlich" });
        jetzt = aendereQuelle(jetzt, id, { note: "   " });
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            quellen: [{ op: "update", sourceId: id, referenceKind: "ausfuehrlich", pages: "129–141", note: null }],
        });
        expect(zaehleAenderungen(start, jetzt)).toBe(1);
    });

    it("Lösen einer Quelle des Servers geht als „remove“, Zurückholen als „restore“; geändert zurückgeholt als „add“ mit den neuen Angaben", () => {
        const start = standAusVorkommen(
            eintrag({ quellen: [quelle(1), quelle(2, { state: "retired", herkunft: "editor" })] }),
        );
        const [eins, zwei] = start.quellen;
        expect(entwurfAlsKoerper(start, loeseQuelle(start, eins!.sourceId))).toEqual({
            quellen: [{ op: "remove", sourceId: eins!.sourceId }],
        });
        const zurueck = stelleQuelleWiederHer(start, zwei!.sourceId);
        expect(entwurfAlsKoerper(start, zurueck)).toEqual({ quellen: [{ op: "restore", sourceId: zwei!.sourceId }] });
        const geaendert = aendereQuelle(zurueck, zwei!.sourceId, { pages: "7" });
        expect(entwurfAlsKoerper(start, geaendert)).toEqual({
            quellen: [{ op: "add", sourceId: zwei!.sourceId, referenceKind: null, pages: "7", note: null }],
        });
        // An einer stillen Quelle ändert sich nichts, bis sie zurückgeholt ist.
        expect(aendereQuelle(start, zwei!.sourceId, { pages: "7" })).toBe(start);
    });
});

describe("Zählung und Kreis", () => {
    it("zählt Felder, Ortszeilen und Quellen zusammen", () => {
        const start = standAusVorkommen(eintrag());
        let jetzt = setzeFeld(start, "name", "Aal, neu");
        jetzt = haengeOrtAn(jetzt, ziel(1), "verbreitung");
        jetzt = loeseOrt(jetzt, "2");
        jetzt = aendereQuelle(jetzt, start.quellen[0]!.sourceId, { pages: "1" });
        expect(zaehleAenderungen(start, jetzt)).toBe(4);
    });

    it("der Kreis: ● aus Legacy oder Wiki, ◐ von der Redaktion, ○ unterdrückt", () => {
        expect(kreisDesEintrags({ herkunft: "legacy", stillgelegt: false })).toBe("voll");
        expect(kreisDesEintrags({ herkunft: "editor", stillgelegt: false })).toBe("halb");
        expect(kreisDesEintrags({ herkunft: "editor", stillgelegt: true })).toBe("leer");
    });
});

describe("Regeln im Stand und im Körper (Regeleditor, WI-0254 `--weiter`)", () => {
    const regel = {
        ruleId: "7",
        relation: "verbreitung" as const,
        ursprung: "wiki" as const,
        state: "active" as const,
        bedingungen: [{ joinOp: "und" as const, arten: [{ ebene: "vegetation", art: "wald" }] }],
        ruleKey: "7".repeat(64),
    };

    it("der Stand trägt die Regeln des Servers; ohne Regeländerung steht kein regeln im Körper", () => {
        const start = standAusVorkommen(eintrag({ regeln: [regel] }));
        expect(start.regeln).toHaveLength(1);
        expect(start.regeln[0]).toMatchObject({ ruleId: "7", neu: false, ursprung: "wiki" });
        const jetzt = setzeFeld(start, "gruppe", "Süßwasser");
        expect(entwurfAlsKoerper(start, jetzt)).not.toHaveProperty("regeln");
    });

    it("🔴 Regeln zählen mit den Feldern, Ortszeilen und Quellen; sie stehen neben ihnen im Körper", () => {
        const start = standAusVorkommen(eintrag({ regeln: [regel] }));
        let jetzt = setzeFeld(start, "name", "Aal, neu");
        jetzt = haengeOrtAn(jetzt, ziel(1), "verbreitung");
        jetzt = { ...jetzt, regeln: loescheRegel(jetzt.regeln, "7") };
        jetzt = {
            ...jetzt,
            regeln: regelAusEditor(
                jetzt.regeln,
                {
                    relation: "herkunft",
                    bedingungen: [
                        {
                            verknuepfung: "und",
                            flaeche: null,
                            arten: [{ ebene: "vegetation", art: "steppe" }],
                            klima: null,
                            woerter: [],
                            rueckfragen: [],
                        },
                    ],
                },
                undefined,
            ),
        };
        expect(zaehleAenderungen(start, jetzt)).toBe(4);
        const koerper = entwurfAlsKoerper(start, jetzt);
        expect(koerper?.fields).toEqual({ name: "Aal, neu" });
        expect(koerper?.orte).toHaveLength(1);
        expect(koerper?.regeln?.map((r) => r.op)).toEqual(["remove", "add"]);
    });
});

describe("Zeichen der Kategorie (Betreiber 2026-10-28)", () => {
    it("jede Kategorie trägt ihr eigenes Zeichen: Pfote, Blume, Korb, Person", () => {
        expect(zeichenDerArt("fauna")).toBe("fauna");
        expect(zeichenDerArt("flora")).toBe("flora");
        expect(zeichenDerArt("ware")).toBe("ware");
        expect(zeichenDerArt("spezies")).toBe("spezies");
        expect(new Set(INHALTE_VORKOMMEN_ARTEN.map((art) => zeichenDerArt(art))).size).toBe(
            INHALTE_VORKOMMEN_ARTEN.length,
        );
    });

    it("alles Unbekannte behält das Zeichen des Reiters", () => {
        expect(zeichenDerArt("")).toBe("vorkommen");
        expect(zeichenDerArt("pilz")).toBe("vorkommen");
    });
});
