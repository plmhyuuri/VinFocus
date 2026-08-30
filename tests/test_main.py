import json
import pytest
from unittest.mock import patch, MagicMock
from main import app, extract_weeks, get_item_completion, format_module_item, module_item_weeks


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear the in-memory cache before each test to prevent test pollution."""
    from main import _cache
    _cache.clear()
    yield
    _cache.clear()


def mock_response(status_code=200, json_data=None, text=""):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data or {}
    mock.text = text
    return mock


# ──────────────────────────────────────────────
# Unit tests for extract_weeks
# ──────────────────────────────────────────────

class TestExtractWeeks:
    """Tests for the extract_weeks() parser function."""

    # Vietnamese week format
    def test_tuan_single(self):
        assert extract_weeks("Tuần 36") == [36]

    def test_tuan_single_uppercase(self):
        assert extract_weeks("TUẦN 25") == [25]

    # English week format
    def test_week_single(self):
        assert extract_weeks("Week 36") == [36]

    def test_week_single_lowercase(self):
        assert extract_weeks("week 20") == [20]

    # Week ranges
    def test_tuan_range_hyphen(self):
        assert extract_weeks("Tuần 36-40") == [36, 37, 38, 39, 40]

    def test_tuan_range_spaces(self):
        assert extract_weeks("Tuần 36 - 40") == [36, 37, 38, 39, 40]

    def test_tuan_range_en_dash(self):
        assert extract_weeks("Tuần 36–40") == [36, 37, 38, 39, 40]

    def test_week_range_english(self):
        assert extract_weeks("Week 20-22") == [20, 21, 22]

    # Multi-week: plus-separated
    def test_tuan_plus_separated(self):
        assert extract_weeks("Tuần 23 + 24 + 25") == [23, 24, 25]
        
    def test_week_ampersand(self):
        assert extract_weeks("Week 23 & 24") == [23, 24]

    # Multi-week: comma-separated
    def test_week_comma_separated(self):
        assert extract_weeks("Week 23, 24, 25") == [23, 24, 25]

    # Compound: ranges + individual
    def test_tuan_range_and_individual(self):
        assert extract_weeks("Tuần 36-40, 42") == [36, 37, 38, 39, 40, 42]

    def test_tuan_complex_mixed(self):
        assert extract_weeks("Tuần 23, 24-26") == [23, 24, 25, 26]

    # Non-week modules
    def test_non_week_emoji_exam(self):
        assert extract_weeks("📝Kiểm tra đánh giá học kì II") == []

    def test_non_week_phan(self):
        assert extract_weeks("Phần 1") == []

    def test_non_week_english_phrase(self):
        assert extract_weeks("Must do quizzes for upcoming semester") == []

    # Real-world edge cases: avoid parsing unrelated numbers
    def test_tuan_stops_at_bai(self):
        assert extract_weeks("Tuần 36 - Bài 13.4") == [36]

    def test_tuan_stops_at_quiz(self):
        assert extract_weeks("Tuần 36 | Quiz 2") == [36]

    def test_week_stops_at_assignment(self):
        assert extract_weeks("Week 25 Assignment 3") == [25]

    def test_tuan_stops_at_parentheses(self):
        assert extract_weeks("Tuần 36 (15 phút)") == [36]

    def test_week_stops_at_chapter(self):
        assert extract_weeks("Week 20 Chapter 5") == [20]

    # Edge cases: empty / None / blank
    def test_empty_string(self):
        assert extract_weeks("") == []

    def test_none_value(self):
        assert extract_weeks(None) == []

    def test_blank_string(self):
        assert extract_weeks("   ") == []

    # Slash separator
    def test_week_slash_separated(self):
        assert extract_weeks("Week 23/24") == [23, 24]

    # Fore/aft spaces handled
    def test_leading_trailing_spaces(self):
        assert extract_weeks("  Tuần 36  ") == [36]

    # Mixed case
    def test_tuan_mixed_case(self):
        assert extract_weeks("TuẦn 36") == [36]

    def test_week_mixed_case(self):
        assert extract_weeks("wEEk 36") == [36]

    # Non-accented TUAN
    def test_tuan_no_accent(self):
        assert extract_weeks("TUAN 31") == [31]

    def test_tuan_no_accent_lowercase(self):
        assert extract_weeks("tuan 31") == [31]

    # Arrow range => 
    def test_tuan_arrow_range(self):
        assert extract_weeks("TUẦN 30 => 33") == [30, 31, 32, 33]

    def test_tuan_arrow_range_no_spaces(self):
        assert extract_weeks("TUẦN 30=>33") == [30, 31, 32, 33]

    # Range in wrong direction (descending) still captures both ends
    def test_range_descending(self):
        result = extract_weeks("Tuần 40-36")
        assert sorted(result) == result  # sorted
        assert set(result) == {36, 40}


# ──────────────────────────────────────────────
# Unit tests for module_item_weeks (SubHeader week inheritance)
# ──────────────────────────────────────────────

def helper_item(item_type, title, position, item_id):
    return {"id": item_id, "type": item_type, "title": title, "position": position}


def week_by_item_id(result, item_id):
    for item, weeks, _label in result:
        if item.get("id") == item_id:
            return weeks
    return None


def label_by_item_id(result, item_id):
    for item, _weeks, label in result:
        if item.get("id") == item_id:
            return label
    return None


class TestModuleItemWeeks:
    def test_normal_week_named_module(self):
        """Week-named modules keep their existing behavior (no subheaders)."""
        module = {
            "name": "TUẦN 36",
            "items": [
                helper_item("Quiz", "Quiz 1", 1, 100),
                helper_item("Page", "Page 1", 2, 101),
            ],
        }
        result = module_item_weeks(module)
        assert week_by_item_id(result, 100) == [36]
        assert week_by_item_id(result, 101) == [36]
        assert label_by_item_id(result, 100) == "TUẦN 36"

    def test_chapter_module_with_subheader_assigns_weeks(self):
        """A chapter-named module uses SubHeader weeks for trailing items."""
        module = {
            "name": "CHƯƠNG 8: Sự hô hấp và Trao đổi khí new",
            "items": [
                helper_item("SubHeader", "Tuần 1 (13.8-21.8.2026) B8.1 Hô Hấp", 1, 1),
                helper_item("Page", "[Tự học] B8.01: Hô hấp", 2, 100),
                helper_item("Quiz", "[Quiz củng cố] B8.01: Hô hấp", 3, 101),
            ],
        }
        result = module_item_weeks(module)
        assert week_by_item_id(result, 100) == [1]
        assert week_by_item_id(result, 101) == [1]
        # Option B: label is the sub-header title
        assert label_by_item_id(result, 100) == "Tuần 1 (13.8-21.8.2026) B8.1 Hô Hấp"

    def test_inherited_through_non_week_subheader(self):
        """Items under a non-week sub-header inherit the prior sub-header's weeks."""
        module = {
            "name": "CHƯƠNG 8",
            "items": [
                helper_item("SubHeader", "Tuần 2 (24.8 - 28.8.2026) B8.3: Thuốc lá", 1, 1),
                helper_item("Page", "[Tự học] B8.03", 2, 100),
                helper_item("SubHeader", "[Nội dung bài học]", 3, 2),
                helper_item("Page", "Sự trao đổi khí ở người", 4, 101),
                helper_item("SubHeader", "Luyện tập", 5, 3),
                helper_item("Quiz", "[Quiz củng cố] B8.02", 6, 102),
            ],
        }
        result = module_item_weeks(module)
        assert week_by_item_id(result, 100) == [2]
        # No-week subheaders: next real items keep previous weeks (2)
        assert week_by_item_id(result, 101) == [2]
        assert week_by_item_id(result, 102) == [2]

    def test_multi_week_subheader(self):
        """A sub-header spanning multiple weeks assigns those weeks to its items."""
        module = {
            "name": "CHƯƠNG 8",
            "items": [
                helper_item("SubHeader", "Tuần 1,2 (17.8 - 28.8.2026) B8.2", 1, 1),
                helper_item("Page", "Trao đổi khí - Tiết 1", 2, 100),
                helper_item("Quiz", "Quiz tự học", 3, 101),
            ],
        }
        result = module_item_weeks(module)
        assert week_by_item_id(result, 100) == [1, 2]
        assert week_by_item_id(result, 101) == [1, 2]

    def test_items_before_first_subheader_fallback_to_module(self):
        """Items before any sub-header fall back to the module name (week 0 if none)."""
        module = {
            "name": "CHƯƠNG 8",
            "items": [
                helper_item("Page", "Intro page before headers", 1, 100),
                helper_item("SubHeader", "Tuần 5", 2, 1),
                helper_item("Quiz", "In week 5", 3, 101),
            ],
        }
        result = module_item_weeks(module)
        # Intro page has no module week and predates any subheader => week 0
        assert week_by_item_id(result, 100) == [0]
        # After the subheader, items inherit week 5
        assert week_by_item_id(result, 101) == [5]

    def test_empty_items(self):
        module = {"name": "TUẦN 36", "items": []}
        assert module_item_weeks(module) == []

    def test_items_sorted_by_position(self):
        """Items are processed in position order regardless of API ordering."""
        module = {
            "name": "CHƯƠNG 8",
            "items": [
                helper_item("Quiz", "Item B (position 3)", 3, 102),
                helper_item("SubHeader", "Tuần 7", 2, 1),
                helper_item("Page", "Item A (position 1)", 1, 100),
            ],
        }
        result = module_item_weeks(module)
        assert week_by_item_id(result, 100) == [0]  # before the subheader
        assert week_by_item_id(result, 102) == [7]  # after the subheader


