import { Type, type Static, type TLiteral, type TUnion } from "@sinclair/typebox";
import { STATUS_SCHLUESSEL_MUSTER } from "./community.ts";
import { KARTE_VERSION_MAX, KARTEN_ARTEN, KARTEN_FARBEN, KARTEN_TYPEN } from "./media-kartensammlung.ts";
import { OperationId, UUID_PATTERN } from "./operation.ts";

/**
 * „Karte vorschlagen“ (WI-0275 Stufe B): Ein Besucher ohne Konto schlägt eine Karte für die Kartensammlung vor, als Link oder als eigene Datei.
 * Das ist ein Vorschlag, KEINE Karte: Er steht in `citymap_suggestion` (Migration 0295) und wird erst mit der Annahme der Redaktion zur Zeile in
 * `citymap`. Bis dahin ist nichts öffentlich; ein Besucher schreibt nie in `citymap`.
 *
 * Pflicht sind nur der Titel und (Link ODER Datei). Alles andere ist freiwillig, die Quelle sperrt nie. Dreiwertige Angaben (Spoiler, offiziell …)
 * fehlen im Rumpf, wenn der Einreicher sie nicht kennt; „unbekannt“ wird nie als „nein“ gespeichert (Regel der Kartensammlung, Migration 0069).
 *
 * Der Weg einer Datei hat zwei Schritte: erst die Angaben (`POST …/einreichungen`, JSON, klein), dann die Bytes (`PUT …/datei`, roher Rumpf bis
 * `KARTENVORSCHLAG_GRENZEN.dateiBytes`). Die globale Grenze der Medienverwaltung (6 MiB je Raster, Betreiberentscheid D2) bleibt unberührt; die
 * 50 MiB gelten nur für diesen Vorschlagsweg.
 */

export const KARTENVORSCHLAG_URL = "/api/kartenvorschlaege";
/** Die Statusseite des Einreichers: `/kartenvorschlag#<Schlüssel>`; das Fragment verlässt den Browser nie (wie `/reisebild` der Reisebilder). */
export const KARTENVORSCHLAG_STATUS_PFAD = "/kartenvorschlag";
/** Die Redaktion (`moderate_submissions`), neben den Bewertungen im Bereich der Community. */
export const KARTENVORSCHLAG_REDAKTION_URL = "/api/community/kartenvorschlaege";
export const kartenvorschlagRedaktionUrl = (id: string): string =>
    `${KARTENVORSCHLAG_REDAKTION_URL}/${encodeURIComponent(id)}`;

/** Fassung der Bedingungen, der der Einreicher einer DATEI zustimmt (nie bei einem Link). */
export const KARTENVORSCHLAG_TERMS_VERSION = "kartenvorschlag-2026-11-04";

/** Die Dateiformate (Entscheid des Betreibers 2026-11-02): JPEG, PNG, WebP und PDF, je bis 50 MiB. Die Art kommt aus den Bytes, nie aus dem Namen. */
export const KARTENVORSCHLAG_DATEITYPEN = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type KartenvorschlagDateityp = (typeof KARTENVORSCHLAG_DATEITYPEN)[number];

export const KARTENVORSCHLAG_ZUSTAENDE = [
    /** Die Angaben sind da, die Datei fehlt noch oder wird noch technisch geprüft. */
    "incoming",
    /** Die Datei ist nicht verarbeitbar (beschädigt, verschlüsselt, zu groß in Pixeln). */
    "technical_failed",
    /** Wartet auf die Redaktion. */
    "pending",
    /** Angenommen: es gibt die Karte (`acceptedCitymap`). */
    "approved",
    "rejected",
    "withdrawn",
] as const;
export type KartenvorschlagZustand = (typeof KARTENVORSCHLAG_ZUSTAENDE)[number];

/** Die Segmente der Redaktion (Entwurf Fassung 2, Vali 2026-11-04): Offen · Angenommen · Abgelehnt; zurückgezogene stehen bei den abgelehnten. */
export const KARTENVORSCHLAG_SEGMENTE = ["offen", "angenommen", "abgelehnt"] as const;
export type KartenvorschlagSegment = (typeof KARTENVORSCHLAG_SEGMENTE)[number];
export const KARTENVORSCHLAG_SEGMENT_ZUSTAENDE: Readonly<
    Record<KartenvorschlagSegment, readonly KartenvorschlagZustand[]>
