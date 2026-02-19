import type { ChannelGroup, ChatMessage, LinkPreview, MemberItem, MessageAttachment } from "@renderer/types/chat";

export type RealtimeEnvelope = {
  type: string;
  request_id?: string;
  payload?: Record<string, unknown>;
};

export type SyncedUserProfile = {
  userUID: string;
  displayName: string;
  avatarMode: "generated" | "uploaded";
  avatarPresetId: string | null;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  profileVersion: number;
  updatedAt: string;
};

export type ProfileUpdateInput = {
  displayName: string;
  avatarMode: "generated" | "uploaded";
  avatarPresetId?: string | null;
  avatarAssetId?: string | null;
};

export type UploadedAvatarAsset = {
  avatarAssetId: string;
  avatarUrl: string;
  width: number;
  height: number;
  contentType: string;
  bytes: number;
};

export class ProfileRequestError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ProfileRequestError";
    this.status = status;
    this.code = code;
  }
}

function authHeaders(userUID: string, deviceID: string): Record<string, string> {
  return {
    "X-OpenChat-User-UID": userUID,
    "X-OpenChat-Device-ID": deviceID
  };
}

async function toProfileRequestError(response: Response, fallbackMessage: string): Promise<ProfileRequestError> {
  try {
    const payload = (await response.json()) as { code?: string; message?: string };
    return new ProfileRequestError(response.status, payload.message ?? fallbackMessage, payload.code ?? null);
  } catch (_error) {
    const text = await response.text();
    return new ProfileRequestError(response.status, text || fallbackMessage, null);
  }
}

function normalizeProfile(payload: Record<string, unknown>): SyncedUserProfile {
  return {
    userUID: String(payload.user_uid ?? "uid_unknown"),
    displayName: String(payload.display_name ?? "Unknown User"),
    avatarMode: payload.avatar_mode === "uploaded" ? "uploaded" : "generated",
    avatarPresetId: payload.avatar_preset_id ? String(payload.avatar_preset_id) : null,
    avatarAssetId: payload.avatar_asset_id ? String(payload.avatar_asset_id) : null,
    avatarUrl: payload.avatar_url ? String(payload.avatar_url) : null,
    profileVersion: Number(payload.profile_version ?? 0),
    updatedAt: String(payload.updated_at ?? new Date().toISOString())
  };
}

function normalizeLinkPreview(input: unknown): LinkPreview | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const url = String(payload.url ?? "").trim();
  if (!url) return null;
  return {
    url,
    title: payload.title ? String(payload.title) : null,
    description: payload.description ? String(payload.description) : null,
    siteName: payload.site_name ? String(payload.site_name) : payload.siteName ? String(payload.siteName) : null,
    imageUrl: payload.image_url ? String(payload.image_url) : payload.imageUrl ? String(payload.imageUrl) : null
  };
}

function normalizeLinkPreviews(input: unknown): LinkPreview[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const previews = input
    .map((item) => normalizeLinkPreview(item))
    .filter((item): item is LinkPreview => item !== null);
  return previews.length > 0 ? previews : undefined;
}

function normalizeMessageAttachment(input: unknown): MessageAttachment | null {
  if (typeof input !== "object" || input === null) return null;
  const payload = input as Record<string, unknown>;
  const attachmentId = String(payload.attachment_id ?? "").trim();
  const url = String(payload.url ?? "").trim();
  if (!attachmentId || !url) return null;
  return {
    attachmentId,
    fileName: String(payload.file_name ?? "image.png"),
    url,
    width: Number(payload.width ?? 0),
    height: Number(payload.height ?? 0),
    contentType: String(payload.content_type ?? "application/octet-stream"),
    bytes: Number(payload.bytes ?? 0)
  };
}

