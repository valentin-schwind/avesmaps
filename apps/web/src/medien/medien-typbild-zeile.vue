<script setup lang="ts">
import { computed, ref } from "vue";
import type { MamTypeImage } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { headerGraphicUrl } from "../info-panel/header-graphic";
import { paarStand, typbildBild } from "./medien-typbilder-modell";
import { typbildObjekteName, zahl } from "./medien-text";

/**
 * Eine Typbildkategorie als Zeile in Spalte 2 (WI-0068 „Typbilder“, Betreiber 2026-10-11; Blatt abgenommen 2026-10-12).
 *
 * Form wie jeder Treffer der Medienverwaltung (`medien-eintrag.vue`, Legacys `.avm-row`): links das Bild, rechts zwei Zeilen; die
 * durchsichtige Kante ist immer da und färbt sich nur bei der Wahl. Zustände nach Guide §30.5: Ruhe · Hover · Aktiv · Fokus ·
 * Übergang (gesperrt gibt es nicht — jede Kategorie ist wählbar, auch eine ohne ★).
 *
 * - **Der ★ steht am Bild**, nicht vor dem Namen: Er sagt „dieses Asset gilt“, und daneben steht, ob es auch öffentlich erscheint.
 * - 🔴 **Ohne ★ zeigt die Zeile die eingebaute Grafik** und sagt es („eingebaute Grafik“). Sie fällt nie aus der Liste: die
 *   Kategorien ohne ★ sind der Arbeitsvorrat.
 * - 🔴 **Ein ★-Asset, das die Policy nicht freigibt, ist kein öffentliches Bild** (A4): Die Zeile zeigt dann die private Vorschau mit
 *   „INTERN“ und sagt, dass Besucher weiter die eingebaute Grafik sehen. Inhaltsbilder werden nie umgefärbt und nie gedimmt.
 * - **Das Paar** (WI-0281): rechts, was es von der Kategorie gibt: „Paar (KI + Ohne KI)“, „Nur KI“, „Nur Ohne KI“ oder „Kein Typbild“, mit einem Zeichen; das Bild
 *   links ist das des Normalmodus (KI-Variante, sonst Ohne-KI-Variante). Ein vollständiges Paar trägt den Ton des Erfolgs, ein halbes den warmen des Befunds;
 *   am schmalen Platz kürzt das Wort mit „…“, das Zeichen bleibt.
 */
const props = defineProps<{
    eintrag: MamTypeImage;
    gewaehlt: boolean;
}>();
const emit = defineEmits<{ waehle: [] }>();

const bild = computed(() => typbildBild(props.eintrag, headerGraphicUrl));
const eingebaut = computed(() => headerGraphicUrl(props.eintrag.category));
const kaputt = ref<string | undefined>(undefined);

/** Die Quelle des gezeigten Bildes; „eingebaut“ fällt auf die Datei des Releases zurück. */
const quelle = computed(() => (bild.value.art === "eingebaut" ? eingebaut.value : bild.value.url));

/** Zweite Zeile: was gilt und was Besucher sehen. */
const unterzeile = computed(() => {
    const objekte =
        props.eintrag.count === null
            ? typbildObjekteName(props.eintrag.objects)
            : t("medien.typbild.zeile.objekte", {
                  art: typbildObjekteName(props.eintrag.objects),
                  n: zahl(props.eintrag.count),
              });
    const aktuell = regulaer.value;
    const stand =
        aktuell === null
            ? t("medien.typbild.zeile.eingebaut")
            : aktuell.public
              ? t("medien.typbild.zeile.oeffentlich")
              : t("medien.typbild.zeile.intern");
    return t("medien.typbild.zeile.unter", { objekte, stand });
});

const frueher = computed(() => {
    const zahlFrueher = props.eintrag.former + (props.eintrag.ohneKi?.former ?? 0);
    return zahlFrueher === 0 ? undefined : t("medien.typbild.zeile.frueher", { n: zahl(zahlFrueher) });
});

/** Was es von der Kategorie gibt (Paar, nur KI, nur ohne KI, keines). */
const paar = computed(() => paarStand(props.eintrag));
/** Der ★ steht, sobald eine Variante einen hat; gedämpft, solange Besucher keine davon sehen. */
const stern = computed(() => {
    const varianten = [props.eintrag.current, props.eintrag.ohneKi?.current ?? null].filter((v) => v !== null);
    return varianten.length === 0 ? undefined : { oeffentlich: varianten.some((v) => v.public) };
});
/** Die zweite Zeile spricht über das Bild des Normalmodus (KI-Variante, sonst Ohne-KI-Variante). */
const regulaer = computed(() => props.eintrag.current ?? props.eintrag.ohneKi?.current ?? null);
</script>

