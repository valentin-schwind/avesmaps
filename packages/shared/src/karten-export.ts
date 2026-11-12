import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * Karten herunterladen (WI-0280): alle Kartenserien als PNG und die Vektorkarte als SVG, immer im ZIP, für die angemeldete Person, per befristetem
 * Link und per API-Schlüssel.
 *
 *     GET  /api/karten-export/stand                  Karten, Links, Schlüssel, Stand der SVG      export_maps
 *     GET  /api/karten-export/paket.zip?ids=a,b      das ZIP für die angemeldete Person           export_maps
 *     POST /api/karten-export/zugaenge               Link oder Schlüssel anlegen                  export_maps
 *     POST /api/karten-export/zugaenge/:id/neu       neu ausstellen                               export_maps
 *     POST /api/karten-export/zugaenge/:id/weg       zurücknehmen oder widerrufen                 export_maps
 *     POST /api/karten-export/svg                    SVG neu erzeugen                             export_maps
 *
 *     GET  /api/karten-paket/oeffnen                 was ein Link liefert (Bearer: das Token aus `/paket#…`)
 *     GET  /api/karten-paket/datei/:ticket           das ZIP, mit kurzlebigem Ticket statt des Tokens in der Adresse
 *
 *     GET  /api/v1/karten                            was dieser Schlüssel darf (Bearer avk_…)
 *     GET  /api/v1/karten/{id}.zip                   eine Karte im ZIP
 *     GET  /api/v1/karten/paket.zip?ids=a,b          mehrere Karten in einem ZIP
 *     GET  /api/v1/karten/svg-export[?smooth=1]      die Vektorkarte roh oder geglättet, als SVG ohne ZIP: der Vertrag der Terrain-Pipeline,
 *                                                    Nachfolger von Legacys `api/svg-export.php` (Vali 2026-11-05)
 *
 * 🔴 **`/api/v1` ist ein Vertrag nach außen** (Kap. 4.27, 11.15): Felder kommen nur dazu, keines ändert seine Bedeutung. Was sich sonst ändern müsste,
 * wird `/api/v2`. Die Kennungen der Serien kommen aus dem Katalog, neue Kartenserien erscheinen von selbst.
 */

export const KARTEN_EXPORT_URL = "/api/karten-export";
export const KARTEN_PAKET_URL = "/api/karten-paket";
export const KARTEN_API_URL = "/api/v1/karten";
/** Die Empfängerseite eines Links; das Token steht im Fragment und erreicht so kein Protokoll. */
export const KARTEN_PAKET_PFAD = "/paket";
export const KARTEN_VERTRAG_FASSUNG = 1;

export const KARTEN_SVG_ROH = "svg-roh";
export const KARTEN_SVG_GLATT = "svg-glatt";
/** Die Vektorkarte ohne ZIP für Werkzeuge (Terrain-Pipeline): Kopfzeilen `X-Avesmaps-*`, `If-None-Match` mit der blanken Prüfsumme, 304. */
export const KARTEN_SVG_EXPORT_URL = `${KARTEN_API_URL}/svg-export`;
/** Wer einen festen Abzug erzeugt hat: der tägliche Lauf oder jemand mit „SVG erzeugen“ (Kopfzeile `X-Avesmaps-Quelle`, wie Legacy). */
export const KARTEN_SVG_QUELLEN = ["routine", "manuell"] as const;
export type KartenSvgQuelle = (typeof KARTEN_SVG_QUELLEN)[number];
/** Ein Abzug mit eigenen Einstellungen: `svg-eigen-<12 Hex>`, die Prüfsumme der Einstellungen. */
export const KARTEN_SVG_EIGEN_PRAEFIX = "svg-eigen-";

export const KARTEN_ID_MUSTER = "^[a-z][a-z0-9-]{0,40}$";
const KARTEN_ID = /^[a-z][a-z0-9-]{0,40}$/u;
export function istKartenId(wert: string): boolean {
    return KARTEN_ID.test(wert);
}

export const KARTEN_ZUGANG_ARTEN = ["link", "schluessel"] as const;
export type KartenZugangArt = (typeof KARTEN_ZUGANG_ARTEN)[number];

