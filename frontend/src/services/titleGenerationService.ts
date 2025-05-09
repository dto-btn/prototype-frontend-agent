import OpenAI from 'openai';

// OpenAI client instance
const openai = new OpenAI({
  baseURL: 'http://localhost:5000/api', // Use our backend proxy
  apiKey: 'dummy-key', // Not used with our proxy, but required by the client
  dangerouslyAllowBrowser: true,
});

/**
 * Generate a concise, descriptive title for a conversation based on the first exchange
 * 
 * @param userMessage The first message from the user
 * @param assistantResponse The first response from the assistant
 * @returns A generated title for the conversation
 */
export async function generateTitle(content: string): Promise<string> {
    console.log('Generating title for conversation:', content);
  try {
    // Create a prompt instructing the model to generate a short, descriptive title
    const prompt = `Generate a short, descriptive title (5-7 words maximum) for a conversation that starts with:
    
    ${ content }

The title should capture the main topic or question. Return only the title without quotes or additional text.`;

    // Call the OpenAI API
    const response = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates concise, descriptive titles.' },
        { role: 'user', content: prompt }
      ],
      model: 'gpt-4o', // Use the available model in our backend
      max_tokens: 30, // Keep response short
    });

    // Extract the title from the response
    const title = response.choices[0]?.message?.content?.trim() || '';
    
    // Ensure the title isn't too long
    if (title.length > 50) {
      return title.substring(0, 47) + '...';
    }

    console.log('Generated title:', title);
    
    return title || 'New Conversation'; // Fallback if empty
  } catch (error) {
    console.error('Error generating title with AI:', error);
    
    // Fallback to a simple title extraction
    const simpleTitle = extractSimpleTitle(content);
    return simpleTitle;
  }
}

/**
 * Fallback method to extract a simple title from a message
 */
function extractSimpleTitle(content: string): string {
  // Use the first ~30 characters of message as title
  const truncated = content.substring(0, 30).trim();
  return truncated.length > 0 
    ? `${truncated}${truncated.length >= 30 ? '...' : ''}`
    : 'New Conversation';
}