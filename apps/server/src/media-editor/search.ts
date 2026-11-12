import {
    MAM_BASKETS,
    MAM_EINREICHUNGEN,
    MAM_GALLERY_PREVIEWS,
    MAM_PAGE_LIMIT,
    MEDIA_ASSET_TYPES,
    PHOTOBOX_GALERIE_OHNE_ORT,
    PHOTOBOX_ORT_EINGAENGE_MAX,
    PHOTOBOX_ORT_REISEBILDER_MAX,
    PHOTOBOX_STAPEL_MAX,
    mediaEditorPreviewUrl,
    mediaPublicUrl,
    type MamAssetSummary,
    type MamBasket,
    type MamNavigation,
    type MamSearchQuery,
    type MamSearchResult,
    type MamSort,
    type MamSubmissionLabel,
    type MamUsageLabel,
    type MediaPersonRef,
    type PhotoboxGalerien,
    type PhotoboxOrtEingaenge,
    type PhotoboxOrtReisebilder,
    type PhotoboxStapel,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { PHOTOBOX_QUELLSYSTEM } from "../photobox/db.ts";
import { missingDerivativeAssets } from "./derivatives.ts";
import { typeImageOf } from "./usage.ts";
import { activeUsagesSql, personJson } from "./usage-sql.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import { GEHALTENE_QUELLBYTES_SQL } from "../media/notaus.ts";

/**
 * Liste, Suche und Navigation des MAM (WI-0068 §3.1, §3.2, P2): PostgreSQL allein, keine Suchinfrastruktur und kein
 * gespeicherter Index (2.484 Assets; `pg_trgm` erst nach Messung).
 *
 * Je Asset rechnet EINE Tafel `facts` (unten) die Werte, nach denen gefiltert, sortiert und gezählt wird: Rechte, Zahl der
 * aktiven Verwendungen, erste Verwendung als Name, andere Assets mit demselben Original, ob eine Datei unter `published/`
 * liegt, ob ein Notaus gilt und welche Einreichung eines Besuchers dahintersteht. Die Prüfkörbe (`MAM_BASKETS`) sind Bedingungen auf genau dieser Tafel, an EINER Stelle
 * (`basketWhere`); Liste und Navigation zählen mit denselben. Nur „Fehlende Derivate“ ist keine Spalte: Ob ein Bild öffentlich sein
 * dürfte, sagt die Policy (`derivatives.ts`); die Bedingung nimmt ihre Kennungen als Parameter.
 */

const FACTS = `
    WITH use AS (${activeUsagesSql("")}),
    -- Je Asset einmal zusammengefasst, damit kein Filter je Zeile die ganze Verwendungstafel durchläuft: Zahl, Rollen, Fachobjekte
    -- (art:uuid) und die Namen für die Suche, getrennt durch ein Steuerzeichen, das keine Eingabe überbrückt.
    use_agg AS (
        SELECT asset_id, count(*)::int AS n,
               array_agg(DISTINCT role) FILTER (WHERE role IS NOT NULL) AS roles,
               array_agg(DISTINCT subject_kind || ':' || subject_id) FILTER (WHERE subject_id IS NOT NULL) AS subjects,
               string_agg(concat_ws(chr(31), subject_name, gallery_title), chr(31)) AS use_text
          FROM use
         GROUP BY asset_id
    ),
    first_use AS (
        SELECT DISTINCT ON (asset_id) asset_id, subject_kind, subject_id, subject_name, subject_active, role, gallery_id,
               gallery_title, type_category
          FROM use
         ORDER BY asset_id, CASE via WHEN 'binding' THEN 0 ELSE 1 END, subject_name NULLS LAST, role NULLS LAST,
                  gallery_id NULLS LAST
    ),
    source AS (
        SELECT media_asset_id AS asset_id, sha256, width AS source_width, height AS source_height, corners_transparent
          FROM media_file WHERE storage_class = 'private_source'
    ),
    -- 🔴 Ein aufgegangenes Werk (D1) ist kein eigenes Bild mehr (Betreiber 2026-10-17: „Die zusammengeführten alten Assets sollen
    -- aus normalen Listen und Auswahlen verschwinden.“). Es fällt aus Liste, Körben, Zahlen und Gruppen; es bleibt bestehen und ist
    -- über die Zusammenführung umkehrbar.
    merged AS (
        SELECT merged_asset_id AS asset_id FROM media_merge WHERE lifted_at IS NULL
    ),
    live_source AS (
        SELECT s.* FROM source s WHERE NOT EXISTS (SELECT 1 FROM merged m WHERE m.asset_id = s.asset_id)
    ),
    -- Offline: der eigene Notaus oder, bei einer erzeugten Vorschau, der ihrer Karte (WI-0287, media/notaus.ts).
    suspended AS (
        SELECT DISTINCT s.asset_id
          FROM source s JOIN (${GEHALTENE_QUELLBYTES_SQL}) n ON n.sha256 = s.sha256
    ),
    -- Die Einreichung eines Besuchers hinter einem Asset (WI-0272 S3, media_ingest.submission_id): nur hinter dem AKTUELLEN Bild der
    -- Einreichung, dem des jüngsten Eingangs. Ein ersetztes Bild ist abgelehnt und gehört in keinen Korb. 🔴 Die Unterteilung submission_group
    -- ist die SQL-Fassung von photoboxUnterteilung (shared): offen = eingegangen, geprüft, und freigegeben mit wartender Beschreibung;
    -- Rückfrage; der Rest erledigt, auch ein technisch gescheitertes Bild (die Redaktion kann dort nichts entscheiden, Review M11). Der
    -- Routentest der Medienverwaltung hält beide gegeneinander.
    submission AS (
        SELECT DISTINCT ON (i.submission_id) i.media_asset_id AS asset_id, s.state AS submission_state, s.description AS submission_description,
               s.submitted_at AS submission_at, s.creation_kind AS submission_kind, p.name AS submission_place,
               CASE WHEN s.state IN ('incoming', 'pending') THEN 'offen'
                    WHEN s.state = 'approved' AND s.pending_description IS NOT NULL THEN 'offen'
                    WHEN s.state = 'changes_requested' THEN 'rueckfrage'
                    ELSE 'erledigt' END AS submission_group
          FROM media_ingest i
          JOIN media_submission s ON s.id = i.submission_id
          LEFT JOIN place p ON p.id = s.place_id
         WHERE i.submission_id IS NOT NULL
         ORDER BY i.submission_id, i.id DESC
    ),
    -- Wer eine Gruppe gleicher Dateien anführt: das älteste Werk (kleinste id). EINMAL je Datei gerechnet; 🪤 als Unterabfrage je Gruppe
    -- las sie für jede Gruppe alle Originale (R8-Messung 2026-10-18 am lokalen Bestand, 2.501 Werke in 1.025 Gruppen: 380 von 470 ms
    -- der Liste).
    group_lead AS (
        SELECT DISTINCT ON (s.sha256) s.sha256, a.public_id AS group_id
          FROM live_source s JOIN media_asset a ON a.id = s.asset_id
         ORDER BY s.sha256, a.id
    ),
    shared AS (
        -- Wie viele ANDERE Werke dieselbe Datei tragen, und wer die Gruppe anführt (group_lead).
        -- Die Kennung macht die Gruppe für eine Auswahl zusammenfassbar, ohne die SHA-256 nach außen zu geben.
        SELECT s.asset_id, count(DISTINCT o.asset_id)::int AS n, g.group_id
          FROM live_source s JOIN live_source o ON o.sha256 = s.sha256 AND o.asset_id <> s.asset_id
          JOIN group_lead g ON g.sha256 = s.sha256
         GROUP BY s.asset_id, s.sha256, g.group_id
    ),
    facts AS (
        SELECT a.id, a.public_id, a.revision::int AS revision, a.title, a.media_kind, a.asset_type, a.origin, a.creation_method,
               a.source_system = '${PHOTOBOX_QUELLSYSTEM}' AS is_reisebild,
               a.technical_state, a.source_ref, r.rights_basis, r.clearance_state, r.creator, r.rights_holder,
               coalesce(ua.n, 0) AS usage_count, coalesce(ua.roles, '{}') AS roles, coalesce(ua.subjects, '{}') AS subjects,
               coalesce(ua.use_text, '') AS use_text, coalesce(sh.n, 0) AS shared_count, sh.group_id::text AS file_group,
               EXISTS (SELECT 1 FROM media_file p WHERE p.media_asset_id = a.id AND p.storage_class = 'published') AS published,
               su.asset_id IS NOT NULL AS suspended,
               sc.source_width, sc.source_height, sc.corners_transparent,
               EXISTS (SELECT 1 FROM media_ingest i WHERE i.media_asset_id = a.id AND i.ingest_kind = 'legacy_import') AS from_legacy,
               greatest(a.updated_at, r.updated_at, c.updated_at) AS changed_at,
               sb.submission_state, sb.submission_group, sb.submission_description, sb.submission_at, sb.submission_kind, sb.submission_place,
               coalesce(a.title, fu.subject_name, fu.gallery_title) AS sort_name,
               fu.subject_kind, fu.subject_id, fu.subject_name, fu.subject_active, fu.role AS first_role, fu.gallery_id,
               fu.gallery_title, fu.type_category
          FROM media_asset a
          LEFT JOIN media_rights r ON r.media_asset_id = a.id
          LEFT JOIN media_creation c ON c.media_asset_id = a.id
          LEFT JOIN use_agg ua ON ua.asset_id = a.id
          LEFT JOIN shared sh ON sh.asset_id = a.id
          LEFT JOIN suspended su ON su.asset_id = a.id
          LEFT JOIN submission sb ON sb.asset_id = a.id
          LEFT JOIN source sc ON sc.asset_id = a.id
          LEFT JOIN first_use fu ON fu.asset_id = a.id
         WHERE NOT EXISTS (SELECT 1 FROM merged m WHERE m.asset_id = a.id)
    )
`;

/** Die Prüfkörbe als Bedingung auf `facts` (Beschreibung je Korb an `MAM_BASKETS`); „Fehlende Derivate“ steht in `basketWhere`. */
const BASKET_WHERE: Readonly<Record<Exclude<MamBasket, "missing_derivative">, string>> = {
    rights_open:
        "(rights_basis IS NULL OR rights_basis = 'unknown' OR clearance_state IN ('unreviewed', 'needs_review', 'legacy_assumed'))",
    // Betreiber 2026-10-10: eigene Werke aus Legacy, die nicht (mehr) KI-generiert sind und deren Rechte niemand geprüft hat.
    former_ai_assumption:
        "(from_legacy AND rights_basis = 'own_work' AND creation_method <> 'ai_generated' AND clearance_state NOT IN ('cleared', 'rejected'))",
    legacy_assumed: "clearance_state = 'legacy_assumed'",
    unused: "usage_count = 0",
    multiple: "usage_count > 1",
    shared_file: "shared_count > 0",
    missing_file: "technical_state IN ('pending', 'missing_file')",
    // T2b: undurchsichtige Ecken bei jedem Wappen, nicht quadratisch nur im Bestand (ein Wappen aus dem Editor wird aufgefüllt).
    coat_defects:
        "(asset_type = 'coat' AND (corners_transparent = false OR (origin <> 'editor_upload' AND source_width <> source_height)))",
    technical: "technical_state IN ('decode_failed', 'unsupported_format')",
    unpublished: "NOT published",
    suspended: "suspended",
    // WI-0272 S3: jedes Asset, das die Einreichung eines Besuchers ist; die Teile trennt `einreichung`.
    photobox_uploads: "submission_group IS NOT NULL",
};

/** Die Bedingung eines Korbs; `fehlend` ist der Platzhalter des Parameters mit den Kennungen der Bilder ohne Derivat. */
function basketWhere(basket: MamBasket, fehlend: () => string): string {
    return basket === "missing_derivative" ? `id = ANY(${fehlend()}::bigint[])` : BASKET_WHERE[basket];
}

/** Rechtestand als Rang: Offenes zuerst, wenn aufsteigend sortiert. */
const RIGHTS_RANK = `CASE coalesce(clearance_state, 'missing')
    WHEN 'rejected' THEN 0 WHEN 'missing' THEN 1 WHEN 'needs_review' THEN 2 WHEN 'unreviewed' THEN 3
    WHEN 'legacy_assumed' THEN 4 WHEN 'legacy_asserted' THEN 5 WHEN 'cleared' THEN 6 ELSE 7 END`;

const SORT_COLUMN: Readonly<Record<MamSort, string>> = {
    name: "lower(sort_name)",
    changed: "changed_at",
    usage: "usage_count",
    rights: RIGHTS_RANK,
};

/** Vorgabe je Sortierung: Namen aufsteigend, alles andere zuerst das Neueste, Meiste, Offenste. */
const DEFAULT_ORDER: Readonly<Record<MamSort, "asc" | "desc">> = {
    name: "asc",
    changed: "desc",
    usage: "desc",
    rights: "asc",
};

/** `%`, `_` und `\` in der Eingabe sind Text, kein Muster. */
export function likePattern(text: string): string {
    return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

interface FactRow {
    id: string;
    public_id: string;
    revision: number;
    title: string | null;
    media_kind: MamAssetSummary["kind"];
    asset_type: MamAssetSummary["assetType"];
    origin: MamAssetSummary["origin"];
    creation_method: MamAssetSummary["creationMethod"];
    technical_state: MamAssetSummary["technicalState"];
    is_reisebild: boolean;
    rights_basis: MamAssetSummary["rightsBasis"];
    clearance_state: MamAssetSummary["clearance"];
    usage_count: number;
    shared_count: number;
    file_group: string | null;
    published: boolean;
    suspended: boolean;
    changed_at: Date;
    subject_kind: NonNullable<MamUsageLabel["subject"]>["kind"] | null;
    subject_id: string | null;
    subject_name: string | null;
    subject_active: boolean | null;
    first_role: MamUsageLabel["role"];
    gallery_id: string | null;
    gallery_title: string | null;
    type_category: string | null;
    preview_sha256: string | null;
    preview_width: number | null;
    preview_height: number | null;
    intern_variant: string | null;
    intern_width: number | null;
    intern_height: number | null;
    uploaded_by: MediaPersonRef | null;
    uploaded_by_label: string | null;
    uploaded_at: Date | null;
    submission_state: MamSubmissionLabel["zustand"] | null;
    submission_group: MamSubmissionLabel["unterteilung"] | null;
    submission_description: string | null;
    submission_at: Date | null;
    submission_kind: MamSubmissionLabel["entstehung"] | null;
    submission_place: string | null;
    total: number;
}

function summaryOf(row: FactRow): MamAssetSummary {
    const hasUsage = row.subject_id !== null || row.gallery_id !== null;
    return {
        id: row.public_id,
        revision: row.revision,
        title: row.title,
        kind: row.media_kind,
        assetType: row.asset_type,
        origin: row.origin,
        creationMethod: row.creation_method,
        technicalState: row.technical_state,
        rightsBasis: row.rights_basis,
        clearance: row.clearance_state,
        usageCount: row.usage_count,
        sharedFileCount: row.shared_count,
        fileGroup: row.file_group,
        primaryUsage: hasUsage
            ? {
                  subject:
                      row.subject_kind === null || row.subject_id === null
                          ? null
                          : {
                                kind: row.subject_kind,
                                id: row.subject_id,
                                name: row.subject_name ?? "",
                                active: row.subject_active ?? false,
                            },
                  role: row.first_role,
                  gallery: row.gallery_id === null ? null : { id: row.gallery_id, title: row.gallery_title },
                  ...(row.type_category === null ? {} : { typeImage: typeImageOf(row.type_category)! }),
              }
            : null,
        preview:
            row.preview_sha256 === null || row.preview_width === null || row.preview_height === null
                ? null
                : { url: mediaPublicUrl(row.preview_sha256), width: row.preview_width, height: row.preview_height },
        privatePreview:
            row.intern_variant === null || row.intern_width === null || row.intern_height === null
                ? null
                : {
                      url: mediaEditorPreviewUrl(row.public_id, row.intern_variant),
                      width: row.intern_width,
                      height: row.intern_height,
                  },
        published: row.published,
        suspended: row.suspended,
        updatedAt: row.changed_at.toISOString(),
        uploadedBy: row.uploaded_by,
        uploadedByLabel: row.uploaded_by_label,
        uploadedAt: row.uploaded_at?.toISOString() ?? null,
        submission:
            row.submission_state === null ||
            row.submission_group === null ||
            row.submission_at === null ||
            row.submission_kind === null
                ? null
                : {
                      zustand: row.submission_state,
                      unterteilung: row.submission_group,
                      beschreibung: row.submission_description,
                      eingereichtAm: row.submission_at.toISOString(),
                      entstehung: row.submission_kind,
                      ortName: row.submission_place,
                  },
    };
}

/**
 * Die Suche (Spalte 2). Jeder Wert geht als Parameter; Spalten und Richtungen kommen nur aus den festen Tafeln oben.
 *
 * 🔴 Rein lesend (WI-0272 S3, Fixrunde E): Der Übergang einer Einreichung nach der technischen Prüfung (`incoming` → `pending`, `technikNachziehen`) steht NICHT hier,
 * sondern in der Route vor dem Lesen; so läuft die Funktion auch in `READ ONLY` (`media:messung`). Das gilt für `mediaNavigation`, `photoboxStapel` und `assetDetail` ebenso.
 */
export async function searchMedia(database: Queryable, query: MamSearchQuery): Promise<MamSearchResult> {
    const params: unknown[] = [];
    const param = (value: unknown): string => {
        params.push(value);
        return `$${String(params.length)}`;
    };
    const where: string[] = [];
    if (query.q !== undefined) {
        const pattern = param(likePattern(query.q.trim()));
        where.push(`(
            title ILIKE ${pattern} OR creator ILIKE ${pattern} OR rights_holder ILIKE ${pattern} OR source_ref ILIKE ${pattern}
            OR use_text ILIKE ${pattern}
        )`);
    }
    if (query.kind !== undefined) where.push(`media_kind = ${param(query.kind)}`);
    if (query.type !== undefined) where.push(`asset_type = ${param(query.type)}`);
    if (query.creation !== undefined) where.push(`creation_method = ${param(query.creation)}`);
    if (query.origin !== undefined) where.push(`origin = ${param(query.origin)}`);
    if (query.rightsBasis !== undefined) where.push(`rights_basis = ${param(query.rightsBasis)}`);
    if (query.clearance !== undefined) where.push(`clearance_state = ${param(query.clearance)}`);
    if (query.technical !== undefined) where.push(`technical_state = ${param(query.technical)}`);
    if (query.role !== undefined) where.push(`${param(query.role)}::text = ANY(roles)`);
    if (query.subject !== undefined) where.push(`${param(query.subject)}::text = ANY(subjects)`);
    // Je Dateigruppe nur das älteste Werk: `file_group` TRÄGT dessen Kennung, der Vergleich ist deshalb ein reiner Filter.
    if (query.groupFiles === true) where.push("(file_group IS NULL OR file_group = public_id::text)");
    // Eine Auswahl bietet kein Reisebild an (WI-0272 S5): Es bleibt in seiner Rolle, auch ein ersetztes Bild einer Einreichung, das in keinem Korb mehr steht.
    if (query.ohneReisebilder === true) where.push("NOT is_reisebild");
    if (query.einreichung !== undefined) where.push(`submission_group = ${param(query.einreichung)}`);
    if (query.basket === "missing_derivative") {
        const fehlend = param(await missingDerivativeAssets(database));
        where.push(basketWhere(query.basket, () => fehlend));
    } else if (query.basket !== undefined) {
        where.push(basketWhere(query.basket, () => ""));
    }

    const sort = query.sort ?? "name";
    const direction = (query.order ?? DEFAULT_ORDER[sort]) === "desc" ? "DESC" : "ASC";
    const limit = query.limit ?? MAM_PAGE_LIMIT.default;
    const offset = query.offset ?? 0;
    const order = `${SORT_COLUMN[sort]} ${direction} NULLS LAST, public_id`;
    const rows = await summaryRows(
        database,
        `SELECT facts.*, count(*) OVER ()::int AS total
           FROM facts
          ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
          ORDER BY ${order}
          LIMIT ${param(limit)} OFFSET ${param(offset)}`,
        order,
        params,
    );
    // Ohne Treffer auf dieser Seite fehlt die Fensterzählung; dann zählt eine zweite, schmale Abfrage (nur bei Seiten jenseits des Endes).
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && offset > 0) {
        const countParams = params.slice(0, -2);
        const [row] = await database.unsafe<{ n: number }[]>(
            `${FACTS} SELECT count(*)::int AS n FROM facts ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}`,
            countParams as never[],
        );
        total = row?.n ?? 0;
    }
    return { items: rows.map(summaryOf), total, limit, offset };
}

/**
 * Die Werke mit diesen Original-Bytes, das älteste zuerst (Duplikat-Prüfung beim Hochladen, Betreiber 2026-10-17). Ohne die
 * aufgegangenen: `facts` kennt sie nicht.
 */
export async function sameBytesAssets(database: Queryable, sha256: string): Promise<MamAssetSummary[]> {
    const rows = await summaryRows(
        database,
        `SELECT facts.*, count(*) OVER ()::int AS total
           FROM facts
          WHERE id IN (SELECT asset_id FROM source WHERE sha256 = $1)
          ORDER BY id`,
        "page.id",
        [sha256],
    );
    return rows.map(summaryOf);
}

/**
 * Der Stapel neuer Reisebilder in Community › Meldungen (WI-0272 S3, Aufgabe 19): wie viele Einreichungen offen sind und die internen Vorschauen der neuesten (höchstens
 * `PHOTOBOX_STAPEL_MAX`, neueste zuerst). 🔴 „Offen“ ist die Spalte `submission_group` aus `facts`, dieselbe Rechnung wie die Unterteilung „offen“ des Korbs „PhotoBox-Uploads“ und die
 * Zahl in `mediaNavigation`: keine zweite Fassung der Regel. Die Vorschau ist der vorhandene private Weg der Medienverwaltung (`mediaEditorPreviewUrl`, Variante `intern_…`); eine
 * Einreichung, deren Vorschau noch nicht gerechnet ist, zählt mit, steht aber nicht im Stapel. Sonst nichts: keine Beschreibung, kein Name, kein Ort.
 */
export async function photoboxStapel(database: Queryable): Promise<PhotoboxStapel> {
    const rows = await database.unsafe<{ offen: number; public_id: string | null; variant: string | null }[]>(
        `${FACTS},
        offen AS (SELECT id, public_id, submission_at FROM facts WHERE submission_group = 'offen')
        SELECT z.offen, s.public_id::text AS public_id, s.variant
          FROM (SELECT count(*)::int AS offen FROM offen) z
          LEFT JOIN (
              SELECT o.id, o.public_id, o.submission_at, v.variant
                FROM offen o
                JOIN LATERAL (
                    SELECT f.variant FROM media_file f
                     WHERE f.media_asset_id = o.id AND f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%' AND f.mime_type = 'image/webp'
                     ORDER BY f.width * f.height, f.id
                     LIMIT 1
                ) v ON TRUE
               ORDER BY o.submission_at DESC, o.id DESC
               LIMIT ${String(PHOTOBOX_STAPEL_MAX)}
          ) s ON TRUE
         ORDER BY s.submission_at DESC NULLS LAST, s.id DESC`,
    );
    return {
        offen: rows[0]?.offen ?? 0,
        vorschau: rows.flatMap((row) =>
            row.public_id === null || row.variant === null
                ? []
                : [{ publicId: row.public_id, url: mediaEditorPreviewUrl(row.public_id, row.variant) }],
        ),
    };
}

/**
 * Die offenen Eingänge eines Ortes für den Kopf seiner Infobox (WI-0272 S5): Einreichungen, die der Einreicher diesem Ort zugeordnet hat und über die die Redaktion noch nicht
 * entschieden hat (eingegangen oder geprüft, Zustand `incoming` oder `pending`), mit der internen Vorschau ihres aktuellen Bildes (dem des jüngsten Eingangs; ein ersetztes Bild zählt nicht).
 * Eine Einreichung, deren Vorschau noch nicht gerechnet ist, fehlt. Die ältesten zuerst, höchstens `PHOTOBOX_ORT_EINGAENGE_MAX`.
 *
 * 🔴 Nur für `view_media_private` (`routes/media-editor.ts`, `no-store`) und nur die Kennung des Mediums, die Adresse des privaten Weges und die Maße der Vorschau: keine Beschreibung, kein
 * Name, keine Stelle. Rein lesend; den Übergang `incoming` → `pending` zieht die Route vorher nach (`technikNachziehen`).
 */
export async function photoboxOrtEingaenge(database: Queryable, ortId: string): Promise<PhotoboxOrtEingaenge> {
    const rows = await database<{ public_id: string; variant: string; width: number; height: number }[]>`
        SELECT a.public_id::text AS public_id, v.variant, v.width, v.height
          FROM place p
          JOIN media_submission s ON s.place_id = p.id AND s.state IN ('incoming', 'pending')
          JOIN LATERAL (
              SELECT i.media_asset_id FROM media_ingest i WHERE i.submission_id = s.id ORDER BY i.id DESC LIMIT 1
          ) cur ON TRUE
          JOIN media_asset a ON a.id = cur.media_asset_id
          JOIN LATERAL (
              SELECT f.variant, f.width, f.height FROM media_file f
               WHERE f.media_asset_id = a.id AND f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%' AND f.mime_type = 'image/webp'
               ORDER BY f.width * f.height, f.id
               LIMIT 1
          ) v ON TRUE
         WHERE p.public_id = ${ortId}::uuid
         ORDER BY s.submitted_at, s.id
         LIMIT ${PHOTOBOX_ORT_EINGAENGE_MAX}
    `;
    return {
        eingaenge: rows.map((row) => ({
            publicId: row.public_id,
            url: mediaEditorPreviewUrl(row.public_id, row.variant),
            breite: row.width,
            hoehe: row.height,
        })),
    };
}

/**
 * Die freigegebenen Reisebilder eines Ortes für das Panel „Reisebilder der Community“ im Ortseditor (WI-0272): Einreichungen im Zustand `approved` an diesem Ort mit noch gültiger Verwendung, in der Reihenfolge
 * der Freigabe. Die Vorschau ist die private Datei, solange das Bild nicht öffentlich ist, sonst die Hauptfassung (nicht die Kachel: Sie ist Beiwerk der Leiste). Nur für `view_media_private`, rein lesend.
 */
export async function photoboxOrtReisebilder(
    database: Queryable,
    ortId: string | null,
): Promise<PhotoboxOrtReisebilder> {
    const rows = await reisebildZeilen(database, { ort: ortId, limit: PHOTOBOX_ORT_REISEBILDER_MAX });
    return {
        reisebilder: rows.map((row) => ({
            publicId: row.public_id,
            url: reisebildUrl(row),
            beschreibung: row.beschreibung,
            name: row.name,
            entstehung: row.entstehung,
            lage: { x: row.x, y: row.y },
        })),
    };
}

/**
 * Das Medienobjekt „PhotoBox-Galerien“: dieselben Reisebilder wie im Panel, je Ort zusammengefasst, die Orte nach Namen, die Bilder an freien Stellen zuletzt. Rein lesend; die Suche filtert über den Ortsnamen
 * und lässt die Sammlung ohne Ort weg.
 */
export async function photoboxGalerien(database: Queryable, q?: string): Promise<PhotoboxGalerien> {
    const suche = q?.trim() ?? "";
    const rows = await reisebildZeilen(database, { muster: suche === "" ? null : `%${suche}%` });
    const galerien = new Map<string, PhotoboxGalerien["items"][number]>();
    for (const row of rows) {
        const kennung = row.ort_id ?? PHOTOBOX_GALERIE_OHNE_ORT;
        const galerie = galerien.get(kennung) ?? {
            ort: row.ort_id === null || row.ort_name === null ? null : { id: row.ort_id, name: row.ort_name },
            bilder: 0,
            previews: [],
        };
        galerie.bilder += 1;
        const url = reisebildUrl(row);
        if (url !== null && galerie.previews.length < MAM_GALLERY_PREVIEWS) galerie.previews.push({ url });
        galerien.set(kennung, galerie);
    }
    return {
        items: [...galerien.values()].sort((a, b) =>
            a.ort === null ? 1 : b.ort === null ? -1 : a.ort.name.localeCompare(b.ort.name, "de"),
        ),
    };
}

interface ReisebildZeile {
    ort_id: string | null;
    ort_name: string | null;
    public_id: string;
    beschreibung: string | null;
    name: string | null;
    entstehung: PhotoboxOrtReisebilder["reisebilder"][number]["entstehung"];
    x: number;
    y: number;
    variant: string | null;
    sha256: string | null;
    storage_class: string | null;
}

/** Die freigegebenen Reisebilder in der Reihenfolge der Freigabe: die eines Ortes, die ohne Ort (`ort: null`) oder, ohne `ort`, alle (dann gilt die Suche über den Ortsnamen). */
function reisebildZeilen(
    database: Queryable,
    wahl: { ort?: string | null; muster?: string | null; limit?: number },
): Promise<ReisebildZeile[]> {
    const ort = wahl.ort ?? null;
    const muster = wahl.muster ?? null;
    return database<ReisebildZeile[]>`
        SELECT p.public_id::text AS ort_id, p.name AS ort_name,
               a.public_id::text AS public_id, s.description AS beschreibung, s.attribution_name AS name, s.creation_kind AS entstehung,
               ST_X(s.geom) AS x, ST_Y(s.geom) AS y, v.variant, v.sha256, v.storage_class
          FROM media_submission s
          JOIN photobox_media m ON m.media_submission_id = s.id AND m.retired_at IS NULL
          JOIN media_asset a ON a.id = m.media_asset_id
          LEFT JOIN place p ON p.id = s.place_id
          LEFT JOIN LATERAL (
              SELECT f.variant, f.sha256, f.storage_class FROM media_file f
               WHERE f.media_asset_id = a.id AND f.mime_type = 'image/webp'
                 AND ((f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%')
                      OR (f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.photobox}))
               ORDER BY f.storage_class = 'derivative' DESC, f.id DESC
               LIMIT 1
          ) v ON TRUE
         WHERE s.state = 'approved'
           AND (${wahl.ort !== null}::boolean OR s.place_id IS NULL)
           AND (${ort}::uuid IS NULL OR p.public_id = ${ort}::uuid)
           AND (${muster}::text IS NULL OR p.name ILIKE ${muster})
         ORDER BY m.id
         LIMIT ${wahl.limit ?? null}::int
    `;
}

/**
 * Die Vorschauen gemeldeter Reisebilder (WI-0272, Vali 2026-11-04: „das bild oder den link ins MAM“): je Kennung des Mediums die Adresse wie im Panel der Reisebilder. Nur Medien der PhotoBox; was es nicht gibt oder
 * noch keine Vorschau hat, fehlt. Die Kennung kommt vom Melder: Ein fremdes Medium führt hier zu nichts. 🔴 Nur für `view_media_private`.
 */
export async function reisebildVorschauen(
    database: Queryable,
    ids: readonly string[],
): Promise<Map<string, { publicId: string; url: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await database<Pick<ReisebildZeile, "public_id" | "variant" | "sha256" | "storage_class">[]>`
        SELECT a.public_id::text AS public_id, v.variant, v.sha256, v.storage_class
          FROM media_asset a
          JOIN LATERAL (
              SELECT f.variant, f.sha256, f.storage_class FROM media_file f
               WHERE f.media_asset_id = a.id AND f.mime_type = 'image/webp'
                 AND ((f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%')
                      OR (f.storage_class = 'published' AND f.variant = ${PUBLISHED_VARIANT.photobox}))
               ORDER BY f.storage_class = 'derivative' DESC, f.id DESC
               LIMIT 1
          ) v ON TRUE
         WHERE a.public_id = ANY(${[...ids]}::uuid[])
           AND EXISTS (SELECT 1 FROM media_ingest i WHERE i.media_asset_id = a.id AND i.submission_id IS NOT NULL)
    `;
    const vorschauen = new Map<string, { publicId: string; url: string }>();
    for (const row of rows) {
        const url = reisebildUrl(row);
        if (url !== null) vorschauen.set(row.public_id, { publicId: row.public_id, url });
    }
    return vorschauen;
}

function reisebildUrl(row: Pick<ReisebildZeile, "public_id" | "variant" | "sha256" | "storage_class">): string | null {
    if (row.sha256 === null || row.variant === null) return null;
    return row.storage_class === "published"
        ? mediaPublicUrl(row.sha256)
        : mediaEditorPreviewUrl(row.public_id, row.variant);
}

/** Eine Seite aus `facts` (`pageSql` wählt, ordnet und begrenzt) mit Vorschau und Eingang, in derselben Reihenfolge. */
async function summaryRows(database: Queryable, pageSql: string, order: string, params: unknown[]): Promise<FactRow[]> {
    return database.unsafe<FactRow[]>(
        `${FACTS},
        page AS (${pageSql})
        SELECT page.*, pv.sha256 AS preview_sha256, pv.width AS preview_width, pv.height AS preview_height,
               ipv.variant AS intern_variant, ipv.width AS intern_width, ipv.height AS intern_height,
               ing.uploaded_by, ing.uploaded_by_label, ing.uploaded_at
          FROM page
          LEFT JOIN LATERAL (
              SELECT f.sha256, f.width, f.height FROM media_file f
               WHERE f.media_asset_id = page.id AND f.storage_class = 'published'
               ORDER BY f.width * f.height, f.id
               LIMIT 1
          ) pv ON TRUE
          -- Ohne öffentliche Datei: die private Vorschau (WI-0068 P4b), nur für die Medienverwaltung.
          LEFT JOIN LATERAL (
              SELECT f.variant, f.width, f.height FROM media_file f
               WHERE pv.sha256 IS NULL AND f.media_asset_id = page.id AND f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%'
               ORDER BY f.width * f.height, f.id
               LIMIT 1
          ) ipv ON TRUE
          -- Wer es hereinbrachte (nur die Seite, nicht der ganze Bestand): der erste Eingang wie bei den Plätzen (slots.ts).
          LEFT JOIN LATERAL (
              SELECT CASE WHEN i.ingest_kind = 'editor_upload' AND p.id IS NOT NULL THEN ${personJson("p")} END AS uploaded_by,
                     i.legacy_actor_label AS uploaded_by_label,
                     coalesce(i.legacy_uploaded_at, i.ingested_at) AS uploaded_at
                FROM media_ingest i
                LEFT JOIN avesmaps_auth.person p ON p.id = i.actor_person_id
               WHERE i.media_asset_id = page.id
               ORDER BY i.id
               LIMIT 1
          ) ing ON TRUE
         ORDER BY ${order}`,
        params as never[],
    );
}

/** Die Navigation (Spalte 1): Arten, Medienobjekte und die Prüfkörbe mit ihrer Zahl, in EINER Abfrage. */
export async function mediaNavigation(database: Queryable): Promise<MamNavigation> {
    const fehlend = await missingDerivativeAssets(database);
    const baskets = MAM_BASKETS.map(
        (basket) => `count(*) FILTER (WHERE ${basketWhere(basket, () => "$1")})::int AS "${basket}"`,
    );
    // Die Typen kommen aus der festen Tafel des Vertrags, nie aus einer Eingabe: sie dürfen als Spaltennamen stehen.
    const types = MEDIA_ASSET_TYPES.map(
        (type) => `count(*) FILTER (WHERE asset_type = '${type}')::int AS "type_${type}"`,
    );
    // Die Teile des Korbs „PhotoBox-Uploads“: dieselbe Spalte `submission_group` wie der Filter der Liste.
    const einreichungen = MAM_EINREICHUNGEN.map(
        (teil) => `count(*) FILTER (WHERE submission_group = '${teil}')::int AS "einreichung_${teil}"`,
    );
    const [row] = await database.unsafe<Record<string, number>[]>(
        `${FACTS}
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE media_kind = 'image')::int AS image,
               count(*) FILTER (WHERE media_kind = 'model_3d')::int AS model_3d,
               ${types.join(",\n               ")},
               ${einreichungen.join(",\n               ")},
               (SELECT count(*)::int FROM media_gallery) AS galleries,
               (SELECT count(*)::int FROM citymap WHERE is_active) AS citymaps,
               (SELECT count(*)::int FROM (
                   SELECT DISTINCT s.place_id FROM media_submission s
                     JOIN photobox_media m ON m.media_submission_id = s.id AND m.retired_at IS NULL
                    WHERE s.state = 'approved'
               ) g) AS photobox_galerien,
               (SELECT count(DISTINCT category)::int FROM media_type_image WHERE retired_at IS NULL) AS type_images,
               ${baskets.join(",\n               ")}
          FROM facts`,
        [fehlend] as never[],
    );
    const value = (key: string): number => row?.[key] ?? 0;
    return {
        total: value("total"),
        kinds: { image: value("image"), model_3d: value("model_3d") },
        types: Object.fromEntries(
            MEDIA_ASSET_TYPES.map((type) => [type, value(`type_${type}`)]),
        ) as MamNavigation["types"],
        galleries: value("galleries"),
        citymaps: value("citymaps"),
        photoboxGalerien: value("photobox_galerien"),
        // „Kategorien mit ★“ in mindestens einer Variante (WI-0281: je Kategorie bis zu zwei aktive Zeilen), nie mehr als `HEADER_GRAPHICS`.
        typeImages: value("type_images"),
        baskets: Object.fromEntries(MAM_BASKETS.map((basket) => [basket, value(basket)])) as MamNavigation["baskets"],
        einreichungen: {
            offen: value("einreichung_offen"),
            rueckfrage: value("einreichung_rueckfrage"),
            erledigt: value("einreichung_erledigt"),
        },
    };
}
