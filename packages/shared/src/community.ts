import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { BezeichnungWert } from "./auth/session.ts";
import { RollenInhaber, VorgangRolle, ZeilenRolle, ZustaendigSeit } from "./community-rollen.ts";
import { KANAL_KATEGORIEN, KANAL_PRIORITAETEN } from "./kanal.ts";
import { AVENTURIA } from "./map-domain-registry.ts";
import { OperationId } from "./operation.ts";

/**
 * Community-Modul (WI-0263 Fachkonzept, Bau WI-0268): Vorgänge von außen mit COM-Nummer, Melder, Bezug, Nachrichten, Notizen, Verlauf.
 * Die Regeln stehen in der Datenbank (Migration 0265, Schema `avesmaps_community`); dieser Vertrag beschreibt nur, was über die Leitung geht.
 * Lesen und Bearbeiten mit `moderate_submissions` (dazu gehört seit WI-0279, Vali 2026-11-11, auch: andere zuständig setzen und Sonderrollen zuweisen), Moderieren (Papierkorb,
 * Personenbezug) mit `moderate_community`.
 */

export const COMMUNITY_URL = "/api/community";

export const COMMUNITY_ARTEN = ["meldung", "anfrage"] as const;
export type CommunityArt = (typeof COMMUNITY_ARTEN)[number];

/** Fachkonzept §3.2: sechs Kategorien in Alltagssprache statt Legacys rund 40 Objektarten. */
export const MELDUNG_KATEGORIEN = ["lage", "name", "angabe", "fehlt", "entfaellt", "sonstiges"] as const;
export type MeldungKategorie = (typeof MELDUNG_KATEGORIEN)[number];
export const ANFRAGE_KATEGORIEN = [
    "frage",
    "hinweis",
    "mitmachen",
    "lob",
    "allgemein",
    "problem",
    "rechte",
    "datenschutz",
    "sonstiges",
] as const;
export type AnfrageKategorie = (typeof ANFRAGE_KATEGORIEN)[number];
/**
 * Was das Kontaktformular anbietet (Betreiber 2026-11-04). `rechte`, `datenschutz` und `sonstiges` bleiben im Vertrag: Es gibt Vorgänge mit diesen Kategorien, und ein altes Fenster im Browser kann sie noch senden.
 * Rechte- und Datenschutzanfragen gehen an die Adresse im Impressum.
 */
export const KONTAKT_THEMEN = ["frage", "hinweis", "mitmachen", "lob", "allgemein", "problem"] as const;
export type KontaktThema = (typeof KONTAKT_THEMEN)[number];

/**
 * Was bei „Etwas fehlt“ fehlt (Fachkonzept §3.2: „die Objektart wird mitgefragt“): ALLE gültigen Werte, auch die, die das Formular nicht mehr anbietet (`gebiet` aus dem Bestand und der Legacy-Übernahme).
 * Der Server nimmt jeden; angeboten wird `FEHLT_ARTEN_FORMULAR`.
 */
export const FEHLT_ARTEN = [
    "ort",
    "weg",
    "fluss",
    "gebirge",
    "gewaesser",
    "gebiet",
    "anderes",
    "insel",
    "landschaft",
    "herrschaft",
    "sprache",
] as const;
export type FehltArt = (typeof FEHLT_ARTEN)[number];
/** Die Liste, die das Meldeformular anbietet, in der Reihenfolge der Kacheln (WI-0279): kein `gebiet` mehr, dafür Herrschaftsgebiet, Insel, Landschaft und Sprache. */
export const FEHLT_ARTEN_FORMULAR = [
    "ort",
    "weg",
    "fluss",
    "gewaesser",
    "insel",
    "landschaft",
    "gebirge",
    "herrschaft",
    "sprache",
    "anderes",
] as const satisfies readonly FehltArt[];

export const COMMUNITY_EINGAENGE = ["website", "kontakt", "mail", "discord", "redaktion"] as const;
export type CommunityEingang = (typeof COMMUNITY_EINGAENGE)[number];

/** Fachkonzept §4.1. Archiv und Papierkorb sind keine Zustände, sondern Zeitpunkte am abgeschlossenen Vorgang. */
export const COMMUNITY_ZUSTAENDE = ["neu", "in_arbeit", "rueckfrage", "abgeschlossen"] as const;
export type CommunityZustand = (typeof COMMUNITY_ZUSTAENDE)[number];

/** Fachkonzept §4.3. `spam` und `zurueckgezogen` setzen eigene Wege (Papierkorb, Statusseite), nie „Abschließen“. */
export const COMMUNITY_ERGEBNISSE = [
    "umgesetzt",
    "bereits_richtig",
    "abgelehnt",
    "dublette",
    "weitergereicht",
    "beantwortet",
    "erledigt",
    "zurueckgezogen",
    "spam",
] as const;
export type CommunityErgebnis = (typeof COMMUNITY_ERGEBNISSE)[number];
/** Was „Abschließen“ je Art anbietet. */
export const ABSCHLUSS_ERGEBNISSE: Readonly<Record<CommunityArt, readonly CommunityErgebnis[]>> = {
    meldung: ["umgesetzt", "bereits_richtig", "abgelehnt", "dublette", "weitergereicht"],
    anfrage: ["beantwortet", "erledigt", "abgelehnt", "dublette", "weitergereicht"],
};

export const COMMUNITY_PRIORITAETEN = ["niedrig", "normal", "hoch", "dringend"] as const;
export type CommunityPrioritaet = (typeof COMMUNITY_PRIORITAETEN)[number];

/** Die Kartenobjekte, auf die sich eine Meldung beziehen kann; dieselben Arten wie die Detail-Endpunkte des Infopanels. */
export const BEZUG_OBJEKTARTEN = ["place", "path", "area", "territory", "peak", "powerline"] as const;
export type BezugObjektart = (typeof BEZUG_OBJEKTARTEN)[number];

