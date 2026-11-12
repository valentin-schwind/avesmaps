import { readFileSync } from "node:fs";
import { releaseAusNotiz } from "./release-nachweis.ts";
const sha = process.argv[2] ?? "";
const text = readFileSync(0, "utf8");
const n = text.length <= 64 * 1024 ? releaseAusNotiz(text, sha) : undefined;
if (n === undefined) process.exitCode = 1;
else process.stdout.write(`${n.ende}\n`);
