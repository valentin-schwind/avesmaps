import type { Queryable } from "../database.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import { footprintOf, footprintRingOf, type Rect } from "../terrain/domain/footprint.ts";
import { diffInputIndex, loadDomainInputIndex, readInputIndex } from "../terrain/domain/input-index.ts";
import { inTransaction, insertJob, type InsertedJob } from "./store.ts";

/**
 * Die Gelände-Kette einreihen (JOBS-0001 4.4, Etappe 2, WI-0125). In Etappe 2 gibt es keinen Editor-Auslöser: Die Kette entsteht über
 * die Kommandozeile (`npm run jobs -- enqueue terrain_local …`), in EINER Transaktion, als Baum in `job_dependency`:
 *
 *     terrain_local ── dem_publish ─┬─ routing_reload
 *                                   └─ display_heights        (Etappe 2: ohne Entprellung)
 *     terrain_full  ─┬─ routing_reload                         (der gesammelte volle Lauf, D6 = B)
 *                    └─ display_heights
 *
 * - **Bereich:** `terrain_local` und `dem_publish` tragen den Fußabdruck als Rechenkacheln (`scope_tiles`), aus denselben Eingaben
 *   geplant, die der Job beim Start noch einmal liest; ohne Index des Masters die ganze Domäne. `routing_reload` und
 *   `display_heights` sperren keinen Bereich (sie lesen nur den geltenden Master; `display_heights` läuft höchstens einmal zur Zeit).
 *   `terrain_full` sperrt die Domäne: Er wartet auf alles, was vor ihm eingereiht ist, und alles danach auf ihn.
 * - **Vorrang** (4.5, Entwurf): Veröffentlichen und Routing vor lokalem Rechnen, vor Anzeigehöhen, vor dem vollen Lauf.
 * - **Gesammelt:** Ein `terrain_full`, der noch wartet, nimmt jede weitere Anforderung auf (`coalesced_count`), statt einen zweiten
 *   anzulegen, und trägt danach das Etikett der jüngsten (wie `terrain_chain_enqueue`, 0129: Der Lauf rechnet beim Start die GELTENDE
 *   Wahl, also ist das neue Etikett das wahre). Die Entprellung mit Frist (`not_before`) bringt Etappe 3.
 */

export const TERRAIN_PRIORITY = {
    dem_publish: 20,
    routing_reload: 20,
    terrain_local: 30,
    display_heights: 60,
    terrain_full: 70,
} as const;

export interface TerrainChainRequest {
    mapDomainId: string;
    actorRef?: string | null;
    release?: string | null;
    /** Das Etikett des vollen Laufs (`vollerLaufEtikett`); ohne „Gelände voll (gesammelt)“. */
    label?: string;
}

/**
 * Das Etikett des vollen Laufs, wie es in der Warteschlange steht: „Gelände voll rechnen (Fassung 19 (Test))“ (Hauptorchestrierung
 * 2026-10-19), mit dem Anlass dahinter („…, zurück“). Es beginnt mit der Art, damit die Warteschlange es an ihrer Stelle zeigen kann und
 * Claudios Rollout „hinter Gelände voll rechnen (…)“ wartet. Höchstens 120 Zeichen wie `job.label`.
 */
export function vollerLaufEtikett(fassung: string, anlass?: string): string {
    return `Gelände voll rechnen (${fassung}${anlass === undefined ? "" : `, ${anlass}`})`.slice(0, 120);
}

export interface PlannedFootprint {
    tiles: number[];
    rects: Rect[];
    changes: number;
    /** Der geltende Master trägt keinen Eingabeindex: Ohne Bereich kann der Job nichts erkennen. */
    indexMissing: boolean;
}

/** Plant den Fußabdruck wie der Job (`terrain/domain/local.ts`), ohne V12 zu rechnen: Index des Masters gegen die heutigen Eingaben. */
export async function planFootprint(
    database: Queryable,
    mapDomainId: string,
    bounds: readonly Rect[] = [],
): Promise<PlannedFootprint> {
    const [master] = await database<{ input_index: unknown }[]>`
        SELECT t.input_index FROM terrain_dem d
        JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
        WHERE d.map_domain_id = ${mapDomainId} AND d.is_current
    `;
    const base = readInputIndex(master?.input_index);
    const changes = base ? diffInputIndex(base, await loadDomainInputIndex(database, mapDomainId)) : [];
    const footprint = footprintOf(changes, footprintRingOf(await resolveTerrainRecipe(database, mapDomainId)), bounds);
    return { tiles: footprint.tiles, rects: footprint.rects, changes: changes.length, indexMissing: base === null };
}

