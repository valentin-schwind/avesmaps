import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { CommunityLage, WaypointNearestResponse } from "@avesmaps3d/shared";
import type { FensterBox } from "../fenster/fenster-lage";
import { fetchNearestPlace } from "../route-planner/route-client";
import { istSchluessel } from "./api";
import type { BezugOrt, MeldeBezug } from "./meldung-modell";

/**
 * Die Steuerung der Besucherseite der Meldungen (WI-0268 C2): EIN Fenster zur Zeit, entweder das Meldeformular oder die Statusseite, dazu die Lage des Fensters und der Modus
 * „Neue Lage auf der Karte zeigen“. `app.vue` kennt von alledem nur `oeffneMeldung`, `oeffneStelle` und `oeffneStatus` (Naht des Infopanels, Kartenmenü, Einstieg über
 * `/meldung#…`); gezeichnet wird in `community-besucher.vue`, die Karte hört über `lage-vorschlag.ts` zu.
 *
 * - 🔴 **Ein Fenster, eine Lage.** Rechts steht höchstens ein angedocktes Fenster (EDIT-0001 D15); die Fenster der Besucher teilen sich darum EINE Anzeige und EINE Lage.
 *   Ein anderer Vorgang im selben Fenster behält die Lage (Bedienkonzept §1.3); `schliesse` lässt sie für das nächste Öffnen stehen.
 * - 🔴 **Die Lage ist gelöst und mittig, bis jemand ▥ drückt** (Betreiber 2026-10-31: „popups … im frontend standardmäßig abgedockt … und zentriert, erst der
 *   ‚andocken‘ dockt es an. angedockt bleibt standard im backend“; ersetzt Bedienkonzept §1.3 „Es öffnet angedockt“ für die Besucher). Besucher haben keine Ablage; ein
 *   gelöstes Fenster steht zuerst mittig über der Karte, danach dort, wo es jemand hingezogen hat (diese Sitzung, nichts wird gespeichert). Angedockt steht es links
 *   neben einem offenen Panel (`NEBEN_PANEL`). Am Telefon gibt es nur angedockt.
 * - **Ein weiterer Rechtsklick setzt die Stelle neu, das Geschriebene bleibt** (§2.1a): Bei einer offenen Meldung an einer Stelle ersetzt `oeffneStelle` nur den Bezug, die
 *   Nummer der Anzeige bleibt, und das Formular behält seinen Text.
 */

/** Der Ort, zu dem „Bewertung schreiben“ das Formular öffnet (WI-0269 C10); `sterne` setzt die Wertung vor. */
export interface BewertungsZiel {
    readonly ortId: string;
    readonly ortName: string;
    readonly sterne?: number | undefined;
}

/** Die Bewertung, die „⚑ Melden“ meldet: Kennung, Sterne, Autorzeile und Text, nur für die Anzeige im Fenster (WI-0269 C10). */
export interface BewertungsMeldungsZiel {
    readonly ortId: string;
    readonly ortName: string;
    readonly bewertung: {
        readonly id: string;
        readonly stars: number;
        readonly head: string;
        readonly text?: string | undefined;
    };
}

export type Anzeige =
    | { readonly art: "meldung"; readonly nr: number; readonly bezug: MeldeBezug }
    /** „Bewertung schreiben“ (WI-0269 C10). */
    | { readonly art: "bewertung"; readonly nr: number; readonly ziel: BewertungsZiel }
    /** „Bewertung melden“ (WI-0269 C10). */
    | { readonly art: "bewertungMelden"; readonly nr: number; readonly ziel: BewertungsMeldungsZiel }
    /** Das Kontaktformular der Hinweise (WI-0268 C4). */
    | { readonly art: "kontakt"; readonly nr: number }
    /** `schluessel` ist `null`, wenn der Link keinen Schlüssel trug oder einen verstümmelten: Das Fenster sagt es, ohne den Server zu fragen. */
    | { readonly art: "status"; readonly nr: number; readonly schluessel: string | null };

export interface FensterStand {
    readonly lage: "angedockt" | "geloest";
    readonly box?: FensterBox | undefined;
}

/** Der Modus „Neue Lage auf der Karte zeigen“: wessen Lage, und wo sie bisher war (von dort geht die gestrichelte Linie zur neuen). */
export interface LageModus {
    readonly name: string;
    readonly alt?: CommunityLage | undefined;
}

