import type { GebirgsNetzAenderung, GebirgsNetzStand } from "@avesmaps3d/shared";

/**
 * Startwerte im Netz eines Gebirges erkennen (WI-0249; Vali wählte 2026-10-26: Startwerte 2.300 gelten nicht als eigene Höhe und werden auf der
 * Stage an den Punkten entfernt). Von P9 (2026-10-24) bis zu diesem Stand gab der Kammeditor jedem neuen Kammpunkt und jedem neuen Nebengipfel
 * die Kammhöhe des Gebirges als eigene Höhe; eine Änderung der Kammhöhe nahm eigene Höhen verhältnisgleich mit, ein Startwert blieb also gleich
 * der Kammhöhe. Reine Rechnung; lesen und schreiben tut `apps/server/src/terrain/startwerte-cli.ts`.
 *
 * **Kriterium**, je Punkt mit eigener Höhe auf einem Kamm (Haupt- oder Nebenkamm) oder an einem Nebengipfel:
 * - `eigen`: Die Höhe weicht von der Kammhöhe ab, die heute gilt, oder das Fachprotokoll (`area.gebirge`, Netz vorher und nachher) zeigt
 *   den Punkt an derselben Lage einmal ohne eigene Höhe oder mit einer anderen als der damaligen Kammhöhe: Jemand hat sie gesetzt oder gezogen.
 * - `startwert`: Die Höhe ist gleich der Kammhöhe, und in jedem Stand des Fachprotokolls, der den Punkt an dieser Lage zeigt, war sie gleich der
 *   damaligen Kammhöhe: seit dem Anlegen nie geändert.
 * - `unklar`: gleich der Kammhöhe, aber kein Stand des Fachprotokolls zeigt den Punkt an dieser Lage (verschoben, eingespielt): nicht sauber
 *   trennbar, bleibt und wird gemeldet.
 * Täler und Mulden bekamen nie einen Startwert und bleiben unberührt.
 */

/** Ein Stand des Netzes mit der Kammhöhe, die damals galt (Schritt; ohne eigene die Grundhöhe der Fläche). */
export interface NetzZustand {
    readonly netz: GebirgsNetzStand;
    readonly kammhoehe: number;
}

export type StartwertKlasse = "startwert" | "eigen" | "unklar";

export interface StartwertPunkt {
    /** `kamm`: Stützpunkt `punkt` des Kamms `kamm` (Index in `netz.kaemme`); `nebengipfel`: Index `punkt` in `netz.nebengipfel`. */
    art: "kamm" | "nebengipfel";
    kamm?: number;
    punkt: number;
    x: number;
    y: number;
    h: number;
    klasse: StartwertKlasse;
}

const lage = (x: number, y: number): string => `${x.toFixed(6)},${y.toFixed(6)}`;

/** Je Lage alle Höhen, die ein Stand dort trägt (Kämme ohne Täler, Nebengipfel), mit der Kammhöhe dieses Stands. */
function hoehenJeLage(zustand: NetzZustand, ziel: Map<string, { h: number | null; kammhoehe: number }[]>): void {
    const nimm = (x: number, y: number, h: number | null | undefined): void => {
        const k = lage(x, y);
        const liste = ziel.get(k) ?? [];
        liste.push({ h: typeof h === "number" ? h : null, kammhoehe: zustand.kammhoehe });
        ziel.set(k, liste);
    };
    for (const kamm of zustand.netz.kaemme) {
        if (kamm.rang === "tal") continue;
        kamm.punkte.forEach(([x, y], s) => nimm(x, y, kamm.hoehen?.[s]));
    }
    for (const n of zustand.netz.nebengipfel) nimm(n.x, n.y, n.h);
}

/** Die Punkte mit eigener Höhe des heutigen Netzes, klassifiziert (siehe Kopf). */
export function klassifiziereStartwerte(jetzt: NetzZustand, verlauf: readonly NetzZustand[]): StartwertPunkt[] {
    const belegt = new Map<string, { h: number | null; kammhoehe: number }[]>();
    for (const zustand of verlauf) hoehenJeLage(zustand, belegt);
    const klasse = (x: number, y: number, h: number): StartwertKlasse => {
        if (h !== jetzt.kammhoehe) return "eigen";
        const staende = belegt.get(lage(x, y)) ?? [];
        if (staende.length === 0) return "unklar";
        return staende.every((s) => s.h !== null && s.h === s.kammhoehe) ? "startwert" : "eigen";
    };
    const punkte: StartwertPunkt[] = [];
    jetzt.netz.kaemme.forEach((kamm, k) => {
        if (kamm.rang === "tal") return;
        kamm.punkte.forEach(([x, y], s) => {
            const h = kamm.hoehen?.[s];
            if (typeof h === "number")
                punkte.push({ art: "kamm", kamm: k, punkt: s, x, y, h, klasse: klasse(x, y, h) });
        });
    });
    jetzt.netz.nebengipfel.forEach((n, i) => {
        if (typeof n.h === "number")
            punkte.push({ art: "nebengipfel", punkt: i, x: n.x, y: n.y, h: n.h, klasse: klasse(n.x, n.y, n.h) });
    });
    return punkte;
}

