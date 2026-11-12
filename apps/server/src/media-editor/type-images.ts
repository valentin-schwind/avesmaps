import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    AVENTURIA,
    BUILTIN_TYPE_IMAGE_RIGHTS_DATE,
    BUILTIN_TYPE_IMAGE_RIGHTS_QUOTE,
    HEADER_GRAPHICS,
    HEADER_GRAPHIC_LABELS,
    MAM_TYPE_IMAGE_FORMER_LIMIT,
    assetTypeAllowsRole,
    headerGraphicKeys,
    headerGraphicOf,
    headerGraphicOfLandmarke,
    headerGraphicOfLandscape,
    headerGraphicOfPath,
    headerGraphicOfPlace,
    istWetterSymbolArt,
    mediaEditorPreviewUrl,
    mediaPublicUrl,
    typeImageVariantAccepts,
    wetterSymbolTyp,
    type DerivedWork,
    type HeaderGraphic,
    type MamTypeImage,
    type MamTypeImageList,
    type MamTypeImageSlot,
    type MediaCreationMethod,
    type MediaTypeImageReleaseBody,
    type MediaTypeImageSetBody,
    type MediaTypeImageVariant,
    type MediaTypeImagesAdoptBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { inspectImage } from "../media/raster/inspect.ts";
import { resolveTypeImageVariants } from "../media/resolver.ts";
import type { MediaStore } from "../media/storage.ts";
import { ladeWetterWikiArtikel } from "../wetter/wiki.ts";
import { landmarkeSchluessel } from "../wiki/infobox/landmarke.ts";
import { lockAsset } from "./asset-operations.ts";
import { requireNichtReisebild } from "./reisebild.ts";
import { mediaBindingKey, mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { enqueueSettle } from "./settle.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "./upload.ts";

/**
 * Typbilder (WI-0068, Betreiber 2026-10-11, Vertrag `packages/shared/src/media-type-images.ts`, Tafel `media_type_image`, Migration 0113).
 *
 * - **Liste:** die 37 Kategorien mit ihrem ★-Asset, der Zahl der Objekte, die die Kategorie heute zeigen (gezählt über dieselben
 *   Tafeln Art → Kategorie wie das Infopanel), und der Zahl früherer Typbilder.
 * - **Setzen:** der ★ wandert; die bisherige Zeile wird zurückgezogen (Verlauf), das Asset bleibt. Revision der ★-Zeile, Fachprotokoll
 *   als Bindung (`media_type_image:<id>`), der Abgleich rechnet beide Assets nach (Rolle `header`).
 * - **Eingebaute übernehmen:** ein Klick legt je Kategorie OHNE ★ die eingebaute Grafik als Asset an (Original privat, Rechte nach dem
 *   Betreiber mit Zitat als Beleg) und setzt den ★. Was schon einen ★ hat, bleibt. Fastify legt nur Bytes und Zeilen ab; gerechnet wird im
 *   Worker (Claudio M7).
 * - **Zwei Varianten je Kategorie** (WI-0281, Betreiber 2026-11-05, Migration 0314): `ki` und `ohne_ki`, je mit eigenem ★, Verlauf und Revision. Ein
 *   Wechsel betrifft nur seine Variante. Welches Asset in welche Variante darf, sagt die Entstehung (`typeImageVariantAccepts`): Die Ohne-KI-Variante
 *   nimmt nur Foto, Zeichnung und Scan, die KI-Variante alles andere; so steht dasselbe Asset nie in beiden. Die eingebauten Grafiken sind KI-erzeugt
 *   und gehen nur in die KI-Variante.
 */

const EDIT_CONFLICT_EMPTY = (): ApiError =>
    new ApiError(409, "edit_conflict", "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.", {
        currentRevision: 0,
    });

/** Wo die eingebauten Grafiken liegen: `TYPE_IMAGE_SOURCE_DIR`, sonst der gebaute bzw. der Quellordner der Weboberfläche. */
export function builtinTypeImageDir(): string | undefined {
    const configured = process.env["TYPE_IMAGE_SOURCE_DIR"];
    const candidates = [
        ...(configured === undefined || configured === "" ? [] : [configured]),
        resolve(process.cwd(), "../web/dist/icons/header"),
        resolve(process.cwd(), "../web/public/icons/header"),
        resolve(process.cwd(), "apps/web/dist/icons/header"),
        resolve(process.cwd(), "apps/web/public/icons/header"),
    ];
    return candidates.find((dir) => existsSync(join(dir, "dorf.webp")));
}

interface CurrentRow {
    row_id: string;
    category: string;
    variant: MediaTypeImageVariant;
    creation_method: MediaCreationMethod;
    revision: number;
    created_at: Date;
    asset_public_id: string;
    title: string | null;
    preview_sha256: string | null;
    preview_width: number | null;
    preview_height: number | null;
    intern_variant: string | null;
    intern_width: number | null;
    intern_height: number | null;
}

/**
 * Wie viele aktive Objekte je Bildkategorie eine Kartendomäne hat.
 *
 * 🔴 **Gezählt wird über DIESELBEN Zuordnungsfunktionen, die den Kopf bestimmen** (`headerGraphicOfPlace`,
 * `-OfLandscape`, `-OfPath`, `headerGraphicOf`), nicht über eine eigene Tafel. Sonst driftet die Zahl von dem weg, was
 * ein Besucher sieht — und genau das war sie (Matrix `project-control/discovery/typbildabdeckung-matrix-2026-10-13.md`,
 * Lücke L1): Vorher fragte diese Abfrage nur `place`, `region` und `path`. Es fehlten `terrain_peak`, `territory`,
 * `climate_band` und `powerline`, und sie sind kein Randfall — am Satz vom 2026-10-13 zeigte „Berggipfel“ 0 trotz 240
 * Gipfeln, „Gebirge“ 246 statt 275, und die beiden größten Kategorien „Region“ (1.838 Objekte, darunter alle 1.676
 * Gebiete) und „Kraftlinien“ (174) gar keine Zahl.
 *
 * Seit WI-0260 zählen auch die Einträge der Vorkommen (Flora, Fauna, Ware, Spezies; `lore_entry.kind`) mit: Ihr Typbild steht im Kopf der Infobox eines Eintrags. Sie gehören keiner Kartendomäne an (`lore_entry` hat
 * keine `map_domain_id`) und gelten wie die Klimabänder in jeder.
 *
 * 🪤 Das Domänenprädikat ist eine Richtigkeitsfrage, keine Geschwindigkeitsfrage (Qualitätsreview Q-04): Ohne es summierte die
 * Zahl über alle Kartendomänen, während das Infopanel immer die Objekte einer Domäne zeigt. Heute folgenlos (eine Domäne), mit
 * der zweiten falsch. Gemessen auf `avesmaps3d_dev` (5.198 Orte, 5.413 Regionen, 9.927 Wege aktiv, `EXPLAIN (ANALYZE, BUFFERS)`
 * nach sieben Läufen): ohne Prädikat drei Seq Scans, 967 Buffer, 5,88 ms · mit Prädikat dieselben drei Seq Scans, 967 Buffer,
 * 6,34 ms · mit erzwungenem Indexpfad (`enable_seqscan = off`) drei Bitmap Heap Scans, 915 Buffer, 6,45 ms. Die Annahme des
 * Reviews, das Prädikat lasse die Teilindizes greifen, ist damit WIDERLEGT: Eine Gruppierung über praktisch alle Zeilen liest
 * die Tabelle so oder so, und der Planer wählt den Seq Scan zu Recht. Kein neuer Index — `region` hat ohnehin keinen auf
 * `region_type`, nur auf `region_layer`.
 */
async function objectCounts(db: Queryable, mapDomainId: string): Promise<Map<HeaderGraphic, number>> {
    const rows = await db<{ quelle: string; key: string | null; n: number }[]>`
        SELECT 'place' AS quelle, subtype AS key, count(*)::int AS n FROM place
          WHERE map_domain_id = ${mapDomainId} AND is_active GROUP BY subtype
        UNION ALL
        SELECT 'landscape', region_type, count(*)::int FROM region
          WHERE map_domain_id = ${mapDomainId} AND is_active GROUP BY region_type
        UNION ALL
        SELECT 'path', subtype, count(*)::int FROM path
          WHERE map_domain_id = ${mapDomainId} AND is_active GROUP BY subtype
        UNION ALL
        SELECT 'peak', subtype, count(*)::int FROM terrain_peak
          WHERE map_domain_id = ${mapDomainId} AND is_active GROUP BY subtype
        UNION ALL
        SELECT 'territory', NULL, count(*)::int FROM territory
          WHERE map_domain_id = ${mapDomainId} AND is_active
        UNION ALL
        SELECT 'powerline', NULL, count(*)::int FROM powerline
          WHERE map_domain_id = ${mapDomainId} AND is_active
        UNION ALL
        -- Die Klimabänder sind eine Ableitung ohne Domänenspalte und ohne Rückzug: alle Zeilen gelten.
        SELECT 'climate', NULL, count(*)::int FROM climate_band
        UNION ALL
        -- Die Einträge der Vorkommen (Flora, Fauna, Ware, Spezies; WI-0260) je Art. 🪤 lore_entry hat KEINE Spalte map_domain_id: Wie die Klimabänder
        -- gelten sie für jede Domäne, also ohne das Prädikat der anderen Zeilen; ein Eintrag zählt, wenn er aktiv ist (is_active und state = 'active').
        SELECT 'lore', kind, count(*)::int FROM lore_entry
          WHERE is_active AND state = 'active' GROUP BY kind
    `;
    const raus = new Map<HeaderGraphic, number>();
    const dazu = (graphic: HeaderGraphic, n: number): void => {
        raus.set(graphic, (raus.get(graphic) ?? 0) + n);
    };
    for (const row of rows) {
        if (row.n === 0) continue;
        switch (row.quelle) {
            case "place":
                // 🪤 Auch ohne Klasse: Legacy zeigt dann das Metropolenbild, und genau das zählt hier mit.
                dazu(headerGraphicOfPlace(row.key ?? undefined), row.n);
                break;
            case "landscape":
                dazu(headerGraphicOfLandscape(row.key ?? undefined), row.n);
                break;
            case "path":
                dazu(headerGraphicOfPath(row.key ?? undefined), row.n);
                break;
            case "peak":
                // Je Landmarkenart ihr Bild (WI-0271 L6); ein Gipfel ohne Art ist ein Berggipfel (`headerGraphicOf` für `peak`).
                dazu(headerGraphicOfLandmarke(row.key ?? undefined), row.n);
                break;
            case "territory":
                dazu(headerGraphicOf("territory", undefined), row.n);
                break;
            case "powerline":
                dazu(headerGraphicOf("powerline", undefined), row.n);
                break;
            case "lore":
                // Die Art des Eintrags (`kind`) bestimmt das Typbild; eine unbekannte fiele auf das allgemeine (`headerGraphicOf`).
                dazu(headerGraphicOf("loreEntry", row.key ?? undefined), row.n);
                break;
            default:
                dazu(headerGraphicOf("climate", undefined), row.n);
        }
    }
    for (const [graphic, n] of await wetterSymbolCounts(db)) dazu(graphic, n);
    return raus;
}

/**
 * Die Wetter-Icons, die ein Infopanel mit Typbild haben (WI-0288): nicht entfernt, sichtbar und mit einem Verweis auf einen Artikel, den es unter den Winden, Strömungen
 * und Mahlströmen gibt - genau die, für die `/api/subjects/wetter-symbol/{id}` antwortet. Gezählt über dieselbe Zuordnung wie der Kopf (`wetterSymbolTyp`,
 * `headerGraphicOf`): Ein Wirbel mit Mahlstrom-Artikel zählt als Mahlstrom. Ein Icon ohne Verweis zeigt kein Typbild und zählt nicht, auch keine Vorgabe des Prototyps.
 *
 * 🪤 Die Tafel gibt es erst ab Migration 0326. Erst nachsehen, dann fragen: Ein Fehler in einer Transaktion (`media-messung-cli.ts`) bräche sie ab.
 */
async function wetterSymbolCounts(db: Queryable): Promise<Map<HeaderGraphic, number>> {
    const raus = new Map<HeaderGraphic, number>();
    const [tafel] = await db<{ da: boolean }[]>`SELECT to_regclass('weather_symbol') IS NOT NULL AS da`;
    if (tafel?.da !== true) return raus;
    const zeilen = await db<{ art: string; wiki_titel: string }[]>`
        SELECT art, wiki_titel FROM weather_symbol WHERE entfernt_at IS NULL AND sichtbar AND wiki_titel IS NOT NULL
    `;
    if (zeilen.length === 0) return raus;
    const artikel = new Map(
        (await ladeWetterWikiArtikel(db)).map((eintrag) => [landmarkeSchluessel(eintrag.titel), eintrag.art]),
    );
    for (const zeile of zeilen) {
        const artikelArt = artikel.get(landmarkeSchluessel(zeile.wiki_titel));
        if (artikelArt === undefined || !istWetterSymbolArt(zeile.art)) continue;
        const graphic = headerGraphicOf("wetterSymbol", wetterSymbolTyp(zeile.art, artikelArt));
        raus.set(graphic, (raus.get(graphic) ?? 0) + 1);
    }
    return raus;
}

export async function typeImageList(db: Queryable, mapDomainId = AVENTURIA.mapDomain): Promise<MamTypeImageList> {
    const [current, former, formerRows, counts, publicImages] = await Promise.all([
        db<CurrentRow[]>`
            SELECT t.id::text AS row_id, t.category, t.variant, a.creation_method, t.revision::int AS revision, t.created_at,
                   a.public_id::text AS asset_public_id,
                   a.title, pv.sha256 AS preview_sha256, pv.width AS preview_width, pv.height AS preview_height,
                   iv.variant AS intern_variant, iv.width AS intern_width, iv.height AS intern_height
              FROM media_type_image t
              JOIN media_asset a ON a.id = t.media_asset_id
              LEFT JOIN LATERAL (
                  SELECT f.sha256, f.width, f.height FROM media_file f
                   WHERE f.media_asset_id = a.id AND f.storage_class = 'published' ORDER BY f.width * f.height, f.id LIMIT 1
              ) pv ON TRUE
              LEFT JOIN LATERAL (
                  SELECT f.variant, f.width, f.height FROM media_file f
                   WHERE pv.sha256 IS NULL AND f.media_asset_id = a.id AND f.storage_class = 'derivative'
                     AND f.variant LIKE 'intern\\_%' ORDER BY f.width * f.height, f.id LIMIT 1
              ) iv ON TRUE
             WHERE t.retired_at IS NULL
        `,
        db<{ category: string; variant: MediaTypeImageVariant; n: number }[]>`
            SELECT category, variant, count(*)::int AS n FROM media_type_image WHERE retired_at IS NOT NULL
             GROUP BY category, variant
        `,
        db<FormerRow[]>`
            SELECT t.category, t.variant, a.public_id::text AS asset_public_id, a.title, t.retired_at,
                   pv.sha256 AS preview_sha256, pv.width AS preview_width, pv.height AS preview_height
              FROM (
                  SELECT id, category, variant, media_asset_id, retired_at,
                         row_number() OVER (PARTITION BY category, variant ORDER BY retired_at DESC, id DESC) AS rang
                    FROM media_type_image WHERE retired_at IS NOT NULL
              ) t
              JOIN media_asset a ON a.id = t.media_asset_id
              LEFT JOIN LATERAL (
                  SELECT f.sha256, f.width, f.height FROM media_file f
                   WHERE f.media_asset_id = a.id AND f.storage_class = 'published' ORDER BY f.width * f.height, f.id LIMIT 1
              ) pv ON TRUE
             WHERE t.rang <= ${MAM_TYPE_IMAGE_FORMER_LIMIT}
             ORDER BY t.category, t.variant, t.retired_at DESC
        `,
        objectCounts(db, mapDomainId),
        resolveTypeImageVariants(db),
    ]);
    // Je Kategorie und Variante: `<Kategorie>:<Variante>`.
    const schluessel = (category: string, variant: MediaTypeImageVariant): string => `${category}:${variant}`;
    const currentBy = new Map(current.map((row) => [schluessel(row.category, row.variant), row]));
    const formerBy = new Map(former.map((row) => [schluessel(row.category, row.variant), row.n]));
    const formerItemsBy = new Map<string, MamTypeImageSlot["formerItems"]>();
    for (const row of formerRows) {
        const key = schluessel(row.category, row.variant);
        const eintraege = formerItemsBy.get(key) ?? [];
        eintraege.push({
            assetId: row.asset_public_id,
            title: row.title,
            preview:
                row.preview_sha256 === null || row.preview_width === null || row.preview_height === null
                    ? null
                    : {
                          url: mediaPublicUrl(row.preview_sha256),
                          width: row.preview_width,
                          height: row.preview_height,
                      },
            retiredAt: row.retired_at.toISOString(),
        });
        formerItemsBy.set(key, eintraege);
    }
    /** Eine Variante einer Kategorie: ★, Zahl der früheren und die jüngsten davon. „Öffentlich“ heißt: so sehen es Besucher in diesem Modus. */
    const slot = (category: HeaderGraphic, variant: MediaTypeImageVariant): MamTypeImageSlot => {
        const key = schluessel(category, variant);
        const row = currentBy.get(key);
        const sichtbar = variant === "ki" ? publicImages.ki : publicImages.ohneKi;
        return {
            current:
                row === undefined
                    ? null
                    : {
                          assetId: row.asset_public_id,
                          title: row.title,
                          preview:
                              row.preview_sha256 === null || row.preview_width === null || row.preview_height === null
                                  ? null
                                  : {
                                        url: mediaPublicUrl(row.preview_sha256),
                                        width: row.preview_width,
                                        height: row.preview_height,
                                    },
                          privatePreview:
                              row.intern_variant === null || row.intern_width === null || row.intern_height === null
                                  ? null
                                  : {
                                        url: mediaEditorPreviewUrl(row.asset_public_id, row.intern_variant),
                                        width: row.intern_width,
                                        height: row.intern_height,
                                    },
                          revision: row.revision,
                          since: row.created_at.toISOString(),
                          public: sichtbar.get(category)?.id === row.asset_public_id,
                          creationMethod: row.creation_method,
                      },
            former: formerBy.get(key) ?? 0,
            formerItems: formerItemsBy.get(key) ?? [],
        };
    };
    const items: MamTypeImage[] = HEADER_GRAPHICS.map((category) => {
        // `objects` sagt, WELCHE Fachobjekte die Kategorie zeigen (Trichter der Oberfläche); die Zahl kommt aus den
        // Zuordnungsfunktionen, nicht aus den Schlüsseln — auch „Region“ und „Kraftlinien“ haben jetzt eine.
        const { objects } = headerGraphicKeys(category);
        const ki = slot(category, "ki");
        return {
            category,
            label: HEADER_GRAPHIC_LABELS[category],
            objects,
            count: counts.get(category) ?? 0,
            // Die Felder der Vorversion tragen die KI-Variante.
            current: ki.current,
            former: ki.former,
            formerItems: ki.formerItems,
            ohneKi: slot(category, "ohne_ki"),
        };
    });
    // Die eingebauten Grafiken sind KI-erzeugt: Übernehmen füllt nur die KI-Variante.
    return { items, adoptable: items.filter((item) => item.current === null).length };
}

interface FormerRow {
    category: string;
    variant: MediaTypeImageVariant;
    asset_public_id: string;
    title: string | null;
    retired_at: Date;
    preview_sha256: string | null;
    preview_width: number | null;
    preview_height: number | null;
}

interface ActiveRow {
    id: string;
    revision: number;
    updated_at: Date;
    asset_public_id: string;
}

async function activeTypeImage(
    tx: Queryable,
    category: HeaderGraphic,
    variant: MediaTypeImageVariant,
): Promise<ActiveRow | undefined> {
    const [row] = await tx<ActiveRow[]>`
        SELECT t.id::text AS id, t.revision::int AS revision, t.updated_at, a.public_id::text AS asset_public_id
          FROM media_type_image t JOIN media_asset a ON a.id = t.media_asset_id
         WHERE t.category = ${category} AND t.variant = ${variant} AND t.retired_at IS NULL
           FOR UPDATE OF t
    `;
    return row;
}

/** Je Kategorie nacheinander: zwei gleichzeitige Wechsel warten aufeinander (ein ★ je Kategorie und Variante, Index in 0314). */
async function lockCategory(tx: Queryable, category: HeaderGraphic): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`media_type_image:${category}`}))`;
}

export function setTypeImage(
    database: Database,
    actor: MediaActor,
    body: MediaTypeImageSetBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "type_image.set",
            // Die Variante gehört zur Handlung: Dieselbe Kennung mit einer anderen Variante ist eine andere Anfrage (409 operation_id_reused).
            body: {
                category: body.category,
                assetId: body.assetId,
                baseRevision: body.baseRevision,
                ...(body.variant === undefined ? {} : { variant: body.variant }),
            },
        },
        async (tx) => {
            const variant: MediaTypeImageVariant = body.variant ?? "ki";
            await lockCategory(tx, body.category);
            const asset = await lockAsset(tx, body.assetId);
            // 🔴 Ein Reisebild wird kein Typbild.
            requireNichtReisebild(asset);
            if (asset.mediaKind !== "image" || !assetTypeAllowsRole(asset.assetType, "header")) {
                throw new ApiError(
                    409,
                    "media_type_mismatch",
                    "Ein Typbild ist ein Bild, kein Wappen und kein 3D-Modell.",
                    {
                        assetType: asset.assetType,
                    },
                );
            }
            // 🔴 Die Entstehung entscheidet die Variante (WI-0281): ohne KI nur ein Foto, eine Zeichnung, ein Scan; KI nimmt nie eines davon.
            if (!typeImageVariantAccepts(variant, asset.creationMethod)) {
                throw new ApiError(
                    409,
                    "type_image_variant_mismatch",
                    variant === "ohne_ki"
                        ? "Als Typbild ohne KI geht nur ein Bild, dessen Entstehung als Foto, Zeichnung oder Scan eingetragen ist."
                        : "Dieses Bild ist ohne KI entstanden: Es gehört in die Variante „Ohne KI“.",
                    { variant, creationMethod: asset.creationMethod },
                );
            }
            if (asset.assetType === null) {
                await tx`UPDATE media_asset SET asset_type = 'picture' WHERE id = ${asset.id} AND asset_type IS NULL`;
            }
            const active = await activeTypeImage(tx, body.category, variant);
            if (active !== undefined) {
                if (body.baseRevision !== active.revision) {
                    throw await mediaEditConflict(
                        tx,
                        {
                            record: "binding",
                            assetId: active.asset_public_id,
                            binding: mediaBindingKey("media_type_image", active.id),
                        },
                        { revision: active.revision, changedAt: active.updated_at },
                    );
                }
                if (active.asset_public_id === asset.publicId) {
                    throw new ApiError(
                        409,
                        "media_already_bound",
                        "Dieses Bild ist schon das Typbild dieser Kategorie.",
                    );
                }
            } else if (body.baseRevision !== undefined) {
                throw EDIT_CONFLICT_EMPTY();
            }

            const entries: MediaAuditEntry[] = [];
            const derivedWork: DerivedWork[] = [];
            if (active !== undefined) {
                const [retired] = await tx<{ revision: number }[]>`
                    UPDATE media_type_image SET retired_at = now() WHERE id = ${active.id} RETURNING revision::int AS revision
                `;
                entries.push({
                    action: "binding.type_image_released",
                    assetId: active.asset_public_id,
                    targetRevision: retired!.revision,
                    details: {
                        binding: mediaBindingKey("media_type_image", active.id),
                        category: body.category,
                        variant,
                        replacedBy: asset.publicId,
                    },
                });
                derivedWork.push(
                    await enqueueSettle(tx, {
                        assetPublicId: active.asset_public_id,
                        role: "header",
                        actorPersonId: actor.personId,
                    }),
                );
            }
            // 🔴 Die neue Zeile zählt über jeder früheren der Kategorie (beider Varianten): Sonst begänne sie bei 1, und ein zweiter Wechsel mit
            // demselben gesehenen Stand ginge durch (Befund WI-0068 R8 2026-10-18; dieselbe Regel wie `naechsteRevision` der Bindungen).
            const [created] = await tx<{ id: string; revision: number }[]>`
                INSERT INTO media_type_image (category, variant, media_asset_id, origin, revision)
                SELECT ${body.category}, ${variant}, ${asset.id}, 'editor', coalesce(max(revision), 0) + 1
                  FROM media_type_image WHERE category = ${body.category}
                RETURNING id::text AS id, revision::int AS revision
            `;
            entries.push({
                action: "binding.type_image_set",
                assetId: asset.publicId,
                targetRevision: created!.revision,
                details: {
                    binding: mediaBindingKey("media_type_image", created!.id),
                    category: body.category,
                    variant,
                    origin: "editor",
                },
            });
            derivedWork.unshift(
                await enqueueSettle(tx, {
                    assetPublicId: asset.publicId,
                    role: "header",
                    actorPersonId: actor.personId,
                }),
            );
            return {
                receipt: {
                    affected: [{ kind: "type_image", id: body.category, revision: created!.revision }],
                    derivedWork,
                    warnings: [],
                },
                entries,
            };
        },
    );
}

/**
 * Den ★ einer Variante lösen, ohne ein anderes Bild zu setzen (WI-0281, Vali 2026-11-05: „ja im zweifel darf auch nix sein - und dann ist halt grau“). Die Zeile
 * wird Verlauf wie bei einem Wechsel (`retired_at`), das Asset bleibt; der Abgleich rechnet es nach (Rolle `header`). Gesehener Stand ist die Revision der
 * ★-Zeile dieser Variante; ist sie schon leer, ist das ein Konflikt (jemand war schneller), kein stilles Gelingen.
 */
export function releaseTypeImage(
    database: Database,
    actor: MediaActor,
    body: MediaTypeImageReleaseBody,
): Promise<OperationReceipt> {
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "type_image.release",
            body: { category: body.category, variant: body.variant, baseRevision: body.baseRevision },
        },
        async (tx) => {
            await lockCategory(tx, body.category);
            const active = await activeTypeImage(tx, body.category, body.variant);
            if (active === undefined) throw EDIT_CONFLICT_EMPTY();
            if (body.baseRevision !== active.revision) {
                throw await mediaEditConflict(
                    tx,
                    {
                        record: "binding",
                        assetId: active.asset_public_id,
                        binding: mediaBindingKey("media_type_image", active.id),
                    },
                    { revision: active.revision, changedAt: active.updated_at },
                );
            }
            const [retired] = await tx<{ revision: number }[]>`
                UPDATE media_type_image SET retired_at = now() WHERE id = ${active.id} RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [{ kind: "type_image", id: body.category, revision: retired!.revision }],
                    derivedWork: [
                        await enqueueSettle(tx, {
                            assetPublicId: active.asset_public_id,
                            role: "header",
                            actorPersonId: actor.personId,
                        }),
                    ],
                    warnings: [],
                },
                entries: [
                    {
                        action: "binding.type_image_released",
                        assetId: active.asset_public_id,
                        targetRevision: retired!.revision,
                        details: {
                            binding: mediaBindingKey("media_type_image", active.id),
                            category: body.category,
                            variant: body.variant,
                        },
                    },
                ],
            };
        },
    );
}

