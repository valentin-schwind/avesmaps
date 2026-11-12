/**
 * Beobachter des Domain-Geländes (WI-0249 P1, Diagnose; für Phasenzeiten auch im Terrain-Lab, WI-0250).
 *
 * Ein optionaler Rückruf bekommt nach jeder Phase eine Sicht auf das Höhenfeld, wie es in diesem Moment ist. Er rechnet nichts mit,
 * legt keine Kopie an und ändert keine Reihenfolge: Ohne Beobachter rechnet jeder Schritt Zeichen für Zeichen wie zuvor
 * (`domain-terrain-beobachter.test.ts`, Fingerabdruck gleich), und mit ihm auch, solange er nur liest.
 *
 * Regeln für den Beobachter:
 * - **Nur lesen.** `hoehe` ist das Arbeitsfeld des Laufs (bei Erosion mit Workern im gemeinsamen Speicher). Wer etwas behalten will,
 *   kopiert den Ausschnitt, den er braucht; die Sicht gilt nur während des Aufrufs.
 * - **Kurz bleiben.** Er läuft im Hauptthread zwischen zwei Schritten; die Zeit zwischen zwei Aufrufen ist die Zeit der Phase.
 *
 * Phasen in ihrer Folge (Gitter = Zeile 0 im Norden, gespeichert = Zeile 0 im Süden):
 *
 * | Phase | Feld | Was davor geschah |
 * |---|---|---|
 * | `landforms` | Gitter, Float32 | Kontinentwölbung, Wasser, Landformen; noch ohne Gebirgssaaten |
 * | `initial` | Gitter, Float32 | Saaten eingebettet (`initial-terrain.ts`), dazu ein übernommenes Anfangsgelände (WI-0223) |
 * | `seed` | Gitter, Float32 | Gipfelsaaten, Gipfelkerne, Seespiegel: das Feld, mit dem die Erosion beginnt |
 * | `erosion-<r>/stream` | Gitter, Float32 | Runde r (ab 1): Einschneiden (Stream Power) |
 * | `erosion-<r>/diffusion` | Gitter, Float32 | Runde r: Hangdiffusion |
 * | `erosion-<r>/uplift` | Gitter, Float32 | Runde r: Rückverteilung des Verlusts (domainweit oder regional) |
 * | `erosion` | Gitter, Float32 | nach der letzten Runde die Gipfelkerne wieder gesetzt |
 * | `mountain-interior` | gespeichert, Uint16 | Gebirgsinneres (V12-Gebirge; Rückennetz-Gebirge lässt es aus) |
 * | `constraints/water` | gespeichert, Uint16 | Schlussschritte: Flüsse eingebrannt, Seen eben (grob und fein je einmal) |
 * | `constraints/cap` | gespeichert, Uint16 | Rückennetz-Gebirge auf ihre Kammhöhe gedeckelt |
 * | `constraints/summits` | gespeichert, Uint16 | Gipfelformen und -kerne gesetzt: das fertige Raster dieser Stufe |
 * | `fine-tiles` | gespeichert, Uint16 | feine Stufe zusammengesetzt (8192²), vor ihren Schlussschritten |
 *
 * Die Schlussschritte laufen je Stufe einmal; `n` sagt, welche (grob 4096², fein 8192²). Ein Beobachter, der eine Phase nicht kennt,
 * übergeht sie: Neue Phasen dürfen hinzukommen.
 */
export interface HoehenSicht {
    /** Seitenlänge des Gitters in Zellen. */
    n: number;
    /** Zellweite in Karteneinheiten. */
    cell: number;
    /** Wo Zeile 0 liegt: im Gitter der Erosion im Norden, im gespeicherten Raster im Süden. */
    zeile0: "nord" | "sued";
    /** Höhe in Schritt, n · n Werte, zeilenweise. Nur lesen. */
    hoehe: Float32Array | Uint16Array;
}

export type HoehenBeobachter = (phase: string, sicht: HoehenSicht) => void;

/** Die Sicht auf ein Feld im Gitter der Erosion (Zeile 0 im Norden). */
export function gitterSicht(g: { n: number; cell: number }, hoehe: Float32Array): HoehenSicht {
    return { n: g.n, cell: g.cell, zeile0: "nord", hoehe };
}

/** Die Sicht auf ein gespeichertes Raster (Zeile 0 im Süden). */
export function rasterSicht(raster: { width: number; cell: number; samples: Uint16Array }): HoehenSicht {
    return { n: raster.width, cell: raster.cell, zeile0: "sued", hoehe: raster.samples };
}
