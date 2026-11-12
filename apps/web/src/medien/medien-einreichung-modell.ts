import {
    HEADER_GRAPHICS,
    HEADER_GRAPHIC_LABELS,
    MAM_EINREICHUNGEN,
    PHOTOBOX_LIMITS,
    PHOTOBOX_NACHRICHT_MAX,
    type HeaderGraphic,
    type MamEinreichung,
    type MamNavigation,
    type MediaAssetDetail,
    type MediaUsageResult,
    type PhotoboxRedaktionKorrigieren,
    type PhotoboxSubmissionState,
    type PhotoboxSubmissionView,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, t } from "../i18n/i18n";
import { ZUSTAND_TEXT } from "../photobox/status-modell";
import { BLICK_RICHTUNGEN } from "../photobox/stelle-text";
import type { FeldZeile } from "./medien-inspektor-modell";
import { datumZeit } from "./medien-text";

/**
 * Was der Inspector der Medienverwaltung zu einer Einreichung eines Besuchers zeigt und tut (WI-0272 S3, Aufgabe 18), als Daten: welche Kästen, welche
 * Knöpfe mit welchem Recht, was eine Freigabe bewirkt und was in einer Korrektur geändert ist. Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * - 🔴 **Die Knöpfe stehen nach Recht und Zustand**: ohne `moderate_submissions` gibt es keinen Knopf des Prüfens, ohne `publish_media` kein „Offline nehmen“
 *   (ein Reviewer sieht es nicht). Was der Zustand nicht erlaubt, steht gesperrt mit seinem Satz da (Guide §7); der Server prüft jede Operation ohnehin selbst
 *   (`photobox/redaktion.ts`: aus `pending` und `changes_requested` freigeben, fragen, ablehnen; nach der Freigabe nur die wartende Beschreibung und die Beschreibung).
 * - **Die Kästen gibt es nur bei einer Einreichung** (`einreichungVon`): ein Asset ohne `submission` bleibt der gewöhnliche Inspector.
 */

export interface EinreichungRechte {
    /** Freigeben, Rückfrage, Ablehnen, Korrigieren (`moderate_submissions`, ab Reviewer). */
    moderieren: boolean;
    /** Eine freigegebene Einreichung offline nehmen (`publish_media`, ab Editor). */
    offlineNehmen: boolean;
}

export function einreichungRechte(faehigkeiten: readonly string[]): EinreichungRechte {
    return {
        moderieren: faehigkeiten.includes("moderate_submissions") || faehigkeiten.includes("moderate_photobox"),
        offlineNehmen: faehigkeiten.includes("publish_media"),
    };
}

/** Die Einreichung hinter dem Asset, wenn es eine hat; sonst `undefined`, und der Inspector zeigt keinen der Kästen. */
export function einreichungVon(
    detail: Pick<MediaAssetDetail, "submission"> | undefined,
): PhotoboxSubmissionView | undefined {
    return detail?.submission;
}

// --- Der Zustand in Worten -----------------------------------------------------------------------------------------------------------------

/**
 * Der Zustand der Einreichung für die Redaktion: die Worte der Statusseite (`ZUSTAND_TEXT`: „Eingegangen“, „In Prüfung“, „Rückfrage“ …), nur die Freigabe heißt hier
 * „Freigegeben“. Der Einsender liest „Veröffentlicht“; ob das Bild wirklich öffentlich ist, sagt in der Medienverwaltung die Pille „öffentlich“ und die Zeile der
 * Veröffentlichung (es kann auf die Freigaberegel warten), und beides soll sich nicht widersprechen.
 */
export const zustandName = (zustand: PhotoboxSubmissionState): string =>
    zustand === "approved" ? t("medien.einreichung.freigegeben") : t(ZUSTAND_TEXT[zustand]);

// --- Prüfen ---------------------------------------------------------------------------------------------------------------------------------

export type EinreichungAktion = "freigeben" | "uebernehmen" | "rueckfrage" | "ablehnen" | "korrigieren";

