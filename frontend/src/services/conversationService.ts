import { type Message } from '../hooks/useChat';
import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
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
  static getAllConversations(): Observable<Conversation[]> {
    return from(
      fetch(`${API_URL}/conversations`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
    ).pipe(
      catchError(error => {
        console.error('Error fetching conversations:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Get a specific conversation by ID
   */
  static getConversation(id: string): Observable<Conversation> {
    return from(
      fetch(`${API_URL}/conversations/${id}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
    ).pipe(
      catchError(error => {
        console.error(`Error fetching conversation ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Create a new conversation
   */
  static createConversation(title: string, initialMessages: Message[] = []): Observable<Conversation> {
    return from(
      fetch(`${API_URL}/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          messages: initialMessages,
        }),
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
    ).pipe(
      tap(conversation => {
        // Update the store with the new conversation
        conversationStore.updateConversation(conversation);
      }),
      catchError(error => {
        console.error('Error creating conversation:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Update an existing conversation or create if it doesn't exist
   */
  static updateConversation(id: string, update: ConversationUpdate): Observable<Conversation> {
    return from(
      fetch(`${API_URL}/conversations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update),
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
    ).pipe(
      tap(conversation => {
        // Update the store with the updated conversation
        conversationStore.updateConversation(conversation);
      }),
      catchError(error => {
        console.error(`Error updating conversation ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Delete a conversation
   */
  static deleteConversation(id: string): Observable<{ success: boolean; message: string }> {
    return from(
      fetch(`${API_URL}/conversations/${id}`, {
        method: 'DELETE',
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
    ).pipe(
      tap(() => {
        // Remove the conversation from the store
        conversationStore.removeConversation(id);
      }),
      catchError(error => {
        console.error(`Error deleting conversation ${id}:`, error);
        return throwError(() => error);
      })
    );
  }
}