import os
import json
import logging
import requests
import time
from typing import Dict, List, Optional, Any, Union
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.responses import JSONResponse
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

class ErrorResponse(BaseModel):
    error: str
    message: Optional[str] = None

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
            "max_tokens": request.max_tokens
        }
        
        # Make the direct API call with retry logic
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