> = {
    offen: ["pending", "incoming", "technical_failed"],
    angenommen: ["approved"],
    abgelehnt: ["rejected", "withdrawn"],
};

export const KARTENVORSCHLAG_NUTZUNGEN = ["avesmaps_only", "cc-by-4.0"] as const;
export type KartenvorschlagNutzung = (typeof KARTENVORSCHLAG_NUTZUNGEN)[number];

export const KARTENVORSCHLAG_LIMITS = {
    titelMax: 300,
    beschreibungMax: 2000,
    quelleMax: 500,
    linkMax: 500,
    urheberMax: 300,
    notizMax: 2000,
    nameMax: 80,
    grundMax: 500,
    typenMax: KARTEN_TYPEN.length,
    jahrMin: -3000,
    jahrMax: 9999,
} as const;

export const KARTENVORSCHLAG_GRENZEN = {
    /** Zeitfalle: schneller als ein Mensch tippt (wie `COMMUNITY_GRENZEN.mindestDauerMs`). */
    mindestDauerMs: 3000,
    /** Einreichungen je Adresse und Stunde (zählt jeder Versuch, auch ein Fallen-Treffer). */
    jeAdresseJeStunde: 6,
    /** Einreichungen aller zusammen je Tag. */
    jeTag: 100,
    /** Dateien je Adresse und Stunde, und alle zusammen je Tag (begrenzt den Speicher: 100 × 50 MiB). */
    dateiJeAdresseJeStunde: 6,
    dateiJeTag: 100,
    /** Aufrufe der Statusseite je Adresse und Stunde. */
    statusJeStunde: 60,
    /** Rumpf der JSON-Routen. */
    rumpfBytes: 64 * 1024,
    /** Größe einer Datei: 50 MiB. */
    dateiBytes: 50 * 1024 * 1024,
} as const;

/** Das Kopffeld des Statusschlüssels bei `PUT …/datei` (der Rumpf sind die rohen Bytes, der Schlüssel darf nicht in die Adresse). */
export const KARTENVORSCHLAG_SCHLUESSEL_KOPF = "x-vorschlag-schluessel";

const strict = { additionalProperties: false } as const;
function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const Uuid = Type.String({ pattern: UUID_PATTERN });
const Moment = Type.String();
const Schluessel = Type.String({ pattern: STATUS_SCHLUESSEL_MUSTER });
const Text = (max: number) => Type.String({ minLength: 1, maxLength: max, pattern: "\\S" });
const Jahr = Type.Integer({ minimum: KARTENVORSCHLAG_LIMITS.jahrMin, maximum: KARTENVORSCHLAG_LIMITS.jahrMax });
const Falle = Type.Object({ feld: Type.String({ maxLength: 200 }), dauerMs: Type.Integer({ minimum: 0 }) }, strict);
const Link = Type.String({ minLength: 8, maxLength: KARTENVORSCHLAG_LIMITS.linkMax, pattern: "^https?://\\S+$" });

/** Die freiwilligen Angaben zur Karte, gemeinsam für Einreichung und Anzeige. Fehlt eine, ist sie unbekannt. */
const KartenAngaben = {
    typen: Type.Optional(
        Type.Array(oneOf(KARTEN_TYPEN), { uniqueItems: true, maxItems: KARTENVORSCHLAG_LIMITS.typenMax }),
    ),
    urheber: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.urheberMax)),
    art: Type.Optional(oneOf(KARTEN_ARTEN)),
    gueltigAb: Type.Optional(Jahr),
    gueltigBis: Type.Optional(Jahr),
    farbe: Type.Optional(oneOf(KARTEN_FARBEN)),
    spoiler: Type.Optional(Type.Boolean()),
    beschriftet: Type.Optional(Type.Boolean()),
    mehrstoeckig: Type.Optional(Type.Boolean()),
    offiziell: Type.Optional(Type.Boolean()),
    kostenpflichtig: Type.Optional(Type.Boolean()),
    vorschauLink: Type.Optional(Link),
    notiz: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.notizMax)),
} as const;

