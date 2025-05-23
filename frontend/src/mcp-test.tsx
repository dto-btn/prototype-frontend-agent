import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export const connectClient = async (url: string) => {
    let client: Client|undefined = undefined
    const baseUrl = new URL(url);
    try {
      client = new Client({
        name: 'streamable-http-client',
        version: '1.0.0'
      });
      const transport = new StreamableHTTPClientTransport(
        new URL(baseUrl)
      );
      await client.connect(transport);
      console.log("Connected using Streamable HTTP transport");
    } catch (error) {
      // If that fails with a 4xx error, try the older SSE transport
      console.log("Streamable HTTP connection failed, falling back to SSE transport");
      client = new Client({
        name: 'sse-client',
        version: '1.0.0'
      });
      const sseTransport = new SSEClientTransport(baseUrl);
      await client.connect(sseTransport);
      console.log("Connected using SSE transport");
    }
    return client;
}