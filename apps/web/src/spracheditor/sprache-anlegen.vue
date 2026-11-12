<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SpracheEditorArtikelZeile } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { t } from "../i18n/i18n";
import SpracheFarbwahl from "./sprache-farbwahl.vue";
import { farbeGueltig, farbeNormal, NEUE_FARBE, wikiArtikelUrl } from "./sprache-felder";

/**
 * Was rechts im Spracheditor steht, wenn keine Sprache gewählt ist, sondern (WI-0261 S5d2):
 *
 * - **„✚ Neue Sprache“** (Bauvorlage `neueSprache`): Name und Farbe, dann „✚ Anlegen“; die neue Sprache öffnet sich im Fenster, ohne Fläche
 *   („○ nicht platziert, ohne Wiki-Artikel“). Wiki-Artikel und Teilflächen kommen danach in ihren Reitern.
 * - **ein freier Wiki-Artikel** („◐ nur im Wiki, nicht platziert“, O1): „✚ Als neue Sprache anlegen“ (Name aus dem Artikel, er wird ihre
 *   erste Pille) oder „⇄ Einer Sprache zuordnen“ (die Sprache öffnet sich, der Artikel steht als neue Pille im Entwurf; „Fertig“ schreibt).
 */
const props = defineProps<{
    art: "neu" | "artikel";
    artikel?: SpracheEditorArtikelZeile | undefined;
    /** Die aktiven Sprachen, denen der Artikel zugeordnet werden kann. */
    sprachen: readonly { readonly id: string; readonly name: string }[];
    lesend: boolean;
    /** Ein Anlegen läuft. */
    laeuft: boolean;
    kennung: string;
}>();
const emit = defineEmits<{
    anlegen: [name: string, farbe: string, wiki: readonly string[]];
    zuordnen: [sprache: string, artikel: string];
    abbrechen: [];
}>();

const name = ref("");
const farbe = ref(NEUE_FARBE);
const ziel = ref("");
watch(
    () => props.artikel?.id,
    () => {
        ziel.value = "";
    },
);
const anlegenGrund = computed(() => {
    if (props.laeuft) return t("spracheditor.anlegen.laeuft");
    if (name.value.trim() === "") return t("spracheditor.grund.name");
    if (!farbeGueltig(farbe.value)) return t("spracheditor.grund.farbe");
    return undefined;
});
const zielOptionen = computed(() => [
    { wert: "", text: t("spracheditor.artikel.waehlen"), gesperrt: true },
    ...props.sprachen.map((sprache) => ({ wert: sprache.id, text: sprache.name })),
]);
const artikelName = computed(() => props.artikel?.name ?? props.artikel?.titel ?? "");
</script>

<template>
    <div class="anlegen" :data-testid="`${kennung}-anlegen-${art}`">
        <template v-if="art === 'neu'">
            <section class="anlegen__kasten">
                <h4 class="anlegen__titel">{{ t("spracheditor.anlegen.titel") }}</h4>
                <FensterFeldzeile :name="t('spracheditor.feld.name')" :fuer="`${kennung}-neu-name`">
                    <AvmEingabe
                        :id="`${kennung}-neu-name`"
                        v-model="name"
                        :placeholder="t('spracheditor.feld.namePlatzhalter')"
                        :testid="`${kennung}-neu-name`"
                    />
                </FensterFeldzeile>
                <SpracheFarbwahl
                    :farbe="farbe"
                    :gespeichert="NEUE_FARBE"
                    :start="undefined"
                    :lesend="false"
                    :kennung="`${kennung}-neu`"
                    @setze="(wert: string) => (farbe = wert)"
                />
                <p class="anlegen__hinweis">{{ t("spracheditor.anlegen.hinweis") }}</p>
                <div class="anlegen__knoepfe">
                    <AvmKnopf
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="anlegenGrund"
                        :testid="`${kennung}-neu-anlegen`"
                        @click="emit('anlegen', name.trim(), farbeNormal(farbe), [])"
                    >
                        {{ t("spracheditor.anlegen.knopf") }}
                    </AvmKnopf>
                    <AvmKnopf groesse="zeile" @click="emit('abbrechen')">{{
                        t("spracheditor.anlegen.abbrechen")
                    }}</AvmKnopf>
                </div>
            </section>
        </template>
        <template v-else-if="artikel">
            <section class="anlegen__kasten">
                <h4 class="anlegen__titel">{{ t("spracheditor.artikel.titel") }}</h4>
                <p class="anlegen__name">
                    <a :href="wikiArtikelUrl(artikel.titel)" target="_blank" rel="noopener">{{ artikel.titel }}</a>
                </p>
                <p v-if="artikel.sprachfamilie" class="anlegen__hinweis">{{ artikel.sprachfamilie }}</p>
                <p v-if="artikel.kurzbeschreibung" class="anlegen__text">{{ artikel.kurzbeschreibung }}</p>
                <p class="anlegen__hinweis">{{ t("spracheditor.artikel.frei") }}</p>
            </section>
            <section v-if="!lesend" class="anlegen__kasten">
                <h4 class="anlegen__titel">{{ t("spracheditor.artikel.zuordnen") }}</h4>
                <FensterFeldzeile :name="t('spracheditor.artikel.sprache')" :fuer="`${kennung}-ziel`">
                    <AvmAuswahl
                        :id="`${kennung}-ziel`"
                        v-model="ziel"
                        :optionen="zielOptionen"
                        :testid="`${kennung}-ziel`"
                    />
                </FensterFeldzeile>
                <div class="anlegen__knoepfe">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="ziel === '' ? t('spracheditor.artikel.erstWaehlen') : undefined"
                        :testid="`${kennung}-zuordnen`"
                        @click="emit('zuordnen', ziel, artikel.id)"
                    >
                        {{ t("spracheditor.artikel.zuordnenKnopf") }}
                    </AvmKnopf>
                </div>
                <p class="anlegen__hinweis">{{ t("spracheditor.artikel.zuordnenHinweis") }}</p>
            </section>
            <section v-if="!lesend" class="anlegen__kasten">
                <h4 class="anlegen__titel">{{ t("spracheditor.artikel.neu") }}</h4>
                <p class="anlegen__hinweis">{{ t("spracheditor.artikel.neuHinweis", { name: artikelName }) }}</p>
                <div class="anlegen__knoepfe">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="laeuft ? t('spracheditor.anlegen.laeuft') : undefined"
                        :testid="`${kennung}-als-neue`"
                        @click="emit('anlegen', artikelName, NEUE_FARBE, [artikel.id])"
                    >
                        {{ t("spracheditor.artikel.neuKnopf") }}
                    </AvmKnopf>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.anlegen {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.anlegen__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.anlegen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.anlegen__name {
    margin: 0;
    font-size: var(--font-size-subhead);
}

.anlegen__name a {
    color: var(--color-link);
}

.anlegen__text {
    margin: 0;
    color: var(--color-text-strong);
}

.anlegen__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.anlegen__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
</style>
