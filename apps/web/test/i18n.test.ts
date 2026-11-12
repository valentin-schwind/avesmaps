import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KONTENVERWALTUNG, SYSTEMSTEUERUNG } from "@avesmaps3d/shared";
import { afterEach, describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import {
    browserLocale,
    formatNumber,
    initialLocale,
    isMessageKey,
    locale,
    LOCALES,
    type Locale,
    t,
    tPlural,
} from "../src/i18n/i18n.ts";
import { DUAL_CASES, PLURAL_CASES, PLURAL_FORMS } from "../src/i18n/plural.ts";
import { RECHTSSAETZE_ENGLISCH } from "./rechtssaetze-reisebilder.ts";
import {
    DEFAULT_OPTIONS,
    mapPointName,
    optionsSummary,
    pathLabel,
    pointLabel,
    transportLabel,
    transportSummary,
} from "../src/route-planner/planner-model.ts";
import { airSummary, DEFAULT_AIR_CHOICE } from "../src/route-planner/air-profiles.ts";
import { capLabel } from "../src/keyboard/shortcuts.ts";
import {
    KANAL_KATEGORIEN,
    KANAL_PRIORITAETEN,
    KANAL_STATIONEN,
    KANAL_STATUS,
    KANAL_STATUS_STATIONEN,
} from "@avesmaps3d/shared";

/**
 * Deutsch, Englisch, Französisch, Niederländisch, Italienisch und Spanisch (WI-0032, WI-0158, WI-0165,
 * WI-0167, WI-0170): die Tafeln, die Wahl der Sprache und wie die Texte des Planers in ihnen erscheinen.
 */

/**
 * 🔴 Ein Schlüssel im Quelltext einer Tafel. `[^"]+`, nicht `[A-Za-z0-9._]+`: Elf Schlüssel tragen einen
 * Bindestrich, und ein Muster, das sie übergeht, übergeht sie STILL - siehe den Fall weiter unten.
 */
const SCHLUESSEL_IM_QUELLTEXT = /^\s+"([^"]+)":/gmu;

afterEach(() => {
    locale.value = "de";
});

/**
 * Die Schlüssel, die eine Tafel dieser Sprache tragen MUSS: jeder Grundschlüssel der deutschen Quelle, dazu jeder
 * Zählfall in genau den Formen, die diese Sprache erklärt hat (WI-0173). Für die sechs heutigen Sprachen sind das
 * dieselben Formen; für Polnisch sind es vier statt zwei, und genau dafür ist die Rechnung hier da.
 */
const erwarteteSchluessel = (lang: Locale): string[] => {
    const zaehlformen = new Set(
        PLURAL_CASES.flatMap((fall) => ["one", "two", "few", "many", "other"].map((form) => `${fall}.${form}`)),
    );
    const grund = Object.keys(de).filter((key) => !zaehlformen.has(key));
    const formen = PLURAL_CASES.flatMap((fall) => [
        ...PLURAL_FORMS[lang].map((form) => `${fall}.${form}`),
        ...((DUAL_CASES as readonly string[]).includes(fall) ? [`${fall}.two`] : []),
    ]);
    return [...grund, ...formen].sort();
};

