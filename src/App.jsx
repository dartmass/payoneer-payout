import { useMemo, useState } from "react";
import Papa from "papaparse";
import "./App.css";

function sliceToHeader(rawText) {
  const lines = rawText.split(/\r?\n/);
  const idx = lines.findIndex(
    (l) => l.includes('"Transaction creation date"') && l.includes('"Payout ID"')
  );
  if (idx === -1) return rawText;
  return lines.slice(idx).join("\n");
}

function safeStr(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "--" ? "" : s;
}

function toNum(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount, currency) {
  const v = (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);
  return `${currency} $${v}`;
}

function classifyRow(r) {
  // MVPの分類：Order番号やItemがあれば売上扱いに寄せる
  const orderNo = safeStr(r["Order number"]);
  const itemId = safeStr(r["Item ID"]);
  const type = safeStr(r["Type"]).toLowerCase();
  const desc = safeStr(r["Description"]).toLowerCase();

  if (type === "payout") return "payout";
  if (orderNo || itemId) return "sale";
  if (type.includes("fee") || desc.includes("fee")) return "fee";
  return "adjustment";
}

function buildPayouts(rows) {
  const payouts = {};

  for (const r of rows) {
    const payoutId = safeStr(r["Payout ID"]);
    if (!payoutId) continue;

    const currency = safeStr(r["Payout currency"]) || "USD";
    const net = toNum(r["Net amount"]);
    const typeRaw = safeStr(r["Type"]);
    const kind = classifyRow(r);

    if (!payouts[payoutId]) {
      payouts[payoutId] = {
        payoutId,
        payoutDate: "",
        currency,
        payoutAmount: 0,
        summary: {
          salesTotal: 0,
          feesTotal: 0,
          adjustmentsTotal: 0,
          rowCount: 0,
        },
        rows: [],
        _payoutAbs: 0,
      };
    }

    const p = payouts[payoutId];

    // 日付は Payout行の Transaction creation date を優先、なければPayout date
    const d1 = safeStr(r["Transaction creation date"]);
    const d2 = safeStr(r["Payout date"]);
    if (!p.payoutDate) p.payoutDate = d1 || d2 || "";

    if (kind === "payout") {
      p._payoutAbs += Math.abs(net);
      continue; // 内訳表には出さない（MVP）
    }

    const orderNumber = safeStr(r["Order number"]);
    const itemTitle = safeStr(r["Item title"]);
    const desc = safeStr(r["Description"]);

    p.rows.push({
      kind, // sale / fee / adjustment
      typeRaw,
      orderNumber,
      itemTitle,
      description: desc,
      netAmount: net,
      date: getRowDate(r),    
      });

    p.summary.rowCount += 1;

    if (kind === "sale") p.summary.salesTotal += net;
    else if (kind === "fee") p.summary.feesTotal += net;
    else p.summary.adjustmentsTotal += net;
  }

  // payoutAmount確定：Payout行があればabs合計、なければ内訳合計
  for (const pid of Object.keys(payouts)) {
    const p = payouts[pid];
    const breakdownSum = p.rows.reduce((a, x) => a + (x.netAmount || 0), 0);
    p.payoutAmount = p._payoutAbs > 0 ? p._payoutAbs : breakdownSum;
    delete p._payoutAbs;
  }

  return payouts;
}

