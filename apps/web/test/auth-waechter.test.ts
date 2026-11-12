import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 T6 (AUTH-0001 §10.3; WI-0120 A12): In den Oberflächen der Anmeldung und der Verwaltung landet nie Text als HTML. Namen von
 * Personen, Discord-Namen, Gründe und Anlässe sind Fremdtext; Vue escapet sie, solange niemand `v-html` oder `innerHTML`
 * benutzt. Dieser Wächter hält das fest, damit ein späteres „nur schnell fett machen“ rot wird statt still eine Lücke zu öffnen.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AUTH = join(root, "apps", "web", "src", "auth");
const VERBOTEN: readonly [string, RegExp][] = [
    ["v-html", /\bv-html\b/u],
    ["innerHTML", /\.innerHTML\b/u],
    ["outerHTML", /\.outerHTML\b/u],
    ["insertAdjacentHTML", /\binsertAdjacentHTML\b/u],
    ["document.write", /\bdocument\.write\b/u],
];

const DATEIEN = readdirSync(AUTH, { recursive: true, encoding: "utf8" })
    .filter((pfad) => /\.(vue|ts)$/u.test(pfad))
    .map((pfad) => join(AUTH, pfad));

describe("Kein HTML aus Text in Anmeldung und Verwaltung (T6)", () => {
    it("🔴 keine Datei unter apps/web/src/auth setzt HTML aus Text", () => {
        expect(DATEIEN.length).toBeGreaterThan(20);
        const funde = DATEIEN.flatMap((datei) => {
            const inhalt = readFileSync(datei, "utf8");
            return VERBOTEN.filter(([, muster]) => muster.test(inhalt)).map(
                ([name]) => `${relative(root, datei).replace(/\\/gu, "/")}: ${name}`,
            );
        });
        expect(funde).toEqual([]);
    });

    it("💣 Probe: ein `v-html` würde gefunden", () => {
        expect(VERBOTEN.some(([, muster]) => muster.test('<span v-html="person.displayName" />'))).toBe(true);
    });
});
