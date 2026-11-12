import { mediaSwitchKeys, type MediaKind, type MediaRole } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { activeUsagesSql, publishedVariantsArray } from "../media-editor/usage-sql.ts";
import { ausgeschaltet, leseInhaltsstand, schalterVon, type Inhaltsstand } from "../system/inhaltsstand.ts";
import {
    decidePublication,
    type ClearanceState,
    type CreationMethod,
    type ModerationState,
    type PublicationOverride,
    type PublicationRuleFacts,
    type RightsBasis,
    type TechnicalState,
} from "./policy.ts";
import { readPublicationRules } from "./rules.ts";
import type { MediaStore, QuarantineMove } from "./storage.ts";

/**
 * Die Quarantäne veröffentlichter Mediendateien (WI-0127 SYS-10 b3, Migration 0104; Vertrag WI-0127 §19.6). Generisch für Mengen von
 * Bytes: Die Inhaltsschalter rechnen ihre Menge mit `zielInhaltsschalter`, der Einzelbild-Notaus aus WI-0068 seine aus
 * `media_publication_suspension`; beide geben sie an `gleicheQuarantaeneAb`.
 *
 * - **Gegenstand** sind die Bytes einer veröffentlichten Datei (`media_file.sha256`, Klasse `published`). Alle Assets mit denselben
 *   Bytes teilen eine Datei; sie wandert nur, wenn KEINE Verwendung dieser Bytes öffentlich bleibt.
 * - **Eingabe** ist die GANZE Menge eines Grundes, keine Differenz: Der Abgleich ist wiederholbar und rechnet den Unterschied selbst.
 * - **Erst die Zeile, dann die Datei.** Liegt eine Datei falsch (Abbruch dazwischen), legt der nächste Lauf sie richtig: Er gleicht für
 *   alle Bytes, die je in der Tafel standen, den Ort mit den aktiven Gründen ab.
 * - **Rückweg:** Fällt ein Grund weg, bekommt seine Zeile `restored_at`; ist für die Bytes kein Grund mehr aktiv, wandert die Datei
 *   zurück nach `published/`. Nichts wird gelöscht, nichts neu gerendert.
 */

export const QUARANTINE_REASONS = ["content_switch", "asset_suspension"] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

interface UsageFactsRow {
    asset_id: string;
    sha256: string;
    published_mime: string;
    role: MediaRole;
    override: PublicationOverride;
    suppressed: boolean;
    media_kind: MediaKind;
    technical_state: TechnicalState;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    rights_basis: RightsBasis | null;
    clearance_state: ClearanceState | null;
    license_key: string | null;
    license_family: string | null;
    requires_attribution: boolean | null;
}

/**
 * Je aktive Verwendung mit Rolle: die Fakten der Entscheidung und die Bytes der veröffentlichten Dateien ihrer Rolle (falls es welche gibt). Eine Rolle mit
 * Beifassung (das Reisebild und seine Kachel, WI-0272 S4) liefert je Variante die jüngste Datei, also eine Zeile je Datei: So sperrt der Schalter beide.
 */
const FACTS_QUERY = `
    SELECT u.asset_id::text AS asset_id, f.sha256, f.mime_type AS published_mime, u.role, u.override, u.suppressed,
           a.media_kind, a.technical_state, a.moderation_state, a.creation_method,
           r.rights_basis, r.clearance_state, r.license_key, r.license_family, l.requires_attribution
      FROM (${activeUsagesSql("")}) u
      JOIN media_asset a ON a.id = u.asset_id
      LEFT JOIN media_rights r ON r.media_asset_id = a.id
      LEFT JOIN license_catalog l ON l.key = r.license_key
      JOIN LATERAL (
          SELECT DISTINCT ON (f.variant) f.sha256, f.mime_type FROM media_file f
           WHERE f.media_asset_id = a.id AND f.storage_class = 'published' AND f.variant = ANY(${publishedVariantsArray("u.role")})
           ORDER BY f.variant, f.created_at DESC, f.id DESC
      ) f ON TRUE
     WHERE u.role IS NOT NULL
`;

