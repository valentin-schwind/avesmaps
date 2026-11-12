import { expect, test, type Page } from "@playwright/test";
import { openStageGroups, settleStages } from "./stage-groups.ts";
import { closePlannerBox, openPlannerBox, plannerBox, plannerBoxToggle, type PlannerBox } from "./planner-boxes.ts";

/**
 * WI-0089, die Abnahmefälle A1 bis A9 am echten Stack: der Rollbalken verschiebt den Kopf der Reiseübersicht nicht
 * mehr (P1), die drei Zeichen des Etappenkopfes stehen auf 150 % (P2), und „Transportmittel“ und „Reiseoptionen“ sind
 * dieselbe Klappbox wie die Deckel der Routendetails (P3).
 *
 * 💣 **Dieser Lauf lässt Playwrights `--hide-scrollbars` weg.** Headless Chromium zeichnet den Balken sonst mit Breite
 * 0, und dann nimmt er nichts weg: Der Fall A1 wäre vor UND nach der Behebung grün und bewiese nichts. Gemessen am
 * 2026-10-06 ohne den Schalter: 15 px Rinne, mit ihm 0.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

/** Seine eigene Reise aus dem Befund: „Die Reise von Gareth nach Greifenfurt“. */
const REISE = "?route=Gareth~Greifenfurt";
/** Viele Etappen: der Balken ist in jedem Fenster da. */
const LANGE_REISE = "?route=Thorwal~Al'Anfa";

