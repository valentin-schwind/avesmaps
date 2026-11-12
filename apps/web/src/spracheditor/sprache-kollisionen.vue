<script setup lang="ts">
import { computed } from "vue";
import type { SpracheEditorDetail } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, locale, t } from "../i18n/i18n";

/**
 * Der Reiter „Kollisionen“ einer Sprache (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` `sfKollisionen`; O4): die Zahl der getroffenen Orte,
 * Herrschaftsgebiete, Regionen und Wege ab dem Mindestanteil und ihr Stand, „↻ Jetzt neu berechnen“, darunter die Sprachen, mit denen sie sich
 * überlappt (aus den Mischgebieten). Nur lesend und informativ; ein Klick auf eine überlappende Sprache öffnet sie im Fenster.
 */
const props = defineProps<{
    detail: SpracheEditorDetail;
    lesend: boolean;
    /** Läuft „↻ Jetzt neu berechnen“ gerade? */
    rechnet: boolean;
    kennung: string;
}>();
const emit = defineEmits<{ neuRechnen: []; sprache: [id: string] }>();

const zeilen = computed(() => [
    { art: "orte", name: t("sprache.treffer.place"), n: props.detail.treffer.orte },
    { art: "gebiete", name: t("sprache.treffer.territory"), n: props.detail.treffer.gebiete },
    { art: "regionen", name: t("sprache.treffer.region"), n: props.detail.treffer.regionen },
    { art: "wege", name: t("sprache.treffer.path"), n: props.detail.treffer.wege },
]);
const stand = computed(() => {
    const treffer = props.detail.treffer;
    if (treffer.ausstehend) return t("spracheditor.treffer.ausstehend");
    if (treffer.berechnetAt === null) return t("spracheditor.treffer.nie");
    const wann = new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(treffer.berechnetAt),
    );
    return t("spracheditor.treffer.berechnet", { wann });
});
const anteil = (wert: number): string =>
    wert < 0.01 ? t("spracheditor.treffer.unterEins") : `${formatNumber(Math.round(wert * 100), 0)} %`;
</script>

<template>
    <div class="kollisionen" :data-testid="`${kennung}-kollisionen`">
        <section class="kollisionen__kasten">
            <h4 class="kollisionen__titel">{{ t("spracheditor.kasten.treffer") }}</h4>
            <dl class="kollisionen__werte">
                <div v-for="zeile in zeilen" :key="zeile.art">
                    <dt>{{ zeile.name }}</dt>
                    <dd>{{ formatNumber(zeile.n, 0) }}</dd>
                </div>
            </dl>
            <p class="kollisionen__hinweis" :data-testid="`${kennung}-treffer-stand`">{{ stand }}</p>
            <p class="kollisionen__hinweis">{{ t("spracheditor.treffer.hinweis") }}</p>
            <AvmKnopf
                v-if="!lesend"
                groesse="zeile"
                :gesperrt="rechnet ? t('spracheditor.treffer.rechnet') : undefined"
                :testid="`${kennung}-neu-rechnen`"
                @click="emit('neuRechnen')"
            >
                {{ t("spracheditor.treffer.neu") }}
            </AvmKnopf>
        </section>

        <section class="kollisionen__kasten">
            <h4 class="kollisionen__titel">{{ t("spracheditor.kasten.ueberlappungen") }}</h4>
            <ul v-if="detail.ueberlappungen.length > 0" class="kollisionen__liste">
                <li v-for="ueber in detail.ueberlappungen" :key="ueber.id">
                    <button
                        type="button"
                        class="kollisionen__zeile"
                        :title="t('spracheditor.ueberlappung.titel')"
                        :data-testid="`${kennung}-ueberlappung`"
                        @click="emit('sprache', ueber.id)"
                    >
                        <span class="kollisionen__punkt" :style="{ '--farbe': ueber.farbe }" aria-hidden="true"></span>
                        <span class="kollisionen__name">{{ ueber.name }}</span>
                        <span class="kollisionen__zahl">{{
                            t("spracheditor.ueberlappung.zahl", {
                                anteil: anteil(ueber.anteil),
                                flaeche: formatNumber(Math.round(ueber.flaeche), 0),
                            })
                        }}</span>
                    </button>
                </li>
            </ul>
            <p v-else class="kollisionen__hinweis">{{ t("spracheditor.ueberlappung.keine") }}</p>
            <p class="kollisionen__hinweis">{{ t("spracheditor.ueberlappung.hinweis") }}</p>
        </section>
    </div>
</template>

<style scoped>
.kollisionen {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.kollisionen__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kollisionen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kollisionen__werte {
    display: grid;
    gap: var(--space-2);
    margin: 0;
}

.kollisionen__werte > div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-6);
}

.kollisionen__werte dt {
    color: var(--color-text-muted);
}

.kollisionen__werte dd {
    margin: 0;
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}

.kollisionen__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kollisionen__liste {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.kollisionen__zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    padding: var(--space-2) var(--space-6);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.kollisionen__zeile:hover {
    background: var(--color-hover-wash);
}

.kollisionen__zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.kollisionen__punkt {
    width: var(--space-8);
    height: var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--farbe);
}

.kollisionen__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
    .kollisionen__zeile {
        transition: none;
    }
}
</style>
