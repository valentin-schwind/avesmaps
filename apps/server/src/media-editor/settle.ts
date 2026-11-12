import { AVENTURIA, MEDIA_ROLES, type DerivedWork, type MediaRole } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import type { ClearanceState, CreationMethod, ModerationState, RightsBasis, TechnicalState } from "../media/policy.ts";
import { RasterRejection } from "../media/raster/inspect.ts";
import { PDF_ROLES, ingestImage, internVariante, type IngestedFile } from "../media/raster/ingest.ts";
import { MAX_SOURCE_BYTES, PDF_LIMITS } from "../media/raster/limits.ts";
import { beifassungen, profileForAsset } from "../media/raster/profiles.ts";
import { recipeVersion } from "../media/raster/render.ts";
import { PUBLISHED_VARIANT, oeffentlicheVarianten } from "../media/roles.ts";
import { GEHALTENE_QUELLBYTES_SQL } from "../media/notaus.ts";
import { readPublicationRules } from "../media/rules.ts";
import { MediaStorageError, sha256Of, type MediaStore } from "../media/storage.ts";
import { assetPublishes, readUsages } from "../migration/media-publication.ts";

/**
 * Der Abgleich der Dateien EINES Assets mit der Entscheidung der Policy für EINE Rolle (WI-0068 P4a): die Jobart `media_settle`.
 * Nach einem Upload prüft und rendert er das private Original (technisch `ok` oder abgewiesen), nach einer Bindung legt er die
 * öffentliche Fassung an, wenn die Policy JA sagt, und nimmt sie weg, wenn sie NEIN sagt. Dieselbe Pipeline wie der Binärimport
 * (`ingestImage`, `migrate:media-files`) und dieselbe Entscheidung (`assetPublishes` → `decidePublication`), keine eigene Liste.
 *
 * 🔴 Im Worker, nie im Fastify-Prozess (Claudio, `handovers/2026-10-04-media-m7-sharp-antwort.md`): Die Operation legt nur Bytes und
 * Zeilen ab und reiht den Job ein (`enqueueSettle`, `derivedWork` in der Quittung). Ebenso „Vorschau erzeugen“ (WI-0287 Punkt 5): Fastify dekodiert dort nichts, die
 * Operation legt Werk, Rechte und Bindung an, die Jobart `citymap_preview_generate` liest die Karte und rechnet das Original der Vorschau
 * (`kartenvorschau-datei.ts`) und reiht danach diesen Abgleich ein. Bis dahin hat die Vorschau kein Original und steht `pending`.
 * 🔴 Reihenfolge wie im Binärimport: erst Bytes, dann die Datenbank (in der Transaktion, die den Job abschließt); eine öffentliche
 * Datei, die keine Zeile mehr hält, fällt danach weg.
 * 🔴 Schutzregel (Betreiber 2026-10-10): Gilt für die Bytes ein Notaus (`media_publication_suspension`), entsteht nie eine öffentliche
 * Datei, auch wenn die Policy JA sagt; der Notaus selbst wird nie berührt. 🔴 **Die veröffentlichte Zeile bleibt unter dem Notaus
 * stehen** (Code-Review 2026-10-16 S8-04): Aus ihr rechnet die Quarantäne, welche Datei sie hält (`media/notaus.ts`); fiele sie weg,
 * gäbe der nächste Abgleich der Quarantäne die Datei zurück nach `published/`. Gezeigt wird sie trotzdem nicht: Der Lesepfad fragt den
 * Notaus selbst. Nach dem Aufheben reiht `suspension.lift` den Abgleich je aktiver Rolle ein.
 * 🔴 Fällt eine veröffentlichte Datei weg, fällt auch ihre Kopie in der Quarantäne (sonst gäbe ein späterer Rückweg eine Datei ohne
 * Zeile frei).
 * 🔴 Bleibt das Bild privat, gehört zum Stand die private Vorschau (`intern_<variante>`, WI-0068 P4b); wird es öffentlich, fällt sie weg.
 * 🔴 Das Reisebild hat zwei öffentliche Fassungen (WI-0272 S4, Aufgabe 22): die Hauptfassung `photobox_2048` und die Kachel `photobox_kachel` (`roles.ts`, `oeffentlicheVarianten`). Der Abgleich hält beide
 * auf dem Stand: je Fassung genau eine Zeile im Rezept, sonst rechnet er beide neu (ein Asset, das nur die Hauptfassung hat, bekommt die Kachel beim nächsten Lauf); fällt eine weg, fallen
 * beide weg; unter einem Notaus bleiben beide stehen. `published` im Ergebnis meint die Hauptfassung.
 * 🔴 Ein ABGELEHNTES Asset (`moderation_state = 'rejected'`: ein Reisebild, das der Einreicher zurückzog oder offline nahm, WI-0272 S2) rechnet der
 * Abgleich nicht: keine Vorschau, keine Veröffentlichung, das Original wird nicht gelesen, der technische Zustand bleibt (`settleRejected`). Eine neue
 * private Vorschau ließe Dateien auferstehen, die die tägliche Aufbewahrung gerade löscht. Nur das Netz bleibt: eine veröffentlichte Datei, die noch da
 * ist, fällt weg.
 * 🔴 Ein GELÖSCHTES Original (Stempel `media_file.bytes_deleted_at`, nur beim angenommenen Kartenvorschlag, WI-0275, `kartenvorschlag/original-loeschen.ts`): Die Bytes kommen aus der Zeile
 * der Klasse `master`, gegen deren Hash. Rechte, Rollen, Notaus und Rezepte laufen damit ohne Sonderweg weiter. Unter `private/source` entsteht nichts, die Messwerte der Originalzeile bleiben.
 * Fehlt der Master, wird das Asset `missing_file`, aber KEINE Zeile und KEINE Datei wird weggeräumt: Das Rückspielen des Masters heilt es. Eine Abweisung der Bytes (eine fremde Rolle)
 * schreibt keinen Zustand: Das Werk ist in Ordnung, nur diese Rolle geht nicht.
 */

