import type { Gpu, Kern } from "./kern";
import { stroemungsSchritt, wetterSchritt } from "./simulation";

/**
 * Takt der Rechnung: höchstens 30 Schritte je Sekunde, jeder auf zwei Bilder verteilt. Ein schneller Bildschirm rechnet so nicht öfter,
 * und kein Bild trägt die ganze Last. Auf langsamen Rechnern senkt die Automatik den Takt, wenn die Wolkenauflösung schon unten ist. Das
 * Rauschen der Wolken gleitet zwischen den Schritten weiter.
 */
export function taktSchritt(k: Kern, g: Gpu, simDt: number, raw: number): void {
    k.taktRest += simDt;
    k.taktWarte += raw;
    const takt = k.TAKTE[k.taktStufe]!;
    if (k.phase === 1) {
        wetterSchritt(k, g, k.taktDt);
        k.phase = 0;
    } else if (k.taktRest > 0 && k.taktWarte >= takt * 0.9) {
        k.taktDt = k.taktRest;
        k.taktRest = 0;
        k.taktWarte = Math.min(k.taktWarte - takt, takt);
        stroemungsSchritt(k, g, k.taktDt);
        k.phase = 1;
    }
}

/** Die Bildrate und ihre Messfenster; `settle` Bilder nach einem Wechsel zählen nicht. */
export interface Automatik {
    upBlockUntil: number;
    settle: number;
    rateAcc: number;
    rateN: number;
    fpsN: number;
    fpsT: number;
    fps: number;
}

export const neueAutomatik = (): Automatik => ({
    upBlockUntil: 0,
    settle: 90,
    rateAcc: 0,
    rateN: 0,
    fpsN: 0,
    fpsT: performance.now(),
    fps: 0,
});

/**
 * Nach jedem Bild: Mit `res: "auto"` senkt die Automatik erst die Wolkenauflösung (bis `resMin`), unten dann den Takt der Rechnung, und
 * nimmt beides in umgekehrter Folge zurück. Mit fester Auflösung läuft der volle Takt.
 */
export function bildGezaehlt(k: Kern, a: Automatik, raw: number, jetzt: number): void {
    const cfg = k.cfg;
    a.fpsN++;
    a.settle--;
    if (raw < 0.5 && a.settle < 0) {
        a.rateAcc += raw;
        a.rateN++;
    }
    if (a.rateN >= 24) {
        const avg = a.rateAcc / a.rateN;
        a.rateAcc = 0;
        a.rateN = 0;
        if (cfg.res === "auto") {
            if (avg > 1 / cfg.fpsGrob && (k.resLevel > 0 || k.taktStufe < k.TAKTE.length - 1)) {
                if (k.resLevel > 0) k.resLevel--;
                else k.taktStufe++;
                a.upBlockUntil = jetzt + 20000;
                a.settle = 20;
            } else if (
                avg < 1 / cfg.fpsFein &&
                (k.taktStufe > 0 || k.resLevel < k.RES_LEVELS.length - 1) &&
                jetzt > a.upBlockUntil
            ) {
                if (k.taktStufe > 0) k.taktStufe--;
                else k.resLevel++;
                a.upBlockUntil = jetzt + 1500;
                a.settle = 20;
            }
        } else k.taktStufe = 0;
    }
    if (jetzt - a.fpsT > 700) {
        a.fps = Math.round((a.fpsN * 1000) / (jetzt - a.fpsT));
        a.fpsN = 0;
        a.fpsT = jetzt;
    }
}
