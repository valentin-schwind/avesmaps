import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { NEWS_RUBRIKEN } from "./news.ts";
import { OperationId } from "./operation.ts";
import {
    KANAL_IDS,
    KANAL_MIT_ZUGANG,
    KANAL_VERBUNDEN,
    kanalVerbunden,
    mastodonRegel,
    pruefeLaenge,
    regelFuer,
    type KanalId,
    type KanalRegeln,
    type ZaehlRegel,
} from "./social/zaehlen.ts";

/**
 * Der Social Hub im Community-Modul (WI-0270 C11; Fachkonzept `project-control/planning/community-fachkonzept.md` §15, Bedienkonzept §6.4 bis §6.6).
 * Die Regeln (Zustände, Revision, Idempotenz, Rechte der App-Rolle) stehen in der Datenbank (Migration 0269, Schema `avesmaps_community`); dieser
 * Vertrag beschreibt nur, was über die Leitung geht. Die Zählung je Kanal steht in `social/zaehlen.ts` und gilt für Fenster und Server gleich.
 *
 * Ein **Beitrag** (`SOC-000012`) wird einmal geschrieben und je Kanal veröffentlicht. Im ersten Schnitt sendet nur der Kanal „Neuigkeiten“: Er schreibt
 * in die vorhandene Tafel `public.news_entry` (Migration 0119) und trägt dort den Verweis `beitrag_id`; es gibt keinen zweiten Speicher.
 *
 * - **Vorlegen und Freigeben:** Wer `social_communication` hat, verfasst und legt vor. Freigeben, veröffentlichen, zurücknehmen und zurückgeben darf, wer `manage_news`
 *   oder `publish_social` hat. Ein Betreiber gibt den eigenen Beitrag allein frei, mit Vermerk im Verlauf (Entscheidung E10).
 * - **Papierkorb statt Löschen:** Offene Beiträge gehen in den Papierkorb und zurück; nach 30 Tagen räumt die Aufbewahrung ihn leer. Veröffentlichte werden nie
 *   gelöscht, nur zurückgenommen (die Neuigkeit wird versteckt).
 */

export const SOCIAL_URL = "/api/community/social";

/** Die Nummer eines Beitrags: `SOC-` und sechs Stellen, wie `COM-` bei den Vorgängen. */
export const socNummer = (id: number | bigint | string): string => `SOC-${String(id).padStart(6, "0")}`;
export function leseSoc(text: string): number | undefined {
    const treffer = /^(?:SOC-)?0*(\d{1,12})$/iu.exec(text.trim());
    if (treffer === null) return undefined;
    const zahl = Number(treffer[1]);
    return Number.isSafeInteger(zahl) && zahl > 0 ? zahl : undefined;
}

/** Fachkonzept §15.4: Entwurf ○, zur Freigabe ◐, veröffentlicht ●. Der Papierkorb ist ein Merkmal quer dazu (`papierkorb`). */
export const SOCIAL_ZUSTAENDE = ["entwurf", "vorgelegt", "veroeffentlicht"] as const;
export type SocialZustand = (typeof SOCIAL_ZUSTAENDE)[number];

/** Die Segmente der Liste (Bedienkonzept §6.4). „Offen“ fasst Entwürfe und vorgelegte Beiträge zusammen. */
export const SOCIAL_SEGMENTE = ["offen", "veroeffentlicht", "papierkorb"] as const;
export type SocialSegment = (typeof SOCIAL_SEGMENTE)[number];

/** Woher ein Beitrag stammt: die Redaktion, die tägliche Routine (immer ein Vorschlag) oder ein Vorgang der Community (COM-…). */
export const SOCIAL_HERKUENFTE = ["redaktion", "routine", "vorgang"] as const;
export type SocialHerkunft = (typeof SOCIAL_HERKUENFTE)[number];

/** Der Stand des Ziels (Fachkonzept §15.2): wartet, gesendet, Fehler, zurückgenommen. Der Sendestand gehört dem Ziel, nicht dem Beitrag. */
export const SOCIAL_ZIEL_ZUSTAENDE = ["wartet", "ok", "fehler", "zurueck"] as const;
export type SocialZielZustand = (typeof SOCIAL_ZIEL_ZUSTAENDE)[number];

