import type { LunaCard } from "@/lib/luna/tavily";
import { formatNasFilePath } from "@/lib/luna/nas-path";
import {
  DEFAULT_RAIDRIVE_PREFIX_P,
  DEFAULT_RAIDRIVE_PREFIX_T,
  type ModalPathTab,
  type NasPathSettings
} from "@/lib/luna/nas-path-settings";

export const MODAL_PATH_TABS: { id: ModalPathTab; label: string }[] = [
  { id: "office", label: "사무실" },
  { id: "custom", label: "RaiDrive" },
  { id: "unc", label: "UNC" }
];

export function settingsForModalPathTab(
  tab: ModalPathTab,
  base: NasPathSettings
): NasPathSettings {
  if (tab === "custom") {
    return {
      mode: "custom",
      prefixT: base.prefixT.trim() || DEFAULT_RAIDRIVE_PREFIX_T,
      prefixP: base.prefixP.trim() || DEFAULT_RAIDRIVE_PREFIX_P
    };
  }
  return { mode: tab, prefixT: base.prefixT, prefixP: base.prefixP };
}

export function modalFilePath(
  card: LunaCard,
  tab: ModalPathTab,
  base: NasPathSettings
): string {
  if (!card.raw_path) return "";
  const settings = settingsForModalPathTab(tab, base);
  const name =
    card.title || card.raw_path.split(/[/\\]/).pop() || card.raw_path;
  return formatNasFilePath(card.drive, card.raw_path, settings, name);
}
