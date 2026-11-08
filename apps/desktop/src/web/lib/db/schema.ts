// DESKTOP-AUTHORED type stub at the web @/lib/db/schema path so copied web
// components resolve their type-only imports without dragging in drizzle.
// Shapes mirror the serialized projections the UI layer actually consumes.
export type Vote = {
  chatId: string;
  isUpvoted: boolean;
  messageId: string;
};

export type Document = {
  id: string;
  createdAt: string | Date;
  content: string | null;
  kind: "text" | "code" | "image" | "sheet";
  title: string;
  userId?: string | null;
};
