import { Type, type Static, type TLiteral, type TSchema, type TUnion } from "@sinclair/typebox";
import { KANON_OBJEKTARTEN } from "../kanon-tafel.ts";
import { WIKI_KANON } from "../wiki-namespaces.ts";
import { OperationId } from "../operation.ts";
import { WIKISYNC_BEREICHE, WIKISYNC_LAUF_STATUS } from "./wikisync.ts";

/**
 * Was der Reiter „WikiSync“ der Systemsteuerung zusätzlich liest und schreibt (WI-0253 UI-1, Mockup `review/wi-0253/wikisync-mockup.html`):
 *
 *     GET  /api/admin/wikisync/stand    der Dump im Ordner, die jüngste Vorschau, die laufenden Aufträge          view_wikisync (ab `tester`)
 *     GET  /api/admin/wikisync/tafeln   die zwei Tafeln des Kanon-Etiketts mit der Zahl ihrer Objekte            view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/tafeln   { operationId, baseRevision, namensraeume?, entfernen?, objektarten? }   manage_canon_tables (`admin`) + Passkey
 *
 * 🔴 Der Stand fragt das Wiki nie: Er liest den Dump-Ordner (Dateiname, Dateizeit, Größe) und was Aufträge darüber abgelegt haben.
 *
 * **„Dump holen“** (WI-0253 §22): `POST /api/admin/wikisync/dump { operationId }` reiht den Auftrag `wiki_dump_holen` ein (Recht `fetch_wiki_dump`, nur der Betreiber; in
 * Production mit frischem Passkey). Die App holt den Dump NICHT selbst: Der Auftrag hat in ihr keinen Handler, Claudios Korridor führt ihn aus
 * (`ops/production/wiki-einrichten.sh --dump-holen`) und meldet Phasen und Ende über `job_sync_phase` und `job_sync_finish`. Der Stand nennt, ob die Umgebung ihn einreihen darf
 * (`dumpHolen.erlaubt`, sonst mit Grund), den wartenden oder laufenden Auftrag (`auftraege`) und das Ergebnis des letzten (`dumpHolen.letzter`).
 */

export const WIKISYNC_STAND_URL = "/api/admin/wikisync/stand";
export const WIKISYNC_TAFELN_URL = "/api/admin/wikisync/tafeln";
export const WIKISYNC_DUMP_URL = "/api/admin/wikisync/dump";

/** Die Jobart, mit der die App Claudios Holen des Dumps anfordert (Migration 0246); sie hat in der App keinen Handler. */
export const WIKI_DUMP_HOLEN_ART = "wiki_dump_holen";

/**
 * Die Stufen des Holens, die Claudios Abholer am Auftrag meldet (`job_sync_phase`, Migration 0246): `holen` (Abruf beim Wiki, der längste Teil), `pruefen` (`bzip2 -t`), `ablegen`
 * (Umbenennen, zwei Stände bleiben). 🪤 Die Anteile stehen auch in der Datenbankfunktion; ein Test hält beide gleich.
 */
export const WIKI_DUMP_HOLEN_PHASEN = [
    { name: "holen", progress: 0.1 },
    { name: "pruefen", progress: 0.7 },
    { name: "ablegen", progress: 0.9 },
] as const;

/**
 * Wann der Betrieb den Dump von selbst holt: am 2. jedes Monats um 05:00 (Timer `avesmaps3d-wiki-dump.timer`, `ops/production/wiki-einrichten.sh --monatlich-an`; Wiki Aventurica
 * schreibt den Dump zum Monatsanfang neu). Die Oberfläche nennt den nächsten Termin; ob der Timer auf dem Server eingeschaltet ist, weiß die App nicht.
 */
export const WIKI_DUMP_PLAN = { tag: 2, stunde: 5, minute: 0, zeitzone: "Europe/Berlin" } as const;

const union = <T extends readonly string[]>(werte: T) =>
    Type.Union(werte.map((wert) => Type.Literal(wert))) as unknown as TUnion<{
        -readonly [K in keyof T]: TLiteral<T[K] & string>;
    }>;
/** Nur in Antworten: Im Anfrageinhalt verfälscht ajv eine Vereinigung mit `null` (`docs/regeln/entwicklung.md`). */
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;

