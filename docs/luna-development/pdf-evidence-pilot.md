# Bounded PDF evidence pilot

`scripts/probe-nas-pdf.py` diagnoses native text and optionally reads up to five explicitly selected pages with local Korean/English OCR. It never connects to a database or network, edits an input file, runs a scheduler, or replaces existing extracted text. Dependencies for the actual pilot are PyMuPDF and Tesseract plus local `kor`/`eng` traineddata. Nothing installs automatically.

```sh
python3 scripts/probe-nas-pdf.py --file /private/source.pdf \
  --output /private/new-audit --source-kind local --source-ref fixture-1 \
  --expected-sha256 <actual-source-sha256> --ocr-pages 2,3,4 \
  --tessdata-dir /private/tessdata
```

No `--ocr-pages` means native inspection only. OCR defaults to 200 DPI and sparse text segmentation (`--psm 11`); explicit alternatives are DPI 150/200/300 and PSM 3/6/11. Layout affects OCR quality: a higher DPI or default automatic layout is not necessarily better for presentation slides. There is no automatic retry or quality promotion. Limits are 64 MiB input, 500 PDF pages, five OCR pages, 20 million rendered pixels per page and a 45 second OCR timeout per page. Output must be a new directory. A failed/partial run retains `INCOMPLETE`; consumers must reject it. The report records the exact input-byte SHA, engine/model versions, generator SHA, page numbers and rendered-page hashes.

The JSON is a layer-2 diagnostic/recognition candidate. Raw native observations and OCR outputs remain separate. It contains no verified claims and never establishes equivalence with a NAS file just because titles, native text or page counts match. A Library copy with different bytes remains a separate primary source. NAS binding requires independent byte identity/provenance verification.

`low-native-text` is a review trigger, not a declaration that a page is blank or OCR will succeed. Even longer OCR output can contain rendering noise or recognition errors. Review individual statements against rendered pages before generating semantic relationships; keep a review record with page and source hashes. Page 2 title recovery does not verify the full document. Existing Notion descriptions are another source, not a substitute for PDF transcription.

The real private pilot reproduced a 269-character, apparently successful extraction from a 14-page planning PDF. Rendered pages contained a work title, concept text and installation location that native extraction missed. OCR recovered the title and location but also produced errors, so no production text/embedding was replaced. Real source content and evidence are stored privately, never in this public repository.

This is an offline diagnosis/recovery tool, not a live search change. Next integration must retain provenance and freshness and exclude unresolved OCR from definitive answer claims. Do not simply force the existing resume process to repeatedly run the same native extractor on unchanged sparse PDFs.

OCR invocation reference: https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html
