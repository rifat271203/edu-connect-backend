const express = require('express');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { runQuery, ensureEduSchema } = require('../utils/eduSchema');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    next();
  } catch (error) {
    res.status(500).json({ message: 'Failed to initialize edu schema', error: error.message });
  }
});

// Teacher: Create a tuition post
router.post('/posts', eduAuthMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Only teachers can create tuition posts' });
  }

  const { subject, location, tuition_fee, details } = req.body;

  if (!subject || !location || !tuition_fee) {
    return res.status(400).json({ message: 'subject, location, and tuition_fee are required' });
  }

  try {
    const result = await runQuery(
      'INSERT INTO edu_tuition_posts (teacher_id, subject, location, tuition_fee, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, subject, location, tuition_fee, details]
    );

    res.status(201).json({
      message: 'Tuition post created successfully',
      postId: result.insertId
    });
  } catch (error) {
    console.error('Create tuition post error:', error);
    res.status(500).json({ message: 'Failed to create tuition post' });
  }
});

// Student/Teacher: Get all tuition posts
router.get('/posts', eduAuthMiddleware, async (req, res) => {
  try {
    const posts = await runQuery(`
      SELECT p.id, p.teacher_id, p.subject, p.location, p.tuition_fee, p.details, p.created_at,
             u.name as teacher_name, u.institution as teacher_institution, u.profile_pic_url
      FROM edu_tuition_posts p
      JOIN edu_users u ON p.teacher_id = u.id
      ORDER BY p.created_at DESC
    `);

    res.status(200).json(posts);
  } catch (error) {
    console.error('Error fetching tuition posts:', error);
    res.status(500).json({ message: 'Failed to fetch tuition posts' });
  }
});

// Student/Teacher: Get top 5 most popular teachers based on tuition requests
router.get('/teachers/popular', eduAuthMiddleware, async (req, res) => {
  try {
    const teachers = await runQuery(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.department,
        u.institution,
        u.profile_pic_url,
        COUNT(DISTINCT p.id) AS total_posts,
        COUNT(r.id) AS total_requests,
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_requests,
        MAX(p.created_at) AS latest_post_at
      FROM edu_users u
      LEFT JOIN edu_tuition_posts p ON p.teacher_id = u.id
      LEFT JOIN edu_tuition_requests r ON r.post_id = p.id
      WHERE u.role = 'teacher'
      GROUP BY u.id, u.name, u.email, u.department, u.institution, u.profile_pic_url
      HAVING COUNT(DISTINCT p.id) > 0
      ORDER BY total_requests DESC, approved_requests DESC, total_posts DESC, latest_post_at DESC
      LIMIT 5
    `);

    res.status(200).json({
      message: 'Top 5 popular teachers fetched successfully',
      total: teachers.length,
      teachers
    });
  } catch (error) {
    console.error('Error fetching popular teachers:', error);
    res.status(500).json({ message: 'Failed to fetch popular teachers' });
  }
});

// Student: Connect with a tuition post
router.post('/posts/:id/connect', eduAuthMiddleware, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ message: 'Only students can request to connect' });
  }

  const postId = req.params.id;

  try {
    // Check if post exists
    const posts = await runQuery('SELECT * FROM edu_tuition_posts WHERE id = ?', [postId]);
    if (!posts.length) {
      return res.status(404).json({ message: 'Tuition post not found' });
    }

    // Check if already requested
    const existing = await runQuery(
      'SELECT * FROM edu_tuition_requests WHERE post_id = ? AND student_id = ?',
      [postId, req.user.id]
    );
    if (existing.length) {
      return res.status(400).json({ message: 'You have already sent a connect request for this post' });
    }

    await runQuery(
      'INSERT INTO edu_tuition_requests (post_id, student_id, status) VALUES (?, ?, "pending")',
      [postId, req.user.id]
    );

    res.status(201).json({ message: 'Connect request sent successfully' });
  } catch (error) {
    console.error('Connect request error:', error);
    res.status(500).json({ message: 'Failed to send connect request' });
  }
});

// Teacher: Get received connect requests
router.get('/requests/received', eduAuthMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Only teachers can view received requests' });
  }

  try {
    const requests = await runQuery(`
      SELECT r.*, u.name as student_name, u.email as student_email, u.institution as student_institution, p.subject
      FROM edu_tuition_requests r
      JOIN edu_tuition_posts p ON r.post_id = p.id
      JOIN edu_users u ON r.student_id = u.id
      WHERE p.teacher_id = ?
      ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(requests);
  } catch (error) {
    console.error('Get received requests error:', error);
    res.status(500).json({ message: 'Failed to fetch received requests' });
  }
});

// Student: Get my sent connect requests
router.get('/requests/sent', eduAuthMiddleware, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ message: 'Only students can view sent requests' });
  }

  try {
    const requests = await runQuery(`
      SELECT r.*, p.subject, p.location, p.tuition_fee, u.name as teacher_name
      FROM edu_tuition_requests r
      JOIN edu_tuition_posts p ON r.post_id = p.id
      JOIN edu_users u ON p.teacher_id = u.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(requests);
  } catch (error) {
    console.error('Get sent requests error:', error);
    res.status(500).json({ message: 'Failed to fetch sent requests' });
  }
});

// Teacher: Approve or Reject a request
router.patch('/requests/:id', eduAuthMiddleware, async (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Only teachers can approve or reject requests' });
  }

  const requestId = req.params.id;
  const { status } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status. Must be approved or rejected.' });
  }

  try {
    // Check if request exists and belongs to this teacher's post
    const requests = await runQuery(`
      SELECT r.*, p.teacher_id, r.student_id
      FROM edu_tuition_requests r
      JOIN edu_tuition_posts p ON r.post_id = p.id
      WHERE r.id = ?
    `, [requestId]);

    if (!requests.length) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (requests[0].teacher_id !== req.user.id) {
      return res.status(403).json({ message: 'You are not authorized to handle this request' });
    }

    await runQuery('UPDATE edu_tuition_requests SET status = ? WHERE id = ?', [status, requestId]);

    // If approved, we could automatically create a conversation or just let them start messaging
    // The existing messaging system uses edu_dm_conversations
    if (status === 'approved') {
      const studentId = requests[0].student_id;
      const teacherId = req.user.id;

      // Ensure conversation exists
      const user1_id = Math.min(teacherId, studentId);
      const user2_id = Math.max(teacherId, studentId);

      const convs = await runQuery(
        'SELECT id FROM edu_dm_conversations WHERE user1_id = ? AND user2_id = ?',
        [user1_id, user2_id]
      );

      if (!convs.length) {
        await runQuery(
          'INSERT INTO edu_dm_conversations (user1_id, user2_id) VALUES (?, ?)',
          [user1_id, user2_id]
        );
      }
    }

    res.json({ message: `Request ${status} successfully` });
  } catch (error) {
    console.error('Handle request error:', error);
    res.status(500).json({ message: 'Failed to handle request' });
  }
});

module.exports = router;
