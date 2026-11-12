import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";
import { AbgleichAuftrag, AbgleichLauf } from "./abgleiche.ts";

/**
 * Der Abzug für lokal (WI-0251; ADR-0013 „Daten nur nach unten, nur als Kopie, Konten wandern nie“; Vali 2026-10-24: „ja von stage und
 * production, aber ohne die accounts, statistiken und alle kartendaten auch“).
 *
 * Ein Abzug ist EINE Datei (`abzug.tar`) mit allen Kartendaten einer Umgebung, ohne Konten, Betrieb, Statistik und Protokolle mit Personenbezug,
 * und mit leeren Personenfeldern. Welche Tafel mitkommt und welche Spalte leer wird, steht in `config/abzug/regeln.json` (Schema unten); ein Test
 * hält sie gegen das Schema der Datenbank. Den Abzug schreibt Claudios Korridor in einer lesenden Transaktion; die App listet ihn auf Stage und
 * Production und liefert ihn mit kurzlebigem Link aus; lokal spielt sie ihn ein.
 *
 *     GET  /api/admin/system/abzug                    Stand der Rolle dieser Umgebung              create_backup (V)
 *     POST /api/admin/system/abzug/erstellen          { operationId }                              create_backup + Passkey   (Stage, Production)
 *     POST /api/admin/system/abzug/link               { operationId, kennung }                     create_backup + Passkey   (Stage, Production)
 *     GET  /api/admin/system/abzug/datei/:token       die Datei, einmal, nur für die Person        create_backup (V)         (Stage, Production)
 *     PUT  /api/admin/system/abzug/eingang?name=…     die Datei lokal hinlegen und prüfen          run_abzug_einspielen (V)  (nur lokal)
 *     POST /api/admin/system/abzug/einspielen         { operationId, kennung }                     run_abzug_einspielen + Passkey (nur lokal)
 *     POST /api/admin/system/abzug/schluessel         { operationId, tage }                        create_backup + Passkey   (Stage, Production)
 *     POST /api/admin/system/abzug/schluessel/widerrufen { operationId, id }                       create_backup + Passkey   (Stage, Production)
 *     GET  /api/abzug-holen/liste                     die Abzüge dieser Umgebung                   Abzugs-Schlüssel          (Stage, Production)
 *     GET  /api/abzug-holen/:kennung/datei            die Datei als Strom, mit Range               Abzugs-Schlüssel          (Stage, Production)
 *     POST /api/admin/system/abzug/quelle             { operationId, quelle, schluessel }          run_abzug_einspielen      (nur lokal)
 *     POST /api/admin/system/abzug/holen              { operationId, quelle }                      run_abzug_einspielen + Passkey (nur lokal)
 *
 * - **Holen statt Herunterladen und Hochladen** (Vali 2026-10-25): Der Entwicklungsrechner holt den neuesten Abzug selbst über HTTPS und spielt ihn
 *   ein. Er weist sich mit einem **Abzugs-Schlüssel** aus, den ein Admin mit Passkey auf der Quelle anlegt (Ablaufdatum, widerrufbar, im Protokoll);
 *   der Schlüssel darf nur die Abzüge dieser Umgebung auflisten und herunterladen, sonst nichts. Er liegt lokal außerhalb des Repositorys, nie in einer
 *   Ausgabe. Einen Abzug anzustoßen bleibt Sache der Quelle (Passkey dort), nicht des Schlüssels.
 *
 * - 🔴 **Rolle je Umgebung, nie beides.** Stage und Production erstellen und liefern aus (`erstellen`), die lokale Entwicklung spielt ein
 *   (`einspielen`); der Server entscheidet (`AVESMAPS_ENV`, `ABZUG_ROOT`), die Oberfläche zeigt nur, was er schickt.
 * - 🔴 **Einspielen nur lokal und nur auf Knopfdruck der Betreiber**, mit Sicherung davor (Map Mutation Guard: Es ersetzt die Daten der lokalen
 *   Entwicklungsdatenbank). Stage und Production werden nur gelesen.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const ABZUG_URL = "/api/admin/system/abzug";
export const ABZUG_FORMAT = "avesmaps-abzug";
export const ABZUG_VERSION = 1;
export const ABZUG_REGELN_FORMAT = "avesmaps-abzug-regeln";
export const ABZUG_REGELN_VERSION = 1;
/** Die Jobart, mit der die App Claudios Export anfordert (Migration 0218); sie hat in der App keinen Handler. */
export const ABZUG_JOB_ART = "abzug_lokal";
/** Aus welchen Umgebungen ein Abzug kommt (so heißt `--quelle` im Plan und der Ordner in der Ablage). */
export const ABZUG_QUELLEN = ["staging", "production"] as const;
export type AbzugQuelle = (typeof ABZUG_QUELLEN)[number];
export const ABZUG_ROLLEN = ["erstellen", "einspielen"] as const;
export type AbzugRolle = (typeof ABZUG_ROLLEN)[number];

