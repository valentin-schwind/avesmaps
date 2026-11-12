// Das Testpaket des Release-Runners (WI-0248 R1): Vertrag, Prüfung und Einspielen des Korpus.
//
// 🔴 Vertrag (Schema 2). Ein Testpaket ist ein Ordner mit
//   manifest.json  { "schema": 2, "erstellt": "<ISO-Zeit>", "quelle": { "migrationen": ["0001_…", …] } }  (weitere Felder erlaubt)
//   daten.dump     `pg_dump -Fc` der Quelle, VOLLSTÄNDIG (Schema und Daten, auch `schema_migration`)
//   tiles/         die Rasterkacheln          media/   die veröffentlichten Medien
// `quelle.migrationen` sind die Schlüssel des Migrationsjournals (`schema_migration.version`, Dateiname ohne `.sql`); der Dateiname mit
// `.sql` und ein Pfad davor gelten ebenso. Der Runner spielt den Dump in einen leeren Wegwerf-Cluster ein und wendet danach die Migrationen
// DES KANDIDATEN vorwärts an, wie Stage und Production es beim Update tun. Ein Testpaket aus einem Stand, den der Kandidat nicht kennt (eine
// Migration der Quelle fehlt im Kandidaten), ist rot: Der Kandidat könnte das Schema der Quelle nicht richtig lesen.
//
// 🪤 Der Dump wird als Besitzer der Datenbank (Rolle ohne Sonderrechte) eingespielt, wie die App sie auf Stage und Production hat. Was nur ein
// Superuser darf (`CREATE EXTENSION`, `COMMENT ON EXTENSION`, die Daten von `spatial_ref_sys`), legt der Runner vorab als Superuser an und lässt
// es in der Inhaltsliste aus (`pg_restore -l` → filtern → `-L`); jeder andere Fehler beendet das Einspielen (`--exit-on-error`).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseProzess } from "./release-nachweis.ts";

export const TESTPAKET_SCHEMA = 2;

export type PaketPruefung =
    | {
          readonly ok: true;
          readonly erstellt: string;
          /** Die Migrationen der Quelle (Journal-Schlüssel). */
          readonly quelle: readonly string[];
          /** Die Migrationen des Kandidaten, die nach dem Einspielen noch folgen. */
          readonly folgend: readonly string[];
      }
    | { readonly ok: false; readonly grund: string };

/** `0216_x.sql`, `apps/server/migrations/0216_x.sql` oder `0216_x` → `0216_x`, der Schlüssel im Migrationsjournal. */
export function migrationsname(eintrag: string): string {
    const name = eintrag.trim().replace(/\\/g, "/").split("/").pop() ?? "";
    return name.replace(/\.sql$/u, "");
}

/** Die Migrationen eines Stands aus der Ausgabe von `git ls-tree --name-only <sha> apps/server/migrations/` (nur `.sql`, sortiert). */
export function migrationenAusBaum(lsTree: string): string[] {
    return lsTree
        .split(/\r?\n/)
        .map((zeile) => zeile.trim())
        .filter((zeile) => zeile.endsWith(".sql"))
        .map(migrationsname)
        .sort();
}

const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;

/**
 * Prüft das Manifest eines Testpakets gegen die Migrationen des Kandidaten, bevor irgendetwas eingespielt wird. `manifest` ist der Text der
 * Datei oder `undefined`, wenn sie fehlt. Rein: dieselbe Eingabe, dieselbe Antwort.
 */
