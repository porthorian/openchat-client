export type CallMachineState = "idle" | "joining" | "active" | "reconnecting" | "error";

export type CallMachineEvent =
  | "join_requested"
  | "join_succeeded"
  | "join_failed"
  | "signal_disconnected"
  | "signal_reconnected"
  | "left"
  | "fatal_error";

export function transitionCallState(current: CallMachineState, event: CallMachineEvent): CallMachineState {
  switch (event) {
    case "join_requested":
      return "joining";
    case "join_succeeded":
      return "active";
    case "join_failed":
      return current === "active" ? "reconnecting" : "error";
    case "signal_disconnected":
      return current === "idle" ? "idle" : "reconnecting";
    case "signal_reconnected":
      return "active";
    case "left":
      return "idle";
    case "fatal_error":
      return "error";
    default:
      return current;
  }
}
