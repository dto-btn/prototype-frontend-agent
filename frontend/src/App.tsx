import { useState } from 'react';

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

  const handleSendMessage = async () => {
    if (input.trim() === '' || isLoading) return;
    
    // Add user message
    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    
    try {
      // Prepare messages for API - include all conversation history
      const apiMessages = [
        { role: 'system', content: 'You are a helpful AI assistant.' },
        ...newMessages
      ];
      
      // Call our backend proxy API instead of OpenAI directly
      const response = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages,
          model: 'gpt-4o',
          max_tokens: 500
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to get response from server');
      }
      
      const data = await response.json();
      
      // Get the assistant's response
      const assistantMessage = data.choices[0].message;
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: assistantMessage.content || 'Sorry, I couldn\'t generate a response.'
      }]);
    } catch (error) {
      console.error('Error calling API:', error);
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: 'Sorry, there was an error processing your request. Please try again later.'
      }]);
    } finally {
      setIsLoading(false);
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
          {isLoading && (
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
          <button 
            className={`btn ${isLoading ? 'btn-disabled' : 'btn-primary'}`}
            onClick={handleSendMessage}
            disabled={isLoading}
          >
            {isLoading ? <span className="loading loading-spinner loading-sm"></span> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;