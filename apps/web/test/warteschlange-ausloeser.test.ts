import { afterEach, describe, expect, it } from "vitest";
import { AUSLOESER_ARTEN } from "@avesmaps3d/shared";
import { locale, t } from "../src/i18n/i18n.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italienisch } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { reiheZeilen } from "../src/auth/warteschlange-reihe.ts";
import { warteSatz } from "../src/auth/abgleiche.ts";
import { warteText } from "../src/status/gemeinsam-view.ts";
import { ausloeserText, herkunftZeile } from "../src/status/job-view.ts";

/**
 * Wer, wann, wo unter jedem Auftrag der Warteschlange (WI-0293; Betreiber 2026-11-09: „Wer hat sie gestartet. Wann. Wo (Stage oder
 * Production)?“), ohne Browser: der Satzanfang je Art, Zeitpunkt wie im Protokoll, die Umgebung als Satzteil.
 */

afterEach(() => {
    locale.value = "de";
});

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const vor = (stunden: number): string => new Date(NOW - stunden * 3_600_000).toISOString();

describe("Auslöser als Satzanfang", () => {
    it("je Art ein Satz; ohne Namen die Art, ohne jede Angabe „unbekannt“", () => {
        expect(ausloeserText({ art: "person", name: "Vali" })).toBe("Ausgelöst von Vali");
        expect(ausloeserText({ art: "person", name: null })).toBe("Ausgelöst von einer Person");
        expect(ausloeserText({ art: "agent", name: "Claudio" })).toBe("Ausgelöst von Claudio");
        expect(ausloeserText({ art: "agent", name: null })).toBe("Ausgelöst von einem Agenten");
        expect(ausloeserText({ art: "kommandozeile", name: null })).toBe("Ausgelöst an der Kommandozeile");
        expect(ausloeserText({ art: "automatik", name: null })).toBe("Automatisch ausgelöst");
        expect(ausloeserText({ art: "betrieb", name: null })).toBe("Vom Betrieb ausgelöst");
        expect(ausloeserText({ art: "unbekannt", name: null })).toBe("Auslöser unbekannt");
        expect(ausloeserText(undefined)).toBe("Auslöser unbekannt");
    });

    it("🔴 jede Art hat in jeder Sprache ihren Satz, und keiner ist der deutsche", () => {
        const tafeln = { da, en, es, fr, it: italienisch, nl, pl, sv };
        const schluessel = ["von", ...AUSLOESER_ARTEN].map((art) => `status.trigger.${art}`);
        for (const key of schluessel) expect(de).toHaveProperty([key]);
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            for (const key of schluessel) {
                const wert = (tafel as Record<string, string>)[key];
                expect(wert, `${sprache}: ${key}`).toBeTruthy();
                expect(wert, `${sprache}: ${key}`).not.toBe((de as Record<string, string>)[key]);
            }
            expect((tafel as Record<string, string>)["status.trigger.von"]).toContain("{name}");
        }
    });
});

describe("die Zeile wer · wann · wo", () => {
    it("heute mit Uhrzeit, gestern mit „gestern“, davor mit Datum; die Umgebung als Ort", () => {
        const vali = { art: "person" as const, name: "Vali" };
        expect(herkunftZeile({ ausgeloest: vali, queuedAt: vor(0.1) }, "production", NOW)).toMatch(
            /^Ausgelöst von Vali · heute, \d{2}:\d{2} · auf Production$/u,
        );
        expect(herkunftZeile({ ausgeloest: vali, queuedAt: vor(24) }, "staging", NOW)).toMatch(
            /^Ausgelöst von Vali · gestern, \d{2}:\d{2} · auf der Stage$/u,
        );
        expect(herkunftZeile({ ausgeloest: vali, queuedAt: vor(24 * 5) }, "production", NOW)).toMatch(
            /^Ausgelöst von Vali · \d{2}\.\d{2}\., \d{2}:\d{2} · auf Production$/u,
        );
    });

    it("ein Auftrag der anderen Umgebung mit Namen aus dem Stand", () => {
        expect(
            herkunftZeile({ ausgeloest: { art: "person", name: "Vali" }, queuedAt: vor(0.1) }, "production", NOW),
        ).toMatch(/^Ausgelöst von Vali · heute, \d{2}:\d{2} · auf Production$/u);
    });

    it("ein älterer Server ohne Auslöser und Umgebung: „unbekannt“ und kein Ort, nie geraten", () => {
        expect(herkunftZeile({ queuedAt: vor(0.1) }, null, NOW)).toMatch(/^Auslöser unbekannt · heute, \d{2}:\d{2}$/u);
    });

    it("in der Sprache der Seite", () => {
        locale.value = "en";
        expect(herkunftZeile({ ausgeloest: { art: "person", name: "Vali" }, queuedAt: vor(0.1) }, "staging", NOW)).toBe(
            `${t("status.trigger.von", { name: "Vali" })} · ${t("ui.time.todayAt", {
                time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
                    new Date(vor(0.1)),
                ),
            })} · ${t("status.umgebung.at.staging")}`,
        );
        expect(t("status.trigger.von", { name: "Vali" })).toBe("Started by Vali");
    });
});

describe("ein sammelnder Auftrag nennt seine Restzeit, nie „{time}“", () => {
    const start = new Date(NOW + 13_000).toISOString();

    it("mit frühestem Start die Restzeit, ohne ihn „unbekannt“", () => {
        expect(warteText("debouncing", start, NOW)).toBe("Wird gesammelt, noch 13 s.");
        expect(warteText("debouncing", null, NOW)).toBe("Wird gesammelt, noch unbekannt.");
        expect(warteText("debouncing")).not.toContain("{");
        expect(warteSatz("debouncing")).not.toContain("{");
        expect(warteText("waits_slot")).toBe("Wartet auf einen freien Platz.");
    });

    it("die Karte der Verwaltung rechnet dieselbe Restzeit", () => {
        const [zeile] = reiheZeilen(
            [
                {
                    umgebung: "production",
                    eigen: false,
                    jobId: null,
                    kind: "terrain_local",
                    label: null,
                    state: "QUEUED",
                    platz: 3,
                    phase: null,
                    progress: null,
                    waitReason: "debouncing",
                    queuedAt: new Date(NOW - 60_000).toISOString(),
                    startedAt: null,
                    notBefore: start,
                },
            ],
            NOW,
        );
        expect(zeile?.unter).toContain("Wird gesammelt, noch 13 s.");
    });
});
