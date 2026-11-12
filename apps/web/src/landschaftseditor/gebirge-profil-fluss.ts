import { pointInGeometry, PUNKT_HOEHE_GRENZEN, type V12Geometry } from "@avesmaps3d/shared";
import type { FlussAnsicht } from "./kamm-netz-fluss";
import type { ProfilLinie } from "./gebirge-gewaesser";

/**
 * Die Rechnung hinter dem Höhenprofil eines Flusses mit eigenen Höhen (WI-0259, OPS-071; Probierseite abgenommen 2026-10-30): was
 * `gebirge-profil.vue` zeichnet, ohne Oberfläche. Griffe an den Stützpunkten (x nach Bogenlänge, y nach Höhe), die Achse mit Luft zum
 * Hochziehen, die Umrechnung zwischen Zeiger und Höhe (10er-Schritt) und die Platten der Seen mit ihrem Spiegel.
 */

/** Ein Schritt beim Ziehen im Profil (Vorgabe der Probierseite). */
export const PROFIL_SCHRITT = 10;

/** Ein Griff an einem Stützpunkt des Flusses; `x` von 0 (links) bis 1 (rechts), links liegt die Quelle. */
export interface ProfilGriff {
    /** Der Punkt im Flussweg (Index in `fluss.p`). */
    readonly k: number;
    readonly x: number;
    /** Die wirksame Höhe (eigene, dazwischen nach Bogenlänge, sonst die des Geländes). */
    readonly h: number;
    readonly eigen: boolean;
    readonly steigt: boolean;
    /** Liegt der Punkt in der Fläche? Nur dort lässt sich seine Höhe setzen. */
    readonly drin: boolean;
}

/** Die Lage auf der Achse von links (Quelle) nach rechts (Mündung), 0 bis 1. */
export function profilX(a: Pick<FlussAnsicht, "vorwaerts" | "gesamt">, s: number): number {
    if (a.gesamt <= 0) return 0;
    const t = Math.min(1, Math.max(0, s / a.gesamt));
    return a.vorwaerts ? t : 1 - t;
}

/**
 * Die Griffe: jeder Stützpunkt außerhalb eines Sees, dessen Höhe bekannt ist (im See gilt der See und trägt seinen Griff an der Platte). Ein Punkt
 * außerhalb der Fläche hat keine wirksame Höhe (dort zieht dieses Gebirge nichts nach); sein grauer Griff steht auf der Höhe des Höhenmodells
 * (`modell`), wenn es sie kennt.
 */
export function profilGriffe(a: FlussAnsicht, modell?: (k: number) => number | undefined): ProfilGriff[] {
    return a.punkte.flatMap((p, k): ProfilGriff[] => {
        const h = p.hoehe ?? modell?.(k);
        return p.see >= 0 || h === undefined
            ? []
            : [{ k, x: profilX(a, p.s), h, eigen: p.eigen !== null, steigt: p.steigt, drin: p.drin }];
    });
}

/** Die Höhe des Höhenmodells bei der Bogenlänge `s`, linear zwischen den bekannten Proben; `undefined` ohne Proben. */
export function hoeheAmProfil(profil: ProfilLinie, s: number): number | undefined {
    let davor: { at: number; h: number } | undefined;
    for (let i = 0; i < profil.at.length; i++) {
        const h = profil.h[i];
        if (h === null || h === undefined || !Number.isFinite(h)) continue;
        const at = profil.at[i]!;
        if (at >= s) {
            if (davor === undefined || at === s || at - davor.at < 1e-12) return h;
            return davor.h + ((h - davor.h) * (s - davor.at)) / (at - davor.at);
        }
        davor = { at, h };
    }
    return davor?.h;
}

export interface Achse {
    readonly lo: number;
    readonly hi: number;
}

/**
 * Die Achse der Höhe: von der tiefsten bis zur höchsten Höhe aller Linien. Im Kammeditor mit Luft (unten ein Zehntel, oben über ein
 * Drittel der Spanne), damit sich ein Griff nach oben ziehen lässt; sonst knapp wie bisher.
 */
