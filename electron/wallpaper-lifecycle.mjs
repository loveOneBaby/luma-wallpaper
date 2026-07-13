const PAUSE_EVENTS = new Set(["suspend", "lock-screen"]);
const RESUME_EVENTS = new Set(["resume", "unlock-screen"]);

export function shouldResumeWallpaperPlayback(powerState) {
  return powerState?.suspended !== true;
}

/**
 * Pure state transition used by Electron's power lifecycle handlers. Keeping
 * this independent from Electron makes the lock/suspend behavior testable.
 */
export function transitionWallpaperPowerState(currentState, eventName) {
  const wasSuspended = currentState?.suspended === true;
  let sleeping = currentState?.sleeping === true;
  let locked = currentState?.locked === true;

  if (eventName === "suspend") sleeping = true;
  if (eventName === "resume") sleeping = false;
  if (eventName === "lock-screen") locked = true;
  if (eventName === "unlock-screen") locked = false;

  const suspended = sleeping || locked;
  const shouldPause = PAUSE_EVENTS.has(eventName);
  const shouldResume = RESUME_EVENTS.has(eventName) && wasSuspended && !suspended;
  return {
    sleeping,
    locked,
    suspended,
    command: shouldPause ? "pause" : shouldResume ? "resume" : null,
    refreshPlacement: shouldResume,
  };
}
