import type { Database, Queryable } from "../../src/database.ts";
import { LEGACY_SHAPE, MEDIA_CLASSES, MEDIA_SOURCE_SYSTEM, type MediaClass } from "../../src/migration/media-legacy.ts";
import { RULE_SEED_SCOPE_TEXTS } from "../../src/migration/media-rules.ts";

/**
 * Fixtures für die Tests des Medienimports (WI-0063 MEDIA-M8 bis M10): Fachobjekte mit Legacy-Kennung, Manifeste in der Form von
 * Legacys Export E5 (A öffentlich, B privat) und das Aufräumen. Nichts davon ist ein echtes Legacy-Medium; die Beispiele folgen den
 * Beispielantworten `docs/legacy-exporte/media-export*.beispiel.json` in Legacy-Commit `024e3af3d`.
 *
 * Alles trägt die Marke `6d656469-` (UUID-Anfang): `cleanLegacyMedia` entfernt genau das und nichts Fremdes.
 */

const MAP_DOMAIN = "aventuria";
/** `mimp` in Hex: nicht der Anfang der Fixtures der anderen Medientests (`6d656469-`), damit sich beide nie ins Gehege kommen. */
export const PREFIX = "6d696d70-";

export type SubjectKind = "place" | "territory" | "adventure" | "citymap";

const KIND_DIGIT: Readonly<Record<SubjectKind, string>> = { place: "1", territory: "2", adventure: "3", citymap: "4" };

