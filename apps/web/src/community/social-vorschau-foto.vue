<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import { fotoArt } from "./social-vorschau-modell";

/**
 * Das Bild einer Vorschau in der Form des Dienstes (WI-0270, Probierseite V15): 16:9 oder quadratisch (Instagram beschneidet quadratisch), mit oder ohne Rand.
 *
 * - Mit `url` das gewählte Bild (dieselbe Adresse, die das Beitragsfenster in der Bildwahl zeigt); die Bildbeschreibung ist sein `alt`.
 * - Ist ein Bild gewählt, aber keine Adresse da (ein gespeicherter Beitrag, dessen Bild in dieser Sitzung nicht neu gewählt wurde), steht eine Fläche in der Form des Bildes mit einem Satz.
 * - Ist kein Bild gewählt, steht nichts da, außer der Dienst verlangt eines (`ohne`: Instagram): dann die gestrichelte Fläche mit dem Satz.
 */
const props = defineProps<{
    form: "breit" | "quadrat";
    /** Ist ein Bild gewählt? */
    gewaehlt: boolean;
    url: string | null;
    alt: string;
    randlos?: boolean | undefined;
    /** Der Satz der gestrichelten Fläche, wenn der Dienst ohne Bild nicht geht. */
    ohne?: string | undefined;
}>();
const art = computed(() => fotoArt(props.gewaehlt, props.url, props.ohne !== undefined));
</script>

<template>
    <img
        v-if="art === 'bild'"
        class="vs-foto"
        :class="[`vs-foto--${form}`, { 'vs-foto--randlos': randlos }]"
        :src="url ?? undefined"
        :alt="alt"
        data-testid="social-vorschau-bild"
    />
    <div
        v-else-if="art === 'platz'"
        class="vs-foto vs-foto--platz"
        :class="[`vs-foto--${form}`, { 'vs-foto--randlos': randlos }]"
        role="img"
        :aria-label="alt === '' ? t('community.social.vorschau.bildOhneAnsicht') : alt"
        data-testid="social-vorschau-bild"
    >
        {{ t("community.social.vorschau.bildOhneAnsicht") }}
    </div>
    <div
        v-else-if="art === 'ohne'"
        class="vs-foto vs-foto--platz vs-foto--ohne"
        :class="`vs-foto--${form}`"
        data-testid="social-vorschau-ohne-bild"
    >
        {{ ohne }}
    </div>
</template>

<style scoped>
.vs-foto {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    border-radius: 8px;
    object-fit: cover;
}

.vs-foto--breit {
    aspect-ratio: 16 / 9;
}

.vs-foto--quadrat {
    aspect-ratio: 1 / 1;
    border-radius: 0;
}

.vs-foto--randlos {
    border-radius: 0;
}

.vs-foto--platz {
    display: grid;
    place-items: center;
    padding: 12px;
    background: var(--vs-linie);
    color: var(--vs-leise);
    font-size: 0.8125rem;
    text-align: center;
}

.vs-foto--ohne {
    border: 1px dashed var(--vs-leise);
    background: none;
}
</style>
