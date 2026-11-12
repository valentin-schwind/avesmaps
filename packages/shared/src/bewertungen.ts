import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { AVENTURIA } from "./map-domain-registry.ts";
import { OperationId } from "./operation.ts";

/**
 * Bewertungen im Community-Modul (WI-0269 C10; Fachkonzept `project-control/planning/community-fachkonzept.md` §14, Bedienkonzept §6.1 bis §6.3).
 * Die Regeln (Zustände, Revision, Idempotenz, Rechte der App-Rolle) stehen in der Datenbank (Migration 0266, Schema `avesmaps_community`); dieser
 * Vertrag beschreibt nur, was über die Leitung geht und was beide Seiten gleich rechnen (Sterne in halben Schritten, aventurisches Datum).
 *
 * Öffentlich (ohne Anmeldung): schreiben, „Gefällt mir“ setzen und zurücknehmen, melden. Redaktion (`moderate_submissions`): Liste, Fenster,
 * sichten, freigeben, verbergen, einblenden; Inhalt löschen mit `moderate_community` und frischem Passkey.
 */

export const BEWERTUNGEN_URL = "/api/community/bewertungen";

/** Fachkonzept §14.3. Öffentlich sind nur `neu` und `gesichtet`; nur sie zählen in Anzahl und Durchschnitt. */
export const BEWERTUNG_ZUSTAENDE = ["neu", "gesichtet", "zurueckgehalten", "verborgen"] as const;
export type BewertungZustand = (typeof BEWERTUNG_ZUSTAENDE)[number];
export const bewertungOeffentlich = (zustand: BewertungZustand): boolean =>
    zustand === "neu" || zustand === "gesichtet";

/** Warum eine Bewertung zurückgehalten wird (Fachkonzept §14.3: Adresse im Text, Wortliste). Ein Verdacht ist eine Vermutung, kein Urteil. */
export const BEWERTUNG_VERDACHT = ["adresse", "wortliste"] as const;
export type BewertungVerdacht = (typeof BEWERTUNG_VERDACHT)[number];

/** Gründe zum Verbergen und zum Melden (Fachkonzept §14.3 und §14.5), in der Reihenfolge der Auswahl. */
export const BEWERTUNG_GRUENDE = ["beleidigend", "spam", "ort", "person", "sonstiges"] as const;
export type BewertungGrund = (typeof BEWERTUNG_GRUENDE)[number];

export const BEWERTUNG_HERKUENFTE = ["website", "legacy"] as const;
export type BewertungHerkunft = (typeof BEWERTUNG_HERKUENFTE)[number];

/** Die Segmente der Liste der Redaktion (Bedienkonzept §6.1). „Zu sichten“ fasst neue, zurückgehaltene und gemeldete zusammen. */
export const BEWERTUNG_SEGMENTE = ["sichten", "sichtbar", "verborgen"] as const;
export type BewertungSegment = (typeof BEWERTUNG_SEGMENTE)[number];

export const BEWERTUNG_SORTIERUNGEN = ["neueste", "aelteste", "wenigste"] as const;
export type BewertungSortierung = (typeof BEWERTUNG_SORTIERUNGEN)[number];

/** Längen (Fachkonzept §14.2) und Grenzen (§14.4); die Datenbank prüft dieselben Längen. */
export const BEWERTUNG_GRENZEN = {
    textMax: 200,
    nameMax: 80,
    datumMax: 60,
    beschreibungMax: 2000,
    /** Ein Mensch braucht länger; was schneller absendet, ist ein Bot (Zeitfalle, wie bei Meldungen). */
    mindestDauerMs: 2000,
    /** Fünf je Stunde und Adresse (Fachkonzept §14.4, Legacy: 5); gezählt nur im Speicher, nie gespeichert. */
    jeAdresseJeStunde: 5,
    /** „Gefällt mir“ ist leichter als Schreiben, aber nicht frei: eine kurzlebige Grenze je Adresse, ebenfalls nur im Speicher. */
    gefaelltJeAdresseJeStunde: 120,
    meldenJeAdresseJeStunde: 5,
    jeTag: 300,
    rumpfBytes: 8 * 1024,
} as const;