/** Die Dateien eines Abzugs in der Ablage: `<ABZUG_ROOT>/<quelle>/<kennung>/`. */
export const ABZUG_DATEI_TAR = "abzug.tar";
export const ABZUG_DATEI_MANIFEST = "manifest.json";
/** Im Tar: das Manifest zuerst, dann je Tafel eine Datei unter `tafeln/`. */
export const ABZUG_TAR_MANIFEST = "manifest.json";
export const ABZUG_TAR_TAFELN = "tafeln/";
/** Im Tar: danach je Mediendatei `medien/<Schlüssel wie unter MEDIA_ROOT>` (`media_file.storage_key`). */
export const ABZUG_TAR_MEDIEN = "medien/";

/**
 * Die Verzeichnisse unter `MEDIA_ROOT`, aus denen Dateien mitkommen: die Speicherklassen von `media_file` (Migration 0064). `private/evidence`
 * (Genehmigungsbelege), `private/kanal` und `incoming` kommen nie mit.
 */
export const ABZUG_MEDIEN_VERZEICHNISSE = ["private/source", "master", "derivatives", "published"] as const;
const MEDIEN_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]{0,127}";
const MEDIEN_PFAD = new RegExp(`^(?:${ABZUG_MEDIEN_VERZEICHNISSE.join("|")})(?:/${MEDIEN_SEGMENT}){1,8}$`, "u");
/** Die längste Pfadlänge, die ein Medienpfad haben darf. */
export const ABZUG_MEDIEN_PFAD_MAX = 240;

/**
 * Ist das ein Schlüssel, den der Abzug als Datei unter `MEDIA_ROOT` anlegen darf? Relativ, mit `/`, in einem der vier Verzeichnisse der
 * Speicherklassen, jedes Stück beginnt mit Buchstabe oder Ziffer (also nie `.`, `..` oder leer), nur Buchstaben, Ziffern, `.`, `_`, `-`.
 * Kein Laufwerk, kein Rückwärtsschritt, kein Rückwärtsstrich: Was Claudios Export oder ein manipuliertes Manifest nennt, kann den Ordner
 * nie verlassen.
 */
export function istSichererMedienPfad(pfad: unknown): pfad is string {
    return typeof pfad === "string" && pfad.length <= ABZUG_MEDIEN_PFAD_MAX && MEDIEN_PFAD.test(pfad);
}

/** Höchstens so viele Abzüge je Umgebung hält die Ablage, und so lange (Vertrag mit Claudio, Handover 2026-10-24). */
export const ABZUG_HOECHSTENS = 2;
export const ABZUG_AUFBEWAHRUNG_STUNDEN = 24;
/** Wie lange ein Link zum Herunterladen gilt. */
export const ABZUG_LINK_SEKUNDEN = 120;

/** Wo der Entwicklungsrechner die Abzüge einer Umgebung abholt (Stage, Production): hinter dem Schlüssel, nicht hinter der Anmeldung. */
export const ABZUG_HOLEN_URL = "/api/abzug-holen";
/**
 * Der Abzugs-Schlüssel: `abz_` und 32 Byte Zufall als base64url (43 Zeichen). Der Vorsatz sagt, was es ist (ein Fund im Chat oder Journal fällt auf);
 * zur Prüfung auf dem Server zählt allein der Hash des Ganzen.
 */
export const ABZUG_SCHLUESSEL_MUSTER = "^abz_[A-Za-z0-9_-]{43}$";
export function istAbzugSchluessel(wert: unknown): wert is string {
    return typeof wert === "string" && new RegExp(ABZUG_SCHLUESSEL_MUSTER).test(wert);
}
/** Wie lange ein neuer Schlüssel gelten darf (Tage), und wie viele zugleich gültig sein dürfen. */
export const ABZUG_SCHLUESSEL_TAGE = [30, 90, 365] as const;
export const ABZUG_SCHLUESSEL_HOECHSTENS = 5;