export const MEDIA_SETTLE_KIND = "media_settle";

export interface SettleInput {
    assetPublicId: string;
    role: MediaRole;
}

export interface SettleResult {
    asset: string;
    role: MediaRole;
    technicalState: TechnicalState;
    published: boolean;
    unchanged: boolean;
    /** Warum (nicht) veröffentlicht; leer, wenn veröffentlicht. */
    reasons: string[];
    /** Befunde: die der Pipeline und `suspended_held` (Notaus, nichts veröffentlicht). */
    findings: string[];
}

/**
 * Reiht den Abgleich ein, in der Transaktion der Operation, über die einzige Tür der App-Rolle (`job_enqueue`, SECURITY DEFINER,
 * Migration 0090). Die Person ist der Auslöser: ein Editor-Job, der unter Kartensperre wartet (SYS-4). Ein zweiter Job für dasselbe
 * Asset schadet nicht: der Abgleich ist wiederholbar und schreibt nichts, wenn alles auf dem Stand ist.
 */
export async function enqueueSettle(
    tx: Queryable,
    input: SettleInput & { actorPersonId: string; priority?: number | undefined },
): Promise<DerivedWork> {
    // Die Priorität der Warteschlange (0 zuerst, Vorgabe 50): Der Sammellauf der Duplikate reiht seine Abgleiche mit 90 ein, damit
    // fremde ★-Wechsel und Uploads nicht hinter ihnen warten (Claudio 2026-10-17).
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${MEDIA_SETTLE_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, ${input.actorPersonId},
                           ${tx.json({ asset: input.assetPublicId, role: input.role })}, ${input.priority ?? 50}::smallint)
    `;
    return { kind: MEDIA_SETTLE_KIND, jobId: job!.public_id, state: "queued" };
}

/**
 * Den Abgleich je aktiver Rolle eines Assets einreihen: nach jeder Änderung an einer Tatsache, nach der die Policy entscheidet (Entstehung,
 * Grundlage, Lizenz, Prüfstand; Code-Review 2026-10-16 S8-01) und nach dem Aufheben eines Notaus. Ohne aktive Verwendung nichts.
 *
 * 🔴 Dazu jede aus dem Asset erzeugte Vorschau (WI-0287 Punkt 5, `generated_from_asset_id`): Ihre Rechte und ihre Entstehung sind die der Karte (die Auslöser
 * aus Migration 0320 schreiben sie schon mit), und der Notaus der Karte gilt auch ihr. Ändert sich eins davon an der Karte, muss auch ihr Abgleich neu laufen.
 */
export async function enqueueSettleForActiveRoles(
    tx: Queryable,
    input: { assetId: string; assetPublicId: string; actorPersonId: string },
): Promise<DerivedWork[]> {
    const work = await enqueueSettleForRoles(tx, input, await activeRoles(tx, input.assetId));
    const erzeugte = await tx<{ id: string; public_id: string }[]>`
        SELECT id::text AS id, public_id::text AS public_id FROM media_asset WHERE generated_from_asset_id = ${input.assetId}::bigint
    `;
    for (const vorschau of erzeugte) {
        work.push(
            ...(await enqueueSettleForRoles(
                tx,
                { assetPublicId: vorschau.public_id, actorPersonId: input.actorPersonId },
                await activeRoles(tx, vorschau.id),
            )),
        );
    }
    return work;
}

/**
 * Den Abgleich für jede Rolle einreihen, die ein Asset gerade berührt: seine aktiven Verwendungen UND die Rollen seiner Dateien
 * (veröffentlicht oder private Vorschau). Nach Operationen, die Verwendungen zwischen Assets bewegen (Zusammenführen und Aufheben,
 * Code-Review 2026-10-16 S8-02): Dort hat das abgebende Asset keine Verwendung mehr, aber noch die Datei der Rolle, die gegangen ist.
 */
export async function enqueueSettleForTouchedRoles(
    tx: Queryable,
    input: { assetId: string; assetPublicId: string; actorPersonId: string; priority?: number | undefined },
): Promise<DerivedWork[]> {
    const roles = await activeRoles(tx, input.assetId);
    const varianten = await tx<{ variant: string }[]>`
        SELECT DISTINCT variant FROM media_file
         WHERE media_asset_id = ${input.assetId}::bigint AND storage_class IN ('published', 'derivative')
    `;
    for (const role of MEDIA_ROLES) {
        const variante = PUBLISHED_VARIANT[role];
        if (
            varianten.some(
                (row) => oeffentlicheVarianten(role).includes(row.variant) || row.variant === internVariante(variante),
            )
        ) {
            roles.add(role);
        }
    }
    return enqueueSettleForRoles(tx, input, roles);
}

async function activeRoles(tx: Queryable, assetId: string): Promise<Set<MediaRole>> {
    return new Set((await readUsages(tx, assetId)).filter((usage) => !usage.retired).map((usage) => usage.role));
}

async function enqueueSettleForRoles(
    tx: Queryable,
    input: { assetPublicId: string; actorPersonId: string; priority?: number | undefined },
    roles: ReadonlySet<MediaRole>,
): Promise<DerivedWork[]> {
    const work: DerivedWork[] = [];
    for (const role of roles) {
        work.push(
            await enqueueSettle(tx, {
                assetPublicId: input.assetPublicId,
                role,
                actorPersonId: input.actorPersonId,
                priority: input.priority,
            }),
        );
    }
    return work;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Die Eingabe des Jobs; `null`, wenn sie unbrauchbar ist. */
export function parseSettleInput(raw: Record<string, unknown>): SettleInput | null {
    const asset = raw["asset"];
    const role = raw["role"];
    if (typeof asset !== "string" || !UUID.test(asset)) return null;
    if (typeof role !== "string" || !(MEDIA_ROLES as readonly string[]).includes(role)) return null;
    return { assetPublicId: asset, role: role as MediaRole };
}

interface AssetFactsRow {
    id: string;
    media_kind: string;
    origin: string;
    technical_state: TechnicalState;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    license_key: string | null;
    requires_attribution: boolean | null;
    source_key: string | null;
    source_sha256: string | null;
    source_corners: boolean | null;
    /** Der Wahrnehmungs-Hash des Originals (WI-0068 D2, Migration 0196); `null`: noch nicht gerechnet. */
    source_perceptual_hash: string | null;
    /** Der Stempel des Originals (WI-0275, Migration 0308); gesetzt: Die Bytes kommen aus dem Master. */
    source_deleted_at: Date | null;
    /** Eine erzeugte Vorschau (WI-0287, Migration 0320): Ihr Original rechnet der Job `citymap_preview_generate`. */
    erzeugt: boolean;
}

/** Was `leseQuelle` vom Original eines Assets wissen muss (auch der Job „Vorschau erzeugen“ liest die Karte so). */
export type QuellZeile = Pick<AssetFactsRow, "id" | "source_key" | "source_sha256" | "source_deleted_at">;

interface PublishedRow {
    id: string;
    variant: string;
    storage_key: string;
    sha256: string;
    recipe_version: string | null;
}

/** Hält ein Notaus diese Bytes, der eigene oder (bei einer erzeugten Vorschau) der ihrer Karte (`GEHALTENE_QUELLBYTES_SQL`, WI-0287)? */
async function activeSuspension(db: Queryable, sha256: string | null): Promise<boolean> {
    if (sha256 === null) return false;
    const [row] = await db<{ held: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM (${db.unsafe(GEHALTENE_QUELLBYTES_SQL)}) n WHERE n.sha256 = ${sha256}) AS held
    `;
    return row?.held === true;
}

