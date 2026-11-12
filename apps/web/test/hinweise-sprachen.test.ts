import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { HinweiseDokument, LEGAL_NOTICES } from "@avesmaps3d/shared";
import { LOCALES } from "../src/i18n/i18n.ts";
import { klartext, zerlegeInline, zieleVon } from "../src/legal/hinweise-inline.ts";

/**
 * Die Hinweise in jeder Sprache (`config/legal/hinweise/<sprache>.json`, `hinweise-sprachen.ts`): Der Sinn lässt sich hier nicht prüfen, aber alles, woran ein Link, ein Sprung oder das Bauteil hängt: gleicher Aufbau,
 * gleiche Kennungen, gleiche Sprungziele, die Mailadresse als Platzhalter. 🔴 Die Sprache bleibt nur Sprache: Eine Kennung ist eine Adresse, die jemand geteilt hat.
 */

const SPRACHEN = LOCALES.filter((sprache) => sprache !== "de");
const fassung = (sprache: string): HinweiseDokument & { uebersetzung: string } =>
    JSON.parse(readFileSync(new URL(`../../../config/legal/hinweise/${sprache}.json`, import.meta.url), "utf8"));

/** Der Aufbau ohne Texte: Blockarten, Kennungen, Längen und alles, was keine Sprache hat. */
function geruest(wert: unknown, schluessel = ""): unknown {
    if (typeof wert === "string") return ["id", "art", "src", "ziel"].includes(schluessel) ? wert : "·";
    if (Array.isArray(wert)) return wert.map((eintrag) => geruest(eintrag, schluessel));
    if (wert !== null && typeof wert === "object")
        return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, geruest(v, k)]));
    return wert;
}

function alleTexte(wert: unknown, schluessel = ""): string[] {
    if (typeof wert === "string")
        return ["id", "art", "src", "ziel", "uebersetzung"].includes(schluessel) ? [] : [wert];
    if (Array.isArray(wert)) return wert.flatMap((eintrag) => alleTexte(eintrag, schluessel));
    if (wert !== null && typeof wert === "object") return Object.entries(wert).flatMap(([k, v]) => alleTexte(v, k));
    return [];
}

const deutsch = LEGAL_NOTICES.hinweise;
const deutscheTexte = alleTexte(deutsch);

describe.each(SPRACHEN)("Die Hinweise auf %s", (sprache) => {
    const datei = fassung(sprache);
    const { uebersetzung, ...dokument } = datei;
    const texte = alleTexte(dokument);

    it("erfüllen das Schema und sagen, dass die deutsche Fassung gilt", () => {
        expect(Value.Check(HinweiseDokument, dokument)).toBe(true);
        expect(uebersetzung.length).toBeGreaterThan(20);
    });

    it("🔴 haben denselben Aufbau wie die deutsche Fassung: Blöcke, Kennungen, Sprungziele", () => {
        expect(geruest(dokument)).toEqual(geruest(deutsch));
    });

    it("🔴 tragen in jedem Text dieselben Sprünge, gleich viele Verweise, die Mailadresse als Platzhalter", () => {
        const fehler = texte.flatMap((text, stelle) => {
            const vorlage = deutscheTexte[stelle] ?? "";
            const ziele = (t: string): string[] => zieleVon(zerlegeInline(t));
            const sprung = (t: string): string[] => ziele(t).filter((ziel) => !ziel.startsWith("http"));
            const anzahl = (t: string, teil: string): number => t.split(teil).length - 1;
            return JSON.stringify(sprung(text)) === JSON.stringify(sprung(vorlage)) &&
                ziele(text).length === ziele(vorlage).length &&
                anzahl(text, "**") === anzahl(vorlage, "**") &&
                anzahl(text, "{mail}") === anzahl(vorlage, "{mail}")
                ? []
                : [vorlage.slice(0, 70)];
        });
        expect(fehler).toEqual([]);
    });

    it("🔴 stehen wirklich in der Sprache: Mehrwortige Sätze sind nicht das Deutsche", () => {
        const gleich = texte.filter(
            (text, stelle) => text === deutscheTexte[stelle] && klartext(text).split(/\s+/u).length > 6,
        );
        expect(gleich).toEqual([]);
    });
});
