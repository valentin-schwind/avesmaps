import { describe, expect, it } from "vitest";
import type { EditorPathReisen, EditorPathStreet } from "@avesmaps3d/shared";
import {
    fahrtage,
    hatSperrung,
    mitFenster,
    mitMittel,
    reisemittelZeilen,
    TAGE_IM_JAHR,
    uebernahme,
} from "../src/wegeditor/reisemittel";

/**
 * Die Reisemittel im Wege-Fenster (WI-0177, Vorschlag 3): Das Fenster rechnet wie die Wegfindung (Abgleich 2026-10-19). Benannte Fälle:
 * Vorgabe ohne Liste, leere Altliste, Erbe von Haken und Fenster, uneinige Wahl, nur teils angeboten, Fenster über den Jahreswechsel,
 * Schlitten nur im Winter, Sperrzeichen (auch: ein Bach ohne Boote ist keine Sperrung). Ändern (Schritt 3, F16 „A“): Der Karren erbt nach
 * dem Abwählen weiter; das Ausschreiben ändert, was fährt; ein unveränderter Abschnitt wird ausgeschrieben; ein Fenster landet an einem
 * Mittel, das nicht fährt.
 */
type Abschnitt = EditorPathStreet["segments"][number];
const STRASSE = { subtype: "Reichsstrasse", isBach: false } as const;
let n = 0;
const abschnitt = (reisen?: EditorPathReisen, art = "Reichsstrasse"): Abschnitt => ({
    id: `a${++n}`,
    revision: 1,
    labelVisible: true,
    wiki: false,
    points: 2,
    art,
    ...(reisen ? { reisen } : {}),
});
const zeile = (abschnitte: Abschnitt[], mittel: string) =>
    reisemittelZeilen(abschnitte, STRASSE).find((z) => z.mittel === mittel);
const LAND = [
    "groupFoot",
    "lightWalker",
    "groupHorse",
    "lightRider",
    "caravan",
    "cart",
    "wagon",
    "horseCarriage",
    "sleigh",
];
const tag = (monat: number, t: number): number => monat * 30 + t - 1;

describe("Reisemittel je Abschnitt wie die Wegfindung", () => {
    it("ohne gespeicherte Liste: alle Mittel des Wegtyps fahren ganzjährig, keines erbt", () => {
        const zeilen = reisemittelZeilen([abschnitt()], STRASSE);
        expect(zeilen.map((z) => z.mittel)).toEqual(LAND);
        expect(zeilen.every((z) => z.faehrt === true && z.fenster === null && !z.erbt)).toBe(true);
    });

    it("🔴 eine leere Altliste ohne Domäne gilt als Vorgabe, mit Domäne fährt nichts", () => {
        expect(zeile([abschnitt({ liste: [], domaene: null, fenster: {} })], "wagon")?.faehrt).toBe(true);
        expect(zeile([abschnitt({ liste: [], domaene: "land", fenster: {} })], "wagon")?.faehrt).toBe(false);
    });

    it("🔴 Karren und Fuhrwerk erben den Haken der Kutsche, der Schlitten den der Reisegruppe zu Pferd", () => {
        const a = abschnitt({ liste: ["groupFoot", "groupHorse", "horseCarriage"], domaene: "land", fenster: {} });
        expect(zeile([a], "cart")).toMatchObject({ faehrt: true, erbt: true });
        expect(zeile([a], "sleigh")).toMatchObject({ faehrt: true, erbt: true });
        expect(zeile([a], "lightRider")).toMatchObject({ faehrt: false, erbt: false });
        expect(zeile([a], "horseCarriage")).toMatchObject({ faehrt: true, erbt: false });
    });

    it("🔴 ein Fenster ohne eigenes Mittel kommt vom Vorbild", () => {
        const fenster = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 };
        const a = abschnitt({ liste: null, domaene: null, fenster: { horseCarriage: fenster } });
        expect(zeile([a], "horseCarriage")).toMatchObject({ fenster, erbt: false });
        expect(zeile([a], "cart")).toMatchObject({ fenster, erbt: true });
        expect(zeile([a], "groupFoot")?.fenster).toBeNull();
    });

    it("uneinige Wahl: Haken null, verschiedene Fenster undefined", () => {
        const offen = abschnitt();
        const zu = abschnitt({ liste: ["groupFoot"], domaene: "land", fenster: {} });
        expect(zeile([offen, zu], "caravan")?.faehrt).toBeNull();
        expect(zeile([offen, zu], "groupFoot")?.faehrt).toBe(true);
        const sommer = abschnitt({
            liste: null,
            domaene: null,
            fenster: { caravan: { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 } },
        });
        expect(zeile([offen, sommer], "caravan")?.fenster).toBeUndefined();
    });

    it("nur teils angeboten: der Pfad bietet weder Karren noch Fuhrwerk", () => {
        const z = zeile([abschnitt(), abschnitt(undefined, "Pfad")], "cart");
        expect(z).toMatchObject({ angeboten: 1, von: 2, faehrt: true });
    });
});

