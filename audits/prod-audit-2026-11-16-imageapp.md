# Production audit: ImageApp (demo at imageapp.demo.facyke.com), 2026-11-16

## Summary
Two confirmed security issues found and fixed (commit f3e0d10 on branch `fix/restrict-decoders-pillow-13`, deployed to the server
2026-11-16 with the approval of the owner). No other code or configuration changed.

## Architecture / accounts
Flask + Pillow, anonymous tool: no accounts, no sign-in, no sessions cookies (image ids are uuid4 hex, 128-bit, validated by regex).
There is therefore no admin account to create; nothing was added.

## Security
| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | Image.open() auto-detected any of Pillow's ~40 formats; the format whitelist ran after verify()+load() and unknown formats were relabelled PNG, so TIFF/ICO/PPM/TGA/SGI (and others) named .jpg/.png were fully decoded and ACCEPTED | probe on the original code: HTTP 201 for all five | `Image.open(..., formats=["JPEG","PNG","WEBP","BMP","GIF"])` in `open_and_validate`; MPO phone photos still open (tested) |
| 2 | Pillow 12.3.0 (live container) had 42 published advisories (pip-audit), all fixed in 13.0.0; pin was `<13` | pip-audit; `pip list` in the container | `Pillow>=13.0,<14`; pip-audit now: no known vulnerabilities; container runs 13.0.0 |

Other checks (code read): filenames and zip entry names sanitised and de-duplicated; per-file, per-pixel and batch caps; rate limits; temp files under a
validated directory (`safe_join_within`); security headers (nosniff, X-Frame-Options DENY, CSP) on every response; SECRET_KEY random per process (unused).

## Tests
- Local: 95 passed (81 existing + 14 new in `tests/test_format_restriction.py`) on Pillow 13.0.0 AND on 12.3.0. The new tests fail on the old code (8 failures) and pass on the fix.
- Live (headless Chrome through a temporary demo link, since revoked): 40 of 40 interactions pass: upload, side-by-side/slider, zoom x4, quality presets and slider,
  format select, grayscale, 6 adjustment sliders, rotate x2, flip x2, resize (percentage, width/height + preset, crop + ratio + crop reset), preset dropdown,
  Auto-Optimize, Reset, Download (279 KB JPEG), New Upload, batch upload of 3 files (a disguised TIFF is reported as an error, the others succeed), Apply to All,
  ZIP download, New Batch. A TIFF renamed .jpg is refused with HTTP 400 on the live server.
- Container after deploy: healthy, 0 restarts, no errors in logs; the other 14 healthy containers unaffected.

## Deploy / rollback
Before: image tagged `pd-imageapp:rollback-20261116`. Server `/srv/apps/ImageApp` fast-forwarded 1448e01 -> f3e0d10 (bundle), `docker compose build imageapp-demo`, `up -d --no-deps imageapp-demo`.
Rollback: `docker tag pd-imageapp:rollback-20261116 pd-imageapp:latest` then `docker compose --profile apps up -d --no-deps imageapp-demo` (in deploy/), and `git reset --hard 1448e01` in /srv/apps/ImageApp.

## Not changed / outstanding
- The local ImageApp repo's `origin` is the dead Obinwanne1 URL; the server's is github.com/rigwe1965/ImageApp. The fix commit exists only locally and on the server until it is pushed and merged there.
- Rate limiter keys on the gateway's address, so all demo visitors share one limit (20 uploads/min); the gateway has its own per-link limit. Low impact; left alone.
- The page has no favicon, so browsers get a 404 for /favicon.ico. Cosmetic.
- Choosing "Width / Height" resize before entering a size returns a validation 400 (message is clear). Existing behaviour.
- "Remove Background (AI)" downloads a ~170 MB model: not exercised (would be a large download in the sealed demo).
