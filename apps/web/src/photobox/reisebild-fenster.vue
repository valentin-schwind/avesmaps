<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { neuesFormular } from "../community/api";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage, FensterVorgabeEcke } from "../fenster/fenster-lage";
import { showToast } from "../feedback/toast";
import type { MessageKey } from "../i18n/de";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { ReisebildHinweisZiel } from "../legal/hinweise-ziel";
import { fehlerSatzFuer, fehlerText, ladeStand, reisebildAdresse, sendeEinreichung, type FehlerSatz } from "./api";
import { erzeugeBildWahl } from "./bild-wahl";
import {
    frischerSchutz,
    nachKopieren,
    nachMerken,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type WeiterArt,
} from "./fertig-schutz";
import { drahtBody, fehlendes, leererEntwurf, type ReisebildEntwurf } from "./formular-modell";
import { REISEBILD_FENSTER } from "./fenster-linie";
import { useLinkKopieren } from "./link-kopieren";
import { merkliste } from "./meine-reisebilder";
import type { ReisebildAnzeige, ReisebildSteuerung } from "./reisebild-besucher";
import ReisebildFertigFuss from "./reisebild-fertig-fuss.vue";
import ReisebildFertig from "./reisebild-fertig.vue";
import ReisebildFormularFuss from "./reisebild-formular-fuss.vue";
import ReisebildFormular from "./reisebild-formular.vue";
import { stelleText } from "./stelle-text";

/**
 * Das Fenster „Eigenes Bild hinzufügen“ (WI-0272 S2b, Aufgabe 13; Gestaltung: Probierseite Entwurf 8, vom Betreiber abgenommen am 2026-11-01). Ein Werkzeugfenster der Hülle (`AvmFenster`, §12.6) wie das
 * Meldeformular: gelöst und mittig über der Karte, angedockt (▥) am rechten Rand, am Telefon das Blatt unten, ohne Ablage, je Ansicht in einer festen Höhe (`stabil`). Dieses Bauteil hält den Zustand (Entwurf, Absenden,
 * Bestätigung) und den Fuß; der Rumpf des Formulars steht in `reisebild-formular.vue`, der Fuß in `reisebild-formular-fuss.vue`. Was gerechnet wird, steht in `formular-modell.ts`, die Stelle in
 * Worten in `stelle-text.ts`, die Aufrufe in `api.ts`, das Bild in `bild.ts` und `bild-wahl.ts`, die Karte in `stelle-layer.ts`.
 *
 * - **Reihenfolge wie WI §5.1:** Stelle (mit „Stelle ändern“), Bild, Bildbeschreibung mit Bezugsvorschlägen, Entstanden als, Blickrichtung und Name, Nutzung, Erklärung als Häkchen. Pflicht sind das Bild,
 *   die Beschreibung, „Entstanden als“ und das Häkchen.
 * - 🔴 **„Bild hochladen“ ist gesperrt, solange etwas fehlt, aber drückbar** (`aria-disabled`): Ein Druck zeigt den Grund im Fuß, markiert das fehlende Feld, rollt es in Sicht und setzt den Fokus hinein
 *   (`fehlendes`). Der Grund läuft danach live mit, bis alles da ist. Kein dauerhafter Satz „Es fehlt ein Bild“ mehr.
 * - **Das Bild** wird im Browser gelesen und neu kodiert (`bild.ts`): Ein Telefonfoto über 6 MB passt, und die Ortsdaten im Bild verlassen das Gerät nie. Der Dateiname geht nicht an den Server.
 * - **Netz weg:** Der Text bleibt, erneutes Senden trägt dieselbe Kennung und denselben Schlüssel und legt nie ein zweites Reisebild an (ADR-0019). **Grenze erreicht (429):** der Satz mit der Uhrzeit.
 *   **Schalter aus (503) oder `stand.einreichen` falsch:** „Einreichungen sind gerade nicht möglich“ statt eines toten Knopfs.
 * - **Honigtopf und Zeitfalle** (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht, und die Zeit seit dem Öffnen; beides geht mit.
 * - **Nach dem Einreichen** (`reisebild-fertig.vue`): „Eingereicht.“, der persönliche Link `/reisebild#…` in einem goldenen Kasten zum Kopieren, das eingereichte Bild mit dem Ablauf, „Stand ansehen“ und
 *   „Noch ein Bild von hier“. Die Stelle verschwindet von der Karte. 🔴 **Schutz vor Verlust** (`fertig-schutz.ts`): ✕, Esc, „Schließen“ und „Noch ein Bild von hier“ halten ohne kopierten Link einmal an
 *   („Link noch nicht kopiert oder gemerkt.“ im Fuß, Warnring am Kasten); der zweite Versuch geht durch. Seit Entwurf 9 (2026-11-01) trägt der Kasten das Häkchen „Auf diesem Gerät merken“ (anfangs leer, nur mit
 *   Browserspeicher; `meine-reisebilder.ts`): Gemerkt zählt wie kopiert und schließt ohne Warnung.
 * - Die Bedingungen und der volle Datenschutztext stehen unter „Hinweise“ (Aufgabe 15): Das Häkchen trägt einen Verweis zu den Bedingungen, der Kurzsatz zum Datenschutz (hinter „ⓘ Datenschutz“ im Fuß)
 *   einen zum Datenschutz „Reisebilder“; beide gehen als `hinweise` mit ihrem Ziel hinaus, die Seite öffnet die Hinweise dort.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    anzeige: Extract<ReisebildAnzeige, { art: "formular" }>;
    steuerung: ReisebildSteuerung;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    vorgabeEcke?: FensterVorgabeEcke | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
    /** „Bedingungen“ im Häkchen der Erklärung und „Mehr zum Datenschutz“ im Fuß: der Weg zu „Hinweise › Reisebilder“ beziehungsweise „Hinweise › Datenschutz“. */
    hinweise: [ziel: ReisebildHinweisZiel];
}>();

