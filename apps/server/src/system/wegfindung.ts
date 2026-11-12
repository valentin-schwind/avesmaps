import {
    AVENTURIA_TRAVEL_MODEL,
    WEGFINDUNG_AM_KNOPF,
    wegfindungGrenzen,
    wegfindungImRahmen,
    wegfindungVorgabe,
    wegfindungVorgaben,
    wegfindungWert,
    type SeegraphStand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { SEA_ROUTE_ALGORITHM, seaRouteFingerprint } from "../routing/sea-derive.ts";
import { WATER_REGION_TYPES } from "../routing/sea-grid.ts";

/**
 * Verstellen und Freigeben der Kenngrößen der Wegfindung (WI-0153, Bauplan §9 Schnitte 2, 3 und 6). Der Leseweg steht in
 * `wegfindungsstand.ts` — ohne Fastify, weil die Werkzeuge ihn laden; hier darf `ApiError` stehen, denn nur die Route
 * ruft diese beiden Funktionen.
 *
 * 🔴 **Speichern ist nicht Freigeben — für die Werte am Knopf.** `verstelleWegfindung` schreibt in `routing_setting`
 * (das Feld im Reiter). Für die Kennungen der Folge `netz` ändert das am Routing nichts: `gibWegfindungFrei` schreibt
 * sie nach `routing_setting_applied` fort, und ERST das ändert den Revisionsteil `settings`; danach reiht die Freigabe
 * `routing_reload` ein. Alle anderen Kennungen stehen im Teil `settingsLive` und gelten ohne Knopf (WI-0153 Schnitt 6).
 *
 * Beide arbeiten in der Transaktion des Aufrufers, der im selben Zug das Protokoll schreibt (SYS-0001 §9d.2).
 */

/** Die Jobart, die der Knopf einreiht: Sie beobachtet, dass jede Instanz den neuen Stand geladen hat (WI-0125). */
export const ROUTING_RELOAD_KIND = "routing_reload";

/** Die Wegprofile neu rechnen (`jobs/path-profile-job.ts`): vor dem Laden, wenn die Freigabe den Maßstab ändert (WI-0153 7d). */
export const PATH_PROFILE_KIND = "path_profile";

/** Den Seegraphen neu ableiten (`jobs/seegraph-job.ts`, WI-0153 7b): vor dem Laden, zwei bis fünf Minuten. */
export const SEA_DERIVE_KIND = "sea_derive";

/**
 * Wie der Seegraph zu seinen Quellen steht (WI-0153 7b und 7c; Betreiber 2026-10-18: „Seewege“ über den einen Knopf). `stale`, wenn
 * es keinen gibt oder sein Algorithmus oder Fingerabdruck nicht mehr zu Meeren, Seen, Häfen, Klimabändern, Reisemodell und den
 * FREIGEGEBENEN Werten des Seegraphen passt — dieselbe Rechnung, mit der die Ableitung entscheidet, ob sie rechnet
 * (`seaRouteFingerprint`; eine Anweisung, gemessen rund 10 ms). Dazu der jüngste Auftrag `sea_derive` (ein wartender oder laufender
 * vor einem fertigen) und, wenn er wartet, seine interne Kennung für `p_depends_on`.
 *
 * 🪤 Ohne Graphen ist er nur veraltet, wenn es Wasser gibt, aus dem einer entstünde: Eine Datenbank ohne Meere und Seen (die geteilte
 * Testdatenbank, eine frische Umgebung vor dem ersten Import) hat nichts abzuleiten, und der Knopf soll dort nicht dazu auffordern.
 */
async function gibtWasser(db: Queryable, mapDomainId: string): Promise<boolean> {
    const [zeile] = await db<{ da: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
             WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.region_type IN ${db([...WATER_REGION_TYPES])}
        ) AS da
    `;
    return zeile?.da ?? false;
}

export async function seegraphLage(
    db: Queryable,
    mapDomainId: string,
): Promise<SeegraphStand & { wartendId: string | null }> {
    const [graph] = await db<{ derived_at: Date; algorithm_version: string; source_fingerprint: string }[]>`
        SELECT derived_at, algorithm_version, source_fingerprint FROM sea_route_graph WHERE map_domain_id = ${mapDomainId}
    `;
    const stale =
        graph === undefined
            ? await gibtWasser(db, mapDomainId)
            : graph.algorithm_version !== SEA_ROUTE_ALGORITHM ||
              graph.source_fingerprint !== (await seaRouteFingerprint(db, mapDomainId, AVENTURIA_TRAVEL_MODEL));
    const [auftrag] = await db<{ id: string; public_id: string; state: string }[]>`
        SELECT id::text AS id, public_id::text AS public_id, state FROM job
         WHERE kind = ${SEA_DERIVE_KIND} AND map_domain_id = ${mapDomainId}
         ORDER BY (state IN ('QUEUED', 'RUNNING')) DESC, id DESC
         LIMIT 1
    `;
    return {
        derivedAt: graph?.derived_at.toISOString() ?? null,
        stale,
        job: auftrag?.public_id ?? null,
        jobState: auftrag?.state ?? null,
        wartendId: auftrag?.state === "QUEUED" ? auftrag.id : null,
    };
}

export interface Verstellen {
    id: string;
    /** Der neue Wert, oder `null`: zurück auf die Vorgabe (die Zeile wird gelöscht). */
    value: number | null;
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

/**
 * Verstellt einen Wert oder setzt ihn zurück, in der Transaktion des Aufrufers (der das Protokoll im selben Zug schreibt).
 *
 * - `baseRevision` ist die Revision, die die Oberfläche gesehen hat; veraltet: 409 `edit_conflict`.
 * - Kennung nicht im Register: 400 `unknown_setting`. Wert außerhalb der Grenzen seiner Vorgabe: 400 `value_out_of_range`.
 * - Steht der Wert schon so (auch: schon auf der Vorgabe, also ohne Zeile): 409 `no_change`, wie beim Inhaltsschalter. Sonst
 *   stünde ein Protokolleintrag über eine Änderung da, die keine war.
 *
 * Gibt den vorigen Stand (`from`, `null` heißt Vorgabe) und die neue Revision zurück.
 */
export async function verstelleWegfindung(
    tx: Queryable,
    input: Verstellen,
): Promise<{ from: number | null; to: number | null; revision: number }> {
    const wert = wegfindungWert(input.id);
    if (wert === undefined) throw new ApiError(400, "unknown_setting", "Diese Einstellung gibt es nicht.");
    if (input.value !== null && !wegfindungImRahmen(wert, input.value)) {
        const grenzen = wegfindungGrenzen(wert);
        throw new ApiError(
            400,
            "value_out_of_range",
            `Erlaubt ist ${String(grenzen.min)} bis ${String(grenzen.max)}; die Vorgabe ist ${String(wegfindungVorgabe(wert))}.`,
            { min: grenzen.min, max: grenzen.max, vorgabe: wegfindungVorgabe(wert) },
        );
    }
    await pruefeRevision(tx, input);
    const [vorher] = await tx<{ value: number }[]>`SELECT value FROM routing_setting WHERE key = ${input.id}`;
    const from = vorher?.value ?? null;
    if (from === input.value) throw new ApiError(409, "no_change", "Der Wert steht schon so.");
    if (input.value === null) await tx`DELETE FROM routing_setting WHERE key = ${input.id}`;
    else
        await tx`
            INSERT INTO routing_setting (key, value, changed_at, changed_by, changed_by_label)
            VALUES (${input.id}, ${input.value}, now(), ${input.actor.personId}::uuid, ${input.actor.label})
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value, changed_at = now(), changed_by = EXCLUDED.changed_by,
                changed_by_label = EXCLUDED.changed_by_label
        `;
    const [neu] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM routing_setting_state WHERE id = 1`;
    return { from, to: input.value, revision: neu!.revision };
}

/**
 * Sperrt die Zustandszeile und vergleicht die Revision, die die Oberfläche gesehen hat (WI-0214, Befund S1-06: der Block
 * stand zweimal in dieser Datei). Fehlt die Tafel: 503; veraltet: der Konflikt des Aufrufers, sonst 409 `edit_conflict`.
 *
 * 🪤 Die Sperrart bleibt `FOR UPDATE`: Die App hat auf `routing_setting_state` das Recht UPDATE (sie schreibt `applied_*`),
 * und eine Beratungssperre wie bei den Karteneinstellungen wäre hier eine zweite Art, ohne etwas zu gewinnen.
 */
async function pruefeRevision(
    tx: Queryable,
    input: { baseRevision: number; conflict?: Verstellen["conflict"] },
): Promise<void> {
    const [state] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM routing_setting_state WHERE id = 1 FOR UPDATE
    `;
    if (state === undefined) {
        throw new ApiError(503, "wegfindung_unprovisioned", "Die Tafel der Wegfindung fehlt noch in dieser Umgebung.");
    }
    if (state.revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
}

export interface Freigabe {
    baseRevision: number;
    mapDomainId: string;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

/**
 * Gibt den gespeicherten Stand frei: Er wird nach `routing_setting_applied` kopiert, und erst damit ändert sich die
 * Routing-Revision. Danach reiht die Funktion `routing_reload` ein — der Auftrag rechnet nichts, er beobachtet, bis
 * JEDE Fastify-Instanz die neue Revision meldet; in der Warteschlange ist er sichtbar wie jeder andere.
 *
 * - `baseRevision` ist die Revision, die die Oberfläche gesehen hat; veraltet: 409 `edit_conflict`.
 * - Steht nichts an (gespeichert und freigegeben sind gleich, für die Werte am Knopf) und passt der Seegraph zu seinen Quellen
 *   (oder wartet seine Ableitung schon): 409 `nothing_to_apply`. Sonst
 *   stünde ein Auftrag in der Warteschlange, der nichts zu beobachten hat, und ein Protokolleintrag über eine
 *   Freigabe, die keine war. Ein verstellter Wert OHNE Knopf ist kein Grund zur Freigabe: Er gilt schon.
 * - 🪤 Die Werte werden in DERSELBEN Transaktion kopiert, in der der Aufrufer das Protokoll schreibt: Wer zwischen
 *   Kopie und Auftrag verstellt, landet im nächsten Lauf, nicht in diesem.
 */
export async function gibWegfindungFrei(
    tx: Queryable,
    input: Freigabe,
): Promise<{
    werte: number;
    job: string | null;
    vorarbeit: { kind: string; job: string }[];
    seegraph: string | null;
    revision: number;
}> {
    await pruefeRevision(tx, input);
    // Wie viele Werte AM KNOPF sich zwischen gespeichert und gerechnet unterscheiden — dieselbe Zahl, die die Leiste
    // nennt. 🪤 Als Mengendifferenz geschrieben wäre es falsch: `A EXCEPT ALL B UNION C EXCEPT ALL D` bindet in
    // PostgreSQL von links, nicht als symmetrische Differenz. Der äußere Verbund über die Kennung sagt dasselbe.
    const amKnopf = WEGFINDUNG_AM_KNOPF as readonly string[];
    const [offen] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM (SELECT key, value FROM routing_setting WHERE key = ANY(${amKnopf}::text[])) r
          FULL OUTER JOIN routing_setting_applied a ON a.key = r.key
         WHERE r.value IS DISTINCT FROM a.value
    `;
    // Ohne offenen Wert gibt es trotzdem etwas zu tun, wenn der Seegraph nicht mehr zu Meeren, Seen oder Häfen passt (WI-0153 7b;
    // Betreiber 2026-10-18: „Seewege“ über den einen Knopf) und seine Ableitung nicht schon wartet.
    if ((offen?.n ?? 0) === 0) {
        const lage = await seegraphLage(tx, input.mapDomainId);
        if (!lage.stale || lage.wartendId !== null) {
            throw new ApiError(
                409,
                "nothing_to_apply",
                "Es ist nichts freizugeben: Gespeichert und gerechnet sind gleich.",
            );
        }
    }
    // Ändert die Freigabe den Maßstab, rechnen die gespeicherten Steigungen der Wege mit (Betreiber 2026-10-17, WI-0214 §4
    // Frage 2): sonst rechnete das Netz mit Profilen eines anderen Maßstabs. Gelesen VOR dem Fortschreiben.
    const massstab = await aendertMassstab(tx);
    await tx`DELETE FROM routing_setting_applied`;
    const [kopiert] = await tx<{ n: number }[]>`
        WITH neu AS (
            INSERT INTO routing_setting_applied (key, value)
            SELECT key, value FROM routing_setting WHERE key = ANY(${amKnopf}::text[])
            RETURNING 1
        )
        SELECT count(*)::int AS n FROM neu
    `;
    const actorRef = input.actor.personId ?? input.actor.label;
    const vorarbeit: { id: string; kind: string; job: string }[] = [];
    if (massstab !== null) {
        const [profile] = await tx<{ id: string; public_id: string }[]>`
            SELECT id::text AS id, public_id::text AS public_id
              FROM job_enqueue(${PATH_PROFILE_KIND}, 1::smallint, ${input.mapDomainId}, ${actorRef},
                               ${tx.json({ grund: "wegfindung", schrittPerUnit: massstab })})
        `;
        if (profile) vorarbeit.push({ id: profile.id, kind: PATH_PROFILE_KIND, job: profile.public_id });
    }
    // Der Seegraph (WI-0153 7c): NACH dem Fortschreiben gefragt, denn seine freigegebenen Werte gehen in den Fingerabdruck. Passt er
    // nicht mehr, rechnet ihn die Ableitung neu; wartet sie schon, hängt der Reload an ihr (sie liest beim Start den neuesten Stand).
    const see = await seegraphLage(tx, input.mapDomainId);
    let seegraph: string | null = null;
    if (see.stale) {
        const [ableitung] =
            see.wartendId !== null && see.job !== null
                ? [{ id: see.wartendId, public_id: see.job }]
                : await tx<{ id: string; public_id: string }[]>`
                      SELECT id::text AS id, public_id::text AS public_id
                        FROM job_enqueue(${SEA_DERIVE_KIND}, 1::smallint, ${input.mapDomainId}, ${actorRef},
                                         ${tx.json({ grund: "wegfindung" })})
                  `;
        if (ableitung) {
            vorarbeit.push({ id: ableitung.id, kind: SEA_DERIVE_KIND, job: ableitung.public_id });
            seegraph = ableitung.public_id;
        }
    }
    // Freigaben bündeln (Claudio 2026-11-03): Ein Reload lädt den Graphen im laufenden Server, die Wegfindung ist dabei Sekunden weg. Wartet schon
    // einer, liest er beim Start ohnehin den neuesten Stand. Mit neuer Vorarbeit bleibt es ein eigener, denn er muss hinter ihr laufen.
    const [wartend] =
        vorarbeit.length > 0
            ? []
            : await tx<{ public_id: string }[]>`
                  SELECT public_id::text AS public_id FROM job
                   WHERE kind = ${ROUTING_RELOAD_KIND} AND map_domain_id = ${input.mapDomainId} AND state = 'QUEUED'
                   ORDER BY id DESC LIMIT 1
              `;
    // 🪤 `routing_reload` liest beim Start, welche Revision er erwartet: Er läuft deshalb HINTER der Vorarbeit.
    const [job] =
        wartend !== undefined
            ? [wartend]
            : await tx<{ public_id: string }[]>`
                  SELECT public_id::text AS public_id
                    FROM job_enqueue(${ROUTING_RELOAD_KIND}, 1::smallint, ${input.mapDomainId}, ${actorRef},
                                     ${tx.json({ grund: "wegfindung" })},
                                     p_depends_on => ${vorarbeit.map((entry) => entry.id)}::bigint[])
              `;
    await tx`
        UPDATE routing_setting_state
           SET applied_at = now(), applied_by = ${input.actor.personId}::uuid,
               applied_by_label = ${input.actor.personId === null ? input.actor.label : null},
               applied_job = ${job?.public_id ?? null}::uuid
         WHERE id = 1
    `;
    const [neu] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM routing_setting_state WHERE id = 1`;
    return {
        werte: kopiert?.n ?? 0,
        job: job?.public_id ?? null,
        vorarbeit: vorarbeit.map(({ kind, job: jobId }) => ({ kind, job: jobId })),
        seegraph,
        revision: neu!.revision,
    };
}

/**
 * Der neue Maßstab („Schritt je Karteneinheit“), wenn die Freigabe ihn gegenüber dem freigegebenen Stand ändert, sonst `null`.
 * Fehlt eine Zeile, gilt die Vorgabe des Registers.
 */
async function aendertMassstab(tx: Queryable): Promise<number | null> {
    const [zeile] = await tx<{ gespeichert: number | null; freigegeben: number | null }[]>`
        SELECT (SELECT value::float8 FROM routing_setting WHERE key = 'schrittPerUnit') AS gespeichert,
               (SELECT value::float8 FROM routing_setting_applied WHERE key = 'schrittPerUnit') AS freigegeben
    `;
    const vorgabe = wegfindungVorgaben().schrittPerUnit;
    const neu = zeile?.gespeichert ?? vorgabe;
    return neu === (zeile?.freigegeben ?? vorgabe) ? null : neu;
}
