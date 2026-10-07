import { finishApplicationLoading } from "./app-ready.ts";
import { connectComparisonPacket } from "./comparison-packet-ui.ts";
import { getElement } from "./render.ts";

try { connectComparisonPacket(); }
catch (error) {
  if (!(error instanceof Error)) throw error;
  const notice = getElement("packet-error");
  notice.textContent = "The comparison inspector could not initialize. Reload this page before selecting a packet; no file was read or history changed.";
  notice.hidden = false;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) control.disabled = true;
  console.error("decision_continuity_packet_initialization_failed", { name: error.name, message: error.message.slice(0, 600) });
  throw error;
}
finally { finishApplicationLoading(); }