/** Die Ereignisse im Verlauf eines Beitrags. Nie ein Text des Beitrags, nur Art, Person, Zeit und ein kurzer Vermerk. */
export const SOCIAL_EREIGNISSE = [
    "angelegt",
    "geaendert",
    "vorgelegt",
    "zurueckgezogen",
    "zurueckgegeben",
    "freigegeben",
    "gesendet",
    "aenderung_veroeffentlicht",
    "zurueckgenommen",
    "erneut_gesendet",
    "verworfen",
    "verfallen",
    "wiederhergestellt",
    "in_systemsteuerung",
] as const;
export type SocialEreignis = (typeof SOCIAL_EREIGNISSE)[number];

/** Längen und Zahlen, die die Datenbank ebenfalls prüft. Die Grenzen je Kanal stehen in `ZAEHLREGELN`. */
export const SOCIAL_GRENZEN = {
    titelMax: 200,
    /** Die obere Grenze der Speicherung; was ein Kanal wirklich nimmt, prüft die Zählung je Kanal beim Vorlegen und Freigeben. */
    textMax: 10_000,
    hashtagsMax: 10,
    hashtagMax: 64,
    beschreibungMax: 1000,
    grundMax: 500,
    rumpfBytes: 64 * 1024,
} as const;

/** Frischeprüfung (Fachkonzept §15.3): Ein Vorschlag der Routine, der so viele Tage liegt, verfällt in den Papierkorb. */
export const SOCIAL_FRISCHE_TAGE = 7;
/** Der Papierkorb räumt nach so vielen Tagen leer (Fachkonzept §15.4). */
export const SOCIAL_PAPIERKORB_TAGE = 30;
/** Notbremse (Fachkonzept §15.3): höchstens so viele Beiträge der Routine je Tag und Kanal. */
export const SOCIAL_ROUTINE_JE_TAG = 1;

const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
const Moment = Type.String();
const KanalLiteral = literals(KANAL_IDS);

/** Hashtags: `#` und Buchstaben, Ziffern, Unterstriche (auch mit Umlaut), höchstens 64 Zeichen; Doppelte ohne Rücksicht auf die Schreibweise fallen weg. */
export const HASHTAG_MUSTER = /^#[\p{L}\p{N}_]{1,63}$/u;

