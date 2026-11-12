import { AVENTURIA_SERIES } from "@avesmaps3d/shared";
import type {
    KartenSvgDaten,
    SvgBeschriftung,
    SvgFlaeche,
    SvgGebiet,
    SvgKraftlinie,
    SvgLandmarke,
    SvgOrt,
    SvgWeg,
} from "./daten.ts";
import {
    BESCHRIFTUNGSFARBE,
    FLUSSARTEN,
    GEBIETSFARBE,
    GEBIETSGRENZE_BREITE,
    KRAFTLINIEN_BREITE,
    KRAFTLINIENFARBE,
    LANDMARKENFARBE,
    LANDMARKEN_RADIUS,
    ORTSFARBE,
    WASSERARTEN,
    WEGARTEN_ZEICHENREIHENFOLGE,
    WEGFARBE_RUECKFALL,
    WEGFARBEN,
    flaechenFarbe,
    mantelBreite,
    wegBreite,
} from "./farben.ts";
import {
    ZEICHENRAUM,
    flaecheninhalt,
    flaechenDaten,
    linienDaten,
    rund,
    svgPunkt,
    vertreterPunktFlaeche,
    vertreterPunktLinie,
    type Punkt,
} from "./geometrie.ts";
import { baueKontextIndex, kontextAm, type KontextEintrag, type KontextIndex } from "./kontext.ts";
import {
    KARTEN_SVG_EBENEN,
    bereinigeKartenSvgOptionen,
    type KartenSvgDialekt,
    type KartenSvgEbene,
    type KartenSvgOptionen,
} from "./optionen.ts";
import {
    GRUPPE_SCHLIESSEN,
    attributText,
    ebeneOeffnen,
    faltAscii,
    gruppeOeffnen,
    gruppenKennung,
    kennungFuer,
    labelAttribut,
    maskiere,
    zahlText,
} from "./text.ts";
import {
    ART_VOKABULAR,
    EBENEN_VOKABULAR,
    FELDER_VOKABULAR,
    LANDMARKENARTEN_REIHE,
    TYP_VOKABULAR,
} from "./vokabular.ts";

/**
 * Der reine Bauer des SVG-Abzugs (WI-0280 K2): Daten rein, Text raus. Portierung von Legacys `js/pages/svg-export-build.js`.
 *
 * 🔴 KEINE DATENBANK, KEIN DATEISYSTEM, KEIN `Date`, KEIN ZUFALL. Das ist der Vertrag, und er ist der Grund, warum diese Datei testbar ist
 * und warum gleiche Eingaben gleiche Bytes ergeben (Prüfsumme des Abzugs, bedingter Abruf). Die Daten holt `daten.ts`, die Uhrzeit
 * reicht der Aufrufer herein (`stempel.erstellt`).
 *
 * Die Ebenen, von unten nach oben (in SVG liegt das Erste unten): Landschaften, Herrschaftsgebiete, Wege, Kraftlinien, Orte,
 * Beschriftungen. Es gibt KEINE Ebene „Regionen“: Die Flächen, die man dafür hielte, sind die Landschaften.
 *
 * 🔴 „FLÜSSE UNTER SEEN“ (Owner 15.08.2026). Die Wege sind Ebene 3, die Landschaften Ebene 1, also läge ALLES aus den Wegen über jedem
 * See. Die Flüsse (und der Bach) ziehen deshalb in die Landschaften-Ebene, unmittelbar vor die Wasserflächen: über Wald und Land, unter
 * See und Meer. Ihre ids landen trotzdem in der Wegemerkliste, also findet die Beschriftung sie. Sie zählen als Wege (`zaehler.wege`).
 * Das gilt nur, wenn Landschaften UND Wege in der Datei stehen; sonst bleiben sie in den Wegen.
 *
 * 🔴 HERRSCHAFTSGEBIETE WERDEN NIE GEGLÄTTET (Owner 15.08.2026: „auf keinen Fall“). Eine politische Grenze ist eine Behauptung über einen
 * Verlauf, keine organische Form: Eine gerundete Grenze verschiebt Land zwischen Reichen und sieht dabei aus wie eine Verbesserung.
 * `false` steht ausgeschrieben unten und nicht etwa `optionen.glattFlaechen`: Wer den Schalter durchreichen will, muss diese Zeile
 * löschen und stolpert dabei über die Begründung. `avm:flaechen_geglaettet="ja"` gilt den LANDSCHAFTSflächen.
 *
 * Bewusst nicht übernommen (keine Einstellung dafür im Vertrag, und Legacys Vorgabe war jeweils „aus“): Konturen der Wege und Flächen,
 * Abwahl einzelner Unterarten, eigene Farbfelder. Bewusst nicht in der Datei: Sprachen, Reisebilder, Kartenserien.
 */

const AVM_NAMESPACE = "https://avesmaps.de/ns/export/1";

/** Ortsklassen in Katalogreihenfolge mit der geschätzten Ausdehnung (Durchmesser in Meilen); eine Zahl je Klasse, der Radius wird gerechnet. */
const MEILEN_JE_EINHEIT = 3;
const ORTSKLASSEN: readonly { readonly slug: string; readonly label: string; readonly meilen: number }[] = [
    { slug: "metropole", label: "Metropole", meilen: 5.5 },
    { slug: "grossstadt", label: "Großstadt", meilen: 2.2 },
    { slug: "stadt", label: "Stadt", meilen: 1.25 },
    { slug: "kleinstadt", label: "Kleinstadt", meilen: 0.7 },
    { slug: "dorf", label: "Dorf", meilen: 0.5 },
    { slug: "gebaeude", label: "Gebäude", meilen: 0.15 },
    // Zeichen für Zeichen die Zeile darüber (Owner 31.08.2026): eine eigene Zahl wäre eine Aussage, die niemand getroffen hat.
    { slug: "stadtviertel", label: "Stadtviertel", meilen: 0.15 },
];
/** Eine unbekannte Ortsklasse liegt IN der Reihe, nicht daneben: zwischen Dorf und Kleinstadt. */
const ORTS_RADIUS_RUECKFALL_MEILEN = 0.6;

