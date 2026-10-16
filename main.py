import os
import re
import time
import threading
import logging
import hashlib
import hmac
import secrets
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple
from functools import lru_cache

import requests
from flask import Flask, jsonify, make_response, request, send_from_directory, render_template
from flask_cors import CORS

from flask_talisman import Talisman
from flask_compress import Compress

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

from dotenv import load_dotenv

load_dotenv()

VINFOCUS_SCRIPT_VERSION = "1.10.2"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

class PrivacyFilter(logging.Filter):
    def filter(self, record):
        # Redact IP addresses from logs
        if hasattr(record, 'msg'):
            record.msg = re.sub(r'\d+\.\d+\.\d+\.\d+', '[REDACTED_IP]', str(record.msg))
        if record.args:
            record.args = tuple('[REDACTED_IP]' if isinstance(arg, str) and re.match(r'\d+\.\d+\.\d+\.\d+', arg) else arg for arg in record.args)
        return True

logger.addFilter(PrivacyFilter())

app = Flask(__name__)

Compress(app)

csp = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
}

Talisman(app, content_security_policy=csp, force_https=False)

# Limit request body size to 1MB
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

# Configure CORS for frontend access
CORS(app, resources={
    r"/api/*": {
        "origins": ["https://vinfocus.onrender.com", "http://localhost:5000"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-CSRF-Token"]
    }
})

# Configuration
class Config:
    DEFAULT_COURSE_ID = 32140
    LMS_BASE_URL = "https://lms.vinschool.edu.vn"
    REQUEST_TIMEOUT = 30  # Increased for overview requests
    PER_PAGE = 1000       # Increased for large courses
    CACHE_TTL = 300  # seconds (5 minutes)
    MAX_CACHE_SIZE = 1000  # Maximum number of cached items
    MAX_COURSE_ID = 999999  # Maximum reasonable course ID for validation
    
    # Rate limiting configuration (token bucket per IP)
    RATE_LIMIT_TOKENS = 300       # Max requests per window
    RATE_LIMIT_WINDOW = 60       # Window in seconds
    RATE_LIMIT_VALIDATE_TOKENS = 5   # Stricter limit for validate-token
    
    # Get debug mode from environment variable (default to False for safety)
    DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

# Apply configuration
app.config["DEBUG"] = Config.DEBUG

# Limit request body size to 1MB
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

# Configure CORS for frontend access
CORS(app, resources={
    r"/api/*": {
        "origins": ["https://vinfocus.onrender.com", "http://localhost:5000"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-CSRF-Token"]
    }
})

ALLOWED_ITEM_TYPES = frozenset({"Quiz", "Assignment", "File", "Page"})

# Detection: does the module name even mention weeks?
# Supports: tuần (accented), tuân (alternate accent), tuan (no accent), week
WEEK_KEYWORD = re.compile(r"(?:tu[âầa]?n|week)", re.IGNORECASE)
# Characters that separate week-number tokens inside a contiguous week expression
WEEK_SEPARATORS = frozenset("-–+&,/= >")

# In-memory cache: key -> {"data": ..., "ts": float}
# NOTE: Cache keys MUST include user-specific identifiers to prevent data leaks
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = threading.Lock()

# Rate limiting state: {ip: {"tokens": float, "last_refill": float}}
_rate_limit_state: Dict[str, Dict[str, float]] = {}
_rate_limit_lock = threading.Lock()

# CSRF token store: {token: expiry_timestamp}
_csrf_tokens: Dict[str, float] = {}
_csrf_token_lock = threading.Lock()

# Tokens are NEVER stored server-side. They are only read from the per-request
# `Authorization` header (sent by the frontend) or the optional API_TOKEN env var.


def get_client_ip() -> str:
    """Get the real client IP address, handling Render's proxy headers.
    
    Render sends the real client IP in the X-Forwarded-For header.
    Falls back to remote_addr if the header is not present.
    """
    # Check X-Forwarded-For header (set by Render's proxy)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For can contain multiple IPs (client, proxy1, proxy2, ...)
        # The first IP is the real client IP
        return forwarded_for.split(",")[0].strip()
    
    # Fallback to remote_addr
    return request.remote_addr or "unknown"


def check_rate_limit(ip: str, max_tokens: int = Config.RATE_LIMIT_TOKENS, window: int = Config.RATE_LIMIT_WINDOW) -> Tuple[bool, int]:
    """Rate limiting using token bucket algorithm.
    
    Each IP gets max_tokens tokens, refilled at window rate.
    Returns (allowed, retry_after_seconds).
    """
    now = time.time()
    with _rate_limit_lock:
        state = _rate_limit_state.get(ip)
        if state is None:
            # New IP, give full bucket
            _rate_limit_state[ip] = {"tokens": max_tokens - 1, "last_refill": now}
            return True, 0
        
        # Calculate tokens to add based on time elapsed
        elapsed = now - state["last_refill"]
        tokens_to_add = elapsed * (max_tokens / window)
        state["tokens"] = min(max_tokens, state["tokens"] + tokens_to_add)
        state["last_refill"] = now
        
        if state["tokens"] >= 1:
            state["tokens"] -= 1
            return True, 0
        else:
            retry_after = int((1 - state["tokens"]) / (max_tokens / window)) + 1
            return False, retry_after


def cleanup_rate_limit_state() -> None:
    """Periodically clean up stale rate limit entries."""
    now = time.time()
    with _rate_limit_lock:
        stale_ips = [
            ip for ip, state in _rate_limit_state.items()
            if now - state["last_refill"] > Config.RATE_LIMIT_WINDOW * 2
        ]
        for ip in stale_ips:
            del _rate_limit_state[ip]


def generate_csrf_token() -> str:
    """Generate and store a CSRF token (valid for 1 hour)."""
    token = secrets.token_hex(32)
    expiry = time.time() + 3600  # 1 hour
    with _csrf_token_lock:
        _csrf_tokens[token] = expiry
    return token


def validate_csrf_token(token: str) -> bool:
    """Validate a CSRF token and remove it if valid (one-time use)."""
    if not token:
        return False
    with _csrf_token_lock:
        expiry = _csrf_tokens.pop(token, None)
        if expiry is None:
            return False
        if time.time() > expiry:
            return False
    return True


def cleanup_csrf_tokens() -> None:
    """Remove expired CSRF tokens."""
    now = time.time()
    with _csrf_token_lock:
        expired = [t for t, exp in _csrf_tokens.items() if now > exp]
        for t in expired:
            del _csrf_tokens[t]


def cache_get(key: str) -> Optional[Any]:
    """Return cached value if it exists and hasn't expired, else None."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.time() - entry["ts"] < Config.CACHE_TTL:
            return entry["data"]
        return None


def cache_get_ttl(key: str, ttl: int) -> Optional[Any]:
    """Return cached value with a custom TTL."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.time() - entry["ts"] < ttl:
            return entry["data"]
        return None


def cache_set(key: str, data: Any) -> None:
    """Store a value in the cache with the current timestamp.
    
    Implements FIFO eviction if cache size exceeds MAX_CACHE_SIZE.
    Note: This is a simple FIFO eviction, not true LRU, due to Python dict
    insertion order preservation in Python 3.7+.
    """
    with _cache_lock:
        # Enforce cache size limit using FIFO eviction
        if len(_cache) >= Config.MAX_CACHE_SIZE:
            # Remove oldest 20% of entries (FIFO eviction)
            keys_to_remove = list(_cache.keys())[:int(Config.MAX_CACHE_SIZE * 0.2)]
            for old_key in keys_to_remove:
                del _cache[old_key]
            logger.info(f"Cache evicted {len(keys_to_remove)} entries")
        
        _cache[key] = {"data": data, "ts": time.time()}


@app.get("/")
def landing():
    return no_store_response(
        make_response(render_template("landing.html", version=VINFOCUS_SCRIPT_VERSION))
    )

@app.get("/app")
def app_page():
    return no_store_response(
        make_response(render_template("app.html"))
    )

@app.get("/static/<path:filename>")
def static_files(filename):
    response = make_response(send_from_directory("static", filename))
    # Cache images and manifest files aggressively (1 year)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response

@app.route("/sitemap.xml")
def sitemap():
    return app.send_static_file("sitemap.xml")


def no_store_response(response):
    response = make_response(response)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


def token_hash(headers: Dict[str, str]) -> str:
    """Generate a hash from the authorization token for cache key namespacing.
    
    This ensures cache entries are user-specific and prevents data leaks between users.
    Uses full SHA256 hash to eliminate collision risk.
    """
    token = headers.get("Authorization", "")
    if token.startswith("Bearer "):
        token = token[7:]
    return hashlib.sha256(token.encode()).hexdigest()


def get_canvas_headers() -> Optional[Dict[str, str]]:
    """Get Canvas API headers.

    Priority:
    1. Authorization header from the incoming request (frontend-sent PAT)
    2. API_TOKEN environment variable (legacy/fallback)

    Returns:
        Headers dict or None if no token available
    """
    # Priority 1: Authorization header from frontend (PAT)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]  # Strip "Bearer "
        if token:
            return {"Authorization": f"Bearer {token}"}

    # Priority 2: Environment variable (legacy fallback)
    token = os.getenv("API_TOKEN")
    if token:
        return {"Authorization": f"Bearer {token}"}

    return None


def require_headers():
    headers = get_canvas_headers()
    if not headers:
        return None, (jsonify({"error": "Missing API token. Please set your Canvas API token in the app."}), 401)
    return headers, None


def api_error(message: str, response: requests.Response) -> Tuple[Dict, int]:
    """Create a standardized API error response.
    
    Logs the error details server-side but doesn't expose sensitive information to the client.
    """
    logger.error(f"API error: {message} - Status: {response.status_code} - URL: {response.url}")
    return jsonify({
        "error": message,
        "status_code": response.status_code,
    }), response.status_code


def course_api_url(course_id: int) -> str:
    """Generate the Canvas API URL for a specific course."""
    return f"{Config.LMS_BASE_URL}/api/v1/courses/{course_id}"


def validate_course_id(course_id: int) -> Optional[str]:
    """Validate course ID is within reasonable bounds.
    
    Returns error message if invalid, None if valid.
    """
    if not isinstance(course_id, int) or course_id <= 0 or course_id > Config.MAX_COURSE_ID:
        return f"Invalid course ID: {course_id}"
    return None


def validate_week(week: int) -> Optional[str]:
    """Validate week number is within reasonable bounds.
    
    Returns error message if invalid, None if valid.
    """
    if not isinstance(week, int) or week < 0 or week > 100:
        return f"Invalid week number: {week}"
    return None


def canvas_get(url: str, headers: Dict[str, str], params: Optional[Dict] = None) -> Tuple[Optional[Dict], Optional[requests.Response]]:
    """Make a GET request to the Canvas API with retry logic for 429 errors.
    
    Implements exponential backoff when rate limited (429).
    Maximum 3 retries with delays of 1s, 2s, 4s (capped at 60s).
    
    Returns:
        Tuple of (data, error_response). If successful, data contains the JSON response
        and error_response is None. If failed, data is None and error_response contains
        the response object.
    """
    max_retries = 3
    base_delay = 1  # seconds
    
    for attempt in range(max_retries):
        try:
            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=Config.REQUEST_TIMEOUT,
            )

            if response.status_code == 429:
                # Rate limited - retry with exponential backoff
                if attempt < max_retries - 1:
                    delay = min(base_delay * (2 ** attempt), 60)
                    logger.warning(f"Canvas API rate limited (429). Retrying in {delay}s (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                else:
                    logger.error(f"Canvas API rate limited (429). Max retries exceeded for {url}")
                    return None, response

            if response.status_code != 200:
                logger.warning(f"Canvas API request failed: {response.status_code} for {url}")
                return None, response

            return response.json(), None
        except requests.exceptions.Timeout:
            logger.error(f"Canvas API request timeout: {url}")
            return None, None
        except requests.exceptions.RequestException as e:
            logger.error(f"Canvas API request error: {e} for {url}")
            return None, None
    
    # Should not reach here, but just in case
    return None, None


@lru_cache(maxsize=256)
def extract_weeks_cached(module_name: str) -> Tuple[int, ...]:
    """Cached version of extract_weeks using functools.lru_cache.
    
    Module names are typically short strings (under 200 chars) from Canvas,
    making them ideal for caching. The LRU cache with maxsize=256 should
    cover the active module set for most courses.
    
    Returns a tuple of sorted unique week numbers for hashability.
    """
    return tuple(extract_weeks_raw(module_name))


def extract_weeks(module_name: Optional[str]) -> List[int]:
    """Extract all week numbers from a Canvas module name.
    
    Uses a small parser that:
    1. Looks for the keyword (tuần or week) at the start of a phrase
    2. Collects the contiguous week-number expression following it
    3. Stops at the first unrelated word or punctuation
    4. Interprets ranges (-, –) and lists (+, &, ,, /)
    
    Returns a sorted list of unique week numbers, or [] if no week info found.
    This function delegates to extract_weeks_cached for caching the computation.
    """
    if not module_name:
        return []
    return list(extract_weeks_cached(module_name))


def extract_weeks_raw(module_name: str) -> List[int]:
    """Raw implementation of week extraction (no caching wrapper).
    
    Extracted to allow lru_cache on the string -> tuple conversion
    while maintaining the original List[int] interface.
    """
    if not module_name:
        return []

    # Normalize: strip leading emoji/common symbols that might precede the keyword
    name = module_name.strip()
    if not name:
        return []

    # Locate the week keyword
    match = WEEK_KEYWORD.search(name)
    if not match:
        logger.debug(f"No week keyword found in module: {module_name!r}")
        return []

    # Extract the substring starting at the keyword
    start = match.start()
    tail = name[start:]

    # Build a token sequence from the tail:
    # We want to collect: numbers, and allowed separators (-, +, &, ,, /)
    # Stop at the first unrelated token (a word, parenthesis, period, etc.)
    tokens = []
    i = len(match.group())  # skip past the keyword itself
    while i < len(tail):
        ch = tail[i]
        # Skip whitespace between tokens
        if ch.isspace():
            i += 1
            continue

        # Number: collect consecutive digits
        if ch.isdigit():
            j = i
            while j < len(tail) and tail[j].isdigit():
                j += 1
            tokens.append(("num", tail[i:j]))
            i = j
            continue

        # Separator characters
        if ch in WEEK_SEPARATORS:
            tokens.append(("sep", ch))
            i += 1
            continue

        # Anything else terminates the week expression
        break

    if not tokens:
        logger.debug(f"Keyword found but no numbers in module: {module_name!r}")
        return []

    # Parse tokens into week numbers
    weeks: List[int] = []
    i = 0
    while i < len(tokens):
        typ, val = tokens[i]
        if typ != "num":
            i += 1
            continue

        num = int(val)
        # Look ahead for a range: num - num, num – num, or num => num
        if i + 2 < len(tokens) and tokens[i + 1][0] == "sep" and tokens[i + 1][1] in "-–" and tokens[i + 2][0] == "num":
            end_num = int(tokens[i + 2][1])
            if num < end_num:
                weeks.extend(range(num, end_num + 1))
            else:
                weeks.append(num)
                weeks.append(end_num)
            i += 3
        # Handle "=>" range: num = > num (two consecutive sep tokens)
        elif (i + 3 < len(tokens)
              and tokens[i + 1][0] == "sep" and tokens[i + 1][1] == "="
              and tokens[i + 2][0] == "sep" and tokens[i + 2][1] == ">"
              and tokens[i + 3][0] == "num"):
            end_num = int(tokens[i + 3][1])
            if num < end_num:
                weeks.extend(range(num, end_num + 1))
            else:
                weeks.append(num)
                weeks.append(end_num)
            i += 4
        else:
            weeks.append(num)
            i += 1

    return sorted(set(weeks))


def get_courses(headers: Dict[str, str]) -> Tuple[Optional[List[Dict]], Optional[requests.Response]]:
    """Fetch all active courses from Canvas.
    
    NOTE: Courses are NOT cached globally because they are user-specific.
    Each user has different course access in Canvas, so caching would cause
    data leaks between users. This is intentionally not cached.
    """
    logger.info("Fetching courses from Canvas API")
    data, response = canvas_get(
        f"{Config.LMS_BASE_URL}/api/v1/courses",
        headers,
        params={"enrollment_state": "active", "per_page": Config.PER_PAGE},
    )
    if response is not None:
        return None, response

    courses = [
        {
            "id": course["id"],
            "name": course.get("name"),
            "course_code": course.get("course_code"),
        }
        for course in data
    ]

    logger.info(f"Fetched {len(courses)} courses (not cached - user-specific)")
    return courses, None


def get_course_name(course_id: int, headers: Dict[str, str]) -> str:
    """Fetch the name of a specific course."""
    cache_key = f"course_name:{token_hash(headers)}:{course_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    data, response = canvas_get(course_api_url(course_id), headers)
    if response is not None or data is None:
        name = f"Course {course_id}"
    else:
        name = data.get("name") or f"Course {course_id}"
    cache_set(cache_key, name)
    return name


def get_course_modules(course_id: int, headers: Dict[str, str], include_items: bool = False) -> Tuple[Optional[List[Dict]], Optional[requests.Response]]:
    """Fetch all modules for a specific course.
    
    Args:
        course_id: The Canvas course ID
        headers: Authentication headers
        include_items: If True, include all module items inline using Canvas's
            `include[]=items` parameter. This reduces API calls from N+1 to 1
            for overview/week endpoints at the cost of a larger response body.
    """
    params = {"per_page": Config.PER_PAGE}
    if include_items:
        params["include[]"] = "items"

    cache_key = f"modules:{token_hash(headers)}:{course_id}:include_items={include_items}"
    # Bypass cache when the request carries a cache-buster query param.
    # The frontend appends ?_t=<timestamp> on week/overview loads to force
    # fresh completion data from Canvas, so we must not serve stale modules.
    if request.args.get("_t"):
        with _cache_lock:
            _cache.pop(cache_key, None)
    else:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached, None

    data, response = canvas_get(
        f"{course_api_url(course_id)}/modules",
        headers,
        params=params,
    )
    if response is not None:
        return None, response

    cache_set(cache_key, data)
    return data, None


def get_week_modules(course_id: int, week: int, headers: Dict[str, str]) -> Tuple[Optional[List[Dict]], Optional[requests.Response]]:
    """Fetch modules that contain at least one item belonging to a specific week.

    Uses `include_items=True` to fetch all module items in a single API call,
    then filters modules by the week numbers resolved per-item via
    `module_item_weeks()` (which considers SubHeader week info).

    For week > 0: includes modules where any item's resolved weeks contain the
    requested week. For week == 0: includes modules with any item that could not
    be resolved to a week (General category) OR whose items carry no week at all.
    """
    modules, response = get_course_modules(course_id, headers, include_items=True)
    if response is not None:
        return None, response

    week_modules = []
    for module in modules:
        module_items = module.get("items")
        if not module_items:
            # No items at all: only relevant for the uncategorized week.
            if week == 0 and not extract_weeks(module.get("name")):
                week_modules.append(module)
            continue

        item_weeks_list = module_item_weeks(module)
        # Weeks resolved by sub-headers/module-name across this module's items.
        resolves_to_week0 = any(weeks == [0] for _, weeks, _ in item_weeks_list)
        matches_week = any(week in weeks for _, weeks, _ in item_weeks_list)

        if week == 0:
            # Include if any item is unresolvable (week 0) — but only if the
            # module itself isn't purely a week-named module without subheaders.
            if resolves_to_week0:
                week_modules.append(module)
        else:
            if matches_week:
                week_modules.append(module)

    return week_modules, None


def get_module_items(course_id: int, module_id: int, headers: Dict[str, str]) -> Tuple[Optional[List[Dict]], Optional[requests.Response]]:
    """Fetch all items for a specific module.
    
    NOTE: This is kept for backward compatibility and for use cases that need
    items for a single module. For overview/week endpoints, prefer using
    `get_course_modules(include_items=True)` to avoid N+1 API calls.
    """
    cache_key = f"items:{token_hash(headers)}:{course_id}:{module_id}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached, None

    data, response = canvas_get(
        f"{course_api_url(course_id)}/modules/{module_id}/items",
        headers,
        params={"per_page": Config.PER_PAGE},
    )
    if response is not None:
        return None, response

    cache_set(cache_key, data)
    return data, None


def item_url(course_id: int, item: Dict[str, Any]) -> Optional[str]:
    """Generate the direct URL for a Canvas item."""
    item_type = item.get("type")
    content_id = item.get("content_id")

    if item_type == "Quiz" and content_id:
        return f"{Config.LMS_BASE_URL}/courses/{course_id}/quizzes/{content_id}"

    if item_type == "Assignment" and content_id:
        return f"{Config.LMS_BASE_URL}/courses/{course_id}/assignments/{content_id}"

    return item.get("html_url")


def get_item_completion(item: Dict[str, Any]) -> Tuple[bool, bool]:
    """Determine completion status of a Canvas module item.
    
    Returns:
        Tuple of (is_completed, has_tracking).
        - is_completed: True if item has completion tracking and is completed
                        False if item has completion tracking and is not completed
                        None if item has no completion tracking (unknown)
        - has_tracking: True if Canvas reports a completion_requirement for this item
    """
    completion = item.get("completion_requirement")
    if not completion:
        return (None, False)
    return (completion.get("completed", False), True)


def module_item_weeks(module: Dict[str, Any]) -> List[Tuple[Dict[str, Any], List[int], str]]:
    """Walk a module's items in position order, assigning each a week set and label.

    Canvas teachers sometimes name a top-level module by chapter (e.g.
    "CHƯƠNG 8: Sự hô hấp...") rather than by week. In that structure the actual
    week numbers live in "Context Module Sub Header" items (type "SubHeader")
    that precede groups of real items inside the module.

    This helper yields each item (including SubHeader items, for module
    classification) paired with the week numbers parsed from the most recent
    preceding SubHeader and the display label (the SubHeader title). Items
    before any SubHeader fall back to the top-level module name; if that also
    has no week info they get week [0] (uncategorized).

    Returns a list of (item, weeks, label) tuples in position order.
    """
    items = module.get("items") or []
    # Ensure a deterministic order independent of API ordering.
    ordered = sorted(items, key=lambda it: it.get("position", 0))

    # Start with the top-level module name so items before any SubHeader still
    # get assigned (items with no resolvable week default to [0] / uncategorized).
    label = module.get("name", "Unnamed Module")
    weeks = extract_weeks(module.get("name"))

    result: List[Tuple[Dict[str, Any], List[int], str]] = []
    for item in ordered:
        if item.get("type") == "SubHeader":
            sub_title = item.get("title", "")
            if sub_title:
                label = sub_title
            sub_weeks = extract_weeks(sub_title)
            # A sub-header without week info (e.g. "[Nội dung bài học]" or
            # "Luyện tập") is a grouping header, not a week boundary — keep the
            # previously parsed weeks so trailing items stay in the right week.
            if sub_weeks:
                weeks = sub_weeks
            result.append((item, weeks, label))
            continue

        result.append((item, (weeks if weeks else [0]), label))

    return result


def format_module_item(course_id: int, course_name: str, module: Dict[str, Any], item: Dict[str, Any], module_label: Optional[str] = None) -> Dict[str, Any]:
    """Format a module item into a consistent structure for the frontend.

    Args:
        module_label: The display label for the item's group. Defaults to the
            top-level module name; callers should pass the nearest SubHeader
            title when one applies (see module_item_weeks).
    """
    is_completed, has_tracking = get_item_completion(item)

    return {
        "course_id": course_id,
        "course_name": course_name,
        "module": module_label or module.get("name", "Unnamed Module"),
        "title": item.get("title", "Untitled"),
        "type": item.get("type", "Unknown"),
        "completed": is_completed,
        "has_tracking": has_tracking,
        "module_item_id": item.get("id"),
        "url": item_url(course_id, item),
    }


def is_incomplete(item: Dict[str, Any]) -> bool:
    """Check if a Canvas item is incomplete (explicitly tracked and not completed).
    
    Items without completion tracking return False (they are "unknown", not "incomplete").
    """
    completion = item.get("completion_requirement")
    if not completion:
        return False
    return completion.get("completed") is False


def fetch_items_for_module(course_id: int, module: Dict[str, Any], headers: Dict[str, str]) -> Tuple[Dict[str, Any], Optional[List[Dict]]]:
    """Fetch and return (module, items_list) for a single module. Returns None items on error."""
    module_items, error = get_module_items(course_id, module["id"], headers)
    if error is not None:
        return module, None
    return module, module_items


def get_week_items(
    course_id: int,
    week: int,
    headers: Dict[str, str],
    unfinished_only: bool = False
) -> Tuple[Optional[List[Dict]], Optional[str], Optional[requests.Response]]:
    """Fetch all items for a specific week in a course.
    
    Uses `get_week_modules()` which fetches modules with embedded items in a
    single API call, then iterates the cached items directly.
    
    Args:
        course_id: The Canvas course ID
        week: The week number to fetch
        headers: Authentication headers
        unfinished_only: If True, only return explicitly-incomplete items (not unknown)
        
    Returns:
        Tuple of (items, course_name, error_response)
    """
    week_modules, response = get_week_modules(course_id, week, headers)
    if response is not None:
        return None, None, response

    course_name = get_course_name(course_id, headers)
    items = []

    for module in week_modules:
        # Items are embedded directly in the module response
        module_items = module.get("items")
        if not module_items:
            continue

        for item, item_weeks, item_label in module_item_weeks(module):
            if item.get("type") not in ALLOWED_ITEM_TYPES:
                continue
            # Only include items that actually belong to the requested week.
            # For week 0, item_weeks is already [0] for unresolvable items.
            if week not in item_weeks:
                continue
            if unfinished_only and not is_incomplete(item):
                continue
            items.append(format_module_item(course_id, course_name, module, item, module_label=item_label))

    logger.info(f"Found {len(items)} items for course {course_id}, week {week}")
    return items, course_name, None


def get_all_course_items(
    course_id: int,
    headers: Dict[str, str]
) -> Tuple[Optional[Dict[int, List[Dict]]], Optional[requests.Response]]:
    """Fetch ALL items for a course, grouped by week number.
    
    Uses `include_items=True` to fetch modules with embedded items in a single
    API call, eliminating the need for parallel module-item fetches.
    
    This is the workhorse for the overview endpoint. It:
    1. Fetches all modules with embedded items in ONE API call
    2. Groups items by the week numbers resolved per-item via module_item_weeks()
       (which considers SubHeader week info and falls back to the module name)

    Returns:
        Tuple of (week_groups, error_response) where week_groups is a dict
        mapping week number -> list of formatted items.
        Items that cannot be resolved to a week are grouped under week 0 (General).
    """
    modules, response = get_course_modules(course_id, headers, include_items=True)
    if response is not None:
        return None, response

    course_name = get_course_name(course_id, headers)

    # Group items by week directly from the modules-with-items response
    week_groups: Dict[int, List[Dict]] = {}
    for module in modules:
        for item, item_weeks, item_label in module_item_weeks(module):
            if item.get("type") not in ALLOWED_ITEM_TYPES:
                continue
            formatted = format_module_item(course_id, course_name, module, item, module_label=item_label)
            # An item may belong to multiple weeks (e.g. a sub-header spanning
            # weeks 1,2) — include it in each resolved week.
            for week in item_weeks:
                if not (0 <= week <= 100):
                    continue
                week_groups.setdefault(week, []).append(formatted)

    return week_groups, None


# ─── Rate Limiting Decorator ──────────────────────────────

def rate_limit(max_tokens: int = None, window: int = None):
    """Decorator to apply rate limiting to a route.
    
    Uses the client's IP address as the rate limit key.
    Returns 429 Too Many Requests if limit is exceeded.
    """
    if max_tokens is None:
        max_tokens = Config.RATE_LIMIT_TOKENS
    if window is None:
        window = Config.RATE_LIMIT_WINDOW
    
    def decorator(f):
        def wrapper(*args, **kwargs):
            # Get client IP (handles Render proxy)
            ip = get_client_ip()
            allowed, retry_after = check_rate_limit(ip, max_tokens, window)
            if not allowed:
                resp = jsonify({
                    "error": "Too many requests. Please slow down.",
                    "retry_after": retry_after
                })
                resp.status_code = 429
                resp.headers["Retry-After"] = str(retry_after)
                return resp
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator


# ─── Token Management Endpoints ─────────────────────────────────


def validate_canvas_token(access_token: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """Validate a Canvas access token against /api/v1/users/self.

    Returns (is_valid, user_info_dict_or_none). Used by the manual-token
    validation endpoint (/api/validate-token) to verify a Personal Access Token.
    The token is used only for this validation request and is never stored
    server-side.
    """
    if not access_token:
        return False, None

    url = f"{Config.LMS_BASE_URL}/api/v1/users/self"
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.exceptions.RequestException as e:
        logger.error(f"Token validation request failed: {e}")
        return False, None

    if resp.status_code == 200:
        return True, resp.json()
    elif resp.status_code == 401:
        logger.info("Token validation failed: 401 Unauthorized")
        return False, None
    else:
        logger.warning(f"Token validation unexpected status: {resp.status_code}")
        return False, None


@app.post("/api/validate-token")
@rate_limit(max_tokens=Config.RATE_LIMIT_VALIDATE_TOKENS, window=Config.RATE_LIMIT_WINDOW)
def validate_token():
    """Validate a Canvas API token by making a test call to the Canvas API.

    Expects JSON body: { "token": "..." }
    Requires X-CSRF-Token header for CSRF protection.
    Returns: { "valid": true/false, "message": "..." }
    The token is used only for this validation request and is never stored
    server-side. The frontend is responsible for persisting it in localStorage.

    Rate limited: 5 requests per minute per IP.
    """
    # Validate CSRF token
    csrf_token = request.headers.get("X-CSRF-Token", "")
    if not validate_csrf_token(csrf_token):
        return jsonify({"valid": False, "message": "Invalid or missing CSRF token. Please refresh and try again."}), 403

    data = request.get_json(silent=True)
    if not data or not data.get("token"):
        return jsonify({"valid": False, "message": "No token provided."}), 400

    token = data["token"].strip()
    if not token:
        return jsonify({"valid": False, "message": "Token is empty."}), 400

    # Use shared validation function (validates against /api/v1/users/self)
    valid, user_info = validate_canvas_token(token)
    if valid:
        return jsonify({
            "valid": True,
            "message": "Token is valid.",
        })
    else:
        return jsonify({
            "valid": False,
            "message": "Token is invalid or expired. Please check your token and try again.",
        })


@app.get("/api/csrf-token")
@rate_limit()
def get_csrf_token():
    """Get a CSRF token for POST endpoints.

    The frontend should include this token in the X-CSRF-Token header
    when making POST requests to /api/validate-token or /api/feedback.
    """
    token = generate_csrf_token()
    return jsonify({"csrf_token": token})


# ─── API Routes ────────────────────────────────────────────────


@app.get("/api/courses")
@rate_limit()
def list_courses():
    """List all active courses for the authenticated user."""
    headers, error = require_headers()
    if error:
        return error

    courses, response = get_courses(headers)
    if response is not None:
        return api_error("Failed to fetch courses", response)

    logger.info(f"Returning {len(courses)} courses")
    return jsonify({
        "course_count": len(courses),
        "courses": courses,
    })


@app.get("/api/courses/<int:course_id>/weeks")
@rate_limit()
def list_course_weeks(course_id: int):
    """List all week numbers found in module names for a course."""
    # Input validation
    error_msg = validate_course_id(course_id)
    if error_msg:
        return jsonify({"error": error_msg}), 400

    headers, error = require_headers()
    if error:
        return error

    modules, response = get_course_modules(course_id, headers, include_items=True)
    if response is not None:
        return api_error("Failed to fetch modules", response)

    # Collect all week numbers from extract_weeks (ranges already expanded).
    # Weeks may come from the top-level module name or from SubHeader items
    # within a chapter-named module, so we resolve them per-item.
    weeks = set()
    has_general = False
    for module in modules:
        module_items = module.get("items")

        if not module_items:
            module_weeks = extract_weeks(module.get("name"))
            if not module_weeks:
                has_general = True
            else:
                weeks.update(w for w in module_weeks if 0 <= w <= 100)
            continue

        for _item, item_weeks, _label in module_item_weeks(module):
            validated = [w for w in item_weeks if 0 <= w <= 100]
            if not validated:
                has_general = True
            else:
                weeks.update(validated)

    result = sorted(weeks)
    if has_general:
        result = [0] + result

    logger.info(f"Found {len(result)} weeks for course {course_id}")
    return jsonify({
        "course_id": course_id,
        "week_count": len(result),
        "weeks": result,
    })


@app.get("/api/courses/<int:course_id>/week/<int:week>")
@rate_limit()
def get_course_week(course_id: int, week: int):
    """Get all items (quizzes, assignments, files) for a specific week."""
    # Input validation
    error_msg = validate_course_id(course_id)
    if error_msg:
        return jsonify({"error": error_msg}), 400
    error_msg = validate_week(week)
    if error_msg:
        return jsonify({"error": error_msg}), 400

    headers, error = require_headers()
    if error:
        return error

    items, course_name, response = get_week_items(course_id, week, headers)
    if response is not None:
        return api_error("Failed to fetch modules", response)

    logger.info(f"Returning {len(items)} items for course {course_id}, week {week}")
    return jsonify({
        "course_id": course_id,
        "course_name": course_name,
        "week": week,
        "item_count": len(items),
        "items": items,
    })


@app.get("/api/courses/<int:course_id>/week/<int:week>/unfinished")
@rate_limit()
def get_course_week_unfinished(course_id: int, week: int):
    """Get unfinished items for a specific week."""
    # Input validation
    error_msg = validate_course_id(course_id)
    if error_msg:
        return jsonify({"error": error_msg}), 400
    error_msg = validate_week(week)
    if error_msg:
        return jsonify({"error": error_msg}), 400

    headers, error = require_headers()
    if error:
        return error

    items, course_name, response = get_week_items(
        course_id, week, headers, unfinished_only=True
    )
    if response is not None:
        return api_error("Failed to fetch modules", response)

    logger.info(f"Returning {len(items)} unfinished items for course {course_id}, week {week}")
    return jsonify({
        "course_id": course_id,
        "course_name": course_name,
        "week": week,
        "item_count": len(items),
        "items": items,
    })


@app.get("/api/courses/<int:course_id>/overview")
@rate_limit()
def get_course_overview(course_id: int):
    """Get overview data for a course: all weeks with their item counts and completion stats.
    
    This is a dedicated, efficient endpoint that fetches ALL course data in one pass,
    replacing the previous approach of making N*2 individual week requests.
    """
    # Input validation
    error_msg = validate_course_id(course_id)
    if error_msg:
        return jsonify({"error": error_msg}), 400

    headers, error = require_headers()
    if error:
        return error

    course_name = get_course_name(course_id, headers)
    
    week_groups, response = get_all_course_items(course_id, headers)
    if response is not None:
        return api_error("Failed to fetch course items for overview", response)

    # Build overview summary for each week
    week_summaries = []
    for week in sorted(week_groups.keys()):
        items_list = week_groups[week]
        total = len(items_list)
        done = sum(1 for item in items_list if item["completed"] is True)
        unfinished = sum(1 for item in items_list if item["completed"] is False)
        unknown = sum(1 for item in items_list if item["completed"] is None)
        
        # Count by type
        type_counts = {}
        for item in items_list:
            item_type = item["type"]
            type_counts[item_type] = type_counts.get(item_type, 0) + 1

        week_summaries.append({
            "week": week,
            "total": total,
            "done": done,
            "unfinished": unfinished,
            "unknown": unknown,
            "type_counts": type_counts,
            "items": [
                {
                    "course_id": item["course_id"],
                    "module_item_id": item.get("module_item_id"),
                    "completed": item["completed"],
                }
                for item in items_list
            ],
        })

    # Build course-wide totals
    total_all = sum(ws["total"] for ws in week_summaries)
    total_done = sum(ws["done"] for ws in week_summaries)
    total_unfinished = sum(ws["unfinished"] for ws in week_summaries)
    total_unknown = sum(ws["unknown"] for ws in week_summaries)

    # Count unfinished + unknown items in uncategorized (week 0) modules
    uncategorized_unfinished_count = 0
    for ws in week_summaries:
        if ws["week"] == 0:
            uncategorized_unfinished_count = ws["unfinished"] + ws["unknown"]
            break

    response_data = {
        "course_id": course_id,
        "course_name": course_name,
        "week_count": len(week_summaries),
        "weeks": week_summaries,
        "totals": {
            "total": total_all,
            "done": total_done,
            "unfinished": total_unfinished,
            "unknown": total_unknown,
        },
        "uncategorized_unfinished_count": uncategorized_unfinished_count,
    }

    logger.info(f"Returning overview for course {course_id}: {len(week_summaries)} weeks, {total_all} items")
    return jsonify(response_data)


@app.get("/api/week/<int:week>")
@rate_limit()
def get_week_legacy(week: int):
    """Legacy route for backward compatibility."""
    return _legacy_week_response(week, unfinished_only=False)


@app.get("/api/todo/<int:week>")
@rate_limit()
def get_todo_legacy(week: int):
    """Legacy route for backward compatibility."""
    return _legacy_week_response(week, unfinished_only=True, todo_key=True)


def _legacy_week_response(week: int, unfinished_only: bool = False, todo_key: bool = False):
    """Handle legacy week/todo API routes."""
    headers, error = require_headers()
    if error:
        return error

    items, course_name, response = get_week_items(
        Config.DEFAULT_COURSE_ID, week, headers, unfinished_only=unfinished_only
    )
    if response is not None:
        return api_error("Failed to fetch modules", response)

    payload = {
        "course_id": Config.DEFAULT_COURSE_ID,
        "course_name": course_name,
        "week": week,
    }

    if todo_key:
        payload["todo_count"] = len(items)
        payload["todo"] = items
    else:
        payload["item_count"] = len(items)
        payload["items"] = items

    return jsonify(payload)


# ─── Feedback Database ─────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL")

# Database connection pool (initialized on startup)
_db_pool: Optional[SimpleConnectionPool] = None

def init_db_pool() -> None:
    """Initialize database connection pool."""
    global _db_pool
    if not DATABASE_URL:
        logger.warning("DATABASE_URL not set - feedback features will be disabled")
        return

    try:
        _db_pool = SimpleConnectionPool(
            minconn=2,     # Increased from 1 for redundancy
            maxconn=20,    # Increased from 10 for production load with 2 gunicorn workers
            dsn=DATABASE_URL,
            cursor_factory=RealDictCursor
        )
        logger.info("Database connection pool initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database pool: {e}")
        _db_pool = None

def get_db():
    """Get a database connection from the pool."""
    if _db_pool is None:
        raise RuntimeError("Database not configured")
    return _db_pool.getconn()


def init_db() -> None:
    """Initialize the feedback database, creating the table if it doesn't exist."""
    if _db_pool is None:
        logger.warning("Skipping database initialization - DATABASE_URL not configured")
        return
    
    conn = get_db()
    cur = conn.cursor()

    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                usage_type TEXT NOT NULL,
                recommend TEXT NOT NULL,
                improvement TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        logger.info("Feedback database initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        conn.rollback()
    finally:
        cur.close()
        _db_pool.putconn(conn)


@app.post("/api/feedback")
@rate_limit(max_tokens=10)
def submit_feedback():
    """Submit user feedback.
    
    Expects JSON body: { "rating": int, "usage_type": str, "recommend": str, "improvement": str }
    Requires X-CSRF-Token header for CSRF protection.
    Returns: { "success": true/false, "message": "..." }
    """
    # Validate CSRF token
    csrf_token = request.headers.get("X-CSRF-Token", "")
    if not validate_csrf_token(csrf_token):
        return jsonify({"success": False, "message": "Invalid or missing CSRF token. Please refresh and try again."}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "No data provided."}), 400

    rating = data.get("rating")
    usage_type = data.get("usage_type")
    recommend = data.get("recommend")
    improvement = data.get("improvement", "")

    # Validate required fields
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({"success": False, "message": "Rating must be an integer between 1 and 5."}), 400

    allowed_usage = ["quizzes_assignments", "timetable", "unfinished", "other"]
    if usage_type not in allowed_usage:
        return jsonify({"success": False, "message": f"Usage type must be one of: {', '.join(allowed_usage)}."}), 400

    allowed_recommend = ["yes", "maybe", "no"]
    if recommend not in allowed_recommend:
        return jsonify({"success": False, "message": f"Recommend must be one of: {', '.join(allowed_recommend)}."}), 400

    if not isinstance(improvement, str):
        improvement = ""

    if _db_pool is None:
        return jsonify({"success": False, "message": "Feedback system is temporarily unavailable."}), 503
    
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute(
            """
            INSERT INTO feedback
            (rating, usage_type, recommend, improvement)
            VALUES (%s, %s, %s, %s)
            """,
            (rating, usage_type, recommend, improvement)
        )

        conn.commit()
        logger.info(f"Feedback saved: rating={rating}, usage={usage_type}, recommend={recommend}")
        return jsonify({"success": True, "message": "Thank you for your feedback!"})
    except Exception as e:
        logger.error(f"Failed to save feedback: {e}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "message": "An error occurred while saving feedback."}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            _db_pool.putconn(conn)


@app.get("/api/feedback")
def get_feedback():
    """Get all feedback submissions.
    
    Requires admin API key for authentication.
    """
    # Check admin API key (use constant-time comparison to prevent timing attacks)
    admin_key = request.headers.get("X-Admin-Key")
    expected_key = os.getenv("ADMIN_API_KEY", "")
    if not admin_key or not hmac.compare_digest(admin_key, expected_key):
        logger.warning("Unauthorized attempt to access feedback endpoint")
        return jsonify({"error": "Unauthorized. Access denied."}), 401
    
    if _db_pool is None:
        return jsonify({"error": "Feedback system is temporarily unavailable."}), 503
    
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT *
            FROM feedback
            ORDER BY id DESC
        """)

        rows = cur.fetchall()

        return jsonify(rows)

    except Exception as e:
        logger.error(f"Failed to fetch feedback: {e}")
        return jsonify({"error": "Failed to fetch feedback"}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            _db_pool.putconn(conn)


@app.delete("/api/feedback/<int:feedback_id>")
def delete_feedback(feedback_id: int):
    """Delete a specific feedback entry by ID.
    
    Requires admin API key for authentication.
    Returns: { "success": true/false, "message": "..." }
    """
    # Check admin API key (use constant-time comparison to prevent timing attacks)
    admin_key = request.headers.get("X-Admin-Key")
    expected_key = os.getenv("ADMIN_API_KEY", "")
    if not admin_key or not hmac.compare_digest(admin_key, expected_key):
        logger.warning("Unauthorized attempt to delete feedback")
        return jsonify({"error": "Unauthorized. Access denied."}), 401
    
    if _db_pool is None:
        return jsonify({"error": "Feedback system is temporarily unavailable."}), 503
    
    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()

        # Check if feedback exists
        cur.execute("SELECT id FROM feedback WHERE id = %s", (feedback_id,))
        if cur.fetchone() is None:
            return jsonify({"success": False, "message": "Feedback not found."}), 404

        cur.execute("DELETE FROM feedback WHERE id = %s", (feedback_id,))
        conn.commit()
        
        logger.info(f"Feedback deleted: id={feedback_id}")
        return jsonify({"success": True, "message": "Feedback deleted successfully."})
    except Exception as e:
        logger.error(f"Failed to delete feedback: {e}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "message": "An error occurred while deleting feedback."}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            _db_pool.putconn(conn)


# ─── Health Check ───────────────────────────────────────────────

@app.get("/health")
def health_check():
    """Health check endpoint for Render monitoring.
    
    Tests database connectivity and returns detailed status.
    """
    db_status = "configured"
    db_detail = "ok"
    
    if _db_pool is None:
        db_status = "not configured"
        db_detail = "no database URL configured"
    else:
        # Test actual database connectivity
        conn = None
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.close()
        except Exception as e:
            db_status = "error"
            db_detail = "connection failed"
            logger.error(f"Health check database error: {e}")
        finally:
            if conn:
                try:
                    _db_pool.putconn(conn)
                except Exception:
                    pass
    
    return jsonify({
        "status": "healthy" if db_status != "error" else "degraded",
        "service": "VinFocus",
        "database": db_status,
        "database_detail": db_detail,
        "version": VINFOCUS_SCRIPT_VERSION,
    }), 200 if db_status != "error" else 503


# ─── Error Handlers ──────────────────────────────────────────────

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle request body too large errors."""
    return jsonify({
        "error": "Request body too large. Maximum size is 1MB."
    }), 413


# ─── Startup ────────────────────────────────────────────────────

init_db_pool()
init_db()

# Log rate limiter configuration
logger.info(f"Rate limiting configured: {Config.RATE_LIMIT_TOKENS} requests per {Config.RATE_LIMIT_WINDOW}s per IP")

# Initial cleanup of stale rate limit and CSRF state
cleanup_rate_limit_state()
cleanup_csrf_tokens()

# Start background cleanup thread
_cleanup_thread_started = False

def _start_cleanup_thread():
    global _cleanup_thread_started
    if _cleanup_thread_started:
        return
    _cleanup_thread_started = True

    def cleanup_loop():
        while True:
            time.sleep(300)  # Every 5 minutes
            cleanup_rate_limit_state()
            cleanup_csrf_tokens()

    thread = threading.Thread(target=cleanup_loop, daemon=True)
    thread.start()
    logger.info("Started background cleanup thread for rate limit and CSRF state")

_start_cleanup_thread()

if __name__ == "__main__":
    logger.info(f"Starting VinFocus in {'DEBUG' if Config.DEBUG else 'PRODUCTION'} mode")
    app.run(debug=Config.DEBUG, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