/** Der Beleg an jedem übernommenen Asset: das Zitat des Betreibers zu den Rechten, wörtlich, mit Datum. */
export const BUILTIN_RIGHTS_NOTE = `Betreiber ${BUILTIN_TYPE_IMAGE_RIGHTS_DATE}, wörtlich zu den eingebauten Kopfgrafiken: „${BUILTIN_TYPE_IMAGE_RIGHTS_QUOTE}“`;

export async function adoptBuiltinTypeImages(
    database: Database,
    store: MediaStore,
    actor: MediaActor,
    body: MediaTypeImagesAdoptBody,
    dir: string | undefined,
): Promise<OperationReceipt> {
    if (dir === undefined) {
        throw new ApiError(
            503,
            "type_images_unavailable",
            "Die eingebauten Grafiken liegen auf dieser Instanz nicht vor.",
        );
    }
    // Die Dateien vor der Transaktion lesen (nichts davon ist Zustand der Datenbank).
    const files = new Map<HeaderGraphic, Buffer>();
    for (const category of HEADER_GRAPHICS) {
        const path = join(dir, `${category}.webp`);
        if (existsSync(path)) files.set(category, await readFile(path));
    }
    return mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "type_image.adopt", body: {} },
        async (tx) => {
            const [person] = await tx<{ display_name: string | null }[]>`
                SELECT display_name FROM avesmaps_auth.person WHERE id = ${actor.personId}::uuid
            `;
            const owner = person?.display_name?.trim() || null;
            const entries: MediaAuditEntry[] = [];
            const derivedWork: DerivedWork[] = [];
            const affected: OperationReceipt["affected"] = [];
            for (const category of HEADER_GRAPHICS) {
                const bytes = files.get(category);
                if (bytes === undefined) continue;
                await lockCategory(tx, category);
                // Die eingebauten Grafiken sind KI-erzeugt: nur in die KI-Variante, und nur, wo sie leer ist.
                if ((await activeTypeImage(tx, category, "ki")) !== undefined) continue;
                const inspection = inspectImage(bytes);
                const stored = await store.store("private_source", bytes, "webp");
                const [asset] = await tx<{ id: string; public_id: string; revision: number }[]>`
                    INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state,
                                             source_system, source_ref, title)
                    VALUES ('image', 'picture', 'project_generated', 'ai_generated', 'pending', 'not_applicable',
                            ${MEDIA_EDITOR_SOURCE_SYSTEM}, ${`icons/header/${category}.webp`},
                            ${`Typbild ${HEADER_GRAPHIC_LABELS[category]}`})
                    RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
                `;
                await tx`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                    VALUES (${asset!.id}, 'source', 'private_source', ${stored.key}, ${inspection.mimeType}, ${inspection.width},
                            ${inspection.height}, ${stored.byteSize}, ${stored.sha256})
                `;
                await tx`
                    INSERT INTO media_rights (media_asset_id, rights_basis, creator, rights_holder, clearance_state)
                    VALUES (${asset!.id}, 'own_work', ${owner}, ${owner}, 'unreviewed')
                `;
                await tx`
                    INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, description, recorded_by)
                    VALUES (${asset!.id}, 'operator_note', ${BUILTIN_RIGHTS_NOTE}, ${actor.personId})
                `;
                await tx`
                    INSERT INTO media_ingest (media_asset_id, ingest_kind, actor_person_id, source_system, source_ref, original_filename)
                    VALUES (${asset!.id}, 'editor_upload', ${actor.personId}::uuid, ${MEDIA_EDITOR_SOURCE_SYSTEM},
                            ${"eingebaute Kopfgrafik aus dem Release"}, ${`${category}.webp`})
                `;
                const [row] = await tx<{ id: string; revision: number }[]>`
                    INSERT INTO media_type_image (category, variant, media_asset_id, origin, revision)
                    SELECT ${category}, 'ki', ${asset!.id}, 'release', coalesce(max(revision), 0) + 1
                      FROM media_type_image WHERE category = ${category}
                    RETURNING id::text AS id, revision::int AS revision
                `;
                entries.push(
                    {
                        action: "asset.uploaded",
                        assetId: asset!.public_id,
                        targetRevision: asset!.revision,
                        details: {
                            role: "header",
                            kind: "image",
                            format: inspection.format,
                            byteSize: stored.byteSize,
                            sha256: stored.sha256,
                        },
                    },
                    {
                        action: "rights.evidence_added",
                        assetId: asset!.public_id,
                        targetRevision: null,
                        details: { kind: "operator_note", hasFile: false, hasUrl: false },
                    },
                    {
                        action: "binding.type_image_set",
                        assetId: asset!.public_id,
                        targetRevision: row!.revision,
                        details: {
                            binding: mediaBindingKey("media_type_image", row!.id),
                            category,
                            variant: "ki",
                            origin: "release",
                        },
                    },
                );
                affected.push({ kind: "type_image", id: category, revision: row!.revision });
                derivedWork.push(
                    await enqueueSettle(tx, {
                        assetPublicId: asset!.public_id,
                        role: "header",
                        actorPersonId: actor.personId,
                    }),
                );
            }
            return { receipt: { affected, derivedWork, warnings: [] }, entries };
        },
    );
}