export function pruefeTestpaketManifest(
    manifest: string | undefined,
    kandidatMigrationen: readonly string[],
): PaketPruefung {
    const nein = (grund: string): PaketPruefung => ({ ok: false, grund });
    if (manifest === undefined)
        return nein(
            `Testpaket ohne manifest.json: altes Testpaketformat (erwartet Schema ${String(TESTPAKET_SCHEMA)} mit quelle.migrationen)`,
        );
    let roh: unknown;
    try {
        roh = JSON.parse(manifest);
    } catch {
        return nein("manifest.json des Testpakets ist kein gültiges JSON");
    }
    if (typeof roh !== "object" || roh === null || Array.isArray(roh))
        return nein("manifest.json des Testpakets ist kein Objekt");
    const m = roh as { schema?: unknown; erstellt?: unknown; quelle?: unknown };
    if (m.schema !== TESTPAKET_SCHEMA) {
        if (typeof m.schema === "number" && m.schema > TESTPAKET_SCHEMA)
            return nein(
                `Testpaketformat neuer als der Runner (Schema ${String(m.schema)}, erwartet ${String(TESTPAKET_SCHEMA)})`,
            );
        return nein(
            `altes Testpaketformat (Schema ${m.schema === undefined ? "fehlt" : JSON.stringify(m.schema)}, erwartet ${String(TESTPAKET_SCHEMA)})`,
        );
    }
    if (typeof m.erstellt !== "string" || !ISO_ZEIT.test(m.erstellt) || !Number.isFinite(Date.parse(m.erstellt)))
        return nein("manifest.json: „erstellt“ fehlt oder ist keine ISO-Zeit");
    const migrationen = (m.quelle as { migrationen?: unknown } | null | undefined)?.migrationen;
    if (
        !Array.isArray(migrationen) ||
        migrationen.length === 0 ||
        !migrationen.every((e): e is string => typeof e === "string" && migrationsname(e) !== "")
    )
        return nein("manifest.json: „quelle.migrationen“ fehlt, ist leer oder enthält Ungültiges");
    if (kandidatMigrationen.length === 0)
        return nein("Kandidat enthält keine Migrationen unter apps/server/migrations/");
    const quelle = [...new Set(migrationen.map(migrationsname))].sort();
    const kandidat = new Set(kandidatMigrationen.map(migrationsname));
    const fehlend = quelle.filter((name) => !kandidat.has(name));
    if (fehlend.length > 0)
        return nein(
            `Testpaket neuer als der Kandidat: ${String(fehlend.length)} Migration(en) der Quelle fehlen im Kandidaten (${fehlend.slice(0, 5).join(", ")}${fehlend.length > 5 ? ", …" : ""})`,
        );
    const bekannt = new Set(quelle);
    return {
        ok: true,
        erstellt: m.erstellt,
        quelle,
        folgend: [...kandidat].filter((name) => !bekannt.has(name)).sort(),
    };
}

/** Der Text von `manifest.json` im Testpaket oder `undefined`. */
export function liesManifest(ordner: string): string | undefined {
    const datei = join(ordner, "manifest.json");
    return existsSync(datei) ? readFileSync(datei, "utf8") : undefined;
}

const ERWEITERUNG = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Filtert die Inhaltsliste von `pg_restore -l` für ein Einspielen ohne Superuser: Erweiterungen, deren Kommentare und die Daten von
 * `spatial_ref_sys` entfallen (die Erweiterungen legt der Runner vorab als Superuser an). Ausgelassene Zeilen bleiben als Kommentar (`;`) stehen, `pg_restore -L` überliest
 * sie. Alles andere bleibt unverändert und scheitert gegebenenfalls laut.
 */
export function filtereInhaltsliste(inhalt: string): {
    readonly liste: string;
    readonly erweiterungen: readonly string[];
    readonly ausgelassen: number;
} {
    const erweiterungen: string[] = [];
    let ausgelassen = 0;
    const zeilen = inhalt.split(/\r?\n/).map((zeile) => {
        const eintrag = /^\d+;\s+\d+\s+\d+\s+(.*)$/u.exec(zeile)?.[1];
        if (eintrag === undefined) return zeile;
        const erweiterung = /^EXTENSION\s+-\s+(\S+)/u.exec(eintrag)?.[1];
        if (erweiterung !== undefined) {
            if (!ERWEITERUNG.test(erweiterung))
                throw new Error(`Unzulässiger Erweiterungsname im Dump: ${erweiterung}`);
            erweiterungen.push(erweiterung);
            ausgelassen += 1;
            return `; ausgelassen (Superuser): ${zeile}`;
        }
        // Die Tabelle gehört PostGIS (Besitzer postgres) und ist nach `CREATE EXTENSION` gefüllt; ein COPY darauf braucht Schreibrecht.
        if (
            /^COMMENT\s+-\s+EXTENSION\s/u.test(eintrag) ||
            /^TABLE DATA\s+public\s+spatial_ref_sys(\s|$)/u.test(eintrag)
        ) {
            ausgelassen += 1;
            return `; ausgelassen (Superuser): ${zeile}`;
        }
        return zeile;
    });
    return { liste: zeilen.join("\n"), erweiterungen, ausgelassen };
}