describe("Die Tafeln", () => {
    it.each([
        ["Deutsch", "de", de],
        ["Englisch", "en", en],
        ["Französisch", "fr", fr],
        ["Niederländisch", "nl", nl],
        ["Italienisch", "it", itTafel],
        ["Spanisch", "es", es],
    ] as const)("🔴 %s trägt jeden Schlüssel und keinen weiteren", (_name, lang, tafel) => {
        expect(Object.keys(tafel).sort()).toEqual(erwarteteSchluessel(lang));
    });

    /**
     * 🪤 Kein Schlüssel zweimal — und das lässt sich nur am QUELLTEXT prüfen: Ein Objektliteral behält stillschweigend den
     * letzten Wert, `Object.keys` sähe die Dopplung nie. `tsc` meldet sie (TS1117) und hält damit den ganzen Bau an.
     *
     * Der Grund, warum das hier steht (Claudio 2026-10-13, `handovers/2026-10-13-master-baut-nicht-i18n-doppelt.md`): Ein
     * Merge trug 19 Galerie-Schlüssel zweimal ein — auf beiden Seiten hinzugefügt, an verschiedenen Zeilen, also ohne
     * Konflikt. Die Sprachtafeln sind der Ort, an dem parallele Sitzungen sich treffen; genau dort fällt es sonst erst dem
     * Bau auf. „Merges bringen genau das immer wieder.“
     */
    it.each([
        ["de.ts", "../src/i18n/de.ts"],
        ["en.ts", "../src/i18n/en.ts"],
        ["fr.ts", "../src/i18n/fr.ts"],
        ["nl.ts", "../src/i18n/nl.ts"],
        ["it.ts", "../src/i18n/it.ts"],
        ["es.ts", "../src/i18n/es.ts"],
    ])("🔴 %s trägt keinen Schlüssel zweimal (TS1117 hält sonst den Bau an)", (_name, pfad) => {
        const quelle = readFileSync(resolve(import.meta.dirname, pfad), "utf8");
        const gesehen = new Map<string, number>();
        for (const match of quelle.matchAll(SCHLUESSEL_IM_QUELLTEXT)) {
            const key = match[1] as string;
            gesehen.set(key, (gesehen.get(key) ?? 0) + 1);
        }
        const doppelt = [...gesehen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
        expect(doppelt.sort()).toEqual([]);
    });

    /**
     * 💣 **Der Wächter über den Wächtern: Was die Regex oben NICHT sieht, gibt es trotzdem.**
     *
     * Sie stand auf `[A-Za-z0-9._]+` und übersah damit stillschweigend die elf Schlüssel mit Bindestrich
     * (`display.check.uphill-rivers`, `admin.content.license.cc-by-sa`, `admin.tab.protokoll-system` und acht
     * weitere). Für den Dopplungsfall hieß das: Eine Dopplung in einem von ihnen wäre durchgegangen und hätte den
     * Bau mit TS1117 angehalten, ohne dass dieser Test je gemeckert hätte.
     *
     * Schlimmer war, was dieselbe Regex in einem ERZEUGER anrichtete: Das Werkzeug, das `nl.ts` aus `de.ts` baute,
     * übersprang die elf Zeilen — und ließ in ihnen den DEUTSCHEN Text stehen. Sieben deutsche Sätze mitten in der
     * niederländischen Tafel (WI-0165 R4, gefunden von der Sitzung zur italienischen Tafel). Der Typ merkt das
     * nicht: Der Schlüssel ist ja da, nur sein Text ist die falsche Sprache.
     *
     * 🔴 Dieser Fall prüft die Regex gegen die Wahrheit, statt sie von Hand nachzulesen: So viele Schlüssel, wie
     * der Quelltext hergibt, hat auch das Objekt. Weicht es ab, übersieht das Muster etwas - egal welches Zeichen
     * als Nächstes in einem Schlüssel auftaucht.
     */
    it.each([
        ["de.ts", "../src/i18n/de.ts", de],
        ["en.ts", "../src/i18n/en.ts", en],
        ["fr.ts", "../src/i18n/fr.ts", fr],
        ["nl.ts", "../src/i18n/nl.ts", nl],
        ["it.ts", "../src/i18n/it.ts", itTafel],
        ["es.ts", "../src/i18n/es.ts", es],
    ])("💣 %s: die Suche im Quelltext findet JEDEN Schlüssel, auch die mit Bindestrich", (_name, pfad, tafel) => {
        const quelle = readFileSync(resolve(import.meta.dirname, pfad), "utf8");
        const imQuelltext = [...quelle.matchAll(SCHLUESSEL_IM_QUELLTEXT)].map((m) => m[1] as string);
        expect(new Set(imQuelltext).size).toBe(Object.keys(tafel).length);
        // Und die elf mit Bindestrich sind wirklich dabei - die Stelle, an der es schiefging.
        expect(imQuelltext).toContain("display.check.uphill-rivers");
        expect(imQuelltext).toContain("admin.content.license.cc-by-sa");
    });

    it.each([
        ["Englischen", en],
        ["Französischen", fr],
        ["Niederländischen", nl],
        ["Italienischen", itTafel],
        ["Spanischen", es],
    ])("🔴 jeder Platzhalter des Deutschen steht auch im %s", (_name, tafel) => {
        const holes = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
        for (const key of Object.keys(de) as (keyof typeof de)[]) {
            expect(holes(tafel[key]), key).toEqual(holes(de[key]));
        }
    });

    it.each([
        ["englischer", en],
        ["französischer", fr],
        ["niederländischer", nl],
        ["italienischer", itTafel],
        ["spanischer", es],
    ])("kein %s Text ist leer", (_name, tafel) => {
        const empty = Object.entries(tafel).filter(([, text]) => text.trim() === "");
        expect(empty).toEqual([]);
    });

    /**
     * 🔴 Französische Typografie (WI-0158): Apostroph und Anführungszeichen sind Zeichen, nicht Tasten. Die Tafel
     * schreibt ’ (U+2019) und « … », nie ' und nie „ “ - sonst mischt sich beim nächsten Schlüssel das eine ins andere,
     * und gerade der Apostroph steht in fast jedem zweiten französischen Satz.
     */
    it("🔴 die französische Tafel schreibt den Apostroph und die Anführungszeichen typografisch", () => {
        const gerade = Object.entries(fr).filter(([, text]) => text.includes("'"));
        expect(gerade.map(([key]) => key)).toEqual([]);
        const deutsch = Object.entries(fr).filter(([, text]) => /[„“]/.test(text));
        expect(deutsch.map(([key]) => key)).toEqual([]);
    });

    /**
     * 🔴 Niederländische Typografie (WI-0165): Niederländisch setzt die Anführungszeichen hoch (“ … ”), nicht wie das
     * Deutsche tief („ … “), und schreibt den Apostroph typografisch (’, etwa in „regio’s“). Beides steht hier fest,
     * damit nicht ab dem nächsten Schlüssel zwei Formen durcheinandergehen.
     */
    it("🔴 die niederländische Tafel schreibt die Anführungszeichen hoch und den Apostroph typografisch", () => {
        const gerade = Object.entries(nl).filter(([, text]) => text.includes("'"));
        expect(gerade.map(([key]) => key)).toEqual([]);
        const deutsch = Object.entries(nl).filter(([, text]) => text.includes("„"));
        expect(deutsch.map(([key]) => key)).toEqual([]);
    });

    /**
     * 💣 **Und sie stehen paarweise, öffnend vor schließend.** Ohne diese Prüfung fällt es niemandem auf: ”Das
     * Schwarze Auge” sieht beim Überfliegen aus wie “Das Schwarze Auge”. Genau so geschah es in WI-0165 — ein
     * Werkzeug, das „ … “ nach “ … ” drehte, lief zweimal und machte aus jedem öffnenden ein schließendes.
     */
    it("💣 jedes Anführungszeichen der niederländischen Tafel hat seinen Partner, öffnend zuerst", () => {
        const falsch = Object.entries(nl).filter(([, text]) => {
            const zeichen = [...text].filter((c) => c === "“" || c === "”");
            if (zeichen.length === 0) return false;
            if (zeichen.length % 2 !== 0) return true;
            return zeichen.some((c, i) => c !== (i % 2 === 0 ? "“" : "”"));
        });
        expect(falsch.map(([key]) => key)).toEqual([]);
    });

    /** 🔴 Die Sprachnamen stehen in JEDER Tafel gleich (WI-0156): Wer „Français“ sucht, findet es auf Deutsch. */
    it("🔴 `lang.name.*` ist in allen sechs Tafeln gleich", () => {
        for (const lang of LOCALES) {
            const key = `lang.name.${lang}` as const;
            expect(isMessageKey(key), key).toBe(true);
            if (!isMessageKey(key)) continue;
            expect([de[key], en[key], fr[key], nl[key], itTafel[key], es[key]], key).toEqual([
                de[key],
                de[key],
                de[key],
                de[key],
                de[key],
                de[key],
            ]);
        }
        expect(fr["lang.name.fr"]).toBe("Français");
        expect(fr["status.locale"]).toBe("fr-FR");
        expect(nl["lang.name.nl"]).toBe("Nederlands");
        expect(nl["status.locale"]).toBe("nl-NL");
        expect(itTafel["lang.name.it"]).toBe("Italiano");
        expect(itTafel["status.locale"]).toBe("it-IT");
        expect(es["lang.name.es"]).toBe("Español");
        expect(es["status.locale"]).toBe("es-ES");
    });

    /**
     * 💣 **Was die beiden Prüfungen darüber NICHT finden:** Fehlt ein Schlüssel in BEIDEN Tafeln, decken sie sich weiterhin, und
     * der Test bleibt grün. Genau so geschah es: Migration 0122 brachte die Stationen `production_live` und `production_zurueck`,
     * die Sprachtafeln kamen nicht mit, und der Betreiber sah am 2026-10-13 in der Leiste von OPS-000003 zwei Rohwerte stehen.
     *
     * 🪤 Es fällt nicht auf, weil `nachschlagen` bewusst auf den Rohwert zurückfällt (`kanal.ts`): Das ist richtig für einen Wert
     * aus dem Betrieb, den die Oberfläche nicht kennen kann — und falsch für einen aus einer Aufzählung, die im selben
     * Repository steht. Für die gibt es keine Entschuldigung, also stehen sie hier.
     *
     * Eine neue Jobart, Kategorie oder Station fällt ab jetzt hier auf und nicht erst im Bild des Betreibers.
     */
    it("🔴 jeder Wert der Kanal-Aufzählungen hat einen Satz, in beiden Sprachen", () => {
        const fehlend = [
            ...KANAL_STATIONEN.map((wert) => `kanal.station.${wert}`),
            ...KANAL_STATUS_STATIONEN.map((wert) => `kanal.station.${wert}`),
            ...KANAL_KATEGORIEN.map((wert) => `kanal.kategorie.${wert}`),
            ...KANAL_STATUS.map((wert) => `kanal.status.${wert}`),
            ...KANAL_PRIORITAETEN.map((wert) => `kanal.prioritaet.${wert}`),
        ].filter((key) => !isMessageKey(key));
        expect(fehlend, "diese Werte stünden als Rohwert in der Oberfläche").toEqual([]);
    });

    /**
     * 🔴 **Der Spieltitel ist ein Name mit eigener Fassung je Ausgabe**: „The Dark Eye“, „L’Œil Noir“,
     * „Het Oog des Meesters“, „Uno Sguardo nel Buio“, „El Ojo Oscuro“. Nur die deutsche Tafel schreibt
     * „Das Schwarze Auge“.
     *
     * 💣 **Bis WI-0167 lief dieser Fall über eine feste Liste** `[en, fr, nl]` und hätte eine fünfte Tafel,
     * die den deutschen Titel behält, nicht bemerkt — er prüfte genau die drei, die ohnehin stimmten. Jetzt
     * läuft er über `LOCALES`, und `TITEL` ist ein `Record` über alle Sprachen außer Deutsch: Eine sechste
     * Sprache ist damit ein TYPFEHLER, nicht erst ein roter Test (Hinweis der nl-Sitzung, 2026-10-15).
     */
    const TITEL: Record<Exclude<Locale, "de">, string> = {
        en: "The Dark Eye",
        fr: "L’Œil Noir",
        nl: "Het Oog des Meesters",
        it: "Uno Sguardo nel Buio",
        es: "El Ojo Oscuro",
        // 🪤 Für Polnisch gibt es keine Ausgabe; „Czarne Oko“ ist die schlichte Übersetzung, hier gesetzt (WI-0174 §2.2).
        pl: "Czarne Oko",
        // 🪤 Auch für Dänisch gibt es keine Ausgabe; „Det Sorte Øje“ ist die schlichte Übersetzung (WI-0210 §2.2).
        da: "Det Sorte Øje",
        sv: "Det Svarta Ögat",
    };

    it("🔴 jede Tafel trägt den Titel ihrer Ausgabe, nur die deutsche „Das Schwarze Auge“", () => {
        for (const lang of LOCALES) {
            locale.value = lang;
            const satz = t("planner.tagline");
            const marke = t("planner.wordmark.alt");
            if (lang === "de") {
                expect(satz, lang).toContain("Das Schwarze Auge");
                continue;
            }
            expect(satz, lang).toContain(TITEL[lang]);
            expect(marke, lang).toContain(TITEL[lang]);
            expect(satz, lang).not.toContain("Das Schwarze Auge");
            expect(marke, lang).not.toContain("Das Schwarze Auge");
        }
    });
});

/**
 * 🔴 Der Deckel der gemeinsamen Klappbox (WI-0081). Er beginnt mit der ZAHL, ohne „Durch“ (Betreiber 2026-10-05:
 * „Durch 19 Landschaften und 43 politische Gebiete → 19 Landschaften und 43 politische Gebiete“).
 * Gemessen wird der WORTLAUT der Tafeln in allen Zahlformen: Die Sprachtafel trägt je Fall den ganzen Rahmen
 * und setzt die beiden Zählangaben ein, damit die Einzahl in jeder Verbindung stimmt. Welche der drei Fälle die
 * Übersicht wählt, prüft `e2e/route-landscapes.spec.ts` an der laufenden Oberfläche.
 */
describe("Der Deckel der Landschaften und politischen Gebiete", () => {
    const lid = (landscapes: number, territories: number): string => {
        const l = tPlural("planner.summary.landscapes", landscapes, { n: landscapes });
        const g = tPlural("planner.summary.territories", territories, { n: territories });
        if (landscapes > 0 && territories > 0) return t("planner.summary.areas", { landscapes: l, territories: g });
        return landscapes > 0
            ? t("planner.summary.areas.landscapes", { landscapes: l })
            : t("planner.summary.areas.territories", { territories: g });
    };

    it("🔴 deutsch: Einzahl und Mehrzahl stimmen in jeder Verbindung", () => {
        expect(lid(19, 43)).toBe("19 Gegenden und 43 politische Gebiete");
        expect(lid(1, 43)).toBe("1 Gegend und 43 politische Gebiete");
        expect(lid(19, 1)).toBe("19 Gegenden und 1 politisches Gebiet");
        expect(lid(1, 1)).toBe("1 Gegend und 1 politisches Gebiet");
        // Fehlt eine der beiden Listen, nennt der Deckel nur die vorhandene.
        expect(lid(19, 0)).toBe("19 Gegenden");
        expect(lid(1, 0)).toBe("1 Gegend");
        expect(lid(0, 43)).toBe("43 politische Gebiete");
        expect(lid(0, 1)).toBe("1 politisches Gebiet");
    });

    it("die beiden Unterüberschriften in der Box nennen keine Zahl - der Deckel trägt sie", () => {
        expect(t("planner.summary.areas.heading.landscapes")).toBe("Derographie");
        expect(t("planner.summary.areas.heading.territories")).toBe("Politische Gebiete");
        locale.value = "en";
        expect(t("planner.summary.areas.heading.landscapes")).toBe("Derography");
        expect(t("planner.summary.areas.heading.territories")).toBe("Political territories");
        for (const key of [
            "planner.summary.areas.heading.landscapes",
            "planner.summary.areas.heading.territories",
        ] as const) {
            expect(t(key)).not.toMatch(/\d/);
        }
    });

    it("🔴 englisch ebenso, und niemand wird angesprochen", () => {
        locale.value = "en";
        expect(lid(19, 43)).toBe("19 areas and 43 political territories");
        expect(lid(1, 43)).toBe("1 area and 43 political territories");
        expect(lid(19, 1)).toBe("19 areas and 1 political territory");
        expect(lid(1, 1)).toBe("1 area and 1 political territory");
        expect(lid(19, 0)).toBe("19 areas");
        expect(lid(1, 0)).toBe("1 area");
        expect(lid(0, 43)).toBe("43 political territories");
        expect(lid(0, 1)).toBe("1 political territory");
    });
});

/**
 * 🔴 Der Deckel der Eiltempo-Klappbox (Betreiber 2026-10-05: „8,6 Std. Zeitersparnis im Eiltempo … und präsentiere
 * die rechnung beim aufklappen“). Gemessen wird der WORTLAUT in beiden Sprachen, samt der beiden Sonderfälle: Ohne
 * jede Wirkung sagt er das, und unter einer Zehntelstunde steht „wenige Minuten“ statt „0,0 Std.“.
 */
describe("Der Deckel des Eiltempos", () => {
    it("deutsch: das Ergebnis zuerst, die Sonderfälle ohne „0,0“", () => {
        expect(t("planner.hurry.lid", { saved: "8,6 Std." })).toBe("8,6 Std. Zeitersparnis im Eiltempo");
        expect(t("planner.hurry.lid", { saved: "1,4 Tage" })).toBe("1,4 Tage Zeitersparnis im Eiltempo");
        expect(t("planner.hurry.lid.tiny")).toBe("Wenige Minuten Zeitersparnis im Eiltempo");
        expect(t("planner.hurry.lid.none")).toBe("Kein Abschnitt bei der Reise im Eiltempo möglich");
        // 🔴 Seit WI-0087 P11 steht die Rechnung als Tabelle: Benennung und Wert sind zwei Schlüssel, die Werte
        // selbst sind unverändert.
        expect(t("planner.hurry.stretch.label")).toBe("Geeignet");
        expect(t("planner.hurry.stretch", { miles: "210,8 Meilen", total: "2.808,7 Meilen" })).toBe(
            "210,8 Meilen von 2.808,7 Meilen",
        );
        expect(t("planner.hurry.days.label")).toBe("Im Eiltempo gereist");
        expect(t("planner.hurry.days", { hurried: "1,4", total: "11,2" })).toBe("1,4 von 11,2 Reisetagen");
        expect(t("planner.hurry.factor.label")).toBe("Faktor an einem Eiltag");
        expect(t("planner.hurry.factor.value", { n: "1,5" })).toBe("1,5-fach");
        expect(t("planner.hurry.saved.label")).toBe("Daraus die Ersparnis");
        // 🔴 Die Regel der Geographia ist aufgelockert, aber Wort für Wort dieselbe: die drei Teile ergeben
        // zusammengesetzt wieder den alten Absatz.
        const regel = [
            t("planner.hurry.rule.pace"),
            t("planner.hurry.rule.whereYes"),
            t("planner.hurry.rule.whereNo"),
            t("planner.hurry.rule.sleds"),
        ].join(" ");
        expect(regel).toBe(
            "Im Eiltempo gehen Reisende und Zugtiere das Anderthalbfache, Fuhrwerke und Kutschen das 1,25-fache " +
                "ihrer Tagesleistung - und das nur jeden zweiten Reisetag, dauerhaft ist mehr nicht zu halten. " +
                "Es gilt auf Reichsstraßen, Straßen und Wegen, zu Fuß auch auf Pfaden; nicht über Gebirgspässe, " +
                "nicht querfeldein, nicht durch Sumpf oder Regenwald und nicht auf aufgeweichtem Boden, Tiefschnee " +
                "oder Eis. Ein Schlitten eilt auf Schnee und Eis. Fluss-, Seefahrt und Flug kennen kein Eiltempo.",
        );
    });

    it("englisch ebenso, und niemand wird angesprochen", () => {
        locale.value = "en";
        expect(t("planner.hurry.lid", { saved: "8.6 h" })).toBe("8.6 h saved at a forced pace");
        expect(t("planner.hurry.lid.tiny")).toBe("A few minutes saved at a forced pace");
        expect(t("planner.hurry.lid.none")).toBe("No stretch of this journey can keep a forced pace");
        expect(t("planner.hurry.days.label")).toBe("Travelled at a forced pace");
        expect(t("planner.hurry.days", { hurried: "1.4", total: "11.2" })).toBe("1.4 of 11.2 days of travel");
        expect(t("planner.hurry.factor.value", { n: "1.5" })).toBe("1.5×");
        for (const key of [
            "planner.hurry.lid.tiny",
            "planner.hurry.lid.none",
            "planner.hurry.stretch.label",
            "planner.hurry.stretch",
            "planner.hurry.days.label",
            "planner.hurry.days",
            "planner.hurry.factor.label",
            "planner.hurry.saved.label",
            "planner.hurry.rule.pace",
            "planner.hurry.rule.whereYes",
            "planner.hurry.rule.whereNo",
            "planner.hurry.rule.sleds",
        ] as const) {
            expect(t(key, { saved: "", miles: "", total: "", hurried: "", factors: "" })).not.toMatch(/\byou\b/i);
        }
    });
});

describe("Die Wahl der Sprache", () => {
    it("`?lang=` geht vor, dann der Browser, dann Deutsch", () => {
        expect(initialLocale("?lang=en", ["de-DE"])).toBe("en");
        expect(initialLocale("?route=Gareth~Perricum&lang=de", ["en-GB"])).toBe("de");
        expect(initialLocale("?lang=fr", ["de-DE"])).toBe("fr");
        expect(initialLocale("?lang=nl", ["de-DE"])).toBe("nl");
        expect(initialLocale("?lang=it", ["de-DE"])).toBe("it");
        expect(initialLocale("?lang=es", ["de-DE"])).toBe("es");
        // Eine Sprache, die es nicht gibt, fällt durch - weder aus der Adresse noch aus dem Browser.
        expect(initialLocale("?lang=pt", [])).toBe("de");
        expect(initialLocale("", [])).toBe("de");
    });

    /**
     * 🔴 Betreiber 2026-10-15 (WI-0156): „mach dass die sprache sich standardmäßig dem browser anpasst, default ist
     * sonst DE“. Vorher zählte die Browsersprache nicht, weil Legacys Englisch Lücken hatte; der Typ erzwingt hier
     * jede Tafel vollständig.
     */
    it("🔴 ohne Wahl entscheidet der Browser, und Deutsch bleibt der Rest", () => {
        expect(initialLocale("", ["en-GB", "de-DE"])).toBe("en");
        expect(initialLocale("", ["de-AT"])).toBe("de");
        // Die erste Marke, die es GIBT - `fr-BE` ist Französisch, seit WI-0158 steht die Tafel.
        expect(initialLocale("", ["fr-BE", "en-US"])).toBe("fr");
        expect(initialLocale("", ["fr"])).toBe("fr");
        // `nl-BE` ist Niederländisch, seit WI-0165 steht die Tafel.
        expect(initialLocale("", ["nl-BE", "fr-FR"])).toBe("nl");
        expect(initialLocale("", ["nl"])).toBe("nl");
        // `it-CH` ist Italienisch, seit WI-0167 steht die Tafel.
        expect(initialLocale("", ["it-CH", "fr-FR"])).toBe("it");
        expect(initialLocale("", ["it"])).toBe("it");
        // `es-AR` ist Spanisch, seit WI-0170 steht die Tafel.
        expect(initialLocale("", ["es-AR", "nl-NL"])).toBe("es");
        expect(initialLocale("", ["es"])).toBe("es");
        // `pl-PL` ist Polnisch, seit WI-0174 steht die Tafel.
        expect(initialLocale("", ["pl-PL", "de-DE"])).toBe("pl");
        expect(initialLocale("", ["pl"])).toBe("pl");
        expect(browserLocale(["EN-gb"])).toBe("en");
        // 🪤 „es“ ist seit WI-0170 und „pl“ seit WI-0174 eine echte Marke; hier stehen deshalb welche, die es nicht gibt.
        expect(browserLocale(["pt", "ru"])).toBe(null);
        expect(browserLocale([])).toBe(null);
    });

    it("Platzhalter werden ersetzt, unbekannte bleiben stehen", () => {
        expect(t("route.noRouteBetween", { from: "Gareth", to: "Perricum" })).toBe(
            "Keine Route zwischen Gareth und Perricum gefunden.",
        );
        expect(t("unit.miles", {})).toBe("{n} Meilen");
        expect(isMessageKey("path.Strasse")).toBe(true);
        expect(isMessageKey("path.Unbekannt")).toBe(false);
    });
});

describe("Der Planer auf Französisch", () => {
    it("Zahlen mit Komma, Wörter aus der französischen Tafel", () => {
        locale.value = "fr";
        expect(formatNumber(1234.5, 1)).toBe("1 234,5");
        expect(transportLabel("groupFoot")).toBe("Groupe à pied");
        // „Hors-piste“ statt „Terrain accidenté“: br00n0 (Les Ateliers d'Alrik) 2026-10-15 gegen das Glossar
        // von „L'Œil Noir“ durchgesehen.
        expect(pathLabel("Querfeldein")).toBe("Hors-piste");
        // Ein unbekannter Datenwert bleibt stehen, wie in jeder Tafel: erfunden wird nichts.
        expect(pathLabel("Unbekannt")).toBe("Unbekannt");
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Point de sortie");
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8,0 h/jour",
            "Indéterminé",
            "Chambre partagée",
        ]);
        expect(transportSummary(DEFAULT_OPTIONS).at(-1)?.text).toBe("Itinéraire le plus rapide");
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Point sur la carte près de Gareth");
        expect(capLabel("{shift} + A")).toBe("Maj + A");
    });

    it("🔴 der Deckel der Flächen stimmt in der Einzahl, auch bei null", () => {
        locale.value = "fr";
        const zahl = (n: number): string => tPlural("planner.summary.landscapes", n, { n });
        // Die Landschaften heißen auf Französisch „régions“ (br00n0, 2026-10-15, Glossar „L'Œil Noir“).
        expect(zahl(0)).toBe("0 zone");
        expect(zahl(1)).toBe("1 zone");
        expect(zahl(19)).toBe("19 zones");
    });

    it("🪤 die Rechtstexte fallen auf die englische Fassung, mit dem Satz über die gültige Fassung", () => {
        locale.value = "fr";
        expect(t("notes.title")).toBe("Informations");
    });
});

