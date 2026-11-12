/**
 * Woher der gemessene Code kommt (WI-0250 Phase B): ein festgelegter Stand, nie ein halb veränderter Arbeitsbaum.
 *
 * - **Im Arbeitsbaum** (ohne `--commit`): `pruefeBaum` liest den Commit und ob die Generator-Verzeichnisse (`GENERATOR_PFADE`) sauber sind.
 *   Ungetrackte Dateien dort zählen mit: eine neue `.ts` kann eine alte überschatten. Unsauber: der Adapter verweigert, außer mit
 *   `--schmutzig-erlauben`; dann trägt der Lauf den Hash der Änderung und gilt nicht als reproduzierbar.
 * - **Im Stand** (`--commit <sha>`): `stelleStandBereit` entpackt die Quellen des Commits mit `git archive` (bitgenau, ohne Zeilenenden-Umwandlung,
 *   ohne `.git`) unter `<Labor>/staende/<sha12>`, legt dort die zwei Drittpakete in der Fassung der `package-lock.json` des Commits an und
 *   merkt sich das in `STAND.json`. Einmal je Commit, danach wiederverwendet. Es wird kein `node_modules` des Hauptcheckouts verlinkt;
 *   `@avesmaps3d/shared` löst `modul-hook.mjs` auf die Quellen des Stands auf.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_PFADE, STAND_ABHAENGIGKEITEN, STAND_PFADE, standOrdner } from "./pfade.ts";

export class StandFehler extends Error {}

function git(wurzel: string, args: readonly string[], eingabe?: string): string {
    const r = spawnSync("git", ["-C", wurzel, ...args], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        ...(eingabe === undefined ? {} : { input: eingabe }),
    });
    if (r.status !== 0) throw new StandFehler(`git ${args.join(" ")}: ${(r.stderr || r.error?.message || "").trim()}`);
    return r.stdout;
}

export interface BaumZustand {
    art: "arbeitsbaum" | "stand";
    wurzel: string;
    commit: string;
    sauber: boolean;
    /** Geänderte oder ungetrackte Dateien in den Generator-Verzeichnissen (Git-Kurzstatus). */
    geaendert: string[];
    /** SHA-256 über Diff und Inhalte ungetrackter Dateien; nur bei unsauberem Baum. */
    aenderung_sha256: string | null;
}

/** Commit und Sauberkeit der Generator-Verzeichnisse eines Arbeitsbaums. */
export function pruefeBaum(wurzel: string): BaumZustand {
    const commit = git(wurzel, ["rev-parse", "HEAD"]).trim();
    const status = git(wurzel, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...GENERATOR_PFADE]);
    const geaendert = status.split("\0").filter((z) => z !== "");
    let aenderung_sha256: string | null = null;
    if (geaendert.length > 0) {
        const h = createHash("sha256");
        h.update(git(wurzel, ["diff", "HEAD", "--binary", "--", ...GENERATOR_PFADE]));
        for (const zeile of geaendert.filter((z) => z.startsWith("??")).sort()) {
            const datei = zeile.slice(3);
            h.update(`\0${datei}\0`);
            try {
                h.update(readFileSync(join(wurzel, datei)));
            } catch {
                /* verschwunden zwischen Status und Lesen: zählt als Änderung, ohne Inhalt */
            }
        }
        aenderung_sha256 = h.digest("hex");
    }
    return { art: "arbeitsbaum", wurzel, commit, sauber: geaendert.length === 0, geaendert, aenderung_sha256 };
}

/** Der volle Commit-Hash zu einer Angabe (Hash, Kurzhash, Name); wirft, wenn der Commit lokal fehlt. */
export function loeseCommitAuf(repoWurzel: string, angabe: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$/.test(angabe)) throw new StandFehler(`Ungültige Commit-Angabe: ${angabe}`);
    try {
        return git(repoWurzel, ["rev-parse", "--verify", `${angabe}^{commit}`]).trim();
    } catch {
        throw new StandFehler(`Commit ${angabe} nicht gefunden (lokal vorhanden? git fetch origin)`);
    }
}

interface StandKopf {
    commit: string;
    erstellt: string;
    pfade: string[];
    abhaengigkeiten: Record<string, string | null>;
}

function npm(cwd: string, args: readonly string[]): void {
    // Windows: npm ist ein Skript (`npm.cmd`); mit Shell aufrufen. Die Argumente sind feste Texte und Fassungen aus der Lock-Datei.
    const r = spawnSync(`npm ${args.join(" ")}`, { cwd, shell: true, encoding: "utf8" });
    if (r.status !== 0)
        throw new StandFehler(`npm ${args.join(" ")}: ${(r.stderr || r.stdout || "").trim().slice(-800)}`);
}

