import { IMAGE_MIN_LONG_EDGE, imageLongEdgeRejectMessage } from "@/lib/website/image-long-edge";
import { SPEC } from "@/lib/website/spec";

export const BODY_LANDSCAPE_MIN_LONG = SPEC.bodyImage.minLong;
export const BODY_LANDSCAPE_RECOMMEND_LONG = SPEC.bodyImage.storeLong;

export type BodyImageReject = { kind: "size"; width: number; height: number };

export function validateBodyImageDimensions(
  _preset: string | undefined,
  _width: number,
  _height: number,
  _opts?: { mime?: string | null; src?: string | null }
): BodyImageReject | null {
  return null;
}

export function bodyImageRejectMessage(reject: BodyImageReject): string {
  return imageLongEdgeRejectMessage(reject.width, reject.height);
}

export function bodyImageWarnMessage(
  _preset: string | undefined,
  _width: number,
  _height: number
): string | null {
  return null;
}

export { IMAGE_MIN_LONG_EDGE };
