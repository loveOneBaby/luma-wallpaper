import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldResumeWallpaperPlayback,
  transitionWallpaperPowerState,
} from "../electron/wallpaper-lifecycle.mjs";

test("suspend and lock pause video without trying to restore its desktop layer", () => {
  assert.deepEqual(
    transitionWallpaperPowerState({ sleeping: false, locked: false, suspended: false }, "suspend"),
    {
      sleeping: true,
      locked: false,
      suspended: true,
      command: "pause",
      refreshPlacement: false,
    },
  );
  assert.deepEqual(
    transitionWallpaperPowerState(
      { sleeping: false, locked: false, suspended: false },
      "lock-screen",
    ),
    {
      sleeping: false,
      locked: true,
      suspended: true,
      command: "pause",
      refreshPlacement: false,
    },
  );
});

test("resume and unlock restore placement before playback resumes", () => {
  assert.deepEqual(
    transitionWallpaperPowerState({ sleeping: true, locked: false, suspended: true }, "resume"),
    {
      sleeping: false,
      locked: false,
      suspended: false,
      command: "resume",
      refreshPlacement: true,
    },
  );
  assert.deepEqual(
    transitionWallpaperPowerState(
      { sleeping: false, locked: true, suspended: true },
      "unlock-screen",
    ),
    {
      sleeping: false,
      locked: false,
      suspended: false,
      command: "resume",
      refreshPlacement: true,
    },
  );
});

test("resume does not restart playback while the screen remains locked", () => {
  assert.deepEqual(
    transitionWallpaperPowerState({ sleeping: true, locked: true, suspended: true }, "resume"),
    {
      sleeping: false,
      locked: true,
      suspended: true,
      command: null,
      refreshPlacement: false,
    },
  );
});

test("lock, suspend, resume, unlock waits for the final unlock before restarting", () => {
  let state = { sleeping: false, locked: false, suspended: false };
  const transitions = ["lock-screen", "suspend", "resume", "unlock-screen"].map((eventName) => {
    const transition = transitionWallpaperPowerState(state, eventName);
    state = {
      sleeping: transition.sleeping,
      locked: transition.locked,
      suspended: transition.suspended,
    };
    return transition;
  });

  assert.deepEqual(
    transitions.map(({ command, refreshPlacement }) => ({ command, refreshPlacement })),
    [
      { command: "pause", refreshPlacement: false },
      { command: "pause", refreshPlacement: false },
      { command: null, refreshPlacement: false },
      { command: "resume", refreshPlacement: true },
    ],
  );
  assert.equal(state.suspended, false);
});

test("unrelated power events preserve the suspended state", () => {
  assert.deepEqual(
    transitionWallpaperPowerState({ sleeping: false, locked: true, suspended: true }, "on-ac"),
    {
      sleeping: false,
      locked: true,
      suspended: true,
      command: null,
      refreshPlacement: false,
    },
  );
});

test("an async placement completion cannot resume after a later lock event", () => {
  assert.equal(shouldResumeWallpaperPlayback({ suspended: false }), true);
  assert.equal(shouldResumeWallpaperPlayback({ suspended: true }), false);
});
