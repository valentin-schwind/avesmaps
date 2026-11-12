import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { MapSeries, MapSeriesCatalog, MapSeriesThumb, type MapSeriesTextsEn } from "../map-series.ts";
import { OperationId } from "../operation.ts";
import { RASTER_REVISION_PATTERN } from "../raster-pyramid.ts";

/**
 * Die Kartenserien zur Laufzeit (WI-0220; Betreiber 2026-10-17: „Die Karten von Avesmaps sollen in der Systemsteuerung gelistet
 * werden. Es sollen neue hinzugefügt, gelöscht und ersetzt werden können“).
 *
 * 🔴 **Vorgabe und Abweichung:** Die heutigen Serien stehen weiter in `config/map-series/aventuria.json` (`AVENTURIA_SERIES`); sie
 * sind die Vorgabe. Die Tafel `map_series` (Migration 0167) hält je Umgebung nur, was die Systemsteuerung daran verstellt hat, und
 * die Serien, die dort neu entstehen. Ein leeres Feld einer Zeile heißt „wie die Vorgabe“. So ändert die Migration nichts, was
 * Besucher sehen, und ein Rückweg auf das vorige Release liest einfach wieder die JSON.
 *
 * Diese Datei rechnet beides zusammen, ohne Datenbank und ohne Fastify, für den Server (`GET /api/map-series`) wie für Tests.
 */

/** Der öffentliche Leseweg des wirksamen Katalogs (no-cache mit ETag, gelesen von der Karte vor ihrem Start). */
export const MAP_SERIES_URL = "/api/map-series";

/**
 * Die Kennung einer Serie: Kleinbuchstaben, höchstens 24. Nginx liefert Kacheln nur unter `^/tiles/raster/[a-z]+/…` aus
 * (`ops/deploy/staging-deploy.sh`), und Claudio rät, dabei zu bleiben (Handover 2026-10-17, Antwort Punkt 4).
 */
export const KARTENSERIE_KENNUNG_MUSTER = "^[a-z]{1,24}$";
const KENNUNG = new RegExp(KARTENSERIE_KENNUNG_MUSTER, "u");

export function istKartenserieKennung(id: string): boolean {
    return KENNUNG.test(id);
}

/** Eine Zeile der Tafel `map_series`: `null` heißt „wie die Vorgabe“ (bei neuen Serien: nicht angegeben). */
export interface KartenserieZeile {
    id: string;
    label: string | null;
    description: string | null;
    visibility: MapSeries["visibility"] | null;
    labelsInImage: boolean | null;
    sortOrder: number | null;
    thumb: MapSeriesThumb | null;
    author: string | null;
    origin: string | null;
    derivation: string | null;
    permissionStatement: string | null;
    attribution: string | null;
    en: Partial<MapSeriesTextsEn> | null;
    /** Nur neue Serien: Kantenlänge der Quelle und höchste eigene Stufe (32k: 6, 64k: 7). */
    sourcePixels: number | null;
    maxNativeZoom: number | null;
    isDefault: boolean;
    status: "aktiv" | "papierkorb";
}

/** Abstand der Reihenfolge der Vorgabe-Serien, damit eine verschobene Serie zwischen zwei andere passt. */
const REIHE = 10;

/**
 * Die Reihenfolge der Vorgabe-Serien im Fächer, ohne eigene Wahl: Legacys `#mapStyleSelect` (Modern, Original, Old), vorher fest in
 * `controls/map-fan.vue`. Eine Serie der JSON, die hier fehlt, kommt danach in der Reihenfolge der JSON.
 */
export const KARTENSERIEN_VORGABE_REIHENFOLGE: readonly string[] = ["modern", "original", "old"];

function vorgabeRang(id: string, index: number): number {
    const rang = KARTENSERIEN_VORGABE_REIHENFOLGE.indexOf(id);
    return (rang < 0 ? KARTENSERIEN_VORGABE_REIHENFOLGE.length + index : rang) * REIHE;
}

