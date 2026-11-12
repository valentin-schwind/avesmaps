import { describe, expect, it } from "vitest";
import { HaeufungsWaechter, imRechenzentrum, netzVon } from "../src/besucher/automaten.ts";

/**
 * Getarnte Automaten an Mustern erkennen (OPS-000118; Claudios Auswertung der Protokolle vom 11.11.,
 * `2026-11-12-analyse-ops-000118-zugriffe-antwort-an-claudia.md`): ein Abrufer aus Tencent-Netzen, echter Browser, jede Anfrage von einer
 * anderen Adresse und mit einer anderen Chrome-Version, in Schüben von rund zehn Seiten je Sekunde aus demselben /16.
 *
 * Land und kurze Dauer allein entscheiden nie (Vorgabe im Vorgang). Die Gründe sind das Netz eines Rechenzentrums und die Häufung vieler
 * neuer Personen aus einem Netz in kurzer Zeit.
 */

const kennung = (n: number): string => `person-${String(n)}`;

describe("Netz einer Adresse", () => {
    it("fasst IPv4 zu /16 und IPv6 zu /48 zusammen, auch in IPv6-Schreibweise für IPv4", () => {
        expect(netzVon("43.173.5.9")).toBe("43.173");
        expect(netzVon("::ffff:43.173.5.9")).toBe("43.173");
        expect(netzVon("2003:e1:abcd:12::1")).toBe("2003:e1:abcd");
        expect(netzVon("2003:e1::1")).toBe("2003:e1:0");
        expect(netzVon("kaputt")).toBeUndefined();
    });
});

describe("Rechenzentrum", () => {
    it("🔴 erkennt die Netze des Abrufers vom 11.11., in beiden Schreibweisen", () => {
        expect(imRechenzentrum("43.173.5.9")).toBe(true);
        expect(imRechenzentrum("43.172.200.1")).toBe(true);
        expect(imRechenzentrum("161.120.44.7")).toBe(true);
        expect(imRechenzentrum("::ffff:43.160.0.1")).toBe(true);
    });

    it("lässt Netze von Menschen in Ruhe, auch aus Singapur", () => {
        expect(imRechenzentrum("203.127.4.5")).toBe(false);
        expect(imRechenzentrum("79.200.1.1")).toBe(false);
        expect(imRechenzentrum("2003:e1::1")).toBe(false);
        expect(imRechenzentrum("")).toBe(false);
    });
});

describe("Häufung neuer Personen aus einem Netz", () => {
    const ab = Date.UTC(2026, 10, 11, 13, 44);

    it("🔴 ein Schub aus einem /16: die ersten sieben zählen, ab der achten neuen Person in einer Minute ist das Netz auffällig", () => {
        const waechter = new HaeufungsWaechter();
        const urteile = Array.from({ length: 10 }, (_, i) =>
            waechter.auffaellig(`43.80.${String(i)}.1`, kennung(i), ab + i * 100),
        );
        expect(urteile).toEqual([false, false, false, false, false, false, false, true, true, true]);
    });

    it("bleibt eine halbe Stunde auffällig, danach nicht mehr", () => {
        const waechter = new HaeufungsWaechter();
        for (let i = 0; i < 8; i++) waechter.auffaellig(`100.70.0.${String(i)}`, kennung(i), ab + i * 1000);
        expect(waechter.auffaellig("100.70.9.9", kennung(99), ab + 29 * 60_000)).toBe(true);
        expect(waechter.auffaellig("100.70.9.9", kennung(99), ab + 40 * 60_000)).toBe(false);
    });

    it("dieselbe Person, die oft kommt, ist keine Häufung", () => {
        const waechter = new HaeufungsWaechter();
        const urteile = Array.from({ length: 30 }, (_, i) =>
            waechter.auffaellig("79.200.1.1", kennung(1), ab + i * 500),
        );
        expect(urteile.every((urteil) => !urteil)).toBe(true);
    });

    it("über den Tag verteilte Menschen aus einem großen Netz sind keine Häufung", () => {
        const waechter = new HaeufungsWaechter();
        const urteile = Array.from({ length: 40 }, (_, i) =>
            waechter.auffaellig(`79.200.${String(i)}.1`, kennung(i), ab + i * 90_000),
        );
        expect(urteile.every((urteil) => !urteil)).toBe(true);
    });

    it("ein auffälliges Netz färbt kein anderes", () => {
        const waechter = new HaeufungsWaechter();
        for (let i = 0; i < 8; i++) waechter.auffaellig(`43.80.0.${String(i)}`, kennung(i), ab);
        expect(waechter.auffaellig("43.81.0.1", kennung(50), ab)).toBe(false);
    });

    it("vergisst Netze, deren Fenster abgelaufen ist, statt unbegrenzt zu wachsen", () => {
        const waechter = new HaeufungsWaechter();
        // 6.000 verschiedene /16, alle zwei Sekunden eines: Im Fenster einer Minute leben davon nur rund dreißig.
        for (let i = 0; i < 6000; i++) {
            waechter.auffaellig(`${String(1 + Math.floor(i / 250))}.${String(i % 250)}.0.1`, kennung(i), ab + i * 2000);
        }
        expect(waechter.groesse()).toBeLessThanOrEqual(1001);
    });
});