/**
 * `POST /api/kartenvorschlaege/einreichungen`: die Angaben. Bei `weg` `link` gehört `link` dazu, bei `datei` die Beschreibung der Datei
 * (`datei`, Art und Größe wie angekündigt; geprüft wird beim Hochladen aus den Bytes) samt `nutzung` und der Fassung der `bedingungen`.
 * `placeId` ist der Ort, für dessen Kartensammlung der Vorschlag gilt (öffentliche Kennung); `quelle` ist ein freier Text („Herz des Reiches“).
 */
export const KartenvorschlagEinreichung = Type.Object(
    {
        operationId: OperationId,
        schluessel: Schluessel,
        weg: oneOf(["link", "datei"] as const),
        titel: Text(KARTENVORSCHLAG_LIMITS.titelMax),
        beschreibung: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.beschreibungMax)),
        quelle: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.quelleMax)),
        link: Type.Optional(Link),
        datei: Type.Optional(
            Type.Object(
                {
                    typ: oneOf(KARTENVORSCHLAG_DATEITYPEN),
                    groesse: Type.Integer({ minimum: 1, maximum: KARTENVORSCHLAG_GRENZEN.dateiBytes }),
                },
                strict,
            ),
        ),
        nutzung: Type.Optional(oneOf(KARTENVORSCHLAG_NUTZUNGEN)),
        bedingungen: Type.Optional(Type.Literal(KARTENVORSCHLAG_TERMS_VERSION)),
        placeId: Type.Optional(Uuid),
        name: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.nameMax)),
        ...KartenAngaben,
        falle: Falle,
    },
    strict,
);
export type KartenvorschlagEinreichung = Static<typeof KartenvorschlagEinreichung>;

/**
 * Die Antwort auf das Einreichen (201): eingegangen. `nummer` ist die laufende Nummer („K-1042“), die der Einreicher sieht. Die Falle antwortet
 * mit demselben Satz und einer erfundenen Nummer, legt aber nichts an.
 */
export const KartenvorschlagEingegangen = Type.Object(
    { ok: Type.Literal(true), nummer: Type.String(), dateiNoetig: Type.Boolean() },
    strict,
);
export type KartenvorschlagEingegangen = Static<typeof KartenvorschlagEingegangen>;

/** `GET /api/kartenvorschlaege/stand`: nimmt dieser Server Vorschläge an (Tafel und Recht da, Schalter an)? */
export const KartenvorschlagStand = Type.Object({ einreichen: Type.Boolean() }, strict);
export type KartenvorschlagStand = Static<typeof KartenvorschlagStand>;

/** Die Antwort auf `PUT …/datei`: die Datei ist angenommen und wird technisch geprüft. */
export const KartenvorschlagDateiAngenommen = Type.Object(
    { ok: Type.Literal(true), zustand: oneOf(KARTENVORSCHLAG_ZUSTAENDE) },
    strict,
);
export type KartenvorschlagDateiAngenommen = Static<typeof KartenvorschlagDateiAngenommen>;

/** `POST …/status` (und `…/zurueckziehen`): der Schlüssel geht im Rumpf, damit er in keinem Log steht. */
export const KartenvorschlagStatusBody = Type.Object({ schluessel: Schluessel }, strict);
export type KartenvorschlagStatusBody = Static<typeof KartenvorschlagStatusBody>;

export const KartenvorschlagZurueckziehen = Type.Object({ schluessel: Schluessel, operationId: OperationId }, strict);
export type KartenvorschlagZurueckziehen = Static<typeof KartenvorschlagZurueckziehen>;

/** Der Stand eines Vorschlags für den Einreicher: nie Schlüssel, nie interne Kennungen, nie der Grund einer Ablehnung außer dem, den die Redaktion schrieb. */
export const KartenvorschlagStatus = Type.Object(
    {
        nummer: Type.String(),
        zustand: oneOf(KARTENVORSCHLAG_ZUSTAENDE),
        weg: oneOf(["link", "datei"] as const),
        titel: Type.String(),
        link: Type.Union([Type.String(), Type.Null()]),
        dateiTyp: Type.Union([oneOf(KARTENVORSCHLAG_DATEITYPEN), Type.Null()]),
        eingegangenAm: Moment,
        entschiedenAm: Type.Union([Moment, Type.Null()]),
        /** Der Grund der Ablehnung, wenn die Redaktion einen nannte. */
        grund: Type.Union([Type.String(), Type.Null()]),
        /** Kann der Einreicher noch zurückziehen? (vor der Entscheidung) */
        zurueckziehbar: Type.Boolean(),
    },
    strict,
);
export type KartenvorschlagStatus = Static<typeof KartenvorschlagStatus>;

