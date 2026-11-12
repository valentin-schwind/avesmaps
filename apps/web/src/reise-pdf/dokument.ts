import { canonColour } from "@avesmaps3d/shared";
import type { Domain } from "../route-planner/planner-model";
import {
    seitenMasse,
    type Format,
    type Inhalt as InhaltName,
    type Lage,
    type Papier,
    type ReisePdfEinstellungen,
} from "./einstellungen";
import type { Inhalt, Knoten, PdfDokument, Rand, TabellenLayout, Vektor } from "./pdf-knoten";
import type { Abschnitt, DazuTeil, EtappenZeile, Kennzeile, ProfilDaten, ReiseDaten, Station } from "./reise-daten";

/**
 * Das PDF als Beschreibung für pdfmake (WI-0306, Entwurf Fassung 6): eine reine Funktion aus den Daten der Reise, den Wörtern der gewählten
 * Sprache und den Einstellungen. Keine Vue, kein DOM, kein `t()`: `reise-daten.ts` hat schon alles in Worte gefasst.
 *
 * - **Seiten:** Deckblatt (Auge, Titel, Zeitraum, Notiz, Kartenbild oder Stationen, Stationsband, Kennzahlen, Einstellungszeile, QR-Code), danach
 *   Reiseverlauf (kurz je Abschnitt oder als Tafel je Etappe mit Wiederholkopf), Höhenprofil als Vektor, Reisekosten mit Fußnoten,
 *   Schifffahrtshinweise, Gegenden, Sprachen und Gebiete, Vorkommen unterwegs und das Reisetagebuch auf eigener Seite.
 * - 🔴 **Im Fuß jeder Seite die Nennung** (Lizenz des Kartenpakets): Fanprojekt-Logo, Nennung der Kartenserie samt Adresse der
 *   Fan-Richtlinie (`screenshot/nennung.ts`) und „Seite n von m“. Das Logo steht so hoch wie das 2,6-Fache der Fußschrift, wie im Screenshot.
 * - **Schrift:** nur die Hausschrift Faculty Glyphic Regular; betont wird über Größe und Farbe, nie fett. Jeder Text läuft durch den Säuberer
 *   (`zeichen.ts`): Was die Schrift nicht hat, wird ersetzt, nie ein Kästchen. Kreise und Linien sind Vektoren.
 * - **Farben** sind die hellen des Kanons, weil Papier in beiden Themen hell bleibt: Tinte `text`, leise `textMuted`, Gold `accentStrong`,
 *   Linien `borderStrong`, zarte Flächen `disclosureBg`, Pergament `mapPaper` (das Papier der Karte), Stationen `markerWaypoint`, Profil
 *   `profileLand`/`profileRiver`/`profileSea`/`profileAir`. „Weiß“ druckt keinen Grund.
 */

export interface PdfWorte {
    marke: string;
    auge: string;
    /** „Seite {n} von {m}“, die Platzhalter bleiben stehen. */
    seite: string;
    qr: string;
    verlauf: string;
    spalten: { nr: string; strecke: string; weg: string; meilen: string; zeit: string; rast: string };
    profil: string;
    schritt: string;
    toene: { land: string; river: string; sea: string; air: string };
    kosten: string;
    gebiete: string;
    derographie: string;
    sprachen: string;
    politisch: string;
    unterwegs: string;
    tagebuch: string;
    tagebuchUnter: string;
    wetter: readonly string[];
}

export interface DokumentEingabe {
    daten: ReiseDaten;
    worte: PdfWorte;
    einstellungen: ReisePdfEinstellungen;
    /** Was hineinkommt: gewählt UND für diese Reise vorhanden. */
    inhalt: Readonly<Record<InhaltName, boolean>>;
    /** Der Planer-Link der Reise für den QR-Code. */
    link: string;
    /** Die Nennung im Fuß: Nennung der Serie und Adresse der Fan-Richtlinie. */
    nennung: string;
    /** Die Nennung der Serie unter dem Kartenbild. */
    kartenNennung: string;
    /** Die Bilder, die da sind, als data-URL je Name (`karte`, `logo`, `sym.*`, `dom.*`). Was fehlt, wird weggelassen. */
    bilder: Readonly<Record<string, string>>;
    saeubern: (text: string) => string;
    schrift: string;
    /** Die Sprache des PDFs (Metadaten). */
    sprache: string;
}

/** Die Bilder, die das Dokument kennt: Name und Datei unter `public/`. */
export const PDF_BILDER: Readonly<Record<string, string>> = {
    logo: "/img/dsa-fanprojekt-logo.webp",
    "sym.wegweiser": "/icons/route/Wegweiser.webp",
    "sym.kompass": "/icons/route/compass.webp",
    "sym.uhr": "/icons/route/Stoppuhr.webp",
    "sym.segler": "/icons/route/Flusssegler.webp",
    "sym.nadel": "/icons/route/waypoint.webp",
    "sym.feder": "/icons/route/federundpapier.webp",
    "sym.zelt": "/icons/route/Zelt.webp",
    "dom.land": "/icons/route/LandwegMitWanderern.webp",
    "dom.river": "/icons/route/FlussMitBoot.webp",
    "dom.sea": "/icons/route/MeerMitSchiff.webp",
};

/** Seitenverhältnis des Logos (480 × 138). */
const LOGO_VERHAELTNIS = 480 / 138;
/** So hoch steht das Logo, gemessen an der Fußschrift (wie `LOGO_JE_SCHRIFT` im Screenshot). */
const LOGO_JE_SCHRIFT = 2.6;

const FARBE = {
    tinte: canonColour("text"),
    leise: canonColour("textMuted"),
    gold: canonColour("accentStrong"),
    linie: canonColour("borderStrong"),
    zart: canonColour("disclosureBg"),
    papier: canonColour("mapPaper"),
    /** Der Grund der Zeichen auf weißem Papier: der helle Fenstergrund, vom reinen Weiß der Seite nicht zu unterscheiden (`bildGrund`). */
    weiss: canonColour("panel"),
    rot: canonColour("markerWaypoint"),
    land: canonColour("profileLand"),
    river: canonColour("profileRiver"),
    sea: canonColour("profileSea"),
    air: canonColour("profileAir"),
} as const;

