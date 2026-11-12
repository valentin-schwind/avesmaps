import {
    COMMUNITY_GRENZEN,
    leseCom,
    type BezugObjektart,
    type CommunityArt,
    type CommunityErgebnis,
    type CommunityPerson,
    type CommunityPrioritaet,
    type CommunitySegment,
    type CommunityZustand,
    type MailInhalt,
    type MailZustellstand,
    MAIL_WIEDER_GEOEFFNET,
    type VerlaufEintrag,
    type VorgangDetail,
    type VorgangListe,
    type VorgangZeile,
    SONDERROLLEN_NAMEN,
    rollenGeordnet,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { formatList, isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { zuLangSatz } from "./redaktion-ablehnung";

/**
 * Das Modell des Reiters „Community › Meldungen“ ohne Vue und ohne Browser (WI-0268 C3; Bedienkonzept WI-0263 §2.2 bis §2.6, §4): Kreis, Titel, Filter, Sortierung, die Zahlen, die Sperrgründe der
 * Handgriffe und der Verlauf in Alltagssprache. Die Bauteile zeichnen nur, was hier steht; Vitest prüft es ohne Browser (`test/community-meldungen.test.ts`).
 *
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19). Jeder Handgriff, der in einem Zustand oder mit einem Recht nicht geht, trägt hier seinen Grund; die Bauteile sperren nie ohne ihn.
 * - **Was der Server entscheidet, bleibt beim Server:** Übergänge, Revision, Rechte. Dieses Modell blendet nur aus, was nicht passt, und sagt, warum; ein Schritt, der trotzdem abgelehnt wird,
 *   kommt als `community_transition` oder `community_conflict` zurück (`redaktion-api.ts`).
 */

// --- Kreis, Zustand, Titel -------------------------------------------------------------------------------------------------

export type Kreis = "leer" | "halb" | "halb-rechts" | "voll";

/** Der Kreis der Liste (Fachkonzept §4.1): neu ○, in Arbeit ◐, Rückfrage ◑, abgeschlossen ●. */
export const KREIS_VON_ZUSTAND: Readonly<Record<CommunityZustand, Kreis>> = {
    neu: "leer",
    in_arbeit: "halb",
    rueckfrage: "halb-rechts",
    abgeschlossen: "voll",
};
export const kreisVon = (zustand: CommunityZustand): Kreis => KREIS_VON_ZUSTAND[zustand];

export const ZUSTAND_NAME: Readonly<Record<CommunityZustand, MessageKey>> = {
    neu: "community.redaktion.zustand.neu",
    in_arbeit: "community.redaktion.zustand.in_arbeit",
    rueckfrage: "community.redaktion.zustand.rueckfrage",
    abgeschlossen: "community.redaktion.zustand.abgeschlossen",
};

const nachschlagen = (key: string): string | undefined => (isMessageKey(key) ? t(key) : undefined);

/** Die Kategorie in Alltagssprache; eine unbekannte (etwa die spätere „Bewertung gemeldet“) bleibt, wie sie kommt. */
export const kategorieName = (kategorie: string): string =>
    nachschlagen(`community.kategorie.${kategorie}`) ?? kategorie;

export const ergebnisName = (ergebnis: string | null): string =>
    ergebnis === null ? "" : (nachschlagen(`community.ergebnis.${ergebnis}`) ?? ergebnis);

/** Der Name einer Sonderrolle als Aufgabe („Derograph“), nicht als Wortform einer Person (WI-0279); eine unbekannte bleibt, wie sie kommt. */
export const rolleName = (rolle: string): string => nachschlagen(`auth.sonderrolle.${rolle}`) ?? rolle;

export const prioritaetName = (prioritaet: string): string =>
    nachschlagen(`community.redaktion.prio.${prioritaet}`) ?? prioritaet;

/** Der Bezug als Wort: der Name des Objekts, oder „Stelle bei ‹Ort›“ (Bedienkonzept §2.1a); `undefined`, wenn der Vorgang keinen Bezug hat. */
export function bezugText(zeile: Pick<VorgangZeile, "bezugArt" | "bezugName">): string | undefined {
    if (zeile.bezugArt === "stelle") {
        return zeile.bezugName === null
            ? t("community.redaktion.stelle")
            : t("community.redaktion.stelleBei", { ort: zeile.bezugName });
    }
    return zeile.bezugName ?? undefined;
}

/** „Lage falsch: Wehrheim“, „Etwas fehlt: Stelle bei Gallys“ (Bedienkonzept §2.2 Nr. 2). */
export function titelVon(zeile: Pick<VorgangZeile, "kategorie" | "bezugArt" | "bezugName">): string {
    const bezug = bezugText(zeile);
    const kategorie = kategorieName(zeile.kategorie);
    return bezug === undefined ? kategorie : `${kategorie}: ${bezug}`;
}

export const zustaendigName = (zeile: Pick<VorgangZeile, "zustaendig">): string =>
    zeile.zustaendig === null || zeile.zustaendig.name === ""
        ? t("community.redaktion.niemandZustaendig")
        : zeile.zustaendig.name;

/** „COM-000123 · Wehrheim · niemand zuständig“ (Bedienkonzept §2.2 Nr. 2). */
export function unterzeile(zeile: VorgangZeile): string {
    return unterzeileTeile(zeile, undefined)
        .map((teil) => teil.text)
        .join("");
}

/** Ein Stück der Unterzeile; `mein` steht in Gold (WI-0279: die eigene Person, eine eigene Rolle). */
export interface UnterzeileTeil {
    readonly text: string;
    readonly mein: boolean;
}

/**
 * Die Unterzeile in Stücken (WI-0279, Entwurf „Meldungen an Rollen“): Nummer · Bezug · wer zuständig ist, Person und Rollen mit Komma, „niemand zuständig“ ohne beides.
 * `ich`: die eigene Kennung; der eigene Teil (die Person, eine Rolle mit `mein`) trägt `mein`.
 */
export function unterzeileTeile(zeile: VorgangZeile, ich: string | undefined): UnterzeileTeil[] {
    const leise = (text: string): UnterzeileTeil => ({ text, mein: false });
    const kopf = [zeile.nummer, bezugText(zeile)].filter((teil) => teil !== undefined).join(" · ");
    const wer: UnterzeileTeil[] = [
        ...(zeile.zustaendig === null || zeile.zustaendig.name === ""
            ? []
            : [{ text: zeile.zustaendig.name, mein: ich !== undefined && zeile.zustaendig.id === ich }]),
        ...(zeile.rollen ?? []).map((rolle) => ({ text: rolleName(rolle.sonderrolle), mein: rolle.mein })),
    ];
    if (wer.length === 0) return [leise(`${kopf} · ${t("community.redaktion.niemandZustaendig")}`)];
    return [leise(`${kopf} · `), ...wer.flatMap((teil, i) => (i === 0 ? [teil] : [leise(", "), teil]))];
}

/** Ist irgendwer zuständig, eine Person oder eine Rolle? */
export const istZugewiesen = (
    zeile: Pick<VorgangZeile, "zustaendig"> & { readonly rollen?: VorgangZeile["rollen"] },
): boolean => zeile.zustaendig !== null || (zeile.rollen?.length ?? 0) > 0;

/** Wie lange es her ist; die Sprache der Seite. */
export const zeitAbstand = (iso: string, jetzt: Date = new Date()): string =>
    relativeTime(new Date(iso), jetzt, locale.value, "abstand");
export const zeitPunkt = (iso: string, jetzt: Date = new Date()): string =>
    relativeTime(new Date(iso), jetzt, locale.value, "zeitpunkt");

/** Die Pille einer Zeile: nur hoch (Bernstein) und dringend (Rot) zeigen eine (Bedienkonzept §4). */
export function prioritaetPille(prioritaet: CommunityPrioritaet): "warnung" | "gefahr" | undefined {
    if (prioritaet === "dringend") return "gefahr";
    return prioritaet === "hoch" ? "warnung" : undefined;
}

/** Die Hinweise unter dem Titel: „mögliche Dublette von COM-…“ und „ohne Quelle“, beide nur an Offenem. */
export function hinweise(zeile: VorgangZeile): string[] {
    if (zeile.zustand === "abgeschlossen") return [];
    return [
        ...(zeile.moeglicheDublette === null
            ? []
            : [t("community.redaktion.dublette", { nummer: zeile.moeglicheDublette })]),
        ...(zeile.ohneQuelle ? [t("community.redaktion.ohneQuelle")] : []),
    ];
}

/** Rechts in der Zeile: die Zeit; an Abgeschlossenem das Ergebnis (Probierseite). */
export function rechtsText(zeile: VorgangZeile, jetzt: Date = new Date()): string {
    return zeile.zustand === "abgeschlossen" && zeile.ergebnis !== null
        ? ergebnisName(zeile.ergebnis)
        : zeitAbstand(zeile.eingegangenAt, jetzt);
}

// --- Segmente und Zahlen ---------------------------------------------------------------------------------------------------

export const LISTEN_SEGMENTE = ["offen", "erledigt", "archiv"] as const;
export type ListenSegment = (typeof LISTEN_SEGMENTE)[number];

/** Die Zahl am Segment (Bedienkonzept §4: „Offen · Erledigt · Archiv mit Zahl“). */
export const segmentZahl = (zaehler: VorgangListe["zaehler"], segment: CommunitySegment): number => zaehler[segment];

/** Die Zahl am Unterreiter: offene ohne Zuständigkeit plus mir zugewiesene, was auf mich wartet (Bedienkonzept §1.1). */
export const unterreiterZahl = (liste: Pick<VorgangListe, "zaehler"> | undefined): number | undefined =>
    liste?.zaehler.meine;

/** Die Legende unten (EINE Zeile): wie viele der gezeigten Zeilen in welchem Kreis stehen. */
export function legendeZahlen(zeilen: readonly Pick<ListenZeile, "zustand">[]): Record<Kreis, number> {
    const zahlen: Record<Kreis, number> = { leer: 0, halb: 0, "halb-rechts": 0, voll: 0 };
    for (const zeile of zeilen) zahlen[kreisVon(zeile.zustand)] += 1;
    return zahlen;
}

/** Welche Kreise die Legende nennt: im Offenen die drei Stufen, sonst das, was in der Liste vorkommt (Erledigt: nur ●; der Papierkorb zeigt alle vier). */
export function legendeNamen(segment: CommunitySegment | "papierkorb"): Partial<Record<Kreis, string>> {
    if (segment === "offen") {
        return {
            leer: t(ZUSTAND_NAME.neu),
            halb: t(ZUSTAND_NAME.in_arbeit),
            "halb-rechts": t(ZUSTAND_NAME.rueckfrage),
        };
    }
    if (segment === "papierkorb") {
        return {
            leer: t(ZUSTAND_NAME.neu),
            halb: t(ZUSTAND_NAME.in_arbeit),
            "halb-rechts": t(ZUSTAND_NAME.rueckfrage),
            voll: t(ZUSTAND_NAME.abgeschlossen),
        };
    }
    return { voll: t(ZUSTAND_NAME.abgeschlossen) };
}

// --- Filter und Sortierung -------------------------------------------------------------------------------------------------

export const FILTER_ABSCHNITTE = [
    "zustand",
    "zustaendig",
    "sonderrolle",
    "prioritaet",
    "kategorie",
    "papierkorb",
] as const;
export type FilterAbschnittId = (typeof FILTER_ABSCHNITTE)[number];

/** Die gesetzten Werte je Abschnitt; leer heißt alle (wie `FilterWahl` des Filterknopfs). */
export type ListenFilter = Readonly<Partial<Record<FilterAbschnittId, readonly string[]>>>;

export const ZUSTAENDIG_WERTE = ["mir", "niemand", "andere"] as const;
export const OFFENE_ZUSTAENDE = ["neu", "in_arbeit", "rueckfrage"] as const;

/** Die Kategorien, die das Meldeformular anbietet (Fachkonzept §3.2), für den Trichter. */
export const FILTER_KATEGORIEN = ["lage", "name", "angabe", "fehlt", "entfaellt", "sonstiges", "bewertung"] as const;

const gesetzt = (filter: ListenFilter, abschnitt: FilterAbschnittId): readonly string[] => filter[abschnitt] ?? [];

/**
 * Was Trichter, Sortierung und Legende an einer Zeile lesen. Ein Vorgang hat es; ein Kartenvorschlag bekommt es, wenn er in der Liste steht (WI-0305, `meldungen-karten.ts`): neu oder abgeschlossen,
 * niemand zuständig, normal, Kategorie „Karte“.
 */
export type ListenZeile = Pick<
    VorgangZeile,
    "nummer" | "zustand" | "zustaendig" | "prioritaet" | "kategorie" | "eingegangenAt" | "aktivAt"
> & { readonly rollen?: VorgangZeile["rollen"]; readonly mein?: VorgangZeile["mein"] };

/** Der Papierkorb ist kein Filter der Zeilen, sondern ein anderes Segment der Anfrage (`GET …/vorgaenge?segment=papierkorb`). */
export const papierkorbAn = (filter: ListenFilter): boolean => gesetzt(filter, "papierkorb").length > 0;

function zustaendigWert(zeile: ListenZeile, ich: string | undefined): (typeof ZUSTAENDIG_WERTE)[number] {
    if (zeile.zustaendig === null) return (zeile.rollen?.length ?? 0) > 0 ? "andere" : "niemand";
    return ich !== undefined && zeile.zustaendig.id === ich ? "mir" : "andere";
}

/** Die Prüfung eines Abschnitts an einer Zeile. Ein leerer Abschnitt lässt alles durch. */
function passtAbschnitt(
    zeile: ListenZeile,
    abschnitt: FilterAbschnittId,
    werte: readonly string[],
    ich: string | undefined,
): boolean {
    if (werte.length === 0) return true;
    switch (abschnitt) {
        case "zustand":
            return werte.includes(zeile.zustand);
        case "zustaendig":
            return werte.includes(zustaendigWert(zeile, ich));
        case "sonderrolle":
            return (zeile.rollen ?? []).some((rolle) => werte.includes(rolle.sonderrolle));
        case "prioritaet":
            return werte.includes(zeile.prioritaet);
        case "kategorie":
            return werte.includes(zeile.kategorie);
        case "papierkorb":
            return true;
    }
}

/** Passt die Zeile zu allen Abschnitten außer `ausser` (für die Zahlen im Trichter)? */
export function passtFilter(
    zeile: ListenZeile,
    filter: ListenFilter,
    ich: string | undefined,
    ausser?: FilterAbschnittId,
): boolean {
    return FILTER_ABSCHNITTE.every(
        (abschnitt) => abschnitt === ausser || passtAbschnitt(zeile, abschnitt, gesetzt(filter, abschnitt), ich),
    );
}

/**
 * Die Werte des Abschnitts „Sonderrolle“ im Trichter (WI-0279): nur Rollen, die in der Liste vorkommen, in der Reihenfolge des Katalogs; eine gewählte bleibt stehen, auch wenn
 * sie gerade in keiner Zeile steht (sonst ließe sie sich nicht abwählen).
 */
export function sonderrollenImTrichter(zeilen: readonly ListenZeile[], gewaehlt: readonly string[]): string[] {
    return rollenGeordnet([
        ...zeilen.flatMap((zeile) => (zeile.rollen ?? []).map((rolle) => rolle.sonderrolle)),
        ...gewaehlt,
    ]);
}

// --- Meine | Alle (WI-0279) -----------------------------------------------------------------------------------------------

export const LISTEN_REITER = ["meine", "alle"] as const;
export type ListenReiter = (typeof LISTEN_REITER)[number];

/**
 * „Meine“: mir als Person zugewiesen oder einer Rolle, die ich habe (regional: in einer Region der Meldung). Der Server rechnet `mein`; ohne das Feld (ein Server vor WI-0279)
 * zählt nur die Person. Ein Kartenvorschlag hat keine Zuständigkeit und steht in beiden Reitern (Claudias Setzung: sonst sähe ihn unter „Meine“ niemand).
 */
export function istMeine(zeile: ListenZeile, ich: string | undefined): boolean {
    if (zeile.mein !== undefined) return zeile.mein;
    return ich !== undefined && zeile.zustaendig?.id === ich;
}

export const filtere = <Z extends ListenZeile>(
    zeilen: readonly Z[],
    filter: ListenFilter,
    ich: string | undefined,
): Z[] => zeilen.filter((zeile) => passtFilter(zeile, filter, ich));

/** Wie viele Zeilen ein Wert hätte, mit den übrigen Abschnitten wie gewählt (Zahl rechts im Trichter). */
export function trefferZahl(
    zeilen: readonly ListenZeile[],
    filter: ListenFilter,
    ich: string | undefined,
    abschnitt: FilterAbschnittId,
    wert: string,
): number {
    return zeilen.filter(
        (zeile) => passtFilter(zeile, filter, ich, abschnitt) && passtAbschnitt(zeile, abschnitt, [wert], ich),
    ).length;
}

export const ORDNUNGEN = ["neu", "alt", "aktiv", "prioritaet"] as const;
export type Ordnung = (typeof ORDNUNGEN)[number];

const RANG: Readonly<Record<CommunityPrioritaet, number>> = { niedrig: 0, normal: 1, hoch: 2, dringend: 3 };
const spaeter = (a: string, b: string): number => Date.parse(b) - Date.parse(a);

/**
 * Sortierung (Bedienkonzept §4): Zeit (neueste oder älteste zuerst), letzte Aktivität, Priorität. Bei Gleichstand gilt die Zeit, dann die Nummer, damit die Folge fest ist.
 * Die Antwort des Servers bleibt, wie sie kam (Kopie).
 */
export function sortiere<Z extends ListenZeile>(zeilen: readonly Z[], ordnung: Ordnung): Z[] {
    // Ein Kartenvorschlag trägt keine COM-Nummer („K-1042“): Bei gleicher Zeit entscheidet dann die Nummer als Text.
    const nummer = (zeile: ListenZeile): number => leseCom(zeile.nummer) ?? 0;
    const neuZuerst = (a: ListenZeile, b: ListenZeile): number =>
        spaeter(a.eingegangenAt, b.eingegangenAt) || nummer(b) - nummer(a) || b.nummer.localeCompare(a.nummer);
    const vergleich: Record<Ordnung, (a: ListenZeile, b: ListenZeile) => number> = {
        neu: neuZuerst,
        alt: (a, b) => neuZuerst(b, a),
        aktiv: (a, b) => spaeter(a.aktivAt, b.aktivAt) || neuZuerst(a, b),
        prioritaet: (a, b) => RANG[b.prioritaet] - RANG[a.prioritaet] || neuZuerst(a, b),
    };
    return [...zeilen].sort(vergleich[ordnung]);
}

// --- Handgriffe und ihre Sperrgründe ---------------------------------------------------------------------------------------

export const HANDGRIFFE = [
    "uebernehmen",
    "sichten",
    "abschliessen",
    "wiedereroeffnen",
    "archivieren",
    "papierkorb",
    "wiederherstellen",
    "personenbezug",
    "notiz",
    "anMelder",
    "editor",
] as const;
export type Handgriff = (typeof HANDGRIFFE)[number];

/** Ein Handgriff: ob er in diesem Zustand überhaupt vorkommt, und, wenn er nicht geht, der Satz dazu (Guide §13.19). */
export interface HandgriffStand {
    readonly zeigen: boolean;
    readonly grund?: MessageKey | undefined;
}

export interface VorgangLage {
    readonly zeile: Pick<VorgangZeile, "zustand" | "zustaendig" | "art">;
    readonly papierkorb: boolean;
    readonly archiviert: boolean;
    readonly rueckwege: readonly string[];
    readonly entfernt: boolean;
    readonly bezug: Pick<NonNullable<VorgangDetail["bezug"]>, "art" | "objektArt" | "objektId"> | null;
}

/** Aus dem Detail die Lage, nach der die Handgriffe rechnen. */
export function lageVon(detail: VorgangDetail): VorgangLage {
    return {
        zeile: detail.zeile,
        papierkorb: detail.papierkorbAt !== null,
        archiviert: detail.archiviertAt !== null,
        rueckwege: detail.melder.rueckwege,
        entfernt: detail.melder.entfernt,
        bezug: detail.bezug,
    };
}

const hat = (rechte: readonly string[], recht: string): boolean => rechte.includes(recht);
const SPERRE_MODERIEREN = "community.redaktion.grund.moderieren" as const;

/** Das Werkzeug, das zu einer Objektart gehört (dieselbe Zuordnung wie „Im Objektverlauf zeigen“, `aenderungen/aenderung-modell.ts`). */
export const EDITOR_JE_OBJEKTART: Readonly<Record<BezugObjektart, string>> = {
    place: "ortseditor",
    path: "wegeditor",
    area: "landschaftseditor",
    territory: "gebietseditor",
    peak: "landschaftseditor",
    powerline: "kraftlinieneditor",
};

/**
 * Die Handgriffe eines Vorgangs in seiner Lage (Bedienkonzept §2.2 Nr. 4, §2.5, §2.6). `rechte` sind die der Sitzung (`moderate_submissions` ist für den Reiter ohnehin Voraussetzung),
 * `ich` die Kennung der Person (fehlt auf einer Instanz ohne Anmeldung).
 */
export function handgriffe(
    lage: VorgangLage,
    rechte: readonly string[],
    ich: string | undefined,
): Readonly<Record<Handgriff, HandgriffStand>> {
    const zu = lage.zeile.zustand === "abgeschlossen";
    const offen = !zu && !lage.papierkorb;
    const moderiert = hat(rechte, "moderate_community");
    const moderieren = (zeigen: boolean): HandgriffStand => ({
        zeigen,
        ...(moderiert ? {} : { grund: SPERRE_MODERIEREN }),
    });
    // Anfragen legt auch in den Papierkorb, wer nur `trash_mail` hat (Diplomat, WI-0279); Personenbezug löschen bleibt Moderation.
    const korb = (zeigen: boolean): HandgriffStand =>
        lage.zeile.art === "anfrage" && hat(rechte, "trash_mail") ? { zeigen } : moderieren(zeigen);
    const eigene = ich !== undefined && lage.zeile.zustaendig?.id === ich;
    const objekt = lage.bezug?.art === "objekt";
    let editor: HandgriffStand;
    if (!objekt) editor = { zeigen: false };
    else if (!hat(rechte, "edit_map_objects"))
        editor = { zeigen: true, grund: "community.redaktion.grund.editorRecht" };
    else if (lage.bezug?.objektArt == null || lage.bezug.objektId == null)
        editor = { zeigen: true, grund: "community.redaktion.grund.keinEditor" };
    else editor = { zeigen: true };
    let anMelder: HandgriffStand = { zeigen: true };
    if (lage.rueckwege.length === 0) anMelder = { zeigen: true, grund: "community.redaktion.grund.keinRueckweg" };
    else if (lage.papierkorb) anMelder = { zeigen: true, grund: "community.redaktion.grund.imPapierkorb" };
    else if (zu) anMelder = { zeigen: true, grund: "community.redaktion.grund.abgeschlossen" };
    return {
        uebernehmen: { zeigen: offen && !eigene },
        sichten: { zeigen: offen && lage.zeile.zustand === "neu" },
        abschliessen: { zeigen: offen },
        wiedereroeffnen: { zeigen: zu && !lage.papierkorb },
        archivieren: { zeigen: zu && !lage.archiviert && !lage.papierkorb },
        papierkorb: korb(!lage.papierkorb),
        wiederherstellen: korb(lage.papierkorb),
        personenbezug: moderieren(!lage.entfernt),
        notiz: { zeigen: true },
        anMelder,
        editor,
    };
}

/** Darf diese Person die Priorität und die Zuständigkeit noch ändern? Nur an Offenem; Abgeschlossenes und der Papierkorb zeigen sie als Text. */
export const stehtOffen = (lage: Pick<VorgangLage, "zeile" | "papierkorb">): boolean =>
    lage.zeile.zustand !== "abgeschlossen" && !lage.papierkorb;

/** Eine Person im Menü „Zuständig“. Jeder darf zuweisen und jeder kann empfangen (WI-0279, Vali 2026-11-11): kein Eintrag ist gesperrt. */
export interface ZustaendigWahl {
    /** `null`: niemand. */
    readonly person: CommunityPerson | null;
    readonly aktiv: boolean;
}

export function zustaendigWahlen(
    personen: readonly CommunityPerson[],
    aktuell: CommunityPerson | null,
    ich: string | undefined,
    /** Wer an der Stelle der Meldung Ansprechperson ist (WI-0279 E3c): direkt hinter „mir“, sonst in der Ordnung der Liste. */
    vorne: ReadonlySet<string> = new Set(),
): ZustaendigWahl[] {
    const mir = personen.find((person) => person.id === ich);
    const uebrige = personen.filter((person) => person.id !== ich);
    const andere = [
        ...uebrige.filter((person) => vorne.has(person.id)),
        ...uebrige.filter((person) => !vorne.has(person.id)),
    ];
    return [
        ...(mir === undefined ? [] : [{ person: mir, aktiv: aktuell?.id === mir.id } satisfies ZustaendigWahl]),
        ...andere.map((person): ZustaendigWahl => ({ person, aktiv: aktuell?.id === person.id })),
        { person: null, aktiv: aktuell === null },
    ];
}

// --- Sonderrollen im Vorgangsfenster (WI-0279) ---------------------------------------------------------------------------

/** Die Rollen im Blatt: alle zwölf in der Reihenfolge des Katalogs, je mit den Inhabern für diese Meldung. */
export function rollenBlattZeilen(
    detail: Pick<VorgangDetail, "rollenInhaber">,
): { sonderrolle: string; personen: CommunityPerson[] }[] {
    return SONDERROLLEN_NAMEN.map((sonderrolle) => ({
        sonderrolle,
        personen: detail.rollenInhaber?.find((zeile) => zeile.sonderrolle === sonderrolle)?.personen ?? [],
    }));
}

/**
 * Der Satz unten im Blatt: Wer neu in der Glocke hört (die Inhaber der neu gewählten Rollen außer mir), sonst der Hinweis auf „Meine“. Namen ohne Doppelte, in der Folge
 * der Rollen.
 */
export function rollenBlattFolge(
    detail: Pick<VorgangDetail, "rollen" | "rollenInhaber">,
    gewaehlt: readonly string[],
    ich: string | undefined,
): string {
    const bisher = new Set((detail.rollen ?? []).map((rolle) => rolle.sonderrolle));
    const namen = new Map<string, string>();
    for (const zeile of rollenBlattZeilen(detail)) {
        if (!gewaehlt.includes(zeile.sonderrolle) || bisher.has(zeile.sonderrolle)) continue;
        for (const person of zeile.personen) if (person.id !== ich) namen.set(person.id, person.name);
    }
    return namen.size === 0
        ? t("community.redaktion.rollen.meine")
        : t("community.redaktion.rollen.glocke", { namen: formatList([...namen.values()]) });
}

/** Hat sich die Wahl im Blatt gegen die gesetzten Rollen geändert? Ohne Änderung bleibt „Zuweisen“ gesperrt. */
export const rollenGeaendert = (detail: Pick<VorgangDetail, "rollen">, gewaehlt: readonly string[]): boolean => {
    const bisher = new Set((detail.rollen ?? []).map((rolle) => rolle.sonderrolle));
    return gewaehlt.length !== bisher.size || gewaehlt.some((rolle) => !bisher.has(rolle));
};

/** Eine Zeile im Kasten „Zuständig“. `mein` steht in Gold (die eigene Person, eine eigene Rolle). */
export interface ZustaendigZeile {
    readonly key: string;
    readonly art: "person" | "rolle";
    /** Bei der Person ihr Name, bei einer Rolle der Name mit Region („Ortskundiger (Weiden)“). */
    readonly titel: string;
    /** Bei einer Rolle: wer sie hat, oder „noch niemand in dieser Rolle“. */
    readonly inhaber?: readonly { readonly name: string; readonly mein: boolean }[];
    readonly mein: boolean;
    /** „zugewiesen von Vali, vor 2 Stunden“, „selbst übernommen, …“, „zugewiesen von Avesmaps beim Eingang, …“. */
    readonly von: string;
}

/** Der Kasten „Zuständig“ (WI-0279, Entwurf „Meldungen an Rollen“): eine Zeile für die Person, eine je Rolle; ohne jede Zuweisung keine. */
export function zustaendigZeilen(
    detail: Pick<VorgangDetail, "zeile" | "zustaendigSeit" | "rollen">,
    ich: string | undefined,
    jetzt: Date = new Date(),
): ZustaendigZeile[] {
    const wann = (iso: string): string => zeitAbstand(iso, jetzt);
    const zeilen: ZustaendigZeile[] = [];
    const person = detail.zeile.zustaendig;
    if (person !== null) {
        const seit = detail.zustaendigSeit;
        const von =
            seit === undefined || seit === null
                ? ""
                : seit.von?.id === person.id
                  ? t("community.redaktion.zustaendig.selbst", { zeit: wann(seit.at) })
                  : t("community.redaktion.zustaendig.von", {
                        wer: seit.von?.name ?? t("community.redaktion.ereignis.jemand"),
                        zeit: wann(seit.at),
                    });
        zeilen.push({
            key: `person-${person.id}`,
            art: "person",
            titel: person.name,
            mein: ich !== undefined && person.id === ich,
            von,
        });
    }
    for (const rolle of detail.rollen ?? []) {
        const name = rolleName(rolle.sonderrolle);
        const inhaber = rolle.inhaber.map((p) => ({ name: p.name, mein: ich !== undefined && p.id === ich }));
        zeilen.push({
            key: `rolle-${rolle.sonderrolle}`,
            art: "rolle",
            titel:
                rolle.regionen.length === 0
                    ? name
                    : t("auth.sonderrolle.mitRegionen", { name, regionen: rolle.regionen.join(", ") }),
            inhaber,
            mein: inhaber.some((p) => p.mein),
            von:
                rolle.von.art === "system"
                    ? t("community.redaktion.zustaendig.eingang", { zeit: wann(rolle.at) })
                    : t("community.redaktion.zustaendig.von", {
                          wer: rolle.von.person?.name ?? t("community.redaktion.ereignis.jemand"),
                          zeit: wann(rolle.at),
                      }),
        });
    }
    return zeilen;
}

// --- Abschließen -----------------------------------------------------------------------------------------------------------

/** Was „Abschließen …“ anbietet und vorbelegt (Bedienkonzept §2.5, Fachkonzept §4.3). */
export interface AbschlussEntwurf {
    readonly ergebnis: CommunityErgebnis;
    readonly begruendung: string;
    readonly nachrichtSenden: boolean;
    readonly nachricht: string;
    /** Nur bei `dublette`: die Nummer des anderen Vorgangs. */
    readonly dubletteVon: string;
}

/** Der vorbelegte Text der Abschlussnachricht je Ergebnis (Sinn: Fachkonzept §4.3); leer, wo es keine gibt. */
export function abschlussNachricht(ergebnis: CommunityErgebnis, dubletteVon = ""): string {
    const nummer = leseCom(dubletteVon);
    switch (ergebnis) {
        case "umgesetzt":
        case "bereits_richtig":
        case "abgelehnt":
        case "weitergereicht":
            return t(`community.redaktion.abschluss.text.${ergebnis}`);
        case "dublette":
            return nummer === undefined
                ? t("community.redaktion.abschluss.text.dublette")
                : t("community.redaktion.abschluss.text.dubletteNr", { nummer: nummerText(nummer) });
        default:
            return "";
    }
}

const nummerText = (id: number): string => `COM-${String(id).padStart(6, "0")}`;

/** Das Ergebnis, mit dem das Blatt beginnt: „umgesetzt“, wenn eine Korrektur verknüpft ist, sonst das erste der Art. */
export function erstesErgebnis(art: CommunityArt, ergebnisse: readonly CommunityErgebnis[]): CommunityErgebnis {
    const vorgabe = art === "meldung" ? "umgesetzt" : "beantwortet";
    return ergebnisse.includes(vorgabe) ? vorgabe : (ergebnisse[0] ?? "erledigt");
}

export function neuerAbschluss(
    art: CommunityArt,
    ergebnisse: readonly CommunityErgebnis[],
    rueckwege: readonly string[],
): AbschlussEntwurf {
    const ergebnis = erstesErgebnis(art, ergebnisse);
    return {
        ergebnis,
        begruendung: "",
        nachrichtSenden: rueckwege.length > 0,
        nachricht: abschlussNachricht(ergebnis),
        dubletteVon: "",
    };
}

/** Wechselt das Ergebnis, folgt der vorbelegte Text; was jemand selbst geschrieben hat, bleibt (nur ein unverändert vorbelegter Text wird getauscht). */
export function mitErgebnis(
    entwurf: AbschlussEntwurf,
    ergebnis: CommunityErgebnis,
    dubletteVon = entwurf.dubletteVon,
): AbschlussEntwurf {
    const unveraendert = entwurf.nachricht === abschlussNachricht(entwurf.ergebnis, entwurf.dubletteVon);
    return {
        ...entwurf,
        ergebnis,
        dubletteVon,
        nachricht: unveraendert ? abschlussNachricht(ergebnis, dubletteVon) : entwurf.nachricht,
    };
}

/** Wechselt die Nummer der Dublette, folgt der vorbelegte Text; die Begründung wird „Dublette von COM-…“, solange sie leer oder so vorbelegt war. */
export function mitDublette(entwurf: AbschlussEntwurf, nummer: string): AbschlussEntwurf {
    const alt = leseCom(entwurf.dubletteVon);
    const neu = leseCom(nummer);
    const vorgabe = (id: number | undefined): string =>
        id === undefined ? "" : t("community.redaktion.abschluss.begruendung.dublette", { nummer: nummerText(id) });
    const begruendungFrei = entwurf.begruendung === "" || entwurf.begruendung === vorgabe(alt);
    return {
        ...mitErgebnis(entwurf, entwurf.ergebnis, nummer),
        begruendung: begruendungFrei ? vorgabe(neu) : entwurf.begruendung,
    };
}

/** Warum „Abschließen“ noch nicht geht (Guide §13.19), oder `undefined`: die Begründung ist Pflicht (Fachkonzept §4.3), bei einer Dublette die Nummer. */
export function abschlussSperre(entwurf: AbschlussEntwurf, eigeneNummer: string): MessageKey | undefined {
    if (entwurf.begruendung.trim() === "") return "community.redaktion.grund.begruendung";
    if (entwurf.ergebnis === "dublette") {
        const andere = leseCom(entwurf.dubletteVon);
        if (andere === undefined) return "community.redaktion.grund.dubletteNummer";
        if (andere === leseCom(eigeneNummer)) return "community.redaktion.grund.dubletteSelbst";
    }
    if (entwurf.nachrichtSenden && entwurf.nachricht.trim() === "") return "community.redaktion.grund.nachrichtLeer";
    return undefined;
}

/**
 * Warum „Abschließen“ noch nicht geht, als fertiger Satz (WI-0291): zusätzlich zu `abschlussSperre` die Grenzen des Servers (Begründung 2000, Nachricht 4000 Zeichen, in Codepunkten gezählt wie dort),
 * damit der Knopf nicht angeboten wird, den der Server ohnehin ablehnt. `undefined`: es geht.
 */
export function abschlussSperrSatz(entwurf: AbschlussEntwurf, eigeneNummer: string): string | undefined {
    const key = abschlussSperre(entwurf, eigeneNummer);
    if (key !== undefined) return t(key);
    return (
        zuLangSatz("begruendung", entwurf.begruendung, COMMUNITY_GRENZEN.begruendungMax) ??
        (entwurf.nachrichtSenden
            ? zuLangSatz("nachricht", entwurf.nachricht, COMMUNITY_GRENZEN.nachrichtMax)
            : undefined)
    );
}

/** Warum „Wieder öffnen“ noch nicht geht: der Grund fehlt oder ist länger, als der Server nimmt (2000 Zeichen). `undefined`: es geht. */
export function wiedereroeffnenSperrSatz(grund: string): string | undefined {
    if (grund.trim() === "") return t("community.redaktion.grund.grundFehlt");
    return zuLangSatz("grund", grund, COMMUNITY_GRENZEN.begruendungMax);
}

// --- Verlauf in Alltagssprache ---------------------------------------------------------------------------------------------

/** Eine Zeile des Verlaufs, wie das Fenster sie zeichnet (Bedienkonzept §2.2 Nr. 4). */
export type VerlaufZeile =
    | {
          readonly art: "nachricht";
          readonly key: string;
          /** Vom Melder oder an den Melder. */
          readonly richtung: "ein" | "aus";
          readonly text: string | null;
          readonly von: string | undefined;
          readonly weg: string;
          readonly at: string;
          /** Bei einer Mail (WI-0268 C6a): die Kennung der Nachricht und ihr Zustellstand. */
          readonly id?: number;
          readonly zustellung?: MailZustellstand;
          /** Bei einer eingehenden Mail (WI-0268 C6b): Betreff, bereinigtes HTML, Anhänge. */
          readonly mail?: MailInhalt;
      }
    | {
          readonly art: "notiz";
          readonly key: string;
          readonly text: string;
          readonly von: string | undefined;
          readonly at: string;
      }
    | {
          readonly art: "ereignis";
          readonly key: string;
          readonly satz: string;
          /** Die Begründung oder der Grund, falls das Ereignis eine trägt (intern). */
          readonly text: string | undefined;
          readonly at: string;
      };

/**
 * `name`: wie eine Kennung der Zuständigkeit zu einem Namen wird (die Liste der Personen). `art`: Bei einer Anfrage (WI-0268 C4) heißen die Ereignisse der Antwort anders als bei einer Meldung („Antwort
 * gesendet“ statt „Rückfrage gesendet“, „zurück in den Eingang geholt“ statt „wieder geöffnet“).
 */
export function verlaufZeilen(
    verlauf: readonly VerlaufEintrag[],
    name: (id: string | null) => string | undefined,
    art: CommunityArt = "meldung",
): VerlaufZeile[] {
    const zeilen: VerlaufZeile[] = [];
    verlauf.forEach((eintrag, index) => {
        const key = `${eintrag.art}-${String(index)}`;
        if (eintrag.art === "nachricht") {
            zeilen.push({
                art: "nachricht",
                key,
                richtung: eintrag.richtung,
                text: eintrag.text,
                von: eintrag.von?.name,
                weg: eintrag.weg,
                at: eintrag.at,
                ...(eintrag.id === undefined ? {} : { id: eintrag.id }),
                ...(eintrag.zustellung === undefined ? {} : { zustellung: eintrag.zustellung }),
                ...(eintrag.mail === undefined ? {} : { mail: eintrag.mail }),
            });
            return;
        }
        if (eintrag.art === "notiz") {
            zeilen.push({ art: "notiz", key, text: eintrag.text, von: eintrag.von?.name, at: eintrag.at });
            return;
        }
        // Sonderrollen (WI-0279): eine Zeile je Änderung, hinzu und heraus getrennt.
        if (eintrag.ereignis === "rollen" || eintrag.ereignis === "rollen_eingang") {
            for (const [i, satz] of rollenSaetze(eintrag).entries()) {
                zeilen.push({ art: "ereignis", key: `${key}-${String(i)}`, satz, text: undefined, at: eintrag.at });
            }
            return;
        }
        const satz = ereignisSatz(eintrag, name, art);
        if (satz === undefined) return;
        const text = ereignisText(eintrag);
        zeilen.push({ art: "ereignis", key, satz, text, at: eintrag.at });
    });
    return zeilen;
}

type Ereignis = Extract<VerlaufEintrag, { art: "ereignis" }>;

/** Das Ereignis als kurzer Satz mit dem Namen dahinter („gesichtet · Vali“); `eingang` fehlt, denn die Meldung steht selbst im Verlauf. */
function ereignisSatz(
    e: Ereignis,
    name: (id: string | null) => string | undefined,
    art: CommunityArt,
): string | undefined {
    const wer = e.vomMelder ? undefined : e.von?.name;
    const mit = (satz: string): string => (wer === undefined ? satz : `${satz} · ${wer}`);
    switch (e.ereignis) {
        case "eingang":
            return undefined;
        case "gesichtet":
            return mit(t("community.redaktion.ereignis.gesichtet"));
        case "uebernommen":
            return mit(t("community.redaktion.ereignis.uebernommen"));
        case "zustaendig": {
            const neu = e.neu === null ? undefined : (name(e.neu) ?? t("community.redaktion.ereignis.jemand"));
            return mit(
                neu === undefined
                    ? t("community.redaktion.ereignis.zustaendigLeer")
                    : t("community.redaktion.ereignis.zustaendig", { name: neu }),
            );
        }
        case "prioritaet":
            return mit(t("community.redaktion.ereignis.prioritaet", { prioritaet: prioritaetName(e.neu ?? "") }));
        case "rueckfrage":
            return mit(
                t(art === "anfrage" ? "community.mails.ereignis.antwort" : "community.redaktion.ereignis.rueckfrage"),
            );
        case "antwort":
            return t(
                art === "anfrage" ? "community.mails.ereignis.antwortAbsender" : "community.redaktion.ereignis.antwort",
            );
        case "abgeschlossen":
            return mit(t("community.redaktion.ereignis.abgeschlossen", { ergebnis: ergebnisName(e.neu) }));
        case "wiedereroeffnet":
            // Eine neue Mail im Faden (Mailabruf, WI-0268 C6b) trägt den festen Text der Datenbank; sie heißt „durch neue Nachricht“.
            return e.vomMelder
                ? t(
                      e.text === MAIL_WIEDER_GEOEFFNET
                          ? "community.mails.ereignis.durchNachricht"
                          : "community.redaktion.ereignis.durchAntwort",
                  )
                : mit(
                      t(
                          art === "anfrage"
                              ? "community.mails.ereignis.zurueck"
                              : "community.redaktion.ereignis.wiedereroeffnet",
                      ),
                  );
        case "papierkorb":
            return mit(t("community.redaktion.ereignis.papierkorb"));
        case "wiederhergestellt":
            return mit(t("community.redaktion.ereignis.wiederhergestellt"));
        case "archiviert":
            return mit(t("community.redaktion.ereignis.archiviert"));
        case "zurueckgezogen":
            return t(
                art === "anfrage"
                    ? "community.mails.ereignis.zurueckgezogen"
                    : "community.redaktion.ereignis.zurueckgezogen",
            );
        case "personenbezug_geloescht":
            return mit(t("community.redaktion.ereignis.personenbezug"));
        case "kontakt_abgelaufen":
            return t("community.redaktion.ereignis.kontaktAbgelaufen");
        default:
            return mit(e.ereignis);
    }
}

/** Die Rollen eines Ereignisses (`derograph,odologe`) in Alltagssprache: „Derograph und Odologe“, in der Folge des Katalogs. */
const rollenListe = (text: string | null): string | undefined => {
    const rollen = rollenGeordnet((text ?? "").split(",").map((rolle) => rolle.trim()));
    return rollen.length === 0 ? undefined : formatList(rollen.map((rolle) => rolleName(rolle)));
};

/** „Derograph und Topograph zugewiesen · Vali“, „Odologe herausgenommen · Vali“, „Ortskundiger zugewiesen beim Eingang · Avesmaps“. */
function rollenSaetze(e: Ereignis): string[] {
    const hinzu = rollenListe(e.neu);
    if (e.ereignis === "rollen_eingang") {
        return hinzu === undefined
            ? []
            : [
                  `${t("community.redaktion.ereignis.rollenEingang", { rollen: hinzu })} · ${t("community.redaktion.avesmaps")}`,
              ];
    }
    const wer = e.von?.name ?? t("community.redaktion.ereignis.jemand");
    const heraus = rollenListe(e.alt);
    return [
        ...(hinzu === undefined ? [] : [`${t("community.redaktion.ereignis.rollenZu", { rollen: hinzu })} · ${wer}`]),
        ...(heraus === undefined
            ? []
            : [`${t("community.redaktion.ereignis.rollenHeraus", { rollen: heraus })} · ${wer}`]),
    ];
}

/** Nur Abschließen und Wiedereröffnen tragen einen Text (Begründung, Grund); bei der Antwort des Melders ist es die feste Zeile des Servers, die hier nichts zu sagen hat. */
function ereignisText(e: Ereignis): string | undefined {
    if (e.vomMelder) return undefined;
    return e.ereignis === "abgeschlossen" || e.ereignis === "wiedereroeffnet" ? (e.text ?? undefined) : undefined;
}

/** Der Name der Person zu einer Kennung, aus der Liste der Personen. */
export const personenName =
    (personen: readonly CommunityPerson[]) =>
    (id: string | null): string | undefined =>
        id === null ? undefined : personen.find((person) => person.id === id)?.name;
