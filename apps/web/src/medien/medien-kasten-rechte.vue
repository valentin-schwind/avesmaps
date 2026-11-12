<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import {
    MEDIA_EVIDENCE_KINDS,
    MEDIA_RIGHTS_BASES,
    type MediaAssetDetail,
    type MediaLicenseInfo,
    type MediaReviewDecision,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t, type MessageKey } from "../i18n/i18n";
import {
    belegAnfrage,
    leererBeleg,
    pruefungFaelltZurueck,
    pruefungsLage,
    zeigeEntscheid,
    rechteAnfrage,
    rechteAus,
} from "./medien-bearbeiten-modell";
import MedienFeldliste from "./medien-feldliste.vue";
import { befundeJeFeld, belegFelder, type BelegStand, type RechteStand } from "./medien-formular-modell";
import { rechteZeilen } from "./medien-inspektor-modell";
import MedienKasten from "./medien-kasten.vue";
import {
    Handlung,
    dateiFuerAnfrage,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import { datumZeit, groesse, rechtsgrundName } from "./medien-text";

/**
 * Der Kasten „Rechte“ (WI-0068 P4b, Blatt 1 A): Grundlage, Lizenz, Urheber, Rechteinhaber, Namensnennung und Rechtenotiz (`…/rights`).
 * Ändern sich Grundlage oder Lizenz, fällt eine Prüfung zurück; das sagt der Kasten, bevor gespeichert wird.
 *
 * Darunter, lesend wie bearbeitend, die **Prüfung** mit drei Entscheiden (`…/rights/review`): „✓ Rechte geprüft“, „✕ Abgelehnt“,
 * „↺ Erneut zur Prüfung“ (setzt den Prüfstand auf „zu prüfen“; nur, wo es einen Entscheid zurückzunehmen gibt, OPS-000101), nur mit `review_media_rights`,
 * auch am eigenen Hochgeladenen (WI-0282); gesperrt steht der Grund EINMAL
 * darunter. Dazu **„＋ Beleg anhängen“** (`…/evidence`): Art, dann Adresse, Datei oder Text je Art; ein Beleg bleibt immer privat.
 */
const props = defineProps<{
    detail: MediaAssetDetail;
    bearbeitbar: boolean;
    kannPruefen: boolean;
    /** Die Lizenz eines Community-Uploads ändert nur der Betreiber (WI-0282). */
    kannCommunityLizenz: boolean;
    operationen: MedienOperationen;
}>();
const emit = defineEmits<{ gespeichert: []; neuLaden: [] }>();

const id = useId();
const offen = ref(false);
const stand = ref<RechteStand>(rechteAus(props.detail));
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const befunde = ref<ReadonlyMap<string, string>>(new Map());
const handlung = new Handlung();

const lizenzen = shallowRef<readonly MediaLicenseInfo[]>([]);
let lizenzLauf: AbortController | undefined;
async function ladeLizenzen(): Promise<void> {
    if (lizenzen.value.length > 0) return;
    lizenzLauf?.abort();
    lizenzLauf = new AbortController();
    try {
        lizenzen.value = (await props.operationen.lizenzen(lizenzLauf.signal)).licenses;
    } catch {
        // Ohne Katalog bleibt die Auswahl leer; der Server prüft die Lizenz beim Speichern ohnehin.
    }
}
onBeforeUnmount(() => lizenzLauf?.abort());

const grundlageOptionen = computed(() => [
    { wert: "", text: t("medien.formular.bitteWaehlen") },
    ...MEDIA_RIGHTS_BASES.map((basis) => ({ wert: basis, text: rechtsgrundName(basis) })),
]);
const lizenzOptionen = computed(() => [
    { wert: "", text: t("medien.formular.bitteWaehlen") },
    ...lizenzen.value.map((eintrag) => ({ wert: eintrag.key, text: eintrag.displayName })),
]);
const zuruecksetzen = computed(() => offen.value && pruefungFaelltZurueck(props.detail, stand.value));
const lizenzGesperrt = computed(() =>
    props.detail.asset.origin === "community_upload" && !props.kannCommunityLizenz
        ? t("medien.bearbeiten.communityLizenz")
        : undefined,
);

watch(offen, (jetzt) => {
    if (!jetzt) return;
    stand.value = rechteAus(props.detail);
    fehler.value = undefined;
    befunde.value = new Map();
    void ladeLizenzen();
});

async function speichern(): Promise<void> {
    const anfrage = rechteAnfrage(props.detail, stand.value, lizenzen.value);
    befunde.value = befundeJeFeld(anfrage.befunde);
    if (anfrage.befunde.length > 0) return;
    if (anfrage.body === undefined) {
        offen.value = false;
        return;
    }
    const body = anfrage.body;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            props.operationen.rechte(props.detail.asset.id, { ...body, operationId }),
        );
        offen.value = false;
        emit("gespeichert");
    } catch (error) {
        fehler.value = operationsFehler(error);
        befunde.value = befundeJeFeld(fehler.value.befunde);
    } finally {
        sendet.value = false;
    }
}

