import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** Every expensive step is asynchronous so the worker can enforce its deadline. */
export function releaseProzess(
    exe: string,
    args: readonly string[],
    optionen: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        log: string;
        timeoutMs: number;
    },
): Promise<number> {
    return new Promise((resolve, reject) => {
        const fd = openSync(optionen.log, "a");
        const kind = spawn(exe, [...args], {
            cwd: optionen.cwd,
            env: optionen.env,
            stdio: ["ignore", fd, fd],
            windowsHide: true,
            detached: process.platform !== "win32",
        });
        closeSync(fd);
        let abgelaufen = false;
        const timer = setTimeout(() => {
            abgelaufen = true;
            if (kind.pid !== undefined) {
                if (process.platform === "win32") {
                    const stop = spawnSync("taskkill", ["/PID", String(kind.pid), "/T", "/F"], {
                        windowsHide: true,
                        timeout: 10_000,
                    });
                    if (stop.status !== 0) {
                        kind.kill();
                        reject(new Error("timeout: Prozessbaum-Abbruch nicht bestätigt"));
                    }
                } else {
                    try {
                        process.kill(-kind.pid, "SIGKILL");
                    } catch {
                        /* already exited */
                    }
                }
            }
        }, optionen.timeoutMs);
        kind.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
        kind.once("exit", (code) => {
            clearTimeout(timer);
            if (abgelaufen) reject(new Error("timeout"));
            else resolve(code ?? 1);
        });
    });
}

export interface ReleaseTeil {
    sha: string;
    klasse: string;
    exit: number;
    status: string;
    /**
     * Additiv (WI-0248): der Name des Browserteils (`release-teile.json`), damit die Notiz sagt, WAS geprüft wurde. Die Leser (`releaseGruen`,
     * `releaseAusNotiz`, Claudios Prüfer) lesen nur `sha`, `klasse`, `status` und `exit`; ein Teil mit oder ohne diese Felder gilt gleich.
     */
    name?: string;
    /** Additiv: die SHA-256 des Rohberichts dieses Teils (dieselbe wie in `belege`); die Wiederholung prüft damit einen übernommenen Teil. */
    beleg?: string;
}
export interface ReleaseNachweis {
    version: 3;
    sha: string;
    umgebung: string;
    start: string;
    ende: string;
    status: string;
    /**
     * Welches Prüfprofil lief. `tor` (WI-0264, Vali 2026-10-30, Vorgabe): das Release-Tor aus `bau` (Lint, Typen, Bau), `daten` (Migrationen und
     * Rechte auf echten Daten) und `kern-echt` (Kernabläufe im Browser gegen den echten Server, `apps/web/e2e/release-tor.json`). `B`
     * (Betreiberentscheidung 2026-10-24, nur noch auf Auftrag): statische Prüfung, Bau, alle Vitest-Tests (`voll`) und die feste
     * Browser-Stichprobe der Kernabläufe (`kern`, `apps/web/e2e/release-kern.json`). `voll`: dazu alle vier Browserteile statt der Stichprobe,
     * nur auf ausdrücklichen Auftrag. Fehlt das Feld (Notizen von vorher), gilt `voll`.
     */
    profil?: ReleaseProfil;
    /**
     * Additiv (WI-0248, Vali 2026-10-26: die Auslieferung folgt automatisch bei Grün): die Kennung der Freigabe (`RT-…`, `release-freigabe.ts`),
     * mit der dieser Lauf gestartet wurde. Nur ein grüner Nachweis mit der Kennung der jüngsten Freigabe (oder einer, der schon vor ihr grün war)
     * wird ausgeliefert. Fehlt bei Läufen ohne Freigabe (von Hand gestartet); `releaseGruen` liest es nicht.
     */
    auftrag?: string;
    /**
     * Nur lokal (WI-0264, der Volltest der Systemsteuerung): Dieser Lauf schrieb keine Notiz nach origin (`--nur-bericht`), er prüft nur und liefert nie
     * aus. Ein solcher Nachweis steht nur in `status.json` und `ergebnis.json` des Ergebnisordners, nie in `refs/notes/sammellauf`; die Leser hier und
     * bei Claudio sehen ihn darum nie.
     */
    nurBericht?: true;
    /** Nur lokal: Teil 1 des Volltests (Profil `tor`), dessen Bericht diese Seite mit enthält (`--vorlauf`). */
    vorlauf?: ReleaseVorlauf;
    teile: ReleaseTeil[];
    belege: Record<string, string>;
}
/** Der Lauf von Teil 1 eines Volltests, wie Teil 2 ihn bei seinem Start vorfand: Ordnername unter `.release-runs`, Status und Profil. */
export interface ReleaseVorlauf {
    ordner: string;
    status: string;
    profil?: string;
}
export type ReleaseProfil = "tor" | "B" | "voll";
/** Die Teile je Profil; jeder Teil muss genau einmal grün sein. */
export const RELEASE_PROFILE: Readonly<Record<ReleaseProfil, readonly string[]>> = {
    tor: ["bau", "daten", "kern-echt"],
    B: ["voll", "kern"],
    voll: ["voll", "browser-1", "browser-2", "browser-3", "browser-4"],
};
/**
 * Der Rohbericht je Teil (so heißen auch die Belege im Nachweis). `bau.json` ist kein Bericht eines Werkzeugs, sondern die Buchführung des
 * Runners über die drei Schritte des Teils (Name und Exitcode), damit auch dieser Teil einen prüfbaren Beleg hat.
 */