export function bereinigeHashtags(roh: readonly string[], max: number = SOCIAL_GRENZEN.hashtagsMax): string[] {
    const gesehen = new Set<string>();
    const ergebnis: string[] = [];
    for (const eintrag of roh) {
        const rein = eintrag.trim().replace(/^#*/u, "#");
        if (!HASHTAG_MUSTER.test(rein)) continue;
        const schluessel = rein.toLowerCase();
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        ergebnis.push(rein);
        if (ergebnis.length >= max) break;
    }
    return ergebnis;
}

/** So viele Hashtags führt das Panel „Hashtags“ der Systemsteuerung höchstens. */
export const SOCIAL_HASHTAG_VORRAT_MAX = 50;

/** Ein Hashtag, den der Hub in jedem Beitrag anbietet (WI-0270); ein vorausgewählter steht in einem neuen Beitrag schon drin. Die Form prüft die Route mit `bereinigeHashtags`. */
export const SocialHashtag = Type.Object(
    { tag: Type.String({ minLength: 2, maxLength: SOCIAL_GRENZEN.hashtagMax }), vorausgewaehlt: Type.Boolean() },
    strict,
);
export type SocialHashtag = Static<typeof SocialHashtag>;
export const SocialHashtags = Type.Object(
    { hashtags: Type.Array(SocialHashtag, { maxItems: SOCIAL_HASHTAG_VORRAT_MAX }) },
    strict,
);
export type SocialHashtags = Static<typeof SocialHashtags>;

// --- Redaktion ----------------------------------------------------------------------------------------------------------------------

export const SocialParams = Type.Object({ id: Type.Integer({ minimum: 1 }) }, strict);
export type SocialParams = Static<typeof SocialParams>;

export const SocialQuery = Type.Object(
    {
        segment: Type.Optional(literals(SOCIAL_SEGMENTE)),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        kanal: Type.Optional(KanalLiteral),
        herkunft: Type.Optional(literals(SOCIAL_HERKUENFTE)),
    },
    strict,
);
export type SocialQuery = Static<typeof SocialQuery>;

/** Was bei einem fremden Kanal noch aussteht: der Auftrag zum Senden oder zum Zurücknehmen läuft (WI-0268 C12a). */
export const SOCIAL_AUSSTEHEND = ["senden", "zuruecknehmen"] as const;
export type SocialAusstehend = (typeof SOCIAL_AUSSTEHEND)[number];

/**
 * Das Ziel eines Beitrags an einem Kanal. `adresse` ist bei den Neuigkeiten die Kennung des Eintrags (`news:123`), bei Mastodon die Adresse des Beitrags dort.
 * `ausstehend` ist bei einem fremden Kanal gesetzt, solange der Auftrag zum Senden oder Zurücknehmen läuft; `fehler` kann auch bei `ok` stehen (das Zurücknehmen scheiterte).
 */
export const SocialZiel = Type.Object(
    {
        kanal: KanalLiteral,
        zustand: literals(SOCIAL_ZIEL_ZUSTAENDE),
        adresse: Nullable(Type.String()),
        fehler: Nullable(Type.String()),
        versuche: Type.Integer({ minimum: 0 }),
        sendeAt: Nullable(Moment),
        ausstehend: Nullable(literals(SOCIAL_AUSSTEHEND)),
    },
    strict,
);
export type SocialZiel = Static<typeof SocialZiel>;

export const SocialBild = Type.Object(
    {
        id: Uuid,
        titel: Nullable(Type.String()),
        /** Die Rechtsbasis und die Klärung aus dem Medienkern (nur lesbar); `null`, wo das Medium fehlt. */
        rechtsbasis: Nullable(Type.String()),
        klaerung: Nullable(Type.String()),
        /** Darf das Bild raus? Das entscheidet die Policy für die Rolle `social_post` (WI-0278, `bild-urteil.ts`). */
        geklaert: Type.Boolean(),
        /** Der Grundcode der Policy; die Medienverwaltung hat für jeden einen Satz. Tolerant wie `typ`. */
        grund: Type.Optional(Type.String()),
        /** Was der Beitrag nennen muss (Lizenz mit Namensnennung); `null`: nichts. Leer: Etwas ist zu nennen, die Medienverwaltung kennt den Text nicht. */
        nennung: Type.Optional(Nullable(Type.String())),
        /** Kann ein Dienst, der selbst abholt (Instagram), das Bild bekommen? */
        oeffentlich: Type.Optional(Type.Boolean()),
        /** Der Asset-Typ. Bei `social_post` bestätigt die freigebende Person die Rechte im Hub (WI-0278). Tolerant: Ein älterer Server schickt ihn nicht. */
        typ: Type.Optional(Nullable(Type.String())),
    },
    strict,
);
export type SocialBild = Static<typeof SocialBild>;

/** „Rechte bestätigen“ an einem Bild der Kategorie „Social Media Posts“ (WI-0278). */
export const SocialBildParams = Type.Object({ asset: Uuid }, strict);
export type SocialBildParams = Static<typeof SocialBildParams>;
export const SocialBildRechteBody = Type.Object({ operationId: Uuid }, strict);
export type SocialBildRechteBody = Static<typeof SocialBildRechteBody>;
/**
 * Die Antwort auf „Rechte bestätigen“: die Klärung und das Urteil der Policy DANACH. `geklaert` ist `erlaubt` aus `socialBildUrteile`, nicht bloß „bestätigt“: Eine bestätigte Klärung
 * hebt nicht jede Sperre auf (Moderation, Notaus, Schalter im Inhaltsstand). Vorher stand hier fest `true`, das Fenster bot „Freigeben“ an und der Server lehnte ab (Vali 2026-11-08, Beitrag 20).
 * `grund`, `nennung` und `oeffentlich` kamen dazu; ein Fenster ohne sie behält seine vorigen Werte.
 */
export const SocialBildRechte = Type.Object(
    {
        klaerung: Type.String(),
        geklaert: Type.Boolean(),
        grund: Type.Optional(Type.String()),
        nennung: Type.Optional(Nullable(Type.String())),
        oeffentlich: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type SocialBildRechte = Static<typeof SocialBildRechte>;

/** So viele Bilder fragt die Auswahl auf einmal; sie lädt je Seite weniger. */
export const SOCIAL_BILD_URTEILE_MAX = 100;
/** Die Kennungen, durch Kommata getrennt. */
export const SocialBildUrteileQuery = Type.Object({ ids: Type.String({ minLength: 1, maxLength: 4000 }) }, strict);
export type SocialBildUrteileQuery = Static<typeof SocialBildUrteileQuery>;
/** Das Urteil zu einem Bild der Medienverwaltung: darf es in einen Beitrag, und wenn nicht, warum (WI-0278). */
export const SocialBildUrteil = Type.Object(
    {
        id: Uuid,
        erlaubt: Type.Boolean(),
        grund: Type.String(),
        nennung: Nullable(Type.String()),
        oeffentlich: Type.Boolean(),
    },
    strict,
);
export type SocialBildUrteil = Static<typeof SocialBildUrteil>;
export const SocialBildUrteile = Type.Object({ urteile: Type.Array(SocialBildUrteil) }, strict);
export type SocialBildUrteile = Static<typeof SocialBildUrteile>;

export const SocialZeile = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        nr: Type.String(),
        zustand: literals(SOCIAL_ZUSTAENDE),
        herkunft: literals(SOCIAL_HERKUENFTE),
        /** Bei der Herkunft `vorgang` die COM-Nummer, sonst `null`. */
        vorgang: Nullable(Type.String()),
        /** Wer den Beitrag schrieb (intern, nie öffentlich); `null` bei der Routine. */
        verfasser: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, strict)),
        titel: Nullable(Type.String()),
        text: Type.String(),
        hashtags: Type.Array(Type.String()),
        rubrik: Type.String(),
        bild: Nullable(Uuid),
        bildBeschreibung: Nullable(Type.String()),
        /**
         * Das Urteil der Policy über das Bild (nur in der Liste, `socialBildUrteile`): Damit sperrt das ✓ der Zeile mit demselben Grund wie der Server, statt es anzubieten und am Bild
         * zu scheitern (Vali 2026-11-08). Fehlt es, kennt die Zeile das Bild nicht und zählt nur Text, Titel und Kanal.
         */
        bildUrteil: Type.Optional(
            Type.Object(
                {
                    erlaubt: Type.Boolean(),
                    grund: Type.String(),
                    oeffentlich: Type.Boolean(),
                    /** Ein Bild der Kategorie „Social Media Posts“: Seine Rechte bestätigt, wer freigibt, im Beitrag. */
                    social: Type.Boolean(),
                },
                strict,
            ),
        ),
        ki: Type.Boolean(),
        kanaele: Type.Array(KanalLiteral),
        ziele: Type.Array(SocialZiel),
        /** Im Papierkorb; `verfallen` heißt: nach sieben Tagen ohne Freigabe von selbst dorthin gekommen. */
        papierkorb: Type.Boolean(),
        verfallen: Type.Boolean(),
        /** Etwas ist nach der Veröffentlichung geändert und noch nicht veröffentlicht. */
        geaendert: Type.Boolean(),
        revision: Type.Integer({ minimum: 1 }),
        angelegtAt: Moment,
        vorgelegtAt: Nullable(Moment),
        veroeffentlichtAt: Nullable(Moment),
    },
    strict,
);
export type SocialZeile = Static<typeof SocialZeile>;