/** Die Segmente der Liste (Bedienkonzept §4): Offen (○ ◐ ◑), Erledigt (● ohne Archiv), Archiv; dazu der Papierkorb im Trichter. */
export const COMMUNITY_SEGMENTE = ["offen", "erledigt", "archiv", "papierkorb"] as const;
export type CommunitySegment = (typeof COMMUNITY_SEGMENTE)[number];
/**
 * Die Ablagen der Mails (WI-0268 C4, Bedienkonzept §3.4): **Eingang** (alles, was Arbeit braucht oder auf Antwort wartet), Archiv, Papierkorb. „Gesendet“ ist keine Ablage, sondern eine Sicht auf die
 * ausgehenden Nachrichten (`GET …/gesendet`).
 */
export const MAIL_SEGMENTE = ["eingang", "archiv", "papierkorb"] as const;
export type MailSegment = (typeof MAIL_SEGMENTE)[number];
/** Alle Segmente, die `GET …/vorgaenge` kennt: die der Meldungen und die der Mails. */
export const ALLE_SEGMENTE = ["offen", "erledigt", "archiv", "papierkorb", "eingang"] as const;
export type ListenAnfrageSegment = (typeof ALLE_SEGMENTE)[number];

/** Fristen (Fachkonzept §10.2, Vali 2026-10-31 „name und e-mail werden nach 90 tagen gelöscht, text und meldung bleibt im meldungsarchiv“). */
export const COMMUNITY_KONTAKT_TAGE = 90;
export const COMMUNITY_ARCHIV_TAGE = 30;
export const COMMUNITY_PAPIERKORB_TAGE = 30;

/** Längen (Bedienkonzept §2.1). Die Datenbank prüft dieselben Grenzen. */
export const COMMUNITY_GRENZEN = {
    textMin: 10,
    textMax: 2000,
    quelleMax: 1000,
    nameMax: 80,
    notizMax: 4000,
    nachrichtMax: 4000,
    begruendungMax: 2000,
    /** Ein Mensch braucht länger; was schneller absendet, ist ein Bot (Zeitfalle, Fachkonzept §10.5). */
    mindestDauerMs: 3000,
    /** Je Adresse und Stunde (Legacy: 5) und insgesamt je Tag; gezählt nur im Speicher, nie gespeichert. */
    jeAdresseJeStunde: 5,
    jeTag: 300,
    rumpfBytes: 16 * 1024,
    /** Die Adresse im Kontaktformular (RFC 5321: höchstens 254 Zeichen). */
    mailMax: 254,
    /** Wie viele Zeichen der ersten Zeile einer Nachricht die Liste als Betreff zeigt. */
    betreffMax: 120,
    /** Wie viele Zeichen eines ausgehenden Textes die Liste „Gesendet“ zeigt. */
    gesendetTextMax: 200,
    /** Der Betreff einer neuen Mail (WI-0268 C6a). */
    betreffNeuMax: 150,
    /** Wie viele neue Mails an eine freie Adresse eine Person je Tag schreiben darf (Fachkonzept §9, Bedienkonzept §3.5). */
    neueMailsJeTag: 20,
} as const;

/** Eine schlichte Adresse: etwas, ein @, etwas, ein Punkt, etwas. Mehr prüft erst der Mailweg (C6); die Datenbank prüft dasselbe Muster. */
export const KONTAKT_MAIL_MUSTER = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

/**
 * Eine Adresse, an die der Mailweg senden darf (WI-0268 C6a): GENAU eine, ohne Kommentare, Anführungszeichen, Klammern, Komma und Strichpunkt. Die schlichte Prüfung des Kontaktformulars
 * (`KONTAKT_MAIL_MUSTER`) ließe `a@b.de,c@d.de` durch; der Versand braucht die strenge, damit aus einer Adresse nie mehrere Empfänger werden. Die Datenbank und der Versand prüfen dasselbe Muster.
 */
export const MAIL_ADRESSE_MUSTER =
    "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$";
export const istMailAdresse = (text: string): boolean =>
    text.length <= 254 && new RegExp(MAIL_ADRESSE_MUSTER, "u").test(text);

/** COM-000123: die Nummer ist die Kennung des Vorgangs mit sechs Stellen (wie OPS- im Kanal). */
export const comNummer = (id: number | bigint | string): string => `COM-${String(id).padStart(6, "0")}`;
export function leseCom(text: string): number | undefined {
    const treffer = /^(?:COM-)?0*(\d{1,12})$/iu.exec(text.trim());
    if (treffer === null) return undefined;
    const zahl = Number(treffer[1]);
    return Number.isSafeInteger(zahl) && zahl > 0 ? zahl : undefined;
}

/** Der Schlüssel der Statusseite: 32 Zufallsbytes base64url, im Browser erzeugt, steht nur im Fragment (`/meldung#…`); gespeichert wird sein Hash. */
export const STATUS_SCHLUESSEL_MUSTER = "^[A-Za-z0-9_-]{43}$";
export const STATUS_PFAD = "/meldung";

