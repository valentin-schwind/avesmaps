import { createHash } from "node:crypto";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Die Revision einer Subject-Antwort (WI-0063 P4, Entwurf Abschnitt 3): der Satz der Legacy-Daten samt der Revision der
 * abgeleiteten Gebiete. Der Client cacht nur unter diesem Schlüssel und kurz; der Server baut seinen Speicherindex
 * (Objektlinks, Wegegruppen, Gebiete) je Revision neu.
 *
 * 🔴 Die Revision folgt den ABGESCHLOSSENEN Läufen der Importe (`migration_run`, je Datendomäne der jüngste), der
 * Ableitung der Gebiete (`territory_state.derived_revision`, der Inhalts-Fingerabdruck samt Anzeigejahr) und den Operationen der
 * Editoren an der Karte (`map_operation.seq`, die jüngste der Domäne; EDIT-0003 T50, 2026-10-17). Jeder Import, der lief - auch
 * derselbe Satz noch einmal -, und jedes Speichern in einem Editor ändert sie, ohne dass jemand Tabellen zählen oder Zeitstempel
 * vergleichen muss. 🪤 Vorher sah sie die Editoren nicht: Infopanel und Links zeigten einen umbenannten Ort oder eine Landschaft mit
 * neuer Art bis zum nächsten Import alt.
 *
 * 🔴 Dazu die Revision der Kanon-Tafeln (`canon_table_state`, Migration 0223, WI-0253 B-2): Rang 4 des Kanon-Etiketts wird beim LESEN aufgelöst,
 * eine Änderung an der Tafel je Objektart wechselt das Etikett also ohne neue Kanon-Zeile. Fehlt die Tafel (Fastify startet im Korridor vor
 * `migrate`), ist sie `null`.
 *
 * Wenige winzige Abfragen; sie laufen bei jeder Anfrage.
 */
export async function readSubjectRevision(database: Queryable, mapDomainId = "aventuria"): Promise<string> {
    const runs = await database<{ data_domain: string; completed_at: string }[]>`
        SELECT data_domain, max(completed_at)::text AS completed_at
        FROM migration_run
        WHERE status = 'completed' AND completed_at IS NOT NULL
        GROUP BY data_domain
        ORDER BY data_domain
    `;
    const [state] = await database<{ derived_revision: string | null }[]>`
        SELECT derived_revision FROM territory_state WHERE map_domain_id = ${mapDomainId}
    `;
    // Über den Index `map_operation_domain_seq` (0091): ein Griff.
    const [operation] = await database<{ seq: string | null }[]>`
        SELECT max(seq)::text AS seq FROM map_operation WHERE map_domain_id = ${mapDomainId}
    `;
    let kanonTafeln: string | null = null;
    try {
        const [tafel] = await database<
            { revision: string }[]
        >`SELECT revision::text AS revision FROM canon_table_state WHERE id = 1`;
        kanonTafeln = tafel?.revision ?? null;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    const parts = JSON.stringify([
        runs.map((run) => [run.data_domain, run.completed_at]),
        state?.derived_revision ?? null,
        operation?.seq ?? null,
        kanonTafeln,
    ]);
    return createHash("sha256").update(parts).digest("hex").slice(0, 12);
}