/** Fassung eines Drittpakets laut `package-lock.json` des Stands; `null`, wenn der Commit es nicht kennt. */
function lockFassung(standWurzel: string, paket: string): string | null {
    const lock = join(standWurzel, "package-lock.json");
    if (!existsSync(lock)) return null;
    const daten = JSON.parse(readFileSync(lock, "utf8")) as { packages?: Record<string, { version?: string }> };
    return daten.packages?.[`node_modules/${paket}`]?.version ?? null;
}

export function leseStandKopf(standWurzel: string): StandKopf | null {
    const datei = join(standWurzel, "STAND.json");
    return existsSync(datei) ? (JSON.parse(readFileSync(datei, "utf8")) as StandKopf) : null;
}

/**
 * Legt den Stand eines Commits an, wenn er fehlt, und gibt seine Wurzel zurück. Atomar: gebaut wird neben dem Ziel und dann umbenannt, ein
 * abgebrochener Bau hinterlässt keinen halben Stand.
 */
export function stelleStandBereit(
    repoWurzel: string,
    commit: string,
    laborDir?: string,
): { wurzel: string; commit: string; neu: boolean } {
    const voll = loeseCommitAuf(repoWurzel, commit);
    const ziel = join(standOrdner(laborDir), voll.slice(0, 12));
    const kopf = leseStandKopf(ziel);
    if (kopf !== null) {
        if (kopf.commit !== voll) throw new StandFehler(`Stand ${ziel} gehört zu ${kopf.commit}, nicht zu ${voll}`);
        return { wurzel: ziel, commit: voll, neu: false };
    }
    const bau = `${ziel}.bau`;
    rmSync(bau, { recursive: true, force: true });
    rmSync(ziel, { recursive: true, force: true });
    mkdirSync(bau, { recursive: true });
    const vorhanden = STAND_PFADE.filter(
        (p) => git(repoWurzel, ["ls-tree", "--name-only", voll, "--", p]).trim() !== "",
    );
    if (!vorhanden.some((p) => p === "packages/shared"))
        throw new StandFehler(`Commit ${voll} hat kein packages/shared`);
    // `git archive` schreibt ein Tar; das Entpacken macht `tar` (Windows 11 und Git for Windows bringen eines mit). Der Ordner des Tars ist
    // das Arbeitsverzeichnis, damit GNU-tar den Laufwerksbuchstaben eines Archivpfads nicht für einen Rechnernamen hält.
    const tarDatei = join(bau, "stand.tar");
    git(repoWurzel, ["archive", "--format=tar", `--output=${tarDatei}`, voll, "--", ...vorhanden]);
    const entpackt = spawnSync("tar", ["-xf", "stand.tar"], { cwd: bau, encoding: "utf8" });
    if (entpackt.status !== 0)
        throw new StandFehler(`tar: ${(entpackt.stderr || entpackt.error?.message || "").trim()}`);
    rmSync(tarDatei);
    const abhaengigkeiten: Record<string, string | null> = {};
    for (const paket of STAND_ABHAENGIGKEITEN) abhaengigkeiten[paket] = lockFassung(bau, paket);
    const fest = Object.fromEntries(Object.entries(abhaengigkeiten).filter(([, v]) => v !== null));
    // Ein eigenes Wurzel-package.json (nicht das des Repositorys, dessen Arbeitsbereiche npm auf die Pakete des Stands bände).
    writeFileSync(
        join(bau, "package.json"),
        JSON.stringify({ name: "terrain-lab-stand", private: true, type: "module", dependencies: fest }, null, 2),
    );
    if (Object.keys(fest).length > 0)
        npm(bau, ["install", "--no-audit", "--no-fund", "--no-package-lock", "--ignore-scripts", "--loglevel=error"]);
    const standKopf: StandKopf = {
        commit: voll,
        erstellt: new Date().toISOString(),
        pfade: [...vorhanden],
        abhaengigkeiten,
    };
    writeFileSync(join(bau, "STAND.json"), JSON.stringify(standKopf, null, 2));
    renameSync(bau, ziel);
    return { wurzel: ziel, commit: voll, neu: true };
}

/** Der Zustand eines Stands als `BaumZustand` (sauber, denn er ist ein Archiv des Commits). */
export function standZustand(wurzel: string, commit: string): BaumZustand {
    return { art: "stand", wurzel, commit, sauber: true, geaendert: [], aenderung_sha256: null };
}
