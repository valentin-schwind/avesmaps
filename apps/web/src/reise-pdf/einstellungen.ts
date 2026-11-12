import {
    PDF_DERO_EBENEN,
    PDF_ETAPPEN_ARTEN,
    PDF_FORMATE,
    PDF_KARTENBILDER,
    PDF_LAGEN,
    PDF_PAPIERE,
    type KartenEinstellungen,
    type LandscapeSelection,
    type MapView,
    type TopographyVariant,
} from "@avesmaps3d/shared";
import { LOCALES, type Locale } from "../i18n/plural";

/**
 * Was „Reise als PDF“ einstellt (WI-0306, Entwurf Fassung 6, Vali 2026-11-10: „perfekt das bauen, pdfmake 👍“): die Wahl des
 * Kartenbilds, was hineinkommt, Papier, Titel, Sprache und Datei. Reine Daten ohne Vue, ohne DOM; die Dialogteile lesen und setzen sie.
 *
 * - **Das Kartenbild** ist EINE Wahl in der Folge des Entwurfs: die Kartenserien (Ansicht Standard, eine Serie mit Namen im Bild unter
 *   „Nur Karte“, Betreiber 2026-11-10), dann „Politisch“, dann die sieben Ebenen der Derographie (Höhenstufen ist die Topographie mit
 *   der Variante `hoehenstufen`). Wie die Karte dafür umschaltet, sagt `ansichtFuer`; was gerade zu sehen ist, `wahlAus`.
 * - **Die Vorgaben** stellt die Systemsteuerung ein (Standardwerte, Panel „PDF Exporter“; die Tafel in
 *   `packages/shared/src/system/karteneinstellungen.ts`), gelesen beim Start der Karte (`map/start-view.ts`). Was jemand im Dialog wählt,
 *   bleibt bei ihm, solange die Seite offen ist. Die Listen der Wahlen stehen dort, hier nur ihre Typen.
 */

/** Wie das Deckblatt sein Kartenbild bekommt: die ganze Route eingepasst, der gerade gezeigte Ausschnitt, oder keins. */
export type KartenModus = (typeof PDF_KARTENBILDER)[number];
export const KARTEN_MODI: readonly KartenModus[] = PDF_KARTENBILDER;

/** Die Ebenen der Derographie in der Folge des Kartenfächers; `hoehenstufen` ist die Topographie in Höhenstufen. */
export type DeroEbene = (typeof PDF_DERO_EBENEN)[number];
export const DERO_EBENEN: readonly DeroEbene[] = PDF_DERO_EBENEN;

/** Eine Wahl unter „Karte“: eine Kartenserie, „Politisch“ oder eine Ebene der Derographie. */
export type KartenWahl = `serie:${string}` | "politisch" | `dero:${DeroEbene}`;

/** Was die Karte zeigt: Ansicht, Ebene der Derographie, Variante der Topographie und Serie (die Zustände von `app.vue`). */
export interface KartenAnsicht {
    view: MapView;
    landscape: LandscapeSelection;
    topography: TopographyVariant;
    series: string;
}

/** Eine Serie, wie der Fächer sie anbietet; `nurKarte`: Besucher sehen sie nur unter „Nur Karte“ (Namen im Bild). */
export interface WahlSerie {
    id: string;
    label: string;
    nurKarte?: boolean | undefined;
}

export type Inhalt = "etappen" | "profil" | "kosten" | "schiffe" | "gebiete" | "unterwegs" | "tagebuch" | "qr";
export const INHALTE: readonly Inhalt[] = [
    "etappen",
    "profil",
    "kosten",
    "schiffe",
    "gebiete",
    "unterwegs",
    "tagebuch",
    "qr",
];

/** Was unter „Etappen“ je Etappe (oder je Abschnitt) dazukommt. */
export type Zusatz = "gegend" | "gebiet" | "sprache" | "gelaende" | "neu";
export const ZUSAETZE: readonly Zusatz[] = ["gegend", "gebiet", "sprache", "gelaende", "neu"];

export type Format = (typeof PDF_FORMATE)[number];
export const FORMATE: readonly Format[] = PDF_FORMATE;
export type Lage = (typeof PDF_LAGEN)[number];
export type Papier = (typeof PDF_PAPIERE)[number];
export type EtappenArt = (typeof PDF_ETAPPEN_ARTEN)[number];

export interface ReisePdfEinstellungen {
    karte: KartenModus;
    wahl: KartenWahl;
    inhalt: Record<Inhalt, boolean>;
    etappenArt: EtappenArt;
    zusaetze: Record<Zusatz, boolean>;
    wetter: boolean;
    format: Format;
    lage: Lage;
    papier: Papier;
    titel: string;
    notiz: string;
    sprache: Locale;
    /** Der Dateiname ohne die feste Endung „.pdf“. */
    datei: string;
}

