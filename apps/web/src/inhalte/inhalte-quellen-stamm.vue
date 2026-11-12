<script setup lang="ts">
import { computed } from "vue";
import { SOURCE_TYPES, type InhalteKorpusVorgabe, type InhalteQuelle } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { vorgabeNamen } from "./inhalte-korpora-texte";
import { lizenzWert } from "./inhalte-quellen-modell";
import type { QuellenSteuerung } from "./inhalte-quellen-steuerung";

/**
 * Spalte 2 des Reiters „Quellen“ (WI-0254; Mockup): die Stammdaten der gewählten Quelle, gemeinsam für alle ihre Verwendungen.
 *
 * - **Identität:** Titel, Quellentyp, Adresse (die Identität der Quelle, nicht änderbar: eine andere Adresse ist eine andere Quelle),
 *   Korpus-Domain mit dem Weg in den Reiter „Korpora“, Offiziell. **Nachweis und Rechte:** Lizenz (gemeinsamer Katalog), Namensnennung.
 *   **Wiki und Herkunft:** Wiki-Schlüssel einer URL-losen Publikation und die Herkunft des Eintrags.
 * - 🔴 **„Nicht erfasst“ heißt nie „frei“:** Die Auswahl der Lizenz führt „Nicht erfasst“ als eigenen Wert, die Mockup-Beispiele „Externer
 *   Link“ und „Kein Medium hinterlegt“ gibt es im Modell nicht (Aussage `unrecorded`, `license`, `public_domain`, `unfree`).
 * - Ein Konflikt (409) steht als Kasten oben, im Wortlaut der Karteneditoren (`EntwurfKonflikt`); der Entwurf bleibt sichtbar.
 * - Ohne Schreibrecht (Reviewer) und für eine stillgelegte Quelle sind alle Felder gesperrt, mit dem Grund als Zettel.
 */
const props = defineProps<{
    steuerung: QuellenSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ oeffneKorpus: [korpusId: string]; zurueck: []; weiter: [] }>();

const s = props.steuerung;
const quelle = computed(() => s.quelle.value);
const stand = computed(() => s.stand.value);
const felder = computed(() => stand.value?.felder);

/** Warum nichts änderbar ist: EIN Satz oben in der Spalte; die Felder darunter bleiben still gesperrt (leerer Satz, Guide §7). */
const sperrSatz = computed<string | undefined>(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    if (felder.value?.aktiv === false) return t("inhalte.stamm.stillgelegt");
    return undefined;
});
const sperre = computed<string | undefined>(() => (sperrSatz.value === undefined ? undefined : ""));
/**
 * Was der Korpus der Domain vorgibt (Belegstelle mit gesetzter Vorgabe, WI-0254 Runde 4): Art, Offiziell, Lizenz und Namensnennung gelten für ALLE Quellen der
 * Domain und lassen sich nur am Korpus ändern; sonst würde der nächste Durchschlag sie zurücksetzen. An der Quelle sind sie gesperrt, mit EINEM Satz.
 */
const vorgegeben = computed(() => quelle.value?.korpus?.gibtVor ?? []);
const vorgabeSperre = (feld: InhalteKorpusVorgabe): string | undefined =>
    sperre.value ?? (vorgegeben.value.includes(feld) ? "" : undefined);

const typOptionen = computed<readonly { wert: string; text: string }[]>(() =>
    SOURCE_TYPES.map((typ) => ({ wert: typ, text: t(`infoPanel.sourceType.${typ}` as MessageKey) })),
);
const jaNein = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "ja", text: t("inhalte.ja") },
    { wert: "nein", text: t("inhalte.nein") },
]);
const lizenzOptionen = computed<readonly { wert: string; text: string }[]>(() => [
    { wert: "unrecorded", text: t("inhalte.lizenz.nichtErfasst") },
    ...(quelle.value?.lizenzen ?? []).map((lizenz) => ({ wert: `license:${lizenz.key}`, text: lizenz.name })),
    { wert: "public_domain", text: t("infoPanel.source.licensePublicDomain") },
    { wert: "unfree", text: t("infoPanel.source.licenseUnfree") },
]);

