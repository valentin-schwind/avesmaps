<script setup lang="ts">
import { computed } from "vue";
import { LEGAL_NOTICES } from "@avesmaps3d/shared";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { istVerweisZiel } from "../fenster/fenster-text";
import { hinweisAdresse } from "./hinweis-adresse";
import { zerlegeInline, type InlineKnoten } from "./hinweise-inline";

/**
 * Ein Text der Hinweise mit seiner Auszeichnung (Schreibweise: `hinweise-inline.ts`), gebaut aus Knoten, nie aus HTML.
 *
 * - Ein Verweis nach draußen ist `FensterVerweis` (Guide §13.42), mit ↗ aus der Hausregel.
 * - `mailto:` bleibt ein Verweis nach innen: goldbraun und unterstrichen, ohne ↗.
 * - Ein Sprung im Fenster trägt die Adresse der Stelle: Ein Klick springt (das Fenster fängt ihn ab, `data-hinweis-sprung`), Strg+Klick und „Link kopieren“ tun, was sie versprechen. 🔴 Nie `#kennung`: Der Hash gehört der Kamera.
 * - 🔴 Die Mailadresse steht nicht ausgeschrieben im Bündel (`Imprint` in `legal-notices.ts`): Der Text trägt `{mail}`, erst hier kommt sie hinein.
 */
const props = defineProps<{ text?: string | undefined; knoten?: readonly InlineKnoten[] | undefined }>();

const MAIL = `${LEGAL_NOTICES.imprint.mailUser}@${LEGAL_NOTICES.imprint.mailDomain}`;

const teile = computed<readonly InlineKnoten[]>(
    () => props.knoten ?? zerlegeInline((props.text ?? "").replaceAll("{mail}", MAIL)),
);

function sprungKennung(ziel: string): string | undefined {
    return ziel.startsWith("#") ? ziel.slice(1) : undefined;
}

const adresse = (kennung: string): string => hinweisAdresse(globalThis.location?.origin ?? "", kennung);
</script>

<template>
    <template v-for="(teil, nr) in teile" :key="nr">
        <template v-if="teil.art === 'text'">{{ teil.text }}</template>
        <span v-else-if="teil.art === 'hell'" class="hinweis-hell"><HinweiseText :knoten="teil.kinder" /></span>
        <FensterVerweis v-else-if="istVerweisZiel(teil.ziel)" :ziel="teil.ziel"
            ><HinweiseText :knoten="teil.kinder"
        /></FensterVerweis>
        <a v-else-if="sprungKennung(teil.ziel) === undefined" class="hinweis-link" :href="teil.ziel"
            ><HinweiseText :knoten="teil.kinder"
        /></a>
        <a
            v-else
            class="hinweis-link"
            :href="adresse(sprungKennung(teil.ziel) ?? '')"
            :data-hinweis-sprung="sprungKennung(teil.ziel)"
            ><HinweiseText :knoten="teil.kinder"
        /></a>
    </template>
</template>

<style scoped>
/* Hervorhebung über den Textton, nie über Gewicht: Die Hausschrift hat nur den Regular-Schnitt (Guide §3). */
.hinweis-hell {
    color: var(--color-text-strong);
}

/* Die Zustände wie `FensterVerweis` (Guide §13.42, §30.5), ohne ↗: Dieser Verweis verlässt die Seite nicht. */
.hinweis-link {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.hinweis-link:hover,
.hinweis-link:active {
    color: var(--color-link-hover);
}

.hinweis-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .hinweis-link {
        transition: none;
    }
}
</style>
