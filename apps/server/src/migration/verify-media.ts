import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { settleChecks } from "../blocking-checks.ts";
import type { Database } from "../database.ts";
import type { Finding } from "../findings.ts";
import type { MediaPublicView } from "@avesmaps3d/shared";
import { quarantaeneAktiv } from "../media/quarantine.ts";
import { resolvePlaceMedia, resolvePlaceMediaParts, resolveTerritoryMedia } from "../media/resolver.ts";
import { inhaltsstandFuer, schalterVon } from "../system/inhaltsstand.ts";
import type {
    ClearanceState,
    CreationMethod,
    ModerationState,
    PublicationRuleFacts,
    RightsBasis,
    TechnicalState,
} from "../media/policy.ts";
import { readPublicationRules } from "../media/rules.ts";
import { MediaStorageError, instagramWebpKey, quarantineKey, sha256Of, type MediaStore } from "../media/storage.ts";
import { comparePublicToPrivate, planMedia, type MediaPlan, type PlannedAsset } from "./media-plan.ts";
import { readSubjectIndex } from "./media-import.ts";
import { CLASS_ROLE, MEDIA_CLASSES, MEDIA_SOURCE_SYSTEM, type LegacyOrigin, type MediaClass } from "./media-legacy.ts";
import { parseMediaManifest } from "./media-manifest.ts";
import { assetPublishes, readUsages, type UsageRow } from "./media-publication.ts";
import { PUBLICATION_RULE_SEEDS, ruleKeyLabel, ruleSeedStates } from "./media-rules.ts";
import { compareTerritoryCoats } from "./media-territory-coat.ts";
import { check, count, forbiddenColumns, type ParityCheck } from "./verify-catalog.ts";

/**
 * Parität der Medien: Manifest <-> Tafeln <-> Dateien (WI-0063 MEDIA-M8 bis M10, Vertrag `media.yaml` → `verifier`).
 *
 * Geprüft wird das AGGREGAT gegen dasselbe Manifest, aus dem importiert wurde: Anzahl je Klasse, jedes Asset und seine Rechte (neu aus
 * dem Manifest gerechnet), Galerien in Legacys Reihenfolge, Bindungen, Unterdrückungen. Dazu, ohne das Manifest zu brauchen: die
 * Rechte unabhängig mit SQL nachgerechnet (kein `cc_by` mit Schlüssel, `permission_granted` nie als Lizenz), jede Datei mit passender
 * SHA-256 (mit `store`), keine öffentliche Datei ohne einen Weg durch die Veröffentlichungsentscheidung, kein SVG, kein absoluter
 * Pfad, nichts Internes in einer öffentlichen Antwort des Resolvers, und dass der Resolver genau das liefert, was die Policy erlaubt.
 *
 * 🔴 Nichts hier hält einen Lauf an (Betreiber 2026-10-03): jede Prüfung meldet, `BLOCKING_CHECKS` ist leer. Nur lesend.
 *
 * 🔴 Gelesen werden nur `published/` und die Schlüssel, die eine Zeile der MAM nennt (`private/quarantine/` für die Quarantäne). `private/kanal/`
 * gehört dem Betreiber-Kanal (KANAL-0001 §6.3 M3): keine Prüfung hier meldet dort etwas, keine löscht dort etwas.
 */

export interface VerifyMediaOptions {
    /** Das öffentliche Manifest (A), wenn zusätzlich zu B eines vorliegt. */
    publicPayload?: unknown;
    /** Die Gebietsdatei (E4, `legacy-political-territories.json`): dann auch der Abgleich des Wappenzustands mit dem Manifest. */
    territoriesPayload?: unknown;
    /** Die Medienwurzel: ohne sie entfallen die Prüfungen der Dateien auf der Platte. */
    store?: MediaStore | undefined;
    /** Jede Datei erneut hashen (Vorgabe) oder nur Dasein und Größe prüfen. */
    hash?: boolean | undefined;
    /** Die Resolver, deren Antworten geprüft werden: im Betrieb die echten, in Tests ein Doppelgänger, der absichtlich etwas ausliefert. */
    resolvers?: Resolvers | undefined;
}

export interface Resolvers {
    place(database: Database, publicId: string): Promise<MediaPublicView[]>;
    territory(database: Database, publicId: string): Promise<MediaPublicView[]>;
    /**
     * Die Typbilder, die ein Ort nach dem Bildbezug 2B zurückhält, weil er eine Ortsansicht ausliefert (Betreiber 2026-10-11): erlaubt,
     * aber bewusst nicht geliefert. Fehlt die Funktion (ein Doppelgänger im Test), hält kein Ort etwas zurück.
     */
    placeWithheld?(database: Database, publicId: string): Promise<string[]>;
}

const REAL_RESOLVERS: Resolvers = {
    place: resolvePlaceMedia,
    territory: resolveTerritoryMedia,
    placeWithheld: async (database, publicId) =>
        (await resolvePlaceMediaParts(database, publicId)).withheld.map((view) => view.id),
};

export interface ClassSummary {
    assets: number;
    /** Öffentlich: die Policy erlaubt es, und die veröffentlichte Datei ist da. */
    public: number;
    /** Technisch in Ordnung, aber nicht öffentlich (Rechte, Regel, Einzelsperre), mit dem Grund. */
    private: number;
    /** Abgewiesen oder ohne Datei: `decode_failed`, `unsupported_format`, `missing_file`. */
    rejected: number;
    /** Metadaten da, Bytes noch nicht (`pending`). */
    pending: number;
    reasons: Record<string, number>;
}