export interface ChainFollowers {
    routing: InsertedJob;
    heights: InsertedJob;
}

async function followers(
    tx: Queryable,
    request: TerrainChainRequest,
    after: InsertedJob,
    label: string,
): Promise<ChainFollowers> {
    const common = {
        mapDomainId: request.mapDomainId,
        actorRef: request.actorRef ?? null,
        release: request.release ?? null,
        dependsOn: [after.id],
    };
    return {
        routing: await insertJob(tx, {
            ...common,
            kind: "routing_reload",
            label: `Routenrechner nach ${label}`,
            priority: TERRAIN_PRIORITY.routing_reload,
            scopeKind: "tiles",
            scopeTiles: [],
        }),
        heights: await insertJob(tx, {
            ...common,
            kind: "display_heights",
            label: `Höhenlinien nach ${label}`,
            priority: TERRAIN_PRIORITY.display_heights,
            scopeKind: "tiles",
            scopeTiles: [],
        }),
    };
}

export interface TerrainFullChain extends Partial<ChainFollowers> {
    full: InsertedJob;
    /** `true`: ein schon wartender voller Lauf hat die Anforderung aufgenommen. */
    coalesced: boolean;
}

/** Reiht den gesammelten vollen Lauf ein, oder zählt die Anforderung an einem, der noch wartet. */
export async function enqueueTerrainFull(database: Queryable, request: TerrainChainRequest): Promise<TerrainFullChain> {
    return inTransaction(database, async (tx) => {
        const [waiting] = await tx<{ id: string; public_id: string }[]>`
            SELECT id::text, public_id::text FROM job
            WHERE kind = 'terrain_full' AND map_domain_id = ${request.mapDomainId} AND state = 'QUEUED'
            ORDER BY id LIMIT 1 FOR UPDATE
        `;
        if (waiting) {
            await tx`
                UPDATE job SET coalesced_count = coalesced_count + 1, label = COALESCE(${request.label ?? null}, label)
                WHERE id = ${waiting.id}
            `;
            return { full: { id: Number(waiting.id), publicId: waiting.public_id, created: false }, coalesced: true };
        }
        const full = await insertJob(tx, {
            kind: "terrain_full",
            mapDomainId: request.mapDomainId,
            actorRef: request.actorRef ?? null,
            release: request.release ?? null,
            label: request.label ?? "Gelände voll (gesammelt)",
            priority: TERRAIN_PRIORITY.terrain_full,
            scopeKind: "domain",
        });
        return { full, coalesced: false, ...(await followers(tx, request, full, "vollem Lauf")) };
    });
}

export interface TerrainLocalChain extends ChainFollowers {
    local: InsertedJob;
    publish: InsertedJob;
    footprint: PlannedFootprint;
    full?: TerrainFullChain;
}

/** Reiht `terrain_local` samt Kette ein; mit `fullAfter` dahinter den gesammelten vollen Lauf. */
export async function enqueueTerrainLocal(
    database: Queryable,
    request: TerrainChainRequest & { bounds?: readonly Rect[]; fullAfter?: boolean },
): Promise<TerrainLocalChain> {
    const bounds = request.bounds ?? [];
    const footprint = await planFootprint(database, request.mapDomainId, bounds);
    const scope =
        footprint.tiles.length > 0
            ? { scopeKind: "tiles" as const, scopeTiles: footprint.tiles }
            : { scopeKind: "domain" as const };
    return inTransaction(database, async (tx) => {
        const common = {
            mapDomainId: request.mapDomainId,
            actorRef: request.actorRef ?? null,
            release: request.release ?? null,
        };
        const local = await insertJob(tx, {
            ...common,
            kind: "terrain_local",
            label: `Gelände lokal, ${String(footprint.tiles.length)} Rechenkacheln`,
            priority: TERRAIN_PRIORITY.terrain_local,
            inputRef: bounds.length > 0 ? { bounds: bounds.map((b) => [b.minX, b.minY, b.maxX, b.maxY]) } : {},
            ...scope,
        });
        const publish = await insertJob(tx, {
            ...common,
            kind: "dem_publish",
            label: "Gelände veröffentlichen",
            priority: TERRAIN_PRIORITY.dem_publish,
            inputRef: { candidateJob: local.publicId },
            dependsOn: [local.id],
            ...scope,
        });
        const chain: TerrainLocalChain = {
            local,
            publish,
            footprint,
            ...(await followers(tx, request, publish, "lokaler Veröffentlichung")),
        };
        if (request.fullAfter === true) chain.full = await enqueueTerrainFull(tx, request);
        return chain;
    });
}
