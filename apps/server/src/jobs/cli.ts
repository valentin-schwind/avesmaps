import { runJobsCli } from "./cli-commands.ts";

/** Einstieg von `jobs-cli` (`npm run jobs --`, auf dem VPS `node apps/server/dist/jobs/cli.js`). */
const code = await runJobsCli(process.argv.slice(2), process.env, {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
});
process.exit(code);