/** Wie viele Bewertungen die Liste im Reiter zuerst zeigt; „Alle N zeigen“ zeigt die übrigen (höchstens `SUBJECT_REVIEW_LIMIT`). */
export const BEWERTUNG_ZUERST_GEZEIGT = 12;

const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
const Schluessel = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const Moment = Type.String();
const { bounds: WORLD } = AVENTURIA.coordinateSpace;
const Lage = Type.Object(
    {
        x: Type.Number({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y: Type.Number({ minimum: WORLD.minY, maximum: WORLD.maxY }),
    },
    strict,
);

// --- Öffentlich ---------------------------------------------------------------------------------------------------------------------

const Falle = Type.Object({ feld: Type.String({ maxLength: 200 }), dauerMs: Type.Integer({ minimum: 0 }) }, strict);

/**
 * `POST /api/community/bewertungen` (öffentlich). `falle` sind Honigtopf und Zeitfalle. Das freiwillige Mailfeld für den Änderungslink (E8)
 * gibt es hier noch nicht: Es braucht den Mailweg (Umsetzungsplan C6).
 */
export const BewertungBody = Type.Object(
    {
        operationId: OperationId,
        ort: Uuid,
        sterne: Type.Integer({ minimum: 1, maximum: 5 }),
        text: Type.Optional(Type.String({ maxLength: BEWERTUNG_GRENZEN.textMax })),
        name: Type.Optional(Type.String({ maxLength: BEWERTUNG_GRENZEN.nameMax })),
        datum: Type.Optional(Type.String({ maxLength: BEWERTUNG_GRENZEN.datumMax })),
        falle: Falle,
    },
    strict,
);
export type BewertungBody = Static<typeof BewertungBody>;

/** Die Antwort sagt, ob die Bewertung schon steht (`neu`) oder kurz angesehen wird (`zurueckgehalten`); den Grund erfährt der Verfasser nicht. */
export const BewertungAntwort = Type.Object(
    { id: Uuid, zustand: literals(["neu", "zurueckgehalten"] as const) },
    strict,
);
export type BewertungAntwort = Static<typeof BewertungAntwort>;

/** `POST …/:id/gefaellt`: `1` setzt, `-1` nimmt zurück. Wer es war, wird nie gespeichert; „einmal je Browser“ hält der Browser. */
export const GefaelltBody = Type.Object({ delta: Type.Union([Type.Literal(1), Type.Literal(-1)]) }, strict);
export type GefaelltBody = Static<typeof GefaelltBody>;
export const GefaelltAntwort = Type.Object({ gefaellt: Type.Integer({ minimum: 0 }) }, strict);
export type GefaelltAntwort = Static<typeof GefaelltAntwort>;

/** `POST …/:id/melden`: wird ein normaler Vorgang (COM-…) im Reiter Meldungen; der Schlüssel ist der der Statusseite (`/meldung#…`). */
export const BewertungMeldenBody = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        grund: literals(BEWERTUNG_GRUENDE),
        text: Type.Optional(Type.String({ maxLength: BEWERTUNG_GRENZEN.beschreibungMax })),
        falle: Falle,
    },
    strict,
);
export type BewertungMeldenBody = Static<typeof BewertungMeldenBody>;

export const BewertungParams = Type.Object({ id: Uuid }, strict);
export type BewertungParams = Static<typeof BewertungParams>;

// --- Redaktion ----------------------------------------------------------------------------------------------------------------------

export const BewertungenQuery = Type.Object(
    {
        segment: Type.Optional(literals(BEWERTUNG_SEGMENTE)),
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        sterne: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        herkunft: Type.Optional(literals(BEWERTUNG_HERKUENFTE)),
        /** Nur Bewertungen mit einer offenen Meldung. */
        gemeldet: Type.Optional(Type.Boolean()),
        /** Nur zurückgehaltene (Spamverdacht). */
        zurueckgehalten: Type.Optional(Type.Boolean()),
        sortierung: Type.Optional(literals(BEWERTUNG_SORTIERUNGEN)),
    },
    strict,
);
export type BewertungenQuery = Static<typeof BewertungenQuery>;

