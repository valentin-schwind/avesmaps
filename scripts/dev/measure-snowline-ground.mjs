// Messung „Schnee über der Schneegrenze“ (Betreiber 2026-10-04: „ja, A, aber erst nach einer Messung“, dann „schnee B“):
// ganze Reisen heute (ohne `schneegrenze.bodenDarueber`), mit Fassung A (Tiefschnee nur auf ganzen Wegstücken über der
// Grenze) und mit Fassung B (`bodenAnteilig`: auf dem Teil jedes Stücks über der Grenze). Nur lesend gegen die
// Entwicklungsdatenbank.
//
// Aufruf (von der Wurzel; je Variante ein eigener Prozess, nacheinander, damit Speicher nicht mischt):
//   node --expose-gc --env-file-if-exists=.env scripts/dev/measure-snowline-ground.mjs run --variant off|a|b --out x.json
//   node scripts/dev/measure-snowline-ground.mjs compare off.json a.json b.json [--md bericht.md] [--top 15]
//   node --env-file-if-exists=.env scripts/dev/measure-snowline-ground.mjs census
//   node --env-file-if-exists=.env scripts/dev/measure-snowline-ground.mjs bench [--out zeiten.json]
//   node --env-file-if-exists=.env scripts/dev/measure-snowline-ground.mjs gate
//
// Reisen: 200 zufällige (fester Seed; Start und Ziel unter den sichtbaren Orten mit eindeutigem Namen, 30 bis 600
// Einheiten Luftlinie; zu Fuß oder beritten; nur Land oder mit Fluss und See) und 30 über benannte Gebirgspässe (die
// höchsten, je Pass die nächsten Orte an seinen Enden, nur Land). Je Reise vier Reisebeginne (1. Praios, 1. Peraine,
// 1. Efferd, 1. Firun) und beide Optimierungen.
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    dayOfYear,
    isShownPathName,
    ROUTE_DEFAULTS,
    routeDomain,
    snowlineHeight,
} from "@avesmaps3d/shared";
import { createDatabase, WORKER_TIMEOUTS } from "../../apps/server/src/database.ts";
import { databaseRoutingSource, RouteService } from "../../apps/server/src/routing/service.ts";
import { aboveSnowline, snowShare } from "../../apps/server/src/routing/snow-ground.ts";

const DATES = [
    { month: "praios", day: 1 },
    { month: "peraine", day: 1 },
    { month: "efferd", day: 1 },
    { month: "firun", day: 1 },
];
const OPTIMIZE = ["fastest", "shortest"];
/** Die Varianten: heute, Fassung A, Fassung B. */
const VARIANTS = ["off", "a", "b"];
const LABEL = { off: "heute", a: "A (ganz)", b: "B (anteilig)" };

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        variant: { type: "string" },
        out: { type: "string" },
        md: { type: "string" },
        seed: { type: "string", default: "20261004" },
        trips: { type: "string", default: "200" },
        passes: { type: "string", default: "30" },
        limit: { type: "string" },
        top: { type: "string" },
    },
});
const [command, ...files] = positionals;

/** Das Reisemodell der Variante: heute ohne `bodenDarueber`, A mit, aber nicht anteilig, B anteilig. */
function variantModel(name) {
    const model = AVENTURIA_TRAVEL_MODEL;
    if (!model.schneegrenze.wert.bodenDarueber) throw new Error("Reisemodell ohne bodenDarueber");
    const wert = { ...model.schneegrenze.wert };
    if (name === "off") delete wert.bodenDarueber;
    else if (name === "a") wert.bodenAnteilig = false;
    else if (name === "b") wert.bodenAnteilig = true;
    else throw new Error("--variant off|a|b");
    return { ...model, schneegrenze: { ...model.schneegrenze, wert } };
}

/** mulberry32: kleiner, fester Zufall. */
function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function open() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (--env-file-if-exists=.env)");
    const database = createDatabase(process.env.DATABASE_URL, { max: 2, timeouts: WORKER_TIMEOUTS });
    const source = databaseRoutingSource(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL);
    const data = await source.load();
    return { database, source, data };
}

