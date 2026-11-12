import { describe, expect, it } from "vitest";
import type { InhalteQuelle, InhalteVerwendung, InhalteZiel } from "@avesmaps3d/shared";
import {
    aendereVerwendung,
    entwurfAlsKoerper,
    haengeAn,
    kreisDerQuelle,
    lizenzWert,
    loeseVerwendung,
    setzeFeld,
    setzeLizenz,
    standAusQuelle,
    stelleWiederHer,
    zaehleAenderungen,
} from "../src/inhalte/inhalte-quellen-modell.ts";

/**
 * Die Entwurfsrechnung des Reiters „Quellen“ im Fenster „Inhalte bearbeiten“ (WI-0254): was „Speichern“ aus dem Unterschied zwischen dem
 * Stand des Servers und dem Entwurf macht. Dass der Server den Körper annimmt, belegt `apps/server/test/inhalte-quellen.test.ts`; wie das
 * Fenster aussieht, zeigt die Sichtprüfung. Hier steht nur die reine Rechnung.
 */
const verwendung = (teil: Partial<InhalteVerwendung>): InhalteVerwendung => ({
    kind: "place",
    carrierId: "00000000-0000-4000-8000-000000000001",
    name: "Gareth",
    referenceKind: "erwaehnung",
    pages: "45",
    note: null,
    state: "active",
    herkunft: "legacy",
    traegerAktiv: true,
    aenderbar: true,
    ...teil,
});

const quelle = (verwendungen: InhalteVerwendung[] = [verwendung({})]): InhalteQuelle => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    revision: 3,
    identitaet: "url",
    title: "Geographia Aventurica",
    url: "https://example.org/geo",
    sourceType: "regionalspielhilfe",
    isOfficial: true,
    lizenzAussage: "unrecorded",
    lizenzKey: null,
    attribution: null,
    editorNote: null,
    herkunft: "legacy",
    aktiv: true,
    verwendungen,
    verwendungenGesamt: verwendungen.length,
    lizenzen: [],
});

const ziel = (teil: Partial<InhalteZiel> = {}): InhalteZiel => ({
    kind: "territory",
    carrierId: "00000000-0000-4000-8000-000000000002",
    name: "Albernia",
    ...teil,
});

const ID_ORT = "00000000-0000-4000-8000-000000000001";

describe("Stand und Körper", () => {
    it("ein unveränderter Entwurf hat keinen Körper und keine Änderung", () => {
        const start = standAusQuelle(quelle());
        expect(entwurfAlsKoerper(start, start)).toBeUndefined();
        expect(zaehleAenderungen(start, start)).toBe(0);
    });

    it("🔴 nur geänderte Felder gehen in den Körper; ein leerer Text wird zu null", () => {
        const start = standAusQuelle(quelle());
        const jetzt = setzeFeld(setzeFeld(start, "title", "Neuer Titel"), "attribution", "  ");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({ fields: { title: "Neuer Titel" } });
        const mitNennung = setzeFeld(start, "attribution", "VolkoV");
        expect(entwurfAlsKoerper(start, mitNennung)).toEqual({ fields: { attribution: "VolkoV" } });
        const leerNachNennung = setzeFeld(mitNennung, "attribution", "");
        expect(entwurfAlsKoerper(mitNennung, leerNachNennung)).toEqual({ fields: { attribution: null } });
    });

    it("der Kommentar der Redaktion: getrimmt, leer wird null, Leerzeichen allein sind keine Änderung", () => {
        const start = standAusQuelle(quelle());
        const mit = setzeFeld(start, "editorNote", "  Buchquelle  ");
        expect(entwurfAlsKoerper(start, mit)).toEqual({ fields: { editorNote: "Buchquelle" } });
        expect(entwurfAlsKoerper(start, setzeFeld(start, "editorNote", "   "))).toBeUndefined();
        expect(entwurfAlsKoerper(mit, setzeFeld(mit, "editorNote", ""))).toEqual({ fields: { editorNote: null } });
    });

    it("die Lizenz gehört zusammen: ohne Aussage „Lizenz“ gibt es keinen Schlüssel, und beide gehen gemeinsam in den Körper", () => {
        const start = standAusQuelle(quelle());
        const frei = setzeLizenz(start, "license:cc-by-sa-3.0");
        expect(lizenzWert(frei.felder)).toBe("license:cc-by-sa-3.0");
        expect(entwurfAlsKoerper(start, frei)).toEqual({
            fields: { lizenzAussage: "license", lizenzKey: "cc-by-sa-3.0" },
        });
        expect(zaehleAenderungen(start, frei)).toBe(1);
        const zurueck = setzeLizenz(frei, "public_domain");
        expect(zurueck.felder.lizenzKey).toBeNull();
        expect(lizenzWert(zurueck.felder)).toBe("public_domain");
        expect(setzeLizenz(start, "unsinn")).toBe(start);
    });

    it("eine Änderung und ihr Zurücksetzen auf den alten Wert ist keine Änderung", () => {
        const start = standAusQuelle(quelle());
        const hin = setzeFeld(start, "isOfficial", false);
        expect(zaehleAenderungen(start, hin)).toBe(1);
        expect(entwurfAlsKoerper(start, setzeFeld(hin, "isOfficial", true))).toBeUndefined();
    });
});

