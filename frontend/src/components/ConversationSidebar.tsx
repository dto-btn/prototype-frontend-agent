import { useState, useEffect } from 'react';
import { ConversationService } from '../services/conversationService';
import type { Conversation } from '../services/conversationService';

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

  // Load conversations on component mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setIsLoading(true);
    
    try {
      const result = await new Promise<Conversation[]>((resolve, reject) => {
        ConversationService.getAllConversations().subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err)
        });
      });
      
      // Sort conversations by updated_at in descending order (newest first)
      const sorted = [...result].sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      setConversations(sorted);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // Prevent triggering conversation selection
    
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      try {
        await new Promise<void>((resolve, reject) => {
          ConversationService.deleteConversation(id).subscribe({
            next: () => resolve(),
            error: (err) => reject(err)
          });
        });
        
        // Refresh the list
        loadConversations();
        
        // If the deleted conversation was active, trigger new conversation
        if (activeConversationId === id) {
          onNewConversation();
        }
      } catch (error) {
        console.error(`Error deleting conversation ${id}:`, error);
      }
    }
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
            onClick={loadConversations}
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