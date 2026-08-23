import type { StravaTimeRange } from '../model/strava.js';
import { getOlderYearOptions, getTimeRangeOptions } from '../model/strava.js';

interface Props {
  value: StravaTimeRange;
  onChange: (value: StravaTimeRange) => void;
  today?: Date;
}

export function DateRangeSelector({ value, onChange, today = new Date() }: Props) {
  const buttonOptions = getTimeRangeOptions(today);
  const olderYearOptions = getOlderYearOptions(today);
  const selectedOlderYear = olderYearOptions.some((option) => option.value === value) ? value : '';

  return (
    <div className="strava-range-group">
      {buttonOptions.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`strava-range-btn${value === option.value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      {olderYearOptions.length > 0 && (
        <select
          aria-label="More years"
          className={`strava-range-btn strava-range-more${selectedOlderYear ? ' active' : ''}`}
          value={selectedOlderYear}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        >
          <option value="" disabled>More</option>
          {olderYearOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
