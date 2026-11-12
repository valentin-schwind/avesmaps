/**
 * Phasenzeiten des Rückennetzes durch Differenzen (WI-0250 Phase B). Die Rechnung hat keinen Rückruf je Phase; sie hat aber zwei Schalter,
 * die ihre Teile trennen: `stufe` („grundform“: Netz und Hebung, „landschaft“: dazu Täler, Erosion, Pässe, Senkenfüllung) und `talbodenFest`
 * (ohne ihn sucht die Rechnung den Talboden mit mehreren Probeläufen auf gröberem Gitter). Mit dem gefundenen Talboden als festem Wert
 * rechnet sie dasselbe Ergebnis ohne Suche; darum gilt
 *
 *   netz_hebung         = Zeit(grundform, Talboden fest)
 *   landschaft          = Zeit(landschaft, Talboden fest) − netz_hebung
 *   talboden_ableitung  = Zeit(wie im Hauptlauf, mit Suche)  − Zeit(landschaft, Talboden fest)      (nur wenn der Hauptlauf sucht)
 *
 * Jede Probe läuft `wiederholungen`-mal im selben Prozess, gewertet wird der Median; da sie nach dem Hauptlauf laufen, sind Module und JIT warm. Die Proben laufen
 * NACH dem Hauptlauf und ändern ihn nicht. Gleicht das Ergebnis der letzten Probe nicht dem des Hauptlaufs, steht `ergebnis_gleich: false`
 * im Bericht: dann bildet die Probe nicht nach, was der Hauptlauf rechnet, und die Anteile gelten nicht.
 */
import { messe, median, runde } from "./messung.ts";
import { samplesFingerprint, schritteZuSamples } from "./austausch.ts";
import type { Eingabe, Generator, RueckenErgebnis } from "./generator.ts";

export interface PhasenBericht {
    methode: "differenz";
    wiederholungen: number;
    /** Median der Rohzeiten je Probe (ms). */
    proben_ms: Record<string, number>;
    /** Anteile der Phasen (ms), aus den Differenzen; negative Werte (Rauschen) sind auf 0 gesetzt, die Rohzeiten stehen darüber. */
    phasen_ms: Record<string, number>;
    ergebnis_gleich: boolean | null;
    hinweise: string[];
}

export interface PhasenAuftrag {
    gen: Generator;
    eingabe: Eingabe;
    /** Das Argument `typ` der Rechnung: `{ struktur, form }` aus `rueckennetzRegler`. */
    typ: unknown;
    /** Die Optionen des Hauptlaufs (ohne `stufe`). */
    optionen: Record<string, unknown>;
    /** Sucht der Hauptlauf den Talboden? */
    sucht: boolean;
    /** Der Talboden, den der Hauptlauf fand oder setzte. */
    talboden: number;
    /** Fingerabdruck der Samples des Hauptlaufs, gegen den die letzte Probe geprüft wird. */
    hauptFingerprint: string;
    wiederholungen: number;
    /** Das Ergebnis des Hauptlaufs ist Float32 (die Vorschau gibt `Float32Array.from(h)` zurück): Die Probe rundet für den Vergleich ebenso, sonst trennt ein Wert dicht bei x,5 beide Fingerabdrücke. */
    alsFloat32?: boolean;
}

async function probe(
    p: PhasenAuftrag,
    optionen: Record<string, unknown>,
): Promise<{ ms: number; ergebnis: RueckenErgebnis }> {
    const zeiten: number[] = [];
    let ergebnis: RueckenErgebnis | null = null;
    for (let i = 0; i < p.wiederholungen; i++) {
        const { wert, messung } = await messe(() => p.gen.gebirge.rechneRueckennetz(p.eingabe, p.typ, optionen));
        ergebnis = wert;
        zeiten.push(messung.wall_ms);
    }
    return { ms: median(zeiten), ergebnis: ergebnis as RueckenErgebnis };
}

export async function messePhasen(p: PhasenAuftrag): Promise<PhasenBericht> {
    const fest = { ...p.optionen, hypsometrie: false, talbodenFest: p.talboden };
    const hinweise: string[] = [];
    const grund = await probe(p, { ...fest, stufe: "grundform" });
    const land = await probe(p, { ...fest, stufe: "landschaft" });
    const proben_ms: Record<string, number> = { grundform_talboden_fest: grund.ms, landschaft_talboden_fest: land.ms };
    let letzte = land.ergebnis;
    const phasen: Record<string, number> = {};
    const rein = (name: string, wert: number): void => {
        if (wert < 0) hinweise.push(`${name}: Differenz ${runde(wert, 1)} ms negativ (Rauschen), auf 0 gesetzt`);
        phasen[name] = runde(Math.max(0, wert), 1);
    };
    rein("netz_hebung", grund.ms);
    rein("landschaft", land.ms - grund.ms);
    if (p.sucht) {
        const voll = await probe(p, { ...p.optionen, stufe: "landschaft" });
        proben_ms["landschaft_mit_suche"] = voll.ms;
        rein("talboden_ableitung", voll.ms - land.ms);
        letzte = voll.ergebnis;
    }
    const h = p.alsFloat32 ? Float32Array.from(letzte.h) : letzte.h;
    const gleich = samplesFingerprint(schritteZuSamples(h, letzte.eigen)) === p.hauptFingerprint;
    if (!gleich) hinweise.push("Die Probe rechnet nicht dasselbe wie der Hauptlauf; die Anteile gelten nicht.");
    return {
        methode: "differenz",
        wiederholungen: p.wiederholungen,
        proben_ms,
        phasen_ms: phasen,
        ergebnis_gleich: gleich,
        hinweise,
    };
}
