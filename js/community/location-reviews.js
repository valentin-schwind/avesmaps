/*
 * Community-Ortsbewertungen: Anzeige in der Orts-Infobox (Durchschnitt mit halben Sternen +
 * scrollbare Liste), Schreib-Dialog und Editor-Moderation (verbergen/einblenden/löschen).
 */

const LOCATION_REVIEWS_PUBLIC_ENDPOINT = "/api/app/location-reviews.php";
const LOCATION_REVIEWS_EDIT_ENDPOINT = "/api/edit/reviews.php";
const LOCATION_REVIEWS_FETCH_LIMIT = 12;
const LOCATION_REVIEW_BODY_MAX = 200;

let reviewDialogContext = { publicId: "", name: "" };
let reviewDialogStars = 0;

const REVIEW_DSA_MONTH_KEYS = ["praios", "rondra", "efferd", "travia", "boron", "hesinde", "firun", "tsa", "phex", "peraine", "ingerimm", "rahja"];
const REVIEW_DSA_MONTH_DISPLAY = ["Praios", "Rondra", "Efferd", "Travia", "Boron", "Hesinde", "Firun", "Tsa", "Phex", "Peraine", "Ingerimm", "Rahja"];

// Prüft + normalisiert ein aventurisches Datum (Spiegel der Server-Logik).
// ""=leer, gültig=kanonische Form ("7. Rahja 1049 BF"), ungültig=null.
function normalizeReviewDsaDate(input) {
	const value = String(input || "").trim();
	if (value === "") {
		return "";
	}
	let match = value.match(/^(\d{1,2})\s*\.?\s*namenlose[rn]?\s+tage?\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/i);
	if (match) {
		const day = parseInt(match[1], 10);
		const year = parseInt(match[2], 10);
		if (day < 1 || day > 5 || year < 1 || year > 9999) {
			return null;
		}
		const era = match[3] && /^v/i.test(match[3].trim()) ? "v. BF" : "BF";
		return `${day}. Namenloser Tag ${year} ${era}`;
	}
	match = value.match(/^(\d{1,2})\s*\.?\s*([a-zäöü]+)\s+(\d{1,4})\s*(v\.?\s*bf|bf)?$/i);
	if (!match) {
		return null;
	}
	const day = parseInt(match[1], 10);
	const monthIndex = REVIEW_DSA_MONTH_KEYS.indexOf(match[2].toLowerCase());
	const year = parseInt(match[3], 10);
	if (monthIndex < 0 || day < 1 || day > 30 || year < 1 || year > 9999) {
		return null;
	}
	const era = match[4] && /^v/i.test(match[4].trim()) ? "v. BF" : "BF";
	return `${day}. ${REVIEW_DSA_MONTH_DISPLAY[monthIndex]} ${year} ${era}`;
}

function reviewIsEditMode() {
	return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
}

// 5 Sterne mit voll/halb/leer; value 0..5 (auch .5 für den Durchschnitt).
function reviewStarsMarkup(value) {
	const numeric = Math.max(0, Math.min(5, Number(value) || 0));
	let stars = "";
	for (let i = 1; i <= 5; i += 1) {
		let className = "review-star review-star--empty";
		if (numeric >= i) {
			className = "review-star review-star--full";
		} else if (numeric >= i - 0.5) {
			className = "review-star review-star--half";
		}
		stars += `<span class="${className}">★</span>`;
	}
	return `<span class="review-stars" aria-hidden="true">${stars}</span>`;
}

function formatReviewAverage(average) {
	return (Number(average) || 0).toFixed(1).replace(".", ",");
}

function reviewSummaryMarkup(average, count) {
	if (!count) {
		return `<div class="location-reviews__summary location-reviews__summary--empty">${tr("review.emptySummary", "Noch keine Bewertungen – sei die erste Stimme!")}</div>`;
	}
	const label = count === 1 ? tr("review.countSingular", "Bewertung") : tr("review.countPlural", "Bewertungen");
	return '<div class="location-reviews__summary">'
		+ `<span class="location-reviews__avg">${escapeHtml(formatReviewAverage(average))}</span>`
		+ reviewStarsMarkup(average)
		+ `<span class="location-reviews__count">(${count} ${label})</span>`
		+ "</div>";
}

