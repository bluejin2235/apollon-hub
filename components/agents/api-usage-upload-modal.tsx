"use client";

import { AgentsModalPortal } from "@/components/agents/agents-modal-portal";
import { ApiUsageUpload } from "@/components/agents/api-usage-upload";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export function ApiUsageUploadModal({ open, onClose, onSaved }: Props) {
  return (
    <AgentsModalPortal open={open} title="CSV 업로드" onClose={onClose} maxWidthClass="max-w-2xl">
      <ApiUsageUpload
        variant="modal"
        onSaved={() => {
          onSaved?.();
          onClose();
        }}
      />
    </AgentsModalPortal>
  );
}
