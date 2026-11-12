import type { OperationReceipt } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import { runOperation, type OperationStore, type StoredOperation } from "../auth/operations.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { MEDIA_AUDIT_FREE_TEXT_KEYS, MEDIA_AUDIT_RECORDS } from "./audit.ts";

/**
 * Die Speicherstelle der Medien-Operationen (WI-0068 P4a, ADR-0019 Nr. 3): `media_operation` (Kennung, Hash, Quittung, Akteur) und
 * je betroffenem Gegenstand eine Zeile im Fachprotokoll `media_audit_event` (Migration 0086), in derselben Transaktion wie die
 * Änderung. Die Regeln von `runOperation` bleiben dieselben wie bei der Verwaltung.
 *
 * 🔴 POSITIVLISTE je Protokollhandlung (`MEDIA_AUDIT_DETAIL_KEYS`, wie `AUDIT_DETAIL_KEYS` der Anmeldung): In `details` steht nur, was
 * hier steht; nie ein Prompt, eine Rechtenotiz, ein Beleg, ein Dateiname oder Speicherschlüssel. Freitext nur unter `reason` und
 * `note` (`MEDIA_AUDIT_FREE_TEXT_KEYS`), sonst greift die Schwärzung beim Auflösen eines Kontos nicht (Migration 0088). In Tests
 * scheitert ein unbekannter Schlüssel laut.
 *
 * Konventionen aus P2 (`audit.ts`), nach denen `mediaEditConflict` liest: `action` beginnt mit dem Datensatz, dessen Revision
 * `target_revision` nennt; eine Bindung nennt sich in `details.binding` als `<tabelle>:<id>`. Dazu P4a: das Fachobjekt einer Bindung
 * steht in `details.subject` als `<art>:<public_id>` (der Verlauf am Ort, EDIT-0001 E19).
 */
