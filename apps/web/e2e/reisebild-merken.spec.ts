import { expect, test, type Page } from "@playwright/test";
import { stubReisebilder, type AttrappeOptionen } from "./reisebild-stub.ts";
import { chooseView, freeSpot, GARETH, openMap, showPlace } from "./map-handle.ts";

/**
 * Den persönlichen Link sichern und „Meine Reisebilder“ (WI-0272 S3, Aufgabe 19a; Entwurf 9, Betreiber 2026-11-01): das Häkchen „Auf diesem Gerät merken“ in der Bestätigung und auf der Statusseite, der
 * Eintrag im Kartenmenü und das Fenster mit einer Karte je gemerkter Einreichung. Der Server ist eine Attrappe (`reisebild-stub.ts`); die Merkliste ohne Browser prüft `test/photobox-merkliste.test.ts`, die
 * Bilder für die Abnahme macht `reisebild-e9-review.spec.ts`.
 *
 * Problemfälle: das Häkchen ist anfangs gesetzt oder legt mehr als Schlüssel und Zeit ab; die Höhe springt beim Setzen; Schließen warnt, obwohl gemerkt ist; der Menüeintrag steht ohne Gemerktes oder
 * außerhalb der Standardansicht; die Liste erfindet bei der Lesegrenze einen Stand oder fragt nach der Grenze weiter; die Karte oder das Fenster wachsen bei der Frage „Vergessen?“; ein gesperrter Speicher
 * lässt Häkchen oder Eintrag stehen; der Schlüssel steht in einer Adresse oder einem Log.
 */

const SPEICHER = "avesmaps.reisebilder.gemerkt";

/** Gültige Schlüssel (43 Zeichen, base64url), je Nummer ein anderer. */
const schluessel = (nr: number): string => `${String(nr)}`.padStart(2, "0").repeat(21) + "A";
const K = [1, 2, 3, 4, 5].map(schluessel);

/** Ein Stand, wie der Server ihn liefert (`PhotoboxStatus`). */
const stand = (
    zustand: string,
    beschreibung: string,
    ueber: Record<string, unknown> = {},
): Record<string, unknown> => ({
    zustand,
    eingereichtAm: "2026-10-31T10:00:00.000Z",
    beschreibung,
    entstehung: "photo",
    nutzung: "avesmaps_only",
    lage: { x: 560, y: 540 },
    vorschauBereit: true,
    angepasst: false,
    ...ueber,
});

/** Was dieses Gerät schon gemerkt hat, bevor die Seite lädt: je Nummer eine Einreichung, später gemerkt = höhere Nummer. */
async function gemerktVorab(page: Page, nummern: readonly number[]): Promise<void> {
    const eintraege = nummern.map((nr) => ({
        schluessel: schluessel(nr),
        gemerktAm: `2026-11-01T${String(nr % 24).padStart(2, "0")}:00:00.000Z`,
    }));
    await page.addInitScript(
        ([key, wert]) => {
            localStorage.setItem(key as string, wert as string);
        },
        [SPEICHER, JSON.stringify(eintraege)] as const,
    );
}

/**
 * Der Speicher lässt das Schreiben der Merkliste nicht zu (privates Fenster, voller Speicher): Der Rest des Hauses merkt nichts davon. Jeder Versuch, einen Schlüssel der Reisebilder zu schreiben,
 * steht in `window.__merkVersuche` (auch der gescheiterte): Bis zum Setzen des Häkchens darf es keinen geben (Review S3 M1).
 */
async function speicherGesperrt(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const urspruenglich = Storage.prototype.setItem;
        const versuche: string[] = [];
        (globalThis as unknown as { __merkVersuche: string[] }).__merkVersuche = versuche;
        Storage.prototype.setItem = function (schluessel: string, wert: string): void {
            if (String(schluessel).startsWith("avesmaps.reisebilder")) {
                versuche.push(String(schluessel));
                throw new DOMException("voll", "QuotaExceededError");
            }
            urspruenglich.call(this, schluessel, wert);
        };
    });
}

/** Der Speicher lässt das LESEN der Merkliste nicht zu (gesperrte Website-Daten): Das Merken verschwindet still. */
async function speicherUnlesbar(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const urspruenglich = Storage.prototype.getItem;
        Storage.prototype.getItem = function (schluessel: string): string | null {
            if (String(schluessel).startsWith("avesmaps.reisebilder"))
                throw new DOMException("gesperrt", "SecurityError");
            return urspruenglich.call(this, schluessel);
        };
    });
}

/** Wie oft die Seite versucht hat, einen Schlüssel der Reisebilder zu schreiben (nur mit `speicherGesperrt` aufgezeichnet). */
const schreibVersuche = (page: Page): Promise<string[]> =>
    page.evaluate(() => (globalThis as unknown as { __merkVersuche?: string[] }).__merkVersuche ?? []);

/** Alles, was die Seite an Adressen anfragt und in die Konsole schreibt: Darin steht nie ein Schlüssel. */
function belauschen(page: Page): { readonly adressen: string[]; readonly konsole: string[] } {
    const adressen: string[] = [];
    const konsole: string[] = [];
    page.on("request", (anfrage) => adressen.push(anfrage.url()));
    page.on("console", (nachricht) => konsole.push(nachricht.text()));
    page.on("pageerror", (fehler) => konsole.push(String(fehler)));
    return { adressen, konsole };
}

