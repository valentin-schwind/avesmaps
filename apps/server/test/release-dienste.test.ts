import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARTIN_STANDARD, findeMartin, martinArgumente, starteMartin } from "../../../scripts/dev/release-dienste.ts";
import { ES_WACH, starteWachhalten, wachhaltenArgumente, wachhaltenSkript } from "../../../scripts/dev/release-wach.ts";

/**
 * Hilfsdienste des Release-Runners (WI-0248 R1): ein eigener Martin gegen den Korpus (nie der auf 3010) und das Wachhalten des Rechners.
 * Problemfälle: fehlende Martin-Datei; Martin endet oder antwortet nie (rot mit Protokollende, kein Prozess bleibt); Wachhalten endet mit dem
 * Runner und hinterlässt nichts. Martin wird durch ein kleines Node-Programm ersetzt, das nur die Argumente und `/health` kennt.
 */
const lebt = (pid: number | undefined): boolean => {
    if (pid === undefined) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};
const warteBis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
        if (bedingung()) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return bedingung();
};
const freierPort = (): Promise<number> =>
    new Promise((erfuellt, abgelehnt) => {
        const s = net.createServer();
        s.once("error", abgelehnt);
        s.listen(0, "127.0.0.1", () => {
            const a = s.address();
            s.close(() => (typeof a === "object" && a !== null ? erfuellt(a.port) : abgelehnt(new Error("kein Port"))));
        });
    });
const lauscht = (port: number): Promise<boolean> =>
    new Promise((erfuellt) => {
        const v = net.connect({ host: "127.0.0.1", port });
        v.once("connect", () => {
            v.destroy();
            erfuellt(true);
        });
        v.once("error", () => erfuellt(false));
    });

describe("findeMartin", () => {
    it("MARTIN_BIN gewinnt, wenn die Datei existiert", () => {
        expect(findeMartin({ MARTIN_BIN: "M/martin", PATH: "" }, (p) => p === "M/martin")).toBe("M/martin");
    });

    it("🔴 sonst der Windows-Standard, sonst der Suchpfad, sonst undefined (der Lauf ist dann rot)", () => {
        expect(findeMartin({ MARTIN_BIN: "M/fehlt", PATH: "" }, (p) => p === MARTIN_STANDARD)).toBe(MARTIN_STANDARD);
        const imPfad = findeMartin({ PATH: ["A", "B"].join(process.platform === "win32" ? ";" : ":") }, (p) =>
            p.replace(/\\/g, "/").startsWith("B/martin"),
        );
        expect(imPfad?.replace(/\\/g, "/")).toMatch(/^B\/martin/);
        expect(findeMartin({ PATH: "A" }, () => false)).toBeUndefined();
    });
});

describe("martinArgumente", () => {
    it("🔴 hört auf dem übergebenen Port von 127.0.0.1, ohne Kachelspeicher, gegen die übergebene Datenbank (nie die Entwicklungsdatenbank)", () => {
        expect(martinArgumente(4711, "postgres://x@127.0.0.1:5/db", undefined)).toEqual([
            "--listen-addresses",
            "127.0.0.1:4711",
            "--pool-size",
            "8",
            "--cache-size",
            "0",
            "postgres://x@127.0.0.1:5/db",
        ]);
        expect(martinArgumente(1, "u", "3")).toContain("3");
    });
});