<template>
    <button
        type="button"
        class="typbild-zeile"
        :class="{ 'is-gewaehlt': gewaehlt }"
        :aria-current="gewaehlt ? 'true' : undefined"
        :data-kategorie="eintrag.category"
        :data-bild="bild.art"
        data-testid="medien-typbild-zeile"
        @click="emit('waehle')"
    >
        <span class="typbild-zeile__bild" :class="{ 'is-leer': kaputt === quelle }">
            <img
                v-if="kaputt !== quelle"
                :src="quelle"
                alt=""
                loading="lazy"
                decoding="async"
                @error="kaputt = quelle"
            />
        </span>
        <span class="typbild-zeile__text">
            <span class="typbild-zeile__l1">
                <span class="typbild-zeile__name einzeilig">{{ eintrag.label }}</span>
                <span
                    v-if="stern !== undefined"
                    class="typbild-zeile__stern"
                    :class="{ 'is-intern': !stern.oeffentlich }"
                    :title="t('medien.typbild.stern')"
                    :aria-label="t('medien.typbild.stern')"
                    data-testid="medien-typbild-stern"
                    >★</span
                >
                <span v-if="frueher !== undefined" class="typbild-zeile__frueher">{{ frueher }}</span>
            </span>
            <span class="typbild-zeile__l2 einzeilig" :class="{ 'is-offen': regulaer === null }">{{ unterzeile }}</span>
        </span>
        <span class="typbild-zeile__paar" :class="`is-${paar}`" :data-paar="paar" data-testid="medien-typbild-paar">
            <svg class="typbild-zeile__paar-zeichen" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <template v-if="paar === 'paar'">
                    <rect x="1.5" y="4.5" width="8" height="8" rx="1.5" />
                    <rect x="6.5" y="2.5" width="8" height="8" rx="1.5" />
                </template>
                <rect
                    v-else-if="paar === 'keines'"
                    x="3.5"
                    y="3.5"
                    width="9"
                    height="9"
                    rx="1.5"
                    stroke-dasharray="2 2"
                />
                <template v-else>
                    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
                    <rect x="8.5" y="1.5" width="6" height="6" rx="1.5" stroke-dasharray="1.5 1.5" />
                </template>
            </svg>
            <span class="typbild-zeile__paar-text einzeilig">{{ t(`medien.typbild.paar.${paar}`) }}</span>
        </span>
    </button>
</template>

<style scoped>
.typbild-zeile {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.typbild-zeile:hover {
    background: var(--color-hover-wash);
}

.typbild-zeile:active {
    background: var(--color-active-wash);
}

.typbild-zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.typbild-zeile.is-gewaehlt,
.typbild-zeile.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

/* Das Bild wie in jeder Liste: nie hochskaliert, ganz zu sehen, auf der weichen Fläche (Guide §12.6). */
.typbild-zeile__bild {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    width: var(--avm-fenster-daumen);
    height: var(--avm-fenster-daumen);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
}

.typbild-zeile__bild img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.typbild-zeile__bild.is-leer {
    border: 1px dashed var(--color-border-strong);
}

.typbild-zeile__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.typbild-zeile__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.typbild-zeile__name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

/* Der ★ in der Akzentfarbe; gilt das Asset, erscheint aber nicht öffentlich, ist er gedämpft (die Aussage ist schwächer). */
.typbild-zeile__stern {
    flex: none;
    color: var(--color-accent);
    font-size: var(--font-size-small);
}

.typbild-zeile__stern.is-intern {
    color: var(--color-text-muted);
}

.typbild-zeile__frueher {
    flex: none;
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.typbild-zeile__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Noch kein eigenes Typbild: ein Befund, kein Fehler - derselbe warme Ton wie offene Rechte in der Trefferliste. */
.typbild-zeile__l2.is-offen {
    color: var(--color-warning-soft-text);
}

/* Das Paar rechts (WI-0281): Zeichen und Wort; vollständig im Ton des Erfolgs, halb und keines im warmen Ton des Befunds. */
.typbild-zeile__paar {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    max-width: 40%;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.typbild-zeile__paar.is-paar {
    color: var(--color-success-soft-text);
}

.typbild-zeile__paar.is-nurKi,
.typbild-zeile__paar.is-nurOhneKi,
.typbild-zeile__paar.is-keines {
    color: var(--color-warning-soft-text);
}

.typbild-zeile__paar-zeichen {
    flex: none;
    width: var(--space-16);
    height: var(--space-16);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
}

.typbild-zeile__paar-text {
    min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
    .typbild-zeile {
        transition: none;
    }
}
</style>
