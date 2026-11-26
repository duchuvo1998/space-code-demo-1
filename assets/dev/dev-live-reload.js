(() => {
  let version = null;

  async function checkForChanges() {
    try {
      const response = await fetch("/__dev__/version", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (version !== null && result.version !== version) {
        window.location.reload();
        return;
      }
      version = result.version;
    } catch (error) {
      console.warn("Local live-reload check failed.", error);
    }
    window.setTimeout(checkForChanges, 1000);
  }

  void checkForChanges();
})();