/**
 * 🔴 Niederländisch (WI-0165). Geprüft werden die Begriffe, die das Work Item festlegt, die Zahl mit Punkt und Komma
 * wie im Deutschen - und 🪤 dass die Mehrzahl NICHT der französischen Zählweise folgt: „0 etappes“, nicht „0 etappe“.
 */
describe("Der Planer auf Niederländisch", () => {
    it("Zahlen wie im Deutschen, Wörter aus der niederländischen Tafel", () => {
        locale.value = "nl";
        expect(formatNumber(1234.5, 1)).toBe("1.234,5");
        expect(transportLabel("groupFoot")).toBe("Reisgroep te voet");
        expect(pathLabel("Querfeldein")).toBe("Ruw terrein");
        // Ein unbekannter Datenwert bleibt stehen, wie in jeder Tafel: erfunden wird nichts.
        expect(pathLabel("Unbekannt")).toBe("Unbekannt");
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Vertrekpunt");
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8,0 u/dag",
            "Onbepaald",
            "Gedeelde kamer",
        ]);
        expect(transportSummary(DEFAULT_OPTIONS).at(-1)?.text).toBe("Snelste route");
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Kaartpunt bij Gareth");
        expect(capLabel("{shift} + A")).toBe("Shift + A");
    });

    /** 🔴 Die gesetzten DSA-Begriffe (WI-0165 §2.3): Wegarten, Landschaften und die Wörter der Reise. */
    it("🔴 die Begriffe des Work Items stehen so in der Tafel", () => {
        locale.value = "nl";
        expect([
            pathLabel("Reichsstrasse"),
            pathLabel("Strasse"),
            pathLabel("Weg"),
            pathLabel("Pfad"),
            pathLabel("Gebirgspass"),
            pathLabel("Wuestenpfad"),
            pathLabel("Flussweg"),
            pathLabel("Seeweg"),
        ]).toEqual(["Rijksweg", "Straatweg", "Weg", "Pad", "Bergpas", "Woestijnpad", "Rivierweg", "Zeeweg"]);
        // 🪤 „See“ ist ein Binnensee („meer“), „Meer“ ist das Meer („zee“) - im Niederländischen vertauscht.
        expect(t("landscape.type.see")).toBe("Meer");
        expect(t("landscape.type.meer")).toBe("Zee");
        expect(t("unit.miles", { n: 12 })).toBe("12 mijl");
        expect(t("planner.slope.unit")).toBe("passen");
        expect(t("planner.hurry")).toBe("Spoedtempo");
        expect(t("planner.cost.food.note.other", { n: 7 })).toBe("7 reisdagen");
        // 🪤 „Etappe“ heißt im Niederländischen gleich; `e2e/stage-panel.ts` braucht deshalb kein neues Wort.
        expect(t("infoPanel.stage.title", { n: 1, m: 7 })).toBe("Etappe 1 van 7");
    });

    /**
     * 🔴 Der Spieltitel ist ein Name mit niederländischer Fassung (Betreiber 2026-10-15: „Het Oog des Meesters
     * is richtig“), so wie `en.ts` „The Dark Eye“ und `fr.ts` „L’Œil Noir“ schreibt. Die Ausgabe ist vergriffen;
     * die übrigen Begriffe dieser Tafel bleiben darum selbst gesetzt (§2.2) und liegen zur Gegenlesung vor.
     */
    it("🔴 das Spiel heißt auf Niederländisch „Het Oog des Meesters“", () => {
        locale.value = "nl";
        expect(t("planner.tagline")).toBe("De routeplanner voor Aventurië uit “Het Oog des Meesters”.");
        expect(t("planner.wordmark.alt")).toContain("Het Oog des Meesters");
        // Dass KEINE Tafel den deutschen Titel behält, prüft „Der Spieltitel“ weiter oben über `LOCALES`.
    });

    it("🪤 die Mehrzahl ist die deutsche, nicht die französische: null ist Mehrzahl", () => {
        locale.value = "nl";
        const zahl = (n: number): string => tPlural("planner.summary.landscapes", n, { n });
        expect(zahl(0)).toBe("0 streken");
        expect(zahl(1)).toBe("1 streek");
        expect(zahl(19)).toBe("19 streken");
    });

    it("🪤 die Rechtstexte fallen auf die englische Fassung, wie im Französischen", () => {
        locale.value = "nl";
        expect(t("notes.title")).toBe("Informatie");
    });

    /**
     * 🔴 Keine Anrede (AGENTS.md, Guide §24): Das Niederländische hat mit „je“ und „u“ zwei, und beide stehen hier
     * nicht. 🪤 Das bloße „u“ ist in dieser Tafel das EINHEITENZEICHEN für die Stunde („8,0 u/dag“, „{n} u“) und
     * deshalb vom Muster ausgenommen; „uw“ dagegen ist eindeutig eine Anrede und fällt auf.
     */
    it("🔴 niemand wird angesprochen: kein „je“, kein „jouw“, kein „uw“", () => {
        const anrede = /(?<!\p{L})(je|jij|jou|jouw|jullie|uw|uzelf)(?!\p{L})/iu;
        const treffer = Object.entries(nl).filter(([, text]) => anrede.test(text));
        expect(treffer.map(([key]) => key)).toEqual([]);
    });
});