export interface MediaParityReport {
    passed: boolean;
    /** Das Manifest war unbrauchbar: nur die Prüfungen ohne Manifest liefen. */
    manifestSkipped: boolean;
    checks: ParityCheck[];
    findings: Finding[];
    summary: Record<MediaClass, ClassSummary>;
}

interface DbAsset {
    id: string;
    publicId: string;
    key: string;
    technicalState: TechnicalState;
    moderationState: ModerationState;
    degradedOriginal: boolean;
    origin: string;
    creationMethod: CreationMethod;
    uploadedAt: string | null;
    mediaClass: MediaClass;
    legacyOrigin: LegacyOrigin | null;
    legacyRightsCode: string | null;
    basis: RightsBasis | null;
    licenseKey: string | null;
    licenseFamily: string | null;
    clearance: ClearanceState | null;
    reviewed: boolean;
    requiresAttribution: boolean | null;
    actor: string | null;
    noteRaw: string | null;
    rightsNote: string | null;
}

interface DbFile {
    id: string;
    assetId: string;
    variant: string;
    storageClass: string;
    storageKey: string;
    mimeType: string;
    byteSize: string;
    sha256: string;
}

const PRIVATE_LIMIT = 256 * 1024 * 1024;

const emptySummary = (): ClassSummary => ({ assets: 0, public: 0, private: 0, rejected: 0, pending: 0, reasons: {} });

const label = (asset: { key: string }): string => asset.key;

