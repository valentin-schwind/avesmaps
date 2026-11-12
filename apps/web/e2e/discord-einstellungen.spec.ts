import { expect, test, type Page } from "@playwright/test";
import {
    DISCORD_ADMIN_URL,
    DISCORD_PROMPT_VORGABE,
    sendefenster,
    type DiscordStand,
    type NewsPflege,
} from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Reiter „Discord“ unter Systemsteuerung › Neuigkeiten: Prompt, Uhrzeit und Berichtskanal einstellen (WI-0255; Vali 2026-10-25: „die betreiber sollen den
 * prompt unter "Neuigkeiten" -> "Discord" -> "Prompt für den täglichen Bericht" ändern können. schön wär auch die uhrzeit für die routine und auch den
 * kanal festlegen können“). Die Verwaltung kommt aus dem Stub, die Karte dahinter vom echten Entwicklungsserver; der echte Server mit PostgreSQL steht in
 * `apps/server/test/discord-zustellung.test.ts`.
 *
 * Problemfälle: Der Prompt wirkt ohne Formulierer nicht, und der Reiter sagt es; die Uhrzeit bestimmt das Sendefenster; ein Kanal, den der Bot nicht nutzen
 * kann, wird vom Server abgelehnt und mit Kanal und Grund genannt, ohne dass die Eingabe verloren geht; ohne Bot-Schlüssel (Stage, lokal) entfällt die
 * Prüfung, und der Reiter sagt auch das.
 */

const ERSTER = "1000000000000000001";
const NEUER = "1000000000000000002";
const PFLEGE: NewsPflege = { entwuerfe: 0, eintraege: [], papierkorb: [], stage: null };

function ausgangsstand(teil: Partial<DiscordStand> = {}): DiscordStand {
    const fenster = sendefenster("10:00");
    return {
        umgebung: "production",
        modus: "senden",
        modusVeraltet: false,
        sperre: null,
        schluessel: true,
        kanal: ERSTER,
        formulierer: false,
        zeitplan: { uhrzeit: "10:00", zone: "Europe/Berlin", fensterVon: fenster.von, fensterBis: fenster.bis },
        einstellungen: {
            prompt: DISCORD_PROMPT_VORGABE,
            promptEigen: false,
            uhrzeit: "10:00",
            kanalBericht: { eigen: null, umgebung: ERSTER, gilt: ERSTER, quelle: "umgebung" },
            geaendertAt: null,
            geaendertVon: null,
        },
        routine: { aktiv: false, geaendertAt: null, geaendertVon: null },
        letzterLauf: null,
        letzterErfolg: null,
        heute: "2026-10-25",
        archiv: [],
        ...teil,
    };
}

/** Die Verwaltung mit einem kleinen Discord-Server im Speicher: Der Stand ändert sich, wenn die Einstellungen gespeichert werden. */
async function oeffne(
    page: Page,
    optionen: { stand?: Partial<DiscordStand>; darf?: boolean; ablehnen?: { status: number; body: unknown } } = {},
): Promise<{ calls: AdminCall[]; stand: () => DiscordStand }> {
    let stand = ausgangsstand(optionen.stand);
    const calls = await stubAdmin(page, {
        capabilities: [...ADMIN_CAPABILITIES, ...(optionen.darf === false ? [] : ["manage_news"])],
        role: "operator",
        answer: (call) => {
            if (call.path.startsWith("/api/admin/system/news")) return { status: 200, body: PFLEGE };
            if (call.method === "GET" && call.path === DISCORD_ADMIN_URL) return { status: 200, body: stand };
            if (call.method === "POST" && call.path === `${DISCORD_ADMIN_URL}/einstellungen`) {
                if (optionen.ablehnen !== undefined) return optionen.ablehnen;
                const body = call.body as {
                    prompt: string | null;
                    uhrzeit: string;
                    berichtsKanal: string | null;
                };
                const fenster = sendefenster(body.uhrzeit);
                const e = stand.einstellungen;
                stand = {
                    ...stand,
                    // Der Kanal, in den diese Umgebung senden würde: der aus dem Reiter, sonst der der Umgebung.
                    kanal: body.berichtsKanal ?? e.kanalBericht.umgebung ?? ERSTER,
                    zeitplan: {
                        ...stand.zeitplan,
                        uhrzeit: fenster.von,
                        fensterVon: fenster.von,
                        fensterBis: fenster.bis,
                    },
                    einstellungen: {
                        ...e,
                        prompt: body.prompt ?? DISCORD_PROMPT_VORGABE,
                        promptEigen: body.prompt !== null,
                        uhrzeit: body.uhrzeit,
                        kanalBericht: {
                            ...e.kanalBericht,
                            eigen: body.berichtsKanal,
                            gilt: body.berichtsKanal ?? e.kanalBericht.umgebung,
                            quelle: body.berichtsKanal === null ? "umgebung" : "reiter",
                        },
                        geaendertAt: "2026-10-25T10:00:00.000Z",
                        geaendertVon: "Rondrikan",
                    },
                };
                return {
                    status: 200,
                    body: {
                        operationId: String(call.body?.["operationId"] ?? "x"),
                        status: "applied",
                        environment: "production",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                    },
                };
            }
            return undefined;
        },
    });
    await page.goto("/?verwaltung=neuigkeiten");
    await page.getByTestId("neuigkeiten-reiter-discord").click();
    await expect(page.getByTestId("discord-einstellungen")).toBeVisible();
    return { calls, stand: () => stand };
}

