import { Sliders, LogOut } from 'lucide-react';
import type { AppSettings, AppBooleanSettingKey, AppNumericSettingKey } from '../model/index.js';

interface Props {
  onSignOut: () => void;
  appSettings: AppSettings;
  onAppSettingChange: (key: AppBooleanSettingKey, value: boolean) => void;
  onAppNumericSettingChange: (key: AppNumericSettingKey, value: number) => void;
}

export function SettingsView({ onSignOut, appSettings, onAppSettingChange, onAppNumericSettingChange }: Props) {
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

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Round Warmup Plate Math</span>
            <span className="settings-toggle-description">Snap warmup weights to the nearest easy plate combination (45 lb bar + up to two pairs of 10 lb plates, up to one pair of 25 lb plates, any number of 45 lb pairs) when within 5 lbs</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.roundWarmupPlateMath}
            onChange={(e) => onAppSettingChange('roundWarmupPlateMath', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <div className="settings-subsection-title">Optional Tabs</div>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Calendar</span>
            <span className="settings-toggle-description">Show the Calendar tab in the toolbar</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.showCalendarTab}
            onChange={(e) => onAppSettingChange('showCalendarTab', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Garmin</span>
            <span className="settings-toggle-description">Show the Activities & Wellness tab in the toolbar</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.showGarminTab}
            onChange={(e) => onAppSettingChange('showGarminTab', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <div className="settings-subsection-title">Charts</div>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Skip Progress Dips</span>
            <span className="settings-toggle-description">Filter deload sessions from strength-progress charts</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.skipProgressDips}
            onChange={(e) => onAppSettingChange('skipProgressDips', e.target.checked)}
          />
          <span className="settings-toggle-switch" />
        </label>

        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Skip Body Comp Dips</span>
            <span className="settings-toggle-description">Filter measurement dips from body-composition charts</span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle-input"
            checked={appSettings.skipBodyCompDips}
            onChange={(e) => onAppSettingChange('skipBodyCompDips', e.target.checked)}
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
                if (isFinite(v) && v > 0 && v <= 100) onAppNumericSettingChange('withingsDipThresholdPercent', v);
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
                if (isFinite(v) && v > 0 && v <= 100) onAppNumericSettingChange('progressDipThresholdPercent', v);
              }}
            />
            <span className="settings-percent-unit">%</span>
          </div>
        </div>

        <div className="settings-subsection-title">Garmin Goals</div>
        <p className="settings-toggle-description">Set to 0 to disable goal coloring. Steps, floors, and intensity minutes are auto-synced from Garmin.</p>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Daily Steps</span>
            <span className="settings-toggle-description">Colors the steps chart yellow/green/blue</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={100000}
              step={500}
              value={appSettings.garminDailyStepsGoal}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 100000) onAppNumericSettingChange('garminDailyStepsGoal', v);
              }}
            />
            <span className="settings-percent-unit">steps</span>
          </div>
        </div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Daily Sleep</span>
            <span className="settings-toggle-description">Colors the sleep duration chart yellow/green/blue</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={24}
              step={0.5}
              value={appSettings.garminDailySleepHoursGoal}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 24) onAppNumericSettingChange('garminDailySleepHoursGoal', v);
              }}
            />
            <span className="settings-percent-unit">hours</span>
          </div>
        </div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Daily Floors</span>
            <span className="settings-toggle-description">Colors the floors chart yellow/green/blue</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={500}
              step={1}
              value={appSettings.garminDailyFloorsGoal}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 500) onAppNumericSettingChange('garminDailyFloorsGoal', v);
              }}
            />
            <span className="settings-percent-unit">floors</span>
          </div>
        </div>

        <div className="settings-percent-row">
          <span className="settings-toggle-label">
            <span className="settings-toggle-name">Weekly Intensity Min</span>
            <span className="settings-toggle-description">Colors combined intensity chart based on 7-day rolling sum</span>
          </span>
          <div className="settings-percent-input-group">
            <input
              type="number"
              className="settings-percent-input"
              min={0}
              max={10000}
              step={10}
              value={appSettings.garminWeeklyIntensityMinGoal}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (isFinite(v) && v >= 0 && v <= 10000) onAppNumericSettingChange('garminWeeklyIntensityMinGoal', v);
              }}
            />
            <span className="settings-percent-unit">min</span>
          </div>
        </div>

      </div>

      <div className="settings-section settings-section-disconnect">
        <h3 className="settings-section-title">
          <LogOut size={18} />
          Sign Out
        </h3>
        <p className="settings-disconnect-description">
          Sign out of Stronger. Your Firebase data will not be deleted.
        </p>
        <button className="btn-danger" onClick={() => {
          if (window.confirm('Sign out of Stronger? You can sign back in later.')) {
            onSignOut();
          }
        }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