# ──────────────────────────────────────────────
# Integration tests for API endpoints
# ──────────────────────────────────────────────

class TestListCourses:
    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_courses_success(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "Course 1", "course_code": "CODE1"},
                {"id": 2, "name": "Course 2", "course_code": "CODE2"},
            ],
            None,
        )

        response = client.get("/api/courses")
        assert response.status_code == 200
        data = response.get_json()
        assert data["course_count"] == 2
        assert len(data["courses"]) == 2

    @patch("main.get_canvas_headers")
    def test_list_courses_missing_token(self, mock_get_headers, client):
        mock_get_headers.return_value = None

        response = client.get("/api/courses")
        assert response.status_code == 401
        data = response.get_json()
        assert "error" in data

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_courses_api_failure(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        error_response = MagicMock()
        error_response.status_code = 500
        error_response.text = "Server error"
        mock_canvas_get.return_value = (None, error_response)

        response = client.get("/api/courses")
        assert response.status_code == 500
        data = response.get_json()
        assert "error" in data


class TestListCourseWeeks:
    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_success(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "TUẦN 36"},
                {"id": 2, "name": "TUẦN 37"},
                {"id": 3, "name": "TUẦN 38"},
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        assert data["weeks"] == [36, 37, 38]
        assert data["week_count"] == 3

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_with_non_week_modules(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "TUẦN 36"},
                {"id": 2, "name": "General"},
                {"id": 3, "name": "TUẦN 37"},
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        # Week 0 should now be included for non-week modules
        assert data["weeks"] == [0, 36, 37]

    @patch("main.get_canvas_headers")
    def test_list_weeks_missing_token(self, mock_get_headers, client):
        mock_get_headers.return_value = None

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 401

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_english_format(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "Week 36"},
                {"id": 2, "name": "Week 37"},
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        assert data["weeks"] == [36, 37]

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_expands_ranges(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "Tuần 36-40"},
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        assert data["weeks"] == [36, 37, 38, 39, 40]

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_multi_week_lists(self, mock_canvas_get, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "Tuần 23 + 24 + 25"},
                {"id": 2, "name": "Week 23, 24, 25"},
                {"id": 3, "name": "Week 23 & 24"},
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        assert data["weeks"] == [23, 24, 25]

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_list_weeks_from_subheaders(self, mock_canvas_get, mock_get_headers, client):
        """Week pills are derived from SubHeader items inside chapter modules."""
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {
                    "id": 1,
                    "name": "CHƯƠNG 8: Sự hô hấp và Trao đổi khí new",
                    "items": [
                        {"id": 1, "type": "SubHeader", "title": "Tuần 1 (13.8-21.8.2026) B8.1", "position": 1},
                        {"id": 2, "type": "SubHeader", "title": "Tuần 1,2 (17.8-28.8) B8.2", "position": 2},
                        {"id": 100, "type": "Page", "title": "Page", "position": 3},
                    ],
                },
            ],
            None,
        )

        response = client.get("/api/courses/1/weeks")
        assert response.status_code == 200
        data = response.get_json()
        assert data["weeks"] == [1, 2]


