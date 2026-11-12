import { describe, expect, it } from "vitest";
import type { InhalteWerk, InhalteWerkOrt, InhalteZiel } from "@avesmaps3d/shared";
import {
    aktiveOrte,
    entwurfAlsKoerper,
    haengeNamenAn,
    haengeOrtAn,
    jahrAlsZahl,
    jahrIstZahl,
    kreisDesWerks,
    loeseOrt,
    schalteStart,
    setzeFeld,
    setzeRolle,
    standAusWerk,
    stelleOrtWiederHer,
    verschiebeOrt,
    zaehleAenderungen,
} from "../src/inhalte/inhalte-literatur-modell.ts";

/**
 * Die Entwurfsrechnung des Reiters „Literatur“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 2): was „Speichern“ aus dem Unterschied
 * zwischen dem Stand des Servers und dem Entwurf macht. Dass der Server den Körper annimmt, belegt `apps/server/test/inhalte-literatur.test.ts`;
 * hier steht nur die reine Rechnung.
 */
const ort = (n: number, teil: Partial<InhalteWerkOrt> = {}): InhalteWerkOrt => ({
    rowId: String(n),
    role: "play",
    targetState: "resolved",
    kind: "place",
    carrierId: `00000000-0000-4000-8000-00000000000${String(n)}`,
    name: `Ort ${String(n)}`,
    state: "active",
    ursprung: "legacy",
    herkunft: "legacy",
    ...teil,
});

const werk = (orte: InhalteWerkOrt[] = [ort(1), ort(2), ort(3)], teil: Partial<InhalteWerk> = {}): InhalteWerk => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    revision: 4,
    title: "Siegelbruch",
    productType: "gruppenabenteuer",
    edition: "DSA5",
    series: null,
    bfYear: 1044,
    bfLabel: null,
    genre: "Abenteuer",
    isOfficial: true,
    editorNote: null,
    ursprung: "legacy",
    herkunft: "legacy",
    aktiv: true,
    feldUrsprung: {},
    cover: { gebunden: false },
    orte,
    ...teil,
});

const ziel = (n: number, teil: Partial<InhalteZiel> = {}): InhalteZiel => ({
    kind: "territory",
    carrierId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    name: `Gebiet ${String(n)}`,
    ...teil,
});

const namen = (stand: ReturnType<typeof standAusWerk>): string[] => aktiveOrte(stand).map((o) => o.name);

describe("Stand und Körper", () => {
    it("ein unveränderter Entwurf hat keinen Körper und keine Änderung", () => {
        const start = standAusWerk(werk());
        expect(entwurfAlsKoerper(start, start)).toBeUndefined();
        expect(zaehleAenderungen(start, start)).toBe(0);
    });

    it("🔴 nur geänderte Felder gehen in den Körper; Leeres wird zu null, das Jahr zur Zahl", () => {
        const start = standAusWerk(werk());
        let jetzt = setzeFeld(start, "title", "Siegelbruch, neu");
        jetzt = setzeFeld(jetzt, "genre", "   ");
        jetzt = setzeFeld(jetzt, "edition", "");
        jetzt = setzeFeld(jetzt, "bfYear", "1050");
        jetzt = setzeFeld(jetzt, "editorNote", "  Orte folgen der Handlung ");
        expect(entwurfAlsKoerper(start, jetzt)).toEqual({
            fields: {
                title: "Siegelbruch, neu",
                genre: null,
                edition: null,
                bfYear: 1050,
                editorNote: "Orte folgen der Handlung",
            },
        });
        expect(zaehleAenderungen(start, jetzt)).toBe(5);
    });

    it("ein Jahr nimmt nur Ziffern, höchstens vier; leer heißt unbekannt", () => {
        const start = standAusWerk(werk());
        expect(setzeFeld(start, "bfYear", "10x4")).toBe(start);
        expect(setzeFeld(start, "bfYear", "10441")).toBe(start);
        const leer = setzeFeld(start, "bfYear", "");
        expect(entwurfAlsKoerper(start, leer)).toEqual({ fields: { bfYear: null } });
        expect(jahrAlsZahl("")).toBeNull();
        expect(jahrAlsZahl("0998")).toBe(998);
        expect(jahrAlsZahl("abc")).toBeUndefined();
        expect(jahrIstZahl("1044")).toBe(true);
        expect(jahrIstZahl("Praios 1040")).toBe(false);
    });

    it("eine Änderung und ihr Zurücksetzen auf den alten Wert ist keine Änderung", () => {
        const start = standAusWerk(werk());
        const hin = setzeFeld(start, "isOfficial", false);
        expect(zaehleAenderungen(start, hin)).toBe(1);
        expect(entwurfAlsKoerper(start, setzeFeld(hin, "isOfficial", true))).toBeUndefined();
    });

    it("Unterdrücken und Zurückholen ist das Feld aktiv", () => {
        const start = standAusWerk(werk());
        expect(entwurfAlsKoerper(start, setzeFeld(start, "aktiv", false))).toEqual({ fields: { aktiv: false } });
    });

    it("🔴 der Kreis der Liste: ● aus Legacy oder Wiki, ◐ von der Redaktion, ○ unterdrückt", () => {
        expect(kreisDesWerks({ herkunft: "legacy", stillgelegt: false })).toBe("voll");
        expect(kreisDesWerks({ herkunft: "editor", stillgelegt: false })).toBe("halb");
        expect(kreisDesWerks({ herkunft: "editor", stillgelegt: true })).toBe("leer");
    });
});

