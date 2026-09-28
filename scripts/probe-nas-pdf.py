#!/usr/bin/env python3
"""Bounded local PDF evidence probe. No database, network or source writes."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

POLICY = "pdf-evidence-probe/1"
MAX_BYTES = 64 * 1024 * 1024
MAX_PAGES = 500
MAX_OCR_PAGES = 5
MAX_PIXELS = 20_000_000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def selected_pages(value, total):
    if not value:
        return []
    if not re.fullmatch(r"[0-9]+(?:,[0-9]+)*", value):
        raise ValueError("OCR pages must be comma-separated 1-based integers")
    pages = [int(x) for x in value.split(",")]
    if len(pages) > MAX_OCR_PAGES or len(set(pages)) != len(pages):
        raise ValueError("Select at most five distinct OCR pages")
    if any(n < 1 or n > total for n in pages):
        raise ValueError("OCR page outside document")
    return sorted(pages)


def check_source(data, expected_sha):
    if not data.startswith(b"%PDF-") or len(data) > MAX_BYTES:
        raise ValueError("Expected a PDF of at most 64 MiB")
    actual = sha(data)
    if expected_sha and (not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha) or actual != expected_sha.lower()):
        raise ValueError("Source SHA-256 does not match; no audit produced")
    return actual


def render_dimensions(width, height, dpi):
    w, h = math.ceil(width * dpi / 72), math.ceil(height * dpi / 72)
    if w <= 0 or h <= 0 or w * h > MAX_PIXELS:
        raise ValueError("Page render exceeds pixel bound")
    return w, h


def ocr_observation(page, text, image_hash):
    # OCR confidence is not source authority. Review is deliberately separate.
    return {"page": page, "method": "tesseract", "text": text,
            "text_sha256": sha(text.encode()), "render_sha256": image_hash,
            "review_state": "candidate", "verified_claims": []}


def run(args):
    import fitz
    source, out = Path(args.file).resolve(), Path(args.output).resolve()
    if out.exists():
        raise ValueError("Output must be a new directory; existing evidence is preserved")
    if source.stat().st_size > MAX_BYTES:
        raise ValueError("PDF exceeds 64 MiB")
    with source.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    source_hash = check_source(data, args.expected_sha256)
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.needs_pass or not 1 <= len(doc) <= MAX_PAGES:
        raise ValueError("Encrypted, empty or over-limit PDF")
    pages = selected_pages(args.ocr_pages, len(doc))
    for number in pages:
        rect = doc[number - 1].rect
        render_dimensions(rect.width, rect.height, args.dpi)
    models = {}
    engine = None
    if pages:
        if not args.tessdata_dir:
            raise ValueError("Explicit local tessdata directory required for OCR")
        td = Path(args.tessdata_dir).resolve()
        for language in ("kor", "eng"):
            models[language] = sha((td / (language + ".traineddata")).read_bytes())
        engine = subprocess.run(["tesseract", "--version"], capture_output=True, text=True,
                                timeout=10, check=True).stdout.splitlines()[0]
    out.mkdir(parents=True)
    incomplete = out / "INCOMPLETE"
    incomplete.write_text("Do not consume until audit.json exists and this marker is absent.\n")
    observations = []
    try:
        for index, page in enumerate(doc):
            native = page.get_text()
            if len(native) > 100_000:
                raise ValueError("Native page text exceeds bound")
            obs = {"page": index + 1, "native_text": native,
                   "native_alphanumeric_characters": sum(c.isalnum() for c in native),
                   "image_objects": len(page.get_images()), "ocr": None}
            # Low text is a review trigger, not proof that OCR is needed or that a page is empty.
            obs["diagnostic"] = "low-native-text" if obs["native_alphanumeric_characters"] < 20 else "not-assessed"
            if index + 1 in pages:
                render = out / f"page-{index + 1}.png"
                page.get_pixmap(dpi=args.dpi, alpha=False).save(render)
                result = subprocess.run(["tesseract", str(render), "stdout", "--tessdata-dir", str(td),
                                         "-l", "kor+eng", "--oem", "1", "--psm", str(args.psm)],
                                        capture_output=True, text=True, timeout=45, check=True)
                if len(result.stdout) > 100_000:
                    raise ValueError("OCR page text exceeds bound")
                obs["ocr"] = ocr_observation(index + 1, result.stdout, sha(render.read_bytes()))
            observations.append(obs)
        report = {"schema_version": 1, "layer": 2, "policy": POLICY,
                  "generator_sha256": sha(Path(__file__).read_bytes()),
                  "generated_at": datetime.now(timezone.utc).isoformat(),
                  "source": {"kind": args.source_kind, "reference": args.source_ref,
                             "file_name": source.name, "sha256": source_hash, "bytes": len(data),
                             "nas_binding": "unverified", "page_count": len(doc)},
                  "engines": {"native": "PyMuPDF " + fitz.VersionBind, "ocr": engine,
                              "traineddata_sha256": models, "dpi": args.dpi, "psm": args.psm},
                  "review_state": "candidate", "full_document_verified": False,
                  "ocr_pages": pages, "pages": observations}
        (out / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        incomplete.unlink()
        return report
    finally:
        doc.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-kind", choices=["library", "nas", "local"], required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--ocr-pages", default="")
    parser.add_argument("--tessdata-dir")
    parser.add_argument("--dpi", type=int, choices=[150, 200, 300], default=200)
    parser.add_argument("--psm", type=int, choices=[3, 6, 11], default=11)
    args = parser.parse_args()
    report = run(args)
    print(json.dumps({"status": "candidate-audit-complete", "source_sha256": report["source"]["sha256"],
                      "page_count": report["source"]["page_count"], "ocr_pages": report["ocr_pages"]}))


if __name__ == "__main__":
    main()
