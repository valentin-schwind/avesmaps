import { LEGACY_SHAPE, MEDIA_CLASSES, withoutStamp, type MediaClass } from "./media-legacy.ts";
import { legacyLocalPath } from "./media-manifest.ts";

/**
 * Ein ABGELEITETES Manifest für Proben, bevor es Legacys echten Export E5 gibt (WI-0063 MEDIA-M8 bis M10). Es entsteht aus dem Stand,
 * den Avesmaps3D schon hat: Ortsbilder und Ortswappen aus `map-features.json`, Gebietswappen aus `legacy-political-territories.json`
 * (dort steht die Adresse nach Legacys Rangfolge Override, eigenes Feld, Wiki-Stand, und nur, wenn Legacys Lizenz-Gate sie
 * durchlässt). Die Form ist die von Export B.
 *
 * 🔴 KEIN Export von Legacy. Was im Kartensatz fehlt, fehlt hier und wird NICHT erraten: keine Unterdrückung der Gebiete (der
 * Kartensatz kennt „kein Entscheid“ und „ausdrücklich kein Wappen“ nicht auseinander), keine nichtöffentlichen Medien, keine Literatur,
 * keine Kartensammlung, keine Rechtenotizen. Die Quelle des Gebietswappens steht fest auf `territory` (der Kartensatz sagt nicht, ob
 * ein Override oder der Wiki-Stand gewann). Eine Probe damit sagt etwas über Menge, Dauer und Speicher der Pipeline, nie über die
 * Rechte der echten Medien.
 */

const PUBLIC_CODES: readonly string[] = ["public_domain", "cc0", "permission_granted", "ai_generated", "own_work"];

interface PlaceFeature {
    properties?: Record<string, unknown>;
}

export interface ProbeInput {
    features: { features?: PlaceFeature[] };
    territories: { territories?: Record<string, unknown>[] };
    mediaRevision: string;
}

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function item(
    cls: MediaClass,
    key: string,
    subject: string,
    sortOrder: number,
    localUrl: string | null,
    origin: string | null,
    code: string | null,
    isPublic: boolean,
    suppressed: boolean,
    priv: Record<string, unknown>,
): Record<string, unknown> {
    const shape = LEGACY_SHAPE[cls];
    return {
        legacy_media_key: key,
        media_class: cls,
        subject_kind: shape.subjectKind,
        subject_public_id: subject,
        role: shape.role,
        sort_order: sortOrder,
        local_url: localUrl,
        origin,
        legacy_rights_code: code,
        legacy_public: isPublic,
        suppressed,
        stored_url: null,
        source_url: null,
        legacy_source: null,
        license_text: null,
        author: null,
        attribution: null,
        note: null,
        uploaded_by: null,
        uploaded_at: null,
        shown: isPublic && !suppressed,
        legacy_form: null,
        override_keys: null,
        ...priv,
    };
}

export function buildProbeManifest(input: ProbeInput): Record<string, unknown> {
    const items: Record<string, unknown>[] = [];
    for (const feature of input.features.features ?? []) {
        const properties = feature.properties ?? {};
        const place = text(properties["public_id"]);
        if (place === null) continue;
        const images = Array.isArray(properties["images"]) ? (properties["images"] as unknown[]) : [];
        images.forEach((image, index) => {
            const record = typeof image === "object" && image !== null ? (image as Record<string, unknown>) : null;
            const url = text(record === null ? image : record["url"]);
            if (url === null) return;
            const local = legacyLocalPath(url);
            const code = record === null ? null : text(record["license"]);
            items.push(
                item(
                    "settlement_image",
                    `settlement-image:${place}:${url}`,
                    place,
                    index,
                    local,
                    local === null ? "external" : "upload",
                    code,
                    true,
                    false,
                    {
                        stored_url: url,
                        legacy_form: record === null ? "string" : "object",
                        author: record === null ? null : text(record["author"]),
                        note: record === null ? null : text(record["note"]),
                        uploaded_by: record === null ? null : text(record["uploaded_by"]),
                        uploaded_at: record === null ? null : text(record["uploaded_at"]),
                    },
                ),
            );
        });
        if (properties["coat_none"] === true) {
            items.push(
                item("settlement_coat", `settlement-coat:${place}:none`, place, 0, null, null, null, false, true, {}),
            );
            continue;
        }
        const coat = properties["coat"];
        if (typeof coat !== "object" || coat === null) continue;
        const record = coat as Record<string, unknown>;
        const stored = text(record["url"]);
        if (stored === null) continue;
        const local = legacyLocalPath(stored);
        const code = text(record["license_status"]);
        const own = record["source"] === "own";
        const isPublic = local !== null && code !== null && PUBLIC_CODES.includes(code);
        items.push(
            item(
                "settlement_coat",
                `settlement-coat:${place}:${stored}`,
                place,
                0,
                local,
                own ? "custom" : local !== null ? "wiki_localized" : "wiki_staging",
                code,
                isPublic,
                false,
                {
                    stored_url: stored,
                    source_url: text(record["wiki_url"]),
                    legacy_source: text(record["source"]),
                    author: text(record["author"]),
                    attribution: text(record["attribution"]),
                    uploaded_by: text(record["uploaded_by"]),
                    uploaded_at: text(record["uploaded_at"]),
                },
            ),
        );
    }
    for (const territory of input.territories.territories ?? []) {
        const id = text(territory["public_id"]);
        const stored = text(territory["coat_of_arms_url"]);
        if (id === null || stored === null) continue;
        const url = withoutStamp(stored);
        const local = legacyLocalPath(url);
        const code = text(territory["coat_license_status"]);
        const custom = /-custom\.[a-z0-9]+$/i.test(url);
        items.push(
            item(
                "territory_coat",
                `territory-coat:${id}:territory:${url}`,
                id,
                0,
                local,
                custom ? "custom" : local !== null ? "wiki_localized" : "wiki_staging",
                code,
                local !== null && code !== null && PUBLIC_CODES.includes(code),
                false,
                {
                    stored_url: url,
                    legacy_source: "territory",
                },
            ),
        );
    }

    const byClass: Record<string, number> = {};
    for (const entry of items)
        byClass[entry["media_class"] as string] = (byClass[entry["media_class"] as string] ?? 0) + 1;
    return {
        ok: true,
        synthetic:
            "aus dem Kartensatz abgeleitet (map-features.json, legacy-political-territories.json), KEIN Export von Legacy",
        map_revision: 0,
        media_revision: input.mediaRevision,
        switches: {
            settlement_images: true,
            coats_local: true,
            coats_wiki: true,
            citymaps: true,
            citymap_previews: true,
            game_literature: true,
            game_literature_covers: true,
        },
        counts: {
            items: items.length,
            by_class: Object.fromEntries(
                MEDIA_CLASSES.filter((cls) => byClass[cls] !== undefined).map((cls) => [cls, byClass[cls]]),
            ),
            shown: items.filter((entry) => entry["shown"] === true).length,
            not_public: items.filter((entry) => entry["legacy_public"] === false && entry["suppressed"] === false)
                .length,
            suppressed: items.filter((entry) => entry["suppressed"] === true).length,
            game_literature: 0,
            citymaps: 0,
        },
        items,
        game_literature: [],
        citymaps: [],
    };
}