function mitAbweichung(basis: MapSeries, zeile: KartenserieZeile): MapSeries {
    const en = { ...basis.en, ...(zeile.en ?? {}) };
    const serie: MapSeries = {
        ...basis,
        label: zeile.label ?? basis.label,
        description: zeile.description ?? basis.description,
        visibility: zeile.visibility ?? basis.visibility,
        labelsInImage: zeile.labelsInImage ?? basis.labelsInImage,
        author: zeile.author ?? basis.author,
        origin: zeile.origin ?? basis.origin,
        derivation: zeile.derivation ?? basis.derivation,
        permission: { ...basis.permission, statement: zeile.permissionStatement ?? basis.permission.statement },
        attribution: zeile.attribution ?? basis.attribution,
        // Eine ersetzte Fassung mit anderer Kante (Schnitt 3, Auftrag `map_series_tile`).
        sourcePixels: zeile.sourcePixels ?? basis.sourcePixels,
        maxNativeZoom: zeile.maxNativeZoom ?? basis.maxNativeZoom,
        en,
    };
    const thumb = zeile.thumb ?? basis.thumb;
    return thumb === undefined ? serie : { ...serie, thumb };
}

/** Eine neue Serie aus ihrer Zeile; ohne Kantenlänge und Stufe (noch nicht zerlegt) gibt es sie für die Karte nicht. */
function neueSerie(zeile: KartenserieZeile): MapSeries | undefined {
    if (zeile.sourcePixels === null || zeile.maxNativeZoom === null || zeile.label === null) return undefined;
    const derivation = zeile.derivation ?? "";
    const serie: MapSeries = {
        id: zeile.id,
        label: zeile.label,
        description: zeile.description ?? "",
        variant: zeile.labelsInImage === true ? "labels-in-image" : "no-labels",
        labelsInImage: zeile.labelsInImage === true,
        sourcePixels: zeile.sourcePixels,
        tileSize: 512,
        maxNativeZoom: zeile.maxNativeZoom,
        status: "IMPORTED",
        author: zeile.author ?? "",
        origin: zeile.origin ?? "",
        derivation,
        derivationStatus: derivation.trim() === "" ? "UNDOCUMENTED" : "DOCUMENTED",
        sourceCreated: "unknown",
        permission: {
            statement: zeile.permissionStatement ?? "",
            grantedBy: "nicht dokumentiert",
            grantedAt: "nicht dokumentiert",
            form: "nicht dokumentiert",
            evidenceRef: "",
        },
        visibility: zeile.visibility ?? "EDITOR_ONLY",
        attribution: zeile.attribution ?? "",
        en: {
            origin: zeile.en?.origin ?? "",
            derivation: zeile.en?.derivation ?? "",
            permission: zeile.en?.permission ?? "",
            attribution: zeile.en?.attribution ?? "",
        },
    };
    return zeile.thumb === null ? serie : { ...serie, thumb: zeile.thumb };
}

/**
 * Der wirksame Katalog: die Vorgabe, überschrieben von den Zeilen, dazu die neuen Serien, ohne den Papierkorb, in der Reihenfolge
 * des Fächers.
 *
 * - 🔴 Eine Serie mit Beschriftung im Bild darf für alle sichtbar sein, Besucher sehen sie aber nur unter „Nur Karte“ (Betreiber
 *   2026-11-10, `nurUnterNurKarte`; `docs/regeln/oberflaeche.md` „Kartenserie `old`“). Deshalb ist sie nie die Vorgabe: Die Karte
 *   öffnet in einer Ansicht mit unseren Namen, und dort stünde jeder doppelt.
 * - Die Vorgabe-Serie ist die Zeile mit `isDefault`, wenn sie im Katalog steht und überall für alle sichtbar ist; sonst die Vorgabe
 *   der JSON, wenn sie noch dasteht; sonst die erste solche. Ein Katalog ohne sichtbare Serie behält die JSON-Vorgabe, statt leer zu
 *   sein (das verhindern die Schreibwege; hier nur der Halt, falls eine Hand am SQL es doch schafft).
 */
