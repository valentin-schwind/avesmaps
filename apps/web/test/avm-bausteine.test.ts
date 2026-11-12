import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_TOENE, avatarInitiale, avatarTon } from "../src/controls/avm-avatar.ts";
import { autocompleteVorgabe, eingabeTyp } from "../src/controls/avm-eingabe.ts";
import { useKopieren } from "../src/controls/avm-kopierfeld.ts";
import { beschriebenVon, sperre, teileAttrs } from "../src/controls/bedienelement.ts";
import { de } from "../src/i18n/de.ts";
import { relativeTime } from "../src/i18n/relative-time.ts";

/**
 * Die Bausteine der Oberfläche aus WI-0120 A8 (AUTH-0001 §12.3), ohne Browser: was sie rechnen (relative Zeit, Ton und
 * Buchstabe des Avatars, Kopieren, Sperre mit Grund) und was ihre Stildateien zusichern - nur Kanonwerte, die Zustände
 * aus Guide §30.5, der Fokusring komponiert und ohne Rückfall, die Versalhöhe mittig, keine Deckkraft als Hover.
 * Wie sie im Fenster aussehen, zeigt das Gestaltungsblatt `review/wi-0120/blatt-a8.png`; im Browser gemessen werden sie,
 * sobald A9 sie einhängt.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const datei = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");
const canon = JSON.parse(datei("config/design-canon/avesmaps.json")) as {
    colour: Record<string, string>;
    colourDark: Record<string, string>;
    focusRing: { width: number };
    statusDot: { size: number; halo: number };
    fenster: { breite: Record<string, number> };
};

const BAUSTEINE = [
    "avm-knopf",
    "avm-eingabe",
    "avm-auswahl",
    "avm-pille",
    "avm-status",
    "avm-avatar",
    "avm-kopierfeld",
    "avm-hinweis",
    "avm-bestaetigung",
    "avm-sperrgrund",
].map((name) => `apps/web/src/controls/${name}.vue`);

/** Die Bedienelemente unter ihnen: Sie brauchen die ganze Mindestliste aus Guide §30.5. */
const BEDIENBAR = ["avm-knopf", "avm-eingabe", "avm-auswahl"].map((name) => `apps/web/src/controls/${name}.vue`);

