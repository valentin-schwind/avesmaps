<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import AenderungEintrag from "./aenderung-eintrag.vue";
import { besitzerSerie, karteTitel, statusText } from "./aenderung-karte-zeigen";
import { kannLageHaben } from "./aenderung-lage-modell";
import { serienEnden, type SerienZeile } from "./aenderung-modell";
import AenderungSerienDetail from "./aenderung-serien-detail.vue";
import AenderungZeile from "./aenderung-zeile.vue";
import { mitgliedTitel, serienAngaben, zeigtRueckAmEnde, type ZeilenOrt } from "./aenderung-zeile-modell";
import { serienSchluessel } from "./aenderung-gruppen";
import { useAenderungenKontext } from "./aenderungen-kontext";
import { zeigtKarte } from "./karte-ablage";

/**
 * Eine Arbeitsserie in der Liste von „Änderungen“ (WI-0265 B10; Fachvertrag B): dieselbe Zeile wie jede Änderung („Blutzinnen — 8 Änderungen“, Spanne, Felder), aufgeklappt das flache Detail der ganzen Serie
 * (Griffleiste mit „↺ Serie zurücknehmen (n)“, Tafel Vorher vor dem ersten und Nachher nach dem letzten „Fertig“) und darunter die Mitglieder als Zeilen an einer Schiene, jedes für sich aufklappbar.
 * Am Telefon zeigt der Reiter das Detail statt der Liste (`nurDetail`).
 */
const props = defineProps<{
    zeile: SerienZeile;
    nurDetail?: boolean | undefined;
}>();

const kontext = useAenderungenKontext();
const schluessel = computed(() => serienSchluessel(props.zeile.id));
const offen = computed(() => kontext.ist(schluessel.value));
const angebot = computed(() => kontext.angebotFuerSerie(props.zeile));
const angaben = computed(() => serienAngaben(props.zeile, { meine: kontext.meine.value }));
const besitzer = computed(() => besitzerSerie(kontext.kennung, props.zeile.id));
const ort = computed<ZeilenOrt | undefined>(() =>
    props.zeile.mitglieder.some((mitglied) => kannLageHaben(mitglied.objects))
        ? {
              titel: karteTitel(besitzer.value),
              gedrueckt: zeigtKarte(besitzer.value),
              status: statusText(besitzer.value),
              testid: `${kontext.kennung}-serie-karte-griff`,
          }
        : undefined,
);
const ruck = computed(() =>
    zeigtRueckAmEnde({
        phone: kontext.phone.value,
        hatAngebot: angebot.value !== undefined,
        gesperrt: angebot.value?.sperre !== undefined,
    }),
);
const zeigtDetail = computed(() => props.nurDetail === true || (offen.value && !kontext.phone.value));
const neuestes = computed(() => serienEnden(props.zeile).letztes);
</script>

<template>
    <component
        :is="nurDetail ? 'div' : 'li'"
        :class="nurDetail ? undefined : 'serie'"
        :data-aenderung-id="nurDetail ? undefined : zeile.id"
        :data-testid="nurDetail ? undefined : 'editorpanel-aenderung-serie'"
    >
        <AenderungZeile
            v-if="!nurDetail"
            :angaben="angaben"
            :offen="offen"
            :ort="ort"
            :ruck="ruck"
            :ruck-titel="t('aenderungen.ruecknahme.bestaetigen.einzeln')"
            testid="editorpanel-aenderung-serie-zeile"
            @waehle="kontext.schalte(schluessel, true)"
            @ort="kontext.zeigeSerieAufKarte(besitzer, zeile.mitglieder)"
            @ruecknehmen="kontext.stosseAn(schluessel)"
        />
        <AenderungSerienDetail
            v-if="zeigtDetail"
            :zeile="zeile"
            :kennung="kontext.kennung"
            sprung="objekt"
            nur-objekt
            :ruecknahme="angebot"
            :anstoss="kontext.anstossFuer(schluessel)"
            @zurueckgenommen="kontext.zurueckgenommen"
            @neu-lesen="kontext.neuLesen()"
            @konflikt-pruefen="kontext.konfliktPruefen"
            @angestossen="kontext.angestossen()"
            @sprung="kontext.springeZumObjekt(neuestes, zeile.id)"
            @nur-objekt="kontext.nurObjekt"
        >
            <ol class="schiene">
                <AenderungEintrag
                    v-for="mitglied in zeile.mitglieder"
                    :key="mitglied.operationId"
                    :eintrag="mitglied"
                    :titel="mitgliedTitel(mitglied)"
                    mitglied
                    ohne-person
                    ohne-etikett
                />
            </ol>
        </AenderungSerienDetail>
    </component>
</template>

<style scoped>
.serie {
    border-bottom: 1px solid var(--color-border);
}

/* Die Schiene: Die Mitglieder reichen über die Polster des Details hinaus bis an dessen Ränder, getrennt durch Haarlinien. */
.schiene {
    margin: var(--space-2) calc(-1 * var(--space-10)) calc(-1 * var(--space-8)) calc(-1 * var(--space-8));
    padding: 0;
    border-top: 1px solid var(--color-border);
    list-style: none;
}
</style>