/**
 * 🔴 DIE ZAHL IST EINE GESCHÄTZTE ORTSAUSDEHNUNG, KEINE DARSTELLUNGSGRÖSSE (Owner 08.09.2026). Zwei Anker (Gareth 5,5 Meilen, Dorf
 * 0,5 Meilen), dazwischen ⌀ ∝ √Einwohner. Vier Nachkommastellen, weil die Zahlen klein sind: bei 1024 Einheiten Kantenlänge wäre die
 * zweite Stelle für ein Gebäude (0,025) bereits eine Stufe von 20 %.
 */
function ortsRadius(durchmesserMeilen: number): number {
    return Math.round((durchmesserMeilen / MEILEN_JE_EINHEIT / 2) * 10_000) / 10_000;
}

/** Das Wort einer Art für eine Gruppen-id: gefaltet, klein, nie leer. */
const kurzname = (art: string): string => faltAscii(art).toLowerCase() || "ohne";

/** Gruppiert in Einlesereihenfolge; die Reihenfolge der Schlüssel ist die ihres ersten Auftretens. */
function gruppiere<T>(eintraege: readonly T[], schluessel: (eintrag: T) => string): Map<string, T[]> {
    const gruppen = new Map<string, T[]>();
    for (const eintrag of eintraege) {
        const key = schluessel(eintrag);
        const liste = gruppen.get(key);
        if (liste) liste.push(eintrag);
        else gruppen.set(key, [eintrag]);
    }
    return gruppen;
}

/** Anhängen ohne Spread im Funktionsaufruf: Eine Liste mit mehr als etwa hunderttausend Einträgen sprengt sonst den Aufrufstapel. */
function haengeAn(ziel: string[], quelle: readonly string[]): void {
    for (const teil of quelle) ziel.push(teil);
}

// ---- Zustand eines Baus -------------------------------------------------------------------------------------------------

interface Bau {
    readonly dialekt: KartenSvgDialekt;
    readonly semantik: boolean;
    readonly skala: number;
    readonly glattWege: boolean;
    readonly glattFlaechen: boolean;
    readonly spannung: number;
    /** Alle vergebenen ids, Gruppen und Elemente: eine id kommt genau einmal vor. */
    readonly gesehen: Set<string>;
    /** `public_id` eines Wegs → die id seiner Linie, für die Beschriftung entlang der Linie. */
    readonly wegIds: Map<string, string>;
    /** Die wirklich geschriebenen `avm:type`, mit Anzahl. 💣 Das Vokabular entsteht aus DIESEM Zählwerk und nirgends sonst. */
    readonly typen: Map<string, number>;
    /** Klima- und Reliefwerte, die an Elementen stehen: Auch sie erklärt die Datei. */
    readonly kontextWerte: Set<string>;
    readonly arten: Set<string>;
    readonly ebenen: Set<string>;
    readonly kombinationen: Map<string, { anzahl: number; flaeche: number }>;
    readonly kontext: KontextIndex | null;
    readonly passmarken: boolean;
    readonly groessePx: number;
    readonly zaehler: Record<string, number>;
}

interface Ebenenteil {
    readonly teile: string[];
    readonly anzahl: number;
}

type Felder = Record<string, string | undefined>;

/**
 * Die `avm:`-Attribute eines Elements. Leer, wenn niemand sie bestellt hat: Niemand bekommt 20.000-mal drei Attribute ungefragt.
 * `avm:id` ist die DAUERHAFTE Kennung (`public_id`), nicht die XML-id; die trägt den Namen, damit Illustrator und Inkscape etwas
 * Lesbares zeigen, und ändert sich mit jeder Umbenennung. Wer zwei Abzüge vergleichen will, nimmt `avm:id`.
 */
function avmAttribute(bau: Bau, felder: Felder): string {
    if (!bau.semantik) return "";
    if (felder["type"]) bau.typen.set(felder["type"], (bau.typen.get(felder["type"]) ?? 0) + 1);
    if (felder["kind"]) bau.arten.add(felder["kind"]);
    if (felder["ebene"]) bau.ebenen.add(felder["ebene"]);
    return Object.entries(felder)
        .filter(([, wert]) => wert !== undefined && wert !== "")
        .map(([name, wert]) => ` avm:${name}="${maskiere(wert)}"`)
        .join("");
}

function kontextFelder(
    bau: Bau,
    punkt: Punkt | null,
): { felder: Felder; relief: KontextEintrag | null; klima: string } {
    const kontext = kontextAm(bau.kontext, punkt);
    if (kontext.klima) bau.kontextWerte.add(kontext.klima);
    if (kontext.relief) bau.kontextWerte.add(kontext.relief.typ);
    return {
        // Leer, wenn das Relief keinen benannten Gipfel mit Höhe trägt: Eine fehlende Angabe ist ehrlicher als eine gerundete Null.
        felder: {
            klima: kontext.klima,
            relief: kontext.relief?.typ ?? "",
            hoehe: kontext.relief?.hoehe ? String(kontext.relief.hoehe) : "",
        },
        relief: kontext.relief,
        klima: kontext.klima,
    };
}

/** Den Namen einer Wegart im Anzeigebegriff: `Bach` ist ein Flussweg mit Merkmal (Owner 30.08.2026), keine neunte gespeicherte Art. */
function anzeigeArt(weg: SvgWeg): string {
    return weg.art === "Flussweg" && weg.bach ? "Bach" : weg.art;
}

/**
 * 🔴 PASSMARKEN gegen das Photoshop-Problem (Owner 15.08.2026). Photoshop beschneidet eine rasterisierte Ebene auf ihren INHALT; rastert
 * man die Ebenen einzeln, hat jede eine andere Ausdehnung, und der Bezug zur Leinwand ist weg. Vier deckende Quadrate in den vier Ecken
 * jeder Ebene: Damit misst jede Ebene genau die Leinwand und fällt bei 0,0 an ihren Platz.
 * 💣 DECKEND, nicht halbdurchsichtig (Antialiasing kann ein Alpha von 1/255 auf 0 runden, und die Marke wäre fort, ohne dass es jemand
 * merkt). 💣 VIER, nicht zwei: zwei Ecken legen die Ausdehnung fest, vier verraten zusätzlich, ob eine Ebene gespiegelt hereinkam.
 * 💣 Die ids sind JE EBENE verschieden; sechsmal dieselben vier ids waren gegen die Spec, und Inkscape schrieb sie still um.
 * Magenta, weil die Farbe auf dieser Karte sonst nirgends vorkommt und sich per „Ähnliche auswählen“ in einem Griff erwischen lässt.
 */
