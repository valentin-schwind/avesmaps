<script setup lang="ts">
import { computed } from "vue";
import type { MediaUsageResult, MediaUsageSubject } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import { t } from "../i18n/i18n";
import type { DuplikatKonflikt, DuplikatLage } from "./medien-duplikat-modell";
import MedienEintrag from "./medien-eintrag.vue";
import { rolleName, zahl } from "./medien-text";
import MedienVerwendungen from "./medien-verwendungen.vue";
import type { HochladeRolle } from "./medien-formular-modell";

/**
 * „Dieses Bild gibt es bereits!“ (Betreiber 2026-10-17, WI-0068): Die gewählte Datei trägt genau die Bytes eines vorhandenen Werks.
 * Statt eines zweiten Uploads steht das vorhandene da: Vorschau, Name, Rechte und Verwendungen; den Knopf „Vorhandenes Bild
 * verwenden“ trägt das Fenster (`medien-hochladen-fenster.vue`).
 *
 * - **Mehrere Treffer** (Bestand aus Legacy): alle in der Liste, das kanonische vorgewählt; weichen ihre Rechte ab, sagt es der Satz,
 *   und die Wahl ist bewusst.
 * - **Verwendungen als Verweise** auf die Objekte, auch über eine Galerie (Editor-Orchestrierung 2026-10-17), nie nur eine Zahl.
 */
const props = defineProps<{
    lage: DuplikatLage;
    rolle: HochladeRolle;
    konflikte: readonly DuplikatKonflikt[];
    /** Die Verwendungen des gewählten Werks; `undefined`, solange sie laden. */
    verwendung: MediaUsageResult | undefined;
}>();
const gewaehlt = defineModel<string>("gewaehlt", { required: true });
const emit = defineEmits<{ von: [subjekt: MediaUsageSubject]; asset: [id: string] }>();

const mehrere = computed(() => props.lage.treffer.length > 1);
</script>

<template>
    <section class="duplikat" data-testid="medien-duplikat">
        <AvmHinweis ton="warnung" rolle="status" testid="medien-duplikat-hinweis">
            <strong class="duplikat__titel">{{ t("medien.duplikat.titel") }}</strong>
            {{ t("medien.duplikat.satz") }}
        </AvmHinweis>
        <p v-if="mehrere" class="duplikat__satz" data-testid="medien-duplikat-mehrere">
            {{ t("medien.duplikat.mehrere", { n: zahl(lage.treffer.length) }) }}
        </p>
        <ul class="duplikat__treffer">
            <li v-for="treffer in lage.treffer" :key="treffer.id">
                <MedienEintrag
                    :eintrag="treffer"
                    ansicht="liste"
                    :gewaehlt="treffer.id === gewaehlt"
                    @waehle="gewaehlt = treffer.id"
                />
            </li>
        </ul>
        <AvmHinweis v-if="konflikte.includes('rechte')" ton="warnung" testid="medien-duplikat-rechte">{{
            t("medien.duplikat.rechte")
        }}</AvmHinweis>
        <AvmHinweis v-if="konflikte.includes('typ')" ton="warnung" testid="medien-duplikat-typ">{{
            t("medien.duplikat.typ", { rolle: rolleName(rolle) })
        }}</AvmHinweis>
        <AvmHinweis v-if="konflikte.includes('notaus')" ton="warnung" testid="medien-duplikat-notaus">{{
            t("medien.duplikat.notaus")
        }}</AvmHinweis>
        <div class="duplikat__verwendungen">
            <h5 class="duplikat__kopf">{{ t("medien.duplikat.verwendungen") }}</h5>
            <MedienVerwendungen
                v-if="verwendung"
                :verwendung="verwendung"
                nur-verweise
                @von="(subjekt: MediaUsageSubject) => emit('von', subjekt)"
                @waehle-asset="(id: string) => emit('asset', id)"
                @typbild="() => emit('asset', gewaehlt)"
            />
            <p v-else class="duplikat__satz">{{ t("medien.duplikat.laedt") }}</p>
        </div>
    </section>
</template>

<style scoped>
.duplikat {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.duplikat__titel {
    color: var(--color-text-strong);
}

.duplikat__satz {
    margin: 0;
    font-size: var(--font-size-small);
}

.duplikat__treffer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.duplikat__kopf {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-small);
    color: var(--color-text-strong);
}
</style>
