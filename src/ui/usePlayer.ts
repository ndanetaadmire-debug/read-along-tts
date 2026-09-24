import { useSyncExternalStore } from "react";
import type { Player, PlayerState } from "../core/player";

export function usePlayerState(player: Player): PlayerState {
  return useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => player.getState(),
  );
}