const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const { bounds: WORLD } = AVENTURIA.coordinateSpace;
const Lage = Type.Object(
    {
        x: Type.Number({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y: Type.Number({ minimum: WORLD.minY, maximum: WORLD.maxY }),
    },
    strict,
);
export type CommunityLage = Static<typeof Lage>;
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
const Schluessel = Type.String({ pattern: STATUS_SCHLUESSEL_MUSTER });
const Moment = Type.String();

/**
 * Bezug einer Meldung (Fachkonzept §6): ein Kartenobjekt mit Schnappschuss (Name, Art, Lage, wie der Besucher es sah) oder eine Stelle.
 * Ein Vorschlag (neue Lage, neuer Name) wird gezeigt, nie angewandt.
 */
export const MeldungBezug = Type.Union([
    Type.Object(
        {
            art: Type.Literal("objekt"),
            objektArt: literals(BEZUG_OBJEKTARTEN),
            objektId: Uuid,
            name: Type.String({ minLength: 1, maxLength: 200 }),
            typ: Type.Optional(Type.String({ maxLength: 80 })),
            lage: Type.Optional(Lage),
            vorschlagLage: Type.Optional(Lage),
            /** Gemeldet aus der Bildansicht eines Reisebilds (WI-0272): die Kennung des Mediums (`ReisebildKarte.id`). */
            reisebildId: Type.Optional(Uuid),
        },
        strict,
    ),
    Type.Object(
        {
            art: Type.Literal("stelle"),
            lage: Lage,
            /** „Stelle bei Wehrheim“ (Bedienkonzept §2.1a). */
            naechsterOrt: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            /** Gemeldet aus der Bildansicht eines Reisebilds (WI-0272): die Kennung des Mediums (`ReisebildKarte.id`). */
            reisebildId: Type.Optional(Uuid),
        },
        strict,
    ),
]);
export type MeldungBezug = Static<typeof MeldungBezug>;

/** `POST /api/community/meldungen` (öffentlich). `falle` sind Honigtopf und Zeitfalle (Fachkonzept §10.5). */
export const MeldungBody = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        kategorie: literals(MELDUNG_KATEGORIEN),
        text: Type.String({ minLength: COMMUNITY_GRENZEN.textMin, maxLength: COMMUNITY_GRENZEN.textMax }),
        quelle: Type.Optional(Type.String({ maxLength: COMMUNITY_GRENZEN.quelleMax })),
        fehltArt: Type.Optional(literals(FEHLT_ARTEN)),
        name: Type.Optional(Type.String({ maxLength: COMMUNITY_GRENZEN.nameMax })),
        bezug: MeldungBezug,
        falle: Type.Object({ feld: Type.String({ maxLength: 200 }), dauerMs: Type.Integer({ minimum: 0 }) }, strict),
    },
    strict,
);
export type MeldungBody = Static<typeof MeldungBody>;
export const MeldungAntwort = Type.Object({ nummer: Type.String() }, strict);
export type MeldungAntwort = Static<typeof MeldungAntwort>;

/**
 * `POST /api/community/anfragen` (öffentlich, WI-0268 C4, Fachkonzept §3.1, Bedienkonzept §3.1): das Kontaktformular der Hinweise. Name und Adresse sind freiwillig; ohne Adresse gibt es die Antwort nur
 * auf der Statusseite. Die Antwort ist die der Meldung (`MeldungAntwort`, die COM-Nummer). Honigtopf und Zeitfalle wie bei der Meldung.
 */
export const KontaktBody = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        kategorie: literals(ANFRAGE_KATEGORIEN),
        text: Type.String({ minLength: COMMUNITY_GRENZEN.textMin, maxLength: COMMUNITY_GRENZEN.textMax }),
        name: Type.Optional(Type.String({ maxLength: COMMUNITY_GRENZEN.nameMax })),
        mail: Type.Optional(Type.String({ maxLength: COMMUNITY_GRENZEN.mailMax, pattern: KONTAKT_MAIL_MUSTER })),
        falle: Type.Object({ feld: Type.String({ maxLength: 200 }), dauerMs: Type.Integer({ minimum: 0 }) }, strict),
    },
    strict,
);
export type KontaktBody = Static<typeof KontaktBody>;

/** Statusseite: der Schlüssel geht im Rumpf, nie in der Adresse, damit er in keinem Log steht. */
export const StatusBody = Type.Object({ schluessel: Schluessel }, strict);
export type StatusBody = Static<typeof StatusBody>;
export const StatusAntwortBody = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        text: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax }),
    },
    strict,
);
export type StatusAntwortBody = Static<typeof StatusAntwortBody>;
export const StatusZurueckziehenBody = Type.Object({ operationId: OperationId, schluessel: Schluessel }, strict);
export type StatusZurueckziehenBody = Static<typeof StatusZurueckziehenBody>;

/**
 * `POST /api/community/status/discord-loesen` (öffentlich, WI-0268 C8, Fachkonzept §8.4): löst die Verbindung mit Discord. Der Rumpf ist `StatusBody` (der Schlüssel steht im Rumpf, nie in der Adresse); die Antwort
 * nennt, aus wie vielen Vorgängen die Kennung entfernt wurde (alle Vorgänge derselben Verbindung, nicht nur dieser), 0 ohne Verbindung.
 */
export const StatusDiscordLoesenAntwort = Type.Object({ geloest: Type.Integer({ minimum: 0 }) }, strict);
export type StatusDiscordLoesenAntwort = Static<typeof StatusDiscordLoesenAntwort>;

/** Was der Melder sieht (Bedienkonzept §5): nie Notizen, nie Namen der Redaktion, keine Begründung. */
export const StatusSicht = Type.Object(
    {
        nummer: Type.String(),
        art: literals(COMMUNITY_ARTEN),
        kategorie: Type.String(),
        zustand: literals(COMMUNITY_ZUSTAENDE),
        ergebnis: Nullable(literals(COMMUNITY_ERGEBNISSE)),
        eingegangenAt: Moment,
        bezugName: Nullable(Type.String()),
        /** Der Anzeigename der verbundenen Discord-Kennung (WI-0268 C8) oder `null` ohne Verbindung; nie die Kennung selbst. */
        discordName: Type.Optional(Nullable(Type.String())),
        nachrichten: Type.Array(
            Type.Object(
                { richtung: literals(["ein", "aus"] as const), text: Nullable(Type.String()), at: Moment },
                strict,
            ),
        ),
    },
    strict,
);
export type StatusSicht = Static<typeof StatusSicht>;

