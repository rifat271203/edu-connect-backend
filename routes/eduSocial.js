const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');

const router = express.Router();

function logSocialError(routeName, req, error) {
  console.error('EDU SOCIAL ERROR:', {
    routeName,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id || null,
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    stack: error?.stack,
  });
}

function handleSocialServerError(routeName, req, res, error, message) {
  logSocialError(routeName, req, error);
  return res.status(500).json({ message });
}

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to initialize edu schema', error: error.message });
  }
});

router.use(eduAuthMiddleware);

router.use((req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: 'Unauthorized user context' });
  }

  return next();
});

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function isUsersFriends(userAId, userBId) {
  const [u1, u2] = orderedPair(Number(userAId), Number(userBId));
  const rows = await runQuery('SELECT id FROM edu_friendships WHERE user1_id = ? AND user2_id = ? LIMIT 1', [u1, u2]);
  return rows.length > 0;
}

function normalizeProfileVisibility(value) {
  return Number(value) === 1;
}

async function getOrCreateDmConversation(userAId, userBId) {
  const [u1, u2] = orderedPair(Number(userAId), Number(userBId));

  const existing = await runQuery(
    `SELECT id, user1_id, user2_id, created_at
     FROM edu_dm_conversations
     WHERE user1_id = ? AND user2_id = ?
     LIMIT 1`,
    [u1, u2]
  );

  if (existing.length) {
    return existing[0];
  }

  await runQuery('INSERT IGNORE INTO edu_dm_conversations (user1_id, user2_id) VALUES (?, ?)', [u1, u2]);

  const rows = await runQuery(
    `SELECT id, user1_id, user2_id, created_at
     FROM edu_dm_conversations
     WHERE user1_id = ? AND user2_id = ?
     LIMIT 1`,
    [u1, u2]
  );

  return rows[0] || null;
}

const SOCIAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'social');
const PROFILE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'profiles');
const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_PROFILE_PIC_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
]);
const ALLOWED_PROFILE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function getExtensionFromMime(mimeType = '') {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
  };

  return map[mimeType] || '';
}

function createMediaFilename(file) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  const ext = originalExt || getExtensionFromMime(file.mimetype) || '.bin';
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
}

const mediaStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.ensureDir(SOCIAL_UPLOAD_DIR);
      cb(null, SOCIAL_UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    cb(null, createMediaFilename(file));
  },
});

const uploadMediaMiddleware = multer({
  storage: mediaStorage,
  limits: { fileSize: MAX_MEDIA_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only image/jpeg, image/png, image/webp, image/gif, video/mp4, video/quicktime, video/webm or video/x-matroska files are allowed'));
    }

    return cb(null, true);
  },
}).single('media');

const profilePicStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.ensureDir(PROFILE_UPLOAD_DIR);
      cb(null, PROFILE_UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    cb(null, createMediaFilename(file));
  },
});

const uploadProfilePicMiddleware = multer({
  storage: profilePicStorage,
  limits: { fileSize: MAX_PROFILE_PIC_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PROFILE_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only image/jpeg, image/png, image/webp or image/gif files are allowed for profile picture'));
    }

    return cb(null, true);
  },
}).single('profilePic');

function buildMediaUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/social/${filename}`;
}

function buildProfilePicUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/profiles/${filename}`;
}

