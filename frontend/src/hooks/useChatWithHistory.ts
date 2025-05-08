import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat, type Message, type UseChatResult } from './useChat';
import { BehaviorSubject, Observable, of, Subject, firstValueFrom } from 'rxjs';
import { switchMap, catchError, tap, finalize } from 'rxjs/operators';
import { ConversationService } from '../services/conversationService';

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

// RxJS service to manage chat history
class ChatHistoryService {
  private messages$ = new BehaviorSubject<Message[]>([]);
  private input$ = new BehaviorSubject<string>('');
  private conversationId$ = new BehaviorSubject<string | null>(null);
  private isSaving$ = new BehaviorSubject<boolean>(false);
  private saveConversation$ = new Subject<{ id: string, title: string, messages: Message[] }>();
  
  constructor(initialMessages: Message[] = [], initialConversationId?: string) {
    this.messages$.next(initialMessages);
    
    if (initialConversationId) {
      this.conversationId$.next(initialConversationId);
      this.loadConversation(initialConversationId);
    }
    
    // Set up save conversation subscription
    this.saveConversation$.pipe(
      tap(() => this.isSaving$.next(true)),
      switchMap(({ id, title, messages }) => 
        ConversationService.updateConversation(id, {
          title, 
          messages
        }).pipe(
          catchError(error => {
            console.error('Error saving conversation:', error);
            return of(null);
          })
        )
      ),
      finalize(() => this.isSaving$.next(false))
    ).subscribe(result => {
      if (result) {
        console.log('Conversation saved:', result);
      }
    });
  }
  
  loadConversation(id: string): void {
    this.isSaving$.next(true);
    
    ConversationService.getConversation(id).subscribe({
      next: conversation => {
        this.messages$.next(conversation.messages);
        this.conversationId$.next(conversation.id);
        this.isSaving$.next(false);
      },
      error: error => {
        console.error('Error loading conversation:', error);
        this.isSaving$.next(false);
      }
    });
  }
  
  async saveConversation(title: string): Promise<void> {
    const messages = this.messages$.getValue();
    
    if (messages.length === 0) {
      console.warn('Cannot save empty conversation');
      return;
    }
    
    let id = this.conversationId$.getValue();
    
    // If no ID exists, create a new conversation
    if (!id) {
      try {
        const conversation = await firstValueFrom(
          ConversationService.createConversation(title, messages)
        );
        this.conversationId$.next(conversation.id);
        id = conversation.id;
      } catch (error) {
        console.error('Error creating conversation:', error);
        return;
      }
    } else {
      // Use existing ID to update the conversation
      this.saveConversation$.next({
        id,
        title,
        messages
      });
    }
  }
  
  get messages(): Message[] {
    return this.messages$.getValue();
  }
  
  get input(): string {
    return this.input$.getValue();
  }
  
  get conversationId(): string | null {
    return this.conversationId$.getValue();
  }
  
  get isSaving(): boolean {
    return this.isSaving$.getValue();
  }
  
  get messages$Observable(): Observable<Message[]> {
    return this.messages$.asObservable();
  }
  
  get input$Observable(): Observable<string> {
    return this.input$.asObservable();
  }
  
  get conversationId$Observable(): Observable<string | null> {
    return this.conversationId$.asObservable();
  }
  
  get isSaving$Observable(): Observable<boolean> {
    return this.isSaving$.asObservable();
  }
  
  setInput(value: string): void {
    this.input$.next(value);
  }
  
  setConversationId(id: string | null): void {
    if (id) {
      this.loadConversation(id);
    } else {
      this.conversationId$.next(null);
      this.messages$.next([]);
    }
  }
  
  addUserMessage(content: string): void {
    if (!content.trim()) return;
    
    const userMessage: Message = { role: 'user', content };
    this.messages$.next([...this.messages$.getValue(), userMessage]);
    this.input$.next('');
    
    // Auto-save if we have a conversation ID
    const conversationId = this.conversationId$.getValue();
    if (conversationId) {
      this.saveConversation$.next({
        id: conversationId,
        title: this.extractTitle(content),
        messages: this.messages$.getValue()
      });
    }
  }
  
  addAssistantMessage(content: string): void {
    if (!content) return;
    
    const assistantMessage: Message = { role: 'assistant', content };
    const updatedMessages = [...this.messages$.getValue(), assistantMessage];
    this.messages$.next(updatedMessages);
    
    const conversationId = this.conversationId$.getValue();
    
    // If we already have a conversation ID, update it
    if (conversationId) {
      this.saveConversation$.next({
        id: conversationId,
        title: this.extractTitle(updatedMessages[0]?.content || ''),
        messages: updatedMessages
      });
    } 
    // If this is a new conversation (no ID yet) and we have messages, create a new one
    else if (updatedMessages.length >= 2) { // At least one user message and one assistant message
      const userMessage = updatedMessages.find(m => m.role === 'user');
      if (userMessage) {
        const title = this.extractTitle(userMessage.content);
        // Create a new conversation asynchronously
        firstValueFrom(
          ConversationService.createConversation(title, updatedMessages)
        ).then(conversation => {
          console.log('New conversation created after completion:', conversation);
          this.conversationId$.next(conversation.id);
        }).catch(error => {
          console.error('Error creating conversation after completion:', error);
        });
      }
    }
  }
  
  // Helper to extract a title from the first message
  private extractTitle(content: string): string {
    // Use the first ~30 characters of first user message as title
    const truncated = content.substring(0, 30).trim();
    return truncated.length > 0 
      ? `${truncated}${truncated.length >= 30 ? '...' : ''}`
      : 'New Conversation';
  }
}

export function useChatWithHistory({
  initialMessages = [],
  chatOptions = {},
  conversationId
}: UseChatWithHistoryOptions = {}): UseChatWithHistoryResult {
  // Create a ref to hold the service instance to ensure it persists across renders
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
  
  // Initialize the history service if it doesn't exist
  if (!historyServiceRef.current) {
    historyServiceRef.current = new ChatHistoryService(initialMessages, conversationId);
  }
  
  useEffect(() => {
    const historyService = historyServiceRef.current!;
    
    // Subscribe to the service's observables
    const messagesSub = historyService.messages$Observable.subscribe(setMessages);
    const inputSub = historyService.input$Observable.subscribe(setInput);
    const conversationIdSub = historyService.conversationId$Observable.subscribe(setCurrentConversationId);
    const isSavingSub = historyService.isSaving$Observable.subscribe(setIsSaving);
    
    // Cleanup subscriptions on unmount
    return () => {
      messagesSub.unsubscribe();
      inputSub.unsubscribe();
      conversationIdSub.unsubscribe();
      isSavingSub.unsubscribe();
    };
  }, []);
  
  // Handle manual setting of conversation ID
  const handleSetConversationId = useCallback((id: string | null) => {
    historyServiceRef.current?.setConversationId(id);
  }, []);
  
  const handleSendMessage = useCallback(async () => {
    if (input.trim() === '' || isLoading) return;
    
    const historyService = historyServiceRef.current!;
    historyService.addUserMessage(input);
    
    // Send message to API with current message history
    const response = await sendMessage(historyService.messages);
    
    // If we got a response, add it to history
    if (response) {
      historyService.addAssistantMessage(response);
    }
  }, [input, isLoading, sendMessage]);
  
  const handleCancelStream = useCallback(() => {
    // Call the cancelStream function from useChat hook
    // Note: Although the interface says cancelStream returns void,
    // the implementation actually returns a string
    
    // We need to use a type assertion here to resolve the type mismatch
    const result = cancelStream() as unknown as string;
    
    // Check if we have actual content to add
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