/** Ein Fenster, in dem die Übersicht mit zugeklappten Etappen NICHT rollt - nur so gibt es ein „ohne Balken“. */
const HOCH = { width: 1280, height: 1100 };

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("costs-toggle")).toBeVisible({ timeout: 20_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    // 💣 Erst messen, wenn der Planer angekommen ist. Bei 360 px fährt er beim Laden herein (220 ms, `.route-planner`), während Titel
    // und Kosten schon dastehen; wer dann misst, misst die Fahrt und nicht den Kopf. Gemessen 2026-10-08 im Volllauf: Titel bei 10,81
    // statt 23 px, in Ruhe stehen vorher und nachher beide auf 23,00 (A3 einzeln rot, ohne Last).
    await page.waitForFunction(
        () => document.querySelector('[data-testid="route-planner"]')?.getAnimations().length === 0,
        undefined,
        { timeout: 10_000 },
    );
}

interface Kopf {
    /** Rollt die Übersicht gerade? */
    rollt: boolean;
    /** Breite, die der Balken dem Inhalt nimmt beziehungsweise als Rinne reserviert ist. */
    rinne: number;
    gutter: string;
    titelLeft: number;
    titelRight: number;
    linkLeft: number;
    linkRight: number;
    /** Ragt im Panel etwas seitlich über seinen Rand? */
    seitlich: boolean;
}

/** Der Kopf der Reiseübersicht im Bild: Titel, 🔗 und der Zustand des Rollbereichs. */
function kopf(page: Page): Promise<Kopf> {
    return page.evaluate(() => {
        const result = document.querySelector<HTMLElement>(".result--route");
        if (!result) throw new Error("Die Reiseübersicht rollt nicht - kein `.result--route`");
        const style = getComputedStyle(result);
        const border = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
        const rect = (selector: string): DOMRect => {
            const element = document.querySelector(selector);
            if (!element) throw new Error(`fehlt: ${selector}`);
            return element.getBoundingClientRect();
        };
        const titel = rect('[data-testid="route-title"]');
        const link = rect('[data-testid="route-share"]');
        const panel = document.querySelector<HTMLElement>("#route-planner-panel")!;
        const r = (value: number): number => Math.round(value * 100) / 100;
        return {
            rollt: result.scrollHeight > result.clientHeight + 1,
            rinne: r(result.offsetWidth - result.clientWidth - border),
            gutter: style.scrollbarGutter,
            titelLeft: r(titel.left),
            titelRight: r(titel.right),
            linkLeft: r(link.left),
            linkRight: r(link.right),
            seitlich: panel.scrollWidth > panel.clientWidth + 1 || result.scrollWidth > result.clientWidth + 1,
        };
    });
}

/** Titel und 🔗 stehen pixelgleich - das ist der Abnahmefall, nicht „sieht gut aus“. */
function gleicheStelle(a: Kopf, b: Kopf, was: string): void {
    expect(a.titelLeft, `${was}: Titel links`).toBeCloseTo(b.titelLeft, 1);
    expect(a.titelRight, `${was}: Titel rechts`).toBeCloseTo(b.titelRight, 1);
    expect(a.linkLeft, `${was}: 🔗 links`).toBeCloseTo(b.linkLeft, 1);
    expect(a.linkRight, `${was}: 🔗 rechts`).toBeCloseTo(b.linkRight, 1);
}

test("🔴 A1 Reise ohne Balken gegen Reise mit Balken: Kopf und 🔗 stehen pixelgleich", async ({ page }) => {
    await page.setViewportSize(HOCH);
    await openRoute(page, REISE);

    // Zugeklappte Etappen, hohes Fenster: Die Übersicht rollt nicht. Die Rinne steht trotzdem bereit.
    const ohne = await kopf(page);
    expect(ohne.rollt, "zugeklappt rollt die Übersicht nicht").toBe(false);
    expect(ohne.gutter, "die Rinne ist reserviert").toBe("stable");
    // 💣 Ohne diese Zeile prüfte der Fall nichts: Ein Balken ohne Breite kann nichts verschieben.
    expect(ohne.rinne, "der Balken nimmt in diesem Browser Breite").toBeGreaterThan(0);

    await openStageGroups(page);
    await settleStages(page);
    const mit = await kopf(page);
    expect(mit.rollt, "aufgeklappt rollt die Übersicht").toBe(true);
    expect(mit.rinne, "die Rinne ist dieselbe").toBeCloseTo(ohne.rinne, 1);
    gleicheStelle(ohne, mit, "ohne gegen mit Balken");
});

test("🔴 A2 Etappen auf- und zuklappen: der Kopf bewegt sich nicht", async ({ page }) => {
    await page.setViewportSize(HOCH);
    await openRoute(page, REISE);
    const stellen: Kopf[] = [await kopf(page)];
    for (let runde = 0; runde < 2; runde += 1) {
        await openStageGroups(page);
        await settleStages(page);
        stellen.push(await kopf(page));
        // Wieder zu: jeden offenen Gruppenkopf einmal anklicken.
        const offen = page.locator('[data-testid="route-stage-group"] [aria-expanded="true"]');
        for (let guard = 0; guard < 30; guard += 1) {
            const count = await offen.count();
            if (count === 0) break;
            await offen.first().click();
            await expect(offen).toHaveCount(count - 1);
        }
        await settleStages(page);
        stellen.push(await kopf(page));
    }
    for (const stelle of stellen.slice(1)) gleicheStelle(stellen[0]!, stelle, "beim Klappen");
});

test("🔴 A3 360 px, Reise mit vielen Etappen: kein seitlicher Überlauf, der Kopf bleibt stehen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openRoute(page, LANGE_REISE);
    const vorher = await kopf(page);
    expect(vorher.seitlich, "zugeklappt kein seitlicher Überlauf").toBe(false);
    await openStageGroups(page);
    await settleStages(page);
    const nachher = await kopf(page);
    expect(nachher.seitlich, "aufgeklappt kein seitlicher Überlauf").toBe(false);
    gleicheStelle(vorher, nachher, "360 px");
});

interface Kennzahlen {
    panelW: number;
    kastenH: number;
    kastenW: number;
    iconW: number;
    iconH: number;
    /** Die Kantenlänge, die der Kanon dafür führt. */
    kanon: string;
    zellen: { key: string; w: number; h: number; top: number; label: string; labelZeilen: number }[];
    /** Ragt der Kasten seitlich über das Panel? */
    seitlich: boolean;
}

