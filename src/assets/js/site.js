const emitAnalyticsEvent = (eventName, detail = {}) => {
  const payload = { event: eventName, ...detail };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
  document.dispatchEvent(new CustomEvent(`abs:${eventName}`, { detail: payload }));
};

const syncModalBody = () => {
  document.body.classList.toggle("modal-open", Boolean(document.querySelector(".modal.show")));
};

const showProjectModal = (modal) => {
  if (!modal) return;
  if (window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(modal).show();
    return;
  }

  modal.classList.add("show");
  modal.style.display = "block";
  modal.setAttribute("aria-hidden", "false");
  syncModalBody();
};

const hideProjectModal = (modal) => {
  if (!modal) return;
  if (window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(modal).hide();
    return;
  }

  modal.classList.remove("show");
  modal.style.removeProperty("display");
  modal.setAttribute("aria-hidden", "true");
  syncModalBody();
};

const siteHeader = document.querySelector(".site-header");
const headerShell = siteHeader?.querySelector(".header-shell");
if (siteHeader && headerShell) {
  const compactNavigation = new Set(["Водители", "Машинисты", "О компании", "Контакты"]);
  const secondaryItems = [...siteHeader.querySelectorAll(".navbar-nav > .nav-item")]
    .filter((item) => !compactNavigation.has(item.querySelector(":scope > .nav-link")?.textContent.trim()));
  secondaryItems.forEach((item) => item.classList.add("header-secondary-item"));
  const topline = siteHeader.querySelector(".header-topline");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let expandedHeight = 0;
  let morphAnimation;
  let scrollQueued = false;

  const measureExpandedHeight = () => {
    const copy = siteHeader.cloneNode(true);
    copy.classList.remove("header-is-compact");
    copy.removeAttribute("id");
    copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    Object.assign(copy.style, {
      position: "absolute", top: "0", left: "0", right: "auto", height: "auto",
      width: `${siteHeader.getBoundingClientRect().width}px`, visibility: "hidden", pointerEvents: "none",
    });
    const menu = copy.querySelector(".navbar-collapse");
    menu?.classList.remove("show", "collapsing");
    menu?.classList.add("collapse");
    if (menu) menu.style.height = "";
    document.body.append(copy);
    expandedHeight = copy.getBoundingClientRect().height;
    copy.remove();
    if (siteHeader.classList.contains("header-is-compact")) siteHeader.style.height = `${expandedHeight}px`;
  };

  const updateHeader = (animate = true) => {
    scrollQueued = false;
    const compact = window.scrollY > 8;
    if (siteHeader.classList.contains("header-is-compact") === compact) return;
    const before = headerShell.getBoundingClientRect();
    const previousRadius = getComputedStyle(headerShell).borderRadius;
    morphAnimation?.cancel();
    siteHeader.style.height = compact ? `${expandedHeight}px` : "";
    siteHeader.classList.toggle("header-is-compact", compact);
    secondaryItems.forEach((item) => { item.inert = compact; });
    if (topline) topline.inert = compact;
    if (!animate || reducedMotion.matches) return;

    const after = headerShell.getBoundingClientRect();
    const offsetX = compact
      ? before.left + before.width / 2 - after.left - after.width / 2
      : before.left - after.left;
    const offsetY = Math.max(before.top, -before.height) - after.top;
    const baseTransform = compact ? "translateX(-50%) " : "";
    morphAnimation = headerShell.animate([
      { transform: `${baseTransform}translate(${offsetX}px, ${offsetY}px)`, width: `${before.width}px`, maxWidth: `${before.width}px`, height: `${before.height}px`, borderRadius: previousRadius },
      { transform: `${baseTransform}translate(0, 0)`, width: `${after.width}px`, maxWidth: `${after.width}px`, height: `${after.height}px`, borderRadius: getComputedStyle(headerShell).borderRadius },
    ], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  };

  window.addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => updateHeader());
  }, { passive: true });
  window.addEventListener("resize", () => { morphAnimation?.cancel(); measureExpandedHeight(); });
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) morphAnimation?.cancel(); });
  document.fonts?.ready.then(measureExpandedHeight);
  measureExpandedHeight();
  updateHeader(false);
}

const navigation = document.getElementById("siteNavigation");
if (navigation && window.bootstrap) {
  const navigationHeader = navigation.closest(".site-header");
  const navigationToggler = navigationHeader?.querySelector(".navbar-toggler");

  document.addEventListener("click", (event) => {
    if (!navigation.classList.contains("show")) return;
    if (navigation.contains(event.target) || navigationToggler?.contains(event.target)) return;
    window.bootstrap.Collapse.getOrCreateInstance(navigation).hide();
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (navigation.classList.contains("show")) {
        window.bootstrap.Collapse.getOrCreateInstance(navigation).hide();
      }
    });
  });
}

