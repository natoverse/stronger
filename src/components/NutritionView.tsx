import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { MealCategory, MealItem, MealLogEntry } from '../model/index.js';

const CATEGORIES: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'];
const EMPTY_MACROS = { calories: '', fat: '', carbs: '', fiber: '', protein: '' };

type MacroInputs = typeof EMPTY_MACROS;

interface Props {
  items: MealItem[];
  entries: MealLogEntry[];
  onSaveItems: (items: MealItem[]) => void;
  onLogEntry: (entry: MealLogEntry) => void;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MacroFields({ values, onChange }: { values: MacroInputs; onChange: (values: MacroInputs) => void }) {
  return (
    <div className="nutrition-macro-fields">
      {(['calories', 'fat', 'carbs', 'fiber', 'protein'] as const).map((field) => (
        <label key={field}>
          {field === 'calories' ? 'Calories' : `${field[0].toUpperCase()}${field.slice(1)} (g)`}
          <input
            type="number"
            min="0"
            step="any"
            required
            value={values[field]}
            onChange={(event) => onChange({ ...values, [field]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function macrosFrom(values: MacroInputs) {
  return {
    calories: Number(values.calories),
    fat: Number(values.fat),
    carbs: Number(values.carbs),
    fiber: Number(values.fiber),
    protein: Number(values.protein),
  };
}

export function NutritionView({ items, entries, onSaveItems, onLogEntry }: Props) {
  const [date, setDate] = useState(localDate);
  const [showSavedForm, setShowSavedForm] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savedCategory, setSavedCategory] = useState<MealCategory>('Breakfast');
  const [savedMacros, setSavedMacros] = useState<MacroInputs>(EMPTY_MACROS);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<MealCategory>('Snacks');
  const [customMacros, setCustomMacros] = useState<MacroInputs>(EMPTY_MACROS);

  const dayEntries = useMemo(() => entries.filter((entry) => entry.date === date), [entries, date]);
  const totals = useMemo(
    () => dayEntries.reduce((sum, entry) => ({
      calories: sum.calories + entry.calories, fat: sum.fat + entry.fat, carbs: sum.carbs + entry.carbs,
      fiber: sum.fiber + entry.fiber, protein: sum.protein + entry.protein,
    }), { calories: 0, fat: 0, carbs: 0, fiber: 0, protein: 0 }),
    [dayEntries],
  );
  const itemsByCategory = useMemo(() => new Map(CATEGORIES.map((category) => [
    category,
    items.filter((item) => item.category === category).sort((a, b) => a.name.localeCompare(b.name)),
  ])), [items]);

  const logItem = (item: MealItem) => onLogEntry({ ...item, id: newId(), date });

  const saveItem = (event: React.FormEvent) => {
    event.preventDefault();
    const item: MealItem = { id: newId(), name: savedName.trim(), category: savedCategory, ...macrosFrom(savedMacros) };
    if (!item.name) return;
    onSaveItems([...items, item]);
    setSavedName('');
    setSavedMacros(EMPTY_MACROS);
    setShowSavedForm(false);
  };

  const logCustom = (event: React.FormEvent) => {
    event.preventDefault();
    const entry: MealLogEntry = { id: newId(), date, name: customName.trim(), category: customCategory, ...macrosFrom(customMacros) };
    if (!entry.name) return;
    onLogEntry(entry);
    setCustomName('');
    setCustomMacros(EMPTY_MACROS);
  };

  return (
    <main className="nutrition-view">
      <div className="nutrition-heading">
        <h2>Nutrition</h2>
        <input aria-label="Log date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <section className="nutrition-totals">
        <strong>{totals.calories} cal</strong>
        <span>Fat {totals.fat}g</span><span>Carbs {totals.carbs}g</span>
        <span>Fiber {totals.fiber}g</span><span>Protein {totals.protein}g</span>
      </section>

      {CATEGORIES.map((category) => {
        const categoryItems = itemsByCategory.get(category) ?? [];
        const categoryEntries = dayEntries.filter((entry) => entry.category === category);
        return (
          <section className="nutrition-category" key={category}>
            <h3>{category}</h3>
            {categoryItems.map((item) => (
              <button className="nutrition-item" key={item.id} onClick={() => logItem(item)}>
                <span>{item.name}<small>{item.calories} cal · P {item.protein}g · C {item.carbs}g · F {item.fat}g · Fi {item.fiber}g</small></span>
                <Plus size={18} />
              </button>
            ))}
            {categoryEntries.map((entry) => <p className="nutrition-entry" key={entry.id}>{entry.name} <span>{entry.calories} cal</span></p>)}
          </section>
        );
      })}

      <section className="nutrition-actions">
        <button className="btn-new-workout" onClick={() => setShowSavedForm((show) => !show)}>
          <Plus size={20} /> New Saved Item
        </button>
        {showSavedForm && (
          <form className="nutrition-form" onSubmit={saveItem}>
            <input placeholder="Food or drink name" value={savedName} onChange={(event) => setSavedName(event.target.value)} required />
            <select value={savedCategory} onChange={(event) => setSavedCategory(event.target.value as MealCategory)}>
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
            <MacroFields values={savedMacros} onChange={setSavedMacros} />
            <button className="btn-primary" type="submit">Save Item</button>
          </form>
        )}
        <form className="nutrition-form" onSubmit={logCustom}>
          <h3>Quick Add</h3>
          <input placeholder="Meal or item name" value={customName} onChange={(event) => setCustomName(event.target.value)} required />
          <select value={customCategory} onChange={(event) => setCustomCategory(event.target.value as MealCategory)}>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
          <MacroFields values={customMacros} onChange={setCustomMacros} />
          <button className="btn-primary" type="submit">Add to Day</button>
        </form>
      </section>
    </main>
  );
}
