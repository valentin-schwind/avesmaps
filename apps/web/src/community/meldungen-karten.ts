import {
    KARTENVORSCHLAG_SEGMENT_ZUSTAENDE,
    type CommunitySegment,
    type KartenvorschlagListe,
    type KartenvorschlagSegment,
    type KartenvorschlagZeile,
    type VorgangListe,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { ladeVorschlaege, nichtEingerichtet, type VorschlagsFrage } from "./kartenvorschlaege-api";
import { ZUSTAND_NAME as KARTEN_ZUSTAND_NAME, hinweisVon, istOffen, quelleVon } from "./kartenvorschlaege-modell";
import { kategorieName, segmentZahl, unterreiterZahl, zeitAbstand, type ListenZeile } from "./meldungen-modell";

/**
 * Kartenvorschläge in der Liste der Meldungen (WI-0305, Vali 2026-11-10: „Als Eintrag der Meldungen“), ohne Vue und ohne Browser. Die Daten bleiben in ihrer eigenen Tafel und an ihrer eigenen Route
 * (`GET /api/community/kartenvorschlaege`); die Liste holt beide Quellen und zeigt sie als eine.
 *
 * - **Ein Vorschlag ist eine Zeile wie ein Vorgang:** Kategorie „Karte“, niemand zuständig, Priorität normal, offen „neu“ (○) und entschieden „abgeschlossen“ (●). So greifen Trichter, Sortierung und Legende
 *   der Meldungen unverändert; den genauen Zustand („wird geprüft“, „Datei defekt“, „abgelehnt“) sagen der Name des Kreises, der Hinweis und rechts der Text.
 * - **Segmente:** Offen trägt die offenen Vorschläge, Erledigt die angenommenen, abgelehnten und zurückgezogenen. Archiv und Papierkorb kennen Kartenvorschläge nicht.
 * - Ein Klick öffnet das Fenster des Vorschlags (Annehmen, Ablehnen) wie vorher der Reiter „Karten“.
 */

export const KARTEN_KATEGORIE = "karte";

/** Ein Kartenvorschlag als Zeile der Meldungen; `vorschlag` ist die Zeile, wie der Server sie schickt. */
export interface KartenMeldung extends ListenZeile {
    readonly vorschlag: KartenvorschlagZeile;
}
export type MeldungenEintrag = VorgangZeile | KartenMeldung;
export const istKarte = (eintrag: MeldungenEintrag): eintrag is KartenMeldung => "vorschlag" in eintrag;

export function alsMeldung(vorschlag: KartenvorschlagZeile): KartenMeldung {
    return {
        nummer: vorschlag.nummer,
        zustand: istOffen(vorschlag.zustand) ? "neu" : "abgeschlossen",
        zustaendig: null,
        prioritaet: "normal",
        kategorie: KARTEN_KATEGORIE,
        eingegangenAt: vorschlag.eingegangenAm,
        aktivAt: vorschlag.eingegangenAm,
        vorschlag,
    };
}

/** Welche Segmente der Kartenvorschläge zu einem Segment der Meldungen gehören. */
export const KARTEN_SEGMENTE: Readonly<Record<CommunitySegment, readonly KartenvorschlagSegment[]>> = {
    offen: ["offen"],
    erledigt: ["angenommen", "abgelehnt"],
    archiv: [],
    papierkorb: [],
};

/** So viele Vorschläge holt die Liste je Segment der Kartenvorschläge; mehr gibt die Route auf einmal nicht. */
export const KARTEN_JE_SEGMENT = 100;

/** Die Kartenvorschläge eines Segments der Meldungen: Zeilen, Zähler (alle, ohne Suche) und ob es mehr gibt, als die Liste holte. */
export interface KartenTeil {
    readonly eintraege: readonly KartenMeldung[];
    readonly zaehler: KartenvorschlagListe["zaehler"];
    readonly weitere: boolean;
}

/**
 * Holt die Kartenvorschläge zu einem Segment der Meldungen. Ohne passendes Segment (Archiv, Papierkorb) holt EINE Zeile die Zähler, denn die Zahlen an Offen und Erledigt und am Unterreiter brauchen sie.
 * `undefined`: Auf dieser Instanz gibt es keine Kartenvorschläge (503 `kartenvorschlag_unavailable`).
 */
export async function ladeKartenTeil(
    segment: CommunitySegment,
    q: string,
    laden: (frage: VorschlagsFrage) => Promise<KartenvorschlagListe> = ladeVorschlaege,
): Promise<KartenTeil | undefined> {
    const segmente = KARTEN_SEGMENTE[segment];
    try {
        if (segmente.length === 0) {
            const nurZahl = await laden({ segment: "offen", limit: 1 });
            return { eintraege: [], zaehler: nurZahl.zaehler, weitere: false };
        }
        const listen = await Promise.all(segmente.map((teil) => laden({ segment: teil, q, limit: KARTEN_JE_SEGMENT })));
        return {
            eintraege: listen.flatMap((liste) => liste.eintraege.map(alsMeldung)),
            zaehler: listen[0]!.zaehler,
            weitere: listen.some((liste) => liste.weitere),
        };
    } catch (fehler) {
        if (nichtEingerichtet(fehler)) return undefined;
        throw fehler;
    }
}

/** Wie viele Vorschläge in den Zuständen eines Segments der Meldungen stehen. */
export function kartenZahl(zaehler: KartenvorschlagListe["zaehler"] | undefined, segment: CommunitySegment): number {
    if (zaehler === undefined) return 0;
    return KARTEN_SEGMENTE[segment]
        .flatMap((teil) => KARTENVORSCHLAG_SEGMENT_ZUSTAENDE[teil])
        .reduce((summe, zustand) => summe + zaehler[zustand], 0);
}

/** Die Zahl am Segment: Vorgänge und Kartenvorschläge zusammen. */
export const zahlAmSegment = (
    liste: Pick<VorgangListe, "zaehler"> | undefined,
    karten: Pick<KartenTeil, "zaehler"> | undefined,
    segment: CommunitySegment,
): number => (liste === undefined ? 0 : segmentZahl(liste.zaehler, segment)) + kartenZahl(karten?.zaehler, segment);

/** Die Zahl am Unterreiter: was auf mich wartet, dazu die wartenden Kartenvorschläge (vorher die Zahl am Reiter „Karten“). `undefined`, wenn keine Quelle da ist. */
export function wartendeZahl(
    liste: Pick<VorgangListe, "zaehler"> | undefined,
    karten: Pick<KartenTeil, "zaehler"> | undefined,
): number | undefined {
    if (liste === undefined && karten === undefined) return undefined;
    return (unterreiterZahl(liste) ?? 0) + (karten?.zaehler.pending ?? 0);
}

// --- Die Zeile -------------------------------------------------------------------------------------------------------------

/** „Karte: Stadtplan von Gareth“, wie „Lage falsch: Wehrheim“. */
export const kartenTitel = (eintrag: KartenMeldung): string =>
    `${kategorieName(KARTEN_KATEGORIE)}: ${eintrag.vorschlag.titel}`;

/** „K-1042 · Gareth“; die Quelle (Host oder Format, bei einer Datei mit dem Bild-Zeichen davor) setzt die Oberfläche dahinter. */
export const kartenUnterzeile = (eintrag: KartenMeldung): string =>
    [eintrag.vorschlag.nummer, eintrag.vorschlag.ort?.name ?? t("kartenvorschlag.redaktion.ohneOrt")].join(" · ");

export const kartenQuelle = (eintrag: KartenMeldung): string => quelleVon(eintrag.vorschlag);

/** Der genaue Zustand, als Name des Kreises. */
export const kartenZustandName = (eintrag: KartenMeldung): string => t(KARTEN_ZUSTAND_NAME[eintrag.vorschlag.zustand]);

/** Der Hinweis unter dem Titel (Datei fehlt, wird geprüft, defekt), nur an Offenem, wie bei den Vorgängen. */
export const kartenHinweise = (eintrag: KartenMeldung): string[] => {
    if (!istOffen(eintrag.vorschlag.zustand)) return [];
    const hinweis = hinweisVon(eintrag.vorschlag);
    return hinweis === undefined ? [] : [hinweis];
};

/** Rechts: die Zeit; an Entschiedenem der Zustand („angenommen“), wie das Ergebnis eines abgeschlossenen Vorgangs. */
export const kartenRechts = (eintrag: KartenMeldung, jetzt: Date = new Date()): string =>
    istOffen(eintrag.vorschlag.zustand)
        ? zeitAbstand(eintrag.vorschlag.eingegangenAm, jetzt)
        : kartenZustandName(eintrag);

/** Der Titel des Fensters, wie vorher aus dem Reiter „Karten“. */
export const kartenFensterTitel = (eintrag: KartenMeldung): string =>
    `${eintrag.vorschlag.nummer} ${eintrag.vorschlag.titel}`;
