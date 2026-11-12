<script setup lang="ts">
import { computed, ref } from "vue";
import {
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_LANDSCHAFTSARTEN,
} from "@avesmaps3d/shared";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import { t, tafelVon } from "../i18n/i18n";
import { ebeneName, landschaftName, richtungName, zoneName } from "../wikisync/wikisync-regeln-text";
import { TEXT_AUFBAU } from "./inhalte-regeln-text-modell";
import { beziehungName, artName } from "./inhalte-vorkommen-texte";

/**
 * Die Klappe „Schreibweise“ von „Regeln als Text“ (WI-0254 §13; Entwurf `j-text-ansicht.js`, `txSchreibweiseHtml`): die Kurzreferenz der Wiki-Kurzschrift und die Wortlisten. Ein Klick auf ein Wort fügt es an der
 * Schreibmarke des Felds ein (`einfuegen`).
 *
 * - 🔴 **Die Wörter sind die der Schreibweise, also deutsch:** Der Server liest Landschaftsarten, Klimazonen, Richtungen, Beziehungen und Kategorien mit ihren deutschen Namen, in jeder Sprache der Seite. Der Knopf zeigt
 *   darum das deutsche Wort; ist der Name in der Sprache der Seite ein anderer, steht er im Hinweis beim Überfahren.
 * - Die Erläuterungen stehen in der Sprache der Seite, die Zeichen und Schlüsselwörter (`[[…]]`, `außer`, `Klima`, `bis`) bleiben, wie sie geschrieben werden.
 */
const emit = defineEmits<{ einfuegen: [text: string, art: "art" | "beziehung" | "wort"] }>();

/** Die Ebenen der Landschaftsarten in der Folge der Listen im Regeleditor. */
const EBENEN = ["vegetation", "topographie", "derographisch"] as const;

const offen = ref(false);

/** Der deutsche Name zu einem Schlüssel der Tafel (die Schreibweise ist deutsch, die Seite oft nicht). */
const deutsch = (schluessel: string): string => tafelVon("de")[schluessel] ?? schluessel;

interface Wort {
    schluessel: string;
    /** Das deutsche Wort: Aufschrift und Einfügung. */
    wort: string;
    /** Der Name in der Sprache der Seite, wo er ein anderer ist. */
    hinweis: string | undefined;
    einfuegen: string;
    art: "art" | "beziehung" | "wort";
}
interface Gruppe {
    schluessel: string;
    titel: string;
    woerter: Wort[];
}

const wort = (
    schluessel: string,
    deutscherName: string,
    seitenName: string,
    art: Wort["art"],
    einfuegen = deutscherName,
): Wort => ({
    schluessel,
    wort: deutscherName,
    hinweis: seitenName === deutscherName ? undefined : seitenName,
    einfuegen,
    art,
});

const gruppen = computed<Gruppe[]>(() => [
    ...EBENEN.map((ebene) => ({
        schluessel: `arten-${ebene}`,
        titel: t("inhalte.vorkommen.text.woerter.arten", { ebene: ebeneName(ebene) }),
        woerter: WIKISYNC_LANDSCHAFTSARTEN.filter((eintrag) => eintrag.ebene === ebene).map((eintrag) =>
            wort(eintrag.art, deutsch(`landscape.type.${eintrag.art}`), landschaftName(eintrag.art), "art"),
        ),
    })),
    {
        schluessel: "klima",
        titel: t("layer.klima"),
        woerter: WIKISYNC_KLIMAZONEN.map((zone) => wort(zone, deutsch(`climate.zone.${zone}`), zoneName(zone), "wort")),
    },
    {
        schluessel: "richtungen",
        titel: t("inhalte.vorkommen.text.woerter.richtungen"),
        woerter: WIKISYNC_LAGE_RICHTUNGEN.map((richtung) =>
            wort(richtung, deutsch(`admin.wikisync.regeln.richtung.${richtung}`), richtungName(richtung), "wort"),
        ),
    },
    {
        schluessel: "beziehungen",
        titel: t("inhalte.vorkommen.text.woerter.beziehungen"),
        woerter: INHALTE_VORKOMMEN_BEZIEHUNGEN.map((beziehung) => {
            const name = deutsch(`inhalte.vorkommen.beziehung.${beziehung}`);
            return wort(beziehung, name, beziehungName(beziehung), "beziehung", `| ${name} = `);
        }),
    },
    {
        schluessel: "kategorien",
        titel: t("inhalte.vorkommen.text.woerter.kategorien"),
        woerter: INHALTE_VORKOMMEN_ARTEN.map((art) =>
            wort(art, deutsch(`infoPanel.lore.${art}`), artName(art), "wort"),
        ),
    },
]);
</script>