const exe = process.platform === "win32" ? ".exe" : "";

/**
 * Spielt `daten.dump` des Testpakets in die leere Datenbank eines Wegwerf-Clusters ein (Rolle ohne Sonderrechte als Besitzer). Die
 * Migrationen des Kandidaten folgen danach (`spieleSaatEin`). Wirft mit einem Satz, wenn ein Schritt scheitert; Einzelheiten stehen im Protokoll
 * `korpus-laden.log` im `arbeitsordner`.
 */
export async function spieleTestpaketEin(optionen: {
    /** Das Verzeichnis der PostgreSQL-Programme. */
    readonly bin: string;
    readonly url: string;
    readonly port: number;
    readonly datenbank: string;
    readonly dump: string;
    readonly arbeitsordner: string;
    readonly env: NodeJS.ProcessEnv;
    readonly minuten?: number;
}): Promise<{ readonly erweiterungen: readonly string[]; readonly ausgelassen: number }> {
    const programm = (name: string): string => join(optionen.bin, `${name}${exe}`);
    const liste = spawnSync(programm("pg_restore"), ["-l", optionen.dump], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        windowsHide: true,
    });
    if (liste.status !== 0)
        throw new Error(
            `daten.dump ist kein lesbares pg_dump-Archiv (pg_restore -l, Status ${String(liste.status)}): ${(liste.stderr ?? "").trim().split(/\r?\n/).slice(-2).join(" | ")}`,
        );
    const gefiltert = filtereInhaltsliste(liste.stdout);
    const inhalt = join(optionen.arbeitsordner, "korpus-inhalt.txt");
    writeFileSync(inhalt, gefiltert.liste);
    for (const erweiterung of gefiltert.erweiterungen) {
        const lauf = spawnSync(
            programm("psql"),
            [
                "-h",
                "127.0.0.1",
                "-p",
                String(optionen.port),
                "-U",
                "postgres",
                "-d",
                optionen.datenbank,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                `CREATE EXTENSION IF NOT EXISTS "${erweiterung}"`,
            ],
            { encoding: "utf8", windowsHide: true },
        );
        if (lauf.status !== 0)
            throw new Error(
                `Erweiterung „${erweiterung}“ des Testpakets lässt sich im Cluster nicht anlegen: ${(lauf.stderr ?? "").trim().split(/\r?\n/).slice(-2).join(" | ")}`,
            );
    }
    const code = await releaseProzess(
        programm("pg_restore"),
        [
            "--dbname",
            optionen.url,
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
            "--use-list",
            inhalt,
            optionen.dump,
        ],
        {
            cwd: optionen.arbeitsordner,
            env: optionen.env,
            log: join(optionen.arbeitsordner, "korpus-laden.log"),
            timeoutMs: (optionen.minuten ?? 60) * 60_000,
        },
    );
    if (code !== 0) {
        const protokoll = join(optionen.arbeitsordner, "korpus-laden.log");
        const ende = existsSync(protokoll)
            ? readFileSync(protokoll, "utf8")
                  .split(/\r?\n/)
                  .filter((zeile) => zeile.trim() !== "")
                  .slice(0, 2)
                  .map((zeile) => zeile.slice(0, 300))
                  .join(" | ")
            : "";
        throw new Error(`korpus-laden: pg_restore Exit ${String(code)}: ${ende}`);
    }
    return { erweiterungen: gefiltert.erweiterungen, ausgelassen: gefiltert.ausgelassen };
}