const PASSMARKENFARBE = "#ff00ff";

function passmarken(bau: Bau, ebeneId: string): string[] {
    // Kantenlänge = 1 Bildpunkt bei der gewählten Ausgabegröße: kleiner wäre nicht mehr zuverlässig, größer unnötig auffällig.
    const kante = ZEICHENRAUM / Math.max(1, bau.groessePx);
    const fuenf = (zahl: number): number => Math.round(zahl * 100_000) / 100_000;
    const ende = ZEICHENRAUM - kante;
    const ecken: readonly (readonly [number, number])[] = [
        [0, 0],
        [ende, 0],
        [0, ende],
        [ende, ende],
    ];
    const teile = [
        gruppeOeffnen({
            id: gruppenKennung(`${ebeneId}-passmarken`, bau.gesehen),
            name: "Passmarken",
            dialekt: bau.dialekt,
            attribute: { fill: PASSMARKENFARBE, stroke: "none" },
        }),
    ];
    ecken.forEach(([x, y], index) => {
        const id = gruppenKennung(`${ebeneId}-passmarke-${String(index + 1)}`, bau.gesehen);
        teile.push(
            `<rect id="${maskiere(id)}" x="${fuenf(x)}" y="${fuenf(y)}" width="${fuenf(kante)}" height="${fuenf(kante)}"/>\n`,
        );
    });
    teile.push(GRUPPE_SCHLIESSEN);
    return teile;
}

/** Schließt eine Ebene. Die Passmarken kommen INNEN, kurz vor dem Schließen: Außen läge eine Ebene neben der Ebene, und genau die käme beim Rastern nicht mit. */
function schliesseEbene(bau: Bau, ebeneId: string, teile: string[]): string[] {
    if (bau.passmarken) teile.push(...passmarken(bau, ebeneId));
    teile.push(GRUPPE_SCHLIESSEN);
    return teile;
}

function zaehle(bau: Bau, ebene: string, gruppe: string, anzahl = 1): void {
    const schluessel = `${ebene}/${gruppe}`;
    bau.zaehler[schluessel] = (bau.zaehler[schluessel] ?? 0) + anzahl;
    bau.zaehler[ebene] = (bau.zaehler[ebene] ?? 0) + anzahl;
}

// ---- Wege ---------------------------------------------------------------------------------------------------------------

/**
 * Die Wegegruppen (ohne Ebenenhülle), damit die Flüsse in die Landschaften-Ebene wandern können, ohne dass ihr Code ein zweites Mal
 * geschrieben wird. `nimm` entscheidet, welche Anzeigearten dabei sind. Eine leere Untergruppe wird gar nicht geschrieben: Leere Ordner
 * im Ebenenfenster lesen sich wie ein Fehler, obwohl nur nichts da war.
 */