export const SocialListe = Type.Object(
    {
        zeilen: Type.Array(SocialZeile),
        /** Zahlen je Segment ohne Suche und Trichter; dazu die Zustände für die Legende („Entwurf ○ 2 · zur Freigabe ◐ 1 · veröffentlicht ● 14“). */
        zaehler: Type.Object(
            {
                offen: Type.Integer(),
                veroeffentlicht: Type.Integer(),
                papierkorb: Type.Integer(),
                entwurf: Type.Integer(),
                vorgelegt: Type.Integer(),
                /** Was auf eine Person mit `manage_news` wartet: vorgelegte Beiträge und Fehler beim Senden. */
                wartet: Type.Integer(),
            },
            strict,
        ),
    },
    strict,
);
export type SocialListe = Static<typeof SocialListe>;

export const SocialVerlauf = Type.Object(
    {
        art: literals(SOCIAL_EREIGNISSE),
        von: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, strict)),
        /** Ein kurzer Vermerk („allein freigegeben“, der Grund beim Zurückgeben); nie der Text des Beitrags. */
        text: Nullable(Type.String()),
        at: Moment,
    },
    strict,
);
export type SocialVerlauf = Static<typeof SocialVerlauf>;

export const SocialDetail = Type.Object(
    {
        zeile: SocialZeile,
        bild: Nullable(SocialBild),
        verlauf: Type.Array(SocialVerlauf),
    },
    strict,
);
export type SocialDetail = Static<typeof SocialDetail>;

