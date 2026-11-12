<script setup lang="ts">
import { computed } from "vue";
import type { EditorTerritoryDetail } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import MedienWappenKasten from "../medien/medien-wappen-kasten.vue";

/**
 * Der Reiter „Bilder“ des Gebietseditors (WI-0253; Betreiber 2026-10-26: „Wappen gehören zu einem Bilder-Tab“, wie bei Orten): das Wappen des Gebiets. Es ist DER Wappen-Kasten der Medienverwaltung
 * (`medien/medien-wappen-kasten.vue`), derselbe wie im Reiter „Bilder“ des Ortseditors: hinzufügen, ersetzen und entfernen („bewusst ohne“), sofort als Operation der Medienverwaltung, ohne die
 * Speicherleiste des Fensters. Ohne Medienrecht steht nur das veröffentlichte Bild da.
 */
const props = defineProps<{
    detail: EditorTerritoryDetail;
    kennung: string;
    /** Darf die Medienverwaltung öffnen? */
    medien?: boolean | undefined;
    /** Bindungen ändern: Das Fenster schreibt gerade (nicht nur lesend). */
    darfAendern: boolean;
}>();
const emit = defineEmits<{
    /** „Medienverwaltung › Wappen“: das Gebiet, gefiltert auf die Rolle. */
    medien: [];
    /** Der Kasten hat gebunden, ersetzt oder entfernt: Detail, Liste und Infopanel lesen neu. */
    wappen: [];
}>();

const satz = computed(() =>
    props.detail.coat !== undefined
        ? undefined
        : props.detail.hasCoat === true
          ? t("gebietseditor.wappen.unveroeffentlicht")
          : t("gebietseditor.wappen.keins"),
);
</script>

<template>
    <div class="gebiet-bilder" :data-testid="`${kennung}-bilder`">
        <MedienWappenKasten
            v-if="medien"
            :subjekt="{ kind: 'territory', id: detail.id, name: detail.name }"
            :kennung="kennung"
            :darf-aendern="darfAendern"
            verweis
            weg="gebietseditor"
            @medien="emit('medien')"
            @geaendert="emit('wappen')"
        />
        <section v-else class="gebiet-bilder__kasten" :data-testid="`${kennung}-bilder-wappen`">
            <h4 class="gebiet-bilder__titel">{{ t("ortseditor.bilder.wappen") }}</h4>
            <img
                v-if="detail.coat"
                class="gebiet-bilder__wappen"
                :src="detail.coat"
                :alt="t('gebietseditor.wappen.bild', { name: detail.name })"
            />
            <p v-else class="gebiet-bilder__leise">{{ satz }}</p>
        </section>
    </div>
</template>

<style scoped>
.gebiet-bilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.gebiet-bilder__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gebiet-bilder__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gebiet-bilder__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebiet-bilder__wappen {
    display: block;
    max-width: 64px;
    max-height: 64px;
    object-fit: contain;
}
</style>