// --- Redaktion ---------------------------------------------------------------------------------------------------------------------

/**
 * `GET /api/community/kartenvorschlaege?segment&q&zustand&limit&nach`: der Korb der Redaktion. `segment` wählt die Zustände einer Ansicht (offen: älteste zuerst, entschiedene: neueste zuerst), `q` sucht in Titel,
 * Ort, Adresse und Nummer. Ohne `segment` gilt `zustand`, ohne beides die wartenden, älteste zuerst.
 */
export const KartenvorschlagListeQuery = Type.Object(
    {
        segment: Type.Optional(oneOf(KARTENVORSCHLAG_SEGMENTE)),
        q: Type.Optional(Type.String({ maxLength: 100 })),
        zustand: Type.Optional(oneOf(KARTENVORSCHLAG_ZUSTAENDE)),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        nach: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type KartenvorschlagListeQuery = Static<typeof KartenvorschlagListeQuery>;

export const KartenvorschlagOrt = Type.Object({ id: Uuid, name: Type.String() }, strict);

export const KartenvorschlagZeile = Type.Object(
    {
        id: Uuid,
        nummer: Type.String(),
        zustand: oneOf(KARTENVORSCHLAG_ZUSTAENDE),
        weg: oneOf(["link", "datei"] as const),
        titel: Type.String(),
        link: Type.Union([Type.String(), Type.Null()]),
        dateiTyp: Type.Union([oneOf(KARTENVORSCHLAG_DATEITYPEN), Type.Null()]),
        ort: Type.Union([KartenvorschlagOrt, Type.Null()]),
        eingegangenAm: Moment,
        /** Der technische Zustand des Werks (`null`: noch keine Datei): sagt in der Zeile, warum ein Vorschlag noch nicht wartet. */
        technik: Type.Union([Type.String(), Type.Null()]),
    },
    strict,
);
export type KartenvorschlagZeile = Static<typeof KartenvorschlagZeile>;

export const KartenvorschlagListe = Type.Object(
    {
        eintraege: Type.Array(KartenvorschlagZeile),
        /** Wie viele es je Zustand gibt, alle, nicht nur die gesuchten: Zahl am Unterreiter und Legende. */
        zaehler: Type.Object(
            {
                incoming: Type.Integer(),
                technical_failed: Type.Integer(),
                pending: Type.Integer(),
                approved: Type.Integer(),
                rejected: Type.Integer(),
                withdrawn: Type.Integer(),
            },
            strict,
        ),
        weitere: Type.Boolean(),
        naechste: Type.Union([Type.Integer(), Type.Null()]),
    },
    strict,
);
export type KartenvorschlagListe = Static<typeof KartenvorschlagListe>;

/**
 * Ein Vorschlag mit allen Angaben. Der Name des Einreichers und die Beschreibung sind nur der Redaktion sichtbar. `asset` ist das Werk der Datei
 * (öffentliche Kennung des Assets der Medienverwaltung, dort ansehbar).
 */
export const KartenvorschlagDetail = Type.Object(
    {
        ...KartenvorschlagZeile.properties,
        revision: Type.Integer(),
        beschreibung: Type.Union([Type.String(), Type.Null()]),
        quelle: Type.Union([Type.String(), Type.Null()]),
        nutzung: Type.Union([oneOf(KARTENVORSCHLAG_NUTZUNGEN), Type.Null()]),
        name: Type.Union([Type.String(), Type.Null()]),
        typen: Type.Array(oneOf(KARTEN_TYPEN)),
        urheber: Type.Union([Type.String(), Type.Null()]),
        art: Type.Union([oneOf(KARTEN_ARTEN), Type.Null()]),
        gueltigAb: Type.Union([Type.Integer(), Type.Null()]),
        gueltigBis: Type.Union([Type.Integer(), Type.Null()]),
        farbe: Type.Union([oneOf(KARTEN_FARBEN), Type.Null()]),
        spoiler: Type.Union([Type.Boolean(), Type.Null()]),
        beschriftet: Type.Union([Type.Boolean(), Type.Null()]),
        mehrstoeckig: Type.Union([Type.Boolean(), Type.Null()]),
        offiziell: Type.Union([Type.Boolean(), Type.Null()]),
        kostenpflichtig: Type.Union([Type.Boolean(), Type.Null()]),
        vorschauLink: Type.Union([Type.String(), Type.Null()]),
        notiz: Type.Union([Type.String(), Type.Null()]),
        asset: Type.Union([Uuid, Type.Null()]),
        /** Wann der Betreiber das Werk der Datei endgültig gelöscht hat (WI-0287, Migration 0322); dann ist `asset` `null`. Fehlt, wenn nie gelöscht. */
        dateiGeloeschtAm: Type.Optional(Moment),
        entschiedenAm: Type.Union([Moment, Type.Null()]),
        grund: Type.Union([Type.String(), Type.Null()]),
        /** Die Karte, die aus der Annahme entstand (öffentliche Kennung in `citymap`); `null`, solange nicht angenommen. */
        karte: Type.Union([Uuid, Type.Null()]),
        /** Art und Lage des Orts, damit die Karte ihn wählen und anfliegen kann. */
        ortArt: Type.Union([Type.String(), Type.Null()]),
        ortLage: Type.Union([Type.Object({ x: Type.Number(), y: Type.Number() }, strict), Type.Null()]),
        /** Das private Vorschaubild der Datei (bei einem PDF Seite 1); nur beim Lesen mit `view_media_private`, sonst und vor dem Abgleich `null`. */
        vorschau: Type.Union([Type.String(), Type.Null()]),
    },
    strict,
);
export type KartenvorschlagDetail = Static<typeof KartenvorschlagDetail>;

export const KartenvorschlagParams = Type.Object({ id: Uuid }, strict);

/** `POST …/:id/ablehnen`: die Redaktion lehnt ab; der Grund ist freiwillig und für den Einreicher auf der Statusseite lesbar. */
export const KartenvorschlagAblehnen = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        grund: Type.Optional(Text(KARTENVORSCHLAG_LIMITS.grundMax)),
    },
    strict,
);
export type KartenvorschlagAblehnen = Static<typeof KartenvorschlagAblehnen>;

