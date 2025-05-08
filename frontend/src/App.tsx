import { useState, useRef } from 'react';
import { OpenAI } from "openai";

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant. How can I help you today?'
    },
    {
      role: 'user',
      content: 'Can you explain how machine learning works?'
    },
    {
      role: 'assistant',
      content: 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It works by identifying patterns in data and making predictions or decisions based on those patterns. The basic process involves training a model on a dataset, validating its performance, and then using it to make predictions on new data.'
    }
  ]);

  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize OpenAI client
  const openai = new OpenAI({
    baseURL: 'http://localhost:5000/api', // Point to our backend proxy
    dangerouslyAllowBrowser: true, // Allow running in browser (only for development)
    apiKey: 'dummy-key', // This will be ignored by our backend proxy
  });

  const handleSendMessage = async () => {
    if (input.trim() === '' || isLoading) return;
    
    // Add user message
    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setCurrentStreamingMessage('');
    
    // Cancel any previous streaming request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create a new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    try {
      // Prepare messages for API - include all conversation history
      const apiMessages = [
        { role: 'system', content: 'You are a helpful AI assistant.' },
        ...newMessages
      ];
      
      // Use streaming for improved user experience
      const stream = await openai.chat.completions.create({
        messages: apiMessages as any[],
        model: 'gpt-4o',
        max_tokens: 500,
        stream: true,
        signal: abortControllerRef.current.signal
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;
        setCurrentStreamingMessage(fullContent);
      }

      // Once streaming is complete, add the full message to the chat
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: fullContent || 'Sorry, I couldn\'t generate a response.'
      }]);
      
    } catch (error) {
      // Ignore abort errors as they're expected when canceling
      if ((error as Error).name !== 'AbortError') {
        console.error('Error calling API:', error);
        setMessages([...newMessages, { 
          role: 'assistant', 
          content: 'Sorry, there was an error processing your request. Please try again later.'
        }]);
      }
    } finally {
      setIsLoading(false);
      setCurrentStreamingMessage('');
      abortControllerRef.current = null;
    }
  };

  // Function to cancel a streaming response
  const handleCancelStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      
      // If we have a partial message, add it to the conversation
      if (currentStreamingMessage) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: currentStreamingMessage + ' [Response interrupted]'
        }]);
        setCurrentStreamingMessage('');
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-base-200 max-w-md mx-auto">
      {/* Header */}
      <div className="navbar bg-primary text-primary-content">
        <div className="flex-1">
          <a className="btn btn-ghost normal-case text-xl">AI Chat Assistant</a>
        </div>
      </div>
      
      {/* Chat messages */}
      <div className="flex-grow p-4 overflow-y-auto">
        <div className="flex flex-col space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
              <div className={`chat-bubble ${message.role === 'user' ? 'chat-bubble-primary' : 'chat-bubble-secondary'}`}>
                {message.content}
              </div>
            </div>
          ))}
          {isLoading && currentStreamingMessage && (
            <div className="chat chat-start">
              <div className="chat-bubble chat-bubble-secondary">
                {currentStreamingMessage}
              </div>
            </div>
          )}
          {isLoading && !currentStreamingMessage && (
            <div className="chat chat-start">
              <div className="chat-bubble chat-bubble-secondary flex items-center gap-2">
                <span className="loading loading-dots loading-sm"></span>
                Thinking...
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Input area */}
      <div className="p-4 bg-base-300">
        <div className="flex space-x-2">
          <input 
            type="text" 
            placeholder="Type your message here..." 
            className="input input-bordered flex-grow" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage();
              }
            }}
            disabled={isLoading}
          />
          {isLoading ? (
            <button 
              className="btn btn-warning"
              onClick={handleCancelStream}
            >
              Cancel
            </button>
          ) : (
            <button 
              className="btn btn-primary"
              onClick={handleSendMessage}
              disabled={isLoading}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;