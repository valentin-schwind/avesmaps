<script setup lang="ts">
import { computed } from "vue";
import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import AenderungDetail from "./aenderung-detail.vue";
import { besitzerEintrag, karteTitel, statusText } from "./aenderung-karte-zeigen";
import { kannLageHaben } from "./aenderung-lage-modell";
import AenderungZeile from "./aenderung-zeile.vue";
import { eintragsAngaben, einzelnerOrt, zeigtRueckAmEnde, type ZeilenOrt } from "./aenderung-zeile-modell";
import { useAenderungenKontext } from "./aenderungen-kontext";
import { zeigtKarte } from "./karte-ablage";

/**
 * Eine Operation in der Liste von „Änderungen“ (WI-0265 B10): ihre Zeile (höchstens zwei Zeilen, ⊕, beim Überfahren ↺) und, aufgeklappt, ihr flaches Detail. Dieselbe Zeile steht in der Liste, in der Schiene einer
 * Arbeitsserie (`mitglied`, ohne Person und ohne Etikett: Die Kopfzeile der Serie nennt sie) und in der Schiene eines Bündels. Am Telefon zeigt der Reiter das Detail statt der Liste (`nurDetail`).
 * Was der Reiter hält (offene Zeilen, Angebote, Sprünge), kommt über den Kontext (`aenderungen-kontext.ts`).
 */
const props = defineProps<{
    eintrag: MapHistoryEntry;
    /** Ein anderer Titel als der der Operation (ein Mitglied einer Serie: „Schritt 3/8: Kamm 2 verschoben“). */
    titel?: string | undefined;
    /** Die Zeile steht in der Schiene einer Serie oder eines Bündels. */
    mitglied?: boolean | undefined;
    ohnePerson?: boolean | undefined;
    ohneEtikett?: boolean | undefined;
    /** Nur das Detail, ohne Zeile (am Telefon ersetzt es die Liste). */
    nurDetail?: boolean | undefined;
}>();

const kontext = useAenderungenKontext();
const operationId = computed(() => props.eintrag.operationId);
const offen = computed(() => kontext.ist(operationId.value));
const angebot = computed(() => kontext.angebotFuer(props.eintrag));
const angaben = computed(() =>
    eintragsAngaben(props.eintrag, {
        meine: kontext.meine.value,
        titel: props.titel,
        ohnePerson: props.ohnePerson,
        ohneEtikett: props.ohneEtikett,
    }),
);
const besitzer = computed(() => besitzerEintrag(kontext.kennung, operationId.value));
const ortObjekt = computed(() => einzelnerOrt(props.eintrag));
/** ⊕ am Zeilenende: der Ort (genau ein Ort) oder die Karte (B9, jede andere Änderung mit Gegenständen). */
const ort = computed<ZeilenOrt | undefined>(() => {
    if (ortObjekt.value !== undefined)
        return {
            titel: t("editorPanel.aenderungen.zeige"),
            gedrueckt: false,
            status: undefined,
            testid: `${kontext.kennung}-zeige`,
        };
    if (!kannLageHaben(props.eintrag.objects)) return undefined;
    return {
        titel: karteTitel(besitzer.value),
        gedrueckt: zeigtKarte(besitzer.value),
        status: statusText(besitzer.value),
        testid: `${kontext.kennung}-karte-griff`,
    };
});
const ruck = computed(() =>
    zeigtRueckAmEnde({
        phone: kontext.phone.value,
        hatAngebot: angebot.value !== undefined,
        gesperrt: angebot.value?.sperre !== undefined,
    }),
);

function zeigeOrt(): void {
    if (ortObjekt.value !== undefined) kontext.ortZeigen(ortObjekt.value.id);
    else kontext.zeigeEintragAufKarte(props.eintrag);
}

/** Das Detail steht unter der Zeile; am Telefon nur das einer Zeile der Schiene (das einer Zeile der Liste ersetzt dort die Liste). */
const zeigtDetail = computed(
    () => props.nurDetail === true || (offen.value && (!kontext.phone.value || props.mitglied === true)),
);
</script>

<template>
    <component
        :is="nurDetail ? 'div' : 'li'"
        :class="nurDetail ? undefined : ['eintrag', { 'eintrag--mitglied': mitglied }]"
        :data-aenderung-id="nurDetail ? undefined : eintrag.operationId"
        :data-testid="nurDetail ? undefined : 'editorpanel-aenderung'"
    >
        <AenderungZeile
            v-if="!nurDetail"
            :angaben="angaben"
            :offen="offen"
            :ort="ort"
            :ruck="ruck"
            :ruck-titel="t('aenderungen.ruecknahme.bestaetigen.einzeln')"
            testid="editorpanel-aenderung-zeile"
            @waehle="kontext.schalte(operationId, mitglied !== true)"
            @ort="zeigeOrt()"
            @ruecknehmen="kontext.stosseAn(operationId)"
        />
        <AenderungDetail
            v-if="zeigtDetail"
            :eintrag="eintrag"
            :kennung="kontext.kennung"
            sprung="objekt"
            nur-objekt
            :mitglied="mitglied"
            :kennt="kontext.kenntOperation"
            :rechte="kontext.rechte.value"
            :ruecknahme="angebot"
            :anstoss="kontext.anstossFuer(operationId)"
            @zurueckgenommen="kontext.zurueckgenommen"
            @neu-lesen="kontext.neuLesen()"
            @konflikt-pruefen="kontext.konfliktPruefen"
            @angestossen="kontext.angestossen()"
            @sprung="kontext.springeZumObjekt(eintrag, operationId)"
            @zeige="kontext.zeige"
            @nur-objekt="kontext.nurObjekt"
        />
    </component>
</template>

<style scoped>
.eintrag {
    border-bottom: 1px solid var(--color-border);
}

/* In der Schiene: die letzte Zeile schließt ohne Linie ab (die Linie darunter gehört der Zeile der Liste). */
.eintrag--mitglied:last-child {
    border-bottom: 0;
}
</style>
