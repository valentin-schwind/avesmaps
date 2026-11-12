<script setup lang="ts">
import { KARTE_ORTE_MAX } from "@avesmaps3d/shared";
import KartenvorschlagOrtWahl from "../community/kartenvorschlag-ort-wahl.vue";
import type { OrtWahl } from "../community/kartenvorschlaege-modell";
import { t } from "../i18n/i18n";

/**
 * Die Orte und Regionen eines neuen Eintrags (WI-0287, Entwurf Fassung 5, Stufe 3: Fassung 6): gewählte als Marken mit ✕, darunter dieselbe Suche wie beim Annehmen eines Vorschlags
 * (`kartenvorschlag-ort-wahl.vue`, hier mit `regionen`; sie bleibt offen, weil ihre Wahl hier gleich zur Marke wird). Ohne Ort und ohne Region steht der Satz da, was das heißt: Die Karte
 * erscheint dann in keiner Infobox.
 */
const orte = defineModel<readonly OrtWahl[]>({ required: true });
defineProps<{ gesperrt: boolean }>();

function hinzu(ort: OrtWahl | null): void {
    if (ort === null || orte.value.some((eintrag) => eintrag.id === ort.id && eintrag.kind === ort.kind)) return;
    orte.value = [...orte.value, ort];
}
function weg(ort: OrtWahl): void {
    orte.value = orte.value.filter((eintrag) => eintrag !== ort);
}
</script>

<template>
    <div class="eintrag-orte" data-testid="medien-eintrag-orte">
        <span class="eintrag-orte__beschriftung">{{ t("medien.karten.eintrag.orte") }}</span>
        <div class="eintrag-orte__wert">
            <ul v-if="orte.length > 0" class="eintrag-orte__marken">
                <li
                    v-for="ort in orte"
                    :key="`${ort.kind ?? 'place'}:${ort.id}`"
                    class="eintrag-orte__marke"
                    data-testid="medien-eintrag-ort"
                >
                    {{ ort.name }}
                    <button
                        type="button"
                        :disabled="gesperrt"
                        :aria-label="t('medien.karten.eintrag.ortWeg', { name: ort.name })"
                        :title="t('medien.karten.eintrag.ortWeg', { name: ort.name })"
                        @click="weg(ort)"
                    >
                        ✕
                    </button>
                </li>
            </ul>
            <KartenvorschlagOrtWahl
                v-if="orte.length < KARTE_ORTE_MAX"
                :model-value="null"
                :gesperrt="gesperrt"
                regionen
                @update:model-value="hinzu"
            />
            <span v-if="orte.length === 0" class="eintrag-orte__klein" data-testid="medien-eintrag-ohne-ort">{{
                t("medien.karten.eintrag.ohneOrt")
            }}</span>
        </div>
    </div>
</template>

<style scoped>
.eintrag-orte {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-6) var(--space-8);
}

.eintrag-orte__beschriftung {
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--avm-control-h);
}

.eintrag-orte__wert {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.eintrag-orte__marken {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.eintrag-orte__marke {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 1px var(--space-2) 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-small);
}

.eintrag-orte__marke button {
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.eintrag-orte__marke button:hover:not(:disabled) {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.eintrag-orte__marke button:active:not(:disabled) {
    background: var(--color-active-wash);
}

.eintrag-orte__marke button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.eintrag-orte__marke button:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.eintrag-orte__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

@media (prefers-reduced-motion: reduce) {
    .eintrag-orte__marke button {
        transition: none;
    }
}
</style>