/**
 * Eine Zeile der Liste und die Kopfdaten des Fensters. Name, Text und Datum fehlen (`null`), wo der Inhalt gelöscht ist.
 * `gemeldet` nennt die offenen Meldungen (COM-Nummern).
 */
export const BewertungZeile = Type.Object(
    {
        id: Uuid,
        ort: Type.Object({ id: Uuid, name: Type.String() }, strict),
        sterne: Type.Integer({ minimum: 1, maximum: 5 }),
        text: Nullable(Type.String()),
        name: Nullable(Type.String()),
        datum: Nullable(Type.String()),
        zustand: literals(BEWERTUNG_ZUSTAENDE),
        grund: Nullable(Type.String()),
        herkunft: literals(BEWERTUNG_HERKUENFTE),
        eingangAt: Moment,
        gemeldet: Type.Array(Type.String()),
        gefaellt: Type.Integer({ minimum: 0 }),
        inhaltGeloescht: Type.Boolean(),
        revision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type BewertungZeile = Static<typeof BewertungZeile>;

export const BewertungListe = Type.Object(
    {
        zeilen: Type.Array(BewertungZeile),
        /** Zahlen je Segment ohne Suche und Trichter; dazu die Zustände für die Legende („neu ○ 3 · zurückgehalten ◑ 1 · …“). */
        zaehler: Type.Object(
            {
                sichten: Type.Integer(),
                sichtbar: Type.Integer(),
                verborgen: Type.Integer(),
                neu: Type.Integer(),
                zurueckgehalten: Type.Integer(),
                gesichtet: Type.Integer(),
            },
            strict,
        ),
    },
    strict,
);
export type BewertungListe = Static<typeof BewertungListe>;

const Schnitt = Type.Object({ n: Type.Integer({ minimum: 0 }), wert: Nullable(Type.Number()) }, strict);
export type BewertungSchnitt = Static<typeof Schnitt>;

export const BewertungVerlauf = Type.Object(
    {
        /** `eingang` wird aus der Bewertung selbst gebildet; die übrigen sind die Ereignisse der Datenbank. */
        art: literals([
            "eingang",
            "gesichtet",
            "freigegeben",
            "verborgen",
            "eingeblendet",
            "inhalt_geloescht",
            "gemeldet",
            "geaendert",
            "zurueckgezogen",
        ] as const),
        von: Nullable(Type.Object({ id: Type.String(), name: Type.String() }, strict)),
        /** Bei `gemeldet` die COM-Nummer, bei `verborgen` der Grund, bei `freigegeben` der frühere Verdacht, sonst `null`. */
        text: Nullable(Type.String()),
        at: Moment,
    },
    strict,
);
export type BewertungVerlauf = Static<typeof BewertungVerlauf>;

export const BewertungDetail = Type.Object(
    {
        zeile: BewertungZeile,
        ort: Type.Object(
            {
                id: Uuid,
                name: Type.String(),
                /** Die Art des Orts (Stadt, Dorf …) aus der Tafel des Orts; `null`, wo sie fehlt. */
                art: Nullable(Type.String()),
                lage: Nullable(Lage),
                /** Durchschnitt jetzt und nach der Handlung („★ 4,3 aus 12 · nach dem Verbergen ★ 4,5 aus 11“). */
                jetzt: Schnitt,
                danach: Schnitt,
            },
            strict,
        ),
        meldungen: Type.Array(
            Type.Object(
                {
                    nummer: Type.String(),
                    grund: Type.String(),
                    zustand: Type.String(),
                    ergebnis: Nullable(Type.String()),
                },
                strict,
            ),
        ),
        verlauf: Type.Array(BewertungVerlauf),
    },
    strict,
);
export type BewertungDetail = Static<typeof BewertungDetail>;

const Aenderung = { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }) };
export const BewertungSchrittBody = Type.Object(Aenderung, strict);
export type BewertungSchrittBody = Static<typeof BewertungSchrittBody>;
export const BewertungVerbergenBody = Type.Object(
    {
        ...Aenderung,
        grund: literals(BEWERTUNG_GRUENDE),
        /** Die offenen Meldungen zu dieser Bewertung gleich mit dem Ergebnis „umgesetzt“ abschließen (Fachkonzept §14.5). */
        vorgaengeAbschliessen: Type.Boolean(),
    },
    strict,
);
export type BewertungVerbergenBody = Static<typeof BewertungVerbergenBody>;
export const BewertungQuittung = Type.Object(
    { id: Uuid, revision: Type.Integer({ minimum: 1 }), abgeschlossen: Type.Array(Type.String()) },
    strict,
);
export type BewertungQuittung = Static<typeof BewertungQuittung>;