export const MEDIA_AUDIT_DETAIL_KEYS = {
    "asset.uploaded": ["role", "kind", "format", "byteSize", "sha256"],
    // Eine Vorschau aus der Karte eines Eintrags erzeugt (WI-0287 Punkt 5, `kartensammlung-vorschau.ts`): die Rolle und die Karte (`source`, ihre öffentliche Kennung).
    "asset.generated": ["role", "source"],
    "asset.metadata_set": ["fields", "creationMethod"],
    // Der Name aus dem Fachobjekt, gesetzt von einer Bindung, weil das Asset noch keinen Titel hatte (`titles.ts`, Betreiber 2026-10-10).
    "asset.title_derived": ["subject", "role"],
    "creation.set": ["fields"],
    "rights.set": ["basis", "licenseKey", "fields", "clearanceReset"],
    "rights.reviewed": ["decision", "previous", "eigenerUpload"],
    "rights.evidence_added": ["kind", "hasFile", "hasUrl"],
    "binding.coat_set": ["binding", "subject", "role", "reactivated"],
    "binding.coat_released": ["binding", "subject", "role", "replacedBy"],
    "binding.coat_none": ["binding", "subject", "role"],
    // Das Titelbild eines Orts als Einzelbild (WI-0219): Setzen, Lösen (`replacedBy`: das Bild oder die Galerie an seiner Stelle)
    // und „bewusst ohne“.
    "binding.header_set": ["binding", "subject", "role", "reactivated"],
    "binding.header_released": ["binding", "subject", "role", "replacedBy"],
    "binding.header_none": ["subject", "role"],
    "gallery.created": ["subject", "role"],
    // Die Galerie als eigenes Medienobjekt (WI-0068 P6, `gallery-operations.ts`): Titel, Cover, Bildunterschrift und die
    // Ortsbindung, die sie erst sichtbar macht. `draft` am Lösen sagt, dass die Galerie danach an keinem Ort mehr hängt.
    "gallery.title_set": ["fields"],
    "gallery.cover_set": ["cleared"],
    "gallery.caption_set": ["fields"],
    "gallery.bound": ["subject", "role"],
    "gallery.unbound": ["subject", "role", "draft", "replacedBy"],
    // Eine eigene, ortlose Galerie entfernt (`gallery.delete`): wie viele Einträge mit ihr fielen; die Bilder bleiben.
    "gallery.deleted": ["items"],
    "gallery.header_added": ["subject", "position", "reactivated"],
    "gallery.header_removed": ["subject"],
    "gallery.header_reordered": ["subject", "order"],
    // Der Bildbezug einer Verwendung (Betreiber 2026-10-11, Operation `header.relation`): neuer und voriger Wert, `null` heißt „die
    // Regel gilt“. Am Galerieeintrag zählt die Galerie (Konvention oben), an der direkten Bindung die Bindung.
    "gallery.header_relation_set": ["subject", "relation", "previous"],
    "binding.header_relation_set": ["binding", "subject", "relation", "previous"],
    // Typbilder (WI-0068, Migration 0113): der ★ einer Kategorie wandert; `origin` release (übernommen) oder editor; `variant` ki oder ohne_ki
    // (WI-0281, Migration 0314; fehlt es an einer älteren Zeile, war es die KI-Variante).
    "binding.type_image_set": ["binding", "category", "variant", "origin"],
    "binding.type_image_released": ["binding", "category", "variant", "replacedBy"],
    // Der Einzelbild-Notaus (WI-0068, Betreiber 2026-10-10): Gegenstand sind die BYTES, deshalb `sha256`; `assets` und `usages`
    // sagen, wie weit er reicht. Der Grund ist Pflicht und steht als Freitext unter `reason` (damit die Schwärzung ihn erfasst).
    // Zusammenfuehren bytegleicher Werke (WI-0068 D1, Migration 0121): `keptAsset` ist das bleibende, `moved` und `retired`
    // sagen, wie viele Verwendungen umzogen und wie viele am schon belegten Platz zurueckgezogen wurden. Die Zeile steht am
    // AUFGEGANGENEN Werk - dort ist die Aenderung, die jemand spaeter sucht.
    "asset.merged": ["keptAsset", "moved", "retired"],
    "asset.merge_lifted": ["keptAsset", "moved"],
    // Endgültig löschen (WI-0068 R4, `asset-delete.ts`): wie viele Dateizeilen und Belege mit dem Werk fielen. Bei einem Bild aus einem Kartenvorschlag (WI-0287)
    // dazu, wie viele Bindungen an stillgelegte Einträge fielen (`usages`) und wie viele erzeugte Vorschauen mit ihm (`previews`); an einer solchen Vorschau ihre Karte (`source`).
    // Bei einem PhotoBox-Bild (WI-0272) zählt `usages` seine Zeilen in `photobox_media`; an einer ersetzten Fassung, die mitfiel, steht das Bild als `source`.
    // `suspensions`: wie viele Notaus-Zeilen ihren Verweis auf das Werk verloren (Migration 0328); sie bleiben mit Grund, Person, Zeit und Prüfsumme stehen.
    "asset.deleted": ["files", "evidence", "usages", "previews", "source", "suspensions"],
    // Eine Karte der Kartensammlung geändert (WI-0068 R5, `kartensammlung-schreiben.ts`): welche Felder, `types` für die Typen. Die Zeile
    // hält die Karte gegen den Legacy-Zug (`karte-gehalten.ts`); Werte stehen nicht hier, nur ihre Namen. `handedFrom`: Ein anderer Eintrag gab
    // seine Bilder hierher (WI-0287 Stufe 2, `kartensammlung-zusammenlegen.ts`), seine öffentliche Kennung.
    // `op` (WI-0287 Stufe 3, `kartensammlung-orte.ts`): die Handlung an den Orten und Regionen (`add`, `remove`, `resolve`); nie ein Name.
    "citymap.updated": ["fields", "handedFrom", "op"],
    // Eine Karte aus einem Besucher-Vorschlag angelegt (WI-0275 B2, `kartenvorschlag/annehmen.ts`): Weg des Vorschlags (`link` oder `file`), wie viele Typen,
    // ob ein Ort dabei ist; nie Titel, Link, Name oder Text. Die Zeile hält die Karte gegen den Legacy-Zug (`karte-gehalten.ts`).
    "citymap.created": ["way", "types", "place"],
    // Einen Eintrag der Kartensammlung entfernt (stillgelegt) oder zurückgeholt (WI-0287, `kartensammlung-stilllegen.ts`): wie viele aktive Bindungen
    // der Abgleich neu bewertet. Beide Zeilen halten die Karte gegen den Legacy-Zug (`karte-gehalten.ts`). `handedTo`: Die Bilder gingen beim Entfernen an
    // diesen Eintrag (WI-0287 Stufe 2, `citymap.merge`), seine öffentliche Kennung; der Inspector des stillgelegten Eintrags nennt ihn.
    "citymap.retired": ["bindings", "handedTo"],
    "citymap.restored": ["bindings"],
    "suspension.set": ["sha256", "assets", "usages"],
    "suspension.lifted": ["sha256", "assets", "usages"],
    // Reisebilder (WI-0272 S2, `photobox/`): was ein Besucher ohne Konto an seiner Einreichung tut. Nur Codes, Zahlen und Kennungen, nie die
    // Beschreibung, der Name oder der Schlüssel. Die Zeile steht am aktuellen Asset der Einreichung; `target_revision` ist die Revision der
    // EINREICHUNG (`media_submission.revision`), nicht die des Assets.
    "photobox.submitted": ["creation", "grant", "format", "byteSize", "sha256"],
    // `previous` nur bei einer Antwort auf eine Rückfrage (der Zustand davor, ein Code).
    "photobox.description_set": ["pending", "previous"],
    "photobox.image_replaced": ["format", "byteSize", "sha256", "replaced"],
    "photobox.withdrawn": ["previous"],
    "photobox.offline": ["previous", "files"],
    "photobox.grant_set": ["grant", "previous"],
    // Die Redaktion prüft und gibt frei (WI-0272 S3, `photobox/redaktion.ts`): die Person der Redaktion handelt, die Zeile steht am aktuellen Asset
    // der Einreichung, `target_revision` ist die Revision der EINREICHUNG. `previous` ist der Zustand davor (ein Code). Freitext nur unter
    // `note` (Rückfrage) und `reason` (Ablehnung): Die Schwärzung beim Auflösen eines Kontos erfasst genau diese Schlüssel.
    // `descriptionAccepted`: eine wartende Beschreibung wurde übernommen;
    // `fields`: welche Angaben die Redaktion berichtigte (Namen, nie Werte).
    "photobox.approved": ["previous", "descriptionAccepted"],
    "photobox.asked": ["previous"],
    "photobox.rejected": ["previous"],
    "photobox.corrected": ["previous", "fields"],
    "photobox.taken_offline": ["previous", "files"],
    // Erneut zur Prüfung (Vali 2026-11-09): freigegeben zurück nach offen; `previous` ist der Zustand davor (ein Code).
    "photobox.reopened": ["previous"],
    // Das Bild der Einreichung endgültig gelöscht (WI-0272, `asset-delete.ts`): Die Einreichung bleibt ohne Datei im Verlauf. `previous` ist ihr Zustand (ein Code),
    // `versions`, wie viele ersetzte Fassungen mitfielen. Die Zeile steht am gelöschten Asset; `target_revision` ist die Revision der EINREICHUNG.
    "photobox.media_deleted": ["previous", "versions"],
} as const satisfies Record<string, readonly string[]>;