const kennung = neuesFormular();
const geoeffnet = performance.now();
const entwurf = reactive<ReisebildEntwurf>(leererEntwurf(props.anzeige.vorbelegung));
const bildWahl = erzeugeBildWahl(entwurf);
const formular = useTemplateRef<InstanceType<typeof ReisebildFormular>>("formular");
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da. */
const moeglich = ref<boolean | undefined>(undefined);
const sendet = ref(false);
const problem = ref<FehlerSatz | undefined>(undefined);
const eingereicht = ref(false);
/** Hat jemand schon auf den gesperrten Knopf gedrückt? Erst dann steht der Grund da und trägt das fehlende Feld den Warnrand. */
const versucht = ref(false);
const datenschutzOffen = ref(false);
/** Der Schutz vor Verlust des persönlichen Links in der Bestätigung (`fertig-schutz.ts`). */
const schutz = ref(frischerSchutz());
const fertig = useTemplateRef<InstanceType<typeof ReisebildFertig>>("fertig");
/** Gelingt das Kopieren, ist der Link mitgenommen (keine Warnung mehr); geht es nicht, ist er markiert, und Strg+C nimmt ihn mit. */
const linkKopie = useLinkKopieren({
    link: () => linkAdresse.value,
    erfolg: () => {
        schutz.value = nachKopieren();
    },
    misserfolg: () => fertig.value?.markiereLink(),
});
/** Lässt der Browser das Merken zu? Sonst gibt es weder Häkchen noch den Satz „… oder gemerkt“. */
const merkenMoeglich = merkliste.verfuegbar();

onMounted(() => {
    void ladeStand().then((geht) => {
        moeglich.value = geht;
    });
});
// Die Bestätigung steht: Der Fokus geht auf „Link kopieren“ (das Einreichen, das ihn hatte, ist weg), damit Esc und die Tastatur dem Fenster gelten.
// Und sie hängt ihren Wächter in die Steuerung ein: Jeder Weg, der sie ersetzen oder schließen würde (Kartenmenü, „Meine Reisebilder“, ein Fenster der Meldungen), fragt ihn zuerst.
let wacheAb: (() => void) | undefined;
watch(eingereicht, (steht) => {
    wacheAb?.();
    wacheAb = steht ? props.steuerung.schuetze(weiter) : undefined;
    if (steht) void nextTick(() => fertig.value?.fokussiereKopieren());
});
onBeforeUnmount(() => {
    wacheAb?.();
    bildWahl.gibFrei();
});

// --- Die Stelle ----------------------------------------------------------------------------------------------------------------

const stelleWorte = computed(() => stelleText(props.anzeige.stelle, props.anzeige.ort));
const imWaehlen = computed(() => props.steuerung.waehlen.value);

// --- Absenden ------------------------------------------------------------------------------------------------------------------

