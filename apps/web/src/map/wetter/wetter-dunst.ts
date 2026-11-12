import { dunstAnteil, type DunstLage } from "../atmosphere/dunst-tiefe";

/**
 * Das Wetter weicht dem Dunst (WI-0288; Betreiber 2026-11-08: „inkonsistent, dass labels z.b. ‚Orkland‘ im Dunst verschwindet und die Wind-Icons wie
 * ‚Firunsatem‘ nicht. außerdem geht beim blick in die ferne die GPU-lautstärke hoch, vielleicht wärs sinnvoll auf distanz aus- und den dunst einzublenden“).
 *
 * - Gemessen wird am Dunst des Geländes (`dunst-tiefe.ts`), als Anteil an seinem Höchstwert (`staerke`): Wolken, Wind- und Niederschlagsteilchen,
 *   Bodeneffekte, Wolkenschatten und Icons vergehen zwischen `ab` und `weg`. Flacher als der Beginn des Dunsts (`ab` der Kulisse) bleibt alles, wie es war.
 * - Die Wolken tragen denselben Dunst wie das Gelände in ihrer Tiefe (vorher ein eigener bis 100 %, darum blasser als das Land) und enden dort, wo
 *   nichts mehr übrig ist: Hinter `weg` marschiert kein Strahl mehr (Shader `DUNST`, `dunstEnde`).
 * - **Flach am Horizont** (Befund mit WI-0290, Stage in Valis Lage): Strahlen knapp unter oder über dem Horizont laufen sehr lang durch die Wolkenschicht
 *   und legen sie als flache Decke vor das dunstige ferne Land. Wolken in diesem Streifen gehen nach ihrer mittleren Tiefe in der Deckung zurück
 *   (zwischen `flachAb` und `flachWeg` Einheiten), voll bis `flachVoll` (Sinus des Winkels unter dem Horizont), gar nicht ab `flachAus`; Strahlen ganz im
 *   Streifen enden bei `flachWeg`. Lichtstrahlen und Regenschleier weichen ebenso.
 * - 🪤 **Die weißen Striche am Horizont** waren die Schneedecke: Streifende Strahlen finden das ferne Gelände nicht (`bodenTreffer`, 64 Schritte) und landen
 *   auf Meereshöhe weit dahinter; unter einem hohen, verschneiten Gebirge malte der Schnee dort einen Strich. Sie trägt darum den Dunst ihrer Tiefe.
 *   Ausgeblendet wird sie seit 2026-11-09 nicht mehr (Betreiber: „ab bestimmten winkeln (ab zoom 4) wird die schnee- und wolkendecke abgeschnitten.
 *   kannst du das bei der schneedecke lassen“).
 * - **Wolken früher** (Betreiber 2026-11-09, Gareth bei Zoom 6 und 75°: „der haze ist viel zu stark“, auf die Frage nach den fernen Wolken „Ja,
 *   früher weg“; danach „bei der wolkendecke noch ein bisschen nach hinten verlagern“): Wolken, ihre Schatten, Lichtstrahlen und Regenschleier
 *   vergehen zwischen `wolkenAb` und `wolkenWeg`; dort endet auch ihr Marsch (`dunstEnde`). Icons und Teilchen bleiben bei `ab`/`weg`.
 * - 🔴 Dieselbe Regel im Shader (`engine/shader/bausteine.ts`, `wetterSicht`, `wolkenSicht`) und hier für die Icons; die Zahlen kommen nur von hier.
 */
export const WETTER_WEICHT = {
    ab: 0.15,
    weg: 0.5,
    wolkenAb: 0.12,
    wolkenWeg: 0.4,
    flachVoll: 0.01,
    flachAus: 0.05,
    flachAb: 0,
    flachWeg: 20,
} as const;

/** Wie sichtbar das Wetter an einer Stelle der Welt ist, 1 bis 0. Ohne Lage oder ohne Dunst ganz. */
export function wetterSichtbar(lage: DunstLage | undefined, x: number, y: number, z: number): number {
    if (lage === undefined || lage.staerke <= 0) return 1;
    const anteil = dunstAnteil(lage, x, y, z) / lage.staerke;
    const t = Math.min(1, Math.max(0, (anteil - WETTER_WEICHT.ab) / (WETTER_WEICHT.weg - WETTER_WEICHT.ab)));
    return 1 - t * t * (3 - 2 * t);
}

/** Die Uniforms des Shader-Bausteins `DUNST`; ohne Lage kein Dunst (Deckkraft 0). */
export function dunstUniforms(lage: DunstLage | undefined): {
    uDZ: [number, number, number, number];
    uDL: [number, number, number, number];
    uDW: [number, number, number];
    uDF: [number, number, number, number];
    uDC: [number, number];
} {
    const { ab, weg, wolkenAb, wolkenWeg, flachVoll, flachAus, flachAb, flachWeg } = WETTER_WEICHT;
    const uDF: [number, number, number, number] = [flachVoll, flachAus, flachAb, flachWeg];
    const uDC: [number, number] = [wolkenAb, wolkenWeg];
    if (lage === undefined) return { uDZ: [0, 0, 0, 1], uDL: [1, 2, 0, 0], uDW: [0, ab, weg], uDF, uDC };
    return {
        uDZ: [...lage.zeile],
        uDL: [lage.nah, lage.fern, lage.beginn, lage.deckkraft],
        uDW: [lage.staerke, ab, weg],
        uDF,
        uDC,
    };
}