const gemerktImSpeicher = (page: Page): Promise<{ schluessel: string; gemerktAm: string }[]> =>
    page.evaluate((key) => {
        const roh = localStorage.getItem(key);
        return roh === null ? [] : (JSON.parse(roh) as { schluessel: string; gemerktAm: string }[]);
    }, SPEICHER);

async function oeffneFormular(page: Page, breite = 1280, hoehe = 800): Promise<void> {
    await page.setViewportSize({ width: breite, height: hoehe });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const spot = await freeSpot(page, { x: 460, y: 300 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
}

/** Das Formular ausfüllen, einreichen und bis zur Bestätigung warten. */
async function reiche(page: Page, breite = 1280, hoehe = 800): Promise<void> {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await oeffneFormular(page, breite, hoehe);
    await page.getByTestId("reisebild-datei").setInputFiles({
        name: "bild.png",
        mimeType: "image/png",
        buffer: (await import("./reisebild-stub.ts")).kleinesPng(),
    });
    await expect(page.getByTestId("reisebild-vorschau")).toBeVisible();
    await page.getByTestId("reisebild-text").fill("Der Markt am Morgen.");
    await page.getByTestId("reisebild-entstehung-photo").click();
    await page.getByTestId("reisebild-haken").click();
    await page.getByTestId("reisebild-einreichen").click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
}

/** Der Schlüssel der eben eingereichten Einreichung, aus dem Link in der Bestätigung. */
async function schluesselDerBestaetigung(page: Page): Promise<string> {
    const titel = (await page.getByTestId("reisebild-fertig-link").getAttribute("title")) ?? "";
    return titel.slice(titel.indexOf("#") + 1);
}

/** Das Kartenmenü an einer freien Stelle der Karte (Rechtsklick); die Karte steht schon. */
async function oeffneKartenmenue(page: Page): Promise<void> {
    const spot = await freeSpot(page, { x: 460, y: 300 });
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await expect(page.getByTestId("context-report")).toBeVisible();
}

/** Die Liste „Meine Reisebilder“ über das Kartenmenü öffnen. */
async function oeffneListe(page: Page, breite = 1280, hoehe = 800): Promise<void> {
    await page.setViewportSize({ width: breite, height: hoehe });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await oeffneKartenmenue(page);
    await page.getByTestId("context-meine-reisebilder").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
}

const hoehe = async (page: Page, testid: string): Promise<number> =>
    (await page.getByTestId(testid).boundingBox())!.height;

// --- Das Häkchen in der Bestätigung ----------------------------------------------------------------------------------------------

test("🔴 Bestätigung: das Häkchen ist anfangs leer, merkt unter EINEM Schlüssel nur Schlüssel und Zeit, und die Höhe springt dabei nicht", async ({
    page,
}) => {
    const lauscher = belauschen(page);
    await stubReisebilder(page);
    await reiche(page);
    // Das echte Kästchen (`input`) trägt den Zustand, die Zeile (`label`) nimmt den Klick.
    const merken = page.getByTestId("reisebild-fertig-merken");
    const zeile = page.getByTestId("reisebild-fertig-merken-label");
    await expect(merken).not.toBeChecked();
    await expect(page.getByText("Auf diesem Gerät merken", { exact: true })).toBeVisible();
    await expect(
        page.getByText("Nur in diesem Browser, abrufbar unter „Meine Reisebilder“ im Kartenmenü."),
    ).toBeVisible();
    await expect(page.getByText("Auf diesem Gerät gemerkt", { exact: true })).toBeHidden();
    expect(await gemerktImSpeicher(page)).toEqual([]);

    const fensterVorher = await hoehe(page, "reisebild-fenster");
    const zeileVorher = await hoehe(page, "reisebild-fertig-merkzeile");
    const belegVorher = (await page.getByTestId("reisebild-fertig-beleg").boundingBox())!.y;

    // Ein Klick merkt: Das echte Kästchen ist gesetzt, die andere Fassung steht da, im Speicher liegt genau die Zeile des Links.
    await zeile.click();
    await expect(merken).toBeChecked();
    await expect(page.getByText("Auf diesem Gerät gemerkt", { exact: true })).toBeVisible();
    await expect(page.getByText("Unter „Meine Reisebilder“ im Kartenmenü.", { exact: true })).toBeVisible();
    await expect(page.getByText("Auf diesem Gerät merken", { exact: true })).toBeHidden();
    const link = await schluesselDerBestaetigung(page);
    const abgelegt = await gemerktImSpeicher(page);
    expect(abgelegt).toHaveLength(1);
    expect(abgelegt[0]!.schluessel).toBe(link);
    // Nichts als Schlüssel und Zeit: keine Beschreibung, keine Bytes.
    expect(Object.keys(abgelegt[0]!).sort()).toEqual(["gemerktAm", "schluessel"]);
    const roh = await page.evaluate((key) => localStorage.getItem(key) ?? "", SPEICHER);
    expect(roh).not.toContain("Markt");
    expect(roh.length).toBeLessThan(200);
    const nurDiese = await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("avesmaps.reisebilder")),
    );
    expect(nurDiese).toEqual([SPEICHER]);

    // Die Höhe springt nicht: Fenster, Zeile und der Beleg darunter bleiben, wo sie waren.
    expect(Math.abs((await hoehe(page, "reisebild-fenster")) - fensterVorher)).toBeLessThan(1);
    expect(Math.abs((await hoehe(page, "reisebild-fertig-merkzeile")) - zeileVorher)).toBeLessThan(0.5);
    expect(Math.abs((await page.getByTestId("reisebild-fertig-beleg").boundingBox())!.y - belegVorher)).toBeLessThan(
        0.5,
    );

    // Ein zweiter Klick vergisst wieder und nimmt den Schlüssel aus dem Speicher.
    await zeile.click();
    await expect(merken).not.toBeChecked();
    expect(await gemerktImSpeicher(page)).toEqual([]);
    expect(Math.abs((await hoehe(page, "reisebild-fenster")) - fensterVorher)).toBeLessThan(1);

    // 🔴 Der Schlüssel stand in keiner Adresse (außer dem Fragment des Links selbst) und in keinem Log.
    expect(lauscher.adressen.filter((adresse) => adresse.includes(link))).toEqual([]);
    expect(lauscher.konsole.filter((text) => text.includes(link))).toEqual([]);
});

