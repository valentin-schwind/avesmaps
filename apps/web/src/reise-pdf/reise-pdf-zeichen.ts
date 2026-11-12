/**
 * Die Linienzeichen des Fensters „Reise als PDF“ (WI-0306, Entwurf Fassung 6): die Kacheln und der Hauptknopf. Raster 24 × 24, Strich in der
 * Farbe der Umgebung (`currentColor`). Die Formen stehen als Daten da, nie als Zeichenkette für `v-html`. Das Zeichen des Knopfs in der
 * Reiseübersicht steht fest gezeichnet in `reise-pdf-knopf-zeichen.vue` (Start-JS).
 */

export type PdfForm =
    | { readonly art: "pfad"; readonly d: string }
    | { readonly art: "kreis"; readonly cx: number; readonly cy: number; readonly r: number }
    | {
          readonly art: "rechteck";
          readonly x: number;
          readonly y: number;
          readonly w: number;
          readonly h: number;
          readonly rx: number;
      };

const pfad = (d: string): PdfForm => ({ art: "pfad", d });
const kreis = (cx: number, cy: number, r: number): PdfForm => ({ art: "kreis", cx, cy, r });
const rechteck = (x: number, y: number, w: number, h: number, rx: number): PdfForm => ({
    art: "rechteck",
    x,
    y,
    w,
    h,
    rx,
});

export const PDF_ZEICHEN = {
    etappen: [pfad("M5 19c4-1 2-7 7-8s3-5 7-6"), kreis(5, 19, 1.6), kreis(19, 5, 1.6)],
    profil: [pfad("M3 19 9 9l4 5 3-4 5 9z")],
    kosten: [kreis(9, 10, 5), kreis(15, 14, 5)],
    schiffe: [pfad("M4 15h16l-2 4H6zM12 4v11M12 5l6 8h-6")],
    gebiete: [pfad("M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2z"), pfad("M9 3v16M15 5v16")],
    unterwegs: [pfad("M12 21s-6-5-6-10a6 6 0 0 1 12 0c0 5-6 10-6 10z"), kreis(12, 11, 2)],
    tagebuch: [pfad("M6 3h11a1 1 0 0 1 1 1v17H7a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z"), pfad("M9 8h6M9 12h6")],
    qr: [pfad("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2")],
    route: [kreis(5, 18, 2), kreis(19, 6, 2), pfad("M6.6 16.6c3-2 1-6 5-7s3.6-1.8 5.8-2.4")],
    ausschnitt: [rechteck(3, 5, 18, 13, 1.5), pfad("M8 21h8")],
    ohne: [rechteck(3, 5, 18, 14, 1.5), pfad("M4 19 20 5")],
    pergament: [pfad("M5 4c3 1 11 1 14 0v15c-3 1.2-11 1.2-14 0z"), pfad("M8 9h8M8 12h8M8 15h5")],
    weiss: [rechteck(5, 3, 14, 18, 1), pfad("M12 9v6M9 12h6")],
    papier: [pfad("M6 3h8l4 4v14H6z"), pfad("M14 3v4h4")],
    herunterladen: [pfad("M12 4v11"), pfad("m7 10 5 5 5-5"), pfad("M5 20h14")],
} as const satisfies Record<string, readonly PdfForm[]>;

export type PdfZeichenName = keyof typeof PDF_ZEICHEN;
