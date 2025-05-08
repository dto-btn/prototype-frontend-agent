import { useState, useCallback, useRef, useEffect } from 'react';
import { useChat, type Message, type UseChatResult } from './useChat';
import { BehaviorSubject, Observable } from 'rxjs';

interface UseChatWithHistoryOptions {
  initialMessages?: Message[];
  chatOptions?: Parameters<typeof useChat>[0];
}

interface UseChatWithHistoryResult extends Omit<UseChatResult, 'sendMessage'> {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  handleSendMessage: () => Promise<void>;
  handleCancelStream: () => void;
}

// RxJS service to manage chat history
class ChatHistoryService {
  private messages$ = new BehaviorSubject<Message[]>([]);
  private input$ = new BehaviorSubject<string>('');
  
  constructor(initialMessages: Message[] = []) {
    this.messages$.next(initialMessages);
  }
  
  get messages(): Message[] {
    return this.messages$.getValue();
  }
  
  get input(): string {
    return this.input$.getValue();
  }
  
  get messages$Observable(): Observable<Message[]> {
    return this.messages$.asObservable();
  }
  
  get input$Observable(): Observable<string> {
    return this.input$.asObservable();
  }
  
  setInput(value: string): void {
    this.input$.next(value);
  }
  
  addUserMessage(content: string): void {
    if (!content.trim()) return;
    
    const userMessage: Message = { role: 'user', content };
    this.messages$.next([...this.messages$.getValue(), userMessage]);
    this.input$.next('');
  }
  
  addAssistantMessage(content: string): void {
    if (!content) return;
    
    const assistantMessage: Message = { role: 'assistant', content };
    this.messages$.next([...this.messages$.getValue(), assistantMessage]);
  }
}

export function useChatWithHistory({
  initialMessages = [],
  chatOptions = {}
}: UseChatWithHistoryOptions = {}): UseChatWithHistoryResult {
  // Create a ref to hold the service instance to ensure it persists across renders
  const historyServiceRef = useRef<ChatHistoryService | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState<string>('');
  
  const {
    isLoading,
    currentStreamingMessage,
    sendMessage,
    cancelStream
  } = useChat(chatOptions);
  
  // Initialize the history service if it doesn't exist
  if (!historyServiceRef.current) {
    historyServiceRef.current = new ChatHistoryService(initialMessages);
  }
  
  useEffect(() => {
    const historyService = historyServiceRef.current!;
    
    // Subscribe to the service's observables
    const messagesSub = historyService.messages$Observable.subscribe(setMessages);
    const inputSub = historyService.input$Observable.subscribe(setInput);
    
    // Cleanup subscriptions on unmount
    return () => {
      messagesSub.unsubscribe();
      inputSub.unsubscribe();
    };
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
  
  return {
    messages,
    input,
    setInput: handleSetInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream,
    cancelStream
  };
}