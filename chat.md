# No-Risk Betting — chat log (for Claude)

_One entry per session, newest at the bottom, capped at 60 KB. Older entries are in `docs/archive/chat-archive.md`. The current state is in `PROGRESS.md`._

Earlier history (2026-06 to 2026-07-19) is in `docs/archive/progress-2026-09-21.md` (the full pre-migration PROGRESS.md) and in `git log`.

## 2026-09-21 · Migrated PROGRESS.md to the /checkpoint format (Claude, no code changes)
- **Asked:** a laptop-ops run to migrate this project's handoff files to Tim's new compact format via `/checkpoint`.
- **Decided:** kept the `PROGRESS.md` filename. Personal/account emails were left out of the live notes (they're still in the archive snapshot).
- **Built:** `docs/archive/progress-2026-09-21.md` (byte-identical copy, hash checked). Rewrote `PROGRESS.md` to the template and added what happened after its last update (commits of 2026-07-17 and 07-19). Created this `chat.md`.
- **Verified how:** `git status` clean and even with origin. Live `/healthz` 200. Live `sw.js` = `nrb-shell-v41` = repo. `node --check` 12/12 JS files. `ast.parse` 7/7 Python files. No test suite exists. Old env notes corrected: Node is now installed, Python is 3.11.9.
- **Open:** public launch is blocked on Tim getting Kalshi data consent/licence and reviewing ESPN terms. Kalshi borrows #1, #4, #5 and the betting-flow overhaul are not authorized yet.
