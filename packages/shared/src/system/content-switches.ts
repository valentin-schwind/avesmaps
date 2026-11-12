import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";

/**
 * Die Inhaltsschalter (WI-0127 SYS-10, SYS-0001 §3.4, §6.4; Blatt WI-0119 A2, A5, Z8): die EINE Stelle für Server, Oberfläche und Tests,
 * wie der Capability-Katalog. Ein Schalter blendet für Besucher aus; gelöscht wird nichts. Die Tafel `content_switch` hält nur Abweichungen
 * von der Vorgabe (an); ein Schlüssel, den der Katalog nicht kennt, wird ignoriert und gemeldet.
 *
 * - **Bilder nach Art** und **Notaus nach Rechten** (`media.role.*`, `media.rights.*`, `media.license.<family>`): Fehlerrichtung `closed`,
 *   ist die Tafel nie gelesen worden, gilt „aus“ (Legacy-Lehre G9). „Aus“ gewinnt über beide Achsen.
 * - **Infopanel** (`panel.*`) und **Karte** (`map.series.<id>`): Fehlerrichtung `last_known` (letzter Stand, sonst Vorgabe).
 * - Lizenzfamilien kommen aus `license_catalog.family`, Kartenserien aus `config/map-series/` (die Serien, die Besucher sehen; eine bleibt
 *   immer an). Reiseberechnung (`route.compute`) und 3D-Gelände (`map.terrain3d`) gehören zur Karte (SYS-11, `feature_paused`).
 * - **Nicht** im Katalog: die Karte als Ganzes, Kartenebenen, Werkstattwerte, Einladungen (Legacy-Lehren 7, 8).
 */
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const CONTENT_SWITCH_GROUPS = ["media_role", "media_rights", "panel", "map", "betrieb"] as const;
export type ContentSwitchGroup = (typeof CONTENT_SWITCH_GROUPS)[number];
export type ContentSwitchFailure = "closed" | "last_known";

export interface ContentSwitchSpec {
    readonly key: string;
    readonly group: ContentSwitchGroup;
    readonly failure: ContentSwitchFailure;
}

/** Die festen Schalter, in der Reihenfolge der Tafeln (Blatt A2). */
export const CONTENT_SWITCHES: readonly ContentSwitchSpec[] = [
    { key: "media.role.coat", group: "media_role", failure: "closed" },
    { key: "media.role.header", group: "media_role", failure: "closed" },
    { key: "media.role.map_preview", group: "media_role", failure: "closed" },
    { key: "media.role.literature_cover", group: "media_role", failure: "closed" },
    { key: "media.role.photobox", group: "media_role", failure: "closed" },
    { key: "media.role.social_post", group: "media_role", failure: "closed" },
    { key: "media.rights.permission", group: "media_rights", failure: "closed" },
    { key: "media.rights.fan_policy", group: "media_rights", failure: "closed" },
    { key: "media.rights.own_work", group: "media_rights", failure: "closed" },
    { key: "media.rights.public_domain", group: "media_rights", failure: "closed" },
    { key: "media.rights.unclear", group: "media_rights", failure: "closed" },
    { key: "panel.literature", group: "panel", failure: "last_known" },
    { key: "panel.citymaps", group: "panel", failure: "last_known" },
    { key: "panel.lore.flora", group: "panel", failure: "last_known" },
    { key: "panel.lore.fauna", group: "panel", failure: "last_known" },
    { key: "panel.lore.spezies", group: "panel", failure: "last_known" },
    { key: "panel.lore.ware", group: "panel", failure: "last_known" },
    { key: "panel.reviews", group: "panel", failure: "last_known" },
    // SYS-11: die Karte funktioniert weiter, nur ohne Reiseberechnung beziehungsweise flach.
    { key: "route.compute", group: "map", failure: "last_known" },
    { key: "map.terrain3d", group: "map", failure: "last_known" },
    // WI-0138 V7: die anonyme Besucherzählung anhalten (BESUCH-0001 §4.7). Besucher merken nichts - die Seite tut
    // dasselbe, sie wird nur nicht gezählt. Fehlerrichtung wie bei der Karte: Ist die Tafel nie gelesen worden, gilt der
    // letzte bekannte Stand, sonst die Vorgabe „an“ - eine unerreichbare Schaltertafel soll die Messreihe nicht abreißen.
    { key: "visits.count", group: "betrieb", failure: "last_known" },
    // WI-0272 S2: neue Reisebilder annehmen (Einreichungen der Besucher). Aus: Das Formular sagt es, der Server antwortet 503 `photobox_paused`; bereits
    // eingereichte und freigegebene Bilder bleiben unberührt (sichtbar bleibt, was freigegeben ist: das schaltet allein `media.role.photobox`).
    // Fehlerrichtung wie bei der Besucherzählung: unerreichbare Tafel heißt letzter bekannter Stand, sonst die Vorgabe „an“.
    { key: "photobox.submissions", group: "betrieb", failure: "last_known" },
    // WI-0275 B2: neue Kartenvorschläge annehmen (Besucher ohne Konto). Aus: Das Formular sagt es, der Server antwortet 503 `kartenvorschlag_paused`;
    // Eingereichtes (Statusseite, Datei nachreichen, Zurückziehen) und die Redaktion laufen weiter. Fehlerrichtung wie bei den Reisebildern.
    { key: "kartenvorschlag.submissions", group: "betrieb", failure: "last_known" },
];

