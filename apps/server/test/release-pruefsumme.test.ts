import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    browserFluechtig,
    browserUnveraendertSeit,
    fingerprint,
    geaenderteKomponenten,
} from "../../../scripts/dev/release-pruefsumme.ts";

/**
 * Release-Test d1feba8 (2026-10-24): alle Teile grün, rot nur „Testumgebung während des Laufs verändert“. Chromium Headless Shell schreibt
 * bei jedem Start `debug.log` in seinen Installationsordner, der Teil des Fingerabdrucks war; der Lauf veränderte die Umgebung also selbst.
 */
describe("Fingerabdruck des Browserordners", () => {
    const ordner: string[] = [];
    afterEach(() => {
        for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
    });
    const browserordner = (): string => {
        const wurzel = mkdtempSync(join(tmpdir(), "ms-playwright-"));
        ordner.push(wurzel);
        mkdirSync(join(wurzel, "chromium_headless_shell-1243", "chrome-headless-shell-win64"), { recursive: true });
        mkdirSync(join(wurzel, ".links"));
        writeFileSync(
            join(wurzel, "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
            "exe",
        );
        writeFileSync(
            join(wurzel, "chromium_headless_shell-1243", "chrome-headless-shell-win64", "debug.log"),
            "start\n",
        );
        writeFileSync(join(wurzel, ".links", "5a7449e2"), "C:/GIT/avesmaps3D");
        return wurzel;
    };

    it("🔴 ein Lauf, der debug.log verlängert oder einen Projektverweis anlegt, verändert die Umgebung nicht", () => {
        const wurzel = browserordner();
        const vorher = fingerprint(wurzel, browserFluechtig);
        appendFileSync(
            join(wurzel, "chromium_headless_shell-1243", "chrome-headless-shell-win64", "debug.log"),
            "noch ein Start\n",
        );
        writeFileSync(
            join(wurzel, ".links", "0d1feba8"),
            "C:/avesmaps3d-data/release-werkzeug/.release-runs/x/checkout",
        );
        expect(fingerprint(wurzel, browserFluechtig)).toBe(vorher);
        // Ohne Auslassung hätte derselbe Lauf die Umgebung verändert (so war es bis hierher).
        expect(fingerprint(wurzel)).not.toBe(fingerprint(browserordner()));
    });

    it("🔴 ein geänderter Browser verändert die Umgebung weiterhin", () => {
        const wurzel = browserordner();
        const vorher = fingerprint(wurzel, browserFluechtig);
        writeFileSync(
            join(wurzel, "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
            "neu",
        );
        expect(fingerprint(wurzel, browserFluechtig)).not.toBe(vorher);
    });

    it("die Schlussprüfung nennt, welcher Bestandteil sich verändert hat", () => {
        expect(
            geaenderteKomponenten({ node: "a", browser: "b", runner: "c" }, { node: "a", browser: "x", runner: "c" }),
        ).toEqual(["browser"]);
        expect(geaenderteKomponenten({ node: "a" }, { node: "a", martin: "m" })).toEqual(["martin"]);
        expect(geaenderteKomponenten({ node: "a" }, { node: "a" })).toEqual([]);
    });
});

describe("Browserordner unverändert seit dem Start eines Laufs", () => {
    it("🔴 nur Protokolle und Projektverweise neu: unverändert; eine andere Datei neuer als der Start: verändert", () => {
        const wurzel = mkdtempSync(join(tmpdir(), "ms-playwright-seit-"));
        try {
            mkdirSync(join(wurzel, "chromium-1243"));
            writeFileSync(join(wurzel, "chromium-1243", "chrome.exe"), "exe");
            writeFileSync(join(wurzel, "chromium-1243", "debug.log"), "alt");
            const alt = new Date(Date.now() - 60_000);
            for (const p of [join(wurzel, "chromium-1243", "chrome.exe"), join(wurzel, "chromium-1243"), wurzel])
                utimesSync(p, alt, alt);
            // ctime lässt sich nicht zurückstellen: Der Start liegt darum knapp in der Zukunft der Testdateien.
            const start = Date.now() + 1_000;
            expect(browserUnveraendertSeit(wurzel, start)).toBe(true);
            expect(browserUnveraendertSeit(wurzel, alt.getTime() - 60_000)).toBe(false);
            expect(browserUnveraendertSeit(join(wurzel, "gibt-es-nicht"), start)).toBe(false);
        } finally {
            rmSync(wurzel, { recursive: true, force: true });
        }
    });
});
