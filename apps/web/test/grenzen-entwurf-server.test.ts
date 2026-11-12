import { describe, expect, it } from "vitest";
import {
    bereinige,
    mitGemeinsamenEcken,
    mitgezogen,
    schluessel,
    type Punkt as RingPunkt,
} from "../../server/src/editor/ring-form.ts";
import { ausDemEntwurf, standNach, type FormStand } from "../src/map/geometrie/formentwurf.ts";
import { operationAus, type Aufbau } from "../src/map/geometrie/formoperation.ts";
import type { Aenderung, Punkt, Teil } from "../src/map/geometrie/geometrie.ts";
import {
    aufGemeinsamerKante,
    gruppeVerschoben,
    mitPunkt,
    mitziehende,
    mitziehendeAller,
    ohnePunkt,
    stellenAn,
    teilMit,
    verschoben,
} from "../src/map/geometrie/rechnung.ts";

/**
 * Was der Formentwurf schicken kann, muss die Prüfung des Servers durchlassen (OPS-000079: zweimal schickte der Client, was der Server abwies, und die
 * Tests endeten jeweils an der Grenze zwischen beiden). Zufällige Folgen aus Ziehen, Strg-Ziehen, Gruppenzug (OPS-000081), Einfügen und Löschen mit der echten Rechnung beider Seiten.
 *
 * 🪤 Nicht dabei: das Einrasten auf einer fremden Ecke und das Weiterziehen samt Lösen oder Löschen. Das lehnt der Server bewusst ab (`nachbar_umgezeichnet`),
 * eine Ecke, die nie gemeinsam war, ist dann von einer fremden Umzeichnung nicht zu unterscheiden.
 */
const ring = (objekt: string, punkte: Punkt[]): Teil => ({
    objekt,
    name: objekt,
    nr: 0,
    art: "ring",
    punkte,
    revision: 1,
});
const P = (x: number, y: number): Punkt => ({ x, y });
const [A, B, C, D, E, F, G, H] = [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(20, 0), P(20, 10), P(10, 20), P(0, 20)] as [
    Punkt,
    Punkt,
    Punkt,
    Punkt,
    Punkt,
    Punkt,
    Punkt,
    Punkt,
];
const START: FormStand = {
    teile: [ring("eigen", [A, B, C, D])],
    // Zwei Nachbarn: Die Ecke C gehört allen dreien (Drei-Länder-Eck).
    nachbarn: [ring("ost", [B, E, F, C]), ring("nord", [D, C, G, H])],
};
const AUFBAU: Aufbau = new Map([
    ["eigen", [1]],
    ["ost", [1]],
    ["nord", [1]],
]);
const MINDESTENS = 3;

const satz = (teile: readonly Teil[]): Set<string> =>
    new Set(teile.flatMap((t) => t.punkte.map((p) => schluessel([p.x, p.y]))));

function pruefe(jetzt: FormStand, verlauf: readonly string[]): void {
    const eigeneAlt = satz(START.teile);
    const eigeneNeu = satz(jetzt.teile);
    for (const flaeche of operationAus(START, jetzt, AUFBAU, "op").areas) {
        if (flaeche.id === "eigen") continue;
        const alt: RingPunkt[][][] = [
            [START.nachbarn.find((t) => t.objekt === flaeche.id)!.punkte.map((p) => [p.x, p.y] as const)],
        ];
        const neu = bereinige(flaeche.polygons);
        const geht =
            mitgezogen(alt, neu, eigeneAlt, eigeneNeu) !== undefined ||
            mitGemeinsamenEcken(alt, neu, eigeneAlt, eigeneNeu);
        expect(geht, `${flaeche.id} nach ${verlauf.join(", ")}`).toBe(true);
        expect(neu[0]![0]!.length).toBeGreaterThanOrEqual(MINDESTENS);
    }
}

function lauf(saat: number, schritte: number): void {
    let zustand = saat;
    const zufall = (n: number): number => {
        zustand = (Math.imul(zustand, 1664525) + 1013904223) >>> 0;
        return (zustand >>> 8) % n;
    };
    let frisch = 0;
    const neuerPunkt = (): Punkt => {
        frisch += 1;
        return { x: 100 + frisch * 1.5, y: 200 + zufall(1000) / 7 };
    };
    let jetzt = START;
    const verlauf: string[] = [];
    for (let i = 0; i < schritte; i += 1) {
        const teil = jetzt.teile[0]!;
        const index = zufall(teil.punkte.length);
        const von = teil.punkte[index]!;
        const grund = {
            stelle: { objekt: "eigen", nr: 0, index },
            treffer: undefined,
            getrennt: false,
            mitgezogen: [],
        };
        const wahl = zufall(6);
        let aenderung: Aenderung;
        if (wahl >= 4) {
            // Mehrere markierte Ecken um dieselbe Strecke, mit Strg gelöst oder mit den Nachbarn.
            const getrennt = wahl === 5;
            const marken = teil.punkte.flatMap((p, i) =>
                zufall(2) === 0 ? [{ stelle: { objekt: "eigen", nr: 0, index: i }, revision: 1, von: p }] : [],
            );
            if (marken.length === 0) continue;
            frisch += 1;
            const zuege = gruppeVerschoben(marken, 100 + frisch * 1.5, 200 + zufall(1000) / 7);
            aenderung = {
                ...grund,
                art: "ziehen",
                getrennt,
                teile: [
                    teilMit(
                        teil,
                        zuege.reduce((p, z) => verschoben(p, z.stelle.index, z.nach), teil.punkte),
                    ),
                ],
                mitgezogen: mitziehendeAller(zuege, jetzt.nachbarn, [], getrennt),
            };
            verlauf.push(getrennt ? "gruppe strg" : "gruppe");
        } else if (wahl <= 1) {
            const nach = neuerPunkt();
            const getrennt = wahl === 1;
            aenderung = {
                ...grund,
                art: "ziehen",
                getrennt,
                teile: [teilMit(teil, verschoben(teil.punkte, index, nach))],
                mitgezogen: mitziehende(von, nach, jetzt.nachbarn, [], getrennt),
            };
            verlauf.push(getrennt ? "strg" : "ziehen");
        } else if (wahl === 2) {
            const at = neuerPunkt();
            const position = index + 1;
            aenderung = {
                ...grund,
                art: "einfuegen",
                teile: [teilMit(teil, mitPunkt(teil.punkte, position, at))],
                eingefuegt: aufGemeinsamerKante(teil, position, at, jetzt.nachbarn),
            };
            verlauf.push("einfuegen");
        } else {
            if (teil.punkte.length <= MINDESTENS) continue;
            const stellen = stellenAn(von, jetzt.nachbarn).map(({ objekt, nr, index }) => ({
                stelle: { objekt, nr, index },
            }));
            aenderung = {
                ...grund,
                art: "loeschen",
                teile: [teilMit(teil, ohnePunkt(teil.punkte, index))],
                entfernt: ausDemEntwurf(stellen, jetzt, START, MINDESTENS),
            };
            verlauf.push("loeschen");
        }
        jetzt = standNach(jetzt, aenderung);
        pruefe(jetzt, verlauf);
    }
}

describe("Formentwurf gegen die Prüfung des Servers (OPS-000079)", () => {
    it("🔴 keine Folge aus Ziehen, Strg-Ziehen, Gruppenzug, Einfügen und Löschen wird abgelehnt", () => {
        for (let saat = 1; saat <= 200; saat += 1) lauf(saat, 30);
    });
});
