"use strict";
// Die KI-Kennzeichnung im Social-Media-Hub, Client-Hälfte.
// Entwurf: docs/superpowers/specs/2026-08-16-ki-kennzeichnung-design.md
//
// 💣 GEPRÜFT WIRD DER WARNSATZ, NICHT DAS HÄKCHEN. Ein Häkchen durchzureichen ist drei Zeilen und
// geht nicht schief. Schiefgehen kann genau eins: der Editor hakt „Mit KI erstellt" an, wählt
// Facebook, hängt KEIN Bild dran -- und der Beitrag geht wortlos unbeschriftet raus, weil Meta die
// Erklärung nur an `/photos` entgegennimmt und `/feed` das Feld gar nicht kennt. Der Satz, der das
// sagt, ist die eigentliche Arbeit dieses Features.
//
// Vom Repo-Wurzelverzeichnis aus:
//   node js/review/__tests__/social-ki-kennzeichnung.test.js
const assert = require("assert");
const { joinNames, aiChannelsText, aiWarningText } = require("../review-social.js");

// Das Register, wie `list.php` es liefert -- gekürzt auf die Felder, um die es hier geht.
// ⚠️ Absichtlich als Daten und nicht als Namensliste im Code: genau darum steht `ai_label` im
// Register und nicht im Browser.
// 🔴 Stand 18.08.2026: Facebook steht auf `ai_label: false` + `ai_label_manual: true` -- Meta lehnt
// `provenance_info` für unsere App mit `(#100) Missing Permission` ab (Begründung im Register).
// Instagram ist damit der einzige Kanal, der selbst kennzeichnet.
const REGISTER = [
	{ key: "probe", label: "Probe", ai_label: false, ai_label_needs_media: false, ai_label_manual: false },
	{ key: "changelog", label: "Neuigkeiten", ai_label: false, ai_label_needs_media: false, ai_label_manual: false },
	{ key: "instagram", label: "Instagram", ai_label: true, ai_label_needs_media: false, ai_label_manual: false },
	{ key: "facebook", label: "Facebook", ai_label: false, ai_label_needs_media: false, ai_label_manual: true },
	{ key: "mastodon", label: "Mastodon", ai_label: false, ai_label_needs_media: false, ai_label_manual: false },
];

// ---- die Aufzählung ------------------------------------------------------------------------------

assert.strictEqual(joinNames([]), "", "keine Namen, kein Satzteil");
assert.strictEqual(joinNames(["Facebook"]), "Facebook", "einer steht allein");
assert.strictEqual(joinNames(["Facebook", "Instagram"]), "Facebook und Instagram", "zwei mit „und“");
// 💣 Der Fehler beim Abschreiben ist immer derselbe: das „und“ vor dem letzten Namen fehlt und es
// steht „A, B, C“ da. Deshalb gibt es die Funktion einmal statt dreimal.
assert.strictEqual(joinNames(["A", "B", "C"]), "A, B und C", "drei: Kommas, dann „und“");

// ---- welcher Kanal die Erklärung annimmt ---------------------------------------------------------

const satz = aiChannelsText(REGISTER);
assert.ok(satz.indexOf("Instagram") !== -1,
	"das Netz, das selbst kennzeichnet, steht namentlich da: " + satz);
assert.ok(/Neuigkeiten|Mastodon/.test(satz),
	"und die, die es nicht können, ebenfalls -- eine Lücke, die niemand benennt, liest sich wie ein Fehler");

// 💣 DREI GRUPPEN, NICHT ZWEI. Facebook gehört seit 18.08.2026 in keine der beiden alten: es KENNT
// ein Label, wir dürfen es nur nicht setzen. Stünde es unter „kennen keinen", widerspräche dieser
// Satz dem Warnsatz darunter, der zum Nachtragen auffordert -- und der Editor müsste raten, welcher
// von beiden stimmt.
assert.ok(satz.indexOf("Bei Facebook ist er von Hand nachzutragen") !== -1,
	"Facebook steht als eigene Gruppe da, mit dem Handgriff: " + satz);
assert.ok(!/Facebook[^.]*kenn(t|en) keinen/.test(satz),
	"und ausdrücklich NICHT unter „kennt keinen“ -- das wäre sachlich falsch: " + satz);