/** Das Netz ohne die Startwerte (`klasse === "startwert"`): dort keine eigene Höhe mehr; alles andere bleibt. */
export function ohneStartwerte(netz: GebirgsNetzStand, punkte: readonly StartwertPunkt[]): GebirgsNetzStand {
    const weg = punkte.filter((p) => p.klasse === "startwert");
    const kaemme = netz.kaemme.map((kamm, k) => {
        const hier = weg.filter((p) => p.art === "kamm" && p.kamm === k);
        if (hier.length === 0 || kamm.hoehen === undefined) return kamm;
        const hoehen = kamm.hoehen.map((h, s) => (hier.some((p) => p.punkt === s) ? null : h));
        const { hoehen: _alt, ...rest } = kamm;
        void _alt;
        return hoehen.some((h) => typeof h === "number") ? { ...rest, hoehen } : rest;
    });
    const nebengipfel = netz.nebengipfel.map((n, i) =>
        weg.some((p) => p.art === "nebengipfel" && p.punkt === i) ? { ...n, h: null } : n,
    );
    return { ...netz, kaemme, nebengipfel };
}

/** Ein gelesenes Netz als Änderung für `gebirgSchreiben` (Höhen als Paare, ohne `null`; Mulden, Flüsse und Seen ausdrücklich, damit sie bleiben). */
export function alsAenderung(netz: GebirgsNetzStand): GebirgsNetzAenderung {
    return {
        kaemme: netz.kaemme.map((kamm) => {
            const paare = (kamm.hoehen ?? []).flatMap((h, s): [number, number][] =>
                typeof h === "number" ? [[s, h]] : [],
            );
            return {
                punkte: kamm.punkte.map(([x, y]) => [x, y] as [number, number]),
                rang: kamm.rang,
                ...(paare.length > 0 ? { hoehen: paare } : {}),
            };
        }),
        nebengipfel: netz.nebengipfel.map((n) => ({ x: n.x, y: n.y, ...(n.h === null ? {} : { h: n.h }) })),
        mulden: (netz.mulden ?? []).map((m) => ({ x: m.x, y: m.y, ...(m.h === null ? {} : { h: m.h }) })),
        flussHoehen: (netz.flussHoehen ?? []).map((w) => ({ ...w })),
        seeHoehen: (netz.seeHoehen ?? []).map((w) => ({ ...w })),
    };
}

/** Eine Zeile `area.gebirge` des Fachprotokolls, älteste zuerst: die geänderten Felder vorher und nachher. */
export interface GebirgsProtokoll {
    readonly vorher: { readonly netz?: GebirgsNetzStand; readonly maximalhoehe?: number | null };
    readonly nachher: { readonly netz?: GebirgsNetzStand; readonly maximalhoehe?: number | null };
}

/**
 * Die Stände des Netzes aus dem Fachprotokoll, je mit der Kammhöhe, die damals galt: von heute rückwärts, eine Änderung von `maximalhoehe`
 * in einer Zeile setzt die Kammhöhe davor; ohne eigene Kammhöhe gilt die Grundhöhe der Fläche.
 */
export function protokollStaende(
    zeilen: readonly GebirgsProtokoll[],
    kammhoeheHeute: number | null,
    grundhoehe: number,
): NetzZustand[] {
    const staende: NetzZustand[] = [];
    let laufend = kammhoeheHeute;
    for (let i = zeilen.length - 1; i >= 0; i--) {
        const zeile = zeilen[i]!;
        const nachher = laufend;
        const vorher = "maximalhoehe" in zeile.vorher ? (zeile.vorher.maximalhoehe ?? null) : nachher;
        if (zeile.nachher.netz) staende.push({ netz: zeile.nachher.netz, kammhoehe: nachher ?? grundhoehe });
        if (zeile.vorher.netz) staende.push({ netz: zeile.vorher.netz, kammhoehe: vorher ?? grundhoehe });
        laufend = vorher;
    }
    return staende;
}