export function wirksamerKatalog(basis: MapSeriesCatalog, zeilen: readonly KartenserieZeile[]): MapSeriesCatalog {
    const nachKennung = new Map(zeilen.filter((z) => istKartenserieKennung(z.id)).map((z) => [z.id, z]));
    const eintraege: { serie: MapSeries; reihe: number }[] = [];
    basis.series.forEach((vorgabe, index) => {
        const zeile = nachKennung.get(vorgabe.id);
        if (zeile?.status === "papierkorb") return;
        const serie = zeile === undefined ? vorgabe : mitAbweichung(vorgabe, zeile);
        eintraege.push({ serie, reihe: zeile?.sortOrder ?? vorgabeRang(vorgabe.id, index) });
    });
    const vorgabeKennungen = new Set(basis.series.map((s) => s.id));
    for (const zeile of nachKennung.values()) {
        if (vorgabeKennungen.has(zeile.id) || zeile.status === "papierkorb") continue;
        const serie = neueSerie(zeile);
        const ende = (KARTENSERIEN_VORGABE_REIHENFOLGE.length + basis.series.length + 1) * REIHE;
        if (serie !== undefined) eintraege.push({ serie, reihe: zeile.sortOrder ?? ende });
    }
    const series = eintraege
        .sort((a, b) => a.reihe - b.reihe || a.serie.id.localeCompare(b.serie.id))
        .map(({ serie }) => serie);
    const ueberallFuerAlle = (s: MapSeries) => s.visibility === "PUBLIC" && !s.labelsInImage;
    const fuerAlle = (id: string | undefined) =>
        id !== undefined && series.some((s) => s.id === id && ueberallFuerAlle(s));
    const gewaehlt = zeilen.find((z) => z.isDefault && z.status === "aktiv")?.id;
    const defaultSeries = fuerAlle(gewaehlt)
        ? gewaehlt!
        : fuerAlle(basis.defaultSeries)
          ? basis.defaultSeries
          : (series.find(ueberallFuerAlle)?.id ?? basis.defaultSeries);
    // Ohne `notes` und Kommentare der JSON: Die liest niemand außer dem Repository.
    return {
        schemaVersion: basis.schemaVersion,
        mapDomain: basis.mapDomain,
        defaultSeries,
        license: basis.license,
        series,
    };
}

// ── Die Verwaltung: Lesemodell und Schreibweg des Reiters „Kartenserien“ (WI-0220 Schnitt 2) ───────────────────────────────────

/** Lesen (view_operations) und Schreiben (manage_map_series, Passkey) des Reiters. */
export const KARTENSERIEN_URL = "/api/admin/system/kartenserien";

/**
 * Wer eine Serie im Fächer sieht (Vorlage WI-0220 Fassung 4, Betreiber 2026-10-18 abgenommen): alle, nur Editoren, niemand.
 * „Niemand“ ist der Inhaltsschalter `map.series.<id>` (derselbe wie im Reiter „Inhalte“), die anderen beiden `visibility`.
 */
export const KARTENSERIE_STUFEN = ["alle", "editoren", "niemand"] as const;
export type KartenserieStufe = (typeof KARTENSERIE_STUFEN)[number];

export function kartenserieStufe(serie: Pick<MapSeries, "visibility">, ausgeblendet: boolean): KartenserieStufe {
    if (ausgeblendet) return "niemand";
    return serie.visibility === "EDITOR_ONLY" ? "editoren" : "alle";
}

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const Text = (max: number) => Type.String({ maxLength: max });

// ── Hochladen und Zerlegen (WI-0220 Schnitt 3; Vertrag mit Claudio 2026-10-18) ─────────────────────────────────────────────────

