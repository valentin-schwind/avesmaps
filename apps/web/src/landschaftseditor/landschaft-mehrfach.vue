<script setup lang="ts">
import { computed, ref } from "vue";
import {
    EDITOR_LANDSCAPE_LAYERS,
    LANDSCAPE_BATCH_MAX,
    landscapeTypesOfLayer,
    type EditorLandscapeLayer,
    type LandscapeRetireBody,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import { ueberAlle, type SammelEntwurf } from "../fenster/sammel";
import { GRUND_GEBIRGE } from "../editor-menu/sonderrolle-grund";
import { formatNumber, isMessageKey, locale, t } from "../i18n/i18n";
import LandschaftEntfernen from "./landschaft-entfernen.vue";
import { artEbene, fehltArt, type LandschaftSammelFelder, type LandschaftSammelZeile } from "./landschaft-sammel";
import { artName } from "./landschaften-liste";

/**
 * Die Eigenschaften der Mehrfachauswahl im Fenster der Derographie (EDIT-0003 T57; Form wie Fassung 5 der Gebiete, Betreiber 2026-10-19:
 * „perfekt genau das wollen wir“): ab zwei angehakten Landschaften statt der Eigenschaften einer.
 *
 * - **Kopf:** „n Landschaften gewählt“ und ihre Namen (sechs, dann „und n weitere“); von den Reitern geht nur „Eigenschaften“, die übrigen
 *   stehen grau mit „Nur einzeln“.
 * - **Gemeinsam** (`landschaft-sammel.ts`): Ebene, Art und „Besucher“ (verborgen). Ein Feld mit verschiedenen Werten zeigt „gemischt“ und
 *   überschreibt erst, wenn man es ändert; danach steht „gilt für alle n“ daran. Die Art kommt aus der Ebene, die danach für alle gilt.
 * - **Nur einzeln:** der Name, gesperrt mit „Nur einzeln“.
 * - **Entfernen …** für alle: dasselbe Blatt wie an einer Landschaft, mit den Zahlen über alle; schreibt sofort, ↺ im Verlauf.
 * - Geschrieben wird mit „Fertig“ der Leiste (der Sammel-Entwurf, EINE Operation für alle).
 * - **Gipfel und Vulkane** gehen mit (Stage-Fund 2026-10-19): Der Kopf nennt sie; Ebene und Art stehen gesperrt mit „Ebene und Art gelten
 *   nur für Landschaften.“; gemeinsam bleiben „Besucher“ und „Entfernen …“ (Gipfel werden dabei gelöscht, Editor-Orchestrierung
 *   2026-10-19).
 */
const props = defineProps<{
    zeilen: readonly LandschaftSammelZeile[];
    sammel: SammelEntwurf<LandschaftSammelFelder>;
    kennung: string;
    /** Darf diese Sitzung Landschaften schreiben? Sonst stehen die Felder still da. */
    schreibt: boolean;
    /** Hat diese Sitzung `edit_mountains`? Sonst lässt sich kein Gebirge wählen, und Ebene und Art stehen still, sobald eines in der Auswahl ist (WI-0279, E2a). */
    gebirgeFrei?: boolean | undefined;
    /** „Entfernen …“ für alle; fehlt ohne Schreibrecht. */
    entferne?:
        ((stage: LandscapeRetireBody["stage"]) => Promise<{ ok: true } | { ok: false; satz: string }>) | undefined;
}>();

const n = computed(() => props.zeilen.length);
const gipfelZahl = computed(() => props.zeilen.filter((zeile) => zeile.gipfel === true).length);
const kopf = computed(() =>
    gipfelZahl.value === 0
        ? t("landschaftseditor.mehrfach.gewaehlt", { n: formatNumber(n.value, 0) })
        : gipfelZahl.value === n.value
          ? t("landschaftseditor.mehrfach.gewaehltGipfel", { n: formatNumber(n.value, 0) })
          : t("landschaftseditor.mehrfach.gewaehltGemischt", { n: formatNumber(n.value, 0) }),
);
const felder = computed(() => props.sammel.stand.value.felder);
/**
 * Mehr angehakt, als EINE Operation trägt (`LANDSCAPE_BATCH_MAX` je Landschaften und Gipfel): der Grund dazu, vor dem Absenden; dann ruhen
 * alle gemeinsamen Felder und „Entfernen …“ (Editor-Orchestrierung 2026-10-20 nach dem Fund der Gebiete: nie still scheitern).
 */
const grenze = computed(() =>
    n.value - gipfelZahl.value > LANDSCAPE_BATCH_MAX || gipfelZahl.value > LANDSCAPE_BATCH_MAX
        ? t("landschaftseditor.mehrfach.zuViele", {
              max: formatNumber(LANDSCAPE_BATCH_MAX, 0),
              n: formatNumber(n.value, 0),
          })
        : undefined,
);
const ruht = computed(() =>
    !props.schreibt
        ? t("editorPanel.verb.lesen")
        : (grenze.value ?? (props.sammel.zustand.value.art === "speichert" ? t("entwurf.fertigSpeichert") : undefined)),
);
const ebeneName = (ebene: string): string => {
    const key = `layer.${ebene}`;
    return isMessageKey(key) ? t(key) : ebene;
};

const namen = computed(() => props.zeilen.slice(0, 6).map((zeile) => zeile.name));
const weitere = computed(() => Math.max(0, n.value - 6));

const REITER = ["eigenschaften", "form", "beschriftungen", "gebirge", "verlauf"] as const;
const reiterListe = computed(() =>
    REITER.map((id) => ({
        id,
        name:
            id === "beschriftungen"
                ? t("landschaftseditor.reiter.beschriftungen", {
                      n: formatNumber(
                          props.zeilen.reduce((summe, zeile) => summe + (zeile.labels ?? 0), 0),
                          0,
                      ),
                  })
                : t(`landschaftseditor.reiter.${id}`),
        spaeter: id === "eigenschaften" ? undefined : t("fenster.sammel.nurEinzeln"),
    })),
);
const reiter = ref<(typeof REITER)[number]>("eigenschaften");

const name = computed(() => ueberAlle(props.zeilen, (zeile) => zeile.name));
const ebene = computed(() => ueberAlle(props.zeilen, (zeile) => zeile.layer));
const art = computed(() => ueberAlle(props.zeilen, (zeile) => zeile.type ?? ""));
const verborgen = computed(() => ueberAlle(props.zeilen, (zeile) => zeile.hidden === true));

/** Der Wert eines Felds, wie er dasteht: gesetzt für alle, sonst gemeinsam, sonst leer (gemischt). */
const ebeneWert = computed(() => felder.value.ebene ?? (ebene.value.gleich ? ebene.value.wert : ""));
const zielEbene = computed(() => artEbene(props.zeilen, felder.value));
const artWert = computed(() => {
    if (felder.value.art !== undefined) return felder.value.art;
    // Eine neue Ebene: Die Art der alten gilt dort nicht.
    if (felder.value.ebene !== undefined && props.zeilen.some((zeile) => zeile.layer !== felder.value.ebene)) return "";
    return art.value.gleich ? art.value.wert : "";
});
const verborgenWert = computed(() =>
    felder.value.verborgen !== undefined
        ? felder.value.verborgen
            ? "ja"
            : "nein"
        : verborgen.value.gleich
          ? verborgen.value.wert
              ? "ja"
              : "nein"
          : "",
);

const gemischt = (feld: { gleich: boolean }, geaendert: boolean) =>
    !geaendert && !feld.gleich ? [{ wert: "", text: t("fenster.sammel.gemischt"), gesperrt: true }] : [];
const ebenen = computed(() => [
    ...gemischt(ebene.value, felder.value.ebene !== undefined),
    ...EDITOR_LANDSCAPE_LAYERS.map((wert) => ({ wert, text: ebeneName(wert) })),
]);
const arten = computed(() => {
    const ziel = zielEbene.value;
    if (ziel === undefined) return [{ wert: "", text: t("fenster.sammel.gemischt"), gesperrt: true }];
    const liste = landscapeTypesOfLayer(ziel)
        .filter((wert) => props.gebirgeFrei === true || wert !== "gebirge")
        .map((wert) => ({ wert, text: artName(wert) }))
        .sort((a, b) => a.text.localeCompare(b.text, locale.value));
    return artWert.value === ""
        ? [
              {
                  wert: "",
                  text:
                      art.value.gleich || felder.value.ebene !== undefined
                          ? t("landschaftseditor.art.waehlen")
                          : t("fenster.sammel.gemischt"),
                  gesperrt: true,
              },
              ...liste,
          ]
        : liste;
});
/** Frage und Knopf von „Entfernen …“ nennen, was gewählt ist: Flächen, Gipfel oder beides. */
const entfernenFrage = computed(() =>
    gipfelZahl.value === 0
        ? t("landschaftseditor.mehrfach.entfernenFrage", { n: formatNumber(n.value, 0) })
        : gipfelZahl.value === n.value
          ? t("landschaftseditor.mehrfach.entfernenFrageGipfel", { n: formatNumber(n.value, 0) })
          : t("landschaftseditor.mehrfach.entfernenFrageGemischt", { n: formatNumber(n.value, 0) }),
);
const entfernenKnopf = computed(() =>
    gipfelZahl.value === 0
        ? t("landschaftseditor.mehrfach.entfernenOeffnen", { n: formatNumber(n.value, 0) })
        : t("landschaftseditor.mehrfach.entfernenOeffnenAlle", { n: formatNumber(n.value, 0) }),
);
/** Mit Gipfeln gehen Ebene und Art nicht: Gipfel tragen keine. */
const gebirgeInAuswahl = computed(
    () =>
        props.gebirgeFrei !== true &&
        props.zeilen.some((zeile) => zeile.layer === "topographie" && zeile.type === "gebirge"),
);
const ebeneGrund = computed(
    () =>
        ruht.value ??
        (gipfelZahl.value > 0
            ? t("landschaftseditor.mehrfach.nurLandschaften")
            : gebirgeInAuswahl.value
              ? t(GRUND_GEBIRGE)
              : undefined),
);
const artGrund = computed(
    () => ebeneGrund.value ?? (zielEbene.value === undefined ? t("landschaftseditor.mehrfach.ersteEbene") : undefined),
);
const artFehlt = computed(() => fehltArt(props.zeilen, felder.value));
const besucher = computed(() => [
    ...gemischt(verborgen.value, felder.value.verborgen !== undefined),
    { wert: "nein", text: t("landschaftseditor.mehrfach.sichtbar") },
    { wert: "ja", text: t("landschaftseditor.mehrfach.verborgen") },
]);

const entfernenOffen = ref(false);
const entfernenSendet = ref(false);
const entfernenSatz = ref<string | undefined>(undefined);
async function entfernen(stage: LandscapeRetireBody["stage"]): Promise<void> {
    if (props.entferne === undefined) return;
    entfernenSendet.value = true;
    entfernenSatz.value = undefined;
    const antwort = await props.entferne(stage);
    entfernenSendet.value = false;
    if (antwort.ok) entfernenOffen.value = false;
    else entfernenSatz.value = antwort.satz;
}
</script>

<template>
    <div class="mehrfach" :data-testid="`${kennung}-mehrfach`">
        <div class="mehrfach__kopf">
            <strong :data-testid="`${kennung}-mehrfach-kopf`">{{ kopf }}</strong>
            <span class="mehrfach__streifen" :data-testid="`${kennung}-mehrfach-namen`">
                <span v-for="(zeilenName, i) in namen" :key="i">{{ zeilenName }}</span>
                <span v-if="weitere > 0">{{
                    t("landschaftseditor.mehrfach.weitere", { n: formatNumber(weitere, 0) })
                }}</span>
            </span>
        </div>
        <p v-if="grenze" class="mehrfach__satz" role="status" :data-testid="`${kennung}-mehrfach-zu-viele`">
            {{ grenze }}
        </p>
        <FensterReiter
            v-model="reiter"
            :reiter="reiterListe"
            :beschriftung="t('landschaftseditor.reiter')"
            :kennung="`${kennung}-mehrfach`"
        />
        <div :id="`${kennung}-mehrfach-inhalt-eigenschaften`" class="mehrfach__rumpf" role="tabpanel">
            <section class="mehrfach__abschnitt">
                <h4 class="mehrfach__titel">{{ t("landschaftseditor.abschnitt.identitaet") }}</h4>
                <FensterFeldzeilen>
                    <dt>{{ t("landschaftseditor.feld.name") }}</dt>
                    <dd>
                        <AvmEingabe
                            :model-value="name.gleich ? name.wert : ''"
                            :placeholder="name.gleich ? undefined : t('fenster.sammel.gemischt')"
                            :gesperrt="t('fenster.sammel.nurEinzeln')"
                            :aria-label="t('landschaftseditor.feld.name')"
                            :testid="`${kennung}-mehrfach-name`"
                        />
                    </dd>
                    <dt>{{ t("landschaftseditor.feld.ebene") }}</dt>
                    <dd>
                        <AvmAuswahl
                            :model-value="ebeneWert"
                            :optionen="ebenen"
                            :gesperrt="ebeneGrund"
                            :aria-label="t('landschaftseditor.feld.ebene')"
                            :testid="`${kennung}-mehrfach-ebene`"
                            @update:model-value="(wert: string) => sammel.setze('ebene', wert as EditorLandscapeLayer)"
                        />
                        <SammelHinweis v-if="sammel.geaendert('ebene')" art="alle" :n="n" />
                    </dd>
                    <dt>{{ t("landschaftseditor.feld.flaechenart") }}</dt>
                    <dd>
                        <AvmAuswahl
                            :model-value="artWert"
                            :optionen="arten"
                            :gesperrt="artGrund"
                            :aria-label="t('landschaftseditor.feld.flaechenart')"
                            :testid="`${kennung}-mehrfach-art`"
                            @update:model-value="(wert: string) => sammel.setze('art', wert)"
                        />
                        <SammelHinweis v-if="sammel.geaendert('art') && artWert !== ''" art="alle" :n="n" />
                        <p v-if="artFehlt" class="mehrfach__satz" :data-testid="`${kennung}-mehrfach-art-fehlt`">
                            {{ t("landschaftseditor.mehrfach.artFehlt") }}
                        </p>
                    </dd>
                    <dt>{{ t("landschaftseditor.feld.besucher") }}</dt>
                    <dd>
                        <AvmAuswahl
                            :model-value="verborgenWert"
                            :optionen="besucher"
                            :gesperrt="ruht"
                            :aria-label="t('landschaftseditor.feld.besucher')"
                            :testid="`${kennung}-mehrfach-besucher`"
                            @update:model-value="(wert: string) => sammel.setze('verborgen', wert === 'ja')"
                        />
                        <SammelHinweis v-if="sammel.geaendert('verborgen')" art="alle" :n="n" />
                    </dd>
                </FensterFeldzeilen>
            </section>
            <section
                v-if="entferne && schreibt"
                class="mehrfach__abschnitt"
                :data-testid="`${kennung}-mehrfach-entfernen`"
            >
                <LandschaftEntfernen
                    v-if="entfernenOffen"
                    :frage="entfernenFrage"
                    :flaechen="zeilen.reduce((summe, zeile) => summe + (zeile.areas ?? 0), 0)"
                    :beschriftungen="zeilen.reduce((summe, zeile) => summe + (zeile.labels ?? 0), 0)"
                    :gipfel="gipfelZahl"
                    :nur-gipfel="gipfelZahl === n"
                    :kennung="`${kennung}-mehrfach`"
                    :gesperrt="
                        entfernenSendet
                            ? t('landschaftseditor.entfernen.sendet')
                            : sammel.lage.value.aktiv
                              ? t('landschaftseditor.entfernen.erstFertig')
                              : undefined
                    "
                    @entfernen="(stage) => void entfernen(stage)"
                    @abbrechen="entfernenOffen = false"
                />
                <AvmKnopf
                    v-else
                    art="gefahr"
                    groesse="zeile"
                    :gesperrt="
                        grenze ?? (sammel.lage.value.aktiv ? t('landschaftseditor.entfernen.erstFertig') : undefined)
                    "
                    :testid="`${kennung}-mehrfach-entfernen-oeffnen`"
                    @click="entfernenOffen = true"
                >
                    {{ entfernenKnopf }}
                </AvmKnopf>
                <p v-if="entfernenSatz" class="mehrfach__fehler" role="alert">{{ entfernenSatz }}</p>
            </section>
        </div>
    </div>
</template>

<style scoped>
.mehrfach {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.mehrfach__kopf {
    display: grid;
    gap: var(--space-4);
}

.mehrfach__kopf strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

/* Die Namen als leise Pillen, wie in Fassung 5. */
.mehrfach__streifen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.mehrfach__streifen span {
    padding: 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.mehrfach__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Wie die Abschnitte im Fenster einer Landschaft. */
.mehrfach__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.mehrfach__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.mehrfach__satz,
.mehrfach__fehler {
    margin: var(--space-2) 0 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}
</style>