export type MediaAuditAction = keyof typeof MEDIA_AUDIT_DETAIL_KEYS;

/** Eine Zeile des Fachprotokolls: ein Gegenstand, seine Revision NACH der Operation, Einzelheiten nach Positivliste. */
export interface MediaAuditEntry {
    action: MediaAuditAction;
    assetId?: string | null;
    galleryId?: string | null;
    ruleId?: string | null;
    citymapId?: string | null;
    targetRevision?: number | null;
    details?: Record<string, unknown>;
}

/**
 * Ein Besucher ohne Konto als Handelnder (Reisebilder, WI-0272 S2): `media_operation.actor_kind = 'anonymous'` und eine Bezeichnung statt
 * einer Person (`actor_label`, nie ein Name). Die Person bleibt leer (`media_operation_person_iff_person`).
 */
export interface PhotoboxAkteur {
    kind: "anonymous";
    label: "photobox";
    environment: AuthEnvironment;
}

/**
 * Was eine Medien-Operation festhält: die benannte Operation (§14), Umgebung, Handelnder und die Protokollzeilen. Ohne `actorKind` handelt
 * eine Person (`actorPersonId`), so wie alle bisherigen Aufrufer.
 */
export interface MediaOperationEvent {
    /** Die Operation, etwa `coat.bind` (Katalog im Code, Format wie `media_operation_action_format`). */
    operation: string;
    environment: AuthEnvironment;
    /** Die Person; bei einem anonymen Handelnden `null`. */
    actorPersonId: string | null;
    actorKind?: "person" | "anonymous" | undefined;
    /** Die Bezeichnung eines Handelnden ohne Person (`photobox`). */
    actorLabel?: string | undefined;
    entries: MediaAuditEntry[];
}

const AUDIT_STRICT = process.env["VITEST"] !== undefined;
const FREE_TEXT: ReadonlySet<string> = new Set(MEDIA_AUDIT_FREE_TEXT_KEYS);

