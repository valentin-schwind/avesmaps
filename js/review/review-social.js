(function () {
	"use strict";

	// Der Reiter „Social Media" unter Community: die Liste der Beiträge und das Hub-Fenster
	// (Entwurf §2).
	//
	// 💣 DER STATUS GEHÖRT DEM KANAL, NICHT DEM BEITRAG. Ein Beitrag geht an mehrere Netze, und jedes
	// kann für sich scheitern. Deshalb trägt jede Marke ihren eigenen Zustand und ihren eigenen
	// „Erneut"-Knopf, der genau diesen einen Kanal wiederholt. Ein gemeinsames „gesendet" würde den
	// Fall verschlucken, dass eines abgelehnt hat -- und niemand merkte es, bis jemand fragt.
	//
	// ⚠️ Gebaut wird ausschließlich mit createElement, nie mit innerHTML. Der Text stammt von
	// Menschen und geht später öffentlich raus; ein einziges Feld ohne Escaping wäre hier nicht nur
	// ein XSS, sondern einer im Namen des Projekts.

	const LIST_API = "/api/edit/social/list.php";
	const RETRY_API = "/api/edit/social/retry.php";
	const CONNECT_API = "/api/edit/social/connect.php";

	// ---- reine Entscheidungen (unter Test in __tests__/social-list.test.js) -----------------------

	// 🔴 Unbekannt fällt auf „wartet", NIE auf „gesendet". Ein Zustand, den eine spätere Stufe
	// hinzufügt und dieser Client noch nicht kennt, würde sonst grün erscheinen -- und Grün heißt
	// „es steht draußen".
	function chipClass(status) {
		if (status === "sent") { return "social-chip social-chip--ok"; }
		if (status === "failed") { return "social-chip social-chip--err"; }
		return "social-chip social-chip--wait";
	}

	function chipLabel(target) {
		const label = (target && target.label) || "";
		if (target && target.status === "sent") { return label + " ✓"; }
		if (target && target.status === "failed") { return label + " — Fehler"; }
		if (target && target.status === "scheduled") { return label + " — geplant"; }
		return label + " — wartet";
	}

	// Nur ein gescheiterter Kanal darf wiederholt werden. Ein bereits gesendeter waere auf Instagram
	// ein Doppelbeitrag, und der laesst sich dort nicht aendern, nur loeschen.
	function canRetry(target) {
		return !!target && target.status === "failed";
	}

	// Spiegelt avesmapsSocialStrictestLimit. ⚠️ Der Server prueft dasselbe noch einmal in
	// avesmapsSocialCheckTarget -- diese Haelfte ist die Bequemlichkeit, nicht der Riegel.
	function strictestLimit(channels, selectedKeys) {
		let best = { key: null, label: "", max_chars: null };
		(channels || []).forEach(function (channel) {
			if (selectedKeys.indexOf(channel.key) === -1) { return; }
			if (channel.max_chars === null || channel.max_chars === undefined) { return; }
			if (best.max_chars === null || channel.max_chars < best.max_chars) {
				best = { key: channel.key, label: channel.label, max_chars: channel.max_chars };
			}
		});
		return best;
	}

	// 💣 Die Zeile, an der das ganze Hashtag-Konzept haengt: die Tags stehen GETRENNT, weil vier von
	// ihnen schnell 60 Zeichen sind -- bei Mastodons 500 ueber ein Zehntel. „168 + 0" liest sich
	// dagegen wie ein Fehler, also faellt die Haelfte weg, wenn es keine Tags gibt.
	function formatCount(textChars, hashtagChars, limit) {
		const total = textChars + hashtagChars;
		const left = hashtagChars > 0
			? textChars + " + " + hashtagChars + " Hashtags = " + total
			: String(total);
		if (!limit || limit.max_chars === null || limit.max_chars === undefined) {
			return left + " Zeichen";
		}
		return left + " / " + limit.max_chars + " (" + limit.label + ")";
	}

	// Wann laeuft der Zugang eines Kanals ab? DREI Zustaende, und der Unterschied zwischen zweien davon
	// ist der ganze Sinn dieser Zeile.
	//
	// 💣 null heisst „keine gespeicherte Zeile", also NICHTWISSEN -- niemals „laeuft nie ab". Der Token
	// kann in der Konfiguration stehen, wo niemand nach einem Ablauf gefragt hat. Eine Zusage ohne
	// Messung ist genau der Fehler, der am 10.08.2026 zweimal einen Zugang stillschweigend sterben
	// liess: er sah funktionsfaehig aus, bis er es nicht mehr war.
	function formatExpiry(value) {
		if (value === "never") { return "Zugang läuft nie ab"; }
		if (!value) { return ""; }
		const parsed = new Date(String(value).replace(" ", "T"));
		// Unlesbares Datum: lieber den Rohwert zeigen als „Invalid Date" -- und auf keinen Fall
		// stillschweigend auf „nie" zurueckfallen.
		return "Zugang läuft ab: " + (isNaN(parsed.getTime())
			? String(value)
			: parsed.toLocaleDateString("de-DE"));
	}

	// Was ueber einem wartenden Beitrag steht. 💣 Es gibt seit der Entwurfs-Box ZWEI Herkuenfte im
	// selben Zustand `proposal`: die Routine schlaegt vor, ein Editor parkt. Der Satz „Vorschlag der
	// Routine" stand hier fest verdrahtet und war ab dem ersten Editor-Entwurf schlicht falsch --
	// sichtbar falsch, ueber dem eigenen Text. Deshalb entscheidet `origin`, nicht der Zustand.
	function proposalNote(post) {
		return (post && post.origin === "routine")
			? "Vorschlag der Routine — wartet auf Freigabe."
			: "Entwurf — noch nicht veröffentlicht.";
	}

	// 🔴 Was in die Entwurfsliste des Fensters gehoert -- und was NICHT. Ein bereits veroeffentlichter
	// Beitrag darf dort nie auftauchen: er traegt dieselben Knoepfe, und „Veroeffentlichen" waere auf
	// ihm ein zweiter Versand. Auf Instagram ist der ein Doppelbeitrag, den man nur loeschen kann.
	function isDraft(post) {
		return !!post && post.state === "proposal";
	}

	// 🔴 Ein Beitrag, dessen Verfasser verloren ging, darf nie so lesen, als haette die Automatik ihn
	// geschrieben. Der Unterschied zwischen „ein Mensch hat das entschieden" und „eine Routine hat es
	// vorgeschlagen" ist der Sinn des Kennzeichens.
	function postAuthorLabel(post) {
		if (post && post.origin === "routine") { return "Automatisch"; }
		const author = (post && post.author) || "";
		return author !== "" ? author : "Unbekannt";
	}

	// ---- alles ab hier braucht ein Dokument -------------------------------------------------------

	const hasDocument = typeof document !== "undefined";

	let channels = [];
	// Die zuletzt geladenen Beitraege. Sie liegen hier, weil sie ZWEI Leser haben: die Liste im Panel
	// und die Entwurfsspalte im Fenster. Der Server ein zweites Mal danach zu fragen waere derselbe
	// Stand, nur spaeter -- und zwei Staende, die auseinanderlaufen koennen.
	let posts = [];
	let vocabulary = [];
	let sendingEnabled = true;
	let loaded = false;

	function statusEl() { return document.getElementById("social-status"); }
	function listEl() { return document.getElementById("social-post-list"); }

	function api(url, options) {
		return fetch(url, Object.assign({ credentials: "same-origin" }, options || {}))
			.then(function (response) { return response.json(); })
			.catch(function () { return null; });
	}

	// MySQL liefert „2026-08-10 18:04:12.123", was nicht jeder Browser als Datum erkennt. Das T
	// macht daraus etwas Parsbares; scheitert es trotzdem, steht der Rohwert da statt „Invalid Date".
	function formatDate(value) {
		const raw = String(value || "");
		const parsed = new Date(raw.replace(" ", "T"));
		return isNaN(parsed.getTime()) ? raw : parsed.toLocaleString("de-DE");
	}

	function makeChip(target) {
		const chip = document.createElement("span");
		chip.className = chipClass(target.status);
		chip.textContent = chipLabel(target);
		if (target.error) { chip.title = target.error; }
		return chip;
	}

	function retryChannel(postId, channelKey, button) {
		button.disabled = true;
		button.textContent = "…";
		api(RETRY_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: postId, channel: channelKey }),
		}).then(function () {
			// Immer neu laden, auch bei Misserfolg: der Server hat den Zustand des Ziels in jedem Fall
			// fortgeschrieben, und die Liste ist die Wahrheit -- nicht die Antwort auf diesen Klick.
			load(true);
		});
	}

	function renderTargets(post, container) {
		const chips = document.createElement("div");
		chips.className = "social-chips";
		(post.targets || []).forEach(function (target) {
			chips.appendChild(makeChip(target));
			if (canRetry(target)) {
				const button = document.createElement("button");
				button.type = "button";
				// Weich, nicht gefüllt: eine Zeilenhandlung ist nie die Haupthandlung der Seite
				// (AGENTS.md §12) -- und dieser Knopf steht potenziell in jeder Zeile.
				button.className = "social-hub__soft social-hub__soft--mini";
				button.textContent = "Erneut";
				button.title = target.error || "";
				button.addEventListener("click", function () {
					retryChannel(post.id, target.channel, button);
				});
				chips.appendChild(button);
			}
		});
		container.appendChild(chips);

		// Der Probe-Kanal legt ab, was er gesendet hätte. Das ist der eigentliche Nutzen der Probe --
		// und <details> ist nativ, damit Strg+F den Text auch im zugeklappten Kasten findet.
		(post.targets || []).forEach(function (target) {
			if (!target.sent_payload) { return; }
			const details = document.createElement("details");
			details.className = "social-post__payload";
			const summary = document.createElement("summary");
			summary.textContent = target.label + ": Was gesendet worden wäre";
			const pre = document.createElement("pre");
			let text = target.sent_payload;
			try {
				text = JSON.stringify(JSON.parse(target.sent_payload), null, 2);
			} catch (error) {
				// Kein JSON? Dann eben roh -- ein unlesbarer Kasten ist besser als gar keiner.
			}
			pre.textContent = text;
			details.append(summary, pre);
			container.appendChild(details);
		});
	}

	function renderProposalActions(post, container) {
		const row = document.createElement("div");
		row.className = "social-chips social-post__actions";

		const approve = document.createElement("button");
		approve.type = "button";
		approve.className = "wiki-sync-panel__start social-hub__inline";
		approve.textContent = "Freigeben und veröffentlichen";
		approve.addEventListener("click", function () {
			approve.disabled = true;
			decideProposal(post.id, "approve");
		});

		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "social-hub__soft social-hub__soft--mini";
		edit.textContent = "Bearbeiten";
		edit.addEventListener("click", function () { openHub(post); });

		const discard = document.createElement("button");
		discard.type = "button";
		discard.className = "social-hub__soft social-hub__soft--mini";
		discard.textContent = "Verwerfen";
		discard.addEventListener("click", function () {
			discard.disabled = true;
			decideProposal(post.id, "discard");
		});

		row.append(approve, edit, discard);
		container.appendChild(row);
	}

	function renderList(posts) {
		const target = listEl();
		if (!target) { return; }
		target.textContent = "";

		if (!posts || !posts.length) {
			target.textContent = "Noch nichts veröffentlicht.";
			return;
		}

		posts.forEach(function (post) {
			const item = document.createElement("div");
			item.className = "social-post"
				+ (post.state === "proposal" ? " social-post--proposal" : "");

			const top = document.createElement("div");
			top.className = "social-post__top";
			const who = document.createElement("span");
			who.className = "social-post__who"
				+ (post.origin === "routine" ? " social-post__who--auto" : "");
			who.textContent = postAuthorLabel(post);
			const when = document.createElement("span");
			when.className = "social-post__date";
			when.textContent = formatDate(post.created_at);
			top.append(who, when);

			item.append(top);

			// Nur wenn es eine gibt. Ein leerer fetter Absatz über jedem Beitrag ohne Titelzeile wäre
			// eine Zeile Rauschen je Eintrag -- und die Titelzeile ist die Ausnahme, nicht die Regel.
			if (post.title) {
				const heading = document.createElement("p");
				heading.className = "social-post__title";
				heading.textContent = post.title;
				heading.title = "Titelzeile — erscheint nur im Fenster Neuigkeiten";
				item.appendChild(heading);
			}

			const text = document.createElement("p");
			text.className = "social-post__text";
			text.textContent = post.text || "";
			item.appendChild(text);

			if (post.state === "proposal") {
				const note = document.createElement("p");
				note.className = "social-post__note";
				note.textContent = proposalNote(post);
				item.appendChild(note);
				renderProposalActions(post, item);
			}

			renderTargets(post, item);
			target.appendChild(item);
		});
	}

	function setStatus(message) {
		const element = statusEl();
		if (element) { element.textContent = message; }
	}

	function load(force) {
		if (loaded && !force) { return Promise.resolve(); }
		loaded = true;
		setStatus("Beiträge werden geladen …");
		return api(LIST_API).then(function (response) {
			if (!response || !response.ok) {
				setStatus("Die Liste konnte nicht geladen werden.");
				return;
			}
			channels = response.channels || [];
			vocabulary = response.vocabulary || [];
			sendingEnabled = response.enabled !== false;
			setStatus(sendingEnabled
				? ""
				: "Das Senden ist serverseitig abgeschaltet — Beiträge werden angelegt, aber nicht verschickt.");
			posts = response.posts || [];
			renderList(posts);
			// Auch wenn das Fenster gerade zu ist: es kostet nichts und verhindert, dass es beim
			// naechsten Oeffnen kurz den alten Stand zeigt.
			renderHubDrafts();
		});
	}

	// ---- die Entwuerfe im Fenster ---------------------------------------------------------------------

	function renderHubDrafts() {
		const host = el("social-hub-drafts");
		if (!host) { return; }
		host.textContent = "";

		const drafts = (posts || []).filter(isDraft);

		// Der Zähler steht in der Überschrift, nicht als eigene Zeile: er ist eine Eigenschaft der
		// Liste, keine Aussage für sich. Bei null bleibt er weg -- „0 warten" über „Keine Entwürfe"
		// wäre dieselbe Auskunft zweimal.
		const counter = el("social-drafts-count");
		if (counter) {
			counter.textContent = drafts.length
				? " " + drafts.length + (drafts.length === 1 ? " wartet" : " warten")
				: "";
		}

		if (!drafts.length) {
			const empty = document.createElement("p");
			empty.className = "social-hub__hint";
			empty.textContent = "Keine Entwürfe.";
			host.appendChild(empty);
			return;
		}

		drafts.forEach(function (post) {
			const row = document.createElement("div");
			// Der goldene Streifen kennzeichnet den Vorschlag der Routine -- dasselbe Zeichen wie in
			// der Panel-Liste, damit man nicht zweimal lernen muss, was „automatisch" aussieht.
			row.className = "social-hub__draft"
				+ (post.origin === "routine" ? " social-hub__draft--auto" : "");

			const when = document.createElement("span");
			when.className = "social-hub__draft-when";
			when.textContent = postAuthorLabel(post) + " · " + formatDate(post.created_at);

			const text = document.createElement("p");
			text.className = "social-hub__draft-text";
			text.textContent = post.title ? post.title : (post.text || "");

			// Wohin dieser Entwurf gehen soll. 💣 Icon UND Beschriftung: für Netze gibt es keine Emoji,
			// die man erraten kann -- 📘 heißt nicht „Facebook", es steht nur daneben. Die Zuordnung
			// kommt aus dem Register (`icon`), nicht aus einer Schlüsselliste hier, sonst kennt der
			// Browser eine Zuordnung, die der Server nicht kennt.
			const marks = document.createElement("div");
			marks.className = "social-hub__draft-marks";
			(post.targets || []).forEach(function (target) {
				const channel = channels.filter(function (c) { return c.key === target.channel; })[0];
				const mark = document.createElement("span");
				mark.className = "social-chip social-chip--wait";
				// Ein Kanal, den das Register nicht mehr kennt, behält seinen Schlüssel -- lieber ein
				// technischer Name als eine leere Marke, die wie ein Darstellungsfehler aussieht.
				mark.textContent = (channel && channel.icon ? channel.icon + " " : "")
					+ (channel ? channel.label : target.channel);
				marks.appendChild(mark);
			});

			const actions = document.createElement("div");
			actions.className = "social-hub__draft-actions";

			const send = document.createElement("button");
			send.type = "button";
			send.className = "social-hub__soft social-hub__soft--mini";
			send.textContent = "Veröffentlichen";
			send.addEventListener("click", function () {
				send.disabled = true;
				send.textContent = "…";
				// Genau DIESEN einen Entwurf, nicht was gerade im Formular steht. Der Server sendet
				// ihn an die Kanaele, die beim Anlegen ausgewaehlt waren.
				decideProposal(post.id, "approve");
			});

			const open = document.createElement("button");
			open.type = "button";
			open.className = "social-hub__soft social-hub__soft--mini";
			open.textContent = "Bearbeiten";
			open.addEventListener("click", function () { openHub(post); });

			const drop = document.createElement("button");
			drop.type = "button";
			drop.className = "social-hub__soft social-hub__soft--mini";
			drop.textContent = "Verwerfen";
			// Ohne Rückfrage: ein Entwurf war nie öffentlich, und ein Dialog vor jeder Verwerfung
			// erzieht nur dazu, ihn wegzuklicken. ⚠️ Gelöscht wird auch nichts -- der Beitrag bekommt
			// den Zustand `discarded` und verschwindet aus der Liste; die Zeile bleibt in der Tabelle.
			// 💣 Bei einem Routine-Vorschlag ist das trotzdem endgültig: er behält seinen `source_ref`
			// (den Commit), und genau daran erkennt der Dublettenschutz, dass dieser Stand schon
			// vorgeschlagen war. Der nächste Lauf schlägt ihn NICHT erneut vor -- „Verwerfen" heißt
			// „nein", nicht „später nochmal fragen".
			drop.addEventListener("click", function () {
				drop.disabled = true;
				drop.textContent = "…";
				decideProposal(post.id, "discard");
			});

			actions.append(send, open, drop);
			row.append(when, text, marks, actions);
			host.appendChild(row);
		});
	}

	// ---- der Riegel ---------------------------------------------------------------------------------

	// 🔴 Fällt GESCHLOSSEN aus, wie bei der Landschaftsebene: bis die Antwort da ist -- und für immer,
	// wenn sie nie kommt -- bleibt der Reiter weg. Er schaltet ein Fenster frei, das öffentlich und
	// unwiderruflich sendet; ein zu früh gezeigter Knopf wäre schlimmer als ein spät gezeigter.
	function applyCapability() {
		const may = !!(typeof window !== "undefined"
			&& window.AvesmapsSession
			&& window.AvesmapsSession.current().capabilities.social);
		const tab = document.querySelector('[data-review-subtab="social"]');
		const section = document.querySelector('[data-review-subtab-section="social"]');
		if (tab) { tab.hidden = !may; }
		if (section && !may) { section.hidden = true; }
		return may;
	}

	function boot() {
		applyCapability();
		bindHub();
		if (typeof window !== "undefined" && window.AvesmapsSession) {
			window.AvesmapsSession.load().then(function () {
				if (!applyCapability()) { return; }
				// 💣 Geladen wird, SOBALD das Recht feststeht -- nicht erst beim Klick auf den Reiter.
				// Die erste Fassung hing allein am Klick, plus einer Prüfung auf `is-active` beim
				// Start. Beides greift daneben, wenn die Reiter-Kaskade den zuletzt offenen
				// Unterreiter aus dem Speicher wiederherstellt: dann fällt nie ein Klick, `is-active`
				// steht womöglich erst nach dieser Zeile, und der Reiter zeigt für immer „Beiträge
				// werden geladen …" über einer leeren Liste. Ein Wettlauf, den man nicht gewinnt,
				// indem man ihn genauer timt -- also gar nicht erst antreten. Die Abfrage kostet
				// einen Aufruf beim Öffnen des Editors, und den auch nur für Admins.
				load(false);
				// Der Klick bleibt als Auffrischung: wer den Reiter noch einmal anfasst, will sehen,
				// was inzwischen dazugekommen ist.
				const tab = document.querySelector('[data-review-subtab="social"]');
				if (tab) { tab.addEventListener("click", function () { load(true); }); }
			});
		}
	}

	if (hasDocument) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", boot);
		} else {
			boot();
		}
	}

	// ---- das Hub-Fenster ---------------------------------------------------------------------------

	let media = null;      // { url, width, height, cropped, fits: [...] }
	let editingId = null;  // gesetzt, wenn ein Vorschlag bearbeitet wird
	// Die Kanäle eines wiederhergestellten Entwurfs. `null` heisst „keine Vorgabe" -- dann gilt der
	// Startwert (nur die Probe). Eine LEERE Liste ist etwas anderes und muss es bleiben: ein Entwurf
	// ohne Ziel darf nicht stillschweigend wieder eines bekommen.
	let pendingChannels = null;

	function el(id) { return document.getElementById(id); }

	function selectedChannelKeys() {
		return Array.prototype.slice
			.call(document.querySelectorAll("#social-channels input[type=checkbox]:checked"))
			.map(function (input) { return input.value; });
	}

	function currentHashtags() {
		const raw = (el("social-hashtags") || { value: "" }).value;
		// Spiegelt avesmapsSocialNormalizeHashtags: '#' abstreifen, Leerraum drin entfernen,
		// klein-gefaltet entdoppeln. Umlaute bleiben -- ein Hashtag ist kein Wiki-Schlüssel.
		const seen = {};
		const out = [];
		String(raw).split(/[,\s]+/).forEach(function (item) {
			const tag = item.replace(/^#+/, "").replace(/\s+/g, "");
			if (tag === "") { return; }
			const fold = tag.toLowerCase();
			if (seen[fold]) { return; }
			seen[fold] = true;
			out.push("#" + tag);
		});
		return out;
	}

	// ⚠️ Nur die Bequemlichkeit, nicht der Riegel: avesmapsSocialCheckTarget rechnet dasselbe auf dem
	// Server noch einmal, und dort zählt es.
	function updateCount() {
		const keys = selectedChannelKeys();
		const limit = strictestLimit(channels, keys);
		const text = (el("social-text") || { value: "" }).value.replace(/\s+$/, "");
		const tags = currentHashtags();

		// Je Kanal andere Hashtag-Zahlen; für den Zähler zählt der STRENGSTE angehakte, sonst
		// verspricht die Zeile mehr Platz, als der engste Kanal hergibt.
		let maxTags = null;
		channels.forEach(function (channel) {
			if (keys.indexOf(channel.key) === -1) { return; }
			if (channel.max_hashtags === null || channel.max_hashtags === undefined) { return; }
			if (maxTags === null || channel.max_hashtags < maxTags) { maxTags = channel.max_hashtags; }
		});
		const used = maxTags === null ? tags : tags.slice(0, maxTags);
		const caption = used.length && text !== "" ? text + "\n\n" + used.join(" ")
			: (used.length ? used.join(" ") : text);

		const counter = el("social-count");
		if (counter) {
			counter.textContent = formatCount(text.length, caption.length - text.length, limit);
			const over = limit.max_chars !== null && caption.length > limit.max_chars;
			counter.classList.toggle("social-hub__count--over", over);
			const publish = el("social-publish");
			if (publish) { publish.disabled = over || text === "" || keys.length === 0; }
		}

		const foot = el("social-foot-note");
		if (foot) {
			foot.textContent = "Geht an " + keys.length + (keys.length === 1 ? " Kanal" : " Kanäle")
				+ " · als Avesmaps, nicht unter deinem Namen";
		}
	}

	function renderChannels() {
		const host = el("social-channels");
		if (!host) { return; }
		host.textContent = "";

		channels.forEach(function (channel) {
			// 💣 Die Zeile ist ein DIV, das Kontrollkästchen samt Text ein <label> DARIN. Der
			// Einrichtungsknopf steht daneben, ausserhalb des Labels: läge er darin, würde jeder Klick
			// auf ihn den Kanal an- und abhaken -- und ein Knopf im Label ist obendrein ungültiges HTML.
			// (Owner 11.08.2026: der Knopf gehört in die Zeile seines Kanals, nicht unter die Liste.)
			const row = document.createElement("div");
			row.className = "social-hub__channel-row";

			const label = document.createElement("label");
			label.className = "social-hub__channel"
				+ (channel.configured ? "" : " social-hub__channel--off");

			const box = document.createElement("input");
			box.type = "checkbox";
			box.value = channel.key;
			// Ein Kanal ohne Zugang ist ausgegraut und nicht anhakbar -- aber sichtbar. Wer den Hub
			// sieht, soll wissen, was möglich wäre (Entwurf §3).
			box.disabled = !channel.configured;
			// Instagram ohne Bild bleibt gesperrt: dort ist ein Beitrag ohne Bild kein Beitrag.
			if (channel.requires_media && !media) { box.disabled = true; }
			// Mit Vorgabe (ein Entwurf wurde geöffnet) gilt sie; ohne fällt es auf die Probe zurück.
			box.checked = channel.configured && !box.disabled && (pendingChannels === null
				? channel.key === "probe"
				: pendingChannels.indexOf(channel.key) !== -1);
			box.addEventListener("change", updateCount);

			const name = document.createElement("span");
			name.className = "social-hub__channel-name";
			name.textContent = channel.label;

			const meta = document.createElement("span");
			meta.className = "social-hub__channel-meta";
			const parts = [channel.configured ? channel.account : "noch nicht eingerichtet"];
			if (channel.configured) {
				// Der Hinweis kommt aus dem Register, nicht aus einer Schlüsselabfrage hier: sonst
				// stünde dieselbe Aussage an zwei Stellen und liefe beim nächsten Kanal auseinander.
				if (channel.note) { parts.push(channel.note); }
				if (channel.requires_media) { parts.push("Bild erforderlich"); }
				if (channel.max_chars !== null) { parts.push("max. " + channel.max_chars + " Zeichen"); }
				if (channel.max_hashtags === 0) { parts.push("keine Hashtags"); }
				if (!channel.clickable_links) { parts.push("Links nicht klickbar"); }
			}
			meta.textContent = parts.join(" · ");

			// 💣 Der Grund gehört zu dem, was er sperrt. „Instagram braucht ein Bild" stand als eine
			// Warnung UNTER der ganzen Liste -- also neben vier Kanälen, für die sie nicht gilt, und
			// weit weg von dem ausgegrauten Kästchen, das sie erklärt. Jetzt steht sie in der Zeile
			// des Kanals, und zwar nur dann, wenn sie zutrifft.
			const blocked = channel.requires_media && !media && channel.configured;

			const stack = document.createElement("span");
			stack.append(name, meta);

			// Der Ablauf steht in EIGENER Zeile, nicht in der Aufzaehlung: ein Datum ist eine
			// Vorwarnung und darf nicht zwischen Zeichenlimits untergehen. „Nie" bleibt unauffaellig,
			// ein Datum bekommt den Warnton -- der Kanal hoert an diesem Tag ohne Zutun auf.
			const expiry = formatExpiry(channel.access_expires);
			if (expiry !== "") {
				const line = document.createElement("small");
				line.className = channel.access_expires === "never"
					? "social-hub__channel-meta"
					: "social-hub__channel-expiry";
				line.textContent = expiry;
				stack.appendChild(line);
			}

			if (blocked) {
				const why = document.createElement("small");
				why.className = "social-hub__channel-expiry";
				why.textContent = "braucht ein Bild — ohne Anhang gesperrt";
				stack.appendChild(why);
			}

			label.append(box, stack);
			row.appendChild(label);

			// Der Einrichtungsknopf steht in der Zeile SEINES Kanals -- dort, wo auch „Zugang läuft nie
			// ab" steht, also neben der Aussage, die er ändert. Unter der Liste war er von dem Kanal
			// getrennt, um den es geht.
			if (channel.connectable) {
				const open = document.createElement("button");
				open.type = "button";
				open.className = "social-hub__connect-open";
				// „Erneuern" statt „einrichten", sobald ein Zugang steht: der Knopf verschwindet nicht,
				// weil ein Token ersetzt werden können muss -- aber er soll nicht behaupten, es fehle
				// noch etwas.
				open.textContent = "🔑 Zugang zu " + channel.label
					+ (channel.configured ? " erneuern" : " einrichten");
				open.addEventListener("click", function () { openConnect(channel); });
				row.appendChild(open);
			}

			host.appendChild(row);
		});

		renderHashtagNote();
		updateCount();
	}

	// Wie viele Hashtags welcher Kanal verträgt -- aus dem Register, nicht von Hand geschrieben.
	// 💣 `null` heißt ALLE und `0` heißt KEINE; beides als Zahl anzuzeigen („null", „0") wäre an der
	// einen Stelle unverständlich und an der anderen falsch gelesen (0 sieht aus wie „unbegrenzt").
	function renderHashtagNote() {
		const note = el("social-hashtag-note");
		if (!note) { return; }
		const parts = channels.map(function (channel) {
			const max = channel.max_hashtags;
			const wieviel = (max === null || max === undefined) ? "alle" : (max === 0 ? "keine" : max);
			return channel.label + " " + wieviel;
		});
		note.textContent = parts.length ? "Je Kanal: " + parts.join(" · ") : "";
	}

	// ---- einen Zugang einrichten ---------------------------------------------------------------------

	// Welcher Kanal gerade eingerichtet wird. Steht hier und nicht im Feld: das Feld trägt einen Token,
	// und was daran hängt, darf nicht aus dem DOM gelesen werden müssen.
	let connectChannel = null;

	function connectResult(message, tone) {
		const box = el("social-connect-result");
		if (!box) { return; }
		box.textContent = message;
		box.className = "social-hub__hint"
			+ (tone === "ok" ? " social-hub__ok" : "")
			+ (tone === "err" ? " social-hub__warn" : "");
	}

	function openConnect(channel) {
		connectChannel = channel;
		const box = el("social-connect");
		const name = el("social-connect-channel");
		const field = el("social-connect-token");
		if (name) { name.textContent = " zu " + channel.label; }
		if (field) { field.value = ""; }
		connectResult("", "");
		if (box) { box.hidden = false; }
		if (field) { field.focus(); }
	}

	function closeConnect() {
		connectChannel = null;
		const box = el("social-connect");
		const field = el("social-connect-token");
		// 🔴 Das Feld wird GELEERT, nicht nur versteckt. Ein Zugangsdatum, das in einem unsichtbaren
		// Feld weiterlebt, reist bei der nächsten Formularaktion mit und steht in jedem Screenshot des
		// geöffneten Fensters.
		if (field) { field.value = ""; }
		if (box) { box.hidden = true; }
		connectResult("", "");
	}

	function submitConnect() {
		if (!connectChannel) { return; }
		const field = el("social-connect-token");
		const button = el("social-connect-go");
		const token = field ? String(field.value || "").trim() : "";
		if (token === "") {
			connectResult("Es wurde kein Token eingefügt.", "err");
			return;
		}

		// Status IN den Knopf: der Weg geht dreimal zu Meta und dauert spürbar, und ein Knopf, der
		// nichts sagt, wird ein zweites Mal gedrückt.
		const channel = connectChannel;
		if (button) { button.disabled = true; button.textContent = "Verbinde …"; }
		connectResult("Tausch, Seitenliste, Nachprüfung — einen Moment.", "");

		api(CONNECT_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// Im Rumpf, nie in der Adresse: eine Abfragezeichenfolge landet in den Server-Protokollen.
			body: JSON.stringify({ channel: channel.key, token: token })
		}).then(function (response) {
			if (button) { button.disabled = false; button.textContent = "Verbinden"; }
			if (!response || !response.ok) {
				const message = (response && response.error && response.error.message)
					|| "Die Einrichtung ist fehlgeschlagen.";
				connectResult(message, "err");
				return;
			}
			// Das Feld ist sofort leer, auch im Erfolgsfall -- der Token hat seinen Zweck erfüllt.
			if (field) { field.value = ""; }
			connectResult("✓ " + (response.page_name || channel.label) + " verbunden · läuft nie ab.", "ok");
			// Die Liste neu holen, damit der Kanal sofort anhakbar ist: sonst steht „verbunden" über
			// einem ausgegrauten Kästchen, und das liest sich wie ein Fehler.
			load(true).then(renderChannels);
		});
	}

	function renderVocabulary() {
		const host = el("social-vocabulary");
		if (!host) { return; }
		host.textContent = "";
		vocabulary.forEach(function (tag) {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "social-chip social-hub__vocab-chip";
			chip.textContent = tag;
			chip.addEventListener("click", function () {
				const field = el("social-hashtags");
				if (!field) { return; }
				if (currentHashtags().indexOf(tag) !== -1) { return; }
				field.value = (field.value.trim() + " " + tag).trim();
				updateCount();
			});
			host.appendChild(chip);
		});
	}

	function renderMedia() {
		const host = el("social-media-info");
		if (!host) { return; }
		host.textContent = "";
		if (!media) { return; }

		// Das Bild SEHEN, nicht nur seine Maße lesen. Ein Beitrag geht öffentlich unter dem Namen des
		// Projekts hinaus; wer ihn absendet, soll vorher erkennen können, was daran hängt.
		const thumb = document.createElement("img");
		thumb.className = "social-hub__media-thumb";
		thumb.src = media.url;
		thumb.alt = "";
		host.appendChild(thumb);

		// 💣 Ein aus einem Entwurf WIEDERHERGESTELLTES Bild hat keine Messwerte: Maße, Größe und die
		// Kanalliste entstehen beim Hochladen und stehen nirgends gespeichert. Ohne diese Weiche liefe
		// `media.fits.indexOf` auf null -- und der ganze Medienbereich bliebe leer, weil die Ausnahme
		// den Rest der Funktion mitnimmt. Behauptet wird deshalb nichts, was nicht gemessen wurde.
		const measured = media.fits !== null && media.fits !== undefined;

		const line = document.createElement("div");
		line.className = "social-hub__media-line";
		const size = document.createElement("small");
		size.textContent = measured
			? media.width + " × " + media.height
				+ (media.cropped ? " (zugeschnitten)" : "")
				+ " · " + Math.round(media.bytes / 1024) + " kB · JPEG"
			: "Bild aus dem Entwurf";
		const fits = document.createElement("small");
		if (!measured) {
			fits.className = "social-hub__hint";
			// Kein „✓ Passt für …" ohne Messung: das Häkchen ist eine Zusage, und eine ungeprüfte
			// Zusage ist schlimmer als keine.
			fits.textContent = "beim Hochladen bereits geprüft";
			const removeOld = document.createElement("button");
			removeOld.type = "button";
			removeOld.className = "social-hub__soft social-hub__soft--mini";
			removeOld.textContent = "Entfernen";
			removeOld.addEventListener("click", function () {
				media = null;
				const file = el("social-file");
				if (file) { file.value = ""; }
				renderMedia();
				renderChannels();
			});
			line.append(size, fits, removeOld);
			host.appendChild(line);
			return;
		}
		// Sagt VOR dem Absenden, was durchgeht -- statt hinterher einen API-Fehler zu zeigen.
		// `shows_media` kommt aus dem Register: Probe und Neuigkeiten zeigen das Bild gar nicht, und
		// sie hier zu nennen wäre ein Versprechen, das der Kanal nicht einlöst. Die Entscheidung
		// steht im Register und nicht als Schlüsselliste hier, sonst läuft sie beim nächsten Kanal
		// von der Serverseite weg.
		const labels = channels
			.filter(function (c) { return c.shows_media && media.fits.indexOf(c.key) !== -1; })
			.map(function (c) { return c.label; });
		fits.className = "social-hub__ok";
		fits.textContent = labels.length ? "✓ Passt für " + labels.join(", ") : "Passt für keinen Netzkanal.";

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "social-hub__soft social-hub__soft--mini";
		remove.textContent = "Entfernen";
		remove.addEventListener("click", function () {
			media = null;
			const file = el("social-file");
			if (file) { file.value = ""; }
			renderMedia();
			renderChannels();
		});

		line.append(size, fits, remove);
		host.appendChild(line);
	}

	function uploadMedia(file) {
		const host = el("social-media-info");
		if (host) { host.textContent = "Bild wird hochgeladen …"; }

		const form = new FormData();
		form.append("media", file);
		form.append("license", (document.querySelector("input[name=social-license]:checked") || {}).value || "own_work");
		form.append("source", (el("social-source") || { value: "" }).value);

		return api("/api/edit/social/media.php", { method: "POST", body: form })
			.then(function (response) {
				if (!response || !response.ok) {
					if (host) {
						host.textContent = (response && response.error && response.error.message)
							|| "Das Bild wurde nicht angenommen.";
					}
					return;
				}
				media = response;
				renderMedia();
				renderChannels();
			});
	}

	function openHub(post) {
		const overlay = el("social-hub-overlay");
		if (!overlay) { return; }

		editingId = post && post.state === "proposal" ? post.id : null;

		// 💣 Ein Entwurf wird VOLLSTÄNDIG wiederhergestellt, nicht nur sein Text. Bis 11.08.2026 kamen
		// Titel, Text und Hashtags zurück -- Bild, Lizenz und vor allem die ANGEHAKTEN KANÄLE nicht.
		// Wer einen Entwurf für Facebook öffnete und speicherte, hatte danach einen für die Probe: die
		// Kanalliste fällt ohne Vorgabe auf ihren Startwert zurück, und das sieht aus wie eine
		// Einstellung, nicht wie ein Verlust.
		media = post && post.media_url
			? { url: post.media_url, width: 0, height: 0, fits: null }
			: null;
		pendingChannels = post && post.targets
			? post.targets.map(function (target) { return target.channel; })
			: null;

		const title = el("social-title");
		const text = el("social-text");
		const tags = el("social-hashtags");
		if (title) { title.value = post ? (post.title || "") : ""; }
		if (text) { text.value = post ? (post.text || "") : ""; }
		if (tags) { tags.value = post ? (post.hashtags || "") : ""; }
		const file = el("social-file");
		if (file) { file.value = ""; }

		// Lizenz und Quelle gehören zum Bild: ohne sie stünde ein wiederhergestellter Entwurf mit
		// freier Lizenz plötzlich als „eigenes Werk" da -- eine Rechteangabe, die niemand gemacht hat.
		const license = post && post.media_license ? post.media_license : "own_work";
		Array.prototype.forEach.call(document.querySelectorAll("input[name=social-license]"), function (radio) {
			radio.checked = radio.value === license;
		});
		const source = el("social-source");
		if (source) {
			source.value = post ? (post.media_source || "") : "";
			source.hidden = license !== "free_license";
		}

		const subtitle = el("social-hub-subtitle");
		if (subtitle) {
			subtitle.textContent = editingId ? "— Entwurf bearbeiten" : "— Beitrag verfassen";
		}

		renderVocabulary();
		renderChannels();
		renderHubDrafts();
		renderMedia();
		overlay.hidden = false;
		if (text) { text.focus(); }
	}

	function closeHub() {
		const overlay = el("social-hub-overlay");
		if (overlay) { overlay.hidden = true; }
		editingId = null;
		// Zurück auf „keine Vorgabe": sonst brächte das nächste, frisch geöffnete Fenster die Kanäle
		// des zuletzt bearbeiteten Entwurfs mit.
		pendingChannels = null;
	}

	// asDraft: der Beitrag landet in der Box statt hinauszugehen. EIN Weg für beides, weil sich sonst
	// zwei Fassungen desselben Formulars auseinanderentwickeln -- der Unterschied ist genau ein Feld.
	function publish(asDraft) {
		const button = el(asDraft ? "social-draft" : "social-publish");
		if (button) { button.disabled = true; }

		const body = {
			action: "create",
			draft: asDraft === true,
			// Wahlfrei, und sie geht nur an „Neuigkeiten" -- deshalb zählt sie auch nicht im Zähler
			// unten, der die Zeichenlimits der Netze bewacht.
			title: (el("social-title") || { value: "" }).value,
			text: (el("social-text") || { value: "" }).value,
			hashtags: currentHashtags(),
			channels: selectedChannelKeys(),
			media_url: media ? media.url : "",
			media_license: (document.querySelector("input[name=social-license]:checked") || {}).value || "",
			media_source: (el("social-source") || { value: "" }).value,
		};

		// 🔴 Ein bearbeiteter Entwurf wird GEÄNDERT, nicht durch einen neuen ersetzt. Bis 11.08.2026
		// verwarf der Client den alten und legte einen zweiten an -- der bekam dabei ein neues Datum
		// und eine neue id, und wer zweimal speicherte, sah einen Entwurf entstehen, statt seinen zu
		// behalten.
		if (editingId) {
			body.action = "update";
			body.id = editingId;
		}

		const send = api("/api/edit/social/publish.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		// „Veröffentlichen" an einem Entwurf heißt: erst die Änderung sichern, DANN freigeben. Zwei
		// Schritte, weil das Ändern nie sendet -- so kann kein halb gespeicherter Text hinausgehen.
		return send.then(function (response) {
			if (!asDraft && editingId && response && response.ok) {
				return api("/api/edit/social/publish.php", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "approve", id: editingId }),
				});
			}
			return response;
		}).then(function (response) {
			if (button) { button.disabled = false; }
			if (!response || !response.ok) {
				const counter = el("social-count");
				if (counter) {
					counter.textContent = (response && response.error && response.error.message)
						|| "Der Beitrag wurde nicht angenommen.";
					counter.classList.add("social-hub__count--over");
				}
				return;
			}
			closeHub();
			load(true);
		});
	}

	function decideProposal(id, action) {
		return api("/api/edit/social/publish.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: action, id: id }),
		}).then(function () { load(true); });
	}

	function bindHub() {
		const open = el("social-open-hub");
		if (open) { open.addEventListener("click", function () { openHub(null); }); }
		const close = el("social-hub-close");
		if (close) { close.addEventListener("click", closeHub); }
		const overlay = el("social-hub-overlay");
		if (overlay) {
			// Klick auf die Hülle schließt, Klick INS Fenster nicht.
			overlay.addEventListener("click", function (event) {
				if (event.target === overlay) { closeHub(); }
			});
		}
		document.addEventListener("keydown", function (event) {
			const box = el("social-hub-overlay");
			if (event.key === "Escape" && box && !box.hidden) { closeHub(); }
		});

		const text = el("social-text");
		if (text) { text.addEventListener("input", updateCount); }
		const tags = el("social-hashtags");
		if (tags) { tags.addEventListener("input", updateCount); }

		// „Freie Lizenz" verlangt die Quelle -- dieselbe Regel wie serverseitig, nur früher sichtbar.
		Array.prototype.forEach.call(document.querySelectorAll("input[name=social-license]"), function (radio) {
			radio.addEventListener("change", function () {
				const source = el("social-source");
				if (source) { source.hidden = radio.value !== "free_license" || !radio.checked; }
			});
		});

		const file = el("social-file");
		if (file) {
			file.addEventListener("change", function () {
				if (file.files && file.files[0]) { uploadMedia(file.files[0]); }
			});
		}

		const publishButton = el("social-publish");
		// Ohne die Hülle: ein Klick-Ereignis als erstes Argument waere `asDraft` und damit wahr --
		// jeder „Veröffentlichen" wuerde still zum Entwurf.
		if (publishButton) { publishButton.addEventListener("click", function () { publish(false); }); }
		const draftButton = el("social-draft");
		if (draftButton) { draftButton.addEventListener("click", function () { publish(true); }); }

		const connectGo = el("social-connect-go");
		if (connectGo) { connectGo.addEventListener("click", submitConnect); }
		const connectCancel = el("social-connect-cancel");
		if (connectCancel) { connectCancel.addEventListener("click", closeConnect); }
		const connectField = el("social-connect-token");
		if (connectField) {
			// Enter im Feld sendet -- ein einzelnes Feld mit einem Knopf daneben verhält sich sonst
			// anders als jedes andere Formular.
			connectField.addEventListener("keydown", function (event) {
				if (event.key === "Enter") { event.preventDefault(); submitConnect(); }
			});
		}
	}

	if (typeof window !== "undefined") {
		window.AvesmapsSocial = {
			reload: function () { return load(true); },
			channels: function () { return channels; },
			vocabulary: function () { return vocabulary; },
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { chipClass, chipLabel, canRetry, strictestLimit, formatCount, postAuthorLabel,
			formatExpiry, proposalNote, isDraft };
	}
})();