/**
 * 🔴 Italienisch (WI-0167). Geprüft werden die Begriffe, die das Work Item festlegt, die Zahl wie im
 * Deutschen und 🪤 dass die Mehrzahl NICHT der französischen Zählweise folgt: „0 superfici“, nicht „0 superficie“.
 */
describe("Der Planer auf Italienisch", () => {
    it("Zahlen mit Komma, Wörter aus der italienischen Tafel", () => {
        locale.value = "it";
        // 🪤 Italienisch gruppiert erst ab fünf Stellen (CLDR `it`: `minimumGroupingDigits` 2):
        // „2808,7 miglia“ steht ohne Punkt da, „12.345,6“ mit. Deutsch setzt ihn schon bei vier.
        expect(formatNumber(1234.5, 1)).toBe("1234,5");
        expect(formatNumber(12345.6, 1)).toBe("12.345,6");
        expect(transportLabel("groupFoot")).toBe("Gruppo a piedi");
        expect(pathLabel("Querfeldein")).toBe("Terreno impervio");
        // Ein unbekannter Datenwert bleibt stehen, wie in jeder Tafel: erfunden wird nichts.
        expect(pathLabel("Unbekannt")).toBe("Unbekannt");
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Punto di partenza");
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8,0 h/giorno",
            // 🪤 Kurz, weil der Knopf am Telefon nur 70 px breit ist: „Indeterminato“ lief über (§2.5).
            "Indefinito",
            "Camera in comune",
        ]);
        expect(transportSummary(DEFAULT_OPTIONS).at(-1)?.text).toBe("Rotta più rapida");
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Punto sulla mappa presso Gareth");
        expect(capLabel("{shift} + A")).toBe("Maiusc + A");
    });

    /** 🔴 Die gesetzten DSA-Begriffe (WI-0167 §2.2): Wegarten, Landschaften und die Wörter der Reise. */
    it("🔴 die Begriffe des Work Items stehen so in der Tafel", () => {
        locale.value = "it";
        expect([
            pathLabel("Reichsstrasse"),
            pathLabel("Strasse"),
            pathLabel("Weg"),
            pathLabel("Pfad"),
            pathLabel("Gebirgspass"),
            pathLabel("Wuestenpfad"),
            pathLabel("Flussweg"),
            pathLabel("Seeweg"),
        ]).toEqual([
            "Strada imperiale",
            "Strada",
            "Via",
            "Sentiero",
            "Passo montano",
            "Pista del deserto",
            "Via fluviale",
            "Via marittima",
        ]);
        // 🪤 Wie im Niederländischen sind die beiden Gewässer leicht zu vertauschen: „See“ ist der Binnensee.
        expect(t("landscape.type.see")).toBe("Lago");
        expect(t("landscape.type.meer")).toBe("Mare");
        expect(t("unit.miles", { n: 12 })).toBe("12 miglia");
        expect(t("planner.slope.unit")).toBe("passi");
        expect(t("planner.hurry")).toBe("Passo forzato");
        expect(t("planner.cost.food.note.other", { n: 7 })).toBe("7 giornate di viaggio");
        // 🪤 „Etappe“ heißt auf Italienisch „Tappa“; `e2e/stage-panel.ts` trägt das Wort deshalb mit.
        expect(t("infoPanel.stage.title", { n: 1, m: 7 })).toBe("Tappa 1 di 7");
    });

    /**
     * 🔴 Der Spieltitel ist ein Name mit italienischer Fassung: „Uno Sguardo nel Buio“, wie `en.ts`
     * „The Dark Eye“, `fr.ts` „L’Œil Noir“ und `nl.ts` „Het Oog des Meesters“ schreibt.
     */
    it("🔴 das Spiel heißt auf Italienisch „Uno Sguardo nel Buio“", () => {
        locale.value = "it";
        expect(t("planner.tagline")).toBe("Il pianificatore di viaggi per l’Aventuria di «Uno Sguardo nel Buio».");
        expect(t("planner.wordmark.alt")).toContain("Uno Sguardo nel Buio");
        // Dass KEINE Tafel den deutschen Titel behält, prüft „Der Spieltitel“ in „Die Tafeln“ über `LOCALES`.
    });

    it("🪤 die Mehrzahl ist die deutsche, nicht die französische: null ist Mehrzahl", () => {
        locale.value = "it";
        const zahl = (n: number): string => tPlural("planner.summary.landscapes", n, { n });
        expect(zahl(0)).toBe("0 zone");
        expect(zahl(1)).toBe("1 zona");
        expect(zahl(19)).toBe("19 zone");
    });

    it("🪤 die Rechtstexte fallen auf die englische Fassung, wie im Französischen", () => {
        locale.value = "it";
        expect(t("notes.title")).toBe("Avvertenze");
    });

    /**
     * 🔴 Italienische Typografie (WI-0167): Guillemets («…») wie im Französischen, nie die deutschen
     * Anführungszeichen und nie die hohen des Niederländischen; der Apostroph ist typografisch (’),
     * nie die Taste ('). 💣 Und die Guillemets stehen paarweise, öffnend vor schließend - im
     * Italienischen steht der Apostroph in fast jedem zweiten Satz (`l’`, `dell’`, `un’`).
     */
    it("🔴 die italienische Tafel schreibt Apostroph und Anführungszeichen typografisch", () => {
        const gerade = Object.entries(itTafel).filter(([, text]) => text.includes("'"));
        expect(gerade.map(([key]) => key)).toEqual([]);
        const fremd = Object.entries(itTafel).filter(([, text]) => /[„“”]/.test(text));
        expect(fremd.map(([key]) => key)).toEqual([]);
        const falsch = Object.entries(itTafel).filter(([, text]) => {
            const zeichen = [...text].filter((c) => c === "«" || c === "»");
            if (zeichen.length === 0) return false;
            if (zeichen.length % 2 !== 0) return true;
            return zeichen.some((c, i) => c !== (i % 2 === 0 ? "«" : "»"));
        });
        expect(falsch.map(([key]) => key)).toEqual([]);
    });

    /**
     * 🔴 Keine Anrede (AGENTS.md, Guide §24). 🪤 Italienisch hat mit `tu` und `Lei` zwei, und die
     * Pronomen sind kurz: `vi` und `La` stehen NICHT im Muster, weil sie auch „dort“ und den Artikel
     * meinen; geprüft wird, was eindeutig anredet.
     */
    it("🔴 niemand wird angesprochen: kein „tu“, kein „tuo“, kein „voi“", () => {
        const anrede = /(?<!\p{L})(tu|tuo|tua|tuoi|tue|voi|vostro|vostra|vostri|vostre|ti)(?!\p{L})/iu;
        const treffer = Object.entries(itTafel).filter(([, text]) => anrede.test(text));
        expect(treffer.map(([key]) => key)).toEqual([]);
    });
});

