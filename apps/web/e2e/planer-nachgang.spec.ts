import { expect, test, type Page } from "@playwright/test";
import { openMap } from "./map-handle.ts";
import { openStageGroups, settleStages } from "./stage-groups.ts";
import { closePlannerBox, openPlannerBox, type PlannerBox } from "./planner-boxes.ts";

/**
 * Die Nachgänge zu WI-0089 am echten Stack (Betreiber 2026-10-06, nachdem er das Blatt gesehen hat):
 *
 * - **N1 (P2):** „bei 360px kannst du die schrift der zahlen kleiner machen, damit die zahlen in die spalten passen“.
 * - **N2 (P3):** „wir wollen den einzeiligen header (zugeklappt) lassen … aber halt einzeilig“.
 * - **N3 (P3):** „was wir nicht brauchen ist die zusammenfassung unter dem header von einstellungen, die drunter
 *   sowieso schon stehen. die brauchen wir nur wenn sie eingeklappt ist“.
 * - **N4 (P3):** „achte darauf dass das (i) und das pfeilchen nach unten vertikal gleich auf liegen“.
 * - **N5 (P4):** „alle 2 zeiligen lösungen von ‚änderungen vorschlagen‘: passt“.
 */

const REISE = "?route=Gareth~Greifenfurt";
const LANGE_REISE = "?route=Thorwal~Al'Anfa";
const RECHNER = { width: 1280, height: 1000 };
const TELEFON = { width: 360, height: 900 };

async function openRoute(page: Page, search: string): Promise<void> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-title")).toBeVisible({ timeout: 30_000 });
    const tab = page.getByTestId("route-planner-tab");
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
}

/** Öffnet die erste Etappe mit allen drei Kennzahlen (eine Etappe ohne Rast hat nur zwei). */
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

interface Kennzahl {
    key: string;
    text: string;
    wertW: number;
    /** Platz in der Spalte, ohne ihr Polster. */
    platz: number;
    wertSchrift: string;
    nameSchrift: string;
    nameZeilen: number;
}

function kennzahlen(page: Page): Promise<Kennzahl[]> {
    return page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('[data-testid="stage-figures"]');
        if (!box) throw new Error("kein Kennzahlenkasten");
        const r = (value: number): number => Math.round(value * 100) / 100;
        return [...box.querySelectorAll<HTMLElement>(".kennzahl")].map((cell) => {
            const wert = cell.querySelector<HTMLElement>(".kennzahl__wert")!;
            const name = cell.querySelector<HTMLElement>(".kennzahl__name")!;
            const stil = getComputedStyle(cell);
            return {
                key: cell.dataset["testid"] ?? "",
                text: wert.textContent?.trim() ?? "",
                wertW: r(wert.getBoundingClientRect().width),
                platz: r(
                    cell.getBoundingClientRect().width -
                        Number.parseFloat(stil.paddingLeft) -
                        Number.parseFloat(stil.paddingRight),
                ),
                wertSchrift: getComputedStyle(wert).fontSize,
                nameSchrift: getComputedStyle(name).fontSize,
                nameZeilen: Math.round(
                    name.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(name).lineHeight),
                ),
            };
        });
    });
}

