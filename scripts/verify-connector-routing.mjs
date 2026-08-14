import { resolveConnectorsAuto, formatConnectorRoutingSummary } from "../lib/luna/connector-routing.ts";

const message = "청담 오피스라운지 제안서 찾아줘";
const result = resolveConnectorsAuto(message, {
  hasAttachments: false,
  manual: { notion: false, web: false, nas: false }
});

console.log("=== Connector routing verification ===");
console.log("message:", message);
console.log("connectors:", result.connectors);
console.log("reason:", result.reason);
console.log("reasonLabel:", result.reasonLabel);
console.log("summary:", formatConnectorRoutingSummary(result));