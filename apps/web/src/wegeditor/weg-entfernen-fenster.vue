<script setup lang="ts">
import { computed } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import { PATH_SAMMEL_MAX } from "@avesmaps3d/shared";
import {
    WEG_ENTFERNEN_GEHT,
    zuViele as zuVieleAbschnitte,
    type WegEntfernen,
    type WegEntfernenWahl,
} from "./weg-entfernen";
import { wegName } from "./wegeditor-texte";

/**
 * Das Blatt „Weg entfernen“ (WI-0177 Stufe 3; EDIT-0003 G10, T22 Fassung 4, F12, T43): dieselbe Form wie „Ort entfernen“
 * (`ortseditor/ort-entfernen-fenster.vue`), modal mittig über der Karte, mit den zwei Stufen aller Editoren: „Von der Karte nehmen“ und
 * „Ganz löschen“ (weich). Der Gefahrknopf nennt die Handlung. Was gilt, steht in `weg-entfernen.ts`.
 *
 * An der Mehrfachauswahl (WI-0252) ist es dasselbe Blatt für alle gewählten Wege: Die Zeile unter dem Titel nennt „n Wege gewählt“, der
 * Gefahrknopf die Handlung mit der Zahl („3 Wege ganz löschen“).
 */
const props = defineProps<{ entfernen: WegEntfernen }>();
const emit = defineEmits<{
    entfernt: [
        publicId: string,
        name: string,
        wahl: WegEntfernenWahl,
        mapRevision: number | undefined,
        /** Bei der Mehrfachauswahl die Zahl der Wege. */
        wege: number | undefined,
    ];
}>();

const WAHLEN: readonly WegEntfernenWahl[] = ["abnehmen", "loeschen"];
const TITEL: Record<WegEntfernenWahl, MessageKey> = {
    abnehmen: "wegeditor.entfernen.abnehmen",
    loeschen: "wegeditor.entfernen.loeschen",
};
const SATZ: Record<WegEntfernenWahl, MessageKey> = {
    abnehmen: "wegeditor.entfernen.abnehmen.satz",
    loeschen: "wegeditor.entfernen.loeschen.satz",
};

const stand = computed(() => props.entfernen.stand.value);
const offen = computed({
    get: () => stand.value !== undefined,
    set: (auf: boolean) => {
        if (!auf) props.entfernen.schliesse();
    },
});
const name = computed(() => {
    const jetzt = stand.value;
    // Die Mehrfachauswahl (WI-0252): die Zahl der Wege.
    if (jetzt?.auswahl !== undefined)
        return tPlural("wegeditor.mehrfach.gewaehlt", jetzt.auswahl.wege, { n: formatNumber(jetzt.auswahl.wege, 0) });
    if (jetzt?.weg === undefined) return undefined;
    // Die ganze Straße (T49): der Name mit der Zahl ihrer Abschnitte.
    return jetzt.strasse === undefined
        ? wegName(jetzt.weg)
        : t("wegeditor.entfernen.strasse", { name: wegName(jetzt.weg), n: String(jetzt.strasse.length) });
});
/** Die Mehrfachauswahl hat mehr Abschnitte, als EINE Operation nimmt: der Satz dazu, sonst nichts. */
const zuViele = computed(() => {
    const auswahl = stand.value?.auswahl;
    if (auswahl === undefined || !zuVieleAbschnitte(auswahl)) return undefined;
    return t("wegeditor.entfernen.auswahl.zuViele", {
        n: formatNumber(auswahl.abschnitte.length, 0),
        max: formatNumber(PATH_SAMMEL_MAX, 0),
    });
});
const knopfGrund = computed(() => {
    const jetzt = stand.value;
    if (jetzt === undefined || jetzt.phase === "laedt") return t("wegeditor.entfernen.laedt");
    if (jetzt.phase === "ladefehler") return t("wegeditor.entfernen.ladefehler");
    if (jetzt.phase === "laeuft") return t("wegeditor.entfernen.laeuft");
    if (zuViele.value !== undefined) return zuViele.value;
    return jetzt.wahl === undefined ? t("wegeditor.entfernen.wahl") : undefined;
});

