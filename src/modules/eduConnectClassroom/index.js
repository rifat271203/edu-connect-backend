const express = require('express');
const classroomRoutes = require('./routes/classroom.routes');
const roomRouters = require('./rooms');
const { ensureClassroomSchema } = require('./schema/classroom.schema');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureClassroomSchema();
    return next();
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to initialize classroom module schema',
    });
  }
});

router.use(classroomRoutes);
router.use(roomRouters);

module.exports = router;

