import {
    POWERLINE_STATE_CHANGES,
    type FeldHerkunft,
    type OperationReceipt,
    type PowerlineSammelLinie,
    type PowerlineSammelStandBody,
    type PowerlineSammelWikiBody,
    type PowerlineState,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import {
    STEHT,
    WECHSEL_TEXT,
    pruefeLinienSperre,
    sperreLinie,
    standVon,
    wechsleStandImTx,
    wikiName,
} from "./kraftlinien-schreiben.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * Mehrere Kraftlinien auf einmal (WI-0238; EDIT-0003 T57 Mehrfachauswahl, für Kraftlinien „zunächst nur ‚Entfernen …‘ und ↺“):
 *
 * - **Stand** (`POST /api/editor/powerlines/sammel/stand`): derselbe Wechsel für jede gewählte Linie, als EINE Operation unter dem Namen
 *   des Einzelfalls (`powerline.retire` …), mit denselben Prüfungen je Linie (`wechsleStandImTx`: Sperre, Revision, Nodices).
 * - **Wiki-Werte** (`POST /api/editor/powerlines/sammel/wiki`): Name und/oder Beschreibung jeder Linie zurück auf den Wiki-Wert, wie
 *   `{ revert: "wiki" }` am Einzelfall (`powerline.update_line`): Der Name wird der des Artikels der Linie, die Beschreibung leer und
 *   folgt dem Wiki; die Herkunft wird wiki, das Protokoll nennt sie wie am Einzelfall. 🔴 Eine Linie OHNE Artikel (oder ohne Namen im
 *   Wiki) behält ihren Wert: Es gibt keinen Wiki-Wert, dem sie folgen könnte, und der Einzelfall bietet ↺ dort gar nicht an. ↺ für alle
 *   heißt also „für alle, die einen Wiki-Wert haben“ (wie am Ort); hat keine einen, 400.
 * - Alle Linien gehören zu einer Karte. Gesperrt wird in der Reihenfolge der Anker, damit zwei Auswahlen einander nicht festhalten.
 *   Kommt eine Linie doppelt, zählt sie einmal.
 */

/** Jede Linie einmal, nach Anker geordnet. */
function linienVon(lines: readonly PowerlineSammelLinie[]): PowerlineSammelLinie[] {
    const je = new Map(lines.map((linie) => [linie.anker, linie] as const));
    return [...je.values()].sort((a, b) => (a.anker < b.anker ? -1 : a.anker > b.anker ? 1 : 0));
}

interface Vorab {
    public_id: string;
    map_domain_id: string;
    name: string;
    is_active: boolean;
    off_map: boolean;
}

/** Kopf jeder Linie vor der Transaktion: Es gibt sie, und alle liegen auf derselben Karte. */
async function vorabVon(database: Database, linien: readonly PowerlineSammelLinie[]): Promise<Map<string, Vorab>> {
    const zeilen = await database<Vorab[]>`
        SELECT public_id::text AS public_id, map_domain_id, name, is_active, off_map
          FROM powerline WHERE public_id = ANY(${linien.map((l) => l.anker)}::uuid[])
    `;
    const je = new Map(zeilen.map((z) => [z.public_id, z] as const));
    const fehlt = linien.find((l) => !je.has(l.anker));
    if (fehlt !== undefined)
        throw new ApiError(404, "not_found", "Eine der gewählten Kraftlinien gibt es nicht.", { anchor: fehlt.anker });
    if (new Set(zeilen.map((z) => z.map_domain_id)).size > 1)
        throw new ApiError(400, "validation_failed", "Die gewählten Kraftlinien liegen auf verschiedenen Karten.");
    return je;
}

const anzahl = (n: number, einzeln: string): string => (n === 1 ? einzeln : `${String(n)} Kraftlinien`);

export async function setPowerlinesState(
    database: Database,
    actor: MapActor,
    body: PowerlineSammelStandBody,
): Promise<OperationReceipt> {
    const linien = linienVon(body.lines);
    const vorab = await vorabVon(database, linien);
    const regel = POWERLINE_STATE_CHANGES[body.wechsel];
    for (const linie of linien) {
        const v = vorab.get(linie.anker)!;
        const stand = standVon(v);
        if (!(regel.from as readonly PowerlineState[]).includes(stand))
            throw new ApiError(400, "validation_failed", `„${v.name}“: ${STEHT[stand]}`, {
                field: "state",
                anchor: linie.anker,
            });
    }
    const erste = vorab.get(linien[0]!.anker)!;
    const text = WECHSEL_TEXT[body.wechsel];
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: body.wechsel,
            mapDomainId: erste.map_domain_id,
            body,
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            let gezeichnet = false;
            for (const linie of linien) {
                const ergebnis = await wechsleStandImTx(
                    tx,
                    actor,
                    linie.anker,
                    linie.segments,
                    body.wechsel,
                    vorab.get(linie.anker)!,
                );
                affected.push(...ergebnis.affected);
                entries.push(...ergebnis.entries);
                gezeichnet ||= ergebnis.derivedWork.length > 0;
            }
            return {
                receipt: {
                    affected,
                    derivedWork: gezeichnet ? [{ kind: "powerline_path", state: "done" }] : [],
                    warnings: [],
                },
                entries,
                summary: `${anzahl(linien.length, `Kraftlinie „${erste.name}“`)} ${text.satz}`,
            };
        },
    );
}

