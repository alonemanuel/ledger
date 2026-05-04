// Intake tab — paste free text or drop a file (PNG / JPG / PDF / CSV / XLSX),
// the server (Vercel Function /api/intake) extracts structured rows via Claude,
// the browser appends those rows to the live ledger Sheet.
//
// v1: no review step. Rows go straight in. The user can edit the Sheet
// directly if anything looks wrong.

const MAX_FILE_BYTES = 3 * 1024 * 1024;   // 3 MB raw — leaves margin under the 4.5 MB Vercel body limit after base64.
const MAX_TEXT_BYTES = 1 * 1024 * 1024;   // 1 MB of pasted text/CSV — roughly 250k tokens, well past Claude's needs.
const MAX_CSV_ROWS = 500;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('File read failed'));
    fr.onload = () => {
      const result = fr.result || '';
      // result looks like "data:<mediaType>;base64,<...>"
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    fr.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return file.text();
}

async function fileToPayload(file) {
  if (!file) throw new Error('No file');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${(file.size/1024/1024).toFixed(1)} MB). Limit is ${MAX_FILE_BYTES/1024/1024} MB.`);
  }
  const name = (file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const type = file.type || '';

  const fileName = file.name || null;
  if (type.startsWith('image/') || ['png','jpg','jpeg','gif','webp'].includes(ext)) {
    const content = await readFileAsBase64(file);
    return { kind: 'image', mediaType: type || `image/${ext === 'jpg' ? 'jpeg' : ext}`, content, fileName };
  }
  if (type === 'application/pdf' || ext === 'pdf') {
    const content = await readFileAsBase64(file);
    return { kind: 'pdf', content, fileName };
  }
  if (ext === 'xlsx' || type.includes('spreadsheetml')) {
    if (!window.XLSX) throw new Error('XLSX parser not loaded');
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const csv = window.XLSX.utils.sheet_to_csv(ws, { dateNF: 'yyyy-mm-dd' });
    if (csv.split('\n').length > MAX_CSV_ROWS + 1) {
      throw new Error(`XLSX has more than ${MAX_CSV_ROWS} rows; please trim before uploading.`);
    }
    return { kind: 'text', content: csv, fileName };
  }
  // Default: treat as text/CSV.
  const text = await readFileAsText(file);
  if (text.length > MAX_TEXT_BYTES) {
    throw new Error(`File too large after read (${(text.length/1024/1024).toFixed(1)} MB).`);
  }
  if (text.split('\n').length > MAX_CSV_ROWS + 1 && (ext === 'csv' || type === 'text/csv')) {
    throw new Error(`CSV has more than ${MAX_CSV_ROWS} rows; please trim before uploading.`);
  }
  return { kind: 'text', content: text, fileName };
}

async function pasteToPayload(text) {
  if (!text || !text.trim()) throw new Error('Nothing to send');
  if (text.length > MAX_TEXT_BYTES) throw new Error(`Pasted text too large (${(text.length/1024/1024).toFixed(1)} MB).`);
  return { kind: 'text', content: text };
}

async function postIntake(payload) {
  const loader = window.DbLoader || window.SheetsLoader;
  const token = loader?.getCurrentToken?.() || null;
  const sheetId = window.SheetsLoader?.getSheetId?.() || null;
  const schema  = window.SheetsLoader?.getSchemaSnapshot?.() || null;
  const accounts = (window.FinanceData?.ACCOUNTS || []).map(a => ({
    id: a.id, nickname: a.name, type: a.type, currency: a.currency,
  }));
  const categories = window.FinanceData?.CATEGORIES || [];
  const sourceDoc = payload.fileName || (payload.kind === 'text' ? 'user prompt' : payload.kind);
  const res = await fetch('/api/intake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...payload, sheetId, schema, accounts, categories, sourceDoc }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intake API failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// Map API response fields → Google Sheet column names. The Sheet has legacy
// headers (amount_native, currency, amount_ils, fx_rate) while the API now
// returns richer fields (purchase_amount, purchase_currency, charge_amount_ils).
function mapExpenseToSheetRow(row) {
  const pa = parseFloat(row.purchase_amount) || 0;
  const ca = parseFloat(row.charge_amount_ils) || pa;
  const pc = row.purchase_currency || 'ILS';
  const fxRate = (pc !== 'ILS' && pa > 0) ? +(ca / pa).toFixed(4) : 1;
  return {
    date: row.date,
    account_id: row.account_id,
    amount_native: pa,
    currency: pc,
    amount_ils: ca,
    fx_rate: fxRate,
    category: row.category || '',
    subcategory: '',
    merchant: row.merchant || '',
    description: row.description || '',
    source_doc: row.source_doc || '',
    billing_date: row.billing_date || '',
    external_ref_id: row.external_ref_id || '',
    created_at: row.created_at || '',
  };
}

async function applyExtraction(extracted) {
  const counts = { snapshots: 0, income: 0, expenses: 0 };
  const errors = [];
  const expenseRows = (extracted.expenses || []).map(mapExpenseToSheetRow);
  const tabRows = [
    ['snapshots', extracted.snapshots],
    ['income',    extracted.income],
    ['expenses',  expenseRows],
  ];
  for (const [tab, rows] of tabRows) {
    if (!Array.isArray(rows) || !rows.length) continue;
    try {
      const r = await window.SheetsLoader.appendRows(tab, rows);
      counts[tab] = r.appended || 0;
    } catch (e) {
      errors.push(`${tab}: ${e.message || e}`);
    }
  }
  return { counts, errors };
}

function summarizeCounts(counts, rejected) {
  const parts = [];
  if (counts.expenses)  parts.push(`${counts.expenses} expense${counts.expenses === 1 ? '' : 's'}`);
  if (counts.income)    parts.push(`${counts.income} income`);
  if (counts.snapshots) parts.push(`${counts.snapshots} snapshot${counts.snapshots === 1 ? '' : 's'}`);
  const rejCount = Array.isArray(rejected) ? rejected.length : 0;
  if (parts.length) {
    return `Added ${parts.join(', ')}.${rejCount ? ` (${rejCount} skipped — see console.)` : ''}`;
  }
  if (rejCount) {
    return `No rows added — ${rejCount} skipped. ${rejected[0].reason}.`;
  }
  return 'No rows extracted. The model skips entries where the account is ambiguous — try naming the account (e.g. "alon\'s checking") or being more explicit.';
}

function IntakeTab({ onIngested }) {
  const { useState, useRef, useEffect } = React;
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);   // { kind: 'busy'|'ok'|'err', msg }
  const [drop, setDrop] = useState(false);
  const [stubBanner, setStubBanner] = useState(false);
  const [busyStartedAt, setBusyStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const fileInputRef = useRef(null);

  // Tick once a second while busy so the elapsed-time display updates.
  useEffect(() => {
    if (!busyStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [busyStartedAt]);

  const noLoader = !window.DbLoader && !window.SheetsLoader;

  if (noLoader) {
    return (
      <div className="intake">
        <h2 className="intake-h">Intake</h2>
        <div className="intake-disabled">
          Intake is disabled in demo mode. Sign in with Google in the live build to drop receipts and statements here.
        </div>
      </div>
    );
  }

  const submit = async (payload) => {
    const sizeKb = Math.round((payload.content?.length || 0) / 1024);
    setStatus({ kind: 'busy', msg: `Sending ${sizeKb} KB ${payload.kind} to model…` });
    setStubBanner(false);
    setBusyStartedAt(Date.now());
    try {
      const extracted = await postIntake(payload);
      if (extracted.stub) setStubBanner(true);
      const { counts, errors } = await applyExtraction(extracted);
      // Refresh local FinanceData so other tabs reflect the new rows.
      const refreshLoader = window.DbLoader || window.SheetsLoader;
      try { await refreshLoader.fetchAndPopulate(); } catch (_) { /* ignore */ }
      if (extracted.rejected?.length) {
        console.warn('[intake] rejected rows:', extracted.rejected);
      }
      console.log('[intake] response:', {
        model: extracted.model, attempts: extracted.attempts, total_ms: extracted.total_ms,
        finish_reason: extracted.finish_reason, truncated: extracted.truncated, usage: extracted.usage,
        counts, rejected: extracted.rejected?.length || 0,
      });
      let msg = summarizeCounts(counts, extracted.rejected);
      if (extracted.truncated) {
        msg += ` ⚠ Output truncated (finish=${extracted.finish_reason}) — likely missed rows. Try a smaller chunk.`;
      }
      if (errors.length) msg += ` Errors: ${errors.join('; ')}`;
      const meta = extracted.model ? ` · ${extracted.model}, ${Math.round((extracted.total_ms || 0) / 100) / 10}s` : '';
      setStatus({ kind: (errors.length || extracted.truncated) ? 'err' : 'ok', msg: msg + meta });
      if (!errors.length && (counts.expenses || counts.income || counts.snapshots) && onIngested) {
        onIngested();
      }
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
    } finally {
      setBusyStartedAt(null);
    }
  };

  const onSubmitText = async () => {
    try {
      const payload = await pasteToPayload(text);
      await submit(payload);
      setText('');
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
    }
  };

  const onPickFile = async (file) => {
    if (!file) return;
    try {
      const payload = await fileToPayload(file);
      await submit(payload);
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrop(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onPickFile(f);
  };

  const busy = status?.kind === 'busy';

  return (
    <div className="intake">
      <h2 className="intake-h">Intake</h2>
      <p className="intake-lede">
        Paste a free-text receipt, drop a screenshot, PDF, CSV or XLSX. An LLM extracts rows and appends them to the ledger Sheet directly.
      </p>

      {stubBanner && (
        <div className="intake-warn">
          <strong>Stub mode:</strong> /api/intake is returning hardcoded test data. The live Claude call lands in a follow-up step.
        </div>
      )}

      <div
        className={`intake-drop ${drop ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrop(true); }}
        onDragLeave={() => setDrop(false)}
        onDrop={onDrop}
      >
        Drop a file here, or
        <button
          type="button"
          className="intake-pick"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          choose one
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.csv,.tsv,.txt,.xlsx,image/*,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={e => onPickFile(e.target.files?.[0])}
        />
      </div>

      <div className="intake-paste">
        <label className="intake-paste-label" htmlFor="intake-paste-area">Or paste text:</label>
        <textarea
          id="intake-paste-area"
          className="intake-textarea"
          placeholder="Paste a receipt, a list of transactions, a balance update, anything goes…"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          disabled={busy}
        />
        <div className="intake-actions">
          <button
            type="button"
            className="intake-submit"
            onClick={onSubmitText}
            disabled={busy || !text.trim()}
          >
            {busy ? 'Working…' : 'Submit text'}
          </button>
        </div>
      </div>

      {status && (
        <div className={`intake-status intake-status-${status.kind}`}>
          {status.msg}
          {busy && busyStartedAt && (
            <span className="intake-status-elapsed">
              {' '}· {((now - busyStartedAt) / 1000).toFixed(1)}s elapsed
              {(now - busyStartedAt) > 8000 && ' (Gemini retries can take ~10s under load)'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

window.IntakeTab = IntakeTab;
