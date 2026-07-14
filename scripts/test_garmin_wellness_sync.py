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


def test_fetch_training_status_prefers_human_readable_fields():
    class FakeClient:
        def get_training_status(self, _cdate):
            return {
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
                }
            }

    row = garmin_wellness_sync._fetch_training_status(FakeClient(), "2026-07-14")
    assert row == {
        "trainingStatus": "MAINTAINING",
        "trainingAcuteLoad": "224",
        "trainingChronicLoad": "252.5",
    }, row


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


def test_header_drives_column_count_and_span():
    assert garmin_wellness_sync.COLUMN_COUNT == len(garmin_wellness_sync.HEADER)
    assert garmin_wellness_sync._column_letter(garmin_wellness_sync.COLUMN_COUNT) == "W"


def _run():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