/** Die Bytes eines Schlüssels, geprüft gegen ihren Hash; `null`, wenn sie fehlen oder nicht passen. */
async function leseGeprueft(store: MediaStore, key: string, sha256: string): Promise<Buffer | null> {
    try {
        const stored = await store.read(key, MAX_SOURCE_BYTES);
        return sha256Of(stored) === sha256 ? stored : null;
    } catch (error) {
        if (!(error instanceof MediaStorageError)) throw error;
        return null;
    }
}

/**
 * Die Bytes, aus denen der Abgleich rechnet: das Original, oder bei einem Stempel der Master (`ausMaster`).
 *
 * 🔴 Der Wettlauf mit dem Löschen: Dieser Lauf kann die Zeile ungestempelt gelesen haben, und das Original fiel, bevor er die Datei las (`original-loeschen.ts` stempelt immer zuerst). Fehlt
 * die Datei, wird der Stempel deshalb neu gelesen, bevor das Urteil `missing_file` fällt; es nähme sonst Veröffentlichung und Vorschau mit.
 */
export async function leseQuelle(
    database: Queryable,
    store: MediaStore,
    asset: QuellZeile,
): Promise<{ bytes: Buffer | null; ausMaster: boolean }> {
    if (asset.source_deleted_at === null) {
        if (asset.source_key !== null && asset.source_sha256 !== null) {
            const bytes = await leseGeprueft(store, asset.source_key, asset.source_sha256);
            if (bytes !== null) return { bytes, ausMaster: false };
        }
        const [zeile] = await database<{ gestempelt: boolean }[]>`
            SELECT bytes_deleted_at IS NOT NULL AS gestempelt FROM media_file
             WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source'
        `;
        if (zeile?.gestempelt !== true) return { bytes: null, ausMaster: false };
    }
    const [master] = await database<{ storage_key: string; sha256: string }[]>`
        SELECT storage_key, sha256 FROM media_file WHERE media_asset_id = ${asset.id} AND storage_class = 'master' ORDER BY id LIMIT 1
    `;
    return {
        bytes: master === undefined ? null : await leseGeprueft(store, master.storage_key, master.sha256),
        ausMaster: true,
    };
}