/** Die Kennung eines Abzugs (Ordnername in der Ablage, `kennung` im Manifest): Claudio wählt sie, die App prüft nur die Form. */
export const ABZUG_KENNUNG_MUSTER = "^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$";
export function istAbzugKennung(wert: unknown): wert is string {
    return typeof wert === "string" && new RegExp(ABZUG_KENNUNG_MUSTER).test(wert) && !wert.includes("..");
}

/**
 * Die Stufen des Exports, die Claudios Skript am Auftrag meldet (`job_sync_phase`, Migration 0218). 🪤 Die Anteile stehen auch in der
 * Datenbankfunktion; ein Test hält beide gleich.
 */
export const ABZUG_PHASEN = [
    { name: "vorbereiten", progress: 0.05 },
    { name: "lesen", progress: 0.15 },
    { name: "packen", progress: 0.8 },
    { name: "ablegen", progress: 0.95 },
] as const;

/** Der Name einer Tafel in den Regeln: `schema.tafel`. */
export const ABZUG_TAFEL_MUSTER = "^[a-z_][a-z0-9_]*\\.[a-z_][a-z0-9_]*$";
const Tafelname = Type.String({ pattern: ABZUG_TAFEL_MUSTER });
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

// --- Regeln (config/abzug/regeln.json) ---------------------------------------------------------------------------

/** Was an die Stelle eines verdeckten Personenfeldes tritt (Typ `uuid` beziehungsweise `text`): Es gibt kein Konto mehr, das dazugehört. */
export const ABZUG_PLATZHALTER_UUID = "00000000-0000-0000-0000-000000000000";
export const ABZUG_PLATZHALTER_TEXT = "(entfernt)";

/**
 * Eine Zeile der Regeln. `mitnehmen`: die Tafel kommt mit, die Spalten in `leeren` als `NULL` (Personenfelder). Verlangt das Schema selbst
 * einen Wert (NOT NULL, eine CHECK-Bedingung, die die Spalte nennt), steht sie stattdessen in `verdecken`: `NULL` bleibt `NULL`, jeder andere
 * Wert wird zum Platzhalter (`ABZUG_PLATZHALTER_*`), so dass jede Bedingung gilt, die nur von „leer oder nicht leer“ abhängt.
 * `weglassen`: die Tafel bleibt zu Hause. Ein `weglassen` kann `vorausgesetzt` sein (eine mitgenommene Tafel verweist auf sie; sie muss lokal
 * gleich sein, wie `map_domain`) oder `lokalLeeren` (ihre lokalen Zeilen verweisen auf mitgenommene Tafeln und gehen beim Einspielen mit weg).
 */
export const AbzugRegelTafel = Type.Object(
    {
        art: literals(["mitnehmen", "weglassen"] as const),
        grund: Type.Optional(Type.String({ minLength: 1 })),
        leeren: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true, minItems: 1 })),
        verdecken: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true, minItems: 1 })),
        /** Zeilen, die nicht mitkommen: Der Wert von `spalte` steht in `nicht`, etwa verborgene Bewertungen samt Text (Personenbezug). */
        ohneZeilen: Type.Optional(
            Type.Object(
                {
                    spalte: Type.String({ minLength: 1 }),
                    nicht: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true, minItems: 1 }),
                },
                strict,
            ),
        ),
        vorausgesetzt: Type.Optional(Type.Boolean()),
        lokalLeeren: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type AbzugRegelTafel = Static<typeof AbzugRegelTafel>;

export const AbzugRegeln = Type.Object(
    {
        format: Type.Literal(ABZUG_REGELN_FORMAT),
        version: Type.Literal(ABZUG_REGELN_VERSION),
        beschreibung: Type.Optional(Type.String()),
        /** Ganze Schemata, die nie mitkommen (Konten, Kanal, Betrieb), mit dem Grund. Nur `public` wird je gelesen. */
        schemataWeglassen: Type.Record(Type.String({ pattern: "^[a-z_][a-z0-9_]*$" }), Type.String({ minLength: 1 }), {
            additionalProperties: false,
        }),
        tafeln: Type.Record(Tafelname, AbzugRegelTafel, { additionalProperties: false }),
        /**
         * Die Mediendateien: Welche Tafel sie nennt und in welchen Spalten (Schlüssel unter `MEDIA_ROOT`, Größe, SHA-256). Die Tafel muss
         * `mitnehmen` sein; `media_rights_evidence` (Belege) und die Kartenserien (Kacheln unter `TILE_ROOT`) kommen nicht mit.
         */
        medien: Type.Object(
            {
                tafel: Tafelname,
                schluessel: Type.String({ minLength: 1 }),
                groesse: Type.String({ minLength: 1 }),
                sha256: Type.String({ minLength: 1 }),
                beschreibung: Type.Optional(Type.String()),
            },
            strict,
        ),
    },
    strict,
);
export type AbzugRegeln = Static<typeof AbzugRegeln>;