/** Der Schalter, der die anonyme Besucherzählung anhält (WI-0138 V7); Server und Oberfläche nennen ihn nie mit Zeichenkette. */
export const BESUCH_SCHALTER = "visits.count";

/** Der Schalter „Einreichungen annehmen“ für Reisebilder (WI-0272 S2); Server (`/api/photobox`) und Oberfläche nennen ihn nie mit Zeichenkette. */
export const PHOTOBOX_EINREICHEN_SCHALTER = "photobox.submissions";

/** Der Schalter „Vorschläge annehmen“ für Kartenvorschläge (WI-0275 B2); Server (`/api/kartenvorschlaege`) und Oberfläche nennen ihn nie mit Zeichenkette. */
export const KARTENVORSCHLAG_EINREICHEN_SCHALTER = "kartenvorschlag.submissions";

/** Was sich pausieren lässt und an welchem Schalter es hängt (WI-0127 SYS-11); der Server antwortet dann `feature_paused`. */
export const PAUSABLE_FEATURES = ["route", "terrain3d"] as const;
export type PausableFeature = (typeof PAUSABLE_FEATURES)[number];
export const FEATURE_SWITCH: Readonly<Record<PausableFeature, string>> = {
    route: "route.compute",
    terrain3d: "map.terrain3d",
};

/** Schlüssel mit einem Teil aus Daten: Lizenzfamilie und Kartenserie. */
export const LICENSE_SWITCH_PREFIX = "media.license.";
export const SERIES_SWITCH_PREFIX = "map.series.";
const TEIL = /^[a-z0-9][a-z0-9_-]{0,40}$/u;

/** Die Rolle einer Verwendung (`media_usage.role`) zum Schalter „Bilder nach Art“; `map_full` hängt an der Kartenvorschau. */
export const MEDIA_ROLE_SWITCH: Readonly<Record<string, string>> = {
    coat: "media.role.coat",
    header: "media.role.header",
    map_preview: "media.role.map_preview",
    map_full: "media.role.map_preview",
    literature_cover: "media.role.literature_cover",
    photobox: "media.role.photobox",
    social_post: "media.role.social_post",
};

/**
 * Die Abschnitte des Infopanels zu ihren Schaltern (`GET {detail}/{sektion}`, auch die Katalogfenster). Die Vorkommen schalten je Art
 * (`loreSwitchKey`); Quellen und Stätten haben keinen Schalter.
 */
export const PANEL_SECTION_SWITCH: Readonly<Partial<Record<string, string>>> = {
    literature: "panel.literature",
    citymaps: "panel.citymaps",
    reviews: "panel.reviews",
};

/** Der Schalter einer Vorkommensart (`panel.lore.<art>`). */
export const loreSwitchKey = (kind: string): string => `panel.lore.${kind}`;

/** Der Schalter einer Kartenserie (`map.series.<id>`). */
export const seriesSwitchKey = (id: string): string => `${SERIES_SWITCH_PREFIX}${id}`;

/** „Ungeklärt“ (Blatt) meint den Prüfstand, nicht den Rechtsgrund `unknown` (der nie öffentlich ist). */
export const UNCLEAR_CLEARANCE = ["unreviewed", "legacy_assumed", "needs_review"] as const;

/**
 * Der Schalter zu einem Schlüssel: fest, `media.license.<family>` mit einer bekannten Familie, `map.series.<id>` mit einer der genannten
 * Serien; sonst `undefined` (unbekannt: ignorieren und melden).
 */