function wegGruppen(bau: Bau, wege: readonly SvgWeg[], nimm: (art: string) => boolean): Ebenenteil {
    const nachArt = gruppiere(
        wege.filter((weg) => weg.punkte.length >= 2 && nimm(anzeigeArt(weg))),
        anzeigeArt,
    );
    const bekannt: readonly string[] = WEGARTEN_ZEICHENREIHENFOLGE;
    const unbekannt = [...nachArt.keys()].filter((art) => !bekannt.includes(art)).sort();
    const teile: string[] = [];
    let anzahl = 0;

    for (const art of [...bekannt, ...unbekannt]) {
        const gruppe = nachArt.get(art);
        if (!gruppe || gruppe.length === 0) continue;
        const basis = gruppenKennung(`wege-${kurzname(art)}`, bau.gesehen);
        teile.push(
            gruppeOeffnen({
                id: basis,
                name: art,
                dialekt: bau.dialekt,
                attribute: { fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" },
            }),
            gruppeOeffnen({
                id: gruppenKennung(`${basis}-linie`, bau.gesehen),
                name: `${art} Linie`,
                dialekt: bau.dialekt,
                attribute: {
                    stroke: WEGFARBEN[art] ?? WEGFARBE_RUECKFALL,
                    "stroke-width": zahlText(wegBreite(art) * bau.skala),
                },
            }),
        );
        for (const weg of gruppe) {
            const name = weg.name || art;
            const id = kennungFuer(name, weg.kennung, bau.dialekt, bau.gesehen);
            // 🔴 Die Merkliste für die Beschriftung: die Beschriftung soll auf der Mitte des Wegs laufen und liest die id von hier.
            bau.wegIds.set(weg.kennung, id);
            const kontext = kontextFelder(bau, vertreterPunktLinie(weg.punkte));
            teile.push(
                `<path id="${maskiere(id)}"${labelAttribut(name, bau.dialekt)}` +
                    avmAttribute(bau, {
                        kind: "weg",
                        type: art,
                        name,
                        id: weg.kennung,
                        // Die GEZEICHNETE Breite in viewBox-Einheiten, immer mit dem Regler des Abzugs gerechnet. Wer Label und Bild
                        // zur Deckung bringen will, braucht die Breite als Zahl und nicht nur die Achse.
                        breite: zahlText(wegBreite(art) * bau.skala),
                        // Die Mantelbreite der KARTE, immer angegeben, auch wenn hier keine Kontur gezeichnet wird. 💣 Es ist die Breite
                        // der Leaflet-Karte, nicht die eines Kachel-Renderers (gemessen 8 statt 5 Bildpunkte): Wer sie gleichsetzt, irrt.
                        mantel_breite: zahlText(mantelBreite(art) * bau.skala),
                        ...kontext.felder,
                    }) +
                    ` d="${linienDaten(weg.punkte, bau.glattWege, bau.spannung)}">` +
                    `<title>${maskiere(name)}</title></path>\n`,
            );
            anzahl += 1;
            zaehle(bau, "wege", art);
        }
        teile.push(GRUPPE_SCHLIESSEN, GRUPPE_SCHLIESSEN);
    }
    return { teile, anzahl };
}

function wegeEbene(bau: Bau, wege: readonly SvgWeg[], flussUnten: boolean): Ebenenteil {
    const kopf = ebeneOeffnen({ id: "layer-wege", name: "Wege", dialekt: bau.dialekt });
    // Liegen die Flüsse unten, dürfen sie hier NICHT noch einmal kommen: sonst stünde jeder Fluss zweimal in der Datei.
    // 💣 Und der Bach ist einer von ihnen: Beide Listen (hier und beim Einhängen) nennen dieselben Arten.
    const gruppen = wegGruppen(bau, wege, (art) => !flussUnten || !(FLUSSARTEN as readonly string[]).includes(art));
    return { teile: schliesseEbene(bau, "layer-wege", [kopf, ...gruppen.teile]), anzahl: gruppen.anzahl };
}

// ---- Landschaften -------------------------------------------------------------------------------------------------------

/**
 * Die Landschaften. 🔴 WASSER ZULETZT, und dazwischen passt etwas hinein: Die Wasserflächen (See, Meer, Küste, Flussdelta) werden ans
 * ENDE der Ebene sortiert, und unmittelbar davor wird eingehängt, was `flussTeile` mitbringt. Ergebnis: Fluss über Wald und Land, aber
 * unter See und Meer. Gab es gar kein Wasser, kommen die Flüsse trotzdem in die Datei, am Ende der Ebene.
 *
 * 💣 Der Rückfall für eine Fläche ohne Art heißt `ohne_typ` und nicht etwa der Name der Ebene: Eine Fläche, die auf einen Namen fiele,
 * den kein Kästchen kennt, rutschte an jedem Filter vorbei und wäre nie abwählbar.
 *
 * 🔴 KEINE DECKKRAFT. Die Karte füllt mit Lasur, weil dort das Rasterbild durchscheinen soll; hier nicht (Owner 15.08.2026). Eine
 * halbdurchsichtige Fläche in einer Bearbeitungsdatei mischt sich mit allem darunter. Volle Deckung, Transparenz vergibt der Gestalter.
 */
function landschaftenEbene(bau: Bau, flaechen: readonly SvgFlaeche[], flussTeile: readonly string[]): Ebenenteil {
    const nachTyp = gruppiere(flaechen, (flaeche) => flaeche.typ);

    const wasser: readonly string[] = WASSERARTEN;
    const schluessel = [...nachTyp.keys()];
    const reihenfolge = [
        ...schluessel.filter((typ) => !wasser.includes(typ)),
        ...schluessel.filter((typ) => wasser.includes(typ)),
    ];
    const teile: string[] = [ebeneOeffnen({ id: "layer-landschaften", name: "Landschaften", dialekt: bau.dialekt })];
    let eingehaengt = false;
    let anzahl = 0;

    for (const typ of reihenfolge) {
        if (!eingehaengt && wasser.includes(typ)) {
            haengeAn(teile, flussTeile);
            eingehaengt = true;
        }
        const gruppe = nachTyp.get(typ) ?? [];
        const ebene = gruppe[0]?.ebene ?? "topographie";
        const gruppenTeile: string[] = [];
        for (const flaeche of gruppe) {
            const daten = flaechenDaten(flaeche.flaeche, bau.glattFlaechen, bau.spannung);
            if (!daten) continue;
            const name = flaeche.name || typ;
            const id = kennungFuer(name, flaeche.kennung, bau.dialekt, bau.gesehen);
            const kontext = kontextFelder(bau, vertreterPunktFlaeche(flaeche.flaeche));
            if (bau.semantik) {
                // 🔴 Die Matrix entsteht BEIM EXPORT, sie wird nirgends abgeschrieben (Owner 16.08.2026: „die editoren ändern ständig was“).
                // Gezählt wird mit, während der Kontext ohnehin ausgerechnet wird: eine Zeile je Element, kein zweiter Durchgang.
                const schluesselKombi = [
                    typ,
                    kontext.relief?.typ ?? "-",
                    kontext.klima || "-",
                    kontext.relief?.hoehe ?? "-",
                ].join("|");
                const alt = bau.kombinationen.get(schluesselKombi) ?? { anzahl: 0, flaeche: 0 };
                bau.kombinationen.set(schluesselKombi, {
                    anzahl: alt.anzahl + 1,
                    flaeche: alt.flaeche + flaecheninhalt(flaeche.flaeche),
                });
            }
            gruppenTeile.push(
                `<path id="${maskiere(id)}"${labelAttribut(name, bau.dialekt)}` +
                    avmAttribute(bau, {
                        kind: "landschaft",
                        type: typ,
                        id: flaeche.kennung,
                        landschaft: flaeche.landschaft,
                        ebene: flaeche.ebene,
                        name,
                        ...kontext.felder,
                    }) +
                    ` d="${daten}"><title>${maskiere(name)}</title></path>\n`,
            );
            anzahl += 1;
            zaehle(bau, "landschaften", typ);
        }
        teile.push(
            gruppeOeffnen({
                id: gruppenKennung(`layer-landschaften-${kurzname(typ)}`, bau.gesehen),
                name: typ,
                dialekt: bau.dialekt,
                attribute: { fill: flaechenFarbe(typ, ebene), "fill-rule": "evenodd", stroke: "none" },
            }),
        );
        haengeAn(teile, gruppenTeile);
        teile.push(GRUPPE_SCHLIESSEN);
    }
    // Gab es gar kein Wasser, kommen die Flüsse trotzdem in die Datei, am Ende der Ebene.
    if (!eingehaengt) haengeAn(teile, flussTeile);
    return { teile: schliesseEbene(bau, "layer-landschaften", teile), anzahl };
}

// ---- Herrschaftsgebiete -------------------------------------------------------------------------------------------------

function gebieteEbene(bau: Bau, gebiete: readonly SvgGebiet[]): Ebenenteil {
    const nachTyp = gruppiere(gebiete, (gebiet) => gebiet.typ);
    const teile: string[] = [ebeneOeffnen({ id: "layer-gebiete", name: "Herrschaftsgebiete", dialekt: bau.dialekt })];
    let anzahl = 0;

    for (const [typ, gruppe] of nachTyp) {
        const gruppenTeile: string[] = [];
        for (const gebiet of gruppe) {
            // 🔴 `false`, ausgeschrieben: siehe Kopf der Datei.
            const daten = flaechenDaten(gebiet.flaeche, false, bau.spannung);
            if (!daten) continue;
            const name = gebiet.name || typ;
            const id = kennungFuer(name, gebiet.kennung, bau.dialekt, bau.gesehen);
            const kontext = kontextFelder(bau, vertreterPunktFlaeche(gebiet.flaeche));
            gruppenTeile.push(
                `<path id="${maskiere(id)}"${labelAttribut(name, bau.dialekt)}` +
                    avmAttribute(bau, {
                        kind: "herrschaftsgebiet",
                        type: typ,
                        id: gebiet.kennung,
                        name,
                        ...kontext.felder,
                    }) +
                    ` d="${daten}"><title>${maskiere(name)}</title></path>\n`,
            );
            anzahl += 1;
            zaehle(bau, "gebiete", typ);
        }
        teile.push(
            gruppeOeffnen({
                id: gruppenKennung(`layer-gebiete-${kurzname(typ)}`, bau.gesehen),
                name: typ,
                dialekt: bau.dialekt,
                attribute: {
                    fill: "none",
                    "fill-rule": "evenodd",
                    stroke: GEBIETSFARBE,
                    "stroke-width": zahlText(GEBIETSGRENZE_BREITE * bau.skala),
                },
            }),
        );
        haengeAn(teile, gruppenTeile);
        teile.push(GRUPPE_SCHLIESSEN);
    }
    return { teile: schliesseEbene(bau, "layer-gebiete", teile), anzahl };
}

// ---- Kraftlinien --------------------------------------------------------------------------------------------------------

/**
 * Die Kraftlinien: Die gezeichnete Bahn der Karte (`drawn_geom`), nie geglättet, auch nicht in der geglätteten Fassung: Sie ist schon
 * eine abgetastete Kurve, und ein Abzug, der mehr zeigt als die Karte, wäre kein Abzug.
 */
function kraftlinienEbene(bau: Bau, linien: readonly SvgKraftlinie[]): Ebenenteil {
    const teile: string[] = [
        ebeneOeffnen({
            id: "layer-kraftlinien",
            name: "Kraftlinien",
            dialekt: bau.dialekt,
            attribute: {
                fill: "none",
                stroke: KRAFTLINIENFARBE,
                "stroke-linejoin": "round",
                "stroke-width": zahlText(KRAFTLINIEN_BREITE * bau.skala),
            },
        }),
    ];
    let anzahl = 0;
    for (const linie of linien) {
        if (linie.punkte.length < 2) continue;
        const name = linie.name || "Kraftlinie";
        const id = kennungFuer(name, linie.kennung, bau.dialekt, bau.gesehen);
        const kontext = kontextFelder(bau, vertreterPunktLinie(linie.punkte));
        teile.push(
            `<path id="${maskiere(id)}"${labelAttribut(name, bau.dialekt)}` +
                avmAttribute(bau, { kind: "kraftlinie", name, id: linie.kennung, ...kontext.felder }) +
                ` d="${linienDaten(linie.punkte, false, bau.spannung)}"><title>${maskiere(name)}</title></path>\n`,
        );
        anzahl += 1;
    }
    zaehle(bau, "kraftlinien", "Kraftlinien", anzahl);
    return { teile: schliesseEbene(bau, "layer-kraftlinien", teile), anzahl };
}

// ---- Orte und Landmarken ------------------------------------------------------------------------------------------------

function ortKreis(bau: Bau, felder: Felder, ort: { name: string; x: number; y: number }, radius: number): string {
    const punkt = svgPunkt(ort.x, ort.y);
    const kontext = kontextFelder(bau, [ort.x, ort.y]);
    const id = kennungFuer(ort.name, felder["id"] ?? "", bau.dialekt, bau.gesehen);
    return (
        `<circle id="${maskiere(id)}"${labelAttribut(ort.name, bau.dialekt)}` +
        avmAttribute(bau, { ...felder, ...kontext.felder }) +
        ` cx="${punkt.x}" cy="${punkt.y}" r="${radius}"><title>${maskiere(ort.name)}</title></circle>\n`
    );
}

/**
 * Die Orte nach Ortsklasse, danach die Landmarken nach Art (neu in Avesmaps3D: Gipfel, Höhlen, Wasserfälle …, soweit sie auf der Karte
 * stehen). Beide sind Punkte; `avm:kind` trennt sie (`ort` / `landmarke`), und die Gruppe heißt `orte-<klasse>` bzw. `orte-landmarke-<art>`.
 *
 * ⚠️ DARSTELLUNGSradius und Ausdehnung sind zwei Zahlen: `avm:radius` (nur Orte) ist die halbe geschätzte Ortsausdehnung, gezeichnet wird
 * derselbe Wert. Eine Landmarke hat keine Ausdehnung; ihr Kreis ist nur ein Punkt, und `avm:radius` fehlt.
 */
function ortsEbene(bau: Bau, orte: readonly SvgOrt[], landmarken: readonly SvgLandmarke[]): Ebenenteil {
    const teile: string[] = [ebeneOeffnen({ id: "layer-orte", name: "Orte", dialekt: bau.dialekt })];
    let anzahl = 0;

    const nachKlasse = gruppiere(orte, (ort) => ort.art);
    const klassen = ORTSKLASSEN.map((klasse) => klasse.slug);
    const unbekannteKlassen = [...nachKlasse.keys()].filter((art) => !klassen.includes(art)).sort();

    for (const slug of [...klassen, ...unbekannteKlassen]) {
        const gruppe = nachKlasse.get(slug);
        if (!gruppe || gruppe.length === 0) continue;
        const klasse = ORTSKLASSEN.find((eintrag) => eintrag.slug === slug);
        const label = klasse?.label ?? (slug || "Ort");
        const radius = ortsRadius(klasse?.meilen ?? ORTS_RADIUS_RUECKFALL_MEILEN);
        teile.push(
            gruppeOeffnen({
                id: gruppenKennung(`orte-${kurzname(slug)}`, bau.gesehen),
                name: label,
                dialekt: bau.dialekt,
                attribute: { fill: ORTSFARBE, stroke: "none" },
            }),
        );
        for (const ort of gruppe) {
            const name = ort.name || label;
            teile.push(
                ortKreis(
                    bau,
                    { kind: "ort", type: slug, name, id: ort.kennung, radius: String(radius) },
                    { name, x: ort.x, y: ort.y },
                    radius,
                ),
            );
            anzahl += 1;
            zaehle(bau, "orte", label);
        }
        teile.push(GRUPPE_SCHLIESSEN);
    }

    const nachArt = gruppiere(landmarken, (landmarke) => landmarke.art);
    const bekannteArten: readonly string[] = LANDMARKENARTEN_REIHE;
    const unbekannteArten = [...nachArt.keys()].filter((art) => !bekannteArten.includes(art)).sort();

    for (const art of [...bekannteArten, ...unbekannteArten]) {
        const gruppe = nachArt.get(art);
        if (!gruppe || gruppe.length === 0) continue;
        const label = `Landmarke ${TYP_VOKABULAR[art]?.de ?? art}`;
        teile.push(
            gruppeOeffnen({
                id: gruppenKennung(`orte-landmarke-${kurzname(art)}`, bau.gesehen),
                name: label,
                dialekt: bau.dialekt,
                attribute: { fill: LANDMARKENFARBE, stroke: "none" },
            }),
        );
        for (const landmarke of gruppe) {
            const name = landmarke.name || label;
            teile.push(
                ortKreis(
                    bau,
                    {
                        kind: "landmarke",
                        type: art,
                        name,
                        id: landmarke.kennung,
                        ...(landmarke.hoehe !== null && landmarke.hoehe > 0
                            ? { eigene_hoehe: String(landmarke.hoehe) }
                            : {}),
                    },
                    { name, x: landmarke.x, y: landmarke.y },
                    LANDMARKEN_RADIUS,
                ),
            );
            anzahl += 1;
            zaehle(bau, "orte", label);
        }
        teile.push(GRUPPE_SCHLIESSEN);
    }
    return { teile: schliesseEbene(bau, "layer-orte", teile), anzahl };
}

// ---- Beschriftungen -----------------------------------------------------------------------------------------------------

/**
 * Die Beschriftungen: Ortsnamen, Wegnamen ENTLANG der Linie, freie Namen (Landschaften, Regionen, Landmarken).
 *
 * 🔴 DIE KOPPLUNG. Der `<textPath href>` liest die id der Linie aus der Merkliste, die der Wegebauer gefüllt hat. Ein selbst
 * zusammengesetzter Name wäre ein Verweis ins Leere, und diese ganze Gruppe bliebe unsichtbar. Ohne die Wegeebene fehlt die Merkliste,
 * und es gibt keine Wegnamen: richtig so, ein Verweis auf eine Linie, die es nicht gibt, wäre kaputt.
 */
function beschriftungenEbene(
    bau: Bau,
    orte: readonly SvgOrt[],
    wege: readonly SvgWeg[],
    landmarken: readonly SvgLandmarke[],
    freie: readonly SvgBeschriftung[],
): Ebenenteil {
    const teile: string[] = [
        ebeneOeffnen({
            id: "layer-beschriftungen",
            name: "Beschriftungen",
            dialekt: bau.dialekt,
            attribute: { "font-family": "Georgia, serif", fill: BESCHRIFTUNGSFARBE },
        }),
    ];
    let anzahl = 0;

    teile.push(
        gruppeOeffnen({
            id: gruppenKennung("beschriftung-orte", bau.gesehen),
            name: "Orte",
            dialekt: bau.dialekt,
            attribute: { "font-size": "1.6", "text-anchor": "middle" },
        }),
    );
    for (const ort of orte) {
        if (!ort.name || !ort.beschriftung) continue;
        const punkt = svgPunkt(ort.x, ort.y);
        const id = kennungFuer(`${ort.name}-Beschriftung`, ort.kennung, bau.dialekt, bau.gesehen);
        teile.push(
            `<text id="${maskiere(id)}"${labelAttribut(ort.name, bau.dialekt)} x="${punkt.x}" y="${rund(punkt.y + 2.6)}">${maskiere(ort.name)}</text>\n`,
        );
        anzahl += 1;
        zaehle(bau, "beschriftungen", "Orte");
    }
    teile.push(GRUPPE_SCHLIESSEN);

    teile.push(
        gruppeOeffnen({
            id: gruppenKennung("beschriftung-wege", bau.gesehen),
            name: "Wege",
            dialekt: bau.dialekt,
            attribute: { "font-size": "1.3" },
        }),
    );
    for (const weg of wege) {
        if (!weg.name || !weg.beschriftung) continue;
        const linienId = bau.wegIds.get(weg.kennung);
        if (!linienId) continue;
        const id = kennungFuer(`${weg.name}-Wegbeschriftung`, weg.kennung, bau.dialekt, bau.gesehen);
        teile.push(
            `<text id="${maskiere(id)}"${labelAttribut(weg.name, bau.dialekt)}>` +
                `<textPath href="#${maskiere(linienId)}" startOffset="50%">${maskiere(weg.name)}</textPath></text>\n`,
        );
        anzahl += 1;
        zaehle(bau, "beschriftungen", "Wege");
    }
    teile.push(GRUPPE_SCHLIESSEN);

    teile.push(
        gruppeOeffnen({
            id: gruppenKennung("beschriftung-gebiete", bau.gesehen),
            name: "Gebiete",
            dialekt: bau.dialekt,
            attribute: { "font-size": "2.2", "text-anchor": "middle" },
        }),
    );
    // Freie Namen wie auf der Karte, danach die Namen der Landmarken (in Legacy waren die Gipfel freie Beschriftungen und standen hier).
    const namen: readonly { kennung: string; name: string; x: number; y: number; suffix: string }[] = [
        ...freie.map((eintrag) => ({ ...eintrag, suffix: "Gebietsname" })),
        ...landmarken.map((eintrag) => ({
            kennung: eintrag.kennung,
            name: eintrag.name,
            x: eintrag.x,
            y: eintrag.y,
            suffix: "Landmarkenname",
        })),
    ];
    for (const eintrag of namen) {
        if (!eintrag.name) continue;
        const punkt = svgPunkt(eintrag.x, eintrag.y);
        const id = kennungFuer(`${eintrag.name}-${eintrag.suffix}`, eintrag.kennung, bau.dialekt, bau.gesehen);
        teile.push(
            `<text id="${maskiere(id)}"${labelAttribut(eintrag.name, bau.dialekt)} x="${punkt.x}" y="${punkt.y}">${maskiere(eintrag.name)}</text>\n`,
        );
        anzahl += 1;
        zaehle(bau, "beschriftungen", "Gebiete");
    }
    teile.push(GRUPPE_SCHLIESSEN);
    return { teile: schliesseEbene(bau, "layer-beschriftungen", teile), anzahl };
}

// ---- Kopf und Vokabular -------------------------------------------------------------------------------------------------

function dokumentKopf(
    bau: Bau,
    vokabular: string | null,
    stempel: { erstellt: string },
    daten: KartenSvgDaten,
    optionen: KartenSvgOptionen,
): string {
    const inkscape = bau.dialekt === "inkscape" ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' : "";
    const avm = bau.semantik ? ` xmlns:avm="${AVM_NAMESPACE}"` : "";
    // 🔴 DER FASSUNGSSTEMPEL. Ohne ihn lässt sich nicht beweisen, dass dieser Vektorabzug und ein danebenliegender Rasterabzug DIESELBE Welt
    // zeigen. Die Zahlen kommen aus der Datenbank (`daten.ts`), nicht aus einer Uhr; `avm:exportiert` ist die einzige Zeit und kommt von
    // außen. Die Wurzelattribute sind die WAHRHEIT über den Zustand der Datei, nicht der Wunsch, mit dem sie bestellt wurde.
    const stempelAttribute = bau.semantik
        ? attributText({
              "avm:kartenfassung": daten.staende.kartenfassung,
              "avm:landschaftsfassung": daten.staende.landschaftsfassung,
              "avm:exportiert": stempel.erstellt,
              "avm:einheit_px": String(Math.round((bau.groessePx / ZEICHENRAUM) * 1000) / 1000),
              "avm:geglaettet": optionen.glattWege ? "ja" : "nein",
              "avm:flaechen_geglaettet": optionen.glattFlaechen ? "ja" : "nein",
              ...(daten.staende.importstand ? { "avm:importstand": daten.staende.importstand } : {}),
          })
        : "";
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
        inkscape +
        avm +
        ` viewBox="0 0 ${String(ZEICHENRAUM)} ${String(ZEICHENRAUM)}" width="${String(bau.groessePx)}" height="${String(bau.groessePx)}"` +
        stempelAttribute +
        ">\n" +
        // Die Lizenz reist mit: Eine SVG geht nach draußen und muss ohne die Website erklären können, woher sie kommt und was erlaubt ist.
        "<metadata>\n" +
        "  Avesmaps — https://avesmaps.de\n" +
        "  Nicht-kommerzielles Fanprojekt zu Das Schwarze Auge / Aventurien.\n" +
        `  Lizenz: ${AVENTURIA_SERIES.license.uri}\n` +
        // Das Vokabular macht die Datei SELBSTERKLÄREND. JSON in einem <desc>, weil das überall durchkommt und nichts zeichnet.
        (vokabular ? `  <desc id="avm-vokabular">${maskiere(vokabular)}</desc>\n` : "") +
        "</metadata>\n"
    );
}

