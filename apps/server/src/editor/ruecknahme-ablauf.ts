import type { RuecknahmeBody, RuecknahmeReceipt } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { inhalteOperation } from "../inhalte/operation.ts";
import { SerienLeser } from "./arbeitsserie.ts";
import { MAP_OPERATION_STORE, mapOperation, type MapActor } from "./map-operation.ts";
import {
    vorpruefen,
    type RuecknahmeAdapter,
    type RuecknahmeLeser,
    type Vorpruefung,
    type VorpruefungEingabe,
} from "./ruecknahme.ts";

/**
 * Der gemeinsame Ablauf einer Rücknahme je Objektfamilie (WI-0265 B3 Gebirge, B4 Ort; Fachvertrag C.1, C.2): EINE Autorität, die Familien liefern nur ihren Adapter
 * (`ruecknahme.ts`, was die Vorprüfung nicht weiß) und drei Haken. Der Ablauf, der in jeder Familie derselbe ist:
 *
 * 1. Eine bekannte Kennung gibt ihre erste Quittung zurück (`replayed`), auch wenn die Mitglieder inzwischen zurückgenommen sind: Darum zuerst nachsehen.
 * 2. Fremdsperre und Vorprüfung VOR der Transaktion (billig, ohne Sperren); jedes Ergebnis außer `ok` ist ein Fehler in der Form von C.2, bei einer fremden Person ohne
 *    `reason` 400 `reason_required`. Aus ihr stehen die OFFENEN Mitglieder in Serienfolge fest: Sie sind `reverts` der einen Operation.
 * 3. In der Transaktion: Fremdsperre noch einmal, die Zeilen in fester Reihenfolge sperren, die Vorprüfung unter den Sperren wiederholen (der Preflight ist keine Zusage),
 *    dann schreibt die Familie. Die Schreibnaht (`mapOperation`) legt Operation, Protokoll und Verknüpfungen an und rechnet die Ableitung EINMAL.
 *
 * Jeder Fehler vorher oder darin lässt weder eine Änderung noch einen Auftrag zurück (Jobs entstehen in derselben Transaktion).
 */

/** Was die Familie ausmacht: ihre Operation, der Gegenstand der Route, ihr Adapter und die Karte. */
export interface RuecknahmeFamilie {
    /** Die Operation der Rücknahme, etwa `landscape.restore_series`. */
    operation: string;
    /** Der Gegenstand, an dem die Route hängt (`landscape:<id>`, `place:<id>`): Jedes Mitglied berührt ihn, sonst ist die Liste nicht von hier (`invalid_members`). */
    scope: string;
    /**
     * Weitere Gegenstände derselben Route (WI-0265 B6b, Kraftlinie: die Abschnitte der Linie; der Anker darf jeder davon sein). Ist es gesetzt, genügt es, dass jedes Mitglied EINEN der
     * Gegenstände (`scope` und diese) berührt.
     */
    scopes?: readonly string[];
    adapter: RuecknahmeAdapter;
    mapDomainId: string;
    /**
     * Die Schreibnaht: `karte` (Standard, `mapOperation`: mit Ableitungen und dem Ereignis `map.changed`) oder `inhalte` (`inhalteOperation`: ohne beides, wie die Vorwärtswege der Inhalte;
     * WI-0265 B6g1). Die Rücknahme geht über dieselbe Naht wie das Original, damit eine Quelle, ein Werk oder ein Korpus keine Kacheln neu laden lässt.
     * Eine Funktion entscheidet nach der Vorprüfung (WI-0265 B6g3): Die Quellen eines Orts, Gebiets, einer Landschaft oder eines Wegs gehen über die Naht der Inhalte (sie ändern weder Linie noch Fläche),
     * ein Mitglied mit Feldern über die der Karte; eine Rücknahme, die beides enthält, über die der Karte.
     */
    naht?: "karte" | "inhalte" | ((vor: Vorpruefung) => "karte" | "inhalte");
}

