import {
    EDITOR_LOCK_TIMEOUT_MINUTES,
    hauptGegenstand,
    type Bezeichnung,
    type BesuchEditor,
    type BesuchEditoren,
} from "@avesmaps3d/shared";
import { sonderrollenJePerson } from "../auth/sonderrollen.ts";
import type { Queryable } from "../database.ts";
import { eintraegeNachKennung } from "../editor/history.ts";
import { LIVE_FENSTER_MINUTEN } from "./zaehler.ts";

/**
 * Wer im Editor ist (WI-0141b, Betreiber 2026-10-14: „so weiß jeder wer gerade online ist und was macht“).
 *
 * Alles kommt aus dem, was die Anmeldung ohnehin führt — es wird nichts Neues über Personen erfasst:
 *
 * | Angabe | Quelle |
 * |---|---|
 * | Name, Rolle, Verantwortung | `person`, `person_access` (WI-0133 für „Verantwortlich für“) |
 * | Bezeichnung, Sonderrollen | `person`, `sonderrolle_zuteilung` (WI-0279 E9b, E10) |
 * | zuletzt da, online | `session.last_seen_at` der laufenden Sitzungen |
 * | Gerät | `session.client_label` — wie die Sitzung sich selbst nennt |
 * | Tage aktiv | an wie vielen der letzten dreißig Tage eine Sitzung lebte |
 * | was gerade | die jüngste geltende Sperre (`editor_lock`, WI-0276) |
 * | zuletzt geändert, Zahl der Änderungen | `map_operation` (WI-0276), steht ohnehin offen im Reiter „Änderungen“ |
 *
 * 🔴 **Nur diese Umgebung, nur aktive Zugänge.** Wer hier keinen Zugang (mehr) hat, steht nicht in der Liste; ein
 * gesperrtes Konto ebenso wenig. Keine Adresse, kein Anmeldeweg, kein Sperrgrund — das ist Sache der Personenverwaltung.
 *
 * 🪤 `last_seen_at` ist je **Sitzung**. Wer an zwei Geräten arbeitet, hat zwei; gezählt wird die jüngste, und das Gerät
 * dazu ist das der jüngsten Sitzung. Ohne diese Wahl zeigte die Liste zufällig das zuerst gefundene Gerät.
 */
export async function leseEditoren(sql: Queryable, environment: string): Promise<BesuchEditoren> {
    const zeilen = await sql<
        {
            id: string;
            name: string;
            rolle: string;
            bezeichnung: Bezeichnung | null;
            verantwortung: string | null;
            zuletzt: Date | null;
            geraet: string | null;
            ansicht: string | null;
            sitzungen: string;
            tage_aktiv: string;
        }[]
    >`
        WITH lebend AS (
            SELECT person_id, last_seen_at, client_label, view_key,
                   ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY last_seen_at DESC) AS rang
              FROM avesmaps_auth.session
             WHERE environment = ${environment} AND revoked_at IS NULL AND expires_at > now()
        )
        SELECT p.id::text, p.display_name AS name, a.role AS rolle, p.bezeichnung, p.responsible_for AS verantwortung,
               j.last_seen_at AS zuletzt, j.client_label AS geraet, j.view_key AS ansicht,
               (SELECT COUNT(*)::text FROM lebend l WHERE l.person_id = p.id) AS sitzungen,
               (SELECT COUNT(DISTINCT date_trunc('day', s.last_seen_at))::text
                  FROM avesmaps_auth.session s
                 WHERE s.person_id = p.id AND s.environment = ${environment}
                   AND s.last_seen_at >= now() - interval '30 days') AS tage_aktiv
          FROM avesmaps_auth.person p
          JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = ${environment}
          LEFT JOIN lebend j ON j.person_id = p.id AND j.rang = 1
         WHERE p.status = 'active' AND a.status = 'active'
         ORDER BY j.last_seen_at DESC NULLS LAST, lower(p.display_name)
    `.catch(() => []);

    const ids = zeilen.map((zeile) => zeile.id);
    const [sperren, letzte, zahlen, sonderrollen] = await Promise.all([
        leseSperren(sql, ids),
        leseLetzteAenderungen(sql, ids),
        leseAenderungsZahlen(sql, ids),
        // Wie die Angaben davor: Fällt sie aus, bleibt die Liste stehen.
        sonderrollenJePerson(sql, environment, ids).catch(() => new Map<string, never[]>()),
    ]);

    const grenze = Date.now() - LIVE_FENSTER_MINUTEN * 60_000;
    return {
        editoren: zeilen.map((zeile) => ({
            id: zeile.id,
            name: zeile.name,
            rolle: zeile.rolle,
            bezeichnung: zeile.bezeichnung,
            sonderrollen: sonderrollen.get(zeile.id) ?? [],
            verantwortung: zeile.verantwortung,
            zuletzt: zeile.zuletzt?.toISOString() ?? null,
            online: zeile.zuletzt !== null && zeile.zuletzt.getTime() >= grenze,
            geraet: zeile.geraet,
            ansicht: zeile.ansicht,
            sitzungen: Number(zeile.sitzungen),
            tageAktiv: Number(zeile.tage_aktiv),
            bearbeitet: sperren.get(zeile.id) ?? null,
            zuletztGeaendert: letzte.get(zeile.id) ?? null,
            aenderungen: zahlen.get(zeile.id) ?? 0,
        })),
        fensterMinuten: LIVE_FENSTER_MINUTEN,
    };
}

