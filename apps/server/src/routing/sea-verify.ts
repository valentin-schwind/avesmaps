import { seaGraphTransports, shipWaters, WATER_KINDS, type TravelModel } from "@avesmaps3d/shared";
import { settleWith } from "../blocking-checks.ts";
import type { Queryable } from "../database.ts";
import { loadSeaRoutes, SEA_ROUTE_ALGORITHM, seaRouteFingerprint } from "./sea-derive.ts";
import { clearOnMask, seaGraphRoute } from "./sea-graph-store.ts";

/**
 * Prüft den gespeicherten Seegraphen gegen seine Quellen und seine eigenen Invarianten (WI-0046,
 * `npm run verify:sea-routes`). Liest nur.
 */

export interface SeaRouteCheck {
    name: string;
    ok: boolean;
    detail: string;
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

/** Das Urteil über die Prüfungen des Seegraphen: nur eine ausgefallene blockierende lässt es scheitern. */
export function seaRoutesPassed(checks: readonly SeaRouteCheck[]): boolean {
    return checks.every((check) => check.ok || check.blocking === false);
}

export async function verifySeaRoutes(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
): Promise<SeaRouteCheck[]> {
    const checks: SeaRouteCheck[] = [];
    const check = (name: string, ok: boolean, detail: string): void => {
        checks.push({ name, ok, detail });
    };
    const stored = await loadSeaRoutes(database, mapDomainId);
    if (!stored) {
        // Ohne Seegraph gibt es nichts zu prüfen: kein Befund, sondern ein Abbruch (technisch, nicht in der Liste).
        check("vorhanden", false, "kein Seegraph: npm run derive:sea-routes");
        return checks.map((entry) => ({ ...entry, blocking: true }));
    }
    const { graph } = stored;
    check("vorhanden", true, `abgeleitet ${stored.derivedAt}`);
    check(
        "Algorithmus aktuell",
        stored.algorithm === SEA_ROUTE_ALGORITHM,
        `${stored.algorithm}${stored.algorithm === SEA_ROUTE_ALGORITHM ? "" : `, erwartet ${SEA_ROUTE_ALGORITHM}`}`,
    );
    const fingerprint = await seaRouteFingerprint(database, mapDomainId, model);
    check(
        "Quellen unverändert",
        stored.fingerprint === fingerprint,
        stored.fingerprint === fingerprint
            ? fingerprint
            : `gespeichert ${stored.fingerprint}, jetzt ${fingerprint}: npm run derive:sea-routes`,
    );
    // Nur die Schiffe mit eigenen Wegen; die übrigen fahren deren Seereisen (WI-0069, `seaGraphTransports`).
    const transports = seaGraphTransports(model);
    check(
        "Seeschiffe wie im Reisemodell",
        JSON.stringify(graph.transports) === JSON.stringify(transports),
        graph.transports.join(", "),
    );
    const [counted] = await database<{ ports: number }[]>`
        SELECT count(*)::int AS ports FROM place WHERE map_domain_id = ${mapDomainId} AND is_active AND is_seaport
    `;
    const expected = (counted?.ports ?? 0) - stored.stats.withoutLanding.length;
    check(
        "Häfen",
        graph.ports.length === expected,
        `${String(graph.ports.length)} mit Anlegestelle, ${String(stored.stats.withoutLanding.length)} ohne Wasser-Zugang`,
    );
    const nodeCount = graph.nodeX.length;
    check(
        "Kanten zeigen auf Knoten",
        graph.edgeA.every((node) => node < nodeCount) && graph.edgeB.every((node) => node < nodeCount),
        `${String(graph.edgeA.length)} Kanten, ${String(nodeCount)} Knoten`,
    );
    // Gesperrt (0) nur für ein Schiff mit eigenen Gewässern (WI-0069); jeder andere Aufschlag mindestens 1.
    const ships = graph.transports.length;
    const restrictedShip = graph.transports.map(
        (transport) => shipWaters(model, transport).length < WATER_KINDS.length,
    );
    let blocked = 0;
    const factorsOk = graph.factors.every((factor, index) => {
        if (factor !== 0) return factor >= 1000;
        blocked += 1;
        return restrictedShip[index % ships] === true;
    });
    check(
        "Aufschläge nie unter 1",
        factorsOk,
        `${String(graph.factors.length)} Werte, ${String(blocked)} gesperrt für Schiffe mit eigenen Gewässern`,
    );
    let sorted = true;
    for (let index = 1; index < graph.bridgeEdges.length; index += 1) {
        if ((graph.bridgeEdges[index] as number) <= (graph.bridgeEdges[index - 1] as number)) sorted = false;
    }
    check("Brücken geordnet", sorted, `${String(graph.bridgeEdges.length)} Brücken`);
    const pairCount = graph.ports.length * graph.ports.length;
    const known = (1 << graph.closures.length) - 1;
    check(
        "Sperrgebiete",
        graph.pairClosures.length === graph.transports.length &&
            graph.pairClosures.every(
                (bits) => bits.length === pairCount && bits.every((value) => (value & ~known) === 0),
            ),
        graph.closures.length === 0 ? "keine" : graph.closures.map((closure) => closure.name).join(", "),
    );

    // Hin und zurück gleich lang, bis auf Gleichstände unter gleich teuren Wegen.
    const count = graph.ports.length;
    let asymmetric = 0;
    let pairs = 0;
    for (const table of graph.pairs) {
        for (let from = 0; from < count; from += 1) {
            for (let to = from + 1; to < count; to += 1) {
                const there = table[from * count + to] as number;
                const back = table[to * count + from] as number;
                if (Number.isNaN(there) !== Number.isNaN(back)) asymmetric += 1;
                else if (!Number.isNaN(there)) {
                    pairs += 1;
                    if (Math.abs(there - back) > 0.01 * Math.max(there, back) + 0.01) asymmetric += 1;
                }
            }
        }
    }
    check("Hin gleich zurück", asymmetric === 0, `${String(pairs)} verbundene Paare, ${String(asymmetric)} abweichend`);

    // Ein Schiff mit eigenen Gewässern (WI-0069, Ruderboot) hat nur dort Seereisen; der Bericht nennt seine Häfen.
    const restricted = restrictedShip;
    for (const [index, transport] of graph.transports.entries()) {
        if (!restricted[index]) continue;
        const table = graph.pairs[index] as Float32Array;
        let reached = 0;
        for (let from = 0; from < count; from += 1) {
            for (let to = 0; to < count; to += 1) {
                if (from !== to && !Number.isNaN(table[from * count + to] as number)) {
                    reached += 1;
                    break;
                }
            }
        }
        const reported = stored.stats.waters?.find((entry) => entry.transport === transport);
        check(
            `Gewässer ${transport}`,
            reported !== undefined && reached === reported.ports,
            `${String(reached)} Häfen mit Seereise, laut Bericht ${String(reported?.ports ?? "?")}`,
        );
    }

    // Stichprobe: Der Weg, den der Worker zeichnet, ist so lang wie gespeichert und quert kein Land. Bei einem
    // Schiff mit eigenen Gewässern fehlt die Seereise dort, wo der Graph zwar Wasser kennt, das Schiff aber nicht.
    let mismatched = 0;
    let crossing = 0;
    let sampled = 0;
    for (let sample = 0; sample < 40 && count > 1; sample += 1) {
        const from = (sample * 7919) % count;
        const to = (sample * 104_729 + 17) % count;
        if (from === to) continue;
        const transport = sample % graph.transports.length;
        const stored_ = (graph.pairs[transport] as Float32Array)[from * count + to] as number;
        const route = seaGraphRoute(graph, from, to, transport);
        if (Number.isNaN(stored_) !== (route === null)) mismatched += 1;
        if (!route) continue;
        sampled += 1;
        if (Math.abs(route.distance - stored_) > 1e-3 * Math.max(1, stored_)) mismatched += 1;
        for (let index = 1; index < route.points.length; index += 1) {
            const [ax, ay] = route.points[index - 1] as [number, number];
            const [bx, by] = route.points[index] as [number, number];
            if (!clearOnMask(graph.mask, ax, ay, bx, by)) {
                crossing += 1;
                break;
            }
        }
    }
    check("Stichprobe Länge", mismatched === 0, `${String(sampled)} Wege, ${String(mismatched)} abweichend`);
    check("Stichprobe über Wasser", crossing === 0, `${String(sampled)} Wege, ${String(crossing)} über Land`);
    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleWith("verify:sea-routes", checks, (entry) => entry.ok).checks;
}
