import type { StravaTimeRange } from '../model/strava.js';
import { getMoreTimeRangeOptions, getTimeRangeOptions } from '../model/strava.js';

interface Props {
  value: StravaTimeRange;
  onChange: (value: StravaTimeRange) => void;
  today?: Date;
}

export function DateRangeSelector({ value, onChange, today = new Date() }: Props) {
  const buttonOptions = getTimeRangeOptions(today);
  const moreOptions = getMoreTimeRangeOptions(today);
  const selectedMoreOption = moreOptions.some((option) => option.value === value) ? value : '';

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
      {moreOptions.length > 0 && (
        <select
          aria-label="More ranges"
          className={`strava-range-btn strava-range-more${selectedMoreOption ? ' active' : ''}`}
          value={selectedMoreOption}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        >
          <option value="" disabled>More</option>
          {moreOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