/**
 * `POST …/:id/annehmen`: die Redaktion nimmt an. Die Karte entsteht aus den Angaben des Vorschlags; eine Datei wird als Vollkarte an sie gebunden. Die
 * Annahme gibt die Datei frei (Betreiber 2026-11-06, WI-0282); ihre Lizenz bleibt die des Einreichers.
 * `placeId` ist der Ort der Karte, den die Redaktion im Blatt wählt: fehlt die Angabe, gilt der des Vorschlags; `null` heißt ausdrücklich keiner.
 *
 * WI-0287 Stufe 2, „Weitere Version eines Eintrags“: Mit `targetId` (ein aktiver Eintrag der Kartensammlung) entsteht KEINE neue Karte. Die Datei wird eine weitere Version des
 * Eintrags mit `versionLabel` als Bezeichnung, der Link des Vorschlags kommt zu seinen Fundstellen; Titel, Angaben und Orte des Eintrags bleiben, `placeId` gilt dann nicht.
 * Ein stillgelegter Eintrag ist 409 `citymap_target_retired`, ein unbekannter 404. Die Bezeichnung im Anfrageinhalt als Typliste (ajv-Falle).
 */
export const KartenvorschlagAnnehmen = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        placeId: Type.Optional(Type.Union([Uuid, Type.Null()])),
        targetId: Type.Optional(Uuid),
        versionLabel: Type.Optional(
            Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: KARTE_VERSION_MAX }),
        ),
    },
    strict,
);
export type KartenvorschlagAnnehmen = Static<typeof KartenvorschlagAnnehmen>;

/** Die Nummer, wie der Einreicher sie sieht: „K-1042“. */
export const kartenvorschlagNummer = (n: number | string): string => `K-${String(n)}`;
