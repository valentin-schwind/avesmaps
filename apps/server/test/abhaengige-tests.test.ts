import { describe, expect, it } from "vitest";
import { abhaengigeTests, auswahlKosten } from "../../../scripts/dev/abhaengige-tests.ts";
import { waehleTests } from "../../../scripts/dev/pruef-auswahl.ts";

describe("begrenzte Importauswahl", () => {
    const quellen = [
        { pfad: "apps/web/src/kamera.ts", text: "export const x = 1" },
        { pfad: "apps/web/src/fahrt.ts", text: 'import { x } from "./kamera.ts";' },
        { pfad: "apps/web/test/fahrt.test.ts", text: 'import "../src/fahrt.ts";' },
        { pfad: "apps/web/test/fremd.test.ts", text: "// kein Bezug" },
    ];
    it("findet indirekte Leser und startet keine gesamte Websuite", () => {
        expect(abhaengigeTests(["apps/web/src/kamera.ts"], quellen)).toEqual(["apps/web/test/fahrt.test.ts"]);
        const auswahl = waehleTests({
            geaendert: ["apps/web/src/kamera.ts"],
            voll: false,
            quellen,
            testDateien: quellen.filter((q) => q.pfad.endsWith(".test.ts")),
        });
        expect(auswahl.filter).toEqual(["apps/web/test/fahrt.test.ts"]);
    });
    it("beendet Zyklen und berücksichtigt gelöschte importierte Module", () => {
        const zyklus = [...quellen, { pfad: "apps/web/src/kamera.ts", text: 'import "./fahrt.ts";' }];
        expect(abhaengigeTests(["apps/web/src/kamera.ts"], zyklus)).toContain("apps/web/test/fahrt.test.ts");
    });
    it("macht den früheren 550/89-Lauf als außergewöhnlich sichtbar", () => {
        expect(auswahlKosten(550, 89).gross).toBe(true);
        expect(auswahlKosten(7, 2).gross).toBe(false);
        expect(auswahlKosten(0, 1).sekunden).toBeGreaterThan(auswahlKosten(0, 0).sekunden);
    });
});

it("löst benannte Shared-Exporte auf, ohne fremde Module mitzuwählen", () => {
    const q = [
        { pfad: "packages/shared/src/index.ts", text: 'export { a } from "./a.ts"; export { b } from "./b.ts";' },
        { pfad: "packages/shared/src/a.ts", text: "export const a = 1" },
        { pfad: "packages/shared/src/b.ts", text: "export const b = 1" },
        { pfad: "apps/web/test/a.test.ts", text: 'import { a as lokal } from "@avesmaps3d/shared";' },
        { pfad: "apps/web/test/b.test.ts", text: 'import { b } from "@avesmaps3d/shared";' },
        { pfad: "apps/web/test/all.test.ts", text: 'import * as shared from "@avesmaps3d/shared";' },
    ];
    expect(abhaengigeTests(["packages/shared/src/a.ts"], q)).toEqual([
        "apps/web/test/a.test.ts",
        "apps/web/test/all.test.ts",
    ]);
    expect(abhaengigeTests(["packages/shared/src/index.ts"], q)).toHaveLength(3);
});
