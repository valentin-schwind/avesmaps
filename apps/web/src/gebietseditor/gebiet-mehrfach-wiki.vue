<script setup lang="ts">
import type { EditorTerritoryDetailField } from "@avesmaps3d/shared";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import WikiFeld from "../fenster/wiki-feld.vue";
import { t } from "../i18n/i18n";
import { DETAIL_NAMEN } from "./gebiet-detailfelder";
import { sammelWikiLage, sammelWikiWert, type GebietSammel } from "./gebiet-sammel";

/**
 * Die Detailfelder eines Kastens für mehrere Herrschaftsgebiete (EDIT-0003 T57; `gebiet-mehrfach.vue`): je Feld EINE Zeile des
 * Wiki-Felds (`fenster/wiki-feld.vue`) mit dem Wert aller oder „gemischt“; ↺ setzt das Feld für alle auf den Wiki-Wert (`aufWiki`), an
 * den Gebieten mit eigenem Wert. Getippt wird hier nicht: Ein Text für viele Gebiete zugleich ist kein gemeinsamer Handgriff.
 */
const props = defineProps<{
    felder: readonly EditorTerritoryDetailField[];
    sammel: GebietSammel;
    kennung: string;
}>();

const werteVon = (feld: EditorTerritoryDetailField) =>
    (props.sammel.gelesen.value?.territories ?? []).map((g) => g.details[feld]);
const aufWiki = (feld: EditorTerritoryDetailField): boolean => props.sammel.stand.value.wiki.includes(feld);
/** Der Text aller; `undefined` heißt gemischt. */
function text(feld: EditorTerritoryDetailField): string | undefined {
    const u = sammelWikiWert(werteVon(feld), aufWiki(feld));
    return u.gleich ? u.wert || "–" : undefined;
}
</script>

<template>
    <div class="mehrfach-wiki">
        <WikiFeld
            v-for="feld in felder"
            :key="feld"
            :name="t(DETAIL_NAMEN[feld])"
            :lage="sammelWikiLage(werteVon(feld), aufWiki(feld))"
            :geaendert="aufWiki(feld)"
            :testid="`${kennung}-mehrfach-zeile-${feld}`"
            @zurueck="sammel.aufWiki(feld)"
        >
            <span v-if="text(feld) !== undefined" class="mehrfach-wiki__text">{{ text(feld) }}</span>
            <span v-else class="mehrfach-wiki__gemischt">{{ t("fenster.sammel.gemischt") }}</span>
            <SammelHinweis v-if="aufWiki(feld)" art="wiki" :n="sammel.ids.length" />
        </WikiFeld>
    </div>
</template>

<style scoped>
.mehrfach-wiki {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.mehrfach-wiki__text {
    overflow-wrap: anywhere;
}

.mehrfach-wiki__gemischt {
    color: var(--color-placeholder);
    font-style: italic;
}
</style>