const feld = (page: Page, testid: string) => page.getByTestId(testid).locator("input");
const einstellungen = (page: Page) => page.getByTestId("discord-einstellungen");

test("🔴 Prompt, Uhrzeit und Kanal einstellen: Speichern ist ein Satz, danach zeigt der Reiter, was gilt und was der Prompt (noch) nicht tut", async ({
    page,
}) => {
    const { calls } = await oeffne(page);

    // Ausgangslage: alles aus der Vorgabe, nichts zu speichern.
    await expect(feld(page, "discord-uhrzeit")).toHaveValue("10:00");
    await expect(page.getByTestId("discord-uhrzeit-hinweis")).toContainText("bis 14:00");
    await expect(page.getByTestId("discord-prompt")).toHaveValue(DISCORD_PROMPT_VORGABE);
    await expect(page.getByTestId("discord-kanal-bericht-quelle")).toHaveText(
        `Es gilt die Vorgabe der Umgebung: ${ERSTER}.`,
    );
    await expect(feld(page, "discord-kanal-bericht")).toHaveAttribute("placeholder", ERSTER);
    // Einen Testkanal gibt es nicht mehr (Vali 2026-10-26): Der Berichtskanal ist das einzige Kanalfeld.
    await expect(page.getByTestId("discord-kanal-test")).toHaveCount(0);
    await expect(page.getByTestId("discord-kanal-test-quelle")).toHaveCount(0);
    // 🔴 Ohne Formulierer wirkt auch ein gespeicherter Prompt nicht; solange keiner gespeichert ist, gilt die Vorgabe.
    await expect(page.getByTestId("discord-prompt-status")).toContainText(
        "Ein eigener Prompt wird erst mit Formulierer wirksam",
    );
    const speichern = page.getByTestId("discord-einstellungen-speichern");
    await expect(speichern).toBeDisabled();
    await expect(einstellungen(page).getByTestId("sperrgrund")).toHaveText("Nichts geändert.");

    // Eingaben: ein ungültiger Wert sperrt Speichern und nennt den Grund am Feld.
    await page.getByTestId("discord-prompt").fill("Trocken und knapp.");
    await expect(speichern).toBeEnabled();
    await feld(page, "discord-uhrzeit").fill("25:00");
    await expect(speichern).toBeDisabled();
    await expect(page.getByTestId("discord-uhrzeit-hinweis")).toHaveText(
        "Gültig ist eine Uhrzeit wie 10:00 (24 Stunden).",
    );
    await expect(einstellungen(page).getByTestId("sperrgrund")).toHaveText("Eine Angabe ist ungültig.");
    await feld(page, "discord-uhrzeit").fill("9:30");
    await expect(page.getByTestId("discord-uhrzeit-hinweis")).toContainText("bis 13:30");
    await feld(page, "discord-uhrzeit").fill("11:30");
    await expect(page.getByTestId("discord-uhrzeit-hinweis")).toContainText("bis 15:30");
    await feld(page, "discord-kanal-bericht").fill("123");
    await expect(speichern).toBeDisabled();
    await expect(page.getByTestId("discord-kanal-bericht-quelle")).toContainText("17 bis 20 Ziffern");
    await feld(page, "discord-kanal-bericht").fill(NEUER);
    await expect(speichern).toBeEnabled();

    await speichern.click();
    await expect(page.getByTestId("discord-einstellungen-seit")).toContainText("Rondrikan");

    // Was an den Server ging: der ganze Satz, mit Kennung; leere Felder als null.
    const post = calls.find((c) => c.method === "POST" && c.path === `${DISCORD_ADMIN_URL}/einstellungen`);
    expect(post?.body).toMatchObject({
        prompt: "Trocken und knapp.",
        uhrzeit: "11:30",
        berichtsKanal: NEUER,
    });
    expect(post?.body).not.toHaveProperty("testKanal");
    expect(String(post?.body?.["operationId"])).toMatch(/^[0-9a-f-]{36}$/u);

    // Nachher: gespeichert, aber ohne Formulierer noch ohne Wirkung; die Quelle des Kanals und das Fenster stimmen.
    await expect(page.getByTestId("discord-prompt-status")).toHaveText(
        "Prompt gespeichert, wird erst mit Formulierer wirksam. Bis dahin kommt der Bericht aus der festen Vorlage.",
    );
    await expect(page.getByTestId("discord-kanal-bericht-quelle")).toHaveText("Es gilt der Wert aus dem Reiter.");
    await expect(page.getByTestId("discord-betrieb")).toContainText("täglich 11:30 (Europe/Berlin)");
    await expect(page.getByTestId("discord-betrieb")).toContainText("zwischen 11:30 und 15:30");
    await expect(page.getByTestId("discord-kanal")).toContainText(NEUER);
    await expect(speichern).toBeDisabled();

    // Zurück auf die Vorgabe des Prompts, ein Knopf.
    await page.getByTestId("discord-prompt-vorgabe").click();
    await expect(page.getByTestId("discord-prompt")).toHaveValue(DISCORD_PROMPT_VORGABE);
    await expect(speichern).toBeEnabled();
    await page.getByTestId("discord-einstellungen-verwerfen").click();
    await expect(page.getByTestId("discord-prompt")).toHaveValue("Trocken und knapp.");
    await expect(speichern).toBeDisabled();
});

