/**
 * Die Täler aus Flüssen und Seen, vom fertigen Grundrelief abgezogen (hydrologie.js#L974-1334,
 * aff0449a5). Seen vor Flüssen; der Talboden eines Laufs fällt nur.
 */
import {
    ECOSYSTEM_HYDRO_BACH_ANTEIL,
    ECOSYSTEM_HYDRO_EINSCHNITT,
    ECOSYSTEM_HYDRO_SEEBECKEN,
    ECOSYSTEM_HYDRO_TALBREITE,
    ECOSYSTEM_HYDRO_TALSOHLE_REST,
} from "./constants.ts";
import type { Raster } from "./raster.ts";
import type { V12Bounds, V12Lake, V12River } from "./types.ts";

export interface TalSegment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    bedA: number;
    bedB: number;
    wA: number;
    wB: number;
}

export interface Taeler {
    segmente: TalSegment[];
    imSee: Uint8Array;
    /** Zellen, durch die eine Flussachse oder Seefläche läuft, mit ihrem Talboden. */
    achse: Uint8Array;
    achseBoden: Float64Array;
}

export interface TalIndex {
    gitter: (TalSegment[] | undefined)[];
    zelle: number;
    originX: number;
    originY: number;
    w: number;
    h: number;
}

export interface TalOptionen {
    talbreite?: number | undefined;
    bachAnteil?: number | undefined;
    tiefe?: number | undefined;
    einschnitt?: number | undefined;
}

/** Smoothstep-Kern: 1 auf der Achse, 0 am Talrand (hydrologie.js#L974-981). */
export function ecosystemTalKern(u: number): number {
    if (u >= 1) {
        return 0;
    }
    const t = u < 0 ? 0 : u;
    return 1 - t * t * (3 - 2 * t);
}

// Fußpunkt der letzten Abfrage; statt eines Objekts je Aufruf (der Abzug fragt je Zelle dutzendfach).
let streckeD = 0;
let streckeT = 0;

/** Abstand zu einer Strecke und Parameter des Fußpunkts, nach `streckeD`/`streckeT` (hydrologie.js#L985-998). */
function ecosystemTalStrecke(px: number, py: number, ax: number, ay: number, bx: number, by: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    streckeD = Math.hypot(px - fx, py - fy);
    streckeT = t;
}

/**
 * Die Talsegmente mit Talboden je Punkt, die Seeflächen und die Achsen (hydrologie.js#L1008-1220).
 * Nur was in die Höhe eingeht; Legacys Diagnose (Spuren, Spiegel, geratene Richtungen) fehlt.
 */