/** Die vorgeschlagene Lage samt der alten, auf die der Geist zeigt. */
export interface LageVorschlag {
    readonly neu: CommunityLage;
    readonly alt?: CommunityLage | undefined;
}

export interface BesucherSteuerung {
    readonly anzeige: Readonly<ShallowRef<Anzeige | undefined>>;
    readonly fenster: Readonly<ShallowRef<FensterStand>>;
    readonly lageModus: Readonly<ShallowRef<LageModus | undefined>>;
    readonly vorschlag: Readonly<ShallowRef<LageVorschlag | undefined>>;
    /** Steht ein Fenster der Besucher angedockt am rechten Rand? `app.vue` rückt dafür Laschen und Eckknöpfe. */
    readonly angedockt: ComputedRef<boolean>;
    oeffneMeldung(bezug: MeldeBezug): void;
    /** Das Kontaktformular („Nachricht schreiben“ im Impressum der Hinweise, WI-0268 C4); ein zweiter Aufruf lässt das offene Formular mit seinem Text stehen. */
    oeffneKontakt(): void;
    /** Das Formular „Bewertung schreiben“ zu einem Ort (WI-0269 C10). */
    oeffneBewertung(ziel: BewertungsZiel): void;
    /** Das Fenster „Bewertung melden“ zu einer Bewertung (WI-0269 C10). */
    oeffneBewertungMelden(ziel: BewertungsMeldungsZiel): void;
    /** Eine freie Stelle der Karte; der nächste Ort kommt dazu, sobald der Server ihn nennt (oder gleich, wo der Aufrufer ihn schon hat). */
    oeffneStelle(lage: CommunityLage, ort?: BezugOrt, reisebildId?: string): void;
    /** Die Statusseite zu einem Schlüssel; `null`, `""` oder ein verstümmelter Schlüssel zeigen gleich „gibt es nicht (mehr)“. */
    oeffneStatus(schluessel: string | null | undefined): void;
    schliesse(): void;
    setzeLage(lage: FensterStand["lage"], box?: FensterBox): void;
    setzeBox(box: FensterBox): void;
    starteLageModus(modus: LageModus): void;
    beendeLageModus(): void;
    /** Der Klick auf die Karte: die neue Lage steht, der Modus ist zu. */
    setzeVorschlag(neu: CommunityLage): void;
    nimmVorschlagZurueck(): void;
}

/** Der Ort aus der Antwort „nächster Ort“; ohne Treffer kein Ort. */
export function ortAusAntwort(antwort: Pick<WaypointNearestResponse, "place">): BezugOrt | undefined {
    const ort = antwort.place;
    if (!ort) return undefined;
    return { id: ort.id, name: ort.name, typ: ort.subtype, lage: { x: ort.x, y: ort.y } };
}