test("🔴 N1 bei 360 px passt jede Zahl in ihre Spalte, am Rechner bleibt sie groß", async ({ page }) => {
    test.setTimeout(300_000);

    // Am Rechner unverändert: die Zahl in `--font-size-title`, die Beschriftung in `--font-size-small`.
    await page.setViewportSize(RECHNER);
    await openRoute(page, LANGE_REISE);
    await openDreiKacheln(page);
    for (const zahl of await kennzahlen(page)) {
        expect(zahl.wertSchrift, `${zahl.key}: Zahl am Rechner`).toBe("20px");
        expect(zahl.nameSchrift, `${zahl.key}: Beschriftung am Rechner`).toBe("12px");
    }

    // Bei 360 px fällt die Zahl auf die nächste Sprosse des Kanons; die Beschriftung bleibt, wie sie war.
    await page.setViewportSize(TELEFON);
    await openRoute(page, LANGE_REISE);
    await openDreiKacheln(page);
    const kacheln = await kennzahlen(page);
    expect(kacheln.length, "drei Kennzahlen").toBe(3);
    for (const zahl of kacheln) {
        expect(zahl.wertSchrift, `${zahl.key}: Zahl bei 360 px`).toBe("16px");
        expect(zahl.nameSchrift, `${zahl.key}: Beschriftung bei 360 px`).toBe("12px");
        expect(zahl.nameZeilen, `${zahl.key}: Beschriftung einzeilig`).toBe(1);
        expect(zahl.wertW, `${zahl.key} „${zahl.text}“ in ${String(zahl.platz)} px`).toBeLessThanOrEqual(zahl.platz);
    }

    /*
     * 🔴 Und zwar nicht nur für die eine geöffnete Etappe: Jede Auswahl fliegt die Kamera, deshalb werden die Zahlen
     * ALLER Etappen mehrerer Reisen ohne Klick aus den Zeilen gelesen (`.wert__zahl`, dieselben Formatierer) und in
     * der echten Schrift der Kennzahl vermessen. Gemessen am 2026-10-06: 190 Texte, der breiteste „202,50 h“ mit
     * 69,86 px bei 16 px gegen 80,33 px Spaltenplatz - bei 20 px wären es 87,33 px gewesen.
     */
    const texte = new Set<string>();
    for (const route of [LANGE_REISE, "?route=Gareth~Fasar", "?route=Riva~Al'Anfa"]) {
        await openRoute(page, route);
        await openStageGroups(page);
        for (const text of await page.evaluate(() =>
            [...document.querySelectorAll('[data-testid="route-stage"] .wert__zahl')].map((zahl) =>
                (zahl.textContent ?? "").trim(),
            ),
        )) {
            if (text === "") continue;
            texte.add(text);
            // Reise- und Rastzeit tragen in der Kachel ihre Einheit mit.
            texte.add(`${text} h`);
        }
    }
    expect(texte.size, "es wurden Zahlen geerntet").toBeGreaterThan(50);

    const breiteste = await page.evaluate(
        ({ liste, platz }) => {
            const wert = document.querySelector<HTMLElement>(".kennzahl__wert");
            const probe = document.createElement("span");
            probe.style.position = "absolute";
            probe.style.visibility = "hidden";
            probe.style.whiteSpace = "pre";
            if (wert) {
                const stil = getComputedStyle(wert);
                probe.style.font = stil.font;
                probe.style.fontVariantNumeric = stil.fontVariantNumeric;
                probe.style.letterSpacing = stil.letterSpacing;
            }
            document.body.append(probe);
            let text = "";
            let breite = 0;
            for (const kandidat of liste) {
                probe.textContent = kandidat;
                const w = probe.getBoundingClientRect().width;
                if (w > breite) {
                    breite = w;
                    text = kandidat;
                }
            }
            probe.remove();
            return { text, breite: Math.round(breite * 100) / 100, platz };
        },
        { liste: [...texte], platz: kacheln[0]!.platz },
    );
    expect(
        breiteste.breite,
        `die breiteste Zahl „${breiteste.text}“ passt in ${String(breiteste.platz)} px`,
    ).toBeLessThanOrEqual(breiteste.platz);
});

interface Kurzangabe {
    da: boolean;
    text: string | null;
    titel: string | null;
    zeilen: number;
    hoehe: number;
    zeilenhoehe: number;
    umbruch: string;
    kopfH: number;
}

function kurzangabe(page: Page, box: PlannerBox): Promise<Kurzangabe> {
    return page.evaluate((testid) => {
        const element = document.querySelector(`[data-testid="${testid}"]`)!;
        const kopf = element.querySelector<HTMLElement>("summary")!;
        const sec = element.querySelector<HTMLElement>(".disclosure__secondary");
        /*
         * 🪤 Gezählt wird über die HÖHE der Kurzangabe, nicht über Textrechtecke: Ihre Symbole (16 px, `vertical-align:
         * top`) liegen über der Grundlinie und ergeben eigene Rechtecke mit eigener Oberkante - eine einzige Zeile
         * zählte damit als zwei. Die Zeilenhöhe der Zeile ist der Maßstab.
         */
        const zeilenhoehe = sec === null ? 0 : Number.parseFloat(getComputedStyle(sec).lineHeight);
        const secH = sec?.getBoundingClientRect().height ?? 0;
        return {
            da: sec !== null,
            text: sec?.textContent?.trim() ?? null,
            titel: sec?.getAttribute("title") ?? null,
            zeilen: zeilenhoehe > 0 ? Math.max(1, Math.round(secH / Math.max(zeilenhoehe, 16))) : 0,
            hoehe: Math.round(secH * 100) / 100,
            zeilenhoehe: Math.round(zeilenhoehe * 100) / 100,
            umbruch: sec === null ? "" : getComputedStyle(sec).whiteSpace,
            kopfH: Math.round(kopf.getBoundingClientRect().height * 100) / 100,
        };
    }, `planner-${box}`);
}