export interface EinreichungKnopf {
    aktion: EinreichungAktion;
    /** Der Satz, warum der Knopf gerade nicht geht (Schlüssel der Sprachtafel); gesetzt heißt gesperrt. */
    gesperrt?: MessageKey;
}

/** Zustände, in denen der Kasten „Prüfen“ steht: noch nicht entschieden, oder freigegeben (dort nur die Beschreibung). */
const PRUEFBAR: readonly PhotoboxSubmissionState[] = [
    "incoming",
    "technical_failed",
    "pending",
    "changes_requested",
    "approved",
];

/** Entschieden und abgeschlossen: kein Kasten „Prüfen“, kein „Nach der Freigabe“. */
export const zeigtPruefen = (s: Pick<PhotoboxSubmissionView, "zustand">): boolean => PRUEFBAR.includes(s.zustand);

/** Der Kasten „Nach der Freigabe“ erklärt, was eine Freigabe tut oder getan hat: nur, solange die Einreichung nicht abgelehnt oder beendet ist. */
export const zeigtNachFreigabe = (s: Pick<PhotoboxSubmissionView, "zustand">): boolean => zeigtPruefen(s);

/**
 * Entschieden und abgeschlossen (offline, zurückgezogen, abgelehnt, verfallen, geleert): Dort steht statt der beiden Kästen der kleine Kasten „Abgeschlossen“ mit dem
 * Zustand und „Endgültig löschen …“, damit das Löschen am Bild steht und nicht nur unten unter „Handlungen“ (Entwurf „Eingänge“ Fassung 2, Vali 2026-11-08: „bevor du die
 * funktion irgendwo wieder versteckst“). Ohne `delete_media` fällt der Kasten weg.
 */
export const zeigtAbgeschlossen = (s: Pick<PhotoboxSubmissionView, "zustand">): boolean => !zeigtPruefen(s);

/**
 * Die Knöpfe des Kastens „Prüfen“ in ihrer Reihenfolge. Ohne das Recht keiner. Vor der technischen Prüfung und nach einem Fehler der Datei stehen alle vier
 * gesperrt mit ihrem Grund (der Server nähme sie mit 409 `photobox_transition` nicht an); nach der Freigabe gibt es nur „Neue Beschreibung übernehmen“ (wenn eine
 * wartet) und „Korrigieren“ (nur die Beschreibung).
 */
export function pruefKnoepfe(
    s: Pick<PhotoboxSubmissionView, "zustand" | "wartendeBeschreibung">,
    rechte: EinreichungRechte,
): EinreichungKnopf[] {
    if (!rechte.moderieren) return [];
    switch (s.zustand) {
        case "incoming":
            return (["freigeben", "rueckfrage", "ablehnen", "korrigieren"] as const).map((aktion) => ({
                aktion,
                gesperrt: "medien.einreichung.gesperrt.datei",
            }));
        case "technical_failed":
            return (["freigeben", "rueckfrage", "ablehnen", "korrigieren"] as const).map((aktion) => ({
                aktion,
                gesperrt: "medien.einreichung.gesperrt.fehler",
            }));
        case "pending":
        case "changes_requested":
            return [
                { aktion: "freigeben" },
                { aktion: "rueckfrage" },
                { aktion: "ablehnen" },
                { aktion: "korrigieren" },
            ];
        case "approved":
            return [
                ...(s.wartendeBeschreibung === undefined ? [] : [{ aktion: "uebernehmen" as const }]),
                { aktion: "korrigieren" },
            ];
        default:
            return [];
    }
}

/** Darf diese Sitzung die freigegebene Einreichung offline nehmen? Nur ab `publish_media`, und nur eine freigegebene. */
export const darfOffline = (s: Pick<PhotoboxSubmissionView, "zustand">, rechte: EinreichungRechte): boolean =>
    rechte.offlineNehmen && s.zustand === "approved";