/** Die Kennung je Inhalt und je Zusatz in den Standardwerten (Panel „PDF Exporter“). */
const INHALT_WERT = {
    etappen: "pdfEtappen",
    profil: "pdfProfil",
    kosten: "pdfKosten",
    schiffe: "pdfSchiffe",
    gebiete: "pdfGebiete",
    unterwegs: "pdfUnterwegs",
    tagebuch: "pdfTagebuch",
    qr: "pdfQr",
} as const satisfies Record<Inhalt, keyof KartenEinstellungen>;
const ZUSATZ_WERT = {
    gegend: "pdfDazuGegend",
    gebiet: "pdfDazuGebiet",
    sprache: "pdfDazuSprache",
    gelaende: "pdfDazuGelaende",
    neu: "pdfDazuNeu",
} as const satisfies Record<Zusatz, keyof KartenEinstellungen>;

/** Ein Wert der Standardwerte als eine der Wahlen; der Start der Karte hat ihn schon geprüft, hier nur für den Typ. */
const einerVon = <T extends string>(wahlen: readonly T[], wert: string, sonst: T): T =>
    wahlen.includes(wert as T) ? (wert as T) : sonst;

/** Die Vorgaben aus den Standardwerten; Titel, Sprache, Datei und Karte kommen von der Reise und der Seite (`richteEin` im Fenster). */
export function vorgaben(
    werte: KartenEinstellungen,
    titel: string,
    sprache: Locale,
    datei: string,
    wahl: KartenWahl,
): ReisePdfEinstellungen {
    return {
        karte: einerVon(KARTEN_MODI, werte.pdfKartenbild, "route"),
        wahl,
        inhalt: Object.fromEntries(INHALTE.map((name) => [name, werte[INHALT_WERT[name]]])) as Record<Inhalt, boolean>,
        etappenArt: einerVon(PDF_ETAPPEN_ARTEN, werte.pdfEtappenArt, "lang"),
        zusaetze: Object.fromEntries(ZUSAETZE.map((name) => [name, werte[ZUSATZ_WERT[name]]])) as Record<
            Zusatz,
            boolean
        >,
        wetter: werte.pdfWetter,
        format: einerVon(FORMATE, werte.pdfFormat, "a4"),
        lage: einerVon(PDF_LAGEN, werte.pdfLage, "hoch"),
        papier: einerVon(PDF_PAPIERE, werte.pdfPapier, "pergament"),
        titel,
        notiz: "",
        sprache,
        datei,
    };
}

/** Die Sprache des PDFs aus den Standardwerten: `seite` heißt die Sprache, in der die Seite gerade steht. */
export const startSprache = (vorgabe: string, seite: Locale): Locale => einerVon(LOCALES, vorgabe, seite);

/**
 * Die Karte, mit der der Dialog aufgeht. `aktuell` heißt, was die Karte gerade zeigt; dasselbe gilt, wenn die eingestellte Serie fehlt
 * oder die Gebiete für „Politisch“ noch nicht geladen sind (die Karte zeigte sonst etwas anderes, als die Wahl sagt).
 */
export function startWahl(
    vorgabe: string,
    jetzt: KartenWahl | undefined,
    aktuelleSerie: string,
    serien: readonly WahlSerie[],
    politischBereit: boolean,
): KartenWahl {
    const aktuell: KartenWahl = jetzt ?? `serie:${aktuelleSerie}`;
    if (vorgabe === "politisch") return politischBereit ? "politisch" : aktuell;
    const gibt = kartenWahlen(serien) as string[];
    return gibt.includes(vorgabe) ? (vorgabe as KartenWahl) : aktuell;
}

/** Der Dateiname aus der Vorlage der Standardwerte: `{von}` und `{bis}` werden Start und Ziel. */
export const dateiAusVorlage = (vorlage: string, von: string, bis: string): string =>
    vorlage.replace(/\{(von|bis)\}/g, (_treffer, teil: string) => (teil === "von" ? von : bis));

/** Die Wahlen unter „Karte“ in der Folge des Entwurfs: Serien, Politisch, die Ebenen der Derographie. */
export function kartenWahlen(serien: readonly WahlSerie[]): KartenWahl[] {
    return [
        ...serien.map((serie): KartenWahl => `serie:${serie.id}`),
        "politisch",
        ...DERO_EBENEN.map((ebene): KartenWahl => `dero:${ebene}`),
    ];
}

export const istDero = (wahl: KartenWahl): wahl is `dero:${DeroEbene}` => wahl.startsWith("dero:");
export const serieDerWahl = (wahl: KartenWahl): string | undefined =>
    wahl.startsWith("serie:") ? wahl.slice("serie:".length) : undefined;
export const ebeneDerWahl = (wahl: KartenWahl): DeroEbene | undefined =>
    istDero(wahl) ? (wahl.slice("dero:".length) as DeroEbene) : undefined;

