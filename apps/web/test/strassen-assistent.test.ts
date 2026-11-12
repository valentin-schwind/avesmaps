import { describe, expect, it } from "vitest";
import {
    STRASSEN_ASSISTENT_MAX,
    type StrasseStreckeAntwort,
    type StrassenAbschnitt,
    type StrassenOrt,
} from "@avesmaps3d/shared";
import {
    abseitsRahmen,
    befundeVon,
    fuegeOrtEin,
    neueWahl,
    rahmenVon,
    rechneAssistent,
    verschiebeOrt,
    zuweisenBody,
    zuweisenGrund,
    type AssistentEingabe,
} from "../src/wegeditor/strassen-assistent";

/**
 * Der Straßen-Assistent im Wegeditor (WI-0310): die Rechnung hinter dem Fenster. Problemfälle: Ein fertiger Abschnitt wird mitgeschrieben; ein
 * Abschnitt einer anderen Straße (⇄) wird ungefragt umbenannt; ein Abschnitt ohne Haken zählt trotzdem; „Zuweisen würde schreiben“ nennt
 * andere Zahlen, als der Körper schickt; ein neuer Ort landet am Ende statt an der Stelle mit dem kleinsten Umweg; ein Ort steht zweimal in
 * der Liste; ein Griff oder ein leerer Name geht durch; mehr Abschnitte als EINE Operation nimmt.
 */
