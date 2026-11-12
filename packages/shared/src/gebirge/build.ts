/**
 * Der Trichter: aus Gipfeln, Kamm, Reglern, Flüssen und Seen das Raster einer Gebirgsfläche
 * (hydrologie.js#L1779-2100, aff0449a5), im Pfad von Legacys Speicherlauf: Zellweite 0,25, ohne
 * `deckel`, ohne Verbund. Die Reihenfolge ist Legacys und tragend:
 *   Gipfelkerne → lösen → Kamm → lösen → Bergform addieren → Rauschen → Hypsometrie
 *   → Täler abziehen → Erosion → Deckel auf den höchsten festen Wert.
 */
import {
    avesmapsGebirgeBleibtFlach,
    avesmapsHydroErosionsSchritte,
    ECOSYSTEM_HYDRO_ABTRAG,
    ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE,
    ECOSYSTEM_HYDRO_KRIECHEN,
    ECOSYSTEM_HYDRO_PLATEAU_VORGABE,
    ECOSYSTEM_HYDRO_RAUSCHEN,
    ECOSYSTEM_HYDRO_SATTEL,
    ECOSYSTEM_HYDRO_STANDARDHOEHE,
    ECOSYSTEM_HYDRO_ZELLWEITE,
} from "./constants.ts";
import { erosionsSchritt, type ErosionsZustand } from "./erosion.ts";
import { fbm, zellMuster } from "./noise.ts";
import { addiereGipfelkegel, stempleGipfel } from "./peaks.ts";
import { andockRahmen, baueRaster, mitAndockStreifen, randAbstand, type Raster } from "./raster.ts";
import { loeseRelief, zieheAufHypsometrie } from "./relief.ts";
import { stempleKamm, type KammPunkt } from "./ridge.ts";
import type { V12Input } from "./types.ts";
import { baueEcosystemTaeler, baueEcosystemTalIndex, ecosystemTalAbzug, type Taeler } from "./valleys.ts";

export interface GebirgsRaster {
    r: Raster;
    h: Float64Array;
}

