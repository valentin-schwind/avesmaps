import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import {
    LEGACY_SHAPE,
    MEDIA_CLASSES,
    isLegacyOrigin,
    isMediaClass,
    withoutStamp,
    type LegacyOrigin,
    type MediaClass,
} from "./media-legacy.ts";

/**
 * Legacys Medien-Manifest lesen und auf Brauchbarkeit prüfen (Export E5, Legacy-Commit `024e3af3d`: A `GET /api/app/media-export.php`,
 * öffentlich, B `GET /api/edit/migration/media-export.php`, nur Admin; WI-0063 MEDIA-M8, Vertrag `media.yaml`).
 *
 * Beide Antworten haben dieselbe Form (`ok`, `map_revision`, `media_revision`, `switches`, `counts`, `items`); B trägt je Eintrag
 * zusätzlich die privaten Felder und die Blöcke `game_literature` und `citymaps` (E5+, eigene Folgearbeit). A enthält NUR, was
 * Legacy heute jedem zeigt: nichts Unterdrücktes, nichts Nichtöffentliches, keine Notiz, keinen Urheber, keinen Stempel.
 *
 * 🔴 Eine unbrauchbare Antwort (`ok` nicht wahr, keine Liste, leere Liste, Zähler weicht von der Liste ab) schreibt nichts: der
 * Import würde sonst jede vorhandene Bindung als „fehlt im Manifest“ zurückziehen (media.yaml `abbruch`). Wie bei Literatur und
 * Kartensammlung ist das ein Befund und kein Tor (Betreiber 2026-10-03: nur vom Betreiber definierte Prüfungen halten an).
 */

export type ManifestKind = "public" | "private";

export interface ManifestItem {
    /** Legacys Identität: `<art>:<subjekt>:[…:]<gespeicherte URL>`; eine Unterdrückung ohne Datei endet auf `:none`. */
    key: string;
    mediaClass: MediaClass;
    subjectPublicId: string;
    sortOrder: number;
    /** Die Datei in Legacys Speicher (`/uploads/…`, ohne `?v=`), oder `null`, wenn Legacy nur eine fremde Adresse kennt. */
    localUrl: string | null;
    origin: LegacyOrigin | null;
    /** Der rohe Rechtecode, `null` bei leerem oder fehlendem Wert. */
    rightsCode: string | null;
    /** Legacys eigenes Tor: Evidenz, keine Freigabe. */
    legacyPublic: boolean;
    suppressed: boolean;
    // ---- nur Export B (sonst `null`) ----
    storedUrl: string | null;
    sourceUrl: string | null;
    legacySource: string | null;
    licenseText: string | null;
    author: string | null;
    attribution: string | null;
    note: string | null;
    uploadedBy: string | null;
    uploadedAt: string | null;
    /** Zeigt Legacy das Bild heute (Tor UND Schalter UND Objekt öffentlich)? `null` in Export A. */
    shown: boolean | null;
    legacyForm: "string" | "object" | null;
    overrideKeys: string[] | null;
}

export interface MediaManifest {
    kind: ManifestKind;
    mediaRevision: string;
    mapRevision: number | null;
    items: ManifestItem[];
    /** Die Zahl je Klasse, die Legacy nennt (`counts.by_class`), zum Vergleich mit der Liste. */
    declaredByClass: Record<string, number>;
}