/** Öffnet die erste Etappe, die alle drei Kennzahlen trägt (eine Etappe ohne Rast hat nur zwei). */
async function openDreiKacheln(page: Page): Promise<void> {
    await openStageGroups(page);
    const rows = page.getByTestId("route-stage");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    const count = await rows.count();
    for (let at = 0; at < count; at += 1) {
        await rows.nth(at).locator("img").first().click();
        await expect(page.getByTestId("stage-figures")).toBeVisible({ timeout: 20_000 });
        if ((await page.locator('[data-testid="stage-figures"] .kennzahl').count()) === 3) return;
    }
    throw new Error("keine Etappe mit drei Kennzahlen gefunden");
}

function kennzahlen(page: Page): Promise<Kennzahlen> {
    return page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-testid="stage-figures"]');
        if (!box) throw new Error("kein Kennzahlenkasten");
        const panel = document.querySelector<HTMLElement>('[data-testid="info-panel"]')!;
        const bild = box.querySelector<HTMLImageElement>(".kennzahl__bild")!;
        const r = (value: number): number => Math.round(value * 100) / 100;
        return {
            panelW: r(panel.getBoundingClientRect().width),
            kastenH: r(box.getBoundingClientRect().height),
            kastenW: r(box.getBoundingClientRect().width),
            iconW: r(bild.getBoundingClientRect().width),
            iconH: r(bild.getBoundingClientRect().height),
            kanon: getComputedStyle(document.documentElement)
                .getPropertyValue("--avesmaps-infopanel-figure-icon")
                .trim(),
            zellen: [...box.querySelectorAll<HTMLElement>(".kennzahl")].map((cell) => {
                const name = cell.querySelector<HTMLElement>(".kennzahl__name")!;
                const lh = Number.parseFloat(getComputedStyle(name).lineHeight);
                return {
                    key: cell.dataset["testid"] ?? "",
                    w: r(cell.getBoundingClientRect().width),
                    h: r(cell.getBoundingClientRect().height),
                    top: r(cell.getBoundingClientRect().top),
                    label: name.textContent?.trim() ?? "",
                    labelZeilen: Math.round(name.getBoundingClientRect().height / lh),
                };
            }),
            seitlich: box.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1,
        };
    });
}

test("🔴 A4 Etappenkopf, drei Kacheln: das Zeichen steht auf 150 %, Zahl und Beschriftung unverändert", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openRoute(page, LANGE_REISE);
    await openDreiKacheln(page);
    const mass = await kennzahlen(page);

    // 🔴 Das Maß kommt aus dem Kanon (`infoPanel.figureIcon`), nicht aus der Vorlage - und es ist genau 150 % von
    // `icon.lg` (24 px). Beides wird gemessen, damit eine Zahl in der Vorlage auffiele.
    expect(mass.kanon, "der Kanon führt das Maß").toBe("36px");
    expect(mass.iconW, "Breite des Zeichens").toBeCloseTo(36, 1);
    expect(mass.iconH, "Höhe des Zeichens").toBeCloseTo(36, 1);
    const lg = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--icon-lg")),
    );
    expect(mass.iconW / lg, "150 % von icon.lg").toBeCloseTo(1.5, 2);

    // Zahl und Beschriftung bleiben, wie sie waren: eine Zeile, keine andere Schriftgröße.
    expect(mass.zellen.map((zelle) => zelle.label)).toEqual(["Meilen", "Reisezeit", "Rastzeit"]);
    for (const zelle of mass.zellen) expect(zelle.labelZeilen, `${zelle.label}: eine Zeile`).toBe(1);
    const schrift = await page.evaluate(() => {
        const name = document.querySelector('[data-testid="stage-figures"] .kennzahl__name')!;
        const wert = document.querySelector('[data-testid="stage-figures"] .kennzahl__wert')!;
        return { name: getComputedStyle(name).fontSize, wert: getComputedStyle(wert).fontSize };
    });
    // `--font-size-small` und `--font-size-title` des Kanons, unverändert.
    expect(schrift).toEqual({ name: "12px", wert: "20px" });
});

