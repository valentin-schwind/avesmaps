import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { KANAL_STATUS } from "./kanal.ts";
import { OperationId } from "./operation.ts";

/**
 * Benachrichtigungen in der Leiste (WI-0136, NACHRICHT-0001 §3): die eigenen der letzten Zeit, die Zahl der ungelesenen, „gelesen“ und die
 * Antwort „Gelöst“ / „Noch nicht gelöst“ auf „Fix ist live“. Erzeugt werden sie nur in der Datenbank (`benachrichtige`, Migration 0107),
 * heute vom Betreiber-Kanal. Den Satz baut die Oberfläche aus `art`, Absender und OPS-ID; `text` ist höchstens ein Zusatz ohne
 * Meldungstext (der Kurztitel eines Vorgangs).
 */

export const BENACHRICHTIGUNG_URL = "/api/benachrichtigungen";
/** Die Seite fragt in diesem Takt nach, solange sie sichtbar ist, und beim Zurückkehren (ETag, sonst 304). */
export const BENACHRICHTIGUNG_TAKT_MS = 60_000;
/** So viele der eigenen Benachrichtigungen kommen mit (die jüngsten). */
export const BENACHRICHTIGUNG_SEITE = 50;

export const BENACHRICHTIGUNG_ARTEN = [
    "kanal_antwort",
    "kanal_rueckfrage",
    "kanal_zur_abnahme",
    "kanal_fix_live",
    "kanal_wiederherstellung",
    "kanal_uebernommen",
    // Neue Stände (Migration 0118): nach einem grünen automatischen Stage-Rollout und nach einer Production-Freigabe. Beide trägt
    // Claudios Korridor ein; der Text ist die Kurzinfo, der Link führt auf „Versionen“ bzw. „Production“.
    "stage_neu",
    "production_neu",
    // Störungen im Betrieb an die Betreiber (WI-0179; Betreiber 2026-10-15 nach acht Stunden stillem Warten: Probleme müssen sich
    // melden). `auftrag_haengt` meldet die App, wenn der Dirigent einen Auftrag ihrer Umgebung als hängend führt (`haengt` im Stand,
    // `apps/server/src/jobs/haengt-melder.ts`); der Text ist die Bezeichnung des Auftrags. `betrieb_alarm` ist Claudios Wächter der
    // Warteschlange (`ops/jobs/warteschlangen-waechter.sh`), der Text sein Befund.
    "auftrag_haengt",
    "betrieb_alarm",
    // Der Abgleich der Sonderrollen mit Production (WI-0279, `apps/server/src/auth/sonderrollen-abgleich.ts`): Die Stage meldet selbst, wenn er länger als
    // 30 Minuten gestört ist, und noch einmal, wenn er danach wieder läuft. Ohne Text; der Satz steht in der Sprachtafel.
    "sonderrollen_gestoert",
    "sonderrollen_wieder",
    // Der Prüflauf nach jedem Push (WI-0201; Betreiber 2026-10-16: „nein die prüfung geschieht auf dem server, aber sie muss
    // stattfinden und als ergebnis an die glocke gehen“). Claudios Lauf auf dem VPS reiht sie über die Warteschlange ein; das
    // Urteil steht im Satz der Tafel, der Text trägt Stand, Schritt und erste Fehlerzeile. Grün nur beim Wechsel von Rot.
    "pruefung_rot",
    "pruefung_gruen",
    // Die eigenen Aufträge sind abgearbeitet (WI-0230; Betreiber 2026-10-19: „wenn die warteschlange abgearbeitet ist, kann sie die
    // glocke benachrichtigen“). Der Ausführer meldet sie der auslösenden Person, je Folge einmal (`apps/server/src/jobs/folge-fertig.ts`):
    // `warteschlange_fertig`, wenn die Karte alles selbst nachlädt, `warteschlange_fertig_laden`, wenn erst Neuladen es zeigt,
    // `warteschlange_fehler`, wenn ein Auftrag scheiterte oder abgebrochen wurde. Ohne Text.
    "warteschlange_fertig",
    "warteschlange_fertig_laden",
    "warteschlange_fehler",
    // Eine Freigabe für Production erlosch (WI-0234): Serverprüfung rot, Kandidat ungültig (Paket fehlt, kein Nachfahre, Sammellauf nicht
    // mehr grün). Claudios Nachtlauf und Abholer reihen sie über die Warteschlange ein (`benachrichtigung_einreihen`, Migration 0207);
    // der Text ist der Grund.
    "freigabe_erloschen",
    // Die Meldungen der Community (WI-0268 C5, Fachkonzept WI-0263 §7): Sätze aus Art und COM-Nummer, nie aus dem Meldetext, nie mit dem
    // Namen des Melders. Die Nummer steht im `text`; `bezug_ops` bleibt der Kanal-Nummer (OPS-…) vorbehalten. Erzeugt von der App
    // (`apps/server/src/community/glocke.ts`) und von der täglichen Aufbewahrung (`community_frist`), nie über die Warteschlange.
    "community_neu",
    // Eine neue Anfrage aus dem Kontaktformular (WI-0268 C4, Fachkonzept §7): an alle mit `read_mailbox`, Satz „Neue Nachricht COM-…“, nie mit dem Inhalt. Eine eigene Art statt `community_neu`, denn
    // die ist gebündelt („3 neue Meldungen“) und kennt nur Meldungen; Anfragen gehen an einen engeren Kreis und tragen immer ihre Nummer.
    "community_nachricht",
    "community_zugewiesen",
    // Eine Meldung wurde einer Sonderrolle zugewiesen (WI-0279, Vali 2026-11-11): an die Inhaber der NEU hinzugekommenen Rolle (regional: in einer Region der Meldung), die Meldungen
    // bearbeiten dürfen, außer der Person, die zuweist; beim Eingang von Avesmaps (`von_art` `system`). Gebündelt je Empfänger, Absender und Rolle, solange ungelesen; der `text` ist die
    // Rolle und die COM-Nummern (`leseRollenGlocke`, `community-rollen.ts`), nie ein Text der Meldung.
    "community_rolle",
    "community_antwort",
    "community_frist",
    // Eine ausgehende Mail wurde nicht zugestellt (WI-0268 C6a, Bedienkonzept WI-0263 §3.3): an die Person, die sie schrieb; Satz aus Art und COM-Nummer, nie aus dem Inhalt der Mail. Erzeugt vom
    // Versandjob (`community_mail_versand`) mit der Jobs-Rolle, nie über die Warteschlange der Benachrichtigungen.
    "community_mail_fehler",
    // Ein Beitrag des Social Hubs wartet auf Freigabe (WI-0270 C11, Fachkonzept WI-0263 §15.9): an die Betreiber, Satz aus Art und SOC-Nummer, nie aus dem
    // Text des Beitrags. Erzeugt von der App beim Vorlegen und vom täglichen Lauf für die Vorschläge der Routine, nie über die Warteschlange.
    "social_freigabe",
    // Ein neues Reisebild wartet auf Prüfung (WI-0272 S3, Aufgabe 19): an alle mit `moderate_submissions` (ab Reviewer), gebündelt wie `community_neu`. Der `text` ist leer (eine Einreichung) oder die Zahl
    // (mehrere), nie Beschreibung oder Name des Einsenders. Erzeugt von der App beim Einreichen, Ersetzen des Bildes und einer wartenden Beschreibung (`community/glocke.ts`), nie über die Warteschlange.
    "photobox_eingang",
    // Eine neue Bewertung wartet aufs Sichten (Vali 2026-11-04): an alle mit `moderate_submissions`, gebündelt wie `community_neu`. Der `text` ist die Kennung der Bewertung (eine) oder die Zahl (mehrere),
    // nie Text oder Name des Verfassers. Erzeugt von der App beim Schreiben (`community/glocke.ts`), nie über die Warteschlange.
    "bewertung_neu",
    // Ein neuer Kartenvorschlag wartet auf die Redaktion (WI-0275, Vali 2026-11-04): an alle mit `moderate_map_suggestions`, gebündelt wie `community_neu`. Der `text` ist die Kennung des Vorschlags (einer) oder die
    // Zahl (mehrere), nie Titel oder Name des Einreichers. Erzeugt von der App beim Eingang (`community/glocke.ts`), nie über die Warteschlange.
    "kartenvorschlag_neu",
] as const;

