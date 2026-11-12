<script setup lang="ts">
import { computed } from "vue";
import type { LandscapeBooleanOperation } from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t, type MessageKey } from "../i18n/i18n";
import type { MitAnderer } from "./mit-anderer-flaeche";

/**
 * Die Leiste von „Mit anderer Fläche ›“ (Werkzeug 1, Thomas 4.1): die gemeinsame Leiste des Modus (`fenster/fenster-modusleiste.vue`).
 * Titel ist der Eintrag des Menüs, dahinter die Quelle und, sobald gewählt, die andere Fläche; „Fertig“ schreibt sofort (Ausnahme von
 * G4, Editor-Orchestrierung 2026-10-19) und sagt, solange es nicht geht, warum; „Verwerfen“ und Esc brechen ab. Nimmt die Operation die
 * andere Landschaft ganz von der Karte, sagt es die Zeile der Gesten vorher.
 */

const props = defineProps<{
    mitAnderer: MitAnderer;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

/** Eintrag und Zeichen je Operation; die „… behalten“-Fassungen tragen das Zeichen ihres Geschwisters. */
const EINTRAG: Record<LandscapeBooleanOperation, { label: MessageKey; zeichen: EditorZeichenName }> = {
    vereinigen: { label: "landschaftseditor.griff.vereinigen", zeichen: "vereinigen" },
    "vereinigen-behalten": { label: "landschaftseditor.griff.vereinigenBehalten", zeichen: "vereinigen" },
    ausschneiden: { label: "landschaftseditor.griff.ausschneiden", zeichen: "ausschneiden" },
    "ausschneiden-behalten": { label: "landschaftseditor.griff.ausschneidenBehalten", zeichen: "ausschneiden" },
    schnittmenge: { label: "landschaftseditor.griff.neuAusschneiden", zeichen: "neu-ausschneiden" },
};

const lauf = computed(() => props.mitAnderer.laufend.value);
/** Der Eintrag ohne seine Auslassungspunkte: In der Leiste folgt nichts mehr. */
const titel = computed(() => (lauf.value ? t(EINTRAG[lauf.value.operation].label).replace(/\s*…$/, "") : ""));
const objekt = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return "";
    const ziel = jetzt.ziel?.vorschau?.targetName;
    return ziel === undefined ? jetzt.name : `${jetzt.name} · ${ziel}`;
});
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "schreibt") return t("neueFlaeche.speichert");
    if (jetzt.phase === "rechnet") return t("landschaftseditor.mitAnderer.rechnet");
    return jetzt.ziel?.vorschau === undefined ? t("landschaftseditor.mitAnderer.waehle") : undefined;
});
const gesten = computed(() => {
    const jetzt = lauf.value;
    const satz = phoneViewport.value
        ? t("landschaftseditor.mitAnderer.gestenFinger")
        : t("landschaftseditor.mitAnderer.gesten");
    const vorschau = jetzt?.ziel?.vorschau;
    return vorschau?.targetLandscapeGoes === true
        ? `${t("landschaftseditor.mitAnderer.geht", { name: vorschau.targetName })} · ${satz}`
        : satz;
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined"
        :zeichen="EINTRAG[lauf.operation].zeichen"
        :titel="titel"
        :objekt="objekt"
        :ungespeichert="0"
        :zurueck="false"
        :wieder="false"
        :fertig-grund="fertigGrund"
        :gesten="gesten"
        :telefon="phoneViewport"
        :rand="rand"
        testid="mit-anderer-leiste"
        @verwerfen="mitAnderer.abbrechen()"
        @fertig="void mitAnderer.bestaetige()"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
