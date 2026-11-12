import {
    MAM_KARTEN_SEITE,
    mediaEditorPreviewUrl,
    mediaPublicUrl,
    type MamKarteBild,
    type MamKarteDetail,
    type MamKartenAnfrage,
    type MamKartenListe,
    type MamKartePublikation,
    type MediaUsage,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { quellenTyp } from "../inhalte/quellen-lesen.ts";
import { umschlaegeVon } from "../inhalte/quellen-umschlag.ts";
import { karteGehalten } from "./karte-gehalten.ts";
import { erzeugtAusVon, vorschauSperren } from "./kartensammlung-vorschau.ts";
import { likePattern } from "./search.ts";
import { loadUsages } from "./usage.ts";
import { publishedVariantCase } from "./usage-sql.ts";

/**
 * Die Kartensammlung in der Medienverwaltung, der Lesepfad (WI-0068 R5, Vertrag `packages/shared/src/media-kartensammlung.ts`); das
 * Ändern steht in `kartensammlung-schreiben.ts`.
 *
 * 🔴 EIN Modell: die Tafeln aus Migration 0069 (`citymap` und ihre Kinder) und die Bindungen `citymap_media`. Die Entscheidung der Policy
 * je Bild kommt aus Reverse Usage (`loadUsages`), also aus derselben Rechnung wie der Lesepfad der Besucher; hier wird nichts neu
 * entschieden. Die Vorschau eines Bildes ist seine veröffentlichte Datei oder die private Vorschau (`intern_<variante>`), wie in der Liste
 * der Werke.
 */

interface BildZeile {
    karte: string;
    asset_db: string;
    asset_id: string;
    title: string | null;
    technical_state: NonNullable<MamKarteBild["technicalState"]>;
    role: "map_full" | "map_preview";
    origin: MamKarteBild["origin"];
    override: MamKarteBild["override"];
    pub_sha: string | null;
    pub_w: number | null;
    pub_h: number | null;
    iv_variant: string | null;
    iv_w: number | null;
    iv_h: number | null;
    version_label: string | null;
}

const VARIANTE = publishedVariantCase("m.role");

/**
 * Die aktiven Bilder der genannten Karten (interne Kennungen) mit Entscheidung und Vorschau, je Karte in der Folge Vorschau, dann die Karten (`map_full`) in der Reihenfolge ihrer
 * Versionen (WI-0287 Stufe 2, Migration 0321: `version_position NULLS FIRST`, dann die Bindung). Die erste Karte ist die, aus der eine Vorschau entsteht.
 */
async function bilderVon(db: Queryable, kartenIds: readonly string[]): Promise<Map<string, MamKarteBild[]>> {
    const je = new Map<string, MamKarteBild[]>();
    if (kartenIds.length === 0) return je;
    const zeilen = await db.unsafe<BildZeile[]>(
        `SELECT c.public_id::text AS karte, a.id::text AS asset_db, a.public_id::text AS asset_id, a.title, a.technical_state, m.role, m.origin,
                m.publication_override AS override, m.version_label,
                pub.sha256 AS pub_sha, pub.width AS pub_w, pub.height AS pub_h,
                iv.variant AS iv_variant, iv.width AS iv_w, iv.height AS iv_h
           FROM citymap_media m
           JOIN citymap c ON c.id = m.citymap_id
           JOIN media_asset a ON a.id = m.media_asset_id
           LEFT JOIN LATERAL (
               SELECT f.sha256, f.width, f.height FROM media_file f
                WHERE f.media_asset_id = a.id AND f.storage_class = 'published' AND f.variant = ${VARIANTE}
                ORDER BY f.created_at DESC, f.id DESC LIMIT 1
           ) pub ON TRUE
           LEFT JOIN LATERAL (
               SELECT f.variant, f.width, f.height FROM media_file f
                WHERE f.media_asset_id = a.id AND f.storage_class = 'derivative' AND f.variant = 'intern_' || ${VARIANTE}
                ORDER BY f.created_at DESC, f.id DESC LIMIT 1
           ) iv ON TRUE
          WHERE m.retired_at IS NULL AND m.citymap_id = ANY($1::bigint[])
          ORDER BY c.public_id, CASE m.role WHEN 'map_preview' THEN 0 ELSE 1 END, m.version_position NULLS FIRST, m.id`,
        [kartenIds as string[]],
    );
    const verwendungen = await loadUsages(
        db,
        zeilen.map((zeile) => zeile.asset_db),
    );
    // „Vorschau erzeugen“ (WI-0287 Punkt 5): an der Karte, warum es gesperrt ist; an einer erzeugten Vorschau, woraus sie entstand.
    const [sperren, herkunft] = await Promise.all([
        vorschauSperren(
            db,
            zeilen.filter((zeile) => zeile.role === "map_full").map((zeile) => zeile.asset_db),
        ),
        erzeugtAusVon(
            db,
            zeilen.filter((zeile) => zeile.role === "map_preview").map((zeile) => zeile.asset_db),
        ),
    ]);
    // Die Stelle einer Karte unter den Versionen ihres Eintrags: Die Zeilen kommen schon in dieser Folge.
    const stellen = new Map<string, number>();
    for (const zeile of zeilen) {
        const stelle = zeile.role === "map_full" ? (stellen.get(zeile.karte) ?? 0) : undefined;
        if (stelle !== undefined) stellen.set(zeile.karte, stelle + 1);
        const hier = (verwendungen.get(zeile.asset_db) ?? []).find(
            (usage: MediaUsage) =>
                usage.via === "binding" &&
                usage.subject?.kind === "citymap" &&
                usage.subject.id === zeile.karte &&
                usage.role === zeile.role,
        );
        const bild: MamKarteBild = {
            role: zeile.role,
            assetId: zeile.asset_id,
            title: zeile.title,
            origin: zeile.origin,
            override: zeile.override,
            // Ohne Verwendung (darf es nicht geben, die Zeile IST eine) sagt die Entscheidung „verborgen“ statt etwas zu erfinden.
            publication: hier?.publication ?? { public: false, reason: "suppressed" },
            preview:
                zeile.pub_sha === null || zeile.pub_w === null || zeile.pub_h === null
                    ? null
                    : { url: mediaPublicUrl(zeile.pub_sha), width: zeile.pub_w, height: zeile.pub_h },
            privatePreview:
                zeile.iv_variant === null || zeile.iv_w === null || zeile.iv_h === null
                    ? null
                    : {
                          url: mediaEditorPreviewUrl(zeile.asset_id, zeile.iv_variant),
                          width: zeile.iv_w,
                          height: zeile.iv_h,
                      },
            technicalState: zeile.technical_state,
            ...(stelle !== undefined
                ? {
                      vorschauSperre: sperren.get(zeile.asset_db) ?? null,
                      versionLabel: zeile.version_label,
                      versionPosition: stelle,
                  }
                : { erzeugtAus: herkunft.get(zeile.asset_db) ?? null }),
        };
        je.set(zeile.karte, [...(je.get(zeile.karte) ?? []), bild]);
    }
    return je;
}

interface ListenZeile {
    id: string;
    public_id: string;
    title: string;
    art: MamKarteDetail["art"];
    state: MamKarteDetail["state"];
    is_active: boolean;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    types: MamKarteDetail["types"] | null;
    places: number;
}

/** Die Liste, nach Titel wie der Katalog; die Suche geht über Titel, Zeichner, Verlag und die Namen der Orte. */
export async function kartenListe(db: Queryable, anfrage: MamKartenAnfrage): Promise<MamKartenListe> {
    const suche = anfrage.q?.trim() ?? "";
    const muster = suche === "" ? null : likePattern(suche);
    const limit = anfrage.limit ?? MAM_KARTEN_SEITE.default;
    const offset = anfrage.offset ?? 0;
    // WI-0287: Standard ohne die entfernten (stillgelegten) Einträge; mit dem Schalter erscheinen sie in der Liste.
    const mitStillgelegten = anfrage.retired === true;
    const filter = db`
        (${muster}::text IS NULL OR c.title ILIKE ${muster} OR c.author ILIKE ${muster} OR c.publisher ILIKE ${muster}
         OR EXISTS (SELECT 1 FROM citymap_place p WHERE p.citymap_id = c.id AND p.is_active AND p.raw_name ILIKE ${muster}))
        AND (c.is_active OR (${mitStillgelegten} AND c.state = 'retired'))
    `;
    const zeilen = await db<ListenZeile[]>`
        SELECT c.id::text AS id, c.public_id::text AS public_id, c.title, c.art, c.state, c.is_active, c.valid_from_bf,
               c.valid_to_bf,
               (SELECT array_agg(t.type_key ORDER BY t.type_key) FROM citymap_type t
                 WHERE t.citymap_id = c.id AND t.is_active) AS types,
               (SELECT count(*)::int FROM citymap_place p WHERE p.citymap_id = c.id AND p.is_active) AS places
          FROM citymap c
         WHERE ${filter}
         ORDER BY c.title, c.id
         LIMIT ${limit} OFFSET ${offset}
    `;
    const [gesamt] = await db<{ n: number; stillgelegt: number }[]>`
        SELECT count(*)::int AS n, (SELECT count(*)::int FROM citymap WHERE state = 'retired') AS stillgelegt
          FROM citymap c WHERE ${filter}
    `;
    const bilder = await bilderVon(
        db,
        zeilen.map((zeile) => zeile.id),
    );
    return {
        items: zeilen.map((zeile) => {
            const eigene = bilder.get(zeile.public_id) ?? [];
            // Die Liste zeigt die Vorschau der Karte, sonst das Vollbild.
            const zeigt = eigene.find((bild) => bild.role === "map_preview") ?? eigene[0];
            return {
                id: zeile.public_id,
                title: zeile.title,
                art: zeile.art,
                types: zeile.types ?? [],
                places: zeile.places,
                state: zeile.state,
                active: zeile.is_active,
                validFromBf: zeile.valid_from_bf,
                validToBf: zeile.valid_to_bf,
                images: eigene.length,
                publicImages: eigene.filter((bild) => bild.publication.public).length,
                versions: eigene.filter((bild) => bild.role === "map_full").length,
                preview: zeigt?.preview ?? null,
                privatePreview: zeigt?.privatePreview ?? null,
            };
        }),
        total: gesamt?.n ?? 0,
        retiredTotal: gesamt?.stillgelegt ?? 0,
    };
}

/**
 * Die Publikationen einer Karte (WI-0287 Stufe 1, Punkt 4): jede Quelle an ihr in jedem Zustand, in der Reihenfolge am Eintrag (`position`, die erste aktive ist der Band), mit dem
 * Umschlagbild des Werks (`quellen-umschlag.ts`). Eine im Katalog stillgelegte Quelle fehlt, wie im Infopanel und im Band der Besucher.
 */
async function publikationenVon(db: Queryable, karteId: string): Promise<MamKartePublikation[]> {
    const zeilen = await db<
        {
            source_id: string;
            title: string;
            source_type: string;
            is_official: boolean;
            url: string | null;
            pages: string | null;
            state: MamKartePublikation["state"];
        }[]
    >`
        SELECT s.public_id::text AS source_id, s.title, s.source_type, s.is_official, s.url, q.pages, q.state
          FROM citymap_source q JOIN feature_source s ON s.id = q.source_id AND s.is_active
         WHERE q.citymap_id = ${karteId}::bigint
         ORDER BY q.position, q.id
    `;
    const umschlaege = await umschlaegeVon(
        db,
        zeilen.map((zeile) => zeile.source_id),
    );
    return zeilen.map((zeile) => ({
        sourceId: zeile.source_id,
        title: zeile.title,
        sourceType: quellenTyp(zeile.source_type),
        offiziell: zeile.is_official,
        url: zeile.url,
        pages: zeile.pages,
        state: zeile.state,
        umschlag: umschlaege.get(zeile.source_id) ?? null,
    }));
}

interface DetailZeile {
    id: string;
    public_id: string;
    revision: number;
    editor_held: boolean;
    title: string;
    art: MamKarteDetail["art"];
    color_mode: MamKarteDetail["colorMode"];
    is_multilevel: boolean | null;
    is_labeled: boolean | null;
    is_official: boolean | null;
    is_spoiler: boolean | null;
    has_scale: boolean | null;
    width_px: number | null;
    height_px: number | null;
    format: string | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    author: string | null;
    publisher: string | null;
    note: string | null;
    legacy_wiki_key: string | null;
    legacy_origin: MamKarteDetail["legacyOrigin"];
    state: MamKarteDetail["state"];
    is_active: boolean;
    imported_at: Date | null;
    parent: { id: string; title: string } | null;
}

/** Eine Karte mit allem, was der Bestand führt; `undefined`, wenn es sie nicht gibt. */
export async function karteDetail(db: Queryable, publicId: string): Promise<MamKarteDetail | undefined> {
    const [karte] = await db<DetailZeile[]>`
        SELECT c.id::text AS id, c.public_id::text AS public_id, c.revision::int AS revision, ${db.unsafe(karteGehalten("c"))} AS editor_held,
               c.title, c.art, c.color_mode, c.is_multilevel, c.is_labeled,
               c.is_official, c.is_spoiler, c.has_scale, c.width_px, c.height_px, c.format, c.valid_from_bf, c.valid_to_bf, c.author,
               c.publisher, c.note, c.legacy_wiki_key, c.legacy_origin, c.state, c.is_active, c.imported_at,
               CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.public_id, 'title', e.title) END AS parent
          FROM citymap c LEFT JOIN citymap e ON e.id = c.parent_id
         WHERE c.public_id = ${publicId}::uuid
    `;
    if (karte === undefined) return undefined;
    const [verwandt, typen, orte, verweise, quellen, wiki, bilder, publikationen, uebergeben] = await Promise.all([
        db<{ id: string; title: string }[]>`
            SELECT o.public_id::text AS id, o.title FROM citymap_related r JOIN citymap o ON o.id = r.related_citymap_id
             WHERE r.citymap_id = ${karte.id}::bigint AND r.is_active ORDER BY o.title, o.id
        `,
        db<{ type_key: MamKarteDetail["types"][number] }[]>`
            SELECT type_key FROM citymap_type WHERE citymap_id = ${karte.id}::bigint AND is_active ORDER BY type_key
        `,
        db<
            {
                name: string;
                target_state: MamKarteDetail["places"][number]["targetState"];
                kind: string | null;
                id: string | null;
                target_name: string | null;
                target_active: boolean | null;
                target_type: string | null;
            }[]
        >`
            SELECT p.raw_name AS name, p.target_state,
                   CASE WHEN pl.id IS NOT NULL THEN 'place' WHEN t.id IS NOT NULL THEN 'territory' WHEN rg.id IS NOT NULL THEN 'region'
                        WHEN pk.id IS NOT NULL THEN 'terrain_peak' WHEN pa.id IS NOT NULL THEN 'path' END AS kind,
                   coalesce(pl.public_id, t.public_id, rg.public_id, pk.public_id, pa.public_id)::text AS id,
                   coalesce(pl.name, t.name, rg.name, pk.name, pa.name) AS target_name,
                   coalesce(pl.is_active, t.is_active, rg.is_active, pk.is_active, pa.is_active) AS target_active,
                   coalesce(pl.subtype, rg.region_type) AS target_type
              FROM citymap_place p
              LEFT JOIN place pl ON pl.id = p.place_id
              LEFT JOIN territory t ON t.id = p.territory_id
              LEFT JOIN region rg ON rg.id = p.region_id
              LEFT JOIN terrain_peak pk ON pk.id = p.terrain_peak_id
              LEFT JOIN path pa ON pa.id = p.path_id
             WHERE p.citymap_id = ${karte.id}::bigint AND p.is_active
             ORDER BY p.sort_order, p.id
        `,
        db<{ role: "primary" | "further"; url: string; label: string; is_paid: boolean | null }[]>`
            SELECT link_role AS role, url, label, is_paid FROM citymap_link
             WHERE citymap_id = ${karte.id}::bigint AND is_active ORDER BY CASE link_role WHEN 'primary' THEN 0 ELSE 1 END, position, id
        `,
        db<{ title: string; url: string | null; pages: string | null }[]>`
            SELECT s.title, s.url, q.pages FROM citymap_source q JOIN feature_source s ON s.id = q.source_id
             WHERE q.citymap_id = ${karte.id}::bigint AND q.is_active ORDER BY q.position, q.id
        `,
        db<{ url: string | null; title: string | null; state: string }[]>`
            SELECT wiki_url AS url, article_title AS title, assignment_state AS state FROM citymap_wiki_assignment
             WHERE citymap_id = ${karte.id}::bigint AND is_active ORDER BY id DESC LIMIT 1
        `,
        bilderVon(db, [karte.id]),
        publikationenVon(db, karte.id),
        // WI-0287 Stufe 2: Gingen die Bilder beim (letzten) Entfernen an einen anderen Eintrag, nennt ihn die Zeile `citymap.retired` (`handedTo`).
        karte.state === "retired"
            ? db<{ id: string; title: string }[]>`
                  SELECT z.public_id::text AS id, z.title
                    FROM (SELECT e.details ->> 'handedTo' AS ziel FROM media_audit_event e
                           WHERE e.citymap_public_id = ${karte.public_id}::uuid AND e.action = 'citymap.retired'
                           ORDER BY e.id DESC LIMIT 1) letzte
                    JOIN citymap z ON z.public_id::text = letzte.ziel
              `
            : Promise.resolve([]),
    ]);
    return {
        id: karte.public_id,
        revision: karte.revision,
        title: karte.title,
        art: karte.art,
        colorMode: karte.color_mode,
        isMultilevel: karte.is_multilevel,
        isLabeled: karte.is_labeled,
        isOfficial: karte.is_official,
        isSpoiler: karte.is_spoiler,
        hasScale: karte.has_scale,
        widthPx: karte.width_px,
        heightPx: karte.height_px,
        format: karte.format,
        validFromBf: karte.valid_from_bf,
        validToBf: karte.valid_to_bf,
        author: karte.author,
        publisher: karte.publisher,
        note: karte.note,
        legacyWikiKey: karte.legacy_wiki_key,
        legacyOrigin: karte.legacy_origin,
        state: karte.state,
        active: karte.is_active,
        importedAt: karte.imported_at === null ? null : karte.imported_at.toISOString(),
        editorHeld: karte.editor_held,
        parent: karte.parent,
        related: verwandt.map((zeile) => ({ id: zeile.id, title: zeile.title })),
        types: typen.map((zeile) => zeile.type_key),
        places: orte.map((zeile) => ({
            name: zeile.name,
            target:
                zeile.kind === null || zeile.id === null
                    ? null
                    : {
                          kind: zeile.kind as NonNullable<MamKarteDetail["places"][number]["target"]>["kind"],
                          id: zeile.id,
                          name: zeile.target_name ?? zeile.name,
                          active: zeile.target_active ?? false,
                          type: zeile.target_type,
                      },
            targetState: zeile.target_state,
        })),
        links: verweise.map((zeile) => ({
            role: zeile.role,
            url: zeile.url,
            label: zeile.label,
            isPaid: zeile.is_paid,
        })),
        sources: quellen.map((zeile) => ({ title: zeile.title, url: zeile.url, pages: zeile.pages })),
        publications: publikationen,
        wiki: wiki[0] === undefined ? null : { url: wiki[0].url, title: wiki[0].title, state: wiki[0].state },
        images: bilder.get(karte.public_id) ?? [],
        handedTo: uebergeben[0] ?? null,
    };
}
