# VinFocus
> "Everything from Canvas. Nothing in your way."

*Development is currently paused pending official approval from Vinschool.*

VinFocus is a personal information hub for Vinschool's Canvas LMS, designed for Vinschool students. It aggregates course modules and items into a cleaner interface so you can browse what exists — without trying to predict what you should do on a given day.

## Demo
> This demo shows a previous version of VinFocus. It does not represent the current development status or planned public authentication flow.

https://github.com/user-attachments/assets/c0bf2085-5e51-4b41-b13e-41436c0d9945

## Access

VinFocus is currently not publicly available while its integration with Vinschool's Canvas LMS is being reviewed.

The hosted demo is kept offline during this period. Development and testing continue locally.

## Screenshots
> Shown from the current development build. The manual token workflow is intended for local testing only and will be replaced by OAuth for public use.

### Landing Page
![VinFocus Landing Page](static/images/landing.png)

### Setup Wizard
![VinFocus Setup Wizard](static/images/setup-wizard.png)

### Work View
![VinFocus Work View](static/images/work-view.png)

### Timetable
![VinFocus timetable](static/images/timetable.png)

## Why I Built This

Vinschool's Canvas LMS contains all the information students need, but finding it often requires navigating through multiple pages and module lists. As a result, students can spend more time searching for information than actually using it.

I built VinFocus to make course content easier to access without replacing Canvas itself. It organizes modules into weeks and presents quizzes, assignments, files, and other resources in a single searchable view. It also highlights unfinished work and provides a timetable view, reducing the amount of navigation required.

VinFocus is not designed to tell students what they should do each day. Instead, it helps answer questions such as:

- What quizzes exist for this week?
- What assignments exist for this week?
- What resources are available for this week?
- What items are still unfinished?
- Which modules belong to each week?

Students decide what to work on. VinFocus simply makes the information easier to find.

## Why Not Just Use Vinschool LMS?

Canvas contains all the information students need, but navigating between courses, modules, assignments, quizzes, and files often requires many clicks.

VinFocus doesn't replace Canvas. It reorganizes the same information into a faster, searchable interface.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `j` or `←` | Previous week |
| `k` or `→` | Next week |
| `g` | Focus week input |
| `d` | Toggle unfinished filter |
| `f` | Toggle unknown filter |

## Features

### Navigation
- Course browser with pill-style navigation
- Week navigation with keyboard shortcuts (`j`/`k` to move, `g` to jump)
- Search across courses, modules, quizzes, assignments, and files

