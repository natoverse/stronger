import { describe, it, expect } from 'vitest';
import { parseGarminWellnessRow } from '../sheets.ts';

describe('parseGarminWellnessRow', () => {
  it('parses a full row correctly', () => {
    const row = [
      '2024-03-15',       // date
      '48', 'BALANCED', // hrv
      '25200', '7200', '10800', '5400', '1800', '78', // sleep
      '85', '22',         // body battery
      '72',               // readiness
      'PRODUCTIVE', '245', '310', // training
      '8500', '12', '52', '51.5', // steps/floors/RHR/VO2
      '30', '15',         // intensity min
      '68.2', '72.5',     // hill/endurance
      '37', '12', '1625', // acclimation
      '520', '1850',      // calories
      '41',               // stress
    ];
    const entry = parseGarminWellnessRow(row);
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe('2024-03-15');
    expect(entry!.hrvWeeklyAvg).toBe(48);
    expect(entry!.hrvStatus).toBe('BALANCED');
    expect(entry!.sleepDurationSec).toBe(25200);
    expect(entry!.sleepScore).toBe(78);
    expect(entry!.bodyBatteryHigh).toBe(85);
    expect(entry!.bodyBatteryLow).toBe(22);
    expect(entry!.readinessScore).toBe(72);
    expect(entry!.trainingStatus).toBe('PRODUCTIVE');
    expect(entry!.trainingAcuteLoad).toBe(245);
    expect(entry!.trainingChronicLoad).toBe(310);
    expect(entry!.steps).toBe(8500);
    expect(entry!.floors).toBe(12);
    expect(entry!.restingHR).toBe(52);
    expect(entry!.vo2Max).toBe(51.5);
    expect(entry!.intensityMinModerate).toBe(30);
    expect(entry!.intensityMinVigorous).toBe(15);
    expect(entry!.hillScore).toBe(68.2);
    expect(entry!.enduranceScore).toBe(72.5);
    expect(entry!.heatAcclimationPct).toBe(37);
    expect(entry!.altitudeAcclimationPct).toBe(12);
    expect(entry!.currentAltitude).toBe(1625);
    expect(entry!.activeCalories).toBe(520);
    expect(entry!.bmrCalories).toBe(1850);
    expect(entry!.avgStress).toBe(41);
  });

  it('returns null for empty date', () => {
    const row = ['', '42', '48', 'BALANCED'];
    expect(parseGarminWellnessRow(row)).toBeNull();
  });

  it('handles missing optional columns gracefully', () => {
    const row = ['2024-03-15'];
    const entry = parseGarminWellnessRow(row);
    expect(entry).not.toBeNull();
    expect(entry!.hrvWeeklyAvg).toBeNull();
    expect(entry!.sleepDurationSec).toBeNull();
    expect(entry!.trainingStatus).toBe('');
    expect(entry!.steps).toBeNull();
  });

  it('parses empty string numeric fields as null', () => {
    const row = ['2024-01-01', '', 'LOW', '', '', '', '', '', '', ''];
    const entry = parseGarminWellnessRow(row);
    expect(entry).not.toBeNull();
    expect(entry!.hrvWeeklyAvg).toBeNull();
    expect(entry!.hrvStatus).toBe('LOW');
    expect(entry!.sleepDurationSec).toBeNull();
  });

  it('trims whitespace from date and string fields', () => {
    const row = [
      '  2024-06-01  ',
      '55', '  UNBALANCED  ',
      '28800', '', '', '', '', '70',
    ];
    const entry = parseGarminWellnessRow(row);
    expect(entry!.date).toBe('2024-06-01');
    expect(entry!.hrvStatus).toBe('UNBALANCED');
  });

  it('normalizes numeric training status codes to enum text', () => {
    const row = ['2024-07-14', '', '', '', '', '', '', '', '', '', '', '', '4'];
    const entry = parseGarminWellnessRow(row);
    expect(entry!.trainingStatus).toBe('MAINTAINING');
  });

  it('normalizes Garmin training status feedback phrases', () => {
    const row = ['2024-07-14', '', '', '', '', '', '', '', '', '', '', '', 'strained_5'];
    const entry = parseGarminWellnessRow(row);
    expect(entry!.trainingStatus).toBe('STRAINED');
  });
});
