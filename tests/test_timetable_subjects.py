import pytest

import main


@pytest.mark.parametrize(
    "course_name, expected",
    [
        ("Công nghệ thông tin", "IT"),
        ("Công Nghệ Thông Tin", "IT"),
        ("cong nghe thong tin", "IT"),
        ("CNTT", "IT"),
        ("Tin học", "IT"),
        ("Tin hoc", "IT"),
        ("HANGVM5-CÔNG NGHỆ THÔNG TIN-10-2026 - 2027", "IT"),
        ("Công nghệ", "TECH"),
        ("Công Nghệ", "TECH"),
        ("cong nghe", "TECH"),
        ("TRANGPT68-CÔNG NGHỆ-10-THPT-OCEAN PARK-2026 - 2027", "TECH"),
    ],
)
def test_normalize_course_subject_distinguishes_ict_and_tech(course_name, expected):
    assert main._normalize_course_subject(course_name) == expected


def test_normalize_course_subject_rejects_empty_name():
    assert main._normalize_course_subject("") is None