/** Der Grund, auf den die Zeichen und das Logo vor dem Einbetten gelegt werden (`bilder.ts`: JPEG statt PNG mit Transparenz). */
export function bildGrund(papier: Papier): string {
    return papier === "pergament" ? FARBE.papier : FARBE.weiss;
}

/** Der Rand und der Faktor der Schrift je Format: A5 als Heft enger und kleiner (Entwurf: 24 statt 34, Schrift × 0,82). */
export function satzspiegel(format: Format): { rand: number; f: number } {
    return format === "a5" ? { rand: 24, f: 0.82 } : { rand: 34, f: 1 };
}

const KOPF_HOEHE = 16;
const FUSS_HOEHE = 26;

function seitenRand(format: Format): Rand {
    const { rand, f } = satzspiegel(format);
    return [rand, rand + KOPF_HOEHE * f, rand, rand + FUSS_HOEHE * f];
}

/** Die Inhaltsfläche einer Seite. */
export function inhaltsFlaeche(format: Format, lage: Lage): { breite: number; hoehe: number } {
    const masse = seitenMasse(format, lage);
    const [links, oben, rechts, unten] = seitenRand(format);
    return { breite: masse.breite - links - rechts, hoehe: masse.hoehe - oben - unten };
}

/**
 * Das Feld des Kartenbilds auf dem Deckblatt: volle Breite, die Höhe so, dass das Deckblatt auf eine Seite passt (Titel, Zeitraum, Notiz,
 * Stationsband und Kennzahlen darüber und darunter). Hoch höchstens im Verhältnis 1,15 : 1, quer nimmt es, was bleibt. Die Aufnahme schneidet
 * im Verhältnis dieses Felds (`kartenbild-aufnahme.ts`), das PDF deckt es (`cover`).
 */
export function kartenFeld(
    format: Format,
    lage: Lage,
    titelZeilen = 2,
    mitNotiz = false,
): { breite: number; hoehe: number } {
    const { breite, hoehe } = inhaltsFlaeche(format, lage);
    const { f } = satzspiegel(format);
    const titelGroesse = (lage === "quer" ? 19 : 23) * f;
    // Gemessen an den Probe-PDFs (Gareth – Elenvina – Havena, A4 und A5, hoch und quer): Auge, Zeitraum, Bildnennung, Stationsband, Kennzahlen
    // samt Einstellungszeile und die Abstände brauchen hoch rund 300, quer rund 275 Punkte (in A5 mal 0,82); dazu Titel und Notiz.
    const rest = (lage === "quer" ? 275 : 300) * f + titelZeilen * titelGroesse * 1.12 + (mitNotiz ? 24 * f : 0);
    const frei = Math.max(110 * f, hoehe - rest);
    return { breite, hoehe: Math.round(Math.min(frei, breite / 1.15)) };
}

/** Wie viele Zeilen der Titel ungefähr braucht: Faculty Glyphic setzt im Mittel 0,52 Geviert je Zeichen. */
export function titelZeilen(titel: string, format: Format, lage: Lage): number {
    const { breite } = inhaltsFlaeche(format, lage);
    const { f } = satzspiegel(format);
    const groesse = (lage === "quer" ? 19 : 23) * f;
    return Math.max(1, Math.ceil((titel.length * groesse * 0.52) / breite));
}

const ohneLinien: TabellenLayout = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
};

