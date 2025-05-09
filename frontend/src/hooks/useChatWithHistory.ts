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

class ChatHistoryService {
  private messages: Message[] = [];
  private input: string = '';
  private conversationId: string | null = null;
  private savingStates: string[] = [];
  private title: string = 'New Conversation';
  private pendingSave = false;
  private titleGenerated = false;
  private awaitingTitleUpdate = false;
  private listeners: { [K in keyof ChatHistoryServiceState]?: ((val: any) => void)[] } = {};

  constructor(initialMessages: Message[] = [], initialConversationId?: string) {
    this.messages = initialMessages;
    if (initialConversationId) {
      this.conversationId = initialConversationId;
      this.loadConversation(initialConversationId);
    }
    if (initialMessages.length > 0) {
      const userMessage = initialMessages.find(m => m.role === 'user');
      if (userMessage) {
        this.title = this.extractTitle(userMessage.content);
      }
    }
  }

  private notify<K extends keyof ChatHistoryServiceState>(key: K, value: ChatHistoryServiceState[K]) {
    (this.listeners[key] || []).forEach(cb => cb(value));
  }

  subscribe<K extends keyof ChatHistoryServiceState>(key: K, cb: (val: ChatHistoryServiceState[K]) => void) {
    if (!this.listeners[key]) this.listeners[key] = [];
    this.listeners[key]!.push(cb);
    // Initial call
    cb(this[key]);
    return () => {
      this.listeners[key] = (this.listeners[key] || []).filter(fn => fn !== cb);
    };
  }

  private setState<K extends keyof ChatHistoryServiceState>(key: K, value: ChatHistoryServiceState[K]) {
    this[key] = value;
    this.notify(key, value);
  }

  private setSaving(key: string, saving: boolean) {
    if (saving) {
      if (!this.savingStates.includes(key)) {
        this.savingStates = [...this.savingStates, key];
        this.notify('savingStates', this.savingStates);
      }
    } else {
      if (this.savingStates.includes(key)) {
        this.savingStates = this.savingStates.filter(k => k !== key);
        this.notify('savingStates', this.savingStates);
      }
    }
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
    const messages = this.messages;
    if (messages.length === 0) {
      console.warn('Cannot save empty conversation');
      return;
    }
    let id = this.conversationId;
    this.setSaving('conversation-create', true);
    try {
      if (!id) {
        const conversation = await ConversationService.createConversation(title, messages);
        this.setState('conversationId', conversation.id);
        id = conversation.id;
      } else {
        await ConversationService.updateConversation(id, { title, messages });
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
      this.savingStates = [];
      this.notify('savingStates', this.savingStates);
    }
  }

  addUserMessage(content: string) {
    if (!content.trim()) return;
    const userMessage: Message = { role: 'user', content };
    const newMessages = [...this.messages, userMessage];
    this.setState('messages', newMessages);
    this.setState('input', '');
    const conversationId = this.conversationId;
    if (conversationId) {
      this.debouncedSave(conversationId, undefined, newMessages);
    }
  }

  addAssistantMessage(content: string) {
    if (!content) return;
    const assistantMessage: Message = { role: 'assistant', content };
    const updatedMessages = [...this.messages, assistantMessage];
    this.setState('messages', updatedMessages);
    const conversationId = this.conversationId;
    const isFirstQAComplete = !conversationId && updatedMessages.length >= 1;
    if (isFirstQAComplete) {
      this.setState('title', 'Untitled Conversation');
      this.awaitingTitleUpdate = true;
      this.generateTitle(JSON.stringify(updatedMessages).substring(0, 100)).then(title => {
        this.setState('title', title);
        const currentId = this.conversationId;
        if (currentId && this.awaitingTitleUpdate) {
          this.debouncedSave(currentId, title, this.messages);
          this.awaitingTitleUpdate = false;
        }
      });
    }
    if (conversationId) {
      this.debouncedSave(conversationId, this.awaitingTitleUpdate ? this.title : undefined, updatedMessages);
    } else if (updatedMessages.length >= 1) {
      const userMessage = updatedMessages.find(m => m.role === 'user');
      if (userMessage) {
        const title = this.titleGenerated ? this.title : this.extractTitle(userMessage.content);
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
      const conversationId = this.conversationId;
      if (conversationId && this.awaitingTitleUpdate) {
        this.debouncedSave(conversationId, title, this.messages);
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

  // Getters for hook
  getState(): ChatHistoryServiceState {
    return {
      messages: this.messages,
      input: this.input,
      conversationId: this.conversationId,
      isSaving: this.savingStates.length > 0,
      title: this.title,
    };
  }
}

export function useChatWithHistory({
  initialMessages = [],
  chatOptions = {},
  conversationId
}: UseChatWithHistoryOptions = {}): UseChatWithHistoryResult {
  const historyServiceRef = useRef<ChatHistoryService | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState<string>('');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId || null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

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
    const unsubMessages = historyService.subscribe('messages', setMessages);
    const unsubInput = historyService.subscribe('input', setInput);
    const unsubConversationId = historyService.subscribe('conversationId', setCurrentConversationId);
    const unsubSaving = historyService.subscribe('savingStates', (states: string[]) => setIsSaving(states.length > 0));
    return () => {
      unsubMessages();
      unsubInput();
      unsubConversationId();
      unsubSaving();
    };
  }, []);

  const handleSetConversationId = useCallback((id: string | null) => {
    historyServiceRef.current?.setConversationId(id);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (input.trim() === '' || isLoading) return;
    const historyService = historyServiceRef.current!;
    historyService.addUserMessage(input);
    const response = await sendMessage(historyService.getState().messages);
    if (response) {
      historyService.addAssistantMessage(response);
    }
  }, [input, isLoading, sendMessage]);

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
    messages,
    input,
    setInput: handleSetInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream,
    conversationId: currentConversationId,
    saveConversation: handleSaveConversation,
    isSaving,
    setConversationId: handleSetConversationId,
    cancelStream
  };
}