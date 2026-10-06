import { getElement } from "./render.ts";

/** Enable interaction only after initialization has installed handlers or displayed its error. */
export function finishApplicationLoading(): void {
  getElement("main").inert = false;
  getElement("app-loading").hidden = true;
  document.documentElement.dataset.appReady = "true";
}