document.querySelectorAll("[data-request-form]").forEach((form) => {
  const startedAt = Date.now();
  const submittedAt = form.querySelector("[data-submitted-at]");
  const sourceUrl = form.querySelector("[data-source-url]");
  const submitButton = form.querySelector("[data-submit-button]");
  const submitLabel = form.querySelector("[data-submit-label]");
  const submitSpinner = form.querySelector("[data-submit-spinner]");
  const errorPanel = form.querySelector("[data-form-error]");
  const validationModal = form.parentElement?.querySelector("[data-validation-modal]") || document.querySelector("[data-validation-modal]");
  const validationMessage = validationModal?.querySelector("[data-validation-message]");
  let hasStarted = false;

  if (submittedAt) submittedAt.value = String(startedAt);
  if (sourceUrl) sourceUrl.value = window.location.href;

  const markStarted = () => {
    if (hasStarted) return;
    hasStarted = true;
    emitAnalyticsEvent("form_start", { page_type: document.body.dataset.pageType || "" });
  };

  form.addEventListener("input", markStarted, { once: true });
  const showValidationMessage = (message) => {
    if (validationMessage) validationMessage.textContent = message;
    showProjectModal(validationModal);
  };

  validationModal?.querySelectorAll("[data-bs-dismiss=modal]").forEach((button) => {
    button.addEventListener("click", () => {
      hideProjectModal(validationModal);
    });
  });

  form.addEventListener("submit", (event) => {
    const name = form.elements.name?.value.trim();
    const phone = form.elements.phone?.value.trim();
    const consent = form.elements.consent;

    if (!name || !phone) {
      event.preventDefault();
      event.stopPropagation();
      form.classList.add("was-validated");
      showValidationMessage("Заполните имя и телефон.");
      (name ? form.elements.phone : form.elements.name)?.focus();
      emitAnalyticsEvent("form_validation_error", { page_type: document.body.dataset.pageType || "" });
      return;
    }

    if (!consent?.checked) {
      event.preventDefault();
      event.stopPropagation();
      form.classList.add("was-validated");
      showValidationMessage("Подтвердите согласие на обработку персональных данных.");
      consent?.focus();
      emitAnalyticsEvent("form_validation_error", { page_type: document.body.dataset.pageType || "" });
      return;
    }

    if (!form.checkValidity()) {
      event.preventDefault();
      event.stopPropagation();
      form.classList.add("was-validated");
      emitAnalyticsEvent("form_validation_error", { page_type: document.body.dataset.pageType || "" });
      form.querySelector(":invalid")?.focus();
      return;
    }

    errorPanel?.classList.add("d-none");
    if (submitButton) submitButton.disabled = true;
    if (submitLabel) submitLabel.textContent = "Отправляем";
    submitSpinner?.classList.remove("d-none");
    emitAnalyticsEvent("form_submit", { page_type: document.body.dataset.pageType || "" });
  });
});

const requestPopup = document.querySelector("[data-request-popup]");
const requestPopupSource = document.querySelector("[data-request-popup-source]");
const requestPopupFormHost = requestPopup?.querySelector("[data-request-popup-form]");
const requestPopupForm = requestPopupSource?.querySelector("[data-request-form]");
const restoreRequestForm = () => {
  if (requestPopupForm && requestPopupSource && requestPopupForm.parentElement !== requestPopupSource) {
    requestPopupSource.prepend(requestPopupForm);
  }
};

requestPopup?.addEventListener("hidden.bs.modal", restoreRequestForm);
requestPopup?.querySelectorAll("[data-bs-dismiss=modal]").forEach((button) => {
  button.addEventListener("click", () => {
    if (window.bootstrap) return;
    hideProjectModal(requestPopup);
    restoreRequestForm();
  });
});

requestPopup?.addEventListener("click", (event) => {
  if (!window.bootstrap && event.target === requestPopup) {
    hideProjectModal(requestPopup);
    restoreRequestForm();
  }
});

document.querySelectorAll("[data-request-popup-trigger]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    if (!requestPopup || !requestPopupForm || !requestPopupFormHost) return;
    event.preventDefault();
    requestPopupFormHost.append(requestPopupForm);
    showProjectModal(requestPopup);
  });
});

const status = new URLSearchParams(window.location.search).get("status");
if (status === "error") {
  const errorPanel = document.querySelector("[data-form-error]");
  errorPanel?.classList.remove("d-none");
  emitAnalyticsEvent("form_error", { page_type: document.body.dataset.pageType || "" });
}

if (document.body.dataset.pageType === "service-thanks") {
  emitAnalyticsEvent("form_success", { page_type: document.body.dataset.pageType });
}
