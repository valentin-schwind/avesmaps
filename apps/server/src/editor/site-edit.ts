import { SITE_ADD_MAX, type OperationReceipt, type SiteAddBody, type SiteRelationBody } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { nachfolgerSql } from "./nachfolgesitz.ts";
import { domainOf, readPlace } from "./place-edit.ts";

/**
 * Die Innerorts-Beziehung einer Stätte zuordnen, verlagern und entkoppeln (WI-0128 E10b; EDIT-0001 G3; Abschlussauftrag
 * 2026-10-13 §3.2.5).
 *
 * 🔴 **Nur über Kennungen.** Die Stätte nennt ihre `site.id`, der Ort steht in der Adresse. Kein Name, keine Adresse, kein
 * Linkziel wird je zu einer Beziehung (WI-0134 §3 Regel 2, Betreiber 2026-10-10). Eine hier entstandene Zeile trägt
 * `origin = 'editor'`; kein Legacy-Zug fasst sie wieder an (`site_settlement`, 0099).
 *
 * 🔴 **Verlagern ist EINE Operation** (G3): War die Stätte an einem anderen Ort gebunden, geht die alte Zeile in derselben
 * Transaktion still und die neue entsteht; das Fachprotokoll bekommt einen Eintrag an BEIDEN Orten. Eine stille Feldmutation
 * wäre im Verlauf nicht zu sehen.
 *
 * 🪤 **Die Revision des Orts steigt nicht.** Am Ort selbst ändert sich nichts - weder Name noch Lage noch ein Feld; was sich
 * ändert, ist die Beziehung einer anderen Sache zu ihm. Stiege sie doch, verlöre jeder offene Entwurf im Ortseditor seine
 * Basis und bekäme beim Speichern einen Konflikt, den niemand verursacht hat. Der Protokolleintrag trägt darum dieselbe
 * Revision vor und nach der Operation.
 */

interface SiteRow {
    id: string;
    name: string;
    source_kind: string;
    source_key: string;
    site_active: boolean;
    /** Die Zeile der Beziehung, AUCH wenn sie still liegt: Es gibt nur eine je Stätte, und sie wird wiederverwendet. */
    relation_id: string | null;
    relation_active: boolean | null;
    relation_origin: string | null;
    relation_place_id: string | null;
    relation_place_public_id: string | null;
    relation_place_name: string | null;
}

/**
 * Die Sperre je Stätte, für die Dauer der Transaktion (`pg_advisory_xact_lock`): Namensraum `<Tabelle>:schreiben` wie
 * `map_setting:schreiben`, `zoom_band:schreiben` und `map_series:schreiben`, mit der Kennung der Stätte als zweitem Schlüssel (Form
 * der Schriftlaufsperre in `derive/refresh-label-curve.ts`).
 *
 * 🔴 **Nicht `SELECT … FOR UPDATE` auf `site`:** Das verlangt in PostgreSQL das UPDATE-Recht, auch wenn niemand schreibt, und die App
 * hat an `site` nur SELECT (`map-grants.psql`: die Stätte selbst schreibt allein der Import). Auf Stage und Production endete jedes
 * Zuordnen, Umhängen und Lösen mit 42501 „permission denied for table site“; lokal und in den Servertests fiel es nicht auf, weil dort als
 * Eigentümer gearbeitet wird. Der Wächter ist `schreibwege-app-rolle.test.ts`, der als App-Rolle schreibt.
 */
export const STAETTEN_SPERRE = "site:schreiben";

/**
 * Die Stätte samt ihrer aktiven Beziehung, für diese Transaktion gesperrt: Erst die Sperre der Stätte (`STAETTEN_SPERRE`), dann wird
 * gelesen. 🪤 Die Reihenfolge trägt: Die Transaktion läuft unter READ COMMITTED, jede Anweisung sieht den Stand beim eigenen Beginn.
 * Wer wartet, liest darum nach dem Warten, was der Vorgänger festgeschrieben hat; läse er davor, bände er auf einem Stand, den es nicht
 * mehr gibt.
 *
 * Die Kennung geht als `bigint` in den Schlüssel ein, nicht als Zeichenkette: `007` und `7` sind dieselbe Stätte und müssen dieselbe
 * Sperre nehmen.
 *
 * 🪤 Auch eine STILLGELEGTE Stätte kommt zurück (B4): An ihr hängt womöglich noch eine Beziehung, und genau die will das
 * Umhängen bewegen. Wer sie nicht haben will, prüft `site_active` selbst.
 */