function vokabularText(bau: Bau): string {
    // Das Vokabular führt NUR, was wirklich in der Datei steht: Eine Liste aller denkbaren Typen wäre eine Behauptung über eine Datei, die es nicht gibt.
    const typen: Record<string, { de: string; en: string; anzahl: number; unbeschrieben?: true }> = {};
    const eintrag = (
        schluessel: string,
        anzahl: number,
    ): { de: string; en: string; anzahl: number; unbeschrieben?: true } => {
        const begriff = TYP_VOKABULAR[schluessel];
        // ⚠️ Ein Typ ohne Eintrag wird TROTZDEM geführt, mit dem rohen Schlüssel und dem Vermerk, dass er unbeschrieben ist. Ihn wegzulassen
        // hieße, eine Vokabel zu benutzen und zu verschweigen (Gebietsarten sind freier Text und kommen so in die Datei).
        return begriff
            ? { de: begriff.de, en: begriff.en, anzahl }
            : { de: schluessel, en: "", anzahl, unbeschrieben: true };
    };
    for (const [schluessel, anzahl] of bau.typen) typen[schluessel] = eintrag(schluessel, anzahl);
    // Klima und Relief stehen an Elementen, auch wenn deren Ebene nicht in der Datei ist: Auch diese Werte erklärt die Datei (Anzahl 0).
    for (const wert of [...bau.kontextWerte].sort()) if (!(wert in typen)) typen[wert] = eintrag(wert, 0);

    const begriffe = (tafel: Readonly<Record<string, { de: string; en: string }>>, benutzt: ReadonlySet<string>) =>
        Object.fromEntries(
            [...benutzt].sort().map((schluessel) => [schluessel, tafel[schluessel] ?? { de: schluessel, en: "" }]),
        );

    // Die Klimabänder als y-Bereiche, in SVG-y (nach unten wachsend) wie alles hier.
    // 💣 DAS SIND HÜLLBOXEN, KEINE SCHNITTE, und sie ÜBERLAPPEN SICH kräftig (Legacy gemessen: polar 0…141, subpolar 102…290). Wer allein aus y
    // auf die Zone schließt, ordnet im Überlappungsbereich falsch ein. Als Vorfilter brauchbar; exakt gehen die Bandpolygone selbst, sie liegen in der Datei.
    const baender = (bau.kontext?.klima ?? [])
        .map((eintragKlima) => ({
            typ: eintragKlima.typ,
            y_von: rund(ZEICHENRAUM - eintragKlima.box.maxY),
            y_bis: rund(ZEICHENRAUM - eintragKlima.box.minY),
        }))
        .sort((a, b) => a.y_von - b.y_von || (a.typ < b.typ ? -1 : 1));

    return JSON.stringify({
        hinweis: "avm:kind/type/klima/relief an jedem Element. Nur Fakten, keine Deutung.",
        quelle: "https://avesmaps.de",
        felder: FELDER_VOKABULAR,
        arten: begriffe(ART_VOKABULAR, bau.arten),
        ebenen: begriffe(EBENEN_VOKABULAR, bau.ebenen),
        typen,
        klimabaender_hinweis:
            "Huellboxen, ueberlappend -- Vorfilter. Exakt: die Bandpolygone in der Ebene Landschaften (avm:ebene=klima).",
        klimabaender: baender,
        // 🔴 Zusicherung: Die Malreihenfolge IST die Dokumentordnung. Was später im Dokument steht, liegt oben. Es gibt keine z-Angabe.
        reihenfolge: "Dokumentordnung: was spaeter steht, liegt oben.",
        // Die tatsächlich vorkommenden Kombinationen aus DIESEM Export, nach FLÄCHE sortiert (was groß ist, prägt das Bild).
        kombinationen: [...bau.kombinationen.entries()]
            .map(([schluessel, wert]) => {
                const [typ = "", relief = "-", klima = "-", hoehe = "-"] = schluessel.split("|");
                return {
                    typ,
                    relief: relief === "-" ? "" : relief,
                    klima: klima === "-" ? "" : klima,
                    gipfelhoehe: hoehe === "-" ? "" : Number(hoehe),
                    anzahl: wert.anzahl,
                    flaeche: Math.round(wert.flaeche * 100) / 100,
                };
            })
            .sort((a, b) => b.flaeche - a.flaeche),
    });
}