describe("Fahrtage auf den Tag genau", () => {
    it("🔴 ein Fenster über den Jahreswechsel schließt die Namenlosen Tage ein", () => {
        const tage = fahrtage("caravan", true, { from_month: "rahja", from_day: 20, to_month: "praios", to_day: 10 });
        expect(tage).toHaveLength(TAGE_IM_JAHR);
        expect(tage[tag(11, 19)]).toBe(false);
        expect(tage[tag(11, 20)]).toBe(true);
        expect(tage.slice(360).every(Boolean)).toBe(true);
        expect(tage[tag(0, 10)]).toBe(true);
        expect(tage[tag(0, 11)]).toBe(false);
        expect(tage.filter(Boolean)).toHaveLength(11 + 5 + 10);
    });

    it("ohne Fenster immer, ohne Haken nie", () => {
        expect(fahrtage("caravan", true, null).every(Boolean)).toBe(true);
        expect(fahrtage("caravan", false, null).some(Boolean)).toBe(false);
    });

    it("🔴 der Schlitten fährt nur im Winter (Firun bis Phex), auch ohne Fenster", () => {
        const tage = fahrtage("sleigh", true, null);
        expect(tage.filter(Boolean)).toHaveLength(90);
        expect(tage[tag(6, 1)]).toBe(true);
        expect(tage[tag(8, 30)]).toBe(true);
        expect(tage[tag(5, 30)]).toBe(false);
        expect(tage.slice(360).some(Boolean)).toBe(false);
    });
});

describe("Sperrzeichen an der Nummer", () => {
    it("die Vorgabe ist keine Sperrung, ein fehlendes Mittel oder ein Fenster schon", () => {
        expect(hatSperrung(abschnitt(), STRASSE)).toBe(false);
        expect(
            hatSperrung(
                abschnitt({ liste: LAND.filter((m) => m !== "caravan"), domaene: "land", fenster: {} }),
                STRASSE,
            ),
        ).toBe(true);
        const fenster = { caravan: { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 } };
        expect(hatSperrung(abschnitt({ liste: null, domaene: null, fenster }), STRASSE)).toBe(true);
    });

    it("🔴 ein Bach ohne Boote ist keine Sperrung (F14)", () => {
        const bach = { ...abschnitt({ liste: [], domaene: "river", fenster: {} }, "Flussweg"), bach: true };
        expect(hatSperrung(bach, { subtype: "Flussweg", isBach: true })).toBe(false);
        const fluss = abschnitt({ liste: ["riverSailer"], domaene: "river", fenster: {} }, "Flussweg");
        expect(hatSperrung(fluss, { subtype: "Flussweg", isBach: false })).toBe(true);
    });
});

