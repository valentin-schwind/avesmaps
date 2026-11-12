import type { EditorPathFlussnetz } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { topologieUm } from "./path-verbinden.ts";

/**
 * Das Flussnetz einer Straße (OPS-000112, `GET /api/editor/paths/:id/street/flussnetz`): für „Fließrichtung auf alle Abschnitte übernehmen“
 * im Wegeditor. Je Flussabschnitt der Straße seine Knoten in Zeichenrichtung (Anfang, innere Teilungen, Ende) und die Länge dazwischen,
 * gerechnet mit der Topologie der Wegfindung samt eingestelltem Fangradius (`topologieUm`, dieselbe Rechnung wie „Wege verbinden“). Zwei
 * Enden, die die Wegfindung verbindet, haben also denselben Knoten; eine Lücke, über die keine Route fährt, trennt auch hier.
 *
 * Rein lesend. Die Richtung rechnet der Browser im Entwurf (`fliessrichtung.ts` im gemeinsamen Paket), damit ↶ und „Fertig“ wie bei jeder
 * anderen Eigenschaft gelten; geschrieben wird über `path.update`.
 */
export async function leseFlussnetz(sql: Queryable, ids: readonly string[]): Promise<EditorPathFlussnetz> {
    if (ids.length === 0) return { abschnitte: [] };
    const zeilen = await sql<{ id: string; domaene: string; geojson: string }[]>`
        SELECT public_id::text AS id, map_domain_id AS domaene, ST_AsGeoJSON(geom, 15) AS geojson
          FROM path
         WHERE public_id = ANY(${[...ids]}::uuid[]) AND subtype = 'Flussweg' AND is_active
    `;
    const erste = zeilen[0];
    if (erste === undefined) return { abschnitte: [] };
    // In der Folge der Straße; alle Abschnitte einer Straße liegen auf einer Karte.
    const folge = new Map(ids.map((id, i) => [id, i] as const));
    const linien = new Map(
        zeilen
            .filter((z) => z.domaene === erste.domaene)
            .sort((a, b) => (folge.get(a.id) ?? 0) - (folge.get(b.id) ?? 0))
            .map((z) => [z.id, (JSON.parse(z.geojson) as { coordinates: [number, number][] }).coordinates] as const),
    );
    const { topologie } = await topologieUm(sql, erste.domaene, linien);
    const abschnitte = topologie.plans
        .filter((plan) => linien.has(plan.publicId))
        .map((plan) => {
            const grenzen = [0, ...plan.splits.map((s) => s.index), plan.coordinates.length - 1];
            const laengen = grenzen.slice(1).map((bis, j) => {
                let l = 0;
                for (let k = grenzen[j]! + 1; k <= bis; k++) {
                    const [ax, ay] = plan.coordinates[k - 1]!;
                    const [bx, by] = plan.coordinates[k]!;
                    l += Math.hypot(bx - ax, by - ay);
                }
                return Math.round(l * 1000) / 1000;
            });
            return { id: plan.publicId, knoten: [plan.start, ...plan.splits.map((s) => s.nodeId), plan.end], laengen };
        });
    return { abschnitte };
}