/** Was jetzt fehlt (das erste Pflichtfeld in der Reihenfolge des Formulars), solange das Formular offen steht. */
const fehlt = computed(() => fehlendes(entwurf));
/** Sieht der Hauptknopf gesperrt aus? Es fehlt etwas, oder das Bild wird gerade gelesen. */
const knopfGesperrt = computed(() => fehlt.value !== undefined || bildWahl.laedt.value);
/** Der Satz, warum es nicht geht: erst nach einem Druck auf den gesperrten Knopf, dann live, bis alles da ist. */
const grund = computed(() => (versucht.value && fehlt.value !== undefined ? t(fehlt.value.grund) : undefined));
const problemSatz = computed(() => (problem.value === undefined ? undefined : fehlerText(problem.value)));
/**
 * Die Ansicht des Fensters: Das Formular, die Bestätigung und der Satz „geht gerade nicht“ haben je ihre Höhe (`stabil` der Hülle misst sie beim Erscheinen einmal und hält sie), die Bestätigung
 * ist nie höher als das Formular davor (`ansicht-nie-hoeher`). Ein gewähltes Bild, Bezüge und Hinweise im Fuß ändern die Höhe nicht: Der Rumpf rollt, „Bild hochladen“ bleibt im Bild.
 */
const ansicht = computed(() => (eingereicht.value ? "fertig" : moeglich.value === false ? "gesperrt" : "formular"));
/** Steht das Formular da (nicht die Bestätigung, nicht der Satz „geht gerade nicht“)? Nur dann hat das Fenster den Fuß mit „Bild hochladen“. */
const formularOffen = computed(() => !eingereicht.value && moeglich.value !== false);
const linkAdresse = computed(() => reisebildAdresse(globalThis.location.origin, kennung.schluessel));
/** Ist der Link auf diesem Gerät gemerkt? Folgt der Merkliste, auch wenn ein anderer Tab sie ändert. */
const gemerkt = computed(() => merkliste.hat(kennung.schluessel));
/** Warum das Merken eben nicht ging (Review S3 M4); der Linkkasten sagt es leise. */
const merkenProblem = ref<"voll" | "gesperrt" | undefined>(undefined);
/** Steht die Warnung „Link noch nicht kopiert oder gemerkt.“ da (im Fuß der Hinweis, am Linkkasten der Warnring)? */
const warnt = computed(() => eingereicht.value && warnungSteht(schutz.value, gemerkt.value));
const entstehungText = computed(() =>
    entwurf.entstehung === "" ? "" : t(`photobox.entstehung.${entwurf.entstehung}` as MessageKey),
);

/** Der Druck auf „Bild hochladen“: fehlt etwas, nennt der Fuß den Grund, und das Feld wird markiert und fokussiert; sonst geht das Bild hinaus. */
function hochladenGedrueckt(): void {
    if (sendet.value || bildWahl.laedt.value) return;
    const fehlendesFeld = fehlt.value;
    if (fehlendesFeld === undefined) {
        void einreichen();
        return;
    }
    versucht.value = true;
    formular.value?.fokussiere(fehlendesFeld.feld);
}

async function einreichen(): Promise<void> {
    sendet.value = true;
    problem.value = undefined;
    try {
        await sendeEinreichung(
            drahtBody(kennung, entwurf, props.anzeige.stelle, props.anzeige.ort, performance.now() - geoeffnet),
        );
        eingereicht.value = true;
        // Die Stelle ist abgegeben: Symbol und Linie gehen von der Karte.
        props.steuerung.markiereAbgesendet();
    } catch (fehler) {
        // WI-0291: der genaue Grund des Servers (Stelle, Ort, Datei, Text), sonst der allgemeine Satz; die Uhrzeit der Drossel steht nie roh als {uhr} da.
        const jetzt = new Date();
        problem.value = fehlerSatzFuer(fehler, (bis) => relativeTime(bis, jetzt, locale.value, "zeitpunkt"), jetzt);
    } finally {
        sendet.value = false;
    }
}

/** „Stand ansehen“: Die Statusseite ersetzt die Bestätigung; die Steuerung fragt den Wächter, ob der Link dabei verloren ginge (`weiter("stand")`). */
function standAnsehen(): void {
    props.steuerung.oeffneStatus(kennung.schluessel);
}

