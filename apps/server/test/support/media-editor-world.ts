import type { Database, Queryable } from "../../src/database.ts";
import { storageKey } from "../../src/media/storage.ts";
import {
    FIXTURE_SOURCE,
    cleanMediaFixtures,
    insertAdventure,
    insertAsset,
    insertCitymap,
    insertGallery,
    insertPlace,
    insertTerritory,
    sha,
    type FixtureAsset,
} from "./media-fixture.ts";

/**
 * Eine kleine Welt für den Lesepfad der Medienverwaltung (WI-0068 P2). Sie liegt auf den Fixtures der Medientests
 * (`media-fixture.ts`, Quellsystem `media-test`, Kennungen `6d656469-…`) und wird mit `cleanMediaWorld` wieder abgeräumt.
 *
 *     Medienort 1 ── Wappen ─────────────── WAPPEN    ┐ dieselben Bytes (Original)
 *       └ Galerie „Hafenbilder“ (Kopf):  [0] KOPF    │
 *                                         [1] WAPPEN  │ (Cover, gesperrt)
 *     Mediengebiet 2 ── Wappen ──────────── ZWILLING  ┘
 *     Medienwerk 3 ── Umschlag (zurückgezogen) ─ WAPPEN
 *     UNBENUTZT: keine Verwendung, keine Rechte, noch keine Bytes
 *
 * Jede private Angabe trägt die Marke `INTERN-…`: Eine öffentliche Antwort darf keine davon enthalten. Ein Notaus gilt den Bytes
 * von WAPPEN und ZWILLING. Die Quellschlüssel beginnen mit `mamweb-`; eine Suche nach `mamweb` findet genau diese Welt, auch in
 * einer Datenbank mit echten Medien.
 */

export const OPERATION_PREFIX = "6d656469-0000-4000-9000-";
export const operationId = (n: number): string => `${OPERATION_PREFIX}${n.toString(16).padStart(12, "0")}`;

/** Der Medienzug der Welt (Akteur des Legacy-Ingests). */
export const WORLD_RUN = "6d656469-0000-4000-9000-ffffffffffff";

/** Alle privaten Werte der Welt; keiner darf in einer öffentlichen Antwort stehen. */
export const PRIVATE_VALUES = {
    rightsNote: "INTERN-Rechtenotiz-77",
    legacyRightsCode: "INTERN-legacy-code",
    reviewedBy: "INTERN-Prüfer-Text",
    prompt: "INTERN-Prompt-11",
    negativePrompt: "INTERN-Negativ-12",
    tool: "INTERN-Werkzeug-13",
    legacyNote: "INTERN-Notiz-14",
    legacyActor: "INTERN-thomas",
    filename: "INTERN-datei-22.png",
    evidence: "INTERN-Beleg-44",
    localUrl: "/uploads/INTERN-pfad-66.png",
    overrideReason: "INTERN-Begründung-55",
    operatorQuote: "INTERN-Zitat-33",
    itemReason: "INTERN-Galerie-Begründung-56",
    suspensionReason: "INTERN-Notaus-88",
} as const;

export interface MediaWorld {
    place: { id: string; publicId: string };
    territory: { id: string; publicId: string };
    adventure: { id: string; publicId: string };
    citymap: { id: string; publicId: string };
    coat: FixtureAsset;
    twin: FixtureAsset;
    header: FixtureAsset;
    unused: FixtureAsset;
    gallery: { id: string; publicId: string };
    bytes: string;
}

async function insertSource(database: Queryable, assetId: string, sha256: string): Promise<void> {
    await database`
        INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
        VALUES (${assetId}, 'source', 'private_source', ${storageKey("private_source", sha256, "png")}, 'image/png', 64, 48, 2048,
                ${sha256})`;
}

/**
 * Baut die Welt. `people` sind pseudonyme Personen (`person.id`), die als Entscheider und Hochlader eingetragen werden; ohne
 * Konto erscheinen sie im MAM als `null`.
 */
