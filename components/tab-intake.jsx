// Intake tab — paste free text or drop a file (PNG / JPG / PDF / CSV / XLSX),
// the server extracts structured rows via Gemini, the user reviews them in a
// table, then approves to write to the DB.

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_BYTES = 1 * 1024 * 1024;
const MAX_CSV_ROWS = 500;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('File read failed'));
    fr.onload = () => {
      const result = fr.result || '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    fr.readAsDataURL(file);
  });
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
  const text = await file.text();
  if (text.length > MAX_TEXT_BYTES) throw new Error(`File too large (${(text.length/1024/1024).toFixed(1)} MB).`);
  if (text.split('\n').length > MAX_CSV_ROWS + 1 && (ext === 'csv' || type === 'text/csv')) {
    throw new Error(`CSV has more than ${MAX_CSV_ROWS} rows; please trim before uploading.`);
  }
  return { kind: 'text', content: text, fileName };
}

async function postExtract(payload) {
  const token = window.DbLoader?.getCurrentToken?.() || null;
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
    body: JSON.stringify({ ...payload, accounts, categories, sourceDoc, dryRun: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intake API failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function postApprove(rows, tab) {
  const token = window.DbLoader?.getCurrentToken?.() || null;
  const res = await fetch(`/api/${tab}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Write failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// ── Review table for extracted rows ─────────────────────────────────────────

function ReviewTable({ expenses, income, snapshots, onApprove, onCancel, busy }) {
  const total = expenses.length + income.length + snapshots.length;
  if (!total) return null;

  return (
    <div className="intake-review">
      <div className="intake-review-header">
        <strong>{total} row{total !== 1 ? 's' : ''} extracted</strong>
        <span className="dim">Review below, then approve or cancel.</span>
      </div>

      {expenses.length > 0 && (
        <div className="intake-review-section">
          <h4>{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</h4>
          <div style={{ overflowX: 'auto' }}>
          <table className="data-tbl compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant</th>
                <th>Category</th>
                <th className="r">Amount</th>
                <th>Currency</th>
                <th>Ref</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{e.date}</td>
                  <td>{e.merchant}</td>
                  <td>{e.category || <span className="dim">—</span>}</td>
                  <td className="r mono">{e.charge_amount_ils || e.purchase_amount}</td>
                  <td>{e.purchase_currency}</td>
                  <td className="mono dim">{e.external_ref_id || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {income.length > 0 && (
        <div className="intake-review-section">
          <h4>{income.length} income</h4>
          <table className="data-tbl compact">
            <thead><tr><th>Date</th><th>Source</th><th>Type</th><th className="r">Amount</th><th>Currency</th></tr></thead>
            <tbody>
              {income.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.date}</td>
                  <td>{r.source}</td>
                  <td>{r.type}</td>
                  <td className="r mono">{r.gross_native}</td>
                  <td>{r.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="intake-review-section">
          <h4>{snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}</h4>
          <table className="data-tbl compact">
            <thead><tr><th>Date</th><th>Account</th><th className="r">Balance</th><th>Currency</th></tr></thead>
            <tbody>
              {snapshots.map((s, i) => (
                <tr key={i}>
                  <td className="mono">{s.date}</td>
                  <td>{s.account_id}</td>
                  <td className="r mono">{s.balance_native}</td>
                  <td>{s.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="intake-review-actions">
        <button className="intake-submit" onClick={onApprove} disabled={busy}>
          {busy ? 'Saving…' : `Approve & save ${total} row${total !== 1 ? 's' : ''}`}
        </button>
        <button className="intake-pick" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main IntakeTab ──────────────────────────────────────────────────────────

function IntakeTab({ onIngested }) {
  const { useState, useRef, useEffect } = React;
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('input');  // input | extracting | review | saving | done
  const [status, setStatus] = useState(null);
  const [drop, setDrop] = useState(false);
  const [busyStartedAt, setBusyStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [extraction, setExtraction] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!busyStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [busyStartedAt]);

  if (!window.DbLoader) {
    return (
      <div className="intake">
        <h2 className="intake-h">Intake</h2>
        <div className="intake-disabled">
          Intake is disabled in demo mode. Sign in to drop receipts and statements here.
        </div>
      </div>
    );
  }

  const extract = async (payload) => {
    setPhase('extracting');
    setStatus({ kind: 'busy', msg: `Sending ${Math.round((payload.content?.length || 0) / 1024)} KB ${payload.kind} to model…` });
    setBusyStartedAt(Date.now());
    setExtraction(null);
    try {
      const result = await postExtract(payload);
      console.log('[intake] extraction:', {
        model: result.model, total_ms: result.total_ms,
        expenses: (result.expenses || []).length,
        income: (result.income || []).length,
        snapshots: (result.snapshots || []).length,
        rejected: (result.rejected || []).length,
        truncated: result.truncated,
      });
      if (result.rejected?.length) {
        console.warn('[intake] rejected:', result.rejected);
      }

      const total = (result.expenses?.length || 0) + (result.income?.length || 0) + (result.snapshots?.length || 0);
      if (total === 0) {
        const meta = result.model ? ` · ${result.model}` : '';
        setStatus({ kind: 'err', msg: 'No rows extracted. Try being more specific about the account or merchant.' + meta });
        setPhase('input');
      } else {
        setExtraction(result);
        const meta = result.model ? ` · ${result.model}, ${Math.round((result.total_ms || 0) / 100) / 10}s` : '';
        let warn = '';
        if (result.truncated) warn = ' ⚠ Output may be truncated.';
        if (result.rejected?.length) warn += ` ${result.rejected.length} skipped.`;
        setStatus({ kind: 'ok', msg: `Extracted ${total} rows${warn}${meta}` });
        setPhase('review');
      }
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
      setPhase('input');
    } finally {
      setBusyStartedAt(null);
    }
  };

  const approve = async () => {
    if (!extraction) return;
    setPhase('saving');
    setBusyStartedAt(Date.now());
    try {
      const errors = [];
      let totalInserted = 0;

      for (const [tab, rows] of [['expenses', extraction.expenses], ['income', extraction.income], ['snapshots', extraction.snapshots]]) {
        if (!rows?.length) continue;
        try {
          const mapRow = tab === 'expenses' ? (r) => {
            const pa = parseFloat(r.purchase_amount) || 0;
            const ca = parseFloat(r.charge_amount_ils) || pa;
            const pc = r.purchase_currency || 'ILS';
            return {
              date: r.date, account_id: r.account_id, amount_native: pa, currency: pc,
              amount_ils: ca, fx_rate: (pc !== 'ILS' && pa > 0) ? +(ca / pa).toFixed(4) : 1,
              category: r.category || null, merchant: r.merchant, description: r.description || null,
              source_doc: r.source_doc || null, billing_date: r.billing_date || null,
              external_ref_id: r.external_ref_id || null,
            };
          } : (r) => r;
          const result = await postApprove(rows.map(mapRow), tab);
          totalInserted += result.inserted || 0;
        } catch (e) {
          errors.push(`${tab}: ${e.message}`);
        }
      }

      try { await window.DbLoader.fetchAndPopulate(); } catch (_) {}

      if (errors.length) {
        setStatus({ kind: 'err', msg: `Saved ${totalInserted} rows. Errors: ${errors.join('; ')}` });
      } else {
        setStatus({ kind: 'ok', msg: `Saved ${totalInserted} rows to ledger.` });
      }
      setExtraction(null);
      setText('');
      setPhase('input');
      if (totalInserted > 0 && onIngested) onIngested();
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
      setPhase('review');
    } finally {
      setBusyStartedAt(null);
    }
  };

  const cancel = () => {
    setExtraction(null);
    setPhase('input');
    setStatus(null);
  };

  const onSubmitText = async () => {
    try {
      const payload = { kind: 'text', content: text };
      if (!text?.trim()) throw new Error('Nothing to send');
      if (text.length > MAX_TEXT_BYTES) throw new Error('Text too large');
      await extract(payload);
    } catch (e) {
      setStatus({ kind: 'err', msg: e.message || String(e) });
    }
  };

  const onPickFile = async (file) => {
    if (!file) return;
    try {
      const payload = await fileToPayload(file);
      await extract(payload);
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

  const busy = phase === 'extracting' || phase === 'saving';

  return (
    <div className="intake">
      <h2 className="intake-h">Intake</h2>
      <p className="intake-lede">
        Paste text, drop a screenshot, PDF, CSV or XLSX. Gemini extracts rows — review before saving.
      </p>

      {phase !== 'review' && (
        <>
          <div
            className={`intake-drop ${drop ? 'over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrop(true); }}
            onDragLeave={() => setDrop(false)}
            onDrop={onDrop}
          >
            Drop a file here, or
            <button type="button" className="intake-pick" onClick={() => fileInputRef.current?.click()} disabled={busy}>
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
              placeholder="Paste a receipt, a list of transactions, a balance update…"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={6}
              disabled={busy}
            />
            <div className="intake-actions">
              <button type="button" className="intake-submit" onClick={onSubmitText} disabled={busy || !text.trim()}>
                {busy ? 'Working…' : 'Extract'}
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'review' && extraction && (
        <ReviewTable
          expenses={extraction.expenses || []}
          income={extraction.income || []}
          snapshots={extraction.snapshots || []}
          onApprove={approve}
          onCancel={cancel}
          busy={phase === 'saving'}
        />
      )}

      {status && (
        <div className={`intake-status intake-status-${status.kind}`}>
          {status.msg}
          {busy && busyStartedAt && (
            <span className="intake-status-elapsed">
              {' '}· {((now - busyStartedAt) / 1000).toFixed(1)}s elapsed
              {(now - busyStartedAt) > 8000 && ' (retries can take ~10s under load)'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

window.IntakeTab = IntakeTab;
