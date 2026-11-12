import { runCommunityLegacy } from "./community-legacy-lauf.ts";

/**
 * Die offenen Meldungen aus Legacy einmalig als Vorgänge der Community übernehmen (WI-0268 C9, Entscheidung E6; Vertrag
 * `project-control/migration/contracts/community-meldungen.yaml`).
 *
 * Die Datei kommt aus `api/discord/reports-export.php` (Legacy, nur mit dem Token der Discord-App; den Abruf macht Claudio). Dieses Werkzeug ruft nie einen
 * Endpunkt. 🔴 Ohne `--anwenden` rechnet und zählt es nur (kein Schreibzugriff); mit `--anwenden` ist `--operator-said "<Zitat>"` Pflicht, je Umgebung und Lauf gesondert.
 *
 * Beispiele:
 *   npm run community:legacy -- --datei C:\avesmaps3d-data\legacy-snapshots\aktuell\map-reports-offen.json
 *   npm run community:legacy -- --datei <datei> --anwenden --operator-said "<Zitat des Betreibers>"
 */
process.exit(
    await runCommunityLegacy(process.argv.slice(2), process.env, {
        out: (line) => void process.stdout.write(`${line}\n`),
        err: (line) => void process.stderr.write(`${line}\n`),
    }),
);
