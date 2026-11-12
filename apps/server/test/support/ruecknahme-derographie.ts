import type { Capability, OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../../src/database.ts";
import { mitgliederHash } from "../../src/editor/arbeitsserie.ts";
import type { MapActor } from "../../src/editor/map-operation.ts";
import { ruecknehmenFlaeche } from "../../src/editor/ruecknahme-flaeche.ts";
import { ruecknehmenGipfel } from "../../src/editor/ruecknahme-gipfel.ts";

/**
 * Die Rücknahme der Derographie für Tests der Vorwärtsoperationen (WI-0265 B6c): Die früheren Wege `restoreBoolean`, `restoreBatch`, `restoreLandscape` und `restorePeak` (`POST …/:id/restore`)
 * entfielen; was sie prüften, prüfen die Tests der Werkzeuge jetzt über den einen Weg des Servers (`ruecknehmenFlaeche`, `ruecknehmenGipfel`), mit den Kartenrechten der Vorwärtsoperationen. Die Tests rufen die
 * Schreibwege ohne Route auf; wer fragt, ist der Handelnde selbst (kein Grund nötig, keine Fremdsperre gegen sich).
 */

const RECHTE: ReadonlySet<Capability> = new Set<Capability>([
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_landscapes",
    "edit_landscape_form",
]);

const leserVon = (actor: MapActor): { personId: string; rechte: ReadonlySet<Capability> } => ({
    personId: actor.kind === "person" ? actor.personId : "",
    rechte: RECHTE,
});

/** Nimmt EINE Operation (`reverts`) zurück, von der Landschaft `regionId` aus; wie `POST /api/editor/landscapes/:id/restore-series` mit genau einem Mitglied. */
export function nimmFlaecheZurueck(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: { operationId: string; reverts: string },
): Promise<OperationReceipt> {
    return ruecknehmenFlaeche(database, actor, leserVon(actor), regionId, {
        operationId: body.operationId,
        members: [body.reverts],
        membersHash: mitgliederHash([body.reverts]),
    });
}

/** Dasselbe von einem Gipfel aus (`POST /api/editor/peaks/:id/restore-series`). */
export function nimmGipfelZurueck(
    database: Database,
    actor: MapActor,
    peakId: string,
    body: { operationId: string; reverts: string },
): Promise<OperationReceipt> {
    return ruecknehmenGipfel(database, actor, leserVon(actor), peakId, {
        operationId: body.operationId,
        members: [body.reverts],
        membersHash: mitgliederHash([body.reverts]),
    });
}
