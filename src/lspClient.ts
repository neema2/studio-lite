/**
 * LSP HTTP Client for Legend-Lite backend.
 * 
 * Communicates with the LspHttpAdapter endpoints:
 * - POST /lsp - LSP JSON-RPC messages
 * - POST /lsp/execute - Execute Pure code
 */

const LSP_BASE_URL = 'http://localhost:8081';

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  source: string;
  message: string;
}

export interface ExecuteResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ParsedExecuteResult {
  sql: string;
  plan: string;
}

/**
 * Send an LSP JSON-RPC message and get the response.
 */
export async function sendLspMessage(message: object): Promise<object | null> {
  const response = await fetch(`${LSP_BASE_URL}/lsp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  
  if (response.status === 204) {
    return null; // Notification, no response
  }
  
  return response.json();
}

/**
 * Initialize LSP connection.
 */
export async function initializeLsp(): Promise<object> {
  const response = await sendLspMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      processId: null,
      rootUri: null,
      capabilities: {},
    },
  });
  
  // Send initialized notification
  await sendLspMessage({
    jsonrpc: '2.0',
    method: 'initialized',
    params: {},
  });
  
  return response || {};
}

/**
 * Notify server of document open.
 */
export async function didOpen(uri: string, text: string): Promise<Diagnostic[]> {
  const response = await sendLspMessage({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri,
        languageId: 'pure',
        version: 1,
        text,
      },
    },
  });
  
  return parseDiagnostics(response);
}

/**
 * Notify server of document change.
 */
export async function didChange(uri: string, text: string, version: number): Promise<Diagnostic[]> {
  const response = await sendLspMessage({
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    },
  });
  
  return parseDiagnostics(response);
}

/**
 * Execute Pure code.
 */
export async function executeCode(code: string): Promise<ExecuteResult> {
  const response = await fetch(`${LSP_BASE_URL}/lsp/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  
  return response.json();
}

/**
 * Parse diagnostics from LSP response.
 */
function parseDiagnostics(response: object | null): Diagnostic[] {
  if (!response) return [];
  
  const resp = response as { params?: { diagnostics?: Diagnostic[] } };
  return resp.params?.diagnostics || [];
}

/**
 * Check if backend is healthy.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${LSP_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