export function profilAchse(werte: readonly number[], mitLuft: boolean): Achse {
    if (werte.length === 0) return { lo: 0, hi: 1 };
    const unten = Math.min(...werte);
    const oben = Math.max(...werte);
    const spanne = Math.max(1, oben - unten);
    return mitLuft
        ? { lo: Math.max(0, unten - 0.1 * spanne), hi: oben + 0.35 * spanne }
        : { lo: unten, hi: unten + spanne };
}

/** Der Rand der Zeichnung in Einheiten ihrer Höhe `hoehe`. */
export const profilRand = (mitLuft: boolean): number => (mitLuft ? 11 : 4);

/** y (0 oben) zu einer Höhe. */
export function yVonHoehe(h: number, achse: Achse, hoehe: number, rand: number): number {
    return hoehe - rand - ((h - achse.lo) / Math.max(1e-9, achse.hi - achse.lo)) * (hoehe - 2 * rand);
}

/** Die Höhe zu einem y (0 oben); nicht begrenzt. */
export function hoeheVonY(y: number, achse: Achse, hoehe: number, rand: number): number {
    return achse.lo + ((hoehe - rand - y) / Math.max(1e-9, hoehe - 2 * rand)) * (achse.hi - achse.lo);
}

/**
 * Die Höhe unter dem Zeiger als eigene Höhe: auf `PROFIL_SCHRITT` gerundet, in der Achse des Zugs und in den Grenzen einer Punkthöhe
 * (`PUNKT_HOEHE_GRENZEN`).
 */
export function gezogeneHoehe(h: number, achse: Achse): number {
    const begrenzt = Math.min(achse.hi, Math.max(achse.lo, h));
    const gerundet = Math.round(begrenzt / PROFIL_SCHRITT) * PROFIL_SCHRITT;
    return Math.min(PUNKT_HOEHE_GRENZEN.max, Math.max(PUNKT_HOEHE_GRENZEN.min, gerundet));
}

/** Eine Platte unter der Kurve: wo der Fluss einen See durchquert. */
export interface SeePlatte {
    /** Der See (Index in der Liste der Seen); −1, wenn sie nicht zugeordnet ist. */
    readonly see: number;
    /** Von … bis auf der Achse (0 bis 1, links die Quelle). */
    readonly x0: number;
    readonly x1: number;
    /** Die Höhe der Oberkante: der eigene Spiegel, sonst die höchste Stelle des Höhenmodells im See. */
    readonly h: number;
    /** Trägt der See eine eigene Höhe? */
    readonly eigen: boolean;
    /** Die Kurve des Höhenmodells im See als Paare (x, Höhe). */
    readonly kurve: readonly (readonly [number, number])[];
}

/**
 * Die Platten der Seen unter dem Profil: je See jedes Stück der Abtastung, das in ihm liegt (ab zwei Proben). `lagen` sind die Lagen der Proben
 * (`lagenEntlang`). Hat ein See einen eigenen Spiegel, steht die Platte auf dessen Höhe, flach.
 */
export function seePlatten(
    a: Pick<FlussAnsicht, "vorwaerts" | "gesamt">,
    profil: ProfilLinie,
    lagen: readonly (readonly [number, number])[],
    seen: readonly { readonly g?: V12Geometry | null | undefined }[],
    spiegel: readonly (number | null)[],
): SeePlatte[] {
    const aus: SeePlatte[] = [];
    seen.forEach((see, si) => {
        if (!see.g) return;
        let stueck: { s: number; h: number }[] = [];
        const schliesse = (): void => {
            if (stueck.length >= 2) {
                const xs = stueck.map((q) => profilX(a, q.s));
                const eigen = spiegel[si] !== null && spiegel[si] !== undefined;
                aus.push({
                    see: si,
                    x0: Math.min(...xs),
                    x1: Math.max(...xs),
                    h: eigen ? spiegel[si]! : Math.max(...stueck.map((q) => q.h)),
                    eigen,
                    kurve: stueck.map((q) => [profilX(a, q.s), q.h] as const),
                });
            }
            stueck = [];
        };
        profil.at.forEach((s, i) => {
            const h = profil.h[i];
            const drin = lagen[i] !== undefined && pointInGeometry(lagen[i]!, see.g!);
            if (drin && h !== null && h !== undefined && Number.isFinite(h)) stueck.push({ s, h });
            else schliesse();
        });
        schliesse();
    });
    return aus;
}
