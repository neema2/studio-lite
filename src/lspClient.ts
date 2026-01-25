/**
 * Legend-Lite HTTP Client.
 * 
 * Communicates with the LegendHttpServer endpoints:
 * - POST /lsp - LSP JSON-RPC messages
 * - POST /engine/execute - Execute Pure code queries
 * - POST /engine/sql - Execute raw SQL queries
 */

const BASE_URL = 'http://localhost:8080';

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
  data?: string;
  columns?: string[];
  rowCount?: number;
  error?: string;
}

/**
 * Send an LSP JSON-RPC message and get the response.
 */
export async function sendLspMessage(message: object): Promise<object | null> {
  const response = await fetch(`${BASE_URL}/lsp`, {
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
 * Execute Pure code query via /engine/execute.
 */
export async function executeCode(code: string): Promise<ExecuteResult> {
  const response = await fetch(`${BASE_URL}/engine/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  return response.json();
}

/**
 * Execute raw SQL via /engine/sql.
 * Requires the Pure model code, SQL query, and runtime name.
 */
export async function executeSql(
  code: string,
  sql: string,
  runtime: string
): Promise<ExecuteResult> {
  const response = await fetch(`${BASE_URL}/engine/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, sql, runtime }),
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
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
