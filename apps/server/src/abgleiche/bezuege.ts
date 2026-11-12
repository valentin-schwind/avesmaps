import { LEGACY_ZUG_KATEGORIEN, type LegacyZugKategorie } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { createFinding, type Finding } from "../findings.ts";

/**
 * Die Bezüge zwischen den Kategorien des Legacy-Zugs (WI-0141, Handover `2026-10-13-legacy-zug-nach-production-je-kategorie.md`
 * §3.2). Claudio hat vorgeschlagen, abzubrechen („Erst ‚Orte‘ ziehen“). Das wäre falsch, und zwar aus dem Datenmodell heraus:
 *
 * 1. **Zwischen den Kategorien gibt es keinen Fremdschlüssel.** Ein Weg kennt keinen Ort; sein Ende hängt geometrisch an ihm
 *    (±`ENDPOINT_BOX`, `routing/topology.ts`). Eine Landschaft kennt keinen Weg. Ein halber Bezug kann also nicht entstehen —
 *    nur ein Ende, das nichts trifft, und das ist ein Zustand, den die Karte seit dem Cutoff trägt und zeigt (13 lose Wegenden
 *    am 2026-10-10, `project-control/state/current.md`).
 * 2. **3D-eigene Daten können nicht verwaisen.** Jeder Importer legt nur still, was `source_system = 'legacy'` trägt und im
 *    Schnitt seiner Quelle liegt (`migration/places.ts`). Ein Ort aus dem Ortseditor (`source_system = 'avesmaps3d'`,
 *    Migration 0091), ein Medien-Slot, eine Stätte, ein Typbild: Kein Zug fasst sie an.
 * 3. **Anhalten wäre ein Gate, das niemand bestellt hat.** Die Hausregel ist: Import, Ableitung und Prüfer halten nur bei
 *    definierten Prüfungen an, sonst gibt es einen Befund (Betreiber 2026-10-03, „A auch für die Prüfungen“). Ein Abbruch
 *    „erst Orte ziehen“ würde beim ersten losen Wegende losgehen, das es heute schon gibt — der Knopf wäre unbenutzbar.
 *
 * Statt dessen zählt dieser Bericht nach jedem Zug, was an der Naht zwischen den Kategorien nicht mehr zusammenpasst. Er
 * schreibt nichts und hält nichts an; die Zahlen gehen in den Bericht des Zugs und in die Jobzeile. Wird eine Zahl groß, ist
 * das die Ansage, auch die andere Kategorie zu ziehen.
 */

/** Ein Befund der Naht: wie viele Objekte betroffen sind und welche (bis `PROBEN` Namen als Probe). */
const PROBEN = 20;

export interface BezugsBefund {
    code: string;
    anzahl: number;
    namen: string[];
}

export interface BezugsBericht {
    kategorie: LegacyZugKategorie;
    befunde: BezugsBefund[];
}

/**
 * Wegenden, die an keinem aktiven Ort und an keinem anderen Wegende hängen („lose Wegenden“, WI-0132). Nach einem Zug der Orte
 * oder der Wege kann ihre Zahl steigen; sie ist das Maß der Naht zwischen diesen zwei Kategorien.
 */
async function loseWegenden(db: Queryable, mapDomainId: string): Promise<BezugsBefund> {
    const rows = await db<{ name: string }[]>`
        WITH enden AS (
            SELECT p.public_id, p.name, ST_StartPoint(p.geom) AS punkt FROM path p
             WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
            UNION ALL
            SELECT p.public_id, p.name, ST_EndPoint(p.geom) FROM path p
             WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
        )
        SELECT e.name
          FROM enden e
         WHERE NOT EXISTS (
                   SELECT 1 FROM place o
                    WHERE o.map_domain_id = ${mapDomainId} AND o.is_active
                      AND abs(ST_X(o.geom) - ST_X(e.punkt)) < 0.5
                      AND abs(ST_Y(o.geom) - ST_Y(e.punkt)) < 0.5
               )
           AND NOT EXISTS (
                   SELECT 1 FROM enden a
                    WHERE a.public_id <> e.public_id
                      AND round(ST_X(a.punkt)::numeric, 5) = round(ST_X(e.punkt)::numeric, 5)
                      AND round(ST_Y(a.punkt)::numeric, 5) = round(ST_Y(e.punkt)::numeric, 5)
               )
         ORDER BY e.name
    `;
    return { code: "wegende_ohne_anschluss", anzahl: rows.length, namen: rows.slice(0, PROBEN).map((r) => r.name) };
}

