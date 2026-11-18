# Library verification log

Last check: 2026-11-18. Method: official text downloaded, whitespace, case and punctuation removed on both sides, then each
library paragraph looked up in the official text. Sources: EU Official Journal HTML (Publications Office of the EU) for GDPR and AI Act,
the BPK PDF of UU 27/2022 (scanned, OCR text), the NIST AI 100-1 PDF. This is a text comparison by script, not a legal review.

| Source | Checked | Result |
|---|---|---|
| GDPR (OJ L 119, 4.5.2016) | Art. 33(1), 33(3), 35(1), 35(3), 35(7), 36(1), 4(12): 7 units, 18 paragraphs | all match exactly |
| EU AI Act (OJ L, 12.7.2024) | Art. 6(1), 9(1), 14(1), 26(1), 27(1): 5 units | all match exactly |
| UU 27/2022 (BPK PDF) | Pasal 34(1), 34(2), 34(3), 35(1), 39(1), 46(1), 46(2), 53(1), 20(2) | 34(1), 34(3), 35(1), 39(1), 46(2) exact. 34(2)(g) and 46(1) differ only by OCR noise in the scan (similarity 0.92-0.97, checked by eye). 20(2) and 53(1): lettered list lines did not match because of OCR/line layout; not confirmed line by line |
| NIST AI RMF 1.0 | all 91 paragraphs | 77 exact. 14 did not match because the PDF tables interleave columns (text is split across lines). **Two real errors found and fixed**: GOVERN 4 and GOVERN 4.1 were garbled in the library; corrected against the PDF fragments. The other 12 look like layout noise but were not confirmed one by one |
| ISO/IEC 27001, 27701, 42001 | labels | Not verifiable: the standards are paid. Labels are our own wording (21 labels that were identical to the standards' short control titles were reworded on 2026-11-18). Identifiers are written from knowledge and **not checked** against the standards, so the flag stays `verified: no` |

What this does not cover: articles not listed above (most GDPR, AI Act and UU PDP units were not compared), recitals, Annex III of the AI Act,
the Indonesian official gazette versions beyond the BPK scan, and later corrections. The flags in the front matter stay as they are;
the "verified: yes" for UU PDP now rests on a sampled check with OCR limits. PP 33/2026 is not in the library: no official text was available.
Cross-law mappings (`mappings.csv`) are marked `draft-ai` and were not checked here.