describe("starteMartin", () => {
    const ersatz = (ordner: string): string => {
        const datei = join(ordner, "martin-ersatz.mjs");
        writeFileSync(
            datei,
            [
                'import http from "node:http";',
                'const i = process.argv.indexOf("--listen-addresses");',
                'const [host, port] = process.argv[i + 1].split(":");',
                'if (process.env.ERSATZ === "ende") { console.error("kaputt: keine Verbindung"); process.exit(3); }',
                'if (process.env.ERSATZ === "stumm") setInterval(() => {}, 1000);',
                'else http.createServer((q, r) => r.end(q.url === "/health" ? "OK" : "?")).listen(Number(port), host);',
            ].join("\n"),
        );
        return datei;
    };

    it("🔴 wartet auf /health, übergibt Port und Datenbank und beendet den Prozess samt Port", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "release-martin-"));
        try {
            const port = await freierPort();
            const dienst = await starteMartin({
                bin: process.execPath,
                vorArgumente: [ersatz(ordner)],
                port,
                url: "postgres://x@127.0.0.1:5/db",
                log: join(ordner, "martin.log"),
                env: process.env,
                bereitMs: 20_000,
            });
            expect(await lauscht(port)).toBe(true);
            expect(lebt(dienst.pid)).toBe(true);
            dienst.beende();
            dienst.beende();
            expect(await warteBis(() => !lebt(dienst.pid), 10_000), "Prozess weg").toBe(true);
            expect(await lauscht(port), "Port frei").toBe(false);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 endet Martin vor der Bereitschaft, ist der Lauf rot und die Meldung nennt das Protokollende", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "release-martin-"));
        try {
            await expect(
                starteMartin({
                    bin: process.execPath,
                    vorArgumente: [ersatz(ordner)],
                    port: await freierPort(),
                    url: "u",
                    log: join(ordner, "martin.log"),
                    env: { ...process.env, ERSATZ: "ende" },
                    bereitMs: 20_000,
                }),
            ).rejects.toThrow(/endete vor der Bereitschaft \(Exit 3\).*kaputt: keine Verbindung/s);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 antwortet Martin nie, läuft die Zeit ab, der Prozess wird beendet und nichts bleibt zurück", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "release-martin-"));
        try {
            const log = join(ordner, "martin.log");
            await expect(
                starteMartin({
                    bin: process.execPath,
                    vorArgumente: [ersatz(ordner)],
                    port: await freierPort(),
                    url: "u",
                    log,
                    env: { ...process.env, ERSATZ: "stumm" },
                    bereitMs: 1200,
                }),
            ).rejects.toThrow(/antwortete in \d+ s nicht auf \/health/);
            expect(readFileSync(log, "utf8")).toBe("");
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("eine fehlende Programmdatei ist ein Satz, kein Absturz", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "release-martin-"));
        try {
            await expect(
                starteMartin({
                    bin: join(ordner, "gibt-es-nicht.exe"),
                    port: await freierPort(),
                    url: "u",
                    log: join(ordner, "martin.log"),
                    env: process.env,
                    bereitMs: 5000,
                }),
            ).rejects.toThrow("Martin lässt sich nicht starten");
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

describe("Wachhalten", () => {
    it("🔴 das Skript hält ES_CONTINUOUS | ES_SYSTEM_REQUIRED und wartet auf genau den Runner-Prozess", () => {
        expect(ES_WACH).toBe(0x80000001);
        const skript = wachhaltenSkript(4242);
        expect(skript).toContain("SetThreadExecutionState");
        expect(skript).toContain("[uint32]2147483649");
        expect(skript).toContain("Wait-Process -Id 4242");
    });

    it("lehnt eine ungültige Prozesskennung ab (kein Einschleusen in das Skript)", () => {
        expect(() => wachhaltenSkript(0)).toThrow();
        expect(() => wachhaltenSkript(1.5)).toThrow();
        // @ts-expect-error absichtlich falscher Typ
        expect(() => wachhaltenSkript("1; calc")).toThrow();
    });

    it("die Argumente tragen das Skript kodiert (UTF-16LE, Base64) in einem versteckten, nicht interaktiven PowerShell ohne Profil", () => {
        const argumente = wachhaltenArgumente(77);
        expect(argumente).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden"]));
        const kodiert = argumente[argumente.indexOf("-EncodedCommand") + 1] as string;
        expect(Buffer.from(kodiert, "base64").toString("utf16le")).toBe(wachhaltenSkript(77));
    });

    it("auf anderen Plattformen als Windows geschieht nichts", () => {
        expect(starteWachhalten(1, "linux")).toBeUndefined();
        expect(starteWachhalten(1, "darwin")).toBeUndefined();
    });

    // Echter Kindprozess: nur unter Windows (dort hält er die Anforderung). `powercfg /requests` braucht Adminrechte, der Test prüft den Lebenslauf.
    it.runIf(process.platform === "win32")(
        "🔴 lebt, solange der Runner lebt, endet mit ihm und endet auf Zuruf",
        { timeout: 120_000 },
        async () => {
            const runner = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
                stdio: "ignore",
                windowsHide: true,
            });
            const wach = starteWachhalten(runner.pid);
            const zweiter = starteWachhalten(runner.pid);
            try {
                expect(wach?.pid).toBeGreaterThan(0);
                await new Promise((r) => setTimeout(r, 4000));
                expect(lebt(wach?.pid), "wach, solange der Runner lebt").toBe(true);

                zweiter?.beende();
                expect(await warteBis(() => !lebt(zweiter?.pid), 15_000), "endet auf Zuruf").toBe(true);

                runner.kill();
                expect(await warteBis(() => !lebt(wach?.pid), 30_000), "endet mit dem Runner").toBe(true);
            } finally {
                runner.kill();
                wach?.beende();
                zweiter?.beende();
            }
        },
    );
});