// --- Gemeinsame Rechnung ------------------------------------------------------------------------------------------------------------

// Die fünf Sterne zu einem Wert (voll, halb, leer) rechnet das Infopanel (`starsOf`, Design Guide §16.6); hier steht nur, was Server und Seite gleich zählen.

/**
 * Die Verteilung der Sterne aus den ganzen Wertungen: `[Anzahl 5, 4, 3, 2, 1]`. Aus der Liste gerechnet (nur öffentliche Bewertungen),
 * für den Server ebenso wie für Modelltests.
 */
export function sternVerteilung(sterne: readonly number[]): [number, number, number, number, number] {
    const verteilung: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const stern of sterne) {
        if (Number.isInteger(stern) && stern >= 1 && stern <= 5)
            verteilung[5 - stern] = (verteilung[5 - stern] ?? 0) + 1;
    }
    return verteilung;
}

// --- Aventurisches Datum (Legacy `api/_internal/reviews.php`, Mirror 04a85a54f) -------------------------------------------------------

const MONATE = [
    "Praios",
    "Rondra",
    "Efferd",
    "Travia",
    "Boron",
    "Hesinde",
    "Firun",
    "Tsa",
    "Phex",
    "Peraine",
    "Ingerimm",
    "Rahja",
] as const;

/**
 * Der heutige Tag im aventurischen Kalender der Anwendung (Fachkonzept §14.2: „mit einstellbarem Jahr statt fest 1049 BF“). Die zwölf
 * Göttermonate laufen parallel zu den echten Monaten, Praios entspricht dem Juli; der Tag ist der Tag des echten Monats, höchstens 30.
 * Gerechnet wird mit der Zone UTC, damit Server und Test dasselbe sagen.
 */
export function aventurischesDatumHeute(jetzt: Date, jahrBf: number): string {
    const monat = MONATE[(jetzt.getUTCMonth() + 1 - 7 + 12) % 12] as string;
    return `${String(Math.min(30, jetzt.getUTCDate()))}. ${monat} ${String(jahrBf)} BF`;
}

/**
 * Prüft ein eingegebenes aventurisches Datum und gibt die kanonische Form zurück („7. Rahja 1049 BF“). Leer bleibt leer (der Aufrufer setzt
 * dann das heutige Datum), ein ungültiges Datum ergibt `null`. Auch „3. Namenloser Tag 1049 BF“ (Tag 1 bis 5) und „v. BF“ gelten.
 */
export function normalisiereAventurischesDatum(eingabe: string): string | null {
    const wert = eingabe.trim().replace(/\s+/gu, " ");
    if (wert === "") return "";
    const namenlos = /^(\d{1,2})\s*\.?\s*namenlose[rn]?\s+tage?\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/iu.exec(wert);
    if (namenlos !== null) {
        const tag = Number(namenlos[1]);
        const jahr = Number(namenlos[2]);
        if (tag < 1 || tag > 5 || jahr < 1) return null;
        return `${String(tag)}. Namenloser Tag ${String(jahr)} ${(namenlos[3] ?? "").toLowerCase().startsWith("v") ? "v. BF" : "BF"}`;
    }
    const regulaer = /^(\d{1,2})\s*\.?\s*([a-zäöü]+)\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/iu.exec(wert);
    if (regulaer === null) return null;
    const tag = Number(regulaer[1]);
    const monat = MONATE.findIndex((name) => name.toLowerCase() === (regulaer[2] ?? "").toLowerCase());
    const jahr = Number(regulaer[3]);
    if (monat < 0 || tag < 1 || tag > 30 || jahr < 1) return null;
    return `${String(tag)}. ${MONATE[monat] as string} ${String(jahr)} ${(regulaer[4] ?? "").toLowerCase().startsWith("v") ? "v. BF" : "BF"}`;
}