test("Bestätigung: die Leertaste setzt das Häkchen, der Fokusring steht am Kästchen", async ({ page }) => {
    await stubReisebilder(page);
    await reiche(page);
    const merken = page.getByTestId("reisebild-fertig-merken");
    await merken.focus();
    await expect(merken).toBeFocused();
    await page.keyboard.press("Space");
    await expect(merken).toBeChecked();
    await page.keyboard.press("Space");
    await expect(merken).not.toBeChecked();
    // Das Kästchen ist beschriftet: Es gibt es nur mit seinem Label.
    await expect(page.getByLabel("Auf diesem Gerät merken")).toHaveCount(1);
});

test("🔴 Schließen ohne Warnung, wenn gemerkt; sonst hält der erste Versuch an („… oder gemerkt“), und das Häkchen nimmt die Warnung sofort weg", async ({
    page,
}) => {
    await stubReisebilder(page);
    await reiche(page);
    const fenster = page.getByTestId("reisebild-fenster");

    // Gemerkt: ohne Halt.
    await page.getByTestId("reisebild-fertig-merken-label").click();
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(fenster).toHaveCount(0);

    // Weder gemerkt noch kopiert: Der erste Versuch hält an, mit dem Satz für beides.
    await reiche(page);
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toContainText("Link noch nicht kopiert oder gemerkt.");
    await expect(page.getByTestId("reisebild-fertig-linkkasten")).toHaveClass(/is-fehlt/u);

    // Das Häkchen danach: Hinweis und Warnring sind sofort weg; ✕ schließt ohne Halt.
    await page.getByTestId("reisebild-fertig-merken-label").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-fertig-linkkasten")).not.toHaveClass(/is-fehlt/u);
    await fenster.getByTestId("fenster-schliessen").click();
    await expect(fenster).toHaveCount(0);
});

// --- Der Linkschutz gilt auch für die Wege von außen (Review S3 I1) --------------------------------------------------------------

test("🔴 Bestätigung offen, Link weder kopiert noch gemerkt: Kartenmenü „Eigenes Bild hinzufügen“ und „Meine Reisebilder“ halten einmal an, der zweite Versuch geht durch", async ({
    page,
}) => {
    await gemerktVorab(page, [1]);
    await stubReisebilder(page);
    await reiche(page);
    const warnung = page.getByTestId("reisebild-fertig-warnung");
    await expect(warnung).toHaveCount(0);

    // „Eigenes Bild hinzufügen“ ersetzt die Bestätigung nicht, sondern warnt.
    await oeffneKartenmenue(page);
    await page.getByTestId("context-photobox").click();
    await expect(warnung).toContainText("Link noch nicht kopiert oder gemerkt.");
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await expect(page.getByTestId("reisebild-formular")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-fertig-linkkasten")).toHaveClass(/is-fehlt/u);

    // Die Warnung steht schon: Ein zweiter Versuch, auch auf einem anderen Weg („Meine Reisebilder“), geht durch.
    await oeffneKartenmenue(page);
    await page.getByTestId("context-meine-reisebilder").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);
});

test("🔴 „Meine Reisebilder“ von außen: erster Versuch hält an, „Trotzdem weiter“ führt den gewählten Weg aus", async ({
    page,
}) => {
    await gemerktVorab(page, [1]);
    await stubReisebilder(page);
    await reiche(page);
    await oeffneKartenmenue(page);
    await page.getByTestId("context-meine-reisebilder").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
    await expect(page.getByTestId("reisebild-meine-fenster")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-fertig-trotzdem")).toContainText("Trotzdem weiter");
    await page.getByTestId("reisebild-fertig-trotzdem").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);
});