/**
 * Der Stand des Moduls für das Formular: geht es gerade (Schema da, Rechte gesetzt, kein eingeschränkter Betrieb)? `mailweg` (WI-0268 C6a): ist der Versand eingerichtet (alle Angaben der Umgebung da)?
 * Fehlt auch nur eine, ist er aus, und Antworten gehen wie vor dem Mailweg auf die Statusseite. Der Wert verrät nichts über die Angaben selbst.
 */
export const CommunityStand = Type.Object(
    {
        meldungen: Type.Boolean(),
        mailweg: Type.Boolean(),
        /** Geht „Mit Discord verbinden“ (WI-0268 C8)? Ja, wenn die Anmeldung mit Discord in dieser Umgebung eingerichtet ist; der Wert verrät nichts über die Angaben. */
        discord: Type.Boolean(),
    },
    strict,
);
export type CommunityStand = Static<typeof CommunityStand>;

// --- Redaktion ------------------------------------------------------------------------------------------------------------------

export const ComParams = Type.Object({ com: Type.String({ pattern: "^(?:COM-)?\\d{1,12}$" }) }, strict);
export type ComParams = Static<typeof ComParams>;

export const VorgaengeQuery = Type.Object(
    {
        segment: Type.Optional(literals(ALLE_SEGMENTE)),
        art: Type.Optional(literals(COMMUNITY_ARTEN)),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    },
    strict,
);
export type VorgaengeQuery = Static<typeof VorgaengeQuery>;

export const CommunityPerson = Type.Object({ id: Type.String(), name: Type.String() }, strict);
export type CommunityPerson = Static<typeof CommunityPerson>;

