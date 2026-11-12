import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import type { CommunityLage, PhotoboxCreationKind } from "@avesmaps3d/shared";
import { besucher as communityBesucher, ortAusAntwort } from "../community/community-besucher";
import { istSchluessel } from "../community/api";
import type { BezugOrt } from "../community/meldung-modell";
import type { FensterBox } from "../fenster/fenster-lage";
import { fetchNearestPlace } from "../route-planner/route-client";
import type { WeiterArt } from "./fertig-schutz";

/**
 * Die Steuerung der Reisebilder auf der Besucherseite (WI-0272 S2b; Bedienkonzept wie `community/community-besucher.ts`): EIN Fenster zur Zeit, entweder das Formular
 * „Eigenes Bild hinzufügen“ die Statusseite `/reisebild#…` oder die Liste „Meine Reisebilder“, dazu die Lage des Fensters, der Wählmodus „Stelle ändern“ und die Stelle auf der Karte. `app.vue` kennt von
 * alledem nur `oeffne` und `oeffneMeine` (Kartenmenü) und `oeffneStatus` (Einstieg über den Link); gezeichnet wird in `reisebild-besucher.vue`, die Karte hört über `stelle-layer.ts` zu.
 *
 * - 🔴 **Eigene Steuerung neben dem Community-Wirt.** WI-0268 baut dessen Dateien gerade um; hier wird nur gelesen (`community-besucher.ts`). Damit nie zwei Besucherfenster
 *   zugleich offen stehen, schließt `oeffne` das der Meldungen, und ein Fenster der Meldungen schließt das der Reisebilder.
 * - **Gelöst und mittig.** Das Fenster steht gelöst in der Mitte über der Karte (Entwurf 8, Betreiber 2026-11-01), im Wählmodus als schmaler Balken oben in der Mitte; die Kamera fliegt die
 *   Stelle in die freie Fläche neben dem Fenster (`stelle-layer.ts`: links, sonst rechts), damit Symbol und Linie zu sehen sind. Wer es einmal zieht, findet es dort wieder (diese Sitzung,
 *   nichts wird gespeichert). Angedockt (▥) steht es am rechten Rand; am Telefon gibt es nur das Blatt unten.
 * - **Ein weiterer Rechtsklick setzt die Stelle neu, das Geschriebene bleibt** (wie bei den Meldungen): Bei offenem Formular ersetzt `oeffne` nur die Stelle; ist es schon abgeschickt,
 *   beginnt ein frisches Formular.
 * - **Stelle ändern** ist ein Modus der Karte (`waehlen`): Das Fenster klappt auf Kopf und Moduszeile ein, der nächste Klick auf die Karte setzt die Stelle (`setzeStelle`), Esc beendet ihn.
 * - **„Auf der Karte zeigen“ der Statusseite** (Stage-Fund; Vali 2026-11-01) zeigt die Stelle wie das Formular: dasselbe gelbe Platzhaltersymbol (`stelle-layer.ts`) und dieselbe Linie vom Fensterkopf
 *   (`fenster-linie.ts`). Die Steuerung merkt dafür die gezeigte Stelle (`gezeigt`, mit einer Nummer je Auslösen: Die Linie zeichnet sich bei jedem Mal einmal); `stelle` ist dann sie. Sie endet mit der Anzeige:
 *   Schließen, ein anderes Fenster oder ein anderer Link nehmen Symbol und Linie mit (`raeume`).
 * - 🔴 **Eine gezogene Größe gilt für die Art des Fensters, in der sie gezogen wurde** (Stage-Fund; Hausregel „Fenster nur so hoch wie nötig“): Formular und Statusseite teilen sich `fenster.box`, haben aber
 *   ganz verschiedene Inhalte. Wer das Formular zog und dann „Stand ansehen“ wählt (oder die Statusseite über den Link öffnet), bekäme sonst dessen Höhe samt leerer Fläche unten, obwohl das
 *   Fenster `hoehe="inhalt"` hat. Beim Wechsel der Art (`passeBoxAn`) wird die Box verworfen (die Lage, angedockt oder gelöst, bleibt); das Fenster richtet sich wieder nach seinem Inhalt. Bleibt die
 *   Art gleich (ein weiteres Formular, „Noch ein Bild von hier“), bleibt die gezogene Größe.
 * - 🔴 **Der Linkschutz hängt hier, nicht an den Knöpfen des Bestätigungsfensters** (Review S3 I1): Solange der persönliche Link in der Bestätigung weder kopiert noch gemerkt ist, hängt das Fenster einen
 *   Wächter ein (`schuetze`). `oeffne`, `oeffneStatus`, `oeffneMeine`, `schliesse` und das Schließen durch ein Fenster der Meldungen fragen ihn zuerst (`verlassen`); hält er an, bleibt die Anzeige stehen,
 *   die Warnung erscheint, und der zweite Versuch (oder „Trotzdem weiter“ in der Warnung) geht durch. Ohne Wächter, also bei jedem anderen Fenster, ändert sich nichts.
 */