test("🔴 „Stand ansehen“ hält ebenfalls einmal an; nach dem Kopieren oder Merken gibt es gar keine Warnung", async ({
    page,
}) => {
    await gemerktVorab(page, [1]);
    await stubReisebilder(page);
    await reiche(page);
    const warnung = page.getByTestId("reisebild-fertig-warnung");

    await page.getByTestId("reisebild-fertig-stand").click();
    await expect(warnung).toBeVisible();
    await expect(page.getByTestId("reisebild-status-fenster")).toHaveCount(0);
    await page.getByTestId("reisebild-fertig-stand").click();
    await expect(page.getByTestId("reisebild-status-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);

    // Kopiert: Kartenmenü und „Stand ansehen“ gehen ohne Warnung durch.
    await reiche(page);
    await page.getByTestId("reisebild-fertig-kopieren").click();
    await expect(page.getByTestId("reisebild-fertig-kopieren")).toContainText("Kopiert");
    await oeffneKartenmenue(page);
    await page.getByTestId("context-meine-reisebilder").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
    await expect(warnung).toHaveCount(0);

    // Gemerkt: ebenso.
    await reiche(page);
    await page.getByTestId("reisebild-fertig-merken-label").click();
    await oeffneKartenmenue(page);
    await page.getByTestId("context-photobox").click();
    await expect(page.getByTestId("reisebild-formular")).toBeVisible();
    await expect(page.getByTestId("reisebild-fertig")).toHaveCount(0);
    await expect(warnung).toHaveCount(0);
});

test("🔴 lässt der Browser den Speicher nicht lesen, erscheinen weder Häkchen noch Menüeintrag, und die Warnung nennt nur das Kopieren", async ({
    page,
}) => {
    await speicherUnlesbar(page);
    await stubReisebilder(page);
    await reiche(page);
    await expect(page.getByTestId("reisebild-fertig-merkzeile")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-fertig-merken")).toHaveCount(0);
    await expect(page.getByText("Auf diesem Gerät merken")).toHaveCount(0);
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toContainText("Link noch nicht kopiert.");
    await expect(page.getByTestId("reisebild-fertig-warnung")).not.toContainText("gemerkt");
    await page.getByTestId("reisebild-fertig-trotzdem").click();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);
    await oeffneKartenmenue(page);
    await expect(page.getByTestId("context-photobox")).toBeVisible();
    await expect(page.getByTestId("context-meine-reisebilder")).toHaveCount(0);
});

test("🔴 lässt der Browser das Schreiben nicht zu: Vor dem Häkchen wird nie geschrieben (Review M1), das Häkchen sagt dann leise, warum es nicht geht, und die Höhe springt nicht (M4)", async ({
    page,
}) => {
    await speicherGesperrt(page);
    await stubReisebilder(page);
    await reiche(page);
    // Das Formular war offen und die Bestätigung steht: Geschrieben wurde nichts, auch keine Probe.
    expect(await schreibVersuche(page)).toEqual([]);
    const merken = page.getByTestId("reisebild-fertig-merken");
    const zeile = page.getByTestId("reisebild-fertig-merken-label");
    await expect(merken).not.toBeChecked();
    await expect(page.getByTestId("reisebild-fertig-merken-gesperrt")).toBeHidden();
    const fensterVorher = await hoehe(page, "reisebild-fenster");
    const zeileVorher = await hoehe(page, "reisebild-fertig-merkzeile");
    const belegVorher = (await page.getByTestId("reisebild-fertig-beleg").boundingBox())!.y;

    await zeile.click();
    // Erst jetzt geschieht der Versuch, und der Grund steht in der Zelle der Erklärzeile.
    expect(await schreibVersuche(page)).toEqual([SPEICHER]);
    await expect(merken).not.toBeChecked();
    await expect(page.getByTestId("reisebild-fertig-merken-gesperrt")).toBeVisible();
    await expect(page.getByTestId("reisebild-fertig-merken-gesperrt")).toHaveText(
        "Der Browser lässt das Merken nicht zu.",
    );
    await expect(page.getByTestId("reisebild-fertig-merkproblem")).toHaveText("Der Browser lässt das Merken nicht zu.");
    await expect(
        page.getByText("Nur in diesem Browser, abrufbar unter „Meine Reisebilder“ im Kartenmenü."),
    ).toBeHidden();
    expect(Math.abs((await hoehe(page, "reisebild-fenster")) - fensterVorher)).toBeLessThan(1);
    expect(Math.abs((await hoehe(page, "reisebild-fertig-merkzeile")) - zeileVorher)).toBeLessThan(0.5);
    expect(Math.abs((await page.getByTestId("reisebild-fertig-beleg").boundingBox())!.y - belegVorher)).toBeLessThan(
        0.5,
    );
    // Gemerkt ist nichts, also hält das Schließen weiter an.
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fertig-warnung")).toBeVisible();
});

test("🔴 ist die Liste voll (30), sagt das Häkchen es leise: in der Bestätigung und auf der Statusseite, ohne dass die Höhe springt (Review M4)", async ({
    page,
}) => {
    await gemerktVorab(
        page,
        Array.from({ length: 30 }, (_, i) => i + 1),
    );
    await stubReisebilder(page, { status: stand("pending", "Hügel im ersten Licht") });
    await reiche(page);
    const merken = page.getByTestId("reisebild-fertig-merken");
    // Das Fenster gleitet beim Wechsel zur Bestätigung in seine Höhe (240 ms): erst messen, wenn es steht.
    await page.waitForTimeout(500);
    const fensterVorher = await hoehe(page, "reisebild-fenster");
    const zeileVorher = await hoehe(page, "reisebild-fertig-merkzeile");
    await page.getByTestId("reisebild-fertig-merken-label").click();
    await expect(merken).not.toBeChecked();
    const satz = "Die Liste ist voll. Einzelne Einträge lassen sich unter „Meine Reisebilder“ vergessen.";
    await expect(page.getByTestId("reisebild-fertig-merken-voll")).toHaveText(satz);
    await expect(page.getByTestId("reisebild-fertig-merkproblem")).toHaveText(satz);
    expect(await gemerktImSpeicher(page)).toHaveLength(30);
    expect(Math.abs((await hoehe(page, "reisebild-fenster")) - fensterVorher)).toBeLessThan(1);
    expect(Math.abs((await hoehe(page, "reisebild-fertig-merkzeile")) - zeileVorher)).toBeLessThan(0.5);

    // Dieselbe Rückmeldung auf der Statusseite eines Links, der nicht gemerkt ist.
    await openMap(page, `/reisebild#${schluessel(40)}`);
    const seite = page.getByTestId("reisebild-status-fenster");
    await expect(seite).toBeVisible();
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    const seiteVorher = (await seite.boundingBox())!.height;
    await page.getByTestId("reisebild-status-merken-label").click();
    await expect(page.getByTestId("reisebild-status-merken")).not.toBeChecked();
    await expect(page.getByTestId("reisebild-status-merken-voll")).toHaveText(satz);
    expect(Math.abs((await seite.boundingBox())!.height - seiteVorher)).toBeLessThan(1);
});

// --- Das Kartenmenü ------------------------------------------------------------------------------------------------------------

test("🔴 Kartenmenü: „Meine Reisebilder“ steht nur mit Gemerktem und nur in der Standardansicht, unter „Eigenes Bild hinzufügen“, und geht nach dem letzten Vergessen", async ({
    page,
}) => {
    await stubReisebilder(page);
    // Ohne Gemerktes gibt es den Eintrag nicht.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await oeffneKartenmenue(page);
    await expect(page.getByTestId("context-photobox")).toBeVisible();
    await expect(page.getByTestId("context-meine-reisebilder")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Etwas merken (über die Bestätigung), dann steht er da, direkt unter dem Eintrag des Formulars.
    await oeffneKartenmenue(page);
    await page.getByTestId("context-photobox").click();
    await page.getByTestId("reisebild-datei").setInputFiles({
        name: "bild.png",
        mimeType: "image/png",
        buffer: (await import("./reisebild-stub.ts")).kleinesPng(),
    });
    await page.getByTestId("reisebild-text").fill("Der Markt am Morgen.");
    await page.getByTestId("reisebild-entstehung-photo").click();
    await page.getByTestId("reisebild-haken").click();
    await page.getByTestId("reisebild-einreichen").click();
    await expect(page.getByTestId("reisebild-fertig")).toBeVisible();
    await page.getByTestId("reisebild-fertig-merken-label").click();
    await page.getByTestId("reisebild-fertig-schliessen").click();
    await expect(page.getByTestId("reisebild-fenster")).toHaveCount(0);

    await oeffneKartenmenue(page);
    const bild = (await page.getByTestId("context-photobox").boundingBox())!;
    const meine = page.getByTestId("context-meine-reisebilder");
    await expect(meine).toContainText("Meine Reisebilder");
    const kasten = (await meine.boundingBox())!;
    expect(kasten.y).toBeGreaterThan(bild.y);
    expect(kasten.y).toBeLessThan(bild.y + bild.height * 2.2);
    await page.keyboard.press("Escape");

    // In einer anderen Ansicht fehlt er wie „Eigenes Bild hinzufügen“.
    await chooseView(page, "landscapes");
    await oeffneKartenmenue(page);
    await expect(page.getByTestId("context-photobox")).toHaveCount(0);
    await expect(page.getByTestId("context-meine-reisebilder")).toHaveCount(0);
});

// --- Das Fenster „Meine Reisebilder“ --------------------------------------------------------------------------------------------

const STAENDE: NonNullable<AttrappeOptionen["statusJeSchluessel"]> = {
    [K[0]!]: stand("pending", "Hügel im ersten Licht"),
    [K[1]!]: stand("changes_requested", "Rast am Pass", { entstehung: "drawing" }),
    [K[2]!]: stand("approved", "Die Reichsstraße im Morgendunst"),
    [K[3]!]: undefined,
};

test("🔴 Liste: neueste zuerst, nacheinander abgefragt, die Marken je Zustand, verschwundene Einreichung, Höhe stabil beim Laden", async ({
    page,
}) => {
    const lauscher = belauschen(page);
    await gemerktVorab(page, [1, 2, 3, 4]);
    const attrappe = await stubReisebilder(page, { statusJeSchluessel: STAENDE, statusVerzoegerungMs: 250 });
    await oeffneListe(page);

    const fenster = page.getByTestId("reisebild-meine-fenster");
    await expect(fenster.locator(".avm-fenster__titel")).toHaveText("Meine Reisebilder");
    await expect(page.getByTestId("fenster-unterzeile")).toHaveText("Auf diesem Gerät gemerkt");
    const karten = page.getByTestId("reisebild-meine-karte");
    await expect(karten).toHaveCount(4);
    // Neueste zuerst: Die zuletzt gemerkte (Nummer 4) steht oben, und noch ohne Stand steht ein ruhiger Platzhalter, ohne Marke.
    await expect(karten.first()).toContainText("Wird geladen …");
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveCount(0);
    const hoeheLaedt = (await fenster.boundingBox())!.height;
    const karteLaedt = (await karten.first().boundingBox())!.height;

    // Stand je Eintrag, nacheinander: die Marken in der Reihenfolge der Karten.
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveText(
        ["Nicht mehr vorhanden", "Veröffentlicht", "Rückfrage", "In Prüfung"],
        { timeout: 15_000 },
    );
    await expect(karten.nth(2)).toContainText("Rast am Pass");
    await expect(karten.nth(2)).toContainText("Gareth");
    await expect(karten.nth(2)).toContainText("Gemalt");
    await expect(karten.nth(3)).toContainText("Foto");
    await expect(karten.nth(2).getByTestId("reisebild-meine-marke")).toHaveClass(/mr__marke--rueckfrage/u);
    await expect(karten.nth(1).getByTestId("reisebild-meine-marke")).toHaveClass(/mr__marke--oeffentlich/u);
    await expect(karten.nth(0).getByTestId("reisebild-meine-marke")).toHaveClass(/mr__marke--leise/u);
    // Die Vorschau kommt aus der Statusantwort (`vorschauBereit`), sonst steht das gemalte Symbol.
    await expect(page.getByTestId("reisebild-meine-vorschau")).toHaveCount(3);
    await expect(page.getByTestId("reisebild-meine-vorschau").first()).toHaveAttribute("src", /^blob:/u);
    // Eine Einreichung, die es nicht mehr gibt, öffnet nichts, bietet aber „Vergessen“.
    await expect(karten.first()).toContainText("Zu diesem Link gibt es kein Reisebild (mehr).");
    await expect(karten.first().getByTestId("reisebild-meine-titel")).toHaveCount(0);
    await expect(karten.first().getByTestId("reisebild-meine-vergessen")).toBeVisible();

    // 🔴 Die Höhe springt nicht, wenn die Stände ankommen.
    expect(Math.abs((await fenster.boundingBox())!.height - hoeheLaedt)).toBeLessThan(1);
    expect(Math.abs((await karten.first().boundingBox())!.height - karteLaedt)).toBeLessThan(1);

    // Nacheinander, in dieser Reihenfolge, einmal je Eintrag; ohne Takt nichts danach.
    const fragen = attrappe.aufrufe.filter((aufruf) => aufruf.pfad.startsWith("/status"));
    expect(fragen.map((aufruf) => aufruf.pfad)).toEqual([
        "/status",
        "/status",
        "/status/vorschau",
        "/status",
        "/status/vorschau",
        "/status",
        "/status/vorschau",
    ]);
    expect(fragen.map((aufruf) => (aufruf.body as { schluessel: string }).schluessel)).toEqual([
        K[3],
        K[2],
        K[2],
        K[1],
        K[1],
        K[0],
        K[0],
    ]);
    await page.waitForTimeout(1200);
    expect(attrappe.aufrufe.filter((aufruf) => aufruf.pfad.startsWith("/status"))).toHaveLength(7);

    // 🔴 Kein Schlüssel in einer Adresse, keiner in der Konsole, keiner in der Adresse der Seite.
    for (const k of K) {
        expect(lauscher.adressen.filter((adresse) => adresse.includes(k))).toEqual([]);
        expect(lauscher.konsole.filter((text) => text.includes(k))).toEqual([]);
        expect(page.url()).not.toContain(k);
    }
});

test("🔴 Liste → Karte → zurück: der Rückweg fragt den Server nichts mehr (Review M2), und nur eine Karte, die etwas öffnet, reagiert auf den Zeiger (M7)", async ({
    page,
}) => {
    await gemerktVorab(page, [1, 2, 3]);
    const attrappe = await stubReisebilder(page, {
        statusJeSchluessel: {
            [K[0]!]: stand("pending", "Hügel im ersten Licht"),
            [K[1]!]: stand("withdrawn", "Zurückgezogen am Pass"),
            [K[2]!]: undefined,
        },
    });
    await oeffneListe(page);
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveCount(3);
    const anfragen = (): { status: number; vorschau: number } => ({
        status: attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/status").length,
        vorschau: attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/status/vorschau").length,
    });
    // Drei Stände; die Vorschau nur für die eine Einreichung, deren Bild noch eine Rolle spielt (nicht für die zurückgezogene).
    await expect.poll(() => anfragen()).toEqual({ status: 3, vorschau: 1 });

    // Die Karte öffnet die Statusseite (ihr eigener Abruf: ein Stand und eine Vorschau), der Rückweg nichts mehr.
    const karten = page.getByTestId("reisebild-meine-karte");
    const weg = karten.nth(0); // neueste zuerst: Nummer 3, „Nicht mehr vorhanden“
    const offen = karten.nth(2);
    await expect(weg.getByTestId("reisebild-meine-titel-aus")).toBeVisible();

    // M7: Die Karte, die nichts öffnet, bleibt beim Überfahren, wie sie ist; die offene färbt sich.
    const rand = (karte: typeof weg): Promise<string> =>
        karte.evaluate((element) => getComputedStyle(element).borderTopColor);
    const wegVorher = await rand(weg);
    await weg.hover();
    await page.waitForTimeout(250);
    expect(await rand(weg)).toBe(wegVorher);
    const offenVorher = await rand(offen);
    await offen.hover();
    await expect.poll(() => rand(offen)).not.toBe(offenVorher);

    await offen.getByTestId("reisebild-meine-titel").click();
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    const nachKarte = anfragen();
    await page.getByTestId("reisebild-status-zurueck").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveCount(3);
    await page.waitForTimeout(400);
    expect(anfragen(), "der Rückweg fragt nichts mehr").toEqual(nachKarte);
});

test("🔴 Liste: bei der Lesegrenze (429) steht „Stand gerade nicht abrufbar“, nichts wird erfunden, und der Rest wird nicht mehr gefragt", async ({
    page,
}) => {
    await gemerktVorab(page, [1, 2, 3]);
    const attrappe = await stubReisebilder(page, {
        statusFehler: { status: 429, code: "photobox_rate" },
    });
    await oeffneListe(page);
    const marken = page.getByTestId("reisebild-meine-marke");
    await expect(marken).toHaveText(Array.from({ length: 3 }, () => "Stand gerade nicht abrufbar"));
    // Nur die eine Frage, die die Grenze traf; die übrigen zwei wurden gar nicht erst gestellt.
    expect(attrappe.aufrufe.filter((aufruf) => aufruf.pfad === "/status")).toHaveLength(1);
    // Keine Marke eines Zustands; die Karten bleiben bedienbar (die Statusseite versucht es selbst noch einmal).
    for (const text of ["In Prüfung", "Rückfrage", "Veröffentlicht"]) {
        await expect(page.getByTestId("reisebild-meine-liste").getByText(text, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId("reisebild-meine-titel").first()).toBeVisible();
});

test("🔴 Liste: „Vergessen“ fragt einmal nach (Karte und Fenster wachsen nicht), Esc nimmt die Frage zurück, das Vergessen räumt den Speicher und lässt das Reisebild eingereicht", async ({
    page,
}) => {
    await gemerktVorab(page, [1, 2]);
    const attrappe = await stubReisebilder(page, {
        statusJeSchluessel: {
            [K[0]!]: stand("pending", "Hügel im ersten Licht"),
            [K[1]!]: stand("approved", "Die Reichsstraße"),
        },
    });
    await oeffneListe(page);
    const fenster = page.getByTestId("reisebild-meine-fenster");
    const karten = page.getByTestId("reisebild-meine-karte");
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveCount(2);
    const fensterHoehe = (await fenster.boundingBox())!.height;
    const karteHoehe = (await karten.first().boundingBox())!.height;

    // Die Frage ersetzt den Inhalt der Karte; nichts wächst.
    await karten.first().getByTestId("reisebild-meine-vergessen").click();
    await expect(karten.first().getByTestId("reisebild-meine-frage")).toHaveText(
        "Nur von diesem Gerät entfernen? Das Reisebild bleibt eingereicht.",
    );
    // Eine Gruppe für den Vorleser ist ein `div`, kein Absatz mit Rolle (Review M5b).
    const frage = karten.first().getByTestId("reisebild-meine-frage");
    expect(await frage.evaluate((element) => element.tagName)).toBe("DIV");
    await expect(frage).toHaveAttribute("role", "group");
    await expect(karten.first().getByTestId("reisebild-meine-vergessen-ja")).toBeFocused();
    expect(Math.abs((await karten.first().boundingBox())!.height - karteHoehe)).toBeLessThan(1);
    expect(Math.abs((await fenster.boundingBox())!.height - fensterHoehe)).toBeLessThan(1);

    // Esc nimmt die Frage zurück und lässt das Fenster offen; „Abbrechen“ behält alle Karten.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("reisebild-meine-frage")).toHaveCount(0);
    await expect(fenster).toBeVisible();
    await karten.first().getByTestId("reisebild-meine-vergessen").click();
    await page.getByTestId("reisebild-meine-vergessen-nein").click();
    await expect(page.getByTestId("reisebild-meine-frage")).toHaveCount(0);
    await expect(karten).toHaveCount(2);

    // Vergessen: die Karte geht, der Hinweis sagt, dass das Reisebild eingereicht bleibt, der Fokus geht auf die nächste Karte.
    await karten.first().getByTestId("reisebild-meine-vergessen").click();
    await page.getByTestId("reisebild-meine-vergessen-ja").click();
    await expect(karten).toHaveCount(1);
    await expect(page.getByText("Vergessen. Das Reisebild bleibt eingereicht.")).toBeVisible();
    await expect(karten.first().getByTestId("reisebild-meine-titel")).toBeFocused();
    expect((await gemerktImSpeicher(page)).map((e) => e.schluessel)).toEqual([K[0]]);
    // Vergessen ist nur am Gerät: Der Server hat dazu nichts gehört (nur Lesen).
    expect(attrappe.aufrufe.filter((aufruf) => /zurueckziehen|offline|beschreibung|bild$/u.test(aufruf.pfad))).toEqual(
        [],
    );
    expect(Math.abs((await fenster.boundingBox())!.height - fensterHoehe)).toBeLessThan(1);

    // Die letzte: „Nichts gemerkt.“, der Fokus auf „Schließen“, der Schlüssel ist aus dem Speicher, das Fenster bleibt so hoch.
    await karten.first().getByTestId("reisebild-meine-vergessen").click();
    await page.getByTestId("reisebild-meine-vergessen-ja").click();
    await expect(page.getByTestId("reisebild-meine-leer")).toContainText("Nichts gemerkt.");
    await expect(page.getByTestId("reisebild-meine-schliessen")).toBeFocused();
    expect(await gemerktImSpeicher(page)).toEqual([]);
    expect(await page.evaluate((key) => localStorage.getItem(key), SPEICHER)).toBeNull();
    expect(Math.abs((await fenster.boundingBox())!.height - fensterHoehe)).toBeLessThan(1);

    // Und der Menüeintrag ist weg.
    await page.getByTestId("reisebild-meine-schliessen").click();
    await expect(fenster).toHaveCount(0);
    await oeffneKartenmenue(page);
    await expect(page.getByTestId("context-meine-reisebilder")).toHaveCount(0);
});

// --- Die Statusseite ---------------------------------------------------------------------------------------------------------

test("🔴 Statusseite aus der Liste: im selben Fenster, „‹ Meine Reisebilder“ führt zurück, der kompakte Linkkasten zeigt „gemerkt“ mit „Vergessen“, ohne dass die Höhe springt", async ({
    page,
}) => {
    await gemerktVorab(page, [1, 2]);
    await stubReisebilder(page, {
        statusJeSchluessel: {
            [K[0]!]: stand("pending", "Hügel im ersten Licht"),
            [K[1]!]: stand("approved", "Die Reichsstraße"),
        },
    });
    await oeffneListe(page);
    await expect(page.getByTestId("reisebild-meine-marke")).toHaveCount(2);

    // Die ganze Karte öffnet die Statusseite im selben Fenster (der Dialog der Liste ist ersetzt).
    await page.getByTestId("reisebild-meine-karte").nth(1).getByTestId("reisebild-meine-titel").click();
    const seite = page.getByTestId("reisebild-status-fenster");
    await expect(seite).toBeVisible();
    await expect(page.getByTestId("reisebild-meine-fenster")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-zurueck")).toContainText("Meine Reisebilder");
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    // Breite wie die übrigen Fenster (520), der Kasten oben, gemerkt.
    expect(Math.round((await seite.boundingBox())!.width)).toBe(520);
    const merken = page.getByTestId("reisebild-status-merken");
    await expect(merken).toBeChecked();
    await expect(page.getByText("Auf diesem Gerät gemerkt", { exact: true })).toBeVisible();
    await expect(page.getByTestId("reisebild-status-vergessen")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-linksatz")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-link")).toHaveAttribute(
        "title",
        new RegExp(`/reisebild#${K[0]}$`, "u"),
    );

    // „Vergessen“ nimmt das Häkchen, die Höhe springt nicht, der Speicher verliert genau diese Einreichung.
    const fensterHoehe = (await seite.boundingBox())!.height;
    const zeileHoehe = await hoehe(page, "reisebild-status-merkzeile");
    await page.getByTestId("reisebild-status-vergessen").click();
    await expect(merken).not.toBeChecked();
    // Der Knopf ist dabei unsichtbar geworden: Der Fokus geht auf das Kästchen daneben (Review M5a).
    await expect(merken).toBeFocused();
    await expect(page.getByText("Auf diesem Gerät merken", { exact: true })).toBeVisible();
    await expect(page.getByTestId("reisebild-status-vergessen")).toBeHidden();
    expect(Math.abs((await seite.boundingBox())!.height - fensterHoehe)).toBeLessThan(1);
    expect(Math.abs((await hoehe(page, "reisebild-status-merkzeile")) - zeileHoehe)).toBeLessThan(0.5);
    expect((await gemerktImSpeicher(page)).map((e) => e.schluessel)).toEqual([K[1]]);
    // Das Häkchen merkt wieder.
    await page.getByTestId("reisebild-status-merken-label").click();
    await expect(merken).toBeChecked();
    expect((await gemerktImSpeicher(page)).map((e) => e.schluessel).sort()).toEqual([K[0], K[1]].sort());
    expect(Math.abs((await seite.boundingBox())!.height - fensterHoehe)).toBeLessThan(1);

    // „Link kopieren“ legt den vollen Link in die Zwischenablage.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("reisebild-status-kopieren").click();
    await expect(page.getByTestId("reisebild-status-kopieren")).toContainText("Kopiert");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/reisebild#${K[0]}$`, "u"));

    // Zurück in die Liste.
    await page.getByTestId("reisebild-status-zurueck").click();
    await expect(page.getByTestId("reisebild-meine-fenster")).toBeVisible();
    await expect(page.getByTestId("reisebild-meine-karte")).toHaveCount(2);
});

test("Statusseite über den Link: das Häkchen ist anfangs leer, kein Weg zurück, und „Auf diesem Gerät merken“ legt die Einreichung unter „Meine Reisebilder“ ab", async ({
    page,
}) => {
    await stubReisebilder(page, { status: stand("pending", "Hügel im ersten Licht") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page, `/reisebild#${K[0]}`);
    const seite = page.getByTestId("reisebild-status-fenster");
    await expect(seite).toBeVisible();
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-zurueck")).toHaveCount(0);
    const merken = page.getByTestId("reisebild-status-merken");
    await expect(merken).not.toBeChecked();
    expect(await gemerktImSpeicher(page)).toEqual([]);
    await page.getByTestId("reisebild-status-merken-label").click();
    await expect(merken).toBeChecked();
    expect((await gemerktImSpeicher(page)).map((e) => e.schluessel)).toEqual([K[0]]);

    // Zu, dann steht der Eintrag im Kartenmenü.
    await seite.getByTestId("fenster-schliessen").click();
    await expect(seite).toHaveCount(0);
    await oeffneKartenmenue(page);
    await page.getByTestId("context-meine-reisebilder").click();
    await expect(page.getByTestId("reisebild-meine-karte")).toHaveCount(1);
});

test("🔴 Statusseite bei unlesbarem Speicher: weder Häkchen noch Zeile, der Rest bleibt", async ({ page }) => {
    await speicherUnlesbar(page);
    await stubReisebilder(page, { status: stand("pending", "Hügel im ersten Licht") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page, `/reisebild#${K[0]}`);
    await expect(page.getByTestId("reisebild-status-zustand")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-linkkasten")).toBeVisible();
    await expect(page.getByTestId("reisebild-status-merkzeile")).toHaveCount(0);
    await expect(page.getByTestId("reisebild-status-kopieren")).toBeVisible();
});

test("Kaputter Inhalt im Speicher zählt als leer: kein Menüeintrag, keine Fehlermeldung", async ({ page }) => {
    const lauscher = belauschen(page);
    await page.addInitScript((key) => localStorage.setItem(key, '{"das":"gehört","mir":"nicht"}'), SPEICHER);
    await stubReisebilder(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMap(page);
    await showPlace(page, GARETH, 5);
    await oeffneKartenmenue(page);
    await expect(page.getByTestId("context-meine-reisebilder")).toHaveCount(0);
    expect(lauscher.konsole.filter((text) => /Merk|reisebilder\.gemerkt|SyntaxError/u.test(text))).toEqual([]);
});
