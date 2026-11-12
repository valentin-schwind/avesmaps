import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Claudios Bedingungen an die native Bildbibliothek (WI-0063 MEDIA-M7, D1, `handovers/2026-10-04-media-m7-sharp-antwort.md`
 * Frage 5): exakt gepinnt mit Integrität im Lockfile, das Release-Artefakt bringt die linux-x64-glibc-Prebuilds mit, keine
 * System-libvips. Das ist ein Test der Entwicklung (er hält die Zusage fest), kein Betriebs-Gate.
 */

const repository = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const text = (path: string): Promise<string> => readFile(repository(path), "utf8");

interface LockPackage {
    version?: string;
    integrity?: string;
    resolved?: string;
    os?: string[];
    cpu?: string[];
    libc?: string[];
    optional?: boolean;
}

describe("sharp: gepinnt, mit Integrität, für linux-x64-glibc", () => {
    it("🔴 apps/server hängt von sharp ab, exakt gepinnt (kein ^ und kein ~)", async () => {
        const manifest = JSON.parse(await text("apps/server/package.json")) as { dependencies: Record<string, string> };
        expect(manifest.dependencies["sharp"]).toBe("0.35.5");
    });

    it("🔴 das Lockfile trägt sharp und die Prebuilds für linux-x64-glibc mit Integrität (sha512)", async () => {
        const lock = JSON.parse(await text("package-lock.json")) as { packages: Record<string, LockPackage> };
        const sharp = lock.packages["node_modules/sharp"];
        expect(sharp?.version).toBe("0.35.5");
        expect(sharp?.integrity).toMatch(/^sha512-/);
        for (const name of ["sharp-linux-x64", "sharp-libvips-linux-x64"]) {
            const entry = lock.packages[`node_modules/@img/${name}`];
            expect(entry, name).toBeDefined();
            expect(entry?.integrity, name).toMatch(/^sha512-/);
            expect(entry?.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//);
            expect(entry?.os, name).toEqual(["linux"]);
            expect(entry?.cpu, name).toEqual(["x64"]);
            expect(entry?.libc, name).toEqual(["glibc"]);
        }
        // Jeder @img-Eintrag hat eine Integrität: npm ci prüft sie, der VPS lädt beim Deploy nichts nach.
        for (const [key, entry] of Object.entries(lock.packages)) {
            if (key.startsWith("node_modules/@img/")) expect(entry.integrity, key).toMatch(/^sha512-/);
        }
    });

    it("🔴 das Release erzwingt das Ziel linux-x64-glibc, gleich auf welchem Host gebaut wird", async () => {
        const script = await text("ops/deploy/build-release.sh");
        expect(script).toContain("TARGET_PLATFORM=(--os=linux --cpu=x64 --libc=glibc)");
        const productionInstall = script
            .split("\n")
            .find((line) => !line.trimStart().startsWith("#") && line.includes("npm ci --omit=dev"));
        expect(productionInstall).toBeDefined();
        expect(productionInstall).toContain('"${TARGET_PLATFORM[@]}"');
        // Die nativen Teile müssen im Artefakt stehen; fehlen sie, bricht der Bau ab.
        expect(script).toContain("@img/sharp-linux-x64");
        expect(script).toContain("@img/sharp-libvips-linux-x64");
        expect(script).toContain('die "Release enthaelt die linux-x64-glibc-Prebuilds von sharp nicht');
    });

    it("`--omit=optional` steht nirgends: die Prebuilds sind optionale Abhängigkeiten", async () => {
        const script = await text("ops/deploy/build-release.sh");
        expect(script).not.toContain("--omit=optional");
        expect(script).not.toContain("--no-optional");
    });

    it("die Plattform steht nicht in einer .npmrc: sie stellte die Entwicklung auf Windows auf Linux-Binärdateien um", async () => {
        let npmrc = "";
        try {
            npmrc = await text(".npmrc");
        } catch {
            // keine .npmrc: der Normalfall
        }
        expect(npmrc).not.toMatch(/^\s*(os|cpu|libc)\s*=/m);
    });
});
