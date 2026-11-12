import { describe, expect, it } from "vitest";
import { CAPABILITY_NAMES } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de";

/**
 * 🔴 Die Tafeln der Rechte und Sonderrollen lesen ihre Texte über `label()`: Fehlt ein Schlüssel, steht dort still die technische Kennung (Vali 2026-11-05 am Kartographen:
 * zweimal „export_maps“). Der Typcheck sieht das nicht, weil der Schlüssel erst zur Laufzeit entsteht. Darum hier: Jedes Recht hat einen Namen und einen Satz. Dass jede
 * andere Sprache dieselben Schlüssel trägt, verlangt schon der Typ der Tafeln.
 */
describe("Texte der Rechte", () => {
    const tafel: Readonly<Record<string, string>> = de;

    it("jedes Recht hat einen Namen", () => {
        expect(CAPABILITY_NAMES.filter((name) => tafel[`auth.capability.${name}`] === undefined)).toEqual([]);
    });

    it("jedes Recht hat einen Satz, was es erlaubt", () => {
        expect(CAPABILITY_NAMES.filter((name) => tafel[`admin.capability.${name}`] === undefined)).toEqual([]);
    });
});
