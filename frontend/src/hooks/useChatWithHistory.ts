import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat, type Message, type UseChatResult } from './useChat';
import { debounce } from '../utils/debounce';
import { ConversationService } from '../services/conversationService';
import { generateTitle } from '../services/titleGenerationService';

interface UseChatWithHistoryOptions {
  initialMessages?: Message[];
  chatOptions?: Parameters<typeof useChat>[0];
  conversationId?: string;
}

interface UseChatWithHistoryResult extends Omit<UseChatResult, 'sendMessage'> {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  handleSendMessage: () => Promise<void>;
  handleCancelStream: () => void;
  conversationId: string | null;
  saveConversation: (title: string) => Promise<void>;
  isSaving: boolean;
  setConversationId: (id: string | null) => void;
}

type ChatHistoryServiceState = {
  messages: Message[];
  input: string;
  conversationId: string | null;
  isSaving: boolean;
  title: string;
  savingStates?: string[];
};

// --- ChatHistoryService: manages chat state, persistence, and title generation ---
class ChatHistoryService {
  private state: ChatHistoryServiceState;
  private listeners: { [K in keyof ChatHistoryServiceState]?: ((val: any) => void)[] } = {};
  private pendingSave = false;
  private titleGenerated = false;
  private awaitingTitleUpdate = false;

  constructor(initialMessages: Message[] = [], initialConversationId?: string) {
    this.state = {
      messages: initialMessages,
      input: '',
      conversationId: initialConversationId || null,
      isSaving: false,
      title: initialMessages.length > 0
        ? this.extractTitle(initialMessages.find(m => m.role === 'user')?.content || '')
        : 'New Conversation',
      savingStates: [],
    };
    if (initialConversationId) this.loadConversation(initialConversationId);
  }

  private notify<K extends keyof ChatHistoryServiceState>(key: K, value: ChatHistoryServiceState[K]) {
    (this.listeners[key] || []).forEach(cb => cb(value));
  }

  subscribe<K extends keyof ChatHistoryServiceState>(key: K, cb: (val: ChatHistoryServiceState[K]) => void) {
    if (!this.listeners[key]) this.listeners[key] = [];
    this.listeners[key]!.push(cb);
    cb(this.state[key]);
    return () => {
      this.listeners[key] = (this.listeners[key] || []).filter(fn => fn !== cb);
    };
  }

  private setState<K extends keyof ChatHistoryServiceState>(key: K, value: ChatHistoryServiceState[K]) {
    this.state[key] = value;
    this.notify(key, value);
  }

  private setSaving(key: string, saving: boolean) {
    const savingStates = this.state.savingStates || [];
    const next = saving
      ? savingStates.includes(key) ? savingStates : [...savingStates, key]
      : savingStates.filter(k => k !== key);
    this.setState('savingStates', next);
    this.setState('isSaving', next.length > 0);
  }

  async loadConversation(id: string) {
    this.setSaving('conversation-load', true);
    try {
      const conversation = await ConversationService.getConversation(id);
      this.setState('messages', conversation.messages);
      this.setState('conversationId', conversation.id);
    } catch (error) {
      console.error('Error loading conversation:', error);
    } finally {
      this.setSaving('conversation-load', false);
    }
  }

  async saveConversation(title: string): Promise<void> {
    const { messages, conversationId } = this.state;
    if (messages.length === 0) return;
    this.setSaving('conversation-create', true);
    try {
      if (!conversationId) {
        const conversation = await ConversationService.createConversation(title, messages);
        this.setState('conversationId', conversation.id);
      } else {
        await ConversationService.updateConversation(conversationId, { title, messages });
      }
    } catch (error) {
      console.error('Error creating/updating conversation:', error);
    } finally {
      this.setSaving('conversation-create', false);
    }
  }

  setInput(value: string) {
    this.setState('input', value);
  }

  setConversationId(id: string | null) {
    if (id) {
      this.loadConversation(id);
    } else {
      this.setState('conversationId', null);
      this.setState('messages', []);
      this.setState('title', 'New Conversation');
      this.titleGenerated = false;
      this.awaitingTitleUpdate = false;
      this.setState('savingStates', []);
    }
  }

  addUserMessage(content: string) {
    if (!content.trim()) return;
    const userMessage: Message = { role: 'user', content };
    const newMessages = [...this.state.messages, userMessage];
    this.setState('messages', newMessages);
    this.setState('input', '');
    if (this.state.conversationId) {
      this.debouncedSave(this.state.conversationId, undefined, newMessages);
    }
  }

