import { createHash } from "node:crypto";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../../database.ts";
import { pruneTerrainDem } from "../derive.ts";
import {
    DEM_ENCODING,
    DEM_MAX_ZOOM,
    DEM_TILE_FORMAT,
    DEM_TILE_SIZE,
    demRevision,
    demTileOrder,
    demTiles,
    tileRevision,
    type DemTile,
} from "../dem-tiles.ts";
import { computePathProfiles, writePathProfiles } from "../path-profiles.ts";
import { DEFAULT_CONE } from "../peak-cone.ts";
import { candidateDir, readCandidate, removeCandidate, type Candidate } from "./candidate.ts";
import { dropCoarseState, promoteCoarseState } from "./coarse-cache.ts";
import { computeTileBounds, type Rect } from "./footprint.ts";
import { insertComputeTile } from "./local-fine.ts";
import { PROVISIONAL_INPUT_PREFIX } from "./provisional.ts";
import { composeDomainDem } from "./publish.ts";
import { loadPublishedDomainSource, readDomainSamples } from "./read.ts";
import { inheritRecipeVersion, storeDomainRaster } from "./store.ts";
import { demTilesOfComputeTiles } from "./verify-manifest.ts";

/**
 * `dem_publish` (JOBS-0001 4.4, V2, WI-0125): einen Kandidaten von `terrain_local` auf den AKTUELLEN Stand setzen und veröffentlichen.
 *
 *   1. **Aufsetzen:** Der geltende Master (nicht der, auf den gerechnet wurde: ein anderer Bereich kann inzwischen veröffentlicht
 *      sein) bekommt die Rechenkacheln des Kandidaten eingesetzt. Hat inzwischen ein voller Lauf mit denselben Eingaben veröffentlicht,
 *      ist der Kandidat überholt und es geschieht nichts.
 *   2. **Vorbereiten (für niemanden sichtbar):** der vorläufige Master (`provisional`, Präfix `lokal:` vor dem Eingabe-Fingerabdruck),
 *      die neue Pyramidenrevision mit ALLEN Kacheln (die geänderten neu kodiert, genau die Bytes eines vollen Laufs auf diesem Master;
 *      die übrigen kopiert, sie behalten Bytes und Kachelrevision) und die Wegprofile der Wege an geänderten Blöcken.
 *   3. **Wechseln in EINER Transaktion** (`completeJob` mit `publish`): Jobzeile gesperrt und Lease geprüft (Fencing), der geltende
 *      Zeiger ist noch der, auf den aufgesetzt wurde (sonst Neuversuch), Wegprofile, Zeiger, `area.changed` und `SUCCEEDED`. `NOTIFY`
 *      geht erst mit dem Commit hinaus.
 *   4. **Aufräumen:** alte Revisionen (ADR-0008), verwaiste Master, der Kandidat.
 */

export interface LocalPublishOptions {
    mapDomainId: string;
    /** Der `terrain_local`, dessen Kandidat veröffentlicht wird. */
    candidateJob: string;
    /** Dieser Job: Kennung, öffentliche Kennung und Lease (Fencing). */
    job: { id: number; publicId: string; leaseNo: number };
    candidateRoot?: string;
    phase?: (name: string, progress: number) => Promise<void>;
    /** Schließt den Job in der Transaktion des Zeigerwechsels ab (`completeJob` mit `publish`). */
    complete: (publish: (tx: Queryable) => Promise<void>, result: Record<string, unknown>) => Promise<"ok" | "fenced">;
}

export interface LocalPublishResult {
    outcome: "published" | "unchanged" | "superseded" | "no_candidate";
    revision: string;
    previous: string;
    /** Kacheln mit neuer Revision (Schlüssel `z/x/y` → Kachelrevision). */
    changed: Record<string, string>;
    computeTiles: number[];
    bounds: Rect | null;
    bytes: number;
    profiles: number;
    phasesMs: Record<string, number>;
}

/** Der Kandidat fehlt oder der Zeiger wechselte zwischen Vorbereiten und Wechseln: ein zweiter Lauf setzt neu auf. */
export class LocalPublishRetry extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "LocalPublishRetry";
        this.code = code;
    }
}

function unionRect(rects: readonly Rect[]): Rect | null {
    if (rects.length === 0) return null;
    return rects.reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
    }));
}

async function loadCandidate(
    database: Queryable,
    options: LocalPublishOptions,
): Promise<Candidate | "unchanged" | "missing"> {
    try {
        return await readCandidate(options.mapDomainId, options.candidateJob, options.candidateRoot);
    } catch {
        // Kein Kandidat: Der lokale Job fand nichts zu tun (dann steht das in seinem Ergebnis), sonst fehlt er wirklich.
        const [row] = await database<{ result: { candidate?: unknown; unchanged?: unknown } | null }[]>`
            SELECT result FROM job WHERE public_id = ${options.candidateJob}::uuid AND kind = 'terrain_local'
        `;
        return row?.result?.unchanged === true ? "unchanged" : "missing";
    }
}

