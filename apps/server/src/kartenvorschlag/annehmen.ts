import {
    AVENTURIA,
    type KartenvorschlagAnnehmen,
    type KartenvorschlagZustand,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { mapImportRunning } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { notFound } from "../media-editor/asset-operations.ts";
import { versionsBezeichnung } from "../media-editor/kartensammlung-bilder.ts";
import { ergaenzeLinks, haengeVersionAn, zielStillgelegt } from "../media-editor/kartensammlung-zusammenlegen.ts";
import { mediaOperation, type MediaActor, type MediaAuditEntry } from "../media-editor/operation-store.ts";
import { enqueueSettle } from "../media-editor/settle.ts";
import { technikNachziehen, ungueltig } from "./db.ts";

/**
 * Einen Kartenvorschlag annehmen (WI-0275 Stufe B2, Operation `kartenvorschlag.accept`): Die Redaktion (`moderate_submissions`) macht aus dem Vorschlag
 * eine Karte der Kartensammlung. Das ist der EINE Weg, auf dem ein Besucher-Vorschlag zur Zeile in `citymap` wird; er läuft als gewöhnliche Operation
 * einer berechtigten Person, wie `citymap.update` (`media-editor/kartensammlung-schreiben.ts`).
 *
 * - **Aus `pending`**, gegen die Revision, die die Oberfläche sah (409 `kartenvorschlag_conflict`). Schon angenommen: der Stand kommt zurück, ohne zweite
 *   Karte und ohne zweites Ereignis (auch mit neuer Kennung). Jeder andere Zustand ist 409 `kartenvorschlag_transition`. Dieselbe Kennung wiederholt die
 *   Quittung (M10).
 * - **Die Karte** übernimmt nur, was der Vorschlag nennt: Titel, Art, Farbe, die dreiwertigen Merkmale (fehlt eine Angabe, bleibt sie unbekannt, nie „nein“),
 *   Zeitraum, Zeichner, die Beschreibung als Notiz; die Typen als `citymap_type`; der Ort, den die Redaktion im Blatt wählt, sonst der des Vorschlags, als `citymap_place` (aufgelöst, Herkunft `editor`); ein Link als
 *   Karten-Link (`citymap_link`, `primary`; die Quelle als Beschriftung, `is_paid` aus der Angabe). Die Quelle einer Datei und eine zu lange Quelle stehen
 *   am Ende der Notiz. Nicht übernommen werden die Notiz an die Redaktion, der Name des Einreichers und der externe Vorschaulink (Legacy-Lehre: ein
 *   Fremdbild wird nie Asset).
 * - **Das Werk einer Datei** wird an die Karte gebunden (`citymap_media`, Rolle `map_full`, Herkunft `editor`, keine Einzelfreigabe) und `approved`. 🔴 Die
 *   Annahme gibt die Karte frei (Betreiber 2026-11-06, WI-0282): Der Prüfstand wird `cleared`, gleich unter welcher Lizenzwahl. Die Lizenz des Einreichers bleibt, wie sie ist;
 *   ein abgelehntes Recht bleibt abgelehnt. Der Abgleich der Rolle wird eingereiht und veröffentlicht nach der Policy (`decidePublication`).
 * - 🔴 **Schutz gegen den Legacy-Zug (I21):** Die Zeile `citymap.created` im Fachprotokoll der Medien hält die Karte wie `citymap.updated` (`karte-gehalten.ts`,
 *   eine Mechanik): Der Zug legt sie nicht still und überschreibt weder sie noch ihre Typen, Orte und Fundstellen. Gegen einen laufenden Zug nimmt die Annahme
 *   die Sperre der Kartendomäne geteilt (503 `map_import_running`), wie jedes Speichern im Editor.
 * - **Als weitere Version eines Eintrags** (WI-0287 Stufe 2, `targetId`): Es entsteht keine neue Karte. Die Datei wird eine weitere Version des Eintrags (ans Ende, Bezeichnung
 *   `versionLabel`), der Link kommt zu seinen Fundstellen (ans Ende; hat er keinen Karten-Link, wird es dieser); Titel, Angaben und Orte des Eintrags bleiben, und der Ort des
 *   Vorschlags bleibt, wie er war. Der Eintrag wird gesperrt, aber ohne gesehenen Stand (das Blatt kennt seine Revision nicht); stillgelegt ist 409 `citymap_target_retired`,
 *   unbekannt 404. Die Zeile `citymap.updated` (`fields`) hält ihn gegen den Zug. Freigabe, Abgleich, Ereignis und `accepted_citymap_id` (dann der Eintrag) wie beim neuen.
 */

export interface AngenommenerVorschlag {
    receipt: OperationReceipt;
    /** Hat die Annahme etwas geändert (`false`: war schon angenommen)? */
    wirklich: boolean;
}

interface Zeile {
    id: string;
    state: KartenvorschlagZustand;
    revision: number;
    way: "link" | "file";
    title: string;
    description: string | null;
    source_text: string | null;
    link_url: string | null;
    place_id: string | null;
    type_keys: string[];
    author: string | null;
    art: string | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    color_mode: string | null;
    is_spoiler: boolean | null;
    is_labeled: boolean | null;
    is_multilevel: boolean | null;
    is_official: boolean | null;
    is_paid: boolean | null;
    asset_id: string | null;
    asset_public_id: string | null;
    technical_state: string | null;
    moderation_state: string | null;
    citymap_public_id: string | null;
}

/** Die Länge, bis zu der die Quelle eines Links die Beschriftung des Karten-Links wird (Legacy: Link-Titel bis 200 Zeichen). */
const BESCHRIFTUNG_MAX = 200;

const nichtMehr = (): ApiError =>
    new ApiError(409, "kartenvorschlag_transition", "Das geht bei diesem Kartenvorschlag nicht (mehr).");

/** Die Notiz der Karte: die Beschreibung des Vorschlags und, wo die Quelle nicht Beschriftung des Links ist, die Quelle darunter. */
export function notizDerKarte(beschreibung: string | null, quelle: string | null, imLink: boolean): string | null {
    const teile: string[] = [];
    if (beschreibung !== null) teile.push(beschreibung);
    if (quelle !== null && !imLink) teile.push(`Quelle: ${quelle}`);
    return teile.length === 0 ? null : teile.join("\n\n");
}

/**
 * Nimmt den Vorschlag an. `ereignis` schreibt das Ereignis des Anmeldeprotokolls in derselben Transaktion und wird nur gerufen, wenn wirklich etwas
 * geschah (nicht bei einer Wiederholung).
 */
export async function annehmen(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: KartenvorschlagAnnehmen,
    ereignis: (tx: Sql, kennungen: { vorschlag: string; karte: string }) => Promise<void>,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene, damit sie fremde Läufe nicht aufhalten. */
    optionen: { mapDomainId?: string } = {},
): Promise<AngenommenerVorschlag> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    let wirklich = false;
    const receipt = await mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "kartenvorschlag.accept",
            body: {
                id: publicId,
                baseRevision: body.baseRevision,
                ...(body.placeId === undefined ? {} : { placeId: body.placeId }),
                ...(body.targetId === undefined ? {} : { targetId: body.targetId }),
                ...(body.targetId === undefined ? {} : { versionLabel: versionsBezeichnung(body.versionLabel) }),
            },
        },
        async (tx) => {
            const [frei] = await tx<{ ok: boolean }[]>`
                SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene})) AS ok
            `;
            if (frei?.ok !== true) throw mapImportRunning();
            // Die technische Prüfung der Datei zuerst nachziehen (der Abgleich im Worker schreibt die Tafel nicht), dann die Zeile sperren.
            const [vorab] = await tx<
                { id: string }[]
            >`SELECT id::text AS id FROM citymap_suggestion WHERE public_id = ${publicId}::uuid`;
            if (vorab === undefined)
                throw new ApiError(404, "kartenvorschlag_not_found", "Diesen Kartenvorschlag gibt es nicht.");
            await technikNachziehen(tx, vorab.id);
            const [zeile] = await tx<Zeile[]>`
                SELECT s.id::text AS id, s.state, s.revision::int AS revision, s.way, s.title, s.description, s.source_text, s.link_url,
                       s.place_id::text AS place_id, s.type_keys, s.author, s.art, s.valid_from_bf, s.valid_to_bf, s.color_mode, s.is_spoiler,
                       s.is_labeled, s.is_multilevel, s.is_official, s.is_paid, s.media_asset_id::text AS asset_id,
                       a.public_id::text AS asset_public_id, a.technical_state, a.moderation_state, c.public_id::text AS citymap_public_id
                  FROM citymap_suggestion s
                  LEFT JOIN media_asset a ON a.id = s.media_asset_id
                  LEFT JOIN citymap c ON c.id = s.accepted_citymap_id
                 WHERE s.id = ${vorab.id}::bigint
                   FOR UPDATE OF s
            `;
            if (zeile === undefined)
                throw new ApiError(404, "kartenvorschlag_not_found", "Diesen Kartenvorschlag gibt es nicht.");
            if (zeile.state === "approved") {
                // Wiederholung mit neuer Kennung: der Stand, keine zweite Karte.
                return {
                    receipt: {
                        affected: [{ kind: "citymap", id: zeile.citymap_public_id ?? "", revision: 1 }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                };
            }
            if (zeile.state !== "pending") throw nichtMehr();
            if (zeile.revision !== body.baseRevision) {
                throw new ApiError(
                    409,
                    "kartenvorschlag_conflict",
                    "Dieser Kartenvorschlag wurde inzwischen geändert.",
                    {
                        revision: zeile.revision,
                    },
                );
            }
            if (zeile.way === "file" && (zeile.asset_id === null || zeile.technical_state !== "ok")) throw nichtMehr();

            const quelle = zeile.source_text;
            const imLink = zeile.way === "link" && quelle !== null && quelle.length <= BESCHRIFTUNG_MAX;
            const linkText = imLink && quelle !== null ? quelle : "Karte";
            /** Das Werk einer Datei (Kennung in der Datenbank); ein Link hat keins. */
            const datei =
                zeile.way === "file" && zeile.asset_id !== null && zeile.asset_public_id !== null
                    ? { db: zeile.asset_id }
                    : undefined;

            /** Die Karte, die den Vorschlag aufnimmt, ihre Zeile im Fachprotokoll und (beim neuen Eintrag) der Ort. */
            let karte: { id: string; public_id: string; revision: number };
            let zeileDerKarte: MediaAuditEntry;
            let ort: { id: string; name: string } | undefined;
            if (body.targetId !== undefined) {
                // Als weitere Version eines vorhandenen Eintrags (WI-0287 Stufe 2): keine neue Karte, Titel, Angaben und Orte des Eintrags bleiben.
                const [ziel] = await tx<{ id: string; public_id: string; revision: number; state: string }[]>`
                    SELECT id::text AS id, public_id::text AS public_id, revision::int AS revision, state
                      FROM citymap WHERE public_id = ${body.targetId}::uuid FOR UPDATE
                `;
                if (ziel === undefined) throw notFound("Dieser Eintrag der Kartensammlung");
                if (ziel.state !== "active") throw zielStillgelegt();
                const felder: string[] = [];
                if (
                    datei !== undefined &&
                    (await haengeVersionAn(tx, ziel.id, datei.db, versionsBezeichnung(body.versionLabel)))
                ) {
                    felder.push("images");
                }
                if (zeile.way === "link" && zeile.link_url !== null) {
                    const dazu = await ergaenzeLinks(tx, ziel.id, [
                        { url: zeile.link_url, label: linkText, isPaid: zeile.is_paid, legacyOrigin: "community" },
                    ]);
                    if (dazu > 0) felder.push("links");
                }
                const [neu] = await tx<{ revision: number }[]>`
                    UPDATE citymap SET updated_at = now(), revision = ${ziel.revision + 1}
                     WHERE id = ${ziel.id}::bigint RETURNING revision::int AS revision
                `;
                karte = { id: ziel.id, public_id: ziel.public_id, revision: neu!.revision };
                zeileDerKarte = {
                    action: "citymap.updated",
                    citymapId: karte.public_id,
                    assetId: zeile.asset_public_id,
                    targetRevision: karte.revision,
                    details: { fields: felder },
                };
            } else {
                // Der Ort: der aus dem Blatt, ohne Angabe der des Vorschlags, `null` heißt keiner. Der Name steht als Rohname an der Karte (wie Legacy), das Ziel ist aufgelöst.
                if (body.placeId !== undefined && body.placeId !== null) {
                    [ort] = await tx<{ id: string; name: string }[]>`
                        SELECT id::text AS id, name FROM place
                         WHERE public_id = ${body.placeId}::uuid AND map_domain_id = ${AVENTURIA.mapDomain} AND is_active
                    `;
                    if (ort === undefined) throw ungueltig("Diesen Ort gibt es nicht.", "ort_unbekannt");
                } else if (body.placeId === undefined && zeile.place_id !== null) {
                    [ort] = await tx<
                        { id: string; name: string }[]
                    >`SELECT id::text AS id, name FROM place WHERE id = ${zeile.place_id}::bigint`;
                }
                const notiz = notizDerKarte(zeile.description, quelle, imLink);
                const [angelegt] = await tx<{ id: string; public_id: string; revision: number }[]>`
                    INSERT INTO citymap (public_id, title, art, color_mode, is_multilevel, is_labeled, is_official, is_spoiler, valid_from_bf, valid_to_bf,
                                         author, note, legacy_origin, source_system)
                    VALUES (gen_random_uuid(), ${zeile.title}, ${zeile.art}, ${zeile.color_mode}, ${zeile.is_multilevel}, ${zeile.is_labeled},
                            ${zeile.is_official}, ${zeile.is_spoiler}, ${zeile.valid_from_bf}, ${zeile.valid_to_bf}, ${zeile.author}, ${notiz},
                            'community', 'avesmaps3d')
                    RETURNING id::text AS id, public_id::text AS public_id, revision::int AS revision
                `;
                if (angelegt === undefined) throw new Error("citymap: INSERT ohne Zeile");
                karte = angelegt;

                if (zeile.type_keys.length > 0) {
                    await tx`
                        INSERT INTO citymap_type (citymap_id, type_key, source_system)
                        SELECT ${karte.id}::bigint, k, 'avesmaps3d' FROM unnest(${zeile.type_keys}::text[]) AS k
                    `;
                }
                if (ort !== undefined) {
                    await tx`
                        INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, resolved_by,
                                                   place_id, target_origin, legacy_origin, source_system)
                        VALUES (${karte.id}::bigint, 0, 0, ${ort.name.trim().toLowerCase()}, 0, ${ort.name}, 'resolved', 'public_id',
                                ${ort.id}::bigint, 'editor', 'community', 'avesmaps3d')
                    `;
                }
                if (zeile.way === "link" && zeile.link_url !== null) {
                    await tx`
                        INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position, legacy_origin, source_system)
                        VALUES (${karte.id}::bigint, 'primary', ${zeile.link_url}, ${linkText}, ${zeile.is_paid}, 0,
                                'community', 'avesmaps3d')
                    `;
                }
                if (datei !== undefined) {
                    await tx`
                        INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
                        VALUES (${karte.id}::bigint, ${datei.db}::bigint, 'map_full', 'editor')
                    `;
                }
                zeileDerKarte = {
                    action: "citymap.created",
                    citymapId: karte.public_id,
                    assetId: zeile.asset_public_id,
                    targetRevision: karte.revision,
                    details: { way: zeile.way, types: zeile.type_keys.length, place: ort !== undefined },
                };
            }

            const derivedWork = [];
            const freigabe: MediaAuditEntry[] = [];
            if (datei !== undefined && zeile.asset_id !== null && zeile.asset_public_id !== null) {
                await tx`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${zeile.asset_id}::bigint`;
                // Die Annahme ist die Freigabe (WI-0282): Eine Person der Redaktion hat die Karte gesehen.
                const [rechte] = await tx<{ clearance_state: string }[]>`
                    SELECT clearance_state FROM media_rights WHERE media_asset_id = ${zeile.asset_id}::bigint FOR UPDATE
                `;
                const [geprueft] = await tx<{ revision: number }[]>`
                    UPDATE media_rights
                       SET clearance_state = 'cleared', reviewed_at = now(), reviewed_by_person = ${actor.personId}::uuid,
                           reviewed_by = NULL, updated_at = now()
                     WHERE media_asset_id = ${zeile.asset_id}::bigint
                       AND clearance_state <> 'rejected' AND rights_basis <> 'unknown'
                    RETURNING revision::int AS revision
                `;
                if (geprueft !== undefined) {
                    freigabe.push({
                        action: "rights.reviewed",
                        assetId: zeile.asset_public_id,
                        targetRevision: geprueft.revision,
                        details: { decision: "cleared", previous: rechte?.clearance_state ?? null },
                    });
                }
                derivedWork.push(
                    await enqueueSettle(tx, {
                        assetPublicId: zeile.asset_public_id,
                        role: "map_full",
                        actorPersonId: actor.personId,
                    }),
                );
            }
            // Als Version bleibt der Ort des Vorschlags, wie er war; der neue Eintrag nennt den, den er bekam.
            const ortDesVorschlags = body.targetId === undefined ? (ort?.id ?? null) : zeile.place_id;
            await tx`
                UPDATE citymap_suggestion
                   SET state = 'approved', state_changed_at = now(), decided_at = now(), decided_by = ${actor.personId}::uuid,
                       accepted_citymap_id = ${karte.id}::bigint, place_id = ${ortDesVorschlags}::bigint
                 WHERE id = ${zeile.id}::bigint
            `;
            await ereignis(tx, { vorschlag: publicId, karte: karte.public_id });
            wirklich = true;
            return {
                receipt: {
                    affected: [{ kind: "citymap", id: karte.public_id, revision: karte.revision }],
                    derivedWork,
                    warnings: [],
                },
                entries: [zeileDerKarte, ...freigabe],
            };
        },
    );
    return { receipt, wirklich };
}
