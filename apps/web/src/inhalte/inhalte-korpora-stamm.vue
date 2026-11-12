<script setup lang="ts">
import { computed } from "vue";
import { SOURCE_TYPES, type SourceType } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InhalteKorporaWirkung from "./inhalte-korpora-wirkung.vue";
import { formAusWert, lizenzWert, schreibtDurch } from "./inhalte-korpora-modell";
import type { KorporaSteuerung } from "./inhalte-korpora-steuerung";
import { formName } from "./inhalte-korpora-texte";

/**
 * Spalte 2 des Reiters „Korpora“ (WI-0254, Runde 4; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): die Angaben des gewählten Korpus und die Vorgabe
 * für die Quellen seiner Domain.
 *
 * - **Identität und Anzeigeform:** der Schlüssel (die registrierbare Domain, unveränderlich), der Name des Angebots und die Anzeigeform samt Vorschau, wie die
 *   erste Quelle der Domain danach erscheint. Der Name ersetzt nie den Titel einer Seite; die Form sagt nur, welcher von beiden vorn steht.
 * - 🔴 **Korpusweite Angaben:** Art, „offiziell“, Lizenz und Namensnennung. Bei einer Belegstelle gelten sie für ALLE Quellen der Domain, ohne Ausnahme je
 *   Quelle (Vali: „wenn ich da was änder, änderts überall, was den Korpus verwendet“); „Speichern“ schreibt sie in EINER Operation durch. Bei Werk und
 *   unentschiedener Form schreibt nichts durch: Die vier Felder sind gesperrt, mit einem Satz, und bleiben an der Quelle.
 * - **Wirkung prüfen** rechnet vor dem Speichern, wie viele Quellen sich ändern und wie viele davon eine andere Angabe überschreiben. Trifft die Änderung ab
 *   zehn Quellen, fragt das Fenster oben nach, mit derselben Rechnung.
 * - Ein Konflikt (409) steht als Kasten oben, im Wortlaut der Karteneditoren (`EntwurfKonflikt`); der Entwurf bleibt sichtbar.
 */
const props = defineProps<{
    steuerung: KorporaSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: []; weiter: [] }>();

const s = props.steuerung;
const korpus = computed(() => s.korpus.value);
const stand = computed(() => s.stand.value);
const felder = computed(() => stand.value?.felder);

/** Warum nichts änderbar ist: EIN Satz oben in der Spalte; die Felder darunter bleiben still gesperrt (leerer Satz, Guide §7). */
const sperrSatz = computed<string | undefined>(() => (!props.darfSchreiben ? t("inhalte.nurLesen") : undefined));
const sperre = computed<string | undefined>(() => (sperrSatz.value === undefined ? undefined : ""));
/** Die vier Felder der Vorgabe: gesperrt, solange die Anzeigeform nicht durchschreibt. */
const vorgabeGesperrt = computed(() => felder.value !== undefined && !schreibtDurch(felder.value));
const vorgabeSperre = computed<string | undefined>(() =>
    sperre.value !== undefined || vorgabeGesperrt.value ? "" : undefined,
);

const formOptionen = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "", text: t("inhalte.korpora.form.unentschieden") },
    { wert: "werk", text: t("inhalte.korpora.form.werk") },
    { wert: "belegstelle", text: t("inhalte.korpora.form.belegstelle") },
]);
const typOptionen = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "", text: t("inhalte.korpora.feld.typ.keine") },
    ...SOURCE_TYPES.map((typ) => ({ wert: typ, text: t(`infoPanel.sourceType.${typ}` as MessageKey) })),
]);
const offiziellOptionen = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "", text: t("inhalte.korpora.feld.offiziell.keine") },
    { wert: "ja", text: t("inhalte.ja") },
    { wert: "nein", text: t("inhalte.nein") },
]);
const lizenzOptionen = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "unrecorded", text: t("inhalte.lizenz.nichtErfasst") },
    ...(korpus.value?.lizenzen ?? []).map((lizenz) => ({ wert: `license:${lizenz.key}`, text: lizenz.name })),
    { wert: "public_domain", text: t("infoPanel.source.licensePublicDomain") },
    { wert: "unfree", text: t("infoPanel.source.licenseUnfree") },
]);