/** Was „Noch ein Bild von hier“ aus dem vorigen Formular mitnimmt (Probierseite: Art und Name). */
export interface Vorbelegung {
    readonly entstehung?: PhotoboxCreationKind | undefined;
    readonly name?: string | undefined;
}

export type ReisebildAnzeige =
    | {
          readonly art: "formular";
          readonly nr: number;
          readonly stelle: CommunityLage;
          /** Der nächste Ort, sobald der Server ihn nennt (oder gleich, wo der Aufrufer ihn schon hat). */
          readonly ort?: BezugOrt | undefined;
          readonly vorbelegung?: Vorbelegung | undefined;
          /** Das Formular ist abgeschickt (die Bestätigung steht da): Die Stelle ist abgegeben, Symbol und Linie gehen von der Karte. */
          readonly abgesendet?: boolean | undefined;
      }
    /**
     * `schluessel` ist `null`, wenn der Link keinen Schlüssel trug oder einen verstümmelten: Das Fenster sagt es, ohne den Server zu fragen. `von` ist `"meine"`, wenn die Seite aus der Liste „Meine Reisebilder“
     * geöffnet wurde: Dann führt „‹ Meine Reisebilder“ im Kopf dorthin zurück.
     */
    | {
          readonly art: "status";
          readonly nr: number;
          readonly schluessel: string | null;
          readonly von?: "meine" | undefined;
      }
    /** Die Liste „Meine Reisebilder“ (Entwurf 9): die gemerkten Einreichungen dieses Geräts mit ihrem Stand. */
    | { readonly art: "meine"; readonly nr: number };

/** Die Stelle, die die Statusseite auf der Karte zeigt; `nr` zählt die Auslösungen (jede zeichnet die Linie neu). */
export interface GezeigteStelle {
    readonly lage: CommunityLage;
    readonly nr: number;
}

export interface FensterStand {
    readonly lage: "angedockt" | "geloest";
    readonly box?: FensterBox | undefined;
}

/** Ein Punkt in Bildschirmkoordinaten der Seite. */
export interface SchirmPunkt {
    readonly x: number;
    readonly y: number;
}

export interface StatusOptionen {
    /** Die Seite wird aus der Liste „Meine Reisebilder“ geöffnet. */
    readonly von?: "meine" | undefined;
}

export interface OeffneOptionen {
    /** Immer ein neues Formular, auch bei offenem (der Knopf „Noch ein Bild von hier“). */
    readonly neu?: boolean | undefined;
    readonly vorbelegung?: Vorbelegung | undefined;
    /**
     * Gleich im Modus „Stelle ändern“ öffnen (die Leiste der Reisebilder: Die Stelle ist die Mitte der freien Fläche und soll gewählt werden). Der Modus steht vor der neuen Anzeige, damit
     * die Kamera nicht zur Mitte fliegt, bevor man gewählt hat.
     */
    readonly waehlen?: boolean | undefined;
}

