import {
    SPRACHENKARTE_TITEL,
    subjectKey,
    type SourceEntry,
    type SprachTrefferListe,
    type SubjectDetail,
    type SubjectFact,
    type SubjectFactField,
    type SubjectRef,
    type SubjectSprache,
} from "@avesmaps3d/shared";
import { formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import { headerGraphicOf } from "./header-graphic";
import { spracheActions } from "./panel-action-model";
import { wikiOf } from "./panel-header";
import { partsOfLinked, percentOf } from "./panel-text";
import type { AlleZeigenModel, PanelEnv, PanelModel, RowModel, TextPart } from "./panel-types";
import type { ShownSubject } from "./subject-selection";
import { safeHref } from "./source-model";
import { lizenzTeile } from "./vorkommen-sammel";

/**
 * Die Infobox einer Sprache (WI-0261 S5b; Bauvorlage: die Probierseite vom 2026-10-30, `app.js` Zustand 2 „Infobox“, `inhalt.js`). Gebaut aus der Detailantwort
 * (`apps/server/src/subjects/detail-sprache.ts`) in das Modell, das jedes Subject zeichnet:
 *
 * - **Kopf:** Typbild `sprachen`, links vom Namen eine Sprechblase in der Farbe der Sprache auf der Karte (Vorlage `sprechblase`), darunter „Sprache“ oder
 *   „Sprachgruppe“ und die Sprachfamilie.
 * - **Band:** Anzeigen und Link teilen (`spracheActions`).
 * - **Feldtafel** in der Reihenfolge der Vorlage: Beschreibung (die Kurzbeschreibung des Wikis), Sprachfamilie, Vorstufen, Schrift, Dialekte, Sprecher,
 *   Amtssprache in, Weitere Verbreitung; darunter die Herkunft des Texts mit Lizenz wie bei den Vorkommen (`lizenzTeile`).
 * - **„Wo sie gesprochen wird“:** je Art eine Zeile wie die Vorkommen (O4 „nur Zahlen, aufklappbar“; Betreiber 2026-10-31: „kannst du dich hier an das design der
 *   bisherigen item in der infobox halten“): zugeklappt der Zählsatz, aufgeklappt Suchfeld und Buchstabenregister (`sprache-treffer.ts`, `info-lore-row.vue`).
 * - **Quellenkasten** (O5): die Wikizeile des ersten Artikels samt Lizenz hinter dem ⓘ, die weiteren Artikel der Gruppe und die Herkunft der Flächen
 *   (Referenzkarte oder Redaktion).
 */

/** Die Felder der Tafel in der Reihenfolge der Bauvorlage (`app.js` `fakten`). */
const SPRACH_FELDER: readonly SubjectFactField[] = [
    "description",
    "sprachfamilie",
    "vorstufen",
    "schrift",
    "dialekte",
    "sprecheranzahl",
    "amtssprache",
    "weitereVerbreitung",
];

const feldLabel = (field: SubjectFactField): string => t(`infoPanel.field.${field}` as MessageKey);

/** Eine Zeile der Tafel: Text, Text mit Verweisen (Amtssprache) oder eine Liste (Dialekte). */
function feldZeile(fact: SubjectFact, index: number): RowModel | undefined {
    const label = feldLabel(fact.field);
    if ("values" in fact) {
        return fact.values.length === 0
            ? undefined
            : { key: `${fact.field}:${String(index)}`, label, value: { kind: "text", text: fact.values.join(", ") } };
    }
    if (fact.value.trim() === "") return undefined;
    const links = fact.links ?? [];
    return {
        key: `${fact.field}:${String(index)}`,
        label,
        value:
            links.length === 0
                ? { kind: "text", text: fact.value }
                : { kind: "parts", parts: partsOfLinked(fact.value, links) },
    };
}

/** Die Zeilen der Feldtafel: nur die bekannten Felder, in der Reihenfolge der Vorlage; leere fallen weg (WI-0063 5.3). */
export function sprachFeldZeilen(facts: readonly SubjectFact[] | undefined): RowModel[] {
    const zeilen: RowModel[] = [];
    for (const feld of SPRACH_FELDER) {
        (facts ?? []).forEach((fact, index) => {
            if (fact.field !== feld) return;
            const zeile = feldZeile(fact, index);
            if (zeile !== undefined) zeilen.push(zeile);
        });
    }
    return zeilen;
}

/**
 * Eine Trefferzeile: der Zählsatz wie an den Vorkommen am Telefon („721 Gebiete“); die Namen holt die Zeile beim Aufklappen selbst. Die
 * Zahl ist die der Detailantwort, nicht die Länge einer Liste.
 */
export function sprachTrefferZeile(liste: SprachTrefferListe, sprache: SubjectRef): RowModel {
    const n = formatNumber(liste.anzahl, 0);
    const einheit = tPlural(`sprache.treffer.einheit.${liste.art}`, liste.anzahl);
    return {
        key: `treffer:${liste.art}`,
        label: t(`sprache.treffer.${liste.art}` as MessageKey),
        value: {
            kind: "sprachTreffer",
            ref: sprache,
            art: liste.art,
            count: liste.anzahl,
            // Ohne Verb, in jeder Sprache gleich gebaut: Ein Partizip hinter dem Wort der Art müsste sich nach dessen Genus beugen („regiones registradas“).
            sentence: `${n} ${einheit}`,
            shortSentence: `${n} ${einheit}`,
        },
    };
}

/**
 * Die leisen Zeilen unter der Feldtafel (Bauvorlage `infoSprache`): die Herkunft des Texts mit Lizenz, nur wo es einen Wiki-Text gibt (`lizenzTeile`, wie bei den
 * Vorkommen), und die weiteren Wiki-Artikel einer Gruppe („Weitere Wiki-Artikel: Gjalskisch ↗ · Fjarningsch ↗“); der erste steht als Wikizeile im Quellenkasten.
 */
export function sprachHerkunftZeilen(
    detail: SubjectDetail,
    mitText: boolean,
): { text: string; href?: string | undefined }[][] {
    const zeilen: { text: string; href?: string | undefined }[][] = [];
    if (mitText && detail.wiki !== undefined) zeilen.push(lizenzTeile({ wiki: detail.wiki }));
    const weitere = (detail.sprache?.artikel ?? []).slice(1);
    if (weitere.length > 0) {
        zeilen.push([
            { text: `${t("sprache.weitereArtikel")} ` },
            ...weitere.flatMap((artikel, at) => [
                ...(at > 0 ? [{ text: " · " }] : []),
                { text: artikel.titel, href: safeHref(artikel.url) },
            ]),
        ]);
    }
    return zeilen;
}

/**
 * Die Quellen der Flächen, die die Infobox mitbringt (O5): die Referenzkarte, ein offizielles Werk (E0: „teil des ganz normalen ulisses kartenpakets“), oder die
 * Redaktion, die keines ist. Die Hinweise ändert dieses WI nicht (O5: beim Cutoff).
 */
export function sprachQuellen(detail: SubjectDetail): SourceEntry[] {
    const block = detail.sprache;
    if (block === undefined) return [];
    return block.herkunft.map((herkunft) =>
        herkunft === "sprachenkarte"
            ? { title: SPRACHENKARTE_TITEL, type: "sonstiges", official: true, note: t("sprache.quelle.flaeche") }
            : {
                  title: t("sprache.quelle.redaktion"),
                  type: "sonstiges",
                  official: false,
                  note: t("sprache.quelle.flaeche"),
              },
    );
}

/**
 * „Alle zeigen“ (WI-0261 S5c): nur, wo die Sprache Flächen hat; ohne sie gäbe es nichts zu zeigen (kein leerer Baustein, WI-0063 5.3). Die Kamera fliegt auf das Ziel der Antwort, die
 * Hülle der Hauptteile (`detail-sprache.ts`).
 */
export function alleZeigenOf(detail: SubjectDetail): AlleZeigenModel | undefined {
    const block = detail.sprache;
    if (block === undefined || block.gegenden <= 0) return undefined;
    return {
        schluessel: block.schluessel,
        gegenden: block.gegenden,
        ref: detail.subject,
        ...(detail.target === undefined ? {} : { target: detail.target }),
    };
}

/** Das Modell der Infobox einer Sprache. */
export function spracheModel(shown: ShownSubject, detail: SubjectDetail, env: PanelEnv): PanelModel {
    const block = detail.sprache;
    const art = detail.subtitle?.find((part) => part.part === "type");
    const familie = detail.subtitle?.find((part) => part.part === "kind");
    const artWort = t(
        art?.part === "type" && art.key === "sprachgruppe" ? "sprache.art.sprachgruppe" : "sprache.art.sprache",
    );
    const rows = sprachFeldZeilen(detail.facts);
    const lizenz = sprachHerkunftZeilen(
        detail,
        rows.some((row) => row.key.startsWith("description:")),
    );
    const treffer = (block?.treffer ?? []).map((liste) => sprachTrefferZeile(liste, detail.subject));
    const alleZeigen = alleZeigenOf(detail);
    const wiki = wikiOf(detail);
    const quellen = sprachQuellen(detail);
    return {
        header: {
            title: detail.title ?? shown.title ?? t("infoPanel.untitled"),
            subtitle: [
                { parts: [{ text: artWort }] },
                ...(familie?.part === "kind" ? [{ parts: [{ text: familie.text }] }] : []),
            ],
            graphic: headerGraphicOf("sprache", undefined),
            images: [],
            ...(block === undefined ? {} : { sprachfarbe: block.farbe }),
        },
        actions: spracheActions(detail, env),
        rows,
        ...(lizenz.length === 0 ? {} : { lizenz }),
        ...(treffer.length === 0 && alleZeigen === undefined
            ? {}
            : {
                  gesprochen: {
                      heading: t("sprache.wo"),
                      rows: treffer,
                      ...(alleZeigen === undefined ? {} : { alleZeigen }),
                  },
              }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(quellen.length === 0 ? {} : { quellen }),
        catalogs: [],
    };
}

/**
 * Die Zeile „Sprachen“ der übrigen Infoboxen (WI-0261 S5b; Betreiber 2026-10-30: „zwischen "Regionen" und "Topographie"“, „sprachen sind verlinkt“): jede Sprache
 * ein Verweis auf ihre Infobox mit dem Kästchen ihrer Farbe davor (Vorlage `punkt`, wie „Umstritten mit“), durch „ · “ getrennt (Vorlage). Wo mehrere eine
 * Fläche oder einen Weg teilen, steht ihr Anteil dahinter wie bei der Klimazone; an einem Ort (Punkt in Fläche) nie. Ohne Sprache keine Zeile.
 */
export function sprachenZeile(sprachen: readonly SubjectSprache[] | undefined, ort: boolean): RowModel | undefined {
    if (sprachen === undefined || sprachen.length === 0) return undefined;
    const gesehen = new Set<string>();
    const teile: TextPart[] = [];
    for (const sprache of sprachen) {
        const key = subjectKey(sprache.ref);
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        if (teile.length > 0) teile.push({ text: " · " });
        teile.push({ text: sprache.name, ref: sprache.ref, swatch: sprache.farbe });
        if (!ort && sprachen.length > 1) teile.push({ text: percentOf(sprache.anteil) });
    }
    return { key: "ctx:sprachen", label: t("infoPanel.sprachen"), value: { kind: "parts", parts: teile } };
}