/**
 * 🔴 Spanisch (WI-0170). Geprüft werden die Begriffe, die das Work Item festlegt, die Zahl wie im
 * Italienischen und 🪤 dass die Mehrzahl NICHT der französischen Zählweise folgt: „0 superficies“, nicht
 * „0 superficie“.
 */
describe("Der Planer auf Spanisch", () => {
    it("Zahlen mit Komma, Wörter aus der spanischen Tafel", () => {
        locale.value = "es";
        // 🪤 Spanisch gruppiert wie das Italienische erst ab fünf Stellen (CLDR `es`:
        // `minimumGroupingDigits` 2): „2808,7 millas“ steht ohne Punkt da, „12.345,6“ mit.
        expect(formatNumber(1234.5, 1)).toBe("1234,5");
        expect(formatNumber(12345.6, 1)).toBe("12.345,6");
        expect(transportLabel("groupFoot")).toBe("Grupo a pie");
        expect(pathLabel("Querfeldein")).toBe("Terreno abrupto");
        // Ein unbekannter Datenwert bleibt stehen, wie in jeder Tafel: erfunden wird nichts.
        expect(pathLabel("Unbekannt")).toBe("Unbekannt");
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Punto de salida");
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8,0 h/día",
            // 🪤 Kurz, weil der Knopf am Telefon nur 70 px breit ist (§2.5): „Indefinido“ sind zehn
            // Zeichen, wie das deutsche „Unbestimmt“.
            "Indefinido",
            "Habitación compartida",
        ]);
        expect(transportSummary(DEFAULT_OPTIONS).at(-1)?.text).toBe("Ruta más rápida");
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Punto en el mapa cerca de Gareth");
        expect(capLabel("{shift} + A")).toBe("Mayús + A");
    });

    /** 🔴 Die gesetzten DSA-Begriffe (WI-0170 §2.2): Wegarten, Landschaften und die Wörter der Reise. */
    it("🔴 die Begriffe des Work Items stehen so in der Tafel", () => {
        locale.value = "es";
        expect([
            pathLabel("Reichsstrasse"),
            pathLabel("Strasse"),
            pathLabel("Weg"),
            pathLabel("Pfad"),
            pathLabel("Gebirgspass"),
            pathLabel("Wuestenpfad"),
            pathLabel("Flussweg"),
            pathLabel("Seeweg"),
        ]).toEqual([
            "Calzada imperial",
            "Calzada",
            "Camino",
            "Senda",
            "Paso de montaña",
            "Pista del desierto",
            "Vía fluvial",
            "Vía marítima",
        ]);
        // 🪤 Wie im Niederländischen und Italienischen sind die beiden Gewässer leicht zu vertauschen.
        expect(t("landscape.type.see")).toBe("Lago");
        expect(t("landscape.type.meer")).toBe("Mar");
        expect(t("unit.miles", { n: 12 })).toBe("12 millas");
        expect(t("planner.slope.unit")).toBe("pasos");
        expect(t("planner.hurry")).toBe("Paso forzado");
        expect(t("planner.cost.food.note.other", { n: 7 })).toBe("7 jornadas de viaje");
        // 🪤 „Etappe“ heißt auf Spanisch „Etapa“; `e2e/stage-panel.ts` trägt das Wort deshalb mit.
        expect(t("infoPanel.stage.title", { n: 1, m: 7 })).toBe("Etapa 1 de 7");
    });

    /**
     * 🔴 Der Spieltitel ist ein Name mit spanischer Fassung: «El Ojo Oscuro», so erscheint die Ausgabe
     * von Ediciones Epicismo unter Lizenz von Ulisses Spiele.
     */
    it("🔴 das Spiel heißt auf Spanisch «El Ojo Oscuro»", () => {
        locale.value = "es";
        expect(t("planner.tagline")).toBe("El planificador de rutas para la Aventuria de «El Ojo Oscuro».");
        expect(t("planner.wordmark.alt")).toContain("El Ojo Oscuro");
        // Dass KEINE Tafel den deutschen Titel behält, prüft „Der Spieltitel“ in „Die Tafeln“ über `LOCALES`.
    });

    it("🪤 die Mehrzahl ist die deutsche, nicht die französische: null ist Mehrzahl", () => {
        locale.value = "es";
        const zahl = (n: number): string => tPlural("planner.summary.landscapes", n, { n });
        expect(zahl(0)).toBe("0 zonas");
        expect(zahl(1)).toBe("1 zona");
        expect(zahl(19)).toBe("19 zonas");
    });

    it("🪤 die Rechtstexte fallen auf die englische Fassung, wie im Französischen", () => {
        locale.value = "es";
        expect(t("notes.title")).toBe("Información");
    });

    /**
     * 🔴 Spanische Typografie (WI-0170): Guillemets («…») wie im Französischen und Italienischen, nie die
     * deutschen Anführungszeichen und nie die hohen des Niederländischen; der gerade Apostroph (') kommt im
     * Spanischen nicht vor. 💣 Und die Guillemets stehen paarweise, öffnend vor schließend.
     */
    it("🔴 die spanische Tafel schreibt die Anführungszeichen als Guillemets, paarweise", () => {
        const gerade = Object.entries(es).filter(([, text]) => text.includes("'"));
        expect(gerade.map(([key]) => key)).toEqual([]);
        const fremd = Object.entries(es).filter(([, text]) => /[„“”]/.test(text));
        expect(fremd.map(([key]) => key)).toEqual([]);
        const falsch = Object.entries(es).filter(([, text]) => {
            const zeichen = [...text].filter((c) => c === "«" || c === "»");
            if (zeichen.length === 0) return false;
            if (zeichen.length % 2 !== 0) return true;
            return zeichen.some((c, i) => c !== (i % 2 === 0 ? "«" : "»"));
        });
        expect(falsch.map(([key]) => key)).toEqual([]);
    });

    /**
     * 🔴 **Eine spanische Frage trägt das öffnende Zeichen** (¿, ¡), und zwar in JEDEM Satz, der mit ? oder !
     * endet. 🪤 Ein Text ohne Buchstaben zählt nicht: `planner.cost.tolls.unknown` ist das einzelne „?“ für
     * eine unbekannte Zahl, kein Satz. Ausgenommen sind die Rechtssätze der Reisebilder, die hier englisch stehen, bis eine eigene Fassung
     * abgenommen ist (`rechtssaetze-reisebilder.ts`, Review S2b I4): Ein englischer Satz trägt kein „¿“.
     */
    it("🔴 jede Frage und jeder Ausruf hat sein öffnendes Zeichen", () => {
        const fehlend = Object.entries(es).filter(([key, text]) => {
            if (RECHTSSAETZE_ENGLISCH.includes(key)) return false;
            if (!/\p{L}/u.test(text)) return false;
            if (text.includes("?") && !text.includes("¿")) return true;
            return text.includes("!") && !text.includes("¡");
        });
        expect(fehlend.map(([key]) => key)).toEqual([]);
    });

    /**
     * 🔴 **Keine langen Gedankenstriche** (AGENTS.md): Die deutsche Quelle hat 22, diese Tafel hat keinen
     * MITTEN im Satz. 🪤 Am Anfang eines Textes ist „—“ das Zeichen für „nichts“ (`planner.cost.free`,
     * `medien.galerien.ohneEigenenTitel`) und bleibt stehen.
     */
    it("🔴 kein Gedankenstrich mitten im Satz", () => {
        const treffer = Object.entries(es).filter(([, text]) => text.slice(1).includes("—"));
        expect(treffer.map(([key]) => key)).toEqual([]);
    });

    /**
     * 🔴 Keine Anrede (AGENTS.md, Guide §24). 🪤 Spanisch hat mit `tú` und `usted` zwei. `su` und `sus`
     * stehen NICHT im Muster: Sie sind auch die dritte Person („su nombre“ = sein Name) und in dieser Tafel
     * genau so gemeint.
     */
    it("🔴 niemand wird angesprochen: kein „tú“, kein „tu“, kein „usted“", () => {
        const anrede =
            /(?<!\p{L})(tú|tu|tus|ti|te|usted|ustedes|vosotros|vosotras|vuestro|vuestra|vuestros|vuestras)(?!\p{L})/iu;
        const treffer = Object.entries(es).filter(([, text]) => anrede.test(text));
        expect(treffer.map(([key]) => key)).toEqual([]);
    });
});

