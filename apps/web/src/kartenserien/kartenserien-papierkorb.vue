<script setup lang="ts">
/**
 * Der Papierkorb des Reiters „Kartenserien“ (WI-0220 Schnitt 4; Vorlage Fassung 4, Betreiber 2026-10-18 abgenommen): je Serie, wann
 * sie hineinkam und wann ihre Kacheln und ihre Quelle endgültig weggeräumt werden, dazu „Wiederherstellen“. Nach der Frist steht
 * eine Serie nicht mehr hier; weggeräumt wird sie von der Pflege der Warteschlange (`apps/server/src/map-series/papierkorb.ts`).
 */
import { KARTENSERIE_PAPIERKORB_TAGE, type AdminKartenserien } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";

defineProps<{
    papierkorb: AdminKartenserien["papierkorb"];
    gesperrt: string | undefined;
    /** Nennt ein Satz der Seite den Grund schon, zeigen die Knöpfe darauf, statt ihn je Zeile zu wiederholen (`AvmKnopf` `grundBei`). */
    grundBei?: string | undefined;
}>();
const emit = defineEmits<{ wiederherstellen: [id: string] }>();

const datum = (iso: string): string => new Date(iso).toLocaleDateString();
</script>

<template>
    <FensterKarte
        v-if="papierkorb.length > 0"
        :titel="t('admin.kartenserien.papierkorb.titel')"
        data-testid="kartenserien-papierkorb"
    >
        <ul class="korb">
            <li v-for="p in papierkorb" :key="p.id" :data-testid="`kartenserien-korb-${p.id}`">
                <span
                    >{{ p.label }}
                    <span class="korb__leise"
                        >·
                        {{
                            t("admin.kartenserien.papierkorb.seit", { zeit: datum(p.seit), bis: datum(p.endgueltig) })
                        }}</span
                    ></span
                >
                <AvmKnopf
                    :gesperrt="gesperrt"
                    :grund-bei="grundBei"
                    :testid="`kartenserien-wiederherstellen-${p.id}`"
                    @click="emit('wiederherstellen', p.id)"
                >
                    <span aria-hidden="true">↺ </span>{{ t("admin.kartenserien.papierkorb.wiederherstellen") }}
                </AvmKnopf>
            </li>
        </ul>
        <span class="korb__leise">{{
            t("admin.kartenserien.papierkorb.satz", { tage: KARTENSERIE_PAPIERKORB_TAGE })
        }}</span>
    </FensterKarte>
</template>

<style scoped>
.korb {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.korb li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    align-items: center;
    justify-content: space-between;
}

.korb__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
