const express = require('express');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');
const { ensureEduSchema } = require('../utils/eduSchema');
const { ensureClassroomSchema } = require('../src/modules/eduConnectClassroom/schema/classroom.schema');
const { getHomeFeed } = require('../services/homeFeed.service');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureEduSchema();
    await ensureClassroomSchema();
    return next();
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to initialize feed schema',
      error: error.message,
    });
  }
});

router.use(eduAuthMiddleware);

router.get('/home', async (req, res) => {
  try {
    const result = await getHomeFeed({
      userId: Number(req.user.id),
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    return res.json(result);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to fetch home feed',
      error: error.message,
    });
  }
});

module.exports = router;