export interface ReisebildSteuerung {
    readonly anzeige: Readonly<ShallowRef<ReisebildAnzeige | undefined>>;
    readonly fenster: Readonly<ShallowRef<FensterStand>>;
    /** Läuft gerade der Modus „Stelle ändern“? */
    readonly waehlen: Readonly<ShallowRef<boolean>>;
    /** Wo die Stelle des Formulars gerade auf dem Bildschirm liegt (setzt die Karte); `undefined`, solange sie nicht zu sehen ist. */
    readonly schirm: Readonly<ShallowRef<SchirmPunkt | undefined>>;
    /** Die Stelle, die die Karte als Platzhalter zeigt: die des offenen Formulars (bis es abgeschickt ist) oder die, die die Statusseite mit „Auf der Karte zeigen“ zeigt. */
    readonly stelle: ComputedRef<CommunityLage | undefined>;
    /** Die Stelle, die die Statusseite gerade zeigt (`nr` zählt jedes Auslösen); `undefined`, solange sie nichts zeigt. */
    readonly gezeigt: Readonly<ShallowRef<GezeigteStelle | undefined>>;
    /** Steht ein Fenster der Reisebilder angedockt am rechten Rand? `app.vue` rückt dafür Laschen und Eckknöpfe. */
    readonly angedockt: ComputedRef<boolean>;
    /** Das Formular an einer Stelle; der nächste Ort kommt dazu, sobald der Server ihn nennt (oder gleich, wo der Aufrufer ihn schon hat). */
    oeffne(
        lage: CommunityLage,
        ort?: { id: string; name: string; subtype: string; x: number; y: number },
        optionen?: OeffneOptionen,
    ): void;
    /** Die Statusseite zu einem Schlüssel; `null`, `""` oder ein verstümmelter Schlüssel zeigen gleich „gibt es nicht (mehr)“. */
    oeffneStatus(schluessel: string | null | undefined, optionen?: StatusOptionen): void;
    /** Die Liste „Meine Reisebilder“ (Kartenmenü, auch aus der Statusseite zurück). */
    oeffneMeine(): void;
    schliesse(): void;
    /**
     * Darf das offene Fenster jetzt verlassen werden? Fragt den Wächter des Fensters (`schuetze`); ohne Wächter immer. `danach` ist der Weg selbst: Hält der Wächter an, merkt das Fenster ihn sich, und
     * „Trotzdem weiter“ führt ihn aus.
     */
    verlassen(weg: WeiterArt, danach?: () => void): boolean;
    /** Das offene Fenster hängt seinen Wächter ein (die Bestätigung mit dem ungesicherten Link); die Rückgabe hängt ihn aus und räumt nie einen neueren. */
    schuetze(waechter: Waechter): () => void;
    setzeLage(lage: FensterStand["lage"], box?: FensterBox): void;
    setzeBox(box: FensterBox): void;
    starteWahl(): void;
    beendeWahl(): void;
    /** Der Klick auf die Karte im Wählmodus: Die neue Stelle steht, der Modus ist zu. */
    setzeStelle(lage: CommunityLage): void;
    /** Das Formular ist abgeschickt: Die Stelle verschwindet von der Karte, das Fenster bleibt mit der Bestätigung stehen. */
    markiereAbgesendet(): void;
    /** Setzt die Karte, wo die Stelle auf dem Bildschirm liegt (Bildschirmkoordinaten der Seite). */
    setzeSchirm(punkt: SchirmPunkt | undefined): void;
    /** Die Stelle zeigen („Auf der Karte zeigen“ der Statusseite): Platzhalter und Linie stehen da, die Kamera fliegt hin; die Karte hängt sich mit `verbinde` ein. */
    zeigeAufKarte(lage: CommunityLage): void;
    verbinde(zeige: (lage: CommunityLage) => void): () => void;
}

/** Der Wächter des offenen Fensters: `true`, wenn der Weg weitergehen darf; `false`, wenn er anhält (dann steht die Warnung da). */
export type Waechter = (weg: WeiterArt, danach?: () => void) => boolean;

export interface SteuerungUmfeld {
    readonly naechsterOrt?: (lage: CommunityLage) => Promise<BezugOrt | undefined>;
    /** Das Besucherfenster der Meldungen: Es und dieses schließen einander. */
    readonly andere?: { readonly anzeige: Readonly<ShallowRef<unknown>>; schliesse(): void };
}

const naechsterOrtVomServer = async (lage: CommunityLage): Promise<BezugOrt | undefined> => {
    try {
        return ortAusAntwort(await fetchNearestPlace(lage));
    } catch {
        // Ohne den Ort bleibt die Stelle die einzige Angabe; das Formular geht trotzdem.
        return undefined;
    }
};

