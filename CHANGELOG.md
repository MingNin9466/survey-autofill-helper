# Changelog

All notable changes to this project are documented here.

## [1.0.2] - 2026-10-22

### Added
- **WPS 表单 / WPS Forms support** (`f.wps.cn`): scans `.ksapc-questions-write-container`, fills antd radios, checkboxes, text inputs/areas, and antd Select dropdowns (opens the dropdown and picks by option text).
- Detects WPS forms that require a WPS login or have stopped collecting, and marks them instead of guessing.

### Changed
- Question titles: leading required markers (`*`) and numbering are stripped for cleaner lists.
- `fillAll({ adapter })` can force a specific adapter (useful for testing).

## [1.0.1] - 2026-10-22

### Fixed
- Backspace / Delete did not work inside the panel's own inputs on pages that intercept keyboard events (e.g. WJX blocks Backspace to prevent back-navigation). The Shadow DOM retargeted `event.target` to the host element, so the site treated it as “not an input”. Key, clipboard and composition events are now stopped at the panel boundary.

## [1.0.0] - 2026-10-22

### Added
- Answer templates (multiple, switchable, JSON import/export).
- Scan mode: list detected questions with type and options, write answers, save as a template.
- Fill engine: single / multi / text / select, random answers, only-fill-blank mode, per-question verification and highlighting.
- Adapters: 问卷星 (WJX), 腾讯问卷 (Tencent Survey), generic fallback.
- Shadow-DOM panel with tabs: Fill / Scan / Templates / Settings.
