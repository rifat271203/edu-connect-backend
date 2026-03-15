# Edu Connect Smart Home Feed (MVP Practical Design)

This document describes a practical backend design for a ranked mixed home feed at `GET /api/feed/home`.

---

## 1) Endpoint Design

### Route
- **Method**: `GET`
- **Path**: `/api/feed/home`
- **Auth**: Bearer JWT (required)

### Query Params
- `limit` (optional, default `20`, max `50`)
- `cursor` (optional, opaque base64url cursor)

### Response Shape

```json
{
  "feed": [
    {
      "id": 123,
      "user_id": 8,
      "content": "...",
      "media_url": null,
      "privacy": "public",
      "created_at": "2026-03-15T19:00:00.000Z",
      "updated_at": "2026-03-15T19:00:00.000Z",
      "author_name": "Ayesha Rahman",
      "author_role": "teacher",
      "author_profile_pic_url": "...",
      "like_count": 32,
      "comment_count": 7,
      "share_count": 3,
      "shared_course_count": 1,
      "source_types": ["followed", "course"],
      "feed_score": 0.876541
    }
  ],
  "pagination": {
    "type": "cursor",
    "limit": 20,
    "nextCursor": "eyJzY29yZSI6MC43N...",
    "hasMore": true
  },
  "strategy": {
    "candidateSources": ["followed_recent", "enrolled_course", "public_trending"],
    "weightedMixPattern": "2 followed : 1 course : 1 trending",
    "scoreWeights": {
      "relationship": 0.38,
      "course": 0.24,
      "recency": 0.23,
      "engagement": 0.15
    },
    "lookbackDays": {
      "followed": 14,
      "course": 21,
      "trending": 7
    }
  }
}
```

---

## 2) Candidate Generation + SQL Strategy

Generate candidates independently from 3 sources, each with a larger fetch size than final page size (e.g. `sourceFetchLimit = max(limit * 8, 80)`).

### A. Recent followed/friend posts (high priority)

```sql
SELECT
  p.id,
  p.user_id,
  p.content,
  p.media_url,
  p.privacy,
  p.created_at,
  p.updated_at,
  u.name AS author_name,
  u.role AS author_role,
  u.profile_pic_url AS author_profile_pic_url,
  (SELECT COUNT(*) FROM edu_post_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM edu_comments c WHERE c.post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id) AS share_count,
  0 AS shared_course_count
FROM edu_posts p
JOIN edu_users u ON u.id = p.user_id
JOIN edu_friendships f
  ON (
    (f.user1_id = ? AND f.user2_id = p.user_id)
    OR
    (f.user2_id = ? AND f.user1_id = p.user_id)
  )
WHERE p.user_id <> ?
  AND p.created_at >= ?
  AND p.privacy IN ('public', 'friends')
ORDER BY p.created_at DESC, p.id DESC
LIMIT ?;
```

### B. Enrolled course-relevant posts

```sql
SELECT
  p.id,
  p.user_id,
  p.content,
  p.media_url,
  p.privacy,
  p.created_at,
  p.updated_at,
  u.name AS author_name,
  u.role AS author_role,
  u.profile_pic_url AS author_profile_pic_url,
  (SELECT COUNT(*) FROM edu_post_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM edu_comments c WHERE c.post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id) AS share_count,
  course_rel.shared_course_count
FROM edu_posts p
JOIN edu_users u ON u.id = p.user_id
JOIN (
  SELECT
    cm_author.user_id,
    COUNT(DISTINCT cl.course_id) AS shared_course_count
  FROM classroom_members cm_author
  JOIN classrooms cl ON cl.id = cm_author.classroom_id
  JOIN courses c ON c.id = cl.course_id
  JOIN classroom_members cm_viewer
    ON cm_viewer.classroom_id = cm_author.classroom_id
   AND cm_viewer.user_id = ?
   AND cm_viewer.is_active = 1
   AND cm_viewer.removed_at IS NULL
  WHERE cm_author.is_active = 1
    AND cm_author.removed_at IS NULL
    AND cm_author.user_id <> ?
    AND c.status = 'active'
  GROUP BY cm_author.user_id
) AS course_rel
  ON course_rel.user_id = p.user_id
WHERE p.user_id <> ?
  AND p.created_at >= ?
  AND (
    p.privacy = 'public'
    OR (
      p.privacy = 'friends'
      AND EXISTS (
        SELECT 1
        FROM edu_friendships ef
        WHERE (ef.user1_id = ? AND ef.user2_id = p.user_id)
           OR (ef.user2_id = ? AND ef.user1_id = p.user_id)
      )
    )
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT ?;
```

### C. Public trending posts

```sql
SELECT
  p.id,
  p.user_id,
  p.content,
  p.media_url,
  p.privacy,
  p.created_at,
  p.updated_at,
  u.name AS author_name,
  u.role AS author_role,
  u.profile_pic_url AS author_profile_pic_url,
  (SELECT COUNT(*) FROM edu_post_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM edu_comments c WHERE c.post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id) AS share_count,
  0 AS shared_course_count
FROM edu_posts p
JOIN edu_users u ON u.id = p.user_id
WHERE p.user_id <> ?
  AND p.privacy = 'public'
  AND p.created_at >= ?
ORDER BY
  (
    (SELECT COUNT(*) FROM edu_post_likes l WHERE l.post_id = p.id)
    + (2 * (SELECT COUNT(*) FROM edu_comments c WHERE c.post_id = p.id))
    + (3 * (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id))
  ) DESC,
  p.created_at DESC,
  p.id DESC
LIMIT ?;
```