export function baueEcosystemTaeler(
    r: Raster,
    hoehe: Float64Array,
    fluesse: readonly V12River[],
    seen: readonly V12Lake[],
    istImSee: ((index: number, x: number, y: number) => boolean) | null,
    opt: TalOptionen,
): Taeler {
    const breite = Number(opt.talbreite) > 0 ? Number(opt.talbreite) : ECOSYSTEM_HYDRO_TALBREITE;
    const bachAnteil = Number.isFinite(Number(opt.bachAnteil)) ? Number(opt.bachAnteil) : ECOSYSTEM_HYDRO_BACH_ANTEIL;
    const tiefe = Number.isFinite(Number(opt.tiefe)) ? Math.max(0, Math.min(1, Number(opt.tiefe))) : 1;
    const einschnitt = Number.isFinite(Number(opt.einschnitt))
        ? Math.max(0, Number(opt.einschnitt))
        : ECOSYSTEM_HYDRO_EINSCHNITT;
    const segmente: TalSegment[] = [];
    const imSee = new Uint8Array(r.w * r.hh);
    const achse = new Uint8Array(r.w * r.hh);
    const achseBoden = new Float64Array(r.w * r.hh);

    const lies = (x: number, y: number): number | null => {
        const i = r.i(x);
        const j = r.j(y);
        return i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i] ? null : (hoehe[j * r.w + i] as number);
    };

    // 1. Die Seen: Becken mit ebenem Spiegel auf dem Tiefstwert darunter.
    for (let sIndex = 0; sIndex < seen.length; sIndex++) {
        if (typeof istImSee !== "function") {
            break;
        }
        let tiefster = Infinity;
        let summe = 0;
        const zellen: number[] = [];
        for (let j = 0; j < r.hh; j++) {
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                if (!r.drin[k] || !istImSee(sIndex, r.x(i), r.y(j))) {
                    continue;
                }
                zellen.push(k);
                imSee[k] = 1;
                const v = hoehe[k] as number;
                summe += v;
                if (v < tiefster) {
                    tiefster = v;
                }
            }
        }
        if (!zellen.length || !Number.isFinite(tiefster)) {
            continue;
        }
        const mittel = summe / zellen.length;
        const niveau = Math.max(0, tiefe * tiefster + (1 - tiefe) * mittel);
        for (const k of zellen) {
            const i = k % r.w;
            const j = (k - i) / r.w;
            if (!achse[k] || niveau < (achseBoden[k] as number)) {
                achse[k] = 1;
                achseBoden[k] = niveau;
            }
            segmente.push({
                ax: r.x(i),
                ay: r.y(j),
                bx: r.x(i),
                by: r.y(j),
                bedA: niveau,
                bedB: niveau,
                wA: breite * ECOSYSTEM_HYDRO_SEEBECKEN,
                wB: breite * ECOSYSTEM_HYDRO_SEEBECKEN,
            });
        }
    }

    // 2. Die Flüsse: dicht abtasten, Richtung, kumulativer Tiefstwert mit gedeckeltem Einschnitt.
    for (const f of fluesse) {
        const dicht: [number, number][] = [];
        for (let n = 1; n < f.p.length; n++) {
            const [ax, ay] = f.p[n - 1] as [number, number];
            const [bx, by] = f.p[n] as [number, number];
            const stueck = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r.cell * 0.5)));
            for (let t = 0; t < stueck; t++) {
                dicht.push([ax + (bx - ax) * (t / stueck), ay + (by - ay) * (t / stueck)]);
            }
        }
        // Wie Legacy: ein Lauf ohne Punkte scheitert beim Zerlegen des leeren Endpunkts.
        dicht.push(f.p[f.p.length - 1] as [number, number]);
        const innen = dicht.filter(([x, y]) => lies(x, y) !== null);
        if (innen.length < 2) {
            continue;
        }
        let lauf = innen;
        if (f.dir === "reverse") {
            lauf = innen.slice().reverse();
        } else if (!f.dir) {
            const erster = lauf[0] as [number, number];
            const letzter = lauf[lauf.length - 1] as [number, number];
            const hA = lies(erster[0], erster[1]) || 0;
            const hB = lies(letzter[0], letzter[1]) || 0;
            if (hB > hA) {
                lauf = lauf.slice().reverse();
            }
        }
        const w = breite * (f.bach ? bachAnteil : 1);
        let boden = Infinity;
        const spur: [number, number][] = [];
        const boeden: number[] = [];
        for (const [x, y] of lauf) {
            const gelaende = lies(x, y);
            if (gelaende === null) {
                continue;
            }
            const i = r.i(x);
            const j = r.j(y);
            const k = j * r.w + i;
            // Ein Fluss im See ist der See: er übernimmt den Spiegel und schneidet nicht ein.
            if (imSee[k]) {
                boden = Math.min(boden, hoehe[k] as number);
            } else {
                boden = Math.min(boden, gelaende);
            }
            if (imSee[k]) {
                spur.push([x, y]);
                boeden.push(boden);
                continue;
            }
            const wirksam = Math.min(einschnitt, gelaende * (1 - ECOSYSTEM_HYDRO_TALSOHLE_REST));
            const eingegraben = gelaende - wirksam;
            boden = Math.min(boden, eingegraben);
            const ziel = tiefe >= 1 ? boden : Math.max(boden, (1 - tiefe) * gelaende);
            spur.push([x, y]);
            boeden.push(ziel);
        }
        if (spur.length < 2) {
            continue;
        }
        for (let n = 1; n < spur.length; n++) {
            const a = spur[n - 1] as [number, number];
            const b = spur[n] as [number, number];
            segmente.push({
                ax: a[0],
                ay: a[1],
                bx: b[0],
                by: b[1],
                bedA: boeden[n - 1] as number,
                bedB: boeden[n] as number,
                wA: w,
                wB: w,
            });
        }
        // Die Achse als Maske mit ihrem Talboden; im See gilt der Spiegel, sonst der tiefste Anspruch.
        for (let n = 0; n < spur.length; n++) {
            const p = spur[n] as [number, number];
            const i = r.i(p[0]);
            const j = r.j(p[1]);
            if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
                continue;
            }
            const k = j * r.w + i;
            if (!r.drin[k]) {
                continue;
            }
            if (imSee[k]) {
                continue;
            }
            const b = boeden[n] as number;
            if (!achse[k] || b < (achseBoden[k] as number)) {
                achse[k] = 1;
                achseBoden[k] = b;
            }
        }
    }

    return { segmente, imSee, achse, achseBoden };
}