export const BELEG_JE_TEIL: Readonly<Record<string, string>> = {
    voll: "vitest.json",
    kern: "kern.json",
    "browser-1": "browser-1.json",
    "browser-2": "browser-2.json",
    "browser-3": "browser-3.json",
    "browser-4": "browser-4.json",
    bau: "bau.json",
    daten: "daten.json",
    "kern-echt": "kern-echt.json",
};
export const releaseKlassen = (profil: ReleaseProfil | undefined): readonly string[] =>
    RELEASE_PROFILE[profil ?? "voll"];
export const releaseBelege = (profil: ReleaseProfil | undefined): readonly string[] =>
    releaseKlassen(profil).map((k) => BELEG_JE_TEIL[k] ?? `${k}.json`);
/**
 * Das Profil eines Laufs (WI-0264): Vorgabe ist das Tor (`tor`); `AVESMAPS_RELEASE_PROFIL=B` und `=voll` nur auf ausdrücklichen Auftrag.
 * Jeder andere Wert gilt wie kein Wert: Ein Tippfehler macht den Lauf nie strenger oder lockerer als das Tor.
 */
export const releaseProfilAus = (env: NodeJS.ProcessEnv): ReleaseProfil => {
    const wert = env["AVESMAPS_RELEASE_PROFIL"];
    return wert === "voll" || wert === "B" ? wert : "tor";
};
/** Profil `voll` (Notizen ohne Profilfeld); für ältere Leser und Fixtures. */
export const RELEASE_BELEGE = [
    "vitest.json",
    "browser-1.json",
    "browser-2.json",
    "browser-3.json",
    "browser-4.json",
] as const;
export const RELEASE_KLASSEN = ["voll", "browser-1", "browser-2", "browser-3", "browser-4"] as const;
export function releaseGruen(n: ReleaseNachweis, sha: string, umgebung?: string): boolean {
    if (n.profil !== undefined && !Object.hasOwn(RELEASE_PROFILE, n.profil)) return false;
    const klassen = releaseKlassen(n.profil);
    const belege = releaseBelege(n.profil);
    const ende = Date.parse(n.ende),
        start = Date.parse(n.start);
    return (
        n.version === 3 &&
        /^[a-f0-9]{40}$/.test(sha) &&
        n.sha === sha &&
        /^[a-f0-9]{64}$/.test(n.umgebung) &&
        (umgebung === undefined || n.umgebung === umgebung) &&
        n.status === "gruen" &&
        Number.isFinite(start) &&
        Number.isFinite(ende) &&
        start <= ende &&
        ende <= Date.now() &&
        n.belege !== null &&
        typeof n.belege === "object" &&
        Object.keys(n.belege).length === belege.length &&
        belege.every((p) => /^[a-f0-9]{64}$/.test(n.belege[p] ?? "")) &&
        Array.isArray(n.teile) &&
        n.teile.length === klassen.length &&
        klassen.every(
            (k) =>
                n.teile.filter((t) => t.klasse === k && t.sha === sha && t.status === "gruen" && t.exit === 0)
                    .length === 1,
        )
    );
}
export function releaseNotiz(n: ReleaseNachweis): string {
    if (!releaseGruen(n, n.sha)) throw new Error("Unvollständiger Release-Nachweis");
    return `${n.sha} ${n.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(n)}\n`;
}

/** All Production readers use the same versioned contract, including the first line. */
export function releaseAusNotiz(text: string, sha: string): ReleaseNachweis | undefined {
    try {
        const zeilen = text.trim().split(/\r?\n/);
        if (zeilen.length !== 2 || !zeilen[1]?.startsWith("release-nachweis-v3 ")) return undefined;
        const n = JSON.parse(zeilen[1].slice("release-nachweis-v3 ".length)) as ReleaseNachweis;
        return releaseGruen(n, sha) && zeilen[0] === [sha, n.ende, "gruen"].join(" ") ? n : undefined;
    } catch {
        return undefined;
    }
}
