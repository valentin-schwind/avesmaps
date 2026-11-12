import { kanonMitRang4, type InhalteTraegerArt, type SubjectCanon, type SubjectDetailKind } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseObjektartZeile } from "../kanon/tafel.ts";
import { canonOf, type CanonRow } from "../subjects/facts.ts";
import { CARRIER_TABLES } from "../subjects/carrier-tables.ts";

/**
 * Die Träger der Verwendungen einer Quelle (Migration 0066): welche Tabelle, welche Verknüpfungstafel, welche Spalte die Art nennt. Die
 * Namen sind Konstanten dieser Datei, nie Eingaben (Tabellennamen sind keine Parameter). Die Tabellen der Verknüpfung und des Kanons
 * kommen aus `subjects/carrier-tables.ts`, EINE Liste; neu ist nur die Spalte der Art.
 *
 * Die Redaktion nennt die Landschaft `area` (wie der Lesevertrag), die Tabelle heißt `region`.
 */
export interface TraegerTabellen {
    /** Die Art im Lesevertrag der Subjects (`place`, `path`, `territory`, `area`, `peak`). */
    kind: Extract<SubjectDetailKind, InhalteTraegerArt>;
    carrier: string;
    link: string;
    foreignKey: string;
    canon: string;
    /** Die Spalte der Art des Trägers (Ortsklasse, Gebietsart, Landschaftsart, Gipfelart, Wegtyp). */
    subtype: string;
}

function tabellen(kind: TraegerTabellen["kind"], subtype: string): TraegerTabellen {
    const eine = CARRIER_TABLES[kind];
    if (eine.link === null) throw new Error(`${kind} hat keine Verknüpfungstafel`);
    return { kind, carrier: eine.carrier, link: eine.link, foreignKey: eine.foreignKey, canon: eine.canon, subtype };
}

export const TRAEGER: Readonly<Record<InhalteTraegerArt, TraegerTabellen>> = {
    place: tabellen("place", "subtype"),
    territory: tabellen("territory", "territory_type"),
    area: tabellen("area", "region_type"),
    peak: tabellen("peak", "subtype"),
    path: tabellen("path", "subtype"),
};

/** Die Reihenfolge der Arten in der Liste der Verwendungen. */
export const TRAEGER_REIHENFOLGE: readonly InhalteTraegerArt[] = ["place", "territory", "area", "peak", "path"];

/**
 * Das Etikett von Trägern, wie es das Infopanel zeigt (`subjects/carrier-tables.ts`, `readCanon`): die abgeleitete Zeile des Trägers,
 * und wo es keine gibt Rang 4 der Tafel der Umgebung. Eine Abfrage je Art statt eine je Träger.
 */
export async function leseKanonJeTraeger(
    database: Queryable,
    kind: InhalteTraegerArt,
    publicIds: readonly string[],
): Promise<Map<string, SubjectCanon | undefined>> {
    const ergebnis = new Map<string, SubjectCanon | undefined>();
    if (publicIds.length === 0) return ergebnis;
    const tafeln = TRAEGER[kind];
    const zeilen = await database.unsafe<(CanonRow & { public_id: string })[]>(
        `SELECT c.public_id::text AS public_id, k.canon, k.designator_type, k.designator_count, k.designator_label
           FROM ${tafeln.carrier} c
           JOIN ${tafeln.canon} k ON k.${tafeln.foreignKey} = c.id
          WHERE c.public_id = ANY($1::uuid[])`,
        [[...publicIds]],
    );
    const artZeile = await leseObjektartZeile(database, kind);
    const vorhanden = new Map(zeilen.map((zeile) => [zeile.public_id, canonOf(zeile)]));
    for (const id of publicIds) {
        const eigene = vorhanden.get(id);
        // Eine Zeile `unlabelled` gewinnt vor Rang 4 (nur Publikationen belegen): `kanonMitRang4` lässt sie stehen.
        ergebnis.set(id, kanonMitRang4(eigene, artZeile));
    }
    return ergebnis;
}
