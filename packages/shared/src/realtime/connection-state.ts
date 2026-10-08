import type { ConnectionState } from "../schemas/realtime.js";

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export type ConnectionMachineState = {
  status: ConnectionState;
  attempt: number;
};

export function initialConnectionState(): ConnectionMachineState {
  return { status: "connecting", attempt: 0 };
}

export function nextBackoffDelayMs(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

export function onTransportConnecting(state: ConnectionMachineState): ConnectionMachineState {
  return {
    status: state.attempt > 0 ? "reconnecting" : "connecting",
    attempt: state.attempt,
  };
}

export function onTransportConnected(_state: ConnectionMachineState): ConnectionMachineState {
  return { status: "connected", attempt: 0 };
}

export function onTransportDisconnected(state: ConnectionMachineState): ConnectionMachineState {
  const nextAttempt = state.attempt + 1;
  if (nextAttempt >= MAX_ATTEMPTS) {
    return { status: "failed", attempt: nextAttempt };
  }

  return {
    status: "reconnecting",
    attempt: nextAttempt,
  };
}

export function onManualRetry(): ConnectionMachineState {
  return { status: "connecting", attempt: 0 };
}

export function onBrowserOffline(): ConnectionMachineState {
  return { status: "disconnected", attempt: 0 };
}

export function shouldScheduleCatchUp(previous: ConnectionState, next: ConnectionState): boolean {
  return (
    (previous === "connecting" ||
      previous === "reconnecting" ||
      previous === "disconnected" ||
      previous === "failed") &&
    next === "connected"
  );
}

export { MAX_ATTEMPTS };
