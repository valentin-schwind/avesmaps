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
const REGISTER = [
	{ key: "probe", label: "Probe", ai_label: false, ai_label_needs_media: false },
	{ key: "changelog", label: "Neuigkeiten", ai_label: false, ai_label_needs_media: false },
	{ key: "instagram", label: "Instagram", ai_label: true, ai_label_needs_media: false },
	{ key: "facebook", label: "Facebook", ai_label: true, ai_label_needs_media: true },
	{ key: "mastodon", label: "Mastodon", ai_label: false, ai_label_needs_media: false },
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
assert.ok(satz.indexOf("Instagram und Facebook") !== -1,
	"die beiden Netze, die es können, stehen namentlich da: " + satz);
assert.ok(/Neuigkeiten|Mastodon/.test(satz),
	"und die, die es nicht können, ebenfalls -- eine Lücke, die niemand benennt, liest sich wie ein Fehler");

// 💣 Der Satz wird aus dem REGISTER gebaut, nicht aus einer Namensliste im Client. Nimmt ein Kanal
// die Erklärung künftig an, steht er hier von selbst -- und niemand muss daran denken.
const mitBluesky = aiChannelsText(REGISTER.concat(
	[{ key: "bluesky", label: "Bluesky", ai_label: true, ai_label_needs_media: false }]
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
	{ key: "facebook", label: "Facebook", ai_label: true, ai_label_needs_media: true },
]);
assert.ok(alleKoennen.indexOf("kennt keinen") === -1 && alleKoennen.indexOf("kennen keinen") === -1,
	"ohne Rest fällt der zweite Halbsatz weg: " + alleKoennen);

// ---- 💣 DIE WARNUNG, um die es geht --------------------------------------------------------------

// Der Fall, der ohne diesen Satz still danebengeht.
const warnung = aiWarningText(true, ["facebook", "probe"], false, REGISTER);
assert.ok(warnung.indexOf("Facebook") !== -1 && warnung.indexOf("ohne Bild") !== -1,
	"angehakt + Facebook + kein Bild = Warnung, die Facebook beim Namen nennt: " + warnung);
assert.ok(warnung.indexOf("Probe") === -1,
	"und sie nennt nur die betroffenen Kanäle, nicht jeden angehakten");

// Mit Bild ist nichts zu warnen -- dann geht die Erklärung an /photos und kommt an.
assert.strictEqual(aiWarningText(true, ["facebook"], true, REGISTER), "",
	"mit Bild kommt die Erklärung an; kein Hinweis");

// Nicht angehakt: es gibt nichts zu verlieren.
assert.strictEqual(aiWarningText(false, ["facebook"], false, REGISTER), "",
	"ohne Häkchen ist auch nichts zu warnen");

// 🔴 Instagram löst die Warnung NIE aus. Es verlangt ohnehin ein Bild, kann die Erklärung also nie
// mangels Bild verlieren -- eine Warnung dort wäre schlicht falsch, und eine falsche Warnung ist der
// schnellste Weg, dass die richtige nicht mehr gelesen wird.
assert.strictEqual(aiWarningText(true, ["instagram"], false, REGISTER), "",
	"Instagram verlangt ohnehin ein Bild und taucht in der Warnung nie auf");

// Und ein Kanal, der die Erklärung gar nicht kennt, ebenso wenig.
assert.strictEqual(aiWarningText(true, ["mastodon", "changelog", "probe"], false, REGISTER), "",
	"wer keine Erklärung annimmt, kann sie auch nicht verlieren");

// ⚠️ Streng auf `true` geprüft, wie der Server: ein "truthy" Wert aus einem alten Client darf nicht
// als Erklärung durchgehen.
assert.strictEqual(aiWarningText("ja", ["facebook"], false, REGISTER), "",
	"nur ein echtes true zählt als angehakt");

// 💣 Wen es betrifft, sagt das REGISTER. Verliert Facebook eines Tages die Bild-Bedingung (Meta baut
// das Feld an /feed nach), verschwindet die Warnung durch eine Datenänderung -- nicht durch eine
// Codesuche nach dem Wort „facebook".
const ohneBildbedingung = REGISTER.map(function (channel) {
	return channel.key === "facebook"
		? Object.assign({}, channel, { ai_label_needs_media: false })
		: channel;
});
assert.strictEqual(aiWarningText(true, ["facebook"], false, ohneBildbedingung), "",
	"die Bedingung steht im Register, nicht als Kanalname im Code");

// Mehrere Betroffene werden aufgezählt und das Verb wandert mit.
const zwei = aiWarningText(true, ["facebook", "bluesky"], false, REGISTER.concat(
	[{ key: "bluesky", label: "Bluesky", ai_label: true, ai_label_needs_media: true }]
));
assert.ok(zwei.indexOf("Facebook und Bluesky") !== -1 && zwei.indexOf("können") !== -1,
	"zwei Betroffene werden aufgezählt, und das Verb wandert in den Plural: " + zwei);

console.log("social-ki-kennzeichnung.test: OK");