test("🔴 A5 360 px, drei Kacheln nebeneinander: kein Umbruch, keine andere Breite, die Höhe steht im Bericht", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await openRoute(page, LANGE_REISE);
    await openDreiKacheln(page);
    const mass = await kennzahlen(page);

    // Drei Spalten nebeneinander: dieselbe Oberkante, dieselbe Breite, keine ragt aus dem Panel.
    expect(mass.zellen).toHaveLength(3);
    for (const zelle of mass.zellen) {
        expect(zelle.top, `${zelle.label}: dieselbe Zeile`).toBeCloseTo(mass.zellen[0]!.top, 1);
        expect(zelle.w, `${zelle.label}: gleich breit`).toBeCloseTo(mass.zellen[0]!.w, 0);
        expect(zelle.labelZeilen, `${zelle.label}: eine Zeile`).toBe(1);
    }
    expect(mass.seitlich, "kein seitlicher Überlauf").toBe(false);

    /*
     * 🪤 Die Kachel WIRD höher - zwangsläufig, das Zeichen wächst um 12 px (gemessen 90 → 102 px, der Kasten
     * 92 → 104 px; die Breite bleibt bei 92,33 px je Spalte). Der Fall A5 des Work Items verlangte „keine höhere
     * Kachel als heute“; das kann bei einem größeren Zeichen nicht gelten und ist im Work Item als Widerspruch
     * benannt. Geprüft wird stattdessen, was zählt: Die drei stehen nebeneinander, nichts bricht um, nichts läuft
     * über - und die Höhe bleibt in der gemessenen Schranke, damit sie nicht unbemerkt weiterwächst.
     */
    expect(mass.zellen[0]!.h, "Höhe der Kachel").toBeLessThanOrEqual(105);
    expect(mass.kastenH, "Höhe des Kastens").toBeLessThanOrEqual(107);
});

/** Die fünf Deckel der Routendetails sind die Vergleichsgruppe: dieselbe Rezeptur heißt dieselben Werte. */
const REZEPT = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontSize",
    "borderTopLeftRadius",
    "gap",
    "alignItems",
] as const;

function rezeptur(page: Page, testid: string): Promise<Record<string, string>> {
    return page.evaluate(
        ({ id, keys }) => {
            const box = document.querySelector(`[data-testid="${id}"]`);
            if (!box) throw new Error(`Klappbox fehlt: ${id}`);
            const head = box.querySelector("summary")!;
            const body = box.querySelector(".disclosure__content")!;
            const headStyle = getComputedStyle(head);
            const bodyStyle = getComputedStyle(body);
            const out: Record<string, string> = {};
            for (const key of keys) out[`kopf.${key}`] = headStyle[key as never] as string;
            for (const key of keys) out[`rumpf.${key}`] = bodyStyle[key as never] as string;
            out["rahmen"] = getComputedStyle(box).border;
            out["grund"] = getComputedStyle(box).backgroundColor;
            return out;
        },
        { id: testid, keys: [...REZEPT] },
    );
}

/** Steht der Titel in seinem Kasten an derselben Stelle wie vorher? Das ist „der Header bleibt stabil“. */
function titelImKasten(page: Page, testid: string): Promise<number> {
    return page.evaluate((id) => {
        const box = document.querySelector(`[data-testid="${id}"]`)!;
        const titel = box.querySelector(".disclosure__labels")!.firstElementChild!;
        return Math.round((titel.getBoundingClientRect().top - box.getBoundingClientRect().top) * 100) / 100;
    }, testid);
}

/** Die Höhe der Kopfzeile selbst - sie soll sich beim Klappen nicht ändern. */
function kopfHoehe(page: Page, testid: string): Promise<number> {
    return page.evaluate((id) => {
        const head = document.querySelector(`[data-testid="${id}"]`)!.querySelector("summary")!;
        return Math.round(head.getBoundingClientRect().height * 100) / 100;
    }, testid);
}