export function createBesucherSteuerung(
    umfeld: { naechsterOrt?: (lage: CommunityLage) => Promise<BezugOrt | undefined> } = {},
): BesucherSteuerung {
    const anzeige = shallowRef<Anzeige | undefined>(undefined);
    const fenster = shallowRef<FensterStand>({ lage: "geloest" });
    const lageModus = shallowRef<LageModus | undefined>(undefined);
    const vorschlag = shallowRef<LageVorschlag | undefined>(undefined);
    let zaehler = 0;
    const naechsterOrt =
        umfeld.naechsterOrt ??
        (async (lage: CommunityLage): Promise<BezugOrt | undefined> => {
            try {
                return ortAusAntwort(await fetchNearestPlace(lage));
            } catch {
                // Ohne den Ort bleibt die Stelle die einzige Wahl; das Formular geht trotzdem.
                return undefined;
            }
        });

    const raeumeLage = (): void => {
        lageModus.value = undefined;
        vorschlag.value = undefined;
    };

    function oeffneMeldung(bezug: MeldeBezug): void {
        const jetzt = anzeige.value;
        // Dieselbe Art von Bezug (eine Stelle statt der anderen): dasselbe Formular, nur der Bezug wechselt.
        if (jetzt?.art === "meldung" && jetzt.bezug.art === "stelle" && bezug.art === "stelle") {
            anzeige.value = { art: "meldung", nr: jetzt.nr, bezug };
            return;
        }
        raeumeLage();
        zaehler += 1;
        anzeige.value = { art: "meldung", nr: zaehler, bezug };
    }

    return {
        anzeige,
        fenster,
        lageModus,
        vorschlag,
        angedockt: computed(() => anzeige.value !== undefined && fenster.value.lage === "angedockt"),
        oeffneMeldung,
        oeffneKontakt() {
            if (anzeige.value?.art === "kontakt") return;
            raeumeLage();
            zaehler += 1;
            anzeige.value = { art: "kontakt", nr: zaehler };
        },
        oeffneBewertung(ziel) {
            // Derselbe Ort noch einmal: das Fenster bleibt mit seinem Text; ein anderer Ort oder ein anderes Fenster beginnt neu.
            const jetzt = anzeige.value;
            if (jetzt?.art === "bewertung" && jetzt.ziel.ortId === ziel.ortId) return;
            raeumeLage();
            zaehler += 1;
            anzeige.value = { art: "bewertung", nr: zaehler, ziel };
        },
        oeffneBewertungMelden(ziel) {
            raeumeLage();
            zaehler += 1;
            anzeige.value = { art: "bewertungMelden", nr: zaehler, ziel };
        },
        oeffneStelle(lage, ort, reisebildId) {
            oeffneMeldung({
                art: "stelle",
                lage,
                ...(ort === undefined ? {} : { ort }),
                ...(reisebildId === undefined ? {} : { reisebildId }),
            });
            if (ort !== undefined) return;
            // Der nächste Ort kommt nach; steht dann schon eine andere Stelle oder ein anderes Fenster da, gilt die Antwort nicht mehr.
            const nr = anzeige.value?.nr;
            void naechsterOrt(lage).then((gefunden) => {
                const jetzt = anzeige.value;
                if (gefunden === undefined || jetzt?.art !== "meldung" || jetzt.nr !== nr) return;
                if (jetzt.bezug.art !== "stelle" || jetzt.bezug.lage !== lage) return;
                anzeige.value = { ...jetzt, bezug: { ...jetzt.bezug, ort: gefunden } };
            });
        },
        oeffneStatus(schluessel) {
            raeumeLage();
            zaehler += 1;
            anzeige.value = {
                art: "status",
                nr: zaehler,
                schluessel: typeof schluessel === "string" && istSchluessel(schluessel) ? schluessel : null,
            };
        },
        schliesse() {
            raeumeLage();
            anzeige.value = undefined;
        },
        setzeLage(lage, box) {
            fenster.value = { lage, ...(box === undefined ? {} : { box }) };
        },
        setzeBox(box) {
            fenster.value = { ...fenster.value, box };
        },
        starteLageModus(modus) {
            lageModus.value = modus;
        },
        beendeLageModus() {
            lageModus.value = undefined;
        },
        setzeVorschlag(neu) {
            vorschlag.value = { neu, ...(lageModus.value?.alt === undefined ? {} : { alt: lageModus.value.alt }) };
            lageModus.value = undefined;
        },
        nimmVorschlagZurueck() {
            vorschlag.value = undefined;
        },
    };
}

/** Die eine Steuerung der Seite. */
export const besucher: BesucherSteuerung = createBesucherSteuerung();

/**
 * Wie weit ein angedocktes Besucherfenster vom rechten Rand abrückt, wenn rechts das Info- oder Editorpanel offen steht: genau dessen Breite, ohne Fuge
 * (wie `community-redaktion.vue`). 🔴 Ein Besucherfenster steht NEBEN dem Panel, nie darüber (Betreiber 2026-10-31: „neue popups (hier bewertungen) sollen
 * zentriert erscheinen oder neben dem info-box panel NICHT ÜBER DEM INFOBOX PANEL“), und angedockt ohne Spalt (Betreiber 2026-10-31: „ohne spalt an den das
 * editor-panel andocken“).
 */
export const NEBEN_PANEL = "min(var(--avesmaps-infopanel-width), 100vw - var(--avesmaps-tab-w))";
/** Die Breite eines angedockten Besucherfensters (Kanonbreite „entscheiden“). */
export const BESUCHER_BREITE = "min(calc(var(--avm-fenster-entscheiden)), 100vw - var(--avesmaps-tab-w))";

export const oeffneMeldung = (bezug: MeldeBezug): void => besucher.oeffneMeldung(bezug);
export const oeffneStelle = (lage: CommunityLage, ort?: BezugOrt): void => besucher.oeffneStelle(lage, ort);
export const oeffneKontakt = (): void => besucher.oeffneKontakt();
export const oeffneStatus = (schluessel: string | null | undefined): void => besucher.oeffneStatus(schluessel);
