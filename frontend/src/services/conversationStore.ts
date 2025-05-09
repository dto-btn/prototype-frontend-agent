import { ConversationService, type Conversation } from './conversationService';

// Singleton service to manage conversation state
class ConversationStore {
  private conversations: Conversation[] = [];
  private isLoading = false;
  private initialized = false;
  private listeners: (() => void)[] = [];

  // Subscribe to store changes
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  // Get all conversations (sorted)
  getConversations(): Conversation[] {
    return [...this.conversations].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  // Get loading state
  getIsLoading(): boolean {
    return this.isLoading;
  }

  // Load all conversations
  async loadConversations(): Promise<void> {
    this.isLoading = true;
    this.notify();
    try {
      const conversations = await ConversationService.getAllConversations();
      console.log('Loaded conversations from server:', conversations.length);
      this.conversations = conversations;
      this.initialized = true;
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  // Add or update a conversation in the store
  updateConversation(conversation: Conversation): void {
    const index = this.conversations.findIndex(c => c.id === conversation.id);
    if (index >= 0) {
      console.log(`Updating existing conversation in store: ${conversation.id}, title: "${conversation.title}"`);
      this.conversations[index] = conversation;
    } else {
      console.log(`Adding new conversation to store: ${conversation.id}, title: "${conversation.title}"`);
      this.conversations.push(conversation);
    }
    this.notify();
  }

  // Remove a conversation from the store
  removeConversation(id: string): void {
    this.conversations = this.conversations.filter(c => c.id !== id);
    this.notify();
  }
}

export const conversationStore = new ConversationStore();