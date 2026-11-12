import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SYSTEMSTEUERUNG_GRUPPEN } from "@avesmaps3d/shared";
import { LOCALES, locale, t, type MessageKey } from "../src/i18n/i18n.ts";

/**
 * Die Schiene der Systemsteuerung in vier festen Gruppen (Betreiber 2026-10-17, WI-0127 §23): „vier kleine Zwischenüberschriften
 * in VERSALIEN … nicht anklickbar, nicht einklappbar und besitzen keine Pfeile“, nur in der Systemsteuerung, „nicht die
 * Kontenverwaltung oder Medienverwaltung“. Welche Reiter in welcher Gruppe stehen, prüft `packages/shared/test/navigation.test.ts`;
 * wie es gezeichnet aussieht, `e2e/verwaltung.spec.ts`. Hier die Grenzen an den Quellen.
 */
const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const datei = (pfad: string): string => readFileSync(join(wurzel, pfad), "utf8");

/** Der Rumpf einer CSS-Regel, deren Selektorliste mit `kopf` beginnt. */
function regel(quelle: string, kopf: string): string {
    const anfang = quelle.indexOf(kopf);
    if (anfang < 0) throw new Error(`Regel ${kopf} fehlt`);
    const auf = quelle.indexOf("{", anfang);
    return quelle.slice(auf + 1, quelle.indexOf("}", auf));
}

afterEach(() => {
    locale.value = "de";
});

describe("Systemsteuerung in vier festen Gruppen", () => {
    it("🔴 nur die Systemsteuerung bekommt feste Köpfe; Kontenverwaltung und Medienverwaltung bleiben, wie sie sind", () => {
        const verwaltung = datei("auth/verwaltung-fenster.vue");
        expect(verwaltung).toContain(`:feste-koepfe="props.tafel === 'system'"`);
        expect(verwaltung).toContain(`:ohne-kopf="props.tafel !== 'system'"`);
        expect(datei("medien/medien-arten.vue")).not.toMatch(/feste-koepfe|festeKoepfe/);
    });

    it("🔴 Wächter: jede Schiene außer der Systemsteuerung bleibt ohne feste Köpfe, der klappbare Kopf bleibt Knopf mit Winkel", () => {
        // Alle Nutzungen von `FensterSchiene`; eine neue landet hier und muss sich entscheiden (Editor-Orchestrierung 2026-10-17).
        const nutzer = readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            .map((pfad) => pfad.replace(/\\/gu, "/"))
            .filter((pfad) => pfad.endsWith(".vue") && datei(pfad).includes("<FensterSchiene"))
            .sort();
        expect(nutzer).toEqual(["auth/verwaltung-fenster.vue", "medien/medien-arten.vue"]);
        const mitFestenKoepfen = nutzer.filter((pfad) => /feste-koepfe|festeKoepfe/u.test(datei(pfad)));
        expect(mitFestenKoepfen).toEqual(["auth/verwaltung-fenster.vue"]);
        // Ohne die Eigenschaft zeichnet die Schiene den Kopf wie vorher: ein Knopf, der klappt, mit Winkel.
        const schiene = datei("fenster/fenster-schiene.vue");
        const anfang = schiene.indexOf(`v-else-if="!props.ohneKopf"`);
        const knopf = schiene.slice(anfang, schiene.indexOf("</button>", anfang));
        expect(knopf).toContain(`:aria-expanded="offen.has(bereich.id)"`);
        expect(knopf).toContain(`@click="umklappen(bereich.id)"`);
        expect(knopf).toContain("<svg");
    });

    it("🔴 der feste Kopf ist eine Überschrift, kein Knopf: kein Winkel, nicht klappbar, Versalien aus dem Rahmen", () => {
        const schiene = datei("fenster/fenster-schiene.vue");
        const kopf = schiene.slice(
            schiene.indexOf(`v-if="props.festeKoepfe"`),
            schiene.indexOf("</p>", schiene.indexOf(`v-if="props.festeKoepfe"`)),
        );
        expect(kopf).toContain(`role="heading"`);
        expect(kopf).not.toMatch(/<svg|@click|aria-expanded|<button/);
        // Mit festen Köpfen steht jede Gruppe offen, die Unterzeile eines zugeklappten Bereichs entfällt.
        expect(schiene).toContain(`v-show="props.ohneKopf || props.festeKoepfe || offen.has(bereich.id)"`);
        expect(schiene).toContain(`v-if="!props.ohneKopf && !props.festeKoepfe && !offen.has(bereich.id)"`);
        const gruppe = regel(schiene, ".fenster-schiene__gruppe {");
        expect(gruppe).toContain("text-transform: uppercase");
        // Die Farbe der Bereichsköpfe aus Blatt WI-0119 und SYS-1 (Betreiber 2026-10-17: „du hattest früher mal was“), als Token.
        expect(gruppe).toContain("color: var(--color-accent-strong)");
        expect(kopf).toContain("einzeilig");
        // Zwischen den Gruppen nur Abstand, keine Linie (Betreiber: „Keine zusätzlichen Kästen, Rahmen“).
        expect(
            regel(schiene, ".fenster-schiene--fest .fenster-schiene__bereich + .fenster-schiene__bereich {"),
        ).toContain("border-top: none");
        const name = regel(schiene, ".fenster-schiene--fest .fenster-schiene__name {");
        // Einzeilig über `.einzeilig` (Luft unten), oben dieselbe Luft für Akzente (Sichtprüfung 2026-10-17, `avm-versalmitte`).
        expect(name).toContain("padding-top: var(--descender-room)");
        expect(schiene.split(`:class="{ einzeilig: props.festeKoepfe }"`)).toHaveLength(4);
    });

    it("🔴 jede Gruppe hat in allen Tafeln einen Namen, normal geschrieben (die Versalien macht der Rahmen)", () => {
        for (const sprache of LOCALES) {
            locale.value = sprache;
            for (const gruppe of SYSTEMSTEUERUNG_GRUPPEN) {
                const schluessel = `admin.area.${gruppe.replace(/^bereich-/u, "")}` as MessageKey;
                const name = t(schluessel);
                expect(name, `${sprache} ${schluessel}`).not.toBe(schluessel);
                expect(name, `${sprache} ${schluessel}`).not.toBe(name.toLocaleUpperCase(sprache));
            }
            expect(t("admin.area.system" as MessageKey), sprache).toBe("admin.area.system");
        }
    });
});
