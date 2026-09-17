#!/usr/bin/env python3
"""Offline unit tests for Garmin wellness metric extraction.

Run with: python scripts/test_garmin_wellness_sync.py
"""

import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "garmin_wellness_sync", os.path.join(_HERE, "garmin-wellness-sync.py")
)
garmin_wellness_sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(garmin_wellness_sync)


def test_normalize_training_status_handles_feedback_phrases():
    assert garmin_wellness_sync.normalize_training_status("MAINTAINING_2") == "MAINTAINING"
    assert garmin_wellness_sync.normalize_training_status("STRAINED_5") == "STRAINED"
    assert garmin_wellness_sync.normalize_training_status("NO_STATUS_2") == "NO_STATUS"


def test_normalize_training_status_handles_numeric_codes():
    assert garmin_wellness_sync.normalize_training_status(4) == "MAINTAINING"
    assert garmin_wellness_sync.normalize_training_status("7") == "PRODUCTIVE"
    assert garmin_wellness_sync.normalize_training_status("8") == "STRAINED"


def test_fetch_hrv_includes_balanced_baseline_range():
    class FakeClient:
        def get_hrv_data(self, _cdate):
            return {
                "hrvSummary": {
                    "weeklyAvg": 48,
                    "status": "BALANCED",
                    "baseline": {
                        "lowUpper": 42,
                        "balancedLow": 43,
                        "balancedUpper": 58,
                    },
                },
                "hrv": [],
            }

    assert garmin_wellness_sync._fetch_hrv(FakeClient(), "2026-08-15") == {
        "hrvWeeklyAvg": "48",
        "hrvStatus": "BALANCED",
        "hrvBaselineMin": "43",
        "hrvBaselineMax": "58",
    }


def test_fetch_hrv_leaves_missing_baseline_range_blank():
    class FakeClient:
        def get_hrv_data(self, _cdate):
            return {"hrvSummary": {"weeklyAvg": 48, "status": "LOW"}}

    row = garmin_wellness_sync._fetch_hrv(FakeClient(), "2026-08-15")
    assert row["hrvBaselineMin"] == ""
    assert row["hrvBaselineMax"] == ""


def test_wellness_to_entry_matches_firestore_schema():
    entry = garmin_wellness_sync.wellness_to_entry({
        "date": "2026-08-15",
        "hrvWeeklyAvg": "48",
        "hrvStatus": "BALANCED",
        "trainingStatus": "MAINTAINING_2",
        "steps": "8000",
    })
    assert len(entry) == 45
    assert entry["date"] == "2026-08-15"
    assert entry["hrvWeeklyAvg"] == 48
    assert entry["hrvStatus"] == "BALANCED"
    assert entry["trainingStatus"] == "MAINTAINING"
    assert entry["steps"] == 8000
    assert entry["sleepScore"] is None


def test_build_entry_combines_provider_metrics_without_positional_fields():
    from unittest.mock import patch

    fetchers = {
        "_fetch_hrv": {"hrvWeeklyAvg": "48", "hrvStatus": "BALANCED"},
        "_fetch_sleep": {"sleepScore": "85"},
        "_fetch_readiness": {"readinessScore": "72"},
        "_fetch_training_status": {"trainingStatus": "MAINTAINING_2"},
        "_fetch_daily_summary": {"steps": "8000"},
        "_fetch_vo2max": {"vo2Max": "52.5"},
        "_fetch_hill_score": {"hillScore": "90"},
        "_fetch_endurance_score": {"enduranceScore": "7300"},
        "_fetch_lactate_threshold": {"lactateThresholdHr": "165"},
        "_fetch_fitness_age": {"fitnessAge": "29"},
        "_fetch_max_hr": {"maxHrEstimate": "187"},
    }
    from contextlib import ExitStack

    client = object()
    with ExitStack() as stack:
        mocks = [
            stack.enter_context(patch.object(garmin_wellness_sync, name, return_value=values))
            for name, values in fetchers.items()
        ]
        entry = garmin_wellness_sync.build_entry(client, "2026-08-15")
        for fetch in mocks:
            fetch.assert_called_once_with(client, "2026-08-15")

    expected = {"date": "2026-08-15"}
    for values in fetchers.values():
        expected.update(values)
    assert entry == garmin_wellness_sync.wellness_to_entry(expected)
    assert entry["vo2Max"] == 52.5
    assert entry["bodyBatteryHigh"] is None


