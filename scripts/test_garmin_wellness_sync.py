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
    assert len(entry) == 49
    assert entry["date"] == "2026-08-15"
    assert entry["hrvWeeklyAvg"] == 48
    assert entry["hrvStatus"] == "BALANCED"
    assert entry["trainingStatus"] == "MAINTAINING"
    assert entry["steps"] == 8000
    assert entry["sleepScore"] is None
    for field in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS:
        assert entry[field] is None


def test_fetch_sleep_preserves_milliseconds_through_firestore():
    from firestore_sync import firestore_value, firestore_value_to_json

    timestamps = {
        "sleepStartTimestampLocal": 1769470048123,
        "sleepEndTimestampLocal": 1769496015456,
        "sleepStartTimestampGMT": 1769455648123,
        "sleepEndTimestampGMT": 1769481615456,
    }

    class FakeClient:
        def get_sleep_data(self, cdate):
            assert cdate == "2026-01-27"
            return {"dailySleepDTO": {
                **timestamps,
                "sleepTimeSeconds": 25967,
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 18000,
                "remSleepSeconds": 4367,
                "awakeSleepSeconds": 120,
                "sleepScores": {"overall": {"value": 85}},
            }}

    metrics = garmin_wellness_sync._fetch_sleep(FakeClient(), "2026-01-27")
    entry = garmin_wellness_sync.wellness_to_entry({"date": "2026-01-27", **metrics})
    stored = firestore_value_to_json(firestore_value(entry))
    for field, value in timestamps.items():
        assert metrics[field] == stored[field] == value
        assert isinstance(stored[field], int)
    for field, value in {
        "sleepDurationSec": 25967, "sleepDeepSec": 3600,
        "sleepLightSec": 18000, "sleepRemSec": 4367,
        "sleepAwakeSec": 120, "sleepScore": 85,
    }.items():
        assert stored[field] == value


def test_sleep_timestamp_normalization_does_not_round_numbers():
    for value in (1769470048123, 1769470048123.25):
        entry = garmin_wellness_sync.wellness_to_entry({
            field: value for field in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS
        })
        for field in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS:
            assert entry[field] == value


def test_fetch_sleep_rejects_malformed_timestamps_independently():
    invalid_values = (
        None, "", "1769470048123", "invalid", True, False, 0, -1,
        float("nan"), float("inf"), -float("inf"), {}, [],
    )
    for field in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS:
        for value in invalid_values:
            timestamps = {
                key: 1769470048123 for key in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS
            }
            timestamps[field] = value

            class FakeClient:
                def get_sleep_data(self, _cdate):
                    return {"dailySleepDTO": {**timestamps, "sleepTimeSeconds": 28000}}

            metrics = garmin_wellness_sync._fetch_sleep(FakeClient(), "2026-01-27")
            entry = garmin_wellness_sync.wellness_to_entry(metrics)
            direct = garmin_wellness_sync.wellness_to_entry(timestamps)
            assert metrics[field] is None
            assert entry[field] is None
            assert direct[field] is None
            assert entry["sleepDurationSec"] == 28000
            for key in timestamps:
                if key != field:
                    assert entry[key] == 1769470048123


def test_fetch_sleep_missing_payloads_and_timestamps_stay_null():
    for payload in (None, {}, {"dailySleepDTO": None}, {"dailySleepDTO": {}},
                    {"dailySleepDTO": {"sleepTimeSeconds": 28000}}):
        class FakeClient:
            def get_sleep_data(self, _cdate):
                return payload

        entry = garmin_wellness_sync.wellness_to_entry(
            garmin_wellness_sync._fetch_sleep(FakeClient(), "2026-01-27")
        )
        for field in garmin_wellness_sync.SLEEP_TIMESTAMP_FIELDS:
            assert entry[field] is None


def test_fetch_sleep_does_not_infer_local_from_gmt_or_gmt_from_local():
    for suffix, missing_suffix in (("GMT", "Local"), ("Local", "GMT")):
        timestamps = {
            f"sleepStartTimestamp{suffix}": 1769455648000,
            f"sleepEndTimestamp{suffix}": 1769481615000,
        }

        class FakeClient:
            def get_sleep_data(self, _cdate):
                return {"dailySleepDTO": timestamps}

        entry = garmin_wellness_sync.wellness_to_entry(
            garmin_wellness_sync._fetch_sleep(FakeClient(), "2026-01-27")
        )
        for field, value in timestamps.items():
            assert entry[field] == value
        assert entry[f"sleepStartTimestamp{missing_suffix}"] is None
        assert entry[f"sleepEndTimestamp{missing_suffix}"] is None