// --- Manifest (manifest.json im Tar und neben ihm) ---------------------------------------------------------------

export const AbzugSpalte = Type.Object(
    { name: Type.String({ minLength: 1 }), typ: Type.String({ minLength: 1 }) },
    strict,
);
export type AbzugSpalte = Static<typeof AbzugSpalte>;

export const AbzugManifestTafel = Type.Object(
    {
        tafel: Tafelname,
        /** Pfad im Tar, `tafeln/<schema>.<tafel>.bin`: die Tafel als `COPY … TO STDOUT (FORMAT binary)`. */
        datei: Type.String({ pattern: "^tafeln/[a-z0-9_.]+\\.bin$" }),
        /** Die Spalten in der Reihenfolge der Datei, mit dem Typ so, wie `format_type` ihn schreibt. */
        spalten: Type.Array(AbzugSpalte, { minItems: 1 }),
        /** Die Spalten, die als `NULL` geschrieben wurden (Personenfelder), zur Kontrolle. */
        leeren: Type.Array(Type.String()),
        /** Die Spalten, deren Werte durch den Platzhalter ersetzt wurden (Personenfelder, die das Schema nicht leer lässt). */
        verdeckt: Type.Array(Type.String()),
        zeilen: Type.Integer({ minimum: 0 }),
        sha256: Sha256,
    },
    strict,
);
export type AbzugManifestTafel = Static<typeof AbzugManifestTafel>;

/** Eine Mediendatei im Tar: `medien/<pfad>`, mit der Größe und der Prüfsumme der Bytes im Tar (wie `sha256sum` auf der Datei). */
export const AbzugMedium = Type.Object(
    { pfad: Type.String({ minLength: 1, maxLength: 1024 }), groesse: Type.Integer({ minimum: 0 }), sha256: Sha256 },
    strict,
);
export type AbzugMedium = Static<typeof AbzugMedium>;

export const AbzugManifest = Type.Object(
    {
        format: Type.Literal(ABZUG_FORMAT),
        version: Type.Literal(ABZUG_VERSION),
        kennung: Type.String({ pattern: ABZUG_KENNUNG_MUSTER }),
        quelle: literals(ABZUG_QUELLEN),
        erstellt: Type.String({ minLength: 10 }),
        regeln: Type.Object({ version: Type.Integer({ minimum: 1 }), pruefsumme: Sha256 }, strict),
        /** Das Migrationsjournal der Quelle (`schema_migration`, nach Version geordnet). */
        migrationen: Type.Array(
            Type.Object({ version: Type.String({ minLength: 1 }), checksum: Type.String({ minLength: 1 }) }, strict),
        ),
        /** Die Kartendomänen der Quelle (`map_domain`): lokal müssen sie gleich sein. */
        kartendomaenen: Type.Array(
            Type.Object(
                {
                    id: Type.String({ minLength: 1 }),
                    koordinatenraum: Type.String({ minLength: 1 }),
                    pruefsumme: Type.String({ minLength: 1 }),
                },
                strict,
            ),
            { minItems: 1 },
        ),
        /** In der Reihenfolge des Einspielens (Eltern vor Kindern). */
        tafeln: Type.Array(AbzugManifestTafel, { minItems: 1 }),
        /**
         * Die Mediendateien im Tar: genau die, deren Zeilen in der Medientafel stehen (`regeln.medien`) und deren Datei an der Quelle lag, aus
         * derselben lesenden Transaktion wie die Tafeln.
         */
        medien: Type.Array(AbzugMedium),
        /** Schlüssel, deren Zeile da ist, deren Datei an der Quelle aber fehlte; sie kommen nicht mit und sind kein Fehler. */
        medienFehlend: Type.Array(Type.String({ minLength: 1, maxLength: 1024 })),
    },
    strict,
);
export type AbzugManifest = Static<typeof AbzugManifest>;