describe("Der Planer auf Englisch", () => {
    it("Zahlen mit Punkt, Wörter aus der englischen Tafel", () => {
        locale.value = "en";
        expect(formatNumber(1234.5, 1)).toBe("1,234.5");
        expect(transportLabel("groupFoot")).toBe("Group on foot");
        expect(pathLabel("Querfeldein")).toBe("Rough terrain");
        expect(pathLabel("Unbekannt")).toBe("Unbekannt");
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Exit point");
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8.0 h/day",
            "Unspecified",
            "Shared room",
        ]);
        expect(transportSummary(DEFAULT_OPTIONS).at(-1)?.text).toBe("Fastest route");
        expect(airSummary(DEFAULT_AIR_CHOICE).map((part) => part.text)).toEqual([
            "Witch's flying device",
            "40 miles/h · 100 paces",
        ]);
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Map point near Gareth");
        expect(capLabel("{shift} + A")).toBe("Shift + A");
    });

    it("und zurück auf Deutsch", () => {
        locale.value = "de";
        expect(formatNumber(1234.5, 1)).toBe("1.234,5");
        expect(capLabel("{shift} + A")).toBe("Umschalt + A");
        expect(capLabel("{home}")).toBe("Pos1");
    });
});

/** `label("admin.tab" | "admin.foot", id)` fällt still auf die rohe Kennung zurück: Im Fuß des Mailpostfachs stand deshalb das Wort „mail“ (Betreiber 2026-11-03). */
describe("Texte der Verwaltung", () => {
    it("🔴 jede Ansicht beider Tafeln hat einen Reiter- und einen Fußtext", () => {
        const fehlend = [KONTENVERWALTUNG, SYSTEMSTEUERUNG]
            .flatMap((tafel) => [...tafel.eintraege])
            .filter((eintrag) => eintrag.art === "ansicht")
            .flatMap((eintrag) => [`admin.tab.${eintrag.id}`, `admin.foot.${eintrag.id}`])
            .filter((schluessel) => !isMessageKey(schluessel));
        expect(fehlend).toEqual([]);
    });
});
