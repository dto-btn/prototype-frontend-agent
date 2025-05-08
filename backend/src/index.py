import os
import json
import logging
from typing import Dict, List, Optional, Any, Union
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI
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

# Configure Azure OpenAI client
def get_azure_openai_client():
    """
    Initialize and return an Azure OpenAI client using Azure AD authentication
    Following Azure best practices for secure authentication
    """
    try:
        token_provider = get_bearer_token_provider(
            DefaultAzureCredential(),
            "https://cognitiveservices.azure.com/.default"
        )
        
        azure_openai_uri = os.getenv("AZURE_OPENAI_ENDPOINT")
        api_version = os.getenv("AZURE_OPENAI_VERSION", "2024-05-01-preview")
        print(f"MONARCH: Using Azure OpenAI URI: {azure_openai_uri}")
        print(f"MONARCH: Using Azure OpenAI API version: {api_version}")
        
        if not azure_openai_uri:
            logger.error("AZURE_OPENAI_ENDPOINT environment variable is not set")
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is not set")
        
        client = AzureOpenAI(
            api_version=api_version,
            azure_endpoint=azure_openai_uri,
            azure_ad_token_provider=token_provider
        )
        
        logger.info("Successfully initialized Azure OpenAI client")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize Azure OpenAI client: {str(e)}")
        raise

# Application lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize OpenAI client on startup
    try:
        app.state.openai_client = get_azure_openai_client()
    except Exception as e:
        logger.error(f"Failed to initialize Azure OpenAI client: {str(e)}")
        app.state.openai_client = None
    yield
    # Clean up on shutdown
    app.state.openai_client = None

# Initialize FastAPI app
app = FastAPI(
    title="Azure OpenAI Proxy API",
    description="A proxy API for Azure OpenAI services",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get OpenAI client
async def get_openai_client(request: Request) -> AzureOpenAI:
    if not request.app.state.openai_client:
        logger.error("OpenAI client not initialized")
        raise HTTPException(status_code=500, detail="OpenAI client not initialized")
    return request.app.state.openai_client

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
async def chat(request: ChatRequest, openai_client: AzureOpenAI = Depends(get_openai_client)):
    try:
        model = request.model or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
        print(f"MONARCH: Using model: {model}")
        if not model:
            raise HTTPException(
                status_code=400, 
                detail="Model is required. Either specify it in the request or set AZURE_OPENAI_DEPLOYMENT_NAME environment variable"
            )
            
        completion = openai_client.chat.completions.create(
            model=model,
            messages=request.messages,
            max_tokens=request.max_tokens,
        )
        
        # Convert the response to a dictionary
        return completion.model_dump()
    
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