/** Die Legacy-Kennung eines Fixture-Objekts: stabil und erkennbar. */
export const subjectId = (kind: SubjectKind, n: number): string =>
    `${PREFIX}${KIND_DIGIT[kind]}000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export async function insertSubjects(
    database: Queryable,
    spec: { places?: number[]; territories?: number[]; adventures?: number[]; citymaps?: number[] },
): Promise<void> {
    for (const n of spec.places ?? []) {
        const id = subjectId("place", n);
        await database`
            INSERT INTO place (public_id, legacy_public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${id}, ${id}, ${MAP_DOMAIN}, ${`Importort ${String(n)}`}, 'stadt', ST_SetSRID(ST_MakePoint(300 + ${n}, 320), 0), 'test', TRUE)
        `;
    }
    for (const n of spec.territories ?? []) {
        const id = subjectId("territory", n);
        await database`
            INSERT INTO territory (public_id, legacy_public_id, map_domain_id, name, color, opacity, source_system)
            VALUES (${id}, ${id}, ${MAP_DOMAIN}, ${`Importgebiet ${String(n)}`}, '#B2B065', 0.7, 'test')
        `;
    }
    for (const n of spec.adventures ?? []) {
        const id = subjectId("adventure", n);
        await database`
            INSERT INTO adventure (public_id, legacy_public_id, title, product_type, is_official)
            VALUES (${id}, ${id}, ${`Importwerk ${String(n)}`}, 'abenteuer', TRUE)
        `;
    }
    for (const n of spec.citymaps ?? []) {
        const id = subjectId("citymap", n);
        await database`INSERT INTO citymap (public_id, legacy_public_id, title) VALUES (${id}, ${id}, ${`Importkarte ${String(n)}`})`;
    }
}

export interface PrivateSpec {
    stored_url?: string | null;
    source_url?: string | null;
    legacy_source?: string | null;
    license_text?: string | null;
    author?: string | null;
    attribution?: string | null;
    note?: string | null;
    uploaded_by?: string | null;
    uploaded_at?: string | null;
    shown?: boolean;
    legacy_form?: "string" | "object" | null;
    override_keys?: string[] | null;
}

export interface ItemSpec {
    cls: MediaClass;
    subject: string;
    /** Die Datei in Legacys Speicher; `null`: nur eine fremde Adresse. */
    url?: string | null;
    sort?: number;
    origin?: string | null;
    code?: string | null;
    public?: boolean;
    suppressed?: boolean;
    /** Die Quelle des Gebietswappens im Schlüssel (`override`, `territory`, `staging`). */
    source?: string;
    priv?: PrivateSpec;
}

const urlOf = (spec: ItemSpec): string | null =>
    spec.url === undefined ? `/uploads/test/${spec.subject.slice(-6)}-${String(spec.sort ?? 0)}.webp` : spec.url;

/** Der Schlüssel `legacy_media_key` nach Legacys Formen (media.yaml `identitaet`). */
export function mediaKey(spec: ItemSpec): string {
    const url = urlOf(spec);
    // Die Unterdrückung ohne Datei endet auf `:none` (nur bei Wappen: `coat_none`, leerer Gebiets-Override).
    const tail = spec.suppressed === true && spec.cls.endsWith("coat") ? "none" : (url ?? "");
    switch (spec.cls) {
        case "settlement_image":
            return `settlement-image:${spec.subject}:${url ?? ""}`;
        case "settlement_coat":
            return `settlement-coat:${spec.subject}:${tail}`;
        case "territory_coat":
            return `territory-coat:${spec.subject}:${spec.source ?? "override"}:${tail}`;
        case "citymap_full":
            return `citymap:${spec.subject}:full:${url ?? ""}`;
        case "citymap_preview":
            return `citymap:${spec.subject}:preview:${url ?? ""}`;
        case "literature_cover":
            return `adventure:${spec.subject}:cover:${url ?? ""}`;
    }
}

/** Ein Eintrag des öffentlichen Manifests (A); mit `priv` zusätzlich die Felder von Export B. */
export function rawItem(spec: ItemSpec, kind: "public" | "private"): Record<string, unknown> {
    const shape = LEGACY_SHAPE[spec.cls];
    const url = urlOf(spec);
    const suppression = spec.suppressed === true && spec.cls.endsWith("coat");
    const item: Record<string, unknown> = {
        legacy_media_key: mediaKey(spec),
        media_class: spec.cls,
        subject_kind: shape.subjectKind,
        subject_public_id: spec.subject,
        role: shape.role,
        sort_order: spec.sort ?? 0,
        local_url: suppression ? null : url,
        origin: suppression ? null : (spec.origin ?? defaultOrigin(spec.cls)),
        legacy_rights_code: spec.code === undefined ? null : spec.code,
        legacy_public: spec.public ?? !suppression,
        suppressed: spec.suppressed ?? false,
    };
    if (kind === "private") {
        const priv = spec.priv ?? {};
        Object.assign(item, {
            stored_url: priv.stored_url ?? url,
            source_url: priv.source_url ?? null,
            legacy_source: priv.legacy_source ?? null,
            license_text: priv.license_text ?? null,
            author: priv.author ?? null,
            attribution: priv.attribution ?? null,
            note: priv.note ?? null,
            uploaded_by: priv.uploaded_by ?? null,
            uploaded_at: priv.uploaded_at ?? null,
            shown: priv.shown ?? spec.public ?? !suppression,
            legacy_form: priv.legacy_form ?? (spec.cls === "settlement_image" ? "object" : null),
            override_keys: priv.override_keys ?? null,
        });
    }
    return item;
}

function defaultOrigin(cls: MediaClass): string {
    switch (cls) {
        case "settlement_image":
        case "citymap_full":
            return "upload";
        case "settlement_coat":
        case "territory_coat":
            return "custom";
        case "citymap_preview":
            return "upload";
        case "literature_cover":
            return "upload";
    }
}

/** Die ganze Antwort von Export A (`kind: "public"`) oder B (`kind: "private"`). */
export function manifestOf(
    specs: readonly ItemSpec[],
    kind: "public" | "private",
    mediaRevision = "media-test-1",
): Record<string, unknown> {
    const items = specs.map((spec) => rawItem(spec, kind));
    const byClass: Record<string, number> = {};
    for (const item of items)
        byClass[item["media_class"] as string] = (byClass[item["media_class"] as string] ?? 0) + 1;
    const counts: Record<string, unknown> = { items: items.length, by_class: byClass };
    const document: Record<string, unknown> = {
        ok: true,
        map_revision: 812,
        media_revision: mediaRevision,
        switches: {
            settlement_images: true,
            coats_local: true,
            coats_wiki: true,
            citymaps: true,
            citymap_previews: true,
            game_literature: true,
            game_literature_covers: true,
        },
        counts,
        items,
    };
    if (kind === "private") {
        Object.assign(counts, {
            shown: items.filter((item) => item["shown"] === true).length,
            not_public: items.filter((item) => item["legacy_public"] === false && item["suppressed"] === false).length,
            suppressed: items.filter((item) => item["suppressed"] === true).length,
            game_literature: 0,
            citymaps: 0,
        });
        document["game_literature"] = [];
        document["citymaps"] = [];
    }
    return document;
}

export const ALL_CLASSES = MEDIA_CLASSES;

/**
 * Was dem Test gehört, als SQL-Ausdruck. Die Testdatenbank teilen sich mehrere Sitzungen (und die anderen Medientests): ein Test
 * zählt, ändert und vergleicht NUR die eigenen Zeilen, nie eine Tabelle als Ganzes.
 */
export const MINE = {
    assets: `(SELECT id FROM media_asset WHERE source_system = '${MEDIA_SOURCE_SYSTEM}')`,
    galleries: `(SELECT id FROM media_gallery WHERE source_system = '${MEDIA_SOURCE_SYSTEM}')`,
    places: `(SELECT id FROM place WHERE public_id::text LIKE '${PREFIX}%')`,
    territories: `(SELECT id FROM territory WHERE public_id::text LIKE '${PREFIX}%')`,
    adventures: `(SELECT id FROM adventure WHERE public_id::text LIKE '${PREFIX}%')`,
    citymaps: `(SELECT id FROM citymap WHERE public_id::text LIKE '${PREFIX}%')`,
    rules: `(SELECT id FROM publication_rule WHERE scope_text IN (${RULE_SEED_SCOPE_TEXTS.map((text) => `'${text.replace(/'/g, "''")}'`).join(", ")}))`,
} as const;

/** Je Tabelle die Bedingung, die genau die Zeilen des Tests auswählt. */
export const SCOPE_BY_TABLE: Readonly<Record<string, string>> = {
    media_asset: `t.source_system = '${MEDIA_SOURCE_SYSTEM}'`,
    media_rights: `t.media_asset_id IN ${MINE.assets}`,
    media_creation: `t.media_asset_id IN ${MINE.assets}`,
    media_legacy_source: `t.media_asset_id IN ${MINE.assets}`,
    media_file: `t.media_asset_id IN ${MINE.assets}`,
    media_gallery: `t.source_system = '${MEDIA_SOURCE_SYSTEM}'`,
    media_gallery_item: `t.gallery_id IN ${MINE.galleries}`,
    place_media_gallery: `t.media_gallery_id IN ${MINE.galleries}`,
    place_media: `t.place_id IN ${MINE.places} OR t.media_asset_id IN ${MINE.assets}`,
    territory_media: `t.territory_id IN ${MINE.territories} OR t.media_asset_id IN ${MINE.assets}`,
    adventure_media: `t.adventure_id IN ${MINE.adventures} OR t.media_asset_id IN ${MINE.assets}`,
    citymap_media: `t.citymap_id IN ${MINE.citymaps} OR t.media_asset_id IN ${MINE.assets}`,
    place_media_suppression: `t.place_id IN ${MINE.places}`,
    territory_media_suppression: `t.territory_id IN ${MINE.territories}`,
    publication_rule: `t.id IN ${MINE.rules}`,
    media_rights_evidence: `t.publication_rule_id IN ${MINE.rules} OR t.media_asset_id IN ${MINE.assets}`,
};

/** Ein Fingerabdruck der Zeilen des Tests: ändert ein Lauf auch nur einen Zeitstempel, ändert er sich. */
export async function fingerprint(
    database: Database,
    tables: readonly string[] = Object.keys(SCOPE_BY_TABLE),
): Promise<string> {
    const parts: string[] = [];
    for (const table of tables) {
        const [row] = await database.unsafe<{ h: string | null }[]>(
            `SELECT md5(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text)) AS h FROM ${table} t WHERE ${SCOPE_BY_TABLE[table] ?? "FALSE"}`,
        );
        parts.push(`${table}=${row?.h ?? "leer"}`);
    }
    return parts.join(";");
}

/** Wie viele Zeilen der Test je Tabelle hat. */
export async function scopedCounts(
    database: Database,
    tables: readonly string[] = Object.keys(SCOPE_BY_TABLE),
): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const table of tables) {
        const [row] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${table} t WHERE ${SCOPE_BY_TABLE[table] ?? "FALSE"}`,
        );
        result[table] = row?.n ?? 0;
    }
    return result;
}

