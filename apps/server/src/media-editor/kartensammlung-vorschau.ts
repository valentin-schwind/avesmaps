import {
    AVENTURIA,
    type DerivedWork,
    type KarteVorschauSperre,
    type MamKarteVorschauBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GEHALTENE_QUELLBYTES_SQL } from "../media/notaus.ts";
import { hebeRevision, sperreKarte } from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "./upload.ts";

/**
 * „Vorschau erzeugen“ (WI-0287 Stufe 1, Punkt 5; OPS-000091 von einem Editor: „Für Karten, deren Rechte wir haben, möchte ich eine Vorschau erzeugen“, Ort: Media Inspector). Die
 * Operation `citymap.preview_generate` und was die Lesewege darüber wissen (Sperre, „erzeugt aus“, „gilt auch für“).
 *
 * Die Operation legt ein neues Werk der Art `map_preview` an (Herkunft `project_generated`, Eingang `generated`, `generated_from_asset_id` = die Karte), bindet es sofort als
 * Vorschau des Eintrags und reiht die Jobart `citymap_preview_generate` ein. 🔴 Fastify dekodiert nichts: Erst der Job liest die Karte und rechnet das Original der Vorschau
 * (`kartenvorschau-datei.ts`), danach läuft der gewöhnliche Abgleich (`media_settle`, Rolle `map_preview`). Bis dahin steht die Vorschau `pending`: „Wird gerechnet.“
 *
 * 🔴 Rechte und Entstehung folgen der Karte dauerhaft (Auslöser aus Migration 0320); hier wird die Rechtezeile nur angelegt, der Auslöser füllt sie. An der Vorschau selbst
 * sind Rechte und Entstehung nicht zu ändern (`pruefeEigeneRechte` in `asset-operations.ts`, 409 `media_rights_follow_source`). Der Notaus der Karte gilt auch ihr
 * (`GEHALTENE_QUELLBYTES_SQL`).
 * 🔴 Ob die Vorschau öffentlich ist, entscheidet `decidePublication` für die Rolle `map_preview`, nicht die Karte: Eine Einzelfreigabe der Karte gilt ihrer Bindung, nicht der
 * Vorschau.
 *
 * Gesperrt (409) ist nur, was keine Prüfung tragen kann (`KARTE_VORSCHAU_SPERREN`): Notaus der Karte, unbekannte Rechtsgrundlage, fehlende Datei. Eine offene Prüfung sperrt
 * nicht. Dazu wie die anderen Operationen am Eintrag: Sperre der Kartendomäne (503), gesehener Stand (409), stillgelegter Eintrag (409 `citymap_retired`), dazu belegter Platz
 * der Vorschau (409 `preview_taken`) und eine Karte, die nicht als `map_full` an diesem Eintrag hängt (409 `preview_source_not_bound`). Ein gleicher Name unter
 * „Kartenvorschauen“ ist kein Fehler: Die Oberfläche kündigt ihn an und lässt wählen (Entwurf `platzPanel`, Zweig Konflikt).
 */

export const KARTENVORSCHAU_KIND = "citymap_preview_generate";