/** Die Beschriftung des Gefahrknopfs: die Wahl, an der Mehrfachauswahl mit der Zahl der Wege. */
const losText = computed(() => {
    const jetzt = stand.value;
    if (jetzt?.wahl === undefined) return t("wegeditor.entfernen");
    if (jetzt.auswahl === undefined) return t(TITEL[jetzt.wahl]);
    const fall =
        jetzt.wahl === "loeschen" ? "wegeditor.entfernen.auswahl.loeschen" : "wegeditor.entfernen.auswahl.abnehmen";
    return tPlural(fall, jetzt.auswahl.wege, { n: formatNumber(jetzt.auswahl.wege, 0) });
});

async function los(): Promise<void> {
    const jetzt = stand.value;
    const gemeint = name.value ?? "";
    if (jetzt === undefined) return;
    const fertig = await props.entfernen.los();
    if (fertig !== undefined)
        emit("entfernt", jetzt.publicId, gemeint, fertig.wahl, fertig.quittung.mapRevision, fertig.wege);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="entscheiden"
        :titel="t('wegeditor.entfernen')"
        :zusatz="name"
        testid="weg-entfernen"
    >
        <p v-if="stand?.phase === 'laedt'" class="entfernen__leise" role="status">
            {{ t("wegeditor.entfernen.laedt") }}
        </p>
        <AvmHinweis
            v-else-if="stand?.phase === 'ladefehler'"
            ton="gefahr"
            rolle="alert"
            testid="weg-entfernen-ladefehler"
        >
            {{ t("wegeditor.entfernen.ladefehler") }}
        </AvmHinweis>
        <template v-else-if="stand">
            <div class="entfernen__wahlen" role="radiogroup" :aria-label="t('wegeditor.entfernen')">
                <AvmKaestchen
                    v-for="wahl in WAHLEN"
                    :key="wahl"
                    art="radio"
                    name="weg-entfernen"
                    mehrzeilig
                    class="entfernen__wahl"
                    :class="{ 'entfernen__wahl--gefahr': wahl === 'loeschen' }"
                    :checked="stand.wahl === wahl"
                    :gesperrt="WEG_ENTFERNEN_GEHT[wahl] ? undefined : t('editorPanel.spaeter.satz')"
                    :testid="`weg-entfernen-${wahl}`"
                    @change="entfernen.waehle(wahl)"
                >
                    <span class="entfernen__zeichen" aria-hidden="true"
                        ><EditorZeichen :name="wahl === 'loeschen' ? 'loeschen' : 'abnehmen'"
                    /></span>
                    <span class="entfernen__text">
                        <span class="entfernen__titel">{{ t(TITEL[wahl]) }}</span>
                        <span class="entfernen__satz">{{ t(SATZ[wahl]) }}</span>
                    </span>
                </AvmKaestchen>
            </div>
            <AvmHinweis v-if="zuViele" ton="gefahr" rolle="alert" testid="weg-entfernen-zuviele">{{
                zuViele
            }}</AvmHinweis>
            <AvmHinweis v-if="stand.satz" ton="gefahr" rolle="alert" testid="weg-entfernen-satz">{{
                stand.satz
            }}</AvmHinweis>
        </template>

        <template #fuss-haupt>
            <AvmKnopf testid="weg-entfernen-abbrechen" @click="offen = false">
                {{ t("wegeditor.entfernen.abbrechen") }}
            </AvmKnopf>
            <AvmKnopf art="gefahr" :gesperrt="knopfGrund" testid="weg-entfernen-los" @click="los">
                {{ losText }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
/* Wie „Ort entfernen“ (`ortseditor/ort-entfernen-fenster.vue`). */
.entfernen__wahlen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.entfernen__zeichen {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-top: calc((1lh - var(--icon-sm)) / 2);
    color: var(--color-text-muted);
}

.entfernen__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.entfernen__titel {
    color: var(--color-text-strong);
}

.entfernen__satz,
.entfernen__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.entfernen__wahl--gefahr:not(.kaestchen--gesperrt) .entfernen__titel,
.entfernen__wahl--gefahr:not(.kaestchen--gesperrt) .entfernen__zeichen {
    color: var(--color-danger);
}

.kaestchen--gesperrt .entfernen__titel {
    color: var(--color-text-muted);
}
</style>
