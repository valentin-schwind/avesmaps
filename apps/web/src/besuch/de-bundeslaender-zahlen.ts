/**
 * Wo die Zahl eines Bundeslands auf der Herkunftskarte steht, in den Koordinaten von `DE_VIEWBOX`.
 *
 * Von Hand gesetzt, nicht aus den Umrissen errechnet: Die Mitte Brandenburgs ist Berlin, die Mitte Niedersachsens liegt neben
 * Bremen. Bremen, Hamburg und Berlin sind zu klein für ihre Zahl; sie steht daneben, ein Strich (`zu`) führt zur Fläche.
 */
export interface LandZahlOrt {
    readonly x: number;
    readonly y: number;
    /** Der Punkt in der Fläche, zu dem ein Strich von der Zahl führt. */
    readonly zu?: readonly [number, number];
}

export const DE_ZAHLEN_ORTE: Readonly<Record<string, LandZahlOrt>> = {
    BB: { x: 231, y: 153 },
    BE: { x: 231, y: 104, zu: [231, 124] },
    BW: { x: 100, y: 315 },
    BY: { x: 171, y: 296 },
    HB: { x: 71, y: 82, zu: [90, 96] },
    HE: { x: 100, y: 217 },
    HH: { x: 133, y: 98, zu: [129, 77] },
    MV: { x: 202, y: 68 },
    NI: { x: 124, y: 128 },
    NW: { x: 55, y: 175 },
    RP: { x: 50, y: 240 },
    SH: { x: 124, y: 47 },
    SL: { x: 36, y: 276 },
    SN: { x: 229, y: 196 },
    ST: { x: 180, y: 150 },
    TH: { x: 159, y: 203 },
};