async function lockedSite(tx: Sql, siteId: string): Promise<SiteRow> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${STAETTEN_SPERRE}), hashtext(${siteId}::bigint::text))`;
    const [row] = await tx<SiteRow[]>`
        SELECT s.id::text AS id, s.name, s.source_kind, s.source_key, s.is_active AS site_active,
               ss.id::text AS relation_id, ss.is_active AS relation_active, ss.origin AS relation_origin,
               ss.place_id::text AS relation_place_id,
               p.public_id::text AS relation_place_public_id, p.name AS relation_place_name
          FROM site s
          LEFT JOIN site_settlement ss ON ss.site_id = s.id
          LEFT JOIN place p ON p.id = ss.place_id
         WHERE s.id = ${siteId}::bigint
    `;
    if (row === undefined) throw new ApiError(404, "not_found", "Diese Stätte gibt es nicht.");
    // Die Beziehung selbst wird zusätzlich einzeln gesperrt (die App hat an `site_settlement` UPDATE): Andere Schreiber der Zeile -
    // Import, Ort entfernen (`place-removal-regeln.ts`) - kennen die Sperre der Stätte nicht, nur diese Zeilensperre.
    // `FOR UPDATE` über einen LEFT JOIN geht nicht auf die rechte Seite.
    if (row.relation_id !== null)
        await tx`SELECT 1 FROM site_settlement WHERE id = ${row.relation_id}::bigint FOR UPDATE`;
    return row;
}

/**
 * Der Nachfolgesitz einer stillgelegten Stätte, gesperrt und bereit (B4). Die Regel steht in `nachfolgesitz.ts`; hier wird
 * sie nur angewandt und das Ergebnis in eine Ablehnung oder eine gesperrte Zeile übersetzt.
 */
async function nachfolgerSitz(tx: Sql, staette: SiteRow, ortId: string): Promise<SiteRow> {
    const [n] = await tx.unsafe<{ treffer: number; id: string | null }[]>(
        `SELECT n.treffer::int AS treffer, n.id::text AS id
           FROM site s, LATERAL (${nachfolgerSql("s", "$2::bigint")}) n
          WHERE s.id = $1::bigint`,
        [staette.id, ortId],
    );
    if (n === undefined || n.treffer !== 1 || n.id === null)
        throw new ApiError(
            400,
            "validation_failed",
            n !== undefined && n.treffer > 1
                ? `Zu „${staette.name}“ gibt es mehrere Anwärter; welcher der Nachfolger ist, muss ein Mensch sagen.`
                : `Zu „${staette.name}“ gibt es keinen eindeutigen Nachfolgesitz.`,
            { field: "siteId" },
        );
    return lockedSite(tx, n.id);
}

/**
 * Ein Eintrag des Fachprotokolls am Ort: Die Beziehungen vorher und nachher, als Kennungen.
 *
 * 🪤 OHNE Revision. Die des Orts steigt nicht (siehe Kopf), und `map_audit_event_revision_forward` (0091) verlangt, dass eine
 * genannte Revision WÄCHST - zweimal dieselbe Zahl weist die Datenbank ab (gemessen, 23514). Keine Zahl ist hier die richtige
 * Aussage: An diesem Ort hat sich nichts verändert, was eine Revision zählt.
 */
const eintrag = (action: `place.${string}`, placeId: string, vorher: string[], nachher: string[]): MapAuditEntry => ({
    action,
    placeId,
    changes: { staetten: { before: vorher, after: nachher } },
});

/** `site.relate`: eine Stätte an diesen Ort binden (auch von einem anderen her) oder die Beziehung zu ihm lösen. */
export async function relateSite(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: SiteRelationBody,
): Promise<OperationReceipt> {
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "site.relate",
            mapDomainId: domain,
            body: { publicId, ...body },
        },
        async (tx) => {
            const ort = await readPlace(tx, publicId, false);
            if (ort === undefined || (!ort.unplaced && !ort.is_active))
                throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            const [zeile] = await tx<{ id: string }[]>`
                SELECT id::text AS id FROM place WHERE public_id = ${publicId}::uuid AND is_active
            `;
            const staette = await lockedSite(tx, body.siteId);
            const hier =
                zeile !== undefined && staette.relation_active === true && staette.relation_place_id === zeile.id;

            /*
             * 🔴 B4: Ein Zug der Wiki legt einen Sitz still und legt einen neuen an, sobald sich die Ortsangabe ändert. Die
             * Beziehung bleibt an der stillgelegten Zeile hängen - samt dem, was ein Mensch daran entschieden hat. Das
             * Umhängen ist EINE Operation: Erst bekommt der Nachfolger die Beziehung, dann geht die alte still. Scheitert
             * der erste Schritt, steht die Entscheidung noch da, wo sie war.
             */
            if (body.weg === "nachfolger") {
                if (!hier)
                    throw new ApiError(
                        400,
                        "validation_failed",
                        `„${staette.name}“ ist nicht an ${ort.name} gebunden.`,
                        { field: "siteId" },
                    );
                if (staette.site_active)
                    throw new ApiError(
                        400,
                        "validation_failed",
                        `„${staette.name}“ ist nicht stillgelegt; umgehängt wird nur eine stillgelegte Stätte.`,
                        { field: "siteId" },
                    );
                const nachfolger = await nachfolgerSitz(tx, staette, zeile!.id);
                const [neu] =
                    nachfolger.relation_id === null
                        ? await tx<{ id: string }[]>`
                              INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
                              VALUES (${nachfolger.id}::bigint, NULL, ${zeile!.id}::bigint, 'editor', 'avesmaps3d')
                              RETURNING id::text AS id
                          `
                        : await tx<{ id: string }[]>`
                              UPDATE site_settlement
                                 SET place_id = ${zeile!.id}::bigint, origin = 'editor', is_active = TRUE,
                                     retired_at = NULL, retired_origin = NULL, updated_at = now()
                               WHERE id = ${nachfolger.relation_id}::bigint
                              RETURNING id::text AS id
                          `;
                await tx`
                    UPDATE site_settlement
                       SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', origin = 'editor',
                           updated_at = now()
                     WHERE id = ${staette.relation_id}::bigint
                `;
                const umgehaengt: MapAuditEntry[] = [
                    eintrag("place.site_succeeded", ort.public_id, [staette.relation_id!], [neu!.id]),
                ];
                // Hing der Nachfolger bisher an einem ANDEREN Ort, steht das Umhängen auch in dessen Verlauf.
                if (
                    nachfolger.relation_active === true &&
                    nachfolger.relation_place_id !== zeile!.id &&
                    nachfolger.relation_place_public_id !== null
                ) {
                    const quelle = await readPlace(tx, nachfolger.relation_place_public_id, false);
                    if (quelle !== undefined)
                        umgehaengt.push(
                            eintrag("place.site_detached", quelle.public_id, [nachfolger.relation_id!], []),
                        );
                }
                return {
                    receipt: {
                        affected: [
                            { kind: "place", id: ort.public_id, revision: ort.revision },
                            { kind: "site", id: staette.id },
                            { kind: "site", id: nachfolger.id },
                        ],
                        derivedWork: [],
                        warnings: [],
                    },
                    summary: `${staette.name} auf den Nachfolgesitz ${nachfolger.name} umgehängt`,
                    entries: umgehaengt,
                };
            }

            if (body.weg === "loesen") {
                if (!hier)
                    throw new ApiError(
                        400,
                        "validation_failed",
                        `„${staette.name}“ ist nicht an ${ort.name} gebunden.`,
                        { field: "siteId" },
                    );
                // 🔴 `origin = 'editor'`: Von jetzt an ist das der Entscheid eines Menschen, und kein Legacy-Zug fasst
                // die Zeile wieder an. Ohne das trüge sie weiter Legacys Herkunft, und der nächste Zug holte sie zurück.
                await tx`
                    UPDATE site_settlement
                       SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', origin = 'editor',
                           updated_at = now()
                     WHERE id = ${staette.relation_id}::bigint
                `;
                return {
                    receipt: {
                        affected: [
                            { kind: "place", id: ort.public_id, revision: ort.revision },
                            { kind: "site", id: staette.id },
                        ],
                        derivedWork: [],
                        warnings: [],
                    },
                    summary: `${staette.name} von ${ort.name} gelöst`,
                    entries: [eintrag("place.site_detached", ort.public_id, [staette.relation_id!], [])],
                };
            }

            if (hier)
                throw new ApiError(400, "validation_failed", `„${staette.name}“ liegt schon in ${ort.name}.`, {
                    field: "siteId",
                });
            // Eine stillgelegte Stätte wird nicht neu gebunden: Sie ist Geschichte. Lösen und Umhängen bleiben möglich.
            if (!staette.site_active)
                throw new ApiError(
                    400,
                    "validation_failed",
                    `„${staette.name}“ ist stillgelegt und lässt sich nicht binden.`,
                    { field: "siteId" },
                );
            // 🔴 Ohne Zeile in `place` gibt es keine Beziehung: Ein Ort ohne Lage hat keine `place.id`, und die Spalte zeigt
            // dorthin. Das ist keine Lücke des Editors, sondern die Form der Tabelle (0099).
            if (zeile === undefined)
                throw new ApiError(
                    400,
                    "validation_failed",
                    `${ort.name} steht nicht auf der Karte; eine Stätte lässt sich nur einem Ort mit Kartenzeile zuordnen.`,
                    { field: "siteId" },
                );

            /*
             * 🔴 EINE Zeile je Stätte, für immer (`site_settlement_site_unique`, 0099): Ein Sitz in zwei Städten sind zwei
             * Stätten, nicht zwei Beziehungen. Das Verlagern schreibt darum DIE Zeile um, statt eine zweite anzulegen - ein
             * Einfügen danebenlief in den eindeutigen Schlüssel (gemessen).
             * 🚩 Legacys gespeicherte Kennung bleibt stehen: Sie ist der Beleg, was Legacy sagte. Was jetzt gilt, sagt
             * `place_id` mit `origin = 'editor'`; der Leser zeigt beides nebeneinander.
             */
            const vorher = staette.relation_id;
            const [geschrieben] =
                vorher === null
                    ? await tx<{ id: string }[]>`
                          INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
                          VALUES (${staette.id}::bigint, NULL, ${zeile.id}::bigint, 'editor', 'avesmaps3d')
                          RETURNING id::text AS id
                      `
                    : await tx<{ id: string }[]>`
                          UPDATE site_settlement
                             SET place_id = ${zeile.id}::bigint, origin = 'editor', is_active = TRUE, retired_at = NULL,
                                 retired_origin = NULL, updated_at = now()
                           WHERE id = ${vorher}::bigint
                          RETURNING id::text AS id
                      `;

            const entries: MapAuditEntry[] = [eintrag("place.site_attached", ort.public_id, [], [geschrieben!.id])];
            // Der Eintrag am Herkunftsort: Nur so steht das Verlagern auch in SEINEM Verlauf.
            if (vorher !== null && staette.relation_active === true && staette.relation_place_public_id !== null) {
                const quelle = await readPlace(tx, staette.relation_place_public_id, false);
                if (quelle !== undefined) entries.push(eintrag("place.site_detached", quelle.public_id, [vorher], []));
            }
            return {
                receipt: {
                    affected: [
                        { kind: "place", id: ort.public_id, revision: ort.revision },
                        { kind: "site", id: staette.id },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary:
                    staette.relation_active === true && staette.relation_place_name !== null
                        ? `${staette.name} von ${staette.relation_place_name} nach ${ort.name} verlagert`
                        : `${staette.name} liegt jetzt in ${ort.name}`,
                entries,
            };
        },
    );
}

/**
 * `site.add` (WI-0196, EDIT-0003 T33 (3) „Innerorts hinzufügen“): die gewählten Einträge in EINER Operation an diesen Ort binden, erst
 * mit „Fertig“. Ein Kartenpunkt bekommt dabei seine Stätte (`site_punkt_fuer_ort`, Migration 0139: die App darf `site` selbst nicht
 * schreiben). 🔴 Ist ein Eintrag inzwischen woanders gebunden - oder schon hier -, scheitert die ganze Operation und nennt ihn; geraten
 * und still übersprungen wird nie. Die Revision des Orts steigt nicht (wie `relateSite`); je Eintrag ein Protokolleintrag am Ort.
 */
export async function addSites(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: SiteAddBody,
): Promise<OperationReceipt> {
    if (body.sites.length + body.places.length === 0)
        throw new ApiError(400, "validation_failed", "Es ist nichts gewählt.", { field: "sites" });
    if (body.sites.length + body.places.length > SITE_ADD_MAX)
        throw new ApiError(400, "validation_failed", `Höchstens ${String(SITE_ADD_MAX)} Einträge auf einmal.`, {
            field: "sites",
        });
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "site.add", mapDomainId: domain, body: { publicId, ...body } },
        async (tx) => {
            const ort = await readPlace(tx, publicId, false);
            if (ort === undefined || (!ort.unplaced && !ort.is_active))
                throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            const [zeile] = await tx<{ id: string }[]>`
                SELECT id::text AS id FROM place WHERE public_id = ${publicId}::uuid AND is_active
            `;
            if (zeile === undefined)
                throw new ApiError(
                    400,
                    "validation_failed",
                    `${ort.name} steht nicht auf der Karte; Stätten lassen sich nur einem Ort mit Kartenzeile zuordnen.`,
                    { field: "sites" },
                );
            // Erst die Kartenpunkte zu Stätten: Was es schon gibt, kommt mit seiner `id` zurück, nichts doppelt.
            const ids = [...body.sites];
            for (const punkt of body.places) {
                const [neu] = await tx<
                    { id: string | null }[]
                >`SELECT public.site_punkt_fuer_ort(${punkt}::uuid)::text AS id`.catch((error: unknown) => {
                    throw punktFehler(error) ?? error;
                });
                if (neu?.id) ids.push(neu.id);
            }
            const entries: MapAuditEntry[] = [];
            const affected: OperationReceipt["affected"] = [
                { kind: "place", id: ort.public_id, revision: ort.revision },
            ];
            const namen: string[] = [];
            for (const id of [...new Set(ids)]) {
                const staette = await lockedSite(tx, id);
                if (!staette.site_active)
                    throw new ApiError(
                        400,
                        "validation_failed",
                        `„${staette.name}“ ist stillgelegt und lässt sich nicht binden.`,
                        {
                            field: "sites",
                        },
                    );
                if (staette.relation_active === true && staette.relation_place_id !== null)
                    throw new ApiError(
                        409,
                        "edit_conflict",
                        staette.relation_place_id === zeile.id
                            ? `„${staette.name}“ liegt schon in ${ort.name}.`
                            : `„${staette.name}“ ist inzwischen ${staette.relation_place_name ?? "einem anderen Ort"} zugeordnet.`,
                        { field: "sites" },
                    );
                // EINE Zeile je Stätte, für immer (0099): eine gelöste oder „keine Stadt“ eines Laufs wird umgeschrieben.
                const [geschrieben] =
                    staette.relation_id === null
                        ? await tx<{ id: string }[]>`
                              INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
                              VALUES (${staette.id}::bigint, NULL, ${zeile.id}::bigint, 'editor', 'avesmaps3d')
                              RETURNING id::text AS id
                          `
                        : await tx<{ id: string }[]>`
                              UPDATE site_settlement
                                 SET place_id = ${zeile.id}::bigint, origin = 'editor', is_active = TRUE, retired_at = NULL,
                                     retired_origin = NULL, updated_at = now()
                               WHERE id = ${staette.relation_id}::bigint
                              RETURNING id::text AS id
                          `;
                entries.push(eintrag("place.site_attached", ort.public_id, [], [geschrieben!.id]));
                affected.push({ kind: "site", id: staette.id });
                namen.push(staette.name);
            }
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary:
                    namen.length === 1
                        ? `${namen[0]!} liegt jetzt in ${ort.name}`
                        : `${String(namen.length)} Einträge liegen jetzt in ${ort.name}`,
                entries,
            };
        },
    );
}

/** Die Ablehnung der Funktion in die Sprache der Schnittstelle: Ort fehlt, falsche Ortsgröße oder verborgen; sonst `undefined`. */
function punktFehler(error: unknown): ApiError | undefined {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "P0002")
        return new ApiError(404, "not_found", "Einen gewählten Kartenpunkt gibt es nicht mehr.", { field: "places" });
    if (code === "22023")
        return new ApiError(
            400,
            "validation_failed",
            "Hinzufügen lassen sich nur sichtbare Gebäude und Stadtviertel der Karte.",
            { field: "places" },
        );
    return undefined;
}