function normalizeMessageAttachments(input: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const attachments = input
    .map((item) => normalizeMessageAttachment(item))
    .filter((item): item is MessageAttachment => item !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function hasLimit(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("Invalid avatar image payload");
  }
  return response.blob();
}

export async function fetchChannelGroups(backendUrl: string, serverId: string): Promise<ChannelGroup[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(serverId)}/channels`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load channels (${response.status})`);
  }
  const payload = (await response.json()) as { groups?: ChannelGroup[] };
  return payload.groups ?? [];
}

export async function fetchMembers(backendUrl: string, serverId: string): Promise<MemberItem[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/servers/${encodeURIComponent(serverId)}/members`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load members (${response.status})`);
  }
  const payload = (await response.json()) as { members?: MemberItem[] };
  return payload.members ?? [];
}

export async function fetchMessages(backendUrl: string, channelId: string, limit = 100): Promise<ChatMessage[]> {
  const endpoint = `${backendUrl.replace(/\/$/, "")}/v1/channels/${encodeURIComponent(channelId)}/messages?limit=${limit}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to load messages (${response.status})`);
  }
  const payload = (await response.json()) as {
    messages?: Array<{
      id: string;
      channel_id: string;
      author_uid: string;
      body: string;
      created_at: string;
      link_previews?: unknown;
      attachments?: unknown;
    }>;
  };
  return (payload.messages ?? []).map((message) => ({
    id: message.id,
    channelId: message.channel_id,
    authorUID: message.author_uid,
    body: message.body,
    createdAt: message.created_at,
    linkPreviews: normalizeLinkPreviews(message.link_previews),
    attachments: normalizeMessageAttachments(message.attachments)
  }));
}

export async function createMessage(params: {
  backendUrl: string;
  channelId: string;
  body: string;
  attachments?: File[];
  userUID: string;
  deviceID: string;
  maxMessageBytes?: number | null;
  maxUploadBytes?: number | null;
}): Promise<ChatMessage> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/channels/${encodeURIComponent(params.channelId)}/messages`;
  const files = params.attachments ?? [];
  const headers = authHeaders(params.userUID, params.deviceID);

  const bodyBytes = utf8ByteLength(params.body);
  if (hasLimit(params.maxMessageBytes) && bodyBytes > params.maxMessageBytes) {
    throw new Error(`Message is too large. Max ${formatBytes(params.maxMessageBytes)}.`);
  }

  const uploadLimit = hasLimit(params.maxUploadBytes) ? params.maxUploadBytes : null;
  if (typeof uploadLimit === "number" && files.length > 0) {
    if (files.some((file) => file.size > uploadLimit)) {
      throw new Error(`Image is too large. Max ${formatBytes(uploadLimit)}.`);
    }
    const totalUploadBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalUploadBytes > uploadLimit) {
      throw new Error(`Attachments are too large together. Max ${formatBytes(uploadLimit)} total.`);
    }
  }

  let response: Response;
  try {
    if (files.length === 0) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          body: params.body
        })
      });
    } else {
      const formData = new FormData();
      formData.set("body", params.body);
      files.forEach((file, index) => {
        const fallbackName = `image-${index + 1}.png`;
        formData.append("files", file, file.name || fallbackName);
      });
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData
      });
    }
  } catch (error) {
    const failure = error as Error;
    if (files.length > 0) {
      throw new Error("Upload failed before the server responded. Reduce text or attachments and try again.");
    }
    throw new Error(`Failed to send message: ${failure.message}`);
  }

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("Message payload is too large for this server. Reduce text or attachments and try again.");
    }
    const text = await response.text();
    throw new Error(`Failed to send message (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as {
    message: {
      id: string;
      channel_id: string;
      author_uid: string;
      body: string;
      created_at: string;
      link_previews?: unknown;
      attachments?: unknown;
    };
  };
  return {
    id: payload.message.id,
    channelId: payload.message.channel_id,
    authorUID: payload.message.author_uid,
    body: payload.message.body,
    createdAt: payload.message.created_at,
    linkPreviews: normalizeLinkPreviews(payload.message.link_previews),
    attachments: normalizeMessageAttachments(payload.message.attachments)
  };
}