function decide(
    row: UsageFactsRow,
    rules: readonly PublicationRuleFacts[],
    switches?: { isOff(key: string): boolean },
): boolean {
    return decidePublication({
        role: row.role,
        asset: {
            mediaKind: row.media_kind,
            technicalState: row.technical_state,
            moderationState: row.moderation_state,
            creationMethod: row.creation_method,
        },
        rights:
            row.rights_basis !== null && row.clearance_state !== null
                ? {
                      basis: row.rights_basis,
                      clearance: row.clearance_state,
                      licenseKey: row.license_key,
                      licenseRequiresAttribution: row.requires_attribution,
                      licenseFamily: row.license_family,
                  }
                : null,
        usage: { role: row.role, suppressed: row.suppressed, retired: false, override: row.override },
        published: { mimeType: row.published_mime },
        rules,
        ...(switches === undefined ? {} : { switches }),
    }).allowed;
}

/** Eine öffentliche Verwendung, so wie Quarantäne und Zahlen sie brauchen. */
export interface OeffentlicheVerwendung {
    assetId: string;
    sha256: string;
    /** Die Schalter, die diese Verwendung treffen (`mediaSwitchKeys`). */
    keys: readonly string[];
    /** Öffentlich mit den Schaltern von jetzt? (Ohne Schalter ist sie es, sonst stünde sie nicht hier.) */
    mitSchaltern: boolean;
}

/** Alle Verwendungen, die ohne Schalter öffentlich wären: einmal gelesen, für Quarantäne und Zahlen je Rechtsgrund. */
export async function oeffentlicheVerwendungen(db: Queryable, stand: Inhaltsstand): Promise<OeffentlicheVerwendung[]> {
    const [rows, rules] = await Promise.all([db.unsafe<UsageFactsRow[]>(FACTS_QUERY), readPublicationRules(db)]);
    const switches = schalterVon(stand);
    const found: OeffentlicheVerwendung[] = [];
    for (const row of rows) {
        if (!decide(row, rules)) continue;
        found.push({
            assetId: row.asset_id,
            sha256: row.sha256,
            keys: mediaSwitchKeys({
                role: row.role,
                rightsBasis: row.rights_basis,
                licenseFamily: row.license_family,
                clearance: row.clearance_state,
            }),
            mitSchaltern: decide(row, rules, switches),
        });
    }
    return found;
}

/** Die Bytes, die die Inhaltsschalter aus der Auslieferung nehmen: ohne Schalter öffentlich, mit keiner einzigen Verwendung mehr. */
export function zielInhaltsschalter(verwendungen: readonly OeffentlicheVerwendung[]): Set<string> {
    const bleibt = new Set(verwendungen.filter((entry) => entry.mitSchaltern).map((entry) => entry.sha256));
    return new Set(verwendungen.filter((entry) => !bleibt.has(entry.sha256)).map((entry) => entry.sha256));
}

/** Je Schalter: wie viele Bilder (Assets) Besucher mit ihm sehen und wie viele er gerade zurückhält. */
export function zahlenJeSchalter(
    verwendungen: readonly OeffentlicheVerwendung[],
): Map<string, { sichtbar: number; ausgeblendet: number }> {
    const sichtbar = new Map<string, Set<string>>();
    const ohne = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, key: string, asset: string): void => {
        const set = map.get(key) ?? new Set<string>();
        set.add(asset);
        map.set(key, set);
    };
    for (const entry of verwendungen) {
        for (const key of entry.keys) {
            add(ohne, key, entry.assetId);
            if (entry.mitSchaltern) add(sichtbar, key, entry.assetId);
        }
    }
    const zahlen = new Map<string, { sichtbar: number; ausgeblendet: number }>();
    for (const [key, assets] of ohne) {
        const sehen = sichtbar.get(key) ?? new Set<string>();
        zahlen.set(key, {
            sichtbar: sehen.size,
            ausgeblendet: [...assets].filter((asset) => !sehen.has(asset)).length,
        });
    }
    return zahlen;
}

/** Der Inhalt der Zeile `detail` für den Grund `content_switch`: welche Bilder-Schalter gerade aus sind. */
export function detailInhaltsschalter(stand: Inhaltsstand): string | null {
    const aus = ausgeschaltet(stand).filter((key) => key.startsWith("media."));
    return aus.length === 0 ? null : aus.join(", ").slice(0, 500);
}