/** Der Kopf des Manifests, den der Plan ausgibt: alles, was Claudios Skript nicht erst messen muss (Zeilen und Prüfsumme fehlen noch). */
export const AbzugPlanTafel = Type.Object(
    {
        tafel: Tafelname,
        datei: Type.String(),
        spalten: Type.Array(AbzugSpalte, { minItems: 1 }),
        leeren: Type.Array(Type.String()),
        verdeckt: Type.Array(Type.String()),
        /** Was gelesen wird: ein `SELECT` mit den Spalten der Datei, Personenfelder als `NULL` oder Platzhalter. */
        abfrage: Type.String(),
        /** Der Befehl für diese Tafel (`COPY (<abfrage>) TO STDOUT (FORMAT binary)`), ohne Semikolon. */
        copy: Type.String(),
    },
    strict,
);
export type AbzugPlanTafel = Static<typeof AbzugPlanTafel>;

/** Was der Plan über die Mediendateien sagt: welche Zeilen zu welchen Dateien führen. */
export const AbzugPlanMedien = Type.Object(
    {
        tafel: Tafelname,
        /**
         * Gelesen in derselben Transaktion wie die Tafeln: je Zeile `pfad` (Schlüssel unter `MEDIA_ROOT`), `groesse` und `sha256` laut Zeile. Der
         * Export legt zu jeder Zeile die Datei `<MEDIA_ROOT>/<pfad>` als `medien/<pfad>` ins Tar und trägt Größe und Prüfsumme der Bytes im Manifest
         * ein; fehlt die Datei, steht der Pfad in `medienFehlend`.
         */
        abfrage: Type.String(),
        verzeichnis: Type.Literal(ABZUG_TAR_MEDIEN),
        /** Aus welchem Verzeichnis der Quelle die Dateien kommen (die Umgebungsvariable des Dienstes dort). */
        wurzel: Type.Literal("MEDIA_ROOT"),
        /** Nur diese Anfänge sind Schlüssel (Speicherklassen); alles andere ist ein Fehler des Exports. */
        verzeichnisse: Type.Array(Type.String()),
    },
    strict,
);
export type AbzugPlanMedien = Static<typeof AbzugPlanMedien>;

export const AbzugPlan = Type.Object(
    {
        format: Type.Literal("avesmaps-abzug-plan"),
        version: Type.Literal(1),
        quelle: literals(ABZUG_QUELLEN),
        regeln: Type.Object({ version: Type.Integer({ minimum: 1 }), pruefsumme: Sha256 }, strict),
        /** Die Transaktion, in der alles gelesen wird. */
        transaktion: Type.Literal("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"),
        /** Die zwei Abfragen für den Kopf des Manifests: das Journal und die Kartendomänen. */
        abfragen: Type.Object({ migrationen: Type.String(), kartendomaenen: Type.String() }, strict),
        /** Eltern vor Kindern. Tafeln in einem Kreis stehen zusätzlich in `zyklen` (das Einspielen schiebt dort die Prüfung auf). */
        tafeln: Type.Array(AbzugPlanTafel, { minItems: 1 }),
        medien: AbzugPlanMedien,
        zyklen: Type.Array(Type.Array(Tafelname)),
    },
    strict,
);
export type AbzugPlan = Static<typeof AbzugPlan>;

// --- Routen -------------------------------------------------------------------------------------------------------

export const AbzugDatei = Type.Object(
    {
        kennung: Type.String(),
        erstellt: Type.String(),
        bytes: Type.Integer({ minimum: 0 }),
        tafeln: Type.Integer({ minimum: 0 }),
        zeilen: Type.Integer({ minimum: 0 }),
        /** Mediendateien im Tar und ihre Größe zusammen (ohne die Tafeln). */
        medien: Type.Integer({ minimum: 0 }),
        medienBytes: Type.Integer({ minimum: 0 }),
        /** Wann die Ablage ihn löscht (24 h nach dem Erstellen). */
        laeuftAb: Type.String(),
    },
    strict,
);
export type AbzugDatei = Static<typeof AbzugDatei>;

/** Ein Abzugs-Schlüssel in der Liste der Quelle: nie sein Wert, nur was man zum Verwalten braucht. */
export const ABZUG_SCHLUESSEL_ZUSTAENDE = ["gueltig", "abgelaufen", "widerrufen"] as const;
export const AbzugSchluessel = Type.Object(
    {
        id: Type.String(),
        zustand: literals(ABZUG_SCHLUESSEL_ZUSTAENDE),
        angelegt: Type.String(),
        laeuftAb: Type.String(),
        /** Wer ihn angelegt hat (Anzeigename); `null`, wenn das Konto nicht mehr zu lesen ist. */
        von: Nullable(Type.String()),
        zuletzt: Nullable(Type.String()),
    },
    strict,
);
export type AbzugSchluessel = Static<typeof AbzugSchluessel>;