// 💣 Der Satz wird aus dem REGISTER gebaut, nicht aus einer Namensliste im Client. Nimmt ein Kanal
// die Erklärung künftig an, steht er hier von selbst -- und niemand muss daran denken.
const mitBluesky = aiChannelsText(REGISTER.concat(
	[{ key: "bluesky", label: "Bluesky", ai_label: true, ai_label_needs_media: false, ai_label_manual: false }]
));
assert.ok(mitBluesky.indexOf("Bluesky") !== -1,
	"ein neuer Kanal mit ai_label steht ohne Zutun in der Aufzählung");

// ⚠️ Solange die Liste lädt, ist sie leer -- dann darf KEIN Satz ohne Subjekt herauskommen
// („ zeigen daraufhin einen KI-Hinweis").
assert.ok(aiChannelsText([]).indexOf("kein Kanal") !== -1,
	"eine leere Liste sagt das, statt einen Satz ohne Subjekt zu bauen");
assert.ok(aiChannelsText(undefined).length > 0, "und undefined stürzt nicht ab");

// Können es ALLE, gibt es keinen Rest -- „die übrigen kennen keinen" wäre dann eine Aussage über die
// leere Menge.
const alleKoennen = aiChannelsText([
	{ key: "facebook", label: "Facebook", ai_label: true, ai_label_needs_media: true, ai_label_manual: false },
]);
assert.ok(alleKoennen.indexOf("kennt keinen") === -1 && alleKoennen.indexOf("kennen keinen") === -1,
	"ohne Rest fällt der zweite Halbsatz weg: " + alleKoennen);
// ⚠️ Und der Handarbeit-Halbsatz ebenso wenig -- eine leere Gruppe darf keinen Satz erzeugen.
assert.ok(alleKoennen.indexOf("von Hand") === -1,
	"ohne Handarbeit-Kanal fällt auch dieser Halbsatz weg: " + alleKoennen);

// ---- 💣 DIE WARNUNG, um die es geht --------------------------------------------------------------

// ---- Fall 1: das Netz HAT ein Label, wir setzen es nur nicht (Facebook seit 18.08.2026) ---------
//
// 💣 Der Fall, der ohne diesen Satz still danebengeht: der Editor hakt an, drückt, und hält den
// Beitrag für gekennzeichnet -- während auf Facebook nichts steht.
const vonHand = aiWarningText(true, ["facebook", "probe"], true, REGISTER);
assert.ok(vonHand.indexOf("Facebook") !== -1,
	"angehakt + Facebook = Hinweis, der Facebook beim Namen nennt: " + vonHand);
// 🔴 Und er sagt, was ZU TUN ist. „Facebook kennzeichnet nicht" allein liesse offen, ob dort ein
// Handgriff wartet oder ob das Netz es einfach nicht kann -- genau der Unterschied, für den es
// `ai_label_manual` gibt.
assert.ok(vonHand.indexOf("von Hand") !== -1 && vonHand.indexOf("nachtragen") !== -1,
	"und er nennt den Handgriff, nicht nur den Verlust: " + vonHand);
assert.ok(vonHand.indexOf("Probe") === -1,
	"und nur die betroffenen Kanäle, nicht jeden angehakten");

// 💣 UNABHÄNGIG VOM BILD -- anders als Fall 2. Facebook kann die Erklärung heute weder mit noch ohne
// Bild anbringen; ein Hinweis, der nur ohne Bild erschiene, verschwiege genau den Normalfall
// (Beitrag 30 HATTE ein Bild).
assert.ok(aiWarningText(true, ["facebook"], false, REGISTER).indexOf("Facebook") !== -1,
	"auch ohne Bild steht der Hinweis da");

// Nicht angehakt: es gibt nichts nachzutragen.
assert.strictEqual(aiWarningText(false, ["facebook"], false, REGISTER), "",
	"ohne Häkchen ist auch nichts zu warnen");

// 🔴 Instagram löst nie einen Hinweis aus -- es kennzeichnet selbst. Eine falsche Warnung ist der
// schnellste Weg, dass die richtige nicht mehr gelesen wird.
assert.strictEqual(aiWarningText(true, ["instagram"], false, REGISTER), "",
	"Instagram kennzeichnet selbst und taucht im Hinweis nie auf");