for (const [breite, size] of [
    ["Rechner", RECHNER],
    ["360 px", TELEFON],
] as const) {
    test(`🔴 N2 zugeklappt bleibt die Kurzangabe EINE Zeile und kürzt am Ende (${breite})`, async ({ page }) => {
        await page.setViewportSize(size);
        await openRoute(page, REISE);
        for (const box of ["transport", "options"] as const) {
            await closePlannerBox(page, box);
            const mass = await kurzangabe(page, box);
            expect(mass.da, `${box}: die Kurzangabe steht da`).toBe(true);
            expect(mass.umbruch, `${box}: sie bricht nicht um`).toBe("nowrap");
            expect(
                mass.zeilen,
                `${box}: eine Zeile (Kurzangabe ${String(mass.hoehe)} px, Zeilenhöhe ${String(mass.zeilenhoehe)} px)`,
            ).toBe(1);
            // Der volle Text geht nicht verloren: er steht im DOM und im `title`.
            expect(mass.titel, `${box}: der volle Text im title`).toBe(mass.text);
            expect((mass.text ?? "").length, `${box}: der Text ist da`).toBeGreaterThan(0);
        }
        // „Transportmittel“ trägt die lange Zusammenfassung; ihre Leiste bleibt so hoch wie die kurze von „Reiseoptionen“.
        const lang = await kurzangabe(page, "transport");
        const kurzBox = await kurzangabe(page, "options");
        expect(lang.kopfH, "beide Leisten gleich hoch").toBeCloseTo(kurzBox.kopfH, 1);
    });
}

test("🔴 N3 aufgeklappt entfällt die Kurzangabe, zugeklappt ist sie wieder da", async ({ page }) => {
    await page.setViewportSize(RECHNER);
    await openRoute(page, REISE);
    for (const box of ["transport", "options"] as const) {
        await closePlannerBox(page, box);
        expect((await kurzangabe(page, box)).da, `${box}: zugeklappt da`).toBe(true);
        await openPlannerBox(page, box);
        expect((await kurzangabe(page, box)).da, `${box}: aufgeklappt weg`).toBe(false);
        await closePlannerBox(page, box);
        expect((await kurzangabe(page, box)).da, `${box}: wieder da`).toBe(true);
    }

    /*
     * 🪤 Die Deckel der Routendetails behalten ihre Kurzangabe im offenen Zustand - dort nennt sie das Ergebnis, nicht
     * eine Eingabe, die gleich darunter wieder auftaucht. Ohne diesen Gegenfall wäre nicht gesichert, dass die zwei
     * neuen Eigenschaften nur für die beiden Kästen des Planers gelten.
     */
    await page.getByTestId("costs-toggle").click();
    await page.waitForTimeout(400);
    const deckel = page.getByTestId("planning-costs");
    await expect(deckel.locator("summary")).toHaveAttribute("aria-expanded", "true");
    await expect(deckel.locator(".disclosure__secondary")).toHaveCount(1);
});

/** Die Mitte der Kästen von ⓘ und Winkel; die Tinte liegt in beiden mittig (16 × 16 Bild, Winkel 0,17 px daneben). */
function zeichenMitten(page: Page, box: PlannerBox): Promise<{ info: number; pfeil: number; versatz: number }> {
    return page.evaluate((testid) => {
        const element = document.querySelector(`[data-testid="${testid}"]`)!;
        const i = element.querySelector(".disclosure__info")!.getBoundingClientRect();
        const p = element.querySelector(".disclosure__arrow")!.getBoundingClientRect();
        const r = (value: number): number => Math.round(value * 100) / 100;
        return {
            info: r(i.top + i.height / 2),
            pfeil: r(p.top + p.height / 2),
            versatz: r(i.top + i.height / 2 - (p.top + p.height / 2)),
        };
    }, `planner-${box}`);
}

