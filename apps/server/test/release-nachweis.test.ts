import { describe, expect, it } from "vitest";
import {
    releaseBelege,
    releaseGruen,
    releaseKlassen,
    releaseNotiz,
    releaseProfilAus,
    releaseProzess,
    RELEASE_PROFILE,
    RELEASE_KLASSEN,
    RELEASE_BELEGE,
    type ReleaseNachweis,
} from "../../../scripts/dev/release-nachweis.ts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const sha = "a".repeat(40),
    umgebung = "b".repeat(64);
const gut = (): ReleaseNachweis => ({
    version: 3,
    belege: Object.fromEntries(RELEASE_BELEGE.map((p) => [p, "e".repeat(64)])),
    sha,
    umgebung,
    start: new Date(Date.now() - 1000).toISOString(),
    ende: new Date().toISOString(),
    status: "gruen",
    teile: RELEASE_KLASSEN.map((klasse) => ({ klasse, sha, exit: 0, status: "gruen" })),
});
describe("Release-Nachweis", () => {
    it("akzeptiert ausschließlich vollständige gleichwertige Nachweise", () => {
        expect(releaseGruen(gut(), sha, umgebung)).toBe(true);
        expect(releaseNotiz(gut())).toContain("release-nachweis-v3");
    });
    it.each(["fehlt", "rot", "abgebrochen", "timeout", "mischstand", "alt", "doppelt", "umgebung"])(
        "verweigert %s",
        (fall) => {
            const n = gut();
            if (fall === "fehlt") n.teile.pop();
            if (fall === "rot") n.teile[0]!.exit = 1;
            if (fall === "abgebrochen" || fall === "timeout") n.status = fall;
            if (fall === "mischstand") n.teile[1]!.sha = "c".repeat(40);
            if (fall === "alt") Object.assign(n, { version: 2 });
            if (fall === "doppelt") n.teile[1]!.klasse = "voll";
            if (fall === "umgebung") n.umgebung = "d".repeat(64);
            expect(releaseGruen(n, sha, umgebung)).toBe(false);
        },
    );
    it("🔴 Prüfprofil B (Betreiber 2026-10-24): grün mit voll und kern; ohne kern, mit fremdem Profil oder als B mit allen Teilen nicht", () => {
        const b = (): ReleaseNachweis => ({
            ...gut(),
            profil: "B",
            belege: Object.fromEntries(releaseBelege("B").map((p) => [p, "e".repeat(64)])),
            teile: releaseKlassen("B").map((klasse) => ({ klasse, sha, exit: 0, status: "gruen" })),
        });
        expect(releaseBelege("B")).toEqual(["vitest.json", "kern.json"]);
        expect(releaseGruen(b(), sha, umgebung)).toBe(true);
        expect(releaseNotiz(b())).toContain('"profil":"B"');
        const ohneKern = b();
        ohneKern.teile.pop();
        expect(releaseGruen(ohneKern, sha, umgebung)).toBe(false);
        expect(releaseGruen({ ...b(), profil: "X" as "B" }, sha, umgebung)).toBe(false);
        expect(releaseGruen({ ...gut(), profil: "B" }, sha, umgebung), "die fünf Teile von voll sind kein B").toBe(
            false,
        );
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "voll" })).toBe("voll");
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "B" })).toBe("B");
    });
    it("🔴 Release-Tor (WI-0264, Vali 2026-10-30): Vorgabe; grün mit genau bau, daten und kern-echt, sonst nicht", () => {
        // Vorgabe ist das Tor; B und voll nur auf ausdrücklichen Auftrag, ein unbekannter Wert wird nie lockerer oder strenger als das Tor.
        expect(releaseProfilAus({})).toBe("tor");
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "" })).toBe("tor");
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "tor" })).toBe("tor");
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "b" })).toBe("tor");
        expect(releaseProfilAus({ AVESMAPS_RELEASE_PROFIL: "alles" })).toBe("tor");
        expect(RELEASE_PROFILE.tor).toEqual(["bau", "daten", "kern-echt"]);
        expect(releaseBelege("tor")).toEqual(["bau.json", "daten.json", "kern-echt.json"]);
        const t = (): ReleaseNachweis => ({
            ...gut(),
            profil: "tor",
            belege: Object.fromEntries(releaseBelege("tor").map((p) => [p, "e".repeat(64)])),
            teile: releaseKlassen("tor").map((klasse) => ({ klasse, sha, exit: 0, status: "gruen" })),
        });
        expect(releaseGruen(t(), sha, umgebung)).toBe(true);
        expect(releaseNotiz(t())).toContain('"profil":"tor"');
        for (const fehlt of ["bau", "daten", "kern-echt"]) {
            const n = t();
            n.teile = n.teile.filter((x) => x.klasse !== fehlt);
            expect(releaseGruen(n, sha, umgebung), `ohne ${fehlt}`).toBe(false);
            const o = t();
            o.belege = Object.fromEntries(Object.entries(o.belege).filter(([datei]) => datei !== `${fehlt}.json`));
            expect(releaseGruen(o, sha, umgebung), `ohne Beleg ${fehlt}`).toBe(false);
            const r = t();
            r.teile.find((x) => x.klasse === fehlt)!.status = "rot";
            expect(releaseGruen(r, sha, umgebung), `${fehlt} rot`).toBe(false);
        }
        // Teile eines anderen Profils sind kein Tor: weder B noch voll, noch ein Tor mit zusätzlichem Vitest.
        expect(releaseGruen({ ...gut(), profil: "tor" }, sha, umgebung)).toBe(false);
        expect(
            releaseGruen(
                {
                    ...t(),
                    teile: [...t().teile, { klasse: "voll", sha, exit: 0, status: "gruen" }],
                },
                sha,
                umgebung,
            ),
        ).toBe(false);
        // Ein Name, den nur die Prototypkette kennt, ist kein Profil.
        expect(releaseGruen({ ...t(), profil: "toString" as "tor" }, sha, umgebung)).toBe(false);
        expect(releaseGruen({ ...t(), profil: "__proto__" as "tor" }, sha, umgebung)).toBe(false);
        // Ohne Profilfeld (Notizen von vorher) gilt weiter voll.
        expect(releaseGruen(gut(), sha, umgebung)).toBe(true);
    });
    it("führt einen endlichen Rechnerprozess aus und meldet den Exitcode", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "release-test-"));
        expect(
            await releaseProzess(process.execPath, ["-e", "process.exit(7)"], {
                cwd,
                env: process.env,
                log: join(cwd, "lauf.log"),
                timeoutMs: 2000,
            }),
        ).toBe(7);
    });
    it("bricht einen hängenden Prozess am Zeitlimit ab", async () => {
        const cwd = mkdtempSync(join(tmpdir(), "release-timeout-"));
        await expect(
            releaseProzess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
                cwd,
                env: process.env,
                log: join(cwd, "lauf.log"),
                timeoutMs: 200,
            }),
        ).rejects.toThrow("timeout");
    });
});