export async function revertPowerlinesToWiki(
    database: Database,
    actor: MapActor,
    body: PowerlineSammelWikiBody,
): Promise<OperationReceipt> {
    const linien = linienVon(body.lines);
    const vorab = await vorabVon(database, linien);
    const nicht = linien.find((l) => standVon(vorab.get(l.anker)!) !== "karte");
    if (nicht !== undefined)
        throw new ApiError(400, "validation_failed", `„${vorab.get(nicht.anker)!.name}“ ist nicht auf der Karte.`, {
            field: "state",
            anchor: nicht.anker,
        });
    const mitName = body.felder.includes("name");
    const mitBeschreibung = body.felder.includes("description");
    const erste = vorab.get(linien[0]!.anker)!;
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "powerline.update_line",
            mapDomainId: erste.map_domain_id,
            body,
        },
        async (tx) => {
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            for (const linie of linien) {
                const abschnitte = await sperreLinie(tx, linie.anker);
                if (abschnitte.length === 0) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
                const ids = abschnitte.map((a) => a.public_id);
                await pruefeLinienSperre(tx, actor, ids);
                const basis = new Map(linie.segments.map((s) => [s.id, s.baseRevision]));
                const abweichend =
                    abschnitte.find((a) => basis.get(a.public_id) !== a.revision) ??
                    (basis.size !== abschnitte.length ? abschnitte[0] : undefined);
                if (abweichend !== undefined)
                    throw await mapEditConflict(
                        tx,
                        { kind: "powerline", publicId: abweichend.public_id },
                        { revision: abweichend.revision, changedAt: abweichend.updated_at },
                    );
                const alt = abschnitte[0]!;
                const [artikel] = await tx<{ mit: boolean }[]>`
                    SELECT EXISTS (
                        SELECT 1 FROM powerline p
                          JOIN powerline_wiki_assignment w ON w.powerline_id = p.id AND w.is_active
                         WHERE p.public_id = ANY(${ids}::uuid[])
                    ) AS mit
                `;
                // Ohne Artikel bleibt der eigene Wert (siehe Kopf); ebenso der Name, wenn das Wiki keinen kennt (wikiName sagt dann 400).
                const leeren = mitBeschreibung && artikel?.mit === true;
                let name: string | undefined;
                if (mitName && artikel?.mit === true)
                    try {
                        name = await wikiName(tx, abschnitte, undefined);
                    } catch (fehler) {
                        if (!(fehler instanceof ApiError)) throw fehler;
                    }
                if (name === undefined && !leeren) continue;
                const hier: Partial<Record<"name" | "description", FeldHerkunft>> = {
                    ...(name !== undefined ? { name: "wiki" } : {}),
                    ...(leeren ? { description: "wiki" } : {}),
                };
                const neuerName = name !== undefined && name !== alt.name ? name : undefined;
                const neu = await tx<{ public_id: string; revision: number }[]>`
                    UPDATE powerline
                       SET name = coalesce(${neuerName ?? null}::text, name),
                           description = CASE WHEN ${leeren} THEN NULL ELSE description END,
                           revision = revision
                     WHERE public_id = ANY(${ids}::uuid[])
                 RETURNING public_id::text AS public_id, revision::int AS revision
                `;
                const revisionNach = new Map(neu.map((r) => [r.public_id, r.revision]));
                const herkunftVorher = await leseHerkunft(tx, "powerline", ids);
                await setzeHerkunft(tx, "powerline", ids, hier);
                for (const a of abschnitte) {
                    const changes: Record<string, MapChange> = {};
                    if (neuerName !== undefined) changes["name"] = { before: a.name, after: neuerName };
                    if (leeren && a.description !== null)
                        changes["description"] = { before: a.description, after: null };
                    for (const feld of ["name", "description"] as const) {
                        const nachher = hier[feld];
                        if (nachher === undefined) continue;
                        const vorher = herkunftVorher.get(a.public_id)?.[feld] ?? null;
                        if (vorher !== nachher) changes[`${feld}Origin`] = { before: vorher, after: nachher };
                    }
                    entries.push({
                        action: "powerline.updated",
                        powerlineId: a.public_id,
                        revisionBefore: a.revision,
                        revisionAfter: revisionNach.get(a.public_id) ?? null,
                        changes,
                    });
                    affected.push({
                        kind: "powerline",
                        id: a.public_id,
                        revision: revisionNach.get(a.public_id) ?? a.revision,
                    });
                }
            }
            if (entries.length === 0)
                throw new ApiError(
                    400,
                    "validation_failed",
                    "Keine der gewählten Kraftlinien hat hier einen Wiki-Wert.",
                    {
                        field: "wiki",
                    },
                );
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                entries,
                summary: `${anzahl(linien.length, `Kraftlinie „${erste.name}“`)}: auf Wiki-Werte`,
            };
        },
    );
}