function reviewItemMarkup(review, editable) {
	const author = escapeHtml(review.author || tr("review.anonymousAuthor", "Anonym"));
	const date = escapeHtml(review.dsa_date || "");
	const body = escapeHtml(review.body || "");
	const flags = (review.is_spam ? ' <span class="location-reviews__flag">Spam</span>' : "")
		+ (review.is_hidden ? ' <span class="location-reviews__flag">verborgen</span>' : "");
	const moderation = editable && review.id
		? '<span class="location-reviews__mod">'
			+ (review.is_hidden
				? `<button type="button" class="location-reviews__mod-btn" data-review-action="unhide" data-review-id="${review.id}" title="Wieder einblenden">👁</button>`
				: `<button type="button" class="location-reviews__mod-btn" data-review-action="hide" data-review-id="${review.id}" title="Verbergen">🙈</button>`)
			+ `<button type="button" class="location-reviews__mod-btn" data-review-action="delete" data-review-id="${review.id}" title="Löschen">🗑</button>`
			+ "</span>"
		: "";
	return `<div class="location-reviews__item${review.is_hidden ? " location-reviews__item--hidden" : ""}">`
		+ '<div class="location-reviews__item-head">'
		+ `<span class="location-reviews__author">${author} ${tr("review.writesVerb", "schreibt")}${date ? ` (${date})` : ""}:${flags}</span>`
		+ moderation
		+ "</div>"
		+ reviewStarsMarkup(review.stars)
		+ (body ? `<div class="location-reviews__body">„${body}"</div>` : "")
		+ "</div>";
}

function reviewsListMarkup(reviews, editable) {
	if (!reviews || !reviews.length) {
		return "";
	}
	return `<div class="location-reviews__list">${reviews.map((review) => reviewItemMarkup(review, editable)).join("")}</div>`;
}

// "Bewertung schreiben" gehoert unten zu den Bewertungen (Owner-Vorgabe). Reuse des Popup-Action-Buttons
// (data-popup-action="write-review") -> der bestehende Document-Delegations-Handler (routing.js) oeffnet
// den Dialog. Wird von locationActionsMarkup + dem Route-Popup ENTFERNT und hier zentral gerendert.
function reviewWriteButtonMarkup(publicId, name) {
	if (!publicId || typeof popupActionButtonMarkup !== "function") {
		return "";
	}
	const button = popupActionButtonMarkup({
		label: tr("popup.writeReview", "Bewertung schreiben"),
		iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--review" aria-hidden="true">★</span>',
		attributes: {
			"data-popup-action": "write-review",
			"data-public-id": publicId,
			"data-location-name": name || "",
		},
	});
	const inner = typeof locationPopupActionsMarkup === "function" ? locationPopupActionsMarkup([button]) : button;
	return `<div class="location-reviews__write">${inner}</div>`;
}

