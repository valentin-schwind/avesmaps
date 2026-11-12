import type { FormStand } from "./formentwurf";
import type { Teil } from "./geometrie";

/**
 * Die Operation zu „Fertig“ eines Formentwurfs aus Ringen (WI-0209 C2; gehoben aus `landschaftseditor/ecken.ts`, WI-0178 C2): Fläche
 * (`landscape.update`) und Herrschaftsgebiet (`territory.update`) schicken dieselben Flächen, `areas` mit jeder
 * Fläche, deren Ring sich geändert hat, ganz und gegen ihre Revision vom Start. Reine Rechnung, ohne Server.
 */

/** Wie viele Ringe jedes Polygon einer Fläche hat: daraus werden die Ringe des Entwurfs wieder Polygone. */
export type Aufbau = ReadonlyMap<string, readonly number[]>;

export function aufbauAus(
    flaechen: readonly { id: string; polygons: readonly (readonly unknown[])[] }[],
): Map<string, number[]> {
    return new Map(flaechen.map((flaeche) => [flaeche.id, flaeche.polygons.map((polygon) => polygon.length)] as const));
}

/** Der Körper zu „Fertig“: jede geänderte Fläche mit ihrer Revision vom Start und ihren Polygonen. */
export interface FormOperation {
    operationId: string;
    areas: { id: string; baseRevision: number; polygons: [number, number][][][] }[];
}

const ringSchluessel = (teil: Teil): string => teil.punkte.map((p) => `${p.x.toFixed(5)} ${p.y.toFixed(5)}`).join(";");

/**
 * Jede Fläche (eigene und Nachbarn), von der sich ein Ring gegenüber dem Start geändert hat, ganz, mit der Revision vom Start.
 * Unveränderte Flächen fehlen.
 */
export function operationAus(start: FormStand, jetzt: FormStand, aufbau: Aufbau, operationId: string): FormOperation {
    const areas: FormOperation["areas"] = [];
    const paare: (readonly [readonly Teil[], readonly Teil[]])[] = [
        [start.teile, jetzt.teile],
        [start.nachbarn, jetzt.nachbarn],
    ];
    for (const [vorher, nachher] of paare) {
        for (const objekt of new Set(nachher.map((teil) => teil.objekt))) {
            const alt = vorher.filter((teil) => teil.objekt === objekt).sort((a, b) => a.nr - b.nr);
            const neu = nachher.filter((teil) => teil.objekt === objekt).sort((a, b) => a.nr - b.nr);
            const unveraendert =
                alt.length === neu.length && alt.every((teil, i) => ringSchluessel(teil) === ringSchluessel(neu[i]!));
            if (unveraendert) continue;
            const polygons: [number, number][][][] = [];
            const alsRing = (teil: Teil): [number, number][] => teil.punkte.map((p) => [p.x, p.y] as [number, number]);
            if (neu.every((teil) => teil.stueck !== undefined)) {
                // Neu gelegte Ringe (Pinsel): je Stück ein Polygon, der Aufbau vom Lesen gilt nicht mehr.
                const stuecke = new Map<number, [number, number][][]>();
                for (const teil of neu)
                    stuecke.set(teil.stueck!, [...(stuecke.get(teil.stueck!) ?? []), alsRing(teil)]);
                for (const [, polygon] of [...stuecke.entries()].sort(([a], [b]) => a - b)) polygons.push(polygon);
            } else if (neu.length < alt.length) {
                // Ein Teil ist weg (OPS-000078, `ohneTeil`): Der Aufbau zählt die Ringe vom Lesen. Fehlt der äußere Ring eines Polygons, fällt es samt seinen Löchern weg.
                const jetzt = new Map(neu.map((teil) => [teil.nr, teil] as const));
                let stelle = 0;
                for (const anzahl of aufbau.get(objekt) ?? [alt.length]) {
                    const ringe = alt.slice(stelle, stelle + anzahl).map((teil) => jetzt.get(teil.nr));
                    stelle += anzahl;
                    if (ringe[0] !== undefined) polygons.push(ringe.filter((ring) => ring !== undefined).map(alsRing));
                }
            } else {
                let nr = 0;
                for (const anzahl of aufbau.get(objekt) ?? [neu.length]) {
                    polygons.push(neu.slice(nr, nr + anzahl).map(alsRing));
                    nr += anzahl;
                }
            }
            areas.push({ id: objekt, baseRevision: (alt[0] ?? neu[0]!).revision, polygons });
        }
    }
    return { operationId, areas };
}
