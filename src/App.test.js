import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const STORAGE_KEY = 'debtfree:v1';
const BACKUP_KEY = 'debtfree:backup:v1';

const sampleState = {
  income: 50000,
  expenses: [],
  debts: [
    { id: '1', name: 'Maria', balance: 1000, rate: 0, minPayment: 0, oneTime: 0 },
  ],
  history: [],
};

beforeEach(() => {
  localStorage.clear();
});

test('renders total debt to pay heading', () => {
  render(<App />);
  expect(screen.getByText(/total debt to pay/i)).toBeInTheDocument();
});

test('keeps the previous save as a backup when data changes', () => {
  render(<App />);
  // First save happens on mount: main copy exists, no backup yet
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).debts).toHaveLength(0);

  userEvent.type(screen.getByPlaceholderText(/who do you owe/i), 'maria');
  userEvent.type(screen.getAllByPlaceholderText('Amount')[1], '1000');
  userEvent.click(screen.getByRole('button', { name: /add debt/i }));

  const main = JSON.parse(localStorage.getItem(STORAGE_KEY));
  expect(main.debts).toHaveLength(1);
  expect(main.debts[0].name).toBe('Maria');

  // The backup holds the save from before the debt was added
  const backup = JSON.parse(localStorage.getItem(BACKUP_KEY));
  expect(backup.debts).toHaveLength(0);
});

test('falls back to the backup when the main copy is corrupted', () => {
  localStorage.setItem(STORAGE_KEY, '{not valid json');
  localStorage.setItem(BACKUP_KEY, JSON.stringify(sampleState));

  render(<App />);
  expect(screen.getByText('Maria')).toBeInTheDocument();
});

test('falls back to the backup when the main copy is missing', () => {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(sampleState));

  render(<App />);
  expect(screen.getByText('Maria')).toBeInTheDocument();
});
