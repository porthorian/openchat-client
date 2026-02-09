import type { UIDMode } from "@renderer/types/models";

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  const positive = Math.abs(hash).toString(16);
  return positive.padStart(8, "0");
}

export function projectUID(rootIdentityId: string, serverId: string, mode: UIDMode): string {
  const source = mode === "global" ? rootIdentityId : `${rootIdentityId}:${serverId}`;
  return `uid_${simpleHash(source)}`;
}