### Productivity
- Unfinished filter — filter items to only those explicitly tracked as incomplete by Canvas
- Unknown filter — filter items that have no completion tracking (Canvas doesn't report completion status)
- Semester progress dashboard — per-week item counts, completion stats, type breakdowns, and a visual progress bar
- Item importance — items matching keywords like `HKII`, `HS1`, `cuối năm` are visually highlighted as important
- Manual completion override — mark any item as done even without Canvas tracking; stored in browser localStorage with undo support
- Course progress bars — each course pill shows completion percentage

### Customization
- Dark/light theme toggle
- Subject labels — rename-only (no color customization)
- Bilingual UI (English/Vietnamese)

### Timetable
- Weekly timetable grid with Monday–Friday periods
- Current period and today column highlighting
- Next period highlighting
- Inline editing with desktop dropdown and mobile modal
- Per-period room numbers displayed under each subject
- Today vs full week view toggle on mobile
- One-click button to open the official VSC-Timetable schedule
- Data stored locally in browser

### About View
- App description and usage instructions
- How-to guide covering all major features

### Notices & Banners
- **Token expiry warning** — warns when your Canvas API token is about to expire or has already expired
- **Consent banner** — asks for permission to use localStorage for token persistence; falls back to sessionStorage if declined
- **Unassigned work warning** — in the overview dashboard, warns about unfinished items in modules without a week assignment
- **Terms & Conditions** — modal with privacy and usage terms, accessible from the consent banner

### Offline Support
- Service worker with network-first strategy for API calls
- Cache-first for static assets
- Previously loaded data remains accessible offline

### Other
- Feedback form
- Keyboard shortcuts
- Skeleton loading states
- Progressive loading messages for slow Canvas responses
- Client-side API response cache (5-minute TTL, 500 max entries)

## Tech Stack

- **Python** — Backend logic and API
- **Flask** — Web framework
- **Flask-CORS** — Cross-origin resource sharing for frontend access
- **Flask-Talisman** — Security headers (Content Security Policy)
- **Flask-Compress** — Response compression
- **Requests** — HTTP client for Canvas API
- **psycopg2-binary** — PostgreSQL database driver
- **python-dotenv** — Environment variable management
- **gunicorn** — Production WSGI server
- **pytest** — Testing framework
- **HTML / CSS / JavaScript** — Frontend

## API Endpoints

### Course-aware routes (development)

| Endpoint | Description |
|----------|-------------|
| `GET /api/courses` | Active courses for the authenticated user. Returns `{ course_count, courses: [{ id, name, course_code }] }`. |
| `GET /api/courses/<course_id>/weeks` | Week numbers found in module names and `Context Module Sub Header` items. Week `0` is included if any items have no week information. Returns `{ course_id, week_count, weeks: [int] }`. |
| `GET /api/courses/<course_id>/week/<week>` | Quizzes, assignments, files, and pages for a week. Returns `{ course_id, course_name, week, item_count, items: [...] }`. |
| `GET /api/courses/<course_id>/week/<week>/unfinished` | Same items, filtered to incomplete Canvas work. Same response shape. |
| `GET /api/courses/<course_id>/overview` | Overview data for a course: all weeks with item counts, completion stats (done/unfinished/unknown), type breakdowns, and uncategorized warning count. Returns `{ course_id, course_name, week_count, weeks: [...], totals: { total, done, unfinished, unknown }, uncategorized_unfinished_count: int }`. |

### Token Management

| Endpoint | Description |
|----------|-------------|
| `POST /api/validate-token` | Validate a Canvas API token. Expects JSON body `{ "token": "..." }` and `X-CSRF-Token` header. Returns `{ "valid": true/false, "message": "..." }`. Rate limited: 5 requests/minute. |
| `GET /api/csrf-token` | Get a CSRF token for POST endpoints. The frontend should include this token in the `X-CSRF-Token` header when making POST requests. Returns `{ "csrf_token": "..." }`. |

### Feedback

| Endpoint | Description |
|----------|-------------|
| `GET /api/feedback` | Get all feedback submissions. Requires `X-Admin-Key` header with the admin API key. |
| `POST /api/feedback` | Submit user feedback. Expects JSON body `{ "rating": int (1-5), "usage_type": str, "recommend": str, "improvement": str }` and `X-CSRF-Token` header. Rate limited: 10 requests/minute. |
| `DELETE /api/feedback/<feedback_id>` | Delete a specific feedback entry by ID. Requires `X-Admin-Key` header. Returns `{ "success": true/false, "message": "..." }`. |

### Health Check

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check endpoint for monitoring. Returns `{ "status": "healthy", "service": "VinFocus", "database": "configured" or "not configured", "database_detail": "ok" or "no database URL configured" or "connection failed", "version": "2.2" }`. |

### Legacy routes (backward compatibility)

These routes use a hardcoded default course ID (`32140`) and exist for older clients:

| Endpoint | Description |
|----------|-------------|
| `GET /api/week/<week>` | Items for a week in the default course. Returns `{ course_id, course_name, week, item_count, items }`. |
| `GET /api/todo/<week>` | Unfinished items for a week in the default course. Returns `{ course_id, course_name, week, todo_count, todo }`. |

### Item response shape

Each item in the `items` array has the following fields:

```json
{
  "course_id": 123,
  "course_name": "Course Name",
  "module": "TUẦN 36",
  "title": "Quiz 1",
  "type": "Quiz",
  "completed": false,
  "has_tracking": true,
  "module_item_id": 456,
  "url": "https://lms.vinschool.edu.vn/courses/123/quizzes/789"
}
```

- `completed`: `true` if tracked and done, `false` if tracked and not done, `null` if no completion tracking exists (unknown).
- `has_tracking`: `true` if Canvas reports a completion requirement for this item, `false` otherwise.

Allowed item types: `Quiz`, `Assignment`, `File`, `Page`.

## How It Works

The Flask server in `main.py` proxies Canvas API requests. The current development build uses a setup wizard for manually generated Canvas API tokens during local testing. The public release is planned to use Canvas OAuth instead.

The frontend loads courses, lets you pick a course and week, and renders items grouped by type. The timetable is stored locally in the browser's `localStorage` and is fully editable. The app also includes an overview sidebar with semester progress, week cards, and completion stats.

A service worker (`static/sw.js`) provides offline support with network-first API calls and cache-first static assets.

## Security

> **Authentication status:** The current development build uses manually generated Canvas API tokens for testing. This workflow is not intended for public, multi-user deployment. Public access is paused while OAuth-based authentication and the required institutional approval are being addressed.

- Tokens are stored only in browser localStorage (or sessionStorage if consent is declined)
- Tokens are never stored on VinFocus servers
- Tokens are sent to VinFocus only as needed for authenticated Canvas API requests
- Tokens are forwarded to Canvas for API authentication and are not stored server-side
- Users can revoke tokens at any time from Canvas
- Feedback submission (`POST /api/feedback`) requires a CSRF token obtained from `GET /api/csrf-token`
- Feedback admin access requires an `X-Admin-Key` header with constant-time comparison
- Content Security Policy headers restrict script and style sources
- CORS is restricted to specific origins
- Request body size limited to 1MB
- IP addresses are redacted from logs via privacy filter
- Rate limiting per IP address using token bucket algorithm

## Architecture Notes

- **Caching** — In-memory cache with a 5-minute TTL (same for all endpoints) and FIFO eviction (max 1000 entries). When the cache exceeds the limit, the oldest 20% of entries are evicted. Thread-safe with a lock. Cache keys include a SHA256 hash of the user's token to prevent data leaks between users.
- **Concurrency** — Module items are fetched using `get_course_modules(include_items=True)` to fetch all items in a single API call, eliminating N+1 requests.
- **Rate limiting** — Token bucket algorithm per IP address. General endpoints: 300 requests per 60-second window. Token validation: 5 requests per 60-second window. Feedback submission: 10 requests per minute.
- **Logging** — Structured logging with timestamps, log levels, and module names. IP addresses are redacted.
- **Week parsing** — A custom parser extracts week numbers from module names and `Context Module Sub Header` items. Supports Vietnamese (`tuần`, `tuân`, `tuan`) and English (`week`) keywords, ranges (`-`, `–`), lists (`+`, `&`, `,`, `/`, `=`), and mixed formats. Uses `functools.lru_cache` (maxsize=256) for caching parsed results.
- **SubHeader week inheritance** — Some teachers name top-level modules by chapter (e.g. `CHƯƠNG 8: Sự hô hấp...`) instead of by week, placing the actual week numbers in "Context Module Sub Header" items inside the module. `module_item_weeks()` walks each module's items in position order, assigns each item the weeks of the nearest preceding sub-header, and falls back to the top-level module name (then week 0) for items before the first sub-header. Sub-headers without week info (e.g. `[Nội dung bài học]`, `Luyện tập`) are treated as grouping headers that inherit the previous weeks. The weeks endpoint, per-week endpoint, unfinished endpoint, and overview endpoint all resolve weeks per-item so chapter-named modules are no longer dumped wholesale into "Unassigned Modules".
- **Course code parsing** — Course codes like `THCS.OP-MATHS-TEACHER` are parsed to extract subject keys for labeling and filtering.
- **CSRF protection** — Server-generated tokens with 1-hour expiry, validated on POST endpoints. Stale tokens are cleaned up periodically.
- **Database** — PostgreSQL connection pool (min 2, max 20 connections) for feedback storage.
- **Client-side caching** — API response cache with 5-minute TTL and 500 max entries. AbortController cancels stale requests.

## Running Locally

VinFocus can currently be run locally for development and testing.

> **Note:** The current local build uses manual Canvas API tokens for testing. This is not the intended authentication flow for a public multi-user release.

1. Install dependencies:

```bash
pip install -r requirements.txt
```

This will install all required packages including Flask, Flask-CORS, Flask-Talisman, Flask-Compress, psycopg2-binary, python-dotenv, gunicorn, requests, and pytest.

2. Start the app:

```bash
python main.py
```

3. Open `http://127.0.0.1:5000` in your browser.
 
> **Note:** Each Canvas API token lasts up to 4 months. You'll need to repeat the setup about 2–3 times per school year. The app will warn you a week before the token expires. This applies to the current manual-token development workflow.

## Running Tests

```bash
pytest tests/ -v
```

The test suite covers:

- **Unit tests** for the `extract_weeks()` parser (single weeks, ranges, multi-week lists, edge cases, non-week modules).
- **Unit tests** for `get_item_completion()` and `format_module_item()` (three-state completion: done, unfinished, unknown).
- **Unit tests** for `module_item_weeks()` (sub-header week inheritance, grouping headers without week info, multi-week sub-headers, items before the first sub-header, normal week-named modules).
- **Integration tests** for all API endpoints (success, missing token, API failure, week 0/general, range expansion, legacy routes, overview endpoint, three-state completion, chapter-named modules with week-bearing sub-headers, feedback endpoints).

Additionally, `tests/test_fixes.py` is a standalone verification script that can be run directly:

```bash
python tests/test_fixes.py
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_TOKEN` | — | Optional Canvas API token for local development/testing |
| `DATABASE_URL` | — | PostgreSQL database URL (for feedback feature) |
| `ADMIN_API_KEY` | — | Secret key for accessing feedback data. On Render, this is auto-generated. |
| `FLASK_DEBUG` | `"false"` | Enable Flask debug mode |
| `PORT` | `5000` | Port for the development server |

## Deployment

VinFocus was previously deployed on Render.

Public deployment is currently paused pending official approval from Vinschool
and changes to the Canvas authentication flow.

<!-- ## Accessing Feedback Data

The feedback endpoint is protected and requires an admin API key for security. To view feedback submissions:

### On Render (Production)

1. Go to your Render dashboard
2. Navigate to your web service → **Environment** tab
3. Copy the value of `ADMIN_API_KEY` (auto-generated by Render)
4. Make a request with the admin key:

```bash
curl -H "X-Admin-Key: YOUR_ADMIN_KEY" https://vinfocus.onrender.com/api/feedback
```

Or in your browser's developer console:

```javascript
fetch('/api/feedback', {
  headers: {
    'X-Admin-Key': 'YOUR_ADMIN_KEY'
  }
})
.then(r => r.json())
.then(console.log)
```

### Locally

Add `ADMIN_API_KEY` to your `.env` file:

```bash
ADMIN_API_KEY=your-secret-key-here
```

Then access feedback with:

```bash
curl -H "X-Admin-Key: your-secret-key-here" http://127.0.0.1:5000/api/feedback
```

**Note:** Never commit your `ADMIN_API_KEY` to version control. On Render, it's automatically generated and stored securely in the environment variables. -->

## Future Plans

- OAuth-based Canvas authentication for public multi-user access, pending institutional approval and developer-key setup
- Automatic timetable import from VSC Timetable (made a demo but requires permission from Vinschool's IT to continue)
- Cross-course global search (Experimental)
- Redesign Settings' UI
- Split view mode (Experimental)

## Notes

VinFocus currently uses manually generated Canvas API tokens for local development and testing.

Never commit Canvas credentials or tokens to the repository.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Author

Created by Phạm Lê Mạnh Hùng

## Contact

- Email: hung020121@gmail.com
- GitHub: https://github.com/PhamLeManhHung