/** Was die Familie beim Schreiben bekommt. */
export interface RuecknahmeSchreiben {
    tx: Sql;
    /** Die Vorprüfung unter den Sperren (Ergebnis `ok`). */
    vor: Vorpruefung;
    /** Die offenen Mitglieder in Serienfolge, die älteste zuerst. */
    offen: readonly string[];
    /** Der Grund, wenn einer genannt ist (getrimmt). */
    grund: string | undefined;
}

export type SchreibErgebnis = Awaited<ReturnType<Parameters<typeof mapOperation>[3]>>;

/** Die drei Haken, die jede Familie selbst beantwortet. */
export interface RuecknahmeHaken {
    /** Hält ein anderer einen der Gegenstände (`scopes` der Mitglieder, `<art>:<kennung>`)? Dann 409 `object_locked` in der Form der übrigen Schreibwege der Familie. */
    pruefeFremdeSperre(database: Queryable, actor: MapActor, scopes: ReadonlySet<string>): Promise<void>;
    /** Die Zeilen der Gegenstände in fester Reihenfolge sperren (`FOR UPDATE`), bevor die Vorprüfung wiederholt wird. */
    sperreZeilen(tx: Queryable, vorab: Vorpruefung): Promise<void>;
    /** Die Inverse schreiben: Gegenstände, Protokolleinträge, Quittung. Nichts zu schreiben (der Stand war schon der vom Anfang) ist erlaubt. */
    schreibe(kontext: RuecknahmeSchreiben): Promise<SchreibErgebnis>;
}

/** Die Vorprüfung für diese Familie: der Kern mit dem Adapter, dazu die Prüfung, dass jedes Mitglied den Gegenstand der Route berührt. */
export async function pruefeFamilie(
    database: Queryable,
    eingabe: VorpruefungEingabe,
    leser: RuecknahmeLeser,
    familie: Pick<RuecknahmeFamilie, "scope" | "scopes" | "adapter">,
): Promise<Vorpruefung> {
    const vor = await vorpruefen(database, eingabe, leser, familie.adapter);
    if (vor.ergebnis === "forbidden" || vor.ergebnis === "invalid_members") return vor;
    const scopes = await new SerienLeser(database).scopes(eingabe.mitglieder.map((id) => id.toLowerCase()));
    const erlaubt = new Set([familie.scope, ...(familie.scopes ?? [])]);
    const fremd = eingabe.mitglieder.some(
        (id) => !(scopes.get(id.toLowerCase()) ?? []).some((gegenstand) => erlaubt.has(gegenstand)),
    );
    return fremd ? { ...vor, ergebnis: "invalid_members", ungueltig: "keine_serie" } : vor;
}

/** Wer oder was die Rücknahme, die diese Mitglieder aufhob, war (für `already_reverted`). */
async function bisherigeRuecknahmen(
    database: Queryable,
    ids: readonly string[],
): Promise<{ operationId: string; at: string }[]> {
    const zeilen = await database<{ id: string; at: Date }[]>`
        SELECT DISTINCT l.restore_operation_id::text AS id, o.at, o.seq
          FROM map_operation_revert_link l
          JOIN map_operation o ON o.operation_id = l.restore_operation_id
         WHERE l.reverted_operation_id = ANY(${ids as string[]}::uuid[])
         ORDER BY o.seq DESC
    `;
    return zeilen.map((zeile) => ({ operationId: zeile.id, at: zeile.at.toISOString() }));
}

