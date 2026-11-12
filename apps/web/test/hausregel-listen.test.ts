import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.ts";

/**
 * Hausregel „Filter und Sortierung nur als Zeichen“ (Betreiber 2026-10-11: „generell will ich immer allein das sortierung-symbol und das
 * filter-symbol, um platz zu sparen. beim draufklicken öffnet sich das menü mit den optionen.“; Design Guide §13.45, `AGENTS.md`).
 *
 * 💣 Der Betreiber zweifelt, dass jede Sitzung die Regel liest („bin mal gespannt, ob es das in den design guide schaff und ob den alle
 * lesen“). Dieser Test braucht das Lesen nicht: Er durchsucht jede `.vue` unter `apps/web/src` außerhalb von `controls/` (dort wohnen die
 * Bauteile selbst) und wird rot bei
 *
 * - **R1** einer Klappliste (`<select>`, `AvmAuswahl`), deren Name, Beschriftung oder Wert sortiert („sort“, „Sortierung“, „Ordnung“);
 * - **R2** sichtbarem Text „Sortierung:“, wörtlich im Template oder über einen Text aus `de.ts`;
 * - **R3** einem Textknopf „Filter (n)“ oder „Weitere Filter“, wörtlich oder über einen Text aus `de.ts`;
 * - **R4** Sortierwörtern als Leiste (eine Klasse `sort…`, wie Legacys `.avesmaps-adv__sorts`);
 * - **R5** einem eigenen Trichter-Zeichen und **R6** einem eigenen Sortierzeichen: Beide gibt es einmal, im Filterknopf und in der
 *   Zeichenfamilie `AvmSortierzeichen` (Abnahme 2026-10-11, Punkt 2);
 * - **R7** einem Filter als Klappliste oder Text-Segmente IN der Leiste einer Liste (Koordination 2026-10-11, scharfe Form): ein
 *   `<select>` oder `AvmAuswahl`, ebenso `AvmSegmente` ohne Zeichen, im Slot `leiste` oder in einem Element mit der Klasse
 *   `…__leiste`, `…-leiste`, `…__filter` oder `…-filter`. Reiter (`FensterReiter`, `role="tablist"`) und Zeichen-Segmente (Slot
 *   `zeichen`) bleiben erlaubt;
 * - **R8** einem Trichter (`AvmFilterknopf`) oder Sortierzeichen (`AvmSortierzeichen`) außerhalb der Leiste jeder Liste
 *   (`AvmListenleiste`; Betreiber 2026-10-11: „Trichter und Sortierzeichen statt Filterzeilen -> sollten immer rechtsbündig sein.
 *   idealerweise ist auch immer eine suchmaske nach freitext links von den beiden“). Ausgenommen sind die Abschnitte im Infopanel
 *   (`info-panel/`, etwa „Innerorts ordnen“): Sie ordnen eine Handvoll Einträge in einem schmalen Panel, eine eigene Leiste mit Suche
 *   lohnte dort nicht (Koordination 2026-10-11).
 *
 * Als Name eines Knopfs für Vorleser (`aria-label`, `title`, `bezeichnung`) ist „Sortierung: Name“ richtig und nicht gemeint.
 *
 * ⭐ Die Listen, die noch umgebaut werden, stehen in `NOCH_UMZUBAUEN` mit Besitzer und WI. Die Liste darf nur SCHRUMPFEN: Ein Eintrag,
 * der nicht mehr verstößt, macht den Test ebenfalls rot, damit er gestrichen wird.
 */

const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

type Regel = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8";

const REGEL: Record<Regel, string> = {
    R1: "eine Klappliste sortiert",
    R2: "sichtbares „Sortierung:“",
    R3: "ein Textknopf „Filter (n)“ oder „Weitere Filter“",
    R4: "Sortierwörter als Leiste",
    R5: "ein eigenes Trichter-Zeichen",
    R6: "ein eigenes Sortierzeichen",
    R7: "ein Filter als Klappliste oder Text-Segmente in der Leiste",
    R8: "Trichter oder Sortierzeichen außerhalb der Leiste jeder Liste (AvmListenleiste)",
};