export async function fetchMyProfile(params: {
  backendUrl: string;
  userUID: string;
  deviceID: string;
}): Promise<SyncedUserProfile> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/profile/me`;
  const response = await fetch(endpoint, {
    headers: authHeaders(params.userUID, params.deviceID)
  });
  if (!response.ok) {
    throw await toProfileRequestError(response, `Failed to fetch profile (${response.status})`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeProfile(payload);
}

export async function uploadProfileAvatar(params: {
  backendUrl: string;
  userUID: string;
  deviceID: string;
  avatarImageDataUrl: string;
}): Promise<UploadedAvatarAsset> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/profile/avatar`;
  const blob = await dataUrlToBlob(params.avatarImageDataUrl);
  const contentType = blob.type || "image/png";
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "img";
  const formData = new FormData();
  formData.append("file", blob, `avatar.${extension}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(params.userUID, params.deviceID),
    body: formData
  });
  if (!response.ok) {
    throw await toProfileRequestError(response, `Failed to upload profile avatar (${response.status})`);
  }

  const payload = (await response.json()) as {
    avatar_asset_id: string;
    avatar_url: string;
    width: number;
    height: number;
    content_type: string;
    bytes: number;
  };

  return {
    avatarAssetId: payload.avatar_asset_id,
    avatarUrl: payload.avatar_url,
    width: payload.width,
    height: payload.height,
    contentType: payload.content_type,
    bytes: payload.bytes
  };
}

export async function updateMyProfile(params: {
  backendUrl: string;
  userUID: string;
  deviceID: string;
  input: ProfileUpdateInput;
  expectedVersion?: number;
}): Promise<SyncedUserProfile> {
  const endpoint = `${params.backendUrl.replace(/\/$/, "")}/v1/profile/me`;
  const headers: Record<string, string> = {
    ...authHeaders(params.userUID, params.deviceID),
    "Content-Type": "application/json"
  };
  if (typeof params.expectedVersion === "number" && params.expectedVersion > 0) {
    headers["If-Match"] = String(params.expectedVersion);
  }
  const response = await fetch(endpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      display_name: params.input.displayName,
      avatar_mode: params.input.avatarMode,
      avatar_preset_id: params.input.avatarPresetId ?? null,
      avatar_asset_id: params.input.avatarAssetId ?? null
    })
  });
  if (!response.ok) {
    throw await toProfileRequestError(response, `Failed to update profile (${response.status})`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeProfile(payload);
}

export async function fetchProfilesBatch(params: {
  backendUrl: string;
  userUID: string;
  deviceID: string;
  targetUserUIDs: string[];
}): Promise<SyncedUserProfile[]> {
  const base = params.backendUrl.replace(/\/$/, "");
  const endpoint = new URL(`${base}/v1/profiles:batch`);
  params.targetUserUIDs.forEach((userUID) => {
    endpoint.searchParams.append("user_uid", userUID);
  });
  const response = await fetch(endpoint.toString(), {
    headers: authHeaders(params.userUID, params.deviceID)
  });
  if (!response.ok) {
    throw await toProfileRequestError(response, `Failed to fetch profile batch (${response.status})`);
  }
  const payload = (await response.json()) as {
    profiles?: Record<string, unknown>[];
  };
  return (payload.profiles ?? []).map((profile) => normalizeProfile(profile));
}

export function getRealtimeURL(backendUrl: string, userUID: string, deviceID: string): string {
  const base = new URL(backendUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/v1/realtime";
  base.search = "";
  base.searchParams.set("user_uid", userUID);
  base.searchParams.set("device_id", deviceID);
  return base.toString();
}

export function sendRealtime(socket: WebSocket, envelope: RealtimeEnvelope): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(envelope));
}