/** Der Stilblock einer Vue-Datei ohne Kommentare: Ein Kommentar darf einen Wert nennen, er erklärt ihn ja. */
function stil(pfad: string): string {
    const block = /<style scoped>([\s\S]*?)<\/style>/.exec(datei(pfad))?.[1] ?? "";
    return block.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** WCAG-Kontrast zweier Hexfarben (dieselbe Rechnung wie `info-pillen-masse.test.ts`). */
function kontrast(a: string, b: string): number {
    const helligkeit = (hex: string): number => {
        const [r, g, bl] = [1, 3, 5].map((at) => {
            const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [helligkeit(a), helligkeit(b)].sort((m, n) => n - m) as [number, number];
    return (x + 0.05) / (y + 0.05);
}

const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const tokenName = (variable: string): string =>
    Object.keys(canon.colour).find((name) => `--color-${kebab(name)}` === variable) ?? variable;
const hell = (variable: string): string => canon.colour[tokenName(variable)] ?? variable;
const dunkel = (variable: string): string =>
    canon.colourDark[tokenName(variable)] ?? canon.colour[tokenName(variable)] ?? variable;

describe("Kanon: die Ergänzungen aus A8 (AUTH-0001 §12.3)", () => {
    it("🔴 success- und danger-soft hell und dunkel wörtlich aus Legacy (tokens.css:208-213, 1112-1117 an cbe27821)", () => {
        expect([
            canon.colour["successSoft"],
            canon.colour["successSoftBorder"],
            canon.colour["successSoftText"],
            canon.colour["dangerSoft"],
            canon.colour["dangerSoftBorder"],
            canon.colour["dangerSoftText"],
        ]).toEqual(["#eef6e2", "#a9c07f", "#3c5a1c", "#fbeae6", "#d3a79c", "#8a2d22"]);
        expect([
            canon.colourDark["successSoft"],
            canon.colourDark["successSoftBorder"],
            canon.colourDark["successSoftText"],
            canon.colourDark["dangerSoft"],
            canon.colourDark["dangerSoftBorder"],
            canon.colourDark["dangerSoftText"],
        ]).toEqual(["#2c3a24", "#4d6b3a", "#9cd39a", "#3f2a26", "#6b463f", "#e29c8f"]);
    });

    it("jedes weiche Tripel liest: Schrift gegen Fläche mindestens 4,5 : 1, hell und dunkel", () => {
        for (const art of ["success", "danger", "warning"]) {
            const flaeche = `${art}Soft`;
            const schrift = `${art}SoftText`;
            expect(kontrast(canon.colour[flaeche] ?? "", canon.colour[schrift] ?? ""), `${art} hell`).toBeGreaterThan(
                4.5,
            );
            expect(
                kontrast(canon.colourDark[flaeche] ?? "", canon.colourDark[schrift] ?? ""),
                `${art} dunkel`,
            ).toBeGreaterThan(4.5);
        }
    });

    it("die zweite Zeile auf dem gefüllten Knopf ist themenunabhängig, wie in Legacy (tokens.css:747)", () => {
        expect(canon.colour["onButtonMuted"]).toBe("rgba(255, 255, 255, 0.8)");
        expect(canon.colourDark["onButtonMuted"]).toBeUndefined();
    });

    it("der Hof des Statuspunkts: Legacy für Erfolg und Ruhe, nach Legacys Regel für Gefahr und Warnung", () => {
        expect(canon.colour["successHalo"]).toBe("rgba(79, 159, 74, 0.16)");
        expect(canon.colour["mutedHalo"]).toBe("rgba(161, 140, 116, 0.16)");
        expect(canon.colourDark["successHalo"]).toBe("rgba(124, 196, 138, 0.22)");
        expect(canon.colourDark["mutedHalo"]).toBe("rgba(180, 168, 149, 0.2)");
        // Hell die Statusfarbe mit 0,16, dunkel die dunkle Statusfarbe mit 0,22 - abgeleitet, nicht erfunden.
        const rgba = (hex: string, alpha: number): string =>
            `rgba(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")}, ${String(alpha)})`;
        for (const art of ["danger", "warning"]) {
            expect(canon.colour[`${art}Halo`], art).toBe(rgba(canon.colour[art] ?? "", 0.16));
            expect(canon.colourDark[`${art}Halo`], art).toBe(rgba(canon.colourDark[art] ?? "", 0.22));
        }
        expect(canon.statusDot).toEqual({ size: 9, halo: 3 });
    });

    it("🔴 `--focus-ring` steht im erzeugten Kanon, als Legacys Ring aus Breite und `--color-focus`", () => {
        const css = datei("apps/web/src/styles/canon.css");
        expect(canon.focusRing.width).toBe(3);
        expect(css).toContain("--focus-ring: 0 0 0 3px var(--color-focus);");
        // Kein eigener Dunkelwert: Der Ring verweist auf `--color-focus`, und das kippt mit dem Thema.
        const dunklerBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
        expect(dunklerBlock.slice(0, dunklerBlock.indexOf("}"))).not.toContain("--focus-ring");
        expect(css).toContain("--avm-status-dot: 9px;");
        expect(css).toContain("--avm-status-halo: 3px;");
        expect(css).toContain("--font-size-touch: 16px;");
    });

    it("die Verwaltung hat ihre benannte Breite (AUTH-0001 §12.4: 1040 statt 860/940)", () => {
        expect(canon.fenster.breite["verwaltung"]).toBe(1040);
        expect(datei("apps/web/src/styles/canon.css")).toContain("--avm-fenster-verwaltung: 1040px;");
    });
});

describe("Die Bausteine nehmen nur Kanonwerte und tragen ihre Zustände (Guide §30.5)", () => {
    const definiert = new Set(
        [...datei("apps/web/src/styles/canon.css").matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((treffer) => treffer[1]),
    );

    it("🔴 keine Farbe als Literal, Pixel nur als Linie (1 und 2 px, der Hinweisbalken 3 px wie Legacy)", () => {
        const verstoesse: string[] = [];
        for (const pfad of BAUSTEINE) {
            for (const zeile of stil(pfad).split("\n")) {
                const ohneLinie = zeile
                    .replace(/\b[12]px\b/g, "")
                    .replace(/^\s*border-left:\s*3px solid/, "border-left: solid");
                if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b\d+(\.\d+)?px\b/.test(ohneLinie)) {
                    verstoesse.push(`${pfad}: ${zeile.trim()}`);
                }
            }
        }
        expect(verstoesse).toEqual([]);
    });

    it("🔴 jede gelesene Variable steht im Kanon - keine erfundene, keine vertippte", () => {
        const fehlt: string[] = [];
        for (const pfad of BAUSTEINE) {
            for (const [, name] of stil(pfad).matchAll(/var\((--[a-z0-9-]+)/g)) {
                if (!definiert.has(name ?? "")) fehlt.push(`${pfad}: ${String(name)}`);
            }
        }
        expect(fehlt).toEqual([]);
    });

    it("🔴 der Fokusring ohne Rückfall - `--focus-ring` steht seit A8 im Kanon", () => {
        for (const pfad of BAUSTEINE) expect(stil(pfad), pfad).not.toMatch(/var\(--focus-ring,/);
    });

    it("🔴 Deckkraft heißt nie „Hover“ und Fett wirkt nicht (Guide §30.2, §3)", () => {
        for (const pfad of BAUSTEINE) {
            expect(stil(pfad), pfad).not.toMatch(/\bopacity\s*:/);
            expect(stil(pfad), pfad).not.toMatch(/font-weight:\s*(500|600|700|800|900|bold)/);
        }
    });

    it("🔴 jedes Bedienelement hat Ruhe, Hover, Aktiv, Fokus, Gesperrt und Übergang - und schaltet die Bewegung ab", () => {
        for (const pfad of BEDIENBAR) {
            const css = stil(pfad);
            expect(css, `${pfad}: Hover`).toMatch(/:hover/);
            expect(css, `${pfad}: Aktiv`).toMatch(/:active/);
            expect(css, `${pfad}: Fokus`).toMatch(/:focus(-visible)?\b/);
            expect(css, `${pfad}: Fokusring`).toContain("var(--focus-ring)");
            expect(css, `${pfad}: Gesperrt`).toMatch(/:disabled|\.is-gesperrt/);
            expect(css, `${pfad}: Gesperrt`).toContain("var(--color-disabled-");
            expect(css, `${pfad}: Gesperrt`).toContain("cursor: not-allowed");
            expect(css, `${pfad}: Übergang`).toContain("120ms ease");
            expect(css, `${pfad}: reduzierte Bewegung`).toContain("prefers-reduced-motion: reduce");
            // Gesperrt antwortet nicht auf den Zeiger (§7: keine Aufhellung auf einem gesperrten Knopf).
            expect(css, `${pfad}: Hover sperrt aus`).toMatch(/:hover:not\((:disabled|\.is-gesperrt)\)/);
        }
    });

    it("🔴 der Knopf komponiert den Ring mit seinem Schatten und hebt sich nur ohne reduzierte Bewegung", () => {
        const css = stil("apps/web/src/controls/avm-knopf.vue");
        expect(css).toContain("box-shadow: var(--focus-ring), var(--shadow-button-hover);");
        expect(css).toContain("box-shadow: var(--focus-ring), var(--shadow-button-hover-strong);");
        expect(css).toContain("transform: translateY(-1px);");
        const ruhig = css.slice(css.indexOf("prefers-reduced-motion"));
        expect(ruhig).toContain("transition: none");
        expect(ruhig).toContain("transform: none");
    });

    it("die Gefahr warnt, sie schreit nicht: umrandet im weichen Tripel, die Fläche bleibt (Guide §13.11)", () => {
        const css = stil("apps/web/src/controls/avm-knopf.vue");
        const gefahr = /\.knopf--gefahr \{([^}]*)\}/.exec(css)?.[1] ?? "";
        expect(gefahr).toContain("var(--color-danger-soft-border)");
        expect(gefahr).toContain("var(--color-danger-soft-text)");
        expect(gefahr).not.toContain("background");
        expect(css).not.toContain("var(--color-danger)");
    });

    it("🔴 Etikett, Status, Knopf und Avatar setzen die Versalhöhe in die Mitte - über die Klasse, nie selbst (Guide §3.2)", () => {
        for (const name of ["avm-pille", "avm-status", "avm-knopf", "avm-avatar", "avm-eingabe"]) {
            const pfad = `apps/web/src/controls/${name}.vue`;
            expect(datei(pfad), pfad).toContain("avm-versalmitte");
            expect(stil(pfad), pfad).not.toContain("text-box");
        }
    });

    it("die Pille trägt je Ton ihr ganzes Tripel, der Hinweis warnt mit dem Balken und weist mit dem Tripel ab", () => {
        const pille = stil("apps/web/src/controls/avm-pille.vue");
        for (const [ton, art] of [
            ["erfolg", "success"],
            ["warnung", "warning"],
            ["gefahr", "danger"],
        ] as const) {
            const regel = new RegExp(`\\.pille--${ton} \\{([^}]*)\\}`).exec(pille)?.[1] ?? "";
            expect(regel, ton).toContain(`var(--color-${art}-soft-border)`);
            expect(regel, ton).toContain(`var(--color-${art}-soft)`);
            expect(regel, ton).toContain(`var(--color-${art}-soft-text)`);
        }
        // Warnung: „Nur die Kante ist die warnende statt der ruhigen“ (Legacy landschaft-dialog.css `__warnung`).
        const hinweis = stil("apps/web/src/controls/avm-hinweis.vue");
        expect(/\.hinweis--warnung \{([^}]*)\}/.exec(hinweis)?.[1]?.trim()).toBe(
            "border-left-color: var(--color-warning);",
        );
        // Gefahr: das weiche Tripel wie Legacys abgewiesene Anmeldung (edit.css `.edit-login__error`).
        const gefahr = /\.hinweis--gefahr \{([^}]*)\}/.exec(hinweis)?.[1] ?? "";
        expect(gefahr).toContain("border-left-color: var(--color-danger);");
        expect(gefahr).toContain("background: var(--color-danger-soft);");
        expect(gefahr).toContain("color: var(--color-danger-soft-text);");
    });

    it("der Statuspunkt trägt Punkt und Hof aus dem Kanon, je Ton die Hoffarbe seiner Familie (Guide §15)", () => {
        const css = stil("apps/web/src/controls/avm-status.vue");
        expect(css).toContain("width: var(--avm-status-dot);");
        expect(css).toContain("box-shadow: 0 0 0 var(--avm-status-halo) var(--color-muted-halo);");
        for (const art of ["success", "warning", "danger"]) {
            expect(css, art).toContain(`box-shadow: 0 0 0 var(--avm-status-halo) var(--color-${art}-halo);`);
        }
    });
});

describe("Bausteine, die Fenster brauchen (AUTH-0001 §12.3, Risiken R5 und R6)", () => {
    /** Die Datei ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen (wie `fenster-huelle.test.ts`). */
    const vorlage = (name: string): string =>
        datei(`apps/web/src/controls/${name}.vue`)
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");

    it("🔴 die Auswahl ist ein natives `<select>` - sie geht im modalen Fenster auf, keine Liste nach `body`", () => {
        expect(vorlage("avm-auswahl")).toContain("<select");
        expect(vorlage("avm-auswahl")).not.toContain("Teleport");
    });

    it("🔴 das Kopierfeld meldet im Feld, nicht im Toast, und kopiert über den Weg des Kurzlinks", () => {
        const quelle = vorlage("avm-kopierfeld");
        expect(quelle).toContain('import { copyToClipboard } from "../route-planner/use-share-link"');
        expect(quelle).toContain('role="status"');
        expect(quelle).toContain("readonly");
        expect(quelle).not.toMatch(/feedback\/toast|useToast|showToast/);
    });

    it("🔴 die Bestätigung ist kein zweites Fenster: eine Gruppe im Fenster, Escape bleibt bei ihr", () => {
        const quelle = vorlage("avm-bestaetigung");
        expect(quelle).toContain('role="group"');
        expect(quelle).not.toMatch(/role="(alert)?dialog"|<dialog/);
        expect(quelle).toContain("@keydown.esc");
        expect(quelle).toContain("event.preventDefault()");
        expect(quelle).toContain('art="gefahr"');
    });

    it("🔴 gesperrt heißt mit Satz: Knopf, Feld und Auswahl zeigen ihn sichtbar und verweisen darauf", () => {
        for (const name of ["avm-knopf", "avm-eingabe", "avm-auswahl"]) {
            const quelle = vorlage(name);
            expect(quelle, name).toContain("<AvmSperrgrund");
            expect(quelle, name).toContain(':aria-describedby="beschreibung"');
        }
        expect(vorlage("avm-knopf")).toContain(':title="zustand.grund');
    });

    it("die Texte kommen aus der Sprachtafel - jeder gelesene Schlüssel steht in `de.ts`", () => {
        for (const pfad of BAUSTEINE) {
            for (const [, key] of datei(pfad).matchAll(/\bt\("([\w.]+)"\)/g)) {
                expect(Object.hasOwn(de, key ?? ""), `${pfad}: ${String(key)}`).toBe(true);
            }
        }
    });
});

describe("Sperre mit Grund und die geteilten Attribute", () => {
    it("ohne Angabe frei, mit Satz gesperrt; ein leerer Satz sperrt trotzdem, zeigt aber nichts", () => {
        expect(sperre(undefined)).toEqual({ gesperrt: false, grund: undefined });
        expect(sperre("erst nach der Prüfung")).toEqual({ gesperrt: true, grund: "erst nach der Prüfung" });
        expect(sperre("  ")).toEqual({ gesperrt: true, grund: undefined });
    });

    it("`aria-describedby` verbindet, was der Aufrufer und der Baustein beitragen, ohne Doppel", () => {
        expect(beschriebenVon(undefined, undefined)).toBeUndefined();
        expect(beschriebenVon("v-1", "v-2")).toBe("v-1 v-2");
        expect(beschriebenVon("v-1 v-2", "v-2", 7, null)).toBe("v-1 v-2");
        expect(beschriebenVon("", "  ")).toBeUndefined();
    });

    it("Klasse und Stil gehen an die Hülle, alles andere an das Bedienelement", () => {
        const onClick = (): void => undefined;
        expect(
            teileAttrs({ class: "breit", style: { width: "50%" }, id: "x", onClick, "aria-label": "Suche" }),
        ).toEqual({
            huelle: { class: "breit", style: { width: "50%" } },
            element: { id: "x", onClick, "aria-label": "Suche" },
        });
    });
});

describe("Das Textfeld", () => {
    it("ein Passwort wird zum Text, solange es angezeigt wird; die Suche ist eine Suche", () => {
        expect(eingabeTyp("passwort", false)).toBe("password");
        expect(eingabeTyp("passwort", true)).toBe("text");
        expect(eingabeTyp("suche", true)).toBe("search");
        expect(eingabeTyp("text", true)).toBe("text");
        expect(eingabeTyp("datum", false)).toBe("date");
    });

    it("🔴 das Passwortfeld nimmt den Passwortmanager mit, die Suche merkt sich nichts (AUTH-0001 §6.4)", () => {
        expect(autocompleteVorgabe("passwort")).toBe("current-password");
        expect(autocompleteVorgabe("suche")).toBe("off");
        expect(autocompleteVorgabe("text")).toBeUndefined();
    });
});

describe("Der Avatar: Farbe aus der Kennung, nie aus dem Namen", () => {
    const uuid = (n: number): string => {
        // Feste, gestreute Kennungen ohne Zufall: ein einfacher Zahlengenerator, wie er in Tests üblich ist.
        let x = (n + 1) * 2654435761;
        const hex = Array.from({ length: 32 }, () => {
            x = (Math.imul(x, 1103515245) + 12345) >>> 0;
            return (x >>> 16) % 16;
        })
            .map((ziffer) => ziffer.toString(16))
            .join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };

    it("🔴 dieselbe Kennung gibt denselben Ton, in jeder Schreibung; der Name spielt keine Rolle", () => {
        const kennung = "0b6f3c2e-5a7d-4e19-9c41-2f8d7a6b5c3e";
        expect(avatarTon(kennung)).toBe(avatarTon(kennung.toUpperCase()));
        expect(avatarTon(kennung)).toBe(avatarTon(` ${kennung} `));
        expect(avatarTon(kennung)).toBeGreaterThanOrEqual(0);
        expect(avatarTon(kennung)).toBeLessThan(AVATAR_TOENE);
        // Die Funktion kennt den Namen gar nicht: Umbenennen kann den Ton nicht ändern.
        expect(avatarTon.length).toBe(1);
    });

    it("über viele Kennungen kommt jeder Ton vor, keiner überwiegt", () => {
        const zaehler = new Array<number>(AVATAR_TOENE).fill(0);
        for (let n = 0; n < 1400; n += 1) zaehler[avatarTon(uuid(n))] = (zaehler[avatarTon(uuid(n))] ?? 0) + 1;
        for (const anzahl of zaehler) {
            expect(anzahl).toBeGreaterThan(1400 / AVATAR_TOENE / 2);
            expect(anzahl).toBeLessThan((1400 / AVATAR_TOENE) * 2);
        }
    });

    it("der Buchstabe: das erste Zeichen, das ein Buchstabe oder eine Ziffer ist, groß", () => {
        expect(avatarInitiale("Rondrikan")).toBe("R");
        expect(avatarInitiale("praiodan_42")).toBe("P");
        expect(avatarInitiale("_Hesindiane")).toBe("H");
        expect(avatarInitiale(".ägir")).toBe("Ä");
        expect(avatarInitiale("42er")).toBe("4");
        expect(avatarInitiale("  ")).toBe("?");
        expect(avatarInitiale("…")).toBe("?");
    });

    it("🔴 je Ton genau eine Regel, und jedes Paar liest hell wie dunkel mit mindestens 4,5 : 1", () => {
        const css = stil("apps/web/src/controls/avm-avatar.vue");
        const regeln = [...css.matchAll(/\.avatar\[data-ton="(\d+)"\] \{([^}]*)\}/g)];
        expect(regeln.map((regel) => Number(regel[1]))).toEqual([...Array(AVATAR_TOENE).keys()]);
        for (const [, ton, rumpf] of regeln) {
            const flaeche = /background: var\((--[a-z-]+)\)/.exec(rumpf ?? "")?.[1] ?? "";
            const schrift = /color: var\((--[a-z-]+)\)/.exec(rumpf ?? "")?.[1] ?? "";
            expect(kontrast(hell(flaeche), hell(schrift)), `Ton ${String(ton)} hell`).toBeGreaterThanOrEqual(4.5);
            expect(kontrast(dunkel(flaeche), dunkel(schrift)), `Ton ${String(ton)} dunkel`).toBeGreaterThanOrEqual(4.5);
            // Kein Blau und keine Statusbedeutung (Guide P2): nur warme Töne aus Bedienung, Akzent und Etikett.
            expect(flaeche, `Ton ${String(ton)}`).not.toMatch(/success|danger|warning|kanon|hidden|route|tier/);
        }
    });
});

describe("Kopieren: die Rückmeldung im Feld", () => {
    it("gelungen heißt „kopiert“, misslungen „fehler“, ein neuer Wert setzt zurück", async () => {
        const geschrieben: string[] = [];
        const ok = useKopieren(async (text) => {
            geschrieben.push(await text);
            return true;
        });
        expect(ok.zustand.value).toBe("ruhe");
        expect(await ok.kopiere("https://stage.avesmaps.de/einladung#q7Xk")).toBe(true);
        expect(ok.zustand.value).toBe("kopiert");
        expect(geschrieben).toEqual(["https://stage.avesmaps.de/einladung#q7Xk"]);
        ok.zuruecksetzen();
        expect(ok.zustand.value).toBe("ruhe");

        const nein = useKopieren(() => Promise.resolve(false));
        expect(await nein.kopiere("x")).toBe(false);
        expect(nein.zustand.value).toBe("fehler");

        const wirft = useKopieren(() => Promise.reject(new Error("verweigert")));
        expect(await wirft.kopiere("x")).toBe(false);
        expect(wirft.zustand.value).toBe("fehler");
    });

    it("ein leerer Wert wird nicht kopiert, sondern gemeldet", async () => {
        let gerufen = false;
        const leer = useKopieren(() => {
            gerufen = true;
            return Promise.resolve(true);
        });
        expect(await leer.kopiere("")).toBe(false);
        expect(gerufen).toBe(false);
        expect(leer.zustand.value).toBe("fehler");
    });

    it("🪤 eine späte Antwort eines älteren Klicks überschreibt die jüngere nicht", async () => {
        let loese: (wert: boolean) => void = () => undefined;
        const zweite = new Promise<boolean>((resolve) => {
            loese = resolve;
        });
        let aufruf = 0;
        const kopieren = useKopieren(() => {
            aufruf += 1;
            return aufruf === 1 ? zweite : Promise.resolve(true);
        });
        const alt = kopieren.kopiere("alt");
        await kopieren.kopiere("neu");
        expect(kopieren.zustand.value).toBe("kopiert");
        loese(false);
        await alt;
        expect(kopieren.zustand.value).toBe("kopiert");
    });
});

describe("Relative Zeit (Legacy `formatPresenceAge`, Mockup der Verwaltung)", () => {
    // Ortszeit wie im Browser des Betrachters: 9. Oktober 2026, 14:05.
    const jetzt = new Date(2026, 9, 9, 14, 5, 0);
    const vor = (ms: number): Date => new Date(jetzt.getTime() - ms);
    const MIN = 60_000;
    const STD = 60 * MIN;

    it("deutsch: gerade eben, Minuten, Stunden", () => {
        expect(relativeTime(vor(0), jetzt, "de")).toBe("gerade eben");
        expect(relativeTime(vor(29_000), jetzt, "de")).toBe("gerade eben");
        expect(relativeTime(vor(45_000), jetzt, "de")).toBe("vor 1 Min.");
        expect(relativeTime(vor(4 * MIN), jetzt, "de")).toBe("vor 4 Min.");
        expect(relativeTime(vor(30 * MIN), jetzt, "de")).toBe("vor 30 Min.");
        expect(relativeTime(vor(3 * STD), jetzt, "de")).toBe("vor 3 Std.");
        expect(relativeTime(vor(14 * STD), jetzt, "de")).toBe("vor 14 Std.");
        expect(relativeTime(vor(23 * STD + 50 * MIN), jetzt, "de")).toBe("vor 23 Std.");
    });

    it("🪤 ab einem Tag zählt der Kalender: der Vortag heißt „gestern“, davor „vor N Tagen“, nie „vor 1 Tagen“", () => {
        expect(relativeTime(new Date(2026, 9, 8, 9, 0), jetzt, "de")).toBe("gestern");
        expect(relativeTime(new Date(2026, 9, 7, 23, 30), jetzt, "de")).toBe("vor 2 Tagen");
        expect(relativeTime(new Date(2026, 8, 27, 12, 0), jetzt, "de")).toBe("vor 12 Tagen");
        // Unter 24 Stunden bleibt es bei Stunden, auch über Mitternacht (Legacy).
        expect(relativeTime(new Date(2026, 9, 8, 22, 0), jetzt, "de")).toBe("vor 16 Std.");
    });

    it("englisch: just now, min, h, yesterday, days", () => {
        expect(relativeTime(vor(10_000), jetzt, "en")).toBe("just now");
        expect(relativeTime(vor(4 * MIN), jetzt, "en")).toBe("4 min ago");
        expect(relativeTime(vor(3 * STD), jetzt, "en")).toBe("3 h ago");
        expect(relativeTime(new Date(2026, 9, 8, 9, 0), jetzt, "en")).toBe("yesterday");
        expect(relativeTime(new Date(2026, 8, 27, 12, 0), jetzt, "en")).toBe("12 days ago");
    });

    it("Zeitpunkt fürs Protokoll: heute, gestern, Datum, in einem anderen Jahr mit Jahr", () => {
        expect(relativeTime(new Date(2026, 9, 9, 14, 3), jetzt, "de", "zeitpunkt")).toBe("heute, 14:03");
        expect(relativeTime(new Date(2026, 9, 8, 22, 17), jetzt, "de", "zeitpunkt")).toBe("gestern, 22:17");
        expect(relativeTime(new Date(2026, 8, 23, 21, 5), jetzt, "de", "zeitpunkt")).toBe("23.09., 21:05");
        expect(relativeTime(new Date(2025, 11, 31, 9, 7), jetzt, "de", "zeitpunkt")).toBe("31.12.2025, 09:07");
        expect(relativeTime(new Date(2026, 9, 9, 0, 0), jetzt, "en", "zeitpunkt")).toBe("today, 00:00");
        expect(relativeTime(new Date(2026, 9, 8, 22, 17), jetzt, "en", "zeitpunkt")).toBe("yesterday, 22:17");
        expect(relativeTime(new Date(2026, 8, 23, 21, 5), jetzt, "en", "zeitpunkt")).toBe("23/09, 21:05");
    });

    it("die Zukunft (die Uhr des Servers geht vor) ist „gerade eben“, ein ungültiges Datum nichts", () => {
        expect(relativeTime(new Date(jetzt.getTime() + 5 * MIN), jetzt, "de")).toBe("gerade eben");
        expect(relativeTime(new Date("kein Datum"), jetzt, "de")).toBe("");
    });
});