/** Was beim Anlegen und Ändern über die Leitung geht: das Formular als Ganzes. */
const Inhalt = {
    titel: Type.Optional(Nullable(Type.String({ maxLength: SOCIAL_GRENZEN.titelMax + 200 }))),
    text: Type.String({ maxLength: SOCIAL_GRENZEN.textMax + 1000 }),
    hashtags: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 30 }),
    rubrik: Type.String({ minLength: 1, maxLength: 40 }),
    bild: Type.Optional(Nullable(Uuid)),
    bildBeschreibung: Type.Optional(Nullable(Type.String({ maxLength: SOCIAL_GRENZEN.beschreibungMax + 200 }))),
    ki: Type.Boolean(),
    kanaele: Type.Array(KanalLiteral, { minItems: 1, maxItems: KANAL_IDS.length }),
};

export const SocialAnlegenBody = Type.Object(
    {
        operationId: OperationId,
        ...Inhalt,
        /** „Als Beitrag vorschlagen“ im Vorgangsfenster: die COM-Nummer (ohne Präfix). Der Beitrag trägt nie Daten des Melders. */
        vorgang: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    strict,
);
export type SocialAnlegenBody = Static<typeof SocialAnlegenBody>;

const Aenderung = { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) };
export const SocialAendernBody = Type.Object({ ...Aenderung, ...Inhalt }, strict);
export type SocialAendernBody = Static<typeof SocialAendernBody>;
export const SocialSchrittBody = Type.Object(Aenderung, strict);
export type SocialSchrittBody = Static<typeof SocialSchrittBody>;
export const SocialGrundBody = Type.Object(
    { ...Aenderung, grund: Type.Optional(Type.String({ maxLength: SOCIAL_GRENZEN.grundMax })) },
    strict,
);
export type SocialGrundBody = Static<typeof SocialGrundBody>;
export const SocialErneutBody = Type.Object({ ...Aenderung, kanal: KanalLiteral }, strict);
export type SocialErneutBody = Static<typeof SocialErneutBody>;

// --- Fremde Kanäle (WI-0268 C12a, Fachkonzept §15.7) -----------------------------------------------------------------------------------

/**
 * Warum ein Kanal mit Zugang gerade nicht sendet: die Umgebung kennt ihn nicht (`nicht_eingerichtet`: Adresse oder Zugangsschlüssel fehlen), seine Zählregel ist noch nicht gegen ein Testkonto geprüft
 * (`nicht_freigeschaltet`, Recherche §5) oder der Notschalter steht an.
 */
export const SOCIAL_KANAL_SPERREN = ["nicht_eingerichtet", "nicht_freigeschaltet", "notschalter"] as const;
export type SocialKanalSperre = (typeof SOCIAL_KANAL_SPERREN)[number];

/** Die Grenzen, die der Dienst von sich nennt (Mastodon: `GET /api/v2/instance`). */
export const SocialKanalGrenzen = Type.Object(
    {
        zeichen: Type.Integer({ minimum: 1 }),
        /** Länge einer Adresse: bei Mastodon nennt die Instanz sie (mindestens 1), bei Facebook und Instagram ist sie 0 (Links zählen als Text). */
        adresse: Type.Integer({ minimum: 0 }),
        bilder: Type.Integer({ minimum: 0 }),
        beschreibung: Type.Integer({ minimum: 0 }),
        bildBytes: Type.Integer({ minimum: 0 }),
        bildTypen: Type.Array(Type.String()),
    },
    strict,
);
export type SocialKanalGrenzen = Static<typeof SocialKanalGrenzen>;

/**
 * Der Stand eines Kanals mit Zugang. `bereit` heißt: Der Hub darf an ihn senden (eingerichtet, freigeschaltet, kein Notschalter). 🔴 Weder die Adresse der Instanz noch ein Zugangsschlüssel steht je in
 * dieser Antwort: `eingerichtet` sagt nur, dass die Umgebung beide kennt.
 */
