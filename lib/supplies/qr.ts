import QRCode from "qrcode";
import { supplyPublicUrl } from "@/lib/supplies/utils";

export async function generateSupplyQrDataUrl(code: string): Promise<string> {
  const url = supplyPublicUrl(code);
  return QRCode.toDataURL(url, { margin: 0, width: 340, errorCorrectionLevel: "M" });
}