def test_fetch_training_status_prefers_human_readable_fields():
    class FakeClient:
        def get_training_status(self, _cdate):
            return {
                "heatAltitudeAcclimationDTO": {
                    "heatAcclimationPercentage": 37,
                    "altitudeAcclimationPercentage": 12,
                    "currentAltitude": 1625,
                },
                "mostRecentTrainingStatus": {
                    "latestTrainingStatusData": {
                        "device-1": {
                            "trainingStatus": 4,
                            "trainingStatusFeedbackPhrase": "MAINTAINING_2",
                            "acuteTrainingLoadDTO": {
                                "dailyTrainingLoadAcute": 224,
                                "dailyTrainingLoadChronic": 252.5,
                            },
                        }
                    }
                },
                "mostRecentTrainingLoadBalance": {
                    "metricsTrainingLoadBalanceDTOMap": {
                        "device-1": {
                            "monthlyLoadAerobicLow": 320.4,
                            "monthlyLoadAerobicLowTargetMin": 200,
                            "monthlyLoadAerobicLowTargetMax": 400,
                            "monthlyLoadAerobicHigh": 180.6,
                            "monthlyLoadAerobicHighTargetMin": 150,
                            "monthlyLoadAerobicHighTargetMax": 300,
                            "monthlyLoadAnaerobic": 40.2,
                            "monthlyLoadAnaerobicTargetMin": 50,
                            "monthlyLoadAnaerobicTargetMax": 120,
                        }
                    }
                },
            }

    row = garmin_wellness_sync._fetch_training_status(FakeClient(), "2026-07-14")
    assert row == {
        "trainingStatus": "MAINTAINING",
        "trainingAcuteLoad": "224",
        "trainingChronicLoad": "252.5",
        "heatAcclimationPct": "37",
        "altitudeAcclimationPct": "12",
        "currentAltitude": "1625",
        "loadFocusAerobicLow": "320.4",
        "loadFocusAerobicLowMin": "200",
        "loadFocusAerobicLowMax": "400",
        "loadFocusAerobicHigh": "180.6",
        "loadFocusAerobicHighMin": "150",
        "loadFocusAerobicHighMax": "300",
        "loadFocusAnaerobic": "40.2",
        "loadFocusAnaerobicMin": "50",
        "loadFocusAnaerobicMax": "120",
    }, row


def test_fetch_training_status_omits_load_focus_when_balance_missing():
    class FakeClient:
        def get_training_status(self, _cdate):
            return {
                "mostRecentTrainingStatus": {
                    "latestTrainingStatusData": {
                        "device-1": {
                            "trainingStatus": 7,
                            "acuteTrainingLoadDTO": {
                                "dailyTrainingLoadAcute": 200,
                                "dailyTrainingLoadChronic": 210,
                            },
                        }
                    }
                },
            }

    row = garmin_wellness_sync._fetch_training_status(FakeClient(), "2026-07-14")
    # All load-focus fields present but blank when no balance data.
    for key in (
        "loadFocusAerobicLow", "loadFocusAerobicLowMin", "loadFocusAerobicLowMax",
        "loadFocusAerobicHigh", "loadFocusAerobicHighMin", "loadFocusAerobicHighMax",
        "loadFocusAnaerobic", "loadFocusAnaerobicMin", "loadFocusAnaerobicMax",
    ):
        assert row[key] == "", (key, row)


