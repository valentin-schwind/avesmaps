import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import type { EditorLandscapeLayer, EditorPathAttachment, EditorPathDetail, EditorPathEnds } from "@avesmaps3d/shared";
import type { FormTeil } from "../fenster/bearbeitung";
import type { Entwurf as Sicht } from "../fenster/entwurf-kern";
import { flussArt, WEG } from "../map/geometrie/arten";
import { geometrieBelegt, meldeBelegt } from "../map/geometrie/besitzer";
import type { Bild } from "../map/geometrie/bild";
import type { Aenderung, GeometrieArt, Marke, Pixel, Punkt, Teil, Ziel } from "../map/geometrie/geometrie";
import type { GeometrieEingabe, GeometrieModus } from "../map/geometrie/modus";
import { amOrt, deckungsgleich, ohnePunkt, verschoben } from "../map/geometrie/rechnung";
import { vereinfacht } from "../map/geometrie/vereinfachen";
import type { EditorSperre } from "../editor-sperre/sperre";
import { flussZiele, markenZiele } from "./neuer-weg";
import { festeIndizes, vereinfachenBild } from "./vereinfachen-bild";
import { kurveAus, type WegForm } from "./weg-art";
import type { WegeditorDaten } from "./wegeditor-daten";
import type { WegBearbeitung } from "./wegeditor-steuerung";

/**
 * „Wegkurve bearbeiten“ und „Wegkurve vereinfachen“ (WI-0177; Blatt A2 und B; EDIT-0003 T24, T27 (4), (7), T44, F11): die Kurve EINES
 * Abschnitts als Form im EINEN Entwurf seiner Straße (W5b Schritt 3; O3 `fenster/bearbeitung.ts`, Muster
 * `kraftlinieneditor/kraftlinie-kurve.ts`). Diese Datei ist der Besitzer der Form: Sie schaltet das Geometrie-Modul mit der Art `WEG`
 * ein und zeichnet die Karte neu; Schritte, Frage, Sperre der Straße, „Fertig“ und Konflikt gehören der Bearbeitung.
 *
 * - **Start** nur ausdrücklich. Er holt die Bearbeitung der Straße (`bearbeitung`, sie öffnet dabei ihr Fenster), liest den Abschnitt
 *   mit Revision und Anschlüssen, die Andockziele um ihn (Orte und Stützpunkte anderer Wege) und die Wege, die an einem seiner
 *   Stützpunkte genau anliegen, ohne Ort: Nur deren Punkte können mitziehen. Dann hängt die Form an (`beginne`); ist der Weg nicht frei
 *   sichtbar, fliegt die Kamera hin. Liegt im Entwurf schon die Kurve dieses Abschnitts (das Fenster war abgelegt), geht es mit ihr
 *   weiter.
 * - **Ein Fluss oder Bach** (Vali 2026-11-08) rastet mit JEDEM Stützpunkt an Ecken und Kanten der Flächen der sichtbaren Ebenen (auch
 *   Seeufern) und an Stützpunkten und Strecken anderer Flüsse ein (Art `flussArt`, Ziele `flussZiele`); Orte, Landwege und
 *   Geländemarken bleiben Ziele der Enden. Nur geometrisch: gespeichert wird die Lage, keine Verbindung.
 * - **Ein Abschnitt je Entwurf:** `path.update` schreibt die Kurve EINES Abschnitts. Liegt im Entwurf die Kurve eines anderen mit
 *   Ungespeichertem, beginnt nichts, und ein Hinweis sagt es (`andere`); ohne Ungespeichertes endet die alte Bearbeitung erst.
 * - **Jede Handbewegung ist ein Schritt** in derselben Folge wie die Felder; ↶ ↷ und Strg+Z/Strg+Y gehen über die Bearbeitung
 *   (T27 (7)). Nichts fragt während einer Geste den Server.
 * - **„Fertig“** der Bearbeitung schreibt Felder und Kurve als EINE Operation `path.update` (`weg-art.ts`, `kurveAus`). Mit Kurve sagt
 *   der Hinweis danach, woran die Enden hängen (Entscheid 2026-10-10: sichtbar bestätigen; aus der Quittung) und wer mitgezogen wurde.
 *   Gibt es nichts zu schreiben, endet sie still. Konflikt, Ablehnung und eine fremde Sperre beim Schreiben zeigt die Bearbeitung.
 * - **Sperre** (EDIT-0003 §4): Erst gesperrt, dann bearbeitet. Die Straße sperrt die Bearbeitung an ihrem Anker; läuft sie noch nicht,
 *   nimmt diese Datei die Sperre vorab, damit ein anderer, der die Straße hält, den Modus gar nicht erst beginnen lässt (der Hinweis
 *   nennt ihn). Ist der Abschnitt nicht der Anker, sperrt sie ihn dazu, damit das Schild bei den anderen an ihm steht. Das Ende des
 *   Modus gibt den Abschnitt frei, die Straße gibt die Bearbeitung frei. Läuft die Sperre des Abschnitts ab und nimmt ein anderer sie,
 *   bleibt der Entwurf; der Hinweis sagt es (`verloren`).
 * - **Ein Modus zur Zeit** (`map/geometrie/besitzer.ts`): Läuft schon einer, auch diese Wegkurve an einem anderen Abschnitt, beginnt
 *   keiner; der laufende bleibt, ein Hinweis sagt es.
 * - **Am Stützpunkt** (Rechtsklick auf den Griff, T24 (3)): Die Seite zeigt die Handgriffe des Griffs (`griffMenue`). „Stützpunkt
 *   entfernen“ ist ein Schritt wie der Doppelklick; „Hier teilen“ ist eine eigene Operation `path.split` gegen die Revision des
 *   Abschnitts und geht nur ohne Ungespeichertes. Danach endet die Bearbeitung, und das Fenster liest die Straße neu.
 * - **Esc** bricht erst einen laufenden Zug ab; dann fragt die Bearbeitung bei Ungespeichertem (R2), sonst endet sie. Während
 *   geschrieben wird, hängt Esc nur die Form ab (Esc verlässt jeden Modus): Die Bearbeitung schreibt zu Ende, die Kacheln folgen.
 * - **„Wegkurve vereinfachen“** (W3, Wunsch des Betreibers 2026-10-16) ist die zweite Art (`art: "vereinfachen"`): dieselbe Form, ohne
 *   Anfasser. Der Regler „Stärke“ (`staerke`) zeigt beim Ziehen sofort, was wegfiele, und jedes Loslassen ist ein Schritt. Vereinfacht
 *   wird die Kurve, wie sie beim Start lag (`vereinfacht.von`). Enden, Orte und Knoten mit anderen Wegen bleiben fest (Betreiber
 *   2026-10-16, „Nein, fest“), also zieht nichts mit. Die Stärke ist die Abweichung in Bildpunkten der Karte, wie sie beim Loslassen
 *   steht. Nach dem Start (und dem Hinflug) zeigt die Vorschau gleich die Vorgabe als ersten Schritt; ↶ nimmt ihn zurück.
 * - **Das Fenster trägt die Form:** Wird es abgelegt oder geschlossen, hängt die Form ab (`haengeAb`); der Entwurf bleibt (D19, G5).
 */

