import { createHash } from "node:crypto";
import postgres from "postgres";
import type { Database, Queryable } from "../../src/database.ts";
import { storageKey } from "../../src/media/storage.ts";

/**
 * Fixtures für die Medientests gegen die gemeinsame Testdatenbank. Alles, was sie anlegen, trägt eine Marke
 * (Quellsystem `media-test`, UUIDs mit Präfix `6d656469-`, Regeltext `media-test …`) und wird von `cleanMediaFixtures`
 * wieder entfernt, ohne fremde Zeilen zu berühren.
 */

export const FIXTURE_SOURCE = "media-test";
export const FIXTURE_SCOPE = "media-test Regel";
const MAP_DOMAIN = "aventuria";

export const fixtureId = (n: number): string => `6d656469-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const sha = (seed: string): string => createHash("sha256").update(seed).digest("hex");

export interface RightsSpec {
    basis: string;
    clearance: string;
    licenseKey?: string | null;
    licenseFamily?: string | null;
    creator?: string;
    attribution?: string;
    rightsNote?: string;
    legacyRightsCode?: string;
}

export interface PublishedSpec {
    variant: string;
    sha?: string;
    mimeType?: string;
    width?: number;
    height?: number;
}

export interface AssetSpec {
    ref: string;
    mediaKind?: string;
    technicalState?: string;
    moderationState?: string;
    /** `null`: keine Rechtezeile. */
    rights?: RightsSpec | null;
    /** Standard: eine veröffentlichte Datei der Variante `coat`; `[]`: keine. */
    published?: PublishedSpec[];
    ingestActorLegacy?: string;
}

export interface FixtureAsset {
    id: string;
    publicId: string;
}

const PUBLIC_DOMAIN: RightsSpec = { basis: "public_domain", clearance: "legacy_asserted" };

export async function insertAsset(database: Queryable, spec: AssetSpec): Promise<FixtureAsset> {
    const [asset] = await database<{ id: string; public_id: string }[]>`
        INSERT INTO media_asset (media_kind, origin, technical_state, moderation_state, source_system, source_ref, ingest_actor_legacy)
        VALUES (${spec.mediaKind ?? "image"}, 'legacy_import', ${spec.technicalState ?? "ok"}, ${spec.moderationState ?? "not_applicable"},
                ${FIXTURE_SOURCE}, ${spec.ref}, ${spec.ingestActorLegacy ?? null})
        RETURNING id, public_id
    `;
    if (!asset) throw new Error("Asset nicht angelegt");
    const rights = spec.rights === undefined ? PUBLIC_DOMAIN : spec.rights;
    if (rights) {
        await database`
            INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, clearance_state, creator, attribution,
                                      rights_note, legacy_rights_code)
            VALUES (${asset.id}, ${rights.basis}, ${rights.licenseKey ?? null}, ${rights.licenseFamily ?? null}, ${rights.clearance},
                    ${rights.creator ?? null}, ${rights.attribution ?? null}, ${rights.rightsNote ?? null}, ${rights.legacyRightsCode ?? null})
        `;
    }
    for (const file of spec.published ?? [{ variant: "coat" }]) {
        await insertPublishedFile(database, asset.id, spec.ref, file);
    }
    return { id: asset.id, publicId: asset.public_id };
}

export async function insertPublishedFile(
    database: Queryable,
    assetId: string,
    seed: string,
    file: PublishedSpec,
): Promise<{ sha256: string }> {
    const sha256 = file.sha ?? sha(`${seed}/${file.variant}`);
    await database`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                derivative_recipe, recipe_version)
        VALUES (${assetId}, ${file.variant}, 'published', ${storageKey("published", sha256, "webp")}, ${file.mimeType ?? "image/webp"},
                ${file.width ?? 64}, ${file.height ?? 48}, 1234, ${sha256}, ${`${file.variant}-recipe`}, '1')
    `;
    return { sha256 };
}

export async function insertPlace(database: Queryable, n: number): Promise<{ id: string; publicId: string }> {
    const [place] = await database<{ id: string }[]>`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${fixtureId(n)}, ${MAP_DOMAIN}, ${`Medienort ${String(n)}`}, 'stadt', ST_SetSRID(ST_MakePoint(300 + ${n}, 300), 0), 'test', TRUE)
        RETURNING id
    `;
    if (!place) throw new Error("Ort nicht angelegt");
    return { id: place.id, publicId: fixtureId(n) };
}

export async function insertTerritory(database: Queryable, n: number): Promise<{ id: string; publicId: string }> {
    const [territory] = await database<{ id: string }[]>`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
        VALUES (${fixtureId(n)}, ${MAP_DOMAIN}, ${`Mediengebiet ${String(n)}`}, '#B2B065', 0.7, 'test')
        RETURNING id
    `;
    if (!territory) throw new Error("Gebiet nicht angelegt");
    return { id: territory.id, publicId: fixtureId(n) };
}

/** Ein Werk der Spielliteratur als Träger der Rolle `literature_cover` (MEDIA-M14). */
export async function insertAdventure(database: Queryable, n: number): Promise<{ id: string; publicId: string }> {
    const [row] = await database<{ id: string }[]>`
        INSERT INTO adventure (public_id, title, product_type, is_official, source_system, is_active)
        VALUES (${fixtureId(n)}, ${`Medienwerk ${String(n)}`}, 'gruppenabenteuer', TRUE, 'test', TRUE)
        RETURNING id
    `;
    if (!row) throw new Error("Werk nicht angelegt");
    return { id: row.id, publicId: fixtureId(n) };
}

/** Eine Karte der Kartensammlung als Träger der Rolle `map_preview` (MEDIA-M14). */
export async function insertCitymap(database: Queryable, n: number): Promise<{ id: string; publicId: string }> {
    const [row] = await database<{ id: string }[]>`
        INSERT INTO citymap (public_id, title, source_system, is_active)
        VALUES (${fixtureId(n)}, ${`Medienkarte ${String(n)}`}, 'test', TRUE)
        RETURNING id
    `;
    if (!row) throw new Error("Karte nicht angelegt");
    return { id: row.id, publicId: fixtureId(n) };
}

export async function insertGallery(database: Queryable, ref: string): Promise<{ id: string; publicId: string }> {
    const [gallery] = await database<{ id: string; public_id: string }[]>`
        INSERT INTO media_gallery (gallery_kind, source_system, source_ref)
        VALUES ('object_gallery', ${FIXTURE_SOURCE}, ${ref})
        RETURNING id, public_id
    `;
    if (!gallery) throw new Error("Galerie nicht angelegt");
    return { id: gallery.id, publicId: gallery.public_id };
}

/** Eine Regel mit Zitat; der Regeltext trägt die Marke, damit sie wieder verschwindet. */
export async function insertRule(
    database: Queryable,
    rule: { basis: string; role: string; licenseKey?: string | null; revokedOn?: string | null },
): Promise<string> {
    const [row] = await database<{ id: string }[]>`
        INSERT INTO publication_rule (rights_basis, license_key, role, scope_text, operator_quote, decided_on, revoked_on, revoked_reason)
        VALUES (${rule.basis}, ${rule.licenseKey ?? null}, ${rule.role}, ${`${FIXTURE_SCOPE} ${rule.basis}/${rule.role}`},
                'Testzitat des Betreibers', '2026-10-04', ${rule.revokedOn ?? null}, ${rule.revokedOn ? "Test" : null})
        RETURNING id
    `;
    if (!row) throw new Error("Regel nicht angelegt");
    return row.id;
}

/** Entfernt alles, was die Medientests angelegt haben, in Fremdschlüsselreihenfolge. */
export async function cleanMediaFixtures(database: Database): Promise<void> {
    const places = `(SELECT id FROM place WHERE public_id::text LIKE '6d656469-%')`;
    const territories = `(SELECT id FROM territory WHERE public_id::text LIKE '6d656469-%')`;
    const adventures = `(SELECT id FROM adventure WHERE public_id::text LIKE '6d656469-%')`;
    const citymaps = `(SELECT id FROM citymap WHERE public_id::text LIKE '6d656469-%')`;
    const assets = `(SELECT id FROM media_asset WHERE source_system = '${FIXTURE_SOURCE}')`;
    const galleries = `(SELECT id FROM media_gallery WHERE source_system = '${FIXTURE_SOURCE}')`;
    const rules = `(SELECT id FROM publication_rule WHERE scope_text LIKE '${FIXTURE_SCOPE}%')`;
    const statements = [
        // Der Notaus (WI-0068 P1, Migration 0086) hängt am auslösenden Asset und muss vor ihm gehen. `media_ingest` fällt mit dem
        // Asset (ON DELETE CASCADE).
        `DELETE FROM media_publication_suspension WHERE media_asset_id IN ${assets}`,
        `DELETE FROM place_media_suppression WHERE place_id IN ${places}`,
        `DELETE FROM territory_media_suppression WHERE territory_id IN ${territories}`,
        `DELETE FROM place_media WHERE place_id IN ${places} OR media_asset_id IN ${assets}`,
        `DELETE FROM place_media_gallery WHERE place_id IN ${places} OR media_gallery_id IN ${galleries}`,
        `DELETE FROM territory_media WHERE territory_id IN ${territories} OR media_asset_id IN ${assets}`,
        `DELETE FROM adventure_media WHERE adventure_id IN ${adventures} OR media_asset_id IN ${assets}`,
        `DELETE FROM citymap_media WHERE citymap_id IN ${citymaps} OR media_asset_id IN ${assets}`,
        `DELETE FROM media_gallery_item WHERE gallery_id IN ${galleries} OR media_asset_id IN ${assets}`,
        // Reisebilder (WI-0272 S3): die Verwendung einer freigegebenen Einreichung zeigt auf ein Asset der Fixtures.
        `DELETE FROM photobox_media WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_gallery WHERE source_system = '${FIXTURE_SOURCE}'`,
        `DELETE FROM media_rights_evidence WHERE media_asset_id IN ${assets} OR publication_rule_id IN ${rules}`,
        `DELETE FROM publication_rule WHERE scope_text LIKE '${FIXTURE_SCOPE}%'`,
        `DELETE FROM media_legacy_source WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_creation WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_rights WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_file WHERE media_asset_id IN ${assets}`,
        `DELETE FROM media_asset WHERE source_system = '${FIXTURE_SOURCE}'`,
        `DELETE FROM place WHERE public_id::text LIKE '6d656469-%'`,
        `DELETE FROM territory WHERE public_id::text LIKE '6d656469-%'`,
        `DELETE FROM adventure WHERE public_id::text LIKE '6d656469-%'`,
        `DELETE FROM citymap WHERE public_id::text LIKE '6d656469-%'`,
    ];
    for (const statement of statements) {
        await database.unsafe(statement);
    }
}

/** Was eine Verletzung von Schema oder Trigger meldet: SQLSTATE und Name der Regel. */
export async function violation(work: Promise<unknown>): Promise<{ code: string; constraint: string | undefined }> {
    try {
        await work;
    } catch (error) {
        if (error instanceof postgres.PostgresError) {
            return { code: error.code, constraint: error.constraint_name };
        }
        throw error;
    }
    throw new Error("erwartet wurde eine Verletzung, die Anweisung ging durch");
}