/**
 * Das Hochladen geht stückweise und fortsetzbar über ein eigenes kleines Protokoll (WI-0220 §4.2): anlegen (Größe, SHA-256, Ziel),
 * Stücke zu 8 MiB mit Versatz (`PUT`), Stand abfragen, abschließen. Nginx hat dafür eine eigene Location ohne Request-Puffer
 * (`client_max_body_size 9m`). Der Abschluss reiht den Auftrag `map_series_tile` ein (prüfen, zerlegen, Manifest, umschalten).
 */
export const KARTENSERIEN_UPLOADS_URL = `${KARTENSERIEN_URL}/uploads`;
export const KARTENSERIE_STUECK_BYTES = 8 * 1024 * 1024;
/**
 * Die Prüfsumme je Stück (SHA-256, hex) im Kopf der Anfrage. Der Browser rechnet sie mit SubtleCrypto über 8 MiB; über die ganze Datei
 * ginge das nicht (SubtleCrypto braucht alles auf einmal, ein 64k-PNG hat Gigabytes). Die Prüfsumme der ganzen Quelle rechnet der Auftrag.
 */
export const KARTENSERIE_STUECK_PRUEFSUMME = "x-avesmaps-sha256";
/** Kachelkante der Pyramide (ADR-0008). */
export const KARTENSERIE_KACHEL_PX = 512;
/** Erlaubte Kanten: ein Quadrat, eine Zweierpotenz mal 512, von 8k bis 64k (WI-0220 §4.2). */
export const KARTENSERIE_KANTEN: readonly number[] = [8192, 16384, 32768, 65536];
/** Obergrenze einer Quelle: ein 64k-PNG ist gepackt 2 bis 6 GB (Claudios Messung); mit Abstand nach oben. */
export const KARTENSERIE_HOECHSTENS_BYTES = 16 * 1024 ** 3;

/** Die höchste Stufe einer Kante (32768 px ergibt 6); `null` für eine Kante, die keine Pyramide ergibt. */
export function kartenserieStufen(kante: number): number | null {
    return KARTENSERIE_KANTEN.includes(kante) ? Math.log2(kante / KARTENSERIE_KACHEL_PX) : null;
}

/** Wie viele Kacheln die Pyramide einer Kante hat (Stufe 0 bis n, je Stufe 4^z). */
export function kartenserieKachelzahl(kante: number): number {
    const stufen = kartenserieStufen(kante);
    if (stufen === null) return 0;
    let summe = 0;
    for (let z = 0; z <= stufen; z += 1) summe += 4 ** z;
    return summe;
}

/**
 * Breite und Höhe aus dem Kopf eines PNG (Signatur und IHDR, die ersten 24 Bytes); `null`, wenn es kein PNG ist. Der Browser liest
 * damit nur den Anfang der Datei, nie das ganze Bild; der Server prüft beim Abschluss dasselbe, der Auftrag danach mit libvips.
 */
export function pngKopf(kopf: Uint8Array): { breite: number; hoehe: number } | null {
    const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (kopf.length < 24 || signatur.some((b, i) => kopf[i] !== b)) return null;
    const ihdr = String.fromCharCode(kopf[12]!, kopf[13]!, kopf[14]!, kopf[15]!);
    if (ihdr !== "IHDR") return null;
    const zahl = (o: number) => ((kopf[o]! << 24) >>> 0) + (kopf[o + 1]! << 16) + (kopf[o + 2]! << 8) + kopf[o + 3]!;
    return { breite: zahl(16), hoehe: zahl(20) };
}