export const VorgangZeile = Type.Object(
    {
        nummer: Type.String(),
        art: literals(COMMUNITY_ARTEN),
        kategorie: Type.String(),
        zustand: literals(COMMUNITY_ZUSTAENDE),
        ergebnis: Nullable(literals(COMMUNITY_ERGEBNISSE)),
        prioritaet: literals(COMMUNITY_PRIORITAETEN),
        eingang: literals(COMMUNITY_EINGAENGE),
        bezugName: Nullable(Type.String()),
        bezugArt: Nullable(literals(["objekt", "stelle"] as const)),
        zustaendig: Nullable(CommunityPerson),
        ohneQuelle: Type.Boolean(),
        /** Ein anderer offener Vorgang mit demselben Objekt (Hinweis, nie Sperre; Fachkonzept §4.4). */
        moeglicheDublette: Nullable(Type.String()),
        eingegangenAt: Moment,
        aktivAt: Moment,
        revision: Type.Integer(),
        /**
         * Nur bei Anfragen (WI-0268 C4, Reiter Mails; nur mit `read_mailbox`): der Absender (Name, sonst Adresse; `null` ohne beides oder nach der Frist), der Betreff (die erste Zeile der ersten Nachricht,
         * gekürzt) und ob eine Antwort der Redaktion ausgegangen ist (Abzeichen „beantwortet“).
         */
        absender: Type.Optional(Nullable(Type.String())),
        betreff: Type.Optional(Nullable(Type.String())),
        beantwortet: Type.Optional(Type.Boolean()),
        /**
         * Die zugewiesenen Sonderrollen (WI-0279, `community-rollen.ts`), in der Reihenfolge des Katalogs, je mit `mein`. Fehlt bei Anfragen und bei einem Server vor diesem
         * Stand (der Client liest tolerant).
         */
        rollen: Type.Optional(Type.Array(ZeilenRolle)),
        /** „Meine“: mir als Person zugewiesen oder einer Rolle, die ich habe (regional: in einer Region der Meldung). */
        mein: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type VorgangZeile = Static<typeof VorgangZeile>;

export const VorgangListe = Type.Object(
    {
        zeilen: Type.Array(VorgangZeile),
        /** Zahlen je Segment ohne Suche; `meine` = offene ohne Zuständigkeit (keine Person, keine Rolle) plus meine (Person oder Rolle; Zahl am Unterreiter). */
        zaehler: Type.Object(
            {
                offen: Type.Integer(),
                erledigt: Type.Integer(),
                archiv: Type.Integer(),
                papierkorb: Type.Integer(),
                meine: Type.Integer(),
                neu: Type.Integer(),
                inArbeit: Type.Integer(),
                rueckfrage: Type.Integer(),
                /** Mails (WI-0268 C4): alles im Eingang, also nicht im Archiv und nicht im Papierkorb. */
                eingang: Type.Optional(Type.Integer()),
            },
            strict,
        ),
    },
    strict,
);
export type VorgangListe = Static<typeof VorgangListe>;

/** Der Zustand einer ausgehenden Mail (WI-0268 C6a): `wartet` (wird gesendet), `gesendet` (vom Mailserver angenommen: „zugestellt“), `fehler` (nicht zugestellt, mit Grund). */
export const MAIL_ZUSTELLUNGEN = ["wartet", "gesendet", "fehler"] as const;
export type MailZustellung = (typeof MAIL_ZUSTELLUNGEN)[number];

/**
 * Der Zustellstand EINER ausgehenden Mail. `grund` ist ein kurzer Satz ohne Geheimnis (nie Nutzer oder Passwort des Mailservers); `an` die Adresse (fällt mit den Kontaktdaten nach der Frist weg);
 * `betreff` der Betreff, wie er hinausging (mit der Nummer). 🔴 Steht nur bei Nachrichten mit dem Weg `mail`, und nur dort, wo die Adresse stehen darf (`read_mailbox`).
 */
export const MailZustellstand = Type.Object(
    {
        zustand: literals(MAIL_ZUSTELLUNGEN),
        grund: Nullable(Type.String()),
        an: Nullable(Type.String()),
        betreff: Type.String(),
    },
    strict,
);
export type MailZustellstand = Static<typeof MailZustellstand>;

/**
 * Der Mailabruf (WI-0268 C6b, Fachkonzept §3.4): Grenzen und Gründe. Eine Mail über `mailBytes` wird nicht übernommen (nur ihre Kopfzeilen); die Anhänge einer Mail zusammen höchstens `anhaengeBytes`.
 * Die Sperrliste der Dateitypen steht beim Abruf (`apps/server/src/community/mail/eingang.ts`), die Oberfläche kennt nur die Gründe.
 */
export const COMMUNITY_MAIL_GRENZEN = {
    mailBytes: 30 * 1024 * 1024,
    anhaengeBytes: 25 * 1024 * 1024,
} as const;

/** Warum ein Anhang keine Datei hat: `typ` (Dateityp gesperrt, nicht übernommen), `grenze` (über der Grenze der Mail, nicht übernommen), `entfernt` (mit dem Personenbezug entfernt; die Kontaktfrist lässt Anhänge stehen). */
export const MAIL_ANHANG_GRUENDE = ["typ", "grenze", "entfernt"] as const;
export type MailAnhangGrund = (typeof MAIL_ANHANG_GRUENDE)[number];

/** Warum eine eingehende Mail nur aus Kopfzeilen besteht: `zu_gross` (über der Grenze) oder `unlesbar` (der Parser verstand sie nicht). */
export const MAIL_HINWEISE = ["zu_gross", "unlesbar"] as const;
export type MailHinweis = (typeof MAIL_HINWEISE)[number];

/**
 * Der Ereignistext, der ein Wiederöffnen durch eine neue Mail im Faden kennzeichnet (Bedienkonzept §3.4: „durch neue Nachricht wieder geöffnet“). Die Datenbank (`community_mail_eingang`, Migration 0281)
 * schreibt ihn an das Ereignis `wiedereroeffnet` (vom Melder); die Oberfläche erkennt ihn daran und setzt den Satz in der Sprache der Lesenden.
 */
export const MAIL_WIEDER_GEOEFFNET = "durch neue Nachricht wieder geöffnet";

/** Ein Anhang einer eingehenden Mail. `vorschau`: Die Datei gibt es und sie lässt sich ansehen (Bild, PDF); sonst nur Herunterladen. Ohne Datei (`gesperrt`, `entfernt`) steht der Grund. */
export const MailAnhang = Type.Object(
    {
        id: Type.Integer(),
        name: Type.String(),
        groesse: Type.Integer({ minimum: 0 }),
        mime: Type.String(),
        gesperrt: Type.Boolean(),
        grund: Nullable(literals(MAIL_ANHANG_GRUENDE)),
        vorschau: Type.Boolean(),
    },
    strict,
);
export type MailAnhang = Static<typeof MailAnhang>;

/**
 * Was eine eingehende Mail über ihren Text hinaus trägt (nur mit `read_mailbox`): der Betreff, das BEREINIGTE HTML (nie die Rohfassung), wie viele Bilder aus dem Netz die Bereinigung blockiert hat, ein Hinweis, wenn
 * die Mail nicht übernommen wurde, und die Anhänge. `html` zeigt auf eingebettete Bilder mit Adressen dieser App (`/api/community/vorgaenge/COM-…/anhaenge/…`) und trägt blockierte Bilder als `data-extern`.
 */
export const MailInhalt = Type.Object(
    {
        betreff: Type.String(),
        html: Nullable(Type.String()),
        externBilder: Type.Integer({ minimum: 0 }),
        hinweis: Nullable(literals(MAIL_HINWEISE)),
        anhaenge: Type.Array(MailAnhang),
    },
    strict,
);
export type MailInhalt = Static<typeof MailInhalt>;

/** Die Adresse eines Anhangs (`GET`, `read_mailbox`); mit `ansehen` kommt er inline (nur Bilder und PDF), sonst als Download. */
export const anhangUrl = (com: string, id: number, ansehen = false): string =>
    `${COMMUNITY_URL}/vorgaenge/${com}/anhaenge/${String(id)}${ansehen ? "?ansehen=1" : ""}`;

/** `GET /api/community/vorgaenge/:com/anhaenge/:id`. */
export const AnhangParams = Type.Object(
    { com: Type.String({ pattern: "^(?:COM-)?\\d{1,12}$" }), id: Type.String({ pattern: "^\\d{1,12}$" }) },
    strict,
);
export type AnhangParams = Static<typeof AnhangParams>;
export const AnhangQuery = Type.Object({ ansehen: Type.Optional(Type.Literal("1")) }, strict);
export type AnhangQuery = Static<typeof AnhangQuery>;

/** Ein Eintrag im Verlauf: Nachricht (nach außen oder vom Melder), Notiz (intern) oder Ereignis (wer, wann, was). */
export const VerlaufEintrag = Type.Union([
    Type.Object(
        {
            art: Type.Literal("nachricht"),
            richtung: literals(["ein", "aus"] as const),
            weg: Type.String(),
            text: Nullable(Type.String()),
            von: Nullable(CommunityPerson),
            at: Moment,
            /** Die Kennung der Nachricht und ihr Zustellstand: nur bei einer Nachricht mit dem Weg `mail` (WI-0268 C6a); „Erneut senden“ braucht die Kennung. */
            id: Type.Optional(Type.Integer()),
            zustellung: Type.Optional(MailZustellstand),
            /** Bei einer EINGEHENDEN Mail (WI-0268 C6b): Betreff, bereinigtes HTML und Anhänge; nur mit `read_mailbox`. */
            mail: Type.Optional(MailInhalt),
        },
        strict,
    ),
    Type.Object(
        { art: Type.Literal("notiz"), text: Type.String(), von: Nullable(CommunityPerson), at: Moment },
        strict,
    ),
    Type.Object(
        {
            art: Type.Literal("ereignis"),
            ereignis: Type.String(),
            alt: Nullable(Type.String()),
            neu: Nullable(Type.String()),
            text: Nullable(Type.String()),
            von: Nullable(CommunityPerson),
            vomMelder: Type.Boolean(),
            at: Moment,
        },
        strict,
    ),
]);
export type VerlaufEintrag = Static<typeof VerlaufEintrag>;

/** Woher eine Korrektur am Vorgang weiß: der Editor schrieb den Vorgang als Herkunft mit (`editor`), oder jemand verknüpfte sie von Hand (`hand`). */
export const KORREKTUR_WEGE = ["editor", "hand"] as const;
export type KorrekturWeg = (typeof KORREKTUR_WEGE)[number];

/** Eine Kartenoperation, wie sie der Vorgang zeigt: Kennung, Art (`place.update`), der Satz der Operation, Zeit und wer sie schrieb (`null` bei Agent, Import oder System). */
const KorrekturFelder = {
    operationId: Uuid,
    aktion: Type.String(),
    zusammenfassung: Nullable(Type.String()),
    at: Moment,
    von: Nullable(CommunityPerson),
};
export const VorgangKorrektur = Type.Object({ ...KorrekturFelder, weg: literals(KORREKTUR_WEGE) }, strict);
export type VorgangKorrektur = Static<typeof VorgangKorrektur>;

export const VorgangDetail = Type.Object(
    {
        zeile: VorgangZeile,
        quelle: Nullable(Type.String()),
        fehltArt: Nullable(Type.String()),
        bezug: Nullable(
            Type.Object(
                {
                    art: literals(["objekt", "stelle"] as const),
                    objektArt: Nullable(literals(BEZUG_OBJEKTARTEN)),
                    objektId: Nullable(Type.String()),
                    name: Nullable(Type.String()),
                    typ: Nullable(Type.String()),
                    lage: Nullable(Lage),
                    vorschlagLage: Nullable(Lage),
                    naechsterOrt: Nullable(Type.String()),
                    /** Meldung zu einer Bewertung (WI-0269, Fachkonzept §14.5): die öffentliche Kennung der Bewertung und der Grund; fehlt sonst. */
                    bewertungId: Type.Optional(Nullable(Type.String())),
                    bewertungGrund: Type.Optional(Nullable(Type.String())),
                    /** Meldung zu einem Reisebild (WI-0272): die Kennung des Mediums; fehlt sonst. */
                    reisebildId: Type.Optional(Nullable(Type.String())),
                    /** Seine Vorschau, nur mit `view_media_private`. Fehlt auch, wenn es das Bild nicht mehr gibt oder noch keine Vorschau hat. */
                    reisebild: Type.Optional(Type.Object({ publicId: Type.String(), url: Type.String() }, strict)),
                },
                strict,
            ),
        ),
        /**
         * Die Regionen an der Stelle des Bezugs und wer dort Ortskundiger oder Regionalkanzler ist (WI-0279 E3c): ein Hinweis, keine
         * Zuständigkeit und kein Recht. Fehlt, wo die Stelle unbekannt ist. Das Menü „Zuständig“ stellt diese Personen nach oben.
         */
        regionen: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        name: Type.String(),
                        personen: Type.Array(
                            Type.Object(
                                {
                                    person: CommunityPerson,
                                    sonderrolle: Type.String(),
                                    bezeichnung: Nullable(BezeichnungWert),
                                },
                                strict,
                            ),
                        ),
                    },
                    strict,
                ),
            ),
        ),
        /**
         * Kasten „Melder“ (bei Anfragen „Absender“): Name oder Pseudonym und die Rückwege. `mail` und `fruehere` stehen nur mit `read_mailbox` (WI-0268 C4, Fachkonzept §9: Mails enthalten Adressen): die Adresse und
         * frühere Vorgänge derselben Adresse (ohne Groß- und Kleinschreibung, ohne diesen Vorgang selbst, höchstens zehn, neueste zuerst).
         */
        melder: Type.Object(
            {
                name: Nullable(Type.String()),
                rueckwege: Type.Array(literals(["statusseite", "mail", "discord"] as const)),
                /** Der Anzeigename der verbundenen Discord-Kennung (WI-0268 C8), nie die Kennung; fehlt oder `null` ohne Verbindung. */
                discordName: Type.Optional(Nullable(Type.String())),
                entfernt: Type.Boolean(),
                mail: Type.Optional(Nullable(Type.String())),
                fruehere: Type.Optional(
                    Type.Array(
                        Type.Object(
                            {
                                nummer: Type.String(),
                                kategorie: Type.String(),
                                ergebnis: Nullable(literals(COMMUNITY_ERGEBNISSE)),
                                eingegangenAt: Moment,
                            },
                            strict,
                        ),
                    ),
                ),
            },
            strict,
        ),
        /** Ausdrückliche Beziehungen (WI-0268 C4): „Als Meldung weiterführen“ verknüpft Meldung und Anfrage (`gehoert_zu`); `richtung` sagt, ob dieser Vorgang die Quelle (`von`) oder das Ziel (`zu`) ist. */
        verknuepft: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        art: literals(["gehoert_zu"] as const),
                        richtung: literals(["von", "zu"] as const),
                        nummer: Type.String(),
                    },
                    strict,
                ),
            ),
        ),
        /**
         * Korrekturen an der Karte, die zu diesem Vorgang gehören (WI-0268 C7, Fachkonzept §6), neueste zuerst, ohne Doppelte: die Operationen, die der Editor mit diesem Vorgang als Herkunft schrieb
         * (`editor`, Migration 0272), und die, die jemand von Hand verknüpfte (`hand`, Migration 0273). Fehlt, wenn es keine gibt.
         */
        korrekturen: Type.Optional(Type.Array(VorgangKorrektur)),
        /** Die Vorgänge im Betreiber-Kanal, an die dieser weitergereicht wurde (nur die OPS-Nummern; Fachkonzept §7). Fehlt, wenn es keinen gibt. */
        kanal: Type.Optional(Type.Array(Type.Object({ nummer: Type.String() }, strict))),
        dubletteVon: Nullable(Type.String()),
        papierkorbAt: Nullable(Moment),
        archiviertAt: Nullable(Moment),
        verlauf: Type.Array(VerlaufEintrag),
        /** Kasten „Zuständig“ (WI-0279): wer die zuständige Person einsetzte und wann; fehlt ohne Person oder ohne passendes Ereignis. */
        zustaendigSeit: Type.Optional(Nullable(ZustaendigSeit)),
        /** Die zugewiesenen Sonderrollen mit Absender, Zeit, Inhabern und (regional) Regionen; fehlt ohne Zuweisung und bei Anfragen. */
        rollen: Type.Optional(Type.Array(VorgangRolle)),
        /** Blatt „Sonderrollen zuweisen“: zu jeder Rolle des Katalogs, wer sie für diese Meldung hat. Fehlt bei Anfragen oder ohne lesbare Sonderrollen. */
        rollenInhaber: Type.Optional(Type.Array(RollenInhaber)),
    },
    strict,
);
export type VorgangDetail = Static<typeof VorgangDetail>;