describe("Ändern (Vorschlag 3 Schritt 3, F16 „A“)", () => {
    const winter = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 };

    it("🔴 der erste Schritt schreibt aus: Karren abwählen bei Kutsche wirkt, Fuhrwerk und geerbtes Fenster bleiben", () => {
        const r: EditorPathReisen = {
            liste: ["groupFoot", "horseCarriage"],
            domaene: "land",
            fenster: { horseCarriage: winter },
        };
        const neu = mitMittel(r, "Strasse", "cart", false);
        expect(neu).toEqual({
            liste: ["groupFoot", "wagon", "horseCarriage"],
            domaene: "land",
            fenster: { wagon: winter, horseCarriage: winter },
            geschrieben: true,
        });
        // Wie die Wegfindung: Der Karren fährt nicht mehr, das Fuhrwerk weiter in seinem Fenster, und nichts erbt.
        const a = abschnitt(neu, "Strasse");
        expect(zeile([a], "cart")).toMatchObject({ faehrt: false, erbt: false });
        expect(zeile([a], "wagon")).toMatchObject({ faehrt: true, fenster: winter, erbt: false });
    });

    it("unverändert bleibt ungeschrieben; ein Mittel, das der Wegtyp nicht anbietet, ändert nichts", () => {
        const r: EditorPathReisen = { liste: null, domaene: null, fenster: {} };
        expect(mitMittel(r, "Strasse", "groupFoot", true)).toBe(r);
        expect(mitMittel(r, "Pfad", "cart", true)).toBe(r);
        expect(mitFenster(r, "Strasse", "groupFoot", null)).toBe(r);
    });

    it("🔴 ein Fenster samt Grund setzen und zurück auf ganzjährig; nur wo das Mittel fährt", () => {
        const r: EditorPathReisen = { liste: ["groupFoot"], domaene: "land", fenster: {} };
        const f = { ...winter, reason: "schneemassen" as const };
        const mitF = mitFenster(r, "Strasse", "groupFoot", f);
        expect(mitF).toEqual({ liste: ["groupFoot"], domaene: "land", fenster: { groupFoot: f }, geschrieben: true });
        expect(mitFenster(mitF, "Strasse", "groupFoot", null).fenster).toEqual({});
        expect(mitFenster(r, "Strasse", "caravan", f)).toBe(r);
        // Ohne Haken fällt das Fenster mit weg.
        expect(mitMittel(mitF, "Strasse", "groupFoot", false)).toMatchObject({ liste: [], fenster: {} });
    });
});

/**
 * „Auf alle Abschnitte übernehmen“ (OPS-000112, Entwurf Fassung 2): großer Knopf (alle Zeilen) und kleiner Knopf (eine Zeile). Benannte
 * Fälle: Die übrigen Abschnitte fahren danach wie der gewählte; uneins und „fahren schon so“ sperren; ein Zeitfenster samt Grund geht mit;
 * der kleine Knopf ändert nur seine Zeile (ein geerbtes Mittel fährt weiter wie vorher); ein Wegtyp ohne das Mittel bleibt, wie er ist.
 */
