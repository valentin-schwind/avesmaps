import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INFOSCREEN_DIR, INFOSCREEN_FILES, renderInfoscreens } from "../../../scripts/dev/build-infoscreens.mjs";

/**
 * 🔴 DIE ZWEI INFOSCREENS (WI-0127 SYS-6; Bauplan SYS-0001 §5.1, §6.6, §7.1; Betreiber 2026-10-10, WI-0119 F1: Wartung und Störung,
 * „dieselbe visuelle Hülle, getrennte Inhalte und getrennte Auslöser“; E2: „ein infoscreen für benutzer muss immer vorhanden sein,
 * wenn die karte nicht lädt“).
 *
 * Nginx liefert sie aus, wenn die Anwendung nicht da ist oder nicht da sein soll. Deshalb dürfen sie nichts brauchen, was dann
 * fehlen kann, und die CSP der Stage muss sie tragen. Geprüft werden genau diese Regeln:
 *
 * - kein Skript (kein `<script>`, kein `on…=`, kein `javascript:`);
 * - CSS nur inline (ein `<style>`, kein `<link>`, kein `@import`, kein `url(`);
 * - Bild nur als `data:` (jedes `src`), keine fremde Adresse (kein `http:`, `https:`, `//`, kein `href`);
 * - das Meta-Tag `avesmaps-infoscreen` mit der Art der Seite;
 * - hell und dunkel (`color-scheme`, `prefers-color-scheme: dark`);
 * - Deutsch mit genau einer englischen Zeile, ohne Anrede;
 * - die versprochene Selbstauffrischung, eine kleine Datei;
 * - eine Hülle für beide (dasselbe CSS), getrennte Inhalte;
 * - die Dateien sind bytegleich das, was der Generator heute erzeugt (`node scripts/dev/build-infoscreens.mjs`).
 *
 * ⭐ Eine absichtlich falsche Probe steht mit im Test („💣 …“): Ein Wächter, der nie anschlägt, sieht genauso aus wie einer, der
 * nichts prüft.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ART: Readonly<Record<string, string>> = { "wartung.html": "wartung", "stoerung.html": "stoerung" };
/** Rund 14 KB heute (Bild 7,5 KB als base64, Wortmarke 4 KB); die Grenze lässt Luft, verhindert aber eine eingebettete Schrift. */
const HOECHSTENS_BYTES = 20_000;
const ANREDE = /\b(du|dich|dir|dein\w*|euch|euer\w*|Sie|Ihnen|Ihr\w*|you|your\w*)\b/u;

