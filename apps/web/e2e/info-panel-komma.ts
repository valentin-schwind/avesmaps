import { expect, type Locator, type Page } from "@playwright/test";
import { GARETH, bedieneBilder, oeffne } from "./bildbezug-quelle.ts";
import { openMap } from "./map-handle.ts";

/**
 * Satzzeichen hinter einem Link (Abnahmeblatt `review/bildbezug/blatt.png`, Gareth): „…zu Gareth“ / „, Königreich Garetien,“ - ein Komma
 * darf nie eine Zeile beginnen. Gemeinsame Teile von `info-panel-komma.spec.ts` (Rechner) und `.touch.spec.ts` (Telefon, 412 px).
 *
 * Gestellt ist nur der Untertitel der Detailantwort von Gareth, wie der Server ihn heute liefert (drei Herrschaften, die erste so lang,
 * dass sie in sich umbricht); Panel, Modell und Bauteile sind die echten. Die Bilder beantwortet `bedieneBilder`, damit das Wappen
 * seinen Platz einnimmt und die Zeilen dort brechen, wo sie im Blatt brachen.
 */

const territory = (id: string, name: string) => ({ ref: { kind: "territory", id }, name });

const UNTERTITEL = [
    { part: "type", key: "metropole" },
    {
        part: "capitalOf",
        territory: territory(
            "3359118f-bdfe-4569-8277-3f25c2d62463",
            "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        ),
    },
    { part: "capitalOf", territory: territory("99dacb52-93f1-4698-8746-1dd9d4b55992", "Königreich Garetien") },
    { part: "capitalOf", territory: territory("159ad4fd-54de-4459-9e89-e0344fc7670c", "Kaisermark Gareth") },
];

/** Öffnet Gareth mit dem gestellten Untertitel. */
export async function oeffneGareth(page: Page): Promise<void> {
    await bedieneBilder(page);
    await page.route(
        (url) => url.pathname === `/api/subjects/place/${GARETH}`,
        async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as Record<string, unknown>;
            await route.fulfill({ response, json: { ...answer, subtitle: UNTERTITEL } });
        },
    );
    await openMap(page);
    await oeffne(page, { kind: "place", id: GARETH }, "Gareth");
    await expect(page.getByTestId("info-subtitle").getByTestId("info-link")).toHaveCount(3);
    await expect(page.getByTestId("info-coat")).toBeVisible();
}

interface Kasten {
    left: number;
    right: number;
    top: number;
    height: number;
}

/** Ein Zeichen, wie es im Bild steht. `erzeugt`: aus `::after`, ohne eigenen Kasten - es trägt den des Zeichens davor. */
interface Zeichen {
    char: string;
    kasten: Kasten;
    erzeugt?: string;
}

/**
 * Die Zeichen eines Containers, wie sie im Bild stehen: sichtbarer Text mit dem Kasten je Zeichen (`Range`), dazu erzeugter Inhalt
 * (`::after`) an seiner Stelle hinter dem Inhalt seines Elements. Text in einem Kasten von höchstens 1 px (nur für Vorleser) steht
 * nicht im Bild und zählt nicht. Jedes Element mit erzeugtem Inhalt bekommt eine Probenummer für die Tinte (`abrisse`).
 */
function gezeichnet(container: Locator): Promise<Zeichen[]> {
    return container.evaluate((root) => {
        const zeichen: Zeichen[] = [];
        let probe = 0;
        const walk = (node: Node): void => {
            if (node instanceof Text) {
                const box = node.parentElement?.getBoundingClientRect();
                if (box === undefined || (box.width <= 1 && box.height <= 1)) return;
                for (let at = 0; at < node.data.length; at += 1) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + 1);
                    const rect = [...range.getClientRects()].find((entry) => entry.height > 0);
                    if (rect === undefined) continue;
                    const kasten = { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
                    zeichen.push({ char: node.data[at]!, kasten });
                }
                return;
            }
            if (!(node instanceof Element)) return;
            for (const child of node.childNodes) walk(child);
            // Der Text eines erzeugten Inhalts ohne seinen Alternativtext: `"," / ""` → `,`.
            const inhalt = /^"((?:[^"\\]|\\.)*)"/.exec(getComputedStyle(node, "::after").content)?.[1] ?? "";
            const vorher = zeichen.at(-1);
            if (inhalt === "" || vorher === undefined) return;
            probe += 1;
            node.setAttribute("data-komma-probe", String(probe));
            for (const char of inhalt) zeichen.push({ char, kasten: vorher.kasten, erzeugt: String(probe) });
        };
        walk(root);
        return zeichen;
    });
}

