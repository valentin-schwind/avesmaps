import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    releaseAusNotiz,
    releaseNotiz,
    RELEASE_KLASSEN,
    RELEASE_BELEGE,
    type ReleaseNachweis,
} from "../../../scripts/dev/release-nachweis.ts";
const sha = "a".repeat(40);
const n = (): ReleaseNachweis => ({
    version: 3,
    sha,
    umgebung: "b".repeat(64),
    start: "2026-10-20T00:00:00.000Z",
    ende: "2026-10-20T01:00:00.000Z",
    status: "gruen",
    teile: RELEASE_KLASSEN.map((klasse) => ({ sha, klasse, status: "gruen", exit: 0 })),
    belege: Object.fromEntries(RELEASE_BELEGE.map((p) => [p, "c".repeat(64)])),
});
describe("Production-Notizvertrag", () => {
    it("Stage-Leser bleibt bei Fetchfehler, fehlender und alter Notiz geschlossen", () => {
        const repo = fileURLToPath(new URL("../../../", import.meta.url));
        const stand = readFileSync(`${repo}/ops/production/freigabe-stand.sh`, "utf8");
        const block = stand.slice(stand.indexOf("s_urteil=fehlt"), stand.indexOf("s_zeit_de="));
        const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
        for (const [fetch, notiz, erwartet] of [
            ["nein", releaseNotiz(n()), "fehlt"],
            ["ja", "", "fehlt"],
            ["ja", `${sha} ${n().ende} gruen`, "fehlt"],
            ["ja", releaseNotiz(n()), "gruen"],
        ]) {
            const code =
                'git() { case "$*" in *fetch*) [ "$TEST_FETCH" = ja ] ;; *notes*) printf "%s\\n" "$TEST_NOTIZ" ;; esac; };\n' +
                block +
                '\nprintf "%s" "$s_urteil"';
            const r = spawnSync(bash, ["-c", code], {
                encoding: "utf8",
                env: { ...process.env, CLONE: repo, want: sha, TEST_FETCH: fetch, TEST_NOTIZ: notiz },
            });
            expect(r.status).toBe(0);
            expect(r.stdout).toBe(erwartet);
        }
    });
    describe("🔴 Zusätze je Teil (WI-0248: Name und Beleg) ändern die Aussage nicht", () => {
        /** Dieselbe Aussage wie `n()`, aber jeder Teil trägt seinen Beleg und die Browserteile ihren Namen (so schreibt sie der Runner seit der Einteilung nach Thema). */
        const mitZusaetzen = (): ReleaseNachweis => ({
            ...n(),
            teile: RELEASE_KLASSEN.map((klasse) => ({
                sha,
                klasse,
                status: "gruen",
                exit: 0,
                beleg: "f".repeat(64),
                ...(klasse === "voll" ? {} : { name: `Browserteil ${klasse.slice(-1)}: Orte, Wege, Kraftlinien` }),
            })),
        });

        it("der zentrale Leser nimmt den Nachweis mit Zusätzen an und gibt dieselbe Aussage zurück", () => {
            const text = releaseNotiz(mitZusaetzen());
            expect(text.length).toBeLessThan(64 * 1024);
            const gelesen = releaseAusNotiz(text, sha);
            expect(gelesen?.sha).toBe(sha);
            expect(gelesen?.teile.map((t) => t.klasse)).toEqual([...RELEASE_KLASSEN]);
            expect(gelesen?.teile.find((t) => t.klasse === "browser-2")?.name).toContain("Browserteil 2");
            // Mit und ohne Zusätze gilt dieselbe Aussage: gültig.
            expect(releaseAusNotiz(releaseNotiz(n()), sha)?.sha).toBe(sha);
        });

        it.each([
            "alt",
            "version2",
            "mischstand",
            "teilfehlt",
            "timeout",
            "belegfehlt",
            "rot",
            "doppelt",
            "falscheSha",
        ])("und schließt weiterhin: %s", (fall) => {
            const d = mitZusaetzen();
            if (fall === "version2") Object.assign(d, { version: 2 });
            if (fall === "mischstand") d.teile[1]!.sha = "d".repeat(40);
            if (fall === "teilfehlt") d.teile.pop();
            if (fall === "timeout") d.status = "timeout";
            if (fall === "belegfehlt") delete d.belege["vitest.json"];
            if (fall === "rot") Object.assign(d.teile[2]!, { status: "rot", exit: 1 });
            if (fall === "doppelt") d.teile.push({ ...d.teile[2]! });
            let text = `${sha} ${d.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(d)}\n`;
            if (fall === "alt") text = `${sha} ${d.ende} gruen\n`;
            if (fall === "falscheSha") text = text.replace(sha, "e".repeat(40));
            expect(releaseAusNotiz(text, sha)).toBeUndefined();
        });

        it("die Kommandozeile von Claudios Prüfer liefert das Ende wie bisher, mit Zusätzen und ohne", () => {
            const cli = fileURLToPath(new URL("../../../scripts/dev/release-notiz.ts", import.meta.url));
            for (const nachweis of [n(), mitZusaetzen()]) {
                const r = spawnSync(process.execPath, [cli, sha], { input: releaseNotiz(nachweis), encoding: "utf8" });
                expect(r.status).toBe(0);
                expect(r.stdout.trim()).toBe(nachweis.ende);
            }
            const rot = mitZusaetzen();
            Object.assign(rot.teile[3]!, { status: "rot", exit: 1 });
            const r = spawnSync(process.execPath, [cli, sha], {
                input: `${sha} ${rot.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(rot)}\n`,
                encoding: "utf8",
            });
            expect(r.status).toBe(1);
            expect(r.stdout).toBe("");
        });

        it("der Stage-Leser auf dem VPS (freigabe-stand.sh) liest den Nachweis mit Zusätzen als grün, einen mit rotem Teil nicht", () => {
            const repo = fileURLToPath(new URL("../../../", import.meta.url));
            const stand = readFileSync(`${repo}/ops/production/freigabe-stand.sh`, "utf8");
            const block = stand.slice(stand.indexOf("s_urteil=fehlt"), stand.indexOf("s_zeit_de="));
            const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
            const rot = mitZusaetzen();
            Object.assign(rot.teile[3]!, { status: "rot", exit: 1 });
            for (const [notiz, erwartet] of [
                [releaseNotiz(mitZusaetzen()), "gruen"],
                [`${sha} ${rot.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(rot)}\n`, "fehlt"],
            ] as const) {
                const code =
                    'git() { case "$*" in *fetch*) true ;; *notes*) printf "%s\n" "$TEST_NOTIZ" ;; esac; };\n' +
                    block +
                    '\nprintf "%s" "$s_urteil"';
                const r = spawnSync(bash, ["-c", code], {
                    encoding: "utf8",
                    env: { ...process.env, CLONE: repo, want: sha, TEST_NOTIZ: notiz },
                });
                expect(r.status).toBe(0);
                expect(r.stdout).toBe(erwartet);
            }
        });
    });

    it("akzeptiert vollständige Version 3 und dieselbe SHA", () =>
        expect(releaseAusNotiz(releaseNotiz(n()), sha)?.sha).toBe(sha));
    it.each([
        "alt",
        "version2",
        "mischstand",
        "teilfehlt",
        "timeout",
        "belegfehlt",
        "falscherkopf",
        "ungueltig",
        "doppelterbeleg",
    ])("schließt %s", (fall) => {
        const d = n();
        let text: string;
        if (fall === "version2") Object.assign(d, { version: 2 });
        if (fall === "mischstand") d.teile[1]!.sha = "d".repeat(40);
        if (fall === "teilfehlt") d.teile.pop();
        if (fall === "timeout") d.status = "timeout";
        if (fall === "belegfehlt") delete d.belege["vitest.json"];
        text = `${sha} ${d.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(d)}\n`;
        if (fall === "alt") text = `${sha} ${d.ende} gruen\n`;
        if (fall === "falscherkopf") text = text.replace(sha, "e".repeat(40));
        if (fall === "ungueltig") text = "keine Notiz";
        if (fall === "doppelterbeleg") text += text;
        expect(releaseAusNotiz(text, sha)).toBeUndefined();
    });
    it("CLI liefert ohne gültige Notiz Exit 1 und kein positives Signal", () => {
        const cli = fileURLToPath(new URL("../../../scripts/dev/release-notiz.ts", import.meta.url));
        const r = spawnSync(process.execPath, [cli, sha], {
            input: `${sha} 2026-10-20T00:00:00.000Z gruen`,
            encoding: "utf8",
        });
        expect(r.status).toBe(1);
        expect(r.stdout).toBe("");
        const gruen = spawnSync(process.execPath, [cli, sha], { input: releaseNotiz(n()), encoding: "utf8" });
        expect(gruen.status).toBe(0);
        expect(gruen.stdout.trim()).toBe(n().ende);
    });
    it("Stage- und Kandidatenpfad sowie Abholer verwenden den zentralen Leser", () => {
        const lies = (p: string) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), "utf8");
        const stand = lies("ops/production/freigabe-stand.sh");
        expect(stand).not.toContain("nicht_eingerichtet");
        expect(stand).toContain("release-notiz.ts");
        expect(lies("ops/production/freigabe-kandidat.sh")).toContain('release_nachweis "$repo" "$c"');
        expect(lies("ops/production/freigabe-abholer.sh")).toContain('! release_nachweis "$REPO" "$kfull"');
    });
});
