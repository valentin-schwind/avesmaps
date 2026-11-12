// `node scripts/dev/db-bestand.ts [--ausgabe <ordner>] [--ohne-bank] [--nur <text>]...` — Bestandsaufnahme der Datenbanktests (WI-0224, Hauptorchestrierung
// 2026-10-18): alle Testdateien, die `TEST_DATABASE_URL` lesen, EINMAL auf dem Stand dieser Arbeitskopie (gedacht: frischer `origin/master`) in
// einem Wegwerf-Postgres (`scripts/dev/wegwerf-db.ts`), nie in der geteilten Entwicklungs- oder Testdatenbank.
//
// Ablauf: Prüfbank (der Lauf ist schwer), Wegwerf-Cluster, ein Vitest-Lauf mit den Dateien und JSON, danach jede rote Datei EINMAL mit
// längeren Fristen nachlaufen (unter Last scheitert ein Hook an der Zeit, nicht am Code); erst was auch dort rot bleibt, zählt. Ergebnis:
// `bestand.json` und `bestand.md` im Ausgabeordner, je rote Datei der erste rote Fall, die erste Fehlermeldung und die letzten Commits der
// Datei (der vermutliche Besitzer-Strang).
//
// 🪤 Läuft in der Arbeitskopie selbst, nicht in einer Kopie: Der Lauf braucht einen sauberen Baum auf dem Stand von `origin/master`; die Zeile
// zu Beginn nennt beide Stände und was im Baum anders ist. Ein `.env` im Baum (Hauptcheckout) lädt `vitest.setup.ts` nur für Variablen, die
// der Lauf nicht selbst setzt: `DATABASE_URL` wird darum leer gesetzt, die Entwicklungsdatenbank bleibt unberührt.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { dbTestDateien, leseTestDateien, wertAus, type DateiErgebnis } from "./db-tests.ts";
import { nimmBank, type Bank } from "./pruefbank.ts";
import { findePostgres, starteWegwerfDb, umgebungMitTestdatenbank, type WegwerfDb } from "./wegwerf-db.ts";

const { values } = parseArgs({
    options: {
        ausgabe: { type: "string" },
        "ohne-bank": { type: "boolean", default: false },
        /** Nur Dateien, deren Pfad diesen Text enthält (zum Ausprobieren). */
        nur: { type: "string", multiple: true },
    },
});