export async function buildMediaWorld(
    database: Database,
    people: { decider: string; uploader: string },
): Promise<MediaWorld> {
    const place = await insertPlace(database, 1);
    const territory = await insertTerritory(database, 2);
    const adventure = await insertAdventure(database, 3);
    const citymap = await insertCitymap(database, 4);
    const bytes = sha("mamweb/original");

    const coat = await insertAsset(database, {
        ref: "mamweb-wappen",
        rights: {
            basis: "public_domain",
            clearance: "legacy_asserted",
            creator: "Urheberin Alrike",
            rightsNote: PRIVATE_VALUES.rightsNote,
            legacyRightsCode: PRIVATE_VALUES.legacyRightsCode,
        },
        published: [{ variant: "coat" }, { variant: "header_16_9" }],
    });
    const twin = await insertAsset(database, { ref: "mamweb-zwilling", published: [{ variant: "coat" }] });
    const header = await insertAsset(database, {
        ref: "mamweb-kopf",
        rights: { basis: "own_work", clearance: "legacy_assumed" },
        published: [{ variant: "header_16_9" }],
    });
    const unused = await insertAsset(database, {
        ref: "mamweb-unbenutzt",
        technicalState: "pending",
        rights: null,
        published: [],
    });
    await insertSource(database, coat.id, bytes);
    await insertSource(database, twin.id, bytes);
    await insertSource(database, header.id, sha("mamweb/kopf"));

    await database`
        UPDATE media_rights SET reviewed_by = ${PRIVATE_VALUES.reviewedBy}, reviewed_by_person = ${people.decider},
               reviewed_at = '2026-10-01T10:00:00Z'
         WHERE media_asset_id = ${coat.id}`;
    await database`
        INSERT INTO media_creation (media_asset_id, tool, model, prompt, negative_prompt, parameters, legacy_note_raw)
        VALUES (${coat.id}, ${PRIVATE_VALUES.tool}, 'Modell', ${PRIVATE_VALUES.prompt}, ${PRIVATE_VALUES.negativePrompt},
                '{"steps": 30}'::jsonb, ${PRIVATE_VALUES.legacyNote})`;
    await database`
        INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id, source_system, original_filename)
        VALUES (${coat.id}, 'editor_upload', ${people.uploader}, ${FIXTURE_SOURCE}, ${PRIVATE_VALUES.filename})`;
    await database`
        INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, description, recorded_by)
        VALUES (${coat.id}, 'operator_note', ${PRIVATE_VALUES.evidence}, 'INTERN-erfasst')`;
    await database`
        INSERT INTO media_legacy_source (media_asset_id, media_class, legacy_origin, local_url, legacy_public, stored_url)
        VALUES (${coat.id}, 'settlement_coat', 'custom', ${PRIVATE_VALUES.localUrl}, TRUE,
                ${`https://legacy.test${PRIVATE_VALUES.localUrl}`})`;
    // Der Legacy-Ingest eines echten Imports: der Medienzug als Akteur, der Login nur als Text, nie eine Person.
    await database`
        INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version, status)
        VALUES (${WORLD_RUN}, 'media', ${FIXTURE_SOURCE}, 'mamweb', 'test', 'completed')
        ON CONFLICT (id) DO NOTHING`;
    await database`
        INSERT INTO media_ingest (media_asset_id, ingest_kind, migration_run_id, legacy_actor_label, source_system, ingested_at)
        VALUES (${header.id}, 'legacy_import', ${WORLD_RUN}, ${PRIVATE_VALUES.legacyActor}, ${FIXTURE_SOURCE},
                '2026-10-05T00:00:00Z')`;

    // Verwendungen.
    await database`
        INSERT INTO place_media (place_id, media_asset_id, role, origin, publication_override, override_decided_on,
                                 override_decided_by, override_reason, override_operator_quote)
        VALUES (${place.id}, ${coat.id}, 'coat', 'legacy', 'approved', '2026-10-02', ${people.decider},
                ${PRIVATE_VALUES.overrideReason}, ${PRIVATE_VALUES.operatorQuote})`;
    await database`
        INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
        VALUES (${territory.id}, ${twin.id}, 'coat', 'legacy')`;
    await database`
        INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin, retired_at)
        VALUES (${adventure.id}, ${coat.id}, 'literature_cover', 'legacy', now())`;
    const gallery = await insertGallery(database, "mamweb-galerie");
    await database`UPDATE media_gallery SET title = 'Hafenbilder' WHERE id = ${gallery.id}`;
    await database`
        INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${gallery.id}, ${header.id}, 0)`;
    const [coatItem] = await database<{ id: string }[]>`
        INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, publication_override, override_decided_on,
                                        override_decided_by, override_reason)
        VALUES (${gallery.id}, ${coat.id}, 1, 'blocked', '2026-10-03', ${people.decider}, ${PRIVATE_VALUES.itemReason})
        RETURNING id`;
    await database`UPDATE media_gallery SET cover_item_id = ${coatItem!.id} WHERE id = ${gallery.id}`;
    await database`
        INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
        VALUES (${place.id}, ${gallery.id}, 'header', 'legacy')`;

    // Der Notaus gilt den Bytes, ausgelöst an ZWILLING: WAPPEN ist mit ausgeblendet.
    await database`
        INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
        VALUES (${bytes}, ${twin.id}, ${PRIVATE_VALUES.suspensionReason}, ${people.decider})`;

    return { place, territory, adventure, citymap, coat, twin, header, unused, gallery, bytes };
}

/** Räumt die Welt ab: Operationen und Protokoll, die Medien-Fixtures (`cleanMediaFixtures`) und den Medienzug. */
export async function cleanMediaWorld(database: Database): Promise<void> {
    const prefix = `${OPERATION_PREFIX}%`;
    await database`DELETE FROM media_audit_event WHERE operation_id::text LIKE ${prefix}`;
    await database`DELETE FROM media_operation WHERE operation_id::text LIKE ${prefix}`;
    await cleanMediaFixtures(database);
    await database`DELETE FROM migration_run WHERE id = ${WORLD_RUN}`;
}