const Aenderung = { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) };
export const VorgangSchrittBody = Type.Object(Aenderung, strict);
export type VorgangSchrittBody = Static<typeof VorgangSchrittBody>;
export const ZustaendigBody = Type.Object({ ...Aenderung, person: Nullable(Uuid) }, strict);
export type ZustaendigBody = Static<typeof ZustaendigBody>;
export const PrioritaetBody = Type.Object({ ...Aenderung, prioritaet: literals(COMMUNITY_PRIORITAETEN) }, strict);
export type PrioritaetBody = Static<typeof PrioritaetBody>;
/** Notizen prüfen keine Revision: Sie hängen nur an und stören niemanden, der gerade etwas anderes am Vorgang tut. */
export const NotizBody = Type.Object(
    { operationId: OperationId, text: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.notizMax }) },
    strict,
);
export type NotizBody = Static<typeof NotizBody>;
export const RueckfrageBody = Type.Object(
    { ...Aenderung, text: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax }) },
    strict,
);
export type RueckfrageBody = Static<typeof RueckfrageBody>;
export const AbschliessenBody = Type.Object(
    {
        ...Aenderung,
        ergebnis: literals([
            "umgesetzt",
            "bereits_richtig",
            "abgelehnt",
            "dublette",
            "weitergereicht",
            "beantwortet",
            "erledigt",
        ] as const),
        begruendung: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.begruendungMax }),
        nachricht: Type.Optional(Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax })),
        dubletteVon: Type.Optional(Type.String({ pattern: "^(?:COM-)?\\d{1,12}$" })),
    },
    strict,
);
export type AbschliessenBody = Static<typeof AbschliessenBody>;
export const GrundBody = Type.Object(
    { ...Aenderung, grund: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.begruendungMax }) },
    strict,
);
export type GrundBody = Static<typeof GrundBody>;