/** Stage und Production: der Auftrag, der letzte Lauf und die fertigen Abzüge in der Ablage. */
export const AbzugSichtErstellen = Type.Object(
    {
        rolle: Type.Literal("erstellen"),
        jetzt: Type.String(),
        umgebung: literals(ABZUG_QUELLEN),
        /** Gibt es die Ablage (`ABZUG_ROOT`)? Ohne sie steht der Knopf gesperrt mit Satz da. */
        ablage: Type.Boolean(),
        planerAktiv: Nullable(Type.Boolean()),
        laufend: Nullable(AbgleichAuftrag),
        letzter: Nullable(AbgleichLauf),
        abzuege: Type.Array(AbzugDatei),
        /** Die Schlüssel zum Abholen (gültige und die der letzten Wochen), neueste zuerst. */
        schluessel: Type.Array(AbzugSchluessel),
    },
    strict,
);
export type AbzugSichtErstellen = Static<typeof AbzugSichtErstellen>;

/**
 * Was gegen das Einspielen spricht. `format`, `version`, `datei` und `pruefsumme` (Datei kaputt oder kein Abzug), `migrationen_lokal_alt`
 * (lokal fehlt eine Migration der Quelle: erst `npm run db:migrate`), `migrationen_abweichend` (dieselbe Version mit anderer Prüfsumme),
 * `kartendomaene` (andere Domäne oder anderer Koordinatenraum), `regeln` (der Abzug folgt anderen Regeln als dieser Stand),
 * `tafel_fehlt` und `spalten` (die Tafel gibt es lokal nicht oder anders), `rechte` (der Rolle fehlen Rechte). Zu den Mediendateien:
 * `medien_pfad` (das Manifest nennt einen Pfad, der nicht unter `MEDIA_ROOT` angelegt werden darf, oder einen doppelt), `medien_ablage`
 * (`MEDIA_ROOT` ist nicht eingerichtet oder nicht beschreibbar), `medien_platz` (auf dem Datenträger ist zu wenig Platz für die Dateien).
 */
export const ABZUG_PROBLEME = [
    "format",
    "version",
    "datei",
    "pruefsumme",
    "migrationen_lokal_alt",
    "migrationen_abweichend",
    "kartendomaene",
    "regeln",
    "tafel_fehlt",
    "spalten",
    "rechte",
    "medien_pfad",
    "medien_ablage",
    "medien_platz",
] as const;
export type AbzugProblemCode = (typeof ABZUG_PROBLEME)[number];

export const AbzugProblem = Type.Object({ code: literals(ABZUG_PROBLEME), detail: Nullable(Type.String()) }, strict);
export type AbzugProblem = Static<typeof AbzugProblem>;

/** Die Datei, die lokal bereitliegt, mit dem Ergebnis der Prüfung vor dem Einspielen. */
export const AbzugEingang = Type.Object(
    {
        name: Type.String(),
        bytes: Type.Integer({ minimum: 0 }),
        kennung: Type.String(),
        quelle: literals(ABZUG_QUELLEN),
        erstellt: Type.String(),
        tafeln: Type.Integer({ minimum: 0 }),
        zeilen: Type.Integer({ minimum: 0 }),
        /** Die Mediendateien im Abzug, ihre Größe zusammen, und wie viele schon an der Quelle fehlten (Zeile ohne Datei). */
        medien: Type.Integer({ minimum: 0 }),
        medienBytes: Type.Integer({ minimum: 0 }),
        medienFehlend: Type.Integer({ minimum: 0 }),
        /** Leer: Die Prüfung ist bestanden, der Knopf geht. */
        probleme: Type.Array(AbzugProblem),
    },
    strict,
);
export type AbzugEingang = Static<typeof AbzugEingang>;

export const ABZUG_LAUF_ZUSTAENDE = ["laeuft", "fertig", "fehler"] as const;
export type AbzugLaufZustand = (typeof ABZUG_LAUF_ZUSTAENDE)[number];

