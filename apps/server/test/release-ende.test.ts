import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    beendeHart,
    beendeKinder,
    gibSperreFrei,
    type HartesEnde,
    type KinderWerkzeug,
} from "../../../scripts/dev/release-ende.ts";

/**
 * Das harte Ende des Runners (`scripts/dev/release-ende.ts`, WI-0248): Abbruch über die Karte und Gesamtzeit.
 *
 * 🔴 Anlass (2026-10-24, Abbruch von Lauf 1d1e366a5): Das harte Ende beendete zuletzt den EIGENEN Prozessbaum und starb damit vor dem Freigeben der
 * Sperre `.release-runs\aktiv`. Die Sperre blieb stehen, der nächste Start wurde abgewiesen. Die Sätze, auf die es ankommt:
 * 1. **Die Sperre geht weg**, und zwar nach dem Endzustand, den Diensten, den Kindern und der Notiz, nie davor.
 * 2. **Nur die Kinder enden, nie der Runner selbst**, solange sich bestätigen lässt, dass sie weg sind. Sonst gilt der Notbehelf von früher
 *    (eigener Baum, Sperre bleibt), weil ein lebendes Kind unter einer freien Sperre schlimmer wäre als eine tote Sperre.
 * 3. **Jeder Schritt darf scheitern**, ohne die folgenden zu verhindern.
 */