export interface QuarantaeneErgebnis {
    /** Neu aus dem Grund in Quarantäne (Zeilen). */
    added: number;
    /** Für den Grund aufgehoben (Zeilen). */
    lifted: number;
    /** Dateien nach `private/quarantine/` verschoben beziehungsweise zurück nach `published/`. */
    moved: number;
    restored: number;
    /** Bytes ohne Datei an beiden Stellen (Befund, kein Fehler). */
    missing: number;
    /** Bytes, für die gerade irgendein Grund aktiv ist. */
    active: number;
}

/**
 * Gleicht die Quarantäne eines Grundes mit seiner ganzen Zielmenge ab: neue Zeilen, aufgehobene Zeilen (in EINER Transaktion), danach
 * der Ort jeder Datei, die je in der Tafel stand.
 */
export async function gleicheQuarantaeneAb(
    db: Database,
    store: MediaStore,
    grund: QuarantineReason,
    ziel: ReadonlySet<string>,
    detail: string | null,
): Promise<QuarantaeneErgebnis> {
    const wanted = [...ziel].sort();
    const { added, lifted } = await db.begin(async (tx) => {
        const lifted = await tx<{ sha256: string }[]>`
            UPDATE media_quarantine SET restored_at = now()
             WHERE reason_kind = ${grund} AND restored_at IS NULL AND NOT (sha256 = ANY(${wanted}::text[]))
            RETURNING sha256
        `;
        const added = await tx<{ sha256: string }[]>`
            INSERT INTO media_quarantine (sha256, reason_kind, detail)
            SELECT s, ${grund}, ${detail} FROM unnest(${wanted}::text[]) AS s
            ON CONFLICT (sha256, reason_kind) WHERE restored_at IS NULL DO NOTHING
            RETURNING sha256
        `;
        return { added: added.length, lifted: lifted.length };
    });
    const rows = await db<{ sha256: string; active: boolean }[]>`
        SELECT sha256, bool_or(restored_at IS NULL) AS active FROM media_quarantine GROUP BY sha256 ORDER BY sha256
    `;
    const result: QuarantaeneErgebnis = { added, lifted, moved: 0, restored: 0, missing: 0, active: 0 };
    for (const row of rows) {
        const move: QuarantineMove = row.active
            ? await store.moveToQuarantine(row.sha256)
            : await store.restoreFromQuarantine(row.sha256);
        if (row.active) result.active += 1;
        if (move === "missing") result.missing += 1;
        else if (move === "moved" && row.active) result.moved += 1;
        else if (move === "moved") result.restored += 1;
    }
    return result;
}

/**
 * Die Quarantäne der Inhaltsschalter nachziehen: im Job `media_quarantine` und nach jedem Lauf, der öffentliche Dateien anlegen kann
 * (Binärimport, `media_settle`), damit eine neue Datei einer ausgeschalteten Art nicht unter `published/` stehen bleibt. Tut nichts
 * (`null`), wenn kein Bilder-Schalter aus ist und nichts in Quarantäne liegt.
 */
export async function zieheQuarantaeneNach(
    db: Database,
    store: MediaStore,
    stand?: Inhaltsstand,
): Promise<QuarantaeneErgebnis | null> {
    const aktuell = stand ?? (await leseInhaltsstand(db, { personen: false }));
    const medienAus = ausgeschaltet(aktuell).some((key) => key.startsWith("media."));
    if (!medienAus && (await quarantaeneAktiv(db)).size === 0) return null;
    const verwendungen = await oeffentlicheVerwendungen(db, aktuell);
    return gleicheQuarantaeneAb(
        db,
        store,
        "content_switch",
        zielInhaltsschalter(verwendungen),
        detailInhaltsschalter(aktuell),
    );
}

/** Die Bytes mit aktiver Quarantäne (für die Schutzregel in `migrate:media-files`, `media_settle` und `verify-media`). */
export async function quarantaeneAktiv(db: Queryable): Promise<Set<string>> {
    const [table] = await db<{ present: boolean }[]>`
        SELECT to_regclass('public.media_quarantine') IS NOT NULL AS present
    `;
    if (table?.present !== true) return new Set();
    const rows = await db<{ sha256: string }[]>`SELECT DISTINCT sha256 FROM media_quarantine WHERE restored_at IS NULL`;
    return new Set(rows.map((row) => row.sha256));
}
