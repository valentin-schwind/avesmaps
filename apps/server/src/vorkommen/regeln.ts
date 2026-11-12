import type { InhalteVorkommenArt, InhalteVorkommenBeziehung, WikisyncLageRichtung } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { halbebeneVon, type Halbebene } from "./halbebene.ts";

/**
 * Die Regeln der Vorkommen in der Form, in der die Auswertung sie liest (WI-0257, S1): je Bedingung die Landschaftsarten, die Rahmenfläche mit ihrer Nummer, die Zonen der Klimaspanne und die
 * Halbebene der Lage. Nur lesend. Nichts hier rechnet Geometrie; das tun `karte.ts` (Richtung A) und `punkte.ts` (Richtung B).
 *
 * - **Regeln, die gelten:** aktive Regeln (`is_active`, `state = 'active'`) aktiver Einträge. Eine Regel mit einer Bedingung, die auf eine wartende Fläche zeigt (`wiki_area_title`, F4), wird
 *   ganz ausgelassen (WI-0253 §24 b). Eine Regel ohne Bedingung sagt nichts und fällt ebenfalls weg.
 * - **Die Fläche einer Bedingung** ist eine Aussage der Redaktion (`lore_rule_term.area_region_id`, sonst die Kennung aus Legacy). Gibt es sie nicht mehr, ist sie nicht aktiv oder verborgen
 *   (`region.is_hidden` gibt nichts her, auch keine Form), trifft die Bedingung NICHTS: Sie schränkt nie ab (anders als ein leeres Feld). Gezählt als `verwaiste`.
 * - **Arten:** Paare aus Ebene und Art; die Ebene `klima` trägt keine Landschaften und fällt weg. Nennt die Bedingung Arten und bleibt keine brauchbare übrig, trifft sie nichts.
 * - **Klima:** die Zonen der Spanne nach `climate_zone_type.sort_order`, beide Endpunkte tauschbar, geschlossen. Ein unbekannter Endpunkt heißt „keine Einschränkung“ (Legacy, Migration 0074).
 * - **Lage:** die Halbebene (`halbebene.ts`) aus den genauen Koordinaten der Orte; eine Lage, die nichts trennt, trifft nichts.
 */

export type Verknuepfung = "und" | "oder" | "ohne";

export interface Glied {
    readonly op: Verknuepfung;
    /** Die Arten als `ebene|art`, ohne die Ebene `klima`. */
    readonly arten: readonly string[];
    /** Die Bedingung nennt Arten (auch wenn keine brauchbar ist). */
    readonly nenntArten: boolean;
    /** `null`: keine Fläche gesetzt. Sonst die Nummer der Region, oder `null` darin, wenn es sie nicht (mehr) gibt. */
    readonly flaeche: { readonly regionId: string | null } | null;
    /** Die Zonen der Spanne (`climate_zone_type.type_key`, nur aktive); `null` ohne Klima. */
    readonly klima: { readonly zonen: readonly string[] } | null;
    /** `null` ohne Lage; die Halbebene darin ist `null`, wo die Linie nichts trennt. */
    readonly lage: { readonly halbebene: Halbebene | null } | null;
}

export interface Regel {
    readonly ruleId: string;
    readonly ruleKey: string;
    readonly beziehung: InhalteVorkommenBeziehung;
    /** `lore_entry.id` */
    readonly eintragId: string;
    readonly eintragPublicId: string;
    readonly art: InhalteVorkommenArt;
    readonly glieder: readonly Glied[];
    readonly verwaiste: number;
}

interface RegelZeile {
    id: string;
    rule_key: string;
    relation: string;
    eintrag_id: string;
    eintrag_public_id: string;
    kind: string;
}