function reviewSlotAttrEscape(value) {
	return String(value).replace(/["\\]/g, "\\$&");
}

// Lädt + rendert die Bewertungen eines Ortes in einen Slot-Container der Infobox.
function hydrateLocationReviews(slotEl) {
	if (!slotEl) {
		return;
	}
	const publicId = slotEl.getAttribute("data-reviews-public-id") || "";
	if (!publicId) {
		slotEl.innerHTML = "";
		return;
	}
	const editable = reviewIsEditMode();
	const reviewsName = slotEl.getAttribute("data-reviews-name") || "";
	const base = editable ? LOCATION_REVIEWS_EDIT_ENDPOINT : LOCATION_REVIEWS_PUBLIC_ENDPOINT;
	slotEl.innerHTML = `<div class="location-reviews__loading">${tr("review.loading", "Bewertungen werden geladen …")}</div>`;
	fetch(`${base}?location=${encodeURIComponent(publicId)}&limit=${LOCATION_REVIEWS_FETCH_LIMIT}`, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((data) => {
			if (!data || data.ok === false) {
				// Laden fehlgeschlagen: trotzdem den "Bewertung schreiben"-Button zeigen -- er ist der
				// einzige Einstieg in den Schreib-Dialog; ihn hier zu loeschen macht Bewerten bei jedem
				// API-Fehler unmoeglich.
				slotEl.innerHTML = reviewWriteButtonMarkup(publicId, reviewsName);
				return;
			}
			const reviews = Array.isArray(data.reviews) ? data.reviews : [];
			slotEl.innerHTML = reviewSummaryMarkup(data.average, data.count)
				+ reviewsListMarkup(reviews, editable)
				+ reviewWriteButtonMarkup(publicId, reviewsName);
		})
		.catch(() => {
			slotEl.innerHTML = reviewWriteButtonMarkup(publicId, reviewsName);
		});
}

// Re-Hydrate aller offenen Review-Slots eines Ortes (nach Absenden/Moderation).
function refreshOpenReviewSlots(publicId) {
	if (!publicId) {
		return;
	}
	document
		.querySelectorAll(`.location-reviews[data-reviews-public-id="${reviewSlotAttrEscape(publicId)}"]`)
		.forEach((slotEl) => hydrateLocationReviews(slotEl));
}

// ---- Schreib-Dialog ----

function openReviewDialog(publicId, name) {
	if (!publicId) {
		return;
	}
	reviewDialogContext = { publicId, name: name || "" };
	reviewDialogStars = 0;
	$("#review-dialog-place").text(name || tr("review.thisPlaceFallback", "diesen Ort"));
	$("#review-form-author").val("");
	$("#review-form-body").val("");
	$("#review-form-date").val("");
	$("#review-form-website").val("");
	updateReviewBodyCounter();
	updateReviewStarPicker(0);
	$("#review-overlay").prop("hidden", false);
	window.setTimeout(() => $("#review-form-author").trigger("focus"), 0);
}

function closeReviewDialog() {
	$("#review-overlay").prop("hidden", true);
}

function updateReviewStarPicker(value) {
	reviewDialogStars = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
	$("#review-form-stars .review-form__star").each(function () {
		const starValue = Number($(this).data("star")) || 0;
		$(this).toggleClass("is-active", starValue <= reviewDialogStars);
	});
	$("#review-form-stars-hint").text(reviewDialogStars > 0 ? `${reviewDialogStars} ${tr("review.ofFive", "von 5")}` : tr("review.starsHint", "Sterne vergeben"));
}

function updateReviewBodyCounter() {
	const length = String($("#review-form-body").val() || "").length;
	$("#review-form-body-counter").text(`${length}/${LOCATION_REVIEW_BODY_MAX}`);
}

function submitReviewForm() {
	if (!reviewDialogContext.publicId) {
		return;
	}
	if (reviewDialogStars < 1) {
		showFeedbackToast(tr("review.toastNeedStars", "Bitte vergib 1 bis 5 Sterne."), "warning");
		return;
	}
	// Optionales Datum pruefen: leer = Auto, sonst muss es ein gueltiges aventurisches Datum sein.
	const normalizedDate = normalizeReviewDsaDate(String($("#review-form-date").val() || ""));
	if (normalizedDate === null) {
		showFeedbackToast(tr("review.toastInvalidDate", 'Bitte ein gültiges aventurisches Datum eingeben, z. B. „7. Rahja 1049 BF" – oder das Feld leer lassen.'), "warning");
		$("#review-form-date").trigger("focus");
		return;
	}
	$("#review-form-date").val(normalizedDate);
	const payload = {
		location: reviewDialogContext.publicId,
		location_name: reviewDialogContext.name,
		author: String($("#review-form-author").val() || "").trim(),
		stars: reviewDialogStars,
		body: String($("#review-form-body").val() || "").trim(),
		dsa_date: normalizedDate,
		website: String($("#review-form-website").val() || "").trim(),
	};
	const $submit = $("#review-form-submit").prop("disabled", true);
	fetch(LOCATION_REVIEWS_PUBLIC_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	})
		.then((response) => response.json().catch(() => null))
		.then((data) => {
			if (!data || data.ok === false) {
				showFeedbackToast(apiErrorMessage(data, tr("review.toastSaveFailed", "Bewertung konnte nicht gespeichert werden.")), "warning");
				return;
			}
			showFeedbackToast(data.message || tr("review.toastThanks", "Danke für deine Bewertung!"), "success");
			const publicId = reviewDialogContext.publicId;
			closeReviewDialog();
			refreshOpenReviewSlots(publicId);
		})
		.catch(() => showFeedbackToast(tr("review.toastSendFailed", "Bewertung konnte nicht gesendet werden."), "warning"))
		.finally(() => $submit.prop("disabled", false));
}

// ---- Editor-Moderation ----

function moderateReview(action, id, publicId) {
	fetch(LOCATION_REVIEWS_EDIT_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, id: Number(id) }),
	})
		.then((response) => response.json().catch(() => null))
		.then((data) => {
			if (!data || data.ok === false) {
				showFeedbackToast(apiErrorMessage(data, "Aktion fehlgeschlagen."), "warning");
				return;
			}
			refreshOpenReviewSlots(publicId);
		})
		.catch(() => showFeedbackToast("Aktion fehlgeschlagen.", "warning"));
}

// ---- Wiring ----

$(document).on("click", "#review-form-stars .review-form__star", function () {
	updateReviewStarPicker(Number($(this).data("star")) || 0);
});
$(document).on("input", "#review-form-body", updateReviewBodyCounter);
$(document).on("submit", "#review-form", function (event) {
	event.preventDefault();
	submitReviewForm();
});
$(document).on("click", "[data-review-dialog-close]", function (event) {
	event.preventDefault();
	closeReviewDialog();
});
$(document).on("keydown", function (event) {
	if (event.key === "Escape" && !$("#review-overlay").prop("hidden")) {
		closeReviewDialog();
	}
});
// Moderations-Buttons in der Infobox (nur im Editor sichtbar/aktiv).
$(document).on("click", ".location-reviews__mod-btn", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const action = this.dataset.reviewAction;
	const id = this.dataset.reviewId;
	const slot = this.closest(".location-reviews");
	const publicId = slot ? slot.getAttribute("data-reviews-public-id") : "";
	if (action === "delete" && !window.confirm("Diese Bewertung wirklich endgültig löschen?")) {
		return;
	}
	moderateReview(action, id, publicId);
});
