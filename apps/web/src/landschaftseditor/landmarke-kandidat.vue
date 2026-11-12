<script setup lang="ts">
import { computed, ref } from "vue";
import {
    editorLandmarkenKandidatUnterdrueckenUrl,
    formtGelaende,
    type EditorLandmarkenKandidat,
} from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { sende } from "../fenster/entwurf-senden";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { formatNumber, t } from "../i18n/i18n";
import { landmarkenartName } from "./landschaften-liste";

/**
 * Ein Landmarken-Kandidat aus dem WikiSync im Fenster der Derographie (WI-0271 L7, §4.2): ein Wiki-Artikel ohne Landmarke auf der Karte (◐). Gebaut aus den Teilen, die es schon gibt: der Kopf
 * wie am Gipfel (`gipfel-eigenschaften.vue`), der Satz und „● Auf der Karte setzen“ wie am Ort ohne Kartenpunkt (`ortseditor-eigenschaften.vue`), der Knopf „Nicht auf die Karte“ an der Stelle von
 * „Landmarke entfernen …“.
 *
 * - **„● Auf der Karte setzen“** startet das Setzen einer Landmarke (`landmarke-setzen.ts`) mit der Art und dem Namen des Artikels; gespeichert wird erst bei „Fertig“.
 * - **„✕ Nicht auf die Karte“** unterdrückt den Artikel (je Artikel; kein Lauf überschreibt es), **„↺ Wieder anbieten“** löst es. Beides sofort, mit Rücknahme in „Änderungen“.
 * - Nichts davon setzt eine Lage oder legt ohne Menschen etwas an.
 */

const props = defineProps<{
    kandidat: EditorLandmarkenKandidat;
    /** Schreibrecht (Verb „Bearbeiten“ der Derographie). */
    darf: boolean | undefined;
    kennung: string;
}>();

const emit = defineEmits<{
    /** „● Auf der Karte setzen“: das Setzen mit Art und Namen des Artikels starten. */
    setze: [kandidat: EditorLandmarkenKandidat];
    /** Geschrieben: Die Liste liest neu. */
    erneut: [];
}>();

const unterdrueckt = computed(() => props.kandidat.unterdrueckt === true);
const artName = computed(() => landmarkenartName(props.kandidat.art));
/** Die Wiki-Art in Klammern nur, wo sie anders heißt als die Art („Klamm“ bei Schlucht), nie „Höhle (Höhle)“. */
const wikiArtAnders = computed(() => props.kandidat.wikiArt !== undefined && props.kandidat.wikiArt !== artName.value);
const sendet = ref(false);
const satz = ref<string | undefined>(undefined);

async function schalte(): Promise<void> {
    sendet.value = true;
    satz.value = undefined;
    const antwort = await sende(
        editorLandmarkenKandidatUnterdrueckenUrl(props.kandidat.id),
        {
            operationId: globalThis.crypto.randomUUID(),
            baseRevision: props.kandidat.revision,
            unterdrueckt: !unterdrueckt.value,
        },
        "POST",
    );
    sendet.value = false;
    if (antwort.ok) emit("erneut");
    else satz.value = antwort.fehler.message;
}
</script>

<template>
    <div class="kandidat" :data-testid="`${kennung}-kandidat`">
        <div class="kandidat__kopf">
            <strong>{{ kandidat.name }}</strong>
            <small>{{ artName }} · {{ t("layer.topographie") }} · {{ t("editorListe.unter.nurWiki") }}</small>
        </div>
        <p
            v-if="unterdrueckt"
            class="kandidat__hinweis"
            role="status"
            :data-testid="`${kennung}-kandidat-unterdrueckt`"
        >
            {{ t("landschaftseditor.kandidat.unterdrueckt") }}
        </p>
        <template v-else>
            <p class="kandidat__hinweis">{{ t("ortseditor.nurWiki") }}</p>
            <div v-if="darf" class="kandidat__setzen">
                <AvmKnopf groesse="zeile" :testid="`${kennung}-kandidat-setzen`" @click="emit('setze', kandidat)">
                    {{ t("ortseditor.setzen") }}
                </AvmKnopf>
            </div>
        </template>
        <section class="kandidat__abschnitt">
            <h4 class="kandidat__titel">{{ t("landschaftseditor.abschnitt.identitaet") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("landschaftseditor.feld.name") }}</dt>
                <dd>{{ kandidat.name }}</dd>
                <dt>{{ t("landschaftseditor.landmarke.feld.art") }}</dt>
                <dd :data-testid="`${kennung}-kandidat-art`">
                    {{ artName }}<template v-if="wikiArtAnders"> ({{ kandidat.wikiArt }})</template>
                </dd>
                <template v-if="kandidat.region">
                    <dt>{{ t("admin.wikisync.feld.region") }}</dt>
                    <dd>{{ kandidat.region }}</dd>
                </template>
                <template v-if="formtGelaende(kandidat.art) && kandidat.height !== undefined">
                    <dt>{{ t("admin.wikisync.feld.height") }}</dt>
                    <dd>{{ t("scale.schritt", { n: formatNumber(kandidat.height, 0) }) }}</dd>
                </template>
                <dt>{{ t("admin.wikisync.feld.artikel") }}</dt>
                <dd>
                    <a
                        :href="kandidat.wikiUrl"
                        target="_blank"
                        rel="noopener"
                        :data-testid="`${kennung}-kandidat-wiki`"
                        >{{ kandidat.titel }}</a
                    >
                </dd>
            </FensterFeldzeilen>
            <p v-if="kandidat.kurzbeschreibung" class="kandidat__text">{{ kandidat.kurzbeschreibung }}</p>
        </section>
        <section v-if="darf" class="kandidat__abschnitt">
            <AvmKnopf
                groesse="zeile"
                :gesperrt="sendet ? t('landschaftseditor.entfernen.sendet') : undefined"
                :testid="`${kennung}-kandidat-unterdruecken`"
                @click="void schalte()"
            >
                {{
                    unterdrueckt
                        ? t("landschaftseditor.kandidat.anbieten")
                        : t("landschaftseditor.kandidat.unterdruecken")
                }}
            </AvmKnopf>
            <p v-if="satz" class="kandidat__fehler" role="alert">{{ satz }}</p>
        </section>
    </div>
</template>

<style scoped>
/* Wie das Fenster des Gipfels (`gipfel-eigenschaften.vue`). */
.kandidat {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.kandidat__kopf {
    display: grid;
    gap: var(--space-2);
}

.kandidat__kopf strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.kandidat__kopf small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kandidat__hinweis {
    margin: 0;
    color: var(--color-text-muted);
}

.kandidat__setzen {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.kandidat__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kandidat__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kandidat__text {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.kandidat__fehler {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-small);
}
</style>