describe("Sperre freigeben", () => {
    let ordner = "";
    beforeEach(() => {
        ordner = mkdtempSync(join(tmpdir(), "release-ende-"));
    });
    afterEach(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    it("nimmt den leeren Ordner weg; fehlt er schon, ist das auch gut", () => {
        const sperre = join(ordner, "aktiv");
        mkdirSync(sperre);
        expect(gibSperreFrei(sperre)).toBe(true);
        expect(existsSync(sperre)).toBe(false);
        expect(gibSperreFrei(sperre), "zweimal ist harmlos").toBe(true);
    });

    it("🔴 nie rekursiv: Liegt etwas darin, bleibt die Sperre stehen und es gibt `false`", () => {
        const sperre = join(ordner, "aktiv");
        mkdirSync(sperre);
        writeFileSync(join(sperre, "fremd.txt"), "gehört nicht dem Runner");
        expect(gibSperreFrei(sperre)).toBe(false);
        expect(existsSync(join(sperre, "fremd.txt"))).toBe(true);
    });
});

describe("Kinder beenden", () => {
    function werkzeug(listen: (number[] | undefined)[], log: string[]): KinderWerkzeug {
        let nr = 0;
        return {
            liste: (pid) => {
                log.push(`liste ${String(pid)}`);
                const antwort = listen[Math.min(nr, listen.length - 1)];
                nr += 1;
                return antwort;
            },
            beende: (pid) => void log.push(`beende ${String(pid)}`),
        };
    }

    it("🔴 beendet jedes Kind, nie den Runner selbst, und prüft danach mit einer zweiten Liste", () => {
        const log: string[] = [];
        const ergebnis = beendeKinder(500, werkzeug([[11, 12], []], log));
        expect(ergebnis).toEqual({ beendet: [11, 12], alleWeg: true });
        expect(log).toEqual(["liste 500", "beende 11", "beende 12", "liste 500"]);
        expect(log).not.toContain("beende 500");
    });

    it("lebt danach noch ein Kind, oder lässt sich die Liste nicht lesen, sind sie NICHT bestätigt weg", () => {
        expect(beendeKinder(500, werkzeug([[11], [11]], [])).alleWeg).toBe(false);
        expect(beendeKinder(500, werkzeug([[11], undefined], [])).alleWeg).toBe(false);
        const log: string[] = [];
        expect(beendeKinder(500, werkzeug([undefined], log))).toEqual({ beendet: [], alleWeg: false });
        expect(log, "ohne Liste wird nichts geraten und nichts beendet").toEqual(["liste 500"]);
    });

    it("ohne Kinder ist alles gut; ein Werkzeug, das wirft, macht daraus „nicht bestätigt“ statt eines Absturzes", () => {
        expect(beendeKinder(500, werkzeug([[], []], []))).toEqual({ beendet: [], alleWeg: true });
        const wirft: KinderWerkzeug = {
            liste: () => {
                throw new Error("WMI weg");
            },
            beende: () => undefined,
        };
        expect(beendeKinder(500, wirft)).toEqual({ beendet: [], alleWeg: false });
    });
});

describe("Das harte Ende in seiner Reihenfolge", () => {
    function ende(log: string[], zusatz: Partial<HartesEnde> = {}): HartesEnde {
        return {
            schreibeEnde: () => void log.push("ende"),
            dienste: [() => void log.push("martin"), () => void log.push("cluster")],
            kinder: () => {
                log.push("kinder");
                return true;
            },
            notiz: () => void log.push("notiz"),
            sperreFrei: () => void log.push("sperre"),
            selbstBeenden: () => void log.push("selbst"),
            verlasse: (code) => void log.push(`exit ${String(code)}`),
            ...zusatz,
        };
    }

    it("🔴 erst der Endzustand, die Dienste, die Kinder und die Notiz, dann die Sperre, dann endet der Runner selbst", () => {
        const log: string[] = [];
        expect(beendeHart(ende(log))).toBe(true);
        expect(log).toEqual(["ende", "martin", "cluster", "kinder", "notiz", "sperre", "exit 1"]);
    });

    it("🔴 sind die Kinder nicht bestätigt weg, bleibt die Sperre stehen und der eigene Baum geht mit (Notbehelf)", () => {
        const log: string[] = [];
        const kinder = (): boolean => {
            log.push("kinder");
            return false;
        };
        expect(beendeHart(ende(log, { kinder }))).toBe(false);
        expect(log).toEqual(["ende", "martin", "cluster", "kinder", "notiz", "selbst", "exit 1"]);
        expect(log).not.toContain("sperre");
    });

    it("🔴 jeder Schritt darf scheitern, ohne die folgenden zu verhindern: Die Sperre geht trotzdem weg", () => {
        const log: string[] = [];
        const wirft = (name: string) => (): void => {
            log.push(name);
            throw new Error(name);
        };
        beendeHart(
            ende(log, {
                schreibeEnde: wirft("ende"),
                dienste: [wirft("martin"), () => void log.push("cluster")],
                notiz: wirft("notiz"),
            }),
        );
        expect(log).toEqual(["ende", "martin", "cluster", "kinder", "notiz", "sperre", "exit 1"]);
    });

    it("wirft die Kinder-Suche selbst, gilt das wie „nicht bestätigt“", () => {
        const log: string[] = [];
        beendeHart(
            ende(log, {
                kinder: () => {
                    throw new Error("PowerShell fehlt");
                },
            }),
        );
        expect(log).toEqual(["ende", "martin", "cluster", "notiz", "selbst", "exit 1"]);
    });
});

// Das echte Ende mit echten Prozessen (Windows, wo der Runner läuft): ein Runner-Ersatz legt die Sperre an, startet ein langlebiges Kind, schreibt den Endzustand und
// ruft das harte Ende. Danach muss die Sperre weg sein (der Runner hat sich also NICHT selbst vorher beendet), der Endzustand stehen und das Kind tot sein.
describe.skipIf(process.platform !== "win32")("Das harte Ende mit echten Prozessen (Windows)", () => {
    let ordner = "";
    beforeEach(() => {
        ordner = mkdtempSync(join(tmpdir(), "release-ende-echt-"));
    });
    afterEach(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    it("🔴 Abbruch räumt auf: Sperre weg, Endzustand geschrieben, Kind tot; der Ersatz-Runner endet mit Exit 1 durch sich selbst", () => {
        const modul = pathToFileURL(
            join(import.meta.dirname, "..", "..", "..", "scripts", "dev", "release-ende.ts"),
        ).href;
        const programm = `
            import { spawn } from "node:child_process";
            import { mkdirSync, writeFileSync } from "node:fs";
            import { beendeHart, beendeKinder, gibSperreFrei } from ${JSON.stringify(modul)};
            const e = process.env;
            mkdirSync(e.LOCK);
            const kind = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
            writeFileSync(e.KIND_PID, String(kind.pid));
            beendeHart({
                schreibeEnde: () => writeFileSync(e.STATUS, JSON.stringify({ status: "abgebrochen", ende: new Date().toISOString() })),
                dienste: [],
                kinder: () => beendeKinder(process.pid).alleWeg,
                notiz: () => {},
                sperreFrei: () => { gibSperreFrei(e.LOCK); },
                selbstBeenden: () => writeFileSync(e.SELBST, "ja"),
                verlasse: (code) => process.exit(code),
            });
        `;
        const lock = join(ordner, "aktiv");
        const status = join(ordner, "status.json");
        const kindPid = join(ordner, "kind.pid");
        const selbst = join(ordner, "selbst.txt");
        const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", programm], {
            env: { ...process.env, LOCK: lock, STATUS: status, KIND_PID: kindPid, SELBST: selbst },
            encoding: "utf8",
            timeout: 90_000,
            windowsHide: true,
        });
        expect(lauf.error, lauf.stderr).toBeUndefined();
        expect(lauf.status, lauf.stderr).toBe(1);
        expect(existsSync(selbst), "kein Notbehelf: die Kinder waren bestätigt weg").toBe(false);
        expect(existsSync(lock), "die Sperre ist weg: Der Runner lebte lange genug, sie freizugeben").toBe(false);
        expect(JSON.parse(readFileSync(status, "utf8"))).toMatchObject({ status: "abgebrochen" });
        const pid = Number(readFileSync(kindPid, "utf8"));
        expect(Number.isInteger(pid) && pid > 0).toBe(true);
        let lebt = true;
        try {
            process.kill(pid, 0);
        } catch {
            lebt = false;
        }
        expect(lebt, `Das Kind ${String(pid)} lebt noch`).toBe(false);
    }, 120_000);
});
