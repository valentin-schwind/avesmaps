<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { showToast } from "../feedback/toast";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { namensGrund, namensVorschlag, type WegAuswahl } from "./weg-neuer-weg";

/**
 * Die Rückfrage „Auswahl zu neuem Weg“ (WI-0252) im Wege-Fenster: in der Sammelansicht im Kasten „Form“, sonst über den Eigenschaften der
 * Straße (vom Kartenmenü mit gewählten Abschnitten). Das Namensfeld steht vor, wenn alle gewählten Wege gleich heißen, sonst ist es leer
 * und nennt „gemischt“ (Betreiber 2026-10-24: „alles was "gemischt" wird dann zu einem namen“). Die Folgen stehen darunter; „Zu neuem
 * Weg“ schreibt EINE Operation, ↺ im Verlauf.
 */
const props = defineProps<{
    kennung: string;
    /** Die Auswahl; solange sie nicht gelesen ist, steht „wird gelesen“. */
    auswahl: WegAuswahl | undefined;
    /** Darf Felder schreiben (`edit_map_objects`) und ist Bearbeiten an? Sonst der Grund. */
    gesperrt?: string | undefined;
    schreibe: (name: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly satz: string }>;
}>();
const emit = defineEmits<{ abbrechen: [] }>();

const vorschlag = computed(() => (props.auswahl === undefined ? undefined : namensVorschlag(props.auswahl)));
const name = ref("");
// Der Vorschlag steht vor, sobald die Auswahl gelesen ist; danach gehört das Feld dem Menschen.
watch(
    vorschlag,
    (neu, alt) => {
        if (neu !== undefined && alt === undefined) name.value = neu.name;
    },
    { immediate: true },
);
const n = computed(() => props.auswahl?.abschnitte.length ?? 0);
const laeuft = ref(false);
const satz = ref<string | undefined>(undefined);
const grund = computed(() => {
    if (props.gesperrt !== undefined) return props.gesperrt;
    if (props.auswahl === undefined) return t("wegeditor.mehrfach.laedt");
    if (laeuft.value) return t("kraftlinieneditor.bearbeiten.speichert");
    const fehlt = namensGrund(name.value, props.auswahl);
    return fehlt === undefined ? undefined : t(fehlt);
});
async function bestaetige(): Promise<void> {
    if (grund.value !== undefined) return;
    const neu = name.value.trim();
    const anzahl = n.value;
    laeuft.value = true;
    satz.value = undefined;
    const ergebnis = await props.schreibe(neu);
    laeuft.value = false;
    if (!ergebnis.ok) {
        satz.value = ergebnis.satz;
        return;
    }
    showToast(tPlural("wegeditor.neuerWeg.fertig", anzahl, { n: formatNumber(anzahl, 0), name: neu }), "success");
}
</script>

<template>
    <AvmBestaetigung
        :frage="tPlural('wegeditor.neuerWeg.frage', n, { n: formatNumber(n, 0) })"
        :bestaetigen="t('wegeditor.neuerWeg.knopf')"
        :gesperrt="grund"
        :fokus="false"
        :testid="`${kennung}-neuer-weg`"
        @bestaetigen="bestaetige"
        @abbrechen="emit('abbrechen')"
    >
        <FensterFeldzeile
            :name="t('wegeditor.neuerWeg.name')"
            :fuer="`${kennung}-neuer-weg-name`"
            :testid="`${kennung}-neuer-weg-zeile`"
        >
            <AvmEingabe
                :id="`${kennung}-neuer-weg-name`"
                v-model="name"
                :placeholder="vorschlag?.gemischt ? t('fenster.sammel.gemischt') : ''"
                :testid="`${kennung}-neuer-weg-name`"
            />
        </FensterFeldzeile>
        <ul class="wegneu__folgen" :data-testid="`${kennung}-neuer-weg-folgen`">
            <li v-if="vorschlag?.gemischt">{{ t("wegeditor.neuerWeg.gemischt") }}</li>
            <li>{{ t("wegeditor.neuerWeg.folgeZuweisung") }}</li>
            <li>{{ t("wegeditor.neuerWeg.folgeRest") }}</li>
            <li>{{ t("wegeditor.neuerWeg.folgeForm") }}</li>
        </ul>
        <p v-if="satz" class="wegneu__warn" role="alert">{{ satz }}</p>
    </AvmBestaetigung>
</template>

<style scoped>
.wegneu__folgen {
    margin: 0;
    padding-left: 1.1em;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--font-size-small);
}

.wegneu__warn {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}
</style>
