import os
import json
import logging
import requests
import time
import asyncio
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Union, AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, status, Body
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define data models
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    model: Optional[str] = None
    max_tokens: Optional[int] = 500
    stream: Optional[bool] = False

class Conversation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    messages: List[Message]
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    messages: List[Message]

class ErrorResponse(BaseModel):
    error: str
    message: Optional[str] = None

# In-memory store for conversations (in a production app, use a database)
conversations_db = {}

# Initialize FastAPI app
app = FastAPI(
    title="Azure OpenAI Proxy API",
    description="A proxy API for Azure OpenAI services",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Error handler
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "Internal server error", "message": str(exc)},
    )

# Helper function to stream the response content
async def stream_response(response) -> AsyncGenerator[bytes, None]:
    """
    Properly streams response content from a requests Response object.
    
    This function converts a synchronous response stream to an asynchronous one
    by using asyncio.to_thread to avoid blocking the event loop.
    """
    # Process the response stream in chunks
    for chunk in response.iter_content(chunk_size=1024):
        if chunk:
            yield chunk
        # Give control back to the event loop
        await asyncio.sleep(0)

# Proxy endpoint for OpenAI chat completions
@app.post("/api/chat/completions", response_model=Dict[str, Any])
async def chat(request: ChatRequest):
    try:
        model = request.model or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
        print(f"MONARCH: Using model: {model}")
        if not model:
            raise HTTPException(
                status_code=400, 
                detail="Model is required. Either specify it in the request or set AZURE_OPENAI_DEPLOYMENT_NAME environment variable"
            )
        
        # Construct the API URL
        api_url = f"{os.getenv('AZURE_OPENAI_ENDPOINT')}/openai/deployments/{model}/chat/completions?api-version={os.getenv('AZURE_OPENAI_VERSION', '2024-05-01-preview')}"
        
        # Get the token using the existing token provider
        token = get_bearer_token_provider(
            DefaultAzureCredential(),
            "https://cognitiveservices.azure.com/.default"
        )()
        
        # Prepare headers with authentication
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        }
        
        # Prepare the request payload
        payload = {
            "messages": request.messages,
            "max_tokens": request.max_tokens,
            "stream": request.stream
        }
        
        # If streaming is requested, return a streaming response
        if request.stream:
            # Make the direct API call with streaming enabled
            response = requests.post(
                api_url,
                headers=headers,
                json=payload,
                stream=True,
                timeout=30  # Set an appropriate timeout
            )
            
            response.raise_for_status()  # Raise an exception for 4XX/5XX responses
            
            # Return a streaming response
            return StreamingResponse(
                stream_response(response),
                media_type="text/event-stream"
            )
        
        # For non-streaming requests, use the existing implementation with retry logic
        max_retries = 3
        retry_delay = 1  # seconds
        
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    api_url,
                    headers=headers,
                    json=payload,
                    timeout=30  # Set an appropriate timeout
                )
                
                response.raise_for_status()  # Raise an exception for 4XX/5XX responses
                completion_data = response.json()
                break
            except requests.exceptions.RequestException as e:
                if attempt == max_retries - 1:  # Last attempt
                    logger.exception(f"Error calling Azure OpenAI API after {max_retries} attempts")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Error processing your request: {str(e)}"
                    )
                # Wait before retrying with exponential backoff
                time.sleep(retry_delay * (2 ** attempt))
        
        # Return the response data
        return completion_data
    
    except Exception as e:
        logger.exception("Error calling Azure OpenAI API")
        raise HTTPException(
            status_code=500,
            detail=f"Error processing your request: {str(e)}"
        )

# Health check endpoint
@app.get("/api/health")
async def health():
    return {"status": "OK", "message": "Server is running"}

# Conversation endpoints
@app.get("/api/conversations", response_model=List[Conversation])
async def get_conversations():
    """Get all conversations"""
    return list(conversations_db.values())

@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation by ID"""
    if conversation_id not in conversations_db:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation with ID {conversation_id} not found"
        )
    return conversations_db[conversation_id]

@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(conversation: Conversation):
    """Create a new conversation"""
    # Ensure unique ID and set timestamps
    conversation.id = str(uuid.uuid4())
    conversation.created_at = datetime.now().isoformat()
    conversation.updated_at = datetime.now().isoformat()
    
    # Store the conversation
    conversations_db[conversation.id] = conversation
    return conversation

@app.put("/api/conversations/{conversation_id}", response_model=Conversation)
async def update_conversation(
    conversation_id: str, 
    conversation_update: ConversationUpdate
):
    """Update an existing conversation"""
    if conversation_id not in conversations_db:
        # Create new conversation if it doesn't exist
        new_conversation = Conversation(
            id=conversation_id,
            title=conversation_update.title or "New Conversation",
            messages=conversation_update.messages,
        )
        conversations_db[conversation_id] = new_conversation
        return new_conversation
    
    # Update existing conversation
    current = conversations_db[conversation_id]
    
    # Update title if provided
    if conversation_update.title is not None:
        current.title = conversation_update.title
    
    # Always update messages and updated_at timestamp
    current.messages = conversation_update.messages
    current.updated_at = datetime.now().isoformat()
    
    return current

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation"""
    if conversation_id not in conversations_db:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation with ID {conversation_id} not found"
        )
    
    del conversations_db[conversation_id]
    return {"success": True, "message": f"Conversation {conversation_id} deleted"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 5000))
    
    # Configure server with appropriate worker settings
    uvicorn.run(
        "index:app", 
        host="0.0.0.0", 
        port=port,
        reload=False,
        workers=4,  # Adjust based on your CPU cores
        log_level="info"
    )