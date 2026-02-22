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
 * NLQ result from /engine/nlq.
 */
export interface NlqResult {
  success: boolean;
  rootClass?: string;
  pureQuery?: string;
  explanation?: string;
  queryPlan?: string;
  retrievedClasses?: string[];
  latencyMs?: number;
  error?: string;
}

/**
 * Ask AI — Natural Language Query to Pure.
 * Sends the model code and a natural language question to the NLQ pipeline.
 */
export async function askAi(
  code: string,
  question: string,
  domain?: string
): Promise<NlqResult> {
  const response = await fetch(`${BASE_URL}/engine/nlq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, question, domain: domain || undefined }),
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
 * Diagram data from /engine/diagram.
 */
export interface DiagramClass {
  id: string;
  name: string;
  package: string;
  stereotype: string;
  description: string;
  businessDomain: string;
  properties: { name: string; type: string; multiplicity: string }[];
}

export interface DiagramAssociation {
  name: string;
  source: string;
  target: string;
  sourceProperty: string;
  targetProperty: string;
  sourceMult: string;
  targetMult: string;
}

export interface DiagramGeneralisation {
  child: string;
  parent: string;
}

export interface DiagramData {
  classes: DiagramClass[];
  associations: DiagramAssociation[];
  generalisations: DiagramGeneralisation[];
}

/**
 * Fetch diagram data — classes + associations from Pure source.
 */
export async function fetchDiagram(code: string): Promise<DiagramData> {
  const response = await fetch(`${BASE_URL}/engine/diagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return response.json();
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