export async function publishLocalCandidate(
    database: Database,
    options: LocalPublishOptions,
): Promise<LocalPublishResult> {
    const domain = options.mapDomainId;
    const phasesMs: Record<string, number> = {};
    let started = performance.now();
    let current = "";
    const phase = async (name: string, progress: number): Promise<void> => {
        if (current) phasesMs[current] = Math.round(performance.now() - started);
        current = name;
        started = performance.now();
        await options.phase?.(name, progress);
    };

    await phase("rebase", 0);
    const [pointer] = await database<
        {
            revision: string;
            fingerprint: string;
            size: number;
            input_fingerprint: string;
            tile_size: number;
            max_zoom: number;
        }[]
    >`
        SELECT d.revision, t.fingerprint, t.size, t.input_fingerprint, d.tile_size, d.max_zoom
        FROM terrain_dem d JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
        WHERE d.map_domain_id = ${domain} AND d.is_current
    `;
    if (!pointer) throw new Error("Es gibt keinen veröffentlichten Domain-Master");
    const base: Omit<LocalPublishResult, "outcome"> = {
        revision: pointer.revision,
        previous: pointer.revision,
        changed: {},
        computeTiles: [],
        bounds: null,
        bytes: 0,
        profiles: 0,
        phasesMs,
    };
    const finish = async (outcome: LocalPublishResult["outcome"]): Promise<LocalPublishResult> => {
        const result = { outcome, ...base };
        if ((await options.complete(async () => undefined, { ...result, unchanged: true })) === "fenced")
            throw new LocalPublishRetry("fenced", "Die Lease gehört nicht mehr diesem Lauf");
        return result;
    };
    const candidate = await loadCandidate(database, options);
    if (candidate === "unchanged") return finish("no_candidate");
    if (candidate === "missing")
        throw new Error(`Der Kandidat von ${options.candidateJob} fehlt (aufgeräumt oder nie abgelegt)`);
    const { head } = candidate;
    base.computeTiles = head.tiles;
    base.bounds = unionRect(head.tiles.map((tile) => computeTileBounds(tile, head.tilesPerSide)));
    // Ein voller Lauf mit denselben Eingaben ist schon veröffentlicht: Er ist die Wahrheit, der Kandidat überholt.
    if (pointer.input_fingerprint === head.inputFingerprint) {
        await removeCandidate(domain, options.candidateJob, options.candidateRoot);
        return finish("superseded");
    }
    if (pointer.size !== head.size) throw new Error("Kandidat und Master haben verschiedene Größen");
    const samples = await readDomainSamples(database, domain, pointer.fingerprint, pointer.size);
    head.tiles.forEach((tile, i) =>
        insertComputeTile(samples, head.size, tile, head.tilesPerSide, candidate.tiles[i]!),
    );
    const fingerprint = createHash("sha256")
        .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
        .digest("hex");
    if (fingerprint === pointer.fingerprint) {
        await removeCandidate(domain, options.candidateJob, options.candidateRoot);
        return finish("unchanged");
    }

    await phase("tiles", 0.2);
    const raster = {
        width: head.size,
        height: head.size,
        cell: 1024 / head.size,
        originX: 512 / head.size,
        originY: 512 / head.size,
        samples,
    };
    const inside = demTilesOfComputeTiles(head.tiles, DEM_MAX_ZOOM, head.tilesPerSide);
    const fresh = new Map<string, Buffer>();
    for (const tile of demTiles(composeDomainDem(raster), {
        only: (z, x, y) => inside.has(`${String(z)}/${String(x)}/${String(y)}`),
    }))
        fresh.set(`${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`, tile.image);
    // Die übrigen Kacheln mit ihren gespeicherten Bytes: die Revision der Pyramide ist der Hash über alle, in der Folge des Baus.
    const stored = new Map(
        (
            await database<{ z: number; x: number; y: number; png: Buffer; tile_revision: string }[]>`
                SELECT z, x, y, png, tile_revision FROM terrain_dem_tile WHERE revision = ${pointer.revision}
            `
        ).map((row) => [`${String(row.z)}/${String(row.x)}/${String(row.y)}`, row]),
    );
    const ordered: DemTile[] = demTileOrder(DEM_MAX_ZOOM).map((tile) => {
        const key = `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
        const image = fresh.get(key) ?? stored.get(key)?.png;
        if (!image) throw new Error(`Kachel ${key} fehlt in ${pointer.revision}`);
        return { ...tile, image };
    });
    const revision = demRevision(ordered);
    base.revision = revision;
    base.bytes = ordered.reduce((sum, tile) => sum + tile.image.length, 0);
    for (const [key, image] of fresh) {
        const own = tileRevision(image);
        if (stored.get(key)?.tile_revision !== own) base.changed[key] = own;
    }
    stored.clear();

    await phase("profiles", 0.4);
    const published = await loadPublishedDomainSource(database, domain, pointer.fingerprint, samples);
    if (!published) throw new Error("Der geltende Master ist nicht lesbar");
    const profiles = await computePathProfiles(
        database,
        domain,
        { domain: { ...published, fingerprint, revision }, rasters: [], peaks: [], rule: DEFAULT_CONE },
        AVENTURIA_TRAVEL_MODEL,
    );
    base.profiles = profiles.rows.length;

    await phase("prepare", 0.6);
    // Für niemanden sichtbar, bis der Zeiger wechselt; scheitert der Wechsel, räumt `pruneTerrainDem` es beim nächsten Lauf weg.
    await database.begin(async (tx) => {
        await storeDomainRaster(
            tx,
            domain,
            PROVISIONAL_INPUT_PREFIX + head.inputFingerprint,
            {
                raster,
                fingerprint,
                report: {
                    generator: "local",
                    local: { job: options.candidateJob, base: pointer.fingerprint, tiles: head.tiles },
                    findings: head.findings,
                },
            },
            head.inputIndex,
            { baseFingerprint: pointer.fingerprint, localTiles: head.tiles },
        );
        await inheritRecipeVersion(tx, domain, fingerprint, pointer.fingerprint);
        await tx`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, domain_fingerprint, format)
            VALUES (${revision}, ${domain}, ${PROVISIONAL_INPUT_PREFIX + head.inputFingerprint}, ${DEM_TILE_SIZE}, ${DEM_MAX_ZOOM},
                ${DEM_ENCODING}, ${ordered.length}, ${base.bytes}, ${fingerprint}, ${DEM_TILE_FORMAT})
            ON CONFLICT (revision) DO NOTHING
        `;
        for (const [key, image] of fresh) {
            const [z, x, y] = key.split("/").map(Number) as [number, number, number];
            await tx`
                INSERT INTO terrain_dem_tile (revision, z, x, y, png) VALUES (${revision}, ${z}, ${x}, ${y}, ${image})
                ON CONFLICT (revision, z, x, y) DO NOTHING
            `;
        }
        // Die übrigen auf dem Server kopiert: Bytes und Kachelrevision bleiben (der alte Code liest die Pyramidenrevision weiter).
        const keep = [...fresh.keys()];
        await tx`
            INSERT INTO terrain_dem_tile (revision, z, x, y, png)
            SELECT ${revision}, z, x, y, png FROM terrain_dem_tile
            WHERE revision = ${pointer.revision} AND (z::text || '/' || x::text || '/' || y::text) <> ALL(${keep}::text[])
            ON CONFLICT (revision, z, x, y) DO NOTHING
        `;
    });
    fresh.clear();

    await phase("switch", 0.9);
    const result: LocalPublishResult = { outcome: "published", ...base };
    const outcome = await options.complete(
        async (tx) => {
            const [now] = await tx<{ revision: string }[]>`
                SELECT revision FROM terrain_dem WHERE map_domain_id = ${domain} AND is_current FOR UPDATE
            `;
            if (now?.revision !== pointer.revision)
                throw new LocalPublishRetry(
                    "rebase",
                    `Der Zeiger wechselte während der Vorbereitung (${pointer.revision} → ${now?.revision ?? "keiner"})`,
                );
            await writePathProfiles(tx, domain, profiles);
            await tx`UPDATE terrain_dem SET is_current = FALSE, superseded_at = now()
                WHERE map_domain_id = ${domain} AND is_current`;
            await tx`UPDATE terrain_dem SET is_current = TRUE, superseded_at = NULL
                WHERE map_domain_id = ${domain} AND revision = ${revision}`;
            await tx`
                SELECT job_event_add(
                    'area.changed', ${options.job.id}::bigint, ${domain},
                    ${tx.json({
                        jobId: options.job.publicId,
                        jobKind: "dem_publish",
                        revision,
                        previous: pointer.revision,
                        tiles: base.changed,
                        computeTiles: head.tiles,
                        provisional: true,
                    })}::jsonb,
                    ${tx.json(base.bounds === null ? {} : { ...base.bounds })}::jsonb
                )
            `;
        },
        { ...result, phasesMs: { ...phasesMs } },
    );
    if (outcome === "fenced") throw new LocalPublishRetry("fenced", "Die Lease gehört nicht mehr diesem Lauf");

    // Nach dem Commit gehört die Zeile niemandem mehr: keine Phase mehr melden, nur noch messen und aufräumen.
    phasesMs[current] = Math.round(performance.now() - started);
    started = performance.now();
    // Der Stand der groben Stufe aus dem Kandidaten gehört jetzt zu diesem Master, wenn ohne Umbasieren gerechnet wurde (WI-0223).
    // Sonst fehlt ihm, was dazwischen veröffentlicht wurde: Er fällt weg, und der nächste lokale Lauf rechnet die grobe Stufe voll.
    const adopted =
        head.base.fingerprint === pointer.fingerprint &&
        (await promoteCoarseState(
            { dir: candidateDir(domain, options.candidateJob, options.candidateRoot), name: "coarse" },
            domain,
            fingerprint,
        ));
    if (!adopted) await dropCoarseState(domain);
    await pruneTerrainDem(database, domain, false);
    await removeCandidate(domain, options.candidateJob, options.candidateRoot);
    phasesMs["cleanup"] = Math.round(performance.now() - started);
    return result;
}
