import { useState, useRef, useCallback } from 'react';
import { OpenAI } from 'openai';

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

export function useChat({
  baseURL = 'http://localhost:5000/api',
  apiKey = 'dummy-key',
  model = 'gpt-4o',
  maxTokens = 500,
  systemPrompt = 'You are a helpful AI assistant.'
}: UseChatOptions = {}): UseChatResult {
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize OpenAI client
  const openai = new OpenAI({
    baseURL,
    dangerouslyAllowBrowser: true, // Allow running in browser (only for development)
    apiKey,
  });

  const sendMessage = useCallback(async (messages: Message[]): Promise<string> => {
    if (isLoading) return '';
    
    setIsLoading(true);
    setCurrentStreamingMessage('');
    
    // Cancel any previous streaming request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create a new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    try {
      // Prepare messages for API - include system prompt
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];
      
      // Use streaming for improved user experience
      const stream = await openai.chat.completions.create({
        messages: apiMessages as any[],
        model,
        max_tokens: maxTokens,
        stream: true,
        signal: abortControllerRef.current.signal,
        
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;
        setCurrentStreamingMessage(fullContent);
      }

      return fullContent || 'Sorry, I couldn\'t generate a response.';
      
    } catch (error) {
      // Ignore abort errors as they're expected when canceling
      if ((error as Error).name !== 'AbortError') {
        console.error('Error calling API:', error);
        return 'Sorry, there was an error processing your request. Please try again later.';
      }
      return '';
    } finally {
      setIsLoading(false);
      setCurrentStreamingMessage('');
      abortControllerRef.current = null;
    }
  }, [isLoading, openai, model, maxTokens, systemPrompt]);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      const interruptedMessage = currentStreamingMessage + ' [Response interrupted]';
      setCurrentStreamingMessage('');
      return interruptedMessage;
    }
    return '';
  }, [currentStreamingMessage]);

  return {
    isLoading,
    currentStreamingMessage,
    sendMessage,
    cancelStream
  };
}