/** Ein Dienst über dem festen Datenstand, mit dem Reisemodell der Variante. */
function serviceFor(name, data, source) {
    return new RouteService({
        mapDomain: AVENTURIA.mapDomain,
        model: variantModel(name),
        source: { revision: async () => data.revision, load: async () => data, loadSea: source.loadSea },
        recheckMs: Number.POSITIVE_INFINITY,
    });
}

/** Die Reisen: zufällige und über die höchsten benannten Pässe. Hängt nur an den Daten und am Seed. */
function trips(data) {
    const all = [...data.network.nodes.values()].filter((node) => node.kind === "place" && !node.isHidden);
    const count = new Map();
    for (const node of all) count.set(node.name, (count.get(node.name) ?? 0) + 1);
    const places = all.filter((node) => count.get(node.name) === 1).sort((a, b) => (a.id < b.id ? -1 : 1));
    const next = random(Number(values.seed));
    const pick = () => places[Math.floor(next() * places.length)];
    const result = [];
    while (result.length < Number(values.trips)) {
        const from = pick();
        let to = pick();
        let tries = 0;
        while (tries < 200) {
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            if (to !== from && distance >= 30 && distance <= 600) break;
            to = pick();
            tries += 1;
        }
        if (tries >= 200) continue;
        result.push({
            id: `r${String(result.length).padStart(3, "0")}`,
            group: "zufall",
            names: [from.name, to.name],
            ids: [from.id, to.id],
            land: next() < 0.5 ? "groupFoot" : "groupHorse",
            ship: next() < 0.5,
        });
    }
    // Die Pässe: je Gebirgspass mit Namen im Reiseplan (keine erzeugten Namen wie „Gebirgspass-6019“) sein höchster
    // Punkt, die höchsten zuerst; je Paar von Orten nur eine Reise.
    const passes = new Map();
    for (const link of data.network.links) {
        if (link.subtype !== "Gebirgspass" || !isShownPathName(link.pathName, link.subtype) || !link.slope?.known) {
            continue;
        }
        const known = passes.get(link.pathName.trim());
        if (!known || link.slope.highest > known.highest) {
            passes.set(link.pathName.trim(), {
                name: link.pathName.trim(),
                highest: link.slope.highest,
                id: link.pathPublicId,
            });
        }
    }
    const nearest = (x, y, not) => {
        let best = null;
        let bestDistance = Infinity;
        for (const place of places) {
            if (not && place.id === not.id) continue;
            const distance = Math.hypot(place.x - x, place.y - y);
            if (distance < bestDistance) {
                best = place;
                bestDistance = distance;
            }
        }
        return best;
    };
    const ranked = [...passes.values()].sort((a, b) => b.highest - a.highest);
    let passIndex = 0;
    const pairs = new Set();
    for (const pass of ranked) {
        if (passIndex >= Number(values.passes)) break;
        const line = data.network.paths.get(pass.id);
        if (!line || line.length < 2) continue;
        const [ax, ay] = line[0];
        const [bx, by] = line[line.length - 1];
        const from = nearest(ax, ay, null);
        const to = nearest(bx, by, from);
        if (!from || !to || Math.hypot(to.x - from.x, to.y - from.y) < 5) continue;
        const pair = [from.id, to.id].sort().join("|");
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        result.push({
            id: `p${String(passIndex).padStart(2, "0")}`,
            group: "pass",
            pass: pass.name,
            passHighest: Math.round(pass.highest),
            passId: pass.id,
            names: [from.name, to.name],
            ids: [from.id, to.id],
            land: passIndex % 2 === 0 ? "groupFoot" : "groupHorse",
            ship: false,
        });
        passIndex += 1;
    }
    return result;
}

