import { Type, type Static } from "@sinclair/typebox";

/**
 * The English version of what a reader sees about a series (WI-0032, operator 2026-09-24:
 * "Übersetzen"). 🔴 These are legal texts: the operator accepts every version and every change
 * (AGENTS.md). An empty derivation stays empty in English as well - a gap is not translated away.
 */
export const MapSeriesTextsEn = Type.Object(
    {
        origin: Type.String(),
        derivation: Type.String(),
        permission: Type.String(),
        attribution: Type.String(),
    },
    { $id: "MapSeriesTextsEn", additionalProperties: false },
);

export type MapSeriesTextsEn = Static<typeof MapSeriesTextsEn>;

/** Die Stufe, aus der das Bild im Fächermenü stammt: 32 × 32 Kacheln, eine davon ist das Bild (WI-0220). */
export const KARTENSERIE_THUMB_STUFE = 5;

/** Eine Kachel der Stufe 5 als Bild im Fächermenü (WI-0220, Idee A „Ausschnitt der Karte“). */
export const MapSeriesThumb = Type.Object(
    { x: Type.Integer({ minimum: 0, maximum: 31 }), y: Type.Integer({ minimum: 0, maximum: 31 }) },
    { additionalProperties: false },
);

export type MapSeriesThumb = Static<typeof MapSeriesThumb>;

/** Gareth, dieselbe Stelle wie Legacys Vorlagekachel (`z3 / map_17_-17`); das Bild jeder Serie ohne eigene Wahl. */
export const KARTENSERIE_THUMB_VORGABE: MapSeriesThumb = { x: 17, y: 15 };

/**
 * Map series of a domain (chapter 5.3 to 5.5): a visual family of base maps with its own tile
 * pyramid. A series is a rendering concern; it never affects domain geometry (chapter 5.1).
 */
export const MapSeries = Type.Object(
    {
        id: Type.String(),
        label: Type.String(),
        description: Type.String(),
        variant: Type.String(),
        /** Names baked into the raster: the vector label layer must stay silent for this series. */
        labelsInImage: Type.Boolean(),
        sourcePixels: Type.Integer({ exclusiveMinimum: 0 }),
        tileSize: Type.Integer({ exclusiveMinimum: 0 }),
        maxNativeZoom: Type.Integer({ minimum: 0 }),
        status: Type.Union([
            Type.Literal("IMPORTED"),
            Type.Literal("VALIDATED"),
            Type.Literal("STAGING"),
            Type.Literal("PUBLISHED"),
            Type.Literal("SUPERSEDED"),
            Type.Literal("REJECTED"),
        ]),
        /** Who made the original artwork this series goes back to. */
        author: Type.String(),
        /** Where that artwork comes from, including the resolution it was delivered in. */
        origin: Type.String(),
        /** How this particular series was produced from it. Empty while it is not documented. */
        derivation: Type.String(),
        /**
         * Whether the derivation is documented at all. UNDOCUMENTED is a finding, not a todo: it
         * says the production of this file could not be established, so nothing may be invented
         * for it later.
         */
        derivationStatus: Type.Union([Type.Literal("DOCUMENTED"), Type.Literal("UNDOCUMENTED")]),
        /** Creation date of the source raster, "unknown" while it is not established. */
        sourceCreated: Type.String(),
        /**
         * The permission this use rests on, kept apart from its evidence. A missing evidence trail
         * does not mean there is no permission, and the statement alone does not make it
         * documented - so both are recorded, and neither is read as the other.
         */
        permission: Type.Object(
            {
                statement: Type.String(),
                grantedBy: Type.String(),
                grantedAt: Type.String(),
                form: Type.String(),
                evidenceRef: Type.String(),
            },
            { additionalProperties: false },
        ),
        /**
         * Who may choose this series in the interface.
         *
         * `EDITOR_ONLY` keeps a series to editors. A series with `labelsInImage` (`old`: the same
         * map as `original`, with its place names **burnt into the raster**) may be `PUBLIC` since
         * the operator's decision of 2026-11-10, but visitors get it only in the view "Nur Karte",
         * which draws no names of ours (`nurUnterNurKarte`). Anywhere else every name would appear
         * twice. Editors see it in every view.
         *
         * 🪤 And this governs the SWITCHER, not access. Leaving a series out of the list hides it
         * from the eye and from nothing else: its tiles stay reachable under `/tiles/raster/<id>/…`
         * for anyone who types the path, which is intended - editors need them. A series that must
         * not be *fetched* needs its tile path authorised, not its entry removed.
         */
        visibility: Type.Union([Type.Literal("PUBLIC"), Type.Literal("EDITOR_ONLY")]),
        /** Short line shown on the map itself. */
        attribution: Type.String(),
        /** Origin, derivation, permission and attribution in English. */
        en: MapSeriesTextsEn,
        /**
         * Das Bild der Serie im Fächermenü (WI-0220): die Kachel dieser Stufe-5-Stelle der eigenen Pyramide. Fehlt es, gilt
         * `KARTENSERIE_THUMB_VORGABE` (Gareth, wie seit WI-0009).
         */
        thumb: Type.Optional(MapSeriesThumb),
    },
    { $id: "MapSeries", additionalProperties: false },
);