/**
 * Die Arten der Community (WI-0268 C5). 🔴 Sie kommen nie über die Warteschlange (Jobart `benachrichtigung`): Die Tür
 * `benachrichtigung_einreihen` kennt sie nicht, und die App und der Aufbewahrungsjob rufen `benachrichtige()` selbst.
 */
export const COMMUNITY_GLOCKEN_ARTEN: readonly string[] = [
    "community_neu",
    "community_nachricht",
    "community_zugewiesen",
    "community_rolle",
    "community_antwort",
    "community_frist",
    "community_mail_fehler",
];

/**
 * Die Arten des Social Hubs (WI-0270 C11). 🔴 Wie die der Community: nie über die Warteschlange (Jobart `benachrichtigung`), die App und der Aufbewahrungsjob
 * rufen `benachrichtige()` selbst. Der `text` ist die SOC-Nummer, nie Titel oder Text des Beitrags.
 */
export const SOCIAL_GLOCKEN_ARTEN: readonly string[] = ["social_freigabe"];

/**
 * Die Arten der Reisebilder (WI-0272 S3, Aufgabe 19). 🔴 Wie die der Community und des Social Hubs: nie über die Warteschlange (Jobart `benachrichtigung`), die App ruft
 * `benachrichtige()` selbst, in der Transaktion der Handlung. Der `text` ist leer oder die Zahl, nie ein Text der Einreichung.
 */