/** Die Stärke, mit der „Wegkurve vereinfachen“ beginnt, und die größte (Probierblatt P5). */
export const VEREINFACHEN_VORGABE = 4;
export const VEREINFACHEN_HOECHSTENS = 20;

/** Was der Modus tut: die Kurve mit Anfassern bearbeiten oder sie mit dem Regler vereinfachen. */
export type WegkurveArt = "kurve" | "vereinfachen";

/** Der Stand des Reglers beim Vereinfachen. */
export interface VereinfachenStand {
    readonly staerke: number;
    /** Stützpunkte beim Start und jetzt. */
    readonly vorher: number;
    readonly nachher: number;
    /** Wie viele davon fest sind. */
    readonly fest: number;
}

export interface WegkurveKarte {
    /** Schaltet das Geometrie-Modul für den Weg ein (`map/geometrie/modus.ts`); ohne Karte `undefined`. */
    ein(eingabe: GeometrieEingabe): GeometrieModus | undefined;
    /** Den Weg in die freie Fläche holen, wenn er nicht frei sichtbar ist (Hausregel „Kamera fliegt immer“); erfüllt nach der Landung. */
    zeige(punkte: readonly Punkt[]): Promise<unknown> | void;
    /** Beim Vereinfachen: die Vorschau ohne Anfasser zum Ziehen (`vereinfachen-bild.ts`); ohne Karte `undefined`. */
    vorschau(bild: () => Bild): GeometrieModus | undefined;
    /** Karteneinheiten je Bildpunkt um diese Punkte, wie die Karte jetzt steht. */
    massstab(punkte: readonly Punkt[]): number;
    /** Nach „Hier teilen“: Wege neu zeichnen (`mapRevision` aus der Quittung, WI-0128 E13). Die Kurve schreibt die Bearbeitung. */
    geaendert(revision: number | undefined): void;
}

export interface WegkurveLauf {
    /** Der Abschnitt. */
    readonly publicId: string;
    readonly art: WegkurveArt;
    /** Der Name des Abschnitts; leer, solange er lädt. */
    readonly name: string;
    readonly phase: "laedt" | "bereit";
    /** Die Bearbeitung der Straße, sobald sie geholt ist: Ihr gehören Schritte, Frage und „Fertig“. */
    readonly bearbeitung: WegBearbeitung | undefined;
    /** Beim Vereinfachen der Regler, sobald der Weg gelesen ist. */
    readonly vereinfachen: VereinfachenStand | undefined;
}