/** Was eine neue Serie beim Anlegen mitbringt; Lizenz und Herkunft trägt danach „Lizenz und Herkunft bearbeiten“ ein. */
export const KartenserieAnlage = Type.Object(
    {
        label: Type.String({ minLength: 1, maxLength: 60 }),
        description: Type.Optional(Text(300)),
        labelsInImage: Type.Boolean(),
        nurEditoren: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type KartenserieAnlage = Static<typeof KartenserieAnlage>;

/** Wohin ein Upload geht: eine neue Serie (mit ihrer Anlage) oder eine neue Fassung einer vorhandenen. Der Zweig mit Pflichtfeld vorn (ajv). */
export const KartenserieUploadZiel = Type.Union([
    Type.Object(
        {
            art: Type.Literal("neu"),
            id: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }),
            anlage: KartenserieAnlage,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        { art: Type.Literal("ersetzen"), id: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }) },
        { additionalProperties: false },
    ),
    // Nur die Quelle ablegen, ohne zu zerlegen (WI-0280): Die drei Serien der Vorgabe wurden lokal zerlegt, ihr PNG liegt nicht auf dem Server. Die Kacheln ändern sich nicht.
    Type.Object(
        { art: Type.Literal("quelle"), id: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }) },
        { additionalProperties: false },
    ),
]);
export type KartenserieUploadZiel = Static<typeof KartenserieUploadZiel>;

export const KartenserieUploadAnlegen = Type.Object(
    {
        operationId: OperationId,
        ziel: KartenserieUploadZiel,
        bytes: Type.Integer({ minimum: 1, maximum: KARTENSERIE_HOECHSTENS_BYTES }),
        /** Die Kante aus dem Kopf des PNG, wie der Browser sie gelesen hat; der Server prüft sie beim Abschluss nach. */
        kante: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
);
export type KartenserieUploadAnlegen = Static<typeof KartenserieUploadAnlegen>;

/** Der Stand eines Uploads: was angekommen ist, damit der Browser nach einem Abbruch beim nächsten Stück weitermacht. */
export const KartenserieUpload = Type.Object(
    {
        uploadId: Type.String({ format: "uuid" }),
        ziel: KartenserieUploadZiel,
        bytes: Type.Integer({ minimum: 1 }),
        empfangen: Type.Integer({ minimum: 0 }),
        kante: Type.Integer({ minimum: 1 }),
        stueckBytes: Type.Integer({ minimum: 1 }),
        angelegt: Moment,
    },
    { additionalProperties: false },
);
export type KartenserieUpload = Static<typeof KartenserieUpload>;

export const KartenserieUploadAbschluss = Type.Object({ operationId: OperationId }, { additionalProperties: false });
export type KartenserieUploadAbschluss = Static<typeof KartenserieUploadAbschluss>;

/** Die Phasen des Auftrags `map_series_tile`, in dieser Reihenfolge (WI-0220 §4.3). */
export const KARTENSERIE_PHASEN = ["pruefen", "zerlegen", "manifest", "umschalten"] as const;

/** Der Auftrag einer Serie im Lesemodell (aus der Warteschlange, `input_ref->>'serie'`). */
export const KartenserieAuftrag = Type.Object(
    {
        jobId: Type.String(),
        state: Type.String(),
        phase: Nullable(Type.String()),
        progress: Nullable(Type.Number()),
        waitReason: Nullable(Type.String()),
        fehler: Nullable(Type.String()),
        art: Type.Union([Type.Literal("neu"), Type.Literal("ersetzen")]),
        kante: Nullable(Type.Integer()),
        seit: Moment,
    },
    { additionalProperties: false },
);
export type KartenserieAuftrag = Static<typeof KartenserieAuftrag>;

// ── Papierkorb und Übernahme nach Production (WI-0220 Schnitt 4, Vorlage Fassung 4) ────────────────────────────────────────────

/**
 * So lange bleiben Kacheln und Quelle einer Serie im Papierkorb liegen (Vorlage Fassung 4: „Kacheln und Quelle bleiben 30 Tage
 * liegen“, abgenommen 2026-10-18). Danach räumt die Pflege der Warteschlange sie weg, und Wiederherstellen geht nicht mehr.
 */
export const KARTENSERIE_PAPIERKORB_TAGE = 30;

/** Wann eine Serie, die seit `seit` im Papierkorb liegt, endgültig weggeräumt wird. */
export function kartenserieEndgueltig(seit: Date): Date {
    return new Date(seit.getTime() + KARTENSERIE_PAPIERKORB_TAGE * 24 * 60 * 60 * 1000);
}

/**
 * „Nach Production übernehmen“ (Vorlage Fassung 4, Weg A): ein Knopf auf der Stage, nur für die Betreiber (`release_to_production`,
 * Passkey). Er reiht in der Stage den Auftrag `map_series_production` ein; ausgeführt wird er von Claudios Korridor, denn Production
 * gehört einem anderen Dienstbenutzer (Handover 2026-10-18 „Übernahme nach Production“). Auf Production wird nichts neu zerlegt.
 */
export const KARTENSERIEN_PRODUCTION_URL = `${KARTENSERIEN_URL}/production`;
export const KARTENSERIE_UEBERNAHME_ART = "map_series_production";
/** Die Phasen der Übernahme, wie sie der Korridor meldet (`avesmaps3d-corridor-jobs sync-phase`). */
export const KARTENSERIE_UEBERNAHME_PHASEN = ["kopieren", "einspielen", "proben"] as const;

export const KartenserieUebernahmeBody = Type.Object(
    { operationId: OperationId, id: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }) },
    { additionalProperties: false },
);
export type KartenserieUebernahmeBody = Static<typeof KartenserieUebernahmeBody>;