/** Die Schritte des lokalen Einspielens in ihrer Reihenfolge; die Oberfläche übersetzt den Namen. */
export const ABZUG_EINSPIELEN_PHASEN = [
    "holen",
    "pruefen",
    "medienpruefen",
    "sicherung",
    "leeren",
    "laden",
    "folgen",
    "medien",
    "fertig",
] as const;
export type AbzugEinspielenPhase = (typeof ABZUG_EINSPIELEN_PHASEN)[number];

/** Was das Ablegen der Mediendateien ergab: wie viele der Abzug trägt, wie viele neu geschrieben wurden, wie viele ausstehen (`offen`). */
export const AbzugLaufMedien = Type.Object(
    {
        dateien: Type.Integer({ minimum: 0 }),
        geschrieben: Type.Integer({ minimum: 0 }),
        offen: Type.Integer({ minimum: 0 }),
        bytes: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type AbzugLaufMedien = Static<typeof AbzugLaufMedien>;

export const AbzugLauf = Type.Object(
    {
        kennung: Type.String(),
        zustand: literals(ABZUG_LAUF_ZUSTAENDE),
        phase: Nullable(literals(ABZUG_EINSPIELEN_PHASEN)),
        /** Bei `laden`: welche Tafel gerade und wie viele von wie vielen. */
        tafel: Nullable(Type.String()),
        fortschritt: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
        seit: Type.String(),
        ende: Nullable(Type.String()),
        zeilen: Nullable(Type.Integer({ minimum: 0 })),
        /** Wo die Sicherung der bisherigen Daten liegt (Dateiname), sobald es sie gibt. */
        sicherung: Nullable(Type.String()),
        /** Bei `fehler`: der Satz (nie ein Pfad mit Geheimnis); die Daten sind dann unverändert. */
        meldung: Nullable(Type.String()),
        /** Bei `holen`: von welcher Quelle, wie viele Bytes schon da sind und wie viele es werden. */
        holen: Type.Optional(
            Nullable(
                Type.Object(
                    {
                        quelle: literals(ABZUG_QUELLEN),
                        geladen: Type.Integer({ minimum: 0 }),
                        gesamt: Type.Integer({ minimum: 0 }),
                    },
                    strict,
                ),
            ),
        ),
        /** Nach dem Ersetzen der Datenbank: die Mediendateien. `offen > 0`: unvollständig, ein erneutes Einspielen derselben Datei holt sie nach. */
        medien: Type.Optional(Nullable(AbzugLaufMedien)),
    },
    strict,
);
export type AbzugLauf = Static<typeof AbzugLauf>;

/** Lokal: die Datei, die bereitliegt, und das Einspielen. */
export const AbzugSichtEinspielen = Type.Object(
    {
        rolle: Type.Literal("einspielen"),
        jetzt: Type.String(),
        /** Gibt es einen Ort für Eingang und Sicherung (`ABZUG_ROOT`)? */
        ablage: Type.Boolean(),
        /** Gibt es `pg_dump` für die Sicherung vorher? Ohne bleibt der Knopf gesperrt: Es wird nie ohne Sicherung ersetzt. */
        sicherung: Type.Boolean(),
        eingang: Nullable(AbzugEingang),
        lauf: Nullable(AbzugLauf),
        /** Für welche Quelle ein Schlüssel hinterlegt ist (nie der Wert); ohne ihn geht „Abzug holen und einspielen“ dort nicht. */
        schluessel: Type.Object({ staging: Type.Boolean(), production: Type.Boolean() }, strict),
    },
    strict,
);
export type AbzugSichtEinspielen = Static<typeof AbzugSichtEinspielen>;

export const AbzugSicht = Type.Union([AbzugSichtErstellen, AbzugSichtEinspielen]);
export type AbzugSicht = Static<typeof AbzugSicht>;

export const AbzugErstellenBody = Type.Object({ operationId: OperationId }, strict);
export type AbzugErstellenBody = Static<typeof AbzugErstellenBody>;

export const AbzugLinkBody = Type.Object(
    { operationId: OperationId, kennung: Type.String({ pattern: ABZUG_KENNUNG_MUSTER }) },
    strict,
);
export type AbzugLinkBody = Static<typeof AbzugLinkBody>;

export const AbzugLink = Type.Object(
    { url: Type.String(), gueltigBis: Type.String(), dateiname: Type.String() },
    strict,
);
export type AbzugLink = Static<typeof AbzugLink>;

export const AbzugEinspielenBody = Type.Object(
    { operationId: OperationId, kennung: Type.String({ pattern: ABZUG_KENNUNG_MUSTER }) },
    strict,
);
export type AbzugEinspielenBody = Static<typeof AbzugEinspielenBody>;

export const AbzugSchluesselBody = Type.Object(
    { operationId: OperationId, tage: Type.Union(ABZUG_SCHLUESSEL_TAGE.map((tage) => Type.Literal(tage))) },
    strict,
);
export type AbzugSchluesselBody = Static<typeof AbzugSchluesselBody>;

/** Die Antwort auf das Anlegen: der einzige Moment, in dem der Wert des Schlüssels zu sehen ist. */
export const AbzugSchluesselNeu = Type.Object(
    { id: Type.String(), schluessel: Type.String({ pattern: ABZUG_SCHLUESSEL_MUSTER }), laeuftAb: Type.String() },
    strict,
);
export type AbzugSchluesselNeu = Static<typeof AbzugSchluesselNeu>;

export const AbzugSchluesselWiderrufBody = Type.Object(
    { operationId: OperationId, id: Type.String({ format: "uuid" }) },
    strict,
);
export type AbzugSchluesselWiderrufBody = Static<typeof AbzugSchluesselWiderrufBody>;

/** `GET /api/abzug-holen/liste`: die Abzüge der Umgebung, neueste zuerst. */
export const AbzugHolenListe = Type.Object(
    { umgebung: literals(ABZUG_QUELLEN), jetzt: Type.String(), abzuege: Type.Array(AbzugDatei) },
    strict,
);
export type AbzugHolenListe = Static<typeof AbzugHolenListe>;

/** Lokal: den Schlüssel einer Quelle hinterlegen (`schluessel` gesetzt) oder entfernen (`null`). */
export const AbzugQuelleBody = Type.Object(
    {
        operationId: OperationId,
        quelle: literals(ABZUG_QUELLEN),
        schluessel: Nullable(Type.String({ pattern: ABZUG_SCHLUESSEL_MUSTER })),
    },
    strict,
);
export type AbzugQuelleBody = Static<typeof AbzugQuelleBody>;

/** Lokal: den neuesten Abzug der Quelle holen und einspielen. */
export const AbzugHolenBody = Type.Object({ operationId: OperationId, quelle: literals(ABZUG_QUELLEN) }, strict);
export type AbzugHolenBody = Static<typeof AbzugHolenBody>;

/**
 * Die Fachcodes (ADR-0018): `abzug_ablage_fehlt` (503) diese Instanz hat keine Ablage; `abzug_laeuft` (409) ein Auftrag wartet oder läuft
 * schon, oder lokal läuft ein Einspielen; `abzug_unbekannt` (404) so einen Abzug gibt es nicht (mehr); `abzug_link_ungueltig` (410) der Link
 * ist abgelaufen oder gehört einer anderen Person; `abzug_datei_ungueltig` (422) die Datei ist kein Abzug; `abzug_einspielen_gesperrt` (409)
 * die Prüfung vor dem Einspielen ist nicht bestanden; `abzug_nicht_lokal` (404) das gibt es nur auf dem Entwicklungsrechner.
 * Zum Schlüssel: `abzug_schluessel_ungueltig` (401) unbekannt oder falsch; `abzug_schluessel_abgelaufen` (401) abgelaufen, widerrufen oder die Person, die ihn
 * anlegte, ist nicht mehr aktiv; `abzug_schluessel_zuviele` (409) es gibt schon `ABZUG_SCHLUESSEL_HOECHSTENS` gültige; `abzug_schluessel_unbekannt` (404)
 * den gibt es hier nicht; `abzug_schluessel_gesehen` (409) der Wert steht nur in der ersten Antwort; lokal `abzug_schluessel_fehlt` (409) für diese Quelle
 * ist keiner hinterlegt.
 */
export const ABZUG_ERROR_STATUS = {
    abzug_ablage_fehlt: 503,
    abzug_laeuft: 409,
    abzug_unbekannt: 404,
    abzug_link_ungueltig: 410,
    abzug_datei_ungueltig: 422,
    abzug_einspielen_gesperrt: 409,
    abzug_sicherung_fehlt: 503,
    abzug_schluessel_ungueltig: 401,
    abzug_schluessel_abgelaufen: 401,
    abzug_schluessel_zuviele: 409,
    abzug_schluessel_unbekannt: 404,
    abzug_schluessel_fehlt: 409,
    abzug_schluessel_gesehen: 409,
} as const;
export type AbzugErrorCode = keyof typeof ABZUG_ERROR_STATUS;