export type WegkurveMeldung =
    | {
          readonly art: "gespeichert";
          readonly publicId: string;
          readonly name: string;
          /** Woran die Enden nach dem Speichern hängen, aus der Quittung. */
          readonly enden: EditorPathEnds | undefined;
          readonly mitgezogen: readonly string[];
          /** Beim Vereinfachen: Stützpunkte vorher und nachher. */
          readonly stuetzpunkte?: { readonly vorher: number; readonly nachher: number };
      }
    /** „Hier teilen“ kam zu spät: Ein anderer hat den Abschnitt inzwischen geändert. */
    | {
          readonly art: "konflikt";
          readonly publicId: string;
          readonly wer: string | undefined;
          readonly wann: string | undefined;
      }
    | { readonly art: "abgelehnt"; readonly publicId: string; readonly satz: string }
    /** „Hier teilen“ ist gespeichert: der vordere Teil behält die Kennung, `hinten` ist neu. */
    | { readonly art: "geteilt"; readonly publicId: string; readonly name: string; readonly hinten: string }
    | { readonly art: "verworfen"; readonly publicId: string; readonly name: string }
    /** Ein anderer bearbeitet den Weg gerade (EDIT-0003 §4): Der Modus beginnt nicht. */
    | { readonly art: "gesperrt"; readonly publicId: string; readonly name: string; readonly wer: string }
    /** Die Sperre ließ sich nicht nehmen (keine Verbindung, Bearbeiten aus): Der Modus beginnt nicht. */
    | { readonly art: "sperrfehler"; readonly publicId: string; readonly name: string }
    /** Die Sperre ist abgelaufen, und ein anderer hat sie genommen: Der Entwurf bleibt. */
    | { readonly art: "verloren"; readonly publicId: string; readonly name: string }
    /** Im Entwurf der Straße liegt die ungespeicherte Kurve eines anderen Abschnitts (`name`): Der Modus beginnt nicht. */
    | { readonly art: "andere"; readonly publicId: string; readonly name: string };

export interface Wegkurve {
    readonly laufend: Readonly<ShallowRef<WegkurveLauf | undefined>>;
    /** Die letzte Meldung (gespeichert, gesperrt, verworfen …), bis zur nächsten oder zum nächsten Start. */
    readonly meldung: Readonly<ShallowRef<WegkurveMeldung | undefined>>;
    /** Startet den Modus an diesem Abschnitt; ohne `art` „Wegkurve bearbeiten“. */
    starte(publicId: string, art?: WegkurveArt): Promise<void>;
    /**
     * Beim Vereinfachen der Regler: beim Ziehen (`endgueltig` falsch) nur die Vorschau, beim Loslassen ein Schritt im Entwurf (gleiche
     * Stärke wie der Schritt davor: keiner).
     */
    staerke(wert: number, endgueltig: boolean): void;
    zurueck(): void;
    wieder(): void;
    /** „Fertig“ der Bearbeitung; eine Vorschau des Reglers wird vorher ein Schritt. */
    fertig(): Promise<void>;
    /** Esc: bricht einen laufenden Zug ab, sonst geht es an die Bearbeitung. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    /** „Stützpunkt entfernen“ am Index: ein Schritt im Entwurf (nie ein Ende, nie unter zwei Punkte). */
    entferneStuetzpunkt(index: number): void;
    /** „Hier teilen“ am inneren Stützpunkt `index`: EINE Operation `path.split`, nur ohne Ungespeichertes. */
    teile(index: number): Promise<void>;
    /** Hängt die Form ab; der Entwurf bleibt stehen (das Fenster wird abgelegt oder geschlossen). */
    haengeAb(): void;
    /** Die Form, wie sie jetzt im Entwurf liegt (für Tests). */
    form(): WegForm | undefined;
    destroy(): void;
}

export interface WegkurveOptionen {
    readonly daten: Pick<WegeditorDaten, "weg" | "ziele"> & Partial<Pick<WegeditorDaten, "teile">>;
    readonly karte: WegkurveKarte;
    /** Der Fangradius in Bildpunkten (Karteneinstellung `fangradius`). */
    readonly fangradius: () => number;
    /**
     * Die sichtbaren Ebenen der Derographie: Nur deren Flächenkanten sind Ziele eines Flusses (wie bei „Ecken bearbeiten“, EDIT-0003
     * T27 (1)); ohne Angabe alle drei.
     */
    readonly ebenen?: () => readonly EditorLandscapeLayer[];
    /** Der Satz, wenn der Weg nicht zu lesen ist (aus `t`, damit die Steuerung ohne i18n prüfbar bleibt). */
    readonly ladefehler: () => string;
    /** Wie ein Weg heißt, wo er genannt wird (Titel, „Mitgezogen“); ohne Angabe der gespeicherte Name. */
    readonly nameVon?: (weg: EditorPathDetail) => string;
    readonly neueKennung?: () => string;
    /** Die Sperre der Seite (EDIT-0003 §4): vorab an der Straße, dazu am Abschnitt, wenn er nicht ihr Anker ist. */
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust">;
    /** Die Bearbeitung der Straße dieses Abschnitts; öffnet ihr Fenster (D19). `undefined`: keine (nicht zu lesen, kein Recht). */
    bearbeitung(abschnitt: string): Promise<WegBearbeitung | undefined>;
    /** Rechtsklick auf einen Stützpunkt im Modus: die Seite zeigt seine Handgriffe am Griff (Kartenmenü „nur Editor-Karte“). */
    readonly griffMenue?: (griff: {
        readonly publicId: string;
        readonly name: string;
        readonly index: number;
        readonly ende: boolean;
        readonly ungespeichert: boolean;
        readonly screen: Pixel;
    }) => void;
}

