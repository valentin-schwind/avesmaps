import { describe, expect, it } from "vitest";
import {
    fliessrichtungDemLaufNach,
    fliessrichtungGegeneinander,
    type Fliessrichtung,
    type FlussAbschnitt,
} from "../src/fliessrichtung.ts";

/**
 * Die Fließrichtung „dem Lauf nach“ (OPS-000112, Vali 2026-11-11 „A: in alle Arme“). Die Flüsse sind die der Stage vom 11.11.2026 (nur
 * gelesen): je Abschnitt „Knoten am Anfang, Knoten am Ende, Länge, Richtung“ (f in Zeichenrichtung, r dagegen), die Knoten so verbunden wie im
 * Mockup (Enden näher als 0,05). Ihr heutiger Stand ist stimmig: Wasser läuft an jedem Knoten durch.
 */
const STAGE = {
    Mhanadi:
        "0 1 8.91 f,1 2 9.04 f,2 3 13.37 f,3 4 7.81 f,4 5 3.12 f,6 5 12.39 r,7 6 5.59 r,8 7 1.47 r,9 8 4.15 r,10 9 10.81 r,11 10 1.27 r,12 11 7.91 r,13 12 3.03 r,14 13 5.39 r,15 14 2.08 r,16 15 1.88 r,17 16 9.3 r,18 17 11.76 r,18 19 10.73 f,20 19 9.65 r,21 20 3.05 r,22 21 13.15 r,23 22 12.29 r,23 24 1.64 f,24 25 0.92 f,26 25 20.51 r,27 26 13.27 r,28 27 4.26 r,29 28 1.28 r,30 29 3.45 r,31 30 2.17 r,32 31 2.46 r,33 32 3.36 r,34 33 2.97 r,35 34 3.01 r,36 37 3.11 f,37 38 1.95 f,38 39 2.75 f,38 40 2.08 f,37 41 4.37 f,42 43 1.46 f,34 42 0.97 f,42 44 1.68 f,45 46 3.85 f,36 45 3.45 f,31 36 2.93 f,47 48 0.71 f,49 47 1.67 f,50 49 1.72 f,33 50 2.31 f,51 52 1.77 f,53 51 1.59 f,53 54 3.18 f,51 55 1.61 f,47 56 2.01 f,49 57 4.18 f,58 59 3.34 f,58 60 1.18 f,60 61 1.93 f,60 62 2.11 f,32 63 2.86 f,63 53 3.22 f,50 58 3.18 f",
    Eilabhan:
        "0 1 5.88 f,0 2 2.12 f,2 3 2.9 f,3 4 1.87 f,2 5 4.17 f,3 6 1.91 f,7 8 2.28 f,9 7 8.38 f,10 9 7.51 f,7 11 2.98 f,9 0 5.85 f",
    Bendrom: "0 1 7.92 f,1 2 12.96 f,3 2 13.71 f,4 5 12.74 f,5 6 11.88 f",
    GrosserFluss:
        "0 1 2.13 f,2 0 2.81 f,3 2 2.16 f,4 3 4.54 f,5 4 0.85 f,6 5 7.93 f,7 6 6.32 f,8 7 4.9 f,9 8 1.45 f,10 9 4.83 f,11 10 0.5 f,12 11 6.39 f,13 12 2.07 f,14 13 2.52 f,15 14 0.84 f,16 15 1.13 f,17 16 1.64 f,18 17 1.05 f,19 18 4.1 f,20 19 2.11 f,21 20 1.31 f,22 21 7.09 f,23 22 0.92 f,24 23 3.38 f,25 24 1.43 f,26 27 4.49 f,28 26 2.25 f,29 28 6.23 f,30 29 3.65 f,31 30 3.08 f,32 31 0.67 f,33 32 3.83 f,34 33 1.01 f,35 34 1.91 f,36 35 3.24 f,37 36 6.36 f,38 37 6.38 f,39 38 15.48 f,40 39 0.9 f,41 40 24.05 f,42 41 8.09 f,43 42 8.95 f,44 43 4.8 f,45 44 20.84 f,46 45 1.56 f,47 46 2.65 f,48 47 4.22 f,49 48 6.98 f,50 49 3.54 f,51 50 4.49 f,52 51 4.71 f,53 52 3.48 f,54 55 15.02 f,56 57 7.22 f,57 58 4.25 f,59 60 10.86 f,61 62 5.33 f,27 25 0.63 f",
    Dergel: "0 1 33.66 f,1 2 4.53 f,2 3 11.23 f,3 4 7.55 f,4 5 0.67 f,4 6 15.2 f,6 7 13.44 f,8 9 13.81 f,9 10 11.72 f,10 11 2.66 f",
} as const;