test("mit Formulierer wirkt der Prompt; ohne Bot-Schlüssel entfällt die Kanalprüfung, und der Reiter sagt beides", async ({
    page,
}) => {
    const stand = ausgangsstand();
    await oeffne(page, {
        stand: {
            formulierer: true,
            schluessel: false,
            einstellungen: { ...stand.einstellungen, prompt: "Knapp.", promptEigen: true },
        },
    });
    await expect(page.getByTestId("discord-prompt-status")).toHaveText(
        "Der Prompt wirkt beim nächsten Bericht auf den ganzen Text.",
    );
    await expect(page.getByTestId("discord-kanal-pruefung")).toHaveText(
        "Ohne Bot-Schlüssel (Production, lokal) entfällt die Prüfung des Kanals beim Speichern.",
    );
});

test("mit Bot-Schlüssel sagt der Reiter, dass der Server den Kanal beim Speichern prüft", async ({ page }) => {
    await oeffne(page);
    await expect(page.getByTestId("discord-kanal-pruefung")).toContainText("prüft der Server");
});

test("🔴 ein Kanal, den der Bot nicht nutzen kann, wird mit Kanal und Grund genannt, und die Eingabe bleibt stehen", async ({
    page,
}) => {
    await oeffne(page, {
        ablehnen: {
            status: 409,
            body: {
                error: {
                    code: "discord_kanal_unbrauchbar",
                    message: "x",
                    details: { kanal: "bericht", grund: "schreiben" },
                },
            },
        },
    });
    await feld(page, "discord-kanal-bericht").fill(NEUER);
    await page.getByTestId("discord-einstellungen-speichern").click();
    await expect(einstellungen(page).getByRole("alert")).toHaveText(
        "Berichtskanal: Der Bot darf in diesem Kanal keine Nachrichten senden.",
    );
    await expect(feld(page, "discord-kanal-bericht")).toHaveValue(NEUER);
    // Der Satz gehört zu dieser Karte und steht nicht noch einmal im Betrieb.
    await expect(page.getByTestId("discord-verwaltung").getByRole("alert")).toHaveCount(1);
});

test("steht die Umgebung noch auf dem abgeschafften Modus testkanal, sagt der Reiter, dass er wie aus wirkt", async ({
    page,
}) => {
    await oeffne(page, { stand: { modus: "aus", modusVeraltet: true, sperre: "aus", kanal: null } });
    await expect(page.getByTestId("discord-modus-veraltet")).toContainText("Modus „testkanal“");
    await expect(page.getByTestId("discord-modus-veraltet")).toContainText("wirkt wie „aus“");
});

test("ohne das Recht manage_news sieht man die Einstellungen, kann sie aber nicht ändern", async ({ page }) => {
    await oeffne(page, { darf: false });
    await expect(feld(page, "discord-uhrzeit")).toBeDisabled();
    await expect(page.getByTestId("discord-prompt")).toBeDisabled();
    await expect(page.getByTestId("discord-einstellungen-speichern")).toHaveCount(0);
});