/** Was beim Start feststeht: woran man einrastet, wo Orte sind, woran die Enden hängen. */
interface Umgebung {
    readonly ziele: readonly Ziel[];
    readonly orte: readonly Punkt[];
    readonly enden: EditorPathEnds;
    /** Beim Vereinfachen: die Indizes, die bleiben (`festeIndizes`). */
    readonly fest: readonly number[];
}

/** Die Marke an einem freien Ende: der gestrichelte Ring (Betreiber 2026-10-15, Frage 2). Ein Flussende auf einer Geländemarke ist nicht frei, es hängt an ihr (OPS-000088). */
export function markenAus(teil: Teil, enden: EditorPathEnds, gelaendemarken: readonly Punkt[] = []): Marke[] {
    const raus: Marke[] = [];
    const je = (at: Punkt | undefined, anschluss: EditorPathAttachment): void => {
        if (at !== undefined && anschluss.kind === "free" && !gelaendemarken.some((m) => deckungsgleich(m, at)))
            raus.push({ at, art: "frei" });
    };
    je(teil.punkte[0], enden.start);
    je(teil.punkte.at(-1), enden.end);
    return raus;
}

/** Ein Schritt: der Abschnitt nach der Handbewegung, die Mitgezogenen mit ihren Punkten. Eine Handbewegung vereinfacht nichts. */
export function formNach(form: WegForm, aenderung: Aenderung): WegForm {
    return {
        ursprung: form.ursprung,
        teil: aenderung.teile.find((t) => t.objekt === form.teil.objekt) ?? form.teil,
        nachbarn: form.nachbarn.map((nachbar) => {
            const seine = aenderung.mitgezogen.filter((m) => m.stelle.objekt === nachbar.objekt);
            let punkte: readonly Punkt[] = nachbar.punkte;
            for (const m of seine) punkte = verschoben(punkte, m.stelle.index, m.nach);
            return seine.length === 0 ? nachbar : { ...nachbar, punkte };
        }),
    };
}

/** Wartet, bis die Bearbeitung ihren Stand gelesen hat (oder nicht); `abbrechen` gibt das Warten auf. */
function bisGelesen(bearbeitung: WegBearbeitung): { fertig: Promise<void>; abbrechen: () => void } {
    if (bearbeitung.zustand.value.art !== "laedt") return { fertig: Promise.resolve(), abbrechen: () => undefined };
    let stop = (): void => undefined;
    const fertig = new Promise<void>((weiter) => {
        stop = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                if (art === "laedt") return;
                stop();
                weiter();
            },
        );
    });
    return { fertig, abbrechen: () => stop() };
}

type Gespeichert = Extract<WegkurveMeldung, { art: "gespeichert" }>;