describe("Verwendungen", () => {
    it("🔴 eine angehängte Verwendung ist ein add; wird sie im Entwurf wieder gelöst, kommt sie nicht vor", () => {
        const start = standAusQuelle(quelle());
        const mit = haengeAn(start, ziel(), "ausfuehrlich");
        expect(entwurfAlsKoerper(start, mit)).toEqual({
            links: [
                {
                    op: "add",
                    kind: "territory",
                    carrierId: "00000000-0000-4000-8000-000000000002",
                    referenceKind: "ausfuehrlich",
                    pages: null,
                    note: null,
                },
            ],
        });
        expect(entwurfAlsKoerper(start, loeseVerwendung(mit, "territory", ziel().carrierId))).toBeUndefined();
        expect(haengeAn(mit, ziel(), null)).toBe(mit);
    });

    it("Fundstelle und Art einer bestehenden Verwendung sind ein update, Leerzeichen am Rand fallen weg", () => {
        const start = standAusQuelle(quelle());
        const jetzt = aendereVerwendung(start, "place", ID_ORT, { pages: " 77–79 ", referenceKind: "ausfuehrlich" });
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            links: [
                {
                    op: "update",
                    kind: "place",
                    carrierId: ID_ORT,
                    referenceKind: "ausfuehrlich",
                    pages: "77–79",
                    note: null,
                },
            ],
        });
    });

    it("🔴 Lösen: eine aus Legacy übernommene Verwendung wird unterdrückt, eine eigene gelöst; beides ist ein remove, und ↺ stellt sie her", () => {
        const eigene = verwendung({ carrierId: "00000000-0000-4000-8000-000000000003", herkunft: "editor" });
        const start = standAusQuelle(quelle([verwendung({}), eigene]));
        const geloest = loeseVerwendung(loeseVerwendung(start, "place", ID_ORT), "place", eigene.carrierId);
        expect(geloest.verwendungen.map((v) => v.state)).toEqual(["suppressed", "retired"]);
        expect(entwurfAlsKoerper(start, geloest)?.links?.map((l) => l.op)).toEqual(["remove", "remove"]);
        const zurueck = stelleWiederHer(geloest, "place", ID_ORT);
        expect(entwurfAlsKoerper(start, zurueck)?.links?.map((l) => l.op)).toEqual(["remove"]);
        expect(entwurfAlsKoerper(start, stelleWiederHer(zurueck, "place", eigene.carrierId))).toBeUndefined();
    });

    it("eine schon still geführte Verwendung kommt per restore zurück, mit anderen Angaben per add", () => {
        const still = verwendung({ state: "suppressed" });
        const start = standAusQuelle(quelle([still]));
        const da = stelleWiederHer(start, "place", still.carrierId);
        expect(entwurfAlsKoerper(start, da)?.links).toEqual([
            { op: "restore", kind: "place", carrierId: still.carrierId },
        ]);
        const geaendert = aendereVerwendung(da, "place", still.carrierId, { pages: "12" });
        expect(entwurfAlsKoerper(start, geaendert)?.links?.map((l) => l.op)).toEqual(["add"]);
    });

    describe("ein Weg ist die ganze Straße: eine Zeile wie jede andere, mit dem gesehenen Stand", () => {
        const ID_WEG = "00000000-0000-4000-8000-000000000004";
        const weg = (teil: Partial<InhalteVerwendung> = {}): InhalteVerwendung =>
            verwendung({ kind: "path", carrierId: ID_WEG, name: "Reichsstraße 1", subtype: "Strasse", ...teil });

        it("ändern: der Körper trägt `vorher` (die Sicht der Straße), Seiten und Notiz gekürzt; ein Ort daneben trägt keines", () => {
            const start = standAusQuelle(
                quelle([weg({ pages: " 45 ", note: "  ", referenceKind: "erwaehnung" }), verwendung({})]),
            );
            const geaendert = aendereVerwendung(
                aendereVerwendung(start, "path", ID_WEG, { pages: "46" }),
                "place",
                ID_ORT,
                { pages: "9" },
            );
            expect(entwurfAlsKoerper(start, geaendert)?.links).toEqual([
                {
                    op: "update",
                    kind: "path",
                    carrierId: ID_WEG,
                    vorher: { state: "active", referenceKind: "erwaehnung", pages: "45", note: null },
                    referenceKind: "erwaehnung",
                    pages: "46",
                    note: null,
                },
                { op: "update", kind: "place", carrierId: ID_ORT, referenceKind: "erwaehnung", pages: "9", note: null },
            ]);
            expect(zaehleAenderungen(start, geaendert)).toBe(2);
        });

        it("lösen und wieder holen; neu anhängen mit `vorher: null`; eine stille Straße kommt per restore (gleiche Angaben) oder add (andere) zurück", () => {
            const start = standAusQuelle(quelle([weg({})]));
            const geloest = loeseVerwendung(start, "path", ID_WEG);
            expect(geloest.verwendungen[0]?.state).toBe("suppressed");
            expect(entwurfAlsKoerper(start, geloest)?.links).toEqual([
                {
                    op: "remove",
                    kind: "path",
                    carrierId: ID_WEG,
                    vorher: { state: "active", referenceKind: "erwaehnung", pages: "45", note: null },
                },
            ]);
            expect(entwurfAlsKoerper(start, stelleWiederHer(geloest, "path", ID_WEG))).toBeUndefined();

            const neu = haengeAn(
                start,
                ziel({ kind: "path", carrierId: "00000000-0000-4000-8000-000000000005", name: "Alte Straße" }),
                "ergaenzend",
            );
            expect(entwurfAlsKoerper(start, neu)?.links).toEqual([
                {
                    op: "add",
                    kind: "path",
                    carrierId: "00000000-0000-4000-8000-000000000005",
                    vorher: null,
                    referenceKind: "ergaenzend",
                    pages: null,
                    note: null,
                },
            ]);

            const still = standAusQuelle(quelle([weg({ state: "retired", herkunft: "editor" })]));
            const da = stelleWiederHer(still, "path", ID_WEG);
            const vorher = { state: "retired", referenceKind: "erwaehnung", pages: "45", note: null };
            expect(entwurfAlsKoerper(still, da)?.links).toEqual([
                { op: "restore", kind: "path", carrierId: ID_WEG, vorher },
            ]);
            expect(entwurfAlsKoerper(still, aendereVerwendung(da, "path", ID_WEG, { pages: "12" }))?.links).toEqual([
                {
                    op: "add",
                    kind: "path",
                    carrierId: ID_WEG,
                    vorher,
                    referenceKind: "erwaehnung",
                    pages: "12",
                    note: null,
                },
            ]);
        });

        it("ein Abschnitt kommt im Entwurf nicht vor", () => {
            const start = standAusQuelle(quelle([weg({})]));
            expect(Object.keys(start.verwendungen[0]!)).not.toContain("abschnitte");
        });
    });
});

describe("Kreis der Liste", () => {
    it("● aus Legacy oder Wiki, ◐ von der Redaktion, ○ stillgelegt", () => {
        expect(kreisDerQuelle({ herkunft: "legacy", stillgelegt: false })).toBe("voll");
        expect(kreisDerQuelle({ herkunft: "editor", stillgelegt: false })).toBe("halb");
        expect(kreisDerQuelle({ herkunft: "editor", stillgelegt: true })).toBe("leer");
    });
});
