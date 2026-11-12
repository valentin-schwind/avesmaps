/**
 * Großzügige Wartegrenzen unter Last (Betreiber 2026-10-29: „aber lastprobleme solllten dynamischer oder großzügiger sein, wir haben
 * viel traffic“). Playwright wartet nur, bis der Zustand da ist: Eine höhere Grenze macht einen grünen Lauf nicht langsamer, sie hält nur
 * einen belasteten Rechner (Release-Lauf neben Sitzungen und Prüfbank) davon ab, einen Fall rot zu machen. Am 2026-10-29 wartete
 * `openMap` im Release-Lauf 30 s auf die Karte und gab auf; derselbe Fall war im Lauf davor grün.
 *
 * `E2E_ZEITFAKTOR` gewinnt; sonst 3 in einem Lauf ohne Bildschirmbegleitung (`CI=1`, so startet der Release-Runner seine Schritte), am
 * Arbeitsplatz 1, damit ein echter Hänger beim Entwickeln schnell sichtbar bleibt.
 */
const angegeben = Number(process.env["E2E_ZEITFAKTOR"]);
export const ZEITFAKTOR = Number.isFinite(angegeben) && angegeben >= 1 ? angegeben : process.env["CI"] === "1" ? 3 : 1;

/** Eine Wartegrenze in Millisekunden, mit dem Zeitfaktor dieses Laufs. */
export const zeit = (ms: number): number => Math.round(ms * ZEITFAKTOR);