/** Der Fehler zu einem Ergebnis der Vorprüfung, in der Form von Fachvertrag C.2; `ok` ist kein Fehler. */
export async function fehlerAus(database: Queryable, vor: Vorpruefung): Promise<ApiError | undefined> {
    switch (vor.ergebnis) {
        case "ok":
            return undefined;
        case "forbidden":
            return new ApiError(403, "forbidden", "Dafür fehlt das Recht.", { missing: vor.fehlendeRechte });
        case "object_locked":
            return new ApiError(
                409,
                "object_locked",
                `${vor.sperren[0]?.person.name ?? "Jemand"} bearbeitet das gerade.`,
                { locks: vor.sperren },
            );
        case "invalid_members":
            return new ApiError(400, "invalid_members", "Die Liste der Änderungen gehört nicht zu dieser Rücknahme.", {
                reason: vor.ungueltig ?? "unbekannt",
            });
        case "not_revertable": {
            const ausgeschlossen = vor.mitglieder.filter((m) => m.ausschluss !== undefined);
            return new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                reason: ausgeschlossen[0]?.ausschluss?.grund ?? "art",
                members: ausgeschlossen.map((m) => ({ operationId: m.operationId, reason: m.ausschluss!.grund })),
            });
        }
        case "series_changed":
            return new ApiError(409, "series_changed", "Die Serie ist seit dem Öffnen gewachsen.", {
                members: vor.neueMitglieder ?? [],
                membersHash: vor.neuerHash ?? "",
            });
        case "already_reverted":
            return new ApiError(409, "already_reverted", "Diese Änderungen sind schon zurückgenommen.", {
                revertedBy: await bisherigeRuecknahmen(
                    database,
                    vor.mitglieder.map((m) => m.operationId),
                ),
            });
        case "edit_conflict": {
            const erster = vor.konflikte[0];
            return new ApiError(
                409,
                "edit_conflict",
                "Seit diesen Änderungen hat sich etwas geändert. Die Rücknahme würde das überschreiben.",
                {
                    currentRevision: erster?.currentRevision ?? 0,
                    ...(erster?.changedAt !== undefined ? { changedAt: erster.changedAt } : {}),
                    ...(erster?.changedBy?.id !== undefined && erster.changedBy.name !== undefined
                        ? { changedBy: { id: erster.changedBy.id, displayName: erster.changedBy.name } }
                        : {}),
                    objects: vor.konflikte.map((konflikt) => ({
                        kind: konflikt.kind,
                        id: konflikt.id,
                        ...(konflikt.name !== undefined ? { name: konflikt.name } : {}),
                        art: konflikt.art,
                        currentRevision: konflikt.currentRevision ?? null,
                        changedBy: konflikt.changedBy ?? null,
                        changedAt: konflikt.changedAt ?? null,
                        ...(konflikt.operationId !== undefined ? { operationId: konflikt.operationId } : {}),
                        ...(konflikt.seq !== undefined ? { seq: konflikt.seq } : {}),
                        ...(konflikt.felder !== undefined ? { felder: konflikt.felder } : {}),
                        ...(konflikt.abweichung !== undefined ? { abweichung: konflikt.abweichung } : {}),
                        ...(konflikt.detail !== undefined ? { detail: konflikt.detail } : {}),
                    })),
                },
            );
        }
    }
}

/** Ein Ergebnis, das nicht `ok` ist, ist ein Fehler; bei `ok` verlangt eine fremde Person einen Grund (Gate 2). */
export async function pruefeErgebnis(database: Queryable, vor: Vorpruefung, grund: string | undefined): Promise<void> {
    const fehler = await fehlerAus(database, vor);
    if (fehler !== undefined) throw fehler;
    if (vor.reasonRequired && grund === undefined)
        throw new ApiError(400, "reason_required", "Für die Änderungen einer anderen Person braucht es einen Grund.", {
            field: "reason",
            people: vor.fremdePersonen,
        });
}

/** Die offenen Mitglieder in der Folge der Serie (älteste zuerst). */
export const reihenfolge = (mitglieder: Vorpruefung["mitglieder"], offen: readonly string[]): string[] =>
    mitglieder
        .filter((m) => offen.includes(m.operationId))
        .sort((a, b) => a.seq - b.seq)
        .map((m) => m.operationId);

/** Die Gegenstände der Mitglieder (`<art>:<kennung>`), aus dem Protokoll. */
async function scopesAller(database: Queryable, ids: readonly string[]): Promise<ReadonlySet<string>> {
    const jeOperation = await new SerienLeser(database).scopes(ids);
    return new Set(ids.flatMap((id) => jeOperation.get(id) ?? []));
}