/** Was die Karte gerade zeigt, als Wahl - der goldene Punkt „gerade auf der Karte“; die Kraftlinien sind keine der Wahlen. */
export function wahlAus(jetzt: KartenAnsicht, serien: readonly WahlSerie[]): KartenWahl | undefined {
    if (jetzt.view === "standard" || jetzt.view === "none") {
        return serien.some((serie) => serie.id === jetzt.series) ? `serie:${jetzt.series}` : undefined;
    }
    if (jetzt.view === "political") return "politisch";
    if (jetzt.view === "landscapes") {
        if (jetzt.landscape === "topographie" && jetzt.topography === "hoehenstufen") return "dero:hoehenstufen";
        return `dero:${jetzt.landscape}`;
    }
    return undefined;
}

/**
 * Wie die Karte für eine Wahl steht. 🔴 Ist die Wahl das, was gerade zu sehen ist, bleibt alles, wie es ist (auch „Nur Karte“). Eine Serie
 * mit Namen im Bild steht unter „Nur Karte“, jede andere in der Standardansicht; Politisch und Derographie behalten die Serie, außer sie ist
 * eine solche (dann die Vorgabe), sonst stünde jeder Name doppelt. In der Derographie lässt die Karte das Kartenbild ohnehin weg.
 */
export function ansichtFuer(
    wahl: KartenWahl,
    jetzt: KartenAnsicht,
    serien: readonly WahlSerie[],
    vorgabeSerie: string,
): KartenAnsicht {
    if (wahlAus(jetzt, serien) === wahl) return { ...jetzt };
    const nurKarte = (id: string): boolean => serien.find((serie) => serie.id === id)?.nurKarte === true;
    const serie = serieDerWahl(wahl);
    if (serie !== undefined) return { ...jetzt, series: serie, view: nurKarte(serie) ? "none" : "standard" };
    const ohneBildnamen = nurKarte(jetzt.series) ? vorgabeSerie : jetzt.series;
    if (wahl === "politisch") return { ...jetzt, view: "political", series: ohneBildnamen };
    const ebene = ebeneDerWahl(wahl) ?? "alle";
    if (ebene === "hoehenstufen") {
        return {
            ...jetzt,
            view: "landscapes",
            landscape: "topographie",
            topography: "hoehenstufen",
            series: ohneBildnamen,
        };
    }
    return {
        ...jetzt,
        view: "landscapes",
        landscape: ebene,
        topography: ebene === "topographie" ? "hoehenlinien" : jetzt.topography,
        series: ohneBildnamen,
    };
}

export const gleicheAnsicht = (a: KartenAnsicht, b: KartenAnsicht): boolean =>
    a.view === b.view && a.landscape === b.landscape && a.topography === b.topography && a.series === b.series;

/** Zeichen, die kein Dateisystem im Namen nimmt, und Steuerzeichen. */
// eslint-disable-next-line no-control-regex -- die Steuerzeichen sind genau das, was hier fällt
const VERBOTEN = /[\\/:*?"<>|\u0000-\u001f]/g;
const LAENGE = 120;

/** Der Dateiname ohne Endung, so wie ein Dateisystem ihn nimmt; leer wird er zur Vorgabe. Eine getippte Endung „.pdf“ fällt weg. */
export function dateiName(eingabe: string, vorgabe: string): string {
    const name = eingabe
        .replace(VERBOTEN, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.pdf$/i, "")
        .replace(/[. ]+$/, "")
        .slice(0, LAENGE)
        .trim();
    return name === "" ? vorgabe : name;
}

/** Die Seitengröße in Punkten (1/72 Zoll), hoch; quer tauscht sie. */
export const PAPIER_MASSE: Readonly<Record<Format, readonly [number, number]>> = {
    a4: [595.28, 841.89],
    a5: [419.53, 595.28],
    letter: [612, 792],
};

export function seitenMasse(format: Format, lage: Lage): { breite: number; hoehe: number } {
    const [breite, hoehe] = PAPIER_MASSE[format];
    return lage === "quer" ? { breite: hoehe, hoehe: breite } : { breite, hoehe };
}

/** Wie viele der Inhalte gewählt sind, gezählt nur unter denen, die diese Reise trägt („6 von 8“). */
export function inhaltZaehler(
    inhalt: Readonly<Record<Inhalt, boolean>>,
    verfuegbar: Readonly<Record<Inhalt, boolean>>,
): { gewaehlt: number; von: number } {
    const da = INHALTE.filter((name) => verfuegbar[name]);
    return { gewaehlt: da.filter((name) => inhalt[name]).length, von: da.length };
}

/** Was wirklich hineinkommt: gewählt UND für diese Reise vorhanden. */
export function wirksamerInhalt(
    inhalt: Readonly<Record<Inhalt, boolean>>,
    verfuegbar: Readonly<Record<Inhalt, boolean>>,
): Record<Inhalt, boolean> {
    return Object.fromEntries(INHALTE.map((name) => [name, inhalt[name] && verfuegbar[name]])) as Record<
        Inhalt,
        boolean
    >;
}