// ---- Der ganze Bau ------------------------------------------------------------------------------------------------------

export interface KartenSvgErgebnis {
    readonly svg: string;
    /**
     * Elemente je Ebene (`landschaften`, `gebiete`, `wege`, `kraftlinien`, `orte`, `beschriftungen`) und je Gruppe (`<ebene>/<Gruppe>`).
     * Nur gebaute Ebenen stehen darin. Die Flüsse zählen zu `wege`, auch wenn sie in der Landschaften-Ebene liegen.
     */
    readonly zaehler: Record<string, number>;
}

/**
 * Baut den Abzug. Eine reine Funktion: Dieselben Daten, Einstellungen und `stempel.erstellt` ergeben dieselben Bytes.
 * `stempel.erstellt` ist die Zeit des Abzugs als ISO-Text und der einzige Wert, der von außen kommt.
 */
export function baueKartenSvg(
    daten: KartenSvgDaten,
    optionen: KartenSvgOptionen,
    stempel: { erstellt: string },
): KartenSvgErgebnis {
    const einstellungen = bereinigeKartenSvgOptionen(optionen);
    const an = (ebene: KartenSvgEbene): boolean => einstellungen.ebenen.includes(ebene);
    const bau: Bau = {
        dialekt: einstellungen.dialekt,
        semantik: einstellungen.semantik,
        skala: einstellungen.strichProzent / 100,
        glattWege: einstellungen.glattWege,
        glattFlaechen: einstellungen.glattFlaechen,
        spannung: einstellungen.spannung,
        gesehen: new Set(),
        wegIds: new Map(),
        typen: new Map(),
        kontextWerte: new Set(),
        arten: new Set(),
        ebenen: new Set(),
        kombinationen: new Map(),
        // Der Kontext wird aus ALLEN Flächen gerechnet, auch wenn die Ebene Landschaften nicht in der Datei steht.
        kontext: einstellungen.semantik ? baueKontextIndex(daten.flaechen, daten.gipfel) : null,
        passmarken: einstellungen.passmarken,
        groessePx: einstellungen.groessePx,
        zaehler: {},
    };

    // 🔴 Die Flüsse werden HIER gebaut, vor den Landschaften, und in deren Ebene eingehängt. Reihenfolge im Code = Reihenfolge der
    // id-Vergabe: Die Flüsse bekommen ihre ids zuerst; eindeutig bleibt alles, weil `gesehen` geteilt ist.
    const flussUnten = an("landschaften") && an("wege");
    const fluesse = flussUnten
        ? wegGruppen(bau, daten.wege, (art) => (FLUSSARTEN as readonly string[]).includes(art))
        : { teile: [], anzahl: 0 };

    const koerper: string[] = [];
    if (an("landschaften")) haengeAn(koerper, landschaftenEbene(bau, daten.flaechen, fluesse.teile).teile);
    if (an("gebiete")) haengeAn(koerper, gebieteEbene(bau, daten.gebiete).teile);
    if (an("wege")) haengeAn(koerper, wegeEbene(bau, daten.wege, flussUnten).teile);
    if (an("kraftlinien")) haengeAn(koerper, kraftlinienEbene(bau, daten.kraftlinien).teile);
    if (an("orte")) haengeAn(koerper, ortsEbene(bau, daten.orte, daten.landmarken).teile);
    if (an("beschriftungen")) {
        haengeAn(
            koerper,
            beschriftungenEbene(bau, daten.orte, daten.wege, daten.landmarken, daten.beschriftungen).teile,
        );
    }
    koerper.push("</svg>\n");

    const vokabular = bau.semantik ? vokabularText(bau) : null;
    // Jede gebaute Ebene steht im Zähler, auch mit 0; erst die Summe, dann ihre Gruppen. Feste Reihenfolge: gleiche Daten, gleiche Bytes.
    const zaehler: Record<string, number> = {};
    for (const ebene of KARTEN_SVG_EBENEN) {
        if (!an(ebene)) continue;
        zaehler[ebene] = bau.zaehler[ebene] ?? 0;
        for (const [schluessel, anzahl] of Object.entries(bau.zaehler)) {
            if (schluessel.startsWith(`${ebene}/`)) zaehler[schluessel] = anzahl;
        }
    }
    return { svg: dokumentKopf(bau, vokabular, stempel, daten, einstellungen) + koerper.join(""), zaehler };
}
