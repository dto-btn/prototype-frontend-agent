import { useState, useRef, useCallback, useEffect } from 'react';
import { OpenAI } from 'openai';
import { BehaviorSubject, Subject, Observable, from, of, EMPTY } from 'rxjs';
import { switchMap, catchError, takeUntil, tap, finalize, scan } from 'rxjs/operators';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface UseChatOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface UseChatResult {
  isLoading: boolean;
  currentStreamingMessage: string;
  sendMessage: (messages: Message[]) => Promise<string>;
  cancelStream: () => void;
}

// RxJS subjects to manage state
class ChatService {
  private openai: OpenAI;
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private currentStreamingMessage$ = new BehaviorSubject<string>('');
  private abortController: AbortController | null = null;
  private cancelRequest$ = new Subject<void>();
  private options: Required<UseChatOptions>;

  constructor(options: UseChatOptions = {}) {
    this.options = {
      baseURL: options.baseURL || 'http://localhost:5000/api',
      apiKey: options.apiKey || 'dummy-key',
      model: options.model || 'gpt-4o',
      maxTokens: options.maxTokens || 500,
      systemPrompt: options.systemPrompt || 'You are a helpful AI assistant.'
    };

    // Initialize OpenAI client
    this.openai = new OpenAI({
      baseURL: this.options.baseURL,
      dangerouslyAllowBrowser: true,
      apiKey: this.options.apiKey,
    });
  }

  get isLoading(): boolean {
    return this.isLoading$.getValue();
  }

  get currentStreamingMessage(): string {
    return this.currentStreamingMessage$.getValue();
  }

  get isLoading$Observable(): Observable<boolean> {
    return this.isLoading$.asObservable();
  }

  get currentStreamingMessage$Observable(): Observable<string> {
    return this.currentStreamingMessage$.asObservable();
  }

  sendMessage(messages: Message[]): Observable<string> {
    if (this.isLoading) {
      return of('');
    }

    this.isLoading$.next(true);
    this.currentStreamingMessage$.next('');

    // Cancel any previous streaming request
    if (this.abortController) {
      this.abortController.abort();
    }

    // Create a new abort controller for this request
    this.abortController = new AbortController();

    // Prepare messages for API - include system prompt
    const apiMessages = [
      { role: 'system', content: this.options.systemPrompt },
      ...messages
    ];

    return from(
      this.openai.chat.completions.create({
        messages: apiMessages as any[],
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        stream: true,
        signal: this.abortController.signal
      })
    ).pipe(
      switchMap(stream => {
        return new Observable<string>(observer => {
          let fullContent = '';
          
          const processStream = async () => {
            try {
              for await (const chunk of stream) {
                if (observer.closed) break;
                
                const content = chunk.choices[0]?.delta?.content || '';
                fullContent += content;
                this.currentStreamingMessage$.next(fullContent);
                
                // Only emit updates when there's actual content
                if (content) {
                  observer.next(fullContent);
                }
              }
              observer.next(fullContent || 'Sorry, I couldn\'t generate a response.');
              observer.complete();
            } catch (error) {
              // Ignore abort errors as they're expected when canceling
              if ((error as Error).name !== 'AbortError') {
                observer.error(error);
              } else {
                observer.complete();
              }
            }
          };
          
          processStream();
          
          return () => {
            // Cleanup when the observable is unsubscribed
            if (this.abortController) {
              this.abortController.abort();
            }
          };
        });
      }),
      takeUntil(this.cancelRequest$),
      catchError(error => {
        // Ignore abort errors as they're expected when canceling
        if ((error as Error).name !== 'AbortError') {
          console.error('Error calling API:', error);
          return of('Sorry, there was an error processing your request. Please try again later.');
        }
        return of('');
      }),
      finalize(() => {
        this.isLoading$.next(false);
        this.currentStreamingMessage$.next('');
        this.abortController = null;
      })
    );
  }

  cancelStream(): string {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.isLoading$.next(false);
      
      const interruptedMessage = this.currentStreamingMessage$.getValue() + ' [Response interrupted]';
      this.currentStreamingMessage$.next('');
      this.cancelRequest$.next();
      
      return interruptedMessage;
    }
    return '';
  }
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  // Create a ref to hold the service instance to ensure it persists across renders
  const serviceRef = useRef<ChatService | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');

  // Initialize the service if it doesn't exist
  if (!serviceRef.current) {
    serviceRef.current = new ChatService(options);
  }

  useEffect(() => {
    const service = serviceRef.current!;
    
    // Subscribe to the service's observables
    const loadingSub = service.isLoading$Observable.subscribe(setIsLoading);
    const messageSub = service.currentStreamingMessage$Observable.subscribe(setCurrentStreamingMessage);
    
    // Cleanup subscriptions on unmount
    return () => {
      loadingSub.unsubscribe();
      messageSub.unsubscribe();
    };
  }, []);

  const sendMessage = useCallback(async (messages: Message[]): Promise<string> => {
    return new Promise<string>((resolve) => {
      const service = serviceRef.current!;
      let result = '';
      
      service.sendMessage(messages).subscribe({
        next: (content) => {
          result = content;
        },
        complete: () => {
          resolve(result);
        },
        error: (err) => {
          console.error('Error in sendMessage:', err);
          resolve('Sorry, there was an error processing your request. Please try again later.');
        }
      });
    });
  }, []);

  const cancelStream = useCallback(() => {
    return serviceRef.current?.cancelStream() || '';
  }, []);

  return {
    isLoading,
    currentStreamingMessage,
    sendMessage,
    cancelStream
  };
}