function neuLaden(): void {
    fehler.value = undefined;
    emit("neuLaden");
}

// --- Die Prüfung ---

const lage = computed(() => pruefungsLage(props.detail, props.kannPruefen, datumZeit));
const pruefung = new Handlung();
const prueft = ref<MediaReviewDecision | undefined>();
const pruefFehler = ref<OperationsFehler | undefined>();
const ENTSCHEIDE: readonly { wert: MediaReviewDecision; zeichen: string; text: MessageKey }[] = [
    { wert: "cleared", zeichen: "✓", text: "medien.bearbeiten.entscheid.cleared" },
    { wert: "rejected", zeichen: "✕", text: "medien.bearbeiten.entscheid.rejected" },
    { wert: "needs_review", zeichen: "↺", text: "medien.bearbeiten.entscheid.needs_review" },
];
/**
 * Die Entscheide, die hier etwas ändern (OPS-000101): „Erneut zur Prüfung“ nur, wo ein Entscheid gilt. An einem ungeprüften Bild sagte der Knopf sonst „geprüft am …“
 * und schrieb einen Eintrag ins Fachprotokoll, ohne dass sich sichtbar etwas änderte.
 */
const entscheide_ = computed(() => ENTSCHEIDE.filter((entscheid) => zeigeEntscheid(props.detail, entscheid.wert)));

async function entscheide(decision: MediaReviewDecision): Promise<void> {
    const rechte = props.detail.rights;
    if (rechte === null || lage.value.gesperrt !== undefined) return;
    prueft.value = decision;
    pruefFehler.value = undefined;
    try {
        await pruefung.fuehreAus((operationId) =>
            props.operationen.rechtePruefen(props.detail.asset.id, {
                operationId,
                baseRevision: rechte.revision,
                decision,
            }),
        );
        emit("gespeichert");
    } catch (error) {
        pruefFehler.value = operationsFehler(error);
    } finally {
        prueft.value = undefined;
    }
}

// --- Ein Beleg ---

const belegOffen = ref(false);
const beleg = ref<BelegStand>(leererBeleg());
const belegSendet = ref(false);
const belegFehler = ref<OperationsFehler | undefined>();
const belegBefunde = ref<ReadonlyMap<string, string>>(new Map());
const belegHandlung = new Handlung();
const belegArt = computed(() => belegFelder(beleg.value.art));
const belegOptionen = computed(() => [
    { wert: "", text: t("medien.formular.bitteWaehlen") },
    ...MEDIA_EVIDENCE_KINDS.map((art) => ({ wert: art, text: t(`medien.beleg.${art}`) })),
]);

function belegOeffnen(): void {
    beleg.value = leererBeleg();
    belegFehler.value = undefined;
    belegBefunde.value = new Map();
    belegOffen.value = true;
}

function belegGewaehlt(event: Event): void {
    const eingabe = event.target as HTMLInputElement;
    beleg.value.datei = eingabe.files?.[0] ?? beleg.value.datei;
    eingabe.value = "";
}