/**
 * Den Link kopieren (der Hauptknopf im Kasten und „Kopieren“ in der Warnung). Gelingt es, ist der Link mitgenommen: Die Warnung geht, alles geht ohne Halt, und der Knopf zeigt 2,6 s „✓ Kopiert“.
 * Geht es nicht (die Zwischenablage ist gesperrt), sagt die Zeile unter dem Kasten es, und der Link ist markiert: Strg+C nimmt ihn mit. Dann bleibt alles, wie es war.
 */
const linkKopieren = (): Promise<boolean> => linkKopie.kopiere();

/**
 * Das Häkchen „Auf diesem Gerät merken“: Gemerkt, ist der Link mitgenommen wie beim Kopieren (eine Warnung, die schon stand, geht); der Speicher kann das Merken ablehnen, dann bleibt alles, wie
 * es war, und das Kästchen springt zurück. Wieder entfernt, gilt der Link nur noch als mitgenommen, wenn er kopiert ist.
 */
function merken(an: boolean): void {
    merkenProblem.value = undefined;
    if (!an) {
        merkliste.vergiss(kennung.schluessel);
        return;
    }
    const ausgang = merkliste.versuche(kennung.schluessel);
    if (ausgang === "gemerkt") schutz.value = nachMerken(schutz.value);
    else merkenProblem.value = ausgang;
}

/** Der Weg von außen, der gerade angehalten wurde (Kartenmenü, „Meine Reisebilder“, ein Fenster der Meldungen); „Trotzdem weiter“ führt ihn aus. */
let ausstehend: (() => void) | undefined;

/**
 * Ein Weg, der den Link aus dem Blick nimmt (✕, Esc, „Schließen“, „Noch ein Bild von hier“, „Stand ansehen“ und, über den Wächter der Steuerung, Kartenmenü, „Meine Reisebilder“ und ein Fenster der Meldungen):
 * `true`, wenn es weitergeht; `false`, wenn der erste Versuch ohne kopierten oder gemerkten Link anhält. Dann steht die Warnung im Fuß, und der Linkkasten rollt in Sicht (`fertig-schutz.ts`). `danach` ist
 * der Weg von außen selbst: Er wird gemerkt, und „Trotzdem weiter“ führt ihn aus.
 */
function weiter(art: WeiterArt, danach?: () => void): boolean {
    if (!eingereicht.value) return true;
    const ergebnis = pruefeWeiter(schutz.value, art, gemerkt.value);
    schutz.value = ergebnis.schutz;
    if (ergebnis.halt) {
        ausstehend = danach;
        void nextTick(() => fertig.value?.zeigeLink());
    }
    return !ergebnis.halt;
}

/** Was jemand mit dem Fenster vorhatte, jetzt ausführen: der Weg von außen, der angehalten wurde; sonst schließen, ein neues Formular an derselben Stelle oder die Statusseite. */
function fuehreAus(art: WeiterArt | undefined): void {
    const danach = ausstehend;
    ausstehend = undefined;
    if (danach !== undefined) danach();
    else if (art === "noch-eins") nochEins();
    else if (art === "stand") standAnsehen();
    else offen.value = false;
}

/** ✕ und Esc setzen `offen` an der Hülle: Das Fenster hängt an diesem Modell, dessen Setzer erst prüft, ob der Link verloren ginge. */
const huellenOffen = computed({
    get: () => offen.value,
    set: (auf: boolean) => {
        if (!auf && !weiter("zu")) return;
        offen.value = auf;
    },
});

function schliessenGedrueckt(): void {
    if (weiter("zu")) offen.value = false;
}

function nochEinsGedrueckt(): void {
    if (weiter("noch-eins")) nochEins();
}

function standGedrueckt(): void {
    if (weiter("stand")) standAnsehen();
}

/** „Kopieren“ in der Warnung: kopieren, melden und dann tun, was gewollt war (schließen oder weiter). Ging das Kopieren nicht, bleibt das Fenster stehen. */
async function warnKopieren(): Promise<void> {
    const art = schutz.value.gewarnt;
    if (!(await linkKopieren())) return;
    showToast(t("ui.copy.done"));
    fuehreAus(art);
}

/** „Trotzdem schließen“ beziehungsweise „Trotzdem weiter“: der zweite Versuch, jetzt ohne Halt. */
function trotzdem(): void {
    fuehreAus(schutz.value.gewarnt);
}

