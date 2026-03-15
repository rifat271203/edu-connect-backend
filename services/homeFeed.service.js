const { runQuery } = require('../utils/eduSchema');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SOURCE_LOOKBACK_DAYS = Object.freeze({
  followed: 14,
  course: 21,
  trending: 7,
});

const MIX_PATTERN = Object.freeze(['followed', 'followed', 'course', 'trending']);

const SCORE_WEIGHTS = Object.freeze({
  relationship: 0.38,
  course: 0.24,
  recency: 0.23,
  engagement: 0.15,
});

function clampLimit(rawLimit) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }
  return date;
}

function safeCursorDecode(cursor) {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const score = Number(decoded.score);
    const createdAt = new Date(decoded.createdAt);
    const id = Number(decoded.id);

    if (!Number.isFinite(score) || Number.isNaN(createdAt.getTime()) || !Number.isInteger(id) || id <= 0) {
      const err = new Error('Invalid cursor');
      err.status = 400;
      throw err;
    }

    return {
      score,
      createdAt,
      id,
    };
  } catch (error) {
    const err = new Error('Invalid cursor');
    err.status = 400;
    throw err;
  }
}

function encodeCursor(item) {
  const payload = {
    score: item.feed_score,
    createdAt: toDate(item.created_at).toISOString(),
    id: Number(item.id),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function engagementNormalize(likeCount, commentCount, shareCount) {
  const likes = toNumber(likeCount);
  const comments = toNumber(commentCount);
  const shares = toNumber(shareCount);
  const weighted = likes + (2 * comments) + (3 * shares);
  return Math.min(1, Math.log1p(weighted) / Math.log1p(200));
}

function recencyNormalize(createdAt) {
  const created = toDate(createdAt);
  const ageMs = Math.max(Date.now() - created.getTime(), 0);
  const ageHours = ageMs / (1000 * 60 * 60);
  return Math.exp(-ageHours / 36);
}

function computeFeedScore(candidate) {
  const relationship = candidate.sources.followed ? 1 : 0;
  const courseRelevance = Math.min(1, toNumber(candidate.shared_course_count) / 2);
  const recency = recencyNormalize(candidate.created_at);
  const engagement = engagementNormalize(candidate.like_count, candidate.comment_count, candidate.share_count);
  const multiSourceBonus = Math.max(0, Object.keys(candidate.sources).length - 1) * 0.06;

  const score =
    (SCORE_WEIGHTS.relationship * relationship) +
    (SCORE_WEIGHTS.course * courseRelevance) +
    (SCORE_WEIGHTS.recency * recency) +
    (SCORE_WEIGHTS.engagement * engagement) +
    multiSourceBonus;

  return Number(score.toFixed(6));
}

function compareFeedItemsDesc(a, b) {
  if (a.feed_score !== b.feed_score) {
    return b.feed_score - a.feed_score;
  }

  const aTime = toDate(a.created_at).getTime();
  const bTime = toDate(b.created_at).getTime();
  if (aTime !== bTime) {
    return bTime - aTime;
  }

  return Number(b.id) - Number(a.id);
}

function isStrictlyAfterCursor(item, cursor) {
  const epsilon = 1e-9;

  if (item.feed_score > cursor.score + epsilon) return true;
  if (item.feed_score < cursor.score - epsilon) return false;

  const itemTime = toDate(item.created_at).getTime();
  const cursorTime = cursor.createdAt.getTime();
  if (itemTime > cursorTime) return true;
  if (itemTime < cursorTime) return false;

  return Number(item.id) > Number(cursor.id);
}

function isStrictlyBeforeCursor(item, cursor) {
  const epsilon = 1e-9;

  if (item.feed_score < cursor.score - epsilon) return true;
  if (item.feed_score > cursor.score + epsilon) return false;

  const itemTime = toDate(item.created_at).getTime();
  const cursorTime = cursor.createdAt.getTime();
  if (itemTime < cursorTime) return true;
  if (itemTime > cursorTime) return false;

  return Number(item.id) < Number(cursor.id);
}

function mergeSourceRows(rows, sourceName, merged) {
  rows.forEach((row) => {
    const postId = Number(row.id);
    if (!postId) return;

    if (!merged.has(postId)) {
      merged.set(postId, {
        ...row,
        id: postId,
        user_id: Number(row.user_id),
        like_count: toNumber(row.like_count),
        comment_count: toNumber(row.comment_count),
        share_count: toNumber(row.share_count),
        shared_course_count: toNumber(row.shared_course_count),
        sources: {
          followed: false,
          course: false,
          trending: false,
        },
      });
    }

    const existing = merged.get(postId);
    existing.sources[sourceName] = true;
    existing.shared_course_count = Math.max(existing.shared_course_count, toNumber(row.shared_course_count));
  });
}

function buildBalancedPoolIds({ followedRows, courseRows, trendingRows, targetPoolSize }) {
  const sourceQueues = {
    followed: followedRows.map((row) => Number(row.id)).filter(Boolean),
    course: courseRows.map((row) => Number(row.id)).filter(Boolean),
    trending: trendingRows.map((row) => Number(row.id)).filter(Boolean),
  };

  const pointers = { followed: 0, course: 0, trending: 0 };
  const selected = [];
  const seen = new Set();

  function pullNextFromSource(source) {
    const queue = sourceQueues[source];
    while (pointers[source] < queue.length) {
      const postId = queue[pointers[source]];
      pointers[source] += 1;
      if (!seen.has(postId)) {
        seen.add(postId);
        selected.push(postId);
        return true;
      }
    }
    return false;
  }

  let emptyCycles = 0;
  while (selected.length < targetPoolSize && emptyCycles < 3) {
    let progress = false;

    for (const source of MIX_PATTERN) {
      if (selected.length >= targetPoolSize) break;
      if (pullNextFromSource(source)) {
        progress = true;
      }
    }

    if (!progress) {
      emptyCycles += 1;
    }
  }

  const fallback = [
    ...sourceQueues.followed,
    ...sourceQueues.course,
    ...sourceQueues.trending,
  ];

  for (const postId of fallback) {
    if (selected.length >= targetPoolSize) break;
    if (seen.has(postId)) continue;
    seen.add(postId);
    selected.push(postId);
  }

  return selected;
}

function shapeFeedItem(candidate) {
  return {
    id: Number(candidate.id),
    user_id: Number(candidate.user_id),
    content: candidate.content,
    media_url: candidate.media_url,
    privacy: candidate.privacy,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
    author_name: candidate.author_name,
    author_role: candidate.author_role,
    author_profile_pic_url: candidate.author_profile_pic_url,
    like_count: toNumber(candidate.like_count),
    comment_count: toNumber(candidate.comment_count),
    share_count: toNumber(candidate.share_count),
    shared_course_count: toNumber(candidate.shared_course_count),
    source_types: Object.keys(candidate.sources).filter((source) => candidate.sources[source]),
    feed_score: candidate.feed_score,
  };
}

async function queryFollowedRecentPosts({ userId, limit }) {
  const sinceDate = new Date(Date.now() - SOURCE_LOOKBACK_DAYS.followed * 24 * 60 * 60 * 1000);

  return runQuery(
    `SELECT
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
     LIMIT ?`,
    [userId, userId, userId, sinceDate, limit]
  );
}

async function queryEnrolledCoursePosts({ userId, limit }) {
  const sinceDate = new Date(Date.now() - SOURCE_LOOKBACK_DAYS.course * 24 * 60 * 60 * 1000);

  return runQuery(
    `SELECT
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
     LIMIT ?`,
    [userId, userId, userId, sinceDate, userId, userId, limit]
  );
}

async function queryTrendingPublicPosts({ userId, limit }) {
  const sinceDate = new Date(Date.now() - SOURCE_LOOKBACK_DAYS.trending * 24 * 60 * 60 * 1000);

  return runQuery(
    `SELECT
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
     LIMIT ?`,
    [userId, sinceDate, limit]
  );
}

async function getHomeFeed({ userId, limit: rawLimit, cursor: rawCursor }) {
  const limit = clampLimit(rawLimit);
  const cursor = safeCursorDecode(rawCursor);
  const sourceFetchLimit = Math.max(limit * 8, 80);
  const candidatePoolSize = Math.max(limit * 6, 120);

  const [followedRows, courseRows, trendingRows] = await Promise.all([
    queryFollowedRecentPosts({ userId, limit: sourceFetchLimit }),
    queryEnrolledCoursePosts({ userId, limit: sourceFetchLimit }),
    queryTrendingPublicPosts({ userId, limit: sourceFetchLimit }),
  ]);

  const mergedCandidates = new Map();
  mergeSourceRows(followedRows, 'followed', mergedCandidates);
  mergeSourceRows(courseRows, 'course', mergedCandidates);
  mergeSourceRows(trendingRows, 'trending', mergedCandidates);

  const balancedPoolIds = buildBalancedPoolIds({
    followedRows,
    courseRows,
    trendingRows,
    targetPoolSize: candidatePoolSize,
  });

  const selectedSet = new Set(balancedPoolIds);
  const candidates = [];

  balancedPoolIds.forEach((postId) => {
    const candidate = mergedCandidates.get(postId);
    if (candidate) {
      candidate.feed_score = computeFeedScore(candidate);
      candidates.push(candidate);
    }
  });

  if (candidates.length < limit * 2) {
    for (const [postId, candidate] of mergedCandidates.entries()) {
      if (selectedSet.has(postId)) continue;
      candidate.feed_score = computeFeedScore(candidate);
      candidates.push(candidate);
    }
  }

  candidates.sort(compareFeedItemsDesc);

  const postCursorItems = cursor
    ? candidates.filter((item) => isStrictlyBeforeCursor(item, cursor))
    : candidates;

  const paged = postCursorItems.slice(0, limit + 1);
  const hasMore = paged.length > limit;
  const pageItems = hasMore ? paged.slice(0, limit) : paged;
  const nextCursor = hasMore && pageItems.length ? encodeCursor(pageItems[pageItems.length - 1]) : null;

  return {
    feed: pageItems.map(shapeFeedItem),
    pagination: {
      type: 'cursor',
      limit,
      nextCursor,
      hasMore,
    },
    strategy: {
      candidateSources: ['followed_recent', 'enrolled_course', 'public_trending'],
      weightedMixPattern: '2 followed : 1 course : 1 trending',
      scoreWeights: SCORE_WEIGHTS,
      lookbackDays: SOURCE_LOOKBACK_DAYS,
    },
  };
}

module.exports = {
  getHomeFeed,
};