export interface ManifestParse {
    manifest: MediaManifest | null;
    findings: Finding[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Der Anfang des Schlüssels je Klasse (`legacy_media_key`-Formen, media.yaml `identitaet`), ohne die Kennung des Fachobjekts. */
const KEY_PREFIX: Readonly<Record<MediaClass, string>> = {
    settlement_image: "settlement-image:",
    settlement_coat: "settlement-coat:",
    territory_coat: "territory-coat:",
    citymap_full: "citymap:",
    citymap_preview: "citymap:",
    literature_cover: "adventure:",
};

/** Was nach der Kennung des Fachobjekts folgt, wo die Form es festlegt (Karte: Rolle, Werk: `cover`). */
const KEY_AFTER_SUBJECT: Readonly<Record<MediaClass, string>> = {
    settlement_image: "",
    settlement_coat: "",
    territory_coat: "",
    citymap_full: "full:",
    citymap_preview: "preview:",
    literature_cover: "cover:",
};

const keyMatches = (key: string, mediaClass: MediaClass, subject: string): boolean =>
    key.startsWith(`${KEY_PREFIX[mediaClass]}${subject}:${KEY_AFTER_SUBJECT[mediaClass]}`);

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** `''` und `null` werden `null`, sonst der getrimmte Text (wie Legacys `avesmapsMedienExportText`). */
function text(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

const skipped = (code: string, message: string, numbers: Record<string, number | string> = {}): ManifestParse => ({
    manifest: null,
    findings: [createFinding(code, message, numbers)],
});

/** Ein lokaler Pfad in Legacys Speicher: `/uploads/…`, ohne `?v=`, ohne `..`, ohne Rückwärtsstrich. Sonst `null`. */
export function legacyLocalPath(value: unknown): string | null {
    const raw = text(value);
    if (raw === null) return null;
    const path = withoutStamp(raw);
    if (!path.startsWith("/uploads/") || path.includes("..") || path.includes("\\") || /[?#]/.test(path)) return null;
    return path;
}

export function parseMediaManifest(payload: unknown): ManifestParse {
    const root = asRecord(payload);
    if (root === null)
        return skipped("source_block_missing", "Das Medien-Manifest ist kein JSON-Objekt; nichts geschrieben");
    if (root["ok"] !== true) {
        return skipped(
            "source_block_missing",
            "Das Medien-Manifest meldet ok nicht als wahr; nichts geschrieben, nichts stillgelegt",
        );
    }
    const rawItems = root["items"];
    if (!Array.isArray(rawItems)) {
        return skipped("source_block_missing", "Das Medien-Manifest hat keine Liste `items`; nichts geschrieben");
    }
    if (rawItems.length === 0) {
        return skipped(
            "source_empty_catalog",
            "Das Medien-Manifest ist leer; nichts geschrieben und nichts zurückgezogen (eine leere Liste ist ein Ausfall, kein Bestand)",
        );
    }
    const counts = asRecord(root["counts"]);
    const declaredTotal = counts?.["items"];
    if (typeof declaredTotal !== "number" || declaredTotal !== rawItems.length) {
        return skipped(
            "source_count_mismatch",
            `Das Medien-Manifest nennt ${typeof declaredTotal === "number" ? String(declaredTotal) : "keine"} Einträge, die Liste hat ${String(rawItems.length)}; nichts geschrieben (Antwort unvollständig oder beschädigt)`,
            { gemeldet: typeof declaredTotal === "number" ? declaredTotal : -1, geliefert: rawItems.length },
        );
    }

    const kind: ManifestKind =
        Array.isArray(root["game_literature"]) && Array.isArray(root["citymaps"]) ? "private" : "public";
    const findings: Finding[] = [];
    const items: ManifestItem[] = [];
    const seen = new Set<string>();
    const dropped = {
        unknownClass: [] as FindingObject[],
        badSubject: [] as FindingObject[],
        duplicate: [] as FindingObject[],
        keyMismatch: [] as FindingObject[],
        shape: [] as FindingObject[],
        noKey: 0,
    };
    const objectOf = (key: string, subject: string): FindingObject => ({
        table: "media_asset",
        publicId: subject,
        name: key,
    });

    for (const raw of rawItems) {
        const record = asRecord(raw);
        const key = text(record?.["legacy_media_key"]);
        if (record === null || key === null) {
            dropped.noKey += 1;
            continue;
        }
        const subject = text(record["subject_public_id"])?.toLowerCase() ?? "";
        const mediaClass = record["media_class"];
        if (!isMediaClass(mediaClass)) {
            dropped.unknownClass.push(objectOf(key, subject));
            continue;
        }
        if (!UUID.test(subject)) {
            dropped.badSubject.push(objectOf(key, subject));
            continue;
        }
        if (!keyMatches(key, mediaClass, subject)) {
            dropped.keyMismatch.push(objectOf(key, subject));
            continue;
        }
        if (seen.has(key)) {
            dropped.duplicate.push(objectOf(key, subject));
            continue;
        }
        seen.add(key);

        const expected = LEGACY_SHAPE[mediaClass];
        if (record["subject_kind"] !== expected.subjectKind || record["role"] !== expected.role) {
            dropped.shape.push(objectOf(key, subject));
        }
        const rawOrigin = text(record["origin"]);
        const sortOrder =
            typeof record["sort_order"] === "number" && Number.isInteger(record["sort_order"])
                ? record["sort_order"]
                : 0;
        const form = record["legacy_form"];
        const overrideKeys = record["override_keys"];
        const shown = record["shown"];
        items.push({
            key,
            mediaClass,
            subjectPublicId: subject,
            sortOrder,
            localUrl: legacyLocalPath(record["local_url"]),
            origin: isLegacyOrigin(rawOrigin) ? rawOrigin : null,
            rightsCode: text(record["legacy_rights_code"]),
            legacyPublic: record["legacy_public"] === true,
            suppressed: record["suppressed"] === true,
            storedUrl: text(record["stored_url"]),
            sourceUrl: text(record["source_url"]),
            legacySource: text(record["legacy_source"]),
            licenseText: text(record["license_text"]),
            author: text(record["author"]),
            attribution: text(record["attribution"]),
            note: text(record["note"]),
            uploadedBy: text(record["uploaded_by"]),
            uploadedAt: text(record["uploaded_at"]),
            shown: typeof shown === "boolean" ? shown : null,
            legacyForm: form === "string" || form === "object" ? form : null,
            overrideKeys: Array.isArray(overrideKeys)
                ? overrideKeys.filter((entry): entry is string => typeof entry === "string")
                : null,
        });
    }

    const report = (code: string, message: string, objects: FindingObject[]): void => {
        if (objects.length > 0) findings.push(createFinding(code, message, { eintraege: objects.length }, objects));
    };
    report("unknown_media_class", "Einträge mit unbekannter Klasse; nicht übernommen", dropped.unknownClass);
    report(
        "bad_subject_id",
        "Einträge ohne gültige Kennung des Fachobjekts (keine UUID); nicht übernommen",
        dropped.badSubject,
    );
    report(
        "key_class_mismatch",
        "Einträge, deren Schlüssel nicht zu Klasse und Fachobjekt passt; nicht übernommen (die Identität wäre unsicher)",
        dropped.keyMismatch,
    );
    report(
        "duplicate_media_key",
        "Einträge mit einem Schlüssel, der schon vorkam; nur der erste zählt",
        dropped.duplicate,
    );
    report(
        "manifest_shape",
        "Einträge, deren Fachobjektart oder Rollenwert nicht der Form des Vertrags entspricht (übernommen, die Rolle folgt der Klasse)",
        dropped.shape,
    );
    if (dropped.noKey > 0) {
        findings.push(
            createFinding(
                "item_without_key",
                `${String(dropped.noKey)} Einträge ohne legacy_media_key; nicht übernommen`,
                { eintraege: dropped.noKey },
            ),
        );
    }

    // Der Zähler je Klasse: Legacy nennt ihn, die Liste muss ihn erreichen (Abweichung ist ein Befund, die Liste gewinnt).
    const declaredByClass: Record<string, number> = {};
    const byClass = asRecord(counts?.["by_class"]);
    if (byClass !== null) {
        for (const [name, value] of Object.entries(byClass))
            if (typeof value === "number") declaredByClass[name] = value;
        const actual: Record<string, number> = {};
        for (const item of rawItems) {
            const cls = asRecord(item)?.["media_class"];
            if (typeof cls === "string") actual[cls] = (actual[cls] ?? 0) + 1;
        }
        const differing = MEDIA_CLASSES.filter((cls) => (declaredByClass[cls] ?? 0) !== (actual[cls] ?? 0));
        if (differing.length > 0) {
            findings.push(
                createFinding(
                    "source_class_count_mismatch",
                    `Legacys Zähler je Klasse weicht von der Liste ab: ${differing.map((cls) => `${cls} ${String(declaredByClass[cls] ?? 0)} gemeldet, ${String(actual[cls] ?? 0)} geliefert`).join("; ")}`,
                    Object.fromEntries(
                        differing.map((cls) => [
                            cls,
                            `${String(declaredByClass[cls] ?? 0)}/${String(actual[cls] ?? 0)}`,
                        ]),
                    ),
                ),
            );
        }
    }

    return {
        manifest: {
            kind,
            mediaRevision: text(root["media_revision"]) ?? "",
            mapRevision: typeof root["map_revision"] === "number" ? root["map_revision"] : null,
            items,
            declaredByClass,
        },
        findings,
    };
}
