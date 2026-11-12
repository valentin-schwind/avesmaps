import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Der Commit-Wächter (WI-0185) in echten Wegwerf-Repositorien: ein origin, zwei Kopien, der Hook aus `scripts/git-hooks`.
 *
 * Geprüft wird genau der Fall, aus dem er entstand (eine Kopie mit altem Stand überschreibt eine Datei, die die andere auf
 * origin geändert hat), dazu die Fälle, die er nicht anhalten darf.
 */

const hooks = fileURLToPath(new URL("../../../scripts/git-hooks", import.meta.url));
const ordner: string[] = [];

function git(cwd: string, ...args: string[]) {
    const result = spawnSync(
        "git",
        ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
        {
            cwd,
            encoding: "utf8",
        },
    );
    return { status: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function muss(cwd: string, ...args: string[]) {
    const result = git(cwd, ...args);
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.out}`);
    return result.out;
}

/** origin mit zwei Dateien, Kopie A und Kopie B, beide mit dem Wächter. */
function aufbau() {
    const wurzel = mkdtempSync(join(tmpdir(), "commit-waechter-"));
    ordner.push(wurzel);
    const origin = join(wurzel, "origin.git");
    muss(wurzel, "init", "--bare", "-b", "master", origin);
    const a = join(wurzel, "a");
    muss(wurzel, "clone", "-q", origin, a);
    writeFileSync(join(a, "x.txt"), "eins\n");
    writeFileSync(join(a, "y.txt"), "eins\n");
    muss(a, "add", "x.txt", "y.txt");
    muss(a, "commit", "-q", "-m", "start");
    muss(a, "push", "-q", "origin", "HEAD:master");
    const b = join(wurzel, "b");
    muss(wurzel, "clone", "-q", origin, b);
    for (const kopie of [a, b]) muss(kopie, "config", "core.hooksPath", hooks);
    return { a, b };
}

/** A ändert x.txt auf origin; B holt nur die Referenz, nicht den Stand. */
function aAendertXAufOrigin(a: string, b: string) {
    writeFileSync(join(a, "x.txt"), "eins\nvon A\n");
    muss(a, "commit", "-q", "-am", "A ändert x");
    muss(a, "push", "-q", "origin", "HEAD:master");
    muss(b, "fetch", "-q", "origin");
}

afterEach(() => {
    for (const pfad of ordner.splice(0)) rmSync(pfad, { recursive: true, force: true });
});

describe("Commit-Wächter", () => {
    it("verweigert den Commit einer Datei, die origin seit dem eigenen Stand geändert hat", () => {
        const { a, b } = aufbau();
        aAendertXAufOrigin(a, b);
        writeFileSync(join(b, "x.txt"), "eins\nvon B\n");
        muss(b, "add", "x.txt");
        const versuch = git(b, "commit", "-m", "B überschreibt x");
        expect(versuch.status).not.toBe(0);
        expect(versuch.out).toContain("Commit-Wächter (WI-0185): Commit verweigert.");
        expect(versuch.out).toContain("  - x.txt");
    });

    it("verweigert auch `git commit -- pfad` ohne vorheriges add", () => {
        const { a, b } = aufbau();
        aAendertXAufOrigin(a, b);
        writeFileSync(join(b, "x.txt"), "eins\nvon B\n");
        const versuch = git(b, "commit", "-m", "B überschreibt x", "--", "x.txt");
        expect(versuch.status).not.toBe(0);
        expect(versuch.out).toContain("  - x.txt");
    });

    it("lässt eine Datei durch, die origin nicht geändert hat, auch bei altem Stand", () => {
        const { a, b } = aufbau();
        aAendertXAufOrigin(a, b);
        writeFileSync(join(b, "y.txt"), "eins\nvon B\n");
        expect(git(b, "commit", "-m", "B ändert y", "--", "y.txt").status).toBe(0);
    });

    it("lässt den Commit nach dem Holen des neuen Stands durch", () => {
        const { a, b } = aufbau();
        aAendertXAufOrigin(a, b);
        muss(b, "rebase", "-q", "origin/master");
        writeFileSync(join(b, "x.txt"), "eins\nvon A\nvon B\n");
        expect(git(b, "commit", "-m", "B ergänzt x", "--", "x.txt").status).toBe(0);
    });

    it("lässt einen abschließenden Merge durch", () => {
        const { a, b } = aufbau();
        writeFileSync(join(b, "y.txt"), "eins\nvon B\n");
        muss(b, "commit", "-q", "-m", "B ändert y", "--", "y.txt");
        aAendertXAufOrigin(a, b);
        expect(git(b, "merge", "--no-ff", "-m", "Merge origin", "origin/master").status).toBe(0);
    });

    it("lässt ohne origin/master alles durch", () => {
        const wurzel = mkdtempSync(join(tmpdir(), "commit-waechter-"));
        ordner.push(wurzel);
        muss(wurzel, "init", "-q", "-b", "master", "solo");
        const solo = join(wurzel, "solo");
        muss(solo, "config", "core.hooksPath", hooks);
        writeFileSync(join(solo, "x.txt"), "eins\n");
        muss(solo, "add", "x.txt");
        expect(git(solo, "commit", "-m", "erster").status).toBe(0);
    });
});
