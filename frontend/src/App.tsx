import { useState, useEffect } from 'react';
import { useChatWithHistory } from './hooks/useChatWithHistory';
import { ConversationSidebar } from './components/ConversationSidebar';
import { BehaviorSubject } from 'rxjs';

// Default welcome message for new conversations
const defaultInitialMessages = [
  {
    role: 'assistant' as const,
    content: 'Hello! I\'m your AI assistant. How can I help you today?'
  }
];

// Tracks if a conversation has been automatically saved yet
const isFirstMessageSent = new BehaviorSubject<boolean>(false);

function App() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  
  const {
    messages,
    input,
    setInput,
    isLoading,
    currentStreamingMessage,
    handleSendMessage,
    handleCancelStream,
    saveConversation,
    isSaving,
    setConversationId,
    conversationId
  } = useChatWithHistory({ 
    initialMessages: defaultInitialMessages,
    // Only pass the ID if it's not null
    ...(activeConversationId ? { conversationId: activeConversationId } : {})
  });

  // Effect to sync the conversation ID to state
  useEffect(() => {
    setActiveConversationId(conversationId);
  }, [conversationId]);

  // Handle creating a new conversation
  const handleNewConversation = () => {
    setConversationId(null);
    isFirstMessageSent.next(false);
  };

  // Handle selecting a conversation from the sidebar
  const handleSelectConversation = (id: string) => {
    setConversationId(id);
    isFirstMessageSent.next(true);
  };

  // Modified to avoid duplicate save operations
  const handleSendWithSave = async () => {
    // If this is the first message and there's no conversation ID yet,
    // we don't need to manually call saveConversation because
    // addAssistantMessage will automatically create a conversation
    await handleSendMessage();
    
    // Mark as sent so we don't try to save again if user sends another message
    if (!isFirstMessageSent.getValue()) {
      isFirstMessageSent.next(true);
    }
  };

  return (
    <div className="flex h-screen bg-base-200">
      {/* Sidebar */}
      <ConversationSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
      />
      
      {/* Main chat area */}
      <div className="flex flex-col flex-grow h-full max-w-3xl mx-auto">
        {/* Header */}
        <div className="navbar bg-primary text-primary-content">
          <div className="flex-1">
            <div className="flex items-center">
              <a className="btn btn-ghost normal-case text-xl">AI Chat Assistant</a>
              {isSaving && (
                <span className="badge badge-sm badge-accent">Saving...</span>
              )}
            </div>
          </div>
          <div className="flex-none">
            {conversationId && (
              <button 
                className="btn btn-sm btn-ghost"
                onClick={handleNewConversation}
              >
                New Chat
              </button>
            )}
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
                  handleSendWithSave();
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
                onClick={handleSendWithSave}
                disabled={isLoading || !input.trim()}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;