/**
 * Darf diese Sitzung die freigegebene Einreichung erneut zur Prüfung stellen (Vali 2026-11-09)? Wer prüfen darf (`moderate_submissions`), und nur eine freigegebene:
 * Sie wird wieder offen, verschwindet aus Kopf, Karte und Leiste und steht wieder im Eingang. Anders als „Offline nehmen“ endet nichts.
 */
export const darfErneutPruefen = (s: Pick<PhotoboxSubmissionView, "zustand">, rechte: EinreichungRechte): boolean =>
    rechte.moderieren && s.zustand === "approved";

/** Das Zeichen je Knopf: abstrakt, nie ein Bildsymbol (Editor-Stil, AGENTS.md „Editor: abstrakte Zeichen“). */
export const AKTION_ZEICHEN: Readonly<Record<EinreichungAktion | "offline" | "erneut", string>> = {
    freigeben: "●",
    uebernehmen: "●",
    rueckfrage: "↺",
    ablehnen: "✕",
    korrigieren: "⊙",
    offline: "—",
    // Wieder offen: der leere Kreis gegen den vollen der Freigabe.
    erneut: "○",
};

/** Die Datei in Worten, für den ersten Punkt des Kastens „Prüfen“ (aus `technical_state`, nie von Hand). */
export function dateiStand(technik: MediaAssetDetail["asset"]["technicalState"]): "geprueft" | "wartet" | "fehler" {
    if (technik === "ok") return "geprueft";
    return technik === "pending" ? "wartet" : "fehler";
}

// --- Rückfrage und Ablehnung: der Text -----------------------------------------------------------------------------------------------------

export { PHOTOBOX_NACHRICHT_MAX as NACHRICHT_MAX };

/** Was an einer Rückfrage oder einem Ablehnungsgrund nicht stimmt (Schlüssel der Sprachtafel); `undefined`, wenn er so abgeschickt werden darf. */
export function nachrichtFehler(text: string): MessageKey | undefined {
    const kurz = text.trim();
    if (kurz === "") return "medien.einreichung.nachricht.leer";
    return [...kurz].length > PHOTOBOX_NACHRICHT_MAX ? "medien.einreichung.nachricht.lang" : undefined;
}

// --- Nach der Freigabe ------------------------------------------------------------------------------------------------------------------------

export type Wirkung =
    | { fall: "ortsansicht"; ort: string }
    | { fall: "typbild"; ort: string; typ: HeaderGraphic | undefined }
    | { fall: "ohneOrt" };

const bekannteArt = (typ: string | undefined): HeaderGraphic | undefined =>
    typ !== undefined && (HEADER_GRAPHICS as readonly string[]).includes(typ) ? (typ as HeaderGraphic) : undefined;

/**
 * Was die Freigabe mit dem Reisebild macht (WI-0272 §12): an einem Ort mit Ortsansicht reiht es sich dahinter ein, an einem Ort ohne hinter das Typbild (Vali 2026-11-09: es ersetzt es nicht mehr),
 * ohne Ort erscheint es an der Stelle auf der Karte und in der Leiste. Ob der Ort eine Ortsansicht hat, sagt der Server aus der Logik des Ortskopfs
 * (`ortHatOrtsansicht`); fehlt die Angabe, gilt der vorsichtige Fall (Typbild), nie eine erfundene Ortsansicht.
 */
export function wirkungNachFreigabe(s: Pick<PhotoboxSubmissionView, "ort" | "ortHatOrtsansicht">): Wirkung {
    if (s.ort === undefined) return { fall: "ohneOrt" };
    if (s.ortHatOrtsansicht === true) return { fall: "ortsansicht", ort: s.ort.name };
    return { fall: "typbild", ort: s.ort.name, typ: bekannteArt(s.ort.typ) };
}

/**
 * Der Name einer Typbild-Kategorie in der Sprache der Oberfläche (Review S3 M8): Die Kategorien der Orte sind die Ortsarten, und die haben ihren Namen in den Sprachtafeln (`place.<art>`: Dorf, Village,
 * Village …). Was keine Ortsart ist, hat dort keinen Namen und bleibt bei dem deutschen der Kategorie (`HEADER_GRAPHIC_LABELS`, der Name der Medienverwaltung „Typbilder“); der Satz nennt aber
 * nur das Typbild eines ORTES, also immer eine Ortsart.
 */
