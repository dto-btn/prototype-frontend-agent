import { useState, useEffect } from 'react';
import { ConversationService } from '../services/conversationService';
import type { Conversation } from '../services/conversationService';
import { conversationStore } from '../services/conversationStore';

interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

export function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  // Subscribe to the conversation store for real-time updates
  useEffect(() => {
    // Set initial state
    setConversations(conversationStore.getConversations());
    setIsLoading(conversationStore.getIsLoading());
    // Subscribe to store updates
    const unsubscribe = conversationStore.subscribe(() => {
      setConversations(conversationStore.getConversations());
      setIsLoading(conversationStore.getIsLoading());
    });
    // Initial load if needed
    conversationStore.loadConversations();
    return () => {
      unsubscribe();
    };
  }, []);

  const handleDeleteConversation = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      try {
        await ConversationService.deleteConversation(id);
        // If the deleted conversation was active, trigger new conversation
        if (activeConversationId === id) {
          onNewConversation();
        }
      } catch (error) {
        console.error(`Error deleting conversation ${id}:`, error);
      }
    }
  };

  const refreshConversations = () => {
    conversationStore.loadConversations();
  };

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative">
      {/* Toggle button - always visible */}
      <button 
        className="absolute top-0 -right-12 bg-primary text-primary-content p-2 rounded-r-md z-10" 
        onClick={toggleSidebar}
      >
        {isOpen ? '←' : '→'}
      </button>

      {/* Sidebar container */}
      <div 
        className={`h-full bg-base-300 transition-all duration-300 flex flex-col ${
          isOpen ? 'w-64' : 'w-0 overflow-hidden'
        }`}
      >
        {/* Header with new conversation button */}
        <div className="p-4 bg-base-300 border-b border-base-content/10 flex justify-between items-center">
          <h2 className="font-bold text-lg">Conversations</h2>
          <button 
            className="btn btn-sm btn-primary" 
            onClick={onNewConversation}
          >
            New
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-grow overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center items-center p-4">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-base-content/70">
              No conversations yet
            </div>
          ) : (
            <ul className="menu menu-sm p-2">
              {conversations.map(conversation => (
                <li key={conversation.id} className="mb-1">
                  <a
                    className={`flex justify-between items-center truncate ${
                      activeConversationId === conversation.id ? 'active' : ''
                    }`}
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <span className="truncate flex-grow">{conversation.title}</span>
                    <button
                      className="btn btn-xs btn-ghost btn-circle"
                      onClick={(e) => handleDeleteConversation(conversation.id, e)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer with refresh button */}
        <div className="p-2 border-t border-base-content/10">
          <button 
            className="btn btn-sm btn-outline btn-block"
            onClick={refreshConversations}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                Loading...
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}