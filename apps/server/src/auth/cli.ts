import { runAuthCli } from "./cli-commands.ts";

/** Einstieg des Notzugangs (`npm run auth --`, auf dem VPS über das Werkzeug `avesmaps3d-auth <env>`; AUTH-0001 §6.7). */
const code = await runAuthCli(process.argv.slice(2), process.env, {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
});
process.exit(code);