/** Die wählbaren Fristen in Tagen; die erste Liste wie Legacys Kartenarchiv. */
export const KARTEN_FRISTEN: Readonly<Record<KartenZugangArt, readonly number[]>> = {
    link: [1, 7, 30],
    schluessel: [30, 90, 365],
};
export const KARTEN_FRIST_VORGABE: Readonly<Record<KartenZugangArt, number>> = { link: 7, schluessel: 90 };
/** So lange gilt ein alter Schlüssel nach „Neu ausstellen“ weiter, damit ein Werkzeug umziehen kann. Ein alter Link gilt sofort nicht mehr. */
export const KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE = 7;
/** Gedeckelt werden die gültigen Zugänge je Art, nie geräumt wird nach Anzahl (Legacy: 50 Links). */
export const KARTEN_ZUGANG_HOECHSTENS = 50;
/** Ab so wenigen Tagen zeigt die Liste „läuft bald ab“. */
export const KARTEN_BALD_TAGE = 2;
export const KARTEN_FUER_WEN_LAENGE = 80;

const KARTEN_SCHLUESSEL = /^avk_[A-Za-z0-9_-]{43}$/u;
export function istKartenSchluessel(wert: string | undefined): wert is string {
    return wert !== undefined && KARTEN_SCHLUESSEL.test(wert);
}

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;

export const KartenEintrag = Type.Object(
    {
        id: Type.String({ pattern: KARTEN_ID_MUSTER }),
        art: Type.Union([Type.Literal("png"), Type.Literal("svg")]),
        name: Type.String(),
        beschreibung: Type.String(),
        /** Der Name der Datei im ZIP. */
        datei: Type.String(),
        /** Größe in Bytes; `null`: Die Datei liegt auf diesem Server nicht vor. */
        bytes: Nullable(Type.Integer({ minimum: 0 })),
        /** Wann die Datei entstand. */
        stand: Nullable(Type.String({ format: "date-time" })),
        /** Die Fassung: bei PNG die Kachelrevision der Serie, bei SVG die Kartenfassung. */
        fassung: Nullable(Type.String()),
        /** Kantenlänge in Pixeln; bei SVG die der Zeichenfläche. */
        pixel: Nullable(Type.Integer({ minimum: 1 })),
        sha256: Nullable(Type.String({ pattern: "^[0-9a-f]{64}$" })),
        nurEditoren: Type.Boolean(),
    },
    strict,
);
export type KartenEintrag = Static<typeof KartenEintrag>;