export const SocialKanalStand = Type.Object(
    {
        kanal: literals(KANAL_MIT_ZUGANG),
        eingerichtet: Type.Boolean(),
        freigeschaltet: Type.Boolean(),
        freigeschaltetAt: Nullable(Moment),
        notschalter: Type.Boolean(),
        grenzen: Nullable(SocialKanalGrenzen),
        grenzenAt: Nullable(Moment),
        bereit: Type.Boolean(),
        sperre: Nullable(literals(SOCIAL_KANAL_SPERREN)),
    },
    strict,
);
export type SocialKanalStand = Static<typeof SocialKanalStand>;

export const SocialKanaele = Type.Object(
    {
        kanaele: Type.Array(SocialKanalStand),
        /** Darf diese Sitzung Notschalter und Grenzen verwalten (`manage_social_channels`)? */
        verwalten: Type.Boolean(),
    },
    strict,
);
export type SocialKanaele = Static<typeof SocialKanaele>;

export const SocialKanalParams = Type.Object({ kanal: literals(KANAL_MIT_ZUGANG) }, strict);
export type SocialKanalParams = Static<typeof SocialKanalParams>;
export const SocialNotschalterBody = Type.Object({ an: Type.Boolean() }, strict);
export type SocialNotschalterBody = Static<typeof SocialNotschalterBody>;

/**
 * Was Fenster und Server aus den Ständen der Kanäle brauchen, um gleich zu zählen und gleich zu sperren: die verbundenen Kanäle (die Neuigkeiten immer, ein Kanal mit Zugang nur, wenn er `bereit` ist),
 * die gelesenen Zählregeln (Mastodon: Grenze und Länge einer Adresse von der Instanz) und der Grund, warum ein Kanal gesperrt ist.
 */
export interface KanalKontext {
    readonly verbunden: readonly KanalId[];
    readonly regeln: KanalRegeln;
    readonly sperren: Readonly<Partial<Record<KanalId, SocialKanalSperre>>>;
}

export const KANAL_KONTEXT_VORGABE: KanalKontext = { verbunden: KANAL_VERBUNDEN, regeln: {}, sperren: {} };

export function kanalKontext(staende: readonly SocialKanalStand[]): KanalKontext {
    const verbunden: KanalId[] = [...KANAL_VERBUNDEN];
    const regeln: Partial<Record<KanalId, ZaehlRegel>> = {};
    const sperren: Partial<Record<KanalId, SocialKanalSperre>> = {};
    for (const stand of staende) {
        if (stand.bereit) verbunden.push(stand.kanal);
        else sperren[stand.kanal] = stand.sperre ?? "nicht_eingerichtet";
        // Die gelesenen Grenzen gelten auch für einen Kanal, der gerade gesperrt ist: Der Zähler soll zeigen, was die Instanz verlangt.
        if (stand.kanal === "mastodon" && stand.grenzen !== null) {
            regeln.mastodon = mastodonRegel(stand.grenzen, (stand.grenzenAt ?? "").slice(0, 10) || "unbekannt");
        }
    }
    return { verbunden, regeln, sperren };
}

export const SocialQuittung = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        nr: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        zustand: literals(SOCIAL_ZUSTAENDE),
    },
    strict,
);
export type SocialQuittung = Static<typeof SocialQuittung>;

/** Die Rubriken der Neuigkeiten gelten für jeden Beitrag (Fachkonzept §15.2); die Katalogzeile steht in `news.ts`. */
export const SOCIAL_RUBRIKEN = NEWS_RUBRIKEN;

/**
 * Die Fachcodes der Zählung beim Vorlegen und Freigeben. Der Server schickt sie bei 422 `community_invalid` in `details`: `reason` ist die `art`, `sperrgrund` der ganze Grund
 * (Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“). Das Fenster sagt ihn in seinen eigenen Sätzen, nie im Text des Servers.
 */
export type SocialSperrgrund =
    | { readonly art: "text_fehlt" }
    | { readonly art: "kein_kanal" }
    | { readonly art: "kanal_nicht_verbunden"; readonly kanal: KanalId; readonly sperre?: SocialKanalSperre }
    | {
          readonly art: "zu_lang";
          readonly kanal: KanalId;
          readonly zuviel: number;
          readonly teil: "text" | "titel" | "bytes";
      }
    | { readonly art: "beschreibung_fehlt" }
    /** `grund`: warum die Policy das Bild sperrt (`MediaDenyReason`, etwa `rights_missing`), wenn der Prüfende es kennt. */
    | { readonly art: "bild_nicht_geklaert"; readonly grund?: string }
    /** Ein Kanal sendet nur mit Bild (Instagram, `ZaehlRegel.bildPflicht`). */
    | { readonly art: "bild_fehlt"; readonly kanal: KanalId }
    | { readonly art: "bild_nicht_oeffentlich"; readonly kanal: KanalId }
    | { readonly art: "titel_fehlt" };