/** Die Einzelheiten nach Positivliste; ein Datensatz-Präfix, das P2 nicht kennt, ist ein Fehler im Code. */
export function filterMediaDetails(
    action: MediaAuditAction,
    details: Record<string, unknown> = {},
): Record<string, unknown> {
    if (AUDIT_STRICT && !(MEDIA_AUDIT_RECORDS as readonly string[]).includes(action.split(".")[0] ?? "")) {
        throw new Error(`Fachprotokoll ${action}: unbekannter Datensatz`);
    }
    const allowed = new Set<string>(MEDIA_AUDIT_DETAIL_KEYS[action]);
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        if (value === undefined) continue;
        if (allowed.has(key) || FREE_TEXT.has(key)) kept[key] = value;
        else if (AUDIT_STRICT)
            throw new Error(`Fachprotokoll ${action}: Schlüssel ${key} steht nicht in der Positivliste`);
    }
    return kept;
}

export const MEDIA_OPERATION_STORE: OperationStore<MediaOperationEvent> = {
    async find(sql, operationId) {
        const [row] = await sql<StoredOperation[]>`
            SELECT request_hash, receipt FROM media_operation WHERE operation_id = ${operationId}::uuid
        `;
        return row;
    },
    async record(tx, { operationId, requestHash, receipt, event }) {
        const kind = event.actorKind ?? "person";
        await tx`
            INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id,
                                         actor_label)
            VALUES (${operationId}::uuid, ${requestHash}, ${tx.json(receipt as never)}, ${event.operation}, ${event.environment},
                    ${kind}, ${kind === "person" ? event.actorPersonId : null}::uuid, ${event.actorLabel ?? null})
        `;
        for (const entry of event.entries) {
            await tx`
                INSERT INTO media_audit_event (operation_id, action, media_asset_public_id, media_gallery_public_id,
                                               publication_rule_id, citymap_public_id, target_revision, details)
                VALUES (${operationId}::uuid, ${entry.action}, ${entry.assetId ?? null}::uuid, ${entry.galleryId ?? null}::uuid,
                        ${entry.ruleId ?? null}::bigint, ${entry.citymapId ?? null}::uuid, ${entry.targetRevision ?? null},
                        ${tx.json(filterMediaDetails(entry.action, entry.details) as never)})
            `;
        }
    },
};

/** Wer handelt: die Person der Sitzung in ihrer Umgebung. */
export interface MediaActor {
    personId: string;
    environment: AuthEnvironment;
}

export type MediaWork = (
    tx: Sql,
) => Promise<{ receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">; entries: MediaAuditEntry[] }>;

/**
 * Eine Medien-Operation: höchstens einmal je `operationId` (Speicherstelle oben), Änderung, Operation und Protokoll in EINER
 * Transaktion. Zu Beginn sperrt sie die Kennung selbst: Ein gleichzeitiger Doppelklick wartet auf die erste Anfrage und bekommt ihre
 * Quittung, statt sich selbst einen Bearbeitungskonflikt zu bescheren. Gleichzeitige Operationen mit verschiedener Kennung am selben
 * Gegenstand trennt die Revision (409 `edit_conflict`) oder die Sperre des Platzes in der Operation.
 *
 * Ein eindeutiger Schlüssel, an dem eine gleichzeitige Operation mit anderer Kennung gewann (etwa „höchstens eine aktive Bindung je
 * Rolle“), ist ebenfalls „jemand war schneller“: 409 `edit_conflict`.
 */
export async function mediaOperation(
    database: Database,
    actor: MediaActor | PhotoboxAkteur,
    input: { operationId: string; operation: string; body: unknown },
    work: MediaWork,
): Promise<OperationReceipt> {
    try {
        return await runOperation<MediaOperationEvent>(
            database,
            { operationId: input.operationId, body: { operation: input.operation, ...(input.body as object) } },
            async (tx) => {
                const { receipt, entries } = await work(tx);
                return {
                    receipt: { ...receipt, environment: actor.environment },
                    event: {
                        operation: input.operation,
                        environment: actor.environment,
                        ...("kind" in actor
                            ? { actorPersonId: null, actorKind: actor.kind, actorLabel: actor.label }
                            : { actorPersonId: actor.personId }),
                        entries,
                    },
                };
            },
            {
                store: MEDIA_OPERATION_STORE,
                serialize: async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtext(${`media_operation:${input.operationId}`}))`;
                },
            },
        );
    } catch (error) {
        // `currentRevision` 0: der Stand ist hier nicht bekannt, Neuladen zeigt ihn.
        if ((error as { code?: string }).code === "23505") {
            throw new ApiError(
                409,
                "edit_conflict",
                "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                {
                    currentRevision: 0,
                },
            );
        }
        throw error;
    }
}
