import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import "./map-handle";
import { showStages } from "./stage-groups.ts";
import { openStagePanel } from "./stage-panel.ts";

/**
 * Blatt „Passt die neue Sprache in die Oberfläche?“ (WI-0174, erstmals für Polnisch).
 *
 * 💣 Dieser Lauf prüft NICHTS über die Anwendung. Er legt EIN Blatt je Lage vor und MISST, welche Elemente über
 * ihren Platz laufen - gegen dieselbe Lage auf Deutsch, denn beschnitten wird auch dort schon einiges (Namen in
 * schmalen Zellen, bewusst mit `text-overflow`). Der Fund ist nur, was AUF DER NEUEN SPRACHE mehr überläuft.
 *
 *   npm run review:sprachplatz                 # Vorgabe: Polnisch gegen Deutsch
 *   $env:REVIEW_LANG="it"; npm run review:sprachplatz
 *
 * Eigene Ports für parallele Sitzungen:
 *   $env:E2E_PORT="4234"; npm run review:sprachplatz
 *
 * Ablage: `review/sprachplatz/<lang>-<lage>-<breite>.png` und `befund.md` (`review/` ist nicht versioniert).
 */

const LANG = process.env["REVIEW_LANG"] ?? "pl";
const OUTPUT = resolve(import.meta.dirname, "../../../review/sprachplatz");

/** Die Lagen, die der Betreiber bei jeder neuen Sprache sehen will (WI-0174 §6). */
const LAGEN = [
    { name: "planer", oeffnen: async (): Promise<void> => {} },
    {
        name: "etappen",
        oeffnen: async (page: Page): Promise<void> => {
            await showStages(page);
        },
    },
    {
        name: "infopanel",
        oeffnen: async (page: Page): Promise<void> => {
            await showStages(page);
            await openStagePanel(page, 0);
        },
    },
] as const;

const BREITEN = [1280, 360] as const;

/** Was über seinen Platz läuft: Kennung, Text und um wie viele Pixel. */
interface Ueberlauf {
    wo: string;
    text: string;
    um: number;
}

async function ueberlaeufe(page: Page): Promise<Ueberlauf[]> {
    return page.evaluate(() => {
        const raus: { wo: string; text: string; um: number }[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const um = el.scrollWidth - el.clientWidth;
            if (um <= 1 || el.clientWidth === 0) continue;
            // Elemente, die scrollen SOLLEN, laufen nicht über - sie sind scrollbar.
            const stil = globalThis.getComputedStyle(el);
            if (stil.overflowX === "auto" || stil.overflowX === "scroll") continue;
            if (el.querySelector("*") !== null && el.childElementCount > 0 && el.scrollWidth > el.clientWidth * 2)
                continue;
            raus.push({
                wo: el.dataset["testid"] ?? `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`,
                text: (el.textContent ?? "").trim().slice(0, 60),
                um,
            });
        }
        return raus;
    });
}

async function lage(page: Page, lang: string, name: string, breite: number): Promise<Ueberlauf[]> {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto(`/?route=Gareth~Perricum&lang=${lang}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await page.getByTestId("route-stages").waitFor({ timeout: 30_000 });
    const schritt = LAGEN.find((l) => l.name === name);
    await schritt?.oeffnen(page);
    await page.waitForTimeout(500);
    mkdirSync(OUTPUT, { recursive: true });
    await page.screenshot({ path: resolve(OUTPUT, `${lang}-${name}-${String(breite)}.png`), fullPage: false });
    return ueberlaeufe(page);
}

test("Blatt: läuft auf der neuen Sprache mehr über als auf Deutsch?", async ({ page }) => {
    test.setTimeout(600_000);
    const zeilen: string[] = [`# Platz in der Oberfläche: ${LANG} gegen de`, ""];
    let mehr = 0;
    for (const breite of BREITEN) {
        for (const { name } of LAGEN) {
            const deutsch = await lage(page, "de", name, breite);
            const neu = await lage(page, LANG, name, breite);
            // 🪤 Nicht die MENGE der Kennungen vergleichen, sondern ihre ZAHL je Kennung: Zwei Felder teilen sich
            // dieselbe Klasse, und eine Menge verschluckt das zweite.
            const zaehle = (liste: Ueberlauf[]): Map<string, number> => {
                const m = new Map<string, number>();
                for (const u of liste) m.set(u.wo, (m.get(u.wo) ?? 0) + 1);
                return m;
            };
            const deutschZahl = zaehle(deutsch);
            const uebrig = new Map(deutschZahl);
            const nurNeu: Ueberlauf[] = [];
            for (const u of neu) {
                const rest = uebrig.get(u.wo) ?? 0;
                if (rest > 0) uebrig.set(u.wo, rest - 1);
                else nurNeu.push(u);
            }
            mehr += nurNeu.length;
            zeilen.push(`## ${name}, ${String(breite)} px`);
            zeilen.push(`- de: ${String(deutsch.length)} beschnitten · ${LANG}: ${String(neu.length)} beschnitten`);
            if (nurNeu.length === 0) zeilen.push(`- **kein Element läuft auf ${LANG} über, das auf Deutsch passt**`);
            for (const u of nurNeu) zeilen.push(`- 🔴 NUR ${LANG}: \`${u.wo}\` um ${String(u.um)} px — „${u.text}“`);
            zeilen.push("");
        }
    }
    zeilen.push(`Summe der Stellen, die nur auf ${LANG} überlaufen: **${String(mehr)}**`);
    writeFileSync(resolve(OUTPUT, "befund.md"), zeilen.join("\n") + "\n", "utf8");
    console.warn(zeilen.join("\n"));
});