export function typbildName(typ: HeaderGraphic): string {
    const key = `place.${typ}`;
    return isMessageKey(key) ? t(key) : HEADER_GRAPHIC_LABELS[typ];
}

export function wirkungText(wirkung: Wirkung): string {
    switch (wirkung.fall) {
        case "ortsansicht":
            return t("medien.einreichung.wirkung.ortsansicht", { ort: wirkung.ort });
        case "typbild":
            return wirkung.typ === undefined
                ? t("medien.einreichung.wirkung.typbildOhneArt", { ort: wirkung.ort })
                : t("medien.einreichung.wirkung.typbild", {
                      ort: wirkung.ort,
                      art: typbildName(wirkung.typ),
                  });
        case "ohneOrt":
            return t("medien.einreichung.wirkung.ohneOrt");
    }
}

/** Zeigt der Kasten „Nach der Freigabe“ das Typbild neben dem Reisebild? Nur dort, wo das Reisebild sich dahinter einreiht, und nur mit bekannter Art. */
export const zeigtTypbildVorschau = (
    wirkung: Wirkung,
): wirkung is Extract<Wirkung, { fall: "typbild" }> & { typ: HeaderGraphic } =>
    wirkung.fall === "typbild" && wirkung.typ !== undefined;

/**
 * Warum ein Grund der Entscheidung (`decidePublication`) die FEHLENDE Freigaberegel meint: Die Rechtelage trägt nicht von selbst, und keine Regel und keine
 * Einzelfreigabe deckt sie. Eine Erlaubnis („nur für Avesmaps“) und CC BY mit Namensnennung kommen so bei jedem Reisebild an, solange es keine Regel der Rolle gibt.
 */
const FEHLENDE_REGEL = [
    "permission_needs_approval",
    "attribution_required",
    "fan_policy_needs_approval",
    "clearance_pending",
] as const;

export interface Veroeffentlichung {
    oeffentlich: boolean;
    /** Der Grund ist die fehlende Freigaberegel: Die Zeile sagt dann „wartet auf die Freigaberegel“. */
    wartetAufRegel: boolean;
    text: string;
}

/**
 * Die Veröffentlichung der Einreichung, wie der Inspector sie schon für jedes Asset zeigt (`freigabeSatz`), für die Verwendung der Rolle `photobox`. Ohne diese
 * Verwendung (nicht freigegeben, oder zurückgenommen) gibt es keine Zeile.
 */
export function veroeffentlichung(verwendung: MediaUsageResult | undefined): Veroeffentlichung | undefined {
    const nutzung = verwendung?.usages.find((eintrag) => eintrag.role === "photobox" && eintrag.publication !== null);
    const entscheidung = nutzung?.publication;
    if (entscheidung === null || entscheidung === undefined) return undefined;
    if (entscheidung.public) {
        return { oeffentlich: true, wartetAufRegel: false, text: t("medien.einreichung.oeffentlich") };
    }
    const wartet = (FEHLENDE_REGEL as readonly string[]).includes(entscheidung.reason);
    return {
        oeffentlich: false,
        wartetAufRegel: wartet,
        text: wartet
            ? t("medien.einreichung.wartetAufRegel")
            : t("medien.freigabe.nein", { grund: t(`medien.grund.${entscheidung.reason}` as MessageKey) }),
    };
}

// --- Angaben des Einsenders --------------------------------------------------------------------------------------------------------------------

const nr = (wert: number): string => String(Math.round(wert * 10) / 10);