export function reiseDokument(eingabe: DokumentEingabe): PdfDokument {
    const { daten, worte, einstellungen: e, inhalt, bilder } = eingabe;
    const s = eingabe.saeubern;
    const { rand, f } = satzspiegel(e.format);
    const masse = seitenMasse(e.format, e.lage);
    const flaeche = inhaltsFlaeche(e.format, e.lage);
    const breit = e.lage === "quer" || e.format !== "a5";
    const groesse = {
        grund: 8.4 * f,
        klein: 7.2 * f,
        winzig: 6.4 * f,
        fuss: 5.6 * f,
        h2: 13 * f,
    };
    const hat = (name: string): boolean => bilder[name] !== undefined;
    const text = (inhaltText: string, stil: Knoten = {}): Knoten => ({ text: s(inhaltText), ...stil });
    const linie = (breite: number, farbe: string = FARBE.linie, staerke = 0.6): Knoten => ({
        canvas: [{ type: "line", x1: 0, y1: 0, x2: breite, y2: 0, lineWidth: staerke, lineColor: farbe }],
    });
    const punkt = (r: number, farbe: string = FARBE.rot): Knoten => ({
        canvas: [{ type: "ellipse", x: r, y: r, r1: r, r2: r, color: farbe }],
        width: r * 2,
    });
    const symbol = (name: string, mass: number): Knoten | undefined =>
        hat(name) ? { image: name, fit: [mass, mass], width: mass } : undefined;

    /**
     * Eine Überschrift mit Zeichen und Linie bis zum Rand (Entwurf `.b-h`). 🪤 Eine Leinwand schneidet nicht ab: Die Linie ist so lang wie der Platz
     * hinter dem Titel, geschätzt mit großzügigen 0,62 Geviert je Zeichen; sie endet eher vor dem Rand als dahinter.
     */
    const ueberschrift = (titel: string, bild: string, abstand: boolean): Knoten => {
        const mass = 16 * f;
        const zeichen = symbol(bild, mass);
        const luecke = 5 * f;
        const rest = flaeche.breite - (zeichen ? mass + luecke : 0) - titel.length * groesse.h2 * 0.62 - luecke;
        return {
            columns: [
                ...(zeichen ? [zeichen] : []),
                { text: s(titel), fontSize: groesse.h2, color: FARBE.tinte, width: "auto", margin: [0, 1 * f, 0, 0] },
                {
                    width: "*",
                    canvas: [
                        {
                            type: "line",
                            x1: 0,
                            y1: 10 * f,
                            x2: Math.max(0, rest),
                            y2: 10 * f,
                            lineWidth: 0.6,
                            lineColor: FARBE.linie,
                        },
                    ],
                },
            ],
            columnGap: luecke,
            margin: [0, abstand ? 10 * f : 0, 0, 3 * f],
        };
    };
    const leise = (inhaltText: string, stil: Knoten = {}): Knoten => text(inhaltText, { color: FARBE.leise, ...stil });

    // --- Kopf und Fuß jeder Seite -------------------------------------------------------------------------------------------------

    const kopf = (): Inhalt => ({
        margin: [rand, rand * 0.62, rand, 0],
        stack: [
            {
                columns: [
                    text(`${worte.marke} · ${worte.auge}`.toLocaleUpperCase(eingabe.sprache), {
                        color: FARBE.gold,
                        fontSize: groesse.winzig,
                        characterSpacing: 0.5 * f,
                        width: "auto",
                    }),
                    leise(daten.kopfRechts, { fontSize: groesse.winzig, alignment: "right", width: "*" }),
                ],
                columnGap: 10,
            },
            { ...linie(flaeche.breite), margin: [0, 3 * f, 0, 0] },
        ],
    });
    const logoHoehe = groesse.fuss * LOGO_JE_SCHRIFT;
    const fuss = (seite: number, seiten: number): Inhalt => ({
        margin: [rand, 5 * f, rand, 0],
        stack: [
            linie(flaeche.breite),
            {
                columns: [
                    ...(hat("logo")
                        ? [{ image: "logo", width: logoHoehe * LOGO_VERHAELTNIS, height: logoHoehe } satisfies Knoten]
                        : []),
                    leise(eingabe.nennung, {
                        fontSize: groesse.fuss,
                        lineHeight: 1.15,
                        width: "*",
                        margin: [0, 1.5 * f, 0, 0],
                    }),
                    text(worte.seite.replace("{n}", String(seite)).replace("{m}", String(seiten)), {
                        fontSize: 6.8 * f,
                        color: FARBE.tinte,
                        width: "auto",
                        noWrap: true,
                        margin: [0, 3 * f, 0, 0],
                    }),
                ],
                columnGap: 8 * f,
                margin: [0, 4 * f, 0, 0],
            },
        ],
    });

    // --- Deckblatt ---------------------------------------------------------------------------------------------------------------

    const kennBlock = (zeilen: readonly Kennzeile[]): Knoten => ({
        table: {
            widths: ["*", "auto", "auto"],
            body: zeilen.map((z) => [
                leise(z.label, z.gesamt ? { color: FARBE.gold, fontSize: 9.6 * f } : {}),
                text(z.wert, {
                    alignment: "right",
                    fontSize: (z.gesamt ? 9.6 : 9.2) * f,
                    color: FARBE.tinte,
                    noWrap: true,
                }),
                leise(z.notiz, { noWrap: true, ...(z.gesamt ? { color: FARBE.tinte, fontSize: 9.6 * f } : {}) }),
            ]),
        },
        layout: { ...ohneLinien, paddingRight: (i) => (i < 2 ? 7 * f : 0), paddingBottom: () => 3 * f },
    });

    const stationsKasten = (stationen: readonly Station[]): Knoten => ({
        table: {
            widths: ["*"],
            body: [
                [
                    {
                        stack: stationen.map((station) => ({
                            columns: [
                                { ...punkt(4.5 * f), margin: [0, 2 * f, 0, 0] },
                                {
                                    text: [
                                        { text: s(station.name), fontSize: 10 * f, color: FARBE.tinte },
                                        { text: s(` · ${station.rolle}`), fontSize: 7.6 * f, color: FARBE.leise },
                                    ],
                                    width: "*",
                                },
                                leise(station.datum, { fontSize: 7.6 * f, width: "auto", alignment: "right" }),
                            ],
                            columnGap: 8 * f,
                            margin: [0, 0, 0, 6 * f],
                        })),
                        margin: [10 * f, 10 * f, 10 * f, 4 * f],
                    },
                ],
            ],
        },
        layout: {
            ...ohneLinien,
            hLineWidth: () => 0.8,
            vLineWidth: () => 0.8,
            hLineColor: () => FARBE.linie,
            vLineColor: () => FARBE.linie,
        },
    });

    /** Das Stationsband unter dem Kartenbild: Stationen mit Datum, dazwischen gestrichelt die Mittel der Strecke. Bei mehr als fünf Stationen Start und Ziel. */
    const stationsBand = (stationen: readonly Station[]): Knoten => {
        const gezeigt = stationen.length <= 5 ? stationen : [stationen[0]!, stationen[stationen.length - 1]!];
        // Feste Breiten, damit die gestrichelte Linie genau ihre Zelle füllt (eine Leinwand schneidet nicht ab).
        const stationsBreite = 84 * f;
        const verbinder =
            gezeigt.length > 1 ? (flaeche.breite - gezeigt.length * stationsBreite) / (gezeigt.length - 1) : 0;
        const mass = 16 * f;
        const zellen: Inhalt[] = [];
        const breiten: number[] = [];
        gezeigt.forEach((station, i) => {
            zellen.push({
                stack: [
                    {
                        ...punkt(4.5 * f),
                        width: stationsBreite,
                        alignment: "center",
                        margin: [stationsBreite / 2 - 4.5 * f, 0, 0, 1],
                    },
                    text(station.name, { fontSize: 9.6 * f, alignment: "center", lineHeight: 1 }),
                    leise(station.datum, { fontSize: 6.8 * f, alignment: "center" }),
                ],
            });
            breiten.push(stationsBreite);
            if (i < gezeigt.length - 1) {
                const mittel = (gezeigt.length < stationen.length ? [] : station.strecke)
                    .map((d: Domain) => symbol(`dom.${d}`, mass))
                    .filter((k): k is Knoten => k !== undefined);
                const luecke = 6 * f;
                const belegt = mittel.length * mass + Math.max(0, mittel.length - 1) * luecke;
                const links = Math.max(0, (verbinder - belegt) / 2);
                // Die Linie in zwei Stücken links und rechts der Zeichen: Sie läuft nicht durch die Bilder.
                const strich = (x1: number, x2: number): Vektor => ({
                    type: "line",
                    x1,
                    y1: 4.5 * f,
                    x2,
                    y2: 4.5 * f,
                    lineWidth: 0.8,
                    lineColor: FARBE.leise,
                    dash: { length: 2.5, space: 2 },
                });
                zellen.push({
                    stack: [
                        {
                            canvas:
                                mittel.length === 0
                                    ? [strich(0, verbinder)]
                                    : [strich(0, links - 3 * f), strich(links + belegt + 3 * f, verbinder)],
                        },
                        ...(mittel.length === 0
                            ? []
                            : [
                                  {
                                      columns: mittel.map((m) => ({ ...m, width: mass })),
                                      columnGap: luecke,
                                      relativePosition: { x: links, y: -mass / 2 },
                                  } satisfies Knoten,
                              ]),
                    ],
                });
                breiten.push(verbinder);
            }
        });
        return {
            table: { widths: breiten, body: [zellen] },
            layout: ohneLinien,
        };
    };

    const deckblatt = (): Inhalt[] => {
        const titelText = e.titel.trim() === "" ? daten.titel : e.titel.trim();
        const zeilen = titelZeilen(titelText, e.format, e.lage);
        const feld = kartenFeld(e.format, e.lage, zeilen, e.notiz.trim() !== "");
        const mitBild = e.karte !== "ohne" && hat("karte");
        const teile: Inhalt[] = [
            text(worte.auge.toLocaleUpperCase(eingabe.sprache), {
                fontSize: 7 * f,
                color: FARBE.gold,
                characterSpacing: 1.1 * f,
                margin: [0, 4 * f, 0, 2 * f],
            }),
            text(titelText, {
                fontSize: (e.lage === "quer" ? 19 : 23) * f,
                lineHeight: 1.05,
                margin: [0, 0, 0, 3 * f],
            }),
            leise(daten.zeitraum, { fontSize: 9.4 * f, margin: [0, 0, 0, 8 * f] }),
        ];
        if (e.notiz.trim() !== "") {
            teile.push({
                table: { widths: ["*"], body: [[text(e.notiz.trim(), { fontSize: 8.6 * f })]] },
                layout: {
                    ...ohneLinien,
                    vLineWidth: (i) => (i === 0 ? 2 : 0),
                    vLineColor: () => FARBE.gold,
                    fillColor: () => FARBE.zart,
                    paddingLeft: () => 8 * f,
                    paddingRight: () => 8 * f,
                    paddingTop: () => 4 * f,
                    paddingBottom: () => 4 * f,
                },
                margin: [0, 0, 0, 8 * f],
            });
        }
        if (mitBild) {
            teile.push({
                table: {
                    widths: [feld.breite - 1.6],
                    body: [
                        [
                            {
                                image: "karte",
                                cover: {
                                    width: feld.breite - 1.6,
                                    height: feld.hoehe,
                                    align: "center",
                                    valign: "center",
                                },
                            },
                        ],
                    ],
                },
                layout: {
                    ...ohneLinien,
                    hLineWidth: () => 0.8,
                    vLineWidth: () => 0.8,
                    hLineColor: () => FARBE.tinte,
                    vLineColor: () => FARBE.tinte,
                },
            });
            teile.push(
                leise(eingabe.kartenNennung, { fontSize: 5.2 * f, alignment: "right", margin: [0, 1.5 * f, 0, 6 * f] }),
            );
            if (daten.stationen.length >= 2)
                teile.push({ ...stationsBand(daten.stationen), margin: [0, 0, 0, 10 * f] });
        } else {
            teile.push({ ...stationsKasten(daten.stationen), margin: [0, 0, 0, 10 * f] });
        }
        const rechts = [...daten.kennzahlen.rechts];
        if (inhalt.kosten && daten.kostenSumme !== null) {
            rechts.push({ label: worte.kosten, wert: daten.kostenSumme, notiz: "", gesamt: true });
        }
        const zahlen: Knoten = {
            stack: [
                linie(flaeche.breite - (inhalt.qr ? 92 * f : 0), FARBE.tinte, 0.8),
                {
                    columns: [
                        { ...kennBlock(daten.kennzahlen.links), width: "*" },
                        { ...kennBlock(rechts), width: "*" },
                    ],
                    columnGap: 16 * f,
                    margin: [0, 6 * f, 0, 0],
                },
                leise(daten.gerechnet, { fontSize: 7 * f, margin: [0, 6 * f, 0, 0] }),
            ],
            width: "*",
        };
        teile.push({
            columns: [
                zahlen,
                ...(inhalt.qr
                    ? [
                          {
                              stack: [
                                  {
                                      qr: eingabe.link,
                                      fit: 64 * f,
                                      foreground: FARBE.tinte,
                                      eccLevel: "M",
                                      alignment: "center",
                                  },
                                  leise(worte.qr, { fontSize: 5.8 * f, alignment: "center", margin: [0, 3 * f, 0, 0] }),
                              ],
                              width: 78 * f,
                          } satisfies Knoten,
                      ]
                    : []),
            ],
            columnGap: 14 * f,
            unbreakable: true,
        });
        return teile;
    };

    // --- Reiseverlauf -------------------------------------------------------------------------------------------------------------

    const dazuGewaehlt = (teile: readonly DazuTeil[]): DazuTeil[] => teile.filter((teil) => e.zusaetze[teil.art]);
    const dazuText = (teile: readonly DazuTeil[], groesseText: number): Knoten | undefined => {
        const gewaehlt = dazuGewaehlt(teile);
        if (gewaehlt.length === 0) return undefined;
        const laeufe: Knoten[] = [];
        gewaehlt.forEach((teil, i) => {
            if (i > 0) laeufe.push({ text: " · ", color: FARBE.linie });
            laeufe.push({ text: s(`${teil.label} `), color: FARBE.gold });
            laeufe.push({ text: s(teil.wert), color: FARBE.tinte });
            if (teil.leise) laeufe.push({ text: s(` (${teil.leise})`), color: FARBE.leise });
        });
        return { text: laeufe, fontSize: groesseText, lineHeight: 1.3 };
    };

    const stationsZeile = (station: Station): Knoten => ({
        columns: [
            { ...punkt(4 * f), margin: [3 * f, 2.5 * f, 0, 0], width: 14 * f },
            {
                text: [
                    { text: s(station.name), fontSize: 10 * f, color: FARBE.tinte },
                    {
                        text: s(` · ${[station.rolle, station.wo].filter((t) => t !== "").join(" · ")}`),
                        color: FARBE.leise,
                    },
                ],
                width: "*",
            },
            leise(station.datum, { width: "auto", alignment: "right" }),
        ],
        columnGap: 6 * f,
        margin: [0, 2 * f, 0, 2 * f],
        unbreakable: true,
    });

    const abschnittsKopf = (abschnitt: Abschnitt, mitDazu: boolean): Knoten => {
        const zeichen = symbol(`dom.${abschnitt.domain}`, 18 * f);
        const dazu = mitDazu ? dazuText(abschnitt.dazu, 6.8 * f) : undefined;
        return {
            columns: [
                {
                    width: 14 * f,
                    canvas: [
                        {
                            type: "line",
                            x1: 7 * f,
                            y1: 0,
                            x2: 7 * f,
                            y2: 24 * f,
                            lineWidth: 0.8,
                            lineColor: FARBE.leise,
                            dash: { length: 2, space: 2 },
                        },
                    ],
                },
                ...(zeichen ? [{ ...zeichen, width: 20 * f }] : []),
                {
                    stack: [
                        {
                            text: [
                                { text: s(abschnitt.titel), color: FARBE.tinte },
                                { text: s(` · ${abschnitt.meta}`), color: FARBE.leise },
                            ],
                        },
                        leise(abschnitt.namen),
                        ...(dazu ? [{ ...dazu, margin: [0, 1, 0, 0] as Rand }] : []),
                    ],
                    width: "*",
                },
                leise(abschnitt.datum, { width: "auto", alignment: "right", noWrap: true }),
            ],
            columnGap: 6 * f,
            margin: [0, 3 * f, 0, 3 * f],
            unbreakable: true,
        };
    };

    const etappenTafel = (abschnitt: Abschnitt): Knoten => {
        const mitDatum = daten.datumSpalte !== null;
        const sp = worte.spalten;
        const kopfZelle = (inhaltText: string, rechts = false): Knoten =>
            leise(inhaltText.toLocaleUpperCase(eingabe.sprache), {
                fontSize: 6.6 * f,
                characterSpacing: 0.25 * f,
                ...(rechts ? { alignment: "right" } : {}),
                noWrap: true,
            });
        const spalten = mitDatum ? 7 : 6;
        const kopfZeile: Inhalt[] = [
            kopfZelle(sp.nr),
            kopfZelle(sp.strecke),
            kopfZelle(sp.weg),
            ...(mitDatum ? [kopfZelle(daten.datumSpalte ?? "")] : []),
            kopfZelle(sp.meilen, true),
            kopfZelle(sp.zeit, true),
            kopfZelle(sp.rast, true),
        ];
        const titelZeile: Inhalt[] = [
            { ...abschnittsKopf(abschnitt, false), colSpan: spalten },
            ...Array<Inhalt>(spalten - 1).fill(""),
        ];
        const koerper: Inhalt[][] = [titelZeile, kopfZeile];
        const zebra: boolean[] = [false, false];
        abschnitt.etappen.forEach((z: EtappenZeile, i) => {
            const streifen = i % 2 === 1;
            koerper.push([
                leise(String(z.nr)),
                text(`${z.von} – ${z.nach}`),
                leise(z.weg),
                ...(mitDatum ? [text(z.datum, { noWrap: true })] : []),
                text(z.meilen, { alignment: "right", noWrap: true }),
                text(z.zeit, { alignment: "right", noWrap: true }),
                text(z.rast, { alignment: "right", noWrap: true, color: FARBE.gold }),
            ]);
            zebra.push(streifen);
            const dazu = dazuText(z.dazu, 6.6 * f);
            if (dazu) {
                koerper.push(["", { ...dazu, colSpan: spalten - 1 }, ...Array<Inhalt>(spalten - 2).fill("")]);
                zebra.push(streifen);
            }
        });
        return {
            table: {
                widths: mitDatum
                    ? [16 * f, "*", "*", "auto", "auto", "auto", "auto"]
                    : [16 * f, "*", "*", "auto", "auto", "auto"],
                headerRows: 2,
                keepWithHeaderRows: 1,
                dontBreakRows: true,
                body: koerper,
            },
            layout: {
                hLineWidth: (zeile) => (zeile === 2 ? 0.8 : 0),
                vLineWidth: () => 0,
                hLineColor: () => FARBE.tinte,
                paddingLeft: (spalte) => (spalte === 0 ? 0 : 3 * f),
                paddingRight: () => 3 * f,
                paddingTop: () => 1.6 * f,
                paddingBottom: () => 1.6 * f,
                fillColor: (zeile) => (zebra[zeile] === true ? FARBE.zart : null),
            },
            margin: [0, 2 * f, 0, 6 * f],
        };
    };

    const verlauf = (): Inhalt[] => {
        const teile: Inhalt[] = [];
        const kurz = e.etappenArt === "kurz";
        const kopfStapel: Inhalt[] = [
            ueberschrift(worte.verlauf, "sym.wegweiser", false),
            leise(daten.verlaufUnter, { margin: [0, 0, 0, 4 * f] }),
        ];
        daten.verlauf.forEach((eintrag, i) => {
            const knoten =
                eintrag.art === "station"
                    ? stationsZeile(eintrag.station)
                    : kurz
                      ? abschnittsKopf(eintrag.abschnitt, true)
                      : etappenTafel(eintrag.abschnitt);
            // Die Überschrift bleibt bei ihrem ersten Eintrag (keine Überschrift allein unten auf einer Seite).
            if (i === 0) teile.push({ stack: [...kopfStapel, knoten], unbreakable: eintrag.art === "station" || kurz });
            else teile.push(knoten);
        });
        if (daten.verlauf.length === 0) teile.push(...kopfStapel);
        return teile;
    };

    // --- Höhenprofil --------------------------------------------------------------------------------------------------------------

    const profilGrafik = (profil: ProfilDaten): Knoten[] => {
        const B = flaeche.breite;
        const H = (e.lage === "quer" ? 120 : 132) * f;
        const L = 30 * f;
        const U = 14 * f;
        const O = 8 * f;
        const max = Math.max(100, Math.ceil((profil.hoechste * 1.08) / 100) * 100);
        const bx = (meile: number): number => L + (profil.distanz > 0 ? (meile / profil.distanz) * (B - L - 4) : 0);
        const by = (hoehe: number): number => O + (1 - hoehe / max) * (H - O - U);
        // Ein unsichtbarer Punkt unten rechts: Die Leinwand misst sich an ihren Vektoren, das Band der Ortsnamen gehört dazu.
        const vektoren: Vektor[] = [
            { type: "line", x1: B - 4, y1: H, x2: B - 4, y2: H, lineWidth: 0.1, lineColor: FARBE.linie },
        ];
        const raster = [0, Math.round(max / 2 / 50) * 50, max];
        for (const wert of raster) {
            vektoren.push({
                type: "line",
                x1: L,
                y1: by(wert),
                x2: B - 4,
                y2: by(wert),
                lineWidth: 0.4,
                lineColor: FARBE.linie,
            });
        }
        for (const lauf of profil.laeufe) {
            if (lauf.punkte.length < 2) continue;
            const farbe = FARBE[lauf.ton];
            // 🪤 Jede Linie bekommt eigene Punkte: pdfmake verschiebt sie beim Setzen an Ort und Stelle (`offsetVector`); geteilte Punkte rückten
            // doppelt, und die Linie stand um die Höhe des Blocks darüber zu tief.
            const punkte = (): { x: number; y: number }[] => lauf.punkte.map(([m, h]) => ({ x: bx(m), y: by(h) }));
            const erster = bx(lauf.punkte[0]![0]);
            const letzter = bx(lauf.punkte[lauf.punkte.length - 1]![0]);
            if (lauf.ton !== "air") {
                vektoren.push({
                    type: "polyline",
                    points: [{ x: erster, y: by(0) }, ...punkte(), { x: letzter, y: by(0) }],
                    closePath: true,
                    color: farbe,
                    fillOpacity: 0.3,
                    lineWidth: 0,
                });
            }
            vektoren.push({ type: "polyline", points: punkte(), lineColor: farbe, lineWidth: 1.1, lineJoin: "round" });
        }
        for (const station of profil.stationen) {
            const x = bx(station.meile);
            vektoren.push({
                type: "line",
                x1: x,
                y1: O,
                x2: x,
                y2: H - U,
                lineWidth: 0.6,
                lineColor: FARBE.rot,
                dash: { length: 2, space: 2 },
            });
        }
        // Beschriftungen stehen frei über der Leinwand; eine Breite gilt in pdfmake nur in Spalten, darum steht jede in einer Spalte fester Breite.
        const frei = (inhalt: Knoten, breite: number, x: number, y: number): Knoten => ({
            columns: [{ ...inhalt, width: breite }],
            relativePosition: { x, y },
        });
        const beschriftung: Knoten[] = [
            ...raster.map((wert) =>
                frei(leise(String(wert), { fontSize: 6.5 * f, alignment: "right" }), L - 4, 0, by(wert) - 3.5 * f - H),
            ),
            ...profil.stationen.map((station, i) => {
                const x = bx(station.meile);
                const breite = 120 * f;
                const erste = i === 0;
                const letzte = i === profil.stationen.length - 1;
                const links = erste ? x : letzte ? x - breite : x - breite / 2;
                const ausrichtung = erste ? ("left" as const) : letzte ? ("right" as const) : ("center" as const);
                return frei(
                    text(station.name, { fontSize: 6.5 * f, alignment: ausrichtung }),
                    breite,
                    links,
                    -U + 3 * f,
                );
            }),
        ];
        const toene = [...new Set(profil.laeufe.map((l) => l.ton))];
        return [
            { canvas: vektoren, margin: [0, 2 * f, 0, 0] },
            { stack: beschriftung, margin: [0, 0, 0, 0] },
            {
                columns: [
                    ...toene.map((ton): Knoten => ({
                        columns: [
                            {
                                canvas: [
                                    {
                                        type: "rect",
                                        x: 0,
                                        y: 2 * f,
                                        w: 10 * f,
                                        h: 5 * f,
                                        color: FARBE[ton],
                                        fillOpacity: 0.6,
                                    },
                                ],
                                width: 12 * f,
                            },
                            leise(worte.toene[ton], { fontSize: 6.6 * f, width: "auto" }),
                        ],
                        width: "auto",
                        columnGap: 2,
                    })),
                    leise(profil.bereich, { fontSize: 6.6 * f, alignment: "right", width: "*" }),
                ],
                columnGap: 12 * f,
                margin: [0, 2 * f, 0, 0],
            },
        ];
    };

    // --- Kosten, Schiffe, Gebiete, Unterwegs ---------------------------------------------------------------------------------------

    const kosten = (): Inhalt[] => {
        const k = daten.kosten;
        if (k === null) return [];
        const hoch = (nummer: number | null): Knoten[] =>
            nummer === null ? [] : [{ text: String(nummer), sup: true, color: FARBE.gold }];
        const zeilen: Inhalt[][] = k.zeilen.map((z) => [
            leise(z.label),
            text(z.betrag, { alignment: "right", noWrap: true, ...(z.unbekannt ? { color: FARBE.leise } : {}) }),
            {
                stack: [
                    ...(z.naechte
                        ? z.naechte.map((n): Knoten => ({
                              text: [
                                  { text: s(n.betrag === null ? n.text : `${n.text}: `), color: FARBE.leise },
                                  ...(n.betrag === null ? [] : [{ text: s(n.betrag), color: FARBE.tinte }]),
                                  ...hoch(n.fussnote),
                              ],
                          }))
                        : [{ text: [{ text: s(z.notiz), color: FARBE.leise }, ...hoch(z.fussnote)] }]),
                    ...(z.extra ? [leise(z.extra)] : []),
                    ...(z.grenzen && z.grenzen.length > 0
                        ? [
                              {
                                  ol: z.grenzen.map((g) => leise(g, { fontSize: 6.8 * f })),
                                  markerColor: FARBE.leise,
                                  margin: [0, 1, 0, 0] as Rand,
                              },
                          ]
                        : []),
                ],
            },
        ]);
        zeilen.push([
            text(k.summe.label, { fontSize: 10 * f }),
            text(k.summe.betrag, { fontSize: 10 * f, alignment: "right", noWrap: true }),
            leise(k.summe.notiz, { fontSize: 10 * f * 0.84 }),
        ]);
        return [
            {
                stack: [
                    ueberschrift(worte.kosten, "sym.uhr", true),
                    {
                        table: { widths: ["auto", "auto", "*"], body: zeilen, dontBreakRows: true },
                        layout: {
                            ...ohneLinien,
                            hLineWidth: (i) => (i === zeilen.length - 1 ? 0.6 : 0),
                            hLineColor: () => FARBE.linie,
                            paddingRight: (i) => (i < 2 ? 10 * f : 0),
                            paddingTop: (i) => (i === zeilen.length - 1 ? 3 * f : 1 * f),
                            paddingBottom: () => 1 * f,
                        },
                    },
                ],
                unbreakable: true,
            },
            ...(k.fussnoten.length > 0
                ? [
                      {
                          stack: k.fussnoten.map((n): Knoten => ({
                              text: [
                                  { text: String(n.nummer), sup: true, color: FARBE.gold },
                                  { text: s(` ${n.text}`) },
                              ],
                              color: FARBE.leise,
                              fontSize: 6.6 * f,
                          })),
                          margin: [0, 4 * f, 0, 0] as Rand,
                      } satisfies Knoten,
                  ]
                : []),
        ];
    };

    const schiffe = (): Inhalt[] => {
        const sch = daten.schiffe;
        if (sch === null) return [];
        return [
            {
                stack: [
                    ueberschrift(sch.titel, "sym.segler", true),
                    ...sch.zeilen.slice(0, 1).map((z) => text(z, { margin: [0, 0, 0, 2 * f] })),
                ],
                unbreakable: true,
            },
            ...sch.zeilen.slice(1).map((z) => text(z, { margin: [0, 0, 0, 2 * f] })),
        ];
    };

    const gebiete = (): Inhalt[] => {
        const g = daten.gebiete;
        if (g === null) return [];
        const absatz = (titel: string, zahl: number | null, inhaltText: string): Knoten => ({
            text: [
                { text: s(zahl === null ? `${titel}: ` : `${titel} (${String(zahl)}): `), color: FARBE.leise },
                { text: s(inhaltText), color: FARBE.tinte },
            ],
            margin: [0, 0, 0, 3 * f],
        });
        const spalten = breit ? 3 : 2;
        const proSpalte = Math.ceil(g.gebiete.length / spalten);
        return [
            {
                stack: [
                    ueberschrift(worte.gebiete, "sym.nadel", true),
                    ...(g.gegenden.length > 0
                        ? [absatz(worte.derographie, g.gegenden.length, g.gegenden.join(", "))]
                        : []),
                    ...(g.sprachen.length > 0 ? [absatz(worte.sprachen, null, g.sprachen.join(", "))] : []),
                    ...(g.gebiete.length > 0 ? [leise(`${worte.politisch} (${String(g.gebiete.length)}):`)] : []),
                ],
                unbreakable: true,
            },
            ...(g.gebiete.length > 0
                ? [
                      {
                          columns: Array.from({ length: spalten }, (_, i) => ({
                              stack: g.gebiete.slice(i * proSpalte, (i + 1) * proSpalte).map((name) => text(name)),
                              width: "*" as const,
                          })),
                          columnGap: 14 * f,
                          fontSize: 7.4 * f,
                          margin: [0, 1 * f, 0, 0] as Rand,
                      } satisfies Knoten,
                  ]
                : []),
        ];
    };

    const unterwegs = (): Inhalt[] => {
        const u = daten.unterwegs;
        if (u === null) return [];
        const spalten = breit ? 4 : 2;
        const bloecke: Knoten[] = u.map((spalte) => ({
            stack: [
                {
                    columns: [
                        text(spalte.titel, { fontSize: 9 * f, width: "*" }),
                        text(spalte.zahl, { fontSize: 9 * f, color: FARBE.gold, width: "auto" }),
                    ],
                },
                { ...linie((flaeche.breite - (spalten - 1) * 10 * f) / spalten), margin: [0, 1, 0, 2 * f] },
                ...spalte.eintraege.map((eintrag): Knoten => ({
                    stack: [text(eintrag.name, { fontSize: 7.2 * f }), leise(eintrag.wo, { fontSize: 6.2 * f })],
                    margin: [0, 0, 0, 2 * f],
                })),
                ...(spalte.weitere ? [leise(spalte.weitere, { fontSize: 6.6 * f, margin: [0, 1 * f, 0, 0] })] : []),
            ],
            width: "*",
        }));
        const reihen: Knoten[] = [];
        for (let i = 0; i < bloecke.length; i += spalten) {
            const reihe = bloecke.slice(i, i + spalten);
            while (reihe.length < spalten) reihe.push({ text: "", width: "*" });
            reihen.push({ columns: reihe, columnGap: 10 * f, margin: [0, 0, 0, 6 * f], unbreakable: true });
        }
        return [
            { stack: [ueberschrift(worte.unterwegs, "sym.feder", true), ...reihen.slice(0, 1)], unbreakable: true },
            ...reihen.slice(1),
        ];
    };

    // --- Reisetagebuch ------------------------------------------------------------------------------------------------------------

    const tagebuch = (): Inhalt[] => {
        const tage = daten.tage;
        if (tage.length === 0) return [];
        const spalteLinks = 46 * f;
        const breiteRechts = flaeche.breite - spalteLinks - 8 * f;
        const zeilen = (anzahl: number): Knoten => ({
            canvas: Array.from({ length: anzahl }, (_, i) => ({
                type: "line" as const,
                x1: 0,
                y1: (i + 1) * 11 * f,
                x2: breiteRechts,
                y2: (i + 1) * 11 * f,
                lineWidth: 0.4,
                lineColor: FARBE.linie,
            })),
            margin: [0, 0, 0, 2 * f],
        });
        // 🪤 Je Tag ein eigener Knoten: pdfmake verschiebt die Vektoren beim Setzen an Ort und Stelle, ein geteilter Knoten rückte jedes Mal weiter.
        const wetter = (): Knoten => ({
            columns: worte.wetter.map((wort): Knoten => ({
                columns: [
                    {
                        canvas: [
                            {
                                type: "rect",
                                x: 0,
                                y: 1.5 * f,
                                w: 6 * f,
                                h: 6 * f,
                                lineColor: FARBE.leise,
                                lineWidth: 0.7,
                            },
                        ],
                        width: 9 * f,
                    },
                    leise(wort, { fontSize: 6.4 * f, width: "auto" }),
                ],
                width: "auto",
                columnGap: 1,
            })),
            columnGap: 10 * f,
        });
        const tagKnoten = tage.map((tag): Knoten => ({
            columns: [
                {
                    stack: [
                        text(tag.gross, { fontSize: 10 * f, lineHeight: 1 }),
                        leise(tag.klein, { fontSize: 6.2 * f }),
                    ],
                    width: spalteLinks,
                },
                {
                    stack: [
                        {
                            columns: [
                                {
                                    text: [
                                        { text: s(tag.was), color: FARBE.tinte },
                                        ...(tag.wege === "" ? [] : [{ text: s(` · ${tag.wege}`), color: FARBE.leise }]),
                                    ],
                                    width: "*",
                                },
                                leise(tag.nacht, { width: "auto", alignment: "right" }),
                            ],
                            columnGap: 8 * f,
                            fontSize: 7.2 * f,
                        },
                        zeilen(2),
                        ...(e.wetter ? [wetter()] : []),
                    ],
                    width: "*",
                },
            ],
            columnGap: 8 * f,
            margin: [0, 4 * f, 0, 4 * f],
            unbreakable: true,
        }));
        const trenner = (k: Knoten): Inhalt[] => [k, linie(flaeche.breite, FARBE.linie, 0.5)];
        return [
            {
                stack: [
                    ueberschrift(worte.tagebuch, "sym.zelt", false),
                    leise(worte.tagebuchUnter, { margin: [0, 0, 0, 4 * f] }),
                    ...trenner(tagKnoten[0]!),
                ],
                pageBreak: "before",
                unbreakable: true,
            },
            ...tagKnoten.slice(1).flatMap(trenner),
        ];
    };

    // --- Zusammensetzen -----------------------------------------------------------------------------------------------------------

    const inhaltSeiten: Inhalt[] = [];
    if (inhalt.etappen) inhaltSeiten.push(...verlauf());
    if (inhalt.profil && daten.profil !== null) {
        const p = daten.profil;
        inhaltSeiten.push({
            stack: [
                ueberschrift(worte.profil, "sym.kompass", inhaltSeiten.length > 0),
                ...(p.satz === "" ? [] : [text(p.satz, { margin: [0, 0, 0, 2 * f] })]),
                ...(p.laeufe.length > 0 ? profilGrafik(p) : []),
            ],
            unbreakable: true,
        });
    }
    if (inhalt.kosten) inhaltSeiten.push(...kosten());
    if (inhalt.schiffe) inhaltSeiten.push(...schiffe());
    if (inhalt.gebiete) inhaltSeiten.push(...gebiete());
    if (inhalt.unterwegs) inhaltSeiten.push(...unterwegs());
    const ersteInhalt = inhaltSeiten[0];
    if (ersteInhalt !== undefined && typeof ersteInhalt !== "string")
        inhaltSeiten[0] = { ...ersteInhalt, pageBreak: "before" };
    if (inhalt.tagebuch) inhaltSeiten.push(...tagebuch());

    const verwendet = new Set<string>(["logo", "karte", ...Object.keys(PDF_BILDER)]);
    const images = Object.fromEntries(Object.entries(bilder).filter(([name]) => verwendet.has(name)));
    const titel = e.titel.trim() === "" ? daten.titel : e.titel.trim();

    return {
        pageSize: { width: masse.breite, height: masse.hoehe },
        pageMargins: seitenRand(e.format),
        info: {
            title: s(titel),
            author: worte.marke,
            subject: s(daten.zeitraum),
            creator: worte.marke,
            producer: worte.marke,
        },
        language: eingabe.sprache,
        defaultStyle: { font: eingabe.schrift, fontSize: groesse.grund, lineHeight: 1.25, color: FARBE.tinte },
        ...(e.papier === "pergament"
            ? {
                  background: (_seite: number, g: { width: number; height: number }): Inhalt => ({
                      canvas: [{ type: "rect", x: 0, y: 0, w: g.width, h: g.height, color: FARBE.papier }],
                  }),
              }
            : {}),
        header: () => kopf(),
        footer: (seite, seiten) => fuss(seite, seiten),
        content: [...deckblatt(), ...inhaltSeiten],
        images,
    };
}
