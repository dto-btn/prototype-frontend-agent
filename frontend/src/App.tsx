import { useChatWithHistory } from './hooks/useChatWithHistory';

function App() {
  const initialMessages = [
    {
      role: 'assistant' as const,
      content: 'Hello! I\'m your AI assistant. How can I help you today?'
    },
    {
      role: 'user' as const,
      content: 'Can you explain how machine learning works?'
    },
    {
      role: 'assistant' as const,
      content: 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It works by identifying patterns in data and making predictions or decisions based on those patterns. The basic process involves training a model on a dataset, validating its performance, and then using it to make predictions on new data.'
    }
  ];

  const {
    messages,
    input,
    setInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream
  } = useChatWithHistory({ initialMessages });

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