function queryOf(trip, optimize, date) {
    return {
        optimize,
        transports: { land: trip.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
        enabled: { land: true, river: trip.ship, sea: trip.ship },
        minimizeTransfers: false,
        seaRouting: ROUTE_DEFAULTS.sea_routing,
        hoursPerDay: ROUTE_DEFAULTS.hours_per_day,
        waypoints: trip.ids,
        ...(date ? { departure: date } : {}),
    };
}

const memory = () => {
    const usage = process.memoryUsage();
    return { rss: usage.rss, heapUsed: usage.heapUsed, arrayBuffers: usage.arrayBuffers };
};
const settle = async () => {
    for (let index = 0; index < 2; index += 1) {
        globalThis.gc?.();
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
};

/** Was von einer Antwort festgehalten wird. */
function rowOf(trip, outcome) {
    if (!outcome.ok) return { outcome: `error:${outcome.error}` };
    const route = outcome.response;
    if (!route.found) return { outcome: `no_route:${route.reason ?? ""}` };
    return {
        outcome: "route",
        travel: route.travel_hours,
        total: route.total_hours,
        distance: route.distance_units,
        snow: route.snow?.extra_hours ?? 0,
        snowConditions: route.snow?.conditions ?? [],
        path: route.segments.map((segment) => `${segment.edge_id}|${segment.transport_type}`).join(";"),
        passUsed: trip.passId ? route.segments.some((segment) => segment.public_id === trip.passId) : null,
        highest: route.slope?.highest_schritt ?? null,
    };
}

async function run() {
    const variant = values.variant;
    if (!VARIANTS.includes(variant)) throw new Error("--variant off|a|b");
    if (typeof globalThis.gc !== "function") throw new Error("Mit --expose-gc starten");
    const { database, source, data } = await open();
    const service = serviceFor(variant, data, source);
    let list = trips(data);
    if (values.limit) list = list.slice(0, Number(values.limit));
    // Vorwärmen: je Profil der Graph und der Seegraph, ohne Reisebeginn (nicht gemessen).
    for (const trip of list) await service.route(queryOf(trip, "fastest", null));
    await settle();
    const before = memory();
    let peak = before;
    const results = [];
    const started = performance.now();
    for (const trip of list) {
        for (const date of DATES) {
            for (const optimize of OPTIMIZE) {
                const began = performance.now();
                const outcome = await service.route(queryOf(trip, optimize, date));
                const ms = performance.now() - began;
                const now = memory();
                if (now.rss > peak.rss) peak = { ...peak, rss: now.rss };
                if (now.heapUsed > peak.heapUsed) peak = { ...peak, heapUsed: now.heapUsed };
                results.push({
                    trip: trip.id,
                    date: `${date.month} ${date.day}`,
                    optimize,
                    ms,
                    ...rowOf(trip, outcome),
                });
            }
        }
    }
    const totalMs = performance.now() - started;
    await settle();
    const after = memory();
    await database.end({ timeout: 5 });
    const report = {
        variant,
        revision: data.revision,
        trips: list,
        dates: DATES,
        totalMs,
        memory: { before, peak, after },
        results,
    };
    writeFileSync(values.out ?? `snowline-${variant}.json`, `${JSON.stringify(report)}\n`);
    console.log(`${variant}: ${String(results.length)} Rechnungen in ${(totalMs / 1000).toFixed(1)} s`);
}

const quantile = (sorted, q) => {
    if (sorted.length === 0) return NaN;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
const sortNumbers = (list) => [...list].sort((a, b) => a - b);
const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "-");
const MiB = 1024 * 1024;

/** Weicht die Rechnung der Variante von heute ab (Ergebnisart, Stunden, Weg)? */
const changed = (base, other) =>
    base.outcome !== other.outcome ||
    (base.outcome === "route" &&
        (Math.abs(other.total - base.total) > 1e-6 ||
            Math.abs(other.travel - base.travel) > 1e-6 ||
            base.path !== other.path));
const rerouted = (base, other) => base.outcome === "route" && other.outcome === "route" && base.path !== other.path;

function compare() {
    const reports = Object.fromEntries(
        VARIANTS.map((name, index) => [name, JSON.parse(readFileSync(files[index], "utf8"))]),
    );
    const key = (row) => `${row.trip}|${row.date}|${row.optimize}`;
    const rows = Object.fromEntries(
        VARIANTS.map((name) => [name, new Map(reports[name].results.map((row) => [key(row), row]))]),
    );
    const { off } = reports;
    const tripById = new Map(off.trips.map((trip) => [trip.id, trip]));
    const cases = off.results.map((row) => ({
        trip: tripById.get(row.trip),
        date: row.date,
        optimize: row.optimize,
        off: row,
        a: rows.a.get(key(row)),
        b: rows.b.get(key(row)),
    }));
    const lines = [];
    const out = (line = "") => lines.push(line);
    const dates = off.dates.map((d) => `${d.month} ${d.day}`);
    const groups = ["zufall", "pass"];

    out(
        `Datenstand: Karte ${off.revision.map}, Gelände ${off.revision.terrain ?? "-"}, Klima ${off.revision.climate ?? "-"}`,
    );
    for (const name of ["a", "b"]) {
        const same = JSON.stringify(reports[name].revision) === JSON.stringify(off.revision);
        out(`${LABEL[name]}: gleicher Datenstand wie heute: ${same ? "ja" : "NEIN"}`);
    }
    out(`Rechnungen je Variante: ${String(off.results.length)}; Reisen ${String(off.trips.length)}`);
    out();

    const stats = (list, name, metric) => {
        const routed = list.filter((one) => one.off.outcome === "route" && one[name].outcome === "route");
        const affected = routed.filter((one) => changed(one.off, one[name]));
        const h = sortNumbers(affected.map((one) => one[name][metric] - one.off[metric]));
        const p = sortNumbers(affected.map((one) => (one[name][metric] / one.off[metric] - 1) * 100));
        return {
            routed: routed.length,
            hit: list.filter((one) => changed(one.off, one[name])).length,
            rerouted: list.filter((one) => rerouted(one.off, one[name])).length,
            h,
            p,
        };
    };
    const cell = (s) =>
        `${String(s.hit)} (${fixed((s.hit / Math.max(1, s.routed)) * 100, 0)} %) | ${String(s.rerouted)} | ${fixed(quantile(s.h, 0.5), 1)} / ${fixed(quantile(s.h, 0.9), 1)} / ${fixed(s.h.at(-1), 1)} | ${fixed(quantile(s.p, 0.5), 1)} / ${fixed(quantile(s.p, 0.9), 1)} / ${fixed(s.p.at(-1), 1)}`;
    for (const [metric, title] of [
        ["travel", "Reisestunden"],
        ["total", "Reisedauer samt Rast"],
    ]) {
        out(`**${title}** (Spannen über die betroffenen Rechnungen; Δ gegen heute)`);
        out();
        out(
            "| Gruppe | Reisebeginn | Optimierung | mit Route | A betroffen | A Weg | A Δ h Median / p90 / max | A Δ % Median / p90 / max | B betroffen | B Weg | B Δ h Median / p90 / max | B Δ % Median / p90 / max |",
        );
        out("|---|---|---|---:|---:|---:|---|---|---:|---:|---|---|");
        for (const group of [...groups, "alle"]) {
            for (const date of [...dates, "alle"]) {
                for (const optimize of OPTIMIZE) {
                    if (date !== "alle" && group === "alle") continue;
                    const list = cases.filter(
                        (one) =>
                            (group === "alle" || one.trip.group === group) &&
                            (date === "alle" || one.date === date) &&
                            one.optimize === optimize,
                    );
                    const a = stats(list, "a", metric);
                    const b = stats(list, "b", metric);
                    out(`| ${group} | ${date} | ${optimize} | ${String(a.routed)} | ${cell(a)} | ${cell(b)} |`);
                }
            }
        }
        out();
    }
    for (const group of [...groups, "alle"]) {
        const tripsOf = off.trips.filter((trip) => group === "alle" || trip.group === group);
        const counts = ["a", "b"].map(
            (name) =>
                tripsOf.filter((trip) => cases.some((one) => one.trip === trip && changed(one.off, one[name]))).length,
        );
        out(
            `Reisen der Gruppe ${group}, die mindestens ein Reisebeginn ändert: A ${String(counts[0])}, B ${String(counts[1])} von ${String(tripsOf.length)}`,
        );
    }
    for (const name of ["a", "b"]) {
        const flips = cases.filter((one) => one.off.outcome !== one[name].outcome);
        const shorter = cases.filter(
            (one) =>
                one.off.outcome === "route" && one[name].outcome === "route" && one[name].total < one.off.total - 1e-6,
        );
        const shortestRerouted = cases.filter(
            (one) => one.optimize === "shortest" && rerouted(one.off, one[name]),
        ).length;
        out(
            `${LABEL[name]}: Ergebnisart gewechselt ${String(flips.length)}, kürzer geworden ${String(shorter.length)}, unter „Kürzeste“ andere Wege ${String(shortestRerouted)}`,
        );
        for (const one of [...flips, ...shorter].slice(0, 10)) {
            out(
                `  ${one.trip.id} ${one.date} ${one.optimize}: ${one.off.outcome} ${fixed(one.off.total, 2)} -> ${one[name].outcome} ${fixed(one[name].total, 2)}`,
            );
        }
    }
    out();

    // Je Pass unter „Schnellste“: ΔReisestunden A und B je Reisebeginn, über den Pass vorher.
    const fastest = (trip, date) =>
        cases.find((one) => one.trip === trip && one.date === date && one.optimize === "fastest");
    const delta = (one, name) =>
        one?.off.outcome === "route" && one[name].outcome === "route"
            ? fixed(one[name].travel - one.off.travel, 1)
            : "–";
    out(
        `| Reise | Pass | höchster Punkt | Wegpunkte | Mittel | über den Pass (heute) | Reisestunden heute (${dates.join(" / ")}) | Δ A | Δ B | Schnee B h | B über den Pass |`,
    );
    out("|---|---|---:|---|---|---|---|---|---|---|---|");
    for (const trip of off.trips.filter((one) => one.group === "pass")) {
        const own = dates.map((date) => fastest(trip, date));
        const used = (name) =>
            own.map((one) => (one?.[name].outcome !== "route" ? "–" : one[name].passUsed ? "ja" : "nein")).join("/");
        out(
            `| ${trip.id} | ${trip.pass} | ${String(trip.passHighest)} | ${trip.names.join(" → ")} | ${trip.land} | ${used("off")} | ${own.map((one) => (one?.off.outcome === "route" ? fixed(one.off.travel, 1) : "–")).join(" / ")} | ${own.map((one) => delta(one, "a")).join(" / ")} | ${own.map((one) => delta(one, "b")).join(" / ")} | ${own.map((one) => (one?.b.outcome === "route" ? fixed(one.b.snow, 1) : "–")).join(" / ")} | ${used("b")} |`,
        );
    }
    out();

    // Die größten Mehrzeiten unter „Schnellste“ in B, nach Reisestunden.
    const top = cases
        .filter((one) => one.optimize === "fastest" && one.off.outcome === "route" && one.b.outcome === "route")
        .map((one) => ({ ...one, delta: one.b.travel - one.off.travel }))
        .sort((x, y) => y.delta - x.delta)
        .slice(0, Number(values.top ?? 15));
    out(
        "| # | Reise | Wegpunkte | Mittel | Schiff | Reisebeginn | Reisestunden heute / A / B | Δ B h | Δ B % | Dauer samt Rast heute / B | Schnee heute / A / B h | B ausgewichen |",
    );
    out("|---|---|---|---|---|---|---|---|---|---|---|---|");
    top.forEach((one, index) => {
        out(
            `| ${String(index + 1)} | ${one.trip.id} | ${one.trip.names.join(" → ")} | ${one.trip.land} | ${one.trip.ship ? "ja" : "nein"} | ${one.date} | ${fixed(one.off.travel, 1)} / ${fixed(one.a.travel, 1)} / ${fixed(one.b.travel, 1)} | ${fixed(one.delta, 1)} | ${fixed((one.b.travel / one.off.travel - 1) * 100, 1)} | ${fixed(one.off.total, 1)} / ${fixed(one.b.total, 1)} | ${fixed(one.off.snow, 1)} / ${fixed(one.a.snow, 1)} / ${fixed(one.b.snow, 1)} | ${rerouted(one.off, one.b) ? "ja" : "nein"} |`,
        );
    });
    out();

    out(
        "| Variante | Laufzeit je Route p50 / p95 / max ms (getrennte Prozesse) | Summe s | Heap nach gc vorher / nachher MiB | Heap-Spitze | RSS-Spitze | ArrayBuffer |",
    );
    out("|---|---|---|---|---|---|---|");
    for (const name of VARIANTS) {
        const report = reports[name];
        const times = sortNumbers(report.results.map((row) => row.ms));
        const m = report.memory;
        out(
            `| ${LABEL[name]} | ${fixed(quantile(times, 0.5))} / ${fixed(quantile(times, 0.95))} / ${fixed(times.at(-1))} | ${fixed(report.totalMs / 1000)} | ${fixed(m.before.heapUsed / MiB)} / ${fixed(m.after.heapUsed / MiB)} | ${fixed(m.peak.heapUsed / MiB)} | ${fixed(m.peak.rss / MiB)} | ${fixed(m.after.arrayBuffers / MiB)} |`,
        );
    }
    const text = `${lines.join("\n")}\n`;
    if (values.md) writeFileSync(values.md, text);
    process.stdout.write(text);
    if (values.out) {
        writeFileSync(
            values.out,
            JSON.stringify(
                cases.map((one) => ({
                    trip: one.trip.id,
                    names: one.trip.names,
                    land: one.trip.land,
                    ship: one.trip.ship,
                    group: one.trip.group,
                    pass: one.trip.pass,
                    date: one.date,
                    optimize: one.optimize,
                    off: { travel: one.off.travel, total: one.off.total, snow: one.off.snow, outcome: one.off.outcome },
                    a: { travel: one.a.travel, total: one.a.total, snow: one.a.snow, outcome: one.a.outcome },
                    b: { travel: one.b.travel, total: one.b.total, snow: one.b.snow, outcome: one.b.outcome },
                    reroutedA: rerouted(one.off, one.a),
                    reroutedB: rerouted(one.off, one.b),
                })),
            ),
        );
    }
}

/**
 * Wie viel des Landnetzes je Reisebeginn im Gebirge über der Schneegrenze liegt: ganze Stücke (A, wie der Schlitten)
 * und der Anteil jedes Stücks (B), dazu die erfassten Stücke je Wegart und Zone.
 */
async function census() {
    const { database, data } = await open();
    const model = variantModel("b");
    const heights = data.heights ?? null;
    const land = data.network.links.filter((link) => routeDomain(link.subtype) === "land");
    const total = land.reduce((sum, link) => sum + link.distance, 0);
    console.log(`Landwege: ${String(land.length)} Stücke, ${total.toFixed(0)} Einheiten`);
    for (const date of DATES) {
        const day = dayOfYear(date.month, date.day);
        let wholeCount = 0;
        let whole = 0;
        let partCount = 0;
        let part = 0;
        const bySubtype = new Map();
        const byZone = new Map();
        for (const link of land) {
            const zone = data.climate.zoneOf(link.coordinates);
            const share = snowShare(model, link, zone, day, heights);
            if (share > 0) {
                partCount += 1;
                part += share * link.distance;
                bySubtype.set(link.subtype, (bySubtype.get(link.subtype) ?? 0) + share * link.distance);
                const zoneKey = `${zone} (${String(snowlineHeight(model, zone, day))})`;
                byZone.set(zoneKey, (byZone.get(zoneKey) ?? 0) + share * link.distance);
            }
            if (aboveSnowline(model, link, zone, day, heights)) {
                wholeCount += 1;
                whole += link.distance;
            }
        }
        const parts = (map) =>
            [...map.entries()]
                .sort((x, y) => y[1] - x[1])
                .map(([name, value]) => `${name} ${value.toFixed(0)}`)
                .join(", ");
        console.log(
            `${date.month} ${String(date.day)}: A ${String(wholeCount)} Stücke ${whole.toFixed(0)} E (${((whole / total) * 100).toFixed(2)} %) | B ${String(partCount)} Stücke ${part.toFixed(0)} E (${((part / total) * 100).toFixed(2)} %) | A/B ${((whole / Math.max(1e-9, part)) * 100).toFixed(0)} %`,
        );
        console.log(`   B nach Wegart: ${parts(bySubtype)}`);
        console.log(`   B nach Zone: ${parts(byZone)}`);
    }
    await database.end({ timeout: 5 });
}

/**
 * Die Laufzeit im selben Prozess: alle drei Varianten auf denselben Daten, je Rechnung in wechselnder Reihenfolge, damit
 * Last anderer Prozesse und das Aufwärmen alle gleich treffen.
 */
async function bench() {
    const { database, source, data } = await open();
    const services = Object.fromEntries(VARIANTS.map((name) => [name, serviceFor(name, data, source)]));
    let list = trips(data);
    if (values.limit) list = list.slice(0, Number(values.limit));
    for (const trip of list) {
        for (const name of VARIANTS) await services[name].route(queryOf(trip, "fastest", DATES[0]));
    }
    const times = Object.fromEntries(VARIANTS.map((name) => [name, []]));
    let index = 0;
    for (const trip of list) {
        for (const date of DATES) {
            for (const optimize of OPTIMIZE) {
                const order = VARIANTS.map((_, at) => VARIANTS[(at + index) % VARIANTS.length]);
                for (const name of order) {
                    const began = performance.now();
                    await services[name].route(queryOf(trip, optimize, date));
                    times[name].push(performance.now() - began);
                }
                index += 1;
            }
        }
    }
    await database.end({ timeout: 5 });
    for (const name of VARIANTS) {
        const sorted = sortNumbers(times[name]);
        const sum = sorted.reduce((x, y) => x + y, 0);
        console.log(
            `${LABEL[name]}: ${String(sorted.length)} Rechnungen, p50 ${fixed(quantile(sorted, 0.5))} ms, p95 ${fixed(quantile(sorted, 0.95))} ms, max ${fixed(sorted.at(-1))} ms, Summe ${fixed(sum / 1000)} s`,
        );
    }
    if (values.out) writeFileSync(values.out, `${JSON.stringify(times)}\n`);
}

/**
 * Die Fälle des Routing-Gates heute, mit A und mit B auf denselben Daten: welche die Regel ändert, und wie. Das Gate
 * selbst vergleicht mit seiner Basislinie; liegt die hinter den Daten (`DATA_CHANGE`), trennt erst dieser Lauf die
 * Regel vom Datenwechsel.
 */
async function gate() {
    const { database, source, data } = await open();
    const {
        loadGateFiles,
        queryOf: gateQuery,
        resolveName,
    } = await import("../../apps/server/src/routing/corpus-gate-run.ts");
    const { differences, summarize } = await import("../../apps/server/src/routing/corpus-gate.ts");
    const services = Object.fromEntries(VARIANTS.map((name) => [name, serviceFor(name, data, source)]));
    const places = [...data.network.nodes.values()]
        .filter((node) => node.kind === "place")
        .map((node) => ({ id: node.id, name: node.name, hidden: node.isHidden }));
    const cases = loadGateFiles().cases;
    const same = { a: 0, b: 0 };
    for (const one of cases) {
        const query = gateQuery(one.request);
        const ids = one.names.map((name) => resolveName(places, name)).map((hit) => hit.id);
        if ("invalid" in query || ids.some((id) => id === undefined)) {
            console.log(`${one.id}: nicht rechenbar`);
            continue;
        }
        const results = {};
        for (const name of VARIANTS)
            results[name] = summarize(await services[name].route({ ...query, waypoints: ids }));
        for (const name of ["a", "b"]) {
            const found = differences(results.off, results[name]);
            if (found.length === 0) {
                same[name] += 1;
                continue;
            }
            console.log(`${LABEL[name]} ${one.id} (${one.label})`);
            for (const line of found) console.log(`  ${line}`);
            // Das Ergebnis mit der Regel, in der Form eines Eintrags in `route-gate-expected-changes.json`.
            console.log(`  Ergebnis: ${JSON.stringify(results[name])}`);
        }
    }
    console.log(`gleich wie heute: A ${String(same.a)}, B ${String(same.b)} von ${String(cases.length)}`);
    await database.end({ timeout: 5 });
}

if (command === "run") await run();
else if (command === "bench") await bench();
else if (command === "gate") await gate();
else if (command === "compare") compare();
else if (command === "census") await census();
else {
    console.error("Befehl: run | compare | census | bench | gate");
    process.exit(2);
}