/** Die Form des Trichters und der Pfeil der Sortierzeichen, wie die Bauteile sie zeichnen. */
const TRICHTER = "M2 3h12l-4.5 5.2V13l-3-1.6V8.2Z";
const SORTIERPFEIL = "M3.5 2.5v11M1.5 11.5l2 2 2-2";

/** Was heute noch gegen die Regel steht, je Datei und Regel, mit dem, der es umbaut (Stand 2026-10-11). */
const NOCH_UMZUBAUEN: readonly { datei: string; regel: Regel; besitzer: string }[] = [];

function vueDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return eintrag.name === "controls" && ordner === WEB_SRC ? [] : vueDateien(pfad);
        return eintrag.name.endsWith(".vue") ? [pfad] : [];
    });
}

/** Das Template ohne HTML-Kommentare: Ein Kommentar darf die Regel nennen. */
function template(quelle: string): string {
    const anfang = quelle.indexOf("<template>");
    const ende = quelle.lastIndexOf("</template>");
    if (anfang < 0 || ende < 0) return "";
    return quelle.slice(anfang, ende).replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Ein öffnendes oder schließendes Tag samt Attributen, auch über mehrere Zeilen. 🪤 Anführungszeichenfest: Ein Attribut wie
 * `:aria-label="anzahl > 0 ? …"` enthält ein `>`, das sonst als Ende des Tags gälte, und sein Rest als sichtbarer Text.
 */
const TAG = /<\/?([A-Za-z][\w-]*)((?:\s+[^\s"'>=/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;

const tags = (vorlage: string): { name: string; attribute: string }[] =>
    [...vorlage.matchAll(TAG)].map((treffer) => ({ name: treffer[1] as string, attribute: treffer[2] ?? "" }));

/** Sichtbarer Text: was zwischen den Tags steht, Interpolationen eingeschlossen. */
const texte = (vorlage: string): string[] =>
    vorlage
        .replace(TAG, "\u0000")
        .split("\u0000")
        .filter((text) => text.trim() !== "");

/** Die Schlüssel aus `de.ts`, die ein sichtbarer Text über `t("…")` zeigt. */
const textSchluessel = (text: string): string[] =>
    [...text.matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)].map((treffer) => treffer[1] as string);

const deutsch = de as Record<string, string>;

/** Elemente ohne schließendes Tag: Sie öffnen keinen Bereich. */
const LEER = new Set(["input", "img", "br", "hr", "source", "wbr", "col", "area", "embed", "track"]);

/** Ist dieses Tag die Leiste einer Liste: der Slot `leiste` oder ein Element mit Klasse `…__leiste`, `…-leiste`, `…__filter`, `…-filter`? */
const istLeiste = (name: string, attribute: string): boolean =>
    (name === "template" && /(#|v-slot:)leiste\b/.test(attribute)) ||
    /\bclass="[^"]*(\b[\w-]*__(leiste|filter)\b|\b[\w-]+-(leiste|filter)\b)/.test(attribute);

/** R7: eine Klappliste oder Text-Segmente in der Leiste einer Liste. Zeichen-Segmente tragen den Slot `zeichen`. */
function filterInDerLeiste(vorlage: string): boolean {
    const stapel: { name: string; leiste: boolean }[] = [];
    for (const treffer of vorlage.matchAll(TAG)) {
        const [ganz, name = "", attribute = ""] = treffer;
        if (ganz.startsWith("</")) {
            while (stapel.length > 0 && stapel.pop()?.name !== name);
            continue;
        }
        const inLeiste = stapel.some((eintrag) => eintrag.leiste);
        if (inLeiste && /^(select|AvmAuswahl|avm-auswahl)$/.test(name)) return true;
        if (inLeiste && /^(AvmSegmente|avm-segmente)$/.test(name)) {
            const ende = ganz.endsWith("/>") ? -1 : vorlage.indexOf(`</${name}`, treffer.index);
            const rumpf = ende < 0 ? "" : vorlage.slice(treffer.index, ende);
            if (!/(#|v-slot:)zeichen\b/.test(rumpf)) return true;
        }
        if (!ganz.endsWith("/>") && !LEER.has(name.toLowerCase()))
            stapel.push({ name, leiste: istLeiste(name, attribute) });
    }
    return false;
}

/** R8: ein Trichter oder Sortierzeichen, über dem keine `AvmListenleiste` steht. */
function ausserhalbDerListenleiste(vorlage: string): boolean {
    const stapel: string[] = [];
    for (const treffer of vorlage.matchAll(TAG)) {
        const [ganz, name = ""] = treffer;
        if (ganz.startsWith("</")) {
            while (stapel.length > 0 && stapel.pop() !== name);
            continue;
        }
        if (/^(AvmFilterknopf|avm-filterknopf|AvmSortierzeichen|avm-sortierzeichen)$/.test(name)) {
            if (!stapel.some((eintrag) => /^(AvmListenleiste|avm-listenleiste)$/.test(eintrag))) return true;
        }
        if (!ganz.endsWith("/>") && !LEER.has(name.toLowerCase())) stapel.push(name);
    }
    return false;
}

/** Die Abschnitte im Infopanel brauchen keine Leiste (R8, siehe oben). */
const ohneLeiste = (datei: string): boolean => datei.startsWith("info-panel/");

function verstoesse(quelle: string, datei = ""): Set<Regel> {
    const vorlage = template(quelle);
    const gefunden = new Set<Regel>();
    if (filterInDerLeiste(vorlage)) gefunden.add("R7");
    if (!ohneLeiste(datei) && ausserhalbDerListenleiste(vorlage)) gefunden.add("R8");
    for (const tag of tags(vorlage)) {
        if (/^(select|AvmAuswahl|avm-auswahl)$/.test(tag.name) && /sort|ordnung/i.test(tag.attribute))
            gefunden.add("R1");
        const klassen = /\bclass="([^"]*)"/.exec(tag.attribute)?.[1] ?? "";
        if (klassen.split(/\s+/).some((klasse) => /^sort/i.test(klasse))) gefunden.add("R4");
    }
    if (vorlage.includes(TRICHTER)) gefunden.add("R5");
    if (vorlage.includes(SORTIERPFEIL)) gefunden.add("R6");
    for (const text of texte(vorlage)) {
        const gezeigt = [text, ...textSchluessel(text).map((schluessel) => deutsch[schluessel] ?? "")];
        if (gezeigt.some((wort) => /Sortierung:/.test(wort))) gefunden.add("R2");
        if (gezeigt.some((wort) => /\bFilter \(|Weitere Filter/.test(wort))) gefunden.add("R3");
    }
    return gefunden;
}

const befund = (): Map<string, Set<Regel>> =>
    new Map(
        vueDateien(WEB_SRC)
            .map(
                (pfad) =>
                    [
                        relative(WEB_SRC, pfad).replaceAll("\\", "/"),
                        verstoesse(readFileSync(pfad, "utf8"), relative(WEB_SRC, pfad).replaceAll("\\", "/")),
                    ] as const,
            )
            .filter(([, regeln]) => regeln.size > 0),
    );

const HINWEIS =
    "Filter und Sortierung stehen in jeder Liste nur als Zeichen, rechtsbündig in der Leiste der Liste (AvmListenleiste: links die " +
    "Freitextsuche, rechts Trichter, Sortierung, Umschalter; Betreiber 2026-10-11, Design Guide §13.45): der Filter ist " +
    "`AvmFilterknopf` (apps/web/src/controls/avm-filterknopf.vue), die Sortierung der Menüknopf `AvmMenueknopf` mit den Zeichen aus " +
    "`AvmSortierzeichen`; die Richtung ist eine eigene Ordnung.";

describe("Hausregel: Filter und Sortierung nur als Zeichen (Guide §13.45)", () => {
    it("🔴 keine Liste baut Filter oder Sortierung anders als mit den gemeinsamen Bauteilen", () => {
        const neu = [...befund()].flatMap(([datei, regeln]) =>
            [...regeln]
                .filter(
                    (regel) => !NOCH_UMZUBAUEN.some((eintrag) => eintrag.datei === datei && eintrag.regel === regel),
                )
                .map((regel) => `${datei}: ${REGEL[regel]} (${regel})`),
        );
        expect(neu, `${HINWEIS}\nVerstöße:\n${neu.join("\n")}`).toEqual([]);
    });

    it("🔴 die Ausnahmeliste schrumpft nur: wer umgebaut ist, wird gestrichen", () => {
        const gefunden = befund();
        const erledigt = NOCH_UMZUBAUEN.filter((eintrag) => !gefunden.get(eintrag.datei)?.has(eintrag.regel)).map(
            (eintrag) => `${eintrag.datei} ${eintrag.regel} (${eintrag.besitzer})`,
        );
        expect(erledigt, `Umgebaut: aus NOCH_UMZUBAUEN streichen\n${erledigt.join("\n")}`).toEqual([]);
    });

    it("die Prüfung erkennt jede Form und lässt die Bauteile in Ruhe", () => {
        // Ohne diese Probe könnte eine zu enge Regel still grün sein.
        const v = (vorlage: string): Regel[] => [...verstoesse(`<template>${vorlage}</template>`)].sort();
        expect(v('<AvmAuswahl v-model="sortierung" :optionen="o" />')).toEqual(["R1"]);
        expect(v('<select aria-label="Ordnung"><option>Name</option></select>')).toEqual(["R1"]);
        expect(v("<span>Sortierung: Name</span>")).toEqual(["R2"]);
        expect(v('<span>{{ t("editorListe.sortierung.knopf", { wahl }) }}</span>')).toEqual(["R2"]);
        expect(v('<button>{{ t("controls.filter.gesetzt", { n: 2 }) }}</button>')).toEqual(["R3"]);
        expect(v("<button>Weitere Filter</button>")).toEqual(["R3"]);
        expect(v('<span class="sortierung"><button>Name</button></span>')).toEqual(["R4"]);
        expect(v(`<svg><path d="${TRICHTER}" /></svg>`)).toEqual(["R5"]);
        expect(v(`<svg><path d="${SORTIERPFEIL}" /></svg>`)).toEqual(["R6"]);
        expect(v('<template #leiste><AvmAuswahl v-model="wer" :optionen="o" /></template>')).toEqual(["R7"]);
        expect(v('<div class="liste__filter"><AvmSegmente v-model="z" :options="o" /></div>')).toEqual(["R7"]);
        expect(v('<div class="kanal-leiste"><select v-model="k"></select></div>')).toEqual(["R7"]);
        // Erlaubt in der Leiste: Zeichen-Segmente, Reiter, und eine Klappliste außerhalb jeder Leiste.
        expect(
            v(
                '<template #leiste><AvmSegmente v-model="a" :options="o"><template #zeichen="{ wert }"><i /></template></AvmSegmente></template>',
            ),
        ).toEqual([]);
        expect(v('<template #leiste><FensterReiter v-model="r" :reiter="t" /></template>')).toEqual([]);
        expect(v('<form class="formular"><AvmAuswahl v-model="art" :optionen="o" /></form>')).toEqual([]);
        // Erlaubt: der Name eines Knopfs für Vorleser, auch mit einem „>“ im Attribut, und die Bauteile selbst.
        expect(v(`<button :aria-label="n > 0 ? t('medien.filter.trichterZahl') : 'Filter'">x</button>`)).toEqual([]);
        expect(
            v('<AvmMenueknopf :bezeichnung="t(\'medien.sort.knopf\', { name })" menue-bezeichnung="Sortierung" />'),
        ).toEqual([]);
        expect(
            v('<AvmListenleiste v-model="q"><AvmFilterknopf :abschnitte="a" :wahl="w" /></AvmListenleiste>'),
        ).toEqual([]);
        expect(
            v(
                '<AvmListenleiste v-model="q"><AvmMenueknopf v-model="o"><template #zeichen="{ wert }"><AvmSortierzeichen art="name" /></template></AvmMenueknopf></AvmListenleiste>',
            ),
        ).toEqual([]);
        // R8: Trichter und Sortierzeichen außerhalb der Leiste jeder Liste; im Infopanel begründet erlaubt.
        expect(v('<div class="kopf"><AvmFilterknopf :abschnitte="a" :wahl="w" /></div>')).toEqual(["R8"]);
        expect(
            v(
                '<AvmMenueknopf v-model="o"><template #zeichen><AvmSortierzeichen art="zeit" /></template></AvmMenueknopf>',
            ),
        ).toEqual(["R8"]);
        expect([
            ...verstoesse('<template><AvmSortierzeichen art="name" /></template>', "info-panel/info-lore-row.vue"),
        ]).toEqual([]);
    });
});