export function contentSwitchSpec(
    key: string,
    known: { licenseFamilies: readonly string[]; series: readonly string[] },
): ContentSwitchSpec | undefined {
    const fest = CONTENT_SWITCHES.find((entry) => entry.key === key);
    if (fest !== undefined) return fest;
    if (key.startsWith(LICENSE_SWITCH_PREFIX)) {
        const family = key.slice(LICENSE_SWITCH_PREFIX.length);
        return TEIL.test(family) && known.licenseFamilies.includes(family)
            ? { key, group: "media_rights", failure: "closed" }
            : undefined;
    }
    if (key.startsWith(SERIES_SWITCH_PREFIX)) {
        const id = key.slice(SERIES_SWITCH_PREFIX.length);
        return TEIL.test(id) && known.series.includes(id) ? { key, group: "map", failure: "last_known" } : undefined;
    }
    return undefined;
}

/** Die Schalter eines Medienstands: Art, Rechtsgrund, Lizenzfamilie und „ungeklärt“; „aus“ gewinnt über alle. */
export function mediaSwitchKeys(input: {
    role: string;
    rightsBasis: string | null;
    licenseFamily: string | null;
    clearance: string | null;
}): string[] {
    const keys: string[] = [];
    const role = MEDIA_ROLE_SWITCH[input.role];
    if (role !== undefined) keys.push(role);
    if (input.rightsBasis !== null && input.rightsBasis !== "license" && input.rightsBasis !== "unknown") {
        keys.push(`media.rights.${input.rightsBasis}`);
    }
    if (input.rightsBasis === "license" && input.licenseFamily !== null)
        keys.push(`${LICENSE_SWITCH_PREFIX}${input.licenseFamily}`);
    if (input.clearance !== null && (UNCLEAR_CLEARANCE as readonly string[]).includes(input.clearance)) {
        keys.push("media.rights.unclear");
    }
    return keys;
}

// --- Verträge ------------------------------------------------------------------------------------------------------------------------

/** Der öffentliche Lesepfad des Stands. */
export const CONTENT_STATE_URL = "/api/content-state";

/**
 * `GET /api/content-state` (öffentlich, ETag = Inhaltsrevision und Stand der Reisebilder): welche Schlüssel gerade aus sind. `reisebilder`: ändert sich, sobald sich die freigegebenen Reisebilder ändern; die offene
 * Seite holt dann leise Karte, Leiste und Ortskopf neu (WI-0272). Die Zeichenkette hat keine Bedeutung außer „anders als vorher“.
 */
export const ContentState = Type.Object(
    {
        revision: Nullable(Type.Integer({ minimum: 0 })),
        off: Type.Array(Type.String()),
        reisebilder: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
export type ContentState = Static<typeof ContentState>;

export const AdminContentSwitchRow = Type.Object(
    {
        key: Type.String(),
        group: literals(CONTENT_SWITCH_GROUPS),
        enabled: Type.Boolean(),
        /** Seit wann und von wem abweichend von der Vorgabe; `null`: Vorgabe (an). */
        changedAt: Nullable(Moment),
        changedBy: Nullable(Type.String()),
        /** Bilder: wie viele Besucher mit diesem Schalter gerade sehen (Assets); `null` bei Abschnitten und Serien oder ohne Zählung. */
        visible: Nullable(Type.Integer({ minimum: 0 })),
        /** Bilder, die dieser Schalter gerade zurückhält (nur, wenn er aus ist). */
        hidden: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
);
export type AdminContentSwitchRow = Static<typeof AdminContentSwitchRow>;

/** `GET /api/admin/content-switches`. */
export const AdminContentSwitches = Type.Object(
    {
        now: Moment,
        /** Die Inhaltsrevision (`system_state.content_revision`), Grundlage für `baseRevision`; `null`, solange der Zustand fehlt. */
        revision: Nullable(Type.Integer({ minimum: 0 })),
        /** `unprovisioned`: Tafel fehlt (vor Migration 0102), es gilt die Vorgabe; `unknown`: nie gelesen, Bilder gelten als aus. */
        source: literals(["database", "unprovisioned", "unknown"] as const),
        rows: Type.Array(AdminContentSwitchRow),
        /** Schlüssel in der Tafel, die der Katalog nicht kennt (ignoriert). */
        unknownKeys: Type.Array(Type.String()),
        /** Ein Quarantäne-Abgleich wartet oder läuft: Die Dateien sind noch nicht überall dort, wo die Schalter sie verlangen (b3). */
        pending: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);
export type AdminContentSwitches = Static<typeof AdminContentSwitches>;

/** `POST /api/admin/content-switches`. */
export const ContentSwitchBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        key: Type.String({ minLength: 1, maxLength: 80 }),
        enabled: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type ContentSwitchBody = Static<typeof ContentSwitchBody>;

export const CONTENT_SWITCH_ERROR_STATUS = { unknown_switch: 400, last_series: 409 } as const;
