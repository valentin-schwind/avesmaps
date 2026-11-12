import type { InhalteTraegerQuellenArt, InhalteTraegerQuellenBody, OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { MapActor, MapAuditEntry } from "../editor/map-operation.ts";
import { LANDSCHAFT_ART } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { aktualisiereKanon } from "./kanon-folgen.ts";
import { inhalteOperation } from "./operation.ts";
import { PROTOKOLL, eintrag, stimmtMitStand, sucheQuelle, veralteterStand } from "./traeger-quellen-stand.ts";
import { aendereWegQuellen } from "./traeger-quellen-weg.ts";
import { TRAEGER } from "./traeger.ts";
import { fehlerbild, schreibeVerwendung, sperreVerwendung } from "./verknuepfung-schreiben.ts";

/**
 * Schreiben der Quellen eines Kartenobjekts für die Klappbox der Karteneditoren (WI-0254 §12): `traeger.sources`, EINE Operation je Speichern, für Ort, Herrschaftsgebiet, Landschaft und Gipfel (jede Zeile von `terrain_peak`, auch jede Landmarke ohne Gelände);
 * die Straße eines Wegs schreibt `traeger-quellen-weg.ts` (ein Weg hat seine Quellen als Ganzes, die Verknüpfungen hängen je Abschnitt). Vertrag und Regeln:
 * `packages/shared/src/inhalte-traeger-quellen.ts`; gelesen wird in `traeger-quellen-lesen.ts`; was alle Arten teilen (Probe `vorher`, 409, Protokolleintrag) steht in `traeger-quellen-stand.ts`.
 *
 * - **Der Kern ist der von `source.update`** (`verknuepfung-schreiben.ts`): anhängen, ändern, lösen (Legacy unterdrückt, eigenes gelöst, nie gelöscht) und holen, `source_system = 'editor'`
 *   (der Legacy-Zug fasst die Zeile nie an, der WikiSync wertet sie als von Hand). Neu ist der Weg: vom Objekt her statt von der Quelle her.
 * - 🔴 **Sperren:** eine Sperre je Objekt für diesen Weg (`pg_advisory_xact_lock`, damit zwei Speichern desselben Objekts sich nicht überholen) und `FOR UPDATE` an der Zeile der
 *   Verknüpfung, NIE am Objekt: Eine Quelle ändert weder Linie noch Fläche noch Namen, die Revision des Objekts steigt nicht, und die App-Rolle hat am Objekt keine Rechte für eine
 *   Zeilensperre (Vorbild `site.relate`). Die Quelle selbst bleibt unberührt (keine Revision): Ein Speichern am Objekt sperrt keine Quelle, die Tausende Objekte trägt.
 * - 🔴 **Gegen den gesehenen Stand:** Jede Änderung trägt `vorher`, was die Oberfläche von der Verknüpfung sah. Weicht der Stand ab (jemand hat dieselbe Verknüpfung inzwischen angehängt,
 *   geändert, gelöst), ist die ganze Operation 409 `edit_conflict` und schreibt nichts; die Meldung nennt, wer es zuletzt war, soweit das Fachprotokoll es weiß.
 * - **Das Etikett des Objekts** (Kanon, Rang 1 bis 3) wird in derselben Transaktion neu gerechnet (`kanon-folgen.ts`), wie bei `source.update`.
 * - **Protokoll** am Objekt, ohne Revision (`map_audit_event_revision_forward` verlangt wachsende Zahlen; an diesem Objekt hat sich nichts verändert, was eine Revision zählt): Aktion
 *   `place.sources_changed`, `territory.sources_changed`, `region.sources_changed` oder `peak.sources_changed`, `changes.quellen` mit vorher und nachher je geänderter Quelle.
 * - An ein stilles Objekt und an eine stillgelegte Quelle hängt nichts an (400).
 * - **Zurücknehmen** (WI-0265 B6g3): `traeger.sources` gehört zur Familie des Objekts (Ort, Gebiet, Landschaft, Weg) und teilt dessen Serie; die Rücknahme setzt jede Verknüpfung direkt auf den Stand vor der
 *   Serie (`editor/ruecknahme-traeger-quellen.ts`), nicht über die Operationen dieser Datei. Wer hier Zustand, Angaben oder das Protokoll (`changes.quellen`) ändert, ändert, was die Rücknahme liest.
 */

export async function aendereTraegerQuellen(
    database: Database,
    actor: MapActor,
    kind: InhalteTraegerQuellenArt,
    kennung: string,
    body: InhalteTraegerQuellenBody,
): Promise<OperationReceipt> {
    // Eine Quelle höchstens einmal je Speichern: Zwei Änderungen an derselben Verknüpfung widersprächen einander.
    const gesehen = new Set<string>();
    for (const [index, aenderung] of body.aenderungen.entries()) {
        if (gesehen.has(aenderung.sourceId)) {
            throw fehlerbild(
                `aenderungen.${String(index)}.sourceId`,
                "unique",
                "Jede Quelle darf in einem Speichern nur einmal vorkommen.",
            );
        }
        gesehen.add(aenderung.sourceId);
    }
    if (kind === "path") return aendereWegQuellen(database, actor, kennung, body);
    const tafeln = TRAEGER[kind];
    const protokoll = PROTOKOLL[kind];
    return inhalteOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "traeger.sources", body: { kind, carrierId: kennung, ...body } },
        async (tx) => {
            // Zwei Speichern desselben Objekts laufen nacheinander, nicht ineinander (die Zeilen der Verknüpfung allein deckten eine NEUE Verknüpfung nicht ab).
            await tx`SELECT pg_advisory_xact_lock(hashtext('traeger_quellen:schreiben'), hashtext(${`${kind}:${kennung}`}))`;
            const [traeger] = await tx.unsafe<{ id: string; name: string; is_active: boolean; revision: number }[]>(
                `SELECT id::text AS id, name, is_active, revision::int AS revision FROM ${tafeln.carrier} WHERE public_id = $1::uuid`,
                [kennung],
            );
            if (traeger === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");

            const vorherListe: Record<string, unknown>[] = [];
            const nachherListe: Record<string, unknown>[] = [];
            for (const aenderung of body.aenderungen) {
                const quelle = await sucheQuelle(tx, aenderung.sourceId, aenderung.op);
                const gesperrt = await sperreVerwendung(tx, kind, kennung, quelle.id);
                if (!stimmtMitStand(aenderung.vorher, gesperrt.bisher)) {
                    throw await veralteterStand(
                        tx,
                        kind,
                        [kennung],
                        aenderung.sourceId,
                        traeger.revision,
                        gesperrt.bisher?.updated_at,
                    );
                }
                const ergebnis = await schreibeVerwendung(tx, kind, kennung, quelle.id, gesperrt, aenderung);
                if (ergebnis === undefined) continue;
                vorherListe.push(eintrag(quelle, aenderung.sourceId, ergebnis.vorher));
                nachherListe.push(eintrag(quelle, aenderung.sourceId, ergebnis.nachher));
            }

            const affected = [
                {
                    kind: kind === "area" ? LANDSCHAFT_ART : kind,
                    id: kennung,
                    revision: traeger.revision,
                },
            ];
            if (vorherListe.length === 0) {
                // Nichts hat sich geändert (dieselben Werte noch einmal): kein Protokoll.
                return { receipt: { affected, derivedWork: [], warnings: [] }, entries: [] };
            }
            await aktualisiereKanon(tx, { [kind]: new Set([traeger.id]) });
            const eintragImProtokoll: MapAuditEntry = {
                action: `${protokoll.art}.sources_changed`,
                ...protokoll.ziel(kennung),
                changes: { quellen: { before: vorherListe, after: nachherListe } },
            };
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `Quellen von „${traeger.name}“ geändert`,
                entries: [eintragImProtokoll],
            };
        },
    );
}
