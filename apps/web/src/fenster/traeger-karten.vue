<script setup lang="ts">
import { ref } from "vue";
import type { CitymapEntry } from "@avesmaps3d/shared";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { kartenUnterzeile } from "../medien/medien-karten-modell";
import { oeffneMedien } from "../medien/medien-oeffnen";

/**
 * Der Reiter „Karten“ im Eigenschaftseditor eines Objekts (Ort, Gebiet, Fläche, Landmarke, Weg): alle Karten der Kartensammlung, die es abbilden. Ein Klick öffnet den Eintrag in der Medienverwaltung; bearbeitet wird
 * dort (Vali 2026-11-02: „ein klick öffnet den eintrag im MAM“), hier steht nichts zum Ändern. Die Daten holt `traeger-karten.ts`, denn von ihnen hängt ab, ob der Reiter überhaupt steht.
 */
defineProps<{ karten: readonly CitymapEntry[]; kennung: string }>();

/** Die Vorschauen, die nicht laden: Die Zeile steht dann ohne Bild da. */
const kaputt = ref<readonly string[]>([]);

const unterzeile = (karte: CitymapEntry): string =>
    // Der Katalog führt Art und Typen als Text, die Medienverwaltung als Tafelwerte; beide kommen aus derselben Zeile.
    kartenUnterzeile({
        art: karte.art ?? null,
        types: karte.types ?? [],
        validFromBf: karte.validFrom ?? null,
        validToBf: karte.validTo ?? null,
    } as Parameters<typeof kartenUnterzeile>[0]);
</script>

<template>
    <div class="traeger-karten" :data-testid="`${kennung}-karten`">
        <p class="traeger-karten__hinweis">{{ t("fenster.traegerKarten.hinweis") }}</p>
        <ul class="traeger-karten__liste">
            <li v-for="karte in karten" :key="karte.id">
                <button
                    type="button"
                    class="traeger-karte"
                    :title="t('fenster.traegerKarten.oeffnen', { titel: karte.title })"
                    :data-karte="karte.id"
                    :data-testid="`${kennung}-karte`"
                    @click="oeffneMedien({ karte: karte.id, kartenSuche: karte.title })"
                >
                    <span class="traeger-karte__bild">
                        <img
                            v-if="karte.preview !== undefined && !kaputt.includes(karte.id)"
                            :src="karte.preview.url"
                            alt=""
                            loading="lazy"
                            decoding="async"
                            @error="kaputt = [...kaputt, karte.id]"
                        />
                    </span>
                    <span class="traeger-karte__text">
                        <span class="traeger-karte__titel">{{ karte.title }}</span>
                        <span v-if="unterzeile(karte) !== ''" class="traeger-karte__leise">{{
                            unterzeile(karte)
                        }}</span>
                    </span>
                    <AvmPille v-if="karte.spoiler === true" ton="neutral">{{
                        t("infoPanel.citymaps.spoiler")
                    }}</AvmPille>
                </button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.traeger-karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.traeger-karten__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.traeger-karten__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.traeger-karte {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
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

.traeger-karte:hover {
    background: var(--color-hover-wash);
}

.traeger-karte:active {
    background: var(--color-active-wash);
}

.traeger-karte:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.traeger-karte__bild {
    flex: none;
    width: var(--avm-fenster-daumen);
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.traeger-karte__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.traeger-karte__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.traeger-karte__titel {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.traeger-karte__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .traeger-karte {
        transition: none;
    }
}
</style>
