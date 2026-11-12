<script setup lang="ts">
/**
 * Der Eintrag „Datenabgleich“ der Systemsteuerung mit den Unterreitern `WikiSync | Legacy` (WI-0253 §4 A, Mockup: „in `Datenabgleich` die Unterreiter
 * `Legacy | WikiSync`“; kein zweites Verwaltungsfenster). 🔴 WikiSync steht vorn und ist beim Öffnen gewählt (Vali 2026-10-27); Legacy ist der zweite Reiter. Einen gemerkten Reiter gibt es nicht: Der gewählte Reiter
 * lebt nur, solange der Eintrag eingehängt ist. Der Reiter „Legacy“ ist der bisherige Eintrag, unverändert (`auth/verwaltung-abgleiche.vue`, samt
 * „Abzug für lokal“); „WikiSync“ steht in `verwaltung-wikisync.vue`.
 *
 * Jeder Reiter hängt an seinem Recht: Legacy am Betrieb (`view_operations`, ab Admin), WikiSync an `view_wikisync` (ab Tester, Vali 2026-10-25: „Vorschau
 * und Berichte: alle“). Wer nur einen sieht, bekommt keine Reiterleiste. Der Inhalt eines Reiters wird erst eingehängt, wenn er gewählt ist; so lädt er
 * auch erst dann.
 */
import { computed, ref } from "vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { t } from "../i18n/i18n";
import type { Abgleiche } from "../auth/abgleiche";
import type { Abzug } from "../auth/abzug";
import { authState } from "../auth/session-state";
import VerwaltungAbgleiche from "../auth/verwaltung-abgleiche.vue";
import type { Wikisync } from "./wikisync";
import VerwaltungWikisync from "./verwaltung-wikisync.vue";

const props = defineProps<{
    abgleiche: Abgleiche;
    abzug: Abzug;
    wikisync: Wikisync;
    telefon: boolean;
}>();

type Reiter = "legacy" | "wikisync";

const rechte = authState.value.capabilities;
const reiter = computed(() => [
    ...(rechte.includes("view_wikisync")
        ? [{ id: "wikisync" as const, name: t("admin.wikisync.reiter.wikisync") }]
        : []),
    ...(rechte.includes("view_operations") ? [{ id: "legacy" as const, name: t("admin.wikisync.reiter.legacy") }] : []),
]);
const aktiv = ref<Reiter>(reiter.value[0]?.id ?? "legacy");
</script>

<template>
    <div class="datenabgleich">
        <FensterReiter
            v-if="reiter.length > 1"
            v-model="aktiv"
            :reiter="reiter"
            :beschriftung="t('admin.tab.abgleiche')"
            kennung="datenabgleich"
        />
        <div
            :id="`datenabgleich-inhalt-${aktiv}`"
            :role="reiter.length > 1 ? 'tabpanel' : undefined"
            :aria-labelledby="reiter.length > 1 ? `datenabgleich-reiter-${aktiv}` : undefined"
        >
            <VerwaltungAbgleiche
                v-if="aktiv === 'legacy'"
                :abgleiche="props.abgleiche"
                :abzug="props.abzug"
                :telefon="props.telefon"
            />
            <VerwaltungWikisync v-else :wikisync="props.wikisync" :telefon="props.telefon" />
        </div>
    </div>
</template>

<style scoped>
.datenabgleich {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}
</style>
