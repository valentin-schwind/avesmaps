<script setup lang="ts">
import { computed } from "vue";
import type { HinweisBlock } from "@avesmaps3d/shared";
import HinweiseBlock from "./hinweise-block.vue";
import { gliedereBloecke } from "./hinweise-dokument";

/**
 * Der Inhalt eines Abschnitts der Hinweise: eine Lesespalte aus Blöcken (`LEGAL_NOTICES.hinweise`, abgenommenes Mockup vom 2026-11-04). Stufen über Größe, Farbe und Abstand, Struktur über feine Linien.
 * Einen Block zeichnet `hinweise-block.vue`; hier stehen die Spalte und was unter einer Unterüberschrift zusammengehört.
 */
const props = defineProps<{ bloecke: readonly HinweisBlock[] }>();
const glieder = computed(() => gliedereBloecke(props.bloecke));
</script>

<template>
    <div class="satz">
        <template v-for="(glied, nr) in glieder" :key="nr">
            <section v-if="glied.art === 'gruppe'" class="satz-block">
                <HinweiseBlock :block="glied.kopf" />
                <div class="satz-block__rumpf">
                    <HinweiseBlock v-for="(block, stelle) in glied.rumpf" :key="stelle" :block="block" />
                </div>
            </section>
            <HinweiseBlock v-else :block="glied.block" />
        </template>
    </div>
</template>

<style scoped>
/* Der Fließton liegt zwischen Text und gedämpft; `**…**` hebt sich davon im starken Ton ab. */
.satz {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    color: color-mix(in srgb, var(--color-text) 60%, var(--color-text-muted));
    font-size: var(--font-size-hinweise-text);
    font-synthesis: none;
    line-height: var(--leading-hinweise-text);
    text-align: left;
    hyphens: auto;
}

.satz :deep(.fenster-verweis) {
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
}

/* Was unter einer Unterüberschrift steht, gehört zu ihr: enger als der Takt der Spalte. */
.satz-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-6);
}

.satz-h3 + .satz-block {
    margin-top: var(--space-2);
}

.satz-block__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}
</style>
