import { getElement } from "./render.ts";

function section(id: string): HTMLElement {
  const target = document.getElementById(id);
  if (target === null) throw new ReferenceError(`Workspace section #${id} is unavailable. Reload this page to restore its interface.`);
  if (target.closest("[hidden]") !== null) {
    if (id === "uncertainty-panel") throw new RangeError("Create an explicit v7 continuation from a saved v6 case, or restore a complete v7 export, before opening evidence requirements.");
    throw new RangeError("Create or restore a saved case before opening this section. Recorded-basis inspection requires v6 decision records, directly or inside a v7 continuation.");
  }
  return target;
}

function focusSection(target: HTMLElement): void {
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: "instant", block: "start" });
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-workspace-section]")) {
    if (link.dataset.workspaceSection === target.id) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

/** Section navigation changes focus and the fragment only; it never creates, imports or revises a record. */
export function connectWorkspaceNavigation(): void {
  const notice = document.createElement("p");
  notice.id = "navigation-status"; notice.dataset.testid = "navigation-status";
  notice.className = "navigation-status"; notice.setAttribute("role", "status");
  const navigation = document.querySelector(".app-section-nav");
  if (navigation === null) throw new ReferenceError("Workspace navigation is missing from this page.");
  navigation.after(notice);
  const links = document.querySelectorAll<HTMLAnchorElement>("[data-workspace-section]");
  function availability(): void {
    for (const link of links) {
      const target = getElement(link.hash.slice(1));
      if (target.closest("[hidden]") !== null) link.setAttribute("aria-disabled", "true");
      else link.removeAttribute("aria-disabled");
    }
  }
  function navigate(id: string): void {
    notice.textContent = "";
    try { focusSection(section(id)); }
    catch (error) {
      if (!(error instanceof RangeError || error instanceof ReferenceError)) throw error;
      notice.textContent = error.message;
    }
  }
  for (const link of links) link.addEventListener("click", (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.hash.slice(1));
    if (notice.textContent === "" && window.location.hash !== link.hash) window.history.pushState(null, "", link.href);
  });
  const url = new URL(window.location.href);
  if (url.pathname.endsWith("/impact.html")) {
    getElement("nav-workspace").removeAttribute("aria-current");
    getElement(["6", "7"].includes(url.searchParams.get("format") ?? "") ? "nav-workspace" : "nav-legacy").setAttribute("aria-current", "page");
  }
  availability();
  new MutationObserver(availability).observe(getElement("main"), { attributes: true, attributeFilter: ["hidden"], subtree: true });
  window.addEventListener("hashchange", (): void => {
    const id = window.location.hash.slice(1);
    if (id === "") {
      for (const link of links) link.removeAttribute("aria-current");
      focusSection(getElement("main"));
      return;
    }
    if ([...links].some((link): boolean => link.dataset.workspaceSection === id)) navigate(id);
  });
  const initial = url.hash.slice(1);
  if ([...links].some((link): boolean => link.dataset.workspaceSection === initial)) navigate(initial);
}
