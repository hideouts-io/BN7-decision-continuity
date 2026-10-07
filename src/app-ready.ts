import { getElement } from "./render.ts";
import { connectWorkspaceNavigation } from "./workspace-navigation.ts";

/** Enable interaction only after initialization has installed handlers or displayed its error. */
export function finishApplicationLoading(): void {
  getElement("main").inert = false;
  getElement("app-loading").hidden = true;
  connectWorkspaceNavigation();
  document.documentElement.dataset.appReady = "true";
}
