<script setup lang="ts">
import type { NewsImKorb } from "@avesmaps3d/shared";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { tagText } from "./pflege";

/**
 * Der Papierkorb der Neuigkeiten (WI-0217; Betreiber 2026-10-17, gewählt „Papierkorb“): unten unter der Liste, in der Klappbox des Hauses,
 * zugeklappt mit der Zahl. Je Eintrag Tag, Titel, wann und von wem gelöscht, und „Zurückholen“. 🔴 Gelöscht wird nie (WI-0139):
 * Zurückgeholt steht ein Eintrag wieder so da wie vorher.
 */
const props = defineProps<{
    eintraege: readonly NewsImKorb[];
    gesperrt: boolean;
}>();
const emit = defineEmits<{ zurueckholen: [id: number] }>();

const geloescht = (eintrag: NewsImKorb): string =>
    eintrag.geloeschtVon === null
        ? t("admin.news.trash.deletedAt", { tag: tagText(eintrag.geloeschtAt.slice(0, 10)) })
        : t("admin.news.trash.deleted", { tag: tagText(eintrag.geloeschtAt.slice(0, 10)), name: eintrag.geloeschtVon });
</script>

<template>
    <AvmDisclosure
        class="korb"
        :label="t('admin.news.trash.title')"
        :secondary="String(props.eintraege.length)"
        data-testid="news-papierkorb"
    >
        <ul class="korb__liste">
            <li
                v-for="eintrag in props.eintraege"
                :key="eintrag.id"
                class="korb__zeile"
                :data-testid="`news-korb-${String(eintrag.id)}`"
            >
                <span class="korb__datum">{{ tagText(eintrag.datum) }}</span>
                <span class="korb__titel">{{ eintrag.titel }}</span>
                <span class="korb__wann">{{ geloescht(eintrag) }}</span>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="props.gesperrt ? '' : undefined"
                    testid="news-zurueckholen"
                    @click="emit('zurueckholen', eintrag.id)"
                    >{{ t("admin.news.trash.restore") }}</AvmKnopf
                >
            </li>
        </ul>
        <p class="korb__satz">{{ t("admin.news.trash.lead") }}</p>
    </AvmDisclosure>
</template>

<style scoped>
.korb {
    margin-top: var(--space-16);
}

.korb__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.korb__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.korb__datum,
.korb__wann {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.korb__titel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
}

.korb__satz {
    margin: var(--space-6) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
