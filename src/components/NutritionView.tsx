import { useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, Star, Trash2 } from 'lucide-react';
import type { FoodItem, GarminWellnessEntry, MealCategory, MealItem, MealLogEntry } from '../model/index.js';
import { deduplicateFoodSearchResults } from '../model/nutrition.js';
import type { StravaAggregation, StravaTimeRange } from '../model/strava.js';
import { getTimeRangeOptions } from '../model/strava.js';
import { NutritionCharts } from './NutritionCharts.js';

const CATEGORIES: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Drinks'];

/** Maximum number of recently-used foods to retain. */
const RECENTS_CAP = 50;

/** Servings step for the quantity +/- controls. */
const QTY_STEP = 0.25;

type FinderView = 'favorites' | 'recent' | 'items' | 'search';

interface Props {
  favorites: FoodItem[];
  recents: FoodItem[];
  mealItems: MealItem[];
  entries: MealLogEntry[];
  wellnessEntries?: GarminWellnessEntry[];
  dailyCalorieGoal: number;
  dailyProteinGoalGrams: number;
  dailyFiberGoalGrams: number;
  drinksPerDayGoal: number;
  onFavoritesChange: (favorites: FoodItem[]) => void;
  onRecentsChange: (recents: FoodItem[]) => void;
  onMealItemsChange: (items: MealItem[]) => void;
  onLogEntry: (entry: MealLogEntry) => void;
  onAdjustEntry: (id: string, quantity: number) => void;
  onDeleteEntry: (id: string) => void;
  onChangeCategoryEntry: (ids: string[], category: MealCategory) => void;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Round to nearest whole number for tidy macro display. */
function round(value: number): number {
  return Math.round(value);
}

/** Round quantity values to 2 decimals to avoid floating-point drift. */
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Format quantity values with up to two decimals, trimming trailing zeroes. */
function formatQuantity(value: number): string {
  return roundQuantity(value).toString();
}

/** Snap a servings value to the nearest step, clamped to a single step minimum. */
function snapQuantity(value: number): number {
  const snapped = Math.round(value / QTY_STEP) * QTY_STEP;
  return roundQuantity(Math.max(QTY_STEP, snapped));
}

/** Step a servings string by delta, clamped to a positive multiple of QTY_STEP. */
function stepQuantity(current: string, delta: number): string {
  const value = Number(current);
  const base = Number.isFinite(value) && value > 0 ? value : 1;
  return String(snapQuantity(base + delta));
}

/** Fraction of a goal that counts as "close enough" (within 10%). */
const GOAL_PROXIMITY_THRESHOLD = 0.1;

type GoalStatus = 'good' | 'warn' | 'over' | null;

function statusClass(status: GoalStatus): string {
  return status ? `nutrition-goal-${status}` : '';
}

/** Return the ISO dates for the Monday and Sunday of the week containing the given YYYY-MM-DD date. */
function getWeekBounds(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00`);
  const dayOfWeek = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { start: fmt(monday), end: fmt(sunday) };
}

/** Prepend a food to the recents list, de-duplicating by code and capping the length. */
function withRecent(recents: FoodItem[], food: FoodItem): FoodItem[] {
  return [food, ...recents.filter((item) => item.code !== food.code)].slice(0, RECENTS_CAP);
}

/** A single combined line in "Today's Meals": one food, summed across duplicate log rows. */
interface DayGroup {
  key: string;
  category: MealCategory;
  name: string;
  caloriesPerServing: number;
  quantity: number;
  /** The log-entry ids that make up this group (usually one after log-time merge). */
  ids: string[];
  /** The id whose quantity the +/- controls adjust. */
  primaryId: string;
  primaryQuantity: number;
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
  alcohol_serving?: number;
  alcohol_100g?: number;
}

interface OFFProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number;
  nutriments?: OFFNutriments;
}

const OPEN_FOOD_FACTS_STAGING_SEARCH_URL = 'https://world.openfoodfacts.net/cgi/search.pl';
const OPEN_FOOD_FACTS_STAGING_AUTH = 'Basic b2ZmOm9mZg==';

function parseOFFProduct(product: OFFProduct): FoodItem | null {
  const name = (product.product_name ?? '').trim();
  if (!name) return null;
  const code = (product.code ?? '').trim();
  if (!code) return null;
  const n = product.nutriments ?? {};
  const servingQty = product.serving_quantity ?? 100;

  // Prefer per-serving values; fall back to per-100g scaled by serving size
  const cal = n['energy-kcal_serving'] ?? ((n['energy-kcal_100g'] ?? 0) * servingQty / 100);
  const fat = n['fat_serving'] ?? ((n['fat_100g'] ?? 0) * servingQty / 100);
  const carbs = n['carbohydrates_serving'] ?? ((n['carbohydrates_100g'] ?? 0) * servingQty / 100);
  const fiber = n['fiber_serving'] ?? ((n['fiber_100g'] ?? 0) * servingQty / 100);
  const protein = n['proteins_serving'] ?? ((n['proteins_100g'] ?? 0) * servingQty / 100);
  // Standard drinks: 1 US standard drink = 14 g pure alcohol
  const alcoholGrams = n['alcohol_serving'] ?? ((n['alcohol_100g'] ?? 0) * servingQty / 100);
  const standardDrinks = Math.round(alcoholGrams / 14 * 100) / 100;

  // Drop products where all macros are zero (likely incomplete data)
  if (cal === 0 && fat === 0 && carbs === 0 && protein === 0) return null;

  return {
    code,
    name,
    brand: (product.brands ?? '').split(',')[0].trim(),
    servingLabel: product.serving_size ?? `${servingQty}g`,
    calories: Math.round(cal),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    fiber: Math.round(fiber),
    protein: Math.round(protein),
    standardDrinks,
  };
}

async function searchOpenFoodFacts(query: string, signal: AbortSignal): Promise<FoodItem[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '20',
    fields: 'code,product_name,brands,serving_size,serving_quantity,nutriments',
    // Restrict to products that have an English entry
    tagtype_0: 'languages',
    tag_contains_0: 'contains',
    tag_0: 'en',
    // Exclude meat products (seafood is a separate branch and is not affected)
    tagtype_1: 'categories',
    tag_contains_1: 'does_not_contain',
    tag_1: 'en:meats-and-their-products',
    // Restrict to products sold in the US to reduce irrelevant international results
    tagtype_2: 'countries',
    tag_contains_2: 'contains',
    tag_2: 'en:united-states',
  });
  const response = await fetch(`${OPEN_FOOD_FACTS_STAGING_SEARCH_URL}?${params.toString()}`, {
    signal,
    headers: {
      Authorization: OPEN_FOOD_FACTS_STAGING_AUTH,
    },
  });
  if (!response.ok) throw new Error(`Search failed: ${response.statusText || 'request error'} (${response.status})`);
  const data = (await response.json()) as { products?: OFFProduct[] };
  const foods = (data.products ?? []).flatMap((product) => {
    const parsed = parseOFFProduct(product);
    return parsed ? [parsed] : [];
  });
  return deduplicateFoodSearchResults(foods);
}

/* ── Food finder row ────────────────────────────────────────────────────── */

interface FoodRowProps {
  food: FoodItem;
  isFavorite: boolean;
  category: MealCategory;
  quantity: string;
  drinks: string;
  onCategoryChange: (category: MealCategory) => void;
  onQuantityChange: (quantity: string) => void;
  onDrinksChange: (drinks: string) => void;
  onToggleFavorite: () => void;
  onAdd: () => void;
}

function FoodRow({ food, isFavorite, category, quantity, drinks, onCategoryChange, onQuantityChange, onDrinksChange, onToggleFavorite, onAdd }: FoodRowProps) {
  return (
    <li className="nutrition-food-row">
      <button
        className={`nutrition-star${isFavorite ? ' is-active' : ''}`}
        aria-label={isFavorite ? `Remove ${food.name} from favorites` : `Add ${food.name} to favorites`}
        aria-pressed={isFavorite}
        onClick={onToggleFavorite}
      >
        <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
      <div className="nutrition-food-info">
        <span className="nutrition-food-name">{food.name}</span>
        {food.brand && <span className="nutrition-food-brand">{food.brand}</span>}
        <small className="nutrition-food-serving">Serving: {food.servingLabel}</small>
        <small>
          {food.calories} cal · Fat {food.fat}g · Carbs {food.carbs}g · Fiber {food.fiber}g · Protein {food.protein}g
        </small>
      </div>
      <div className="nutrition-food-add">
        <select
          aria-label={`Meal for ${food.name}`}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as MealCategory)}
        >
          {CATEGORIES.map((option) => <option key={option}>{option}</option>)}
        </select>
        <div className="nutrition-qty-stepper">
          <button
            type="button"
            aria-label={`Decrease servings of ${food.name}`}
            onClick={() => onQuantityChange(stepQuantity(quantity, -QTY_STEP))}
          >
            <Minus size={14} />
          </button>
          <input
            aria-label={`Servings of ${food.name}`}
            type="number"
            min={QTY_STEP}
            step={QTY_STEP}
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
          />
          <button
            type="button"
            aria-label={`Increase servings of ${food.name}`}
            onClick={() => onQuantityChange(stepQuantity(quantity, QTY_STEP))}
          >
            <Plus size={14} />
          </button>
        </div>
        {category === 'Drinks' && (
          <input
            className="nutrition-drinks-input"
            aria-label={`Alcoholic drinks per serving of ${food.name}`}
            type="number"
            min={0}
            step="any"
            placeholder="drinks"
            value={drinks}
            onChange={(event) => onDrinksChange(event.target.value)}
          />
        )}
        <button className="nutrition-food-add-btn" aria-label={`Add ${food.name} to day`} onClick={onAdd}>
          <Plus size={18} />
        </button>
      </div>
    </li>
  );
}

interface MealItemRowProps {
  item: MealItem;
  isFavorite: boolean;
  category: MealCategory;
  quantity: string;
  drinks: string;
  onCategoryChange: (category: MealCategory) => void;
  onQuantityChange: (quantity: string) => void;
  onDrinksChange: (drinks: string) => void;
  onToggleFavorite: () => void;
  onAdd: () => void;
}

function MealItemRow({ item, isFavorite, category, quantity, drinks, onCategoryChange, onQuantityChange, onDrinksChange, onToggleFavorite, onAdd }: MealItemRowProps) {
  return (
    <li className="nutrition-food-row">
      <button
        className={`nutrition-star${isFavorite ? ' is-active' : ''}`}
        aria-label={isFavorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
        aria-pressed={isFavorite}
        onClick={onToggleFavorite}
      >
        <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
      <div className="nutrition-food-info">
        <span className="nutrition-food-name">{item.name}</span>
        <small>
          {item.calories} cal · Fat {item.fat}g · Carbs {item.carbs}g · Fiber {item.fiber}g · Protein {item.protein}g
        </small>
      </div>
      <div className="nutrition-food-add">
        <select
          aria-label={`Meal for ${item.name}`}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as MealCategory)}
        >
          {CATEGORIES.map((option) => <option key={option}>{option}</option>)}
        </select>
        <div className="nutrition-qty-stepper">
          <button
            type="button"
            aria-label={`Decrease servings of ${item.name}`}
            onClick={() => onQuantityChange(stepQuantity(quantity, -QTY_STEP))}
          >
            <Minus size={14} />
          </button>
          <input
            aria-label={`Servings of ${item.name}`}
            type="number"
            min={QTY_STEP}
            step={QTY_STEP}
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
          />
          <button
            type="button"
            aria-label={`Increase servings of ${item.name}`}
            onClick={() => onQuantityChange(stepQuantity(quantity, QTY_STEP))}
          >
            <Plus size={14} />
          </button>
        </div>
        {category === 'Drinks' && (
          <input
            className="nutrition-drinks-input"
            aria-label={`Alcoholic drinks per serving of ${item.name}`}
            type="number"
            min={0}
            step="any"
            placeholder="drinks"
            value={drinks}
            onChange={(event) => onDrinksChange(event.target.value)}
          />
        )}
        <button className="nutrition-food-add-btn" aria-label={`Add ${item.name} to day`} onClick={onAdd}>
          <Plus size={18} />
        </button>
      </div>
    </li>
  );
}


export function NutritionView({
  favorites,
  recents,
  mealItems,
  entries,
  wellnessEntries,
  dailyCalorieGoal,
  dailyProteinGoalGrams,
  dailyFiberGoalGrams,
  drinksPerDayGoal,
  onFavoritesChange,
  onRecentsChange,
  onMealItemsChange,
  onLogEntry,
  onAdjustEntry,
  onDeleteEntry,
  onChangeCategoryEntry,
}: Props) {
  const [date, setDate] = useState(localDate);
  const [view, setView] = useState<FinderView | null>(null);
  const [categories, setCategories] = useState<Record<string, MealCategory>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [drinks, setDrinks] = useState<Record<string, string>>({});
  const [chartRange, setChartRange] = useState<StravaTimeRange>('month');
  const [chartAggregation, setChartAggregation] = useState<StravaAggregation>('day');
  const timeRanges = useMemo(() => getTimeRangeOptions(new Date()), []);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const favoriteCodes = useMemo(() => new Set(favorites.map((food) => food.code)), [favorites]);

  const dayEntries = useMemo(() => entries.filter((entry) => entry.date === date), [entries, date]);

  // Combine duplicate foods (same meal, name, and per-serving calories) into a
  // single summed line so logging the same food twice shows one entry.
  const dayGroups = useMemo(() => {
    const byCategory = new Map<MealCategory, DayGroup[]>();
    for (const category of CATEGORIES) byCategory.set(category, []);
    for (const entry of dayEntries) {
      const groups = byCategory.get(entry.category);
      if (!groups) continue;
      const key = `${entry.name}\u0000${entry.calories}`;
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.quantity = roundQuantity(existing.quantity + entry.quantity);
        existing.ids.push(entry.id);
      } else {
        groups.push({
          key,
          category: entry.category,
          name: entry.name,
          caloriesPerServing: entry.calories,
          quantity: entry.quantity,
          ids: [entry.id],
          primaryId: entry.id,
          primaryQuantity: entry.quantity,
        });
      }
    }
    return CATEGORIES
      .map((category) => ({ category, groups: byCategory.get(category) ?? [] }))
      .filter((section) => section.groups.length > 0);
  }, [dayEntries]);

  const totals = useMemo(
    () => dayEntries.reduce((sum, entry) => ({
      calories: sum.calories + entry.calories * entry.quantity, fat: sum.fat + entry.fat * entry.quantity,
      carbs: sum.carbs + entry.carbs * entry.quantity, fiber: sum.fiber + entry.fiber * entry.quantity,
      protein: sum.protein + entry.protein * entry.quantity,
      drinks: sum.drinks + (entry.standardDrinks ?? 0) * entry.quantity,
    }), { calories: 0, fat: 0, carbs: 0, fiber: 0, protein: 0, drinks: 0 }),
    [dayEntries],
  );
  const macroCaloriePercentages = useMemo(() => {
    const carbsCalories = totals.carbs * 4;
    const proteinCalories = totals.protein * 4;
    const fatCalories = totals.fat * 9;
    const macroCalories = carbsCalories + proteinCalories + fatCalories;
    if (macroCalories <= 0) return { carbs: 0, protein: 0, fat: 0 };
    return {
      carbs: round((carbsCalories / macroCalories) * 100),
      protein: round((proteinCalories / macroCalories) * 100),
      fat: round((fatCalories / macroCalories) * 100),
    };
  }, [totals.carbs, totals.fat, totals.protein]);

  // Weekly standard drinks: sum for the 7-day window containing the selected date (Mon–Sun)
  const weeklyDrinks = useMemo(() => {
    const { start, end } = getWeekBounds(date);
    return entries
      .filter((e) => e.date >= start && e.date <= end)
      .reduce((sum, e) => sum + (e.standardDrinks ?? 0) * e.quantity, 0);
  }, [entries, date]);

  const calorieGoalStatus = useMemo<GoalStatus>(() => {
    if (dailyCalorieGoal <= 0) return null;
    if (totals.calories > dailyCalorieGoal) return 'over';
    return totals.calories >= dailyCalorieGoal * (1 - GOAL_PROXIMITY_THRESHOLD) ? 'good' : 'warn';
  }, [dailyCalorieGoal, totals.calories]);
  const proteinGoalStatus = useMemo<GoalStatus>(() => {
    if (dailyProteinGoalGrams <= 0) return null;
    const diff = Math.abs(totals.protein - dailyProteinGoalGrams);
    return diff <= dailyProteinGoalGrams * GOAL_PROXIMITY_THRESHOLD ? 'good' : 'warn';
  }, [dailyProteinGoalGrams, totals.protein]);
  const fiberGoalStatus = useMemo<GoalStatus>(() => {
    if (dailyFiberGoalGrams <= 0) return null;
    const diff = Math.abs(totals.fiber - dailyFiberGoalGrams);
    return diff <= dailyFiberGoalGrams * GOAL_PROXIMITY_THRESHOLD ? 'good' : 'warn';
  }, [dailyFiberGoalGrams, totals.fiber]);
  const weeklyAlcoholGoal = drinksPerDayGoal > 0 ? drinksPerDayGoal * 7 : 0;
  const weeklyAlcoholStatus = useMemo<GoalStatus>(() => {
    if (weeklyAlcoholGoal <= 0) return null;
    if (weeklyDrinks > weeklyAlcoholGoal) return 'over';
    return weeklyDrinks >= weeklyAlcoholGoal * (1 - GOAL_PROXIMITY_THRESHOLD) ? 'good' : 'warn';
  }, [weeklyAlcoholGoal, weeklyDrinks]);
  const drinksGoalStatus = useMemo<GoalStatus>(() => {
    if (drinksPerDayGoal <= 0) return null;
    const ratio = totals.drinks / drinksPerDayGoal;
    if (ratio < 0.9) return 'warn';
    return ratio <= 1.1 ? 'good' : 'over';
  }, [drinksPerDayGoal, totals.drinks]);

  const categoryFor = (code: string): MealCategory => categories[code] ?? 'Snacks';
  const quantityValue = (code: string): string => quantities[code] ?? '1';
  const quantityFor = (code: string): number => {
    const value = Number(quantityValue(code));
    return Number.isFinite(value) && value > 0 ? value : 1;
  };
  const drinksValue = (code: string): string => drinks[code] ?? '';
  const drinksFor = (code: string): number => {
    const value = Number(drinksValue(code));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  const toggleFavorite = (food: FoodItem) => {
    onFavoritesChange(
      favoriteCodes.has(food.code)
        ? favorites.filter((item) => item.code !== food.code)
        : [...favorites, food],
    );
  };

  const toggleMealItemFavorite = (item: MealItem) => {
    onMealItemsChange(mealItems.map((m) => m.id === item.id ? { ...m, favorite: !m.favorite } : m));
  };

  const addToDay = (food: FoodItem) => {
    const category = categoryFor(food.code);
    const entry: MealLogEntry = {
      id: newId(),
      date,
      name: food.name,
      category,
      calories: food.calories,
      fat: food.fat,
      carbs: food.carbs,
      fiber: food.fiber,
      protein: food.protein,
      quantity: quantityFor(food.code),
      standardDrinks: category === 'Drinks' ? (drinksFor(food.code) || food.standardDrinks || 1) : food.standardDrinks,
    };
    onLogEntry(entry);
    onRecentsChange(withRecent(recents, food));
    setQuantities((previous) => ({ ...previous, [food.code]: '1' }));
    setDrinks((previous) => ({ ...previous, [food.code]: '' }));
  };

  const adjustGroup = (group: DayGroup, delta: number) => {
    const next = snapQuantity(group.primaryQuantity + delta);
    if (next !== group.primaryQuantity) onAdjustEntry(group.primaryId, next);
  };

  const deleteGroup = (group: DayGroup) => {
    for (const id of group.ids) onDeleteEntry(id);
  };

  const changeCategoryGroup = (group: DayGroup, category: MealCategory) => {
    onChangeCategoryEntry(group.ids, category);
  };

  const renderFoodRow = (food: FoodItem) => (
    <FoodRow
      key={food.code}
      food={food}
      isFavorite={favoriteCodes.has(food.code)}
      category={categoryFor(food.code)}
      quantity={quantityValue(food.code)}
      drinks={drinksValue(food.code)}
      onCategoryChange={(category) => setCategories((previous) => ({ ...previous, [food.code]: category }))}
      onQuantityChange={(quantity) => setQuantities((previous) => ({ ...previous, [food.code]: quantity }))}
      onDrinksChange={(value) => setDrinks((previous) => ({ ...previous, [food.code]: value }))}
      onToggleFavorite={() => toggleFavorite(food)}
      onAdd={() => addToDay(food)}
    />
  );

  const addMealItemToDay = (item: MealItem) => {
    const category = categoryFor(item.id);
    const entry: MealLogEntry = {
      id: newId(),
      date,
      name: item.name,
      category,
      calories: item.calories,
      fat: item.fat,
      carbs: item.carbs,
      fiber: item.fiber,
      protein: item.protein,
      quantity: quantityFor(item.id),
      standardDrinks: category === 'Drinks' ? (drinksFor(item.id) || item.standardDrinks || 1) : item.standardDrinks,
    };
    onLogEntry(entry);
    setQuantities((previous) => ({ ...previous, [item.id]: '1' }));
    setDrinks((previous) => ({ ...previous, [item.id]: '' }));
  };

  const renderMealItemRow = (item: MealItem) => (
    <MealItemRow
      key={item.id}
      item={item}
      isFavorite={item.favorite === true}
      category={categoryFor(item.id)}
      quantity={quantityValue(item.id)}
      drinks={drinksValue(item.id)}
      onCategoryChange={(category) => setCategories((previous) => ({ ...previous, [item.id]: category }))}
      onQuantityChange={(quantity) => setQuantities((previous) => ({ ...previous, [item.id]: quantity }))}
      onDrinksChange={(value) => setDrinks((previous) => ({ ...previous, [item.id]: value }))}
      onToggleFavorite={() => toggleMealItemFavorite(item)}
      onAdd={() => addMealItemToDay(item)}
    />
  );

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

  const toggleView = (option: FinderView) => {
    setView((current) => (current === option ? null : option));
  };

  return (
    <main className="nutrition-view">
      <div className="nutrition-heading">
        <h2>Nutrition</h2>
        <input aria-label="Log date" type="date" max={localDate()} value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <section className="nutrition-totals">
        <div className="nutrition-totals-row nutrition-totals-row-top">
          <strong className={statusClass(calorieGoalStatus)}>
            {round(totals.calories)} cal{dailyCalorieGoal > 0 ? ` / ${round(dailyCalorieGoal)}` : ''}
          </strong>
          <span className={statusClass(proteinGoalStatus)}>
            Protein {round(totals.protein)}{dailyProteinGoalGrams > 0 ? ` / ${round(dailyProteinGoalGrams)}` : ''}g
          </span>
        </div>
        <div className="nutrition-totals-row nutrition-totals-row-bottom">
          <span>Fat {round(totals.fat)}g</span><span>Carbs {round(totals.carbs)}g</span>
          <span className={statusClass(fiberGoalStatus)}>
            Fiber {round(totals.fiber)}{dailyFiberGoalGrams > 0 ? ` / ${round(dailyFiberGoalGrams)}` : ''}g
          </span>
          {(totals.drinks > 0 || weeklyAlcoholGoal > 0) && (
            <span className={`nutrition-drinks${weeklyAlcoholStatus ? ` ${statusClass(weeklyAlcoholStatus)}` : ''}`}>
              🍺 {round(totals.drinks)} drinks today · {round(weeklyDrinks)} this week{weeklyAlcoholGoal > 0 ? ` / ${weeklyAlcoholGoal}` : ''}
            </span>
          )}
        </div>
        <div className="nutrition-totals-row nutrition-totals-row-macro-percent">
          <span>
            Calories by macro: Carbs {macroCaloriePercentages.carbs}% · Protein {macroCaloriePercentages.protein}% · Fat {macroCaloriePercentages.fat}%
          </span>
        </div>
      </section>

      <div className="nutrition-finder-toggle" role="tablist" aria-label="Find food">
        {(['favorites', 'recent', 'items', 'search'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            className={`nutrition-finder-tab${view === option ? ' is-active' : ''}`}
            onClick={() => toggleView(option)}
          >
            {option === 'favorites' ? 'Favorites' : option === 'recent' ? 'Recent' : option === 'items' ? 'My Items' : 'Search'}
          </button>
        ))}
      </div>

      {view === 'search' && (
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
            <ul className="nutrition-food-list">{results.map(renderFoodRow)}</ul>
          )}
        </section>
      )}

      {view === 'favorites' && (() => {
        const starredItems = mealItems.filter((m) => m.favorite === true);
        return (
          <section className="nutrition-finder">
            {favorites.length === 0 && starredItems.length === 0
              ? <p className="nutrition-empty">No favorites yet. Star a food or custom item to keep it here.</p>
              : <>
                  {favorites.length > 0 && <ul className="nutrition-food-list">{favorites.map(renderFoodRow)}</ul>}
                  {starredItems.length > 0 && (
                    <ul className="nutrition-food-list">{starredItems.map(renderMealItemRow)}</ul>
                  )}
                </>}
          </section>
        );
      })()}

      {view === 'recent' && (
        <section className="nutrition-finder">
          {recents.length === 0
            ? <p className="nutrition-empty">No recent foods yet. Foods you log will appear here.</p>
            : <ul className="nutrition-food-list">{recents.map(renderFoodRow)}</ul>}
        </section>
      )}

      {view === 'items' && (
        <section className="nutrition-finder">
          {mealItems.length === 0
            ? <p className="nutrition-empty">No custom items found. Add items to the Meal Items sheet tab.</p>
            : <ul className="nutrition-food-list">{mealItems.map(renderMealItemRow)}</ul>}
        </section>
      )}

      <section className="nutrition-day">
        <h3>Today's Meals</h3>
        {dayGroups.length === 0
          ? <p className="nutrition-empty">Nothing logged for this day yet.</p>
          : dayGroups.map((section) => (
            <div className="nutrition-day-category" key={section.category}>
              <h4 className="nutrition-day-category-label">{section.category}</h4>
              {section.groups.map((group) => (
                <div className="nutrition-entry" key={group.key}>
                  <span className="nutrition-entry-info">
                    {group.name}
                    <small>{round(group.caloriesPerServing * group.quantity)} cal</small>
                  </span>
                  <div className="nutrition-entry-controls">
                    <select
                      className="nutrition-entry-category-select"
                      aria-label={`Category for ${group.name}`}
                      value={group.category}
                      onChange={(event) => changeCategoryGroup(group, event.target.value as MealCategory)}
                    >
                      {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <div className="nutrition-qty-stepper">
                      <button type="button" aria-label={`Decrease servings of ${group.name}`} onClick={() => adjustGroup(group, -QTY_STEP)}>
                        <Minus size={14} />
                      </button>
                      <span className="nutrition-entry-qty" aria-label={`${formatQuantity(group.quantity)} servings`}>&times;{formatQuantity(group.quantity)}</span>
                      <button type="button" aria-label={`Increase servings of ${group.name}`} onClick={() => adjustGroup(group, QTY_STEP)}>
                        <Plus size={14} />
                      </button>
                    </div>
                    <button aria-label={`Delete ${group.name}`} className="nutrition-delete" onClick={() => deleteGroup(group)}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </section>

      <section className="nutrition-charts-section">
        <div className="nutrition-charts-header">
          <h3>Trends</h3>
          <div className="chart-controls-sticky nutrition-chart-controls">
            <div className="strava-range-group">
              {timeRanges.map((r) => (
                <button
                  key={r.value}
                  className={`strava-range-btn${chartRange === r.value ? ' active' : ''}`}
                  onClick={() => setChartRange(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="strava-agg-group">
              {(['day', 'week', 'month'] as StravaAggregation[]).map((agg) => (
                <button
                  key={agg}
                  className={`strava-agg-btn${chartAggregation === agg ? ' active' : ''}`}
                  onClick={() => setChartAggregation(agg)}
                >
                  {agg.charAt(0).toUpperCase() + agg.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <NutritionCharts
          entries={entries}
          wellnessEntries={wellnessEntries}
          range={chartRange}
          aggregation={chartAggregation}
          calorieGoal={dailyCalorieGoal}
          proteinGoal={dailyProteinGoalGrams}
          fiberGoal={dailyFiberGoalGrams}
          drinksGoal={drinksPerDayGoal}
        />
      </section>
    </main>
  );
}