/** Was ein Mensch auf der Seite liest: ohne Kommentar, Stil, Pfad und Markup. */
function sichtbarerText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<style>[\s\S]*?<\/style>/g, " ")
        .replace(/<svg[\s\S]*?<\/svg>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Die Verstöße einer Seite gegen die Regeln oben; leer heißt: sie darf ausgeliefert werden. */
function verstoesse(html: string, art: string): string[] {
    const funde: string[] = [];
    const ohneKommentar = html.replace(/<!--[\s\S]*?-->/g, "");
    if (/<script\b/i.test(ohneKommentar)) funde.push("Skript");
    if (/\son[a-z]+\s*=/i.test(ohneKommentar)) funde.push("Ereignis-Attribut");
    if (/javascript:/i.test(ohneKommentar)) funde.push("javascript:");
    if (/<link\b/i.test(ohneKommentar)) funde.push("<link>");
    if (/@import/i.test(ohneKommentar)) funde.push("@import");
    if (/url\(/i.test(ohneKommentar)) funde.push("url( im CSS");
    if ((ohneKommentar.match(/<style>/g) ?? []).length !== 1) funde.push("nicht genau ein <style>");
    for (const quelle of ohneKommentar.matchAll(/\ssrc(?:set)?\s*=\s*"([^"]*)"/gi)) {
        if (!(quelle[1] ?? "").startsWith("data:image/"))
            funde.push(`Bild nicht als data: (${(quelle[1] ?? "").slice(0, 40)})`);
    }
    if (/https?:|["'(\s]\/\/[a-z0-9]/i.test(ohneKommentar)) funde.push("fremde Adresse");
    if (/\shref\s*=/i.test(ohneKommentar)) funde.push("href");
    const meta = [...ohneKommentar.matchAll(/<meta name="avesmaps-infoscreen" content="([^"]*)">/g)];
    if (meta.length !== 1 || meta[0]?.[1] !== art)
        funde.push(`Meta-Tag avesmaps-infoscreen fehlt oder sagt nicht „${art}“`);
    if (!/color-scheme:\s*light dark/.test(ohneKommentar)) funde.push("color-scheme light dark fehlt");
    if (!/@media \(prefers-color-scheme:\s*dark\)/.test(ohneKommentar)) funde.push("dunkles Thema fehlt");
    if (!/<html lang="de">/.test(ohneKommentar)) funde.push("nicht Deutsch");
    if ((ohneKommentar.match(/\slang="en"/g) ?? []).length !== 1) funde.push("nicht genau eine englische Zeile");
    if (!/<meta http-equiv="refresh" content="300">/.test(ohneKommentar)) funde.push("Selbstauffrischung fehlt");
    const anrede = ANREDE.exec(sichtbarerText(html));
    if (anrede !== null) funde.push(`Anrede „${anrede[0]}“`);
    if (Buffer.byteLength(html) > HOECHSTENS_BYTES) funde.push(`größer als ${String(HOECHSTENS_BYTES)} Byte`);
    return funde;
}

const erzeugt = renderInfoscreens(repositoryRoot) as Record<string, string>;
const datei = (name: string): string => readFileSync(join(repositoryRoot, INFOSCREEN_DIR, name), "utf8");

describe("🔴 Die zwei Infoscreens (SYS-6)", () => {
    it("es gibt genau zwei, Wartung und Störung, und keiner liegt unter ops/ (dorthin übernimmt sie Claudio)", () => {
        expect(INFOSCREEN_FILES).toEqual(["wartung.html", "stoerung.html"]);
        expect(Object.keys(erzeugt).sort()).toEqual(["stoerung.html", "wartung.html"]);
        expect(INFOSCREEN_DIR.replace(/\\/g, "/")).not.toMatch(/^ops\//);
    });

    it.each(INFOSCREEN_FILES)("🔴 %s hält jede Regel", (name) => {
        expect(verstoesse(datei(name), ART[name] ?? "")).toEqual([]);
    });

    it.each(INFOSCREEN_FILES)("🔴 %s ist bytegleich das, was der Generator erzeugt", (name) => {
        expect(datei(name), "node scripts/dev/build-infoscreens.mjs ausführen").toBe(erzeugt[name]);
    });

    it("eine Hülle, getrennte Inhalte: dasselbe CSS, verschiedene Überschrift, Titel und Art", () => {
        const stil = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
        const wartung = datei("wartung.html");
        const stoerung = datei("stoerung.html");
        expect(stil(wartung)).toBe(stil(stoerung));
        expect(sichtbarerText(wartung)).toContain("Die Karte wird gerade gewartet.");
        expect(sichtbarerText(stoerung)).toContain("Wartungsarbeiten, wir sind bald wieder da.");
        expect(sichtbarerText(wartung)).not.toContain("bald wieder da");
        expect(sichtbarerText(stoerung)).not.toContain("gewartet");
    });

    it("💣 eine absichtlich falsche Probe wird rot", () => {
        const gut = datei("wartung.html");
        const falsch: Record<string, string> = {
            Skript: gut.replace("</body>", "<script>alert(1)</script></body>"),
            "Ereignis-Attribut": gut.replace("<main>", '<main onclick="x()">'),
            "<link>": gut.replace("</head>", '<link rel="stylesheet" href="/x.css"></head>'),
            "url( im CSS": gut.replace("</style>", "body{background:url(/bild.png)}</style>"),
            "Bild nicht als data:": gut.replace(/src="data:[^"]*"/, 'src="/icons/menu/sextant.webp"'),
            "fremde Adresse": gut.replace("</footer>", " https://avesmaps.de</footer>"),
            "Meta-Tag": gut.replace('content="wartung"', 'content="stoerung"'),
            "dunkles Thema": gut.replace("@media (prefers-color-scheme:dark)", "@media (min-width:1px)"),
            "englische Zeile": gut.replace(' lang="en"', ""),
            Anrede: gut
                .replace("Links, Routen", "Deine Links, Routen")
                .replace("bleiben gültig", "bleiben für dich gültig"),
            Größe: gut.replace("</body>", `<!-- ${"x".repeat(HOECHSTENS_BYTES)} --></body>`),
        };
        for (const [name, html] of Object.entries(falsch)) {
            expect(verstoesse(html, "wartung"), name).not.toEqual([]);
        }
        expect(verstoesse(gut, "wartung")).toEqual([]);
    });
});
