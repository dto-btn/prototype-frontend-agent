import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat, type Message, type UseChatResult } from './useChat';
import { BehaviorSubject, Observable, of, Subject, firstValueFrom } from 'rxjs';
import { switchMap, catchError, tap, finalize } from 'rxjs/operators';
import { ConversationService } from '../services/conversationService';
import { debounce } from '../utils/debounce';
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

// RxJS service to manage chat history
class ChatHistoryService {
  private messages$ = new BehaviorSubject<Message[]>([]);
  private input$ = new BehaviorSubject<string>('');
  private conversationId$ = new BehaviorSubject<string | null>(null);
  private isSaving$ = new BehaviorSubject<boolean>(false);
  private title$ = new BehaviorSubject<string>('New Conversation');
  private saveConversation$ = new Subject<{ id: string, title?: string, messages: Message[] }>();
  private pendingSave = false; // Track if a save is already pending
  private titleGenerated = false; // Track if we've already generated a title
  private awaitingTitleUpdate = false; // Track if we're waiting for an AI title update
  
  // Debounced method to trigger conversation save
  private debouncedSave = debounce((id: string, title: string | undefined, messages: Message[]) => {
    if (!this.pendingSave) {
      this.pendingSave = true;
      this.saveConversation$.next({
        id,
        // If title is undefined, don't include it in the update
        ...(title !== undefined && { title }),
        messages
      });
    }
  }, 300); // 300ms debounce
  
  constructor(initialMessages: Message[] = [], initialConversationId?: string) {
    this.messages$.next(initialMessages);
    
    if (initialConversationId) {
      this.conversationId$.next(initialConversationId);
      this.loadConversation(initialConversationId);
    }

    // If we have initial messages, set a default title based on them
    if (initialMessages.length > 0) {
      const userMessage = initialMessages.find(m => m.role === 'user');
      if (userMessage) {
        this.title$.next(this.extractTitle(userMessage.content));
      }
    }
    
    // Set up save conversation subscription
    this.saveConversation$.pipe(
      tap(() => this.isSaving$.next(true)),
      switchMap(({ id, title, messages }) => 
        ConversationService.updateConversation(id, {
          // Only include title in the update if it's defined
          ...(title !== undefined && { title }),
          messages
        }).pipe(
          catchError(error => {
            console.error('Error saving conversation:', error);
            return of(null);
          })
        )
      ),
      finalize(() => {
        this.isSaving$.next(false);
        this.pendingSave = false; // Reset pending flag after operation completes
      })
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
        // No need to manually update conversationStore as ConversationService now does it
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

  get title(): string {
    return this.title$.getValue();
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

  get title$Observable(): Observable<string> {
    return this.title$.asObservable();
  }
  
  setInput(value: string): void {
    this.input$.next(value);
  }
  
  setConversationId(id: string | null): void {
    if (id) {
      this.loadConversation(id);
    } else {
      // This is a new conversation, reset all relevant state
      this.conversationId$.next(null);
      this.messages$.next([]);
      this.title$.next('New Conversation');
      this.titleGenerated = false; // Reset title generation flag
      this.awaitingTitleUpdate = false; // Reset awaiting title update flag
    }
  }
  
  addUserMessage(content: string): void {
    if (!content.trim()) return;
    
    const userMessage: Message = { role: 'user', content };
    this.messages$.next([...this.messages$.getValue(), userMessage]);
    this.input$.next('');
    
    // Auto-save if we have a conversation ID, using debounce
    const conversationId = this.conversationId$.getValue();
    if (conversationId) {
      this.debouncedSave(
        conversationId,
        undefined, // Don't update the title for existing conversations
        this.messages$.getValue()
      );
    }
  }
  
  addAssistantMessage(content: string): void {
    if (!content) return;
    
    const assistantMessage: Message = { role: 'assistant', content };
    const updatedMessages = [...this.messages$.getValue(), assistantMessage];
    this.messages$.next(updatedMessages);
    
    const conversationId = this.conversationId$.getValue();
    
    // Check if this is a new conversation that just completed a new Q&A exchange.
    // You can do this by checking if there is a conversation ID.
    const currentId = this.conversationId$.getValue();
    const isFirstQAComplete = !currentId && updatedMessages.length >= 1;
    
    if (isFirstQAComplete) {
      console.log('First complete Q&A detected, generating title...');      
      // Show a temporary title while AI generates the better one
      const tempTitle = "Untitled Conversation";
      this.title$.next(tempTitle);
      this.awaitingTitleUpdate = true; // Mark this conversation as awaiting title update
      
      // Generate AI title asynchronously and update when ready
      this.generateTitle(JSON.stringify(updatedMessages).substring(0, 100)).then(title => {
        console.log('AI title generated:', title);
        // Update the title in the UI
        this.title$.next(title);
        
        // If we have a conversation ID by now, update the title
        const currentId = this.conversationId$.getValue();
        if (currentId && this.awaitingTitleUpdate) {
          console.log('Updating title for recently created conversation:', currentId, title);
          this.debouncedSave(
            currentId,
            title,
            this.messages$.getValue()
          );
          this.awaitingTitleUpdate = false;
        }
      });
    }
    
    // If we already have a conversation ID, update it with debounce
    if (conversationId) {
      // Only update title if this conversation is awaiting a title update
      // Otherwise, don't change the title, just update the messages
      this.debouncedSave(
        conversationId,
        this.awaitingTitleUpdate ? this.title$.getValue() : undefined,
        updatedMessages
      );
    } 
    // If this is a new conversation (no ID yet) and we have messages, create a new one
    else if (updatedMessages.length >= 1) { // At least one user message is required
      const userMessage = updatedMessages.find(m => m.role === 'user');
      if (userMessage) {
        // Use the generated title if available, otherwise extract from the message
        const title = this.titleGenerated ? this.title$.getValue() : this.extractTitle(userMessage.content);
        
        // Create a new conversation asynchronously
        firstValueFrom(
          ConversationService.createConversation(title, updatedMessages)
        ).then(conversation => {
          console.log('New conversation created after completion:', conversation);
          this.conversationId$.next(conversation.id);
        }).catch(error => {
          console.error('Error creating conversation after completion:', error);
          this.awaitingTitleUpdate = false; // Reset flag on error
        });
      }
    }
  }
  
  // Generate a meaningful title based on the conversation content using AI
  private async generateTitle(content: string): Promise<string> {
    try {
      // Use the AI-powered title generation service
      console.log('Generating title with AI for conversation');
      const title = await generateTitle(content);
      console.log('AI generated title:', title);
      
      this.titleGenerated = true; // Mark that we've generated a title for this conversation
      this.title$.next(title);
      
      // Important: Update the conversation in the store if we have an ID and are awaiting update
      const conversationId = this.conversationId$.getValue();
      if (conversationId && this.awaitingTitleUpdate) {
        console.log('Updating conversation with AI-generated title:', title);
        // Update the title in the database and conversationStore
        this.debouncedSave(conversationId, title, this.messages$.getValue());
        this.awaitingTitleUpdate = false;
      }
      
      return title;
    } catch (error) {
      console.error('Error generating title with AI:', error);
      this.awaitingTitleUpdate = false; // Reset the flag on error
      const extractedTitle = this.extractTitle(userMessage); // Fallback to simple extraction
      this.titleGenerated = true; // Still mark title as generated even with fallback
      return extractedTitle;
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