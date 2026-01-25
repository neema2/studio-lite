import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { didOpen, didChange, executeCode, executeSql, checkHealth, type Diagnostic } from './lspClient';
import './App.css';

const DOCUMENT_URI = 'file:///query.pure';

// Pure model DEFINITIONS ONLY - no query at the end
const DEFAULT_MODEL = `// ============================================
// Legend Studio Lite - Pure Model Definitions
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
Database PersonDatabase
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
}

// ========== Runtime ==========
Runtime test::TestRuntime
{
    mappings: [ model::PersonMapping ];
    connections: [ PersonDatabase: store::TestConnection ];
}
`;

// Pre-populated Pure queries
const DEFAULT_PURE_QUERIES = [
  {
    name: 'Select All Persons',
    query: `Person.all()
  ->project({p | $p.firstName}, {p | $p.lastName}, {p | $p.age})`
  },
  {
    name: 'Filter by Age > 25',
    query: `Person.all()
  ->filter(p | $p.age > 25)
  ->project({p | $p.firstName}, {p | $p.age})`
  },
  {
    name: 'Select All Addresses',
    query: `Address.all()
  ->project({a | $a.street}, {a | $a.city})`
  }
];

// Pre-populated SQL statements for testing
const DEFAULT_SQL_STATEMENTS = [
  {
    name: '1. Create Table',
    sql: `CREATE TABLE T_PERSON (
    ID INTEGER PRIMARY KEY,
    FIRST_NAME VARCHAR(100),
    LAST_NAME VARCHAR(100),
    AGE_VAL INTEGER
)`
  },
  {
    name: '2. Insert Data',
    sql: `INSERT INTO T_PERSON VALUES (1, 'John', 'Smith', 30);
INSERT INTO T_PERSON VALUES (2, 'Jane', 'Doe', 25);
INSERT INTO T_PERSON VALUES (3, 'Bob', 'Wilson', 45);`
  },
  {
    name: '3. Select All',
    sql: `SELECT * FROM T_PERSON`
  },
  {
    name: '4. Select with Filter',
    sql: `SELECT FIRST_NAME, LAST_NAME, AGE_VAL 
FROM T_PERSON 
WHERE AGE_VAL > 25`
  },
  {
    name: '5. Drop Table',
    sql: `DROP TABLE IF EXISTS T_PERSON`
  }
];

interface QueryResult {
  success: boolean;
  data?: string;
  columns?: string[];
  rowCount?: number;
  message?: string;
  error?: string;
}

type QueryMode = 'pure' | 'sql';

function App() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [pureQuery, setPureQuery] = useState(DEFAULT_PURE_QUERIES[0].query);
  const [sql, setSql] = useState(DEFAULT_SQL_STATEMENTS[0].sql);
  const [queryMode, setQueryMode] = useState<QueryMode>('sql');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [modelStatus, setModelStatus] = useState<'idle' | 'valid' | 'error'>('idle');
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
      didOpen(DOCUMENT_URI, model).then(diags => {
        setDiagnostics(diags);
        setModelStatus(diags.length === 0 ? 'valid' : 'error');
      }).catch(console.error);
    }
  }, [isConnected]);

  // Apply diagnostics to editor
  useEffect(() => {
    if (!editorRef.current) return;

    const monacoModel = editorRef.current.getModel();
    if (!monacoModel) return;

    const markers: monaco.editor.IMarkerData[] = diagnostics.map(d => ({
      severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: d.message,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
    }));

    monaco.editor.setModelMarkers(monacoModel, 'pure', markers);
  }, [diagnostics]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const handleModelChange = useCallback((value: string | undefined) => {
    const newModel = value || '';
    setModel(newModel);
    setModelStatus('idle');

    // Debounce LSP updates
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      if (isConnected) {
        versionRef.current++;
        didChange(DOCUMENT_URI, newModel, versionRef.current)
          .then(diags => {
            setDiagnostics(diags);
            setModelStatus(diags.length === 0 ? 'valid' : 'error');
          })
          .catch(console.error);
      }
    }, 300);
  }, [isConnected]);

  const handleRunPure = useCallback(async () => {
    setIsRunning(true);
    setResult(null);

    try {
      // Combine model + query for execution
      const fullCode = model + '\n\n' + pureQuery;
      const response = await executeCode(fullCode);
      setResult(response as QueryResult);
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : 'Network error'
      });
    } finally {
      setIsRunning(false);
    }
  }, [model, pureQuery]);

  const handleRunSql = useCallback(async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const response = await executeSql(model, sql, 'test::TestRuntime');
      setResult(response as QueryResult);
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : 'Network error'
      });
    } finally {
      setIsRunning(false);
    }
  }, [model, sql]);

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
            <span>Pure Model Definitions</span>
            <div className="model-status">
              {modelStatus === 'valid' && <span className="status-valid">✓ Valid</span>}
              {modelStatus === 'error' && <span className="status-error">✗ {diagnostics.length} errors</span>}
              {modelStatus === 'idle' && <span className="status-idle">...</span>}
            </div>
          </div>
          <Editor
            height="100%"
            defaultLanguage="typescript"
            theme="vs-dark"
            value={model}
            onChange={handleModelChange}
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

        <div className="right-panel">
          {/* Query Mode Tabs */}
          <div className="query-tabs">
            <button
              className={`query-tab ${queryMode === 'pure' ? 'active pure' : ''}`}
              onClick={() => setQueryMode('pure')}
            >
              Pure Query
            </button>
            <button
              className={`query-tab ${queryMode === 'sql' ? 'active sql' : ''}`}
              onClick={() => setQueryMode('sql')}
            >
              Raw SQL
            </button>
          </div>

          {/* Pure Query Panel */}
          {queryMode === 'pure' && (
            <div className="query-panel pure">
              <div className="panel-header">
                <select
                  className="query-preset-select"
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    if (idx >= 0) setPureQuery(DEFAULT_PURE_QUERIES[idx].query);
                  }}
                >
                  {DEFAULT_PURE_QUERIES.map((q, i) => (
                    <option key={i} value={i}>{q.name}</option>
                  ))}
                </select>
                <button
                  className="run-button pure"
                  onClick={handleRunPure}
                  disabled={isRunning || !isConnected}
                >
                  {isRunning ? 'Running...' : '▶ Execute Pure'}
                </button>
              </div>
              <textarea
                className="query-input"
                value={pureQuery}
                onChange={(e) => setPureQuery(e.target.value)}
                placeholder="Enter Pure query expression..."
              />
            </div>
          )}

          {/* SQL Query Panel */}
          {queryMode === 'sql' && (
            <div className="query-panel sql">
              <div className="panel-header">
                <select
                  className="query-preset-select"
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    if (idx >= 0) setSql(DEFAULT_SQL_STATEMENTS[idx].sql);
                  }}
                >
                  {DEFAULT_SQL_STATEMENTS.map((stmt, i) => (
                    <option key={i} value={i}>{stmt.name}</option>
                  ))}
                </select>
                <button
                  className="run-button sql"
                  onClick={handleRunSql}
                  disabled={isRunning || !isConnected}
                >
                  {isRunning ? 'Running...' : '▶ Execute SQL'}
                </button>
              </div>
              <textarea
                className="query-input"
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder="Enter SQL query..."
              />
            </div>
          )}

          {/* Results Panel */}
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
              {result?.success && result.message && (
                <div className="success-message">
                  ✓ {result.message}
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
                  {queryMode === 'pure'
                    ? 'Select a Pure query and click "Execute Pure"'
                    : 'Select a SQL statement and click "Execute SQL"'}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