def test_fetch_training_status_falls_back_to_vo2_acclimation_shape():
    class FakeClient:
        def get_training_status(self, _cdate):
            return {
                "mostRecentVO2Max": {
                    "heatAltitudeAcclimation": {
                        "heatAcclimationPercentage": 18,
                        "altitudeAcclimation": 44,
                        "currentAltitude": 2450,
                    }
                },
                "mostRecentTrainingStatus": {
                    "latestTrainingStatusData": {
                        "device-1": {
                            "trainingStatus": "PRODUCTIVE_1",
                            "acuteTrainingLoadDTO": {
                                "dailyTrainingLoadAcute": 180,
                                "dailyTrainingLoadChronic": 210,
                            },
                        }
                    }
                },
            }

    row = garmin_wellness_sync._fetch_training_status(FakeClient(), "2026-07-14")
    assert row["heatAcclimationPct"] == "18", row
    assert row["altitudeAcclimationPct"] == "44", row
    assert row["currentAltitude"] == "2450", row


class _MockGarminClient:
    def __init__(self, *, max_metrics=None, hill_score=None, endurance_score=None):
        self._max_metrics = max_metrics
        self._hill_score = hill_score
        self._endurance_score = endurance_score

    def get_max_metrics(self, _cdate):
        return self._max_metrics

    def get_hill_score(self, _cdate):
        return self._hill_score

    def get_endurance_score(self, _cdate):
        return self._endurance_score


def test_fetch_vo2max_from_generic_container():
    client = _MockGarminClient(max_metrics=[{"generic": {"vo2MaxPreciseValue": 52.5}}])
    row = garmin_wellness_sync._fetch_vo2max(client, "2026-07-14")
    assert row == {"vo2Max": "52.5"}, row


def test_fetch_vo2max_from_metrics_map_variants():
    client = _MockGarminClient(
        max_metrics={
            "allMetrics": {
                "metricsMap": {
                    "VO2MAX_RUNNING": [{"value": 51.2}],
                }
            }
        }
    )
    row = garmin_wellness_sync._fetch_vo2max(client, "2026-07-14")
    assert row == {"vo2Max": "51.2"}, row


def test_fetch_hill_score_from_overall_score():
    client = _MockGarminClient(hill_score={"overallScore": 98})
    row = garmin_wellness_sync._fetch_hill_score(client, "2026-07-14")
    assert row == {"hillScore": "98"}, row


def test_fetch_endurance_score_from_overall_score():
    client = _MockGarminClient(endurance_score={"overallScore": 7301})
    row = garmin_wellness_sync._fetch_endurance_score(client, "2026-07-14")
    assert row == {"enduranceScore": "7301"}, row


def test_fetch_endurance_score_from_nested_object():
    client = _MockGarminClient(endurance_score={"enduranceScore": {"latestScore": 7450}})
    row = garmin_wellness_sync._fetch_endurance_score(client, "2026-07-14")
    assert row == {"enduranceScore": "7450"}, row


def test_fetch_lactate_threshold_combines_hr_speed_and_power():
    class FakeClient:
        def get_lactate_threshold(self, *, latest=True):
            return {
                "speed_and_heart_rate": {"heartRate": 165, "speed": 3.472},
                "power": {"power": 268},
            }

    row = garmin_wellness_sync._fetch_lactate_threshold(FakeClient(), "2026-07-14")
    assert row == {
        "lactateThresholdHr": "165",
        "lactateThresholdSpeed": "3.472",
        "lactateThresholdPower": "268",
    }, row


def test_fetch_lactate_threshold_handles_missing_power():
    class FakeClient:
        def get_lactate_threshold(self, *, latest=True):
            return {"speed_and_heart_rate": {"heartRate": 160, "speed": None}, "power": {}}

    row = garmin_wellness_sync._fetch_lactate_threshold(FakeClient(), "2026-07-14")
    assert row == {"lactateThresholdHr": "160"}, row


def test_fetch_fitness_age_from_nested_object():
    class FakeClient:
        def get_fitnessage_data(self, _cdate):
            return {"fitnessAge": {"age": 29, "lowerRange": 27, "upperRange": 31}}

    row = garmin_wellness_sync._fetch_fitness_age(FakeClient(), "2026-07-14")
    assert row == {"fitnessAge": "29"}, row


