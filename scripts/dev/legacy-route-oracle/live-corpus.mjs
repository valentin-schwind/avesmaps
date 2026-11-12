/**
 * Fragt Legacys LIVE-Route für einen kleinen Korpus ab (WI-0017 R4, Kap. 6.52).
 *
 * Aufruf: node scripts/dev/legacy-route-oracle/live-corpus.mjs --requests <anfragen.json> --out <ergebnisse.jsonl>
 *         [--pause-ms 10000]
 *
 * 🔴 Gegen avesmaps.de nur gezielte Einzelabfragen (AGENTS.md, Skill legacy-analysis): nacheinander,
 * mindestens 10 s Abstand, höchstens 50 Anfragen je Lauf, mit erkennbarem Absender. `POST /api/route/`
 * rechnet nur, es schreibt nichts.
 *
 * Setzt fort: Was in `--out` schon beantwortet steht, wird nicht noch einmal gefragt. Das Ergebnis hat
 * dieselbe Zeilenform wie `run.mjs` (`index`, `ms`, `route` oder `error`), damit beide sich vergleichen
 * lassen.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

// Globale von Node, die die ESLint-Umgebung der Skripte nicht kennt.
const { fetch, AbortSignal } = globalThis;

const ENDPOINT = "https://avesmaps.de/api/route/";
const LIMIT = 50;
const MIN_PAUSE_MS = 10_000;
const USER_AGENT = "Avesmaps3D-Discovery (Claudia, WI-0017 R4 Routenvergleich)";

const { values } = parseArgs({
    options: {
        requests: { type: "string" },
        out: { type: "string" },
        "pause-ms": { type: "string", default: String(MIN_PAUSE_MS) },
    },
});
if (!values.requests || !values.out) {
    console.error("Aufruf: live-corpus.mjs --requests <anfragen.json> --out <ergebnisse.jsonl> [--pause-ms 10000]");
    process.exit(2);
}
const pause = Math.max(MIN_PAUSE_MS, Number(values["pause-ms"]));
const requests = JSON.parse(readFileSync(values.requests, "utf8"));
if (requests.length > LIMIT) {
    console.error(`Höchstens ${LIMIT} Anfragen je Lauf, hier ${requests.length}.`);
    process.exit(2);
}
const done = new Set(
    existsSync(values.out)
        ? readFileSync(values.out, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line).index)
        : [],
);

let first = true;
for (const [index, request] of requests.entries()) {
    if (done.has(index)) continue;
    if (!first) await new Promise((resolve) => setTimeout(resolve, pause));
    first = false;
    const started = performance.now();
    let line;
    try {
        const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": USER_AGENT },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(60_000),
        });
        const text = await response.text();
        let body;
        try {
            body = JSON.parse(text);
        } catch {
            body = { raw: text.slice(0, 500) };
        }
        line = {
            index,
            status: response.status,
            ms: performance.now() - started,
            ...(body.route ? { route: body.route } : { error: body }),
        };
    } catch (error) {
        line = { index, status: 0, ms: performance.now() - started, error: { message: String(error) } };
    }
    appendFileSync(values.out, JSON.stringify(line) + "\n");
    console.log(`${index + 1}/${requests.length}: HTTP ${line.status}, ${Math.round(line.ms)} ms`);
}
