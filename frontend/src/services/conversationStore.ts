import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConversationService, type Conversation } from './conversationService';

// Singleton service to manage conversation state
class ConversationStore {
  private conversations$ = new BehaviorSubject<Conversation[]>([]);
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private initialized = false;

  // Get all conversations as an observable
  get conversations(): Observable<Conversation[]> {
    // Load conversations if not already loaded
    if (!this.initialized) {
      this.loadConversations();
    }
    return this.conversations$.asObservable().pipe(
      map(conversations => 
        // Sort conversations by updated_at in descending order (newest first)
        [...conversations].sort((a, b) => 
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      )
    );
  }

  // Get loading state as an observable
  get isLoading(): Observable<boolean> {
    return this.isLoading$.asObservable();
  }

  // Load all conversations
  async loadConversations(): Promise<void> {
    this.isLoading$.next(true);
    
    try {
      const conversations = await firstValueFrom(ConversationService.getAllConversations());
      console.log('Loaded conversations from server:', conversations.length);
      this.conversations$.next(conversations);
      this.initialized = true;
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      this.isLoading$.next(false);
    }
  }

  // Add or update a conversation in the store
  updateConversation(conversation: Conversation): void {
    const currentConversations = this.conversations$.getValue();
    const index = currentConversations.findIndex(c => c.id === conversation.id);
    
    if (index >= 0) {
      // Update existing conversation
      console.log(`Updating existing conversation in store: ${conversation.id}, title: "${conversation.title}"`);
      const updatedConversations = [...currentConversations];
      updatedConversations[index] = conversation;
      this.conversations$.next(updatedConversations);
    } else {
      // Add new conversation
      console.log(`Adding new conversation to store: ${conversation.id}, title: "${conversation.title}"`);
      this.conversations$.next([...currentConversations, conversation]);
    }
  }

  // Remove a conversation from the store
  removeConversation(id: string): void {
    const currentConversations = this.conversations$.getValue();
    const updatedConversations = currentConversations.filter(c => c.id !== id);
    this.conversations$.next(updatedConversations);
  }
}

// Export as a singleton
export const conversationStore = new ConversationStore();