/**
 * Die Angaben des Einsenders als Feldzeilen: Beschreibung und die wartende, Entstehung, Nutzung, Blickrichtung, Name, Stelle, Ort, Bezug, Fassung der Bedingungen,
 * eingereicht am und „von der Redaktion angepasst“. Eine Angabe, die es nicht gibt, steht als „ohne …“ da: Ein leeres Feld des Besuchers ist eine Auskunft, kein Loch.
 *
 * 🔴 Alles hier ist PRIVAT (`MEDIA_PRIVATE_FIELDS.MediaAssetDetail`: `submission`; der Name des Einsenders steht nur in der Medienverwaltung). Die Marke „intern“ steht
 * deshalb EINMAL am Kasten (`medien-kasten-einreichung.vue`), nicht an jeder der dreizehn Zeilen.
 */
export function angabenZeilen(s: PhotoboxSubmissionView): FeldZeile[] {
    const zeile = (id: string, label: MessageKey, wert: string, ton?: FeldZeile["ton"]): FeldZeile => ({
        id,
        label: t(label),
        wert,
        intern: false,
        ...(ton === undefined ? {} : { ton }),
    });
    const blick =
        s.blickrichtung === undefined
            ? t("medien.einreichung.ohne")
            : t(`photobox.blick.wahl.${BLICK_RICHTUNGEN[s.blickrichtung] ?? BLICK_RICHTUNGEN[0]}` as MessageKey);
    return [
        zeile("beschreibung", "medien.einreichung.angabe.beschreibung", s.beschreibung),
        ...(s.wartendeBeschreibung === undefined
            ? []
            : [zeile("wartend", "medien.einreichung.angabe.wartend", s.wartendeBeschreibung, "warnung")]),
        ...(s.nachricht === undefined ? [] : [zeile("nachricht", "medien.einreichung.angabe.nachricht", s.nachricht)]),
        zeile(
            "entstehung",
            "medien.einreichung.angabe.entstehung",
            t(`photobox.entstehung.${s.entstehung}` as MessageKey),
        ),
        zeile("nutzung", "medien.einreichung.angabe.nutzung", t(`photobox.nutzung.${s.nutzung}` as MessageKey)),
        zeile("blick", "medien.einreichung.angabe.blick", blick),
        zeile("name", "medien.einreichung.angabe.name", s.name ?? t("medien.einreichung.ohneName")),
        zeile("stelle", "medien.einreichung.angabe.stelle", `${nr(s.lage.x)} / ${nr(s.lage.y)}`),
        zeile("ort", "medien.einreichung.angabe.ort", s.ort?.name ?? t("medien.einreichung.ohne")),
        zeile(
            "bezug",
            "medien.einreichung.angabe.bezug",
            s.bezug === undefined ? t("medien.einreichung.ohne") : bezugText(s.bezug),
        ),
        zeile("bedingungen", "medien.einreichung.angabe.bedingungen", s.bedingungen),
        zeile("eingereicht", "medien.einreichung.angabe.eingereicht", datumZeit(s.eingereichtAm)),
        zeile(
            "angepasst",
            "medien.einreichung.angabe.angepasst",
            t(s.angepasst ? "medien.einreichung.ja" : "medien.einreichung.nein"),
            s.angepasst ? "warnung" : undefined,
        ),
    ];
}

/** Der Bezug in Worten: seine Art und sein Schlüssel (der Name steht nicht in der Einreichung); ein Weg heißt `name:<Name>`. */
export function bezugText(bezug: NonNullable<PhotoboxSubmissionView["bezug"]>): string {
    const art = t(`medien.einreichung.bezugArt.${bezug.art}` as MessageKey);
    const schluessel = bezug.id.replace(/^name:/, "");
    return `${art}: ${schluessel}`;
}

// --- Korrigieren -----------------------------------------------------------------------------------------------------------------------------

/** Was in der Korrektur eingetragen ist (der Stand des Formulars, nicht der Anfrage). */
export interface KorrekturEingabe {
    beschreibung: string;
    /** Die gewählte Stelle; `undefined`, solange sie nicht angefasst ist. */
    lage: { x: number; y: number } | undefined;
    /** Ort und Bezug als Wahl; `undefined` heißt „nicht angefasst“, `null` „entfernt“. */
    ort: { publicId: string; name: string } | null | undefined;
    bezug: { art: NonNullable<PhotoboxSubmissionView["bezug"]>["art"]; id: string; name: string } | null | undefined;
}

