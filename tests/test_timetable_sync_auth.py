from unittest.mock import patch

import pytest

import main


@pytest.fixture
def client():
    main.app.config["TESTING"] = True
    with main.app.test_client() as client:
        yield client


AUTH = {"Authorization": "Bearer test-token"}


def _sync(client):
    return client.get("/api/timetable/sync?date=2026-11-23", headers=AUTH)


def test_missing_token_stays_unauthorized(client):
    response = client.get("/api/timetable/sync")

    assert response.status_code == 200
    assert response.get_json() == {"available": False, "reason": "unauthorized"}


def test_unset_owner_allows_sync_without_extra_canvas_call(client, monkeypatch):
    monkeypatch.delenv("ALLOWED_CANVAS_USER_ID", raising=False)

    with patch.object(main, "week_dates_for", return_value=[("mon", "23112026")]), \
            patch.object(main, "fetch_vsc_timetable", return_value={"success": True, "data": []}) as fetch, \
            patch.object(main, "validate_canvas_token") as validate:
        response = _sync(client)

    assert response.status_code == 200
    data = response.get_json()
    assert data["available"] is True
    assert data["timetable"] == {"mon": []}
    assert fetch.call_count == 1
    validate.assert_not_called()


def test_owner_token_allows_sync(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_CANVAS_USER_ID", "12345")

    with patch.object(main, "week_dates_for", return_value=[("mon", "23112026")]), \
            patch.object(main, "fetch_vsc_timetable", return_value={"success": True, "data": []}) as fetch, \
            patch.object(main, "validate_canvas_token", return_value=(True, {"id": 12345})) as validate:
        response = _sync(client)

    assert response.status_code == 200
    assert response.get_json()["available"] is True
    validate.assert_called_once_with("test-token")
    assert fetch.call_count == 1


def test_other_user_is_rejected_before_touching_relay(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_CANVAS_USER_ID", "12345")

    with patch.object(main, "fetch_vsc_timetable") as fetch, \
            patch.object(main, "validate_canvas_token", return_value=(True, {"id": 99999})):
        response = _sync(client)

    assert response.status_code == 200
    assert response.get_json() == {"available": False, "reason": "forbidden"}
    fetch.assert_not_called()


def test_invalid_token_is_rejected_before_touching_relay(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_CANVAS_USER_ID", "12345")

    with patch.object(main, "fetch_vsc_timetable") as fetch, \
            patch.object(main, "validate_canvas_token", return_value=(False, None)):
        response = _sync(client)

    assert response.status_code == 200
    assert response.get_json() == {"available": False, "reason": "forbidden"}
    fetch.assert_not_called()
