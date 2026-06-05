import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "debtfree:v1";
// Before every save, the previous save is copied here. If the main copy is
// ever lost or corrupted, the app falls back to this one.
const BACKUP_KEY = "debtfree:backup:v1";
// A one-time snapshot of the starting state. Captured the first time there
// is real data and never overwritten, so progress can always be compared
// against where things began, and everything can be reset back to it.
const ORIGINAL_KEY = "debtfree:original:v1";

// Read and parse a stored copy; null if missing or unreadable
function readCopy(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

// "maria cruz" -> "Maria Cruz"
function titleCase(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalize(data) {
  return {
    income: Number(data.income) || 0,
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
    debts: Array.isArray(data.debts)
      ? data.debts.map((d) => ({
          id: d.id,
          name: d.name,
          balance: Number(d.balance) || 0,
          rate: Number(d.rate) || 0,
          minPayment: Number(d.minPayment) || 0,
          oneTime: Number(d.oneTime) || 0,
        }))
      : [],
    history: Array.isArray(data.history) ? data.history : [],
  };
}

function loadState() {
  // Try the main copy first; if it's missing or corrupted, use the backup
  for (const key of [STORAGE_KEY, BACKUP_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalize(JSON.parse(raw));
    } catch {
      // corrupted copy, try the next one
    }
  }
  return { income: 0, expenses: [], debts: [], history: [] };
}

// What's actually owed: the debt plus its interest for the month, if any.
// e.g. 80,000 at 10% = 88,000 to pay.
function owedAmount(debt) {
  return debt.balance * (1 + debt.rate / 100);
}

// The interest part of what's owed, e.g. 8,000 on an 80,000 debt at 10%
function interestAmount(debt) {
  return debt.balance * (debt.rate / 100);
}

// For rate-bearing debts, the minimum tracks the current interest (dynamic).
// For zero-rate debts, it's whatever the user typed.
function effectiveMin(debt) {
  return debt.rate > 0 ? interestAmount(debt) : debt.minPayment;
}

// Forecast, the way you'd do it on paper: this month pays the upcoming
// min payments (one-times included), every month after pays the leftover
// (income minus expenses). Each payment comes straight off the total.
// e.g. 248,600 - 90,600 = 158,000, then -75,700 each month until zero.
// Returns the list of steps, or null if the payments never finish it.
function buildForecast(totalOwed, firstPayment, monthlyPayment) {
  const steps = [];
  let remaining = totalOwed;

  for (let month = 1; month <= 600 && remaining > 0.005; month++) {
    const budget =
      month === 1 && firstPayment > 0
        ? Math.max(firstPayment, monthlyPayment)
        : monthlyPayment;
    if (budget <= 0) return null;
    const payment = Math.min(budget, remaining);
    remaining -= payment;
    steps.push({ month, payment, remaining });
  }
  return remaining > 0.005 ? null : steps;
}

// Month 1 is the current month (e.g. Jun 2026), then Jul 2026, and so on
function forecastMonthLabel(month) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + month - 1);
  return date.toLocaleDateString("en-PH", { month: "short", year: "numeric" });
}


function humanizeMonths(months) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const label = date.toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
  });
  if (months === 0) return `This month (${label})`;
  if (months === 1) return `Next month (${label})`;
  if (months < 12) return `In ${months} months (${label})`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 1 ? "1 year" : `${years} years`;
  const monthPart = rest === 0 ? "" : rest === 1 ? " 1 month" : ` ${rest} months`;
  return `In ${yearPart}${monthPart} (${label})`;
}

