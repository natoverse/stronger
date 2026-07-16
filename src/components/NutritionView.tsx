import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import type { MealCategory, MealItem, MealLogEntry } from '../model/index.js';

const CATEGORIES: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'];
const EMPTY_MACROS = { calories: '', fat: '', carbs: '', fiber: '', protein: '' };

type MacroInputs = typeof EMPTY_MACROS;

interface Props {
  items: MealItem[];
  entries: MealLogEntry[];
  dailyCalorieGoal: number;
  dailyProteinGoalGrams: number;
  onSaveItems: (items: MealItem[]) => void;
  onLogEntry: (entry: MealLogEntry) => void;
  onDeleteEntry: (id: string) => void;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Round to at most two decimals for tidy macro display. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
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
            value={values[field]}
            onChange={(event) => onChange({ ...values, [field]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function macrosFrom(values: MacroInputs) {
  const num = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    calories: num(values.calories),
    fat: num(values.fat),
    carbs: num(values.carbs),
    fiber: num(values.fiber),
    protein: num(values.protein),
  };
}

type GoalStatus = 'good' | 'warn' | 'over' | null;

function statusClass(status: GoalStatus): string {
  return status ? `nutrition-goal-${status}` : '';
}

/* ── Open Food Facts search ─────────────────────────────────────────────── */

interface OFFNutriments {
  'energy-kcal_serving'?: number;
  'energy-kcal_100g'?: number;
  fat_serving?: number;
  fat_100g?: number;
  carbohydrates_serving?: number;
  carbohydrates_100g?: number;
  fiber_serving?: number;
  fiber_100g?: number;
  proteins_serving?: number;
  proteins_100g?: number;
}

interface OFFProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number;
  nutriments?: OFFNutriments;
}

interface OFFSearchResult {
  product_name: string;
  brand: string;
  servingLabel: string;
  calories: number;
  fat: number;
  carbs: number;
  fiber: number;
  protein: number;
}

const OPEN_FOOD_FACTS_STAGING_SEARCH_URL = 'https://world.openfoodfacts.net/api/v2/search';
const OPEN_FOOD_FACTS_STAGING_AUTH = 'Basic b2ZmOm9mZg==';

function parseOFFProduct(product: OFFProduct): OFFSearchResult | null {
  const name = (product.product_name ?? '').trim();
  if (!name) return null;
  const n = product.nutriments ?? {};
  const servingQty = product.serving_quantity ?? 100;

  // Prefer per-serving values; fall back to per-100g scaled by serving size
  const cal = n['energy-kcal_serving'] ?? ((n['energy-kcal_100g'] ?? 0) * servingQty / 100);
  const fat = n['fat_serving'] ?? ((n['fat_100g'] ?? 0) * servingQty / 100);
  const carbs = n['carbohydrates_serving'] ?? ((n['carbohydrates_100g'] ?? 0) * servingQty / 100);
  const fiber = n['fiber_serving'] ?? ((n['fiber_100g'] ?? 0) * servingQty / 100);
  const protein = n['proteins_serving'] ?? ((n['proteins_100g'] ?? 0) * servingQty / 100);

  // Drop products where all macros are zero (likely incomplete data)
  if (cal === 0 && fat === 0 && carbs === 0 && protein === 0) return null;

  return {
    product_name: name,
    brand: (product.brands ?? '').split(',')[0].trim(),
    servingLabel: product.serving_size ?? `${servingQty}g`,
    calories: Math.round(cal * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fiber: Math.round(fiber * 10) / 10,
    protein: Math.round(protein * 10) / 10,
  };
}

async function searchOpenFoodFacts(query: string, signal: AbortSignal): Promise<OFFSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: '20',
    fields: 'product_name,brands,serving_size,serving_quantity,nutriments',
  });
  const response = await fetch(`${OPEN_FOOD_FACTS_STAGING_SEARCH_URL}?${params.toString()}`, {
    signal,
    headers: {
      Authorization: OPEN_FOOD_FACTS_STAGING_AUTH,
    },
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const data = (await response.json()) as { products?: OFFProduct[] };
  return (data.products ?? []).flatMap((product) => {
    const parsed = parseOFFProduct(product);
    return parsed ? [parsed] : [];
  });
}

interface FoodSearchProps {
  date: string;
  onLogEntry: (entry: MealLogEntry) => void;
}

function FoodSearch({ date, onLogEntry }: FoodSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OFFSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [resultCategories, setResultCategories] = useState<Record<number, MealCategory>>({});
  const [resultQuantities, setResultQuantities] = useState<Record<number, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    setSearched(false);
    setResults([]);
    setResultCategories({});
    setResultQuantities({});
    try {
      const found = await searchOpenFoodFacts(trimmed, abortRef.current.signal);
      setResults(found);
      setSearched(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const categoryFor = (index: number): MealCategory => resultCategories[index] ?? 'Snacks';
  const quantityFor = (index: number): number => {
    const value = Number(resultQuantities[index] ?? '1');
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const addToDay = (result: OFFSearchResult, index: number) => {
    const entry: MealLogEntry = {
      id: newId(),
      date,
      name: result.product_name,
      category: categoryFor(index),
      calories: result.calories,
      fat: result.fat,
      carbs: result.carbs,
      fiber: result.fiber,
      protein: result.protein,
      quantity: quantityFor(index),
    };
    onLogEntry(entry);
    setResultQuantities((previous) => ({ ...previous, [index]: '1' }));
  };

  return (
    <section className="nutrition-search">
      <form className="nutrition-search-form" onSubmit={handleSearch}>
        <input
          placeholder="Search food database…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Food search query"
        />
        <button className="btn-primary nutrition-search-btn" type="submit" disabled={loading} aria-label="Search">
          <Search size={18} />
        </button>
      </form>
      {loading && <p className="nutrition-search-status">Searching…</p>}
      {error && <p className="nutrition-search-status nutrition-search-error">{error}</p>}
      {searched && !loading && results.length === 0 && (
        <p className="nutrition-search-status">No results found.</p>
      )}
      {results.length > 0 && (
        <ul className="nutrition-search-results">
          {results.map((result, index) => (
            <li className="nutrition-search-result" key={`${result.product_name}-${result.brand}-${index}`}>
              <div className="nutrition-search-result-info">
                <span className="nutrition-search-result-name">{result.product_name}</span>
                {result.brand && <span className="nutrition-search-result-brand">{result.brand}</span>}
                <small>
                  {result.servingLabel} · {result.calories} cal · Fat {result.fat}g · Carbs {result.carbs}g · Fiber {result.fiber}g · Protein {result.protein}g
                </small>
              </div>
              <div className="nutrition-search-result-add">
                <select
                  aria-label="Category"
                  value={categoryFor(index)}
                  onChange={(event) => setResultCategories((previous) => ({ ...previous, [index]: event.target.value as MealCategory }))}
                >
                  {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                </select>
                <input
                  aria-label="Servings"
                  type="number"
                  min="0.01"
                  step="any"
                  value={resultQuantities[index] ?? '1'}
                  onChange={(event) => setResultQuantities((previous) => ({ ...previous, [index]: event.target.value }))}
                />
                <button aria-label={`Add ${result.product_name} to day`} onClick={() => addToDay(result, index)}>
                  <Plus size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NutritionView({ items, entries, dailyCalorieGoal, dailyProteinGoalGrams, onSaveItems, onLogEntry, onDeleteEntry }: Props) {
  const [date, setDate] = useState(localDate);
  const [showSavedForm, setShowSavedForm] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savedCategory, setSavedCategory] = useState<MealCategory>('Breakfast');
  const [savedMacros, setSavedMacros] = useState<MacroInputs>(EMPTY_MACROS);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<MealCategory>('Snacks');
  const [customMacros, setCustomMacros] = useState<MacroInputs>(EMPTY_MACROS);
  const [customQuantity, setCustomQuantity] = useState('1');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const dayEntries = useMemo(() => entries.filter((entry) => entry.date === date), [entries, date]);
  const dayEntriesByCategory = useMemo(() => CATEGORIES.map((category) => ({
    category,
    entries: dayEntries.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0), [dayEntries]);
  const totals = useMemo(
    () => dayEntries.reduce((sum, entry) => ({
      calories: sum.calories + entry.calories * entry.quantity, fat: sum.fat + entry.fat * entry.quantity,
      carbs: sum.carbs + entry.carbs * entry.quantity, fiber: sum.fiber + entry.fiber * entry.quantity,
      protein: sum.protein + entry.protein * entry.quantity,
    }), { calories: 0, fat: 0, carbs: 0, fiber: 0, protein: 0 }),
    [dayEntries],
  );
  const itemsByCategory = useMemo(() => new Map(CATEGORIES.map((category) => [
    category,
    items.filter((item) => item.category === category).sort((a, b) => a.name.localeCompare(b.name)),
  ])), [items]);
  const calorieGoalStatus = useMemo<GoalStatus>(() => {
    if (dailyCalorieGoal <= 0) return null;
    if (totals.calories > dailyCalorieGoal) return 'over';
    return totals.calories >= dailyCalorieGoal * 0.9 ? 'good' : 'warn';
  }, [dailyCalorieGoal, totals.calories]);
  const proteinGoalStatus = useMemo<GoalStatus>(() => {
    if (dailyProteinGoalGrams <= 0) return null;
    const diff = Math.abs(totals.protein - dailyProteinGoalGrams);
    return diff <= dailyProteinGoalGrams * 0.1 ? 'good' : 'warn';
  }, [dailyProteinGoalGrams, totals.protein]);

  const quantityFor = (id: string) => {
    const value = Number(quantities[id] ?? '1');
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const logItem = (item: MealItem) => {
    onLogEntry({ ...item, id: newId(), date, quantity: quantityFor(item.id) });
    setQuantities((previous) => ({ ...previous, [item.id]: '1' }));
  };

  const toggleCategory = (category: MealCategory) =>
    setOpenCategories((previous) => ({ ...previous, [category]: !previous[category] }));

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
    const quantity = Number(customQuantity);
    const entry: MealLogEntry = {
      id: newId(), date, name: customName.trim(), category: customCategory,
      ...macrosFrom(customMacros), quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    };
    if (!entry.name) return;
    onLogEntry(entry);
    setCustomName('');
    setCustomMacros(EMPTY_MACROS);
    setCustomQuantity('1');
  };

  return (
    <main className="nutrition-view">
      <div className="nutrition-heading">
        <h2>Nutrition</h2>
        <input aria-label="Log date" type="date" max={localDate()} value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <section className="nutrition-totals">
        <strong className={statusClass(calorieGoalStatus)}>
          {round(totals.calories)} cal{dailyCalorieGoal > 0 ? ` / ${round(dailyCalorieGoal)}` : ''}
        </strong>
        <span>Fat {round(totals.fat)}g</span><span>Carbs {round(totals.carbs)}g</span>
        <span>Fiber {round(totals.fiber)}g</span>
        <span className={statusClass(proteinGoalStatus)}>
          Protein {round(totals.protein)}{dailyProteinGoalGrams > 0 ? ` / ${round(dailyProteinGoalGrams)}` : ''}g
        </span>
      </section>

      {CATEGORIES.map((category) => {
        const categoryItems = itemsByCategory.get(category) ?? [];
        const open = openCategories[category] ?? false;
        return (
          <section className="nutrition-category" key={category}>
            <button className="nutrition-category-toggle" aria-expanded={open} onClick={() => toggleCategory(category)}>
              {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <h3>{category}</h3>
              <small>{categoryItems.length}</small>
            </button>
            {open && (
              <div className="nutrition-category-body">
                {categoryItems.length === 0
                  ? <p className="nutrition-empty">No saved items yet.</p>
                  : categoryItems.map((item) => (
                    <div className="nutrition-item" key={item.id}>
                      <span>{item.name}<small>{item.calories} cal · Fat {item.fat}g · Carbs {item.carbs}g · Fiber {item.fiber}g · Protein {item.protein}g</small></span>
                      <div className="nutrition-item-add">
                        <input
                          aria-label={`Servings of ${item.name}`}
                          type="number"
                          min="0"
                          step="any"
                          value={quantities[item.id] ?? '1'}
                          onChange={(event) => setQuantities((previous) => ({ ...previous, [item.id]: event.target.value }))}
                        />
                        <button aria-label={`Add ${item.name} to day`} onClick={() => logItem(item)}><Plus size={18} /></button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        );
      })}

      <FoodSearch date={date} onLogEntry={onLogEntry} />

      <section className="nutrition-actions">
        <button className="btn-new-workout" onClick={() => setShowSavedForm((show) => !show)}>
          <Plus size={20} /> New Saved Item
        </button>
        {showSavedForm && (
          <form className="nutrition-form" onSubmit={saveItem}>
            <select value={savedCategory} onChange={(event) => setSavedCategory(event.target.value as MealCategory)}>
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
            <input placeholder="Food or drink name" value={savedName} onChange={(event) => setSavedName(event.target.value)} required />
            <MacroFields values={savedMacros} onChange={setSavedMacros} />
            <button className="btn-primary" type="submit">Save Item</button>
          </form>
        )}
        <form className="nutrition-form" onSubmit={logCustom}>
          <h3>Quick Add</h3>
          <select value={customCategory} onChange={(event) => setCustomCategory(event.target.value as MealCategory)}>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
          <input placeholder="Meal or item name" value={customName} onChange={(event) => setCustomName(event.target.value)} required />
          <label className="nutrition-quantity-field">
            Servings
            <input type="number" min="0" step="any" value={customQuantity} onChange={(event) => setCustomQuantity(event.target.value)} />
          </label>
          <MacroFields values={customMacros} onChange={setCustomMacros} />
          <button className="btn-primary" type="submit">Add to Day</button>
        </form>
      </section>

      <section className="nutrition-day">
        <h3>Today's Meals</h3>
        {dayEntries.length === 0
          ? <p className="nutrition-empty">Nothing logged for this day yet.</p>
          : dayEntriesByCategory.map((group) => (
            <div className="nutrition-day-category" key={group.category}>
              <h4 className="nutrition-day-category-label">{group.category}</h4>
              {group.entries.map((entry) => (
                <div className="nutrition-entry" key={entry.id}>
                  <span>
                    {entry.name}
                    {entry.quantity !== 1 && <em aria-label={`${round(entry.quantity)} servings`}> &times;{round(entry.quantity)}</em>}
                    <small>{round(entry.calories * entry.quantity)} cal</small>
                  </span>
                  <button aria-label={`Delete ${entry.name}`} className="nutrition-delete" onClick={() => onDeleteEntry(entry.id)}>
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          ))}
      </section>
    </main>
  );
}