async function createNotification({ recipientId, actorId, type, entityType, entityId, message }) {
  if (!recipientId || !entityId || !type || !entityType || !message) {
    return;
  }

  if (actorId && Number(recipientId) === Number(actorId)) {
    return;
  }

  try {
    await runQuery(
      `INSERT INTO edu_notifications (recipient_id, actor_id, type, entity_type, entity_id, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [recipientId, actorId || null, type, entityType, entityId, message]
    );
  } catch (error) {
    console.error('Failed to create notification:', error.message);
  }
}

router.post('/upload-media', (req, res) => {
  uploadMediaMiddleware(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File is too large. Max allowed size is 50 MB' });
    }

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File field 'media' is required" });
    }

    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    return res.status(201).json({
      message: 'Media uploaded',
      mediaUrl: buildMediaUrl(req, req.file.filename),
      mediaType,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  });
});

router.post('/me/profile-pic', (req, res) => {
  uploadProfilePicMiddleware(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Profile picture is too large. Max allowed size is 10 MB' });
    }

    if (error) {
      return res.status(400).json({ message: error.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File field 'profilePic' is required" });
    }

    try {
      const profilePicUrl = buildProfilePicUrl(req, req.file.filename);
      await runQuery('UPDATE edu_users SET profile_pic_url = ? WHERE id = ?', [profilePicUrl, req.user.id]);

      const users = await runQuery(
        `SELECT id, name, email, role, department, institution, profile_pic_url, created_at
         FROM edu_users
         WHERE id = ?`,
        [req.user.id]
      );

      return res.status(200).json({
        message: 'Profile picture updated',
        profilePicUrl,
        user: users[0],
      });
    } catch (dbError) {
      return res.status(500).json({ message: 'Failed to update profile picture', error: dbError.message });
    }
  });
});

router.get('/me/profile', async (req, res) => {
  try {
    const users = await runQuery(
      `SELECT id, name, email, role, department, institution, profile_pic_url, is_profile_public, created_at
       FROM edu_users
       WHERE id = ?`,
      [req.user.id]
    );

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const [postCountRows, shareCountRows, likeCountRows, commentCountRows, friendCountRows] = await Promise.all([
      runQuery('SELECT COUNT(*) AS count FROM edu_posts WHERE user_id = ?', [req.user.id]),
      runQuery('SELECT COUNT(*) AS count FROM edu_shares WHERE user_id = ?', [req.user.id]),
      runQuery('SELECT COUNT(*) AS count FROM edu_post_likes WHERE user_id = ?', [req.user.id]),
      runQuery('SELECT COUNT(*) AS count FROM edu_comments WHERE user_id = ?', [req.user.id]),
      runQuery('SELECT COUNT(*) AS count FROM edu_friendships WHERE user1_id = ? OR user2_id = ?', [req.user.id, req.user.id]),
    ]);

    return res.json({
      profile: users[0],
      stats: {
        postCount: postCountRows[0].count,
        shareCount: shareCountRows[0].count,
        likeGivenCount: likeCountRows[0].count,
        commentCount: commentCountRows[0].count,
        friendCount: friendCountRows[0].count,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load own profile', error: error.message });
  }
});

router.get('/me/activity', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    const [posts, shares, likes, comments] = await Promise.all([
      runQuery(
        `SELECT id, content, media_url, privacy, created_at, updated_at
         FROM edu_posts
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      ),
      runQuery(
        `SELECT
           s.id,
           s.post_id,
           s.caption,
           s.created_at,
           p.content AS original_post_content,
           p.media_url AS original_post_media_url,
           p.user_id AS original_author_id,
           au.name AS original_author_name,
           au.role AS original_author_role
         FROM edu_shares s
         JOIN edu_posts p ON p.id = s.post_id
         JOIN edu_users au ON au.id = p.user_id
         WHERE s.user_id = ?
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      ),
      runQuery(
        `SELECT
           l.id,
           l.post_id,
           l.created_at,
           p.content AS post_content,
           p.media_url AS post_media_url,
           p.user_id AS post_author_id,
           u.name AS post_author_name,
           u.role AS post_author_role,
           u.profile_pic_url AS post_author_profile_pic_url
         FROM edu_post_likes l
         JOIN edu_posts p ON p.id = l.post_id
         JOIN edu_users u ON u.id = p.user_id
         WHERE l.user_id = ?
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      ),
      runQuery(
        `SELECT
           c.id,
           c.post_id,
           c.comment_text,
           c.parent_comment_id,
           c.created_at,
           p.content AS post_content,
           p.user_id AS post_author_id,
           u.name AS post_author_name,
           u.role AS post_author_role,
           u.profile_pic_url AS post_author_profile_pic_url
         FROM edu_comments c
         JOIN edu_posts p ON p.id = c.post_id
         JOIN edu_users u ON u.id = p.user_id
         WHERE c.user_id = ?
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      ),
    ]);

    return res.json({
      limit,
      offset,
      activity: {
        posts,
        shares,
        likes,
        comments,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load own activity', error: error.message });
  }
});

router.get('/me/profile-visibility', async (req, res) => {
  try {
    const rows = await runQuery(
      'SELECT id, is_profile_public FROM edu_users WHERE id = ? LIMIT 1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      userId: rows[0].id,
      isPublic: normalizeProfileVisibility(rows[0].is_profile_public),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch profile visibility', error: error.message });
  }
});

router.patch('/me/profile-visibility', async (req, res) => {
  const { isPublic } = req.body;

  if (typeof isPublic !== 'boolean') {
    return res.status(400).json({ message: 'isPublic must be a boolean' });
  }

  try {
    const result = await runQuery('UPDATE edu_users SET is_profile_public = ? WHERE id = ?', [isPublic ? 1 : 0, req.user.id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      message: 'Profile visibility updated',
      userId: req.user.id,
      isPublic,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update profile visibility', error: error.message });
  }
});

// --- Posts ---
router.post('/posts', async (req, res) => {
  const { content, mediaUrl, privacy } = req.body;

  if (!content && !mediaUrl) {
    return res.status(400).json({ message: 'Either content or mediaUrl is required' });
  }

  const allowedPrivacy = ['public', 'friends', 'private'];
  if (privacy && !allowedPrivacy.includes(privacy)) {
    return res.status(400).json({ message: 'Invalid privacy value' });
  }

  try {
    const result = await runQuery(
      `INSERT INTO edu_posts (user_id, content, media_url, privacy)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, content || null, mediaUrl || null, privacy || 'public']
    );

    const rows = await runQuery(
      `SELECT p.*, u.name AS author_name, u.role AS author_role, u.profile_pic_url AS author_profile_pic_url
       FROM edu_posts p
       JOIN edu_users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ message: 'Post created', post: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create post', error: error.message });
  }
});

router.get('/posts', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    const posts = await runQuery(
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
         (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id) AS share_count
       FROM edu_posts p
       JOIN edu_users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json({ posts, limit, offset });
  } catch (error) {
    return handleSocialServerError('GET /posts', req, res, error, 'Failed to load posts');
  }
});

router.get('/posts/:postId', async (req, res) => {
  try {
    const postRows = await runQuery(
      `SELECT p.*, u.name AS author_name, u.role AS author_role, u.profile_pic_url AS author_profile_pic_url
       FROM edu_posts p
       JOIN edu_users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [req.params.postId]
    );

    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = postRows[0];
    const comments = await runQuery(
      `SELECT c.*, u.name AS author_name, u.role AS author_role, u.profile_pic_url AS author_profile_pic_url
       FROM edu_comments c
       JOIN edu_users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC`,
      [req.params.postId]
    );

    const likes = await runQuery(
      `SELECT l.user_id, u.name, u.role, u.profile_pic_url AS profile_pic_url, l.created_at
       FROM edu_post_likes l
       JOIN edu_users u ON u.id = l.user_id
       WHERE l.post_id = ?
       ORDER BY l.created_at DESC`,
      [req.params.postId]
    );

    return res.json({
      post,
      likes,
      comments,
      stats: {
        likeCount: likes.length,
        commentCount: comments.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load post details', error: error.message });
  }
});

router.patch('/posts/:postId', async (req, res) => {
  const { content, mediaUrl, privacy } = req.body;

  if (content === undefined && mediaUrl === undefined && privacy === undefined) {
    return res.status(400).json({ message: 'At least one field is required for update' });
  }

  const allowedPrivacy = ['public', 'friends', 'private'];
  if (privacy && !allowedPrivacy.includes(privacy)) {
    return res.status(400).json({ message: 'Invalid privacy value' });
  }

  try {
    const postRows = await runQuery('SELECT * FROM edu_posts WHERE id = ?', [req.params.postId]);
    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = postRows[0];
    if (post.user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own posts' });
    }

    await runQuery(
      `UPDATE edu_posts
       SET content = COALESCE(?, content),
           media_url = COALESCE(?, media_url),
           privacy = COALESCE(?, privacy)
       WHERE id = ?`,
      [content ?? null, mediaUrl ?? null, privacy ?? null, req.params.postId]
    );

    const updated = await runQuery('SELECT * FROM edu_posts WHERE id = ?', [req.params.postId]);
    return res.json({ message: 'Post updated', post: updated[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update post', error: error.message });
  }
});

router.delete('/posts/:postId', async (req, res) => {
  try {
    const postRows = await runQuery('SELECT * FROM edu_posts WHERE id = ?', [req.params.postId]);
    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = postRows[0];
    if (post.user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own posts' });
    }

    await runQuery('DELETE FROM edu_posts WHERE id = ?', [req.params.postId]);
    return res.json({ message: 'Post deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete post', error: error.message });
  }
});

// --- Likes ---
router.post('/posts/:postId/likes', async (req, res) => {
  try {
    const postRows = await runQuery('SELECT id, user_id FROM edu_posts WHERE id = ?', [req.params.postId]);
    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const likeInsert = await runQuery(
      'INSERT IGNORE INTO edu_post_likes (post_id, user_id) VALUES (?, ?)',
      [req.params.postId, req.user.id]
    );

    if (likeInsert.affectedRows > 0) {
      await createNotification({
        recipientId: postRows[0].user_id,
        actorId: req.user.id,
        type: 'like',
        entityType: 'post',
        entityId: Number(req.params.postId),
        message: `${req.user.name || 'Someone'} liked your post`,
      });
    }

    const countRows = await runQuery('SELECT COUNT(*) AS likeCount FROM edu_post_likes WHERE post_id = ?', [
      req.params.postId,
    ]);

    return res.status(201).json({ message: 'Post liked', likeCount: countRows[0].likeCount });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to like post', error: error.message });
  }
});

router.delete('/posts/:postId/likes', async (req, res) => {
  try {
    await runQuery('DELETE FROM edu_post_likes WHERE post_id = ? AND user_id = ?', [
      req.params.postId,
      req.user.id,
    ]);

    const countRows = await runQuery('SELECT COUNT(*) AS likeCount FROM edu_post_likes WHERE post_id = ?', [
      req.params.postId,
    ]);

    return res.json({ message: 'Like removed', likeCount: countRows[0].likeCount });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove like', error: error.message });
  }
});

// --- Comments ---
router.post('/posts/:postId/comments', async (req, res) => {
  const { commentText, parentCommentId } = req.body;

  if (!commentText || !commentText.trim()) {
    return res.status(400).json({ message: 'commentText is required' });
  }

  try {
    const postRows = await runQuery('SELECT id, user_id FROM edu_posts WHERE id = ?', [req.params.postId]);
    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const result = await runQuery(
      `INSERT INTO edu_comments (post_id, user_id, comment_text, parent_comment_id)
       VALUES (?, ?, ?, ?)`,
      [req.params.postId, req.user.id, commentText, parentCommentId || null]
    );

    await createNotification({
      recipientId: postRows[0].user_id,
      actorId: req.user.id,
      type: 'comment',
      entityType: 'post',
      entityId: Number(req.params.postId),
      message: `${req.user.name || 'Someone'} commented on your post`,
    });

    const rows = await runQuery(
      `SELECT c.*, u.name AS author_name, u.role AS author_role, u.profile_pic_url AS author_profile_pic_url
       FROM edu_comments c
       JOIN edu_users u ON u.id = c.user_id
       WHERE c.id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ message: 'Comment added', comment: rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add comment', error: error.message });
  }
});

router.delete('/comments/:commentId', async (req, res) => {
  try {
    const rows = await runQuery('SELECT * FROM edu_comments WHERE id = ?', [req.params.commentId]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own comments' });
    }

    await runQuery('DELETE FROM edu_comments WHERE id = ?', [req.params.commentId]);
    return res.json({ message: 'Comment deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete comment', error: error.message });
  }
});

// --- Shares ---
router.post('/posts/:postId/shares', async (req, res) => {
  const { caption } = req.body;

  try {
    const postRows = await runQuery('SELECT id, user_id FROM edu_posts WHERE id = ?', [req.params.postId]);
    if (!postRows.length) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const result = await runQuery(
      'INSERT INTO edu_shares (post_id, user_id, caption) VALUES (?, ?, ?)',
      [req.params.postId, req.user.id, caption || null]
    );

    await createNotification({
      recipientId: postRows[0].user_id,
      actorId: req.user.id,
      type: 'share',
      entityType: 'post',
      entityId: Number(req.params.postId),
      message: `${req.user.name || 'Someone'} shared your post`,
    });

    return res.status(201).json({ message: 'Post shared', shareId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to share post', error: error.message });
  }
});

router.get('/shares', async (req, res) => {
  try {
    const shares = await runQuery(
      `SELECT
         s.id,
         s.post_id,
         s.user_id,
         s.caption,
         s.created_at,
         u.name AS shared_by_name,
         u.role AS shared_by_role,
         u.profile_pic_url AS shared_by_profile_pic_url,
         p.content AS original_post_content,
         p.media_url AS original_post_media_url,
         p.user_id AS original_author_id,
         au.name AS original_author_name,
         au.role AS original_author_role,
         au.profile_pic_url AS original_author_profile_pic_url
       FROM edu_shares s
       JOIN edu_users u ON u.id = s.user_id
       JOIN edu_posts p ON p.id = s.post_id
       JOIN edu_users au ON au.id = p.user_id
       ORDER BY s.created_at DESC`
    );

    return res.json({ shares });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch shares', error: error.message });
  }
});

// --- Friend Requests & Friendships ---
router.post('/friend-requests', async (req, res) => {
  const { receiverId } = req.body;
  const senderId = req.user.id;

  if (!receiverId) {
    return res.status(400).json({ message: 'receiverId is required' });
  }

  if (Number(receiverId) === Number(senderId)) {
    return res.status(400).json({ message: 'You cannot send request to yourself' });
  }

  try {
    const receiverRows = await runQuery('SELECT id FROM edu_users WHERE id = ?', [receiverId]);
    if (!receiverRows.length) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    const [u1, u2] = orderedPair(senderId, Number(receiverId));
    const existingFriend = await runQuery(
      'SELECT id FROM edu_friendships WHERE user1_id = ? AND user2_id = ?',
      [u1, u2]
    );
    if (existingFriend.length) {
      return res.status(409).json({ message: 'Already friends' });
    }

    const existingRequests = await runQuery(
      `SELECT * FROM edu_friend_requests
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY id DESC
       LIMIT 1`,
      [senderId, receiverId, receiverId, senderId]
    );

    if (existingRequests.length && existingRequests[0].status === 'pending') {
      return res.status(409).json({ message: 'A pending request already exists' });
    }

    const result = await runQuery(
      `INSERT INTO edu_friend_requests (sender_id, receiver_id, status)
       VALUES (?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         status = 'pending',
         responded_at = NULL,
         created_at = CURRENT_TIMESTAMP`,
      [senderId, receiverId]
    );

    const requestRows = await runQuery(
      'SELECT id FROM edu_friend_requests WHERE sender_id = ? AND receiver_id = ? LIMIT 1',
      [senderId, receiverId]
    );
    const requestId = requestRows[0]?.id || result.insertId;

    await createNotification({
      recipientId: Number(receiverId),
      actorId: senderId,
      type: 'friend_request',
      entityType: 'friend_request',
      entityId: Number(requestId),
      message: `${req.user.name || 'Someone'} sent you a friend request`,
    });

    return res.status(201).json({ message: 'Friend request sent', requestId: requestId || null });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send friend request', error: error.message });
  }
});

router.get('/friend-requests', async (req, res) => {
  try {
    const incoming = await runQuery(
      `SELECT fr.*, u.name AS sender_name, u.email AS sender_email, u.role AS sender_role, u.profile_pic_url AS sender_profile_pic_url
       FROM edu_friend_requests fr
       JOIN edu_users u ON u.id = fr.sender_id
       WHERE fr.receiver_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [req.user.id]
    );

    const outgoing = await runQuery(
      `SELECT fr.*, u.name AS receiver_name, u.email AS receiver_email, u.role AS receiver_role, u.profile_pic_url AS receiver_profile_pic_url
       FROM edu_friend_requests fr
       JOIN edu_users u ON u.id = fr.receiver_id
       WHERE fr.sender_id = ?
       ORDER BY fr.created_at DESC`,
      [req.user.id]
    );

    return res.json({ incoming, outgoing });
  } catch (error) {
    return handleSocialServerError('GET /friend-requests', req, res, error, 'Failed to fetch friend requests');
  }
});

router.patch('/friend-requests/:requestId/respond', async (req, res) => {
  const { action } = req.body;

  if (!['accepted', 'rejected'].includes(action)) {
    return res.status(400).json({ message: "action must be 'accepted' or 'rejected'" });
  }

  try {
    const rows = await runQuery('SELECT * FROM edu_friend_requests WHERE id = ?', [req.params.requestId]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    const request = rows[0];
    if (request.receiver_id !== req.user.id) {
      return res.status(403).json({ message: 'Only receiver can respond to this request' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Request already ${request.status}` });
    }

    await runQuery(
      `UPDATE edu_friend_requests
       SET status = ?, responded_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [action, req.params.requestId]
    );

    if (action === 'accepted') {
      const [u1, u2] = orderedPair(request.sender_id, request.receiver_id);
      await runQuery('INSERT IGNORE INTO edu_friendships (user1_id, user2_id) VALUES (?, ?)', [u1, u2]);
    }

    return res.json({ message: `Friend request ${action}` });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to respond to friend request', error: error.message });
  }
});

router.delete('/friend-requests/:requestId', async (req, res) => {
  try {
    const rows = await runQuery('SELECT * FROM edu_friend_requests WHERE id = ?', [req.params.requestId]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    const request = rows[0];
    const isSender = request.sender_id === req.user.id;
    const isReceiver = request.receiver_id === req.user.id;

    if (!isSender && !isReceiver) {
      return res.status(403).json({ message: 'Not allowed to cancel this request' });
    }

    if (request.status === 'pending') {
      await runQuery(
        `UPDATE edu_friend_requests
         SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.params.requestId]
      );
      return res.json({ message: 'Friend request cancelled' });
    }

    return res.status(400).json({ message: 'Only pending requests can be cancelled' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to cancel friend request', error: error.message });
  }
});

router.get('/friends', async (req, res) => {
  try {
    const friends = await runQuery(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.department,
         u.institution,
         u.profile_pic_url,
         f.created_at AS friends_since
       FROM edu_friendships f
       JOIN edu_users u
         ON u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END
       WHERE f.user1_id = ? OR f.user2_id = ?
       ORDER BY f.created_at DESC`,
      [req.user.id, req.user.id, req.user.id]
    );

    return res.json({ friends });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch friends', error: error.message });
  }
});

router.delete('/friends/:friendId', async (req, res) => {
  const friendId = Number(req.params.friendId);
  const userId = Number(req.user.id);

  if (!friendId) {
    return res.status(400).json({ message: 'Valid friendId is required' });
  }

  const [u1, u2] = orderedPair(userId, friendId);

  try {
    const result = await runQuery('DELETE FROM edu_friendships WHERE user1_id = ? AND user2_id = ?', [u1, u2]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Friendship not found' });
    }

    return res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove friend', error: error.message });
  }
});

// --- Direct Messages (DM) ---
router.get('/dm/conversations', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    const conversations = await runQuery(
      `SELECT
         c.id AS conversation_id,
         CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END AS other_user_id,
         u.name AS other_user_name,
         u.email AS other_user_email,
         u.role AS other_user_role,
         u.department AS other_user_department,
         u.institution AS other_user_institution,
         u.profile_pic_url AS other_user_profile_pic_url,
         m.id AS last_message_id,
         m.sender_id AS last_message_sender_id,
         m.receiver_id AS last_message_receiver_id,
         m.message_text AS last_message_text,
         m.is_read AS last_message_is_read,
         m.created_at AS last_message_at,
         (
           SELECT COUNT(*)
           FROM edu_dm_messages um
           WHERE um.conversation_id = c.id
             AND um.receiver_id = ?
             AND um.is_read = 0
         ) AS unread_count
       FROM edu_dm_conversations c
       JOIN edu_users u
         ON u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END
       LEFT JOIN edu_dm_messages m
         ON m.id = (
           SELECT lm.id
           FROM edu_dm_messages lm
           WHERE lm.conversation_id = c.id
           ORDER BY lm.created_at DESC, lm.id DESC
           LIMIT 1
         )
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY COALESCE(m.created_at, c.created_at) DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, limit, offset]
    );

    return res.json({ conversations, limit, offset });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch DM conversations', error: error.message });
  }
});

router.get('/dm/messages/:userId', async (req, res) => {
  const otherUserId = Number(req.params.userId);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const beforeId = Number(req.query.beforeId) || null;

  if (!otherUserId) {
    return res.status(400).json({ message: 'Valid userId is required' });
  }

  if (otherUserId === Number(req.user.id)) {
    return res.status(400).json({ message: 'Cannot open DM thread with yourself' });
  }

  try {
    const otherUsers = await runQuery('SELECT id FROM edu_users WHERE id = ? LIMIT 1', [otherUserId]);
    if (!otherUsers.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isFriend = await isUsersFriends(req.user.id, otherUserId);
    if (!isFriend) {
      return res.status(403).json({ message: 'You can only message users in your friend list' });
    }

    const conversation = await getOrCreateDmConversation(req.user.id, otherUserId);
    if (!conversation) {
      return res.json({ conversationId: null, messages: [] });
    }

    const params = [conversation.id];
    let beforeClause = '';
    if (beforeId) {
      beforeClause = 'AND m.id < ?';
      params.push(beforeId);
    }
    params.push(limit);

    const messages = await runQuery(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_id,
         m.receiver_id,
         m.message_text,
         m.is_read,
         m.created_at,
         su.name AS sender_name,
         su.profile_pic_url AS sender_profile_pic_url,
         ru.name AS receiver_name,
         ru.profile_pic_url AS receiver_profile_pic_url
       FROM edu_dm_messages m
       JOIN edu_users su ON su.id = m.sender_id
       JOIN edu_users ru ON ru.id = m.receiver_id
       WHERE m.conversation_id = ?
         ${beforeClause}
       ORDER BY m.id DESC
       LIMIT ?`,
      params
    );

    messages.reverse();

    return res.json({
      conversationId: conversation.id,
      withUserId: otherUserId,
      messages,
      limit,
      beforeId,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch DM messages', error: error.message });
  }
});

router.post('/dm/messages', async (req, res) => {
  const receiverId = Number(req.body.receiverId);
  const senderId = Number(req.user.id);
  const messageText = (req.body.messageText || '').toString().trim();

  if (!receiverId) {
    return res.status(400).json({ message: 'receiverId is required' });
  }

  if (receiverId === senderId) {
    return res.status(400).json({ message: 'You cannot message yourself' });
  }

  if (!messageText) {
    return res.status(400).json({ message: 'messageText is required' });
  }

  try {
    const receiverRows = await runQuery('SELECT id FROM edu_users WHERE id = ? LIMIT 1', [receiverId]);
    if (!receiverRows.length) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    const isFriend = await isUsersFriends(senderId, receiverId);
    if (!isFriend) {
      return res.status(403).json({ message: 'You can only message users in your friend list' });
    }

    const conversation = await getOrCreateDmConversation(senderId, receiverId);
    if (!conversation) {
      return res.status(500).json({ message: 'Could not initialize DM conversation' });
    }

    const insertResult = await runQuery(
      `INSERT INTO edu_dm_messages (conversation_id, sender_id, receiver_id, message_text)
       VALUES (?, ?, ?, ?)`,
      [conversation.id, senderId, receiverId, messageText]
    );

    const messageRows = await runQuery(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_id,
         m.receiver_id,
         m.message_text,
         m.is_read,
         m.created_at,
         su.name AS sender_name,
         su.profile_pic_url AS sender_profile_pic_url,
         ru.name AS receiver_name,
         ru.profile_pic_url AS receiver_profile_pic_url
       FROM edu_dm_messages m
       JOIN edu_users su ON su.id = m.sender_id
       JOIN edu_users ru ON ru.id = m.receiver_id
       WHERE m.id = ?
       LIMIT 1`,
      [insertResult.insertId]
    );

    const dmMessage = messageRows[0];
    const io = req.app.get('io');
    if (io && dmMessage) {
      io.to(`dm-user-${senderId}`).emit('dm-message', { message: dmMessage });
      io.to(`dm-user-${receiverId}`).emit('dm-message', { message: dmMessage });
    }

    return res.status(201).json({
      message: 'DM sent successfully',
      conversationId: conversation.id,
      dmMessage,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send DM message', error: error.message });
  }
});

router.patch('/dm/messages/:messageId/read', async (req, res) => {
  const messageId = Number(req.params.messageId);
  const readerId = Number(req.user.id);

  if (!messageId) {
    return res.status(400).json({ message: 'Valid messageId is required' });
  }

  try {
    const rows = await runQuery(
      `SELECT id, conversation_id, sender_id, receiver_id, is_read
       FROM edu_dm_messages
       WHERE id = ?
       LIMIT 1`,
      [messageId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'DM message not found' });
    }

    const dm = rows[0];
    if (Number(dm.receiver_id) !== readerId) {
      return res.status(403).json({ message: 'Only receiver can mark this message as read' });
    }

    if (!dm.is_read) {
      await runQuery('UPDATE edu_dm_messages SET is_read = 1 WHERE id = ?', [messageId]);
    }

    const io = req.app.get('io');
    if (io) {
      const payload = {
        messageId,
        conversationId: dm.conversation_id,
        readerId,
        readAt: new Date().toISOString(),
      };
      io.to(`dm-user-${dm.sender_id}`).emit('dm-message-read', payload);
      io.to(`dm-user-${dm.receiver_id}`).emit('dm-message-read', payload);
    }

    return res.json({ message: 'DM message marked as read', messageId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark DM message as read', error: error.message });
  }
});

// --- Notifications ---
router.get('/notifications', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    const notifications = await runQuery(
      `SELECT
         n.id,
         n.recipient_id,
         n.actor_id,
         n.type,
         n.entity_type,
         n.entity_id,
         n.message,
         n.is_read,
         n.created_at,
         u.name AS actor_name,
         u.role AS actor_role,
         u.profile_pic_url AS actor_profile_pic_url
       FROM edu_notifications n
       LEFT JOIN edu_users u ON u.id = n.actor_id
       WHERE n.recipient_id = ?
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    return res.json({ notifications, limit, offset });
  } catch (error) {
    return handleSocialServerError('GET /notifications', req, res, error, 'Failed to fetch notifications');
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const rows = await runQuery(
      'SELECT COUNT(*) AS unreadCount FROM edu_notifications WHERE recipient_id = ? AND is_read = 0',
      [req.user.id]
    );

    return res.json({ unreadCount: Number(rows?.[0]?.unreadCount || 0) });
  } catch (error) {
    return handleSocialServerError('GET /notifications/unread-count', req, res, error, 'Failed to fetch unread count');
  }
});

router.patch('/notifications/:notificationId/read', async (req, res) => {
  const { isRead } = req.body;

  if (isRead !== true) {
    return res.status(400).json({ message: 'isRead must be true' });
  }

  try {
    const result = await runQuery(
      'UPDATE edu_notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?',
      [req.params.notificationId, req.user.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    return res.json({ message: 'Notification marked as read' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark notification as read', error: error.message });
  }
});

router.patch('/notifications/read-all', async (req, res) => {
  const { isRead } = req.body;

  if (isRead !== true) {
    return res.status(400).json({ message: 'isRead must be true' });
  }

  try {
    const result = await runQuery(
      'UPDATE edu_notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0',
      [req.user.id]
    );

    return res.json({ message: 'All notifications marked as read', updatedCount: result.affectedRows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark all notifications as read', error: error.message });
  }
});

router.get('/users/:userId/profile', async (req, res) => {
  const targetUserId = Number(req.params.userId);
  const postLimit = Math.min(Number(req.query.postLimit) || 10, 50);
  const postOffset = Number(req.query.postOffset) || 0;

  if (!targetUserId) {
    return res.status(400).json({ message: 'Valid userId is required' });
  }

  try {
    const users = await runQuery(
      `SELECT id, name, role, department, institution, profile_pic_url, is_profile_public, created_at
       FROM edu_users
       WHERE id = ?`,
      [targetUserId]
    );

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = users[0];
    const isSelf = Number(req.user.id) === targetUserId;
    const isFriend = isSelf ? false : await isUsersFriends(req.user.id, targetUserId);
    const isTargetPublic = normalizeProfileVisibility(targetUser.is_profile_public);

    if (!isTargetPublic && !isSelf && !isFriend) {
      return res.status(403).json({ message: 'This profile is private' });
    }

    const [postCountRows, shareCountRows, friendCountRows] = await Promise.all([
      runQuery('SELECT COUNT(*) AS count FROM edu_posts WHERE user_id = ?', [targetUserId]),
      runQuery('SELECT COUNT(*) AS count FROM edu_shares WHERE user_id = ?', [targetUserId]),
      runQuery('SELECT COUNT(*) AS count FROM edu_friendships WHERE user1_id = ? OR user2_id = ?', [targetUserId, targetUserId]),
    ]);

    const posts = await runQuery(
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
         (SELECT COUNT(*) FROM edu_shares s WHERE s.post_id = p.id) AS share_count
       FROM edu_posts p
       JOIN edu_users u ON u.id = p.user_id
       WHERE p.user_id = ?
         AND (
           p.privacy = 'public'
           OR p.user_id = ?
           OR (
             p.privacy = 'friends'
             AND EXISTS (
               SELECT 1
               FROM edu_friendships f
               WHERE (f.user1_id = ? AND f.user2_id = ?)
                  OR (f.user1_id = ? AND f.user2_id = ?)
             )
           )
         )
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [targetUserId, req.user.id, req.user.id, targetUserId, targetUserId, req.user.id, postLimit, postOffset]
    );

    return res.json({
      profile: {
        ...targetUser,
        is_profile_public: isTargetPublic ? 1 : 0,
      },
      stats: {
        postCount: postCountRows[0].count,
        shareCount: shareCountRows[0].count,
        friendCount: friendCountRows[0].count,
      },
      recentPosts: posts,
      pagination: {
        postLimit,
        postOffset,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load user profile', error: error.message });
  }
});

// --- Search ---
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const role = (req.query.role || '').toString().trim();
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  if (!q) {
    return res.status(400).json({ message: 'q query parameter is required' });
  }

  if (role && !['teacher', 'student'].includes(role)) {
    return res.status(400).json({ message: "role must be 'teacher' or 'student'" });
  }

  try {
    const wildcard = `%${q}%`;

    const users = await runQuery(
      `SELECT id, name, email, role, department, institution, profile_pic_url, created_at
       FROM edu_users
       WHERE (name LIKE ? OR email LIKE ? OR department LIKE ? OR institution LIKE ?)
         AND (? = '' OR role = ?)
       ORDER BY role ASC, name ASC
       LIMIT ?`,
      [wildcard, wildcard, wildcard, wildcard, role, role, limit]
    );

    const posts = await runQuery(
      `SELECT
         p.id,
         p.user_id,
         p.content,
         p.media_url,
         p.privacy,
         p.created_at,
         u.name AS author_name,
         u.role AS author_role,
         u.profile_pic_url AS author_profile_pic_url
       FROM edu_posts p
       JOIN edu_users u ON u.id = p.user_id
       WHERE p.content LIKE ?
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [wildcard, limit]
    );

    return res.json({ query: q, role: role || null, users, posts });
  } catch (error) {
    return res.status(500).json({ message: 'Search failed', error: error.message });
  }
});

module.exports = router;
