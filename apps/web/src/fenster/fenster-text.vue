<script setup lang="ts">
import { computed } from "vue";
import { zerlegeBloecke, zerlegeText } from "./fenster-text";
import FensterVerweis from "./fenster-verweis.vue";

/**
 * Fließtext im Fenster, mit `*kursiv*`, `**betont**` und `[Verweis](https://…)` aus der Sprachtafel
 * (Schreibweise in `fenster-text.ts`). Gebaut aus Knoten, nie aus HTML.
 *
 * - Betont heißt **Farbe**, nicht Gewicht (Guide §3): die Hausschrift hat keinen Fettschnitt.
 * - Ein Verweis ist `FensterVerweis`: goldbraun, mit ↗, einmal für alle (Guide §13.42).
 * - Ein Text ohne Zeilenumbruch ist ein Absatz wie bisher (`als`). Mit Zeilenumbrüchen wird er ein Stapel aus Absätzen
 *   und Aufzählungen (`- ` am Zeilenanfang, Leerzeile = neuer Absatz; WI-0076: weniger Textwand).
 */
const props = withDefaults(defineProps<{ text: string; als?: "p" | "span" }>(), { als: "p" });
const mehrteilig = computed(() => props.text.includes("\n"));
const teile = computed(() => zerlegeText(props.text));
const bloecke = computed(() => (mehrteilig.value ? zerlegeBloecke(props.text) : []));
</script>

<template>
    <div v-if="mehrteilig" class="fenster-text fenster-text--bloecke">
        <template v-for="(block, index) in bloecke" :key="index">
            <p v-if="block.art === 'absatz'" class="fenster-text__absatz">
                <template v-for="(teil, stelle) in block.teile" :key="stelle">
                    <em v-if="teil.art === 'kursiv'">{{ teil.text }}</em>
                    <strong v-else-if="teil.art === 'betont'">{{ teil.text }}</strong>
                    <FensterVerweis v-else-if="teil.art === 'verweis'" :ziel="teil.ziel">{{
                        teil.text
                    }}</FensterVerweis>
                    <template v-else>{{ teil.text }}</template>
                </template>
            </p>
            <ul v-else class="fenster-text__liste">
                <li v-for="(punkt, nummer) in block.punkte" :key="nummer">
                    <template v-for="(teil, stelle) in punkt" :key="stelle">
                        <em v-if="teil.art === 'kursiv'">{{ teil.text }}</em>
                        <strong v-else-if="teil.art === 'betont'">{{ teil.text }}</strong>
                        <FensterVerweis v-else-if="teil.art === 'verweis'" :ziel="teil.ziel">{{
                            teil.text
                        }}</FensterVerweis>
                        <template v-else>{{ teil.text }}</template>
                    </template>
                </li>
            </ul>
        </template>
    </div>
    <component :is="als" v-else class="fenster-text">
        <template v-for="(teil, index) in teile" :key="index">
            <em v-if="teil.art === 'kursiv'">{{ teil.text }}</em>
            <strong v-else-if="teil.art === 'betont'">{{ teil.text }}</strong>
            <FensterVerweis v-else-if="teil.art === 'verweis'" :ziel="teil.ziel">{{ teil.text }}</FensterVerweis>
            <template v-else>{{ teil.text }}</template>
        </template>
    </component>
</template>

<style scoped>
.fenster-text {
    margin: 0;
}

/* Absätze und Aufzählungen eines Texts: ein kleiner Stapel im halben Takt der Karte. */
.fenster-text--bloecke {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.fenster-text__absatz,
.fenster-text__liste {
    margin: 0;
}

.fenster-text__liste {
    padding-left: var(--space-16);
}

.fenster-text__liste li + li {
    margin-top: var(--space-2);
}

strong {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-bold);
}
</style>
