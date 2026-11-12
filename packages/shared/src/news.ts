import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * Die Neuigkeiten (WI-0139; Betreiber 2026-10-13: „es wird auch zeit bei "Production" den "Neuigkeiten-Kanal" fürs frontend freizuschalten.
 * in legacy hatten wir dazu eine tägliche routine von claudia, die das nochmal zusammengefasst hat. das war für "normale" nutzer erklärt,
 * was gerade auf avesmaps.de passiert").
 *
 * - **Was Besucher lesen**, wenn sie unten in der Ecke „Neuigkeiten“ öffnen: je Eintrag ein Datum, ein Titel, ein Absatz und eine Rubrik.
 *   Kein Markdown, kein HTML — Text bleibt Text, wie im Kanal.
 * - **Woher sie kommen:** aus Legacys Bestand (103 Einträge vom 22.04. bis 10.10.2026, einmalig eingespielt) und ab jetzt aus Claudios
 *   täglicher Routine, die liest, was **in Production** neu ist.
 * - 🔴 **Erst Entwurf, dann sichtbar** (Betreiber 2026-10-13: „erst entwurf, wie empfohlen“). Die Routine legt an, ein Betreiber gibt frei.
 *   Legacy veröffentlichte sofort; der Unterschied ist bewusst, weil hier ein Agent öffentlichen Text auf avesmaps.de schreibt.
 * - **Das dauerhafte Archiv:** Was der Kasten „✦ Neue Version“ einmal sagte und was die Glocke meldete, steht danach hier — die Glocke
 *   räumt nach 90 Tagen auf, die Neuigkeiten bleiben.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const NEWS_URL = "/api/news";
export const NEWS_ADMIN_URL = "/api/admin/system/news";

/** So lange darf eine Antwort zwischengespeichert werden (Legacy: 10 min). */
export const NEWS_CACHE_S = 600;
/** So viele Einträge kommen je Seite (die jüngsten zuerst). */
export const NEWS_SEITE = 50;

/**
 * Die Rubriken: Legacys vier (`changelog_entry.category`) und seit WI-0217 `programm` und `ki` (Betreiber 2026-10-17: „Außerdem haben
 * wir noch 2 rubriken: Programm und KI“). 🔴 Hier und nicht als `CHECK` in der Datenbank: Eine neue Rubrik wäre sonst ein
 * `DROP CONSTRAINT` mitten im Blue/Green-Wechsel (dieselbe Lehre wie bei den Jobarten und den Benachrichtigungsarten, Migration 0118).
 * Ein unbekannter Name landet in der Anzeige ohne Marke, statt zu brechen; so liest auch ein älteres Release die neuen.
 */
export const NEWS_RUBRIKEN = ["karte", "routenplaner", "inhalte", "community", "programm", "ki"] as const;
export type NewsRubrik = (typeof NEWS_RUBRIKEN)[number];

export function istNewsRubrik(wert: string): wert is NewsRubrik {
    return (NEWS_RUBRIKEN as readonly string[]).includes(wert);
}

/**
 * Der Zustand eines Eintrags: `entwurf` sieht nur, wer die Neuigkeiten pflegt; `sichtbar` steht öffentlich; `versteckt` ist
 * zurückgenommen (nie gelöscht — ein missglückter Satz wird unsichtbar, nicht spurlos).
 */
export const NEWS_ZUSTAENDE = ["entwurf", "sichtbar", "versteckt"] as const;
export type NewsZustand = (typeof NEWS_ZUSTAENDE)[number];

/** Ein Tag als `JJJJ-MM-TT`, wie ihn das Datumsfeld liefert. */
export const NEWS_DATUM_MUSTER = "^\\d{4}-\\d{2}-\\d{2}$";

/** Grenzen der Felder; dieselben prüft die Datenbank. */
export const NEWS_TITEL_MAX = 200;
export const NEWS_TEXT_MAX = 4000;

/** Ein Eintrag, wie Besucher ihn sehen. Keine Kennung einer Person, kein `source_ref`, kein Zustand. */
export const NewsEintrag = Type.Object(
    {
        id: Type.Integer({ minimum: 1 }),
        /** Tag, auf den sich der Eintrag bezieht (`2026-10-13`), nicht der Zeitpunkt des Schreibens. */
        datum: Type.String({ minLength: 10, maxLength: 10 }),
        titel: Type.String({ minLength: 1, maxLength: NEWS_TITEL_MAX }),
        text: Type.String({ minLength: 1, maxLength: NEWS_TEXT_MAX }),
        /** Eine der vier Rubriken; ein unbekannter Name kommt als er selbst und steht ohne Marke da. */
        rubrik: Type.String(),
    },
    strict,
);
export type NewsEintrag = Static<typeof NewsEintrag>;

/** `GET /api/news`: öffentlich, mit ETag und `max-age`. */
export const NewsListe = Type.Object(
    {
        /** Das Datum des jüngsten sichtbaren Eintrags; ohne Einträge `null`. */
        stand: Nullable(Type.String()),
        eintraege: Type.Array(NewsEintrag),
    },
    strict,
);
export type NewsListe = Static<typeof NewsListe>;

// --- Pflege (Systemsteuerung, Rolle Betreiber) -------------------------------------------------------------------

/** Ein Eintrag in der Pflege: mit Zustand, Herkunft und dem, was Besucher nicht sehen. */
export const NewsEintragVoll = Type.Object(
    {
        ...NewsEintrag.properties,
        zustand: literals(NEWS_ZUSTAENDE),
        /**
         * Nur auf der Stage (WI-0217): nach dem letzten Production-Zug angelegt, geändert oder gelöscht. Der nächste Zug ersetzt ihn durch
         * den Stand von Production. Wo kein Production-Zug ankommt, immer `false`.
         */
        nurStage: Type.Boolean(),
        /** Woher er stammt: `routine` (Claudios Lauf), `legacy` (Startbestand) oder der Anzeigename der Person. */
        herkunft: Type.String(),
        /** Der Stand, aus dem die Routine ihn geschrieben hat (Release oder Commit); von Hand angelegt `null`. */
        quelle: Nullable(Type.String()),
        erstelltAt: Type.String(),
        /** Wann er sichtbar wurde; als Entwurf `null`. */
        freigegebenAt: Nullable(Type.String()),
        freigegebenVon: Nullable(Type.String()),
        /**
         * Aus dem Social Hub (WI-0270 C11, Entscheidung E9): die Nummer des Beitrags (`SOC-000012`), aus dem der Eintrag stammt; die Seite zeigt „aus SOC-000012“. Fehlt bei den Einträgen von Hand und aus Legacy
         * und wo der Hub nicht da ist (Stage ohne das Community-Schema). Freiwillig: Ein Server der Vorversion schickt das Feld nicht.
         */
        beitrag: Type.Optional(Nullable(Type.String())),
    },
    strict,
);
export type NewsEintragVoll = Static<typeof NewsEintragVoll>;

/** Ein Eintrag im Papierkorb (WI-0217): aus der Liste und von avesmaps.de genommen, nicht gelöscht, zurückholbar. */
export const NewsImKorb = Type.Object(
    {
        ...NewsEintragVoll.properties,
        geloeschtAt: Type.String(),
        geloeschtVon: Nullable(Type.String()),
    },
    strict,
);
export type NewsImKorb = Static<typeof NewsImKorb>;

/**
 * Der Stand gegenüber Production, nur wo ein Production-Zug ankommt (die Stage; WI-0217, Betreiber 2026-10-17: „neuigkeiten wandern immer
 * von production -> stage“). Der Zug ersetzt alle Neuigkeiten durch die von Production.
 */
export const NewsStageStand = Type.Object(
    {
        /** Ende des letzten erfolgreichen Production-Zugs; ohne einen `null`. */
        letzterZug: Nullable(Type.String()),
        /** Wie viele Einträge nur hier geändert sind, Papierkorb eingeschlossen. */
        nurStage: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type NewsStageStand = Static<typeof NewsStageStand>;

/** `GET /api/admin/system/news`. */
export const NewsPflege = Type.Object(
    {
        /** Wie viele Entwürfe auf eine Freigabe warten — die Zahl an der Schiene. */
        entwuerfe: Type.Integer({ minimum: 0 }),
        eintraege: Type.Array(NewsEintragVoll),
        /** Der Papierkorb, zuletzt Gelöschtes zuerst. */
        papierkorb: Type.Array(NewsImKorb),
        /** Nur wo ein Production-Zug ankommt; sonst `null`. */
        stage: Nullable(NewsStageStand),
    },
    strict,
);
export type NewsPflege = Static<typeof NewsPflege>;

/**
 * `POST /api/admin/system/news` — einen Eintrag von Hand anlegen, direkt sichtbar, denn ein Mensch hat ihn geschrieben; auf Wunsch als
 * Entwurf (WI-0217).
 *
 * 🔴 **Die Reihenfolge bleibt das Datum** (WI-0217): `nach` ist der Eintrag, unter dem eingefügt wurde. Hat der neue dasselbe Datum, steht
 * er direkt darunter; sonst an der Spitze seines Tages, wie ohne `nach`.
 */
export const NewsAnlegenBody = Type.Object(
    {
        operationId: OperationId,
        datum: Type.String({ pattern: NEWS_DATUM_MUSTER }),
        titel: Type.String({ minLength: 1, maxLength: NEWS_TITEL_MAX }),
        text: Type.String({ minLength: 1, maxLength: NEWS_TEXT_MAX }),
        rubrik: literals(NEWS_RUBRIKEN),
        nach: Type.Optional(Type.Integer({ minimum: 1 })),
        zustand: Type.Optional(literals(["sichtbar", "entwurf"] as const)),
    },
    strict,
);
export type NewsAnlegenBody = Static<typeof NewsAnlegenBody>;

/**
 * `POST /api/admin/system/news/:id` — Text, Datum und Rubrik bessern, den Zustand setzen, in den Papierkorb und zurück. Jedes Feld ist
 * freiwillig; was fehlt, bleibt. Ein neues Datum stellt den Eintrag an die Spitze seines Tages.
 *
 * `papierkorb` (WI-0217) steht allein: `true` nimmt den Eintrag aus der Liste und von avesmaps.de (ein sichtbarer wird zugleich versteckt),
 * `false` holt ihn mit seinem Zustand von davor zurück. 🔴 Gelöscht wird nie (WI-0139).
 */
export const NewsAendernBody = Type.Object(
    {
        operationId: OperationId,
        titel: Type.Optional(Type.String({ minLength: 1, maxLength: NEWS_TITEL_MAX })),
        text: Type.Optional(Type.String({ minLength: 1, maxLength: NEWS_TEXT_MAX })),
        datum: Type.Optional(Type.String({ pattern: NEWS_DATUM_MUSTER })),
        rubrik: Type.Optional(literals(NEWS_RUBRIKEN)),
        zustand: Type.Optional(literals(NEWS_ZUSTAENDE)),
        papierkorb: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type NewsAendernBody = Static<typeof NewsAendernBody>;

export const NewsParams = Type.Object({ id: Type.Integer({ minimum: 1 }) }, strict);

/**
 * Die Fachcodes (ADR-0018): `news_not_found` (404) diesen Eintrag gibt es nicht; `news_unavailable` (503) diese Umgebung führt keine
 * Neuigkeiten (die Tabelle fehlt, weil 0119 noch nicht angewandt ist); `news_papierkorb_allein` (400) `papierkorb` kam zusammen mit
 * einer anderen Änderung (WI-0217).
 */
export const NEWS_ERROR_STATUS = {
    news_not_found: 404,
    news_unavailable: 503,
    news_papierkorb_allein: 400,
} as const;
export type NewsErrorCode = keyof typeof NEWS_ERROR_STATUS;

/**
 * Die Datei des Startbestands (`config/news/legacy-seed.json`, von Claudio aus Legacy gelesen). Sie wird einmal eingespielt und bleibt im
 * Repository, weil Legacy jederzeit wegfallen kann — der Satz muss ohne es wiederherstellbar sein.
 */
export const NewsSeed = Type.Object(
    {
        schema: Type.Literal(1),
        /** Woher und wann (`legacy.avesmaps.de`, ISO-Zeitpunkt); nur zur Nachvollziehbarkeit. */
        quelle: Type.String(),
        gelesenAt: Type.String(),
        eintraege: Type.Array(
            Type.Object(
                {
                    datum: Type.String({ minLength: 10, maxLength: 10 }),
                    titel: Type.String({ minLength: 1, maxLength: NEWS_TITEL_MAX }),
                    text: Type.String({ minLength: 1, maxLength: NEWS_TEXT_MAX }),
                    rubrik: Type.String(),
                    /** Legacys `sort_order` innerhalb eines Tages; ohne Wert die Reihenfolge der Datei. */
                    reihe: Type.Optional(Type.Integer()),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type NewsSeed = Static<typeof NewsSeed>;