/**
 * Antworten auf eine Anfrage (WI-0268 C4, Fachkonzept §3.4, Bedienkonzept §3.3): eine Nachricht nach außen (vor dem Mailweg die Statusseite), Zustand „wartet auf Antwort“. Mit `archivieren` geht die Anfrage
 * gleich ins Archiv (Ergebnis `beantwortet`). Braucht `answer_community`.
 */
/** `discord` (WI-0297): Der Absender kam aus Discord und hat weder Statuslink noch Adresse; er liest die Antwort mit `/offen`. Der Server schreibt sie wie für die Statusseite. */
export const MAIL_WEGE = ["mail", "statusseite", "discord"] as const;
export type MailWeg = (typeof MAIL_WEGE)[number];

export const AnfrageAntwortBody = Type.Object(
    {
        ...Aenderung,
        text: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax }),
        archivieren: Type.Boolean(),
        /**
         * Wohin die Antwort geht (WI-0268 C6a). Vorgabe `mail`, wenn der Mailweg an ist und der Absender eine Adresse hat, sonst `statusseite`. 🔴 Der Empfänger einer Mail ist immer die Adresse
         * des Vorgangs, nie eine Angabe der Anfrage: Der Rumpf kennt keine Adresse, damit die Antwort nie ein offenes Relay wird.
         */
        weg: Type.Optional(literals(MAIL_WEGE)),
    },
    strict,
);
export type AnfrageAntwortBody = Static<typeof AnfrageAntwortBody>;

/** `POST /api/community/mails` (`send_new_mail`, WI-0268 C6a): eine neue Mail an eine freie Adresse. Ergebnis: ein Vorgang im Eingang, „von Avesmaps begonnen“, Zustand „wartet auf Antwort“. */
export const NeueMailBody = Type.Object(
    {
        operationId: OperationId,
        an: Type.String({ minLength: 3, maxLength: COMMUNITY_GRENZEN.mailMax, pattern: MAIL_ADRESSE_MUSTER }),
        betreff: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.betreffNeuMax }),
        text: Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax }),
    },
    strict,
);
export type NeueMailBody = Static<typeof NeueMailBody>;
export const NeueMailAntwort = Type.Object({ nummer: Type.String() }, strict);
export type NeueMailAntwort = Static<typeof NeueMailAntwort>;

/** `POST /api/community/vorgaenge/:com/nachrichten/:id/erneut-senden` (`answer_community`): eine nicht zugestellte Mail noch einmal in den Versand geben. */
export const ErneutSendenParams = Type.Object(
    { com: Type.String({ pattern: "^(?:COM-)?\\d{1,12}$" }), id: Type.String({ pattern: "^\\d{1,12}$" }) },
    strict,
);
export type ErneutSendenParams = Static<typeof ErneutSendenParams>;
export const ErneutSendenBody = Type.Object({ operationId: OperationId }, strict);
export type ErneutSendenBody = Static<typeof ErneutSendenBody>;