const titel = computed({
    get: () => felder.value?.title ?? "",
    set: (wert: string) => s.setzeFeldWert("title", wert),
});
const typ = computed({
    get: () => felder.value?.sourceType ?? "sonstiges",
    set: (wert: string) => s.setzeFeldWert("sourceType", wert as InhalteQuelle["sourceType"]),
});
const offiziell = computed({
    get: () => (felder.value?.isOfficial === true ? "ja" : "nein"),
    set: (wert: string) => s.setzeFeldWert("isOfficial", wert === "ja"),
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

const ersterReiter = computed(() =>
    quelle.value?.herkunft === "editor" ? t("inhalte.herkunft.editor") : t("inhalte.herkunft.legacy"),
);
const identitaet = computed(() => {
    const q = quelle.value;
    if (q === undefined) return "";
    if (q.identitaet === "wikipub") return t("inhalte.stamm.wikiKey", { key: q.wikiKey ?? "" });
    return q.url === null ? t("inhalte.stamm.ohneWikiKey") : "";
});
const unterzeile = computed(() => {
    const q = quelle.value;
    if (q === undefined) return undefined;
    return t("inhalte.stamm.unterzeile", {
        typ: t(`infoPanel.sourceType.${felder.value?.sourceType ?? q.sourceType}` as MessageKey),
    });
});

const FELD_NAMEN: Readonly<Record<string, MessageKey>> = {
    title: "inhalte.feld.titel",
    sourceType: "inhalte.feld.typ",
    isOfficial: "inhalte.feld.offiziell",
    lizenzAussage: "inhalte.feld.lizenz",
    attribution: "inhalte.feld.nennung",
    editorNote: "inhalte.feld.kommentar",
    aktiv: "inhalte.feld.aktiv",
};
/** Ein Feld der Quelle oder eine Verwendung (`<art>:<kennung>`) in Worten. */
function feldName(schluessel: string): string {
    const bekannt = FELD_NAMEN[schluessel];
    if (bekannt !== undefined) return t(bekannt);
    const [art, kennung] = schluessel.split(":");
    const verwendung = stand.value?.verwendungen.find((v) => v.kind === art && v.carrierId === kennung);
    return verwendung === undefined ? t("inhalte.feld.verwendung") : verwendung.name;
}

const speicherSatz = computed(() => {
    const z = s.zustand.value;
    if (z.art !== "abgelehnt") return undefined;
    return z.code === "titel_leer" ? t("inhalte.fehler.titelLeer") : z.satz;
});
const stillgelegt = computed(() => felder.value?.aktiv === false);
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="
            quelle
                ? felder?.title === ''
                    ? t('inhalte.ohneTitel')
                    : (felder?.title ?? quelle.title)
                : t('inhalte.stamm.titel')
        "
        :unterzeile="unterzeile"
        testid="inhalte-spalte-stamm"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-liste" @click="emit('zurueck')">{{
                t("inhalte.zurueck.liste")
            }}</AvmKnopf>
        </template>
        <template v-if="quelle && darfSchreiben" #kopf>
            <AvmKnopf
                groesse="zeile"
                :title="stillgelegt ? t('inhalte.stamm.zurueckholen') : t('inhalte.stamm.unterdruecken')"
                :aria-label="stillgelegt ? t('inhalte.stamm.zurueckholen') : t('inhalte.stamm.unterdruecken')"
                testid="inhalte-quelle-unterdruecken"
                @click="s.setzeFeldWert('aktiv', stillgelegt)"
            >
                {{ stillgelegt ? "↺" : "✕" }}
            </AvmKnopf>
        </template>

        <p v-if="s.quelleLaedt.value && !quelle" class="stamm__leise">{{ t("inhalte.laedt") }}</p>
        <AvmHinweis v-else-if="s.quelleFehler.value" ton="warnung" rolle="alert" testid="inhalte-quelle-fehler">
            {{ s.quelleFehler.value.status === 404 ? t("inhalte.quelle.fehlt") : t("inhalte.quelle.fehler") }}
        </AvmHinweis>
        <p v-else-if="!quelle" class="stamm__leise" data-testid="inhalte-stamm-leer">{{ t("inhalte.stamm.leer") }}</p>

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

            <div class="stamm__chips" data-testid="inhalte-quelle-chips">
                <AvmPille :ton="quelle.herkunft === 'editor' ? 'warnung' : 'neutral'">{{ ersterReiter }}</AvmPille>
                <AvmPille v-if="identitaet !== ''">{{ identitaet }}</AvmPille>
                <AvmPille v-if="stillgelegt" ton="gefahr">{{ t("inhalte.stamm.unterdrueckt") }}</AvmPille>
            </div>

            <AvmHinweis testid="inhalte-quelle-gemeinsam">
                {{ t("inhalte.stamm.gemeinsam") }}
            </AvmHinweis>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.abschnitt.identitaet") }}</h4>
                <FensterFeldzeile :name="t('inhalte.feld.titel') + ' *'" fuer="inhalte-feld-titel">
                    <AvmEingabe
                        id="inhalte-feld-titel"
                        v-model="titel"
                        required
                        :gesperrt="sperre"
                        :ungueltig="titel.trim() === ''"
                        testid="inhalte-feld-titel"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.feld.typ')" fuer="inhalte-feld-typ">
                    <AvmAuswahl
                        id="inhalte-feld-typ"
                        v-model="typ"
                        :optionen="typOptionen"
                        :gesperrt="vorgabeSperre('sourceType')"
                        testid="inhalte-feld-typ"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.feld.adresse')">
                    <span class="stamm__lesen einzeilig" data-testid="inhalte-feld-adresse">
                        <FensterVerweis v-if="quelle.url !== null" :ziel="quelle.url">{{ quelle.url }}</FensterVerweis>
                        <template v-else>{{ quelle.url ?? t("inhalte.stamm.ohneAdresse") }}</template>
                    </span>
                </FensterFeldzeile>
                <p class="stamm__notiz">
                    {{ quelle.url === null ? t("inhalte.stamm.adresse.ohne") : t("inhalte.stamm.adresse.identitaet") }}
                </p>
                <FensterFeldzeile :name="t('inhalte.feld.korpus')">
                    <span class="stamm__lesen" data-testid="inhalte-feld-korpus">{{
                        quelle.korpus?.key ?? quelle.domain ?? "—"
                    }}</span>
                </FensterFeldzeile>
                <p class="stamm__notiz stamm__notiz--knopf">
                    <AvmKnopf
                        v-if="quelle.korpus"
                        groesse="zeile"
                        testid="inhalte-korpus-oeffnen"
                        @click="emit('oeffneKorpus', quelle.korpus.id)"
                    >
                        {{ t("inhalte.stamm.korpus.oeffnen") }} ↗
                    </AvmKnopf>
                    <span>{{
                        quelle.korpus
                            ? t("inhalte.stamm.korpus.domain")
                            : quelle.domain
                              ? t("inhalte.stamm.korpus.keiner")
                              : t("inhalte.stamm.korpus.ohneUrl")
                    }}</span>
                </p>
                <AvmHinweis v-if="vorgegeben.length > 0" ton="warnung" testid="inhalte-korpus-vorgabe-gesperrt">
                    {{
                        t("inhalte.stamm.korpus.vorgabe", {
                            korpus:
                                quelle.korpus?.label === "" ? (quelle.korpus?.key ?? "") : (quelle.korpus?.label ?? ""),
                            felder: vorgabeNamen(vorgegeben),
                        })
                    }}
                </AvmHinweis>
                <FensterFeldzeile :name="t('inhalte.feld.offiziell')" fuer="inhalte-feld-offiziell">
                    <AvmAuswahl
                        id="inhalte-feld-offiziell"
                        v-model="offiziell"
                        :optionen="jaNein"
                        :gesperrt="vorgabeSperre('isOfficial')"
                        testid="inhalte-feld-offiziell"
                    />
                </FensterFeldzeile>
            </section>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.abschnitt.rechte") }}</h4>
                <FensterFeldzeile :name="t('inhalte.feld.lizenz')" fuer="inhalte-feld-lizenz">
                    <AvmAuswahl
                        id="inhalte-feld-lizenz"
                        v-model="lizenz"
                        :optionen="lizenzOptionen"
                        :gesperrt="vorgabeSperre('lizenz')"
                        testid="inhalte-feld-lizenz"
                    />
                </FensterFeldzeile>
                <p v-if="felder.lizenzAussage === 'unrecorded'" class="stamm__notiz">
                    {{ t("inhalte.lizenz.hinweis") }}
                </p>
                <FensterFeldzeile :name="t('inhalte.feld.nennung')" fuer="inhalte-feld-nennung">
                    <AvmEingabe
                        id="inhalte-feld-nennung"
                        v-model="nennung"
                        :placeholder="t('inhalte.feld.nennung.platzhalter')"
                        :gesperrt="vorgabeSperre('attribution')"
                        testid="inhalte-feld-nennung"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.feld.kommentar')" fuer="inhalte-feld-kommentar" oben>
                    <AvmTextbereich
                        id="inhalte-feld-kommentar"
                        v-model="kommentar"
                        :zeilen="3"
                        :gesperrt="sperre"
                        testid="inhalte-feld-kommentar"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <AvmKnopf v-if="telefon" groesse="zeile" testid="inhalte-weiter-verwendungen" @click="emit('weiter')">
                {{ t("inhalte.weiter.verwendungen") }} ›
            </AvmKnopf>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.abschnitt.herkunft") }}</h4>
                <FensterFeldzeile :name="t('inhalte.feld.wikiKey')">
                    <span class="stamm__lesen" data-testid="inhalte-feld-wikikey">{{ quelle.wikiKey ?? "—" }}</span>
                </FensterFeldzeile>
                <AvmHinweis>{{ t("inhalte.stamm.getrennt") }}</AvmHinweis>
            </section>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.stamm__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.stamm__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
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

.stamm__lesen {
    display: block;
    min-width: 0;
    color: var(--color-text-muted);
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
</style>