/** Die Eingabe des Jobs: die Vorschau, ihre Karte (zur Probe, maßgeblich ist `generated_from_asset_id`) und die Person, mit der der Abgleich danach eingereiht wird. */
export interface KartenvorschauInput {
    asset: string;
    karte: string;
    actor: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Die Eingabe des Jobs; `null`, wenn sie unbrauchbar ist. */
export function parseKartenvorschauInput(raw: Record<string, unknown>): KartenvorschauInput | null {
    const { asset, karte, actor } = raw;
    if (typeof asset !== "string" || !UUID.test(asset)) return null;
    if (typeof karte !== "string" || !UUID.test(karte)) return null;
    if (typeof actor !== "string" || !UUID.test(actor)) return null;
    return { asset, karte, actor };
}

/** Die Sperre als 409 der Operation; dieselben drei Gründe wie die Oberfläche (`vorschauSperren`). */
const SPERRE_FEHLER: Readonly<Record<KarteVorschauSperre, { code: string; message: string }>> = {
    suspended: { code: "preview_source_suspended", message: "Gesperrt, solange die Karte offline ist." },
    rights_unknown: {
        code: "preview_rights_unknown",
        message: "Gesperrt, bis die Rechtsgrundlage der Karte feststeht.",
    },
    file_missing: { code: "preview_source_missing", message: "Gesperrt: Die Datei der Karte fehlt." },
};

/**
 * Warum „Vorschau erzeugen“ an diesen Werken (interne Kennungen) gesperrt ist, je Werk; `null`: es geht. In der Reihenfolge des Entwurfs (`sperrgrund`): erst der Notaus,
 * dann die unbekannte Rechtsgrundlage (auch ohne Rechtezeile), dann die fehlende Datei (kein Original oder `missing_file`). Ein gelöschtes Original mit Master
 * (WI-0275) fehlt nicht: Der Job liest dann den Master, wie der Abgleich.
 */
export async function vorschauSperren(
    db: Queryable,
    assetIds: readonly string[],
): Promise<Map<string, KarteVorschauSperre | null>> {
    const sperren = new Map<string, KarteVorschauSperre | null>();
    if (assetIds.length === 0) return sperren;
    const zeilen = await db<
        { id: string; rights_basis: string | null; technical_state: string; has_source: boolean; gehalten: boolean }[]
    >`
        SELECT a.id::text AS id, r.rights_basis, a.technical_state, f.id IS NOT NULL AS has_source,
               EXISTS (SELECT 1 FROM (${db.unsafe(GEHALTENE_QUELLBYTES_SQL)}) n WHERE n.sha256 = f.sha256) AS gehalten
          FROM media_asset a
          LEFT JOIN media_rights r ON r.media_asset_id = a.id
          LEFT JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
         WHERE a.id = ANY(${assetIds as string[]}::bigint[])
    `;
    for (const zeile of zeilen) {
        sperren.set(
            zeile.id,
            zeile.gehalten
                ? "suspended"
                : zeile.rights_basis === null || zeile.rights_basis === "unknown"
                  ? "rights_unknown"
                  : !zeile.has_source || zeile.technical_state === "missing_file"
                    ? "file_missing"
                    : null,
        );
    }
    return sperren;
}

/** Die Karte, aus der ein Werk erzeugt wurde, und ob ihr Notaus gerade auch hier gilt; je Werk (interne Kennung), nur für erzeugte. */
export async function erzeugtAusVon(
    db: Queryable,
    assetIds: readonly string[],
): Promise<Map<string, { assetId: string; title: string | null; offline: boolean }>> {
    const je = new Map<string, { assetId: string; title: string | null; offline: boolean }>();
    if (assetIds.length === 0) return je;
    const zeilen = await db<{ id: string; karte: string; title: string | null; offline: boolean }[]>`
        SELECT v.id::text AS id, k.public_id::text AS karte, k.title,
               EXISTS (
                   SELECT 1 FROM media_file f JOIN media_publication_suspension n ON n.source_sha256 = f.sha256 AND n.lifted_at IS NULL
                    WHERE f.media_asset_id = k.id AND f.storage_class = 'private_source'
               ) AS offline
          FROM media_asset v JOIN media_asset k ON k.id = v.generated_from_asset_id
         WHERE v.id = ANY(${assetIds as string[]}::bigint[])
    `;
    for (const zeile of zeilen) je.set(zeile.id, { assetId: zeile.karte, title: zeile.title, offline: zeile.offline });
    return je;
}

/** Die aus einem Werk (interne Kennung) erzeugten Vorschauen, nach Titel („Gilt auch für …“). */
export async function erzeugteVon(
    db: Queryable,
    assetId: string,
): Promise<{ assetId: string; title: string | null }[]> {
    return db<{ assetId: string; title: string | null }[]>`
        SELECT public_id::text AS "assetId", title FROM media_asset
         WHERE generated_from_asset_id = ${assetId}::bigint ORDER BY title NULLS LAST, id
    `;
}

/** Die Vorschau aus der Karte des Eintrags erzeugen (`MamKarteVorschauBody`). */
export function erzeugeKartenvorschau(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteVorschauBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    const title = body.title.trim();
    if (title === "") {
        throw new ApiError(400, "validation_failed", "Die Vorschau braucht einen Namen.", {
            issues: [{ path: "title", rule: "required" }],
        });
    }
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.preview_generate",
            body: { citymapId: publicId, baseRevision: body.baseRevision, sourceAssetId: body.sourceAssetId, title },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            const bilder = await tx<{ role: string; id: string; public_id: string; creation_method: string }[]>`
                SELECT m.role, a.id::text AS id, a.public_id::text AS public_id, a.creation_method
                  FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
                 WHERE m.citymap_id = ${karte.id}::bigint AND m.retired_at IS NULL
                 FOR UPDATE OF m
            `;
            // Jede aktive Version taugt als Quelle (WI-0287 Stufe 2): der Platz nimmt die erste, der Inspector eines Bildes genau dieses.
            const quelle = bilder.find((bild) => bild.role === "map_full" && bild.public_id === body.sourceAssetId);
            if (quelle === undefined) {
                throw new ApiError(
                    409,
                    "preview_source_not_bound",
                    "Diese Karte hängt nicht (mehr) an diesem Eintrag. Neu laden zeigt den aktuellen Stand.",
                );
            }
            if (bilder.some((bild) => bild.role === "map_preview")) {
                throw new ApiError(409, "preview_taken", "Der Eintrag hat schon eine Vorschau.");
            }
            const sperre = (await vorschauSperren(tx, [quelle.id])).get(quelle.id) ?? null;
            if (sperre !== null) {
                throw new ApiError(409, SPERRE_FEHLER[sperre].code, SPERRE_FEHLER[sperre].message, { reason: sperre });
            }

            // Das Werk: die Entstehung setzt der Auslöser aus der Karte (hier nur vorbelegt), technisch `pending`, bis der Job das Original abgelegt und der Abgleich es geprüft hat.
            const [werk] = await tx<{ id: string; public_id: string; revision: number }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system,
                                         title, generated_from_asset_id)
                VALUES ('image', 'map_preview', 'project_generated', ${quelle.creation_method}, 'pending', 'not_applicable',
                        ${MEDIA_EDITOR_SOURCE_SYSTEM}, ${title}, ${quelle.id}::bigint)
                RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
            `;
            // Die Rechtezeile entsteht hier; ihre Werte schreibt der Auslöser `media_rights_folgt_quelle` aus denen der Karte.
            await tx`INSERT INTO media_rights (media_asset_id, rights_basis) VALUES (${werk!.id}::bigint, 'unknown')`;
            await tx`
                INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id, source_system)
                VALUES (${werk!.id}::bigint, 'generated', ${actor.personId}::uuid, ${MEDIA_EDITOR_SOURCE_SYSTEM})
            `;
            await tx`
                INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
                VALUES (${karte.id}::bigint, ${werk!.id}::bigint, 'map_preview', 'editor')
            `;
            const input: KartenvorschauInput = {
                asset: werk!.public_id,
                karte: quelle.public_id,
                actor: actor.personId,
            };
            const [job] = await tx<{ public_id: string }[]>`
                SELECT public_id::text AS public_id
                  FROM job_enqueue(${KARTENVORSCHAU_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, ${actor.personId},
                                   ${tx.json(input as never)}, 50::smallint)
            `;
            const derivedWork: DerivedWork[] = [{ kind: KARTENVORSCHAU_KIND, jobId: job!.public_id, state: "queued" }];
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: {
                    affected: [
                        { kind: "citymap", id: publicId, revision },
                        { kind: "media_asset", id: werk!.public_id, revision: werk!.revision },
                    ],
                    derivedWork,
                    warnings: [],
                },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        assetId: werk!.public_id,
                        targetRevision: revision,
                        details: { fields: ["images"] },
                    },
                    {
                        action: "asset.generated",
                        assetId: werk!.public_id,
                        targetRevision: werk!.revision,
                        details: { role: "map_preview", source: quelle.public_id },
                    },
                ],
            };
        },
    );
}