describe("Auf alle Abschnitte übernehmen (OPS-000112)", () => {
    const winter = {
        from_month: "peraine",
        from_day: 1,
        to_month: "boron",
        to_day: 30,
        reason: "schneemassen" as const,
    };
    const vorgabe = (): EditorPathReisen => ({ liste: null, domaene: null, fenster: {} });
    const ohneWagen = (): EditorPathReisen => ({
        liste: ["groupFoot", "groupHorse", "caravan"],
        domaene: "land",
        fenster: { groupFoot: winter },
    });
    const zeilenVon = (a: Abschnitt) =>
        reisemittelZeilen([a], STRASSE).map((z) => [z.mittel, z.faehrt, z.fenster ?? null]);
    const mitReisen = (a: Abschnitt, r: Readonly<Record<string, EditorPathReisen>>): Abschnitt => ({
        ...a,
        ...(r[a.id] ? { reisen: r[a.id] } : {}),
    });

    it("🔴 großer Knopf: alle Abschnitte fahren danach wie der gewählte, der gewählte selbst bleibt unberührt", () => {
        const [a, b, c] = [
            abschnitt(vorgabe(), "Strasse"),
            abschnitt(ohneWagen(), "Strasse"),
            abschnitt(vorgabe(), "Strasse"),
        ];
        const e = uebernahme([a, b, c], [b.id], STRASSE);
        if (e.art !== "geht") throw new Error(e.art);
        expect(e.geaendert).toEqual([a.id, c.id]);
        expect(e.reisen[b.id]).toBeUndefined();
        for (const x of [a, c]) expect(zeilenVon(mitReisen(x, e.reisen))).toEqual(zeilenVon(b));
        // Danach fahren alle schon so.
        expect(
            uebernahme(
                [a, b, c].map((x) => mitReisen(x, e.reisen)),
                [b.id],
                STRASSE,
            ),
        ).toEqual({ art: "schon" });
    });

    it("uneins sperrt den großen Knopf; der kleine einer einigen Zeile geht trotzdem", () => {
        const [a, b, c] = [
            abschnitt(vorgabe(), "Strasse"),
            abschnitt(ohneWagen(), "Strasse"),
            abschnitt(vorgabe(), "Strasse"),
        ];
        expect(uebernahme([a, b, c], [a.id, b.id], STRASSE)).toEqual({ art: "uneins" });
        // Zu Fuß fährt an beiden, aber mit verschiedenem Fenster: uneins. Reisegruppe zu Pferd fährt an beiden ganzjährig: einig.
        expect(uebernahme([a, b, c], [a.id, b.id], STRASSE, "groupFoot")).toEqual({ art: "uneins" });
        expect(uebernahme([a, b, c], [a.id, b.id], STRASSE, "groupHorse")).toEqual({ art: "schon" });
        expect(uebernahme([a, b, c], [a.id, b.id], STRASSE, "caravan")).toEqual({ art: "schon" });
    });

    it("🔴 das Zeitfenster samt Grund geht mit, ganzjährig nimmt eines weg", () => {
        const [a, b] = [abschnitt(vorgabe(), "Strasse"), abschnitt(ohneWagen(), "Strasse")];
        const hin = uebernahme([a, b], [b.id], STRASSE, "groupFoot");
        if (hin.art !== "geht") throw new Error(hin.art);
        expect(hin.reisen[a.id]?.fenster).toEqual({ groupFoot: winter });
        const her = uebernahme([a, b], [a.id], STRASSE, "groupFoot");
        if (her.art !== "geht") throw new Error(her.art);
        expect(her.geaendert).toEqual([b.id]);
        expect(her.reisen[b.id]?.fenster).toEqual({});
    });

    it("🔴 der kleine Knopf ändert nur seine Zeile: Kutsche aus, der geerbte Karren fährt weiter wie vorher", () => {
        const aus: EditorPathReisen = { liste: ["groupFoot"], domaene: "land", fenster: {}, geschrieben: true };
        const erbt: EditorPathReisen = { liste: ["groupFoot", "horseCarriage"], domaene: "land", fenster: {} };
        const [a, b] = [abschnitt(aus, "Strasse"), abschnitt(erbt, "Strasse")];
        expect(zeile([b], "cart")).toMatchObject({ faehrt: true, erbt: true });
        const e = uebernahme([a, b], [a.id], STRASSE, "horseCarriage");
        if (e.art !== "geht") throw new Error(e.art);
        const neu = mitReisen(b, e.reisen);
        expect(zeile([neu], "horseCarriage")).toMatchObject({ faehrt: false });
        expect(zeile([neu], "cart")).toMatchObject({ faehrt: true, erbt: false });
        expect(zeile([neu], "groupFoot")).toMatchObject({ faehrt: true });
    });

    it("ein Wegtyp ohne das Mittel bleibt, wie er ist; was er anbietet, geht mit", () => {
        const ohneKarren: EditorPathReisen = { liste: ["groupFoot"], domaene: "land", fenster: {}, geschrieben: true };
        const [a, pfad] = [abschnitt(ohneKarren, "Strasse"), abschnitt(vorgabe(), "Pfad")];
        expect(uebernahme([a, pfad], [a.id], STRASSE, "cart")).toEqual({ art: "schon" });
        const e = uebernahme([a, pfad], [a.id], STRASSE);
        if (e.art !== "geht") throw new Error(e.art);
        const neu = mitReisen(pfad, e.reisen);
        expect(zeile([neu], "groupFoot")).toMatchObject({ faehrt: true });
        expect(zeile([neu], "groupHorse")).toMatchObject({ faehrt: false });
        expect(zeile([neu], "cart")).toBeUndefined();
    });
});
