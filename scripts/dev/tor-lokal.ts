import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findeMartin, starteMartin, type Dienst } from "./release-dienste.ts";
import { spieleTestpaketEin } from "./release-testpaket.ts";
import { findePostgres, spieleSaatEin, starteWegwerfDb, WEGWERF_DATENBANK } from "./wegwerf-db.ts";

/**
 * Die Welt des Release-Tors lokal (WI-0264): dieselbe Kulisse wie der Teil `kern-echt` des Runners, ohne den Runner. Ein eigener Cluster mit
 * dem Testpaket (`daten.dump`, Kopie der Entwicklungsdatenbank) und den Migrationen DIESES Stands, ein eigener Martin, eine angemeldete
 * Tor-Person (`tor-welt.ts`). Danach fährt Playwright die genannten Specs gegen den echten Fastify dieses Stands (`E2E_SERVER=1`), oder die
 * Welt bleibt offen (`--offen`), bis Strg+C, und die Kommandozeile für weitere Läufe steht in der Ausgabe.
 *
 * 🔴 Nie gegen die Entwicklungsdatenbank, die Stage oder Production: Der Cluster entsteht hier und verschwindet mit dem Prozess.
 *
 *   node scripts/dev/tor-lokal.ts --testpaket C:\avesmaps3d-data\release-fixtures\<sha> e2e/tor-orte.spec.ts …
 *   node scripts/dev/tor-lokal.ts --testpaket <ordner> --offen
 */
const { values, positionals } = parseArgs({
    options: {
        testpaket: { type: "string" },
        offen: { type: "boolean", default: false },
    },
    allowPositionals: true,
});

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const testpaket = values.testpaket;
if (testpaket === undefined || !existsSync(join(testpaket, "daten.dump"))) {
    console.error(
        "tor-lokal: --testpaket nennt den Ordner mit daten.dump (C:\\avesmaps3d-data\\release-fixtures\\<sha>)",
    );
    process.exit(2);
}
if (!values.offen && positionals.length === 0) {
    console.error("tor-lokal: Specs nennen (e2e/tor-….spec.ts) oder --offen");
    process.exit(2);
}
const bin = findePostgres();
const martinBin = findeMartin();
if (bin === undefined || martinBin === undefined) {
    console.error("tor-lokal: PostgreSQL-Programme oder Martin nicht gefunden (PG_BIN_DIR, MARTIN_BIN)");
    process.exit(2);
}

/** Die Kommandozeile von Playwright, über die Modulauflösung: Eine Arbeitskopie hat kein eigenes node_modules, Node findet das des Hauptcheckouts. */
const PLAYWRIGHT_CLI = join(dirname(createRequire(import.meta.url).resolve("@playwright/test")), "cli.js");

const sage = (zeile: string): void => void process.stdout.write(`${zeile}\n`);

const freierPort = (): Promise<number> =>
    new Promise((erfuellt, abgelehnt) => {
        const server = net.createServer();
        server.once("error", abgelehnt);
        server.listen(0, "127.0.0.1", () => {
            const adresse = server.address();
            const port = typeof adresse === "object" && adresse !== null ? adresse.port : 0;
            server.close(() => (port > 0 ? erfuellt(port) : abgelehnt(new Error("kein freier Port"))));
        });
    });

const basis = mkdtempSync(join(tmpdir(), "avesmaps3d-tor-"));
const env: NodeJS.ProcessEnv = { ...process.env };
const korpus = await starteWegwerfDb({ bin, temp: basis });
let martin: Dienst | undefined;
const aufraeumen = (): void => {
    martin?.beende();
    korpus.stoppe();
};
process.once("SIGINT", () => {
    aufraeumen();
    process.exit(130);
});

try {
    const t0 = Date.now();
    await spieleTestpaketEin({
        bin,
        url: korpus.url,
        port: korpus.port,
        datenbank: WEGWERF_DATENBANK,
        dump: join(testpaket, "daten.dump"),
        arbeitsordner: basis,
        env,
    });
    spieleSaatEin(wurzel, korpus.url);
    sage(`tor-lokal: Korpus bereit in ${String(Math.round((Date.now() - t0) / 1000))} s (${korpus.url})`);

    const tokenDatei = join(basis, "welt-token.txt");
    // Der Medienordner muss schon beim Anlegen der Welt gelten: `tor-welt.ts` legt dort die Beispielbilder der Reisebilder ab (WI-0272 S4).
    env["MEDIA_ROOT"] = join(testpaket, "media");
    const welt = spawnSync(
        process.execPath,
        [join(wurzel, "scripts", "dev", "tor-welt.ts"), "--database-url", korpus.url, "--token-datei", tokenDatei],
        { cwd: wurzel, env, encoding: "utf8" },
    );
    if (welt.status !== 0) throw new Error(`tor-welt scheiterte: ${welt.stderr.trim()}`);

    const martinPort = await freierPort();
    martin = await starteMartin({
        bin: martinBin,
        port: martinPort,
        url: korpus.url,
        log: join(basis, "martin.log"),
        env,
    });

    const weltEnv: Record<string, string> = {
        DATABASE_URL: korpus.url,
        E2E_SERVER: "1",
        E2E_WORKERS: "1",
        TILE_ROOT: join(testpaket, "tiles"),
        MEDIA_ROOT: join(testpaket, "media"),
        MARTIN_PORT: String(martinPort),
        VITE_TILE_BASE: `http://127.0.0.1:${String(martinPort)}`,
        WELT_TOKEN_DATEI: tokenDatei,
        AUTH_INSECURE_COOKIE: "1",
        MAP_EDITING: "testwelt",
        E2E_PORT: String(await freierPort()),
        E2E_SERVER_PORT: String(await freierPort()),
    };
    Object.assign(env, weltEnv);

    if (values.offen) {
        sage("tor-lokal: Welt offen. Specs aus apps/web fahren mit:");
        for (const [k, v] of Object.entries(weltEnv)) sage(`  ${k}=${v}`);
        sage(`  node ${PLAYWRIGHT_CLI} test <specs> --retries=1 --workers=1`);
        sage("Strg+C beendet die Welt.");
        await new Promise(() => undefined);
    } else {
        const code = await new Promise<number>((erfuellt) => {
            const kind = spawn(
                process.execPath,
                [
                    PLAYWRIGHT_CLI,
                    "test",
                    ...positionals,
                    "--retries=1",
                    "--workers=1",
                    `--output=${join(basis, "ergebnisse")}`,
                ],
                { cwd: join(wurzel, "apps", "web"), env, stdio: "inherit" },
            );
            kind.on("exit", (c) => erfuellt(c ?? 1));
        });
        process.exitCode = code;
    }
} finally {
    if (!values.offen) aufraeumen();
}