describe("Die Ortsliste", () => {
    it("🔴 eine neue Zeile hängt hinten an; der Körper ist die GANZE aktive Liste in der gewollten Folge", () => {
        const start = standAusWerk(werk());
        const mit = haengeOrtAn(start, ziel(1), "start");
        expect(namen(mit)).toEqual(["Ort 1", "Ort 2", "Ort 3", "Gebiet 1"]);
        expect(entwurfAlsKoerper(start, mit)).toEqual({
            orte: [
                { rowId: "1", role: "play" },
                { rowId: "2", role: "play" },
                { rowId: "3", role: "play" },
                { kind: "territory", carrierId: ziel(1).carrierId, role: "start" },
            ],
        });
        expect(zaehleAenderungen(start, mit)).toBe(1);
    });

    it("dasselbe Ziel in derselben Rolle steht nur einmal, in einer anderen Rolle darf es noch einmal stehen", () => {
        const start = standAusWerk(werk());
        const eins = haengeOrtAn(start, ziel(1), "play");
        expect(haengeOrtAn(eins, ziel(1), "play")).toBe(eins);
        expect(namen(haengeOrtAn(eins, ziel(1), "start"))).toHaveLength(5);
        // Ein vorhandener Ort des Servers (Ort 1) in derselben Rolle: nichts Neues.
        const vorhanden = ort(1);
        expect(
            haengeOrtAn(
                start,
                { kind: "place", carrierId: vorhanden.carrierId as string, name: vorhanden.name },
                "play",
            ),
        ).toBe(start);
    });

    it("🔴 ein ungeklärter Name steht ohne Ziel da und geht als rawName; ein leerer Name nicht", () => {
        const start = standAusWerk(werk([]));
        expect(haengeNamenAn(start, "   ", "play")).toBe(start);
        const mit = haengeNamenAn(start, " Ein Dorf im Norden ", "covers");
        expect(entwurfAlsKoerper(start, mit)).toEqual({ orte: [{ rawName: "Ein Dorf im Norden", role: "covers" }] });
        expect(haengeNamenAn(mit, "ein dorf im norden", "covers")).toBe(mit);
        expect(aktiveOrte(mit)[0]).toMatchObject({ targetState: "unresolved", kind: undefined, carrierId: undefined });
    });

    it("🔴 ▲ ▼ ordnen unter den AKTIVEN Zeilen; eine stille dazwischen bleibt, wo sie steht", () => {
        const start = standAusWerk(werk([ort(1), ort(2, { state: "retired" }), ort(3)]));
        const hoch = verschiebeOrt(start, "3", -1);
        expect(aktiveOrte(hoch).map((o) => o.rowId)).toEqual(["3", "1"]);
        expect(hoch.orte.map((o) => o.rowId)).toEqual(["3", "2", "1"]);
        expect(verschiebeOrt(start, "1", -1)).toBe(start);
        expect(verschiebeOrt(start, "3", 1)).toBe(start);
        expect(verschiebeOrt(start, "2", 1)).toBe(start);
        expect(entwurfAlsKoerper(start, hoch)).toEqual({
            orte: [
                { rowId: "3", role: "play" },
                { rowId: "1", role: "play" },
            ],
        });
        expect(zaehleAenderungen(start, hoch)).toBe(1);
        // Hoch und wieder runter: dieselbe Liste, nichts zu speichern.
        expect(entwurfAlsKoerper(start, verschiebeOrt(hoch, "3", 1))).toBeUndefined();
    });

    it("★ macht eine Zeile zum Startort und gibt ihr beim zweiten Mal die Rolle davor zurück", () => {
        const start = standAusWerk(werk([ort(1, { role: "covers" }), ort(2)]));
        const star = schalteStart(start, "1");
        expect(aktiveOrte(star)[0]?.role).toBe("start");
        expect(entwurfAlsKoerper(start, star)).toEqual({
            orte: [
                { rowId: "1", role: "start" },
                { rowId: "2", role: "play" },
            ],
        });
        const zurueck = schalteStart(star, "1");
        expect(aktiveOrte(zurueck)[0]?.role).toBe("covers");
        expect(entwurfAlsKoerper(start, zurueck)).toBeUndefined();
        // Mehrere Startorte sind möglich.
        expect(aktiveOrte(schalteStart(star, "2")).map((o) => o.role)).toEqual(["start", "start"]);
        expect(setzeRolle(start, "2", "play")).toBe(start);
        expect(aktiveOrte(setzeRolle(start, "2", "covers"))[1]?.role).toBe("covers");
    });

    it("🔴 Lösen: eine neue Zeile verschwindet ganz; eine aus Legacy wird unterdrückt, eine eigene gelöst; ↺ holt sie ans Ende zurück", () => {
        const start = standAusWerk(werk([ort(1), ort(2, { herkunft: "editor", ursprung: "manual" }), ort(3)]));
        const ohneEins = loeseOrt(start, "1");
        const ohneZwei = loeseOrt(ohneEins, "2");
        expect(ohneZwei.orte.map((o) => o.state)).toEqual(["suppressed", "retired", "active"]);
        expect(entwurfAlsKoerper(start, ohneZwei)).toEqual({ orte: [{ rowId: "3", role: "play" }] });
        expect(zaehleAenderungen(start, ohneZwei)).toBe(2);
        const zurueck = stelleOrtWiederHer(ohneEins, "1");
        expect(zurueck.orte.map((o) => o.rowId)).toEqual(["2", "3", "1"]);
        expect(entwurfAlsKoerper(start, zurueck)).toEqual({
            orte: [
                { rowId: "2", role: "play" },
                { rowId: "3", role: "play" },
                { rowId: "1", role: "play" },
            ],
        });
        // Eine im Entwurf angehängte Zeile, gleich wieder gelöst: nichts zu speichern.
        const neu = haengeOrtAn(start, ziel(5), "play");
        const neuKey = aktiveOrte(neu).at(-1)!.schluessel;
        expect(entwurfAlsKoerper(start, loeseOrt(neu, neuKey))).toBeUndefined();
    });

    it("eine stille Zeile desselben Ziels in derselben Rolle kommt beim Anhängen zurück, am Ende", () => {
        const start = standAusWerk(werk([ort(1, { state: "retired", herkunft: "editor" }), ort(2)]));
        const eins = ort(1);
        const mit = haengeOrtAn(start, { kind: "place", carrierId: eins.carrierId as string, name: eins.name }, "play");
        expect(mit.orte.map((o) => [o.rowId, o.state])).toEqual([
            ["2", "active"],
            ["1", "active"],
        ]);
        expect(entwurfAlsKoerper(start, mit)).toEqual({
            orte: [
                { rowId: "2", role: "play" },
                { rowId: "1", role: "play" },
            ],
        });
    });

    it("🔴 ein Weg (Ankersegment) steht lesend in der Liste und geht mit seiner rowId, nie als neues Ziel", () => {
        const weg = ort(7, { kind: "path", name: "Reichsstraße" });
        const start = standAusWerk(werk([weg, ort(1)]));
        const hoch = verschiebeOrt(start, "1", -1);
        expect(entwurfAlsKoerper(start, hoch)).toEqual({
            orte: [
                { rowId: "1", role: "play" },
                { rowId: "7", role: "play" },
            ],
        });
    });
});