for (const scheme of ["light", "dark"] as const) {
    for (const [breite, size] of [
        ["Rechner", RECHNER],
        ["360 px", TELEFON],
    ] as const) {
        test(`🔴 N4 ⓘ und ▾ liegen auf derselben Mitte (${scheme}, ${breite})`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await page.setViewportSize(size);
            await openRoute(page, REISE);
            for (const box of ["transport", "options"] as const) {
                for (const offen of [false, true]) {
                    if (offen) await openPlannerBox(page, box);
                    else await closePlannerBox(page, box);
                    const mass = await zeichenMitten(page, box);
                    // Vorher lagen sie 3,50 px auseinander (gemessen 2026-10-06, in beiden Kästen gleich).
                    expect(
                        Math.abs(mass.versatz),
                        `${box}, ${offen ? "auf" : "zu"}: ⓘ bei ${String(mass.info)}, ▾ bei ${String(mass.pfeil)}`,
                    ).toBeLessThanOrEqual(0.5);
                }
            }
        });
    }
}

const SUBJECTS = [
    { name: "Ort", ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" } },
    { name: "Weg", ref: { kind: "path", chain: "Misamunder Straße:Strasse" } },
    { name: "Gebiet", ref: { kind: "territory", id: "3359118f-bdfe-4569-8277-3f25c2d62463" } },
    { name: "Kartenpunkt", ref: { kind: "mapPoint", x: 551.6, y: 520.5 } },
] as const;

test("🔴 N5 das Band läuft bei 360 px nicht über das Panel hinaus", async ({ page }) => {
    await page.setViewportSize(TELEFON);
    await openMap(page);
    await page.evaluate(() =>
        globalThis.avesmapsOpenSubject?.({ kind: "path", chain: "Misamunder Straße:Strasse" } as never),
    );
    await expect(page.getByTestId("info-actions")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const ueber = await page.evaluate(() => {
        const band = document.querySelector<HTMLElement>('[data-testid="info-actions"]')!;
        const panel = document.querySelector<HTMLElement>('[data-testid="info-panel"]')!;
        return {
            seitlich: band.scrollWidth > band.clientWidth + 1,
            ausDemPanel: band.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1,
        };
    });
    expect(ueber.seitlich, "das Band rollt nicht seitlich").toBe(false);
    expect(ueber.ausDemPanel, "das Band bleibt im Panel").toBe(false);
});

/*
 * ---- Der zweite Nachgang (Betreiber 2026-10-06, nachdem er das Nachtragsblatt gesehen hat) --------------------
 *
 * - **O1:** „ja, mach die zwei reihen beim weg“.
 * - **O2:** zuerst „kannst du hier noch ein bisschen abstand einfügen (soviel wie zwischen ‚Reiseoptionen‘ und
 *   ‚Reiseübersicht‘“ (roter Pfeil über „Transportmittel“), dann mit drei Pfeilen nachgelegt: „kannst du hier überall
 *   dieselben abstände machen“ - also ein Wert für die ganze Spalte.
 * - **O5:** „die unteren border corners von diesen elementen sind noch rund obwohl das ding ausgeklappt ist“.
 * - **O3/O4:** „wenn das reisedatum unbekannt ist (ich würde es umbennen in ‚unbestimmt‘) sollte das auch im header
 *   stehen. Gemeinschaftszimmer kann auch dranstehen … halt mit ‚…‘“.
 */

for (const [breite, size] of [
    ["Rechner", RECHNER],
    ["360 px", TELEFON],
] as const) {
    test(`🔴 O1 vier Kacheln stehen in zwei Reihen, die anderen Objektarten in einer (${breite})`, async ({ page }) => {
        test.setTimeout(300_000);
        await page.setViewportSize(size);
        await openMap(page);
        for (const subject of SUBJECTS) {
            await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref as never), subject.ref);
            await expect(page.getByTestId("info-actions")).toBeVisible({ timeout: 30_000 });
            await page.waitForTimeout(300);
            const band = await page.evaluate(() => {
                const r = (value: number): number => Math.round(value * 100) / 100;
                const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid="info-actions"] .info-tile')];
                return {
                    anzahl: tiles.length,
                    reihen: new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top))).size,
                    spalten: new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))).size,
                    kacheln: tiles.map((tile) => {
                        const label = tile.querySelector<HTMLElement>(".info-tile__label")!;
                        const kasten = tile.getBoundingClientRect();
                        return {
                            label: label.textContent?.trim() ?? "",
                            w: r(kasten.width),
                            h: r(kasten.height),
                            verhaeltnis: r(kasten.height / kasten.width),
                            zeilen: Math.round(
                                label.getBoundingClientRect().height /
                                    Number.parseFloat(getComputedStyle(label).lineHeight),
                            ),
                        };
                    }),
                };
            });

            if (band.anzahl === 4) {
                // Der Weg: zwei Reihen à zwei Kacheln.
                expect(band.reihen, `${subject.name}: zwei Reihen`).toBe(2);
                expect(band.spalten, `${subject.name}: zwei Spalten`).toBe(2);
            } else {
                // 🪤 Alles andere bleibt unberührt: eine Reihe, so viele Spalten wie Kacheln.
                expect(band.reihen, `${subject.name}: eine Reihe`).toBe(1);
                expect(band.spalten, `${subject.name}: Spalten gleich Kacheln`).toBe(band.anzahl);
            }
            // Und überall reichen jetzt zwei Zeilen - das war die Zusage.
            for (const kachel of band.kacheln) {
                expect(
                    kachel.zeilen,
                    `${subject.name} · „${kachel.label}“ (${String(kachel.w)} × ${String(kachel.h)} px)`,
                ).toBeLessThanOrEqual(2);
                expect(kachel.verhaeltnis, `${subject.name} · „${kachel.label}“: nicht länglich`).toBeLessThanOrEqual(
                    1.25,
                );
            }
        }
    });
}

