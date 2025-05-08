import { useState, useCallback } from 'react';
import { useChat, type Message, type UseChatResult } from './useChat';

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

export function useChatWithHistory({
  initialMessages = [],
  chatOptions = {}
}: UseChatWithHistoryOptions = {}): UseChatWithHistoryResult {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState<string>('');
  
  const {
    isLoading,
    currentStreamingMessage,
    sendMessage,
    cancelStream
  } = useChat(chatOptions);

  const handleSendMessage = useCallback(async () => {
    if (input.trim() === '' || isLoading) return;
    
    // Add user message to history
    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    
    // Send message to API
    const response = await sendMessage(newMessages);
    
    // If we got a response and it wasn't cancelled, add it to history
    if (response) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response
      }]);
    }
  }, [input, isLoading, messages, sendMessage]);

  const handleCancelStream = useCallback(() => {
    const interruptedContent = cancelStream();
    
    // If we have a partial message, add it to the conversation
    if (interruptedContent) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: interruptedContent
      }]);
    }
  }, [cancelStream]);

  return {
    messages,
    input,
    setInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream
  };
}