import { describe, expect, it } from "vitest";
import {
    AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS as DEFAULTS,
    DISPLAY_SIZE_BANDS,
    LandscapeDisplayError,
    effectiveLandscapeDisplay,
    parseLandscapeDisplayResponse,
} from "../src/index.ts";

/**
 * Die wirksame Darstellungstafel der Landschaften (WI-0064): Vorgaben aus Legacys Code plus Uebersteuerungen aus dem
 * Endpunkt, in der Reihenfolge, in der Legacys eigener Code sie aufloest.
 *
 * 💣 Die Faelle sind so gewaehlt, dass eine Vertauschung der Reihenfolge auffaellt: eine Uebersteuerung, die die Vorgabe der
 * Art schlagen muss (wald ab 5 gegen 4), eine Art, die nur in der Uebersteuerung steht (dschungel), eine, die nur in den
 * Vorgaben steht (gebirge), und eine ohne beides (tundra), die die Grundvorgabe erbt.
 */

function antwort(display: unknown, stamp = "1788310790"): unknown {
    return { ok: true, display, stamp };
}

function wirksam(display: unknown, stamp?: string) {
    return effectiveLandscapeDisplay(DEFAULTS, parseLandscapeDisplayResponse(antwort(display, stamp)));
}

describe("Vorgaben aus Legacys Code (erzeugte Datei)", () => {
    it("tragen Herkunft mit Commit und Blob und neun Schriftgroessen je Band", () => {
        expect(DEFAULTS.source.file).toBe("js/map-features/ecosystem-display.js");
        expect(DEFAULTS.source.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(DEFAULTS.source.blob).toMatch(/^[0-9a-f]{40}$/);
        expect(DEFAULTS.sizeByBand).toHaveLength(DISPLAY_SIZE_BANDS);
    });

    it("kennen die Grundvorgabe und die Ausnahmen der Arten, wie Legacy sie schreibt", () => {
        expect(DEFAULTS.base).toEqual({ ab: 0, bis: 7, curveMax: 1, prio: 3 });
        expect(DEFAULTS.perArt["gebirge"]).toEqual({ ab: 2 });
        expect(DEFAULTS.perArt["kontinent"]).toEqual({ bis: 3 });
    });
});

describe("wirksame Tafel: ohne Uebersteuerung gelten die Vorgaben", () => {
    const tafel = wirksam(null);

    it("eine Art mit eigener Vorgabezeile nimmt sie, der Rest kommt aus der Grundvorgabe", () => {
        expect(tafel.arts["gebirge"]).toMatchObject({ ab: 2, bis: 7, curveMax: 1, prio: 3 });
        expect(tafel.arts["kontinent"]).toMatchObject({ ab: 0, bis: 3 });
    });

    it("die Schriftgroesse ist die Vorgabekurve (Legacys Formel, ausgefuehrt), nicht eine Zeile einer Nachbarart", () => {
        expect(tafel.arts["wald"]?.size).toEqual(DEFAULTS.sizeByBand);
        expect(tafel.base.size).toEqual(DEFAULTS.sizeByBand);
    });

    it("Gipfel und Vulkane sind fest, alles andere beweglich (Owner-Entscheid 02.09.2026)", () => {
        expect(tafel.arts["berggipfel"]?.collision).toEqual({ teil: true, fest: true });
        expect(tafel.arts["wald"]?.collision).toEqual({ teil: true, fest: false });
    });

    it("eine Art ohne jede Zeile hat keine Tabellenzeile: sie erbt die Grundvorgabe bei der Anwendung", () => {
        expect(tafel.arts["tundra"]).toBeUndefined();
        expect(tafel.base).toMatchObject({ ab: 0, bis: 7, curveMax: 1, prio: 3 });
    });

    it("Deckkraft und Abstaende sind Legacys Vorgaben, wirksam gemeldet, nie angewendet", () => {
        expect(tafel.notApplied.layerOpacity["klima"]).toBe(0.3);
        expect(tafel.notApplied.spacing).toEqual({ repel: 2, versatz: 8, drift: 72 });
    });
});

describe("wirksame Tafel: die Uebersteuerung schlaegt die Vorgabe", () => {
    it("🔴 wald ab 5 schlaegt die Vorgabe ab 4, bis kommt weiter aus der Grundvorgabe", () => {
        const tafel = wirksam({ version: 1, vorgabe: { wald: { ab: 5 } } });
        expect(tafel.arts["wald"]).toMatchObject({ ab: 5, bis: 7, curveMax: 1, prio: 3 });
    });

    it("eine Art, die nur die Uebersteuerung nennt (dschungel), bekommt eine Zeile aus Uebersteuerung und Grundvorgabe", () => {
        const tafel = wirksam({ version: 1, vorgabe: { dschungel: { ab: 3, bis: 6 } } });
        expect(tafel.arts["dschungel"]).toMatchObject({ ab: 3, bis: 6, curveMax: 1, prio: 3 });
    });

    it("eine Groessenzeile ersetzt die Vorgabekurve; eine Luecke faellt fuer ihr Band zurueck, nicht die ganze Zeile", () => {
        const kurz = wirksam({ version: 1, groesse: { meer: [9, 11, 17] } }).arts["meer"]?.size;
        expect(kurz).toEqual([9, 11, 17, ...DEFAULTS.sizeByBand.slice(3)]);
        const voll = wirksam({ version: 1, groesse: { meer: [9, 11, 17, 19, 21, 23, 25, 27, 29] } }).arts["meer"]?.size;
        expect(voll).toEqual([9, 11, 17, 19, 21, 23, 25, 27, 29]);
    });

    it("die Kollisionsrolle wird je Feld aufgeloest: teil und fest einzeln", () => {
        const tafel = wirksam({ version: 1, kollision: { berggipfel: { fest: false }, wald: { teil: false } } });
        expect(tafel.arts["berggipfel"]?.collision).toEqual({ teil: true, fest: false });
        expect(tafel.arts["wald"]?.collision).toEqual({ teil: false, fest: false });
    });

    it("die globale Deckkraft je Ebene gilt nur, wenn sie an ist", () => {
        const an = wirksam({ version: 1, global: { klima: { an: true, wert: 0.5 } } });
        expect(an.notApplied.layerOpacity["klima"]).toBe(0.5);
        const aus = wirksam({ version: 1, global: { klima: { an: false, wert: 0.5 } } });
        expect(aus.notApplied.layerOpacity["klima"]).toBe(0.3);
    });

    it("die Abstaende der Namen: gesetzte Werte gelten, die anderen bleiben Vorgabe", () => {
        const tafel = wirksam({ version: 1, abstaende: { drift: 150, versatz: 2 } });
        expect(tafel.notApplied.spacing).toEqual({ repel: 2, versatz: 2, drift: 150 });
    });

    it("die Arten stehen nach Schluessel geordnet: zwei Laeufe sind gleich", () => {
        const namen = Object.keys(wirksam({ version: 1, vorgabe: { zzz_neu: { ab: 1 } } }).arts);
        expect(namen).toEqual([...namen].sort());
        expect(namen).toContain("zzz_neu");
    });
});

describe("die Antwort lesen", () => {
    it("🔴 ein leerer Stempel ist ein Ausfall, kein 'nichts uebersteuert'", () => {
        // Legacys Endpunkt faellt offen aus: Fehler ergeben `display: null` und `stamp: ''`.
        expect(() => parseLandscapeDisplayResponse(antwort(null, ""))).toThrow(LandscapeDisplayError);
        expect(() => parseLandscapeDisplayResponse({ ok: true, display: null })).toThrow(/Stempel/);
    });

    it("display null MIT Stempel ist Legacys Ruecksetzen: nichts uebersteuert", () => {
        const gelesen = parseLandscapeDisplayResponse(antwort(null));
        expect(gelesen.stamp).toBe("1788310790");
        expect(gelesen.overrides.vorgabe).toEqual({});
    });

    it("verlangt ok, Fassung 1 und ein Objekt", () => {
        expect(() => parseLandscapeDisplayResponse({ ok: false, display: null, stamp: "1" })).toThrow(/ok/);
        expect(() => parseLandscapeDisplayResponse(antwort({ version: 2 }))).toThrow(/version/);
        expect(() => parseLandscapeDisplayResponse(antwort([1, 2, 3]))).toThrow(/Objekt/);
        expect(() => parseLandscapeDisplayResponse("nichts")).toThrow(/Objekt/);
    });

    it("💣 lehnt ab, was Legacys Server beim Speichern ablehnt: Zahlen ausserhalb der Schranken, Texte statt Zahlen", () => {
        const lies = (display: unknown) => () =>
            parseLandscapeDisplayResponse(antwort({ version: 1, ...(display as object) }));
        expect(lies({ vorgabe: { wald: { ab: 9 } } })).toThrow(/vorgabe\.wald\.ab/);
        expect(lies({ vorgabe: { wald: { ab: "4" } } })).toThrow(/vorgabe\.wald\.ab/);
        expect(lies({ vorgabe: { wald: { ab: 2.5 } } })).toThrow(/ganze Zahl/);
        expect(lies({ vorgabe: { wald: { tippfehler: 1 } } })).toThrow(/unbekannt/);
        expect(lies({ vorgabe: { "Wald!": { ab: 1 } } })).toThrow(/unzulaessig/);
        expect(lies({ groesse: { wald: [3] } })).toThrow(/ausserhalb 4\.\.30/);
        expect(lies({ groesse: { wald: new Array<number>(10).fill(9) } })).toThrow(/hoechstens 9/);
        expect(lies({ kollision: { wald: { teil: 1 } } })).toThrow(/Wahrheitswert/);
        expect(lies({ abstaende: { versatz: 0 } })).toThrow(/abstaende\.versatz/);
        expect(lies({ abstaende: { drfit: 5 } })).toThrow(/unbekannt/);
        expect(lies({ global: { klima: { wert: 1.5 } } })).toThrow(/ausserhalb 0\.\.1/);
    });

    it("nennt Abschnitte, die es gibt und die wir nicht anwenden, und solche, die wir noch nicht kennen", () => {
        const gelesen = parseLandscapeDisplayResponse(
            antwort({
                version: 1,
                farbe: { urwald: "#afc19a" },
                flaeche: { "vegetation:urwald": "#3f6605" },
                kurve: { trackingPct: 30 },
                neuerAbschnitt: {},
            }),
        );
        expect(gelesen.overrides.unapplied).toEqual({ farbe: 1, flaeche: 1, kurve: 1 });
        expect(gelesen.overrides.unknownSections).toEqual(["neuerAbschnitt"]);
    });
});

describe("Widerspruch zwischen Vorgabe und Uebersteuerung", () => {
    it("🔴 ein Band, das vor seinem Anfang endet, bricht ab und nennt die Art - 'aus' ist bis = -1", () => {
        // kontinent traegt in der Vorgabe bis 3; setzt jemand nur ab 5, endet das Band vor seinem Anfang.
        expect(() => wirksam({ version: 1, vorgabe: { kontinent: { ab: 5 } } })).toThrow(/kontinent.*widerspruechlich/);
    });

    it("'aus' (bis = -1) ist ein gueltiger Zustand", () => {
        const tafel = wirksam({ version: 1, vorgabe: { wald: { bis: -1 } } });
        expect(tafel.arts["wald"]).toMatchObject({ ab: 4, bis: -1 });
    });
});
