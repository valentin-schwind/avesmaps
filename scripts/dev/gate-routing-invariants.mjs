// Das Gate der Routing-Invarianten (WI-0061, Plan 11.54, 11.55, 11.57, 6.61): `npm run gate:routing-invariants`.
//
// Läuft dieselben Tests wie `npm test`, aber im vollen Umfang (AVESMAPS_INVARIANTS=full): Zehntausende erzeugte
// Fälle aus festem Seed für die Höhenregel des Flugs (Sperre, Bahn, Profil), die freie Seefahrt (Land, Häfen,
// Stabilität) und die Gelände-Revision, dazu gezogene Paare der echten Orte und Häfen aus der lokalen
// Entwicklungsdatenbank (`DATABASE_URL`, nur lesend; ohne sie überspringen diese Tests sichtbar), dazu die Steigung
// querfeldein auf offenem Land (WI-0049 F5: μ_offen nachgerechnet, Gang nie teurer als die Sehne, Mehrzeit nie negativ,
// `offroad-slope-invariants.test.ts`) und auf Wegen und Straßen außerhalb der Gebirge (F5c: Eichung hält das Mittel je
// Wegart und Familie, Gebirgsteil unverändert, `road-slope-invariants.test.ts`). Dazu die Zollzählung
// gegen zwei Implementierungen (WI-0065 U6, `toll-borders-oracle.test.ts`): die Fälle des Routing-Gates und 196 gezogene
// Reisen, Legacys Code unverändert (B1) und die exakte Rechnung in PostGIS (B2); Tabelle je Reise: `npm run compare:tolls`.
//
// Weitere Argumente reichen an Vitest weiter, etwa `-t "Stabilität"` oder `--reporter=verbose`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Die Tests der Invarianten. Serverseitige Tests laufen über die Wurzel (`fileParallelism: false`, AGENTS.md). */
const FILES = [
    "apps/server/test/air-invariants.test.ts",
    "apps/server/test/sea-invariants.test.ts",
    "apps/server/test/routing-invariants-data.test.ts",
    "apps/server/test/offroad-slope-invariants.test.ts",
    "apps/server/test/road-slope-invariants.test.ts",
    "apps/server/test/toll-borders-oracle.test.ts",
    "apps/web/test/flight-profile-invariants.test.ts",
];

const started = Date.now();
const result = spawnSync(
    process.execPath,
    [
        "--env-file-if-exists=.env",
        "node_modules/vitest/vitest.mjs",
        "run",
        // Die gemessenen Kennzahlen der Tests (Fälle, Umwege, Stabilität) stehen im Protokoll.
        "--disableConsoleIntercept",
        ...FILES,
        ...process.argv.slice(2),
    ],
    {
        cwd: repositoryRoot,
        stdio: "inherit",
        env: { ...process.env, AVESMAPS_INVARIANTS: "full" },
    },
);
console.log(`Routing-Invarianten (voller Satz) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(result.status ?? 1);