/** Die Aufträge des WikiSync, die der Reiter als „läuft“ zeigt. */
export const WIKISYNC_AUFTRAGSARTEN = [
    WIKI_DUMP_HOLEN_ART,
    "wiki_dump_einlesen",
    "wiki_vorschau",
    "wiki_uebernehmen",
    "wiki_zuruecknehmen",
    "wiki_artikel",
] as const;
export type WikisyncAuftragsart = (typeof WIKISYNC_AUFTRAGSARTEN)[number];

export const WikisyncDumpNamensraum = Type.Object(
    {
        nr: Type.Integer(),
        /** Der Name aus dem Kopf des Dumps; `""` im Hauptraum, `null`, wenn der Kopf ihn nicht nennt. */
        name: nullable(Type.String()),
        seiten: Type.Integer(),
    },
    strict,
);
export type WikisyncDumpNamensraum = Static<typeof WikisyncDumpNamensraum>;

/**
 * Der Dump im Ordner (ein Dump je Server, Vali 2026-10-25). `geholtAm` ist die Dateizeit, `stand` der Stand des Dumps selbst (aus dem Dateinamen
 * oder dem Einlesen), nie die Uhr dieses Rechners. Prüfsumme, Seiten und Namensräume stehen nur da, wenn ein Einlesen oder eine Vorschau
 * GENAU diese Datei gelesen hat; sonst `null` (unbekannt ist nicht null Seiten).
 */
export const WikisyncDumpStand = Type.Object(
    {
        /** Ist ein Dump-Ordner eingerichtet und lesbar? */
        ordner: Type.Boolean(),
        datei: nullable(Type.String()),
        geholtAm: nullable(Type.String()),
        groesse: nullable(Type.Integer()),
        stand: nullable(Type.String()),
        seiten: nullable(Type.Integer()),
        sha256: nullable(Type.String()),
        vollstaendig: nullable(Type.Boolean()),
        /** Die Seiten je Namensraum aus dem jüngsten Einlesen dieser Datei; leer, solange keins vorliegt. */
        namensraeume: Type.Array(WikisyncDumpNamensraum),
    },
    strict,
);
export type WikisyncDumpStand = Static<typeof WikisyncDumpStand>;

/** Der jüngste Lauf der Vorschau, auch ein laufender oder gescheiterter (der Bericht nennt nur fertige). */
export const WikisyncVorschauStand = Type.Object(
    {
        id: Type.Integer(),
        status: union(WIKISYNC_LAUF_STATUS),
        bereiche: Type.Array(union(WIKISYNC_BEREICHE)),
        gestartetAm: Type.String(),
        beendetAm: nullable(Type.String()),
        fehler: nullable(Type.String()),
        dumpDatei: nullable(Type.String()),
        dumpStand: nullable(Type.String()),
        /**
         * Die Kategorien-Datei, die diese Vorschau gelesen hat (WI-0294): Dateiname, Stand aus ihrer Endzeile (ISO, UTC) und Zeilenzahl; `null`: Sie hatte keine (die Bereiche mit Kategorien
         * stehen dann aus) oder lief vor WI-0294.
         */
        kategorien: nullable(
            Type.Object({ datei: Type.String(), stand: Type.String(), zeilen: Type.Integer() }, strict),
        ),
        tafelRevision: nullable(Type.Integer()),
        ausgeloestVon: nullable(Type.String()),
    },
    strict,
);
export type WikisyncVorschauStand = Static<typeof WikisyncVorschauStand>;

