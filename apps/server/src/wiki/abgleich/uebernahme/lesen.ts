import {
    WIKISYNC_BEREICHE,
    wikisyncAngeschlossen,
    wikisyncHatKategorien,
    type WikisyncBereiche,
    type WikisyncUebernahmeKurz,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import { isMissingTable } from "../../../system/state-row.ts";

/**
 * Der Stand des WikiSync für die Verwaltung (WI-0253 D-1): je Bereich, ob die Übernahme einen Schreiber hat (dann gehört er dem WikiSync), ob er einen Wiki-Teil braucht
 * und was die jüngste Übernahme oder Rücknahme tat. Gelesen als App-Rolle; die Namen der Auslöser kommen aus dem Schema der Verwaltung.
 *
 * Fehlt `wikisync_uebernahme` (vor Migration 0225), ist keine Übernahme bekannt, nichts bricht.
 */

type Zeile = Record<string, unknown>;

const zeit = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);

export async function leseBereiche(db: Queryable, jetzt: Date): Promise<WikisyncBereiche> {
    const letzte = new Map<string, WikisyncUebernahmeKurz>();
    try {
        const zeilen = await db<Zeile[]>`
            SELECT DISTINCT ON (u.bereich)
                   u.bereich, u.id::int AS id, u.art, u.lauf_id::int AS lauf_id, u.status, u.gestartet_am, u.beendet_am, u.grund,
                   COALESCE(p.display_name, u.ausgeloest_label, 'automatisch') AS wer,
                   COALESCE((u.zahlen ->> 'felder')::int, 0) AS felder, COALESCE((u.zahlen ->> 'befunde')::int, 0) AS befunde,
                   (u.zahlen ->> 'schonGleich')::int AS gleich, (u.zahlen ->> 'angelegt')::int AS angelegt,
                   (u.zahlen ->> 'stillgelegt')::int AS stillgelegt, (u.zahlen ->> 'quellenAngelegt')::int AS quellen_angelegt,
                   (u.zurueckgenommen_am IS NOT NULL) AS zurueckgenommen
              FROM wikisync_uebernahme u
              LEFT JOIN avesmaps_auth.person p ON p.id = u.ausgeloest_von
             ORDER BY u.bereich, u.id DESC
        `;
        for (const zeile of zeilen) {
            letzte.set(String(zeile["bereich"]), {
                id: Number(zeile["id"]),
                art: zeile["art"] as WikisyncUebernahmeKurz["art"],
                lauf: Number(zeile["lauf_id"]),
                status: zeile["status"] as WikisyncUebernahmeKurz["status"],
                gestartetAm: zeit(zeile["gestartet_am"]) ?? "",
                beendetAm: zeit(zeile["beendet_am"]),
                ausgeloestVon: (zeile["wer"] as string | null) ?? null,
                grund: (zeile["grund"] as string | null) ?? null,
                felder: Number(zeile["felder"]),
                befunde: Number(zeile["befunde"]),
                ...(zeile["gleich"] === null || zeile["gleich"] === undefined
                    ? {}
                    : { gleich: Number(zeile["gleich"]) }),
                ...(zeile["angelegt"] === null || zeile["angelegt"] === undefined
                    ? {}
                    : { angelegt: Number(zeile["angelegt"]) }),
                ...(zeile["stillgelegt"] === null || zeile["stillgelegt"] === undefined
                    ? {}
                    : { stillgelegt: Number(zeile["stillgelegt"]) }),
                ...(zeile["quellen_angelegt"] === null || zeile["quellen_angelegt"] === undefined
                    ? {}
                    : { quellenAngelegt: Number(zeile["quellen_angelegt"]) }),
                zurueckgenommen: zeile["zurueckgenommen"] === true,
            });
        }
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    return {
        jetzt: jetzt.toISOString(),
        bereiche: WIKISYNC_BEREICHE.map((bereich) => ({
            bereich,
            angeschlossen: wikisyncAngeschlossen(bereich),
            kategorien: wikisyncHatKategorien(bereich),
            letzteUebernahme: letzte.get(bereich) ?? null,
        })),
    };
}