<template>
    <AvmDisclosure
        v-model:open="offen"
        :label="t('inhalte.vorkommen.text.schreibweise')"
        toggle-testid="inhalte-text-schreibweise"
    >
        <div class="tx-ref">
            <pre class="tx-ref__code" :aria-label="t('inhalte.vorkommen.text.ref.aufbau')">{{ TEXT_AUFBAU }}</pre>
            <dl class="tx-ref__teile">
                <dt>{{ t("inhalte.vorkommen.text.ref.quelle.name") }}</dt>
                <dd>{{ t("inhalte.vorkommen.text.ref.quelle.text") }}</dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.kopf.name") }}</dt>
                <dd>{{ t("inhalte.vorkommen.text.ref.kopf.text") }}</dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.regel.name") }}</dt>
                <dd>{{ t("inhalte.vorkommen.text.ref.regel.text") }}</dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.zeichen.name") }}</dt>
                <dd>
                    <code>;</code> {{ t("inhalte.vorkommen.text.ref.zeichen.neueRegel") }} · <code>,</code>
                    {{ t("inhalte.vorkommen.text.ref.zeichen.oder") }} · <code>:</code>
                    {{ t("inhalte.vorkommen.text.ref.zeichen.und") }} · <code>außer</code>
                    {{ t("inhalte.vorkommen.text.ref.zeichen.ohne") }}.
                    {{ t("inhalte.vorkommen.text.ref.zeichen.gilt") }}
                </dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.glied.name") }}</dt>
                <dd>{{ t("inhalte.vorkommen.text.ref.glied.text") }}</dd>
            </dl>
            <dl class="tx-ref__teile tx-ref__teile--eng">
                <dt>{{ t("inhalte.vorkommen.text.ref.arten.name") }}</dt>
                <dd>
                    <code>[[Wald]]</code> · <code>[[Wald]] oder [[Sümpfe und Moore]]</code>
                    {{ t("inhalte.vorkommen.text.ref.arten.oder") }}
                </dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.flaeche.name") }}</dt>
                <dd>
                    <code>in [[Name]]</code> · <code>in [[Wiki-Titel]]</code> ·
                    {{ t("inhalte.vorkommen.text.ref.flaeche.ohneIn") }} · <code>in [[#3777af29|Name]]</code>
                    {{ t("inhalte.vorkommen.text.ref.flaeche.mehrdeutig") }} · <code>[[Wiki-Titel]] (wartet)</code>
                    {{ t("inhalte.vorkommen.text.ref.flaeche.wartet") }}
                </dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.klima.name") }}</dt>
                <dd><code>Klima Zone</code> · <code>Klima Zone bis Zone</code></dd>
                <dt>{{ t("inhalte.vorkommen.text.ref.lage.name") }}</dt>
                <dd>
                    <code>nördlich von [[Ort]]</code> · <code>südlich der Linie [[Ort]]–[[Ort]]</code>
                    {{ t("inhalte.vorkommen.text.ref.lage.zwischen") }}
                </dd>
            </dl>
            <p class="tx-ref__hinweis">{{ t("inhalte.vorkommen.text.ref.namen") }}</p>
            <p class="tx-ref__hinweis" data-testid="inhalte-text-wiki-unterschied">
                <b>{{ t("inhalte.vorkommen.text.ref.unterschied.kopf") }}</b>
                {{ t("inhalte.vorkommen.text.ref.unterschied.text") }}
            </p>
            <div v-for="gruppe in gruppen" :key="gruppe.schluessel" class="tx-woerter">
                <h5 class="tx-woerter__kopf avm-versalmitte">
                    {{ gruppe.titel }} <span class="tx-woerter__zahl">{{ gruppe.woerter.length }}</span>
                </h5>
                <div class="tx-woerter__liste">
                    <button
                        v-for="eins in gruppe.woerter"
                        :key="eins.schluessel"
                        type="button"
                        class="tx-wort"
                        :title="eins.hinweis"
                        data-testid="inhalte-text-wort"
                        @click="emit('einfuegen', eins.einfuegen, eins.art)"
                    >
                        <span class="avm-versalmitte">{{ eins.wort }}</span>
                    </button>
                </div>
            </div>
        </div>
    </AvmDisclosure>
</template>

<style scoped>
.tx-ref {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-6) var(--space-8) var(--space-8);
}

.tx-ref__code {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    white-space: pre;
}

.tx-ref__teile {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.tx-ref__teile dt {
    color: var(--color-accent-brown);
}

.tx-ref__teile dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.tx-ref__teile--eng {
    padding-left: var(--space-8);
}

.tx-ref__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.tx-ref code {
    padding: 0 3px;
    border: 1px solid var(--color-divider);
    border-radius: 4px;
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
    font: inherit;
}

.tx-woerter__kopf {
    margin: var(--space-4) 0 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.tx-woerter__zahl {
    color: var(--color-text-muted);
}

.tx-woerter__liste {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

/* Ein Wort der Schreibweise: eine Pille, die ein Klick einfügt (die Pille selbst ist keine Bedienung, darum der eigene Knopf). */
.tx-wort {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    height: var(--space-20);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: 1;
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.tx-wort:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.tx-wort:active {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.tx-wort:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

@media (pointer: coarse) {
    .tx-wort {
        height: 30px;
        padding: 0 var(--space-8);
    }
}

@media (prefers-reduced-motion: reduce) {
    .tx-wort {
        transition: none;
    }
}
</style>