export const KartenAbruf = Type.Object(
    {
        zeit: Type.String({ format: "date-time" }),
        zustand: Type.Union([Type.Literal("laeuft"), Type.Literal("vollstaendig"), Type.Literal("abgebrochen")]),
        bytes: Type.Integer({ minimum: 0 }),
        geliefert: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type KartenAbruf = Static<typeof KartenAbruf>;

export const KartenZugang = Type.Object(
    {
        id: Type.String({ format: "uuid" }),
        art: Type.Union(KARTEN_ZUGANG_ARTEN.map((art) => Type.Literal(art))),
        /** Die ersten Zeichen des Werts, zum Wiedererkennen; kein Geheimnis. */
        kennung: Type.String(),
        fuerWen: Type.String(),
        karten: Type.Array(Type.String()),
        zustand: Type.Union([Type.Literal("aktiv"), Type.Literal("abgelaufen"), Type.Literal("widerrufen")]),
        angelegt: Type.String({ format: "date-time" }),
        laeuftAb: Type.String({ format: "date-time" }),
        widerrufen: Nullable(Type.String({ format: "date-time" })),
        /** `null`: Die Person, die ihn anlegte, hat ihr Konto aufgelöst. */
        von: Nullable(Type.String()),
        zuletzt: Nullable(Type.String({ format: "date-time" })),
        abrufe: Type.Integer({ minimum: 0 }),
        letzteAbrufe: Type.Array(KartenAbruf),
    },
    strict,
);
export type KartenZugang = Static<typeof KartenZugang>;

export const KARTEN_SVG_EBENEN = ["landschaften", "gebiete", "wege", "kraftlinien", "orte", "beschriftungen"] as const;
export type KartenSvgEbene = (typeof KARTEN_SVG_EBENEN)[number];

/** Die eigenen Einstellungen eines SVG-Abzugs, wie auf Legacys Seite. */
export const KartenSvgEinstellungen = Type.Object(
    {
        dialekt: Type.Union([Type.Literal("inkscape"), Type.Literal("illustrator")]),
        groessePx: Type.Integer({ minimum: 256, maximum: 200_000 }),
        semantik: Type.Boolean(),
        passmarken: Type.Boolean(),
        strichProzent: Type.Integer({ minimum: 5, maximum: 400 }),
        glattWege: Type.Boolean(),
        glattFlaechen: Type.Boolean(),
        spannung: Type.Number({ minimum: 0, maximum: 1 }),
        ebenen: Type.Array(Type.Union(KARTEN_SVG_EBENEN.map((ebene) => Type.Literal(ebene))), {
            minItems: 1,
            uniqueItems: true,
        }),
    },
    strict,
);
export type KartenSvgEinstellungen = Static<typeof KartenSvgEinstellungen>;

export const KARTEN_SVG_JOB_ART = "karten_svg";

export const KartenSvgStand = Type.Object(
    {
        zustand: Type.Union([Type.Literal("ruht"), Type.Literal("laeuft"), Type.Literal("fehler")]),
        fehler: Nullable(Type.String()),
        /** Die Karte hat sich seit dem letzten Abzug geändert. */
        veraltet: Type.Boolean(),
    },
    strict,
);
export type KartenSvgStand = Static<typeof KartenSvgStand>;

export const KartenExportStand = Type.Object(
    {
        jetzt: Type.String({ format: "date-time" }),
        karten: Type.Array(KartenEintrag),
        links: Type.Array(KartenZugang),
        schluessel: Type.Array(KartenZugang),
        svg: KartenSvgStand,
    },
    strict,
);
export type KartenExportStand = Static<typeof KartenExportStand>;

export const KartenZugangAnlegen = Type.Object(
    {
        operationId: OperationId,
        art: Type.Union(KARTEN_ZUGANG_ARTEN.map((art) => Type.Literal(art))),
        fuerWen: Type.String({ minLength: 1, maxLength: KARTEN_FUER_WEN_LAENGE }),
        tage: Type.Integer({ minimum: 1, maximum: 365 }),
        karten: Type.Array(Type.String({ pattern: KARTEN_ID_MUSTER }), {
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
        }),
    },
    strict,
);
export type KartenZugangAnlegen = Static<typeof KartenZugangAnlegen>;

export const KartenZugangHandlung = Type.Object({ operationId: OperationId }, strict);
export type KartenZugangHandlung = Static<typeof KartenZugangHandlung>;

export const KartenZugangNeu = Type.Object(
    {
        id: Type.String({ format: "uuid" }),
        /** Der ganze Link oder Schlüssel. 🔴 Er steht nur in dieser Antwort; gespeichert wird sein Hash. */
        wert: Type.String(),
        laeuftAb: Type.String({ format: "date-time" }),
    },
    strict,
);
export type KartenZugangNeu = Static<typeof KartenZugangNeu>;

export const KartenSvgAuftrag = Type.Object(
    {
        operationId: OperationId,
        /** Ohne: die beiden festen Abzüge (roh und geglättet). Mit: ein eigener Abzug. */
        einstellungen: Type.Optional(KartenSvgEinstellungen),
    },
    strict,
);
export type KartenSvgAuftrag = Static<typeof KartenSvgAuftrag>;

/** Die Antwort auf `GET /api/karten-paket/oeffnen`: alles, was die Empfängerseite zeigt. */
export const KartenPaketSicht = Type.Object(
    {
        karten: Type.Array(KartenEintrag),
        bytes: Type.Integer({ minimum: 0 }),
        laeuftAb: Type.String({ format: "date-time" }),
        /** Die Adresse des ZIP, mit kurzlebigem Ticket. */
        datei: Type.String(),
        nennung: Type.Array(Type.String()),
        lizenz: Type.Object({ name: Type.String(), uri: Type.String() }, strict),
    },
    strict,
);
export type KartenPaketSicht = Static<typeof KartenPaketSicht>;

/** Die Antwort auf `GET /api/v1/karten`. */
export const KartenApiListe = Type.Object(
    {
        vertrag: Type.Literal(KARTEN_VERTRAG_FASSUNG),
        jetzt: Type.String({ format: "date-time" }),
        laeuftAb: Type.String({ format: "date-time" }),
        karten: Type.Array(KartenEintrag),
    },
    strict,
);
export type KartenApiListe = Static<typeof KartenApiListe>;

/** Die Fehlercodes des Vertrags nach außen. Wer einen neuen braucht, ergänzt ihn hier und im Vertragstest. */
export const KARTEN_API_FEHLER = [
    "unauthorized",
    "not_in_scope",
    "export_not_available",
    "invalid_request",
    "too_many_requests",
    "range_not_satisfiable",
    /** Nur `svg-export?smooth=1`; dort im Rumpf `{"error":"…"}` nach dem Vertrag der Pipeline, nicht in der Hülle. */
    "smooth_export_not_available",
] as const;