export type MapSeries = Static<typeof MapSeries>;

/** The licence the whole domain's material rests on (chapter 5.5). */
export const MapSeriesLicense = Type.Object(
    {
        name: Type.String(),
        uri: Type.String(),
        terms: Type.String(),
        /** Name and terms in English; the URI is the same for both. */
        en: Type.Object(
            { name: Type.String({ minLength: 1 }), terms: Type.String({ minLength: 1 }) },
            { additionalProperties: false },
        ),
    },
    { $id: "MapSeriesLicense", additionalProperties: false },
);

export type MapSeriesLicense = Static<typeof MapSeriesLicense>;

export const MapSeriesCatalog = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        defaultSeries: Type.String(),
        license: MapSeriesLicense,
        series: Type.Array(MapSeries),
    },
    { $id: "MapSeriesCatalog", additionalProperties: true },
);

export type MapSeriesCatalog = Static<typeof MapSeriesCatalog>;

/**
 * The provenance a series needs before it may be shown to anyone (chapter 5.5). The licence of the
 * Ulisses map package demands the licence URI with every distribution, and the fan guidelines a
 * visible attribution - so an empty field here is not a formality, it is the reason not to publish.
 */
export const PROVENANCE_FIELDS = ["author", "origin", "derivation", "permission", "attribution"] as const;

export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];

/**
 * Returns the provenance fields that are still empty, so a series may be published when this is
 * empty. Field names, not sentences: the wording belongs to whoever shows it, in their language.
 */
export function publicationBlockers(series: MapSeries): ProvenanceField[] {
    return PROVENANCE_FIELDS.filter((field) =>
        field === "permission" ? series.permission.statement.trim() === "" : series[field].trim() === "",
    );
}

/**
 * Whether the permission is backed by something a reader could check. False says only that: it is
 * never a statement that no permission exists.
 *
 * Stand 2026-09-28 (aus current.md hierher verschoben, Hardening Review M1): Für jede heutige Serie
 * besteht die Genehmigung laut Betreiberangabe; erteilende Stelle, Zeitpunkt und Form sind nicht
 * dokumentiert (`permissionIsEvidenced` liefert deshalb heute `false` für alle Serien). Offene
 * Betreiberentscheidung, aber ausdrücklich kein Blocker für die Veröffentlichung.
 */
export function permissionIsEvidenced(series: MapSeries): boolean {
    const { grantedBy, grantedAt, form, evidenceRef } = series.permission;
    return [grantedBy, grantedAt, form, evidenceRef].every(
        (value) => value.trim() !== "" && value.trim().toLowerCase() !== "nicht dokumentiert",
    );
}
