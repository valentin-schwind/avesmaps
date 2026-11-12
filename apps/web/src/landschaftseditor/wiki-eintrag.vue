<script setup lang="ts">
import type { EditorWikiEintrag } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { t } from "../i18n/i18n";

/**
 * Ein Wiki-Eintrag ohne Fläche im Fenster der Derographie (WI-0284): Er hat kein Detail, das Fenster zeigt den Artikel und „● Fläche zeichnen“. Gebaut wie der Landmarken-Kandidat (`landmarke-kandidat.vue`).
 * Gespeichert wird erst beim Abschluss der Zeichnung; sie hängt den Artikel an die neue Fläche. Gibt es die Fläche schon, weist der Editor ihr den Artikel in ihrer Wiki-Box zu; die Zeile verschwindet dann von selbst.
 */

defineProps<{
    eintrag: EditorWikiEintrag;
    /** Schreibrecht (Verb „Bearbeiten“ der Derographie). */
    darf: boolean | undefined;
    kennung: string;
}>();

const emit = defineEmits<{
    /** „● Fläche zeichnen“: die Zeichnung für diesen Eintrag starten. */
    zeichne: [eintrag: EditorWikiEintrag];
}>();
</script>

<template>
    <div class="wiki-eintrag" :data-testid="`${kennung}-wiki-eintrag`">
        <div class="wiki-eintrag__kopf">
            <strong>{{ eintrag.name }}</strong>
            <small>{{ eintrag.art ? `${eintrag.art} · ` : "" }}{{ t("editorListe.unter.nurWiki") }}</small>
        </div>
        <p class="wiki-eintrag__hinweis">{{ t("landschaftseditor.wikiEintrag.hinweis") }}</p>
        <div v-if="darf" class="wiki-eintrag__zeichnen">
            <AvmKnopf groesse="zeile" :testid="`${kennung}-wiki-eintrag-zeichnen`" @click="emit('zeichne', eintrag)">
                {{ t("landschaftseditor.wikiEintrag.zeichnen") }}
            </AvmKnopf>
        </div>
        <section class="wiki-eintrag__abschnitt">
            <h4 class="wiki-eintrag__titel">{{ t("landschaftseditor.abschnitt.identitaet") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("landschaftseditor.feld.name") }}</dt>
                <dd>{{ eintrag.name }}</dd>
                <template v-if="eintrag.art">
                    <dt>{{ t("admin.wikisync.feld.art") }}</dt>
                    <dd>{{ eintrag.art }}</dd>
                </template>
                <template v-if="eintrag.region">
                    <dt>{{ t("admin.wikisync.feld.region") }}</dt>
                    <dd>{{ eintrag.region }}</dd>
                </template>
                <dt>{{ t("admin.wikisync.feld.artikel") }}</dt>
                <dd>
                    <a
                        :href="eintrag.wikiUrl"
                        target="_blank"
                        rel="noopener"
                        :data-testid="`${kennung}-wiki-eintrag-wiki`"
                        >{{ eintrag.titel }}</a
                    >
                </dd>
            </FensterFeldzeilen>
            <p v-if="eintrag.kurzbeschreibung" class="wiki-eintrag__text">{{ eintrag.kurzbeschreibung }}</p>
        </section>
    </div>
</template>

<style scoped>
/* Wie der Landmarken-Kandidat (`landmarke-kandidat.vue`). */
.wiki-eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.wiki-eintrag__kopf {
    display: grid;
    gap: var(--space-2);
}

.wiki-eintrag__kopf strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.wiki-eintrag__kopf small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wiki-eintrag__hinweis {
    margin: 0;
    color: var(--color-text-muted);
}

.wiki-eintrag__zeichnen {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.wiki-eintrag__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wiki-eintrag__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-body);
}

.wiki-eintrag__text {
    margin: 0;
    color: var(--color-text);
}
</style>