const name = computed({
    get: () => felder.value?.label ?? "",
    set: (wert: string) => s.setzeFeldWert("label", wert),
});
const form = computed({
    get: () => felder.value?.form ?? "",
    set: (wert: string) => s.setzeFormWert(formAusWert(wert)),
});
const typ = computed({
    get: () => felder.value?.sourceType ?? "",
    set: (wert: string) => s.setzeFeldWert("sourceType", wert === "" ? null : (wert as SourceType)),
});
const offiziell = computed({
    get: () =>
        felder.value?.isOfficial === null || felder.value === undefined ? "" : felder.value.isOfficial ? "ja" : "nein",
    set: (wert: string) => s.setzeFeldWert("isOfficial", wert === "" ? null : wert === "ja"),
});
const lizenz = computed({
    get: () => (felder.value === undefined ? "unrecorded" : lizenzWert(felder.value)),
    set: (wert: string) => s.setzeLizenzWert(wert),
});
const nennung = computed({
    get: () => felder.value?.attribution ?? "",
    set: (wert: string) => s.setzeFeldWert("attribution", wert),
});
const kommentar = computed({
    get: () => felder.value?.editorNote ?? "",
    set: (wert: string) => s.setzeFeldWert("editorNote", wert),
});

/** Der Name, der vorn steht, wo noch keiner vergeben ist: die Domain. */
const anzeigeName = computed(() => {
    const f = felder.value;
    const k = korpus.value;
    if (f === undefined || k === undefined) return "";
    return f.label.trim() === "" ? k.key : f.label.trim();
});
const vorschau = computed(() => {
    const f = felder.value;
    const k = korpus.value;
    if (f === undefined || k === undefined) return undefined;
    const erste = k.quellen[0];
    if (erste === undefined) return { vorn: anzeigeName.value, hinten: "", url: undefined, keine: true };
    return f.form === "belegstelle"
        ? { vorn: anzeigeName.value, hinten: erste.title, url: erste.url ?? undefined, keine: false }
        : { vorn: erste.title, hinten: anzeigeName.value, url: erste.url ?? undefined, keine: false };
});

const FELD_NAMEN: Readonly<Record<string, MessageKey>> = {
    label: "inhalte.korpora.feld.name",
    form: "inhalte.korpora.feld.form",
    sourceType: "inhalte.korpora.feld.typ",
    isOfficial: "inhalte.korpora.feld.offiziell",
    lizenzAussage: "inhalte.feld.lizenz",
    attribution: "inhalte.feld.nennung",
    editorNote: "inhalte.feld.kommentar",
};
const feldName = (schluessel: string): string => t(FELD_NAMEN[schluessel] ?? "inhalte.feld.verwendung");

const speicherSatz = computed(() => {
    const z = s.zustand.value;
    // Die Rückfrage steht als eigener Kasten da; der Fuß nennt sie, der Satz bliebe doppelt.
    return z.art === "abgelehnt" && z.code !== "corpus_confirm_required" ? z.satz : undefined;
});
const herkunftName = computed(() =>
    korpus.value?.herkunft === "editor" ? t("inhalte.herkunft.editor") : t("inhalte.herkunft.legacy"),
);
const zahl = (n: number): string => formatNumber(n, 0);

