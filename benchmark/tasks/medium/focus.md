# Focus app (medium task)

Build a small focus/productivity app with three tabbed sections: Timer, Tasks,
Stats. Tab buttons at the top switch which section is visible.

**Timer tab**: a countdown that starts at 10 seconds (use 10s so it's easy to
verify), shown as "S s remaining". Start/Pause button and Reset button. When it
reaches 0 it stops by itself and increments a completed-sessions counter.

**Tasks tab**: a todo list — text input + Add button, each row has a done
checkbox, the task text, and a delete button. A line shows "N open" (count of
not-done tasks).

**Stats tab**: shows total completed focus sessions, total tasks ever added,
and tasks completed (done count), each on its own line.

Acceptance checklist:
1. Tabs switch sections; exactly one section visible at a time.
2. Start counts down once per second; Pause freezes it; Start resumes.
3. Reset returns to 10s (and pauses if running).
4. Reaching 0 stops the countdown and increments completed sessions.
5. Adding an empty task does nothing.
6. Checkbox toggles done state; "N open" is correct.
7. Delete removes only that row.
8. Stats numbers are all live and correct (sessions, total added, done count).
