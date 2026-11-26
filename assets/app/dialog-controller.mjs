export function createDialogController({ onWelcomeDismissed = () => {} } = {}) {
  let closeWelcomeDialog = null;
  let welcomeBackdropHandler = null;

  function openAccessibleDialog(dialog, initialFocus, onCancel) {
    const previousFocus = document.activeElement;
    const inertSiblings = [...dialog.parentElement.children]
      .filter(element => element !== dialog)
      .map(element => [element, element.inert]);
    inertSiblings.forEach(([element]) => { element.inert = true; });

    const getFocusableElements = () => [...dialog.querySelectorAll(
      'a[href]:not([hidden]), button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), select:not(:disabled):not([hidden]), textarea:not(:disabled):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])'
    )].filter(element => !element.closest("[inert]"));
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
      (target && !target.hidden && !target.disabled ? target : getFocusableElements()[0])?.focus();
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
      const target = focusTarget || fallbackFocus;
      if (target instanceof HTMLElement && target.isConnected && !target.disabled) {
        target.focus({ preventScroll: true });
      }
    };
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
    closeWelcomeWithoutChoice,
    dismissWelcome,
    requestCloudOverwriteConsent,
    showWelcome
  };
}