/**
 * „Als Meldung weiterführen“ (Fachkonzept §3.1): legt aus der Anfrage eine Meldung mit Bezug an (Eingang Redaktion, ohne Melderdaten), verknüpft beide, und die Anfrage kommt ins Archiv. Mit `antwort` geht
 * dem Absender zugleich eine Antwort auf die Statusseite (braucht `answer_community`); ohne ist die Anfrage `erledigt`.
 */
export const AlsMeldungBody = Type.Object(
    {
        ...Aenderung,
        kategorie: literals(MELDUNG_KATEGORIEN),
        text: Type.String({ minLength: COMMUNITY_GRENZEN.textMin, maxLength: COMMUNITY_GRENZEN.textMax }),
        quelle: Type.Optional(Type.String({ maxLength: COMMUNITY_GRENZEN.quelleMax })),
        fehltArt: Type.Optional(literals(FEHLT_ARTEN)),
        bezug: MeldungBezug,
        antwort: Type.Optional(Type.String({ minLength: 1, maxLength: COMMUNITY_GRENZEN.nachrichtMax })),
    },
    strict,
);
export type AlsMeldungBody = Static<typeof AlsMeldungBody>;
export const AlsMeldungAntwort = Type.Object(
    { nummer: Type.String(), revision: Type.Integer(), meldung: Type.String() },
    strict,
);
export type AlsMeldungAntwort = Static<typeof AlsMeldungAntwort>;

/** `GET /api/community/gesendet?q` (`read_mailbox`): die ausgehenden Nachrichten der Anfragen, neueste zuerst (Bedienkonzept §3.4). */
export const GesendetQuery = Type.Object({ q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })) }, strict);
export type GesendetQuery = Static<typeof GesendetQuery>;
export const GesendetZeile = Type.Object(
    {
        nummer: Type.String(),
        /** Die Adresse des Absenders der Anfrage; `null`: die Antwort ging auf die Statusseite. */
        an: Nullable(Type.String()),
        betreff: Nullable(Type.String()),
        text: Nullable(Type.String()),
        at: Moment,
        von: Nullable(CommunityPerson),
        weg: Type.String(),
        /** Der Zustellstand: nur bei `weg = mail` (WI-0268 C6a). */
        zustellung: Type.Optional(MailZustellstand),
    },
    strict,
);
export type GesendetZeile = Static<typeof GesendetZeile>;
export const GesendetListe = Type.Object({ zeilen: Type.Array(GesendetZeile) }, strict);
export type GesendetListe = Static<typeof GesendetListe>;

// --- Verknüpfungen (WI-0268 C7) -------------------------------------------------------------------------------------------------

/**
 * `GET /api/community/vorgaenge/:com/korrektur-kandidaten`: die Operationen, aus denen die Redaktion eine Korrektur verknüpfen kann. Mit Objektbezug (`quelle` `objekt`) die letzten 15, die dieses Objekt
 * betreffen, sonst (`sitzung`) die letzten 15 eigenen; was schon verknüpft ist, fehlt.
 */
export const KorrekturKandidat = Type.Object(KorrekturFelder, strict);
export type KorrekturKandidat = Static<typeof KorrekturKandidat>;
export const KorrekturKandidaten = Type.Object(
    { quelle: literals(["objekt", "sitzung"] as const), kandidaten: Type.Array(KorrekturKandidat) },
    strict,
);
export type KorrekturKandidaten = Static<typeof KorrekturKandidaten>;

/** `POST …/korrektur` (`moderate_submissions`): die Operation `ziel` (Kennung aus „Änderungen“) gehört zu diesem Vorgang. Wiederholen ändert nichts; der Vorgang ändert weder Zustand noch Revision. */
export const KorrekturBody = Type.Object({ operationId: OperationId, ziel: Uuid }, strict);
export type KorrekturBody = Static<typeof KorrekturBody>;

/**
 * `POST …/an-kanal` (`moderate_submissions` und `use_operator_channel`): legt im Betreiber-Kanal der eigenen Umgebung einen Vorgang an und verknüpft ihn. Titel und Nachricht schreibt die Person; der Server
 * nimmt weder Name noch Adresse noch Text des Melders dazu, nur die COM-Nummer als Verweis (Fachkonzept §7).
 */
export const AnKanalBody = Type.Object(
    {
        operationId: OperationId,
        kategorie: literals(KANAL_KATEGORIEN),
        prioritaet: literals(KANAL_PRIORITAETEN),
        titel: Type.String({ minLength: 1, maxLength: 120 }),
        nachricht: Type.String({ minLength: 1, maxLength: 8000 }),
    },
    strict,
);
export type AnKanalBody = Static<typeof AnKanalBody>;
/** Die COM-Nummer des Vorgangs und die OPS-Nummer, unter der er jetzt auch im Kanal steht. */
export const AnKanalAntwort = Type.Object({ nummer: Type.String(), ops: Type.String() }, strict);
export type AnKanalAntwort = Static<typeof AnKanalAntwort>;

/** Antwort jeder Änderung: die neue Revision des Vorgangs. */
export const VorgangQuittung = Type.Object({ nummer: Type.String(), revision: Type.Integer() }, strict);
export type VorgangQuittung = Static<typeof VorgangQuittung>;

/** Fachcodes der Fehler (ADR-0018); die Oberfläche bildet sie auf Sätze ab. */
export const COMMUNITY_FEHLER = [
    "community_not_found",
    "community_conflict",
    "community_transition",
    "community_invalid",
    "community_forbidden",
    "community_rate",
    "community_unavailable",
    /** Die Tagesgrenze für neue Mails an freie Adressen ist erreicht (WI-0268 C6a, 429). */
    "community_mail_grenze",
] as const;
export type CommunityFehler = (typeof COMMUNITY_FEHLER)[number];