async function belegAnhaengen(): Promise<void> {
    const vorab = belegAnfrage(beleg.value);
    belegBefunde.value = befundeJeFeld(vorab.befunde);
    if (vorab.befunde.length > 0) return;
    belegSendet.value = true;
    belegFehler.value = undefined;
    try {
        const datei =
            belegArt.value.datei && beleg.value.datei !== undefined
                ? await dateiFuerAnfrage(beleg.value.datei)
                : undefined;
        const { evidence } = belegAnfrage(beleg.value, datei);
        if (evidence === undefined) return;
        await belegHandlung.fuehreAus((operationId) =>
            props.operationen.beleg(props.detail.asset.id, { operationId, evidence }),
        );
        belegOffen.value = false;
        emit("gespeichert");
    } catch (error) {
        belegFehler.value = operationsFehler(error);
        belegBefunde.value = befundeJeFeld(belegFehler.value.befunde);
    } finally {
        belegSendet.value = false;
    }
}
</script>

<template>
    <MedienKasten
        v-model:offen="offen"
        :titel="t('medien.abschnitt.rechte')"
        :bearbeitbar="bearbeitbar"
        :sendet="sendet"
        :fehler="fehler"
        :speichern-text="t('medien.bearbeiten.speichernRechte')"
        testid="medien-kasten-rechte"
        @speichern="speichern"
        @neu-laden="neuLaden"
    >
        <MedienFeldliste :zeilen="rechteZeilen(detail)" testid="medien-rechte" />
        <!-- An einer Karte: die aus ihr erzeugten Vorschauen, denen diese Rechte auch gelten (WI-0287 Punkt 5). -->
        <slot name="zusatz" />
        <AvmHinweis testid="medien-gespeichert-nicht-geprueft">{{ t("medien.inspektor.nichtGeprueft") }}</AvmHinweis>

        <template #bearbeiten>
            <label :for="`${id}-grundlage`">{{ t("medien.formular.grundlage") }}</label>
            <span class="medien-kasten__wert">
                <AvmAuswahl
                    :id="`${id}-grundlage`"
                    v-model="stand.grundlage"
                    :optionen="grundlageOptionen"
                    :gesperrt="lizenzGesperrt"
                    :aria-invalid="befunde.has('rights.basis') ? 'true' : undefined"
                    testid="medien-bearbeiten-grundlage"
                />
                <span v-if="befunde.get('rights.basis')" class="medien-kasten__befund">{{
                    befunde.get("rights.basis")
                }}</span>
            </span>
            <template v-if="stand.grundlage === 'license'">
                <label :for="`${id}-lizenz`">{{ t("medien.formular.lizenz") }}</label>
                <span class="medien-kasten__wert">
                    <AvmAuswahl
                        :id="`${id}-lizenz`"
                        v-model="stand.lizenz"
                        :optionen="lizenzOptionen"
                        :gesperrt="lizenzGesperrt"
                        :aria-invalid="befunde.has('rights.licenseKey') ? 'true' : undefined"
                        testid="medien-bearbeiten-lizenz"
                    />
                    <span v-if="befunde.get('rights.licenseKey')" class="medien-kasten__befund">{{
                        befunde.get("rights.licenseKey")
                    }}</span>
                </span>
            </template>
            <label :for="`${id}-urheber`">{{ t("medien.formular.urheber") }}</label>
            <AvmEingabe
                :id="`${id}-urheber`"
                v-model="stand.urheber"
                :placeholder="t('medien.formular.urheberHinweis')"
                maxlength="300"
                testid="medien-bearbeiten-urheber"
            />
            <label :for="`${id}-inhaber`">{{ t("medien.formular.rechteinhaber") }}</label>
            <AvmEingabe
                :id="`${id}-inhaber`"
                v-model="stand.rechteinhaber"
                :placeholder="t('medien.formular.rechteinhaberHinweis')"
                maxlength="300"
            />
            <label :for="`${id}-nennung`">{{ t("medien.formular.namensnennung") }}</label>
            <span class="medien-kasten__wert">
                <AvmEingabe
                    :id="`${id}-nennung`"
                    v-model="stand.namensnennung"
                    :placeholder="t('medien.formular.namensnennungHinweis')"
                    :ungueltig="befunde.has('rights.attribution')"
                    maxlength="1000"
                    testid="medien-bearbeiten-nennung"
                />
                <span v-if="befunde.get('rights.attribution')" class="medien-kasten__befund">{{
                    befunde.get("rights.attribution")
                }}</span>
            </span>
            <label :for="`${id}-notiz`">{{ t("medien.formular.rechtenotiz") }}</label>
            <AvmEingabe
                :id="`${id}-notiz`"
                v-model="stand.rechtenotiz"
                :placeholder="t('medien.formular.rechtenotizHinweis')"
                maxlength="4000"
            />
            <AvmHinweis v-if="zuruecksetzen" class="breit" ton="warnung" testid="medien-bearbeiten-zuruecksetzen">{{
                t("medien.bearbeiten.pruefungZurueck")
            }}</AvmHinweis>
        </template>

        <template #unten>
            <div class="medien-kasten-rechte__pruefung" data-testid="medien-pruefung">
                <span class="medien-kasten-rechte__beschriftung">{{ t("medien.bearbeiten.pruefung") }}</span>
                <span class="medien-kasten-rechte__stand" data-testid="medien-pruefung-stand">{{ lage.stand }}</span>
                <span class="medien-kasten-rechte__entscheide">
                    <AvmKnopf
                        v-for="entscheid in entscheide_"
                        :key="entscheid.wert"
                        groesse="zeile"
                        :gesperrt="lage.gesperrt !== undefined || prueft !== undefined ? '' : undefined"
                        :aria-describedby="`${id}-pruefgrund`"
                        :testid="`medien-pruefung-${entscheid.wert}`"
                        @click="entscheide(entscheid.wert)"
                    >
                        <template #zeichen>{{ entscheid.zeichen }}</template>
                        {{ t(entscheid.text) }}
                    </AvmKnopf>
                </span>
                <span :id="`${id}-pruefgrund`" class="medien-kasten-rechte__satz" data-testid="medien-pruefung-satz">{{
                    lage.gesperrt ?? t("medien.bearbeiten.pruefungGilt")
                }}</span>
                <AvmHinweis
                    v-if="pruefFehler"
                    class="medien-kasten-rechte__voll"
                    :ton="pruefFehler.ton"
                    rolle="alert"
                    testid="medien-pruefung-fehler"
                    >{{ pruefFehler.text }}</AvmHinweis
                >
            </div>

            <div v-if="bearbeitbar" class="medien-kasten-rechte__beleg" data-testid="medien-beleg">
                <AvmKnopf v-if="!belegOffen" groesse="zeile" testid="medien-beleg-oeffnen" @click="belegOeffnen">
                    <template #zeichen>＋</template>
                    {{ t("medien.bearbeiten.belegOeffnen") }}
                </AvmKnopf>
                <form v-else class="medien-kasten-rechte__belegform" novalidate @submit.prevent="belegAnhaengen">
                    <fieldset class="medien-kasten-rechte__felder" :disabled="belegSendet">
                        <label :for="`${id}-belegart`">{{ t("medien.formular.beleg") }}</label>
                        <AvmAuswahl
                            :id="`${id}-belegart`"
                            v-model="beleg.art"
                            :optionen="belegOptionen"
                            testid="medien-beleg-art"
                        />
                        <template v-if="belegArt.adresse">
                            <label :for="`${id}-belegadresse`">{{ t("medien.formular.belegAdresse") }}</label>
                            <span class="medien-kasten-rechte__wert">
                                <AvmEingabe
                                    :id="`${id}-belegadresse`"
                                    v-model="beleg.adresse"
                                    :placeholder="t('medien.formular.belegAdresseHinweis')"
                                    :ungueltig="belegBefunde.has('evidence.url')"
                                    testid="medien-beleg-adresse"
                                />
                                <span v-if="belegBefunde.get('evidence.url')" class="medien-kasten-rechte__befund">{{
                                    belegBefunde.get("evidence.url")
                                }}</span>
                            </span>
                        </template>
                        <template v-if="belegArt.datei">
                            <span class="medien-kasten-rechte__beschriftung">{{
                                t("medien.bearbeiten.belegDatei")
                            }}</span>
                            <span class="medien-kasten-rechte__wert">
                                <label class="medien-kasten-rechte__dateiknopf">
                                    <input
                                        class="medien-kasten-rechte__dateieingabe"
                                        type="file"
                                        accept=".pdf,.txt,.eml,.png,.jpg,.jpeg,.gif,.webp"
                                        data-testid="medien-beleg-datei"
                                        @change="belegGewaehlt"
                                    />
                                    <span class="avm-versalmitte">{{ t("medien.formular.belegAnhaengen") }}</span>
                                </label>
                                <span class="medien-kasten-rechte__klein">{{
                                    beleg.datei
                                        ? `${beleg.datei.name} (${groesse(beleg.datei.size)})`
                                        : t("medien.formular.belegOhneDatei")
                                }}</span>
                                <span v-if="belegBefunde.get('evidence.file')" class="medien-kasten-rechte__befund">{{
                                    belegBefunde.get("evidence.file")
                                }}</span>
                            </span>
                        </template>
                        <template v-if="belegArt.text">
                            <label :for="`${id}-belegtext`" class="oben">{{ t("medien.formular.belegText") }}</label>
                            <span class="medien-kasten-rechte__wert">
                                <AvmTextbereich
                                    :id="`${id}-belegtext`"
                                    v-model="beleg.text"
                                    :zeilen="2"
                                    :ungueltig="belegBefunde.has('evidence.text')"
                                    testid="medien-beleg-text"
                                />
                                <span v-if="belegBefunde.get('evidence.text')" class="medien-kasten-rechte__befund">{{
                                    belegBefunde.get("evidence.text")
                                }}</span>
                            </span>
                        </template>
                        <span v-if="belegBefunde.get('evidence.kind')" class="medien-kasten-rechte__befund breit">{{
                            belegBefunde.get("evidence.kind")
                        }}</span>
                        <span class="medien-kasten-rechte__klein breit">{{ t("medien.formular.belegPrivat") }}</span>
                    </fieldset>
                    <AvmHinweis v-if="belegFehler" :ton="belegFehler.ton" rolle="alert" testid="medien-beleg-fehler">{{
                        belegFehler.text
                    }}</AvmHinweis>
                    <div class="medien-kasten-rechte__fuss">
                        <AvmKnopf groesse="zeile" testid="medien-beleg-abbrechen" @click="belegOffen = false">{{
                            t("medien.bearbeiten.abbrechen")
                        }}</AvmKnopf>
                        <AvmKnopf
                            art="gefuellt"
                            groesse="zeile"
                            typ="submit"
                            :gesperrt="belegSendet ? t('medien.bearbeiten.sendet') : undefined"
                            testid="medien-beleg-anhaengen"
                            >{{ t("medien.bearbeiten.belegAnhaengen") }}</AvmKnopf
                        >
                    </div>
                </form>
            </div>
        </template>
    </MedienKasten>
