# Strategy screenshot OCR

RapidOCR ONNX Runtime CPU worker. Runtime uses bundled models, never calls a paid OCR API.

The worker has no published ports. Compose attaches it only to an internal network shared with the authenticated backend. Limits: 1 CPU, 1 GiB, one inference, 10 MiB compressed image, 12 million pixels. A subprocess is killed after 18 seconds; backend aborts after 20 seconds. Only PNG/JPEG/WebP are accepted. No URLs are fetched and images are not saved by the worker.

The backend `/api/tradein-risk/ocr` requires existing login, `tradeIn.riskLedger` access and admin role. Result contains text, quadrilateral coordinates and confidence. Text layout reconstruction preserves table columns. Lines below 0.85 confidence are omitted from automatic filling and listed for review. Choices such as global/non-global and brand/model are not inferred. Missing fields preserve existing values. Saving remains explicit and persists original screenshot, raw OCR and line metadata in the dedicated ledger SQLite database.

Dependencies are pinned for primary packages. Downloaded wheels are checked against official PyPI SHA256 before installation. Default build index is official PyPI; a mirror may be supplied as build argument `PIP_INDEX_URL`, with the same mandatory hash checks.

Source: https://pypi.org/project/rapidocr-onnxruntime/1.4.4/

Acceptance status: implementation tests pass. The production database currently has no screenshot samples. Prototype screenshots are only technical performance fixtures and cannot establish real backend OCR accuracy. Before production release, obtain real screenshots covering multiple model IDs, SKU restrictions, percentage/amount and start/end timestamps. Compare each extracted value against the image and record inference latency, worker/container memory and concurrency behavior.