/**
 * Die jüngste geltende Sperre je Person: gleiche Frist wie die Liste der Sperren (`listEditorLocks`). Der Name ist der heutige; ein Objekt ohne Namen steht mit seiner Art da.
 * 🔴 Fällt diese Angabe aus, bleibt die Liste stehen, nur ohne sie: Wer wer ist, hängt nicht an ihr.
 */
async function leseSperren(
    sql: Queryable,
    ids: readonly string[],
): Promise<ReadonlyMap<string, NonNullable<BesuchEditor["bearbeitet"]>>> {
    const zeilen = await sql<
        {
            person_id: string;
            art: NonNullable<BesuchEditor["bearbeitet"]>["art"];
            id: string;
            name: string | null;
            woran: NonNullable<BesuchEditor["bearbeitet"]>["woran"];
            seit: Date;
        }[]
    >`
        SELECT DISTINCT ON (l.person_id) l.person_id::text AS person_id, l.object_kind AS art, l.object_id::text AS id,
               l.part AS woran, l.since AS seit,
               COALESCE(o.name, nullif(w.name, ''), r.name, g.name, nullif(k.name, ''), t.name, s.name) AS name
          FROM editor_lock l
          LEFT JOIN place o ON l.object_kind = 'place' AND o.public_id = l.object_id
          LEFT JOIN path w ON l.object_kind = 'path' AND w.public_id = l.object_id
          LEFT JOIN region r ON l.object_kind = 'landscape' AND r.public_id = l.object_id
          LEFT JOIN territory g ON l.object_kind = 'territory' AND g.public_id = l.object_id
          LEFT JOIN powerline k ON l.object_kind = 'powerline' AND k.public_id = l.object_id
          LEFT JOIN terrain_peak t ON l.object_kind = 'peak' AND t.public_id = l.object_id
          LEFT JOIN sprache s ON l.object_kind = 'sprache' AND s.public_id = l.object_id
         WHERE l.person_id = ANY(${[...ids]}::uuid[])
           AND l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
         ORDER BY l.person_id, l.since DESC, l.object_id
    `.catch(() => []);
    return new Map(
        zeilen.map((zeile) => [
            zeile.person_id,
            { art: zeile.art, id: zeile.id, name: zeile.name, woran: zeile.woran, seit: zeile.seit.toISOString() },
        ]),
    );
}

/** Woran jede Person zuletzt etwas geändert hat. Name und Gegenstand wie im Reiter „Änderungen“, aus demselben Leseweg. */
async function leseLetzteAenderungen(
    sql: Queryable,
    ids: readonly string[],
): Promise<ReadonlyMap<string, NonNullable<BesuchEditor["zuletztGeaendert"]>>> {
    const zeilen = await sql<{ operation_id: string }[]>`
        SELECT DISTINCT ON (actor_person_id) operation_id::text AS operation_id
          FROM map_operation
         WHERE actor_person_id = ANY(${[...ids]}::uuid[])
         ORDER BY actor_person_id, at DESC, seq DESC
    `.catch(() => []);
    const { entries } = await eintraegeNachKennung(
        sql,
        zeilen.map((zeile) => zeile.operation_id),
        { personId: undefined, nutzlast: "felder" },
    ).catch(() => ({ entries: [] }));
    const letzte = new Map<string, NonNullable<BesuchEditor["zuletztGeaendert"]>>();
    for (const eintrag of entries) {
        const gegenstand = hauptGegenstand(eintrag.objects);
        if (gegenstand === undefined || eintrag.actor.id === undefined) continue;
        letzte.set(eintrag.actor.id, {
            art: gegenstand.kind,
            id: gegenstand.id,
            name: gegenstand.name ?? null,
            am: eintrag.at,
        });
    }
    return letzte;
}

async function leseAenderungsZahlen(sql: Queryable, ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const zeilen = await sql<{ person_id: string; zahl: string }[]>`
        SELECT actor_person_id::text AS person_id, COUNT(*)::text AS zahl
          FROM map_operation
         WHERE actor_person_id = ANY(${[...ids]}::uuid[])
         GROUP BY actor_person_id
    `.catch(() => []);
    return new Map(zeilen.map((zeile) => [zeile.person_id, Number(zeile.zahl)]));
}