/** hydrologie.js#L1779-2100 */
export function avesmapsGebirgsRasterBauen(
    e: V12Input,
    istDrin: (x: number, y: number) => boolean,
    istImSee: (index: number, x: number, y: number) => boolean,
): GebirgsRaster {
    const reg = e.regler || {};
    const r = mitAndockStreifen(
        baueRaster(andockRahmen(e.bounds, e.andock), e.zelle ?? ECOSYSTEM_HYDRO_ZELLWEITE, istDrin, e.vorschauZelleMin),
        e.andock,
    );
    const zellen = r.w * r.hh;
    const h = new Float64Array(zellen);
    const fest = new Uint8Array(zellen);
    const festEro = new Uint8Array(zellen);
    const senke = new Uint8Array(zellen);
    const kern = new Uint8Array(zellen);
    const mantel = new Uint8Array(zellen);
    const kammMaske = new Uint8Array(zellen);
    const peaks = Array.isArray(e.peaks) ? e.peaks : [];

    // Ohne Gipfel und ohne Maximalhöhe bleibt die Fläche flach.
    const maximalhoehe = Number(reg.maximalhoehe) > 0 ? Number(reg.maximalhoehe) : 0;
    if (avesmapsGebirgeBleibtFlach(peaks.length, maximalhoehe)) {
        return { r, h };
    }

    stempleGipfel(r, h, fest, peaks, ECOSYSTEM_HYDRO_STANDARDHOEHE, kern);
    // Ohne Gipfel tragen die Punkte der Kurve die Maximalhöhe.
    const kammPunkte: readonly KammPunkt[] = peaks.length
        ? peaks
        : Array.isArray(e.kurve) && e.kurve.length
          ? e.kurve.map((p) => ({ x: p[0], y: p[1], h: maximalhoehe }))
          : [];
    loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 60, 120, 1.85);

    const sattel = Number.isFinite(Number(reg.sattel)) ? Number(reg.sattel) : ECOSYSTEM_HYDRO_SATTEL;
    const plateau = Number.isFinite(Number(reg.plateau))
        ? Math.max(0, Math.min(1, Number(reg.plateau)))
        : ECOSYSTEM_HYDRO_PLATEAU_VORGABE;
    let kammZellen =
        kammPunkte.length >= 2
            ? stempleKamm(
                  r,
                  h,
                  fest,
                  kammPunkte,
                  sattel,
                  ECOSYSTEM_HYDRO_STANDARDHOEHE,
                  e.kurve,
                  kammMaske,
                  maximalhoehe,
                  plateau,
              )
            : 0;

    // Letzter Rückfall: die Mittelachse (Maximum des Randabstands) auf Maximalhöhe (hydrologie.js#L1847-1866).
    if (!kammZellen && maximalhoehe > 0) {
        const dist = randAbstand(r);
        let dmax = 0;
        for (let k = 0; k < dist.length; k++) {
            if (r.drin[k] && (dist[k] as number) > dmax) dmax = dist[k] as number;
        }
        const anteil = plateau >= 1 ? 0.9 : plateau;
        const schwelle = anteil * dmax;
        let gesetzt = 0;
        for (let k = 0; k < dist.length; k++) {
            if (!r.drin[k] || fest[k] || (dist[k] as number) < schwelle) continue;
            h[k] = maximalhoehe;
            fest[k] = 1;
            kammMaske[k] = 1;
            gesetzt++;
        }
        kammZellen = gesetzt;
        if (gesetzt) loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 40, 100, 1.85);
    }
    // Wie Legacy: nach der Mittelachse wird ein zweites Mal gelöst.
    if (kammZellen) loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 40, 100, 1.85);

    addiereGipfelkegel(r, h, peaks, reg.bergform, ECOSYSTEM_HYDRO_STANDARDHOEHE, fest, mantel);

    // Das Grundrauschen, multiplikativ; Kegelmantel und Kamm bekommen es, Gipfelkerne nicht.
    const spanMax = Math.max(e.bounds.max_x - e.bounds.min_x, e.bounds.max_y - e.bounds.min_y);
    const koernung = Number(reg.koernung) > 0 ? Number(reg.koernung) : 3.2;
    const stufen = Number(reg.stufen) > 0 ? Math.min(8, Math.round(Number(reg.stufen))) : 3;
    const rauschen = Number.isFinite(Number(reg.rauschen)) ? Number(reg.rauschen) : ECOSYSTEM_HYDRO_RAUSCHEN;
    const saat = Number.isFinite(Number(e.saat)) ? Number(e.saat) : 12345;
    let hoechsterFest = 0;
    for (let k = 0; k < zellen; k++) {
        if (r.drin[k] && fest[k] && (h[k] as number) > hoechsterFest) hoechsterFest = h[k] as number;
    }
    if (reg.muster === "zellen") {
        // Muster „Zellen“ (WI-0226, Betreiber 2026-10-18: „ein verrauschtes voronoi pattern mit bergen als zellspitzen“) statt des
        // weichen Rauschens: Dichte aus der Zahl der Erhebungen, Schärfe der Spitzen aus der Feinheit, Verwirbelung der Ränder aus der
        // Stärke des Rauschens, Sockelhöhe aus der Massigkeit. Dieselben Zellen wie das Rauschen: Kegelmantel und Kamm, ohne Gipfelkerne.
        const zelle = spanMax / koernung;
        const warp = 0.45 * rauschen;
        const schaerfe = 0.45 + 0.15 * stufen;
        const hy = Number.isFinite(Number(reg.hypsometrie)) ? Number(reg.hypsometrie) : 0.3;
        const sockel = Math.max(0.1, Math.min(0.85, hy * 1.4));
        for (let j = 0; j < r.hh; j++) {
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                if (!r.drin[k] || (fest[k] && !mantel[k] && !kammMaske[k])) continue;
                const z = zellMuster(saat, r.x(i), r.y(j), zelle, warp);
                const spitze = Math.pow(z.c, schaerfe) * (0.8 + 0.2 * z.hz);
                const unruhe = 1 + 0.25 * rauschen * fbm(saat + 31, r.x(i), r.y(j), zelle / 3, 3, 0.5);
                h[k] = Math.max(0, (h[k] as number) * (sockel + (1 - sockel) * spitze) * unruhe);
            }
        }
    } else if (rauschen > 0) {
        const grobeZelle = spanMax / koernung;
        for (let j = 0; j < r.hh; j++) {
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                if (!r.drin[k] || (fest[k] && !mantel[k] && !kammMaske[k])) continue;
                h[k] = Math.max(
                    0,
                    (h[k] as number) * (1 + rauschen * fbm(saat, r.x(i), r.y(j), grobeZelle, stufen, 0.5)),
                );
            }
        }
    }

    // Die Hypsometrie vor Tälern und Erosion; ausgespart nur die Gipfelkerne.
    const hypsoZiel = Number.isFinite(Number(reg.hypsometrie))
        ? Math.max(0, Math.min(1, Number(reg.hypsometrie)))
        : ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE;
    if (hypsoZiel > 0) zieheAufHypsometrie(h, r.drin, kern, hypsoZiel);

    const initial = h.slice();
    const seen = Array.isArray(e.seen) ? e.seen : [];
    const fluesse = Array.isArray(e.fluesse) ? e.fluesse : [];
    let tal: Taeler | null = null;
    if (seen.length || fluesse.length) {
        // `bachAnteil` und `tiefe` setzt Legacys Speicherlauf nie; ihre Vorgaben gelten.
        tal = baueEcosystemTaeler(r, h, fluesse, seen, istImSee, {
            talbreite: reg.talbreite,
            einschnitt: reg.einschnitt,
        });
        if (tal.segmente.length) {
            const talIndex = baueEcosystemTalIndex(tal.segmente, e.bounds);
            // Der Abzug liest das initiale Feld und schreibt in `h`; die Achse gewinnt auch gegen einen Gipfelkern.
            for (let j = 0; j < r.hh; j++) {
                for (let i = 0; i < r.w; i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k]) continue;
                    const start = initial[k] as number;
                    if (tal.achse[k]) {
                        h[k] = Math.max(0, Math.min(start, tal.achseBoden[k] as number));
                        senke[k] = 1;
                        continue;
                    }
                    if (kern[k]) continue;
                    const abzug = ecosystemTalAbzug(talIndex, r.x(i), r.y(j), start);
                    if (abzug > 0) {
                        h[k] = Math.max(0, start - abzug);
                        if (abzug > 0.98 * Math.max(0, start - 0)) senke[k] = 1;
                    }
                }
            }
        }
    }
    const relief = h.slice();

    // Die Erosionsmaske: fest ohne Kegelmantel und (ohne Plateau) Kamm, dazu Achse, See und Nullzellen.
    festEro.set(fest);
    for (let k = 0; k < zellen; k++) {
        if (mantel[k] || (kammMaske[k] && plateau >= 1)) festEro[k] = 0;
        if (tal && tal.achse[k]) festEro[k] = 1;
        if (r.drin[k] && !((relief[k] as number) > 0)) festEro[k] = 1;
    }
    let hebungZellen = 0;
    for (let k = 0; k < zellen; k++) {
        if (r.drin[k] && !festEro[k]) hebungZellen++;
    }

    const schritte = avesmapsHydroErosionsSchritte(reg.erosion);
    const zustand: ErosionsZustand = { r, h, festEro, senke, hebungZellen, accVorgabe: null };
    for (let it = 0; it < schritte; it++) {
        erosionsSchritt(zustand, { K: ECOSYSTEM_HYDRO_ABTRAG, D: ECOSYSTEM_HYDRO_KRIECHEN });
    }

    // Der Deckel am Ausgang: kein Punkt über dem höchsten festgehaltenen Wert.
    if (hoechsterFest > 0) {
        const fertig = zustand.h;
        for (let k = 0; k < zellen; k++) {
            if (r.drin[k] && (fertig[k] as number) > hoechsterFest) fertig[k] = hoechsterFest;
        }
    }
    return { r, h: zustand.h };
}
