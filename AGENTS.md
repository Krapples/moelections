# Daily Moelections Forecast and Site Refresh

- Run routine refreshes from this checkout while on the local `main` branch. Do not create or push a refresh branch; commit to `main` and push only to `origin/main`.
- Routine refreshes are prediction-only. Use the selected saved model artifacts and established no-fit inference workflow. Do not fit, retrain, tune, reselect, or replace models during a daily refresh. Keep the selected models' existing validation and release-gate evidence; when artifacts are unchanged, do not require a new paired model comparison.
- Fetch eligible polling and predictor data through the stated cutoff. Always exclude Wedgewood polls. Keep fieldwork dates, first-public dates/times, archive-ingestion dates, and source-vintage dates distinct; disclose unknown timing and sample sizes.
- Keep current forecasts, polling averages, race histories, seat distributions, archives, snapshots, source audits, and hashes synchronized to the same prediction stream. Preserve historical performance metrics, prior-error history, and historical race rows unless new verified election outcomes require an update.
- Regenerate race-specific static pages, PNG preview cards, and share metadata from the refreshed stream. Run the required data verifiers and `npm run build`; confirm all 506 race pages and 506 PNG cards are current and the build verifier passes.
- Keep private account or personal information, internal model identifiers, and downloadable raw-source CSV links out of public site content.
- Review the full diff and preserve unrelated local changes. Push only a changed, fully validated release. Never force-push, rewrite history, bypass a gate, or publish when inputs are unchanged or a check fails.
