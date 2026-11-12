<script setup lang="ts">
/**
 * Die Wahl der Regionen einer Sonderrolle (WI-0279, E3b: Flächen der Ebene `derographisch`, mit Suche; eine Person kann mehrere betreuen).
 * Dieselbe Wahl steht im Reiter „Sonderrollen“ und beim Erzeugen einer Einladung. Bei „höchstens eine Person je Region“ steht eine belegte
 * Region mit Namen in der Liste und bleibt wählbar: Abgewiesen wird sie am Knopf des Formulars, mit dem Satz, der den Konflikt nennt.
 */
import { computed, ref } from "vue";
import type { RegionRef } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { t } from "../i18n/i18n";

const props = defineProps<{
    regionen: readonly RegionRef[];
    /** Was hinter einer Region steht: wer sie schon hat oder wie viele. */
    zusatz?: ReadonlyMap<string, string> | undefined;
    testid?: string | undefined;
}>();
const gewaehlt = defineModel<string[]>({ required: true });

const suche = ref("");
const treffer = computed(() => {
    const q = suche.value.trim().toLocaleLowerCase();
    return q === "" ? props.regionen : props.regionen.filter((region) => region.name.toLocaleLowerCase().includes(q));
});
const name = (id: string): string => props.regionen.find((region) => region.id === id)?.name ?? "";

function schalte(id: string, an: boolean): void {
    gewaehlt.value = an ? [...gewaehlt.value, id] : gewaehlt.value.filter((wert) => wert !== id);
}
</script>

<template>
    <div class="regionen" :data-testid="testid">
        <AvmEingabe
            v-model="suche"
            art="suche"
            :placeholder="t('admin.sonderrollen.regionSuchen')"
            :aria-label="t('admin.sonderrollen.regionSuchen')"
            autocomplete="off"
        />
        <div class="regionen__liste" role="group" :aria-label="t('admin.sonderrollen.regionen')">
            <p v-if="treffer.length === 0" class="regionen__leer">
                {{ t("admin.sonderrollen.regionKeine", { q: suche.trim() }) }}
            </p>
            <div v-for="region in treffer" :key="region.id" class="regionen__zeile">
                <AvmKaestchen
                    art="checkbox"
                    :checked="gewaehlt.includes(region.id)"
                    @change="schalte(region.id, $event)"
                    >{{ region.name }}</AvmKaestchen
                >
                <span v-if="zusatz?.get(region.id)" class="regionen__zusatz">{{ zusatz.get(region.id) }}</span>
            </div>
        </div>
        <div v-if="gewaehlt.length > 0" class="regionen__gewaehlt">
            <span v-for="id in gewaehlt" :key="id" class="regionen__chip">
                {{ name(id) }}
                <button
                    type="button"
                    class="regionen__weg"
                    :aria-label="t('admin.sonderrollen.regionEntfernen', { name: name(id) })"
                    @click="schalte(id, false)"
                >
                    ✕
                </button>
            </span>
        </div>
        <p v-else class="regionen__leer">{{ t("admin.sonderrollen.regionNoch") }}</p>
    </div>
</template>

<style scoped>
.regionen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.regionen__liste {
    display: flex;
    flex-direction: column;
    max-height: 168px;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    scrollbar-width: thin;
}

.regionen__zeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-2) var(--space-6);
}

.regionen__zeile:hover {
    background: var(--color-hover-wash);
}

.regionen__zusatz,
.regionen__leer {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.regionen__liste .regionen__leer {
    padding: var(--space-4) var(--space-6);
}

.regionen__gewaehlt {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
}

.regionen__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--color-panel-active);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.regionen__weg {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
}

.regionen__weg:hover {
    color: var(--color-text-strong);
}

.regionen__weg:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