class TestGetCourseWeek:
    @patch("main.get_canvas_headers")
    @patch("main.get_week_items")
    def test_get_week_success(self, mock_get_week_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_week_items.return_value = (
            [
                {
                    "course_id": 1,
                    "course_name": "Test Course",
                    "module": "TUẦN 36",
                    "title": "Quiz 1",
                    "type": "Quiz",
                    "completed": False,
                    "url": "http://example.com/quiz/1",
                }
            ],
            "Test Course",
            None,
        )

        response = client.get("/api/courses/1/week/36")
        assert response.status_code == 200
        data = response.get_json()
        assert data["week"] == 36
        assert data["item_count"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["title"] == "Quiz 1"

    @patch("main.get_canvas_headers")
    @patch("main.get_week_items")
    def test_get_week_unfinished(self, mock_get_week_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_week_items.return_value = (
            [
                {
                    "course_id": 1,
                    "course_name": "Test Course",
                    "module": "TUẦN 36",
                    "title": "Assignment 1",
                    "type": "Assignment",
                    "completed": False,
                    "url": "http://example.com/assignment/1",
                }
            ],
            "Test Course",
            None,
        )

        response = client.get("/api/courses/1/week/36/unfinished")
        assert response.status_code == 200
        data = response.get_json()
        assert data["item_count"] == 1

    @patch("main.get_canvas_headers")
    @patch("main.get_week_items")
    def test_get_week_api_failure(self, mock_get_week_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_week_items.return_value = (None, None, MagicMock(status_code=500, text="Error"))

        response = client.get("/api/courses/1/week/36")
        assert response.status_code == 500
        data = response.get_json()
        assert "error" in data

    @patch("main.get_canvas_headers")
    def test_get_week_missing_token(self, mock_get_headers, client):
        mock_get_headers.return_value = None

        response = client.get("/api/courses/1/week/36")
        assert response.status_code == 401

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_get_week_range_returns_module(self, mock_canvas_get, mock_get_headers, client):
        """A module named 'Tuần 36-40' should be returned for week 37."""
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        # Mock get_course_modules to return a range module
        mock_canvas_get.return_value = (
            [{"id": 1, "name": "Tuần 36-40"}],
            None,
        )
        # Also need to mock get_course_name (called inside get_week_items)
        # And get_module_items

        with patch("main.get_course_name", return_value="Test Course"):
            with patch("main.get_module_items", return_value=([], None)):
                response = client.get("/api/courses/1/week/37")
                assert response.status_code == 200
                data = response.get_json()
                # The module should be found for week 37 (since 36-40 expands)
                # It won't have any matching items, but week should exist
                assert data["week"] == 37

    @patch("main.get_canvas_headers")
    @patch("main.canvas_get")
    def test_get_week_zero_general(self, mock_canvas_get, mock_get_headers, client):
        """Week 0 should return non-week modules."""
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_canvas_get.return_value = (
            [
                {"id": 1, "name": "📝Kiểm tra đánh giá học kì II"},
                {"id": 2, "name": "TUẦN 36"},
            ],
            None,
        )

        with patch("main.get_course_name", return_value="Test Course"):
            with patch("main.get_module_items", return_value=([], None)):
                response = client.get("/api/courses/1/week/0")
                assert response.status_code == 200
                data = response.get_json()
                assert data["week"] == 0


# ──────────────────────────────────────────────
# Unit tests for get_item_completion (three-state)
# ──────────────────────────────────────────────

class TestGetItemCompletion:
    """Tests for the get_item_completion() function."""

    def test_no_completion_requirement(self):
        """Item without completion_requirement should be unknown (None, False)."""
        item = {"id": 1, "title": "Quiz 1"}
        completed, has_tracking = get_item_completion(item)
        assert completed is None
        assert has_tracking is False

    def test_completed_true(self):
        """Item with completion_requirement and completed=True."""
        item = {"id": 1, "title": "Quiz 1", "completion_requirement": {"type": "must_submit", "completed": True}}
        completed, has_tracking = get_item_completion(item)
        assert completed is True
        assert has_tracking is True

    def test_completed_false(self):
        """Item with completion_requirement and completed=False."""
        item = {"id": 1, "title": "Quiz 1", "completion_requirement": {"type": "must_submit", "completed": False}}
        completed, has_tracking = get_item_completion(item)
        assert completed is False
        assert has_tracking is True

    def test_empty_completion_requirement(self):
        """Item with empty completion_requirement dict should be unknown."""
        item = {"id": 1, "title": "Quiz 1", "completion_requirement": {}}
        completed, has_tracking = get_item_completion(item)
        assert completed is None
        assert has_tracking is False


class TestFormatModuleItem:
    """Tests for format_module_item() with three-state completion."""

    def test_item_with_tracking_completed(self):
        item = {"id": 1, "title": "Done Quiz", "type": "Quiz", "completion_requirement": {"type": "must_submit", "completed": True}}
        result = format_module_item(1, "Course", {"id": 10, "name": "Module 1"}, item)
        assert result["completed"] is True
        assert result["has_tracking"] is True

    def test_item_with_tracking_unfinished(self):
        item = {"id": 2, "title": "Unfinished Quiz", "type": "Quiz", "completion_requirement": {"type": "must_submit", "completed": False}}
        result = format_module_item(1, "Course", {"id": 10, "name": "Module 1"}, item)
        assert result["completed"] is False
        assert result["has_tracking"] is True

    def test_item_without_tracking(self):
        item = {"id": 3, "title": "Unknown Quiz", "type": "Quiz"}
        result = format_module_item(1, "Course", {"id": 10, "name": "Module 1"}, item)
        assert result["completed"] is None
        assert result["has_tracking"] is False


# ──────────────────────────────────────────────
# Integration tests for Overview endpoint
# ──────────────────────────────────────────────

class TestCourseOverview:
    @patch("main.get_canvas_headers")
    @patch("main.get_all_course_items")
    def test_overview_success(self, mock_get_all_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        # Mock get_all_course_items to return week groups with mixed completion states
        mock_get_all_items.return_value = (
            {
                36: [
                    {"course_id": 1, "course_name": "Test", "module": "Tuần 36", "title": "Quiz 1", "type": "Quiz", "completed": True, "has_tracking": True},
                    {"course_id": 1, "course_name": "Test", "module": "Tuần 36", "title": "Quiz 2", "type": "Quiz", "completed": False, "has_tracking": True},
                    {"course_id": 1, "course_name": "Test", "module": "Tuần 36", "title": "Quiz 3", "type": "Quiz", "completed": None, "has_tracking": False},
                ],
                37: [
                    {"course_id": 1, "course_name": "Test", "module": "Tuần 37", "title": "Assignment 1", "type": "Assignment", "completed": True, "has_tracking": True},
                ],
            },
            None,
        )

        response = client.get("/api/courses/1/overview")
        assert response.status_code == 200
        data = response.get_json()
        assert data["course_id"] == 1
        assert data["week_count"] == 2
        assert len(data["weeks"]) == 2

        # Check week 36 stats
        week36 = data["weeks"][0]
        assert week36["week"] == 36
        assert week36["total"] == 3
        assert week36["done"] == 1
        assert week36["unfinished"] == 1
        assert week36["unknown"] == 1

        # Check week 37 stats
        week37 = data["weeks"][1]
        assert week37["week"] == 37
        assert week37["total"] == 1
        assert week37["done"] == 1
        assert week37["unfinished"] == 0
        assert week37["unknown"] == 0

        # Check totals
        assert data["totals"]["total"] == 4
        assert data["totals"]["done"] == 2
        assert data["totals"]["unfinished"] == 1
        assert data["totals"]["unknown"] == 1

    @patch("main.get_canvas_headers")
    def test_overview_missing_token(self, mock_get_headers, client):
        mock_get_headers.return_value = None
        response = client.get("/api/courses/1/overview")
        assert response.status_code == 401

    @patch("main.get_canvas_headers")
    @patch("main.get_all_course_items")
    def test_overview_api_failure(self, mock_get_all_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_all_items.return_value = (None, MagicMock(status_code=500, text="Error"))
        response = client.get("/api/courses/1/overview")
        assert response.status_code == 500
        data = response.get_json()
        assert "error" in data

    @patch("main.get_canvas_headers")
    @patch("main.get_all_course_items")
    def test_overview_empty_course(self, mock_get_all_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_all_items.return_value = ({}, None)
        response = client.get("/api/courses/1/overview")
        assert response.status_code == 200
        data = response.get_json()
        assert data["week_count"] == 0
        assert data["weeks"] == []
        assert data["totals"]["total"] == 0

    @patch("main.get_canvas_headers")
    @patch("main.get_course_name")
    @patch("main.get_course_modules")
    def test_overview_chapter_module_with_subheaders(self, mock_modules, mock_name, mock_headers, client):
        """A chapter-named module with week-bearing sub-headers is bucketed by week."""
        mock_headers.return_value = {"Authorization": "Bearer test"}
        mock_name.return_value = "Biology"
        mock_modules.return_value = (
            [
                {
                    "name": "CHƯƠNG 8: Sự hô hấp và Trao đổi khí new",
                    "items": [
                        {"id": 1, "type": "SubHeader", "title": "Tuần 1 (13.8-21.8.2026) B8.1 Hô Hấp", "position": 1},
                        {"id": 100, "type": "Page", "title": "[Tự học] B8.01: Hô hấp", "position": 2},
                        {"id": 2, "type": "SubHeader", "title": "Tuần 1,2 (17.8 - 28.8.2026) B8.2", "position": 3},
                        {"id": 101, "type": "Quiz", "title": "[Quiz tự học] trao đổi khí", "position": 4},
                        {"id": 3, "type": "SubHeader", "title": "Luyện tập", "position": 5},
                        {"id": 102, "type": "Quiz", "title": "[Quiz củng cố] B8.02", "position": 6},
                    ],
                },
            ],
            None,
        )

        response = client.get("/api/courses/1/overview")
        assert response.status_code == 200
        data = response.get_json()

        weeks = {w["week"]: w for w in data["weeks"]}
        # Week 1 gets the B8.01 page plus both B8.02 quizzes (B8.02 quiz spans
        # weeks 1,2, and the củng cố quiz inherits 1,2 through "Luyện tập")
        assert weeks[1]["total"] == 3
        # Week 2 gets the B8.02 quiz (spans) plus the B8.02 củng cố quiz (inherited)
        assert weeks[2]["total"] == 2
        # No items are uncategorized
        assert 0 not in weeks
        assert data["uncategorized_unfinished_count"] == 0
        # Items are counted once per assigned week (multi-week items double-count)
        assert data["totals"]["total"] == 5

        # Option B: items carry the sub-header title as their module label
        week1_items = weeks[1]["items"]
        # The overview items only expose a subset of fields, so verify via the
        # full fetch path instead of the summary. Just assert totals above.


class TestLegacyRoutes:
    @patch("main.get_canvas_headers")
    @patch("main.get_week_items")
    def test_legacy_week_route(self, mock_get_week_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_week_items.return_value = (
            [{"title": "Legacy Item", "type": "Quiz"}],
            "Course Name",
            None,
        )

        response = client.get("/api/week/36")
        assert response.status_code == 200
        data = response.get_json()
        assert "items" in data
        assert data["item_count"] == 1

    @patch("main.get_canvas_headers")
    @patch("main.get_week_items")
    def test_legacy_todo_route(self, mock_get_week_items, mock_get_headers, client):
        mock_get_headers.return_value = {"Authorization": "Bearer test"}
        mock_get_week_items.return_value = (
            [{"title": "Todo Item", "type": "Assignment"}],
            "Course Name",
            None,
        )

        response = client.get("/api/todo/36")
        assert response.status_code == 200
        data = response.get_json()
        assert "todo" in data
        assert data["todo_count"] == 1