import {
    KANAL_IDS,
    MEDIA_DENY_REASONS,
    SOCIAL_KANAL_SPERREN,
    SOCIAL_SEGMENTE,
    ZAEHLREGELN,
    engsterKanal,
    kanalVerbunden,
    pruefeBeitrag,
    zaehleAlle,
    type KanalId,
    type KanalStand,
    type MediaDenyReason,
    type SocialDetail,
    type SocialKanalSperre,
    type SocialListe,
    type SocialPruefung,
    type SocialSegment,
    type SocialSperrgrund,
    type SocialVerlauf,
    type SocialZeile,
    type SocialZiel,
    type SocialZustand,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";
import type { MessageKey } from "../i18n/de";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";
import { grundName } from "../medien/medien-text";
import { textAus, type Abbildung, type GrundSatz } from "../system/ablehnung";
import { zeitAbstand } from "./meldungen-modell";
import { kanalKontextJetzt } from "./social-kontext";

/**
 * Was der Unterreiter „Community › Social Hub“ und das Fenster eines Beitrags rechnen (WI-0270 C11; Bedienkonzept §6.4 und §6.5, Fachkonzept §15), ohne Browser: Segmente und Zahlen, der Kreis je
 * Zustand, die Zeile der Liste mit Urheber und Notiz, die Knöpfe rechts an der Zeile (✓ Freigeben, ✕ Papierkorb, ↺ zurückholen) mit ihren Sperrgründen, der Zähler je Kanal, die Knöpfe des Fußes je Zustand
 * und Recht, der Verlauf. Wie es aussieht, steht in `social-liste.vue` und `social-fenster.vue`.
 *
 * - 🔴 **Eine Zählung für Fenster und Server:** Die Sperren rechnen mit `pruefeBeitrag` und `zaehleAlle` aus `packages/shared` (`social/zaehlen.ts`), derselben Quelle, aus der der Server nachzählt.
 * - **Segmente:** Offen · Veröffentlicht · Papierkorb. Offen fasst Entwürfe und vorgelegte Beiträge zusammen.
 * - **Kreise** (Guide §13.17, ein Ton, Stufen über die Füllung): ○ Entwurf, ◐ zur Freigabe, ● veröffentlicht.
 * - 🔴 **Gesperrt heißt: ein Satz.** Was nicht geht, steht gesperrt da, mit dem Grund (Recht, Vorlage, Zeichengrenze), nie stumm weg.
 * - 🌐 **Fremde Kanäle (WI-0268 C12a):** Welche Kanäle senden und mit welchen Grenzen gezählt wird, steht in `social-kontext.ts` (vom Server gemeldet, `kanalKontext`); Mastodon ist wählbar, wenn es eingerichtet,
 *   freigeschaltet (Zählregel gegen ein Testkonto geprüft) und ohne Notschalter ist, sonst gesperrt mit dem Grund. Der Zähler nimmt die Grenzen der Instanz.
 */

export const LISTEN_SEGMENTE = SOCIAL_SEGMENTE;
export type ListenSegment = SocialSegment;

const KREIS_VON_ZUSTAND: Readonly<Record<SocialZustand, Kreis>> = {
    entwurf: "leer",
    vorgelegt: "halb",
    veroeffentlicht: "voll",
};
export const kreisVon = (zustand: SocialZustand): Kreis => KREIS_VON_ZUSTAND[zustand];

export const ZUSTAND_NAME: Readonly<Record<SocialZustand, MessageKey>> = {
    entwurf: "community.social.zustand.entwurf",
    vorgelegt: "community.social.zustand.vorgelegt",
    veroeffentlicht: "community.social.zustand.veroeffentlicht",
};

/** Der Name eines Kanals: der Eigenname des Dienstes, nicht übersetzt (die Neuigkeiten heißen in der Oberfläche wie im Menü der Seite). */
export const kanalName = (kanal: KanalId): string => ZAEHLREGELN[kanal].name;

/** Sendet der Hub an diesen Kanal? Die Neuigkeiten immer; ein Kanal mit Zugang nur, wenn der Server ihn `bereit` meldet. */
export const kanalOffen = (kanal: KanalId): boolean => kanalVerbunden(kanal, kanalKontextJetzt().verbunden);

/**
 * Warum ein Kanal gerade nicht wählbar ist, als Satz; `undefined`, wenn er es ist. Für einen Kanal, den der Server (noch) nicht gemeldet hat, der allgemeine Satz „noch nicht verbunden“.
 */
export function kanalGrund(kanal: KanalId): string | undefined {
    const kontext = kanalKontextJetzt();
    if (kanalVerbunden(kanal, kontext.verbunden)) return undefined;
    const sperre = kontext.sperren[kanal];
    return sperre === undefined
        ? t("community.social.kanal.sperreNichtVerbunden", { kanal: kanalName(kanal) })
        : t(`community.social.kanal.sperre.${sperre}` as MessageKey, { kanal: kanalName(kanal) });
}

// --- Liste ----------------------------------------------------------------------------------------------------------------------

export const segmentZahl = (zaehler: SocialListe["zaehler"], segment: ListenSegment): number => zaehler[segment];

/** Darf freigeben, veröffentlichen und zurücknehmen: `manage_news` oder `publish_social` (Social-Media-Manager, WI-0279). */
export const istFreigeber = (rechte: readonly string[]): boolean =>
    rechte.includes("manage_news") || rechte.includes("publish_social");

/** Die Zahl am Unterreiter: was auf eine freigebende Person wartet (vorgelegte Beiträge und Fehler beim Senden); für alle anderen keine. */
export const unterreiterZahl = (liste: SocialListe, rechte: readonly string[]): number | undefined =>
    istFreigeber(rechte) ? liste.zaehler.wartet : undefined;

/** Die Legende unten in einer Zeile: „Entwurf ○ 2 · zur Freigabe ◐ 1 · veröffentlicht ● 14“ (Zahlen aller, nicht der gefilterten Liste). */
export function legendeZahlen(zaehler: SocialListe["zaehler"]): Record<Kreis, number> {
    return { leer: zaehler.entwurf, halb: zaehler.vorgelegt, voll: zaehler.veroeffentlicht, "halb-rechts": 0 };
}

export function legendeNamen(): Partial<Record<Kreis, string>> {
    return {
        leer: t(ZUSTAND_NAME.entwurf),
        halb: t(ZUSTAND_NAME.vorgelegt),
        voll: t(ZUSTAND_NAME.veroeffentlicht),
    };
}

/** In welchem Segment steht der Beitrag? */
export const segmentVon = (zeile: Pick<SocialZeile, "papierkorb" | "zustand">): ListenSegment =>
    zeile.papierkorb ? "papierkorb" : zeile.zustand === "veroeffentlicht" ? "veroeffentlicht" : "offen";

/** Der Urheber (13 px gedämpft): „Vali“, „Routine“, „Vali · aus COM-000110“. */
export function urheber(zeile: SocialZeile): string {
    if (zeile.herkunft === "routine") return t("community.social.herkunft.routine");
    const name = zeile.verfasser?.name ?? t("community.social.herkunft.redaktion");
    return zeile.vorgang === null ? name : t("community.social.urheber.vorgang", { name, nummer: zeile.vorgang });
}

/** Die Zusammenfassung der Zeile (13 px kräftig): die Titelzeile, sonst der erste Satz des Textes. */
export function zusammenfassung(zeile: SocialZeile): string {
    const titel = (zeile.titel ?? "").trim();
    if (titel !== "") return titel;
    const erster =
        zeile.text
            .trim()
            .split(/[.!?\n]/u)[0]
            ?.trim() ?? "";
    return erster === "" ? t("community.social.ohneText") : erster;
}

const hatFehler = (zeile: SocialZeile): boolean => zeile.ziele.some((ziel) => ziel.zustand === "fehler");

/** Die Notiz in Amber, wo jemand handeln muss (Bedienkonzept §6.4); `undefined`, wo nichts zu tun ist. */
export function notiz(zeile: SocialZeile): string | undefined {
    if (zeile.papierkorb) return zeile.verfallen ? t("community.social.notiz.verfallen") : undefined;
    if (hatFehler(zeile)) return t("community.social.notiz.fehler");
    if (zeile.zustand === "vorgelegt") {
        return t(zeile.herkunft === "routine" ? "community.social.notiz.routine" : "community.social.notiz.freigabe");
    }
    // Eine Änderung nach dem Veröffentlichen erreicht nur die Neuigkeit; fremde Kanäle behalten, was gesendet wurde.
    if (zeile.zustand === "veroeffentlicht" && zeile.geaendert && zeile.kanaele.includes("neuigkeiten")) {
        return t("community.social.notiz.geaendert");
    }
    return undefined;
}

/** Der Statuschip je Kanal (Bedienkonzept §6.4): wartet (gedämpft), ok, Fehler (rot), zurückgenommen. */
export interface Chip {
    readonly kanal: KanalId;
    readonly zustand: SocialZiel["zustand"];
    readonly text: string;
}

export function chips(zeile: Pick<SocialZeile, "kanaele" | "ziele">): Chip[] {
    return zeile.kanaele.map((kanal) => {
        const zustand = zeile.ziele.find((ziel) => ziel.kanal === kanal)?.zustand ?? "wartet";
        return {
            kanal,
            zustand,
            text: t(`community.social.chip.${zustand}` as MessageKey, { kanal: kanalName(kanal) }),
        };
    });
}

/** Die Zeit rechts in der Zeile. */
export const zeitVon = (zeile: SocialZeile, jetzt: Date = new Date()): string => zeitAbstand(zeile.angelegtAt, jetzt);

/** Die Anfrage an den Server aus der Leiste. */
export function anfrageVon(
    segment: ListenSegment,
    suche: string,
    filter: SocialFilter,
): { segment: ListenSegment; q?: string; kanal?: KanalId; herkunft?: "redaktion" | "routine" | "vorgang" } {
    const q = suche.trim();
    const kanal = filter.kanal?.length === 1 ? filter.kanal[0] : undefined;
    const herkunft = filter.herkunft?.length === 1 ? filter.herkunft[0] : undefined;
    return {
        segment,
        ...(q === "" ? {} : { q: q.slice(0, 100) }),
        ...(kanal !== undefined && (KANAL_IDS as readonly string[]).includes(kanal) ? { kanal: kanal as KanalId } : {}),
        ...(herkunft === "redaktion" || herkunft === "routine" || herkunft === "vorgang" ? { herkunft } : {}),
    };
}

/** Was der Trichter wählt (Bedienkonzept §6.4: nach Kanal und Herkunft). Leer: kein Filter. */
export interface SocialFilter {
    kanal?: readonly string[] | undefined;
    herkunft?: readonly string[] | undefined;
}

export const filterGesetzt = (filter: SocialFilter): boolean =>
    (filter.kanal?.length ?? 0) > 0 || (filter.herkunft?.length ?? 0) > 0;

// --- Sperrgründe ------------------------------------------------------------------------------------------------------------------

/** Der Satz zu einem Sperrgrund der Zählung; derselbe in der Zeile, im Tooltip und im Fuß des Fensters. */
export function sperrSatz(grund: SocialSperrgrund): string {
    switch (grund.art) {
        case "text_fehlt":
            return t("community.social.sperre.textFehlt");
        case "titel_fehlt":
            return t("community.social.sperre.titelFehlt");
        case "kein_kanal":
            return t("community.social.sperre.keinKanal");
        case "kanal_nicht_verbunden":
            return grund.sperre === undefined
                ? t("community.social.sperre.kanalNichtVerbunden", { kanal: kanalName(grund.kanal) })
                : t(`community.social.kanal.sperre.${grund.sperre}` as MessageKey, { kanal: kanalName(grund.kanal) });
        case "zu_lang":
            return t(
                grund.teil === "titel"
                    ? "community.social.sperre.zuLangTitel"
                    : grund.teil === "bytes"
                      ? "community.social.sperre.zuLangBytes"
                      : "community.social.sperre.zuLangText",
                { kanal: kanalName(grund.kanal), n: formatNumber(grund.zuviel, 0) },
            );
        case "beschreibung_fehlt":
            return t("community.social.sperre.beschreibungFehlt");
        case "bild_nicht_geklaert":
            return istPolicyGrund(grund.grund)
                ? t("community.social.sperre.bildPolicy", { grund: grundName(grund.grund) })
                : t("community.social.sperre.bildRechte");
        case "bild_fehlt":
            return t("community.social.sperre.bildFehlt", { kanal: kanalName(grund.kanal) });
        case "bild_nicht_oeffentlich":
            return t("community.social.sperre.bildOhneDatei", { kanal: kanalName(grund.kanal) });
    }
}

const istPolicyGrund = (grund: string | undefined): grund is MediaDenyReason =>
    grund !== undefined && (MEDIA_DENY_REASONS as readonly string[]).includes(grund);

/** Die Gründe der Policy, die an den Rechten hängen: Ein Bild der Kategorie „Social Media Posts“ klärt „Rechte bestätigen“, jedes andere die Medienverwaltung. */
const RECHTE_GRUENDE: ReadonlySet<string> = new Set<MediaDenyReason>([
    "rights_missing",
    "clearance_pending",
    "legacy_assumed",
    "attribution_required",
    "permission_needs_approval",
    "fan_policy_needs_approval",
]);

/** Was beim Bild zu tun ist, je Grund der Policy. `social`: ein Bild der Kategorie „Social Media Posts“ (dort bestätigt, wer freigibt, die Rechte im Beitrag). */
function bildTun(grund: string | undefined, social: boolean): MessageKey {
    if (grund === undefined || RECHTE_GRUENDE.has(grund)) {
        return social ? "community.social.tun.bildRechteBestaetigen" : "community.social.tun.bildRechteKlaeren";
    }
    switch (grund) {
        case "rights_unknown":
        case "clearance_rejected":
            return "community.social.tun.bildRechtsgrundlage";
        case "moderation_pending":
        case "moderation_rejected":
            return "community.social.tun.bildModeration";
        case "publication_suspended":
            return "community.social.tun.bildNotaus";
        case "switched_off":
            return "community.social.tun.bildSchalter";
        default:
            return "community.social.tun.bildAnderes";
    }
}

/**
 * Was zu tun ist, damit der Grund verschwindet (Vali 2026-11-08: „ich will … wissen, was ich zu tun habe“). `bildSocial`: Das gewählte Bild gehört zur Kategorie
 * „Social Media Posts“; dann hilft bei offenen Rechten „Rechte bestätigen“ im Beitrag.
 */
export function tunSatz(grund: SocialSperrgrund, bildSocial = false): string {
    switch (grund.art) {
        case "text_fehlt":
            return t("community.social.tun.textFehlt");
        case "titel_fehlt":
            return t("community.social.tun.titelFehlt", { kanal: kanalName("neuigkeiten") });
        case "kein_kanal":
            return t("community.social.tun.keinKanal");
        case "kanal_nicht_verbunden":
            return t("community.social.tun.kanalNichtVerbunden", { kanal: kanalName(grund.kanal) });
        case "zu_lang":
            return t(
                grund.teil === "titel"
                    ? "community.social.tun.zuLangTitel"
                    : grund.teil === "bytes"
                      ? "community.social.tun.zuLangBytes"
                      : "community.social.tun.zuLangText",
                { kanal: kanalName(grund.kanal), n: formatNumber(grund.zuviel, 0) },
            );
        case "beschreibung_fehlt":
            return t("community.social.tun.beschreibungFehlt");
        case "bild_nicht_geklaert":
            return t(bildTun(grund.grund, bildSocial));
        case "bild_fehlt":
            return t("community.social.tun.bildFehlt", { kanal: kanalName(grund.kanal) });
        case "bild_nicht_oeffentlich":
            return t("community.social.tun.bildOhneDatei", { kanal: kanalName(grund.kanal) });
    }
}

/** Der Grund und was zu tun ist, in einem Satz: neben dem gesperrten Knopf, im Tooltip des ✓ und in der Meldung, wenn der Server ablehnt. */
export const sperrSatzMitTun = (grund: SocialSperrgrund, bildSocial = false): string =>
    t("community.social.sperre.mitTun", { grund: sperrSatz(grund), tun: tunSatz(grund, bildSocial) });

const istKanal = (wert: unknown): wert is KanalId => (KANAL_IDS as readonly unknown[]).includes(wert);
const istKanalSperre = (wert: unknown): wert is SocialKanalSperre =>
    (SOCIAL_KANAL_SPERREN as readonly unknown[]).includes(wert);

/** Der Sperrgrund aus `details.sperrgrund` einer Ablehnung des Servers; `undefined`, wenn er nicht die bekannte Form hat (dann gilt der Rückfall). */
export function sperrgrundAus(details: Readonly<Record<string, unknown>>): SocialSperrgrund | undefined {
    const roh = details["sperrgrund"];
    if (roh === null || typeof roh !== "object") return undefined;
    const g = roh as Record<string, unknown>;
    const art = g["art"];
    switch (art) {
        case "text_fehlt":
        case "titel_fehlt":
        case "kein_kanal":
        case "beschreibung_fehlt":
            return { art };
        case "bild_nicht_geklaert":
            return typeof g["grund"] === "string"
                ? { art: "bild_nicht_geklaert", grund: g["grund"] }
                : { art: "bild_nicht_geklaert" };
        case "kanal_nicht_verbunden": {
            const kanal = g["kanal"];
            const sperre = g["sperre"];
            if (!istKanal(kanal)) return undefined;
            return { art: "kanal_nicht_verbunden", kanal, ...(istKanalSperre(sperre) ? { sperre } : {}) };
        }
        case "zu_lang": {
            const kanal = g["kanal"];
            const teil = g["teil"];
            const zuviel = g["zuviel"];
            if (
                !istKanal(kanal) ||
                typeof zuviel !== "number" ||
                (teil !== "text" && teil !== "titel" && teil !== "bytes")
            ) {
                return undefined;
            }
            return { art: "zu_lang", kanal, zuviel, teil };
        }
        case "bild_fehlt":
        case "bild_nicht_oeffentlich": {
            const kanal = g["kanal"];
            return istKanal(kanal) ? { art, kanal } : undefined;
        }
        default:
            return undefined;
    }
}

/** Die Arten der Zählung, wie sie als `details.reason` ankommen. */
const SOCIAL_SPERR_ARTEN: readonly SocialSperrgrund["art"][] = [
    "text_fehlt",
    "titel_fehlt",
    "kein_kanal",
    "kanal_nicht_verbunden",
    "zu_lang",
    "beschreibung_fehlt",
    "bild_nicht_geklaert",
    "bild_fehlt",
    "bild_nicht_oeffentlich",
];

/**
 * Die Sätze zu den Ablehnungen des Social Hubs (`details.reason`, `apps/server/src/routes/social.ts`). Ein Grund der Zählung kommt mit `details.sperrgrund` und bekommt denselben
 * Satz wie der gesperrte Knopf. `bildSocial` sagt, ob das Bild des Fensters zur Kategorie „Social Media Posts“ gehört.
 */
export function socialAblehnung(bildSocial = false): Abbildung {
    const zaehlung: GrundSatz = (details) => {
        const grund = sperrgrundAus(details);
        return grund === undefined ? undefined : sperrSatzMitTun(grund, bildSocial);
    };
    const gruende: Record<string, GrundSatz> = {
        rubrik_unbekannt: () => t("community.social.ablehnung.rubrikUnbekannt"),
        hashtag_form: () => t("community.social.ablehnung.hashtagForm"),
        bild_nicht_social: () => t("community.social.ablehnung.bildNichtSocial"),
        kanal_ohne_zugang: (details) => {
            const kanal = textAus(details, "kanal");
            return istKanal(kanal)
                ? t("community.social.ablehnung.kanalOhneZugang", { kanal: kanalName(kanal) })
                : undefined;
        },
    };
    for (const art of SOCIAL_SPERR_ARTEN) gruende[art] = zaehlung;
    return { gruende };
}

/**
 * Was die Zählung zu einem Beitrag sagt, als Prüfung. Die Zeile der Liste trägt das Urteil der Policy über ihr Bild (`bildUrteil`), so sperrt das ✓ aus demselben Grund wie das
 * Freigeben am Server; ohne Urteil (älterer Server) zählt nur Text, Titel und Kanal.
 */
export const pruefungVon = (
    zeile: Pick<SocialZeile, "titel" | "text" | "hashtags" | "bild" | "bildBeschreibung" | "kanaele" | "bildUrteil">,
): SocialPruefung => ({
    titel: zeile.titel,
    text: zeile.text,
    hashtags: zeile.hashtags,
    bild: zeile.bild,
    bildBeschreibung: zeile.bildBeschreibung,
    bildGeklaert: zeile.bild === null ? undefined : zeile.bildUrteil?.erlaubt,
    bildGrund: zeile.bildUrteil?.grund,
    bildOeffentlich: zeile.bild === null ? undefined : zeile.bildUrteil?.oeffentlich,
    kanaele: zeile.kanaele,
    kontext: kanalKontextJetzt(),
});

/** Der Grund, der das Freigeben sperrt, als Satz mit dem, was zu tun ist; `undefined`, wenn der Beitrag passt. */
export function passtNicht(pruefung: SocialPruefung, bildSocial = false): string | undefined {
    const grund = pruefeBeitrag(pruefung);
    return grund === null ? undefined : sperrSatzMitTun(grund, bildSocial);
}

// --- Knöpfe rechts an der Zeile ----------------------------------------------------------------------------------------------------

/** Ein Handgriff: ob er dasteht, und wenn er gesperrt ist, der Grund als Satz. */
export interface Griff {
    readonly zeigen: boolean;
    readonly grund?: string | undefined;
}

export interface ZeilenKnoepfe {
    /** ✓ „Freigeben und veröffentlichen“ (offen) */
    readonly freigeben: Griff;
    /** ✕ „In den Papierkorb“ (offen) */
    readonly korb: Griff;
    /** ↺ „Aus dem Papierkorb holen“ (Papierkorb) */
    readonly holen: Griff;
}

const KEIN: Griff = { zeigen: false };

/**
 * Die Knöpfe rechts an der Zeile wie bei den Mails (Rückmeldung Vali 2026-10-31): unter Offen ✓ und ✕, im Papierkorb ↺. ✓ geht mit `manage_news` für Vorgelegtes und für den EIGENEN Entwurf (allein, E10);
 * gesperrt mit Grund ohne das Recht, an einem fremden, noch nicht vorgelegten Entwurf und wenn der Beitrag nicht passt (derselbe Satz wie im Fenster). ✕ und ↺ für den Verfasser oder einen Betreiber.
 */
export function zeilenKnoepfe(zeile: SocialZeile, rechte: readonly string[], ich: string | undefined): ZeilenKnoepfe {
    const freigeber = istFreigeber(rechte);
    const eigen = ich !== undefined && zeile.verfasser?.id === ich;
    if (zeile.papierkorb) {
        return {
            freigeben: KEIN,
            korb: KEIN,
            holen: { zeigen: true, ...(freigeber || eigen ? {} : { grund: t("community.social.grund.holenRecht") }) },
        };
    }
    if (zeile.zustand === "veroeffentlicht") return { freigeben: KEIN, korb: KEIN, holen: KEIN };
    const grundFrei = !freigeber
        ? t("community.social.grund.keinRecht")
        : zeile.zustand === "entwurf" && !eigen
          ? t("community.social.grund.nichtVorgelegt")
          : passtNicht(pruefungVon(zeile), zeile.bildUrteil?.social === true);
    return {
        freigeben: { zeigen: true, ...(grundFrei === undefined ? {} : { grund: grundFrei }) },
        korb: { zeigen: true, ...(freigeber || eigen ? {} : { grund: t("community.social.grund.korbRecht") }) },
        holen: KEIN,
    };
}

// --- Das Fenster ------------------------------------------------------------------------------------------------------------------

/** Das Formular, wie es das Fenster hält. */
export interface Formular {
    titel: string;
    text: string;
    hashtags: string[];
    rubrik: string;
    bild: string | null;
    bildBeschreibung: string;
    ki: boolean;
    kanaele: KanalId[];
}

export const leeresFormular = (): Formular => ({
    titel: "",
    text: "",
    hashtags: [],
    rubrik: "community",
    bild: null,
    bildBeschreibung: "",
    ki: false,
    kanaele: ["neuigkeiten"],
});

export const formularAus = (zeile: SocialZeile): Formular => ({
    titel: zeile.titel ?? "",
    text: zeile.text,
    hashtags: [...zeile.hashtags],
    rubrik: zeile.rubrik,
    bild: zeile.bild,
    bildBeschreibung: zeile.bildBeschreibung ?? "",
    ki: zeile.ki,
    kanaele: [...zeile.kanaele],
});

export const gleich = (a: Formular, b: Formular): boolean =>
    a.titel === b.titel &&
    a.text === b.text &&
    a.rubrik === b.rubrik &&
    a.bild === b.bild &&
    a.bildBeschreibung === b.bildBeschreibung &&
    a.ki === b.ki &&
    a.hashtags.join(" ") === b.hashtags.join(" ") &&
    a.kanaele.join(" ") === b.kanaele.join(" ");

/** Der Rumpf für `anlegen` und `aendern`. */
export function inhaltVon(formular: Formular): {
    titel: string | null;
    text: string;
    hashtags: string[];
    rubrik: string;
    bild: string | null;
    bildBeschreibung: string | null;
    ki: boolean;
    kanaele: KanalId[];
} {
    return {
        titel: formular.titel.trim() === "" ? null : formular.titel,
        text: formular.text,
        hashtags: formular.hashtags,
        rubrik: formular.rubrik,
        bild: formular.bild,
        bildBeschreibung:
            formular.bild === null || formular.bildBeschreibung.trim() === "" ? null : formular.bildBeschreibung,
        ki: formular.ki,
        kanaele: formular.kanaele,
    };
}

export const pruefungAusFormular = (
    formular: Formular,
    bildGeklaert?: boolean | undefined,
    bildOeffentlich?: boolean | undefined,
    bildGrund?: string | undefined,
): SocialPruefung => ({
    titel: formular.titel,
    text: formular.text,
    hashtags: formular.hashtags,
    bild: formular.bild,
    bildBeschreibung: formular.bildBeschreibung,
    bildGeklaert,
    bildGrund,
    bildOeffentlich,
    kanaele: formular.kanaele,
    kontext: kanalKontextJetzt(),
});

/** Die Zählung je gewähltem UND je ungewähltem Kanal: auch für Kanäle ohne Verbindung, damit ein zu langer Text vor dem Einrichten auffällt (Fachkonzept §15.6). Mastodon zählt mit den Grenzen der Instanz. */
export function staendeVon(formular: Formular): KanalStand[] {
    return zaehleAlle(
        KANAL_IDS,
        { titel: formular.titel, text: formular.text, hashtags: formular.hashtags },
        kanalKontextJetzt().regeln,
    );
}

/** Der Zähler oben am Text (Guide §13.21): der gewählte Kanal, dem am wenigsten Platz bleibt; läuft einer über, steht er vorn. */
export function zaehlerSatz(formular: Formular): string {
    if (formular.kanaele.length === 0) return t("community.social.zaehler.keinKanal");
    const staende = zaehleAlle(
        formular.kanaele,
        {
            titel: formular.titel,
            text: formular.text,
            hashtags: formular.hashtags,
        },
        kanalKontextJetzt().regeln,
    );
    const eng = engsterKanal(staende);
    if (eng === null) return t("community.social.zaehler.keinKanal");
    const werte = {
        n: formatNumber(eng.n, 0),
        grenze: formatNumber(eng.grenze, 0),
        kanal: kanalName(eng.kanal),
    };
    if (eng.zuviel > 0) return t("community.social.zaehler.zuViel", { ...werte, zuviel: formatNumber(eng.zuviel, 0) });
    if (eng.zuvielBytes > 0) {
        return t("community.social.zaehler.bytesZuViel", {
            kanal: kanalName(eng.kanal),
            n: formatNumber(eng.bytes ?? 0, 0),
            grenze: formatNumber(eng.bytesGrenze ?? 0, 0),
            zuviel: formatNumber(eng.zuvielBytes, 0),
        });
    }
    if (eng.titel !== null && eng.titel.zuviel > 0) {
        return t("community.social.zaehler.titelZuViel", {
            n: formatNumber(eng.titel.n, 0),
            grenze: formatNumber(eng.titel.grenze, 0),
            zuviel: formatNumber(eng.titel.zuviel, 0),
        });
    }
    return t("community.social.zaehler.ok", werte);
}

/** Die Zählung eines Kanals in einer Zeile (Bedienkonzept §6.5): „328 von 500 Zeichen · Adressen zählen 23 · 2 Hashtags fallen weg · 73 zu viel“. */
export function kanalZeile(stand: KanalStand): string {
    const teile = [
        t("community.social.zeile.zeichen", { n: formatNumber(stand.n, 0), grenze: formatNumber(stand.grenze, 0) }),
    ];
    if (stand.regel.adresse !== undefined) {
        teile.push(t("community.social.zeile.adressen", { n: formatNumber(stand.regel.adresse, 0) }));
    }
    if (stand.bytes !== null && stand.bytesGrenze !== null) {
        teile.push(
            t("community.social.zeile.bytes", {
                n: formatNumber(stand.bytes, 0),
                grenze: formatNumber(stand.bytesGrenze, 0),
            }),
        );
    }
    if (stand.hashtagsWeg > 0)
        teile.push(t("community.social.zeile.hashtagsWeg", { n: formatNumber(stand.hashtagsWeg, 0) }));
    if (stand.zuviel > 0) teile.push(t("community.social.zeile.zuViel", { n: formatNumber(stand.zuviel, 0) }));
    else if (stand.zuvielBytes > 0) {
        teile.push(t("community.social.zeile.bytesZuViel", { n: formatNumber(stand.zuvielBytes, 0) }));
    }
    if (stand.titel !== null && stand.titel.zuviel > 0) {
        teile.push(t("community.social.zeile.titelZuViel", { n: formatNumber(stand.titel.zuviel, 0) }));
    }
    return teile.join(" · ");
}

/** Lizenz und Klärung eines Bildes aus dem Medienkern in einem Satz („Rechte: Eigenes Werk · Klärung: geprüft“), nur zum Lesen. */
export function bildRechte(basis: string | null, klaerung: string | null): string {
    const wort = (schluessel: string): string =>
        isMessageKey(schluessel) ? t(schluessel) : t("community.social.bild.unbekannt");
    return t("community.social.bild.lizenz", {
        basis: basis === null ? t("community.social.bild.unbekannt") : wort(`medien.rechtsgrund.${basis}`),
        klaerung: klaerung === null ? t("community.social.bild.unbekannt") : wort(`medien.pruefstand.${klaerung}`),
    });
}

/**
 * Das Wort zum Stand des Kanals neben seinem Namen: „immer da“ (die Neuigkeiten), „verbunden“ (ein Kanal mit Zugang, der sendet), der Grund in zwei, drei Wörtern („Zählregel noch nicht geprüft“) oder
 * „nicht verbunden“.
 */
export function kanalStand(kanal: KanalId): string {
    const kontext = kanalKontextJetzt();
    if (kanalVerbunden(kanal, kontext.verbunden)) {
        return kanalVerbunden(kanal) ? t("community.social.kanal.immerDa") : t("community.social.kanal.verbunden");
    }
    const sperre = kontext.sperren[kanal];
    return sperre === undefined
        ? t("community.social.kanal.nichtVerbunden")
        : t(`community.social.kanal.wort.${sperre}` as MessageKey);
}

// --- Ziele: Stand je Kanal -------------------------------------------------------------------------------------------------------

/** Was das Fenster zu einem Ziel zeigt: den Chip, den Link zum Beitrag dort, den Grund eines Fehlers und was noch aussteht. */
export interface ZielAnzeige {
    readonly chip: string;
    /** Die Adresse des gesendeten Beitrags bei einem fremden Kanal (nur `https`); sonst `null`. */
    readonly link: string | null;
    /** „nicht gesendet: Grund“ bei einem Fehler, „Zurücknehmen gescheitert: Grund“, wenn das Zurücknehmen scheiterte; sonst `null`. */
    readonly grund: string | null;
    /** „wird gesendet …“ oder „wird zurückgenommen …“, solange der Auftrag läuft; sonst `null`. */
    readonly ausstehend: string | null;
}

export function zielAnzeige(ziel: SocialZiel): ZielAnzeige {
    const fremd = ziel.kanal !== "neuigkeiten";
    const link =
        fremd && ziel.zustand === "ok" && ziel.adresse !== null && /^https:\/\//u.test(ziel.adresse)
            ? ziel.adresse
            : null;
    const fehler = ziel.fehler === null ? "" : ziel.fehler;
    const grund =
        fehler === ""
            ? null
            : ziel.zustand === "fehler"
              ? t("community.social.ziel.nichtGesendet", { grund: fehler })
              : ziel.zustand === "ok"
                ? t("community.social.ziel.zurueckFehler", { grund: fehler })
                : null;
    return {
        chip: t(`community.social.chip.${ziel.zustand}` as MessageKey, { kanal: kanalName(ziel.kanal) }),
        link,
        grund,
        ausstehend:
            ziel.ausstehend === null ? null : t(`community.social.ziel.ausstehend.${ziel.ausstehend}` as MessageKey),
    };
}

/** Darf ein gesendetes Ziel eines fremden Kanals zurückgenommen werden? Wer `manage_news` hat, für einen veröffentlichten Beitrag, dessen Ziel gesendet ist und nicht schon zurückgenommen wird. */
export function darfKanalZuruecknehmen(zeile: SocialZeile | undefined, kanal: KanalId, freigeber: boolean): boolean {
    if (zeile === undefined || !freigeber || kanal === "neuigkeiten" || zeile.papierkorb) return false;
    const ziel = zeile.ziele.find((z) => z.kanal === kanal);
    // Instagram erlaubt kein Löschen über die Schnittstelle: Dort gibt es kein Zurücknehmen von hier (`kanalZurueckSperre` nennt den Grund).
    if (kanal === "instagram") return false;
    return zeile.zustand === "veroeffentlicht" && ziel?.zustand === "ok" && ziel.ausstehend !== "zuruecknehmen";
}

/**
 * Der Satz, warum „Zurücknehmen“ bei einem gesendeten Ziel gesperrt ist, sonst `undefined`. Heute nur Instagram (Fachkonzept §15.4 und §15.7: kein Ändern und kein Löschen nach dem Senden); der Knopf steht gesperrt
 * da, mit dem Grund, nie stumm weg.
 */
export function kanalZurueckSperre(
    zeile: SocialZeile | undefined,
    kanal: KanalId,
    freigeber: boolean,
): string | undefined {
    if (zeile === undefined || !freigeber || kanal !== "instagram" || zeile.papierkorb) return undefined;
    const ziel = zeile.ziele.find((z) => z.kanal === kanal);
    return zeile.zustand === "veroeffentlicht" && ziel?.zustand === "ok"
        ? t("community.social.ziel.keinLoeschen", { kanal: kanalName(kanal) })
        : undefined;
}

/**
 * Warum ein Kanal bei diesem Beitrag gerade nicht anzuhaken ist, obwohl er sendet: Instagram braucht ein Bild, und das Bild muss öffentlich freigegeben sein (Rechte geklärt), weil Meta es selbst abholt.
 * `bild` ist das gewählte Bild (`null`: keins), `geklaert` ob seine Rechte geklärt sind (`undefined`: noch nicht gelesen), `oeffentlich` ob Meta es abholen kann. Ein schon angehakter Kanal bleibt abwählbar (der Aufrufer fragt nur beim Anhaken).
 */
export function kanalBildGrund(
    kanal: KanalId,
    bild: string | null,
    geklaert: boolean | undefined,
    oeffentlich?: boolean | undefined,
): string | undefined {
    if (ZAEHLREGELN[kanal].bildPflicht !== true) return undefined;
    if (bild === null) return t("community.social.kanal.sperreBildFehlt", { kanal: kanalName(kanal) });
    if (geklaert === false) return t("community.social.kanal.sperreBildNichtOeffentlich", { kanal: kanalName(kanal) });
    if (oeffentlich === false) return t("community.social.sperre.bildOhneDatei", { kanal: kanalName(kanal) });
    return undefined;
}

// --- Fuß: Knöpfe je Zustand und Recht ----------------------------------------------------------------------------------------------

export type FussAktion =
    | "verwerfen"
    | "speichern"
    | "vorlegen"
    | "freigeben"
    | "zurueckziehen"
    | "zurueckgeben"
    | "aenderung"
    | "zuruecknehmen"
    | "zurueckholen";

export interface FussKnopf {
    readonly aktion: FussAktion;
    readonly text: string;
    /** Der Hauptknopf (gefüllt). */
    readonly haupt: boolean;
    /** Der Satz, warum er gerade nicht geht; gesetzt heißt gesperrt. */
    readonly gesperrt?: string | undefined;
}

export interface FussStand {
    /** Der Satz links: wohin der Beitrag geht, oder was gerade gilt. */
    readonly satz: string;
    readonly knoepfe: FussKnopf[];
}

/** Wer was am Fenster darf. */
export interface Rolle {
    readonly freigeber: boolean;
    readonly eigen: boolean;
}

/** Darf das Formular bearbeitet werden? Der Verfasser (oder ein Freigebender) den Entwurf; was vorgelegt oder veröffentlicht ist, ändert nur, wer freigibt. */
export function bearbeitbar(zeile: SocialZeile | undefined, rolle: Rolle): boolean {
    if (zeile === undefined) return true;
    if (zeile.papierkorb) return false;
    return zeile.zustand === "entwurf" ? rolle.eigen || rolle.freigeber : rolle.freigeber;
}

/**
 * Der Fuß je Zustand und Recht (Bedienkonzept §6.5). `zeile` fehlt bei einem neuen Beitrag. `sperre` ist der Grund, den die Zählung gegen Vorlegen und Freigeben sagt
 * („Bildbeschreibung fehlt“, „Mastodon: 12 Zeichen zu viel“); `geaendert` heißt: Das Formular weicht vom gespeicherten Stand ab.
 */
export function fussVon(
    zeile: SocialZeile | undefined,
    rolle: Rolle,
    sperre: string | undefined,
    formular: Formular,
    /** Sperrt das Vorlegen anders als das Freigeben? Ein Bild der Kategorie „Social Media Posts“ darf beim Vorlegen noch ohne bestätigte Rechte sein (WI-0278). */
    vorlage?: { readonly sperre: string | undefined },
): FussStand {
    const vorlageSperre = vorlage === undefined ? sperre : vorlage.sperre;
    const namen = formular.kanaele.map(kanalName).join(", ");
    const geht =
        formular.kanaele.length === 1
            ? t("community.social.fuss.gehtEins", { namen })
            : t("community.social.fuss.gehtMehrere", { n: formatNumber(formular.kanaele.length, 0), namen });
    const knopf = (aktion: FussAktion, haupt = false, gesperrt?: string): FussKnopf => ({
        aktion,
        text: t(`community.social.knopf.${aktion}` as MessageKey),
        haupt,
        ...(gesperrt === undefined ? {} : { gesperrt }),
    });
    if (zeile?.papierkorb === true) {
        const darf = rolle.freigeber || rolle.eigen;
        return {
            satz: zeile.verfallen ? t("community.social.fuss.korbVerfallen") : t("community.social.fuss.korb"),
            knoepfe: [knopf("zurueckholen", false, darf ? undefined : t("community.social.grund.holenRecht"))],
        };
    }
    if (zeile === undefined || zeile.zustand === "entwurf") {
        const knoepfe: FussKnopf[] = [
            ...(zeile === undefined ? [] : [knopf("verwerfen")]),
            knopf("speichern"),
            knopf("vorlegen", !rolle.freigeber, vorlageSperre),
        ];
        // Den EIGENEN Entwurf gibt ein Betreiber allein frei (E10); den fremden erst, wenn er vorgelegt ist.
        if (rolle.freigeber && (zeile === undefined || rolle.eigen)) knoepfe.push(knopf("freigeben", true, sperre));
        return {
            satz:
                rolle.freigeber && (zeile === undefined || rolle.eigen)
                    ? t("community.social.fuss.allein", { satz: geht })
                    : geht,
            knoepfe,
        };
    }
    if (zeile.zustand === "vorgelegt") {
        if (rolle.freigeber) {
            return {
                satz: geht,
                knoepfe: [
                    zeile.herkunft === "routine" ? knopf("verwerfen") : knopf("zurueckgeben"),
                    knopf("freigeben", true, sperre),
                ],
            };
        }
        return rolle.eigen
            ? { satz: geht, knoepfe: [knopf("zurueckziehen")] }
            : { satz: t("community.social.fuss.wartet"), knoepfe: [] };
    }
    // veröffentlicht
    const zurueck = zeile.ziele.length > 0 && zeile.ziele.every((ziel) => ziel.zustand === "zurueck");
    // Die Handlungen des Fußes gelten der Neuigkeit: ohne Neuigkeit (nur Mastodon) oder bei schon zurückgenommener gibt es sie nicht. Mastodon nimmt man an seiner Zeile zurück.
    const neuigkeit =
        zeile.kanaele.includes("neuigkeiten") &&
        !zeile.ziele.some((ziel) => ziel.kanal === "neuigkeiten" && ziel.zustand === "zurueck");
    if (!rolle.freigeber) {
        return {
            satz: zurueck ? t("community.social.fuss.zurueckgenommen") : t("community.social.fuss.nurLesen"),
            knoepfe: [],
        };
    }
    return {
        satz: zurueck ? t("community.social.fuss.zurueckgenommen") : geht,
        knoepfe: [
            ...(zurueck || !neuigkeit ? [] : [knopf("zuruecknehmen")]),
            ...(zeile.geaendert && !zurueck && neuigkeit ? [knopf("aenderung", true, sperre)] : []),
        ],
    };
}

// --- Verlauf ------------------------------------------------------------------------------------------------------------------------

export interface VerlaufsZeile {
    readonly key: string;
    readonly zeit: string;
    readonly text: string;
}

export function verlaufZeilen(verlauf: readonly SocialVerlauf[], jetzt: Date = new Date()): VerlaufsZeile[] {
    return verlauf.map((eintrag, index) => ({
        key: `${String(index)}:${eintrag.art}`,
        zeit: zeitAbstand(eintrag.at, jetzt),
        text: t(`community.social.verlauf.${eintrag.art}` as MessageKey, {
            wer: eintrag.von?.name ?? t("community.social.verlauf.system"),
            zusatz: eintrag.text ?? "",
        }).trim(),
    }));
}

/** Das Ziel eines Kanals im Detail, falls es eines gibt. */
export const zielVon = (detail: SocialDetail | undefined, kanal: KanalId): SocialZiel | undefined =>
    detail?.zeile.ziele.find((ziel) => ziel.kanal === kanal);

// --- Von einem Vorgang zum Beitrag ----------------------------------------------------------------------------------------------------

export { vorlageAusVorgang } from "./social-vorlage";