def test_fetch_fitness_age_from_direct_scalar():
    class FakeClient:
        def get_fitnessage_data(self, _cdate):
            return {"fitnessAge": 31.0}

    row = garmin_wellness_sync._fetch_fitness_age(FakeClient(), "2026-07-14")
    assert row == {"fitnessAge": "31"}, row


def test_fetch_max_hr_from_userdata():
    class FakeClient:
        def get_userprofile_settings(self):
            return {"userData": {"maxHeartRate": 187}}

    row = garmin_wellness_sync._fetch_max_hr(FakeClient(), "2026-07-14")
    assert row == {"maxHrEstimate": "187"}, row


def test_fetch_max_hr_missing_returns_empty():
    class FakeClient:
        def get_userprofile_settings(self):
            return {"userData": {}}

    row = garmin_wellness_sync._fetch_max_hr(FakeClient(), "2026-07-14")
    assert row == {}, row


def test_parse_goals_standard_fields():
    goals = garmin_wellness_sync.parse_goals(
        {
            "dailyStepGoal": 10000,
            "userFloorsAscendedGoal": 10,
            "intensityMinutesGoal": 150,
        }
    )
    assert goals == {
        "app.garminDailyStepsGoal": "10000",
        "app.garminDailyFloorsGoal": "10",
        "app.garminWeeklyIntensityMinGoal": "150",
    }, goals


def test_parse_goals_missing_floors_still_harvests_others():
    # Regression: a missing/renamed field must not abort the whole harvest.
    goals = garmin_wellness_sync.parse_goals(
        {"dailyStepGoal": 8000, "intensityMinutesGoal": 300}
    )
    assert goals == {
        "app.garminDailyStepsGoal": "8000",
        "app.garminWeeklyIntensityMinGoal": "300",
    }, goals


def test_parse_goals_ignores_zero_and_missing():
    goals = garmin_wellness_sync.parse_goals(
        {"dailyStepGoal": 0, "userFloorsAscendedGoal": None}
    )
    assert goals == {}, goals


def test_parse_goals_float_and_alias_fields():
    goals = garmin_wellness_sync.parse_goals(
        {"stepGoal": 7500.0, "floorsAscendedGoal": 12.0, "userIntensityMinutesGoal": 200}
    )
    assert goals == {
        "app.garminDailyStepsGoal": "7500",
        "app.garminDailyFloorsGoal": "12",
        "app.garminWeeklyIntensityMinGoal": "200",
    }, goals


def test_parse_goals_empty_payload():
    assert garmin_wellness_sync.parse_goals({}) == {}
    assert garmin_wellness_sync.parse_goals(None) == {}


def test_fetch_daily_summary_calorie_fields():
    class FakeClient:
        def get_user_summary(self, _cdate):
            return {
                "totalSteps": 8000,
                "activeKilocalories": 420,
                "bmrKilocalories": 1800,
            }

    row = garmin_wellness_sync._fetch_daily_summary(FakeClient(), "2026-07-14")
    assert row["activeCalories"] == "420", row
    assert row["bmrCalories"] == "1800", row


def test_fetch_daily_summary_stress_field():
    class FakeClient:
        def get_user_summary(self, _cdate):
            return {"totalSteps": 8000, "averageStressLevel": 37}

    row = garmin_wellness_sync._fetch_daily_summary(FakeClient(), "2026-07-14")
    assert row["avgStress"] == "37", row


def test_stress_ignores_no_data_sentinel():
    # Garmin reports -1/-2 when the device wasn't worn.
    assert garmin_wellness_sync._stress(-1) == ""
    assert garmin_wellness_sync._stress(-2) == ""
    assert garmin_wellness_sync._stress(None) == ""
    assert garmin_wellness_sync._stress(0) == "0"
    assert garmin_wellness_sync._stress(62.4) == "62"


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