function Card({ title, action, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function AmountInput({
  value,
  onChange,
  placeholder,
  className = "",
  disabled,
  invalid,
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
        ₱
      </span>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 disabled:bg-slate-50 disabled:text-slate-500 ${
          invalid
            ? "border-red-400 focus:border-red-500 focus:ring-red-500"
            : "border-slate-300 focus:border-slate-500 focus:ring-slate-500"
        }`}
      />
    </div>
  );
}

function AddExpenseForm({ onAdd }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  function submit(e) {
    e.preventDefault();
    const value = parseFloat(amount);
    if (!name.trim() || !(value > 0)) return;
    onAdd(titleCase(name), value);
    setName("");
    setAmount("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Groceries"
        className="min-w-0 flex-1 basis-32 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      <AmountInput
        value={amount}
        onChange={setAmount}
        placeholder="Amount"
        className="w-32 shrink-0"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      >
        Add
      </button>
    </form>
  );
}

function AddDebtForm({ onAdd }) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [rate, setRate] = useState("");
  // A debt is paid either with a monthly minimum or a one-time payment.
  // Min/month is typed freely; one-time mirrors the amount field.
  const [payMode, setPayMode] = useState("monthly");
  const [minPayment, setMinPayment] = useState("");

  const balanceValue = parseFloat(balance) || 0;

  function submit(e) {
    e.preventDefault();
    if (!name.trim() || !(balanceValue > 0)) return;
    onAdd({
      name: titleCase(name),
      balance: balanceValue,
      rate: parseFloat(rate) || 0,
      minPayment: payMode === "monthly" ? parseFloat(minPayment) || 0 : 0,
      oneTime: payMode === "oneTime" ? balanceValue : 0,
    });
    setName("");
    setBalance("");
    setRate("");
    setMinPayment("");
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Who do you owe? e.g. Home Credit"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      <div className="flex flex-wrap gap-2">
        <AmountInput
          value={balance}
          onChange={setBalance}
          placeholder="Amount"
          className="min-w-0 flex-1 basis-28"
        />
        <div className="relative min-w-0 flex-1 basis-24">
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Interest"
            className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-8 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">
            %
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {[
            ["monthly", "Min/month"],
            ["oneTime", "One-time"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPayMode(mode)}
              aria-pressed={payMode === mode}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                payMode === mode
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <AmountInput
          value={payMode === "oneTime" ? balance : minPayment}
          onChange={setMinPayment}
          placeholder={payMode === "monthly" ? "Min/month" : "One-time"}
          disabled={payMode === "oneTime"}
          className="min-w-0 flex-1 basis-28"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Add debt
        </button>
      </div>
      <p className="text-xs text-slate-400">
        Interest and min/month are optional. One-time is the full amount.
      </p>
    </form>
  );
}

// Popout listing every debt with a payment input. One button pays them all.
// A payment below a debt's monthly minimum blocks saving until it's fixed.
function PaymentsModal({ debts, income, expensesTotal, onSave, onClose }) {
  const [amounts, setAmounts] = useState({});

  const totalEntered = debts.reduce((sum, d) => {
    const value = parseFloat(amounts[d.id]);
    return sum + (value > 0 ? Math.min(value, owedAmount(d)) : 0);
  }, 0);
  const leftBeforePaying = income - expensesTotal;

  function belowMin(debt) {
    const value = parseFloat(amounts[debt.id]);
    const min = effectiveMin(debt);
    return value > 0 && min > 0 && value < Math.min(min, owedAmount(debt));
  }

  function wrongOneTime(debt) {
    const value = parseFloat(amounts[debt.id]);
    return value > 0 && debt.oneTime > 0 && value !== debt.oneTime;
  }

  const hasBelowMin = debts.some(belowMin);
  const hasWrongOneTime = debts.some(wrongOneTime);
  const hasError = hasBelowMin || hasWrongOneTime;

  function submit(e) {
    e.preventDefault();
    if (totalEntered <= 0 || hasError) return;
    onSave(amounts);
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Pay your debts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </header>
        <form onSubmit={submit}>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto px-4 sm:px-5">
            {debts.map((debt) => (
              <li key={debt.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {debt.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      Owes {peso.format(owedAmount(debt))}
                      {debt.rate > 0 &&
                        ` · ${peso.format(interestAmount(debt))} is interest`}
                      {effectiveMin(debt) > 0 &&
                        ` · min ${peso.format(effectiveMin(debt))}/month`}
                      {debt.oneTime > 0 &&
                        ` · one-time ${peso.format(debt.oneTime)}`}
                    </p>
                  </div>
                  <AmountInput
                    value={amounts[debt.id] || ""}
                    onChange={(v) =>
                      setAmounts((a) => ({ ...a, [debt.id]: v }))
                    }
                    placeholder={
                      effectiveMin(debt) > 0
                        ? effectiveMin(debt).toFixed(2)
                        : debt.oneTime > 0
                        ? debt.oneTime.toFixed(2)
                        : "0.00"
                    }
                    invalid={belowMin(debt) || wrongOneTime(debt)}
                    className="w-full sm:w-32"
                  />
                </div>
                {belowMin(debt) && (
                  <p className="mt-1 text-right text-xs text-red-600">
                    Below the {peso.format(effectiveMin(debt))} minimum
                  </p>
                )}
                {wrongOneTime(debt) && (
                  <p className="mt-1 text-right text-xs text-red-600">
                    Must be exactly {peso.format(debt.oneTime)} (one-time)
                  </p>
                )}
              </li>
            ))}
          </ul>
          <footer className="border-t border-slate-100 px-4 py-4 sm:px-5">
            <button
              type="submit"
              disabled={totalEntered <= 0 || hasError}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {hasBelowMin
                ? "A payment is below its minimum"
                : hasWrongOneTime
                ? "One-time payment must match exactly"
                : totalEntered > 0
                ? `Pay ${peso.format(totalEntered)}`
                : "Enter a payment"}
            </button>
            <p className="mt-2 text-center text-xs text-slate-400">
              Expenses {peso.format(expensesTotal)} ·{" "}
              {peso.format(leftBeforePaying)} left before paying
            </p>
          </footer>
        </form>
      </div>
    </div>
  );
}

// Detail view for one history entry: what was paid to whom, plus how the
// month's money looked, income, money after expenses, and salary left.
function HistoryModal({ entry, onClose }) {
  const dateLabel = new Date(entry.date).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{dateLabel}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </header>
        <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto px-5">
          {entry.items.map((item, index) => (
            <li
              key={index}
              className="flex items-center justify-between py-2.5"
            >
              <span className="text-sm text-slate-900">{item.name}</span>
              <span className="text-sm font-semibold text-emerald-600">
                {peso.format(item.amount)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Income</dt>
            <dd className="font-medium">{peso.format(entry.income)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Bills & expenses</dt>
            <dd className="font-medium">-{peso.format(entry.expenses)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">After bills & expenses</dt>
            <dd className="font-medium">{peso.format(entry.afterExpenses)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Debt payments</dt>
            <dd className="font-medium text-emerald-600">
              -{peso.format(entry.total)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2">
            <dt className="font-semibold text-slate-900">
              Salary left after paying
            </dt>
            <dd
              className={`font-semibold ${
                entry.afterPaying >= 0 ? "text-slate-900" : "text-red-600"
              }`}
            >
              {peso.format(entry.afterPaying)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Stat({ label, value, muted }) {
  return (
    <div className="w-24 text-right">
      <p className="text-xs text-slate-400">{label}</p>
      <p
        className={`text-sm ${
          muted ? "text-slate-300" : "font-semibold text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DebtRow({ debt, onRemove }) {
  const minVal = debt.oneTime > 0 ? debt.oneTime : effectiveMin(debt);
  const minLabel = debt.oneTime > 0 ? "One-time" : "Min/month";
  return (
    <li className="py-3">
      {/* Desktop: single row. Mobile: name+delete on top, stats below. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{debt.name}</p>
          <p className="truncate text-xs text-slate-500">
            {peso.format(debt.balance)}
            {debt.rate > 0 && ` + ${debt.rate}% interest`}
          </p>
        </div>
        {/* Stats: inline on desktop, hidden here and shown below on mobile */}
        <div className="hidden sm:flex items-center gap-2">
          <Stat label="Owed" value={peso.format(owedAmount(debt))} />
          <Stat
            label={minLabel}
            value={minVal > 0 ? peso.format(minVal) : "–"}
            muted={minVal <= 0}
          />
        </div>
        <button
          onClick={() => {
            if (window.confirm(`Delete "${debt.name}"?`)) onRemove(debt.id);
          }}
          aria-label={`Delete ${debt.name}`}
          className="shrink-0 rounded-lg px-2 py-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      {/* Stats row: mobile only */}
      <div className="mt-1.5 flex gap-5 sm:hidden">
        <div>
          <p className="text-xs text-slate-400">Owed</p>
          <p className="text-sm font-semibold text-slate-900">{peso.format(owedAmount(debt))}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">{minLabel}</p>
          <p className={`text-sm ${minVal > 0 ? "font-semibold text-slate-900" : "text-slate-300"}`}>
            {minVal > 0 ? peso.format(minVal) : "–"}
          </p>
        </div>
      </div>
    </li>
  );
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [showPayments, setShowPayments] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [incomeDraft, setIncomeDraft] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const isMount = useRef(true);
  const { income, expenses, debts, history } = state;

  useEffect(() => {
    // Skip the backup write on first render — the loaded state IS the backup.
    // Only write backup when the user actually changes something.
    if (!isMount.current) {
      const previous = localStorage.getItem(STORAGE_KEY);
      if (previous) localStorage.setItem(BACKUP_KEY, previous);
    }
    isMount.current = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Capture the original snapshot once, the first time real data exists
    if (state.debts.length > 0 && !localStorage.getItem(ORIGINAL_KEY)) {
      localStorage.setItem(ORIGINAL_KEY, JSON.stringify(state));
    }
  }, [state]);

  const original = readCopy(ORIGINAL_KEY);
  const originalOwed = original
    ? original.debts.reduce((sum, d) => sum + owedAmount(d), 0)
    : 0;

  const totalOwed = debts.reduce((sum, d) => sum + owedAmount(d), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  // What the next round of payments adds up to: every monthly minimum
  // plus every one-time payment, each capped at what's actually owed
  const upcomingPayment = debts.reduce(
    (sum, d) => sum + Math.min(effectiveMin(d) + d.oneTime, owedAmount(d)),
    0
  );
  // The max payment is what's left of net income after total expenses.
  // It already includes the minimum payments: pay the minimums, then
  // everything still unspent goes to debt on top.
  const leftover = income - totalExpenses;
  // This month pays the upcoming minimums; every month after, the leftover
  // After the first payment has been made, all future months pay full leftover.
  // upcomingPayment only applies before any payments have happened.
  const forecast =
    totalOwed > 0
      ? buildForecast(totalOwed, history.length > 0 ? 0 : upcomingPayment, leftover)
      : [];
  const months = forecast === null ? null : forecast.length;

  // Build the full breakdown: historical (paid) steps prepended to remaining forecast.
  // Reconstruct the running balance by adding back all payments, then replay forward.
  let allForecastSteps = null;
  if (forecast !== null) {
    const paidAmounts = [...history].reverse().map((h) => h.total);
    let runningBalance = totalOwed;
    for (const total of paidAmounts) runningBalance += total;
    const historicalSteps = [];
    for (let i = 0; i < paidAmounts.length; i++) {
      runningBalance -= paidAmounts[i];
      historicalSteps.push({ month: i + 1, payment: paidAmounts[i], remaining: Math.max(0, runningBalance), paid: true });
    }
    const remainingSteps = forecast.map((step) => ({
      ...step,
      month: paidAmounts.length + step.month,
      paid: false,
    }));
    allForecastSteps = [...historicalSteps, ...remainingSteps];
  }

  // Every list shows the biggest amounts first
  const sortedDebts = [...debts].filter((d) => d.balance > 0.005).sort((a, b) => owedAmount(b) - owedAmount(a));
  const sortedExpenses = [...expenses].sort((a, b) => b.amount - a.amount);

  function update(patch) {
    setState((s) => ({ ...s, ...patch }));
  }

  function addExpense(name, amount) {
    update({ expenses: [...expenses, { id: crypto.randomUUID(), name, amount }] });
  }

  // Income is typed into a draft field and only stored on Save; the field
  // clears afterwards and the saved value shows beside the label
  function saveIncome(e) {
    e.preventDefault();
    const value = parseFloat(incomeDraft);
    if (!(value >= 0) || incomeDraft === "") return;
    update({ income: value });
    setIncomeDraft("");
  }

  function addDebt(debt) {
    update({ debts: [...debts, { id: crypto.randomUUID(), ...debt }] });
  }

  // Replace the original snapshot with the current data: this becomes
  // the first and original state everything is compared against
  function saveAsOriginal() {
    if (
      window.confirm(
        "Replace the original snapshot with the current data? Progress will be measured against this state from now on."
      )
    ) {
      localStorage.setItem(ORIGINAL_KEY, JSON.stringify(state));
    }
  }

  // Reset everything back to the original snapshot
  function restoreOriginal() {
    if (!original) return;
    if (
      window.confirm(
        "Restore the original state? Your current debts, payments, and history will be replaced by the original snapshot."
      )
    ) {
      setState(original);
    }
  }

  function exportData() {
    const data = localStorage.getItem(STORAGE_KEY) || JSON.stringify(state);
    navigator.clipboard.writeText(data).then(() =>
      window.alert("Data copied to clipboard. Paste it on the other device using Import.")
    );
  }

  function importData() {
    try {
      const parsed = JSON.parse(importText);
      const normalized = normalize(parsed);
      setState(normalized);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      if (!localStorage.getItem(ORIGINAL_KEY)) {
        localStorage.setItem(ORIGINAL_KEY, JSON.stringify(normalized));
      }
      setShowImport(false);
      setImportText("");
    } catch {
      window.alert("Invalid data — make sure you pasted the full export text.");
    }
  }

  // Overwrite the backup copy with the current data, making right now
  // the state that "Revert last change" returns to
  function backUpNow() {
    if (
      window.confirm(
        "Override the backup copy with the current data? Revert will then return to this exact state."
      )
    ) {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
    }
  }

  // Restore the backup copy: the state exactly as it was before the
  // latest change was saved
  function revertToBackup() {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return;
    if (!window.confirm("Revert to the previous save? Your latest change will be undone.")) return;
    try {
      setState(normalize(JSON.parse(raw)));
    } catch {
      window.alert("The backup copy is unreadable, nothing was changed.");
    }
  }

  // A payment covers the interest first; only what's on top of it reduces
  // the debt itself. Pay 8k on an 80k debt at 10% (8k interest) and the
  // debt stays 80k. Pay the full owed amount and it clears completely.
  // Every save is also kept in history with that month's money snapshot.
  function payDebts(amounts) {
    const items = debts
      .map((d) => {
        const value = parseFloat(amounts[d.id]);
        if (!(value > 0)) return null;
        return { name: d.name, amount: Math.min(value, owedAmount(d)) };
      })
      .filter(Boolean);
    const total = items.reduce((sum, i) => sum + i.amount, 0);
    const entry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      items,
      total,
      income,
      expenses: totalExpenses,
      afterExpenses: income - totalExpenses,
      afterPaying: income - totalExpenses - total,
    };
    update({
      debts: debts
        .map((d) => {
          const value = parseFloat(amounts[d.id]);
          if (!(value > 0)) return d;
          const reduction = Math.max(0, value - interestAmount(d));
          return { ...d, balance: Math.max(0, d.balance - reduction) };
        })
        .filter((d) => d.balance > 0.005),
      history: [entry, ...history],
    });
    setShowPayments(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Hero */}
        <header className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Total debt to pay
          </p>
          <p className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">
            {peso.format(totalOwed)}
          </p>
          {originalOwed > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Originally {peso.format(originalOwed)} ·{" "}
              <span className="font-medium text-emerald-600">
                {peso.format(Math.max(0, originalOwed - totalOwed))} cleared so
                far
              </span>
            </p>
          )}
          <div className="mt-3 text-base">
            {totalOwed === 0 ? (
              <p className="font-medium text-emerald-600">
                You're debt free. Keep it that way. 🎉
              </p>
            ) : months === null ? (
              <p className="mx-auto max-w-md rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                After this month's payments, nothing is left after expenses to
                keep paying. Add your income or cut expenses to see your
                debt-free date.
              </p>
            ) : (
              <p className="text-slate-600">
                Debt free:{" "}
                <span className="font-semibold text-emerald-600">
                  {months === 1
                    ? `Next payment (${forecastMonthLabel(history.length + months)})`
                    : `In ${months} payments (${forecastMonthLabel(history.length + months)})`}
                </span>
              </p>
            )}
            {allForecastSteps && allForecastSteps.length > 0 && (
              <details className="mx-auto mt-2 max-w-sm">
                <summary className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-600">
                  See the month-by-month breakdown
                </summary>
                <ol className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs">
                  {[...allForecastSteps].reverse().map((step) => (
                    <li
                      key={step.month}
                      className={`flex items-center justify-between py-1.5 first:pt-0 last:pb-0 ${step.paid ? "opacity-50" : ""}`}
                    >
                      <span className={`text-slate-500 ${step.paid ? "line-through" : ""}`}>
                        <span className="font-medium text-slate-900">
                          {forecastMonthLabel(step.month)}
                        </span>{" "}
                        · pay {peso.format(step.payment)}
                        {!step.paid && step.remaining > 0.005 && (
                          <span className="block text-[11px] text-slate-400">
                            {step.month === history.length + 1 && upcomingPayment > leftover
                              ? "min payments due"
                              : "max payment after expenses"}
                          </span>
                        )}
                      </span>
                      <span
                        className={`font-medium ${step.paid ? "line-through" : ""} ${
                          step.remaining <= 0.005 ? "text-emerald-600" : "text-slate-900"
                        }`}
                      >
                        {step.remaining <= 0.005
                          ? "Debt free 🎉"
                          : `${peso.format(step.remaining)} left`}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        </header>

        <main className="space-y-5">
          {/* Suggestion */}
          {totalOwed > 0 && (
            <Card title="Monthly breakdown">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Net Income</dt>
                  <dd className="font-medium">{peso.format(income)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Total expenses</dt>
                  <dd className="font-medium">
                    -{peso.format(totalExpenses)}
                  </dd>
                </div>
                <div className="border-t border-slate-100 pt-2">
                  <div className="flex justify-between">
                    <dt className="font-semibold text-slate-900">
                      Available for debt payments
                    </dt>
                    <dd
                      className={`font-semibold ${
                        leftover >= upcomingPayment
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {peso.format(leftover)}
                    </dd>
                  </div>
                  {leftover < upcomingPayment && (
                    <p className="mt-0.5 text-right text-xs text-red-600">
                      Short of the {peso.format(upcomingPayment)} minimum
                      payments by <b>{peso.format(upcomingPayment - leftover)}</b>
                    </p>
                  )}
                </div>
              </dl>
            </Card>
          )}

          {/* Income & expenses */}
          <Card title="Income & Expenses">
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium text-slate-500">
                Monthly income
                {income > 0 && (
                  <span className="ml-1.5 font-normal text-slate-400">
                    currently {peso.format(income)}
                  </span>
                )}
              </p>
              <form onSubmit={saveIncome} className="flex gap-2">
                <AmountInput
                  value={incomeDraft}
                  onChange={setIncomeDraft}
                  placeholder={"0.00"}
                  className="w-44"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                >
                  Save
                </button>
              </form>
            </div>
            <p className="mb-2 text-xs font-medium text-slate-500">
              Monthly expenses (groceries, internet, etc...)
            </p>
            {expenses.length > 0 && (
              <details className="mb-3">
                <summary className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-600">
                  {expenses.length} {expenses.length === 1 ? "expense" : "expenses"} · {peso.format(totalExpenses)} total
                </summary>
                <ul className="mt-2 divide-y divide-slate-100">
                  {sortedExpenses.map((expense) => (
                    <li
                      key={expense.id}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="text-sm">{expense.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm text-slate-600">
                          {peso.format(expense.amount)}
                        </span>
                        <button
                          onClick={() =>
                            update({
                              expenses: expenses.filter((e) => e.id !== expense.id),
                            })
                          }
                          aria-label={`Delete ${expense.name}`}
                          className="rounded px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between py-2">
                    <span className="text-sm font-semibold text-slate-900">
                      Total expenses
                    </span>
                    <span className="pr-7 text-sm font-semibold text-slate-900">
                      {peso.format(totalExpenses)}
                    </span>
                  </li>
                </ul>
              </details>
            )}
            <AddExpenseForm onAdd={addExpense} />
          </Card>

          {/* Debts */}
          <Card
            title={debts.length > 0 ? `Debts (${debts.length})` : "Debts"}
            action={
              upcomingPayment > 0 && (
                <p className="text-xs text-slate-500">
                  Min due{" "}
                  <span className="font-semibold text-slate-900">
                    {peso.format(upcomingPayment)}
                  </span>
                </p>
              )
            }
          >
            {debts.length > 0 ? (
              <ul className="mb-3 divide-y divide-slate-100">
                {sortedDebts.map((debt) => (
                  <DebtRow
                    key={debt.id}
                    debt={debt}
                    onRemove={(id) =>
                      update({ debts: debts.filter((d) => d.id !== id) })
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="mb-3 py-4 text-center text-sm text-slate-400">
                No debts yet. Add who you owe, the amount, and interest if any.
              </p>
            )}
            <AddDebtForm onAdd={addDebt} />
          </Card>

          {/* Payments */}
          {debts.length > 0 && (
            <Card title="Payments">
              <p className="mb-3 text-sm text-slate-500">
                Once a month, log what you paid to each debt.
              </p>
              <button
                onClick={() => setShowPayments(true)}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Payments
              </button>
            </Card>
          )}

          {/* History */}
          {history.length > 0 && (
            <Card title="History">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[...history].reverse().map((entry) => (
                  <div key={entry.id} className="relative">
                    <button
                      onClick={() => setSelectedEntry(entry)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 pr-7 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <p className="text-xs text-slate-500">
                        {new Date(entry.date).toLocaleDateString("en-PH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
                        {peso.format(entry.total)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {entry.items.length}{" "}
                        {entry.items.length === 1 ? "debt" : "debts"} paid
                      </p>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Delete this payment record?"))
                          update({
                            history: history.filter((h) => h.id !== entry.id),
                          });
                      }}
                      aria-label="Delete payment record"
                      className="absolute right-1 top-1 rounded px-1.5 py-0.5 text-xs text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </main>

        <footer className="mt-8 text-center text-xs text-slate-400">
          <p>
            Saved automatically on this device. Payments cover interest first;
            anything on top reduces the debt itself.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button
              onClick={exportData}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
            >
              Export data
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
            >
              Import data
            </button>
            <button
              onClick={backUpNow}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
            >
              Back up now
            </button>
            {localStorage.getItem(BACKUP_KEY) && (
              <button
                onClick={revertToBackup}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
              >
                Revert last change
              </button>
            )}
            <button
              onClick={saveAsOriginal}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
            >
              Save as original
            </button>
            {original && (
              <button
                onClick={restoreOriginal}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
              >
                Restore original
              </button>
            )}
          </div>
        </footer>

        {showPayments && (
          <PaymentsModal
            debts={sortedDebts}
            income={income}
            expensesTotal={totalExpenses}
            onSave={payDebts}
            onClose={() => setShowPayments(false)}
          />
        )}

        {selectedEntry && (
          <HistoryModal
            entry={selectedEntry}
            onClose={() => setSelectedEntry(null)}
          />
        )}

        {showImport && (
          <div
            className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4"
            onClick={() => setShowImport(false)}
          >
            <div
              className="w-full max-w-md rounded-xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                <h2 className="text-sm font-semibold text-slate-900">Import data</h2>
                <button
                  onClick={() => setShowImport(false)}
                  className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  ✕
                </button>
              </header>
              <div className="px-5 py-4">
                <p className="mb-3 text-sm text-slate-500">
                  Paste the exported data from your other device below.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  placeholder='{"income":...}'
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
                <button
                  onClick={importData}
                  disabled={!importText.trim()}
                  className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Import &amp; replace
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