it("beendet beim Timeout auch einen Enkelprozess", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "release-tree-"));
    const code =
        'const {spawn}=require("node:child_process"); const fs=require("node:fs"); const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); fs.writeFileSync("enkel.pid",String(c.pid));setInterval(()=>{},1000);';
    await expect(
        releaseProzess(process.execPath, ["-e", code], {
            cwd,
            env: process.env,
            log: join(cwd, "lauf.log"),
            timeoutMs: 700,
        }),
    ).rejects.toThrow("timeout");
    const pid = Number(readFileSync(join(cwd, "enkel.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
});
it("Starter endet unabhängig vom Worker; ungültiger Kandidat liefert roten Status", async () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const fake = "f".repeat(40);
    const beginn = Date.now();
    const ausgabe = execFileSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(repo, "scripts/dev/release-start.ps1"),
            "-Commit",
            fake,
            "-Fixtures",
            tmpdir(),
        ],
        { cwd: repo, encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    expect(ausgabe).toContain("Release-Auftrag gestartet");
    await new Promise((r) => setTimeout(r, 1500));
    const datei = join(repo, ".release-runs", fake, "status.json");
    expect(existsSync(datei)).toBe(true);
    const status = JSON.parse(readFileSync(datei, "utf8"));
    expect(Date.parse(status.start)).toBeGreaterThanOrEqual(beginn);
    expect(status.status).toBe("rot");
    expect(status.teile).toEqual([]);
});
