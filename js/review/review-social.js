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
		approve.className = "review-panel__button social-hub__primary--mini";
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

			const text = document.createElement("p");
			text.className = "social-post__text";
			text.textContent = post.text || "";

			item.append(top, text);

			if (post.state === "proposal") {
				const note = document.createElement("p");
				note.className = "social-post__note";
				note.textContent = "Vorschlag der Routine — wartet auf Freigabe.";
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
			renderList(response.posts || []);
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
				// Erst laden, wenn der Unterreiter wirklich angesehen wird: die Liste ist eine Abfrage
				// über zwei Tabellen und niemand braucht sie beim Öffnen des Editors.
				const tab = document.querySelector('[data-review-subtab="social"]');
				if (tab) { tab.addEventListener("click", function () { load(false); }); }
				if (tab && tab.classList.contains("is-active")) { load(false); }
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
			const row = document.createElement("label");
			row.className = "social-hub__channel" + (channel.configured ? "" : " social-hub__channel--off");

			const box = document.createElement("input");
			box.type = "checkbox";
			box.value = channel.key;
			// Ein Kanal ohne Zugang ist ausgegraut und nicht anhakbar -- aber sichtbar. Wer den Hub
			// sieht, soll wissen, was möglich wäre (Entwurf §3).
			box.disabled = !channel.configured;
			// Instagram ohne Bild bleibt gesperrt: dort ist ein Beitrag ohne Bild kein Beitrag.
			if (channel.requires_media && !media) { box.disabled = true; }
			box.checked = channel.configured && !box.disabled && channel.key === "probe";
			box.addEventListener("change", updateCount);

			const name = document.createElement("span");
			name.className = "social-hub__channel-name";
			name.textContent = channel.label;

			const meta = document.createElement("span");
			meta.className = "social-hub__channel-meta";
			const parts = [channel.configured ? channel.account : "noch nicht eingerichtet"];
			if (channel.configured) {
				if (channel.requires_media) { parts.push("Bild erforderlich"); }
				if (channel.max_chars !== null) { parts.push("max. " + channel.max_chars + " Zeichen"); }
				if (!channel.clickable_links) { parts.push("Links nicht klickbar"); }
			}
			meta.textContent = parts.join(" · ");

			const label = document.createElement("span");
			label.append(name, meta);
			row.append(box, label);
			host.appendChild(row);
		});

		const hint = el("social-channel-hint");
		if (hint) {
			hint.textContent = media
				? ""
				: "Instagram braucht ein Bild — ohne Anhang bleibt der Kanal gesperrt.";
		}
		updateCount();
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

		const line = document.createElement("div");
		line.className = "social-hub__media-line";
		const size = document.createElement("small");
		size.textContent = media.width + " × " + media.height
			+ (media.cropped ? " (zugeschnitten)" : "")
			+ " · " + Math.round(media.bytes / 1024) + " kB · JPEG";
		const fits = document.createElement("small");
		// Sagt VOR dem Absenden, was durchgeht -- statt hinterher einen API-Fehler zu zeigen.
		const labels = channels
			.filter(function (c) { return media.fits.indexOf(c.key) !== -1 && c.key !== "probe"; })
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
		media = null;
		const text = el("social-text");
		const tags = el("social-hashtags");
		if (text) { text.value = post ? (post.text || "") : ""; }
		if (tags) { tags.value = post ? (post.hashtags || "") : ""; }
		const file = el("social-file");
		if (file) { file.value = ""; }

		const subtitle = el("social-hub-subtitle");
		if (subtitle) {
			subtitle.textContent = editingId ? "— Vorschlag bearbeiten" : "— Beitrag verfassen";
		}

		renderVocabulary();
		renderChannels();
		renderMedia();
		overlay.hidden = false;
		if (text) { text.focus(); }
	}

	function closeHub() {
		const overlay = el("social-hub-overlay");
		if (overlay) { overlay.hidden = true; }
		editingId = null;
	}

	function publish() {
		const button = el("social-publish");
		if (button) { button.disabled = true; }

		const body = {
			action: "create",
			text: (el("social-text") || { value: "" }).value,
			hashtags: currentHashtags(),
			channels: selectedChannelKeys(),
			media_url: media ? media.url : "",
			media_license: (document.querySelector("input[name=social-license]:checked") || {}).value || "",
			media_source: (el("social-source") || { value: "" }).value,
		};

		// Ein bearbeiteter Vorschlag wird als neuer Beitrag gesendet und der alte verworfen -- so ist
		// im Verlauf sichtbar, dass jemand eingegriffen hat, statt dass der Vorschlag sich still ändert.
		const discardFirst = editingId
			? api("/api/edit/social/publish.php", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "discard", id: editingId }),
			})
			: Promise.resolve(null);

		return discardFirst.then(function () {
			return api("/api/edit/social/publish.php", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
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
		if (publishButton) { publishButton.addEventListener("click", publish); }
	}

	if (typeof window !== "undefined") {
		window.AvesmapsSocial = {
			reload: function () { return load(true); },
			channels: function () { return channels; },
			vocabulary: function () { return vocabulary; },
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { chipClass, chipLabel, canRetry, strictestLimit, formatCount, postAuthorLabel };
	}
})();
