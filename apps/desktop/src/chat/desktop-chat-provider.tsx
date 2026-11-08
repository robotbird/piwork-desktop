// Desktop stand-in for the web's ActiveChatProvider (hooks/use-active-chat):
// same context shape, but the transport runs over window.desktop IPC and the
// UIMessageChunk stream dual-emitted by the chat worker (P4). Web-only concerns
// (votes, collaboration, sharing) are surfaced as their neutral empty values.
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import type { ChatTransport } from 'ai';
import type { ChatStreamChunk } from '@/app/(chat)/api/chat/stream-mapping';
import type { ChatMessage } from '@/lib/types';
import type { ChatParticipantInfo, ChatMyRole } from '@/lib/types';
import type { Vote } from '@/lib/db/schema';
import type { ChatChunkMessage } from '../../shared/types';

/** Delivers a user turn to the chat worker; resolves to the chat id (new or existing). */
export type DeliverMessage = (text: string) => Promise<string | null>;

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  status: UseChatHelpers<ChatMessage>['status'];
  stop: UseChatHelpers<ChatMessage>['stop'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: 'private';
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  myRole: ChatMyRole;
  participants: ChatParticipantInfo[];
  onlineUserIds: string[];
  typingUserIds: string[];
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function userTextOf(messages: ChatMessage[]): string {
  const last = messages.at(-1);
  if (last?.role !== 'user') return '';
  return last.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string }).text)
    .join('');
}

function createIpcTransport(
  deliver: DeliverMessage,
  onChatId: (id: string) => void,
): ChatTransport<ChatMessage> {
  return {
    sendMessages: async ({ messages }) => {
      let pushChunk: (chunk: ChatStreamChunk) => void = () => {};
      let finishStream: () => void = () => {};
      let failStream: (error: Error) => void = () => {};
      const stream = new ReadableStream<ChatStreamChunk>({
        start(controller) {
          pushChunk = (chunk) => controller.enqueue(chunk);
          finishStream = () => controller.close();
          failStream = (error) => controller.error(error);
        },
      });
      const unsubscribe = window.desktop.onChatChunks((event: ChatChunkMessage) => {
        if (event.control === 'end') {
          unsubscribe();
          finishStream();
        } else if (event.control === 'error') {
          unsubscribe();
          failStream(new Error(event.error ?? 'chat failed'));
        } else if (event.chunk) {
          pushChunk(event.chunk as ChatStreamChunk);
        }
      });
      try {
        const id = await deliver(userTextOf(messages));
        if (id) onChatId(id);
      } catch (error) {
        unsubscribe();
        failStream(error instanceof Error ? error : new Error('send failed'));
      }
      return stream;
    },
    reconnectToStream: async () => null,
  };
}

export function DesktopChatProvider({
  children,
  deliver,
  externalChatId,
  currentModelId: initialModelId = 'desktop',
}: {
  children: ReactNode;
  deliver: DeliverMessage;
  externalChatId?: string | null;
  currentModelId?: string;
}) {
  const [chatId, setChatId] = useState(externalChatId ?? '');
  const [currentModelId, setCurrentModelId] = useState(initialModelId);
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [input, setInput] = useState('');
  const onChatId = useCallback((id: string) => setChatId(id), []);
  const transport = useMemo(
    () => createIpcTransport(deliver, onChatId),
    [deliver, onChatId],
  );

  const chat = useChat<ChatMessage>({
    transport,
    // mirror web: auto-continue after an approved tool response
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return Boolean(
        lastMessage?.parts?.some(
          (part) =>
            'state' in part &&
            part.state === 'approval-responded' &&
            'approval' in part &&
            (part.approval as { approved?: boolean })?.approved === true,
        ),
      );
    },
  });

  const stop = useCallback(async () => {
    chat.stop();
    await window.desktop.stopChat();
  }, [chat]);

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages: chat.messages,
      setMessages: chat.setMessages,
      sendMessage: chat.sendMessage,
      status: chat.status,
      stop,
      regenerate: chat.regenerate,
      addToolApprovalResponse: chat.addToolApprovalResponse,
      input,
      setInput,
      visibilityType: 'private',
      isReadonly: false,
      isLoading: chat.status === 'submitted' || chat.status === 'streaming',
      votes: undefined,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert,
      myRole: 'owner',
      participants: [],
      onlineUserIds: [],
      typingUserIds: [],
    }),
    [chat, chatId, currentModelId, input, showCreditCardAlert, stop],
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error('useActiveChat must be used within DesktopChatProvider');
  }
  return context;
}