/**
 * Was die Übernahme von einer Serie nach Production mitnimmt: die Einstellungen, wie die Stage sie gerade zeigt (nicht nur die
 * Abweichungen). Vorgabe und Papierkorb bleiben Sache jeder Umgebung; `istVorgabe` sagt nur, ob sie auf der Stage die Vorgabe ist.
 */
export const KartenserieEinstellungen = Type.Object(
    {
        label: Type.String({ minLength: 1, maxLength: 60 }),
        description: Text(300),
        visibility: Type.Union([Type.Literal("PUBLIC"), Type.Literal("EDITOR_ONLY")]),
        labelsInImage: Type.Boolean(),
        sortOrder: Type.Integer(),
        thumb: Nullable(MapSeriesThumb),
        author: Text(500),
        origin: Text(2000),
        derivation: Text(2000),
        permissionStatement: Text(2000),
        attribution: Text(500),
        en: Type.Object(
            { origin: Text(2000), derivation: Text(2000), permission: Text(2000), attribution: Text(500) },
            { additionalProperties: false },
        ),
        sourcePixels: Type.Integer({ minimum: 1 }),
        maxNativeZoom: Type.Integer({ minimum: 0, maximum: 8 }),
        istVorgabe: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type KartenserieEinstellungen = Static<typeof KartenserieEinstellungen>;

/**
 * Die Eingabe des Auftrags `map_series_production` (`input_ref`), zugleich die Datei, die der Korridor dem Befehl
 * `kartenserie-uebernehmen` auf Production gibt. `quelle` ist die Datei unter `map-sources/<serie>/`, aus der die Fassung zerlegt
 * wurde; `null` für Serien, deren Original nur bei den Betreibern liegt (F2). 🔴 Ohne Namen: Wer gedrückt hat, steht im Protokoll und am
 * Auftrag der Stage; nach Production geht keine Person mit (sie würde dort beim Auflösen eines Kontos nicht geschwärzt).
 */
export const KartenserieUebernahme = Type.Object(
    {
        serie: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }),
        revision: Type.String({ pattern: RASTER_REVISION_PATTERN }),
        quelle: Nullable(Type.String({ pattern: "^[0-9a-f]{12}\\.png$" })),
        einstellungen: KartenserieEinstellungen,
    },
    { additionalProperties: false },
);
export type KartenserieUebernahme = Static<typeof KartenserieUebernahme>;

