import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, AlertTriangle, Check, Loader, Unlink, Sliders } from 'lucide-react';
import { parseHevyCsv, convertHevyRows, computeImportSummary } from '../model/hevy-import.js';
import { clearSheetId } from '../google/storage.js';
import type { ImportSummary } from '../model/hevy-import.js';
import type { AppSettings, AppBooleanSettingKey, AppPercentSettingKey } from '../model/index.js';

interface Props {
  spreadsheetId: string;
  onImportComplete: () => void;
  appendLogRows: (spreadsheetId: string, rows: (string | number | boolean)[][]) => Promise<void>;
  onDisconnectSheet: () => void;
  appSettings: AppSettings;
  onAppSettingChange: (key: AppBooleanSettingKey, value: boolean) => void;
  onAppPercentSettingChange: (key: AppPercentSettingKey, value: number) => void;
}

type ImportPhase = 'idle' | 'preview' | 'importing' | 'done' | 'error';

export function SettingsView({ spreadsheetId, onImportComplete, appendLogRows, onDisconnectSheet, appSettings, onAppSettingChange, onAppPercentSettingChange }: Props) {
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [convertedRows, setConvertedRows] = useState<(string | number | boolean)[][] | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      const text = await file.text();
      const hevyRows = parseHevyCsv(text);
      if (hevyRows.length === 0) {
        setError('No data rows found in the CSV file.');
        return;
      }
      const rows = convertHevyRows(hevyRows);
      const importSummary = computeImportSummary(hevyRows);
      setConvertedRows(rows);
      setSummary(importSummary);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
      setPhase('error');
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!convertedRows || convertedRows.length === 0) return;

    try {
      setPhase('importing');
      setError(null);
      await appendLogRows(spreadsheetId, convertedRows);
      setImportedCount(convertedRows.length);
      setPhase('done');
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to write to Google Sheet.');
      setPhase('error');
    }
  }, [convertedRows, spreadsheetId, appendLogRows, onImportComplete]);

  const handleReset = useCallback(() => {
    setPhase('idle');
    setSummary(null);
    setConvertedRows(null);
    setImportedCount(0);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">
          <Sliders size={18} />
          Workout Preferences
        </h3>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Rest Timer</span>
            <span className="settings-toggle-description">Show a count-up timer between sets</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.showRestTimer}
            onChange={(e) => onAppSettingChange('showRestTimer', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Set Comments</span>
            <span className="settings-toggle-description">Show rep ranges and notes on sets</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.showSetComments}
            onChange={(e) => onAppSettingChange('showSetComments', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Keep Screen On</span>
            <span className="settings-toggle-description">Prevent the screen from sleeping during workouts</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.keepScreenOn}
            onChange={(e) => onAppSettingChange('keepScreenOn', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Body Comp Dip Filter</span>
            <span className="settings-toggle-description">Skip upward spikes above this % in Withings charts</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0.1}
              max={20}
              step={0.5}
              value={appSettings.withingsDipThresholdPercent}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v > 0 && v <= 100) onAppPercentSettingChange('withingsDipThresholdPercent', v);
              }}
            />
            <span className="settings-percent-unit">%</span>
          </div>
        </div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Progress Dip Filter</span>
            <span className="settings-toggle-description">Skip deload dips below this % in progress charts</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0.1}
              max={50}
              step={1}
              value={appSettings.progressDipThresholdPercent}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v > 0 && v <= 100) onAppPercentSettingChange('progressDipThresholdPercent', v);
              }}
            />
            <span className="settings-percent-unit">%</span>
          </div>
        </div>

        <div className="settings-subsection-title">Nutrition Goals</div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Daily Calories</span>
            <span className="settings-toggle-description">Used to color the nutrition summary</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={20000}
              step={10}
              value={appSettings.dailyCalorieGoal}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 20000) onAppPercentSettingChange('dailyCalorieGoal', v);
              }}
            />
            <span className="settings-percent-unit">cal</span>
          </div>
        </div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Daily Protein</span>
            <span className="settings-toggle-description">Used to color the nutrition summary</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={1000}
              step={1}
              value={appSettings.dailyProteinGoalGrams}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 1000) onAppPercentSettingChange('dailyProteinGoalGrams', v);
              }}
            />
            <span className="settings-percent-unit">g</span>
          </div>
        </div>

      </div>

      <div className="settings-section" style={{ marginTop: '1.5rem' }}>
        <h3 className="settings-section-title">
          <Upload size={18} />
          Import from Hevy
        </h3>

        {/* Instructions */}
        <div className="settings-instructions">
          <p>Import your workout history from Hevy to see it in your progress charts and calendar.</p>
          <p className="settings-instructions-steps">
            <strong>How to export from Hevy:</strong> Profile → Settings → Export & Import Data → Export Workouts
          </p>
        </div>

        {/* Duplicate warning */}
        <div className="settings-warning">
          <AlertTriangle size={14} />
          <span>Re-importing the same file will create duplicate entries. Only import each file once.</span>
        </div>

        {/* File picker */}
        {(phase === 'idle' || phase === 'error') && (
          <div className="settings-file-picker">
            <label className="btn-primary settings-file-label">
              <FileText size={16} />
              Select CSV file
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="settings-file-input"
              />
            </label>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="settings-error">{error}</p>
        )}

        {/* Preview */}
        {phase === 'preview' && summary && (
          <div className="settings-preview">
            <h4 className="settings-preview-title">Import Preview</h4>
            <div className="settings-preview-grid">
              <div className="settings-preview-item">
                <span className="settings-preview-label">Date range</span>
                <span className="settings-preview-value">{summary.dateRange.start} → {summary.dateRange.end}</span>
              </div>
              <div className="settings-preview-item">
                <span className="settings-preview-label">Total sets</span>
                <span className="settings-preview-value">{summary.totalSets.toLocaleString()}</span>
              </div>
              <div className="settings-preview-item">
                <span className="settings-preview-label">Exercises</span>
                <span className="settings-preview-value">{summary.uniqueExercises}</span>
              </div>
              <div className="settings-preview-item">
                <span className="settings-preview-label">Workouts</span>
                <span className="settings-preview-value">{summary.workoutCount}</span>
              </div>
            </div>
            <div className="settings-preview-actions">
              <button className="btn-primary" onClick={handleImport}>
                Import {summary.totalSets.toLocaleString()} sets
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Importing */}
        {phase === 'importing' && (
          <div className="settings-importing">
            <Loader size={20} className="settings-spinner" />
            <span>Importing to Google Sheet…</span>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="settings-done">
            <div className="settings-done-message">
              <Check size={20} />
              <span>Successfully imported {importedCount.toLocaleString()} sets.</span>
            </div>
            <button className="btn-secondary" onClick={handleReset}>
              Import another file
            </button>
          </div>
        )}
      </div>

      <div className="settings-section settings-section-disconnect">
        <h3 className="settings-section-title">
          <Unlink size={18} />
          Google Sheet
        </h3>
        <p className="settings-disconnect-description">
          Disconnect the current Google Sheet to connect a different one.
          Your data in the sheet will not be deleted.
        </p>
        <button className="btn-danger" onClick={() => {
          if (window.confirm('Disconnect this Google Sheet? You can reconnect it later.')) {
            clearSheetId();
            onDisconnectSheet();
          }
        }}>
          Disconnect Sheet
        </button>
      </div>
    </div>
  );
}