/** „Noch ein Bild von hier“: ein frisches Formular an derselben Stelle (neue Kennung, neuer Schlüssel); Art und Name bleiben als Vorbelegung. */
function nochEins(): void {
    const ort = props.anzeige.ort;
    props.steuerung.oeffne(
        props.anzeige.stelle,
        ort === undefined ? undefined : { id: ort.id, name: ort.name, subtype: ort.typ, x: ort.lage.x, y: ort.lage.y },
        {
            neu: true,
            vorbelegung: { entstehung: entwurf.entstehung === "" ? undefined : entwurf.entstehung, name: entwurf.name },
        },
    );
}
</script>

<template>
    <AvmFenster
        v-model:offen="huellenOffen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        :vorgabe-ecke="props.vorgabeEcke"
        hoehe="inhalt"
        stabil
        :ansicht="ansicht"
        ansicht-nie-hoeher
        ohne-ablage
        telefon-blatt
        :eingeklappt="imWaehlen"
        :titel="eingereicht ? t('photobox.fertig.titel') : t('photobox.titel')"
        :unterzeile="
            imWaehlen || moeglich === false
                ? undefined
                : eingereicht
                  ? t('photobox.fertig.unterzeile')
                  : t('photobox.unterzeile')
        "
        :testid="REISEBILD_FENSTER"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template #eingeklappt>
            <div v-if="imWaehlen" class="reisebild__modus" data-testid="reisebild-modusleiste">
                <span class="reisebild__modustitel">{{ t("photobox.waehlen.titel") }}</span>
                <span>{{ t("photobox.waehlen.text") }}</span>
                <AvmKnopf groesse="zeile" testid="reisebild-waehlen-ab" @click="props.steuerung.beendeWahl()">{{
                    t("photobox.waehlen.abbrechen")
                }}</AvmKnopf>
            </div>
        </template>

        <!-- Eingereicht: die Bestätigung mit dem persönlichen Link im selben Fenster. -->
        <ReisebildFertig
            v-if="eingereicht"
            ref="fertig"
            :link="linkAdresse"
            :beschreibung="entwurf.text.trim()"
            :stelle-worte="stelleWorte"
            :entstehung="entstehungText"
            :vorschau-url="bildWahl.vorschauUrl.value"
            :kopiert="linkKopie.anzeige.value"
            :warnt="warnt"
            :merken-moeglich="merkenMoeglich"
            :gemerkt="gemerkt"
            :merken-problem="merkenProblem"
            @kopieren="linkKopieren"
            @merken="merken"
            @stand="standGedrueckt"
            @noch-eins="nochEinsGedrueckt"
        />

        <!-- Geht gerade nicht: ein Satz statt eines toten Knopfs. -->
        <AvmHinweis v-else-if="moeglich === false" ton="warnung" rolle="status" testid="reisebild-nicht-moeglich">
            {{ t("photobox.nichtMoeglich") }} {{ t("photobox.nichtMoeglich.spaeter") }}
        </AvmHinweis>

        <ReisebildFormular
            v-else
            ref="formular"
            :entwurf="entwurf"
            :stelle-worte="stelleWorte"
            :bild-wahl="bildWahl"
            :fehlt="versucht ? fehlt?.feld : undefined"
            @stelle-aendern="props.steuerung.starteWahl()"
            @hinweise="(ziel: ReisebildHinweisZiel) => emit('hinweise', ziel)"
        />

        <!-- „Bild hochladen“ steht im Fuß, damit es auch in einem niedrigen Fenster im Bild bleibt (Guide §12.6, §13.19). -->
        <template v-if="formularOffen" #fuss>
            <ReisebildFormularFuss
                v-model:datenschutz-offen="datenschutzOffen"
                :gesperrt="knopfGesperrt"
                :sendet="sendet"
                :grund="grund"
                :problem="problemSatz"
                @hochladen="hochladenGedrueckt"
                @hinweise="(ziel: ReisebildHinweisZiel) => emit('hinweise', ziel)"
            />
        </template>
        <template v-else-if="eingereicht" #fuss>
            <ReisebildFertigFuss
                :warnt="warnt"
                :trotzdem="trotzdemSchluessel(schutz)"
                :merken-moeglich="merkenMoeglich"
                @schliessen="schliessenGedrueckt"
                @warn-kopieren="warnKopieren"
                @trotzdem="trotzdem"
            />
        </template>
    </AvmFenster>
</template>

<style scoped>
/* Die Moduszeile des eingeklappten Fensters (wie im Ortseditor): der Modus und wie er geht. */
.reisebild__modus {
    display: grid;
    gap: var(--space-4);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    color: var(--color-text);
}

.reisebild__modustitel {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}
</style>