interface GliedZeile {
    rule_id: string;
    id: string;
    join_op: string;
    wiki_area_title: string | null;
    area_region_id: string | null;
    legacy_area_public_id: string | null;
    climate_from: string | null;
    climate_to: string | null;
    legacy_climate_from: string | null;
    legacy_climate_to: string | null;
    line_direction: string | null;
    line_a_x: number | null;
    line_a_y: number | null;
    line_b_x: number | null;
    line_b_y: number | null;
    flaeche_sichtbar: boolean | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RICHTUNGEN: readonly string[] = ["nord", "sued", "ost", "west"];
const BEZIEHUNGEN: readonly string[] = ["verbreitung", "herkunft", "regionen", "vorkommen"];
const ARTEN: readonly string[] = ["fauna", "flora", "ware", "spezies"];

/** Die Zonen: Schlüssel, Rang von Norden nach Süden, aktiv. */
async function ladeZonen(database: Queryable): Promise<{ key: string; rang: number; aktiv: boolean }[]> {
    const zeilen = await database<{ type_key: string; sort_order: number; is_active: boolean }[]>`
        SELECT type_key, sort_order, is_active FROM climate_zone_type ORDER BY sort_order
    `;
    return zeilen.map((z) => ({ key: z.type_key, rang: z.sort_order, aktiv: z.is_active }));
}

/**
 * Die aktiven Regeln, auf Wunsch nur die eines Eintrags (`lore_entry.id`). In der Reihenfolge `sort_order`, `id`, wie die Ketten im Editor.
 * Regeln mit einer wartenden Fläche und leere Regeln sind schon draußen.
 */
export async function ladeRegeln(database: Queryable, eintragId?: string): Promise<Regel[]> {
    const regeln =
        eintragId === undefined
            ? await database<RegelZeile[]>`
                  SELECT r.id::text AS id, r.rule_key, r.relation, e.id::text AS eintrag_id, e.public_id::text AS eintrag_public_id, e.kind
                    FROM lore_rule r
                    JOIN lore_entry e ON e.id = r.lore_entry_id AND e.is_active AND e.state = 'active'
                   WHERE r.is_active AND r.state = 'active'
                   ORDER BY r.lore_entry_id, r.sort_order, r.id
              `
            : await database<RegelZeile[]>`
                  SELECT r.id::text AS id, r.rule_key, r.relation, e.id::text AS eintrag_id, e.public_id::text AS eintrag_public_id, e.kind
                    FROM lore_rule r
                    JOIN lore_entry e ON e.id = r.lore_entry_id AND e.is_active AND e.state = 'active'
                   WHERE r.is_active AND r.state = 'active' AND e.id = ${eintragId}::bigint
                   ORDER BY r.lore_entry_id, r.sort_order, r.id
              `;
    if (regeln.length === 0) return [];
    const ids = regeln.map((r) => r.id);
    const [glieder, zonen] = await Promise.all([
        database<GliedZeile[]>`
            SELECT t.lore_rule_id::text AS rule_id, t.id::text AS id, t.join_op, t.wiki_area_title, t.area_region_id::text AS area_region_id,
                   t.legacy_area_public_id, t.climate_from, t.climate_to, t.legacy_climate_from, t.legacy_climate_to, t.line_direction,
                   ST_X(pa.geom)::float8 AS line_a_x, ST_Y(pa.geom)::float8 AS line_a_y, ST_X(pb.geom)::float8 AS line_b_x, ST_Y(pb.geom)::float8 AS line_b_y,
                   -- Die Region der Redaktion trägt die Fläche nur, wenn sie aktiv und nicht verborgen ist.
                   (SELECT r.is_active AND NOT r.is_hidden FROM region r
                     WHERE r.id = t.area_region_id) AS flaeche_sichtbar
              FROM lore_rule_term t
              LEFT JOIN place pa ON pa.id = t.line_place_a_id
              LEFT JOIN place pb ON pb.id = t.line_place_b_id
             WHERE t.lore_rule_id = ANY(${ids}::bigint[])
             ORDER BY t.lore_rule_id, t.seq
        `,
        ladeZonen(database),
    ]);
    const termIds = glieder.map((g) => g.id);
    const arten =
        termIds.length === 0
            ? []
            : await database<{ term: string; layer: string; type: string }[]>`
                  SELECT y.lore_rule_term_id::text AS term, y.region_layer AS layer, y.region_type AS type
                    FROM lore_rule_term_type y WHERE y.lore_rule_term_id = ANY(${termIds}::bigint[])
                   ORDER BY y.lore_rule_term_id, y.region_layer, y.region_type
              `;
    // Legacy-Kennungen ohne Region der Redaktion: gibt es die Region mit dieser Kennung, trägt sie die Bedingung.
    const legacyKennungen = [
        ...new Set(
            glieder
                .filter((g) => g.area_region_id === null && g.legacy_area_public_id !== null)
                .map((g) => g.legacy_area_public_id as string)
                .filter((kennung) => UUID.test(kennung)),
        ),
    ];
    const legacyRegionen =
        legacyKennungen.length === 0
            ? []
            : await database<{ kennung: string; id: string }[]>`
                  SELECT r.public_id::text AS kennung, r.id::text AS id FROM region r
                   WHERE r.public_id = ANY(${legacyKennungen}::uuid[]) AND r.is_active AND NOT r.is_hidden
              `;
    const legacyNachKennung = new Map(legacyRegionen.map((r) => [r.kennung.toLowerCase(), r.id]));
    const artenNachGlied = new Map<string, { layer: string; type: string }[]>();
    for (const art of arten) {
        const liste = artenNachGlied.get(art.term);
        if (liste === undefined) artenNachGlied.set(art.term, [art]);
        else liste.push(art);
    }
    const gliederNachRegel = new Map<string, GliedZeile[]>();
    for (const glied of glieder) {
        const liste = gliederNachRegel.get(glied.rule_id);
        if (liste === undefined) gliederNachRegel.set(glied.rule_id, [glied]);
        else liste.push(glied);
    }
    const rangNachZone = new Map(zonen.map((z) => [z.key, z.rang]));

    const ergebnis: Regel[] = [];
    for (const regel of regeln) {
        const zeilen = gliederNachRegel.get(regel.id) ?? [];
        if (zeilen.length === 0) continue;
        // F4: Eine Bedingung auf eine wartende Fläche (ohne Fläche und ohne Kennung aus Legacy, mit Titel) lässt die ganze Regel außen vor.
        if (
            zeilen.some(
                (z) => z.area_region_id === null && z.legacy_area_public_id === null && z.wiki_area_title !== null,
            )
        )
            continue;
        if (!BEZIEHUNGEN.includes(regel.relation) || !ARTEN.includes(regel.kind)) continue;
        let verwaiste = 0;
        const bedingungen: Glied[] = zeilen.map((z, position) => {
            const gewaehlt = artenNachGlied.get(z.id) ?? [];
            const brauchbar = gewaehlt.filter((a) => a.layer !== "klima").map((a) => `${a.layer}|${a.type}`);
            let flaeche: Glied["flaeche"] = null;
            if (z.area_region_id !== null) {
                flaeche = { regionId: z.flaeche_sichtbar === true ? z.area_region_id : null };
            } else if (z.legacy_area_public_id !== null) {
                flaeche = { regionId: legacyNachKennung.get(z.legacy_area_public_id.toLowerCase()) ?? null };
            }
            if (flaeche !== null && flaeche.regionId === null) verwaiste += 1;
            const von = z.climate_from ?? z.legacy_climate_from;
            const bis = z.climate_to ?? z.legacy_climate_to;
            const rangVon = von === null ? undefined : rangNachZone.get(von);
            const rangBis = bis === null ? undefined : rangNachZone.get(bis);
            const klima: Glied["klima"] =
                rangVon === undefined || rangBis === undefined
                    ? null
                    : {
                          zonen: zonen
                              .filter(
                                  (zone) =>
                                      zone.aktiv &&
                                      zone.rang >= Math.min(rangVon, rangBis) &&
                                      zone.rang <= Math.max(rangVon, rangBis),
                              )
                              .map((zone) => zone.key),
                      };
            let lage: Glied["lage"] = null;
            if (
                z.line_direction !== null &&
                RICHTUNGEN.includes(z.line_direction) &&
                z.line_a_x !== null &&
                z.line_a_y !== null
            ) {
                const orte = [{ x: z.line_a_x, y: z.line_a_y }];
                if (z.line_b_x !== null && z.line_b_y !== null) orte.push({ x: z.line_b_x, y: z.line_b_y });
                lage = { halbebene: halbebeneVon(z.line_direction as WikisyncLageRichtung, orte) };
            }
            return {
                op: position === 0 ? "und" : z.join_op === "oder" ? "oder" : z.join_op === "ohne" ? "ohne" : "und",
                arten: brauchbar,
                nenntArten: gewaehlt.length > 0,
                flaeche,
                klima,
                lage,
            };
        });
        ergebnis.push({
            ruleId: regel.id,
            ruleKey: regel.rule_key,
            beziehung: regel.relation as InhalteVorkommenBeziehung,
            eintragId: regel.eintrag_id,
            eintragPublicId: regel.eintrag_public_id,
            art: regel.kind as InhalteVorkommenArt,
            glieder: bedingungen,
            verwaiste,
        });
    }
    return ergebnis;
}

/**
 * Der Kartenstand: ein billiger Fingerabdruck von allem, wovon die Auswertung abhängt, in EINER Abfrage. Daran hängt der Zwischenspeicher; ändert sich etwas, ist der Treffer beim nächsten Abruf neu.
 *
 * 🔴 Es gibt keinen Zähler für die ganze Karte, der Landschaften, Klimabänder und Orte zugleich trüge: `readSubjectRevision` (Bilder der Importläufe, Gebietsableitung, `map_operation.seq`) sieht
 * Operationen der Editoren, aber nicht die Ableitung der Klimabänder, die erst nach der Operation läuft, und nicht direkte Eingriffe. Darum zählt der Stand die Zeilen selbst: je Tafel die
 * Zahl, die Summe der Zeilenrevisionen (`region.revision`, `region_area.revision`, `place.revision`, gezählt von den Triggern, 0079 und 0137) und die jüngste Änderung. Dazu der jüngste Lauf der
 * Klimaableitung, die jüngste Operation der Editoren, die Regeln und ihre Einträge, seit WI-0257 S3a auch die Ortszeilen und ihre Ziele. Gemessen: eine Abfrage, rund 5 ms.
 */
export async function ermittleKartenstand(database: Queryable, mapDomainId = "aventuria"): Promise<string> {
    const [zeile] = await database<{ stand: string }[]>`
        SELECT concat_ws('|',
            (SELECT concat_ws(':', count(*), coalesce(sum(a.revision), 0), max(a.updated_at)) FROM region_area a WHERE a.is_active),
            (SELECT concat_ws(':', count(*), coalesce(sum(r.revision), 0), max(r.updated_at)) FROM region r),
            (SELECT concat_ws(':', count(*), max(b.derived_at), md5(string_agg(b.source_fingerprint, ',' ORDER BY b.type_key))) FROM climate_band b),
            (SELECT concat_ws(':', count(*), coalesce(sum(p.revision), 0), max(p.updated_at)) FROM place p),
            (SELECT string_agg(z.type_key || z.sort_order::text || z.is_active::text, ',' ORDER BY z.sort_order) FROM climate_zone_type z),
            (SELECT concat_ws(':', count(*), max(r.id), max(r.updated_at)) FROM lore_rule r),
            (SELECT concat_ws(':', count(*), max(t.id)) FROM lore_rule_term t),
            (SELECT concat_ws(':', count(*), max(e.updated_at)) FROM lore_entry e),
            -- Die Ortszeilen und ihre Ziele (WI-0257 S3a): Das Leuchten eines Eintrags liest sie neben den Regeln.
            (SELECT concat_ws(':', count(*), max(p.id), max(p.updated_at)) FROM lore_place p),
            (SELECT concat_ws(':', count(*), max(t.id)) FROM lore_place_target t),
            (SELECT max(o.seq) FROM map_operation o WHERE o.map_domain_id = ${mapDomainId}),
            (SELECT s.derived_revision FROM territory_state s WHERE s.map_domain_id = ${mapDomainId})
        ) AS stand
    `;
    return zeile?.stand ?? "";
}