/** Die Vorgabe: schreiben in einer eigenen Transaktion (Tests, Kommandozeile); der Job schreibt in der Transaktion seines Abschlusses. */
export type SettleCommit = (write: (tx: Queryable) => Promise<void>, result: SettleResult) => Promise<"ok" | "fenced">;

const ownTransaction =
    (database: Database): SettleCommit =>
    async (write) => {
        await database.begin((tx) => write(tx));
        return "ok";
    };

export async function settleAssetFiles(
    database: Database,
    store: MediaStore,
    input: SettleInput,
    commit: SettleCommit = ownTransaction(database),
): Promise<SettleResult> {
    const role = input.role;
    const [asset] = await database<AssetFactsRow[]>`
        SELECT a.id::text AS id, a.media_kind, a.origin, a.technical_state, a.moderation_state, a.creation_method, r.rights_basis AS basis,
               r.clearance_state AS clearance, r.license_key, l.requires_attribution,
               f.storage_key AS source_key, f.sha256 AS source_sha256, f.corners_transparent AS source_corners,
               f.perceptual_hash AS source_perceptual_hash, f.bytes_deleted_at AS source_deleted_at,
               a.generated_from_asset_id IS NOT NULL AS erzeugt
          FROM media_asset a
          LEFT JOIN media_rights r ON r.media_asset_id = a.id
          LEFT JOIN license_catalog l ON l.key = r.license_key
          LEFT JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
         WHERE a.public_id = ${input.assetPublicId}::uuid
    `;
    const result: SettleResult = {
        asset: input.assetPublicId,
        role,
        technicalState: asset?.technical_state ?? "pending",
        published: false,
        unchanged: false,
        reasons: [],
        findings: [],
    };
    // Ein Wappen aus dem Editor wird zum Quadrat aufgefüllt (Betreiber 2026-10-10); der Bestand aus Legacy behält sein Profil.
    const editorCoat = role === "coat" && asset?.origin === "editor_upload";
    const profile = profileForAsset(role, { editorCoat });
    const recipe = recipeVersion(profile);
    if (asset === undefined) {
        result.reasons = ["asset_missing"];
        await commit(async () => undefined, { ...result, unchanged: true });
        return { ...result, unchanged: true };
    }
    // Eine erzeugte Vorschau ohne Original wartet auf ihren Job (WI-0287): Er legt das Original ab und reiht danach diesen Abgleich selbst ein. Hier gäbe es nur ein
    // falsches „Datei fehlt“, solange er nicht gelaufen ist (etwa wenn sich die Rechte der Karte gerade jetzt ändern).
    if (asset.erzeugt && asset.source_key === null && asset.technical_state === "pending") {
        const wartet: SettleResult = { ...result, reasons: ["generation_pending"], unchanged: true };
        await commit(async () => undefined, wartet);
        return wartet;
    }
    // Die öffentlichen Fassungen der Rolle: die Hauptfassung und, beim Reisebild, die Kachel (WI-0272 S4, `roles.ts`).
    const varianten = oeffentlicheVarianten(role);
    const rezepte = new Map<string, string>([
        [profile.variant, recipe],
        ...beifassungen(role).map((beifassung): [string, string] => [beifassung.variant, recipeVersion(beifassung)]),
    ]);
    const publishedRows = await database<PublishedRow[]>`
        SELECT id::text AS id, variant, storage_key, sha256, recipe_version FROM media_file
         WHERE media_asset_id = ${asset.id} AND storage_class = 'published' AND variant = ANY(${[...varianten]}::text[])
    `;
    const internRows = await database<PublishedRow[]>`
        SELECT id::text AS id, variant, storage_key, sha256, recipe_version FROM media_file
         WHERE media_asset_id = ${asset.id} AND storage_class = 'derivative' AND variant = ${internVariante(profile.variant)}
    `;
    const suspended = await activeSuspension(database, asset.source_sha256);
    if (asset.moderation_state === "rejected") {
        return settleRejected(
            database,
            store,
            { id: asset.id, technicalState: asset.technical_state, sourceSha256: asset.source_sha256 },
            { result, publishedRows, suspended },
            commit,
        );
    }
    const decision = assetPublishes(
        {
            technicalState: "ok",
            moderationState: asset.moderation_state,
            creationMethod: asset.creation_method,
            basis: asset.basis,
            clearance: asset.clearance,
            licenseKey: asset.license_key,
            requiresAttribution: asset.requires_attribution,
        },
        role,
        await readUsages(database, asset.id),
        { mimeType: "image/webp" },
        await readPublicationRules(database),
        true,
    );
    // Ein Wappen aus dem Editor mit undurchsichtigen Ecken bleibt privat (T2a). Ist es schon gemessen (T2b), weiß der Abgleich das vorher und
    // rechnet nicht bei jedem Lauf neu.
    const eckenHalten = editorCoat && asset.source_corners === false;
    const publish = decision.allowed && !suspended && asset.media_kind === "image" && !eckenHalten;
    result.reasons = publish
        ? []
        : suspended
          ? ["suspended"]
          : eckenHalten && decision.allowed
            ? ["coat_not_transparent"]
            : [...new Set(decision.reasons)];
    if (suspended && decision.allowed) result.findings.push("suspended_held");

    // Auf dem Stand: öffentlich mit genau einer Datei des Rezepts je Fassung und ohne private Vorschau, oder privat mit genau einer Vorschau. Unter
    // einem Notaus zählt die veröffentlichte Zeile nicht: Sie bleibt, wie sie ist (siehe Kopf).
    const fassungenAktuell =
        publishedRows.length === varianten.length &&
        varianten.every((variante) => {
            const zeilen = publishedRows.filter((row) => row.variant === variante);
            return zeilen.length === 1 && zeilen[0]?.recipe_version === rezepte.get(variante);
        });
    const current = publish
        ? fassungenAktuell && internRows.length === 0
        : (suspended || publishedRows.length === 0) &&
          internRows.length === 1 &&
          internRows[0]?.recipe_version === recipe;
    // Ein Wappen ohne Messung der Ecken (T2b) ist nicht auf dem Stand: Der Abgleich misst nach. Ein gelöschtes Original lässt sich nicht mehr messen.
    const gemessen = role !== "coat" || asset.source_corners !== null || asset.source_deleted_at !== null;
    if ((asset.technical_state === "ok" && current && gemessen) || asset.media_kind !== "image") {
        const settled = { ...result, technicalState: asset.technical_state, published: publish, unchanged: true };
        await commit(async () => undefined, settled);
        return settled;
    }

    // Die Bytes: das abgelegte Original oder der Master, geprüft gegen ihren Hash.
    const { bytes, ausMaster } = await leseQuelle(database, store, asset);

    let state: TechnicalState = "ok";
    let derivatives: IngestedFile[] = [];
    let preview: IngestedFile | undefined;
    let corners: boolean | undefined;
    let perceptualHash: string | undefined;
    if (bytes === null) {
        state = "missing_file";
        result.findings.push("missing_file");
        // 🔴 Der Master fehlt: Nur der Zustand wird geschrieben, keine Zeile und keine Datei fällt (siehe Kopf).
        if (ausMaster) {
            const fehlt: SettleResult = { ...result, technicalState: state, published: false };
            await commit(async (tx) => {
                await tx`UPDATE media_asset SET technical_state = ${state}, updated_at = now() WHERE id = ${asset.id}`;
            }, fehlt);
            return fehlt;
        }
    } else {
        try {
            // Ein Kartenvorschlag aus der Community (WI-0275) und eine Karte aus der Kartensammlung (WI-0287) dürfen als Rasterdatei bis 50 MiB groß sein; die 6 MiB (D2) gelten für alles
            // andere. Der Master ist von uns gerechnet, die Grenze der Hochladenden gilt für ihn in keiner Rolle.
            const grossErlaubt =
                ausMaster ||
                ((asset.origin === "community_upload" || asset.origin === "editor_upload") && PDF_ROLES.has(role));
            const ingested = await ingestImage(store, {
                bytes,
                role,
                publish,
                editorCoat,
                preview: true,
                ...(grossErlaubt ? { maxRasterBytes: PDF_LIMITS.maxBytes } : {}),
                ...(ausMaster ? { quelleAblegen: false } : {}),
            });
            derivatives = ingested.derivatives;
            preview = ingested.preview;
            corners = ingested.corners;
            perceptualHash = ingested.perceptualHash;
            result.findings.push(...ingested.findings.map((finding) => finding.code));
        } catch (error) {
            if (!(error instanceof RasterRejection)) throw error;
            result.findings.push(error.code);
            // 🔴 Der Master wurde abgewiesen: Das sagt etwas über diese Rolle, nichts über das Werk; kein Zustand, keine Zeile (siehe Kopf).
            if (ausMaster) {
                const abgewiesen: SettleResult = {
                    ...result,
                    technicalState: asset.technical_state,
                    published: false,
                    unchanged: true,
                };
                await commit(async () => undefined, abgewiesen);
                return abgewiesen;
            }
            state = error.technicalState;
        }
    }

    const unpublish: string[] = [];
    /** Veröffentlichte Schlüssel, deren Kopie in der Quarantäne mit wegfällt (Schlüssel → Bytes). */
    const ausQuarantaene = new Map<string, string>();
    // `settled.published` hängt an der Hauptfassung (`derivatives[0]`); die Beifassungen folgen ihr.
    const settled: SettleResult = { ...result, technicalState: state, published: derivatives[0] !== undefined };
    const outcome = await commit(async (tx) => {
        await tx`SELECT 1 FROM media_asset WHERE id = ${asset.id} FOR UPDATE`;
        // Ein Notaus, der seit der Entscheidung kam, gewinnt auch hier; unter ihm bleiben die veröffentlichten Zeilen stehen.
        const gehalten = suspended || (await activeSuspension(tx, asset.source_sha256));
        // 🔴 Und eine Ablehnung, die seit der Entscheidung kam (Offline eines Reisebildes zwischen Entscheidung und Abschluss, WI-0272 S3, Review M4): Der Abschluss liest die
        // Moderation unter der Sperre neu und veröffentlicht bei `rejected` nichts, wie der Abgleich eines abgelehnten Assets (`settleRejected`): keine Fassung, keine Vorschau,
        // was öffentlich stand, fällt weg (unter einem Notaus bleibt es). Die gerechneten Dateien fallen beim Aufräumen weg, denn keine Zeile hält sie.
        const [moderation] = await tx<{ moderation_state: ModerationState }[]>`
            SELECT moderation_state FROM media_asset WHERE id = ${asset.id}
        `;
        if (moderation?.moderation_state === "rejected") {
            settled.published = false;
            settled.reasons = ["moderation_rejected"];
            for (const gerechnet of derivatives) unpublish.push(gerechnet.key);
            if (preview !== undefined) unpublish.push(preview.key);
            for (const row of gehalten ? [] : publishedRows) {
                await tx`DELETE FROM media_file WHERE id = ${row.id}`;
                unpublish.push(row.storage_key);
                ausQuarantaene.set(row.storage_key, row.sha256);
            }
            return;
        }
        // Jede Fassung wird behandelt wie früher die eine: behalten, einfügen, die wegfallenden nach `unpublish`; unter einem Notaus bleibt alles stehen.
        const keeps = gehalten ? [] : derivatives;
        // Eine gerechnete Datei, die keine Zeile bekommt, fällt beim Aufräumen weg (sie lag schon unter `published/`).
        if (gehalten) for (const gerechnet of derivatives) unpublish.push(gerechnet.key);
        const gleich = (row: PublishedRow, fassung: IngestedFile): boolean =>
            row.variant === fassung.variant &&
            row.sha256 === fassung.sha256 &&
            row.recipe_version === fassung.recipeVersion;
        for (const row of gehalten ? [] : publishedRows) {
            if (keeps.some((keep) => gleich(row, keep))) continue;
            await tx`DELETE FROM media_file WHERE id = ${row.id}`;
            unpublish.push(row.storage_key);
            ausQuarantaene.set(row.storage_key, row.sha256);
        }
        for (const keep of keeps) {
            if (publishedRows.some((row) => gleich(row, keep))) continue;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${asset.id}, ${keep.variant}, 'published', ${keep.key}, ${keep.mimeType}, ${keep.width}, ${keep.height},
                        ${keep.byteSize}, ${keep.sha256}, ${keep.derivativeRecipe}, ${keep.recipeVersion})
            `;
        }
        // Die private Vorschau: nur, solange keine öffentliche Datei bleibt; eine ältere fällt weg.
        const vorschau = keeps.length === 0 ? preview : undefined;
        for (const row of internRows) {
            if (
                vorschau !== undefined &&
                row.sha256 === vorschau.sha256 &&
                row.recipe_version === vorschau.recipeVersion
            )
                continue;
            await tx`DELETE FROM media_file WHERE id = ${row.id}`;
            unpublish.push(row.storage_key);
        }
        const vorschauDa = internRows.some(
            (row) =>
                vorschau !== undefined &&
                row.sha256 === vorschau.sha256 &&
                row.recipe_version === vorschau.recipeVersion,
        );
        if (vorschau !== undefined && !vorschauDa) {
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${asset.id}, ${vorschau.variant}, 'derivative', ${vorschau.key}, ${vorschau.mimeType}, ${vorschau.width},
                        ${vorschau.height}, ${vorschau.byteSize}, ${vorschau.sha256}, ${vorschau.derivativeRecipe}, ${vorschau.recipeVersion})
            `;
        }
        // Die Messwerte gehören zu den Bytes des Originals; aus dem Master gerechnet überschreiben sie nichts.
        if (!ausMaster && corners !== undefined && corners !== asset.source_corners) {
            await tx`
                UPDATE media_file SET corners_transparent = ${corners}
                 WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source'
            `;
        }
        // Der Wahrnehmungs-Hash (WI-0068 D2) an die Zeile des Originals, nur wenn er sich ändert.
        if (!ausMaster && perceptualHash !== undefined && perceptualHash !== asset.source_perceptual_hash) {
            await tx`
                UPDATE media_file SET perceptual_hash = ${perceptualHash}
                 WHERE media_asset_id = ${asset.id} AND storage_class = 'private_source'
            `;
        }
        await tx`UPDATE media_asset SET technical_state = ${state}, updated_at = now() WHERE id = ${asset.id}`;
    }, settled);

    // Aufräumen NACH dem Festschreiben: eine öffentliche Datei oder private Vorschau, die keine Zeile mehr hält, fällt weg.
    if (outcome === "ok") await entferneOhneZeile(database, store, unpublish, ausQuarantaene);
    return settled;
}

