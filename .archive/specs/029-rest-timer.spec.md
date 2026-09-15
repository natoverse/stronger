# Feature: Between-set rest timer

> Show an auto-starting count-up timer between sets so the lifter can track rest without leaving the app.

## What

After the lifter checks a set as complete, a timer begins counting up from 0:00 and displays inline in the exercise header row — centered between the exercise name and the role tag. The timer shows elapsed time in `M:SS` format (e.g., `0:00`, `1:45`, `12:03`).

If the completed set is the last set of an exercise, the timer appears in the header of the next exercise below instead, since that's where the lifter's attention moves next.

The timer stops automatically when the lifter taps Finish. Only one timer is visible at a time — starting a new one (by checking another set) replaces the previous one.

### Visual style

The timer text uses a digital LCD-style font (e.g., a monospace/segment-display web font or CSS `font-family` fallback) and is rendered in the app's pink accent color (`--color-accent`, `#ff2d7b`). This makes the timer visually distinct from the exercise name and role tag — it should feel like a small embedded clock.

## Acceptance Criteria

- [ ] Checking a set as complete starts a count-up timer from `0:00`.
- [ ] The timer displays in `M:SS` format in the exercise header row, between the exercise name and role tag.
- [ ] If the completed set is the last set for its exercise, the timer appears in the next exercise's header instead.
- [ ] Only one timer is active/visible at a time; checking a new set resets and relocates the timer.
- [ ] The timer stops when Finish is clicked.
- [ ] Timer text uses a digital LCD-style font.
- [ ] Timer text is colored with `--color-accent` (pink).
- [ ] The timer does not interfere with the layout of the exercise name or role tag on mobile.

## Scope

### In scope
- Count-up timer triggered by set completion checkbox
- Display in the exercise header row
- LCD font styling with pink accent color
- Auto-stop on Finish

### Out of scope
- Configurable rest durations or countdown timers
- Audio/vibration alerts when a target rest time is reached
- Persisting rest times to workout history
- Timer behavior when unchecking a set

## Notes

- Use `setInterval` or `requestAnimationFrame` for the tick — 1-second resolution is fine.
- Clean up the interval on unmount and on Finish.
- For the LCD font, a CSS `@font-face` with a segment-display font is ideal. If adding a web font is too heavy, a fallback like `"Courier New", monospace` with letter-spacing achieves a similar feel. Choose whichever is simplest.
- The timer is purely cosmetic and informational — it does not gate any actions or affect logging.
- Edge case: if the completed set is the last set of the last exercise, the timer still shows in that exercise's header (there is no "next" exercise).