def test_sleep_overnight_and_dst_preserve_local_and_gmt_independently():
    from datetime import datetime, timezone

    def encoded_ms(value):
        return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp() * 1000)

    for start_local, end_local, start_gmt, end_gmt, elapsed_hours in (
        ("2026-01-26T23:00", "2026-01-27T07:00",
         "2026-01-27T04:00", "2026-01-27T12:00", 8),
        ("2026-03-07T23:00", "2026-03-08T07:00",
         "2026-03-08T04:00", "2026-03-08T11:00", 7),
        ("2026-10-31T23:00", "2026-11-01T07:00",
         "2026-11-01T03:00", "2026-11-01T12:00", 9),
    ):
        timestamps = {
            "sleepStartTimestampLocal": encoded_ms(start_local),
            "sleepEndTimestampLocal": encoded_ms(end_local),
            "sleepStartTimestampGMT": encoded_ms(start_gmt),
            "sleepEndTimestampGMT": encoded_ms(end_gmt),
        }

        class FakeClient:
            def get_sleep_data(self, _cdate):
                return {"dailySleepDTO": timestamps}

        entry = garmin_wellness_sync.wellness_to_entry(
            garmin_wellness_sync._fetch_sleep(FakeClient(), end_local[:10])
        )
        for field, value in timestamps.items():
            assert entry[field] == value
        assert entry["sleepEndTimestampLocal"] - entry["sleepStartTimestampLocal"] == 8 * 3600000
        assert entry["sleepEndTimestampGMT"] - entry["sleepStartTimestampGMT"] == elapsed_hours * 3600000


