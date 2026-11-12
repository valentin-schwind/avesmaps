<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { NEWS_RUBRIKEN, NEWS_TEXT_MAX, NEWS_TITEL_MAX } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { Phrase } from "../auth/formular";
import { formatList, t } from "../i18n/i18n";
import { rubrikName } from "./news";
import type { EditorFelder } from "./pflege";

/**
 * Der Editor einer Neuigkeit, an Ort und Stelle in der Liste (WI-0217): derselbe für Neu und Bearbeiten, mit Datum, Rubrik, Titel und
 * Text. Neu bietet „Veröffentlichen“ (von Hand Geschriebenes ist sofort sichtbar, WI-0139) und „Als Entwurf“.
 *
 * Unter dem Datum steht, ob der Eintrag an dieser Stelle bleibt; den Satz rechnet der Aufrufer (`platzHinweis` in `pflege.ts`), weil nur
 * er die Nachbarn kennt.
 */
const props = defineProps<{
    art: "neu" | "bearbeiten";
    /** Wo eingefügt wird („ganz oben“, „unter …“); beim Bearbeiten leer. */
    ort?: string | undefined;
    vorlage: EditorFelder;
    /** Der Satz zum Datum: bleibt der Eintrag hier, oder rückt er? */
    platz: (datum: string) => { satz: Phrase | null; bleibt: boolean };
    beschaeftigt: boolean;
}>();
const emit = defineEmits<{
    speichern: [felder: EditorFelder, zustand: "sichtbar" | "entwurf"];
    abbrechen: [];
}>();

const datum = ref(props.vorlage.datum);
const rubrik = ref<string>(props.vorlage.rubrik);
const titel = ref(props.vorlage.titel);
const text = ref(props.vorlage.text);

const rubriken = computed(() => NEWS_RUBRIKEN.map((wert) => ({ value: wert, label: rubrikName(wert) ?? wert })));
const hinweis = computed(() => props.platz(datum.value));
/** Die Felder, die noch leer sind; ein unvollständiges Datum liefert das Eingabefeld leer. */
const fehlt = computed(() => [
    ...(/^\d{4}-\d{2}-\d{2}$/u.test(datum.value) ? [] : [t("admin.news.field.date")]),
    ...(titel.value.trim() === "" ? [t("admin.news.field.title")] : []),
    ...(text.value.trim() === "" ? [t("admin.news.field.text")] : []),
]);
const vollstaendig = computed(() => fehlt.value.length === 0);
/**
 * Warum Speichern nicht geht (Guide §7: ein gesperrter Knopf nennt seinen Grund). Fehlt etwas, steht der Satz EINMAL unter den Knöpfen und
 * beide Speicherknöpfe zeigen darauf (`grundBei`); während eines Speicherns sind sie kurz ohne Satz gesperrt, wie überall im Haus.
 */
const grundId = useId();
const grund = computed(() =>
    fehlt.value.length > 0 ? t("admin.news.editor.missing", { felder: formatList(fehlt.value) }) : undefined,
);
const sperre = computed(() => grund.value ?? (props.beschaeftigt ? "" : undefined));
const kopf = computed(() => t(props.art === "neu" ? "admin.news.editor.new" : "admin.news.editor.edit"));

function speichern(zustand: "sichtbar" | "entwurf"): void {
    if (!vollstaendig.value) return;
    emit(
        "speichern",
        {
            datum: datum.value,
            rubrik: rubrik.value as EditorFelder["rubrik"],
            titel: titel.value.trim(),
            text: text.value.trim(),
        },
        zustand,
    );
}
</script>

<template>
    <li class="editor" data-testid="news-editor" role="group" :aria-label="kopf">
        <div class="editor__kopf">
            <span class="editor__titel">{{ kopf }}</span>
            <span v-if="props.ort" class="editor__ort">{{ props.ort }}</span>
        </div>

        <div class="editor__felder" :class="{ 'is-telefon': phoneViewport }">
            <label class="feld">
                <span class="feld__name">{{ t("admin.news.field.date") }}</span>
                <AvmEingabe v-model="datum" art="datum" required testid="news-editor-datum" />
            </label>
            <div class="feld">
                <span class="feld__name">{{ t("admin.news.field.rubrik") }}</span>
                <AvmSegmente
                    v-model="rubrik"
                    :options="rubriken"
                    :label="t('admin.news.field.rubrik')"
                    :gestapelt="phoneViewport"
                    testid="news-editor-rubrik"
                />
            </div>
            <p
                v-if="hinweis.satz"
                class="editor__hinweis feld--breit"
                :class="{ 'is-rueckt': !hinweis.bleibt }"
                data-testid="news-editor-platz"
            >
                {{ t(hinweis.satz.key, hinweis.satz.params) }}
            </p>
            <label class="feld feld--breit">
                <span class="feld__name">{{ t("admin.news.field.title") }}</span>
                <AvmEingabe v-model="titel" :maxlength="NEWS_TITEL_MAX" required testid="news-editor-titel" />
            </label>
            <label class="feld feld--breit">
                <span class="feld__name">{{ t("admin.news.field.text") }}</span>
                <AvmTextbereich
                    v-model="text"
                    :zeilen="5"
                    :maxlength="NEWS_TEXT_MAX"
                    required
                    testid="news-editor-text"
                />
                <span class="feld__zahl">{{
                    t("admin.news.field.count", { anzahl: text.length, max: NEWS_TEXT_MAX })
                }}</span>
            </label>
        </div>

        <div class="editor__knoepfe">
            <template v-if="props.art === 'neu'">
                <AvmKnopf
                    groesse="zeile"
                    art="gefuellt"
                    :gesperrt="sperre"
                    :grund-bei="grund === undefined ? undefined : grundId"
                    testid="news-editor-veroeffentlichen"
                    @click="speichern('sichtbar')"
                    >{{ t("admin.news.publishNew") }}</AvmKnopf
                >
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="sperre"
                    :grund-bei="grund === undefined ? undefined : grundId"
                    testid="news-editor-entwurf"
                    @click="speichern('entwurf')"
                    >{{ t("admin.news.saveDraft") }}</AvmKnopf
                >
            </template>
            <AvmKnopf
                v-else
                groesse="zeile"
                art="gefuellt"
                :gesperrt="sperre"
                :grund-bei="grund === undefined ? undefined : grundId"
                testid="news-speichern"
                @click="speichern('sichtbar')"
                >{{ t("admin.news.save") }}</AvmKnopf
            >
            <AvmKnopf groesse="zeile" testid="news-abbrechen" @click="emit('abbrechen')">{{
                t("admin.news.cancel")
            }}</AvmKnopf>
        </div>
        <AvmSperrgrund v-if="grund !== undefined" :id="grundId" :text="grund" />
    </li>
</template>

<style scoped>
.editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-block: var(--space-4);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.editor__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-8);
}

.editor__titel {
    color: var(--color-accent-strong);
}

.editor__ort {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.editor__felder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: var(--space-8) var(--space-12);
    align-items: start;
}

.feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.feld--breit {
    grid-column: 1 / -1;
}

.feld__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.feld__zahl {
    align-self: flex-end;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.editor__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.editor__hinweis.is-rueckt {
    color: var(--color-warning-soft-text);
}

.editor__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.editor__felder.is-telefon {
    grid-template-columns: minmax(0, 1fr);
}
</style>