export function createWegkurve(optionen: WegkurveOptionen): Wegkurve {
    const { daten, karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const nameVon = optionen.nameVon ?? ((weg: EditorPathDetail): string => weg.name);
    const teilAus = (weg: EditorPathDetail): Teil => ({
        objekt: weg.publicId,
        name: nameVon(weg),
        nr: 0,
        art: "linie",
        punkte: weg.points,
        revision: weg.revision,
    });
    const laufend = shallowRef<WegkurveLauf | undefined>(undefined);
    const meldung = shallowRef<WegkurveMeldung | undefined>(undefined);
    let modus: GeometrieModus | undefined;
    let sicht: Sicht<WegForm> | undefined;
    let umgebung: Umgebung | undefined;
    /** Beim Vereinfachen: die Kurve, wie sie beim Start lag. */
    let basis: Teil | undefined;
    /** Beim Vereinfachen, während der Regler gezogen wird: was die Karte zeigt, ohne Schritt im Entwurf. */
    let vorschau: WegForm | undefined;
    /** Jeder Start bekommt eine eigene Marke; was zu einem älteren Start gehört, kommt zu spät und zählt nicht. */
    let lauf: object | undefined;
    let lesen: AbortController | undefined;
    let warten: (() => void) | undefined;
    let stopSperre: WatchStopHandle | undefined;
    let stopHinweis: WatchStopHandle | undefined;
    /** Der Abschnitt, dessen Sperre dieser Modus hält (nur, wenn er nicht der Anker ist). */
    let abschnittGesperrt: string | undefined;
    /** Die Sperre der Straße, vorab genommen, bis die Bearbeitung sie mit `beginne` übernimmt. */
    let ankerGenommen: string | undefined;
    let teilt = false;
    const abmelden = optionen.sperre.beiVerlust((ziel) => {
        const jetzt = laufend.value;
        if (ziel.kind !== "path" || ziel.id !== abschnittGesperrt || jetzt === undefined) return;
        abschnittGesperrt = undefined;
        meldung.value = { art: "verloren", publicId: jetzt.publicId, name: jetzt.name };
    });

    const gezeigt = (): WegForm | undefined => vorschau ?? sicht?.jetzt();
    const speichert = (): boolean => laufend.value?.bearbeitung?.zustand.value.art === "speichert";

    function vereinfachenStand(): VereinfachenStand | undefined {
        const e = gezeigt();
        if (basis === undefined || e === undefined || umgebung === undefined) return undefined;
        return {
            staerke: e.vereinfacht?.staerke ?? 0,
            vorher: basis.punkte.length,
            nachher: e.teil.punkte.length,
            fest: umgebung.fest.length,
        };
    }

    async function lade(
        publicId: string,
        signal: AbortSignal,
    ): Promise<{
        teil: Teil;
        nachbarn: Teil[];
        ziele: Ziel[];
        orte: Punkt[];
        enden: EditorPathEnds;
        gelaendemarken: Punkt[];
        art: GeometrieArt;
        flussziele: Ziel[];
    } | null> {
        try {
            const [weg, ziele] = await Promise.all([
                daten.weg(publicId, signal),
                daten.ziele(publicId, signal, optionen.ebenen?.()),
            ]);
            if (weg === null || ziele === null || !weg.active) return null;
            // Nur Flüsse und Bäche rasten an Geländemarken ein (OPS-000088). Wie an einem Ort zieht dort nichts mit: Ein anderes Flussende auf derselben Marke bleibt an ihr.
            const marken = weg.subtype === "Flussweg" ? markenZiele(ziele) : [];
            const gelaendemarken = marken.map((marke) => marke.at);
            const orte = [...ziele.places.map((ort) => ({ x: ort.x, y: ort.y })), ...gelaendemarken];
            const partner = [
                ...new Set(
                    ziele.vertices
                        .filter((v) => !amOrt(v, orte) && weg.points.some((p) => deckungsgleich(p, v)))
                        .map((v) => v.pathId),
                ),
            ];
            const nachbarn = await Promise.all(partner.map((id) => daten.weg(id, signal)));
            // Ein Fluss rastet überall an Flächen und anderen Flüssen ein (Vali 2026-11-08); innere Punkte nie an einem Landweg.
            const fluss = weg.subtype === "Flussweg";
            const flussziele = fluss ? flussZiele(ziele) : [];
            const wasser = new Set(flussziele.map((ziel) => ziel.objekt));
            return {
                teil: teilAus(weg),
                nachbarn: nachbarn.filter((n): n is EditorPathDetail => n !== null && n.active).map(teilAus),
                ziele: [
                    ...marken,
                    ...ziele.places.map((ort): Ziel => ({
                        art: "ort",
                        at: { x: ort.x, y: ort.y },
                        objekt: ort.publicId,
                        name: ort.name,
                    })),
                    ...ziele.vertices.map((v): Ziel => ({
                        art: "ecke",
                        at: { x: v.x, y: v.y },
                        objekt: v.pathId,
                        name: v.name,
                        stelle: { objekt: v.pathId, nr: 0, index: v.index },
                    })),
                ],
                orte,
                enden: weg.ends,
                gelaendemarken,
                art: fluss ? flussArt((ziel) => wasser.has(ziel.objekt)) : WEG,
                flussziele,
            };
        } catch {
            return null;
        }
    }

    function zeige(): void {
        modus?.aktualisiere();
        const jetzt = laufend.value;
        if (jetzt?.art === "vereinfachen") laufend.value = { ...jetzt, vereinfachen: vereinfachenStand() };
    }

    function raeumeAuf(): void {
        lauf = undefined;
        lesen?.abort();
        lesen = undefined;
        warten?.();
        warten = undefined;
        stopSperre?.();
        stopSperre = undefined;
        if (abschnittGesperrt !== undefined) optionen.sperre.gib({ kind: "path", id: abschnittGesperrt });
        abschnittGesperrt = undefined;
        if (ankerGenommen !== undefined) optionen.sperre.gib({ kind: "path", id: ankerGenommen });
        ankerGenommen = undefined;
        modus?.aus();
        modus = undefined;
        sicht = undefined;
        umgebung = undefined;
        basis = undefined;
        vorschau = undefined;
        laufend.value = undefined;
    }

    function haengeAb(): void {
        const war = sicht;
        raeumeAuf();
        war?.leere();
    }

    /** Der Besitzer der Form für die Bearbeitung: ↶ ↷, Verwerfen und Esc gehen über ihn, weil nur er die Karte neu zeichnet. */
    const teil: FormTeil = {
        zurueck() {
            vorschau = undefined;
            sicht?.zurueck();
            zeige();
        },
        wieder() {
            vorschau = undefined;
            sicht?.wieder();
            zeige();
        },
        verwerfen() {
            const jetzt = laufend.value;
            vorschau = undefined;
            sicht?.verwerfen();
            zeige();
            if (jetzt !== undefined) meldung.value = { art: "verworfen", publicId: jetzt.publicId, name: jetzt.name };
        },
        abbrechen() {
            if (modus?.abbrechen() === true) return true;
            // Esc ohne laufenden Zug: die Frage der Bearbeitung; „ende“ beendet sie und ruft `beende`.
            const wie = sicht?.esc();
            if (wie !== undefined && wie !== "ende") zeige();
            return true;
        },
        beende: raeumeAuf,
    };

    /** Was der Hinweis nach dem Schreiben sagt, gemerkt, solange geschrieben wird; ohne Kurve keiner. */
    function merke(bearbeitung: WegBearbeitung): Omit<Gespeichert, "art"> | undefined {
        const form = bearbeitung.stand.value?.form;
        const kurve = form === undefined ? undefined : kurveAus(form);
        if (form === undefined || kurve === undefined) return undefined;
        const mitgezogen = [...new Set(kurve.carried.map((c) => c.pathId))].map(
            (id) => form.nachbarn.find((n) => n.objekt === id)?.name ?? id,
        );
        return {
            publicId: form.teil.objekt,
            name: form.teil.name,
            enden: umgebung?.enden,
            mitgezogen,
            ...(form.vereinfacht !== undefined
                ? { stuetzpunkte: { vorher: form.ursprung.teil.punkte.length, nachher: form.teil.punkte.length } }
                : {}),
        };
    }

    /** Schreibt „Fertig“ der Bearbeitung mit Kurve, sagt der Hinweis es (auch nach Esc, auch aus dem Fenster). */
    function beobachte(bearbeitung: WegBearbeitung): void {
        stopHinweis?.();
        let geschrieben: Omit<Gespeichert, "art"> | undefined;
        stopHinweis = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                if (art === "speichert") geschrieben = merke(bearbeitung);
                else if (art === "gespeichert" && geschrieben !== undefined)
                    meldung.value = {
                        art: "gespeichert",
                        ...geschrieben,
                        enden: bearbeitung.art.quittung()?.ends ?? geschrieben.enden,
                    };
                if (art !== "speichert") geschrieben = undefined;
            },
            { flush: "sync" },
        );
    }

    /** Nimmt eine Sperre für diesen Lauf; `false` mit dem Hinweis, warum nicht (oder still, wenn der Lauf vorbei ist). */
    async function sperre(id: string, meiner: object, name: string, publicId: string): Promise<boolean> {
        const ergebnis = await optionen.sperre.nimm({ kind: "path", id }, "form");
        if (lauf !== meiner) {
            if (ergebnis.art === "genommen") optionen.sperre.gib({ kind: "path", id });
            return false;
        }
        if (ergebnis.art === "genommen") return true;
        raeumeAuf();
        meldung.value =
            ergebnis.art === "gesperrt"
                ? { art: "gesperrt", publicId, name, wer: ergebnis.sperre.person.name }
                : { art: "sperrfehler", publicId, name };
        return false;
    }

    async function starte(publicId: string, art: WegkurveArt = "kurve"): Promise<void> {
        const vorher = laufend.value;
        if (vorher?.publicId === publicId && vorher.art === art) return;
        if (geometrieBelegt()) {
            meldeBelegt();
            return;
        }
        haengeAb();
        meldung.value = undefined;
        const meiner = {};
        lauf = meiner;
        laufend.value = { publicId, art, name: "", phase: "laedt", bearbeitung: undefined, vereinfachen: undefined };
        const nichtZuLesen = (): void => {
            raeumeAuf();
            meldung.value = { art: "abgelehnt", publicId, satz: optionen.ladefehler() };
        };
        const bearbeitung = await optionen.bearbeitung(publicId);
        if (lauf !== meiner) return;
        if (bearbeitung === undefined) return nichtZuLesen();
        laufend.value = { ...laufend.value, bearbeitung };
        const gelesen = bisGelesen(bearbeitung);
        warten = gelesen.abbrechen;
        await gelesen.fertig;
        if (lauf !== meiner) return;
        warten = undefined;
        if (bearbeitung.detail.value?.segments.some((abschnitt) => abschnitt.id === publicId) !== true)
            return nichtZuLesen();
        // Ein Abschnitt je Entwurf: Die Kurve eines anderen mit Ungespeichertem bleibt stehen; ohne endet die alte Bearbeitung erst.
        const dort = bearbeitung.stand.value?.form;
        if (dort !== undefined && dort.teil.objekt !== publicId) {
            if (bearbeitung.lage.value.ungespeichert > 0) {
                raeumeAuf();
                meldung.value = { art: "andere", publicId, name: dort.teil.name };
                return;
            }
            bearbeitung.esc();
        }
        const steuer = new AbortController();
        lesen = steuer;
        const geladen = await lade(publicId, steuer.signal);
        if (lauf !== meiner) return;
        lesen = undefined;
        if (geladen === null) return nichtZuLesen();
        // Erst gesperrt, dann bearbeitet (EDIT-0003 §4): die Straße vorab, solange ihre Bearbeitung noch nichts hält, und der Abschnitt.
        const name = geladen.teil.name;
        if (!bearbeitung.lage.value.aktiv) {
            if (!(await sperre(bearbeitung.id, meiner, name, publicId))) return;
            ankerGenommen = bearbeitung.id;
        }
        if (publicId !== bearbeitung.id) {
            if (!(await sperre(publicId, meiner, name, publicId))) return;
            abschnittGesperrt = publicId;
        }
        // Weiter mit der Kurve dieses Abschnitts, wenn sie schon im Entwurf liegt (das Fenster war abgelegt).
        const da = bearbeitung.stand.value?.form;
        const g0: WegForm = da ?? {
            teil: geladen.teil,
            nachbarn: geladen.nachbarn,
            ursprung: { teil: geladen.teil, nachbarn: geladen.nachbarn },
        };
        const start =
            art === "vereinfachen" ? { ...g0.teil, punkte: g0.vereinfacht?.von ?? g0.teil.punkte } : undefined;
        const fest = start === undefined ? [] : festeIndizes(start.punkte, geladen.orte, geladen.ziele);
        // Beim Vereinfachen bleiben wie bisher nur Enden, Orte und Knoten mit anderen Wegen fest, nicht jede Ecke einer Fläche.
        umgebung = {
            ziele: [...geladen.ziele, ...geladen.flussziele],
            orte: geladen.orte,
            enden: geladen.enden,
            fest,
        };
        basis = start;
        const eigene = bearbeitung.formEntwurf(teil);
        sicht = eigene;
        const ein =
            art === "vereinfachen"
                ? karte.vorschau(bild)
                : karte.ein({
                      art: geladen.art,
                      teile: () => {
                          const e = eigene.jetzt();
                          return e === undefined ? [] : [e.teil];
                      },
                      nachbarn: () => eigene.jetzt()?.nachbarn ?? [],
                      ziele: () => umgebung?.ziele ?? [],
                      orte: () => umgebung?.orte ?? [],
                      fangradius: optionen.fangradius,
                      handbewegung(aenderung) {
                          const e = eigene.jetzt();
                          if (e === undefined || laufend.value?.phase !== "bereit" || speichert()) return;
                          eigene.schritt(formNach(e, aenderung));
                          // Ein neuer Schritt beendet eine offene Meldung: Sie galt dem vorigen Versuch.
                          meldung.value = undefined;
                          zeige();
                      },
                      ...(optionen.griffMenue === undefined
                          ? {}
                          : {
                                kontext(griff, screen) {
                                    const jetzt = laufend.value;
                                    const e = eigene.jetzt();
                                    if (jetzt?.phase !== "bereit" || e === undefined) return;
                                    optionen.griffMenue?.({
                                        publicId: jetzt.publicId,
                                        name: jetzt.name,
                                        index: griff.index,
                                        ende: griff.index === 0 || griff.index === e.teil.punkte.length - 1,
                                        ungespeichert: bearbeitung.lage.value.ungespeichert > 0,
                                        screen,
                                    });
                                },
                            }),
                  });
        if (ein === undefined) {
            raeumeAuf();
            return;
        }
        modus = ein;
        laufend.value = { ...laufend.value, name, phase: "bereit" };
        // Die Form hängt an; die Sperre der Straße hält von hier an die Bearbeitung.
        eigene.beginne(g0);
        ankerGenommen = undefined;
        if (lauf !== meiner) return;
        stopSperre = watch(
            () => bearbeitung.zustand.value.art,
            (zustand) => modus?.sperre(zustand === "speichert"),
            { immediate: true },
        );
        beobachte(bearbeitung);
        zeige();
        const liegt = eigene.jetzt()?.teil ?? geladen.teil;
        modus.markiere(markenAus(liegt, geladen.enden, geladen.gelaendemarken));
        const flug = karte.zeige(liegt.punkte);
        if (art !== "vereinfachen") return;
        // Die Vorgabe erst nach der Landung: Die Stärke misst in Bildpunkten der Karte, wie sie dann steht.
        await flug;
        if (lauf !== meiner) return;
        staerke(VEREINFACHEN_VORGABE, true);
    }

    /** Die Vorschau beim Vereinfachen: der Start und was gerade gezeigt wird. */
    function bild(): Bild {
        const e = gezeigt();
        if (basis === undefined || e === undefined) return { linien: [], anfasser: [], andock: [], ringe: [] };
        return vereinfachenBild(WEG, basis, e.teil, umgebung?.fest ?? []);
    }

    function staerke(wert: number, endgueltig: boolean): void {
        const jetzt = laufend.value;
        const e = sicht?.jetzt();
        if (jetzt?.art !== "vereinfachen" || jetzt.phase !== "bereit" || jetzt.bearbeitung === undefined) return;
        if (speichert() || jetzt.bearbeitung.lage.value.frage) return;
        if (e === undefined || basis === undefined || umgebung === undefined) return;
        const neu = Math.max(0, Math.min(VEREINFACHEN_HOECHSTENS, Math.round(wert)));
        const toleranz = neu * karte.massstab(basis.punkte);
        const schritt: WegForm = {
            ursprung: e.ursprung,
            teil: { ...e.teil, punkte: vereinfacht(basis.punkte, toleranz, { fest: umgebung.fest }) },
            nachbarn: e.nachbarn,
            vereinfacht: { von: basis.punkte, staerke: neu },
        };
        if (!endgueltig) {
            vorschau = schritt;
            zeige();
            return;
        }
        vorschau = undefined;
        if (neu !== (e.vereinfacht?.staerke ?? 0)) {
            sicht?.schritt(schritt);
            meldung.value = undefined;
        }
        zeige();
    }

    function entferneStuetzpunkt(index: number): void {
        const jetzt = laufend.value;
        const e = sicht?.jetzt();
        if (jetzt?.phase !== "bereit" || jetzt.art !== "kurve" || e === undefined || speichert()) return;
        const punkte = e.teil.punkte;
        if (index <= 0 || index >= punkte.length - 1 || punkte.length <= WEG.mindestens) return;
        sicht?.schritt({
            ursprung: e.ursprung,
            nachbarn: e.nachbarn,
            teil: { ...e.teil, punkte: ohnePunkt(punkte, index) },
        });
        meldung.value = undefined;
        zeige();
    }

    async function teile(index: number): Promise<void> {
        const jetzt = laufend.value;
        const bearbeitung = jetzt?.bearbeitung;
        const e = sicht?.jetzt();
        const teileAn = daten.teile;
        if (jetzt?.phase !== "bereit" || jetzt.art !== "kurve" || bearbeitung === undefined || e === undefined) return;
        if (!teileAn || teilt || speichert() || bearbeitung.lage.value.ungespeichert > 0) return;
        const at = e.teil.punkte[index];
        if (at === undefined || index <= 0 || index >= e.teil.punkte.length - 1) return;
        const meiner = lauf;
        const { publicId, name } = jetzt;
        teilt = true;
        modus?.sperre(true);
        const antwort = await teileAn(publicId, {
            operationId: neueKennung(),
            baseRevision: e.teil.revision,
            index,
            at: { x: at.x, y: at.y },
        });
        teilt = false;
        const noch = lauf === meiner;
        if (antwort.ok) {
            // Die Straße hat jetzt einen Abschnitt mehr: Die Bearbeitung endet (nichts ist ungespeichert), das Fenster liest sie neu.
            if (noch) sicht?.esc();
            karte.geaendert(antwort.quittung.mapRevision);
            if (noch) meldung.value = { art: "geteilt", publicId, name, hinten: antwort.quittung.publicId };
            return;
        }
        if (!noch) return;
        modus?.sperre(false);
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
            meldung.value = {
                art: "konflikt",
                publicId,
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
            };
            return;
        }
        meldung.value = { art: "abgelehnt", publicId, satz: antwort.fehler.message };
    }

    return {
        laufend,
        meldung,
        starte,
        staerke,
        entferneStuetzpunkt,
        teile,
        zurueck: () => laufend.value?.bearbeitung?.zurueck(),
        wieder: () => laufend.value?.bearbeitung?.wieder(),
        async fertig() {
            const bearbeitung = laufend.value?.bearbeitung;
            if (laufend.value?.phase !== "bereit" || bearbeitung === undefined) return;
            // Was gespeichert wird, ist was die Karte zeigt: Eine Vorschau des Reglers (Enter beim Ziehen) wird erst ein Schritt.
            if (vorschau !== undefined) staerke(vorschau.vereinfacht?.staerke ?? 0, true);
            await bearbeitung.fertig();
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            const bearbeitung = jetzt.bearbeitung;
            if (jetzt.phase === "laedt" || bearbeitung === undefined) {
                raeumeAuf();
                return true;
            }
            // Esc verlässt den Modus immer (Editor-Orchestrierung 2026-10-17): beim Schreiben ohne zu warten.
            if (speichert()) {
                haengeAb();
                return true;
            }
            return bearbeitung.esc();
        },
        haengeAb,
        form: () => sicht?.jetzt(),
        destroy() {
            haengeAb();
            stopHinweis?.();
            abmelden();
        },
    };
}