/**
 * Gareths Feldzeilen mit einem Satzzeichen direkt hinter einem Link, aus dem echten Bestand: „Reichsstraßen 2 und 3, Gardel“ und
 * „Herz des Kontinents · Baronie Raulsmark; Reichsstadt (nur Alt-Gareth)“ (dort steht „;“ am Rechner genau am Zeilenende).
 */
export function feldwerte(page: Page): Locator[] {
    return ["Verkehrswege", "Lage"].map((label) =>
        page
            .getByTestId("info-fact")
            .filter({ has: page.getByTestId("info-fact-label").getByText(label, { exact: true }) })
            .getByTestId("info-fact-value"),
    );
}

/** Ein Satzzeichen, das nicht direkt hinter seinem Vorgänger steht. */
export interface Abriss {
    zeichen: string;
    davor: string;
    wie: string;
}

/**
 * Misst im Bild, ob jedes Satzzeichen, das ohne Leerraum auf ein Zeichen folgt, in derselben Zeile direkt dahinter steht - auch über
 * die Grenze eines Links hinweg. Gemessen wird je Zeichen, nicht am Kasten des Links: Ein umbrechender Link ist ein Kasten über die
 * ganze Breite, sein letztes Wort steht links darin. Ein Komma am Zeilenanfang steht eine Zeile tiefer als sein Vorgänger; ein Komma,
 * das rechts neben einem breiten Kasten hängt, steht auf der Höhe, aber weit hinter dem letzten Wort. Beides ist ein Abriss.
 *
 * Erzeugten Inhalt (das Satzzeichen im Kasten des Links) erreicht kein `Range`. Dort wird die Tinte verglichen: ein schmaler Streifen
 * direkt hinter dem letzten Zeichen, einmal wie gezeichnet und einmal mit durchsichtigem `::after`. Gleichen sich beide, steht das
 * Zeichen nicht dort.
 */
export async function abrisse(container: Locator): Promise<Abriss[]> {
    const page = container.page();
    // Die Tinte liest ein Bildschirmfoto: Der Container muss im Bild stehen, bevor die Kästen gemessen werden.
    await container.scrollIntoViewIfNeeded();
    const bild = await gezeichnet(container);
    const found: Abriss[] = [];
    const davor = (index: number): string =>
        bild
            .slice(Math.max(0, index - 12), index)
            .map((entry) => entry.char)
            .join("");
    for (const [index, current] of bild.entries()) {
        const before = bild[index - 1];
        if (before === undefined || !/^\p{P}/u.test(current.char) || /\s/.test(before.char)) continue;
        if (current.erzeugt !== undefined) {
            if (before.erzeugt === current.erzeugt) continue;
            const clip = { x: current.kasten.right, y: current.kasten.top, width: 6, height: current.kasten.height };
            const mit = await page.screenshot({ clip });
            const probe = `[data-komma-probe="${current.erzeugt}"]::after { color: transparent !important; }`;
            const style = await page.addStyleTag({ content: probe });
            const ohne = await page.screenshot({ clip });
            await style.evaluate((node) => (node as Element).remove());
            if (mit.equals(ohne))
                found.push({ zeichen: current.char, davor: davor(index), wie: "keine Tinte dahinter" });
            continue;
        }
        const sameLine = Math.abs(current.kasten.top - before.kasten.top) < current.kasten.height / 2;
        const gap = current.kasten.left - before.kasten.right;
        if (sameLine && gap > -1 && gap < 2) continue;
        const wie = sameLine ? `${String(Math.round(gap))} px hinter dem Wort` : "am Anfang der nächsten Zeile";
        found.push({ zeichen: current.char, davor: davor(index), wie });
    }
    return found;
}

/** Die Zeilen, wie sie im Bild stehen (für die Prüfung des Zeilenanfangs und die Fehlermeldung). */
export async function zeilen(container: Locator): Promise<string[]> {
    const lines = new Map<number, string>();
    for (const entry of await gezeichnet(container)) {
        const top = Math.round(entry.kasten.top / 4) * 4;
        lines.set(top, (lines.get(top) ?? "") + entry.char);
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line.trim());
}

/**
 * Die ganze Prüfung an einem Container: Im Bild steht jedes Zeichen seines Textes genau einmal (kein Satzzeichen fehlt, keines steht
 * doppelt), keine Zeile beginnt mit einem schließenden Satzzeichen, und jedes steht direkt hinter seinem Wort.
 */
export async function pruefeSatzzeichen(container: Locator): Promise<void> {
    const bild = await zeilen(container);
    const meldung = bild.join(" | ");
    const text = (await container.textContent()) ?? "";
    expect(bild.join("").replace(/\s+/g, ""), meldung).toBe(text.replace(/\s+/g, ""));
    for (const zeile of bild) expect(zeile, meldung).not.toMatch(/^[,.;:!?)]/);
    expect(await abrisse(container), meldung).toEqual([]);
}