/** Die letzte Übernahme einer Serie im Lesemodell (aus der Warteschlange der Stage). */
export const KartenserieUebernahmeStand = Type.Object(
    {
        jobId: Type.String(),
        state: Type.String(),
        phase: Nullable(Type.String()),
        fehler: Nullable(Type.String()),
        revision: Type.String(),
        seit: Moment,
        bis: Nullable(Moment),
    },
    { additionalProperties: false },
);
export type KartenserieUebernahmeStand = Static<typeof KartenserieUebernahmeStand>;

/** Eine Fassung auf der Platte: eine Revision unter `TILE_ROOT/<serie>/`; `aktuell`, wenn `current.json` auf sie zeigt. */
export const KartenserieFassung = Type.Object(
    { revision: Type.String({ pattern: RASTER_REVISION_PATTERN }), aktuell: Type.Boolean(), seit: Nullable(Moment) },
    { additionalProperties: false },
);
export type KartenserieFassung = Static<typeof KartenserieFassung>;

/** Eine Serie im Lesemodell: die wirksame Serie samt dem, was nur die Verwaltung braucht. */
export const AdminKartenserie = Type.Object(
    {
        serie: MapSeries,
        /** `vorgabe`: aus der JSON (Felder ohne Abweichung zeigen die Vorgabe); `neu`: in der Systemsteuerung entstanden. */
        quelle: Type.Union([Type.Literal("vorgabe"), Type.Literal("neu")]),
        /** Liegt das PNG der Serie auf diesem Server (`map-sources/<serie>/`)? Ohne ist sie im ZIP nicht zu haben (WI-0280). */
        quelleDa: Type.Optional(Type.Boolean()),
        stufe: Type.Union(KARTENSERIE_STUFEN.map((s) => Type.Literal(s))),
        istVorgabe: Type.Boolean(),
        /** Der Zeiger der Pyramide (`current.json`), wenn der Server ihn lesen kann (`TILE_ROOT`); sonst `null`. */
        fassung: Nullable(Type.Object({ revision: Type.String(), maxNativeZoom: Type.Integer({ minimum: 0 }) })),
        /** Die Fassungen auf der Platte (Revisionen neben `current.json`), die neueste zuerst; leer ohne `TILE_ROOT` (Schnitt 3). */
        fassungen: Type.Array(KartenserieFassung),
        /** Der letzte Auftrag `map_series_tile` dieser Serie (Hochladen und Zerlegen), solange er läuft oder gescheitert ist. */
        auftrag: Nullable(KartenserieAuftrag),
        /** Die letzte Übernahme nach Production (Schnitt 4); `null`, wenn es keine gab. */
        uebernahme: Nullable(KartenserieUebernahmeStand),
        geaendert: Nullable(Type.Object({ at: Moment, by: Nullable(Type.String()) })),
    },
    { additionalProperties: false },
);
export type AdminKartenserie = Static<typeof AdminKartenserie>;

export const AdminKartenserien = Type.Object(
    {
        now: Moment,
        /** `map_series_state.revision`, Grundlage für `baseRevision`; `null` vor Migration 0167. */
        revision: Nullable(Type.Integer({ minimum: 0 })),
        source: Type.Union([Type.Literal("database"), Type.Literal("unprovisioned")]),
        license: MapSeriesCatalog.properties.license,
        serien: Type.Array(AdminKartenserie),
        /** Im Papierkorb, solange die Frist läuft; `endgueltig` ist der Tag, an dem Kacheln und Quelle weggeräumt werden. */
        papierkorb: Type.Array(
            Type.Object(
                { id: Type.String(), label: Type.String(), seit: Moment, endgueltig: Moment },
                { additionalProperties: false },
            ),
        ),
        /** Freier Platz unter der Ablage der Quellen und die Grenze, die ein Upload übrig lassen muss; `null` ohne Ablage (Schnitt 3). */
        platz: Nullable(
            Type.Object(
                { freiBytes: Type.Number({ minimum: 0 }), grenzeBytes: Type.Number({ minimum: 0 }) },
                { additionalProperties: false },
            ),
        ),
        /** Angelegte Uploads, die noch nicht abgeschlossen sind (Fortsetzen nach einem Abbruch). */
        uploads: Type.Array(KartenserieUpload),
        /** Neue Serien, die schon angelegt, aber noch nicht zerlegt sind: Im Fächer erscheinen sie erst danach. */
        inArbeit: Type.Array(
            Type.Object(
                { id: Type.String(), label: Type.String(), auftrag: Nullable(KartenserieAuftrag) },
                { additionalProperties: false },
            ),
        ),
        unknownKeys: Type.Array(Type.String()),
    },
    { additionalProperties: false },
);
export type AdminKartenserien = Static<typeof AdminKartenserien>;