test("🔴 O2 die Spalte des Planers trägt EINEN Abstand - alle fünf gleich, aus ihrem `gap`", async ({ page }) => {
    await page.setViewportSize(RECHNER);
    await openRoute(page, REISE);
    const mass = await page.evaluate(() => {
        const r = (value: number): number => Math.round(value * 100) / 100;
        const planer = document.querySelector<HTMLElement>(".planner")!;
        const kinder = [...planer.children] as HTMLElement[];
        const abstaende: { zwischen: string; px: number }[] = [];
        for (let at = 1; at < kinder.length; at += 1) {
            abstaende.push({
                zwischen: `${kinder[at - 1]!.className.split(" ")[0] ?? ""} -> ${kinder[at]!.className.split(" ")[0] ?? ""}`,
                px: r(kinder[at]!.getBoundingClientRect().top - kinder[at - 1]!.getBoundingClientRect().bottom),
            });
        }
        return {
            gap: Number.parseFloat(getComputedStyle(planer).rowGap),
            abstaende,
            // Kein Kind nimmt sich einen eigenen senkrechten Rand - sonst wäre die Spalte wieder uneinheitlich.
            raender: kinder.map((kind) => ({
                was: kind.className.split(" ")[0] ?? "",
                oben: getComputedStyle(kind).marginTop,
                unten: getComputedStyle(kind).marginBottom,
            })),
        };
    });

    /*
     * Gemessen am 2026-10-06 trug die Spalte ZWEI Werte: viermal die 8 px ihres `gap` und einmal 12 px, weil die
     * Reiseübersicht sich zusätzlich `margin-top: var(--space-2)` nahm. Genau die 12 hatte der Betreiber als Maß
     * genannt; seit sie der `gap` der Spalte ist (`--space-10`), sind alle fünf gleich und der Rand ist weg.
     */
    expect(mass.abstaende.length, "fünf Abstände").toBe(5);
    for (const abstand of mass.abstaende) {
        expect(abstand.px, `${abstand.zwischen}: ${String(abstand.px)} px`).toBeCloseTo(mass.gap, 1);
    }
    expect(mass.gap, "und der `gap` ist die Sprosse --space-10").toBe(12);
    for (const rand of mass.raender) {
        expect(rand.oben, `${rand.was}: kein eigener Rand oben`).toBe("0px");
        expect(rand.unten, `${rand.was}: kein eigener Rand unten`).toBe("0px");
    }
});