def test_build_entry_combines_provider_metrics_without_positional_fields():
    from unittest.mock import patch

    fetchers = {
        "_fetch_hrv": {"hrvWeeklyAvg": "48", "hrvStatus": "BALANCED"},
        "_fetch_sleep": {
            "sleepScore": "85",
            "sleepStartTimestampLocal": 1786748400123,
            "sleepEndTimestampLocal": 1786777200456,
            "sleepStartTimestampGMT": 1786762800123,
            "sleepEndTimestampGMT": 1786791600456,
        },
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


def test_backfill_overwrites_existing_history_without_overwrite_flag():
    import sys
    from unittest.mock import Mock, patch

    dates = ["2021-01-01", "2021-01-02"]
    entries = [
        garmin_wellness_sync.wellness_to_entry({
            "date": day,
            "sleepStartTimestampLocal": 1609455600123 + index * 86400000,
        })
        for index, day in enumerate(dates)
    ]
    requests = Mock()
    with (
        patch.dict(os.environ, {
            "GARMIN_TOKENS": "test-garmin",
            "FIREBASE_SERVICE_ACCOUNT_KEY": "test-service-account",
            "FIREBASE_USER_ID": "test-user",
        }),
        patch.dict(sys.modules, {"requests": requests}),
        patch.object(sys, "argv", ["garmin-wellness-sync.py", "--backfill"]),
        patch.object(garmin_wellness_sync, "login_from_tokens"),
        patch.object(garmin_wellness_sync, "get_firestore_access",
                     return_value=("test-project", "test-access")),
        patch.object(garmin_wellness_sync, "_date_range", return_value=dates) as date_range,
        patch.object(garmin_wellness_sync, "read_year_entries") as read,
        patch.object(garmin_wellness_sync, "build_entry", side_effect=entries) as build,
        patch.object(garmin_wellness_sync.time, "sleep"),
        patch.object(garmin_wellness_sync, "merge_year_bucket_entries",
                     return_value={"added": 0, "updated": 2}) as merge,
        patch.object(garmin_wellness_sync, "_sync_goals"),
    ):
        garmin_wellness_sync.main()
        date_range.assert_called_once_with("2021-01-01", garmin_wellness_sync.date.today().isoformat())
        read.assert_not_called()
        assert [call.args[1] for call in build.call_args_list] == dates
        merge.assert_called_once_with(
            requests.Session.return_value, "test-project", "test-access",
            "test-user", "garminWellness", entries, "date", True, "date",
        )


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
        def get_lactate_threshold(
            self, *, latest, start_date, end_date, aggregation,
        ):
            assert latest is False
            assert start_date == "2026-07-14"
            assert end_date == "2026-07-14"
            assert aggregation == "daily"
            return {
                "heart_rate": [{"calendarDate": "2026-07-14", "value": 165}],
                "speed": [
                    {
                        "calendarDate": "2026-07-13",
                        "values": [
                            {"value": 0.9999},
                            {"calendarDate": "2026-07-14", "value": 0.3472},
                        ],
                    },
                ],
                "power": [
                    {
                        "calendarDate": "2026-07-14",
                        "functionalThresholdPower": 268,
                    },
                ],
            }

    row = garmin_wellness_sync._fetch_lactate_threshold(FakeClient(), "2026-07-14")
    assert row == {
        "lactateThresholdHr": "165",
        "lactateThresholdSpeed": "3.472",
        "lactateThresholdPower": "268",
    }, row


def test_fetch_lactate_threshold_converts_range_speed_before_firestore_storage():
    class FakeClient:
        def get_lactate_threshold(self, **_kwargs):
            return {
                "speed": [
                    {
                        "from": "2026-07-13", "until": "2026-07-13",
                        "series": "running", "value": 0.4, "updatedDate": "2026-07-13",
                    },
                    {
                        "from": "2026-07-14", "until": "2026-07-14",
                        "series": "running", "value": 0.319, "updatedDate": "2026-07-14",
                    },
                ],
            }

    metrics = garmin_wellness_sync._fetch_lactate_threshold(FakeClient(), "2026-07-14")
    entry = garmin_wellness_sync.wellness_to_entry({"date": "2026-07-14", **metrics})
    assert entry["lactateThresholdSpeed"] == 3.19, entry


def test_lactate_threshold_speed_normalizes_numeric_values_without_magnitude_guessing():
    for value, expected in [
        (0.319, "3.19"), ("0.3472", "3.472"), (0.33611017, "3.361"),
        (0.1, "1"), (1.5, "15"),
    ]:
        assert garmin_wellness_sync._lactate_threshold_speed_mps(value) == expected


def test_fetch_lactate_threshold_invalid_speed_preserves_hr_and_power():
    for value in (None, "", "invalid", 0, -1, float("nan"), float("inf"), -float("inf")):
        class FakeClient:
            def get_lactate_threshold(self, **_kwargs):
                return {
                    "heart_rate": [{"value": 165}],
                    "speed": [{"value": value}],
                    "power": [{"value": 268}],
                }

        metrics = garmin_wellness_sync._fetch_lactate_threshold(FakeClient(), "2026-07-14")
        entry = garmin_wellness_sync.wellness_to_entry(metrics)
        assert entry["lactateThresholdSpeed"] is None, entry
        assert entry["lactateThresholdHr"] == 165, entry
        assert entry["lactateThresholdPower"] == 268, entry


def test_fetch_lactate_threshold_handles_missing_power():
    class FakeClient:
        def get_lactate_threshold(self, **_kwargs):
            return {
                "heart_rate": [{"lactateThresholdHeartRate": 160}],
                "speed": [],
                "power": {},
            }

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


def test_fetch_max_hr_from_default_heart_rate_zone():
    class FakeClient:
        def get_userprofile_settings(self):
            return {
                "heartRateZones": [
                    {"sport": "RUNNING", "maxHeartRateUsed": 190},
                    {"sport": "DEFAULT", "maxHeartRateUsed": 187},
                ],
            }

    row = garmin_wellness_sync._fetch_max_hr(FakeClient(), "2026-07-14")
    assert row == {"maxHrEstimate": "187"}, row


def test_fetch_max_hr_falls_back_to_heart_rate_zones_endpoint():
    class FakeClient:
        def get_userprofile_settings(self):
            return {}

        def get_heart_rate_zones(self):
            return [{"sport": "RUNNING", "maxHeartRateUsed": 190}]

    row = garmin_wellness_sync._fetch_max_hr(FakeClient(), "2026-07-14")
    assert row == {"maxHrEstimate": "190"}, row


def test_fetch_max_hr_falls_back_when_settings_zones_are_empty():
    class FakeClient:
        def get_userprofile_settings(self):
            return {"heartRateZones": []}

        def get_heart_rate_zones(self):
            return [{"sport": "DEFAULT", "maxHeartRateUsed": 187}]

    row = garmin_wellness_sync._fetch_max_hr(FakeClient(), "2026-07-14")
    assert row == {"maxHrEstimate": "187"}, row


def test_fetch_max_hr_missing_returns_empty():
    class FakeClient:
        def get_userprofile_settings(self):
            return {"userData": {}}

        def get_heart_rate_zones(self):
            return []

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