/** Eimergitter über die Segmente, Zelle = größte Talbreite (hydrologie.js#L1224-1252). */
export function baueEcosystemTalIndex(segmente: readonly TalSegment[], bounds: V12Bounds): TalIndex {
    let maxW = 0;
    for (const seg of segmente) {
        if (seg.wA > maxW) {
            maxW = seg.wA;
        }
        if (seg.wB > maxW) {
            maxW = seg.wB;
        }
    }
    const zelle = Math.max(0.5, maxW);
    const originX = bounds.min_x - zelle;
    const originY = bounds.min_y - zelle;
    const w = Math.ceil((bounds.max_x - originX) / zelle) + 2;
    const h = Math.ceil((bounds.max_y - originY) / zelle) + 2;
    const gitter = new Array<TalSegment[] | undefined>(w * h);
    for (const seg of segmente) {
        const reich = Math.max(seg.wA, seg.wB);
        const i0 = Math.max(0, Math.floor((Math.min(seg.ax, seg.bx) - reich - originX) / zelle));
        const i1 = Math.min(w - 1, Math.floor((Math.max(seg.ax, seg.bx) + reich - originX) / zelle));
        const j0 = Math.max(0, Math.floor((Math.min(seg.ay, seg.by) - reich - originY) / zelle));
        const j1 = Math.min(h - 1, Math.floor((Math.max(seg.ay, seg.by) + reich - originY) / zelle));
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const key = j * w + i;
                let eimer = gitter[key];
                if (!eimer) {
                    eimer = [];
                    gitter[key] = eimer;
                }
                eimer.push(seg);
            }
        }
    }
    return { gitter, zelle, originX, originY, w, h };
}

/** Der tiefste Schnitt der Segmente in Reichweite, nie anhebend (hydrologie.js#L1296-1334). */
export function ecosystemTalAbzug(index: TalIndex | null, x: number, y: number, hoehe: number): number {
    if (!index || !(hoehe > 0)) {
        return 0;
    }
    const i = Math.floor((x - index.originX) / index.zelle);
    const j = Math.floor((y - index.originY) / index.zelle);
    if (i < 0 || j < 0 || i >= index.w || j >= index.h) {
        return 0;
    }
    let groesster = 0;
    for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= index.w || jj >= index.h) {
                continue;
            }
            const eimer = index.gitter[jj * index.w + ii];
            if (!eimer) {
                continue;
            }
            for (let n = 0; n < eimer.length; n++) {
                const seg = eimer[n] as TalSegment;
                ecosystemTalStrecke(x, y, seg.ax, seg.ay, seg.bx, seg.by);
                const d = streckeD;
                const t = streckeT;
                const w = seg.wA + (seg.wB - seg.wA) * t;
                if (!(w > 0) || d >= w) {
                    continue;
                }
                const bed = seg.bedA + (seg.bedB - seg.bedA) * t;
                const schnitt = ecosystemTalKern(d / w) * Math.max(0, hoehe - bed);
                if (schnitt > groesster) {
                    groesster = schnitt;
                }
            }
        }
    }
    return groesster;
}