test("🔴 O3/O4 die Leiste „Reiseoptionen“ nennt alle drei Einstellungen in der Reihenfolge des Kastens", async ({
    page,
}) => {
    await page.setViewportSize(RECHNER);
    await openRoute(page, REISE);
    await closePlannerBox(page, "options");

    // Ohne Datum: dasselbe Wort wie in der Auswahl selbst.
    const ohne = await kurzangabe(page, "options");
    expect(ohne.text, "ohne Reisebeginn").toBe("8,0 h/Tag · Unbestimmt · Gemeinschaftszimmer");
    expect(ohne.zeilen, "eine Zeile").toBe(1);
    expect(ohne.titel, "der volle Text im title").toBe(ohne.text);
    // Die Auswahl im Kasten trägt dasselbe Wort - kein zweites dafür.
    await openPlannerBox(page, "options");
    await expect(page.getByTestId("travel-start-month")).toHaveText("Unbestimmt");

    // 🪤 Mit gesetztem Datum steht das DATUM da, nicht der Vorgabetext.
    await openRoute(page, "?route=Gareth~Greifenfurt&startMonth=firun&startDay=15");
    await closePlannerBox(page, "options");
    const mit = await kurzangabe(page, "options");
    expect(mit.text, "mit Reisebeginn").toBe("8,0 h/Tag · ab 15. Firun · Gemeinschaftszimmer");
    expect(mit.zeilen, "immer noch eine Zeile").toBe(1);

    // Und die Leiste bleibt so hoch wie die von „Transportmittel“.
    await closePlannerBox(page, "transport");
    expect((await kurzangabe(page, "transport")).kopfH, "beide Leisten gleich hoch").toBeCloseTo(mit.kopfH, 1);
});

test("🔴 O5 ein aufgeklappter Gruppenkopf hat eckige untere Ecken, zugeklappt runde", async ({ page }) => {
    await page.setViewportSize(RECHNER);
    await openRoute(page, LANGE_REISE);
    const kopf = page.locator('[data-testid="route-stage-group"] .group__head').first();
    await expect(kopf).toBeVisible({ timeout: 20_000 });

    /** Die vier Radien des Kopfes, wie der Browser sie rechnet - nicht wie es aussieht. */
    const radien = (): Promise<{ offen: string | null; obenLinks: string; untenLinks: string; untenRechts: string }> =>
        page.evaluate(() => {
            const element = document.querySelector<HTMLElement>('[data-testid="route-stage-group"] .group__head')!;
            const stil = getComputedStyle(element);
            return {
                offen: element.getAttribute("aria-expanded"),
                obenLinks: stil.borderTopLeftRadius,
                untenLinks: stil.borderBottomLeftRadius,
                untenRechts: stil.borderBottomRightRadius,
            };
        });

    // Zugeklappt: Der Kopf steht für sich, rundum gerundet.
    if ((await kopf.getAttribute("aria-expanded")) === "true") await kopf.click();
    await page.waitForTimeout(300);
    const zu = await radien();
    expect(zu.offen).toBe("false");
    expect(zu.untenLinks, "zugeklappt unten links rund").toBe(zu.obenLinks);
    expect(zu.untenRechts, "zugeklappt unten rechts rund").toBe(zu.obenLinks);
    expect(Number.parseFloat(zu.obenLinks), "und der Radius ist nicht 0").toBeGreaterThan(0);

    // Aufgeklappt: Der Rumpf schließt an, die unteren Ecken werden eckig - die oberen bleiben.
    await kopf.click();
    await settleStages(page);
    await page.waitForTimeout(200);
    const auf = await radien();
    expect(auf.offen).toBe("true");
    expect(auf.obenLinks, "oben unverändert").toBe(zu.obenLinks);
    expect(auf.untenLinks, "aufgeklappt unten links eckig").toBe("0px");
    expect(auf.untenRechts, "aufgeklappt unten rechts eckig").toBe("0px");

    // 🔴 Dieselbe Aussage, EINE Rezeptur: Die Klappboxen des Panels tragen dieselbe Hausklasse.
    await openPlannerBox(page, "options");
    const deckel = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[data-testid="planner-options"] summary')!;
        const stil = getComputedStyle(element);
        return {
            klasse: element.classList.contains("avm-kopf-offen"),
            untenLinks: stil.borderBottomLeftRadius,
            untenRechts: stil.borderBottomRightRadius,
        };
    });
    expect(deckel.klasse, "die Klappbox trägt dieselbe Hausklasse").toBe(true);
    expect(deckel.untenLinks).toBe("0px");
    expect(deckel.untenRechts).toBe("0px");
});