/** Entfernt alles, was der Import in der Testdatenbank angelegt hat (Quellsystem `avesmaps-legacy`, Marke, Seed-Regeln). */
export async function cleanLegacyMedia(database: Database): Promise<void> {
    const assets = `(SELECT id FROM media_asset WHERE source_system = '${MEDIA_SOURCE_SYSTEM}')`;
    const galleries = `(SELECT id FROM media_gallery WHERE source_system = '${MEDIA_SOURCE_SYSTEM}')`;
    const places = `(SELECT id FROM place WHERE public_id::text LIKE '${PREFIX}%')`;
    const territories = `(SELECT id FROM territory WHERE public_id::text LIKE '${PREFIX}%')`;
    const adventures = `(SELECT id FROM adventure WHERE public_id::text LIKE '${PREFIX}%')`;
    const citymaps = `(SELECT id FROM citymap WHERE public_id::text LIKE '${PREFIX}%')`;
    const seedScopes = RULE_SEED_SCOPE_TEXTS.map((text) => `'${text.replace(/'/g, "''")}'`).join(", ");
    const rules = `(SELECT id FROM publication_rule WHERE scope_text IN (${seedScopes}))`;
    const statements = [
        `DELETE FROM place_media_suppression WHERE place_id IN ${places}`,
        `DELETE FROM territory_media_suppression WHERE territory_id IN ${territories}`,
        `DELETE FROM place_media WHERE place_id IN ${places} OR media_asset_id IN ${assets}`,
        `DELETE FROM territory_media WHERE territory_id IN ${territories} OR media_asset_id IN ${assets}`,
        `DELETE FROM adventure_media WHERE adventure_id IN ${adventures} OR media_asset_id IN ${assets}`,
        `DELETE FROM citymap_media WHERE citymap_id IN ${citymaps} OR media_asset_id IN ${assets}`,
        `DELETE FROM place_media_gallery WHERE place_id IN ${places} OR media_gallery_id IN ${galleries}`,
        `DELETE FROM media_gallery_item WHERE gallery_id IN ${galleries} OR media_asset_id IN ${assets}`,
        `DELETE FROM media_gallery WHERE source_system = '${MEDIA_SOURCE_SYSTEM}'`,
        `DELETE FROM media_rights_evidence WHERE media_asset_id IN ${assets} OR publication_rule_id IN ${rules}`,
        `DELETE FROM publication_rule WHERE scope_text IN (${seedScopes})`,
        `DELETE FROM media_legacy_source WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_creation WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_rights WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_file WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_asset WHERE source_system = '${MEDIA_SOURCE_SYSTEM}'`,
        `DELETE FROM migration_run WHERE data_domain IN ('media', 'media_files')`,
        `DELETE FROM place WHERE public_id::text LIKE '${PREFIX}%'`,
        `DELETE FROM territory WHERE public_id::text LIKE '${PREFIX}%'`,
        `DELETE FROM adventure WHERE public_id::text LIKE '${PREFIX}%'`,
        `DELETE FROM citymap WHERE public_id::text LIKE '${PREFIX}%'`,
    ];
    for (const statement of statements) await database.unsafe(statement);
}
