// Über den Unterpfad, nicht den Hauptindex: der zöge das ganze Paket samt TypeBox in den Worker (gemessen 2026-10-18: 503 KB statt 18 KB, minifiziert).
import {
    buildMountainRaster,
    gebirgsRegler,
    rechneRueckennetz,
    rechnetRueckennetz,
    rueckennetzRegler,
} from "@avesmaps3d/shared/gebirge";
import type { VorschauAuftrag, VorschauErgebnis } from "./auftrag";

/**
 * Die Rechnung der Gebirge-Vorschau (WI-0226, Betreiber F9: „Vorschau nur Gebirge“): die Grundform eines Gebirges mit der V12 des Geländes,
 * grob. Läuft im Worker (`vorschau-worker.ts`), nie im Hauptbündel; gezeichnet wird in der Oberfläche (WI-0178).
 *
 * 🪤 Sie zeigt die Grundform (die Saat), nicht das fertige Gelände: Danach kommen im Höhenmodell Glättung, Vorland, Hebung, Erosion und
 * Gipfelform. Die Oberfläche sagt das so dazu.
 */

/** Für das breite Eigenschaftsbild bis 0,1 E; nur Vorschau im Worker, keine Änderung am gespeicherten Gelände. */
const ZELLE_MIN = 0.1;

export function rechneVorschau(auftrag: VorschauAuftrag): VorschauErgebnis {
    const start = performance.now();
    const netz = auftrag.rueckennetz;
    // Mit Ausschnitt zählen die Zellen über dem Rahmen (nur im Rückennetz).
    const b = netz !== undefined && auftrag.ausschnitt !== undefined ? auftrag.ausschnitt : auftrag.eingabe.bounds;
    const faktor = auftrag.aufloesung ?? 1;
    // 1× bleibt der bisherige tatsächlich berechnete Stand (das gemeinsame Raster klemmte auf 0,25 E).
    const zelleMin = Math.max(0.25, ZELLE_MIN) / faktor;
    const zelle = Math.max(
        zelleMin,
        Math.max(b.max_x - b.min_x, b.max_y - b.min_y) / Math.max(1, auftrag.kante * faktor),
    );
    const regler = gebirgsRegler(auftrag.preset, auftrag.stand, auftrag.grundhoehe);
    const r = netz === undefined ? null : rueckennetzRegler(netz.gruppe, netz.typ, netz.modell);
    // Dieselbe Weiche wie das Gelände (`rechnetRueckennetz`): mit Kamm, Tal oder Mulde, mit Köpfen auch nur mit Nebengipfeln (WI-0249 P2).
    if (netz !== undefined && r !== null && rechnetRueckennetz(netz, r.form.kopf)) {
        // Das Rückennetz (WI-0245 D4): dieselben Regler wie das Gelände (`rueckennetzRegler`), der Talboden fest, wenn er bekannt ist.
        const talbodenFest = netz.talbodenFest ?? r.talbodenFest ?? undefined;
        const ergebnis = rechneRueckennetz(
            {
                ...auftrag.eingabe,
                regler,
                zelle,
                vorschauZelleMin: zelleMin,
                // Eigene Höhen an Flüssen und Seen (WI-0249): nur mit Einträgen, sonst die Eingabe wie zuvor.
                ...(netz.flussHoehen?.length ? { flussHoehen: netz.flussHoehen } : {}),
                ...(netz.seeHoehen?.length ? { seeHoehen: netz.seeHoehen } : {}),
            },
            { struktur: r.struktur, form: r.form },
            {
                kaemme: netz.kaemme,
                nebengipfel: netz.nebengipfel.map((n) => ({ x: n.x, y: n.y, ...(n.h === null ? {} : { h: n.h }) })),
                mulden: (netz.mulden ?? []).map((n) => ({ x: n.x, y: n.y, ...(n.h === null ? {} : { h: n.h }) })),
                stufe: "landschaft",
                hypsometrie: talbodenFest === undefined && netz.ableiten,
                talbodenFest,
                band: r.band,
                gratMin: r.gratMin,
                // Fassung 19: Die Höhen der Nebengipfel und Mulden verschieben den Talboden nicht, wie im Gelände.
                ...(r.punktHoehenAbsolut ? { punktHoehenAbsolut: true } : {}),
                ...(auftrag.ausschnitt === undefined ? {} : { ausschnitt: auftrag.ausschnitt }),
            },
        );
        return {
            w: ergebnis.w,
            hh: ergebnis.hh,
            cell: ergebnis.cell,
            bounds: ergebnis.bounds,
            eigen: ergebnis.eigen,
            h: Float32Array.from(ergebnis.h),
            ms: performance.now() - start,
            talboden: ergebnis.talboden,
        };
    }
    const raster = buildMountainRaster({ ...auftrag.eingabe, regler, zelle, vorschauZelleMin: zelleMin });
    return {
        w: raster.w,
        hh: raster.hh,
        cell: raster.cell,
        bounds: raster.bounds,
        eigen: raster.eigen,
        h: Float32Array.from(raster.h),
        ms: performance.now() - start,
    };
}
