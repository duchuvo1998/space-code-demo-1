export function createDialogController({ onWelcomeDismissed = () => {} } = {}) {
  let closeWelcomeDialog = null;
  let welcomeBackdropHandler = null;
  const activeDialogs = new Map();

  function openAccessibleDialog(dialog, initialFocus, onCancel) {
    const previousFocus = document.activeElement;
    const inertSiblings = [...dialog.parentElement.children]
      .filter(element => element !== dialog)
      .map(element => [element, element.inert]);
    inertSiblings.forEach(([element]) => { element.inert = true; });

    const getFocusableElements = () => [...dialog.querySelectorAll(
      'a[href]:not([hidden]), button:not(:disabled):not([hidden]), input:not([type="hidden"]):not(:disabled):not([hidden]), select:not(:disabled):not([hidden]), textarea:not(:disabled):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])'
    )].filter(element => {
      if (element.closest("[inert], [hidden]")) return false;
      if (typeof getComputedStyle === "function") {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
      }
      return true;
    });
    const handleKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.classList.add("open");
    document.addEventListener("keydown", handleKeydown);

    requestAnimationFrame(() => {
      if (!dialog.classList.contains("open")) return;
      const target = typeof initialFocus === "function" ? initialFocus() : initialFocus;
      (target && !target.hidden && !target.disabled ? target : getFocusableElements()[0] || dialog)?.focus();
    });

    return ({ restoreFocus = true, focusTarget = null } = {}) => {
      if (!dialog.classList.contains("open")) return;
      dialog.classList.remove("open");
      document.removeEventListener("keydown", handleKeydown);
      inertSiblings.forEach(([element, wasInert]) => { element.inert = wasInert; });
      if (!restoreFocus) return;

      const fallbackFocus = previousFocus === document.body || previousFocus === document.documentElement
        ? document.getElementById("mainContent")
        : previousFocus;
      let target = focusTarget || fallbackFocus;
      const closedDetails = target instanceof HTMLElement ? target.closest("details:not([open])") : null;
      if (closedDetails) {
        target = closedDetails.querySelector("summary") || document.getElementById("mainContent");
      }
      if (target instanceof HTMLElement && target.isConnected && !target.disabled) {
        target.focus({ preventScroll: true });
      }
    };
  }

  function openDialog(dialog, { initialFocus = null, onCancel = null, closeOnBackdrop = true } = {}) {
    if (!dialog) return null;
    if (activeDialogs.has(dialog)) return activeDialogs.get(dialog);

    let closeFn = null;
    const handleCancel = () => {
      if (onCancel) {
        onCancel();
        return;
      }
      closeFn?.();
    };
    const handleBackdropClick = event => {
      if (closeOnBackdrop && event.target === dialog) {
        handleCancel();
      }
    };
    dialog.addEventListener("click", handleBackdropClick);
    const rawClose = openAccessibleDialog(dialog, initialFocus, handleCancel);
    closeFn = (options = {}) => {
      if (!activeDialogs.has(dialog)) return;
      activeDialogs.delete(dialog);
      dialog.removeEventListener("click", handleBackdropClick);
      rawClose(options);
    };
    activeDialogs.set(dialog, closeFn);
    return closeFn;
  }

  function closeDialog(dialog, options) {
    if (!dialog) return;
    const closeFn = activeDialogs.get(dialog);
    if (closeFn) {
      closeFn(options);
    } else {
      dialog.classList.remove("open");
    }
  }

  function closeWelcomeWithoutChoice(options) {
    if (!closeWelcomeDialog) return;
    const dialog = document.getElementById("welcomeModal");
    if (welcomeBackdropHandler) {
      dialog.removeEventListener("click", welcomeBackdropHandler);
      welcomeBackdropHandler = null;
    }
    const closeDialog = closeWelcomeDialog;
    closeWelcomeDialog = null;
    closeDialog(options);
  }

  function dismissWelcome() {
    closeWelcomeWithoutChoice();
    onWelcomeDismissed();
  }

  function showWelcome(focusLogin = false) {
    if (closeWelcomeDialog) return;
    const dialog = document.getElementById("welcomeModal");
    const loginButton = document.getElementById("welcomeLoginButton");
    const continueButton = document.getElementById("welcomeContinueButton");
    const initialFocus = focusLogin && !loginButton.hidden
      ? loginButton
      : loginButton.hidden ? continueButton : loginButton;
    welcomeBackdropHandler = event => {
      if (event.target === dialog) closeWelcomeWithoutChoice();
    };
    dialog.addEventListener("click", welcomeBackdropHandler);
    closeWelcomeDialog = openAccessibleDialog(dialog, initialFocus, closeWelcomeWithoutChoice);
  }

  function requestSyncConflictResolution({
    description = "",
    cloudTitle = "",
    localItems = [],
    cloudItems = [],
    recommended = "merge"
  } = {}) {
    const welcomeWasOpen = document.getElementById("welcomeModal").classList.contains("open");
    if (welcomeWasOpen) {
      closeWelcomeWithoutChoice({ restoreFocus: false });
    }

    return new Promise(resolve => {
      const dialog = document.getElementById("syncConflictModal");
      const descriptionEl = document.getElementById("syncConflictDescription");
      const cloudTitleEl = document.getElementById("syncSummaryCloudTitle");
      const localListEl = document.getElementById("syncSummaryLocalList");
      const cloudListEl = document.getElementById("syncSummaryCloudList");
      const cancelButton = document.getElementById("cancelSyncConflict");
      const confirmButton = document.getElementById("confirmSyncConflict");
      const radios = [...dialog.querySelectorAll('input[name="syncConflictChoice"]')];

      if (descriptionEl) descriptionEl.textContent = description;
      if (cloudTitleEl && cloudTitle) cloudTitleEl.textContent = cloudTitle;
      if (localListEl) {
        localListEl.innerHTML = "";
        localItems.forEach(text => {
          const item = document.createElement("li");
          item.textContent = text;
          localListEl.appendChild(item);
        });
      }
      if (cloudListEl) {
        cloudListEl.innerHTML = "";
        cloudItems.forEach(text => {
          const item = document.createElement("li");
          item.textContent = text;
          cloudListEl.appendChild(item);
        });
      }

      dialog.querySelectorAll("[data-recommended-for]").forEach(badge => {
        badge.hidden = badge.dataset.recommendedFor !== recommended;
      });

      const defaultRadio = radios.find(radio => radio.value === recommended) || radios[0];
      radios.forEach(radio => {
        radio.checked = radio === defaultRadio;
      });

      const updateConfirmStyle = () => {
        const selected = radios.find(radio => radio.checked)?.value || recommended;
        confirmButton.classList.toggle("btn-danger", selected === "replace-cloud");
        confirmButton.classList.toggle("btn-primary", selected !== "replace-cloud");
      };
      updateConfirmStyle();

      let closeDialog;
      const finish = choice => {
        dialog.removeEventListener("click", handleClick);
        dialog.removeEventListener("change", updateConfirmStyle);
        closeDialog?.({
          restoreFocus: Boolean(choice) || !welcomeWasOpen,
          focusTarget: Boolean(choice) && welcomeWasOpen ? document.getElementById("accountButton") : null
        });
        resolve(choice);
      };
      const handleClick = event => {
        if (event.target === dialog) {
          finish(null);
          return;
        }
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("#cancelSyncConflict")) {
          finish(null);
        } else if (event.target.closest("#confirmSyncConflict")) {
          const selected = radios.find(radio => radio.checked)?.value || recommended;
          finish(selected);
        }
      };

      dialog.addEventListener("click", handleClick);
      dialog.addEventListener("change", updateConfirmStyle);
      closeDialog = openAccessibleDialog(dialog, defaultRadio || cancelButton, () => finish(null));
    });
  }

  function requestSignOutConfirmation({ description = "" } = {}) {
    return new Promise(resolve => {
      const dialog = document.getElementById("signOutModal");
      const descriptionEl = document.getElementById("signOutModalDescription");
      const clearLocalCheckbox = document.getElementById("signOutClearLocal");
      const cancelButton = document.getElementById("cancelSignOut");

      if (descriptionEl) descriptionEl.textContent = description;
      if (clearLocalCheckbox) clearLocalCheckbox.checked = false;

      let closeDialog;
      const finish = result => {
        dialog.removeEventListener("click", handleClick);
        closeDialog?.({
          restoreFocus: true,
          focusTarget: document.getElementById("accountButton")
        });
        resolve(result);
      };
      const handleClick = event => {
        if (event.target === dialog) {
          finish(null);
          return;
        }
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("#cancelSignOut")) {
          finish(null);
        } else if (event.target.closest("#confirmSignOut")) {
          finish({ confirmed: true, clearLocal: Boolean(clearLocalCheckbox?.checked) });
        }
      };

      dialog.addEventListener("click", handleClick);
      closeDialog = openAccessibleDialog(dialog, cancelButton, () => finish(null));
    });
  }

  return {
    closeDialog,
    closeWelcomeWithoutChoice,
    dismissWelcome,
    openDialog,
    requestSignOutConfirmation,
    requestSyncConflictResolution,
    showWelcome
  };
}
