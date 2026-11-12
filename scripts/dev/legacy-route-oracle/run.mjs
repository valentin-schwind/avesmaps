/**
 * Rechnet Routen mit Legacys eigenem Routing-Code (WI-0017) - der Vergleichsmaßstab für unsere Wegfindung.
 *
 * Aufruf: node scripts/dev/legacy-route-oracle/run.mjs --requests <anfragen.json> --out <ergebnisse.jsonl> [--workers 6]
 *
 * 1. Exportiert Legacys `api/` aus dem Discovery-Mirror (nie aus dem Checkout des Betreibers) in das
 *    Arbeitsverzeichnis und ändert darin GENAU EINE Zeile: der Kartenlader bekommt die SQLite-Verbindung.
 * 2. Baut die SQLite-Datenbank aus dem Snapshot, falls sie fehlt (build-db.mjs).
 * 3. Verteilt die Anfragen auf mehrere PHP-Prozesse - Legacy baut den Graphen je Anfrage neu (~1,7 s).
 *
 * PHP lädt pdo_sqlite und mbstring per Kommandozeilenschalter; an der PHP-Installation wird nichts
 * geändert. memory_limit wird angehoben, weil Legacys Graphbau über 128 MB braucht.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const COMMIT = "bfec6701661b3178b54fd4a5ff98c4437f747d59";
const MIRROR = "C:/GIT/.discovery/avesmaps.git";
const WORK = "C:/avesmaps3d-data/work/legacy-route-oracle";
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const { values } = parseArgs({
    options: {
        requests: { type: "string" },
        out: { type: "string" },
        workers: { type: "string", default: "6" },
        // Eine andere Orakel-Datenbank, etwa aus einem frischeren Snapshot (build-db.mjs --out).
        database: { type: "string" },
    },
});
if (!values.requests || !values.out) {
    console.error(
        "Aufruf: run.mjs --requests <anfragen.json> --out <ergebnisse.jsonl> [--workers 6] [--database <oracle.sqlite>]",
    );
    process.exit(2);
}

const legacyDirectory = join(WORK, `legacy-${COMMIT.slice(0, 7)}`);
const legacyApi = join(legacyDirectory, "api");
if (!existsSync(join(legacyApi, "_internal", "routing", "response.php"))) {
    mkdirSync(legacyDirectory, { recursive: true });
    const archive = execFileSync("git", [`--git-dir=${MIRROR}`, "archive", COMMIT, "api"], {
        maxBuffer: 1 << 30,
    });
    // 🪤 Kein `-C <pfad>`: GNU tar unter Windows liest `C:` als entfernten Rechner. Also im Ziel entpacken.
    execFileSync("tar", ["-x"], { input: archive, cwd: legacyDirectory });
    const responseFile = join(legacyApi, "_internal", "routing", "response.php");
    const original = "$routeMapData = avesmapsLoadRouteMapData($config);";
    const source = readFileSync(responseFile, "utf8");
    if (!source.includes(original)) throw new Error("Legacy-Ladezeile nicht gefunden - anderer Commit?");
    writeFileSync(
        responseFile,
        source.replace(
            original,
            '$routeMapData = avesmapsLoadRouteMapData($config, $GLOBALS["avesmapsOraclePdo"] ?? null);',
        ),
    );
}
const database = values.database ?? join(WORK, "oracle.sqlite");
if (!values.database && !existsSync(database)) {
    execFileSync(process.execPath, [join(HERE, "build-db.mjs"), "--out", database], { stdio: "inherit" });
}

const requests = JSON.parse(readFileSync(values.requests, "utf8"));
const workers = Math.max(1, Number(values.workers));
const chunks = Array.from({ length: workers }, () => []);
requests.forEach((request, index) => chunks[index % workers].push({ index, request }));

const results = new Array(requests.length);
await Promise.all(
    chunks.map(
        (chunk, worker) =>
            new Promise((done, fail) => {
                if (chunk.length === 0) return done();
                const file = join(WORK, `chunk-${worker}.json`);
                writeFileSync(file, JSON.stringify(chunk.map((entry) => entry.request)));
                const php = spawn("php", [
                    "-d",
                    "extension=pdo_sqlite",
                    "-d",
                    "extension=mbstring",
                    "-d",
                    "memory_limit=2048M",
                    resolve(HERE, "harness.php"),
                    legacyApi,
                    database,
                    file,
                ]);
                let buffer = "";
                php.stdout.on("data", (data) => (buffer += data));
                php.stderr.on("data", (data) => process.stderr.write(data));
                php.on("close", (code) => {
                    rmSync(file, { force: true });
                    if (code !== 0) return fail(new Error(`PHP-Prozess ${worker} endete mit ${code}`));
                    for (const line of buffer.split("\n").filter(Boolean)) {
                        const result = JSON.parse(line);
                        // 🪤 Das Harness zählt je Arbeitspaket; in die Datei kommt die Nummer der Anfrage.
                        const index = chunk[result.index].index;
                        results[index] = { ...result, index };
                    }
                    done();
                });
            }),
    ),
);
writeFileSync(values.out, results.map((result) => JSON.stringify(result)).join("\n") + "\n");
console.log(`${results.length} Routen nach ${values.out}`);