const sag = (zeile: string): void => {
    process.stdout.write(`${zeile}\n`);
};
const git = (...args: string[]): string => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim()}`);
    return r.stdout.trim();
};

const wurzel = git("rev-parse", "--show-toplevel");
const sha = git("rev-parse", "HEAD");
const ausgabe = values.ausgabe ?? join(tmpdir(), "db-bestand");
mkdirSync(ausgabe, { recursive: true });
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

let bank: Bank | undefined;
let db: WegwerfDb | undefined;
const raeumeAuf = (): void => {
    db?.stoppe();
    bank?.gibFrei();
};
for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGBREAK", 149],
    ["SIGHUP", 129],
] as const) {
    process.on(signal, () => {
        raeumeAuf();
        process.exit(code);
    });
}

function vitestLauf(dateien: readonly string[], frist: number, hookFrist: number, json: string): DateiErgebnis[] {
    if (db === undefined) throw new Error("kein Wegwerf-Cluster");
    const env = { ...umgebungMitTestdatenbank(process.env, db.url), DATABASE_URL: "" };
    spawnSync(
        process.execPath,
        [
            vitest,
            "run",
            "--reporter=default",
            "--reporter=json",
            `--outputFile.json=${json}`,
            `--testTimeout=${String(frist)}`,
            `--hookTimeout=${String(hookFrist)}`,
            ...dateien,
        ],
        { cwd: wurzel, env, stdio: ["ignore", "inherit", "inherit"] },
    );
    return wertAus(JSON.parse(readFileSync(json, "utf8")), wurzel);
}

/** Die letzten Commits einer Datei: Hash, Autorin oder Autor, Datum, Betreff. */
function letzteCommits(datei: string): string[] {
    try {
        return git("log", "-3", "--format=%h %as %an: %s", "--", datei)
            .split(/\r?\n/)
            .filter((z) => z !== "");
    } catch {
        return [];
    }
}

const zelle = (text: string): string => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

try {
    const bin = findePostgres();
    if (bin === undefined) {
        sag(
            "ROT  PostgreSQL fehlt auf diesem Rechner (initdb, postgres, pg_ctl, psql, pg_isready; PG_BIN_DIR setzen).",
        );
        process.exit(2);
    }
    const origin = (() => {
        try {
            return git("rev-parse", "origin/master");
        } catch {
            return "(unbekannt)";
        }
    })();
    const getrackt = git("status", "--porcelain", "--untracked-files=no")
        .split(/\r?\n/)
        .filter((z) => z !== "").length;
    sag(
        `db-bestand: Stand ${sha.slice(0, 9)}, origin/master ${origin.slice(0, 9)}${sha === origin ? " (gleich)" : " (VERSCHIEDEN)"}, ${String(getrackt)} geänderte getrackte Dateien im Baum.`,
    );
    const nurTexte = values.nur;
    const dateien = dbTestDateien(leseTestDateien(wurzel)).filter(
        (d) => nurTexte === undefined || nurTexte.some((text) => d.includes(text)),
    );
    sag(`  ${String(dateien.length)} Testdateien lesen TEST_DATABASE_URL.`);
    if (dateien.length === 0) {
        // Ohne Dateiliste liefe Vitest ALLE Tests (gemessen: ein `--nur /text` unter Git Bash wurde zum Windows-Pfad und fand nichts).
        sag(`ROT  Keine Datei gefunden${nurTexte === undefined ? "" : ` für --nur ${nurTexte.join(", ")}`}.`);
        process.exit(1);
    }

    if (!values["ohne-bank"]) {
        bank = await nimmBank({ sitzung: basename(wurzel), art: "DB-Bestandsaufnahme", commit: sha.slice(0, 8), sag });
    }
    const start = Date.now();
    db = await starteWegwerfDb({ bin, saat: wurzel });
    sag(`  Wegwerf-Postgres läuft (Port ${String(db.port)}, ${db.verzeichnis}).`);

    const erster = vitestLauf(dateien, 30_000, 120_000, join(ausgabe, "lauf1.json"));
    const rotErst = erster.filter((e) => e.status === "rot");
    sag(`  Lauf 1: ${String(erster.length)} Dateien, ${String(rotErst.length)} rot.`);
    let zweiter: DateiErgebnis[] = [];
    if (rotErst.length > 0) {
        sag(`  Nachlauf der ${String(rotErst.length)} roten Dateien mit 120 s je Fall und 300 s je Hook.`);
        zweiter = vitestLauf(
            rotErst.map((e) => e.datei),
            120_000,
            300_000,
            join(ausgabe, "lauf2.json"),
        );
    }
    const nachlauf = new Map(zweiter.map((e) => [e.datei, e] as const));
    const rot = rotErst.filter((e) => nachlauf.get(e.datei)?.status === "rot");
    const lastabhaengig = rotErst.filter((e) => nachlauf.get(e.datei)?.status !== "rot");
    const uebersprungen = erster.filter((e) => e.status === "uebersprungen");
    const minuten = Math.round((Date.now() - start) / 60_000);

    const bericht = {
        stand: sha,
        originMaster: origin,
        dateien: erster.length,
        gruen: erster.filter((e) => e.status === "gruen").length,
        rot: rot.map((e) => ({
            ...(nachlauf.get(e.datei) ?? e),
            ersteMeldung: e.meldung,
            commits: letzteCommits(e.datei),
        })),
        lastabhaengig: lastabhaengig.map((e) => e.datei),
        uebersprungen: uebersprungen.map((e) => e.datei),
        minuten,
    };
    writeFileSync(join(ausgabe, "bestand.json"), `${JSON.stringify(bericht, null, 2)}\n`);
    const zeilen = [
        `# Bestandsaufnahme der Datenbanktests`,
        ``,
        `Stand \`${sha.slice(0, 9)}\` (origin/master \`${origin.slice(0, 9)}\`), ${String(erster.length)} Dateien in ${String(minuten)} min im Wegwerf-Postgres: ` +
            `${String(bericht.gruen)} grün, ${String(rot.length)} rot nach Nachlauf, ${String(lastabhaengig.length)} nur unter Last rot, ${String(uebersprungen.length)} ganz übersprungen.`,
        ``,
        `| Datei | erster roter Fall | Meldung | letzte Commits |`,
        `|---|---|---|---|`,
        ...bericht.rot.map(
            (e) =>
                `| \`${e.datei}\` | ${zelle(e.test ?? "")} | ${zelle(e.meldung ?? "")} | ${zelle(e.commits.join(" · "))} |`,
        ),
        ``,
        `Nur unter Last rot (im Nachlauf grün): ${lastabhaengig.map((e) => `\`${e.datei}\``).join(", ") || "keine"}.`,
        ``,
        `Ganz übersprungen: ${uebersprungen.map((e) => `\`${e.datei}\``).join(", ") || "keine"}.`,
        ``,
    ];
    writeFileSync(join(ausgabe, "bestand.md"), zeilen.join("\n"));
    sag(
        `Ergebnis: ${String(erster.length)} Dateien, ${String(bericht.gruen)} grün, ${String(rot.length)} rot nach Nachlauf, ${String(lastabhaengig.length)} nur unter Last rot, ${String(uebersprungen.length)} ganz übersprungen (${String(minuten)} min). Bericht: ${join(ausgabe, "bestand.md")}`,
    );
} finally {
    raeumeAuf();
}