/** Die änderbaren Texte; `null` heißt zurück auf die Vorgabe. Längen wie in der Tafel `map_series` (Migration 0167). */
export const KartenserieTexte = Type.Object(
    {
        label: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 60 }))),
        description: Type.Optional(Nullable(Text(300))),
        author: Type.Optional(Nullable(Text(500))),
        origin: Type.Optional(Nullable(Text(2000))),
        derivation: Type.Optional(Nullable(Text(2000))),
        permissionStatement: Type.Optional(Nullable(Text(2000))),
        attribution: Type.Optional(Nullable(Text(500))),
    },
    { additionalProperties: false },
);
export type KartenserieTexte = Static<typeof KartenserieTexte>;

/**
 * Was eine Handlung des Reiters tut; je Handlung ein Eintrag im Protokoll (`system.map_series_changed`).
 *
 * 🪤 **Die Reihenfolge der Zweige ist Absicht.** Fastifys ajv entfernt fremde Felder (`removeAdditional`) schon beim Prüfen eines
 * Zweigs, der danach scheitert. Ein Zweig ohne Pflichtfeld außer `art` (`vorgabe`, `papierkorb`, `wiederherstellen`) scheitert
 * erst an `art` und hätte vorher das Feld eines späteren Zweigs gestrichen (gemessen: `thumb` kam als 400 an). Zweige mit eigenem
 * Pflichtfeld scheitern früh am fehlenden Feld und streichen nichts; darum stehen sie vorn.
 */
export const KartenserieAktion = Type.Union([
    Type.Object({ art: Type.Literal("texte"), texte: KartenserieTexte }, { additionalProperties: false }),
    Type.Object(
        { art: Type.Literal("stufe"), stufe: Type.Union(KARTENSERIE_STUFEN.map((s) => Type.Literal(s))) },
        { additionalProperties: false },
    ),
    Type.Object(
        { art: Type.Literal("reihe"), richtung: Type.Union([Type.Literal("hoch"), Type.Literal("runter")]) },
        { additionalProperties: false },
    ),
    Type.Object({ art: Type.Literal("thumb"), thumb: Nullable(MapSeriesThumb) }, { additionalProperties: false }),
    // Rückweg (Schnitt 3): `current.json` auf eine Fassung, die schon auf der Platte liegt. Schreibt keine Zeile der Tafel.
    Type.Object(
        { art: Type.Literal("fassung"), revision: Type.String({ pattern: RASTER_REVISION_PATTERN }) },
        { additionalProperties: false },
    ),
    Type.Object({ art: Type.Literal("vorgabe") }, { additionalProperties: false }),
    Type.Object({ art: Type.Literal("papierkorb") }, { additionalProperties: false }),
    Type.Object({ art: Type.Literal("wiederherstellen") }, { additionalProperties: false }),
]);
export type KartenserieAktion = Static<typeof KartenserieAktion>;

export const KartenserieBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        id: Type.String({ pattern: KARTENSERIE_KENNUNG_MUSTER }),
        aktion: KartenserieAktion,
    },
    { additionalProperties: false },
);
export type KartenserieBody = Static<typeof KartenserieBody>;