</template>

<style scoped>
/* Die Prüfung: „Prüfung · Stand“, darunter die drei Entscheide und EIN Satz (Blatt 1). */
.medien-kasten-rechte__pruefung {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4) var(--space-10);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

.medien-kasten-rechte__beschriftung {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-kasten-rechte__stand {
    font-size: var(--font-size-small);
}

.medien-kasten-rechte__entscheide,
.medien-kasten-rechte__satz,
.medien-kasten-rechte__voll {
    grid-column: 1 / -1;
}

.medien-kasten-rechte__entscheide {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.medien-kasten-rechte__satz,
.medien-kasten-rechte__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.medien-kasten-rechte__beleg {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.medien-kasten-rechte__belegform {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.medien-kasten-rechte__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-10);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.medien-kasten-rechte__felder > label {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-kasten-rechte__felder > .oben {
    align-self: start;
    padding-top: var(--space-4);
}

.medien-kasten-rechte__felder > .breit {
    grid-column: 1 / -1;
}

.medien-kasten-rechte__wert {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.medien-kasten-rechte__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}

.medien-kasten-rechte__dateiknopf {
    position: relative;
    display: inline-flex;
    align-self: start;
    padding: var(--space-2) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: pointer;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-kasten-rechte__dateiknopf:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.medien-kasten-rechte__dateiknopf:focus-within {
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.medien-kasten-rechte__dateieingabe {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.medien-kasten-rechte__fuss {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .medien-kasten-rechte__dateiknopf {
        transition: none;
    }
}
</style>
