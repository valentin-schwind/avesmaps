import { jsonLogger, runAuftragCli } from "./ausfuehrer.ts";

/**
 * Einstieg des Ausführers (WI-0163 §5.2): `node apps/server/{src,dist}/jobs/auftrag-cli.{ts,js} --job <id> [--art <art>]` oder
 * `--pflege`, lokal `npm run jobs:auftrag -- …`. Was er tut und welche Exitcodes er kennt, steht in `ausfuehrer.ts`.
 *
 * SIGTERM und SIGINT lösen den laufenden Auftrag ab: Der Job-Prozess darf bis `drainMaxS` weiterrechnen, hält dann an der
 * Phasengrenze an, und die Zeile geht ohne Versuchszähler zurück; danach Exit 0. Der Scope braucht dafür eine Stoppfrist über
 * `drainMaxS` plus Puffer.
 */

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop.abort());

const code = await runAuftragCli(process.argv.slice(2), process.env, {
    log: jsonLogger(
        (text) => void process.stdout.write(text),
        (text) => void process.stderr.write(text),
    ),
    stop: stop.signal,
});
process.exit(code);
