import { describe, expect, it } from "vitest";
import { beendeBaum, starteNebenher } from "../../../scripts/dev/nebenher.ts";

/**
 * Ein Prozess neben den synchronen Schritten eines Laufs (`scripts/dev/nebenher.ts`, WI-0224). Problemfälle: viel Ausgabe darf den Prozess
 * nicht anhalten, während der Aufrufer die Ereignisschleife blockiert (eine volle Pipe täte es); der Status kommt an; ein Abbruch beendet
 * auch die Kinder; ein Prozess, der nicht startet, ist ein Ergebnis, kein Absturz.
 */
const node = process.execPath;
const hier = process.cwd();

/** Blockiert die Ereignisschleife, wie es `spawnSync` in `vor-dem-push` tut. */
function blockiere(ms: number): void {
    const bis = Date.now() + ms;
    while (Date.now() < bis) {
        // absichtlich: die Schleife steht
    }
}

describe("starteNebenher", () => {
    it("🔴 viel Ausgabe füllt keine Pipe: der Prozess endet, obwohl der Aufrufer die Schleife blockiert", async () => {
        const lauf = starteNebenher({
            programm: node,
            args: [
                "-e",
                "for (let i = 0; i < 40000; i++) process.stdout.write('zeile ' + i + '\\n'); process.stderr.write('fehler\\n');",
            ],
            cwd: hier,
            env: process.env,
        });
        blockiere(1500);
        const e = await lauf.fertig;
        expect(e.status).toBe(0);
        expect(e.text).toContain("zeile 39999");
        expect(e.text).toContain("fehler");
        expect(e.text.length, "mehr als eine Pipe fasst (64 KB)").toBeGreaterThan(200_000);
    });

    it("🔴 die Dauer ist die des Prozesses, nicht die Zeit bis der Aufrufer die Schleife freigibt", async () => {
        const lauf = starteNebenher({
            programm: node,
            args: ["-e", "setTimeout(() => process.stdout.write('fertig\\n'), 300)"],
            cwd: hier,
            env: process.env,
        });
        blockiere(4000);
        const e = await lauf.fertig;
        expect(e.text).toContain("fertig");
        expect(e.dauerSekunden, "der Prozess war nach rund einer Sekunde fertig, nicht nach vier").toBeLessThanOrEqual(
            2,
        );
    });

    it("der Exit-Status kommt an", async () => {
        const lauf = starteNebenher({ programm: node, args: ["-e", "process.exit(3)"], cwd: hier, env: process.env });
        expect((await lauf.fertig).status).toBe(3);
    });

    it("🔴 ein Abbruch beendet den Prozess samt Kind; danach ist `fertig` erfüllt", async () => {
        // Der Elternprozess startet ein Kind, schreibt dessen PID und wartet.
        const code =
            "const k = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" +
            "process.stdout.write('KIND ' + k.pid + '\\n'); setInterval(() => {}, 1000);";
        const lauf = starteNebenher({ programm: node, args: ["-e", code], cwd: hier, env: process.env });
        await new Promise((erfuellt) => setTimeout(erfuellt, 2000));
        lauf.abbrechen();
        const e = await lauf.fertig;
        const kindPid = Number(/KIND (\d+)/.exec(e.text)?.[1]);
        expect(kindPid, "das Kind hat seine PID gemeldet").toBeGreaterThan(0);
        const lebtNoch = (): boolean => {
            try {
                process.kill(kindPid, 0);
                return true;
            } catch {
                return false;
            }
        };
        // Das Beenden braucht einen Augenblick (Linux: das Signal an die Gruppe, Windows: taskkill): bis zu fünf Sekunden warten.
        for (let i = 0; i < 50 && lebtNoch(); i += 1) await new Promise((erfuellt) => setTimeout(erfuellt, 100));
        const lebt = lebtNoch();
        if (lebt) beendeBaum(kindPid);
        expect(lebt, "das Kind lebt nicht mehr").toBe(false);
    });

    it("ein Programm, das es nicht gibt, endet mit Status 1 statt mit einem Absturz", async () => {
        const lauf = starteNebenher({
            programm: "gibt-es-nicht-avesmaps3d",
            args: [],
            cwd: hier,
            env: process.env,
        });
        expect((await lauf.fertig).status).toBe(1);
    });

    it("abbrechen nach dem Ende ist harmlos", async () => {
        const lauf = starteNebenher({ programm: node, args: ["-e", "0"], cwd: hier, env: process.env });
        await lauf.fertig;
        expect(() => lauf.abbrechen()).not.toThrow();
    });
});
