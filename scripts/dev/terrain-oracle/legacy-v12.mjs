/**
 * Legacys Gebirgsrechnung V12 als Orakel (WI-0049 S3): die beiden Module unverändert aus dem
 * Discovery-Mirror, nie aus dem Checkout des Betreibers, ausgeführt in einer Node-VM.
 *
 * Dazu die Eingaben je Gebirgsfläche aus einem Legacy-Snapshot, so wie Legacys Speicherlauf sie
 * zusammenstellt (Gipfel in der Fläche, Kammlinie oder Beschriftungskurve, Flusswege mit `is_bach`
 * und `flow.dir`, Seen mit Hüllrechteck-Vorfilter, Saat aus `public_id#geometry_revision`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const LEGACY_COMMIT = "aff0449a5";
export const MIRROR = "C:/GIT/.discovery/avesmaps.git";
const FILES = [
    "js/map-features/map-features-point-in-polygon.js",
    "js/map-features/map-features-ecosystem-hydrologie.js",
];

/** Lädt beide Module in eine VM; liefert Legacys Trichter des Speicherlaufs und seinen Punkt-in-Fläche-Test. */
export function loadLegacyV12() {
    const ctx = vm.createContext({
        console,
        Math,
        Number,
        Array,
        Float64Array,
        Uint8Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        JSON,
        Set,
        Map,
    });
    for (const file of FILES) {
        const code = execFileSync("git", [`--git-dir=${MIRROR}`, "show", `${LEGACY_COMMIT}:${file}`], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        }).replace(/^\uFEFF/, "");
        vm.runInContext(code, ctx, { filename: file });
    }
    return {
        build: vm.runInContext("avesmapsGebirgsRasterMitUeberlappung", ctx),
        pointInGeometry: vm.runInContext("pointInGeometry", ctx),
    };
}

/** Legacys Speicherkodierung (height-render.js#L1031-1044), wortgleich. */
export function legacySamples(o) {
    const samples = new Uint16Array(o.r.w * o.r.hh);
    for (let k = 0; k < samples.length; k++) {
        if (!o.r.eigen[k]) continue;
        const wert = Math.round(o.h[k]);
        samples[k] = wert > 65535 ? 65535 : wert > 0 ? wert : 0;
    }
    return samples;
}

/** Wortgleich zu Legacys ecosystemHeightSeed (height-field.js#L149-157). */
function seedOf(area) {
    const text = String(area?.public_id || "") + "#" + String(area?.geometry_revision ?? 0);
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (Math.imul(seed, 31) + text.charCodeAt(i)) | 0;
    return seed;
}

/**
 * Die Gebirgsflächen eines Snapshots samt ihrer V12-Eingabe. `pointInGeometry` ist Legacys eigener
 * Test, damit die Auswahl der Gipfel und Flüsse genau Legacys ist.
 */
export function snapshotMountains(snapshotDir, pointInGeometry) {
    const eco = JSON.parse(readFileSync(`${snapshotDir}/ecosystem-areas.json`, "utf8"));
    const mf = JSON.parse(readFileSync(`${snapshotDir}/map-features.json`, "utf8"));
    const peaks = mf.features
        .filter(
            (f) =>
                f.properties.feature_type === "label" &&
                ["berggipfel", "vulkan"].includes(f.properties.feature_subtype),
        )
        .map((f) => ({
            x: f.geometry.coordinates[0],
            y: f.geometry.coordinates[1],
            height: f.properties.height_schritt ?? null,
        }));
    const rivers = mf.features.filter((f) => f.properties.feature_subtype === "Flussweg" && f.geometry);
    const labelsById = new Map(
        mf.features.filter((f) => f.properties.feature_type === "label").map((f) => [f.properties.public_id, f]),
    );
    const lakes = eco.areas.filter((a) => a.kind === "topographie" && a.region_type === "see");

    const inputFor = (area) => {
        const g = area.geometry;
        const fluesse = [];
        for (const f of rivers) {
            const lines =
                f.geometry.type === "LineString"
                    ? [f.geometry.coordinates]
                    : f.geometry.type === "MultiLineString"
                      ? f.geometry.coordinates
                      : [];
            for (const line of lines) {
                if (line.length < 2 || !line.some((c) => pointInGeometry([c[0], c[1]], g))) continue;
                fluesse.push({
                    n: String(f.properties.name || f.properties.public_id || ""),
                    bach: f.properties.is_bach === true,
                    dir: f.properties.flow?.dir || null,
                    p: line,
                });
            }
        }
        const a = area.bounds;
        const seen = lakes
            .filter(
                (k) =>
                    k.geometry &&
                    k.geometry.coordinates &&
                    !(
                        k.bounds &&
                        (k.bounds.max_x < a.min_x ||
                            a.max_x < k.bounds.min_x ||
                            k.bounds.max_y < a.min_y ||
                            a.max_y < k.bounds.min_y)
                    ),
            )
            .map((k) => ({ n: String(k.region_name || ""), g: k.geometry }));
        const own = area.terrain_ridge_line;
        const labelCurve = labelsById.get(area.label_public_id)?.properties.curve_label_line;
        const kurve =
            Array.isArray(own) && own.length > 1
                ? own
                : Array.isArray(labelCurve) && labelCurve.length > 1
                  ? labelCurve
                  : null;
        return {
            bounds: area.bounds,
            geometry: g,
            peaks: peaks.filter((p) => pointInGeometry([p.x, p.y], g)).map((p) => ({ x: p.x, y: p.y, h: p.height })),
            kurve,
            fluesse,
            seen,
            regler: {
                koernung: area.terrain_grain ?? undefined,
                stufen: area.terrain_levels ?? undefined,
                erosion: area.terrain_erosion ?? undefined,
                plateau: area.terrain_plateau ?? undefined,
                hypsometrie: area.terrain_hypsometrie ?? undefined,
                maximalhoehe: area.terrain_avg_height ?? undefined,
                bergform: area.terrain_bergform ?? undefined,
                rauschen: area.terrain_rauschen ?? undefined,
                sattel: area.terrain_sattel ?? undefined,
                talbreite: area.terrain_talbreite ?? undefined,
                einschnitt: area.terrain_einschnitt ?? undefined,
            },
            saat: seedOf(area),
        };
    };

    return eco.areas
        .filter((a) => a.kind === "topographie" && a.region_type === "gebirge")
        .map((area) => ({ area, inputFor: () => inputFor(area) }));
}