export const WikisyncAuftrag = Type.Object(
    {
        art: union(WIKISYNC_AUFTRAGSARTEN),
        zustand: union(["QUEUED", "RUNNING"] as const),
        phase: nullable(Type.String()),
        /** 0 bis 1; `null`, solange der Auftrag keinen Fortschritt meldet. */
        fortschritt: nullable(Type.Number()),
        eingereihtAm: Type.String(),
        gestartetAm: nullable(Type.String()),
        ausgeloestVon: nullable(Type.String()),
        /**
         * Worauf ein wartender Auftrag wartet, wenn es einen benennbaren Grund gibt: `legacy_zug`, solange auf dem Host ein Legacy-Zug läuft (der Zug einer Kategorie, der ganze Zug oder
         * `legacy:update` auf Zuruf). Neben ihm startet kein Auftrag des WikiSync, der die Karte schreibt (`exclusivePairs`), und solange er läuft, auch keiner, der allein laufen muss.
         * `abholung`: Der Auftrag ist einer, den Claudios Korridor ausführt (`wiki_dump_holen`), und wartet darauf, dass er ihn übernimmt (Wartegrund `waits_pickup`).
         * Fehlt: kein solcher Grund (die Oberfläche sagt dann „wartet in der Warteschlange“).
         */
        wartetAuf: Type.Optional(union(["legacy_zug", "abholung"] as const)),
        /**
         * Die Bereiche, für die der Auftrag im verketteten Lauf arbeitet (Variante A, WI-0253 §20): bei der Vorschau die Bereiche, die danach übernommen werden sollen (`folge`), bei der Übernahme ihre `bereiche`. Fehlt bei einem Auftrag, der nicht zu einem solchen Lauf gehört.
         */
        bereiche: Type.Optional(Type.Array(union(WIKISYNC_BEREICHE))),
    },
    strict,
);
export type WikisyncAuftrag = Static<typeof WikisyncAuftrag>;

/** Warum diese Umgebung den Dump nicht holen darf: lokal (`umgebung`), ohne echtes Release (`release`) oder ohne Dump-Ordner (`ordner`). */
export const WIKISYNC_DUMP_HOLEN_GRUENDE = ["umgebung", "release", "ordner"] as const;
export type WikisyncDumpHolenGrund = (typeof WIKISYNC_DUMP_HOLEN_GRUENDE)[number];

/** Das Ende des jüngsten Holens, das über die Warteschlange lief (ein Holen des Timers steht hier nicht: Es läuft außerhalb). */
export const WikisyncDumpHolenLetzter = Type.Object(
    {
        status: union(["fertig", "fehlgeschlagen", "abgebrochen"] as const),
        beendetAm: Type.String(),
        /** Die Person, die den Knopf gedrückt hat; `null`, wenn der Auftrag ohne Person eingereiht wurde. */
        ausgeloestVon: nullable(Type.String()),
        /** Der Satz des Betriebs: bei `fertig` die Zusammenfassung (etwa „Dump unverändert“), sonst der Grund (nie ein Pfad, nie ein Geheimnis); höchstens 500 Zeichen. */
        meldung: nullable(Type.String()),
    },
    strict,
);
export type WikisyncDumpHolenLetzter = Static<typeof WikisyncDumpHolenLetzter>;

export const WikisyncDumpHolen = Type.Object(
    {
        /** Darf diese Umgebung einen Auftrag einreihen? Lokal nie. */
        erlaubt: Type.Boolean(),
        /** Warum nicht; `null`, wenn sie darf. */
        grund: nullable(union(WIKISYNC_DUMP_HOLEN_GRUENDE)),
        letzter: nullable(WikisyncDumpHolenLetzter),
    },
    strict,
);
export type WikisyncDumpHolen = Static<typeof WikisyncDumpHolen>;

/**
 * Die Kategorien-Datei im Dump-Ordner (`dump_categorylinks-<ts>.sql.gz`, WI-0294), die jüngste. `geholtAm` ist die Dateizeit, `stand` das Datum aus dem Dateinamen; der Stand aus der
 * Endzeile der Datei steht erst im Pin einer Vorschau (`WikisyncVorschauStand.kategorien`). Alles `null`: Es liegt keine Datei im Ordner.
 */
export const WikisyncKategorienDatei = Type.Object(
    {
        datei: nullable(Type.String()),
        geholtAm: nullable(Type.String()),
        groesse: nullable(Type.Integer()),
        stand: nullable(Type.String()),
    },
    strict,
);
export type WikisyncKategorienDatei = Static<typeof WikisyncKategorienDatei>;

export const WikisyncDumpHolenBody = Type.Object({ operationId: OperationId }, strict);
export type WikisyncDumpHolenBody = Static<typeof WikisyncDumpHolenBody>;