/** Nach dem Festschreiben: die Dateien weg, die keine Zeile mehr hält (bytegleiche Werke teilen sich ihre Datei), samt Kopie in der Quarantäne. */
async function entferneOhneZeile(
    database: Database,
    store: MediaStore,
    keys: readonly string[],
    ausQuarantaene: ReadonlyMap<string, string>,
): Promise<void> {
    for (const key of keys) {
        const [referenced] = await database<{ present: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM media_file WHERE storage_key = ${key}) AS present
        `;
        if (referenced?.present === true) continue;
        await store.remove(key);
        const quarantaene = ausQuarantaene.get(key);
        if (quarantaene !== undefined) await store.removeQuarantined(quarantaene);
    }
}

/**
 * Der Abgleich für ein abgelehntes Asset (siehe Kopf): nichts rechnen, nichts veröffentlichen, nichts lesen, den technischen Zustand lassen, wie er ist.
 * Das Netz: Eine veröffentlichte Zeile des Assets (und ihre Datei samt Kopie in der Quarantäne) fällt weg, außer unter einem Notaus (dort bleibt die Zeile
 * stehen, aus ihr rechnet die Quarantäne; der Lesepfad zeigt sie ohnehin nicht, denn `decidePublication` hält ein abgelehntes Asset zurück).
 * Der Abschluss (`commit`) läuft immer, damit der Auftrag zu Ende geht.
 */
async function settleRejected(
    database: Database,
    store: MediaStore,
    asset: { id: string; technicalState: TechnicalState; sourceSha256: string | null },
    state: { result: SettleResult; publishedRows: readonly PublishedRow[]; suspended: boolean },
    commit: SettleCommit,
): Promise<SettleResult> {
    const gehalten: SettleResult = {
        ...state.result,
        technicalState: asset.technicalState,
        published: false,
        unchanged: true,
        reasons: ["moderation_rejected"],
    };
    const wegfallend = state.suspended ? [] : state.publishedRows;
    if (wegfallend.length === 0) {
        await commit(async () => undefined, gehalten);
        return gehalten;
    }
    const settled: SettleResult = { ...gehalten, unchanged: false };
    const unpublish: string[] = [];
    const ausQuarantaene = new Map<string, string>();
    const outcome = await commit(async (tx) => {
        await tx`SELECT 1 FROM media_asset WHERE id = ${asset.id} FOR UPDATE`;
        // Ein Notaus, der seit der Entscheidung kam, gewinnt auch hier: die veröffentlichte Zeile bleibt stehen.
        if (await activeSuspension(tx, asset.sourceSha256)) return;
        for (const row of wegfallend) {
            await tx`DELETE FROM media_file WHERE id = ${row.id}`;
            unpublish.push(row.storage_key);
            ausQuarantaene.set(row.storage_key, row.sha256);
        }
    }, settled);
    if (outcome === "ok") await entferneOhneZeile(database, store, unpublish, ausQuarantaene);
    return settled;
}
