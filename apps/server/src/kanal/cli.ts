import { createDatabase } from "../database.ts";
import { runKanalCli } from "./agent-cli.ts";

/**
 * Einstieg der Kommandozeile des Betreiber-Kanals (`npm run kanal --`, WI-0124). Verbindung: `KANAL_DATABASE_URL` (die Rolle eines
 * Agenten; auf Stage richtet Claudio sie ein), sonst `DATABASE_URL` (lokal der Besitzer; dann `--als claudia` oder `KANAL_ALS`).
 *
 * 🪤 Mehrzeiligen Text nicht über `npm run kanal --` eintragen: npm reicht das Argument über eine Kommandozeile weiter, und auf
 * Windows kommt nur der Teil bis zur ersten Zeilenschaltung an — ohne Fehler, Exitcode 0. Am 2026-10-14 stand so die halbe
 * Antwort an einen Mitbetreiber im Kanal (OPS-000005). Für mehrzeiligen Text diese Datei direkt aufrufen, aus der Repo-Wurzel:
 * `node --env-file-if-exists=.env apps/server/src/kanal/cli.ts eintragen OPS-000005 --art antwort --text "…"`.
 */
const url = process.env["KANAL_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (url === undefined || url === "") {
    process.stderr.write("KANAL_DATABASE_URL oder DATABASE_URL fehlt\n");
    process.exit(2);
}
const database = createDatabase(url, { max: 1 });
const als = process.env["KANAL_ALS"];
// Die Verbindung schließt in jedem Fall, auch wenn der Befehl wirft.
const code = await runKanalCli(process.argv.slice(2), {
    database,
    als: als === "claudia" || als === "claudio" ? als : undefined,
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
}).finally(() => database.end({ timeout: 5 }));
process.exit(code);
