<script setup lang="ts">
import { onMounted, useId, useTemplateRef } from "vue";
import { t } from "../i18n/i18n";
import AvmKnopf from "./avm-knopf.vue";

/**
 * Die Bestätigung einer folgenreichen Handlung, als kleiner Inhalt IM Fenster (WI-0120 A8; AUTH-0001 §12.3: Sperren,
 * Zurückziehen; Guide §24 führt Bestätigungsdialoge als offene Frage).
 *
 * 🔴 Kein zweites modales Fenster: Sie steht an der Stelle, an der gefragt wurde (in der Zeile der Person, unter der
 * Einladung), und das Fenster bleibt eins. `role="group"` mit der Frage als Namen und der Folge als Beschreibung - ein
 * `role="alertdialog"` wäre ein Fenster und gehört der Hülle (`fenster-huelle.test.ts`).
 *
 * - **Frage, Folge, zwei Knöpfe:** „Efferdan_vom_Kap sperren?“ · was danach gilt · `Abbrechen` (weich) und die Handlung
 *   selbst in der Gefahrfassung (umrandet, nicht gefüllt: er warnt, er schreit nicht, Guide §13.11). Die Handlung trägt
 *   ihren Namen („Sperren“), nicht „OK“ (Guide §24: Knöpfe sind Handlungen).
 * - **Fokus:** Beim Erscheinen steht er auf „Abbrechen“, dem harmlosen Weg; Escape bricht die Bestätigung ab, nicht das
 *   ganze Fenster (Discovery Frontend, Risiko R6: das `cancel` des `<dialog>` schlösse sonst alles).
 * - Eingefärbt wie Legacys Neuanlage, nur leiser: die weiche Fläche, eine Kante im Gefahrtripel.
 * - Was die Handlung braucht, steht zwischen Folge und Knöpfen im Slot (WI-0120 A10: der Grund einer Sperre); dann ist die
 *   Handlung `gesperrt`, bis es dasteht.
 */
const props = withDefaults(
    defineProps<{
        /** Die Frage, als Handlung am Gegenstand: „Efferdan_vom_Kap sperren?“ */
        frage: string;
        /** Was danach gilt: „Der Zugang endet sofort, beide Sitzungen werden beendet.“ */
        folge?: string | undefined;
        /** Die Aufschrift der Handlung: „Sperren“. */
        bestaetigen: string;
        /** Die Aufschrift des harmlosen Wegs; ohne Angabe „Abbrechen“. */
        abbrechen?: string | undefined;
        /** Der Satz, warum die Handlung gerade nicht geht (etwa während sie läuft). */
        gesperrt?: string | undefined;
        /** Den Fokus beim Erscheinen auf „Abbrechen“ setzen (Vorgabe); aus, wo die Bestätigung schon dasteht. */
        fokus?: boolean | undefined;
        testid?: string | undefined;
    }>(),
    { fokus: true },
);
const emit = defineEmits<{ bestaetigen: []; abbrechen: [] }>();

const frageId = useId();
const folgeId = useId();
const abbrechenKnopf = useTemplateRef<InstanceType<typeof AvmKnopf>>("abbrechenKnopf");

onMounted(() => {
    if (props.fokus) abbrechenKnopf.value?.focus();
});

/** Escape gehört der Bestätigung: Sie bricht ab, das Fenster darum bleibt offen. */
function escape(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <div
        class="bestaetigung"
        role="group"
        :aria-labelledby="frageId"
        :aria-describedby="props.folge ? folgeId : undefined"
        :data-testid="props.testid"
        @keydown.esc="escape"
    >
        <p :id="frageId" class="bestaetigung__frage">{{ props.frage }}</p>
        <p v-if="props.folge" :id="folgeId" class="bestaetigung__folge">{{ props.folge }}</p>
        <slot />
        <div class="bestaetigung__knoepfe">
            <AvmKnopf ref="abbrechenKnopf" @click="emit('abbrechen')">{{
                props.abbrechen ?? t("ui.confirm.cancel")
            }}</AvmKnopf>
            <AvmKnopf art="gefahr" :gesperrt="props.gesperrt" @click="emit('bestaetigen')">{{
                props.bestaetigen
            }}</AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
.bestaetigung {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-danger-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.bestaetigung__frage {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.bestaetigung__folge {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

/* Die Knöpfe stehen rechts, der harmlose zuerst; die Handlung trennt sich durch ihre Fassung, nicht durch ihren Ort. */
.bestaetigung__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-2);
}
</style>