const wirkungKnopfSperre = computed<string | undefined>(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    return s.wirkung.value.art === "laedt" ? t("inhalte.korpora.wirkung.laedt") : undefined;
});
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="korpus ? anzeigeName : t('inhalte.korpora.stamm.titel')"
        :unterzeile="korpus ? t('inhalte.korpora.stamm.unterzeile') : undefined"
        testid="inhalte-spalte-stamm"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-liste" @click="emit('zurueck')">{{
                t("inhalte.korpora.zurueck.liste")
            }}</AvmKnopf>
        </template>

        <p v-if="s.korpusLaedt.value && !korpus" class="stamm__leise">{{ t("inhalte.laedt") }}</p>
        <AvmHinweis v-else-if="s.korpusFehler.value" ton="warnung" rolle="alert" testid="inhalte-korpus-fehler">
            {{ s.korpusFehler.value.status === 404 ? t("inhalte.korpora.fehlt") : t("inhalte.korpora.fehler") }}
        </AvmHinweis>
        <p v-else-if="!korpus" class="stamm__leise" data-testid="inhalte-stamm-leer">
            {{ t("inhalte.korpora.stamm.leer") }}
        </p>

        <template v-else-if="felder">
            <EntwurfKonflikt
                v-if="s.zustand.value.art === 'konflikt'"
                :bearbeitung="{
                    eigeneAnwenden: (trotzdem?: boolean) => s.eigeneAnwenden(trotzdem),
                    fremdenUebernehmen: () => s.fremdenUebernehmen(),
                }"
                :konflikt="s.zustand.value"
                :feld-name="feldName"
                kennung="inhalte"
            />
            <AvmHinweis v-if="sperrSatz" ton="warnung" testid="inhalte-stamm-sperre">{{ sperrSatz }}</AvmHinweis>
            <AvmHinweis v-if="speicherSatz" ton="gefahr" rolle="alert" testid="inhalte-speichern-fehler">{{
                speicherSatz
            }}</AvmHinweis>

            <AvmBestaetigung
                v-if="s.rueckfrage.value"
                :frage="
                    t('inhalte.korpora.rueckfrage.frage', {
                        aendern: zahl(s.rueckfrage.value.aendern),
                        quellen: zahl(s.rueckfrage.value.quellen),
                    })
                "
                :folge="t('inhalte.korpora.rueckfrage.folge')"
                :bestaetigen="t('inhalte.korpora.rueckfrage.bestaetigen', { n: zahl(s.rueckfrage.value.aendern) })"
                :abbrechen="t('inhalte.korpora.rueckfrage.bleiben')"
                testid="inhalte-korpora-rueckfrage"
                @bestaetigen="void s.schreibeTrotzdem()"
                @abbrechen="s.bleibeBeimEntwurf()"
            >
                <InhalteKorporaWirkung
                    v-if="s.wirkung.value.art === 'da'"
                    :wirkung="s.wirkung.value.wirkung"
                    :lizenzen="korpus.lizenzen"
                    testid="inhalte-korpora-rueckfrage-wirkung"
                />
                <p v-else-if="s.wirkung.value.art === 'laedt'" class="stamm__leise">
                    {{ t("inhalte.korpora.wirkung.laedt") }}
                </p>
            </AvmBestaetigung>

            <div class="stamm__chips" data-testid="inhalte-korpus-chips">
                <AvmPille>{{ t("inhalte.korpora.pille") }}</AvmPille>
                <AvmPille :ton="korpus.herkunft === 'editor' ? 'warnung' : 'neutral'">{{ herkunftName }}</AvmPille>
            </div>

            <AvmHinweis testid="inhalte-korpus-gemeinsam">{{ t("inhalte.korpora.stamm.gemeinsam") }}</AvmHinweis>

            <dl class="stamm__zahlen" data-testid="inhalte-korpus-zahlen">
                <div class="zahl">
                    <dt>{{ t("inhalte.korpora.zahl.quellen") }}</dt>
                    <dd data-testid="inhalte-korpus-zahl-quellen">{{ zahl(korpus.quellenGesamt) }}</dd>
                </div>
                <div class="zahl">
                    <dt>{{ t("inhalte.korpora.zahl.traeger") }}</dt>
                    <dd data-testid="inhalte-korpus-zahl-traeger">{{ zahl(korpus.traegerGesamt) }}</dd>
                </div>
                <div class="zahl">
                    <dt>{{ t("inhalte.korpora.zahl.abweichend") }}</dt>
                    <dd data-testid="inhalte-korpus-zahl-abweichend">{{ zahl(korpus.abweichendGesamt) }}</dd>
                </div>
            </dl>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.korpora.abschnitt.identitaet") }}</h4>
                <FensterFeldzeile :name="t('inhalte.korpora.feld.schluessel')">
                    <span class="stamm__schluessel" data-testid="inhalte-feld-schluessel">{{ korpus.key }}</span>
                </FensterFeldzeile>
                <p class="stamm__notiz">{{ t("inhalte.korpora.stamm.schluessel") }}</p>
                <FensterFeldzeile :name="t('inhalte.korpora.feld.name')" fuer="inhalte-feld-korpusname">
                    <AvmEingabe
                        id="inhalte-feld-korpusname"
                        v-model="name"
                        :placeholder="t('inhalte.korpora.feld.name.platzhalter')"
                        :gesperrt="sperre"
                        testid="inhalte-feld-korpusname"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.korpora.feld.form')" fuer="inhalte-feld-form">
                    <AvmAuswahl
                        id="inhalte-feld-form"
                        v-model="form"
                        :optionen="formOptionen"
                        :gesperrt="sperre"
                        testid="inhalte-feld-form"
                    />
                </FensterFeldzeile>
                <p class="stamm__notiz">{{ t("inhalte.korpora.stamm.form") }}</p>
                <div v-if="vorschau" class="stamm__vorschau" data-testid="inhalte-korpus-vorschau">
                    <span class="stamm__klein">{{ t("inhalte.korpora.vorschau.titel") }}</span>
                    <span class="stamm__vorn" data-testid="inhalte-korpus-vorschau-vorn">
                        {{ vorschau.vorn }}
                        <span v-if="vorschau.hinten !== ''" class="stamm__leise" :title="vorschau.hinten">ⓘ</span>
                    </span>
                    <span v-if="vorschau.url" class="stamm__adresse">{{ vorschau.url }}</span>
                    <span class="stamm__klein">
                        {{
                            vorschau.keine
                                ? t("inhalte.korpora.vorschau.keine")
                                : t("inhalte.korpora.vorschau.hinten", { hinten: vorschau.hinten })
                        }}
                    </span>
                </div>
            </section>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.korpora.abschnitt.angaben") }}</h4>
                <AvmHinweis :ton="vorgabeGesperrt ? 'warnung' : 'neutral'" testid="inhalte-korpus-vorgabe-hinweis">
                    {{
                        vorgabeGesperrt
                            ? t("inhalte.korpora.vorgabe.gesperrt", { form: formName(felder.form) })
                            : t("inhalte.korpora.vorgabe.hinweis")
                    }}
                </AvmHinweis>
                <FensterFeldzeile :name="t('inhalte.korpora.feld.typ')" fuer="inhalte-feld-korpustyp">
                    <AvmAuswahl
                        id="inhalte-feld-korpustyp"
                        v-model="typ"
                        :optionen="typOptionen"
                        :gesperrt="vorgabeSperre"
                        testid="inhalte-feld-korpustyp"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.korpora.feld.offiziell')" fuer="inhalte-feld-korpusoffiziell">
                    <AvmAuswahl
                        id="inhalte-feld-korpusoffiziell"
                        v-model="offiziell"
                        :optionen="offiziellOptionen"
                        :gesperrt="vorgabeSperre"
                        testid="inhalte-feld-korpusoffiziell"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.feld.lizenz')" fuer="inhalte-feld-korpuslizenz">
                    <AvmAuswahl
                        id="inhalte-feld-korpuslizenz"
                        v-model="lizenz"
                        :optionen="lizenzOptionen"
                        :gesperrt="vorgabeSperre"
                        testid="inhalte-feld-korpuslizenz"
                    />
                </FensterFeldzeile>
                <p v-if="felder.lizenzAussage === 'unrecorded'" class="stamm__notiz">
                    {{ t("inhalte.lizenz.hinweis") }}
                </p>
                <FensterFeldzeile :name="t('inhalte.feld.nennung')" fuer="inhalte-feld-korpusnennung">
                    <AvmEingabe
                        id="inhalte-feld-korpusnennung"
                        v-model="nennung"
                        :placeholder="t('inhalte.feld.nennung.platzhalter')"
                        :gesperrt="vorgabeSperre"
                        testid="inhalte-feld-korpusnennung"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.korpora.abschnitt.redaktion") }}</h4>
                <FensterFeldzeile :name="t('inhalte.feld.kommentar')" fuer="inhalte-feld-korpuskommentar" oben>
                    <AvmTextbereich
                        id="inhalte-feld-korpuskommentar"
                        v-model="kommentar"
                        :zeilen="3"
                        :gesperrt="sperre"
                        testid="inhalte-feld-korpuskommentar"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <section class="stamm__abschnitt" data-testid="inhalte-korpus-wirkung-abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.korpora.abschnitt.wirkung") }}</h4>
                <div class="stamm__wirkung">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="wirkungKnopfSperre"
                        testid="inhalte-korpus-wirkung-pruefen"
                        @click="void s.pruefeWirkung()"
                    >
                        ⇄ {{ t("inhalte.korpora.wirkung.pruefen") }}
                    </AvmKnopf>
                    <span class="stamm__klein">{{ t("inhalte.korpora.wirkung.hilfe") }}</span>
                </div>
                <p v-if="s.wirkung.value.art === 'laedt'" class="stamm__leise">
                    {{ t("inhalte.korpora.wirkung.laedt") }}
                </p>
                <AvmHinweis
                    v-else-if="s.wirkung.value.art === 'fehler'"
                    ton="warnung"
                    rolle="alert"
                    testid="inhalte-korpus-wirkung-fehler"
                >
                    {{ t("inhalte.korpora.wirkung.fehler") }}
                </AvmHinweis>
                <InhalteKorporaWirkung
                    v-else-if="s.wirkung.value.art === 'da' && !s.rueckfrage.value"
                    :wirkung="s.wirkung.value.wirkung"
                    :lizenzen="korpus.lizenzen"
                />
            </section>

            <AvmKnopf v-if="telefon" groesse="zeile" testid="inhalte-weiter-quellen" @click="emit('weiter')">
                {{ t("inhalte.korpora.weiter.quellen") }} ›
            </AvmKnopf>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.stamm__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.stamm__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.stamm__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.stamm__zahlen {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
    margin: 0;
}

.zahl {
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.zahl dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zahl dd {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-variant-numeric: tabular-nums;
}

.stamm__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.stamm__kopf {
    margin: var(--space-6) 0 0;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.stamm__schluessel {
    display: block;
    min-width: 0;
    color: var(--color-accent-strong);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.stamm__notiz {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    margin: 0 0 0 calc(var(--avm-field-label-w) + var(--space-8));
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.stamm__vorschau {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.stamm__vorn {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    overflow-wrap: anywhere;
}

.stamm__adresse {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
}

.stamm__wirkung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
}
</style>
