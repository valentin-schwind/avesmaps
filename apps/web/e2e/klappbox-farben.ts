import { expect, type Page } from "@playwright/test";

/**
 * 🔴 Die Klappbox-Regel für Werte, gemessen an den berechneten Farben (Design Guide §16.3 und §17, Betreiber 2026-10-04:
 * „numerische Mess-/Geldwerte verwenden --color-text-strong und tabular-nums; Einheiten und Abkürzungen wie %, Std., Schritt,
 * D, S, H sowie erläuternde Sekundärtexte verwenden --color-text-muted; normale Fließtexte bleiben --color-text, reine Titel
 * --color-text-strong“). Verglichen wird mit den Tokens selbst, im hellen wie im dunklen Thema: Eine Sonderfarbe an einer
 * Klappbox fiele hier auf.
 */
export interface KlappboxFarben {
    /** Die Farben der drei Tokens, wie der Browser sie im aktuellen Thema berechnet. */
    token: { strong: string; muted: string; text: string };
    boxes: KlappboxReport[];
}

export interface KlappboxReport {
    box: string;
    /** Die Farben aller Zahlen (`.wert__zahl`) in Kopfzeile und Inhalt, ohne Doppelte. */
    zahlen: string[];
    /** Die Farben aller Einheiten. */
    einheiten: string[];
    /** `font-variant-numeric` aller Zahlen. */
    ziffern: string[];
    zahlenAnzahl: number;
    einheitenAnzahl: number;
    /** Der Titel der Kopfzeile (Rolle `titel`): Farbe, wenn die Beschriftung keine Zahl trägt; sonst leer. */
    titel: string[];
    /** Die Kurzangabe der Kopfzeile (Rolle `sekundaer`). */
    kurzangabe: string[];
    /** Texte des Inhalts je Rolle: Fließtext und Sekundärtext. */
    fliesstext: string[];
    sekundaer: string[];
}

export async function klappboxFarben(page: Page, boxes: readonly string[]): Promise<KlappboxFarben> {
    return page.evaluate((testids) => {
        const probe = (token: string): string => {
            const element = document.createElement("span");
            element.style.color = `var(${token})`;
            document.body.append(element);
            const colour = getComputedStyle(element).color;
            element.remove();
            return colour;
        };
        const colours = (root: Element, selector: string): string[] => [
            ...new Set([...root.querySelectorAll(selector)].map((element) => getComputedStyle(element).color)),
        ];
        const reports = testids.map((testid) => {
            const box = document.querySelector(`[data-testid="${testid}"]`);
            if (!box) throw new Error(`Klappbox fehlt: ${testid}`);
            const head = box.querySelector("summary")!;
            const labels = head.querySelector(".disclosure__labels")!;
            const hasDigits = /\d/.test(labels.querySelector(":scope > span")?.textContent ?? "");
            return {
                box: testid,
                zahlen: colours(box, ".wert__zahl"),
                einheiten: colours(box, ".wert__einheit"),
                ziffern: [
                    ...new Set(
                        [...box.querySelectorAll(".wert__zahl")].map((e) => getComputedStyle(e).fontVariantNumeric),
                    ),
                ],
                zahlenAnzahl: box.querySelectorAll(".wert__zahl").length,
                einheitenAnzahl: box.querySelectorAll(".wert__einheit").length,
                titel: hasDigits ? [] : colours(labels, ":scope > span .avm-text--titel"),
                kurzangabe: colours(head, ".disclosure__secondary .avm-text--sekundaer"),
                fliesstext: colours(box.querySelector(".disclosure__content")!, ".avm-text--text"),
                sekundaer: colours(box.querySelector(".disclosure__content")!, ".avm-text--sekundaer"),
            };
        });
        return {
            token: {
                strong: probe("--color-text-strong"),
                muted: probe("--color-text-muted"),
                text: probe("--color-text"),
            },
            boxes: reports,
        };
    }, boxes);
}

/** Öffnet die Klappboxen des Planers, die es für diese Strecke gibt (und die Grenzübertritte), und wartet die Bewegung ab. */
export async function openKlappboxen(page: Page, testids: readonly string[]): Promise<void> {
    await expect(page.getByTestId("areas-toggle")).toBeVisible({ timeout: 30_000 });
    for (const testid of testids) {
        const toggle = page.getByTestId(testid);
        if ((await toggle.count()) > 0) await toggle.click();
    }
    await page.waitForTimeout(500);
}