export const PHOTOBOX_GLOCKEN_ARTEN: readonly string[] = ["photobox_eingang"];

/** Die Arten der Bewertungen (Vali 2026-11-04). 🔴 Wie die der Reisebilder: Die App meldet in der Transaktion der Handlung, nie über die Warteschlange. Der `text` ist die Kennung der Bewertung oder die Zahl. */
export const BEWERTUNG_GLOCKEN_ARTEN: readonly string[] = ["bewertung_neu"];

/** Die Arten der Kartenvorschläge (WI-0275). 🔴 Wie die der Bewertungen: Die App meldet in der Transaktion der Handlung, nie über die Warteschlange. Der `text` ist die Kennung des Vorschlags oder die Zahl, nie Titel oder Name. */
export const KARTENVORSCHLAG_GLOCKEN_ARTEN: readonly string[] = ["kartenvorschlag_neu"];

/**
 * `community_neu` ist gebündelt: Solange jemand eine ungelesene hat, entsteht keine zweite, sondern die Zahl wächst (Bedienkonzept WI-0263
 * §2.2 Nr. 1). Der `text` trägt dann die COM-Nummer (eine Meldung: „Neue Meldung COM-000123“) oder die Zahl (mehrere: „3 neue Meldungen“),
 * ohne neue Spalte und ohne Migration. Gibt die Zahl zurück, wenn der Text eine ist, sonst `undefined`.
 */
export function communityNeuAnzahl(text: string | null): number | undefined {
    if (text === null || !/^[0-9]{1,6}$/u.test(text)) return undefined;
    const n = Number(text);
    return n >= 1 ? n : undefined;
}

/**
 * `photobox_eingang` ist gebündelt wie `community_neu`: Die erste Einreichung trägt keinen Text, ab der zweiten steht die Zahl im `text` („3 neue Reisebilder zur Prüfung“). Gibt die
 * Zahl zurück, wenn der Text eine ist, sonst `undefined` - was sonst im Text stünde, wird nie gezeigt.
 */
export function photoboxEingangAnzahl(text: string | null): number | undefined {
    return communityNeuAnzahl(text);
}

/**
 * Störungen im Betrieb (WI-0179). 🔴 Sie kommen nie über die Warteschlange (Jobart `benachrichtigung`): Eine Meldung darüber, dass
 * die Warteschlange hängt, darf nicht in eben dieser Warteschlange warten.
 */
export const STOERUNG_ARTEN: readonly string[] = [
    "auftrag_haengt",
    "betrieb_alarm",
    "sonderrollen_gestoert",
    "sonderrollen_wieder",
];

/** Das Ende der eigenen Aufträge (WI-0230): Nur der Ausführer meldet es, nie ein Auftrag der Warteschlange (Jobart `benachrichtigung`). */
export const WARTESCHLANGE_ARTEN: readonly string[] = [
    "warteschlange_fertig",
    "warteschlange_fertig_laden",
    "warteschlange_fehler",
];