export const WikisyncStand = Type.Object(
    {
        jetzt: Type.String(),
        dump: WikisyncDumpStand,
        /** Die Kategorien-Datei im Ordner neben dem Dump (WI-0294). */
        kategorienDatei: WikisyncKategorienDatei,
        dumpHolen: WikisyncDumpHolen,
        vorschau: nullable(WikisyncVorschauStand),
        /** Die Revision der Kanon-Tafeln jetzt: Weicht sie von der Revision der Vorschau ab, rechnete die Vorschau nach einer anderen Tafel. */
        tafelRevision: nullable(Type.Integer()),
        auftraege: Type.Array(WikisyncAuftrag),
    },
    strict,
);
export type WikisyncStand = Static<typeof WikisyncStand>;

// ── Die zwei Tafeln des Kanon-Etiketts ────────────────────────────────────────────────────────────────────────────────────────────

/** Eine Zeile der Namensräume, wie die Route sie annimmt (Länge und Form prüft `pruefeNamespaceZeile`). */
export const WikisyncNamensraumZeile = Type.Object(
    {
        ns: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
        praefix: Type.String({ maxLength: 80 }),
        kanon: union(WIKI_KANON),
        einsammeln: Type.Boolean(),
        bezeichner: Type.String({ maxLength: 80 }),
    },
    strict,
);
export type WikisyncNamensraumZeile = Static<typeof WikisyncNamensraumZeile>;

export const WikisyncObjektartZeile = Type.Object(
    {
        art: union(KANON_OBJEKTARTEN),
        anzeigen: Type.Boolean(),
        bezeichner: Type.String({ maxLength: 80 }),
    },
    strict,
);
export type WikisyncObjektartZeile = Static<typeof WikisyncObjektartZeile>;

const geaendert = {
    geaendertAm: nullable(Type.String()),
    geaendertVon: nullable(Type.String()),
};

export const WikisyncTafelNamensraum = Type.Object(
    {
        ns: Type.Integer(),
        praefix: Type.String(),
        kanon: union(WIKI_KANON),
        einsammeln: Type.Boolean(),
        bezeichner: Type.String(),
        /** Objekte mit einer Wiki-Zuweisung in diesem Raum (nach der Erbschaft der Wegegruppe); `null`: nicht gezählt. */
        objekte: nullable(Type.Integer()),
        ...geaendert,
    },
    strict,
);
export type WikisyncTafelNamensraum = Static<typeof WikisyncTafelNamensraum>;

export const WikisyncTafelObjektart = Type.Object(
    {
        art: union(KANON_OBJEKTARTEN),
        anzeigen: Type.Boolean(),
        bezeichner: Type.String(),
        /** Objekte dieser Art ohne Kanon-Zeile (weder Wiki-Zuweisung noch Quelle noch Publikation); bei Wegen Abschnitte. */
        objekte: nullable(Type.Integer()),
        ...geaendert,
    },
    strict,
);
export type WikisyncTafelObjektart = Static<typeof WikisyncTafelObjektart>;

export const WikisyncTafeln = Type.Object(
    {
        jetzt: Type.String(),
        /** `vorgabe`: Die Tafeln fehlen in dieser Umgebung (vor Migration 0223); speichern geht dann nicht. */
        quelle: union(["datenbank", "vorgabe"] as const),
        revision: nullable(Type.Integer()),
        namensraeume: Type.Array(WikisyncTafelNamensraum),
        objektarten: Type.Array(WikisyncTafelObjektart),
    },
    strict,
);
export type WikisyncTafeln = Static<typeof WikisyncTafeln>;

/**
 * Ein Speichern beider Tafeln (eine Revision für beide). `namensraeume` und `objektarten` nennen ganze Zeilen; eine Zeile, die der Vorgabe gleicht,
 * setzt zurück. `entfernen` nimmt hinzugefügte Räume heraus (bei einem Raum der Vorgabe heißt es: zurück auf die Vorgabe). Kein Feld trägt `null`.
 */
export const WikisyncTafelnBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        namensraeume: Type.Optional(Type.Array(WikisyncNamensraumZeile, { maxItems: 64 })),
        entfernen: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 2_147_483_647 }), { maxItems: 64 })),
        objektarten: Type.Optional(Type.Array(WikisyncObjektartZeile, { maxItems: 6 })),
    },
    strict,
);
export type WikisyncTafelnBody = Static<typeof WikisyncTafelnBody>;