  addAssistantMessage(content: string) {
    if (!content) return;
    const assistantMessage: Message = { role: 'assistant', content };
    const updatedMessages = [...this.state.messages, assistantMessage];
    this.setState('messages', updatedMessages);
    const { conversationId } = this.state;
    const isFirstQAComplete = !conversationId && updatedMessages.length >= 1;
    if (isFirstQAComplete) {
      this.setState('title', 'Untitled Conversation');
      this.awaitingTitleUpdate = true;
      this.generateTitle(JSON.stringify(updatedMessages).substring(0, 100)).then(title => {
        this.setState('title', title);
        if (this.state.conversationId && this.awaitingTitleUpdate) {
          this.debouncedSave(this.state.conversationId, title, this.state.messages);
          this.awaitingTitleUpdate = false;
        }
      });
    }
    if (conversationId) {
      this.debouncedSave(conversationId, this.awaitingTitleUpdate ? this.state.title : undefined, updatedMessages);
    } else if (updatedMessages.length >= 1) {
      const userMessage = updatedMessages.find(m => m.role === 'user');
      if (userMessage) {
        const title = this.titleGenerated ? this.state.title : this.extractTitle(userMessage.content);
        ConversationService.createConversation(title, updatedMessages)
          .then(conversation => {
            this.setState('conversationId', conversation.id);
          })
          .catch(error => {
            console.error('Error creating conversation after completion:', error);
            this.awaitingTitleUpdate = false;
          });
      }
    }
  }

  private debouncedSave = debounce((id: string, title: string | undefined, messages: Message[]) => {
    if (!this.pendingSave) {
      this.pendingSave = true;
      this.setSaving('conversation-update', true);
      ConversationService.updateConversation(id, { ...(title !== undefined && { title }), messages })
        .catch(error => {
          console.error('Error saving conversation:', error);
        })
        .finally(() => {
          this.setSaving('conversation-update', false);
          this.pendingSave = false;
        });
    }
  }, 300);

  private async generateTitle(content: string): Promise<string> {
    this.setSaving('title-generation', true);
    try {
      const title = await generateTitle(content);
      this.titleGenerated = true;
      this.setState('title', title);
      if (this.state.conversationId && this.awaitingTitleUpdate) {
        this.debouncedSave(this.state.conversationId, title, this.state.messages);
        this.awaitingTitleUpdate = false;
      }
      return title;
    } catch (error) {
      console.error('Error generating title with AI:', error);
      this.awaitingTitleUpdate = false;
      const extractedTitle = this.extractTitle(content);
      this.titleGenerated = true;
      return extractedTitle;
    } finally {
      this.setSaving('title-generation', false);
    }
  }

  private extractTitle(content: string): string {
    const truncated = content.substring(0, 30).trim();
    return truncated.length > 0 
      ? `${truncated}${truncated.length >= 30 ? '...' : ''}`
      : 'New Conversation';
  }

  getState(): ChatHistoryServiceState {
    return { ...this.state };
  }
}

// --- useChatWithHistory: React hook for chat with history and persistence ---
export function useChatWithHistory({
  initialMessages = [],
  chatOptions = {},
  conversationId
}: UseChatWithHistoryOptions = {}): UseChatWithHistoryResult {
  const historyServiceRef = useRef<ChatHistoryService | null>(null);
  const [state, setState] = useState<ChatHistoryServiceState>({
    messages: initialMessages,
    input: '',
    conversationId: conversationId || null,
    isSaving: false,
    title: 'New Conversation',
    savingStates: [],
  });

  const {
    isLoading,
    currentStreamingMessage,
    sendMessage,
    cancelStream
  } = useChat(chatOptions);

  if (!historyServiceRef.current) {
    historyServiceRef.current = new ChatHistoryService(initialMessages, conversationId);
  }

  useEffect(() => {
    const historyService = historyServiceRef.current!;
    const unsubs = [
      historyService.subscribe('messages', (v) => setState(s => ({ ...s, messages: v })) ),
      historyService.subscribe('input', (v) => setState(s => ({ ...s, input: v })) ),
      historyService.subscribe('conversationId', (v) => setState(s => ({ ...s, conversationId: v })) ),
      historyService.subscribe('isSaving', (v) => setState(s => ({ ...s, isSaving: v })) ),
    ];
    return () => { unsubs.forEach(unsub => unsub()); };
  }, []);

  const handleSetConversationId = useCallback((id: string | null) => {
    historyServiceRef.current?.setConversationId(id);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (state.input.trim() === '' || isLoading) return;
    const historyService = historyServiceRef.current!;
    historyService.addUserMessage(state.input);
    const response = await sendMessage(historyService.getState().messages);
    if (response) {
      historyService.addAssistantMessage(response);
    }
  }, [state.input, isLoading, sendMessage]);

  const handleCancelStream = useCallback(() => {
    const result = cancelStream() as unknown as string;
    if (result && result.length > 0) {
      historyServiceRef.current?.addAssistantMessage(result);
    }
  }, [cancelStream]);

  const handleSetInput = useCallback((value: string) => {
    historyServiceRef.current?.setInput(value);
  }, []);

  const handleSaveConversation = useCallback(async (title: string) => {
    await historyServiceRef.current?.saveConversation(title);
  }, []);

  return {
    messages: state.messages,
    input: state.input,
    setInput: handleSetInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream,
    conversationId: state.conversationId,
    saveConversation: handleSaveConversation,
    isSaving: state.isSaving,
    setConversationId: handleSetConversationId,
    cancelStream
  };
}