/** Der Grund, getrimmt; leer heißt keiner. */
export const grundVon = (reason: string | undefined): string | undefined =>
    reason === undefined || reason.trim() === "" ? undefined : reason.trim();

/**
 * Nimmt die Mitglieder einer Serie (oder eine Einzeloperation) in EINER Operation zurück (siehe Kopf der Datei). Reihenfolge: Anmeldung, Recht, Kartensperre und Schalter sind
 * Sache der Route.
 */
export async function fuehreRuecknahmeAus(parameter: {
    database: Database;
    actor: MapActor;
    leser: RuecknahmeLeser;
    familie: RuecknahmeFamilie;
    body: RuecknahmeBody;
    haken: RuecknahmeHaken;
}): Promise<RuecknahmeReceipt> {
    const { database, actor, leser, familie, body, haken } = parameter;
    const ids = [...new Set(body.members.map((id) => id.toLowerCase()))].sort();
    const hash = body.membersHash.toLowerCase();
    const grund = grundVon(body.reason);
    const eingabe: VorpruefungEingabe = { mapDomainId: familie.mapDomainId, mitglieder: ids, membersHash: hash };

    let reverts: string[] = ids;
    let vorab: Vorpruefung | undefined;
    if ((await MAP_OPERATION_STORE.find(database, body.operationId)) === undefined) {
        await haken.pruefeFremdeSperre(database, actor, await scopesAller(database, ids));
        vorab = await pruefeFamilie(database, eingabe, leser, familie);
        await pruefeErgebnis(database, vorab, grund);
        reverts = reihenfolge(vorab.mitglieder, vorab.offen);
    }

    // Eine bekannte Kennung (Wiederholung) schreibt nichts und liefert die erste Quittung, gleich über welche Naht.
    const naht =
        typeof familie.naht === "function" ? (vorab === undefined ? "karte" : familie.naht(vorab)) : familie.naht;
    const schreibnaht: typeof mapOperation =
        naht === "inhalte"
            ? (db, akteur, eingabe, arbeit) =>
                  inhalteOperation(
                      db,
                      akteur,
                      {
                          operationId: eingabe.operationId,
                          operation: eingabe.operation,
                          body: eingabe.body,
                          ...(eingabe.source === undefined ? {} : { source: eingabe.source }),
                          ...(eingabe.reverts === undefined ? {} : { reverts: eingabe.reverts }),
                      },
                      arbeit,
                  )
            : mapOperation;
    const quittung = await schreibnaht(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: familie.operation,
            mapDomainId: familie.mapDomainId,
            body: {
                scope: familie.scope,
                members: ids,
                membersHash: hash,
                ...(grund !== undefined ? { reason: grund } : {}),
            },
            source: "restore",
            reverts,
        },
        async (tx) => {
            // Die Arbeit läuft nur, wenn die Kennung noch unbekannt ist; dann hat die Vorprüfung davor stattgefunden.
            if (vorab === undefined) throw new Error("Rücknahme ohne Vorprüfung");
            await haken.pruefeFremdeSperre(tx, actor, await scopesAller(tx, ids));
            await haken.sperreZeilen(tx, vorab);
            // Der Preflight ist keine Zusage (C.2): unter den Sperren noch einmal, und dieselben Mitglieder.
            const vor = await pruefeFamilie(tx, eingabe, leser, familie);
            await pruefeErgebnis(tx, vor, grund);
            if (reihenfolge(vor.mitglieder, vor.offen).join() !== reverts.join())
                throw new ApiError(
                    409,
                    "series_changed",
                    "Die Serie hat sich während der Rücknahme geändert. Bitte noch einmal öffnen.",
                    { members: ids, membersHash: hash },
                );
            return haken.schreibe({ tx, vor, offen: reverts, grund });
        },
    );
    const links = await database<{ id: string }[]>`
        SELECT reverted_operation_id::text AS id FROM map_operation_revert_link
         WHERE restore_operation_id = ${quittung.operationId}::uuid ORDER BY position
    `;
    return { ...quittung, reverts: links.map((link) => link.id) } as RuecknahmeReceipt;
}
