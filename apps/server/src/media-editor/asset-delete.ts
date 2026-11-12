import { AVENTURIA, type MediaDeleteBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import type { MediaStore } from "../media/storage.ts";
import { vergissReisebilder } from "../photobox/karte.ts";
import { lockAsset } from "./asset-operations.ts";
import { mediaEditConflict } from "./audit.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "./operation-store.ts";
import { OFFENE_EINREICHUNGEN, loesePhotobox, photoboxBild, sperreEinreichungen } from "./photobox-loeschen.ts";
import { MEDIA_USAGE_TABLES } from "./usage-sql.ts";
import { vorschlagsBild } from "./vorschlag-loeschen.ts";

/**
 * Endgültig löschen (WI-0068 R4; Recht `delete_media`, nur Betreiber, Stufe S mit frischem Passkey, Betreiberentscheid 2026-10-09).
 *
 * 🔴 **Was gelöscht werden darf** (2026-10-17: Auf „Was darf „Endgültig löschen“ in der Medienverwaltung löschen?“ wählte der
 * Betreiber „A, nur eigene Uploads“, entscheidungen.md): ein eigener Upload (Herkunft `editor_upload`, keine Legacy-Herkunft)
 * ohne JEDE Verwendung, auch ohne zurückgezogene, ohne Galerieeintrag und ohne ★ als Typbild. Eine Zusammenführung (`media_merge`) hält das
 * Werk fest: Sie ist Verlauf, der auf beide Werke zeigt. Bilder aus Legacy bleiben bis zum Cutoff unlöschbar (sonst legte der nächste Zug sie
 * wieder an); von Avesmaps erzeugte (`project_generated`) ebenso, außer als Vorschau eines Vorschlagsbilds (unten).
 *
 * 🔴 **Ein Notaus hindert nicht mehr** (Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2, Antwort „B, löschbar“; Knopftext der Sitzung, kein
 * Betreiberzitat; Migration 0328). Er gilt den Bytes (`source_sha256`): Die Zeile bleibt mit Grund, Person, Zeit und Prüfsumme stehen, nur ihr
 * Verweis auf das Werk wird NULL (Fremdschlüssel `ON DELETE SET NULL`, der Wächter erlaubt genau diesen Übergang). Dieselben Bytes bleiben an
 * jedem anderen Werk und für jeden späteren Upload gesperrt (`media/notaus.ts` fragt über die Prüfsumme).
 *
 * 🔴 **Zwei Ausnahmen von „nur eigene Uploads“:**
 * - **Ein Bild aus einem Kartenvorschlag an stillgelegten Einträgen** (WI-0287; Vali 2026-11-07 auf „Soll der Betreiber Bilder aus
 *   Vorschlägen an stillgelegten Einträgen endgültig löschen dürfen?“: „Ja, erlauben“; die Bedingungen in `vorschlag-loeschen.ts`). Im selben Schritt fallen
 *   seine Bindungen an diese Einträge und die aus ihm erzeugten Vorschauen samt ihren Bindungen; der Vorschlag verliert sein Werk und behält den Zeitpunkt
 *   (`citymap_suggestion.media_deleted_at`, Migration 0322). Die Einträge bleiben stillgelegt; zurückgeholt stehen sie ohne dieses Bild da. Dafür nimmt die
 *   Operation die Sperre der Kartendomäne geteilt (503 `map_import_running` gegen den Legacy-Zug) und sperrt die Einträge, damit kein Zurückholen dazwischenkommt.
 * - **Ein PhotoBox-Bild einer entschiedenen Einreichung** (WI-0272; Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2, Antwort „Ja, bauen“; die Bedingungen in
 *   `photobox-loeschen.ts`). Im selben Schritt fallen seine Zeilen in `photobox_media`; beim aktuellen Bild wird die Einreichung gestempelt
 *   (`media_submission.media_deleted_at`, Migration 0328) und bleibt ohne Datei im Verlauf, ihre ersetzten Fassungen fallen mit. Erst die Einreichung, dann
 *   das Werk sperren, wie Redaktion und Einsender es tun.
 *
 * Geprüft wird auf dem Server im selben Schritt (Transaktion, Sperre des Assets, gesehene Revision). Gelöscht werden die Zeilen von
 * Dateien, Belegen, Rechten, Entstehung und Asset (die Herkunft `media_ingest` fällt per Fremdschlüssel mit); das Fachprotokoll bleibt,
 * es hängt an keinem Fremdschlüssel. Die Dateien fallen NACH der Transaktion, und nur, wenn keine andere Zeile sie noch hält
 * (bytegleiche Werke teilen sich Original und öffentliche Datei).
 */

/**
 * Warum ein Werk nicht gelöscht werden darf (`details.reason` bei 409 `media_not_deletable`, WI-0291: die Oberfläche sagt je Code einen Satz in jeder Sprache):
 * `legacy` importiert, `erzeugt` von Avesmaps erzeugt, `eingesandt` eingesandt ohne Einsendung, `in_use` verwendet, `merged` zusammengeführt, `vorschlag_aktiv`
 * hängt noch an einem geltenden Eintrag, `einreichung_offen` die PhotoBox-Einreichung wartet noch auf die Redaktion.
 */
type Hinderung = "legacy" | "erzeugt" | "eingesandt" | "in_use" | "merged" | "vorschlag_aktiv" | "einreichung_offen";

const nichtLoeschbar = (reason: Hinderung, details: Record<string, number> = {}): ApiError =>
    new ApiError(409, "media_not_deletable", SAETZE[reason], { reason, ...details });

const SAETZE: Readonly<Record<Hinderung, string>> = {
    legacy: "Importierte Bilder lassen sich nicht löschen.",
    erzeugt: "Von Avesmaps erzeugte Bilder lassen sich nicht löschen.",
    eingesandt: "Dieses eingesandte Bild gehört zu keiner Einsendung; es lässt sich nicht löschen.",
    in_use: "Dieses Bild wird noch verwendet (auch zurückgezogene Verwendungen zählen).",
    merged: "Dieses Bild ist Teil einer Zusammenführung.",
    vorschlag_aktiv:
        "Dieses Bild stammt aus einem Kartenvorschlag. Es lässt sich erst löschen, wenn jeder Eintrag entfernt ist, an dem es oder seine erzeugte Vorschau hängt.",
    einreichung_offen: "Dieses Bild gehört zu einer offenen Einsendung der PhotoBox. Erst freigeben oder ablehnen.",
};

/** Warum ein Werk ohne Ausnahme an seiner Herkunft scheitert: erzeugt, eingesandt oder importiert. */
function herkunftsGrund(origin: string): Hinderung {
    if (origin === "project_generated") return "erzeugt";
    if (origin === "community_upload") return "eingesandt";
    return "legacy";
}

interface Bestand {
    origin: string;
    legacy: boolean;
    verwendungen: number;
    zusammenfuehrungen: number;
    notaus: number;
}

/**
 * Jede Zeile jeder Verwendungstafel zählt, aktiv oder zurückgezogen. 🔴 Die Tafeln kommen aus EINER Liste (`MEDIA_USAGE_TABLES`),
 * dieselbe wie für Reverse Usage: Eine neue Verwendungsart, die dort fehlte, ließe sonst ein verwendetes Werk löschen.
 */
const VERWENDUNGEN_SQL = MEDIA_USAGE_TABLES.map(
    (table) => `(SELECT count(*) FROM ${table} WHERE media_asset_id = a.id)`,
).join(" + ");

async function bestand(tx: Queryable, assetId: string): Promise<Bestand> {
    const [row] = await tx.unsafe<Bestand[]>(
        `SELECT a.origin,
                EXISTS (SELECT 1 FROM media_legacy_source l WHERE l.media_asset_id = a.id) AS legacy,
                (${VERWENDUNGEN_SQL})::int AS verwendungen,
                (SELECT count(*) FROM media_merge WHERE merged_asset_id = a.id OR kept_asset_id = a.id)::int AS zusammenfuehrungen,
                (SELECT count(*) FROM media_publication_suspension WHERE media_asset_id = a.id)::int AS notaus
           FROM media_asset a WHERE a.id = $1::bigint`,
        [assetId],
    );
    return row!;
}

/** Was nach der Transaktion von der Platte fallen kann. */
interface Datei {
    key: string;
    published: boolean;
    sha256: string;
}

/**
 * Die Zeilen eines Werks löschen (Dateien, Belege, Rechte, Entstehung, Werk); gibt die Dateien zurück, die danach fallen können. Ein Notaus am Werk verliert dabei
 * seinen Verweis (`ON DELETE SET NULL`, Migration 0328) und bleibt stehen.
 */
async function loescheWerk(
    tx: Queryable,
    assetId: string,
): Promise<{ dateien: Datei[]; files: number; evidence: number }> {
    const files = await tx<{ storage_key: string; storage_class: string; sha256: string }[]>`
        DELETE FROM media_file WHERE media_asset_id = ${assetId} RETURNING storage_key, storage_class, sha256
    `;
    const belege = await tx<{ storage_key: string | null }[]>`
        DELETE FROM media_rights_evidence WHERE media_asset_id = ${assetId} RETURNING storage_key
    `;
    await tx`DELETE FROM media_rights WHERE media_asset_id = ${assetId}`;
    await tx`DELETE FROM media_creation WHERE media_asset_id = ${assetId}`;
    await tx`DELETE FROM media_asset WHERE id = ${assetId}`;
    const dateien: Datei[] = files.map((file) => ({
        key: file.storage_key,
        published: file.storage_class === "published",
        sha256: file.sha256,
    }));
    for (const beleg of belege) {
        if (beleg.storage_key !== null) dateien.push({ key: beleg.storage_key, published: false, sha256: "" });
    }
    return { dateien, files: files.length, evidence: belege.length };
}

/** Wie viele Notaus-Zeilen beim Löschen ihren Verweis verlieren; nur, wenn es welche gibt (Positivliste `asset.deleted`). */
const notausDetail = (notaus: number): { suspensions?: number } => (notaus > 0 ? { suspensions: notaus } : {});

/**
 * Die Bindungen eines Werks an stillgelegte Einträge lösen (nur der Weg des Vorschlagsbilds). Die Einträge sind vorher gesperrt und geprüft; hängt das Werk
 * doch noch woanders, scheitert das Löschen des Werks am Fremdschlüssel, und nichts ist geschehen.
 */
async function loeseStillgelegte(tx: Queryable, assetId: string): Promise<{ eintrag: string; n: number }[]> {
    return tx<{ eintrag: string; n: number }[]>`
        WITH d AS (
            DELETE FROM citymap_media m USING citymap c
             WHERE m.media_asset_id = ${assetId} AND c.id = m.citymap_id AND c.state = 'retired'
            RETURNING c.public_id::text AS eintrag
        )
        SELECT eintrag, count(*)::int AS n FROM d GROUP BY eintrag ORDER BY eintrag
    `;
}

/** Ein Werk endgültig löschen (`MediaDeleteBody`); die Dateien fallen nach der Operation, wenn nichts sie mehr hält. */
export async function deleteAsset(
    database: Database,
    store: MediaStore,
    actor: MediaActor,
    assetPublicId: string,
    body: MediaDeleteBody,
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const dateien: Datei[] = [];
    let reisebild = false;
    const quittung = await mediaOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "asset.delete", body: { assetId: assetPublicId } },
        async (tx) => {
            // Erst die Einreichung eines Reisebilds, dann das Werk (photobox-loeschen.ts); bei jedem anderen Werk sperrt das nichts.
            await sperreEinreichungen(tx, assetPublicId);
            const asset = await lockAsset(tx, assetPublicId);
            if (asset.revision !== body.baseRevision) {
                throw await mediaEditConflict(
                    tx,
                    { record: "asset", assetId: assetPublicId },
                    { revision: asset.revision, changedAt: asset.updatedAt },
                );
            }
            const stand = await bestand(tx, asset.id);
            if (stand.legacy) throw nichtLoeschbar("legacy");
            const ausVorschlag = stand.origin === "editor_upload" ? undefined : await vorschlagsBild(tx, asset.id);
            const ausPhotobox =
                stand.origin === "editor_upload" || ausVorschlag !== undefined
                    ? undefined
                    : await photoboxBild(tx, asset.id);
            if (ausVorschlag !== undefined) {
                if (!ausVorschlag.nurStillgelegt)
                    throw nichtLoeschbar("vorschlag_aktiv", { usages: stand.verwendungen });
            } else if (ausPhotobox !== undefined) {
                if (OFFENE_EINREICHUNGEN.includes(ausPhotobox.zustand)) throw nichtLoeschbar("einreichung_offen");
                if (ausPhotobox.anderswo > 0) throw nichtLoeschbar("in_use", { usages: ausPhotobox.anderswo });
            } else {
                if (stand.origin !== "editor_upload") throw nichtLoeschbar(herkunftsGrund(stand.origin));
                if (stand.verwendungen > 0) throw nichtLoeschbar("in_use", { usages: stand.verwendungen });
            }
            if (stand.zusammenfuehrungen > 0) throw nichtLoeschbar("merged");

            const entries: MediaAuditEntry[] = [];
            const affected: OperationReceipt["affected"] = [];
            let geloest = 0;
            if (ausVorschlag !== undefined) {
                const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
                const [frei] = await tx<{ ok: boolean }[]>`
                    SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
                `;
                if (frei?.ok !== true) throw mapImportRunning();
                // Erst sperren (Vorschauen, dann Einträge), dann erneut lesen: Was zwischen Lesen und Löschen geschah, sieht die Prüfung so noch.
                await tx`
                    SELECT 1 FROM media_asset WHERE generated_from_asset_id = ${asset.id}::bigint ORDER BY id FOR UPDATE
                `;
                await tx`
                    SELECT 1 FROM citymap c
                     WHERE c.id IN (
                         SELECT m.citymap_id FROM citymap_media m
                          WHERE m.media_asset_id = ${asset.id}::bigint
                             OR m.media_asset_id IN (SELECT v.id FROM media_asset v WHERE v.generated_from_asset_id = ${asset.id}::bigint)
                     )
                     ORDER BY c.id FOR UPDATE OF c
                `;
                const gesperrt = await vorschlagsBild(tx, asset.id);
                if (gesperrt?.nurStillgelegt !== true) {
                    throw nichtLoeschbar("vorschlag_aktiv", { usages: stand.verwendungen });
                }
                for (const vorschauId of gesperrt.vorschauen) {
                    const vorschau = await bestand(tx, vorschauId);
                    if (vorschau.legacy) throw nichtLoeschbar("legacy");
                    if (vorschau.zusammenfuehrungen > 0) throw nichtLoeschbar("merged");
                    const [kennung] = await tx<{ public_id: string; revision: number }[]>`
                        SELECT public_id::text AS public_id, revision::int AS revision FROM media_asset WHERE id = ${vorschauId}::bigint
                    `;
                    const eintraege = await loeseStillgelegte(tx, vorschauId);
                    const weg = await loescheWerk(tx, vorschauId);
                    dateien.push(...weg.dateien);
                    const usages = eintraege.reduce((summe, zeile) => summe + zeile.n, 0);
                    geloest += usages;
                    affected.push({ kind: "media_asset", id: kennung!.public_id });
                    entries.push({
                        action: "asset.deleted",
                        assetId: kennung!.public_id,
                        targetRevision: kennung!.revision,
                        details: {
                            files: weg.files,
                            evidence: weg.evidence,
                            usages,
                            source: assetPublicId,
                            ...notausDetail(vorschau.notaus),
                        },
                    });
                    for (const { eintrag } of eintraege) {
                        entries.push({
                            action: "citymap.updated",
                            assetId: kennung!.public_id,
                            citymapId: eintrag,
                            details: { fields: ["images"] },
                        });
                    }
                }
                const eintraege = await loeseStillgelegte(tx, asset.id);
                geloest += eintraege.reduce((summe, zeile) => summe + zeile.n, 0);
                for (const { eintrag } of eintraege) {
                    entries.push({
                        action: "citymap.updated",
                        assetId: assetPublicId,
                        citymapId: eintrag,
                        details: { fields: ["images"] },
                    });
                }
                await tx`
                    UPDATE citymap_suggestion SET media_asset_id = NULL, media_deleted_at = now()
                     WHERE media_asset_id = ${asset.id}::bigint
                `;
            }

            if (ausPhotobox !== undefined) {
                reisebild = true;
                // Erst die Einreichung stempeln (sie hält das freigegebene Werk per Fremdschlüssel), dann die ersetzten Fassungen, dann das Werk.
                const geloestePhotobox = await loesePhotobox(tx, asset.id, ausPhotobox);
                geloest += geloestePhotobox.zeilen;
                for (const ersetztId of ausPhotobox.ersetzte) {
                    const ersetzt = await bestand(tx, ersetztId);
                    if (ersetzt.legacy) throw nichtLoeschbar("legacy");
                    if (ersetzt.verwendungen > 0) throw nichtLoeschbar("in_use", { usages: ersetzt.verwendungen });
                    if (ersetzt.zusammenfuehrungen > 0) throw nichtLoeschbar("merged");
                    const [kennung] = await tx<{ public_id: string; revision: number }[]>`
                        SELECT public_id::text AS public_id, revision::int AS revision FROM media_asset WHERE id = ${ersetztId}::bigint
                    `;
                    const weg = await loescheWerk(tx, ersetztId);
                    dateien.push(...weg.dateien);
                    affected.push({ kind: "media_asset", id: kennung!.public_id });
                    entries.push({
                        action: "asset.deleted",
                        assetId: kennung!.public_id,
                        targetRevision: kennung!.revision,
                        details: {
                            files: weg.files,
                            evidence: weg.evidence,
                            source: assetPublicId,
                            ...notausDetail(ersetzt.notaus),
                        },
                    });
                }
                if (geloestePhotobox.revision !== undefined) {
                    entries.push({
                        action: "photobox.media_deleted",
                        assetId: assetPublicId,
                        targetRevision: geloestePhotobox.revision,
                        details: { previous: ausPhotobox.zustand, versions: ausPhotobox.ersetzte.length },
                    });
                }
            }

            const weg = await loescheWerk(tx, asset.id);
            dateien.push(...weg.dateien);
            entries.unshift({
                action: "asset.deleted",
                assetId: assetPublicId,
                targetRevision: asset.revision,
                details: {
                    files: weg.files,
                    evidence: weg.evidence,
                    ...(ausVorschlag === undefined ? {} : { usages: geloest, previews: affected.length }),
                    ...(ausPhotobox === undefined ? {} : { usages: geloest }),
                    ...notausDetail(stand.notaus),
                },
            });
            return {
                receipt: {
                    affected: [{ kind: "media_asset", id: assetPublicId }, ...affected],
                    derivedWork: [],
                    warnings: [],
                },
                entries,
            };
        },
    );
    // Ein gelöschtes Reisebild soll sofort von der Karte: Der Zwischenspeicher des Lesepfads (S4) fängt von vorn an.
    if (reisebild) vergissReisebilder();
    // Nach der Transaktion: eine Datei fällt nur, wenn keine lebende Zeile sie mehr hält (bytegleiche Werke teilen sie sich; eine gestempelte Zeile hält nichts, WI-0275).
    for (const datei of dateien) {
        const [gehalten] = await database<{ held: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM media_file WHERE storage_key = ${datei.key} AND bytes_deleted_at IS NULL)
                OR EXISTS (SELECT 1 FROM media_rights_evidence WHERE storage_key = ${datei.key}) AS held
        `;
        if (gehalten?.held === true) continue;
        await store.removeAfterDelete(datei.key);
        if (datei.published) await store.removeQuarantined(datei.sha256);
    }
    return quittung;
}