/** Arten, die aus dem Kanal kommen: nur sie haben einen Vorgang, und nur sie verschwinden mit `KANAL=aus`. */
export const KANAL_ARTEN = BENACHRICHTIGUNG_ARTEN.filter((art) => art.startsWith("kanal_"));
export type BenachrichtigungArt = (typeof BENACHRICHTIGUNG_ARTEN)[number];
export const BENACHRICHTIGUNG_ANTWORTEN = ["geloest", "nicht_geloest"] as const;
export type BenachrichtigungAntwort = (typeof BENACHRICHTIGUNG_ANTWORTEN)[number];

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/** Wer etwas schickt: Claudia, Claudio, das System oder eine Person (mit Kennung und Namen; nach einer Kontoauflösung der Platzhalter). */
export const BenachrichtigungVon = Type.Object(
    {
        art: literals(["claudia", "claudio", "person", "system"] as const),
        id: Nullable(Type.String()),
        name: Nullable(Type.String()),
    },
    strict,
);
export type BenachrichtigungVon = Static<typeof BenachrichtigungVon>;

export const Benachrichtigung = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        /**
         * 🔴 Gelesen wird jede Art, nicht nur die des Katalogs (WI-0181): Seit 0118 prüft die Datenbank die Art nicht mehr, und ein
         * älteres Release liest Arten, die erst ein neueres schreibt (Blue/Green-Wechsel, Rücksprung der Stage, Production vor der
         * Freigabe). Die Oberfläche zeigt sie als unbekannten Satz (`notify.text.unbekannt`); als Liste des Katalogs warf die
         * Serialisierung hier 500. Was geschrieben wird, prüft weiter der Katalog (`BenachrichtigungArt`).
         */
        art: Type.String(),
        von: BenachrichtigungVon,
        /** Der Vorgang im Kanal (`OPS-000127`) oder nichts. */
        ops: Nullable(Type.String()),
        text: Nullable(Type.String()),
        /** Die Vorschau des Reisebilds, das eine neue Meldung betrifft (`community_neu`, „Melden“ in der Bildansicht, WI-0272): beim Lesen ergänzt, nur mit `view_media_private`; sonst fehlt das Feld. */
        bilder: Type.Optional(Type.Array(Type.Object({ publicId: Type.String(), url: Type.String() }, strict))),
        /** „Gelöst?“ steht nur bei „Fix ist live“ an der meldenden Person. */
        frageGeloest: Type.Boolean(),
        erstelltAt: Moment,
        gelesenAt: Nullable(Moment),
        beantwortetAt: Nullable(Moment),
        antwort: Nullable(literals(BENACHRICHTIGUNG_ANTWORTEN)),
        /**
         * Der Stand des Vorgangs jetzt, für die Knöpfe und den Satz danach („Abgenommen von Thomas, 10:15“); nur mit dem Kanal
         * (`use_operator_channel`), sonst `null`.
         */
        vorgang: Nullable(
            Type.Object(
                {
                    status: literals(KANAL_STATUS),
                    abgenommenVon: Nullable(Type.String()),
                    abgenommenAt: Nullable(Moment),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type Benachrichtigung = Static<typeof Benachrichtigung>;

export const BenachrichtigungListe = Type.Object(
    { ungelesen: Type.Integer({ minimum: 0 }), eintraege: Type.Array(Benachrichtigung) },
    strict,
);
export type BenachrichtigungListe = Static<typeof BenachrichtigungListe>;

/** `POST /api/benachrichtigungen/gelesen`: alle eigenen bis zu dieser Kennung als gelesen. */
export const BenachrichtigungGelesenBody = Type.Object({ bis: Type.Integer({ minimum: 1 }) }, strict);
export type BenachrichtigungGelesenBody = Static<typeof BenachrichtigungGelesenBody>;
export const BenachrichtigungGelesen = Type.Object({ ungelesen: Type.Integer({ minimum: 0 }) }, strict);
export type BenachrichtigungGelesen = Static<typeof BenachrichtigungGelesen>;

export const BenachrichtigungParams = Type.Object({ id: Type.Integer({ minimum: 1 }) }, strict);

/** `POST /api/benachrichtigungen/:id/antwort`: „Gelöst“ nimmt ab, „Noch nicht gelöst“ öffnet mit Kommentar wieder (W2). */
export const BenachrichtigungAntwortBody = Type.Object(
    {
        operationId: OperationId,
        antwort: literals(BENACHRICHTIGUNG_ANTWORTEN),
        kommentar: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
    },
    strict,
);
export type BenachrichtigungAntwortBody = Static<typeof BenachrichtigungAntwortBody>;