---

## 3) Service-Layer Logic (merge, dedupe, score, rank, paginate)

```pseudo
function getHomeFeed(userId, limit, cursor):
  limit = clamp(limit, 1..50, default=20)
  decodedCursor = decodeCursor(cursor) # contains score, createdAt, id

  sourceFetchLimit = max(limit * 8, 80)
  candidatePoolSize = max(limit * 6, 120)

  followedRows, courseRows, trendingRows = parallel(
    queryFollowedRecentPosts(userId, sourceFetchLimit),
    queryEnrolledCoursePosts(userId, sourceFetchLimit),
    queryTrendingPublicPosts(userId, sourceFetchLimit)
  )

  merged = map<postId, candidate>
  mergeSourceRows(followedRows, "followed", merged)
  mergeSourceRows(courseRows, "course", merged)
  mergeSourceRows(trendingRows, "trending", merged)

  # weighted mixing pattern: 2 followed : 1 course : 1 trending
  poolIds = buildBalancedPoolIds(
    followedRows,
    courseRows,
    trendingRows,
    candidatePoolSize,
    pattern=[followed, followed, course, trending]
  )

  candidates = merged entries for poolIds
  for each candidate in candidates:
    candidate.feed_score = computeFeedScore(candidate)

  sort candidates by:
    feed_score desc,
    created_at desc,
    id desc

  if decodedCursor exists:
    candidates = candidates strictlyBefore(decodedCursor)

  page = first (limit + 1)
  hasMore = page.length > limit
  items = hasMore ? first limit : page
  nextCursor = hasMore ? encode(last(items)) : null

  return {
    feed: shape(items),
    pagination: { type: cursor, limit, nextCursor, hasMore },
    strategy: ...
  }
```

---

## 4) Feed Scoring Formula (MVP)

Use normalized values in `[0,1]` and a weighted sum.

### Core

```text
score =
  0.38 * relationship
  + 0.24 * course_relevance
  + 0.23 * recency
  + 0.15 * engagement
  + multi_source_bonus
```

### Factor details
- `relationship`: `1` if from followed/friend source else `0`
- `course_relevance`: `min(1, shared_course_count / 2)`
- `recency`: `exp(-age_hours / 36)`
- `engagement`:
  - `weighted = likes + 2*comments + 3*shares`
  - `engagement = min(1, log1p(weighted) / log1p(200))`
- `multi_source_bonus`: `0.06 * (number_of_sources - 1)`

This is simple, explainable, and easy to tune by changing constants.

---

## 5) DB Requirements (MVP)

### Required existing tables
- `edu_posts`
- `edu_friendships`
- `classroom_members`, `classrooms`, `courses`
- `edu_post_likes`, `edu_comments`, `edu_shares`

### Recommended indexes

```sql
-- Posts retrieval and recency scans
CREATE INDEX idx_edu_posts_user_created ON edu_posts (user_id, created_at DESC, id DESC);
CREATE INDEX idx_edu_posts_privacy_created ON edu_posts (privacy, created_at DESC, id DESC);

-- Friend graph lookups
CREATE INDEX idx_edu_friendships_u1_u2 ON edu_friendships (user1_id, user2_id);
CREATE INDEX idx_edu_friendships_u2_u1 ON edu_friendships (user2_id, user1_id);

-- Course relevance joins
CREATE INDEX idx_classroom_members_user_active ON classroom_members (user_id, is_active, removed_at, classroom_id);
CREATE INDEX idx_classroom_members_classroom_active ON classroom_members (classroom_id, is_active, removed_at, user_id);
CREATE INDEX idx_classrooms_course ON classrooms (course_id);
CREATE INDEX idx_courses_status_id ON courses (status, id);

-- Engagement counters
CREATE INDEX idx_edu_post_likes_post ON edu_post_likes (post_id);
CREATE INDEX idx_edu_comments_post ON edu_comments (post_id);
CREATE INDEX idx_edu_shares_post ON edu_shares (post_id);
```

### Optional denormalized fields (later, for speed)
Add to `edu_posts` if traffic grows:
- `like_count INT DEFAULT 0`
- `comment_count INT DEFAULT 0`
- `share_count INT DEFAULT 0`
- `hot_score DECIMAL(10,4) DEFAULT 0`

Then update counters on write events to avoid repeated counting subqueries.

---

## 6) MVP vs Advanced Implementation

### MVP (recommended now)
1. Multi-source candidate generation using current SQL
2. Balanced candidate pool with pattern `followed, followed, course, trending`
3. In-memory dedupe + score + sort
4. Cursor pagination with tuple `(feed_score, created_at, id)`
5. Keep scoring weights configurable constants

### Advanced (later)
1. Materialized stats table for engagement and trend windows (1h/24h/7d)
2. Personalized features (author affinity, topic embeddings, click-through)
3. Diversity constraints (author cooldown, source caps)
4. Online weight tuning / A-B tests
5. Redis cache for first-page feed candidates
6. Offline ranking pipeline + feature store

---

## Practical Notes

- Keep feed deterministic for stable pagination: always tie-break by `(feed_score DESC, created_at DESC, id DESC)`.
- Cursor must be opaque and validated.
- Recompute score per request in MVP; migrate to precomputed features only when needed.
- Use a larger candidate fetch than page size to improve ranking quality.

