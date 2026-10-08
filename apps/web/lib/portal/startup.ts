// No user data: coordinate speculative work after the first usable screen.
let ready = false;
const waiting = new Set<() => void>();
export function afterPortalReady(callback: () => void) {
  if (ready) callback();
  else waiting.add(callback);
  return () => {
    waiting.delete(callback);
  };
}
export function markPortalReady() {
  if (ready) return;
  ready = true;
  const callbacks = [...waiting];
  waiting.clear();
  for (const callback of callbacks) callback();
}