const u = (n: number): string => `a0a0a0a0-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORT = (n: number, x: number, y: number, name = `Ort ${String(n)}`): StrassenOrt => ({
    id: u(900 + n),
    name,
    x,
    y,
});

function abschnitt(n: number, teil: Partial<StrassenAbschnitt> = {}): StrassenAbschnitt {
    return {
        id: u(n),
        revision: n + 10,
        name: "Halwartsstieg",
        subtype: "Weg",
        laenge: 10,
        zustand: "fertig",
        wiki: { key: "halwartsstieg", name: "Halwartsstieg" },
        quellen: 2,
        coordinates: [
            [n, n],
            [n + 4, n + 2],
        ],
        ...teil,
    };
}

/** Drei Orte, zwei Paare: Paar 1 hat fertig(1) + ohne Artikel(2) + Lücke(3); Paar 2 hat eine andere Straße(4) + Lücke(5). Abseits: 6. */
function antwort(teil: Partial<StrasseStreckeAntwort> = {}): StrasseStreckeAntwort {
    const abschnitte: Record<string, StrassenAbschnitt> = {};
    for (const a of [
        abschnitt(1),
        abschnitt(2, { zustand: "artikel", wiki: null }),
        abschnitt(3, { zustand: "name", name: "Weg-3443", wiki: null, quellen: 0 }),
        abschnitt(4, { zustand: "fremd", name: "Reichsstraße 3", subtype: "Reichsstrasse", wiki: null, quellen: 0 }),
        abschnitt(5, { zustand: "name", name: "", wiki: null, quellen: 1 }),
        abschnitt(6, { zustand: "fertig" }),
    ])
        abschnitte[a.id] = a;
    return {
        artikel: {
            key: "halwartsstieg",
            name: "Halwartsstieg",
            url: "https://wiki/Halwartsstieg",
            verlauf: "A → B → C",
        },
        name: "Halwartsstieg",
        orte: [ORT(1, 0, 0), ORT(2, 10, 0), ORT(3, 20, 0)],
        unbekannt: [],
        teile: [
            { von: u(901), nach: u(902), laenge: 30, umweg: 1.1, abschnitte: [u(1), u(2), u(3)] },
            { von: u(902), nach: u(903), laenge: 20, umweg: 1.2, abschnitte: [u(4), u(5)] },
        ],
        abschnitte,
        abseits: [u(6)],
        vorschlaege: [ORT(4, 30, 5)],
        quellen: [
            { id: "q1", titel: "Quelle eins" },
            { id: "q2", titel: "Quelle zwei" },
        ],
        ...teil,
    };
}

const eingabe = (teil: Partial<AssistentEingabe> = {}): AssistentEingabe => ({
    antwort: antwort(),
    name: "Halwartsstieg",
    key: "halwartsstieg",
    wahl: neueWahl(),
    ...teil,
});

describe("Was geändert würde", () => {
    it("🔴 fertige ändern nichts; ohne Haken auch kein ⇄; alles andere ist angehakt", () => {
        const m = rechneAssistent(eingabe());
        expect([...m.geaendert].sort()).toEqual([u(2), u(3), u(5)].sort());
        expect(m.zustand[u(1)]).toBe("fertig");
        expect(m.zustand[u(4)]).toBe("fremd");
    });

    it("ein Haken bei ⇄ nimmt den Abschnitt mit, ein Haken weg lässt einen aus", () => {
        const wahl = { ...neueWahl(), rein: new Set([u(4)]), aus: new Set([u(3)]) };
        const m = rechneAssistent(eingabe({ wahl }));
        expect([...m.geaendert].sort()).toEqual([u(2), u(4), u(5)].sort());
    });

    it("die Strecke steht in Fahrtfolge, jeder Abschnitt einmal", () => {
        const a = antwort({
            teile: [
                { von: u(901), nach: u(902), laenge: 30, umweg: 1, abschnitte: [u(1), u(2)] },
                { von: u(902), nach: u(903), laenge: 20, umweg: 1, abschnitte: [u(2), u(3)] },
            ],
        });
        expect(rechneAssistent(eingabe({ antwort: a })).strecke).toEqual([u(1), u(2), u(3)]);
    });

    it("wechselt der Name, rechnet die Oberfläche den Zustand neu: Name und Artikel gelten für den Namen im Feld", () => {
        const m = rechneAssistent(eingabe({ name: "Neuer Stieg" }));
        // 1 hieß „Halwartsstieg“ und ist nun eine andere Straße, 2 (gleicher Name) ebenso; 3 hat einen Griff, 5 gar nichts.
        expect(m.zustand[u(1)]).toBe("fremd");
        expect(m.zustand[u(3)]).toBe("name");
        expect(m.zustand[u(5)]).toBe("name");
        expect([...m.geaendert].sort()).toEqual([u(3), u(5)].sort());
    });

    it("ohne Artikel ist ein Abschnitt mit dem Namen fertig, auch wenn ihm der Artikel fehlt", () => {
        const m = rechneAssistent(eingabe({ key: null }));
        expect(m.zustand[u(2)]).toBe("fertig");
        expect([...m.geaendert].sort()).toEqual([u(3), u(5)].sort());
    });
});

describe("Zuweisen würde schreiben", () => {
    it("🔴 je Punkt eine Zahl, und der Körper schickt genau diese Abschnitte", () => {
        const e = eingabe();
        const m = rechneAssistent(e);
        expect(m.schreibt).toMatchObject({ name: 2, artikel: 3, quellen: 2, abseits: 0, abschnitte: 3 });
        const body = zuweisenBody(m, e, "op-1");
        expect(body.sections.map((s) => s.publicId).sort()).toEqual([u(2), u(3), u(5)].sort());
        expect(body.entfernen).toEqual([]);
        expect(body.sections.find((s) => s.publicId === u(2))).toEqual({ publicId: u(2), baseRevision: 12 });
    });

    it("die Namen zählen nur, wo der Name wirklich wechselt (2 heißt schon so)", () => {
        expect(rechneAssistent(eingabe()).schreibt.name).toBe(2);
    });

    it("Quellen nur mit Haken und nur, wo welche fehlen; die Straße ohne Quellen schreibt keine", () => {
        expect(rechneAssistent(eingabe({ wahl: { ...neueWahl(), quellen: false } })).schreibt.quellen).toBe(0);
        const e = eingabe({ antwort: antwort({ quellen: [] }) });
        const ohne = rechneAssistent(e);
        expect(ohne.schreibt.quellen).toBe(0);
        expect(zuweisenBody(ohne, e, "op").quellen).toBe(false);
    });

    it("ein anderer Artikel an einem Abschnitt geht in den Verlauf: die Vorschau sagt es", () => {
        const a = antwort();
        a.abschnitte[u(2)] = abschnitt(2, { zustand: "artikel", wiki: { key: "anderer", name: "Anderer" } });
        expect(rechneAssistent(eingabe({ antwort: a })).schreibt.artikelErsetzt).toBe(true);
        expect(rechneAssistent(eingabe()).schreibt.artikelErsetzt).toBe(false);
    });

    it("abseits entfernen: Namen und Artikel verlieren die Abschnitte abseits, sie stehen im Körper unter entfernen", () => {
        const e = eingabe({ wahl: { ...neueWahl(), abseits: "entfernen" } });
        const m = rechneAssistent(e);
        expect(m.schreibt.abseits).toBe(1);
        expect(m.schreibt.abschnitte).toBe(4);
        expect(zuweisenBody(m, e, "op").entfernen).toEqual([{ publicId: u(6), baseRevision: 16 }]);
        expect(zuweisenBody(rechneAssistent(eingabe()), eingabe(), "op").entfernen).toEqual([]);
    });

    it("ohne Artikel schickt der Körper key null und zählt keine Artikel", () => {
        const e = eingabe({ key: null });
        const m = rechneAssistent(e);
        expect(m.schreibt.artikel).toBe(0);
        expect(zuweisenBody(m, e, "op").key).toBeNull();
    });

    it("der Name geht getrimmt in den Körper", () => {
        const e = eingabe({ name: "  Halwartsstieg " });
        expect(zuweisenBody(rechneAssistent(e), e, "op").name).toBe("Halwartsstieg");
    });
});

describe("Warum „Zuweisen“ gesperrt ist", () => {
    const grund = (e: AssistentEingabe, darf = true, laedt = false, laeuft = false) =>
        zuweisenGrund(rechneAssistent(e), e, { darf, laedt, laeuft });

    it("frei, wenn es etwas zu schreiben gibt", () => {
        expect(grund(eingabe())).toBeUndefined();
    });
    it("ohne Recht, beim Lesen und beim Schreiben", () => {
        expect(grund(eingabe(), false)).toBe("recht");
        expect(grund(eingabe(), true, true)).toBe("laedt");
        expect(grund(eingabe(), true, false, true)).toBe("laeuft");
    });
    it("ohne Namen und mit einem Griff als Namen", () => {
        expect(grund(eingabe({ name: "  " }))).toBe("kein-name");
        expect(grund(eingabe({ name: "Weg-3443" }))).toBe("griff");
        expect(grund(eingabe({ name: "Weg" }))).toBe("griff");
    });
    it("nichts zu tun, wenn alles fertig ist", () => {
        const e = eingabe({ wahl: { ...neueWahl(), aus: new Set([u(2), u(3), u(5)]) } });
        expect(grund(e)).toBe("nichts");
    });
    it("mehr als EINE Operation nimmt", () => {
        const a = antwort();
        const viele: StrassenAbschnitt[] = Array.from({ length: STRASSEN_ASSISTENT_MAX + 1 }, (_, i) =>
            abschnitt(1000 + i, { zustand: "name", name: "", wiki: null }),
        );
        for (const v of viele) a.abschnitte[v.id] = v;
        a.teile = [{ von: u(901), nach: u(902), laenge: 1, umweg: 1, abschnitte: viele.map((v) => v.id) }];
        expect(grund(eingabe({ antwort: a }))).toBe("zu-viele");
    });
});

describe("Die Orte der Liste", () => {
    const liste = [ORT(1, 0, 0), ORT(2, 10, 0), ORT(3, 20, 0)];

    it("🔴 ein neuer Ort kommt an die Stelle mit dem kleinsten Umweg", () => {
        const r = fuegeOrtEin(liste, ORT(4, 12, 1));
        expect(r?.stelle).toBe(2);
        expect(r?.liste.map((o) => o.id)).toEqual([u(901), u(902), u(904), u(903)]);
    });
    it("ein Ort vor dem Anfang oder hinter dem Ende wird Anfang oder Ende", () => {
        expect(fuegeOrtEin(liste, ORT(4, -5, 0))?.stelle).toBe(0);
        expect(fuegeOrtEin(liste, ORT(4, 40, 0))?.stelle).toBe(3);
    });
    it("🪤 ein Ort, der schon in der Liste steht, kommt nicht noch einmal hinein", () => {
        expect(fuegeOrtEin(liste, ORT(2, 10, 0))).toBeUndefined();
    });
    it("in die leere Liste", () => {
        expect(fuegeOrtEin([], ORT(1, 0, 0))?.liste).toHaveLength(1);
    });
    it("Verschieben ändert die Eingabe nicht und kennt die Grenzen", () => {
        expect(verschiebeOrt(liste, 0, 2).map((o) => o.id)).toEqual([u(902), u(903), u(901)]);
        expect(verschiebeOrt(liste, 0, 0)).toBe(liste);
        expect(verschiebeOrt(liste, 0, 7)).toBe(liste);
        expect(liste[0]?.id).toBe(u(901));
    });
});

describe("Die Befunde je Ortspaar", () => {
    it("ein gutes Paar ohne ⇄ und ohne Umweg macht keinen Befund, nur das Ganze: alles fertig", () => {
        const a = antwort();
        for (const id of Object.keys(a.abschnitte)) a.abschnitte[id] = abschnitt(Number(id.slice(-3)));
        a.teile = [{ von: u(901), nach: u(902), laenge: 30, umweg: 1.1, abschnitte: [u(1), u(2)] }];
        a.orte = [ORT(1, 0, 0), ORT(2, 10, 0)];
        const e = eingabe({ antwort: a });
        expect(befundeVon(e, rechneAssistent(e)).map((b) => b.art)).toEqual(["fertig"]);
    });
    it("kein Weg, Umweg ab 1,5 und andere Straße", () => {
        const a = antwort();
        a.teile = [
            { von: u(901), nach: u(902), laenge: null, umweg: null, abschnitte: [] },
            { von: u(902), nach: u(903), laenge: 20, umweg: 1.5, abschnitte: [u(4), u(5)] },
        ];
        const e = eingabe({ antwort: a });
        const b = befundeVon(e, rechneAssistent(e));
        expect(b.map((x) => x.art)).toEqual(["kein-weg", "umweg", "fremd"]);
        expect(b[0]).toMatchObject({ von: u(901), nach: u(902) });
        const fremd = b[2];
        expect(fremd?.art === "fremd" && fremd.namen).toEqual(["Reichsstraße 3"]);
    });
    it("knapp unter 1,5 ist noch kein Umweg", () => {
        const a = antwort();
        a.teile = [{ von: u(901), nach: u(902), laenge: 20, umweg: 1.49, abschnitte: [u(2)] }];
        a.orte = [ORT(1, 0, 0), ORT(2, 10, 0)];
        const e = eingabe({ antwort: a });
        expect(befundeVon(e, rechneAssistent(e)).some((x) => x.art === "umweg")).toBe(false);
    });
    it("weniger als zwei Orte, und Namen aus dem Wiki ohne Ort", () => {
        const a = antwort({ orte: [ORT(1, 0, 0)], teile: [], unbekannt: ["Nirgendwo"] });
        const e = eingabe({ antwort: a });
        const b = befundeVon(e, rechneAssistent(e));
        expect(b.map((x) => x.art)).toEqual(["zu-wenig", "unbekannt"]);
    });
});

describe("Rahmen zum Zeigen", () => {
    it("der Kasten um die Linien, ohne Linien keiner", () => {
        const a = antwort();
        expect(rahmenVon([a.abschnitte[u(1)]!, a.abschnitte[u(2)]!])).toEqual([1, 1, 6, 4]);
        expect(rahmenVon([])).toBeUndefined();
    });
    it("abseits: der Kasten um alle Abschnitte abseits", () => {
        expect(abseitsRahmen(antwort())).toEqual([6, 6, 10, 8]);
    });
});
