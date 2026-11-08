// DESKTOP-ADAPTED copy of piwork lib/types.ts — the three type-only imports
// below are replaced by local equivalents whose sources are not synced:
// ArtifactKind (from components/chat/artifact definitions), ChatTools (web UI
// tool shapes via InferUITool, loosened to the AI SDK tool part shape) and
// Suggestion (db schema row, serialized projection). Re-apply these rewrites
// when syncing from upstream.
import type { UIMessage } from "ai";
import { z } from "zod";

type ArtifactKind = "text" | "code" | "image" | "sheet";

type Suggestion = {
  createdAt: string | Date;
  description: string | null;
  documentCreatedAt: string | Date;
  documentId: string;
  id: string;
  isResolved: boolean;
  originalText: string;
  suggestedText: string;
  userId: string;
};

import type { Weather } from "@/components/chat/weather";

type WeatherOutput = React.ComponentProps<typeof Weather>["weatherAtLocation"];
type DesktopUiTool = { input: unknown; output: unknown };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  /** 用户消息的发送者；assistant/旧消息为 undefined。仅用于展示归属头像 */
  userId: z.string().optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = {
  input: { city?: string; latitude?: number; longitude?: number };
  output: WeatherOutput;
};
type createDocumentTool = {
  input: { kind: "text" | "code" | "image" | "sheet"; title: string };
  output: { error?: string; title?: string; messageId?: string; id?: string };
};
type updateDocumentTool = {
  input: { id?: string; description?: string } & Record<string, unknown>;
  output: { error?: string; title?: string; messageId?: string; id?: string };
};
type requestSuggestionsTool = {
  input: { documentId?: string } & Record<string, unknown>;
  output: { error?: string } & Record<string, unknown>;
};

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
};

export type WaitingStatusData = {
  phase: "waiting" | "still-waiting" | "health" | "thinking";
  message: string;
  modelId: string;
  modelName: string;
};

export type ToolStatusData = {
  detail?: string;
  phase: "start" | "end";
  toolName: string;
  message: string;
  isError?: boolean;
};

export type DeliveredFileData = {
  filename: string;
  contentType: string;
  url: string;
  downloadUrl?: string;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  "waiting-status": WaitingStatusData;
  "tool-status": ToolStatusData;
  "delivered-file": DeliveredFileData;
  /** (runId, seq) 游标：transient 直传，客户端存内存 ref 供断线重连 */
  "runtime-cursor": RuntimeCursorData;
  "reasoning-timing": ReasoningTimingData;
};

export type RuntimeCursorData = {
  runId: string;
  seq: number;
};

/**
 * reasoning 块的服务端起止时刻（epoch ms，取自 message.delta 的 at）：
 * transient 直传，客户端据此展示思考总耗时与每步耗时——断线重连/重放时
 * 到达时刻失真，服务端时刻仍准确。
 */
export type ReasoningTimingData = {
  id: string;
  phase: "start" | "end";
  at: number;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

/** 分享协作的参与者投影（不含 email 等联系方式），用于头像/名字展示 */
export type ChatParticipantInfo = {
  image: string | null;
  joinedAt: string;
  name: string | null;
  role: "owner" | "collaborator";
  title: string | null;
  userId: string;
};

export type ChatMyRole = "owner" | "collaborator" | null;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
