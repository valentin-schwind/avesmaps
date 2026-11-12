/**
 * Die kleinen Linienzeichen des Formulars „Eigenes Bild hinzufügen“ und seiner Bestätigung (WI-0272, Entwurf 8): dort, wo es kein gemaltes Symbol des Hauses gibt
 * (Chips, ⓘ, Upload, Pfeil der Auswahl, Haken, Kopieren, die Zustandsmarken der Liste). Eine Zeichnung je Name auf einem Raster von 24 × 24, Strich in der Farbe der Umgebung (`currentColor`),
 * einheitlich 1,75 Einheiten stark; die Größe setzt der Aufrufer. Die Formen (Lucide) stehen als Daten da, nie als Zeichenkette, die ein `v-html` einhängen müsste.
 *
 * Die gemalten Symbole (Nadel, Papier und Feder, Kompass, Feder, Bild machen, Link teilen) liegen als Bilder unter `public/icons/` und stehen in `REISEBILD_SYMBOLE`.
 */

export type LinienForm =
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

const pfad = (d: string): LinienForm => ({ art: "pfad", d });
const kreis = (cx: number, cy: number, r: number): LinienForm => ({ art: "kreis", cx, cy, r });

export const LINIEN_ZEICHEN = {
    pinsel: [
        pfad("m11 10 3 3"),
        pfad("M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"),
        pfad("M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"),
    ],
    kamera: [
        pfad("M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"),
        kreis(12, 13, 3),
    ],
    roboter: [
        pfad("M12 8V4H8"),
        { art: "rechteck", x: 4, y: 8, w: 16, h: 12, rx: 2 },
        pfad("M2 14h2M20 14h2M15 13v2M9 13v2"),
    ],
    /** „Ohne KI“: der Roboter, durchgestrichen. */
    roboterAus: [
        pfad("M13.67 8H18a2 2 0 0 1 2 2v4.33"),
        pfad("M2 14h2M20 14h2M22 22 2 2"),
        pfad("M8 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 1.414-.586"),
        pfad("M9 13v2M9.67 4H12v2.33"),
    ],
    /** „Reisebilder ausblenden“: das Auge, durchgestrichen. */
    augeAus: [
        pfad("M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"),
        pfad("M14.084 14.158a3 3 0 0 1-4.242-4.242"),
        pfad("M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"),
        pfad("m2 2 20 20"),
    ],
    karte: [
        pfad(
            "M14.1 5.55a2 2 0 0 0 1.8 0l3.65-1.83a1 1 0 0 1 1.45.9v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.65 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9L8.1 3.45a2 2 0 0 1 1.8 0z",
        ),
        pfad("M15 5.76v15M9 3.24v15"),
    ],
    welt: [kreis(12, 12, 10), pfad("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20")],
    leute: [
        pfad("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
        kreis(9, 7, 4),
        pfad("M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"),
    ],
    frage: [kreis(12, 12, 10), pfad("M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"), pfad("M12 17h.01")],
    gluehbirne: [
        pfad("M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"),
        pfad("M9 18h6M10 22h4"),
    ],
    daumen: [
        pfad("M7 10v12"),
        pfad(
            "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
        ),
    ],
    sprechblase: [pfad("M7.9 20A9 9 0 1 0 4 16.1L2 22Z")],
    warndreieck: [
        pfad("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"),
        pfad("M12 9v4M12 17h.01"),
    ],
    link: [
        pfad("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
        pfad("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
    ],
    hochladen: [pfad("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), pfad("m17 8-5-5-5 5M12 3v12")],
    info: [kreis(12, 12, 10), pfad("M12 16v-4M12 8h.01")],
    // Das Senden (WI-0279, Meldeformular): ein Papierflieger.
    senden: [pfad("M4 12 20 4l-5 16-3-7-8-1Z"), pfad("m12 13 3-3")],
    pfeil: [pfad("m6 9 6 6 6-6")],
    haken: [pfad("M20 6 9 17l-5-5")],
    plus: [pfad("M12 5v14M5 12h14")],
    // Die Zustandsmarken von „Meine Reisebilder“ (Entwurf 9): abgelehnt, zurückgezogen, offline genommen.
    kreuz: [pfad("M18 6 6 18M6 6l12 12")],
    zurueck: [pfad("M9 14 4 9l5-5"), pfad("M4 9h10.5a5.5 5.5 0 0 1 0 11H11")],
    offline: [
        pfad(
            "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M9.88 9.88a3 3 0 1 0 4.24 4.24M2 2l20 20",
        ),
    ],
    kopie: [
        { art: "rechteck", x: 8, y: 8, w: 13, h: 13, rx: 2 },
        pfad("M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"),
    ],
} as const satisfies Record<string, readonly LinienForm[]>;

export type LinienZeichen = keyof typeof LINIEN_ZEICHEN;

/** „Entstanden als“: ein Zeichen je Art. */
export const ENTSTEHUNG_ZEICHEN = {
    drawing: "pinsel",
    photo: "kamera",
    ai_generated: "roboter",
    avesmaps_capture: "karte",
} as const satisfies Record<string, LinienZeichen>;

/** „Nutzung“: ein Zeichen je Wahl. */
export const NUTZUNG_ZEICHEN = {
    avesmaps_only: "welt",
    "cc-by-4.0": "leute",
} as const satisfies Record<string, LinienZeichen>;

/** Die gemalten Symbole des Hauses (80 × 80, `bildmachen` und `linkteilen` größer für scharfe Darstellung). Die ersten beiden gibt es schon, die übrigen kamen mit Entwurf 8 dazu. */
export const REISEBILD_SYMBOLE = {
    pin: "/icons/reisebild/pin.webp",
    papierundfeder: "/icons/reisebild/papierundfeder.webp",
    kompass: "/icons/route/compass.webp",
    feder: "/icons/menu/feder.webp",
    bildmachen: "/icons/reisebild/bildmachen-gross.webp",
    linkteilen: "/icons/reisebild/linkteilen.webp",
    /** Der Stapel gemalter Karten (Kartenmenü, Datenschutz, „Meine Reisebilder“); liegt seit dem Katalogfenster unter `icons/menu/`. */
    kartensammlung: "/icons/menu/kartensammlung.webp",
    /** Die Schriftrolle mit Karte für die Datei-Ablage von „Karte vorschlagen“ (160 × 160, Randpunkte unter 12 % Deckkraft entfernt). */
    karteHochladen: "/icons/menu/karte-hochladen.webp",
    /** Das Kontaktformular: Schreibfläche, Mailfeld und Sendeknopf, „Worum geht es?“ (160 × 160). */
    federUndPapier: "/icons/menu/feder-und-papier.webp",
    brief: "/icons/menu/brief.webp",
    wegweiser: "/icons/menu/wegweiser.webp",
} as const;

export type ReisebildSymbol = keyof typeof REISEBILD_SYMBOLE;