export function createReisebildSteuerung(umfeld: SteuerungUmfeld = {}): ReisebildSteuerung {
    const anzeige = shallowRef<ReisebildAnzeige | undefined>(undefined);
    const fenster = shallowRef<FensterStand>({ lage: "geloest" });
    const waehlen = shallowRef(false);
    const schirm = shallowRef<SchirmPunkt | undefined>(undefined);
    const gezeigt = shallowRef<GezeigteStelle | undefined>(undefined);
    let zaehler = 0;
    let zeigeZaehler = 0;
    /** Für welche Art Fenster `fenster.box` gezogen wurde; `undefined` ohne Box. */
    let boxArt: ReisebildAnzeige["art"] | undefined;
    let zeige: ((lage: CommunityLage) => void) | undefined;
    /** Der Wächter des offenen Fensters (die Bestätigung mit dem ungesicherten Link); `undefined` bei jedem anderen. */
    let waechter: Waechter | undefined;
    const naechsterOrt = umfeld.naechsterOrt ?? naechsterOrtVomServer;
    const andere = umfeld.andere ?? communityBesucher;

    const raeume = (): void => {
        waehlen.value = false;
        schirm.value = undefined;
        gezeigt.value = undefined;
    };

    /** Den nächsten Ort nachtragen, sobald er da ist; steht dann schon eine andere Stelle oder ein anderes Fenster da, gilt die Antwort nicht mehr. */
    const ergaenzeOrt = (nr: number, lage: CommunityLage): void => {
        void naechsterOrt(lage).then((gefunden) => {
            const jetzt = anzeige.value;
            if (gefunden === undefined || jetzt?.art !== "formular" || jetzt.nr !== nr || jetzt.stelle !== lage) return;
            anzeige.value = { ...jetzt, ort: gefunden };
        });
    };

    const verlassen = (weg: WeiterArt, danach?: () => void): boolean => waechter === undefined || waechter(weg, danach);

    const schliesse = (): void => {
        if (!verlassen("zu", schliesse)) return;
        raeume();
        anzeige.value = undefined;
    };

    /** Eine Box merken: Sie gehört der Art Fenster, die gerade offen steht. */
    const merkeBox = (box: FensterBox | undefined): void => {
        boxArt = box === undefined ? undefined : anzeige.value?.art;
    };

    /** Öffnet eine andere Art Fenster als die, für die die Box gezogen wurde, gilt sie nicht: Das Fenster richtet sich nach seinem Inhalt, die Lage bleibt. */
    const passeBoxAn = (art: ReisebildAnzeige["art"]): void => {
        const stand = fenster.value;
        if (stand.box === undefined || boxArt === art) return;
        fenster.value = { lage: stand.lage };
        boxArt = undefined;
    };

    // Öffnet jemand ein Besucherfenster der Meldungen, geht dieses zu: Es gibt ein Fenster der Besucher zur Zeit.
    // Der Linkschutz gilt auch hier: Hält er an, bleibt das Fenster der Reisebilder stehen, bis der Weg ein zweites Mal kommt (oder „Trotzdem weiter“ ihn ausführt).
    watch(andere.anzeige, (offen) => {
        if (offen !== undefined && anzeige.value !== undefined) schliesse();
    });

    const oeffne: ReisebildSteuerung["oeffne"] = (lage, ort, optionen = {}) => {
        if (!verlassen("noch-eins", () => oeffne(lage, ort, optionen))) return;
        andere.schliesse();
        passeBoxAn("formular");
        const bezug: BezugOrt | undefined =
            ort === undefined
                ? undefined
                : { id: ort.id, name: ort.name, typ: ort.subtype, lage: { x: ort.x, y: ort.y } };
        const jetzt = anzeige.value;
        // Eine andere Stelle im selben Formular (ein weiterer Rechtsklick): Das Geschriebene bleibt. Steht schon die Bestätigung da (abgeschickt), gibt es nichts mehr
        // zu behalten: Dann beginnt ein frisches Formular mit eigenem Schlüssel an der neuen Stelle (Symbol, Linie, Kamerafahrt; Review S2b I1).
        if (jetzt?.art === "formular" && jetzt.abgesendet !== true && optionen.neu !== true) {
            waehlen.value = false;
            anzeige.value = { ...jetzt, stelle: lage, ort: bezug };
            if (bezug === undefined) ergaenzeOrt(jetzt.nr, lage);
            return;
        }
        raeume();
        zaehler += 1;
        if (optionen.waehlen === true) waehlen.value = true;
        anzeige.value = {
            art: "formular",
            nr: zaehler,
            stelle: lage,
            ort: bezug,
            vorbelegung: optionen.vorbelegung,
        };
        if (bezug === undefined) ergaenzeOrt(zaehler, lage);
    };

    const oeffneStatus: ReisebildSteuerung["oeffneStatus"] = (schluessel, optionen = {}) => {
        if (!verlassen("stand", () => oeffneStatus(schluessel, optionen))) return;
        andere.schliesse();
        passeBoxAn("status");
        raeume();
        zaehler += 1;
        anzeige.value = {
            art: "status",
            nr: zaehler,
            schluessel: typeof schluessel === "string" && istSchluessel(schluessel) ? schluessel : null,
            ...(optionen.von === undefined ? {} : { von: optionen.von }),
        };
    };

    const oeffneMeine = (): void => {
        if (!verlassen("meine", oeffneMeine)) return;
        andere.schliesse();
        passeBoxAn("meine");
        raeume();
        zaehler += 1;
        anzeige.value = { art: "meine", nr: zaehler };
    };

    return {
        anzeige,
        fenster,
        waehlen,
        schirm,
        gezeigt,
        stelle: computed(() => {
            const jetzt = anzeige.value;
            if (jetzt?.art === "formular") return jetzt.abgesendet === true ? undefined : jetzt.stelle;
            return jetzt?.art === "status" ? gezeigt.value?.lage : undefined;
        }),
        angedockt: computed(() => anzeige.value !== undefined && fenster.value.lage === "angedockt"),
        oeffne,
        oeffneStatus,
        oeffneMeine,
        schliesse,
        verlassen,
        schuetze(neuerWaechter) {
            waechter = neuerWaechter;
            return () => {
                if (waechter === neuerWaechter) waechter = undefined;
            };
        },
        setzeLage(lage, box) {
            fenster.value = { lage, ...(box === undefined ? {} : { box }) };
            merkeBox(box);
        },
        setzeBox(box) {
            fenster.value = { ...fenster.value, box };
            merkeBox(box);
        },
        starteWahl() {
            if (anzeige.value?.art === "formular") waehlen.value = true;
        },
        beendeWahl() {
            waehlen.value = false;
        },
        setzeStelle(lage) {
            waehlen.value = false;
            const jetzt = anzeige.value;
            if (jetzt?.art !== "formular") return;
            anzeige.value = { ...jetzt, stelle: lage, ort: undefined };
            ergaenzeOrt(jetzt.nr, lage);
        },
        markiereAbgesendet() {
            const jetzt = anzeige.value;
            if (jetzt?.art !== "formular") return;
            waehlen.value = false;
            anzeige.value = { ...jetzt, abgesendet: true };
        },
        setzeSchirm(punkt) {
            const alt = schirm.value;
            if (alt?.x === punkt?.x && alt?.y === punkt?.y) return;
            schirm.value = punkt;
        },
        zeigeAufKarte(lage) {
            // Nur die Statusseite zeigt Stellen; Platzhalter und Linie stehen, bis sie schließt oder ein anderes Fenster kommt.
            if (anzeige.value?.art === "status") {
                zeigeZaehler += 1;
                gezeigt.value = { lage, nr: zeigeZaehler };
            }
            zeige?.(lage);
        },
        verbinde(handler) {
            zeige = handler;
            return () => {
                if (zeige === handler) zeige = undefined;
            };
        },
    };
}

/** Die eine Steuerung der Seite. */
export const reisebildBesucher: ReisebildSteuerung = createReisebildSteuerung();

export const oeffneReisebildStatus = (schluessel: string | null | undefined): void =>
    reisebildBesucher.oeffneStatus(schluessel);
