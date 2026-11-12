import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { de } from "../src/i18n/de.ts";
import { LOCALES, tafelVon } from "../src/i18n/i18n.ts";

/**
 * Nur Deutsch steht im Startpaket, jede andere Sprachtafel kommt per `import()` (WI-0235). Anlass: Alle neun Tafeln lagen am 19.10.
 * mit 3,3 MB im Start-JS, 47 % davon, und ein Besucher braucht eine. `vitest.setup.ts` lädt für die Webtests alle Tafeln vorab; diese
 * Fälle holen sich darum eine frische Kopie von `i18n.ts`, in der nur Deutsch geladen ist.
 */
async function frischesI18n(): Promise<typeof import("../src/i18n/i18n.ts")> {
    vi.resetModules();
    return import("../src/i18n/i18n.ts");
}

const quelle = (datei: string): string => readFileSync(new URL(`../src/i18n/${datei}`, import.meta.url), "utf8");

describe("Sprachtafeln im Test-Setup", () => {
    it("🔴 alle Tafeln sind echt geladen, keine fällt still auf Deutsch zurück (Wächter über alle Sprachen, Regel-Koordination)", () => {
        for (const sprache of LOCALES.filter((l) => l !== "de")) {
            expect(tafelVon(sprache), sprache).not.toBe(de);
            expect(tafelVon(sprache)["lang.menu"], sprache).not.toBe(de["lang.menu"]);
        }
    });
});

describe("Sprachtafeln nachladen", () => {
    afterEach(() => {
        vi.doUnmock("../src/i18n/en.ts");
    });

    it("🔴 lädt eine Tafel nicht, bleibt die bisherige Sprache stehen, nie eine halb deutsche Oberfläche", async () => {
        vi.doMock("../src/i18n/en.ts", () => {
            throw new Error("Chunk fehlt nach einem Release");
        });
        const warnung = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const i18n = await frischesI18n();
        await i18n.ladeTafel("fr");
        await i18n.setLocale("fr");
        expect(await i18n.setLocale("en")).toBe(false);
        expect(i18n.locale.value).toBe("fr");
        expect(i18n.t("lang.menu")).toBe(i18n.tafelVon("fr")["lang.menu"]);
        expect(warnung).toHaveBeenCalled();
        warnung.mockRestore();
    });

    it("🔴 lädt die Starttafel nicht, startet die Seite ganz auf Deutsch", async () => {
        vi.doMock("../src/i18n/en.ts", () => {
            throw new Error("Chunk fehlt");
        });
        const warnung = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const i18n = await frischesI18n();
        i18n.locale.value = "en";
        await i18n.ladeStarttafel();
        expect(i18n.locale.value).toBe("de");
        warnung.mockRestore();
    });

    it("🔴 keine andere Tafel wird statisch eingebunden, weder in i18n.ts noch in relative-time.ts", () => {
        for (const datei of ["i18n.ts", "relative-time.ts"]) {
            expect(quelle(datei)).not.toMatch(/^import .* from "\.\/(en|fr|es|it|nl|pl|da|sv)";?$/m);
        }
        expect(quelle("i18n.ts")).toMatch(/import\("\.\/en"\)/);
    });

    it("🔴 eine nicht geladene Sprache spricht Deutsch, nie einen nackten Schlüssel", async () => {
        const i18n = await frischesI18n();
        i18n.locale.value = "en";
        expect(i18n.t("lang.menu")).toBe("Sprache");
        expect(i18n.tafelVon("en")["lang.menu"]).toBe("Sprache");
    });

    it("🔴 setLocale schaltet erst um, wenn die Tafel da ist: kein deutsches Bild dazwischen", async () => {
        const i18n = await frischesI18n();
        i18n.locale.value = "de";
        const umschalten = i18n.setLocale("en");
        expect(i18n.locale.value).toBe("de");
        await umschalten;
        expect(i18n.locale.value).toBe("en");
        expect(i18n.t("lang.menu")).toBe("Language");
    });

    it("eine geladene Sprache schaltet sofort", async () => {
        const i18n = await frischesI18n();
        await i18n.ladeTafel("fr");
        void i18n.setLocale("fr");
        expect(i18n.locale.value).toBe("fr");
        void i18n.setLocale("de");
        expect(i18n.locale.value).toBe("de");
    });

    it("🔴 schnell zweimal gewählt: Die zweite Wahl gilt, auch wenn die erste Tafel später ankommt", async () => {
        const i18n = await frischesI18n();
        const erste = i18n.setLocale("pl");
        const zweite = i18n.setLocale("nl");
        await Promise.all([erste, zweite]);
        expect(i18n.locale.value).toBe("nl");
    });

    it("jede Tafel lädt höchstens einmal", async () => {
        const i18n = await frischesI18n();
        const a = i18n.ladeTafel("sv");
        const b = i18n.ladeTafel("sv");
        expect(a).toBe(b);
        await a;
        expect(i18n.tafelVon("sv")["lang.name.sv"]).toBe("Svenska");
    });
});
