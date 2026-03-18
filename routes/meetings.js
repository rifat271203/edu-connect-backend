const crypto = require('crypto');
const express = require('express');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');
const { createRateLimiter, hashIpForLogs } = require('../utils/security');

const router = express.Router();

const createMeetingRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many meeting create attempts',
});

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to initialize meeting schema' });
  }
});

function createRoomId() {
  return `room_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

router.post('/create', createMeetingRateLimiter, eduAuthMiddleware, async (req, res) => {
  const { title } = req.body || {};
  const ipHash = hashIpForLogs(req.ip);

  if (title !== undefined && (typeof title !== 'string' || title.length > 255)) {
    return res.status(400).json({ message: 'title must be a string up to 255 characters' });
  }

  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Only teacher accounts can create a meeting' });
  }

  try {
    let roomId = createRoomId();
    let insertResult = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        insertResult = await runQuery(
          `INSERT INTO meetings (room_id, title, host_user_id, is_active)
           VALUES (?, ?, ?, 1)`,
          [roomId, title || null, req.user.id]
        );
        break;
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          roomId = createRoomId();
          continue;
        }
        throw error;
      }
    }

    if (!insertResult) {
      return res.status(500).json({ message: 'Could not create unique meeting room ID' });
    }

    return res.status(201).json({
      roomId,
      meetingId: insertResult.insertId,
    });
  } catch (error) {
    console.error('MEETING CREATE FAILED', {
      userId: req.user?.id || null,
      ipHash,
      message: error.message,
      code: error.code,
    });
    return res.status(500).json({ message: 'Failed to create meeting' });
  }
});

router.get('/:roomId', async (req, res) => {
  try {
    const rows = await runQuery(
      `SELECT
         m.id,
         m.room_id,
         m.title,
         m.host_user_id,
         m.is_active,
         m.created_at,
         u.name AS host_name,
         u.role AS host_role
       FROM meetings m
       JOIN edu_users u ON u.id = m.host_user_id
       WHERE m.room_id = ?
       LIMIT 1`,
      [req.params.roomId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Meeting room not found' });
    }

    const meeting = rows[0];
    return res.json({
      meetingId: meeting.id,
      roomId: meeting.room_id,
      title: meeting.title,
      hostUserId: meeting.host_user_id,
      hostName: meeting.host_name,
      hostRole: meeting.host_role,
      isActive: Boolean(meeting.is_active),
      createdAt: meeting.created_at,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch meeting info' });
  }
});

router.post('/:roomId/end', eduAuthMiddleware, async (req, res) => {
  try {
    const rows = await runQuery('SELECT id, host_user_id, is_active FROM meetings WHERE room_id = ? LIMIT 1', [
      req.params.roomId,
    ]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Meeting room not found' });
    }

    const meeting = rows[0];
    if (Number(meeting.host_user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only the meeting host can end this session' });
    }

    if (!meeting.is_active) {
      return res.json({ message: 'Meeting already ended', roomId: req.params.roomId, isActive: false });
    }

    await runQuery('UPDATE meetings SET is_active = 0 WHERE room_id = ?', [req.params.roomId]);
    await runQuery('UPDATE meeting_participants SET left_at = CURRENT_TIMESTAMP WHERE room_id = ? AND left_at IS NULL', [
      req.params.roomId,
    ]);

    return res.json({ message: 'Meeting ended successfully', roomId: req.params.roomId, isActive: false });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to end meeting' });
  }
});

module.exports = router;
