// Bericht über die Verflechtung eines Stands (WI-0289, `scripts/dev/verflechtung.ts`). Nur lesend, ohne Checkout.
//
//     node scripts/dev/verflechtung-bericht.ts [<ref>] [--gegen <basis>]
//
// Ohne `--gegen`: Dateikreise, gegenseitige Bereiche und Grenzübertritte des Stands (Vorgabe `origin/master`). Mit `--gegen`: nur, was
// `<ref>` gegenüber `<basis>` neu verflicht, wie der Hinweis in `vor-dem-push`. Exit 0, auch bei Funden; 2, wenn Git den Stand nicht liefert.
import { berichtZeilen, hinweisZeilen, leseGraph, vergleiche } from "./verflechtung.ts";

const argumente = process.argv.slice(2);
const stelle = argumente.indexOf("--gegen");
const basis = stelle >= 0 ? argumente[stelle + 1] : undefined;
const ref = argumente.find((a, i) => !a.startsWith("--") && (stelle < 0 || i !== stelle + 1)) ?? "origin/master";

try {
    const zeilen =
        basis === undefined
            ? berichtZeilen(leseGraph(ref), ref)
            : [
                  `Verflechtung von ${ref} gegenüber ${basis}:`,
                  ...hinweisZeilen(vergleiche(leseGraph(basis), leseGraph(ref))),
              ];
    process.stdout.write(`${zeilen.join("\n")}\n`);
} catch (fehler) {
    process.stderr.write(`verflechtung-bericht: ${(fehler as Error).message}\n`);
    process.exitCode = 2;
}