// --- Gemeinsame Prüfung --------------------------------------------------------------------------------------------------------------

/** Was ein Beitrag zum Prüfen vor dem Vorlegen und Freigeben mitbringt. `bildGeklaert` kennt, wer das Medium gelesen hat (Server, Fenster). */
export interface SocialPruefung {
    readonly titel?: string | null | undefined;
    readonly text: string;
    readonly hashtags: readonly string[];
    readonly bild?: string | null | undefined;
    readonly bildBeschreibung?: string | null | undefined;
    readonly bildGeklaert?: boolean | undefined;
    /** Warum die Policy das Bild sperrt (`MediaDenyReason`), wenn `bildGeklaert` `false` ist; er geht in den Sperrgrund. */
    readonly bildGrund?: string | undefined;
    /** Kann ein Dienst, der selbst abholt (Instagram), das Bild bekommen? `false`: Es ist nirgends öffentlich. */
    readonly bildOeffentlich?: boolean | undefined;
    readonly kanaele: readonly KanalId[];
    /** Welche Kanäle senden und mit welchen Grenzen gezählt wird; ohne Angabe gilt nur die Seite der Neuigkeiten und die Vorgabe jeder Regel. */
    readonly kontext?: KanalKontext | undefined;
}

/**
 * Der erste Grund, der „Zur Freigabe vorlegen“ und „Freigeben“ sperrt, sonst `null` (Bedienkonzept §6.5: „Fehlt etwas, ist der Hauptknopf gesperrt und
 * sagt warum“). 🔴 Fenster und Server rufen dieselbe Funktion: Der Server weist zu Langes ab, auch wenn ein Fenster es durchließe.
 */
export function pruefeBeitrag(eingabe: SocialPruefung): SocialSperrgrund | null {
    if (eingabe.kanaele.length === 0) return { art: "kein_kanal" };
    const kontext = eingabe.kontext ?? KANAL_KONTEXT_VORGABE;
    for (const kanal of eingabe.kanaele) {
        if (!kanalVerbunden(kanal, kontext.verbunden)) {
            const sperre = kontext.sperren[kanal];
            return { art: "kanal_nicht_verbunden", kanal, ...(sperre === undefined ? {} : { sperre }) };
        }
    }
    if (eingabe.text.trim() === "") return { art: "text_fehlt" };
    if (eingabe.kanaele.includes("neuigkeiten") && (eingabe.titel ?? "").trim() === "") return { art: "titel_fehlt" };
    const ueber = pruefeLaenge(
        eingabe.kanaele,
        {
            titel: eingabe.titel ?? undefined,
            text: eingabe.text,
            hashtags: eingabe.hashtags,
        },
        kontext.regeln,
    );
    if (ueber !== null) return { art: "zu_lang", kanal: ueber.kanal, zuviel: ueber.zuviel, teil: ueber.art };
    const ohneBild = eingabe.bild === null || eingabe.bild === undefined;
    if (ohneBild) {
        // Bildpflicht je Kanal (Fachkonzept §15.6): Instagram sendet nichts ohne Bild.
        const pflicht = eingabe.kanaele.find((kanal) => regelFuer(kanal, kontext.regeln).bildPflicht === true);
        if (pflicht !== undefined) return { art: "bild_fehlt", kanal: pflicht };
    } else {
        if ((eingabe.bildBeschreibung ?? "").trim() === "") return { art: "beschreibung_fehlt" };
        if (eingabe.bildGeklaert === false) {
            return {
                art: "bild_nicht_geklaert",
                ...(eingabe.bildGrund === undefined ? {} : { grund: eingabe.bildGrund }),
            };
        }
        if (eingabe.bildOeffentlich === false) {
            const abholer = eingabe.kanaele.find((kanal) => regelFuer(kanal, kontext.regeln).bildPflicht === true);
            if (abholer !== undefined) return { art: "bild_nicht_oeffentlich", kanal: abholer };
        }
    }
    return null;
}
