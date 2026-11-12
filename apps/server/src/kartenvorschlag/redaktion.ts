import {
    KARTENVORSCHLAG_SEGMENT_ZUSTAENDE,
    KARTENVORSCHLAG_ZUSTAENDE,
    kartenvorschlagNummer,
    mediaEditorPreviewUrl,
    mediaPublicUrl,
    type KartenvorschlagAblehnen,
    type KartenvorschlagDateityp,
    type KartenvorschlagDetail,
    type KartenvorschlagListe,
    type KartenvorschlagListeQuery,
    type KartenvorschlagZeile,
    type KartenvorschlagZustand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { nimmWerkAus, technikNachziehen, ungueltig } from "./db.ts";

/**
 * Die Redaktion der Kartenvorschläge (WI-0275 Stufe B): Liste, ein Vorschlag mit allen Angaben und Ablehnen. Gelesen und geschrieben wird als Person mit
 * `moderate_submissions` (Schreibklasse `community`; die Route liefert die Person aus der Sitzung und schreibt das Ereignis des Protokolls in derselben
 * Transaktion).
 *
 * - **Technik nachgezogen:** Vor jedem Lesen zieht `technikNachziehen` die Vorschläge, deren Datei geprüft ist, von `incoming` auf `pending` oder
 *   `technical_failed` (der Abgleich im Worker schreibt die Tafel nicht).
 * - **Ablehnen** geht aus `incoming`, `technical_failed` und `pending`, gegen die Revision, die die Oberfläche sah (409 `kartenvorschlag_conflict`).
 *   Ein zweites Mal ist wirkungslos (der Stand kommt zurück, ohne zweites Ereignis). Das Werk einer Datei wird `rejected` (keine Veröffentlichung).
 * - 🔴 **Annehmen ist ein eigener Schritt** (`annehmen.ts`): Es legt die Zeile in `citymap` an und bindet das Werk. Hier gibt es keinen Weg, auf dem ein
 *   Vorschlag öffentlich wird; die Tafel selbst verlangt für `approved` eine Karte (`citymap_suggestion_approved_has_citymap`).
 */

interface ZeilenRow {
    public_id: string;
    id: string;
    number: string;
    state: KartenvorschlagZustand;
    way: "link" | "file";
    title: string;
    link_url: string | null;
    file_mime: string | null;
    submitted_at: Date;
    place_public_id: string | null;
    place_name: string | null;
    technical_state: string | null;
}

const alsZeile = (row: ZeilenRow): KartenvorschlagZeile => ({
    id: row.public_id,
    nummer: kartenvorschlagNummer(row.number),
    zustand: row.state,
    weg: row.way === "link" ? "link" : "datei",
    titel: row.title,
    link: row.link_url,
    dateiTyp: (row.file_mime as KartenvorschlagDateityp | null) ?? null,
    ort: row.place_public_id === null ? null : { id: row.place_public_id, name: row.place_name ?? "" },
    eingegangenAm: row.submitted_at.toISOString(),
    technik: row.technical_state,
});

/**
 * Der Korb: die Zustände eines Segments (offen: älteste zuerst, entschiedene: neueste zuerst), sonst die eines `zustand`, standardmäßig die wartenden. `q` sucht in Titel, Ort und Adresse, eine Nummer („K-1047“, „1047“) trifft
 * genau. `nach` ist die Marke der vorigen Seite (`naechste`). Die Zähler gelten für alle, nicht für die gesuchten.
 */
export async function liste(q: Queryable, abfrage: KartenvorschlagListeQuery): Promise<KartenvorschlagListe> {
    await technikNachziehen(q);
    const limit = abfrage.limit ?? 50;
    const zustaende =
        abfrage.segment === undefined
            ? [abfrage.zustand ?? "pending"]
            : [...KARTENVORSCHLAG_SEGMENT_ZUSTAENDE[abfrage.segment]];
    const neuesteZuerst = abfrage.segment === "angenommen" || abfrage.segment === "abgelehnt";
    const gesucht = (abfrage.q ?? "").trim();
    const muster = `%${gesucht.replace(/[\\%_]/gu, (zeichen) => `\\${zeichen}`)}%`;
    const nummer = /^(?:k-?)?(\d{1,18})$/iu.exec(gesucht)?.[1] ?? "";
    const marke =
        abfrage.nach === undefined
            ? q``
            : neuesteZuerst
              ? q`AND s.id < ${String(abfrage.nach)}::bigint`
              : q`AND s.id > ${String(abfrage.nach)}::bigint`;
    const rows = await q<(ZeilenRow & { marke: string })[]>`
        SELECT s.public_id::text AS public_id, s.id::text AS id, s.number::text AS number, s.state, s.way, s.title, s.link_url, s.file_mime,
               s.submitted_at, p.public_id::text AS place_public_id, p.name AS place_name, a.technical_state, s.id::text AS marke
          FROM citymap_suggestion s
          LEFT JOIN place p ON p.id = s.place_id
          LEFT JOIN media_asset a ON a.id = s.media_asset_id
         WHERE s.state = ANY(${zustaende}::text[]) ${marke}
           AND (${gesucht === ""}::boolean OR s.title ILIKE ${muster} OR p.name ILIKE ${muster} OR s.link_url ILIKE ${muster} OR s.number::text = ${nummer})
         ORDER BY s.id ${neuesteZuerst ? q`DESC` : q`ASC`}
         LIMIT ${limit + 1}
    `;
    const seite = rows.slice(0, limit);
    const weitere = rows.length > limit;
    const zaehler = Object.fromEntries(
        KARTENVORSCHLAG_ZUSTAENDE.map((zustand) => [zustand, 0]),
    ) as KartenvorschlagListe["zaehler"];
    const zahlen = await q<{ state: KartenvorschlagZustand; n: number }[]>`
        SELECT state, count(*)::int AS n FROM citymap_suggestion GROUP BY state
    `;
    for (const zeile of zahlen) zaehler[zeile.state] = zeile.n;
    return {
        eintraege: seite.map(alsZeile),
        zaehler,
        weitere,
        naechste: weitere ? Number(seite[seite.length - 1]!.marke) : null,
    };
}

interface DetailRow extends ZeilenRow {
    revision: number;
    description: string | null;
    source_text: string | null;
    usage_grant: "avesmaps_only" | "cc-by-4.0" | null;
    attribution_name: string | null;
    type_keys: string[];
    author: string | null;
    art: KartenvorschlagDetail["art"];
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    color_mode: KartenvorschlagDetail["farbe"];
    is_spoiler: boolean | null;
    is_labeled: boolean | null;
    is_multilevel: boolean | null;
    is_official: boolean | null;
    is_paid: boolean | null;
    preview_url: string | null;
    note: string | null;
    asset_public_id: string | null;
    media_deleted_at: Date | null;
    decided_at: Date | null;
    decision_reason: string | null;
    citymap_public_id: string | null;
    place_art: string | null;
    x: number | null;
    y: number | null;
}

const DETAIL = (q: Queryable) => q`
    SELECT s.public_id::text AS public_id, s.id::text AS id, s.number::text AS number, s.state, s.way, s.title, s.link_url, s.file_mime,
           s.submitted_at, p.public_id::text AS place_public_id, p.name AS place_name, s.revision::int AS revision, s.description, s.source_text,
           s.usage_grant, s.attribution_name, s.type_keys, s.author, s.art, s.valid_from_bf, s.valid_to_bf, s.color_mode, s.is_spoiler, s.is_labeled,
           s.is_multilevel, s.is_official, s.is_paid, s.preview_url, s.note, a.public_id::text AS asset_public_id, a.technical_state,
           s.media_deleted_at, s.decided_at, s.decision_reason, c.public_id::text AS citymap_public_id, p.subtype AS place_art,
           public.st_x(p.geom) AS x, public.st_y(p.geom) AS y
      FROM citymap_suggestion s
      LEFT JOIN place p ON p.id = s.place_id
      LEFT JOIN media_asset a ON a.id = s.media_asset_id
      LEFT JOIN citymap c ON c.id = s.accepted_citymap_id
`;

/**
 * Das größte Vorschaubild eines Werks. 🪤 Wird das Bild öffentlich, fällt die private Vorschau weg (`settle.ts`): Eine angenommene Karte hat oft nur noch die öffentliche Fassung, also zuerst sie, sonst die private
 * (`view_media_private`). Unter einem Notaus bleibt die öffentliche Zeile stehen, ihre Datei aber nicht; das fängt die Oberfläche ab (ein Bild, das nicht lädt, wird zum Platzhalter).
 */
async function vorschauVon(q: Queryable, assetPublicId: string): Promise<string | null> {
    const [datei] = await q<{ storage_class: string; variant: string; sha256: string }[]>`
        SELECT f.storage_class, f.variant, f.sha256 FROM media_file f
          JOIN media_asset a ON a.id = f.media_asset_id
         WHERE a.public_id = ${assetPublicId}::uuid AND f.mime_type = 'image/webp'
           AND (f.storage_class = 'published' OR (f.storage_class = 'derivative' AND f.variant LIKE 'intern\\_%'))
         ORDER BY f.storage_class = 'published' DESC, f.width DESC NULLS LAST, f.id DESC
         LIMIT 1
    `;
    if (datei === undefined) return null;
    return datei.storage_class === "published"
        ? mediaPublicUrl(datei.sha256)
        : mediaEditorPreviewUrl(assetPublicId, datei.variant);
}

/** Ein Vorschlag zur öffentlichen Kennung mit allen Angaben; `undefined`, wenn es ihn nicht gibt. Das Vorschaubild kommt nur mit `mitVorschau` (die Route prüft das Recht). */
export async function detail(
    q: Queryable,
    publicId: string,
    { mitVorschau = false }: { mitVorschau?: boolean } = {},
): Promise<KartenvorschlagDetail | undefined> {
    await technikNachziehen(q);
    const [row] = await q<DetailRow[]>`${DETAIL(q)} WHERE s.public_id = ${publicId}::uuid`;
    if (row === undefined) return undefined;
    return {
        ...alsZeile(row),
        revision: row.revision,
        beschreibung: row.description,
        quelle: row.source_text,
        nutzung: row.usage_grant,
        name: row.attribution_name,
        typen: row.type_keys as KartenvorschlagDetail["typen"],
        urheber: row.author,
        art: row.art,
        gueltigAb: row.valid_from_bf,
        gueltigBis: row.valid_to_bf,
        farbe: row.color_mode,
        spoiler: row.is_spoiler,
        beschriftet: row.is_labeled,
        mehrstoeckig: row.is_multilevel,
        offiziell: row.is_official,
        kostenpflichtig: row.is_paid,
        vorschauLink: row.preview_url,
        notiz: row.note,
        asset: row.asset_public_id,
        ...(row.media_deleted_at === null ? {} : { dateiGeloeschtAm: row.media_deleted_at.toISOString() }),
        entschiedenAm: row.decided_at?.toISOString() ?? null,
        grund: row.decision_reason,
        karte: row.citymap_public_id,
        ortArt: row.place_art,
        ortLage: row.x === null || row.y === null ? null : { x: row.x, y: row.y },
        vorschau: mitVorschau && row.asset_public_id !== null ? await vorschauVon(q, row.asset_public_id) : null,
    };
}

const ABLEHNBAR: ReadonlySet<KartenvorschlagZustand> = new Set(["incoming", "technical_failed", "pending"]);

/**
 * Lehnt einen Vorschlag ab, in der Transaktion des Aufrufers. `wirklich` sagt, ob sich etwas änderte (der Aufrufer schreibt das Ereignis nur dann);
 * die Antwort ist der Stand danach. 404 ohne den Vorschlag, 409 bei anderer Revision oder anderem Zustand.
 */
export async function ablehnen(
    tx: Queryable,
    personId: string,
    publicId: string,
    body: KartenvorschlagAblehnen,
): Promise<{ wirklich: boolean; vorschlag: KartenvorschlagDetail }> {
    await technikNachziehen(tx);
    const [zeile] = await tx<
        { id: string; state: KartenvorschlagZustand; revision: number; media_asset_id: string | null }[]
    >`
        SELECT id::text AS id, state, revision::int AS revision, media_asset_id::text AS media_asset_id
          FROM citymap_suggestion WHERE public_id = ${publicId}::uuid FOR UPDATE
    `;
    if (zeile === undefined)
        throw new ApiError(404, "kartenvorschlag_not_found", "Diesen Kartenvorschlag gibt es nicht.");
    if (zeile.state === "rejected") return { wirklich: false, vorschlag: (await detail(tx, publicId))! };
    if (!ABLEHNBAR.has(zeile.state)) {
        throw new ApiError(409, "kartenvorschlag_transition", "Das geht bei diesem Kartenvorschlag nicht (mehr).");
    }
    if (zeile.revision !== body.baseRevision) {
        throw new ApiError(409, "kartenvorschlag_conflict", "Dieser Kartenvorschlag wurde inzwischen geändert.", {
            revision: zeile.revision,
        });
    }
    const grund = body.grund === undefined ? null : body.grund.trim();
    if (grund === "") throw ungueltig("Der Grund darf nicht leer sein.", "grund_leer");
    await nimmWerkAus(tx, zeile.media_asset_id);
    await tx`
        UPDATE citymap_suggestion
           SET state = 'rejected', state_changed_at = now(), decided_at = now(), decided_by = ${personId}::uuid, decision_reason = ${grund}
         WHERE id = ${zeile.id}::bigint
    `;
    return { wirklich: true, vorschlag: (await detail(tx, publicId))! };
}