export default function App() {
  const [status, setStatus] = useState("未アップロード");
  const [payouts, setPayouts] = useState({});
  const [selectedId, setSelectedId] = useState(null);

  const payoutList = useMemo(() => {
    const list = Object.values(payouts);
    return list.sort((a, b) => (Date.parse(b.payoutDate) || 0) - (Date.parse(a.payoutDate) || 0));
  }, [payouts]);

  const selected = selectedId ? payouts[selectedId] : null;

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("解析中…");
    setSelectedId(null);

    const raw = await file.text();
    const sliced = sliceToHeader(raw);

    const parsed = Papa.parse(sliced, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors?.length) console.log(parsed.errors);

    const rows = parsed.data || [];
    console.log(Object.keys(rows[0] || {}));    
    const built = buildPayouts(rows);

    setPayouts(built);
    setStatus(`読み込みOK（Payout: ${Object.keys(built).length}件）`);
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>Payoneer Payout Breakdown（eBay Transaction CSV）</h1>
        <p className="muted">
          eBayの Transaction CSV を1つアップロード → <b>Payout ID（入金単位）</b>ごとの内訳が出ます。<br />
          データはローカルで処理（サーバ送信なし）。
        </p>

        <div className="row">
          <label className="btn">
            CSVをアップロード
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <span className="pill">{status}</span>
        </div>

        {payoutList.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Payout ID</th>
                <th>Date</th>
                <th className="num">Amount</th>
                <th className="num">Rows</th>
              </tr>
            </thead>
            <tbody>
              {payoutList.map((p) => (
                <tr
                  key={p.payoutId}
                  className="clickable"
                  onClick={() => setSelectedId(p.payoutId)}
                >
                  <td>{p.payoutId}</td>
                  <td>{p.payoutDate || "—"}</td>
                  <td className="num">
                    <b>{formatMoney(p.payoutAmount, p.currency)}</b>
                  </td>
                  <td className="num">{p.summary.rowCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card modal">
          <div className="modalHead">
            <div>
              <div className="modalTitle">Payout {selected.payoutId}</div>
              <div className="muted">
                {selected.payoutDate || "—"} / {formatMoney(selected.payoutAmount, selected.currency)}
              </div>
            </div>
            <button className="btn ghost" onClick={() => setSelectedId(null)}>
              閉じる
            </button>
          </div>

          <div className="grid">
            <div className="kv">
              <div className="k">Total (Payout)</div>
              <div className="v">{formatMoney(selected.payoutAmount, selected.currency)}</div>
            </div>
            <div className="kv">
              <div className="k">Sales total</div>
              <div className="v">{formatMoney(selected.summary.salesTotal, selected.currency)}</div>
            </div>
            <div className="kv">
              <div className="k">Fees total</div>
              <div className="v">{formatMoney(selected.summary.feesTotal, selected.currency)}</div>
            </div>
            <div className="kv">
              <div className="k">Adjustments/Other</div>
              <div className="v">{formatMoney(selected.summary.adjustmentsTotal, selected.currency)}</div>
            </div>
          </div>

          <p className="muted small">内訳（売上 / 手数料 / 調整）</p>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Kind</th>
                <th>Order / Item</th>
                <th>Description</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {selected.rows.map((r, i) => (
                <tr key={i}>
                  <td>{getRowDate(r)}</td>
                  <td>{r.kind}</td>
                  <td>{(r.orderNumber || r.itemTitle || "—").slice(0, 36)}</td>
                  <td>{(r.description || r.itemTitle || "—").slice(0, 80)}</td>
                  <td className="num">
                    {(r.netAmount >= 0 ? "+" : "") + r.netAmount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const getRowDate = (r) => {
  const candidates = [
    "Transaction creation date",
    "Transaction creation date (UTC)",
    "Transaction date",
    "Date",
  ];
  for (const k of candidates) {
    const v = r?.[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  // それでも無いときは、キー名に "date" を含む列を自動で拾う
  const k = Object.keys(r || {}).find((key) => /date/i.test(key) && String(r[key] || "").trim());
  return k ? String(r[k]).trim() : "--";
};
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const calcPayoutCheck = (rows) => {
  const payoutRows = rows.filter(r => r.Type === "Payout");
  const payoutNet = payoutRows.reduce((s, r) => s + num(r["Net amount"]), 0); // だいたいマイナス
  const othersNet = rows.filter(r => r.Type !== "Payout")
    .reduce((s, r) => s + num(r["Net amount"]), 0); // だいたいプラス

  const balance = payoutNet + othersNet; // 0が理想
  const currencies = Array.from(new Set(rows.map(r => r["Payout currency"]).filter(x => x && x !== "--")));

  const ok =
    payoutRows.length === 1 &&
    Math.abs(balance) < 0.01 &&
    (currencies.length <= 1);

  const issues = [];
  if (payoutRows.length !== 1) issues.push(`Payout行が${payoutRows.length}件`);
  if (Math.abs(balance) >= 0.01) issues.push(`差分=${balance.toFixed(2)}`);
  if (currencies.length > 1) issues.push(`通貨混在=${currencies.join(",")}`);

  return {
    ok,
    payoutAmount: Math.abs(payoutNet), // 送金額（正の値）
    balance,
    issues,
  };
};

