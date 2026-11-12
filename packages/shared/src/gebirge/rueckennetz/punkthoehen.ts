/**
 * Die Höhe jedes Punkts im Kammeditor (WI-0249 P9; Betreiber 2026-10-24: „ich will, dass kämme, nebengipfel, täler und mulden definierte
 * höhen haben … cool wärs wenn im editor die punkte mit den höhen beschriftet werden können“): je Stützpunkt jeder Kamm- und Tallinie, je
 * Nebengipfel und je Mulde die Höhe, die gilt, und ob sie eigen ist. Ohne eigene Höhe ist es die Vorgabe des Modells an dieser Stelle, aus
 * derselben Rechnung wie die Saat (`kammPunktHoehen`, `talPunktHoehen`, `nebengipfelVorgabe`, `talBoden`); bei Kämmen ohne die Unruhe von
 * ±5 %. Reine Rechnung ohne Raster, für Feld und Beschriftung der Kamm-Leiste.
 */
import { kammPunktHoehen, type HoehenPunkt } from "./kaemme.ts";
import type { GebirgsNetz } from "./netz-vertrag.ts";
import { nebengipfelVorgabe } from "./rechne.ts";
import { talBoden, talPunktHoehen } from "./senken.ts";

/** Was die Vorgaben brauchen: Kammhöhe, kanonische Gipfel (ohne Höhe: Kammhöhe), wirksamer Talboden, Sattel der V12. */
export interface PunktHoehenLage {
    kammhoehe: number;
    peaks: readonly { x: number; y: number; h?: number | null | undefined }[];
    /** Talboden als Anteil der Kammhöhe (eigener, abgeleiteter oder der des Typs). */
    talboden: number;
    /** Der Sattel der V12 (`regler.sattel`), Vorgabe 0,85 wie die Rechnung. */
    sattel?: number | undefined;
}

/** Eine Höhe, die gilt, in Schritt (gerundet), und ob sie eigen ist. */
export interface PunktHoehe {
    h: number;
    eigen: boolean;
}

export interface PunktHoehen {
    /** Je Linie des Netzes (Kämme und Täler in ihrer Folge) je Stützpunkt. */
    linien: PunktHoehe[][];
    nebengipfel: PunktHoehe[];
    mulden: PunktHoehe[];
}

export function punktHoehen(netz: GebirgsNetz, lage: PunktHoehenLage): PunktHoehen {
    const kamm = lage.kammhoehe;
    const vorgabeNeben = nebengipfelVorgabe(kamm, lage.talboden);
    const boden = talBoden(kamm, lage.talboden);
    const nebengipfel = netz.nebengipfel.map((n) =>
        n.h === null ? { h: vorgabeNeben, eigen: false } : { h: n.h, eigen: true },
    );
    const mulden = (netz.mulden ?? []).map((m) =>
        m.h === null ? { h: boden, eigen: false } : { h: m.h, eigen: true },
    );
    // Wie `rechneRueckennetz`: Gipfel ohne Höhe tragen die Kammhöhe, Nebengipfel ohne eigene (oder 0) ihre Vorgabe.
    const hoehenPunkte: HoehenPunkt[] = [
        ...lage.peaks.map((p) => ({ x: p.x, y: p.y, h: Number(p.h) > 0 ? Number(p.h) : kamm })),
        ...netz.nebengipfel.map((n) => ({ x: n.x, y: n.y, h: Number(n.h) > 0 ? Number(n.h) : vorgabeNeben })),
    ];
    const kaemme = kammPunktHoehen(netz.kaemme, hoehenPunkte, kamm, lage.sattel);
    const linien = netz.kaemme.map((linie, i) => {
        const wirksam =
            linie.rang === "tal"
                ? talPunktHoehen(
                      linie,
                      (netz.mulden ?? []).map((m) => ({ x: m.x, y: m.y, h: m.h })),
                      boden,
                  )
                : (kaemme[i] ?? []);
        return linie.punkte.map((_, s) => {
            const eigen = linie.hoehen?.[s];
            return eigen === null || eigen === undefined
                ? { h: Math.round(wirksam[s] ?? kamm), eigen: false }
                : { h: eigen, eigen: true };
        });
    });
    return { linien, nebengipfel, mulden };
}