// 🔴 Und Mastodon ebenso wenig, obwohl es AUCH nicht kennzeichnet: dort gibt es kein Feld, also
// nichts nachzutragen. Genau hier zahlt sich das dritte Registerfeld aus -- ein aus `!ai_label`
// abgeleiteter Hinweis schickte den Editor auf die Suche nach einem Schalter, den es nicht gibt.
assert.strictEqual(aiWarningText(true, ["mastodon", "changelog", "probe"], false, REGISTER), "",
	"wo es gar kein Label gibt, ist auch nichts nachzutragen");

// ⚠️ Streng auf `true` geprüft, wie der Server: ein "truthy" Wert aus einem alten Client darf nicht
// als Erklärung durchgehen.
assert.strictEqual(aiWarningText("ja", ["facebook"], false, REGISTER), "",
	"nur ein echtes true zählt als angehakt");

// 💣 Wen es betrifft, sagt das REGISTER. Erteilt Meta uns eines Tages die Berechtigung, verschwindet
// der Hinweis durch eine DATENänderung -- nicht durch eine Codesuche nach dem Wort „facebook".
const darfWieder = REGISTER.map(function (channel) {
	return channel.key === "facebook"
		? Object.assign({}, channel, { ai_label: true, ai_label_manual: false })
		: channel;
});
assert.strictEqual(aiWarningText(true, ["facebook"], true, darfWieder), "",
	"die Bedingung steht im Register, nicht als Kanalname im Code");

// ---- Fall 2: nimmt die Erklärung an, aber nur an einem BILD --------------------------------------
//
// ⚠️ Heute trifft das KEINEN Kanal mehr (Facebook ist ganz draussen). Der Zweig wird trotzdem
// geprüft: er beschreibt `/feed` weiterhin richtig und ist am Tag der Meta-Freigabe sofort wieder
// die Wahrheit. Deshalb ein synthetischer Kanal statt Facebook -- er hält den Zweig am Leben, ohne
// zu behaupten, Facebook sei heute in dieser Lage.
const MIT_BILDBEDINGUNG = REGISTER.concat([
	{ key: "bluesky", label: "Bluesky", ai_label: true, ai_label_needs_media: true, ai_label_manual: false },
]);
const ohneBild = aiWarningText(true, ["bluesky"], false, MIT_BILDBEDINGUNG);
assert.ok(ohneBild.indexOf("Bluesky") !== -1 && ohneBild.indexOf("ohne Bild") !== -1,
	"angehakt + kein Bild = Warnung für den Kanal, der eins bräuchte: " + ohneBild);
assert.strictEqual(aiWarningText(true, ["bluesky"], true, MIT_BILDBEDINGUNG), "",
	"mit Bild kommt die Erklärung an; kein Hinweis");

// Mehrere Betroffene werden aufgezählt und das Verb wandert mit.
const zwei = aiWarningText(true, ["bluesky", "threads"], false, MIT_BILDBEDINGUNG.concat(
	[{ key: "threads", label: "Threads", ai_label: true, ai_label_needs_media: true, ai_label_manual: false }]
));
assert.ok(zwei.indexOf("Bluesky und Threads") !== -1 && zwei.indexOf("können") !== -1,
	"zwei Betroffene werden aufgezählt, und das Verb wandert in den Plural: " + zwei);

// 💣 BEIDE FÄLLE ZUGLEICH: heute unmöglich, morgen nicht. Sie müssen sich addieren statt einander zu
// verdrängen -- ein `return` im ersten Zweig hätte den zweiten stillgelegt, und das fiele erst auf,
// wenn jemand einen Kanal mit Bildbedingung dazunimmt.
const beide = aiWarningText(true, ["facebook", "bluesky"], false, MIT_BILDBEDINGUNG);
assert.ok(beide.indexOf("Facebook") !== -1 && beide.indexOf("Bluesky") !== -1,
	"beide Lagen zugleich nennen beide Kanäle: " + beide);

console.log("social-ki-kennzeichnung.test: OK");
