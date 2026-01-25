import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { didOpen, didChange, executeCode, checkHealth, type Diagnostic } from './lspClient';
import './App.css';

const DOCUMENT_URI = 'file:///query.pure';

// Complete Pure example with model, mapping, store, connection, runtime, and query
const DEFAULT_CODE = `// ============================================
// Legend Studio Lite - Complete Pure Example
// ============================================

// ========== Model ==========
Class Person
{
    firstName: String[1];
    lastName: String[1];
    age: Integer[1];
}

Class Address
{
    street: String[1];
    city: String[1];
}

Association Person_Address
{
    person: Person[1];
    addresses: Address[*];
}

// ========== Store (Database) ==========
Database store::PersonDatabase
(
    Table T_PERSON
    (
        ID INTEGER PRIMARY KEY,
        FIRST_NAME VARCHAR(100) NOT NULL,
        LAST_NAME VARCHAR(100) NOT NULL,
        AGE_VAL INTEGER NOT NULL
    )
    Table T_ADDRESS
    (
        ID INTEGER PRIMARY KEY,
        PERSON_ID INTEGER NOT NULL,
        STREET VARCHAR(200) NOT NULL,
        CITY VARCHAR(100) NOT NULL
    )
    Join Person_Address(T_PERSON.ID = T_ADDRESS.PERSON_ID)
)

// ========== Mapping ==========
Mapping model::PersonMapping
(
    Person: Relational
    {
        ~mainTable [PersonDatabase] T_PERSON
        firstName: [PersonDatabase] T_PERSON.FIRST_NAME,
        lastName: [PersonDatabase] T_PERSON.LAST_NAME,
        age: [PersonDatabase] T_PERSON.AGE_VAL
    }

    Address: Relational
    {
        ~mainTable [PersonDatabase] T_ADDRESS
        street: [PersonDatabase] T_ADDRESS.STREET,
        city: [PersonDatabase] T_ADDRESS.CITY
    }
)

// ========== Connection ==========
RelationalDatabaseConnection store::TestConnection
{
    type: DuckDB;
    specification: InMemory { };
    auth: NoAuth { };
}

// ========== Runtime ==========
Runtime test::TestRuntime
{
    mappings: [ model::PersonMapping ];
    connections: [ store::PersonDatabase: store::TestConnection ];
}

// ========== Query (edit this!) ==========
// Try these queries:
//   Person.all()->project({p | $p.firstName}, {p | $p.lastName})
//   Person.all()->filter(p | $p.age > 25)->project({p | $p.firstName}, {p | $p.age})
//   Address.all()->project({a | $a.street}, {a | $a.city})

Person.all()
  ->project({p | $p.firstName}, {p | $p.lastName}, {p | $p.age})
`;

interface QueryResult {
  success: boolean;
  data?: string;
  columns?: string[];
  rowCount?: number;
  error?: string;
}

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const versionRef = useRef(1);
  const debounceRef = useRef<number | null>(null);

  // Check backend connection on mount
  useEffect(() => {
    checkHealth().then(setIsConnected);
  }, []);

  // Send didOpen on mount
  useEffect(() => {
    if (isConnected) {
      didOpen(DOCUMENT_URI, code).then(setDiagnostics).catch(console.error);
    }
  }, [isConnected]);

  // Apply diagnostics to editor
  useEffect(() => {
    if (!editorRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    const markers: monaco.editor.IMarkerData[] = diagnostics.map(d => ({
      severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: d.message,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
    }));

    monaco.editor.setModelMarkers(model, 'pure', markers);
  }, [diagnostics]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const handleCodeChange = useCallback((value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);

    // Debounce LSP updates
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      if (isConnected) {
        versionRef.current++;
        didChange(DOCUMENT_URI, newCode, versionRef.current)
          .then(setDiagnostics)
          .catch(console.error);
      }
    }, 300);
  }, [isConnected]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const response = await executeCode(code);
      setResult(response as QueryResult);
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : 'Network error'
      });
    } finally {
      setIsRunning(false);
    }
  }, [code]);

  // Parse JSON data for table display
  const parseData = (data: string): object[] => {
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Legend Studio Lite</h1>
        <div className="status">
          <span className={`indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <main className="main">
        <div className="editor-panel">
          <div className="panel-header">
            <span>Pure Model & Query</span>
            <button
              className="run-button"
              onClick={handleRun}
              disabled={isRunning || !isConnected}
            >
              {isRunning ? 'Running...' : '▶ Run'}
            </button>
          </div>
          <Editor
            height="100%"
            defaultLanguage="typescript"
            theme="vs-dark"
            value={code}
            onChange={handleCodeChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              wordWrap: 'on',
            }}
          />
        </div>

        <div className="results-panel">
          <div className="panel-header">
            <span>Results</span>
            {result?.success && result.rowCount !== undefined && (
              <span className="row-count">{result.rowCount} rows</span>
            )}
          </div>
          <div className="results-content">
            {result?.success === false && (
              <div className="error">
                <strong>Error:</strong> {result.error}
              </div>
            )}
            {result?.success && result.data && result.columns && (
              <div className="table-container">
                <table className="result-table">
                  <thead>
                    <tr>
                      {result.columns.map((col, i) => (
                        <th key={i}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseData(result.data).map((row: object, i) => (
                      <tr key={i}>
                        {result.columns!.map((col, j) => (
                          <td key={j}>{String((row as Record<string, unknown>)[col] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!result && (
              <div className="placeholder">
                Click "Run" to execute your query
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