interface Fluss {
    readonly abschnitte: FlussAbschnitt[];
    readonly heute: Record<string, Fliessrichtung>;
}

function fluss(text: string): Fluss {
    const abschnitte: FlussAbschnitt[] = [];
    const heute: Record<string, Fliessrichtung> = {};
    text.split(",").forEach((zeile, i) => {
        const [a, b, l, r] = zeile.split(" ");
        const id = `a${String(i + 1)}`;
        abschnitte.push({ id, knoten: [`k${a!}`, `k${b!}`], laengen: [Number(l)] });
        heute[id] = r === "r" ? "reverse" : "forward";
    });
    return { abschnitte, heute };
}

/** Wie heute bei (W): derselbe gespeicherte Wert an allen Abschnitten. */
const kopiert = (f: Fluss, wert: Fliessrichtung): Record<string, Fliessrichtung> =>
    Object.fromEntries(f.abschnitte.map((a) => [a.id, wert]));
const abweichend = (
    a: Readonly<Record<string, Fliessrichtung>>,
    b: Readonly<Record<string, Fliessrichtung>>,
): string[] => Object.keys(a).filter((id) => b[id] !== undefined && a[id] !== b[id]);

describe("Fließrichtung dem Lauf nach (OPS-000112)", () => {
    it("Regressionsfall Mhanadi: Kopieren dreht 27 Pfeile gegen den Strom, dem Lauf nach stellt alle wieder richtig", () => {
        const m = fluss(STAGE.Mhanadi);
        const kopie = kopiert(m, "forward");
        expect(abweichend(kopie, m.heute)).toHaveLength(27);
        const stau = new Set(fliessrichtungGegeneinander(m.abschnitte, kopie).flat());
        expect(stau.size).toBe(9);
        // Von Abschnitt 1 aus (er stimmt) über den kopierten Stand: alles wieder wie heute, keine Pfeile gegeneinander.
        const lauf = fliessrichtungDemLaufNach(m.abschnitte, "a1", kopie["a1"]!);
        expect(Object.keys(lauf.neu)).toHaveLength(63);
        expect(lauf.neu).toEqual(m.heute);
        expect(fliessrichtungGegeneinander(m.abschnitte, lauf.neu)).toEqual([]);
    });

    it.each([
        ["Mhanadi", "a1"],
        ["Eilabhan", "a9"],
    ] as const)(
        "%s: von jedem Abschnitt aus erreicht der Lauf alle Arme und trifft den stimmigen Stand",
        (name, oberster) => {
            const f = fluss(STAGE[name]);
            for (const a of f.abschnitte) {
                const lauf = fliessrichtungDemLaufNach(f.abschnitte, a.id, f.heute[a.id]!);
                expect(abweichend(lauf.neu, f.heute), `Start ${a.id}`).toEqual([]);
                expect(lauf.unterbrochen, `Start ${a.id}`).toEqual([]);
            }
            // Vom Hauptstrom oben aus in alle Arme des Deltas.
            const vonOben = fliessrichtungDemLaufNach(f.abschnitte, oberster, f.heute[oberster]!);
            expect(Object.keys(vonOben.neu)).toHaveLength(f.abschnitte.length);
        },
    );

    it("Umgedreht am Start: der ganze Fluss dreht mit, je Abschnitt in seiner Zeichenrichtung", () => {
        const m = fluss(STAGE.Mhanadi);
        const lauf = fliessrichtungDemLaufNach(m.abschnitte, "a1", "reverse");
        // Ohne Gabelung oberhalb (jetzt die Mündungsseite) stimmen alle gedreht; an den Armen hält der Lauf flussaufwärts.
        expect(abweichend(lauf.neu, m.heute)).toEqual(Object.keys(lauf.neu));
        expect(lauf.gabelung.length).toBeGreaterThan(0);
        expect(lauf.unterbrochen).toEqual([]);
    });

    it("Bendrom: Pfeile zeigen heute gegeneinander, der Lauf löst es", () => {
        const b = fluss(STAGE.Bendrom);
        expect(fliessrichtungGegeneinander(b.abschnitte, b.heute)).toEqual([["a2", "a3"]]);
        const lauf = fliessrichtungDemLaufNach(b.abschnitte, "a1", "forward");
        expect(lauf.neu["a3"]).toBe("reverse");
        expect(fliessrichtungGegeneinander(b.abschnitte, lauf.neu)).toEqual([]);
        // Abschnitt 4 und 5 hängen nicht an 1 bis 3.
        expect(lauf.unterbrochen).toEqual(["a4", "a5"]);
    });

    it("Großer Fluss und Dergel: hinter einer Lücke hält der Lauf an und nennt, was er nicht erreicht", () => {
        const g = fluss(STAGE.GrosserFluss);
        const lauf = fliessrichtungDemLaufNach(g.abschnitte, "a30", g.heute["a30"]!);
        expect(abweichend(lauf.neu, g.heute)).toEqual([]);
        expect(lauf.unterbrochen).toEqual(["a53", "a54", "a55", "a56", "a57"]);
        expect(lauf.gabelung).toEqual([]);
        const d = fluss(STAGE.Dergel);
        const dergel = fliessrichtungDemLaufNach(d.abschnitte, "a1", "forward");
        expect(Object.keys(dergel.neu)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
        expect(dergel.unterbrochen).toEqual(["a8", "a9", "a10"]);
    });

    it("Flussaufwärts hält der Lauf an einer Gabelung, eine Insel nimmt er mit", () => {
        // Zwei Quellbäche treffen sich in k2 (Gabelung von unten gesehen), darunter eine Insel k3–k4, dann die Mündung k5.
        const abschnitte: FlussAbschnitt[] = [
            { id: "q1", knoten: ["k0", "k2"], laengen: [3] },
            { id: "q2", knoten: ["k1", "k2"], laengen: [3] },
            { id: "s", knoten: ["k2", "k3"], laengen: [2] },
            { id: "i1", knoten: ["k3", "k4"], laengen: [2] },
            { id: "i2", knoten: ["k4", "k3"], laengen: [3] },
            { id: "m", knoten: ["k4", "k5"], laengen: [2] },
        ];
        const lauf = fliessrichtungDemLaufNach(abschnitte, "m", "forward");
        expect(lauf.neu).toEqual({ m: "forward", i1: "forward", i2: "reverse", s: "forward" });
        expect(lauf.gabelung).toEqual(["q1", "q2"]);
        // Flussabwärts dagegen in alle Arme: vom Bach q1 aus bekommt auch q2 eine Richtung, und zwar von k2 weg (in alle Arme).
        const abwaerts = fliessrichtungDemLaufNach(abschnitte, "q1", "forward");
        expect(abwaerts.neu).toMatchObject({ s: "forward", i1: "forward", i2: "reverse", m: "forward", q2: "reverse" });
    });

    it("Ein Abschnitt mit innerer Teilung: was dort hängt, ist eine Gabelung; der Lauf geht über die Enden", () => {
        // h läuft k0 → k1 → k2 (in k1 liegt ein Ort), der Zufluss z endet in k1; u schließt unten an.
        const abschnitte: FlussAbschnitt[] = [
            { id: "o", knoten: ["kq", "k0"], laengen: [1] },
            { id: "h", knoten: ["k0", "k1", "k2"], laengen: [2, 2] },
            { id: "z", knoten: ["kz", "k1"], laengen: [2] },
            { id: "u", knoten: ["k3", "k2"], laengen: [1] },
        ];
        const lauf = fliessrichtungDemLaufNach(abschnitte, "o", "forward");
        expect(lauf.neu).toMatchObject({ o: "forward", h: "forward", u: "reverse" });
        // Vom unteren Ende aus hinauf: h bekommt seine Richtung, über k1 hinaus aber nicht weiter.
        const hinauf = fliessrichtungDemLaufNach(abschnitte, "u", "reverse");
        expect(hinauf.neu).toEqual({ u: "reverse", h: "forward" });
        expect(hinauf.gabelung).toEqual(["o", "z"]);
    });
});