const gleicheLage = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y;

const OEFFENTLICHE_KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Ein Treffer der Suche als Teil der Korrektur, wie das Formular der Besucher ihn nimmt (`photobox/formular-modell.ts`, `ortUndBezug`): Ein Ort mit öffentlicher
 * Kennung ist der Ort des Bildes (`placeId`), jeder andere Treffer (Landschaft, Weg, Klima, ein Ort ohne öffentliche Kennung) der Bezug.
 */
export function wahlZuKorrektur(wahl: {
    art: NonNullable<PhotoboxSubmissionView["bezug"]>["art"];
    id: string;
    name: string;
}): { ort?: NonNullable<KorrekturEingabe["ort"]>; bezug?: NonNullable<KorrekturEingabe["bezug"]> } {
    if (wahl.art === "ort" && OEFFENTLICHE_KENNUNG.test(wahl.id))
        return { ort: { publicId: wahl.id, name: wahl.name } };
    return { bezug: { art: wahl.art, id: wahl.id, name: wahl.name } };
}

/**
 * Der Rumpf der Korrektur: NUR was sich gegenüber der Einreichung ändert. Die Beschreibung getrimmt (die Datenbank zählt nach `btrim`). Nach der Freigabe nur die
 * Beschreibung, alles andere fällt weg (der Server nähme es mit 409 nicht an). `undefined`, wenn nichts zu ändern ist: Dann gibt es nichts zu senden.
 */
export function korrekturAnfrage(
    s: Pick<PhotoboxSubmissionView, "zustand" | "beschreibung" | "lage" | "ort" | "bezug">,
    eingabe: KorrekturEingabe,
): Omit<PhotoboxRedaktionKorrigieren, "operationId" | "baseRevision"> | undefined {
    const anfrage: Omit<PhotoboxRedaktionKorrigieren, "operationId" | "baseRevision"> = {};
    const text = eingabe.beschreibung.trim();
    if (text !== "" && text !== s.beschreibung) anfrage.beschreibung = text;
    if (s.zustand !== "approved") {
        if (eingabe.lage !== undefined && !gleicheLage(eingabe.lage, s.lage)) anfrage.lage = eingabe.lage;
        if (eingabe.ort !== undefined && (eingabe.ort?.publicId ?? null) !== (s.ort?.publicId ?? null)) {
            anfrage.placeId = eingabe.ort === null ? null : eingabe.ort.publicId;
        }
        if (eingabe.bezug !== undefined && (eingabe.bezug?.art !== s.bezug?.art || eingabe.bezug?.id !== s.bezug?.id)) {
            anfrage.bezug = eingabe.bezug === null ? null : { art: eingabe.bezug.art, id: eingabe.bezug.id };
        }
    }
    return Object.keys(anfrage).length === 0 ? undefined : anfrage;
}

/** Die Länge der Beschreibung ist die der Tafel (`media_submission_description_len`). */
export const BESCHREIBUNG_MAX = PHOTOBOX_LIMITS.descriptionMax;

// --- Die Unterteilung des Korbs --------------------------------------------------------------------------------------------------------------

export interface Reiter {
    id: MamEinreichung;
    text: string;
    /** Die Zahl aus der Navigation; `undefined`, wenn der Server sie nicht schickt. */
    anzahl: number | undefined;
}

/** Die drei Reiter über der Liste („Offen“, „Rückfrage“, „Erledigt“) mit ihrer Zahl. */
export function reiter(navigation: Pick<MamNavigation, "einreichungen"> | undefined): Reiter[] {
    return MAM_EINREICHUNGEN.map((id) => ({
        id,
        text: t(`medien.einreichung.teil.${id}` as MessageKey),
        anzahl: navigation?.einreichungen?.[id],
    }));
}