for (const [box, titel, zusammenfassung] of [
    ["transport", "Transportmittel", /Schnellste Route|Kürzeste Route/],
    ["options", "Reiseoptionen", /h\/Tag/],
] as const) {
    test(`🔴 A6/A7 „${titel}“: Gestalt wie die übrigen Klappboxen, der Kopf bleibt beim Aufklappen stehen`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 1000 });
        await openRoute(page, REISE);
        const testid = `planner-${box}`;

        // Zugeklappt: Titel und Zusammenfassung stehen da - „eine eingeklappte Leiste ist nie leer“ (Guide §16.3).
        await closePlannerBox(page, box as PlannerBox);
        const zu = await titelImKasten(page, testid);
        const zuHoch = await kopfHoehe(page, testid);
        const kurz = plannerBox(page, box as PlannerBox).locator(".disclosure__secondary");
        await expect(kurz).toHaveText(zusammenfassung);
        await expect(plannerBox(page, box as PlannerBox)).toContainText(titel);

        /*
         * Aufgeklappt: Der Titel steht an derselben Stelle in seinem Kasten. Die Zusammenfassung ist dann WEG - seit dem
         * Nachgang vom 2026-10-06 („die brauchen wir nur wenn sie eingeklappt ist“); gemessen wird sie dort von
         * `planer-nachgang.spec.ts` N3.
         */
        await openPlannerBox(page, box as PlannerBox);
        expect(await titelImKasten(page, testid), "der Kopf bewegt sich nicht").toBeCloseTo(zu, 1);
        /*
         * 🔴 **Und er behält seine Höhe.** Seit dem Nachgang vom 2026-10-06 trägt die ganze einzeilige Kopfzeile die
         * Zeilenhöhe eines Symbols, nicht nur die Kurzangabe; ohne Kurzangabe trägt der Titel die Zeile dann allein.
         * Vorher schrumpfte der Kopf beim Aufklappen von 22,00 auf 19,75 px, weil die 16-px-Zeile mit der Kurzangabe
         * verschwand.
         */
        expect(await kopfHoehe(page, testid), "der Kopf behält seine Höhe").toBeCloseTo(zuHoch, 1);
        await expect(kurz).toHaveCount(0);
        await expect(plannerBox(page, box as PlannerBox)).toContainText(titel);

        // Und wieder zu: dieselbe Stelle, und die Zusammenfassung ist zurück.
        await closePlannerBox(page, box as PlannerBox);
        expect(await titelImKasten(page, testid), "auch wieder zugeklappt").toBeCloseTo(zu, 1);
        await expect(kurz).toHaveText(zusammenfassung);
    });
}

test("🔴 A8 beide Klappboxen: dieselbe Rezeptur wie die Deckel der Routendetails, kein eigener Wert", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openRoute(page, REISE);
    await openPlannerBox(page, "transport");
    await openPlannerBox(page, "options");
    await page.getByTestId("costs-toggle").click();
    await page.getByTestId("profile-toggle").click();
    await page.waitForTimeout(400);

    const vorbild = await rezeptur(page, "planning-costs");
    for (const testid of ["planning-profile", "planner-transport", "planner-options"]) {
        expect(await rezeptur(page, testid), `${testid} folgt derselben Rezeptur`).toEqual(vorbild);
    }

    /*
     * Der Abstand zwischen den beiden Boxen ist der Takt des Panels selbst (`.planner { gap: --space-6 }`, 8 px) -
     * kein eigener Wert. Der Rahmenkasten trug zusätzlich `--space-2` für den Überstand seiner Aufschrift; mit der
     * Aufschrift fällt er weg (gemessen 12 → 8 px). Die 29/26 px aus WI-0088 sind der Takt der Panelabschnitte
     * (`info-section.vue`), nicht der des Planers; siehe Befund im Work Item.
     */
    const abstand = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="planner-transport"]')!.getBoundingClientRect();
        const o = document.querySelector('[data-testid="planner-options"]')!.getBoundingClientRect();
        const gap = Number.parseFloat(getComputedStyle(document.querySelector("#route-planner-panel")!).rowGap);
        return { gemessen: Math.round((o.top - t.bottom) * 100) / 100, gap };
    });
    expect(abstand.gemessen, "der Abstand ist der `gap` des Panels").toBeCloseTo(abstand.gap, 1);
});

