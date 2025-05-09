import { type Message } from '../hooks/useChat';
import { conversationStore } from './conversationStore';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface ConversationUpdate {
  title?: string;
  messages: Message[];
}

const API_URL = 'http://localhost:5000/api';

export class ConversationService {
  /**
   * Get all conversations
   */
  static async getAllConversations(): Promise<Conversation[]> {
    try {
      const response = await fetch(`${API_URL}/conversations`);
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }
  }

  /**
   * Get a specific conversation by ID
   */
  static async getConversation(id: string): Promise<Conversation> {
    try {
      const response = await fetch(`${API_URL}/conversations/${id}`);
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Error fetching conversation ${id}:`, error);
      throw error;
    }
  }

  /**
   * Create a new conversation
   */
  static async createConversation(title: string, initialMessages: Message[] = []): Promise<Conversation> {
    try {
      const response = await fetch(`${API_URL}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          messages: initialMessages,
        }),
      });
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      const conversation = await response.json();
      conversationStore.updateConversation(conversation);
      return conversation;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * Update an existing conversation or create if it doesn't exist
   */
  static async updateConversation(id: string, update: ConversationUpdate): Promise<Conversation> {
    try {
      const response = await fetch(`${API_URL}/conversations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      const conversation = await response.json();
      conversationStore.updateConversation(conversation);
      return conversation;
    } catch (error) {
      console.error(`Error updating conversation ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a conversation
   */
  static async deleteConversation(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${API_URL}/conversations/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      conversationStore.removeConversation(id);
      return result;
    } catch (error) {
      console.error(`Error deleting conversation ${id}:`, error);
      throw error;
    }
  }
}