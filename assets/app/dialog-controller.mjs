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

  function requestCloudOverwriteConsent() {
    const welcomeWasOpen = document.getElementById("welcomeModal").classList.contains("open");
    if (welcomeWasOpen) {
      closeWelcomeWithoutChoice({ restoreFocus: false });
    }

    return new Promise(resolve => {
      const dialog = document.getElementById("cloudOverwriteModal");
      const cancelButton = dialog.querySelector('[data-cloud-overwrite-choice="cancel"]');
      let closeDialog;
      const finish = approved => {
        dialog.removeEventListener("click", handleClick);
        closeDialog?.({
          restoreFocus: approved || !welcomeWasOpen,
          focusTarget: approved && welcomeWasOpen ? document.getElementById("accountButton") : null
        });
        resolve(approved);
      };
      const handleClick = event => {
        if (!(event.target instanceof Element)) return;
        const choice = event.target.closest("[data-cloud-overwrite-choice]");
        if (choice) finish(choice.dataset.cloudOverwriteChoice === "replace");
        else if (event.target === dialog) finish(false);
      };

      dialog.addEventListener("click", handleClick);
      closeDialog = openAccessibleDialog(dialog, cancelButton, () => finish(false));
    });
  }

  return {
    closeDialog,
    closeWelcomeWithoutChoice,
    dismissWelcome,
    openDialog,
    requestCloudOverwriteConsent,
    showWelcome
  };
}