/** Alle Dateien unter `published/` (relativ zur Wurzel), um solche ohne Zeile zu finden. */
async function listPublished(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (relative: string): Promise<void> => {
        let entries;
        try {
            entries = await readdir(join(root, relative), { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        for (const entry of entries) {
            const next = `${relative}/${entry.name}`;
            if (entry.isDirectory()) await walk(next);
            else found.push(next);
        }
    };
    await walk("published");
    return found;
}

/**
 * Die Dateien unter `published/`, die keine Zeile hält. Eine Instagram-Fassung (`<hash>.ig.jpg`, WI-0268 C12b) hat keine Zeile und ist erlaubt - solange ihre WebP daneben liegt UND eine Zeile sie hält. Ohne die WebP
 * (in Quarantäne, gelöscht, nie da) ist sie eine Waise: Sie bliebe öffentlich länger als ihre WebP und ist ein Befund.
 */
export function unreferencedPublished(onDisk: readonly string[], referenced: ReadonlySet<string>): string[] {
    const present = new Set(onDisk);
    return onDisk.filter((key) => {
        if (referenced.has(key)) return false;
        const webp = instagramWebpKey(key);
        return webp === undefined || !(referenced.has(webp) && present.has(webp));
    });
}

export async function verifyMedia(
    database: Database,
    payload: unknown,
    options: VerifyMediaOptions = {},
): Promise<MediaParityReport> {
    const checks: ParityCheck[] = [];
    const findings: Finding[] = [];
    const summary = Object.fromEntries(MEDIA_CLASSES.map((name) => [name, emptySummary()])) as Record<
        MediaClass,
        ClassSummary
    >;

    const dbAssets = await database<DbAsset[]>`
        SELECT a.id::text AS id, a.public_id::text AS "publicId", a.source_ref AS key, a.technical_state AS "technicalState",
               a.moderation_state AS "moderationState", a.degraded_original AS "degradedOriginal", a.origin,
               a.creation_method AS "creationMethod",
               to_char(a.legacy_uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "uploadedAt",
               s.media_class AS "mediaClass", s.legacy_origin AS "legacyOrigin",
               r.legacy_rights_code AS "legacyRightsCode", r.rights_basis AS basis, r.license_key AS "licenseKey",
               r.license_family AS "licenseFamily", r.clearance_state AS clearance,
               coalesce(r.reviewed_at IS NOT NULL OR r.clearance_state IN ('cleared', 'rejected'), FALSE) AS reviewed,
               l.requires_attribution AS "requiresAttribution",
               a.ingest_actor_legacy AS actor, c.legacy_note_raw AS "noteRaw", r.rights_note AS "rightsNote"
        FROM media_asset a
        JOIN media_legacy_source s ON s.media_asset_id = a.id
        LEFT JOIN media_rights r ON r.media_asset_id = a.id
        LEFT JOIN license_catalog l ON l.key = r.license_key
        LEFT JOIN media_creation c ON c.media_asset_id = a.id
        WHERE a.source_system = ${MEDIA_SOURCE_SYSTEM}
        ORDER BY a.id
    `;
    const assetByKey = new Map(dbAssets.map((asset) => [asset.key, asset]));
    const assetById = new Map(dbAssets.map((asset) => [asset.id, asset]));
    const dbFiles = await database<DbFile[]>`
        SELECT f.id::text AS id, f.media_asset_id::text AS "assetId", f.variant, f.storage_class AS "storageClass",
               f.storage_key AS "storageKey", f.mime_type AS "mimeType", f.byte_size::text AS "byteSize", f.sha256
        FROM media_file f ORDER BY f.id
    `;
    const filesByAsset = new Map<string, DbFile[]>();
    for (const file of dbFiles) filesByAsset.set(file.assetId, [...(filesByAsset.get(file.assetId) ?? []), file]);
    const rules = await readPublicationRules(database);
    const usages = await readUsages(database);
    const usagesByAsset = new Map<string, UsageRow[]>();
    for (const usage of usages) usagesByAsset.set(usage.assetId, [...(usagesByAsset.get(usage.assetId) ?? []), usage]);

    // ---- Manifest <-> Tafeln -------------------------------------------------------------------------------------------------------
    let plan: MediaPlan | null = null;
    let manifestSkipped = false;
    if (payload !== undefined) {
        const parsed = parseMediaManifest(payload);
        findings.push(...parsed.findings);
        if (parsed.manifest === null) {
            manifestSkipped = true;
        } else {
            plan = planMedia(parsed.manifest, await readSubjectIndex(database));
            if (options.publicPayload !== undefined && parsed.manifest.kind === "private") {
                const publicParsed = parseMediaManifest(options.publicPayload);
                if (publicParsed.manifest !== null) {
                    const drift = comparePublicToPrivate(publicParsed.manifest, parsed.manifest);
                    if (drift !== null) findings.push(drift);
                }
            }
        }
    }

    if (plan !== null) {
        const planned: PlannedAsset[] = plan.assets;
        const exact = plan.kind === "private";

        // Anzahl je Klasse: das Manifest nennt sie, die Tafel führt sie (nur Legacy-Assets).
        const wantByClass = new Map<MediaClass, number>(MEDIA_CLASSES.map((name) => [name, plan.byClass[name].assets]));
        const haveByClass = new Map<MediaClass, number>(MEDIA_CLASSES.map((name) => [name, 0]));
        for (const asset of dbAssets) haveByClass.set(asset.mediaClass, (haveByClass.get(asset.mediaClass) ?? 0) + 1);
        const countOffenders = MEDIA_CLASSES.filter((name) =>
            exact
                ? haveByClass.get(name) !== wantByClass.get(name)
                : (haveByClass.get(name) ?? 0) < (wantByClass.get(name) ?? 0),
        ).map((name) => `${name}: ${String(haveByClass.get(name))} Assets, Manifest ${String(wantByClass.get(name))}`);
        checks.push(
            check(
                "counts",
                countOffenders.length === 0,
                `Assets je Klasse ${MEDIA_CLASSES.map((name) => `${name} ${String(haveByClass.get(name))}/${String(wantByClass.get(name))}`).join(", ")} (Tafel/Manifest${exact ? "" : ", öffentliches Manifest: mindestens"}); Fachobjekt unbekannt: ${MEDIA_CLASSES.map((name) => `${name} ${String(plan?.byClass[name].orphans)}`).join(", ")}`,
                countOffenders,
            ),
        );

        const missingAssets = planned
            .filter((asset) => !assetByKey.has(asset.key))
            .map((asset) => `${label(asset)} fehlt`);
        checks.push(
            check(
                "assets_present",
                missingAssets.length === 0,
                `${String(planned.length)} Assets des Manifests in der Tafel`,
                missingAssets,
            ),
        );

        // Rechte, Entstehung, Herkunft, Stempel und „Kein Original“: Zeile für Zeile gegen den neu gerechneten Plan.
        const rightsOffenders: string[] = [];
        const degradedOffenders: string[] = [];
        const stampOffenders: string[] = [];
        for (const want of planned) {
            const have = assetByKey.get(want.key);
            if (have === undefined) continue;
            if (!have.reviewed) {
                const wrong: string[] = [];
                if (have.basis !== want.rights.basis)
                    wrong.push(`Basis ${String(have.basis)} statt ${want.rights.basis}`);
                if (have.clearance !== want.rights.clearance)
                    wrong.push(`Clearance ${String(have.clearance)} statt ${want.rights.clearance}`);
                if ((have.licenseKey ?? null) !== want.rights.licenseKey) wrong.push("Lizenzschlüssel");
                if ((have.licenseFamily ?? null) !== want.rights.licenseFamily) wrong.push("Lizenzfamilie");
                if ((have.legacyRightsCode ?? null) !== want.rights.legacyRightsCode) wrong.push("Legacy-Code");
                if (have.creationMethod !== want.creationMethod)
                    wrong.push(`Entstehung ${have.creationMethod} statt ${want.creationMethod}`);
                if (wrong.length > 0) rightsOffenders.push(`${label(want)}: ${wrong.join(", ")}`);
            }
            if (have.origin !== want.origin)
                rightsOffenders.push(`${label(want)}: Herkunft ${have.origin} statt ${want.origin}`);
            if (have.degradedOriginal !== want.degradedOriginal)
                degradedOffenders.push(
                    `${label(want)}: degraded_original ${String(have.degradedOriginal)} statt ${String(want.degradedOriginal)}`,
                );
            if (want.legacyUploadedAt !== null && have.uploadedAt !== want.legacyUploadedAt) {
                stampOffenders.push(
                    `${label(want)}: Stempel ${String(have.uploadedAt)} statt ${want.legacyUploadedAt}`,
                );
            }
        }
        checks.push(
            check(
                "rights",
                rightsOffenders.length === 0,
                `Rechtsbasis, Lizenzschlüssel, Clearance, Entstehung und Herkunft von ${String(planned.length)} Assets gegen das neu gerechnete Manifest`,
                rightsOffenders,
            ),
        );
        checks.push(
            check(
                "degraded_original",
                degradedOffenders.length === 0,
                "„Kein Original vorhanden“ nach der Regel je Klasse und Herkunft",
                degradedOffenders,
            ),
        );
        // Der Stempel wird einmal übernommen und nie neu geschrieben: eine Abweichung ist dann eine echte Änderung in Legacy.
        checks.push(
            check(
                "stamps",
                stampOffenders.length === 0,
                "Hochladestempel gleich dem Manifest (einmal übernommen, nie neu geschrieben)",
                stampOffenders,
            ),
        );

        // Galerien, Bindungen, Unterdrückungen.
        const subject = await readSubjectIndex(database);
        const bindingOffenders: string[] = [];
        const spec = [
            { table: "place_media", column: "place_id", kind: "place" },
            { table: "territory_media", column: "territory_id", kind: "territory" },
            { table: "adventure_media", column: "adventure_id", kind: "adventure" },
            { table: "citymap_media", column: "citymap_id", kind: "citymap" },
        ] as const;
        for (const table of spec) {
            const rows = await database.unsafe<{ subject: string; assetId: string; role: string }[]>(
                `SELECT ${table.column}::text AS subject, media_asset_id::text AS "assetId", role FROM ${table.table} WHERE retired_at IS NULL`,
            );
            const active = new Map(rows.map((row) => [`${row.subject}|${row.role}`, row.assetId]));
            for (const want of plan.bindings.filter((binding) => binding.subjectKind === table.kind)) {
                const owner = subject[table.kind].get(want.subjectPublicId);
                const have = owner === undefined ? undefined : active.get(`${owner.id}|${want.role}`);
                const asset = assetByKey.get(want.key);
                if (asset === undefined || have !== asset.id)
                    bindingOffenders.push(
                        `${table.table} ${owner?.name ?? want.subjectPublicId} (${want.role}): ${want.key} ist nicht die aktive Bindung`,
                    );
            }
        }
        checks.push(
            check(
                "bindings",
                bindingOffenders.length === 0,
                `${String(plan.bindings.length)} direkte Bindungen (Wappen, Titelbilder mit einem Bild, Cover, Karten) aktiv wie im Manifest`,
                bindingOffenders,
            ),
        );

        const galleryOffenders: string[] = [];
        const galleryRows = await database<{ ref: string; key: string; sortOrder: number }[]>`
            SELECT g.source_ref AS ref, a.source_ref AS key, i.sort_order AS "sortOrder"
            FROM media_gallery g
            JOIN place_media_gallery b ON b.media_gallery_id = g.id AND b.retired_at IS NULL AND b.role = 'header'
            JOIN media_gallery_item i ON i.gallery_id = g.id AND i.retired_at IS NULL
            JOIN media_asset a ON a.id = i.media_asset_id
            WHERE g.source_system = ${MEDIA_SOURCE_SYSTEM}
            ORDER BY g.source_ref, i.sort_order
        `;
        const dbOrder = new Map<string, string[]>();
        for (const row of galleryRows) dbOrder.set(row.ref, [...(dbOrder.get(row.ref) ?? []), row.key]);
        let galleryItems = 0;
        for (const gallery of plan.galleries) {
            galleryItems += gallery.items.length;
            const wanted = gallery.items.map((item) => item.key);
            const wantedSet = new Set(wanted);
            // Mit dem öffentlichen Manifest zählen nur die genannten Bilder (die übrigen kennt es nicht), mit B alle.
            const have = (dbOrder.get(gallery.ref) ?? []).filter((key) => exact || wantedSet.has(key));
            if (have.join("\n") !== wanted.join("\n"))
                galleryOffenders.push(
                    `${gallery.ref}: ${have.length} Bilder in der Tafel, ${wanted.length} im Manifest oder andere Reihenfolge`,
                );
        }
        checks.push(
            check(
                "galleries",
                galleryOffenders.length === 0,
                `${String(plan.galleries.length)} Galerien mit ${String(galleryItems)} Einträgen in Legacys Reihenfolge`,
                galleryOffenders,
            ),
        );

        const suppressionOffenders: string[] = [];
        for (const want of plan.suppressions) {
            const owner = subject[want.subjectKind].get(want.subjectPublicId);
            const table = want.subjectKind === "place" ? "place_media_suppression" : "territory_media_suppression";
            const column = want.subjectKind === "place" ? "place_id" : "territory_id";
            const present =
                owner === undefined
                    ? 0
                    : await count(
                          database,
                          `SELECT count(*) FROM ${table} WHERE ${column} = ${owner.id} AND role = '${want.role}'`,
                      );
            if (present !== 1)
                suppressionOffenders.push(
                    `${want.subjectKind} ${owner?.name ?? want.subjectPublicId}: Unterdrückung fehlt`,
                );
        }
        checks.push(
            check(
                "suppressions",
                suppressionOffenders.length === 0,
                `${String(plan.suppressions.length)} Unterdrückungen (coat_none, leerer Gebiets-Override) als eigene Zeilen`,
                suppressionOffenders,
            ),
        );

        // E4 und E5 sagen dasselbe über das Wappen eines Gebiets (der Gebietsimport rechnet es durch, dieser Import schreibt es).
        if (options.territoriesPayload !== undefined && plan.kind === "private") {
            const agreement = compareTerritoryCoats(plan, options.territoriesPayload);
            checks.push(
                check(
                    "territory_coat_agreement",
                    agreement.disagreements.length === 0,
                    `Wappenzustand von ${String(agreement.compared)} Gebieten: E4 und E5 stimmen bei ${String(agreement.agreed)} überein`,
                    agreement.disagreements,
                ),
            );
        }
    }

    // ---- Struktur und Rechte, unabhängig mit SQL nachgerechnet (ohne das Manifest) ---------------------------------------------------
    const forbidden = await forbiddenColumns(database, [
        "media_legacy_source",
        "media_gallery",
        "media_gallery_item",
        "place_media_gallery",
        "place_media",
        "territory_media",
        "adventure_media",
        "citymap_media",
        "place_media_suppression",
        "territory_media_suppression",
        "media_file",
        "media_rights",
    ]);
    checks.push(
        check(
            "structure",
            forbidden.length === 0,
            "kein entity_type und keine JSON-Spalte an den Medientabellen",
            forbidden.map((row) => `${row.table_name}.${row.column_name}`),
        ),
    );

    const orphanAssets = dbAssets
        .filter((asset) => (usagesByAsset.get(asset.id) ?? []).length === 0)
        .map((asset) => `${asset.key} hat keine Nutzung`);
    const [emptyGalleries] = await database<{ n: number }[]>`
        SELECT count(*)::int AS n FROM media_gallery g
        WHERE g.source_system = ${MEDIA_SOURCE_SYSTEM} AND NOT EXISTS (SELECT 1 FROM media_gallery_item i WHERE i.gallery_id = g.id)
    `;
    checks.push(
        check(
            "orphans",
            orphanAssets.length === 0 && (emptyGalleries?.n ?? 0) === 0,
            `${String(orphanAssets.length)} Assets ohne Bindung oder Galerieeintrag, ${String(emptyGalleries?.n ?? 0)} Galerien ohne Einträge`,
            orphanAssets,
        ),
    );

    // EIN Titelbild ODER EINE Galerie (WI-0219; Betreiber 2026-10-17 „A, über den Zug“): Ein Ort mit genau einem Bild trägt es als
    // Titelbild (Bindung der Rolle header), ab zwei Bildern als Galerie, nie beides zugleich.
    const beides = await database<{ name: string | null; public_id: string }[]>`
        SELECT p.name, p.public_id::text AS public_id FROM place p
         WHERE EXISTS (SELECT 1 FROM place_media m WHERE m.place_id = p.id AND m.role = 'header' AND m.retired_at IS NULL)
           AND EXISTS (SELECT 1 FROM place_media_gallery g WHERE g.place_id = p.id AND g.role = 'header' AND g.retired_at IS NULL)
         ORDER BY p.name
    `;
    checks.push(
        check(
            "header_or_gallery",
            beides.length === 0,
            "Ein Ort hat EIN Titelbild ODER EINE Galerie, nie beides",
            beides.map((row) => `${row.name ?? row.public_id} hat Titelbild und Galerie`),
        ),
    );

    // Unabhängig vom Importcode: was jeder Legacy-Code im Ziel NIE sein darf.
    const rightOffenders: string[] = [];
    for (const asset of dbAssets) {
        if (asset.reviewed) continue;
        const code = asset.legacyRightsCode;
        if (asset.basis === "license" && asset.licenseKey === null && asset.clearance !== "needs_review") {
            rightOffenders.push(`${asset.key}: Lizenz ohne Schlüssel und ohne needs_review`);
        }
        if (
            code === "cc_by" &&
            (asset.licenseKey !== null || asset.clearance !== "needs_review" || asset.basis !== "license")
        ) {
            rightOffenders.push(`${asset.key}: cc_by mit geratener Version oder ohne needs_review`);
        }
        if (code === "permission_granted" && asset.basis !== "permission" && asset.basis !== "fan_policy") {
            rightOffenders.push(`${asset.key}: permission_granted als ${String(asset.basis)}`);
        }
        if (code === "ai_generated" && (asset.creationMethod !== "ai_generated" || asset.basis !== "own_work")) {
            rightOffenders.push(`${asset.key}: ai_generated ohne Entstehungsart oder mit Lizenz`);
        }
        if (code === "public_domain" && asset.basis !== "public_domain")
            rightOffenders.push(`${asset.key}: public_domain als ${String(asset.basis)}`);
        if ((code === "unknown_other" || code === null) && asset.basis !== "unknown" && asset.basis !== "own_work") {
            rightOffenders.push(`${asset.key}: ohne Einstufung als ${String(asset.basis)}`);
        }
        if (
            asset.basis === "fan_policy" &&
            asset.mediaClass !== "literature_cover" &&
            asset.mediaClass !== "citymap_preview"
        ) {
            rightOffenders.push(`${asset.key}: fan_policy an einer Klasse ohne Fan-Regel`);
        }
        if (asset.basis === "own_work" && code === null && asset.clearance !== "legacy_assumed") {
            rightOffenders.push(`${asset.key}: Vorgabe ohne legacy_assumed`);
        }
    }
    checks.push(
        check(
            "rights_consistent",
            rightOffenders.length === 0,
            "Rechtsbasis, Lizenzschlüssel und Clearance stimmen zu Legacys Code (unabhängig gerechnet)",
            rightOffenders,
        ),
    );

    // Je Regel des Skripts ihr Stand; „ausstehend“ heißt: die Vorgängerin gilt noch, der Wechsel (media:regeln, migrate:media) fehlt.
    const ruleStates = await ruleSeedStates(database, PUBLICATION_RULE_SEEDS);
    const RULE_STATE_TEXT = {
        active: "gilt",
        revoked: "widerrufen",
        held: "nicht angelegt, Vorgängerin widerrufen",
        pending: "ausstehend, Vorgängerin gilt noch",
        missing: "fehlt",
    } as const;
    const missingRules = ruleStates.filter(({ state }) => state === "missing" || state === "pending");
    checks.push(
        check(
            "rules",
            missingRules.length === 0,
            `Freigaberegeln mit Betreiberzitat (G1 = A): ${ruleStates.map(({ seed, state }) => `${ruleKeyLabel(seed)} ${RULE_STATE_TEXT[state]}`).join(", ")}`,
            missingRules.map(({ seed, state }) => `${ruleKeyLabel(seed)} ${RULE_STATE_TEXT[state]}`),
        ),
    );

    // ---- Dateien ----------------------------------------------------------------------------------------------------------------------
    const publishedFiles = dbFiles.filter((file) => file.storageClass === "published" && assetById.has(file.assetId));
    const noDecision: string[] = [];
    for (const file of publishedFiles) {
        const asset = assetById.get(file.assetId);
        if (asset === undefined || (asset.basis === null && asset.clearance === null)) {
            noDecision.push(`${asset?.key ?? file.assetId}: veröffentlichte Datei ohne Rechtezeile`);
            continue;
        }
        const result = assetPublishes(
            {
                technicalState: asset.technicalState,
                moderationState: asset.moderationState,
                creationMethod: asset.creationMethod,
                basis: asset.basis,
                clearance: asset.clearance,
                licenseKey: asset.licenseKey,
                requiresAttribution: asset.requiresAttribution,
            },
            CLASS_ROLE[asset.mediaClass],
            usagesByAsset.get(asset.id) ?? [],
            { mimeType: file.mimeType },
            rules,
        );
        if (!result.allowed)
            noDecision.push(`${asset.key}: veröffentlicht, aber die Policy sagt nein (${result.reasons.join(", ")})`);
    }
    checks.push(
        check(
            "published_decision",
            noDecision.length === 0,
            `${String(publishedFiles.length)} veröffentlichte Dateien, jede mit einem Weg durch die Veröffentlichungsentscheidung`,
            noDecision,
        ),
    );

    const surface: string[] = [];
    for (const file of dbFiles) {
        if (!assetById.has(file.assetId)) continue;
        if (file.storageClass === "published") {
            if (file.mimeType !== "image/webp" || /\.svg$/i.test(file.storageKey))
                surface.push(`${file.storageKey}: kein WebP im öffentlichen Bereich`);
            if (!/^published\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/.test(file.storageKey))
                surface.push(`${file.storageKey}: Schlüssel nicht aus dem Hash abgeleitet`);
        } else if (file.storageKey.startsWith("published/")) {
            surface.push(`${file.storageKey}: private Klasse unter published/`);
        }
        if (file.storageKey.startsWith("/") || file.storageKey.includes("\\") || /^[A-Za-z]:/.test(file.storageKey))
            surface.push(`${file.storageKey}: absoluter Pfad`);
    }
    checks.push(
        check(
            "public_surface",
            surface.length === 0,
            "veröffentlicht ist nur WebP unter published/sha256/…, kein SVG, kein absoluter Pfad",
            surface,
        ),
    );

    // Ohne eine Datei kein `ok`; mit `ok` ein Original; `pending` ist der Stand vor dem Binärimport (Befund, kein Fehler dieser Prüfung).
    const fileOffenders: string[] = [];
    let pending = 0;
    for (const asset of dbAssets) {
        const own = filesByAsset.get(asset.id) ?? [];
        if (asset.technicalState === "pending") pending += 1;
        if (asset.technicalState === "ok" && !own.some((file) => file.storageClass === "private_source"))
            fileOffenders.push(`${asset.key}: ok ohne Original`);
        if (asset.technicalState !== "ok" && own.some((file) => file.storageClass === "published"))
            fileOffenders.push(`${asset.key}: ${asset.technicalState} mit veröffentlichter Datei`);
    }
    checks.push(
        check(
            "files",
            fileOffenders.length === 0,
            `${String(dbAssets.length - pending)} von ${String(dbAssets.length)} Assets mit Dateistand${pending > 0 ? `, ${String(pending)} noch pending (Binärimport nicht gelaufen)` : ""}`,
            fileOffenders,
        ),
    );

    if (options.store !== undefined) {
        const store = options.store;
        const disk: string[] = [];
        let checked = 0;
        // Eine öffentliche Datei in Quarantäne liegt unter private/quarantine/ (WI-0127 SYS-10 b3): dort zählt sie als vorhanden.
        const quarantaene = await quarantaeneAktiv(database);
        for (const file of dbFiles) {
            if (!assetById.has(file.assetId)) continue;
            checked += 1;
            const key =
                file.storageClass === "published" && quarantaene.has(file.sha256)
                    ? quarantineKey(file.sha256)
                    : file.storageKey;
            try {
                const bytes = await store.read(key, PRIVATE_LIMIT);
                if (String(bytes.byteLength) !== file.byteSize)
                    disk.push(`${key}: ${String(bytes.byteLength)} Bytes statt ${file.byteSize}`);
                else if (options.hash !== false && sha256Of(bytes) !== file.sha256)
                    disk.push(`${key}: SHA-256 passt nicht`);
            } catch (error) {
                if (error instanceof MediaStorageError && error.code === "missing") disk.push(`${key}: Datei fehlt`);
                else throw error;
            }
        }
        checks.push(
            check(
                "disk_parity",
                disk.length === 0,
                `${String(checked)} Dateien auf der Platte, Größe${options.hash === false ? "" : " und SHA-256"} gleich der Tafel`,
                disk,
            ),
        );

        const referenced = new Set(
            dbFiles.filter((file) => file.storageClass === "published").map((file) => file.storageKey),
        );
        const strays = unreferencedPublished(await listPublished(store.root), referenced);
        checks.push(
            check(
                "published_unreferenced",
                strays.length === 0,
                `${String(strays.length)} Dateien unter published/ ohne Zeile in der Tafel (eine Instagram-Fassung neben ihrer WebP zählt nicht)`,
                strays,
            ),
        );
    }

    // ---- Bilanz: öffentlich, privat, abgewiesen ---------------------------------------------------------------------------------------
    for (const asset of dbAssets) {
        const bucket = summary[asset.mediaClass];
        bucket.assets += 1;
        const own = filesByAsset.get(asset.id) ?? [];
        if (asset.technicalState === "pending") {
            bucket.pending += 1;
            continue;
        }
        if (asset.technicalState !== "ok") {
            bucket.rejected += 1;
            bucket.reasons[asset.technicalState] = (bucket.reasons[asset.technicalState] ?? 0) + 1;
            continue;
        }
        const published = own.find((file) => file.storageClass === "published");
        const facts = {
            technicalState: asset.technicalState,
            moderationState: asset.moderationState,
            creationMethod: asset.creationMethod,
            basis: asset.basis,
            clearance: asset.clearance,
            licenseKey: asset.licenseKey,
            requiresAttribution: asset.requiresAttribution,
        };
        const role = CLASS_ROLE[asset.mediaClass];
        const assetUsages = usagesByAsset.get(asset.id) ?? [];
        const decision = assetPublishes(
            facts,
            role,
            assetUsages,
            published === undefined ? null : { mimeType: published.mimeType },
            rules,
        );
        if (decision.allowed) {
            bucket.public += 1;
        } else {
            bucket.private += 1;
            // Der Grund der Rechte, nicht der der fehlenden Datei: gefragt wird, als läge das WebP schon da. Erlaubt die Policy es dann,
            // fehlt nur noch der Lauf des Binärimports (`publication_pending`).
            const hypothetical = assetPublishes(facts, role, assetUsages, { mimeType: "image/webp" }, rules, true);
            const reason = hypothetical.allowed ? "publication_pending" : (hypothetical.reasons[0] ?? "unbekannt");
            bucket.reasons[reason] = (bucket.reasons[reason] ?? 0) + 1;
        }
    }

    // ---- Resolver <-> Policy, und nichts Internes in der öffentlichen Antwort -----------------------------------------------------------
    const [resolverCheck, leakCheck] = await verifyResolver(
        database,
        dbAssets,
        filesByAsset,
        usagesByAsset,
        rules,
        options.resolvers ?? REAL_RESOLVERS,
    );
    checks.push(resolverCheck, leakCheck);

    const settled = settleChecks("verify:media", checks);
    return { passed: settled.passed, manifestSkipped, checks: settled.checks, findings, summary };
}

/** Der Resolver liefert genau, was die Policy erlaubt, und in seiner Antwort steht nichts Internes. */
async function verifyResolver(
    database: Database,
    dbAssets: readonly DbAsset[],
    filesByAsset: ReadonlyMap<string, DbFile[]>,
    usagesByAsset: ReadonlyMap<string, UsageRow[]>,
    rules: readonly PublicationRuleFacts[],
    resolvers: Resolvers,
): Promise<[ParityCheck, ParityCheck]> {
    // Nur Orte und Gebiete mit Medien des Legacy-Imports: Medien aus anderer Quelle (Editor, später Community) prüft dieser Prüfer nicht.
    const places = await database<{ id: string; publicId: string }[]>`
        SELECT DISTINCT p.id::text AS id, p.public_id::text AS "publicId"
        FROM place p
        WHERE EXISTS (SELECT 1 FROM place_media m JOIN media_asset a ON a.id = m.media_asset_id
                      WHERE m.place_id = p.id AND a.source_system = ${MEDIA_SOURCE_SYSTEM})
           OR EXISTS (SELECT 1 FROM place_media_gallery g
                      JOIN media_gallery_item i ON i.gallery_id = g.media_gallery_id
                      JOIN media_asset a ON a.id = i.media_asset_id
                      WHERE g.place_id = p.id AND a.source_system = ${MEDIA_SOURCE_SYSTEM})
        ORDER BY 2
    `;
    const territories = await database<{ id: string; publicId: string }[]>`
        SELECT DISTINCT t.id::text AS id, t.public_id::text AS "publicId"
        FROM territory t
        WHERE EXISTS (SELECT 1 FROM territory_media m JOIN media_asset a ON a.id = m.media_asset_id
                      WHERE m.territory_id = t.id AND a.source_system = ${MEDIA_SOURCE_SYSTEM})
        ORDER BY 2
    `;
    // Je Asset und Rolle: was die Policy im wirklichen Zustand erlaubt, mit denselben Inhaltsschaltern wie der Lesepfad (WI-0127 SYS-10).
    const switches = schalterVon(await inhaltsstandFuer(database));
    const allowedAssets = new Set<string>();
    for (const asset of dbAssets) {
        const published = (filesByAsset.get(asset.id) ?? []).find((file) => file.storageClass === "published");
        const decision = assetPublishes(
            {
                technicalState: asset.technicalState,
                moderationState: asset.moderationState,
                creationMethod: asset.creationMethod,
                basis: asset.basis,
                clearance: asset.clearance,
                licenseKey: asset.licenseKey,
                requiresAttribution: asset.requiresAttribution,
                licenseFamily: asset.licenseFamily,
            },
            CLASS_ROLE[asset.mediaClass],
            usagesByAsset.get(asset.id) ?? [],
            published === undefined ? null : { mimeType: published.mimeType },
            rules,
            false,
            switches,
        );
        if (decision.allowed) allowedAssets.add(asset.publicId);
    }
    const assetByPublicId = new Map(dbAssets.map((asset) => [asset.publicId, asset]));
    const notAllowed: string[] = [];
    const leaks: string[] = [];
    const secrets = new Set<string>();
    for (const asset of dbAssets) {
        for (const text of [asset.actor, asset.noteRaw, asset.rightsNote]) {
            if (text !== null && text.trim().length >= 3) secrets.add(text.trim());
        }
    }
    let views = 0;
    // `relation`: der Bildbezug eines Kopfbildes (Betreiber 2026-10-11), öffentlich und ohne Inneres. `ki` und `ohneKi`: die zwei Merker der Entstehung
    // für den Filter „Ohne KI“ (WI-0272, WI-0281), je nur `true`, ohne Werkzeug, Modell oder Prompt.
    const ALLOWED_KEYS = new Set([
        "id",
        "role",
        "url",
        "width",
        "height",
        "mimeType",
        "credit",
        "relation",
        "ki",
        "ohneKi",
    ]);
    const resolved = [
        ...(await Promise.all(
            places.map(async (place) => ({
                kind: "place",
                id: place.publicId,
                list: await resolvers.place(database, place.publicId),
            })),
        )),
        ...(await Promise.all(
            territories.map(async (territory) => ({
                kind: "territory",
                id: territory.publicId,
                list: await resolvers.territory(database, territory.publicId),
            })),
        )),
    ];
    for (const entry of resolved) {
        for (const view of entry.list) {
            // Ein Bild aus anderer Quelle (Editor, Community) gehört nicht zu diesem Prüfer.
            if (!assetByPublicId.has(view.id)) continue;
            views += 1;
            // Nur Freigegebenes: die Sicht gehört zu einem Asset, das die Policy im wirklichen Zustand erlaubt.
            if (!allowedAssets.has(view.id))
                notAllowed.push(
                    `${entry.kind} ${entry.id}: ${assetByPublicId.get(view.id)?.key ?? view.id} ausgeliefert, die Policy sagt nein`,
                );
            const extra = Object.keys(view).filter((key) => !ALLOWED_KEYS.has(key));
            if (extra.length > 0) leaks.push(`${entry.kind} ${entry.id}: Felder ${extra.join(", ")} in der Antwort`);
        }
        const text = JSON.stringify(entry.list);
        for (const secret of secrets)
            if (text.includes(secret))
                leaks.push(`${entry.kind} ${entry.id}: interner Text „${secret.slice(0, 24)}“ in der Antwort`);
        if (/private\/|storage_?key|evidence|prompt|uploaded_by/i.test(text))
            leaks.push(`${entry.kind} ${entry.id}: interner Pfad oder Feldname in der Antwort`);
    }
    // Umgekehrt: Alles, was die Policy erlaubt UND einem Ort oder Gebiet gehört, muss der Resolver auch liefern.
    const delivered = new Set(resolved.flatMap((entry) => entry.list.map((view) => view.id)));
    const onSubject = new Set(
        dbAssets
            .filter(
                (asset) =>
                    asset.mediaClass === "settlement_image" ||
                    asset.mediaClass === "settlement_coat" ||
                    asset.mediaClass === "territory_coat",
            )
            .map((asset) => asset.publicId),
    );
    // Bildbezug 2B (Betreiber 2026-10-11): Ein Ort mit Ortsansicht liefert seine Typbilder bewusst nicht aus. Gefragt nur, wo etwas fehlt.
    const candidates = [...allowedAssets].filter((id) => onSubject.has(id) && !delivered.has(id));
    const withheld = new Set<string>();
    if (candidates.length > 0 && resolvers.placeWithheld !== undefined) {
        for (const place of places) {
            for (const id of await resolvers.placeWithheld(database, place.publicId)) withheld.add(id);
        }
    }
    const missing = candidates
        .filter((id) => !withheld.has(id))
        .map((id) => `${assetByPublicId.get(id)?.key ?? id}: erlaubt, aber vom Resolver nicht geliefert`);
    return [
        check(
            "resolver_parity",
            notAllowed.length === 0 && missing.length === 0,
            `der Resolver lieferte ${String(views)} Medien für ${String(places.length)} Orte und ${String(territories.length)} Gebiete: genau die, die die Policy erlaubt (ohne ${String(withheld.size)} Typbilder, die ein Ort mit Ortsansicht nach 2B zurückhält)`,
            [...notAllowed, ...missing],
        ),
        check(
            "no_leak",
            leaks.length === 0,
            "keine Notiz, kein Login, kein Prompt, kein Speicherpfad und kein weiteres Feld in einer öffentlichen Antwort",
            leaks,
        ),
    ];
}

/** Eine Gesamtzahl für Log und Bericht. */
export function mediaTotals(summary: Record<MediaClass, ClassSummary>): ClassSummary {
    const total = emptySummary();
    for (const bucket of Object.values(summary)) {
        total.assets += bucket.assets;
        total.public += bucket.public;
        total.private += bucket.private;
        total.rejected += bucket.rejected;
        total.pending += bucket.pending;
        for (const [reason, n] of Object.entries(bucket.reasons))
            total.reasons[reason] = (total.reasons[reason] ?? 0) + n;
    }
    return total;
}
