"use client";

import { useEffect, useMemo, useState } from "react";
import { generateSupplyQrDataUrl } from "@/lib/supplies/qr";

export type QrStickerItem = { code: string; name: string };

type Props = {
  items: QrStickerItem[];
  title?: string;
  onClose?: () => void;
};

/** Brother PT-P750W + TZe-231 (12mm 흰색 테이프) 세로형 스티커 */
export function QrPrintSheet({ items, title = "비품 QR 스티커 (12mm)", onClose }: Props) {
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const itemKey = useMemo(() => items.map((i) => i.code).join(","), [items]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const item of items) {
        next[item.code] = await generateSupplyQrDataUrl(item.code);
      }
      if (!cancelled) setQrs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemKey]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="qr-print-root fixed inset-0 z-50 overflow-auto bg-slate-100">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">Brother PT-P750W · TZe-231 (12mm) 세로형</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            인쇄
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              닫기
            </button>
          ) : null}
        </div>
      </div>

      <div className="qr-print-area mx-auto p-6">
        {items.map((item) => (
          <article key={item.code} className="qr-sticker">
            <div className="qr-sticker-qr-wrap">
              {qrs[item.code] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrs[item.code]} alt="" className="qr-sticker-qr" />
              ) : (
                <div className="qr-sticker-qr qr-sticker-qr--loading" />
              )}
            </div>
            <p className="qr-sticker-code">{item.code}</p>
            <p className="qr-sticker-name">{item.name}</p>
          </article>
        ))}
      </div>

      <style jsx global>{`
        .qr-print-area {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: center;
          gap: 4mm;
        }

        .qr-sticker {
          box-sizing: border-box;
          width: 12mm;
          background: #fff;
          color: #000;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: center;
          overflow: hidden;
          border: 1px dashed #ccc;
        }

        .qr-sticker-qr-wrap {
          padding: 2mm;
          box-sizing: border-box;
          width: 100%;
        }

        .qr-sticker-qr {
          display: block;
          width: 100%;
          aspect-ratio: 1;
          height: auto;
          object-fit: contain;
          background: #fff;
        }

        .qr-sticker-qr--loading {
          background: #f1f5f9;
          animation: pulse 1.2s ease-in-out infinite;
        }

        .qr-sticker-code {
          margin: 0;
          padding: 0 1mm;
          font-size: 2.2mm;
          font-weight: 700;
          line-height: 1.2;
          letter-spacing: -0.02em;
        }

        .qr-sticker-name {
          margin: 0;
          padding: 0.5mm 1mm 2mm;
          font-size: 1.8mm;
          font-weight: 400;
          line-height: 1.25;
          word-break: keep-all;
          overflow-wrap: break-word;
          white-space: normal;
        }

        @media print {
          @page {
            size: 12mm auto;
            margin: 0;
          }

          .no-print {
            display: none !important;
          }

          .qr-print-root {
            background: #fff !important;
            position: static !important;
            overflow: visible !important;
          }

          body * {
            visibility: hidden;
          }

          .qr-print-area,
          .qr-print-area * {
            visibility: visible;
          }

          .qr-print-area {
            position: absolute;
            left: 0;
            top: 0;
            display: block;
            padding: 0;
            margin: 0;
          }

          .qr-sticker {
            width: 12mm;
            border: none;
            page-break-inside: avoid;
            break-inside: avoid;
            margin: 0 0 4mm 0;
          }

          .qr-sticker:last-child {
            margin-bottom: 0;
          }
        }
      `}</style>
    </div>
  );
}