test("🔴 A9 Tastatur und Vorleser: beide Boxen sind als aufklappbar angekündigt", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openRoute(page, REISE);
    for (const box of ["transport", "options"] as const) {
        const toggle = plannerBoxToggle(page, box);
        await closePlannerBox(page, box);
        await expect(toggle, `${box}: zugeklappt angekündigt`).toHaveAttribute("aria-expanded", "false");

        // Mit der Tastatur: Fokus auf die Kopfzeile, Enter klappt auf.
        await toggle.focus();
        await expect(toggle).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(toggle, `${box}: aufgeklappt angekündigt`).toHaveAttribute("aria-expanded", "true");
        // Native `<details>`: der Inhalt ist für den Vorleser erreichbar, der Rumpf steht im Baum.
        expect(
            await page.evaluate(
                (id) => document.querySelector(`[data-testid="${id}"]`)?.hasAttribute("open"),
                `planner-${box}`,
            ),
            `${box}: das Element selbst ist offen`,
        ).toBe(true);
        // Mit Leertaste wieder zu.
        await page.keyboard.press(" ");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }

    // Das ⓘ gehört zur Kopfzeile, klappt sie aber nicht mit (WI-0045).
    await openPlannerBox(page, "transport");
    await page.getByTestId("transport-info-open").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(plannerBoxToggle(page, "transport")).toHaveAttribute("aria-expanded", "true");
});

test("💣 A10 ohne Reise: die Höhe des Kopfes hängt nicht am Rollbalken, sonst zappelt der Balken", async ({ page }) => {
    // Betreiber 2026-10-10: „der routenplaner … zeig zappelnd den scrollbalken“, „nach dem zusammenklappen ist er da, beim
    // hovern wieder nicht“. Gemessen bei 1400 × 626 ohne Reise: Die Wortmarke stand auf 95 % der INNENbreite. Ohne Balken war der
    // Kopf 119,61 px hoch, der Inhalt 607,28 px und lief über (Platz 603,48) - also kam der Balken. Mit Balken (15 px schmaler)
    // schrumpfte die Wortmarke, der Kopf wurde 115,81 px hoch, der Inhalt passte genau - also ging der Balken wieder. Welcher
    // Zustand stehen blieb, entschied die letzte Neuberechnung (Zuklappen, Hover). Die Wächterregel: Die Kopfhöhe ist mit und
    // ohne Balken dieselbe, dann gibt es keine Rückkopplung mehr.
    await page.setViewportSize({ width: 1400, height: 626 });
    await page.goto("/");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    const heads = await page.evaluate(() => {
        const panel = document.getElementById("route-planner-panel") as HTMLElement;
        const head = panel.querySelector(".planner__head") as HTMLElement;
        const measure = (overflow: string): { head: number; gutter: number } => {
            panel.style.overflowY = overflow;
            const gutter = panel.offsetWidth - panel.clientWidth;
            return { head: head.getBoundingClientRect().height, gutter };
        };
        const withBar = measure("scroll");
        const withoutBar = measure("hidden");
        panel.style.overflowY = "";
        return { withBar, withoutBar };
    });
    // Ohne `--hide-scrollbars` nimmt der Balken echte Breite, sonst bewiese der Fall nichts.
    expect(heads.withBar.gutter).toBeGreaterThan(0);
    expect(heads.withoutBar.gutter).toBe(0);
    expect(Math.abs(heads.withBar.head - heads.withoutBar.head)).toBeLessThan(0.5);
});