/**
 * Kraftlinien, deren gezeichnete Bahn nicht mehr an ihrem Ort beginnt oder endet. Kraftlinien gehören KEINER Kategorie
 * (`ohne_kategorie` in `config/legacy-zug-kategorien.json`): Verschiebt ein Zug der Orte einen Ort, an dem eine Kraftlinie
 * hängt, löst sich ihre Bahn sichtbar vom Ort. Genau das misst dieser Befund — er ist der Grund, über den der Betreiber
 * entscheiden muss, ob Kraftlinien mit „Orte“ mitfahren sollen.
 */
async function kraftlinienOhneOrt(db: Queryable, mapDomainId: string): Promise<BezugsBefund> {
    const rows = await db<{ name: string }[]>`
        SELECT p.name
          FROM powerline p
          LEFT JOIN place fp ON fp.public_id = p.from_public_id AND fp.map_domain_id = p.map_domain_id AND fp.is_active
          LEFT JOIN place tp ON tp.public_id = p.to_public_id AND tp.map_domain_id = p.map_domain_id AND tp.is_active
         WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
           AND (
                 (fp.id IS NOT NULL AND NOT ST_DWithin(ST_StartPoint(p.drawn_geom), fp.geom, 0.001))
              OR (tp.id IS NOT NULL AND NOT ST_DWithin(ST_EndPoint(p.drawn_geom), tp.geom, 0.001))
               )
         ORDER BY p.name
    `;
    return {
        code: "kraftlinie_loest_sich_vom_ort",
        anzahl: rows.length,
        namen: rows.slice(0, PROBEN).map((r) => r.name),
    };
}

/**
 * Gipfel und Vulkane, die in keiner aktiven Gebirgsfläche mehr liegen. Sie gehören ebenfalls keiner Kategorie; ein Zug der
 * Landschaften kann eine Gebirgsfläche verschieben und sie damit „in der Luft“ stehen lassen.
 */
async function gipfelOhneGebirge(db: Queryable, mapDomainId: string): Promise<BezugsBefund> {
    const rows = await db<{ name: string }[]>`
        SELECT k.name
          FROM terrain_peak_gelaende k
         WHERE k.map_domain_id = ${mapDomainId} AND k.is_active
           AND NOT EXISTS (
                   SELECT 1 FROM region_area a
                    WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND ST_Contains(a.geom, k.geom)
               )
         ORDER BY k.name
    `;
    return { code: "gipfel_ohne_gebirge", anzahl: rows.length, namen: rows.slice(0, PROBEN).map((r) => r.name) };
}

/** Welche Nähte eine Kategorie berührt: nur die messen, die dieser Zug bewegt haben kann. */
const NAEHTE: Readonly<Record<LegacyZugKategorie, readonly string[]>> = {
    landschaften: ["gipfel_ohne_gebirge"],
    wege: ["wegende_ohne_anschluss"],
    orte: ["wegende_ohne_anschluss", "kraftlinie_loest_sich_vom_ort"],
};

/**
 * Die Naht nach einem Zug messen. Read-only; ein Fehler einer einzelnen Messung (eine Tafel fehlt in dieser Datenbank) lässt
 * nur sie entfallen, nie den Zug.
 */
export async function messeBezuege(
    db: Queryable,
    kategorie: LegacyZugKategorie,
    mapDomainId: string,
): Promise<BezugsBericht> {
    const messungen: Readonly<Record<string, (db: Queryable, domain: string) => Promise<BezugsBefund>>> = {
        wegende_ohne_anschluss: loseWegenden,
        kraftlinie_loest_sich_vom_ort: kraftlinienOhneOrt,
        gipfel_ohne_gebirge: gipfelOhneGebirge,
    };
    const befunde: BezugsBefund[] = [];
    for (const code of NAEHTE[kategorie]) {
        const messung = messungen[code];
        if (messung === undefined) continue;
        try {
            befunde.push(await messung(db, mapDomainId));
        } catch {
            // Eine fehlende Tafel ist kein Quellenfehler: die Messung entfällt still, der Zug geht weiter.
        }
    }
    return { kategorie, befunde };
}

/** Die Befunde als Befunde des Zugs, nur wo etwas zu melden ist (Anzahl 0 sagt nichts). */
export function bezugsBefunde(bericht: BezugsBericht): Finding[] {
    return bericht.befunde
        .filter((befund) => befund.anzahl > 0)
        .map((befund) =>
            createFinding(
                befund.code,
                `${String(befund.anzahl)} an der Naht der Kategorien: ${befund.namen.join(", ")}`,
                {
                    kategorie: bericht.kategorie,
                    anzahl: befund.anzahl,
                },
            ),
        );
}

/** Die Kategorien, für die es überhaupt eine Naht zu messen gibt (für Tests und den Bericht). */
export const BEZUGS_KATEGORIEN = LEGACY_ZUG_KATEGORIEN;
