const { runQuery } = require('../../../../utils/eduSchema');

function buildPaginatedMeta(page, limit, total) {
  const safeTotal = Number(total) || 0;
  const totalPages = Math.max(Math.ceil(safeTotal / limit), 1);
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
  };
}

async function createCourse({ teacherId, title, code, description, coursePicUrl, department }) {
  const insertCourse = await runQuery(
    `INSERT INTO courses (teacher_id, title, code, description, course_pic_url, department, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [
      teacherId,
      title.trim(),
      code.trim().toUpperCase(),
      description || null,
      coursePicUrl || null,
      department || null,
    ]
  );

  const courseId = insertCourse.insertId;

  const insertClassroom = await runQuery(
    `INSERT INTO classrooms (course_id, visibility)
     VALUES (?, 'private')`,
    [courseId]
  );

  await runQuery(
    `INSERT INTO classroom_members (classroom_id, user_id, membership_role, source_enrollment_id, is_active)
     VALUES (?, ?, 'teacher', NULL, 1)`,
    [insertClassroom.insertId, teacherId]
  );

  const rows = await runQuery(
    `SELECT c.id, c.teacher_id, c.title, c.code, c.description, c.course_pic_url, c.department, c.status, c.created_at,
            cl.id AS classroom_id, cl.visibility
     FROM courses c
     JOIN classrooms cl ON cl.course_id = c.id
     WHERE c.id = ?
     LIMIT 1`,
    [courseId]
  );

  return rows[0];
}

async function listCourses({ page, limit, q, status, sortBy, sortOrder }) {
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'title', 'code'].includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = [];
  const params = [];

  if (status && ['active', 'archived'].includes(status)) {
    whereParts.push('c.status = ?');
    params.push(status);
  }

  if (q && String(q).trim()) {
    whereParts.push('(c.title LIKE ? OR c.code LIKE ? OR c.description LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const rows = await runQuery(
    `SELECT c.id, c.teacher_id, c.title, c.code, c.description, c.course_pic_url, c.department, c.status, c.created_at,
            u.name AS teacher_name
     FROM courses c
     JOIN edu_users u ON u.id = c.teacher_id
     ${whereSql}
     ORDER BY c.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM courses c
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function getCourseById(courseId) {
  const rows = await runQuery(
    `SELECT c.id, c.teacher_id, c.title, c.code, c.description, c.course_pic_url, c.department, c.status, c.created_at, c.updated_at,
            u.name AS teacher_name
     FROM courses c
     JOIN edu_users u ON u.id = c.teacher_id
     WHERE c.id = ?
     LIMIT 1`,
    [courseId]
  );

  return rows[0] || null;
}

async function updateCourse(courseId, payload) {
  const updatable = ['title', 'code', 'description', 'department', 'status', 'course_pic_url'];
  const fields = [];
  const values = [];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      fields.push(`${field} = ?`);
      if (field === 'code') {
        values.push(String(payload[field]).trim().toUpperCase());
      } else {
        values.push(payload[field]);
      }
    }
  });

  if (!fields.length) {
    return getCourseById(courseId);
  }

  values.push(courseId);

  await runQuery(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, values);
  return getCourseById(courseId);
}

async function updateCourseStatus(courseId, status) {
  await runQuery('UPDATE courses SET status = ? WHERE id = ?', [status, courseId]);
  return getCourseById(courseId);
}

async function submitEnrollmentRequest({ courseId, studentId, note }) {
  const existingPending = await runQuery(
    `SELECT id FROM course_enrollment_requests
     WHERE course_id = ? AND student_id = ? AND status = 'pending'
     LIMIT 1`,
    [courseId, studentId]
  );

  if (existingPending.length) {
    const err = new Error('An enrollment request is already pending for this course');
    err.status = 409;
    throw err;
  }

  const insertResult = await runQuery(
    `INSERT INTO course_enrollment_requests (course_id, student_id, status, note)
     VALUES (?, ?, 'pending', ?)`,
    [courseId, studentId, note || null]
  );

  const rows = await runQuery(
    `SELECT id, course_id, student_id, status, note, requested_at
     FROM course_enrollment_requests
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listEnrollmentRequests({ courseId, status, page, limit, q }) {
  const offset = (page - 1) * limit;
  const whereParts = ['cer.course_id = ?'];
  const params = [courseId];

  if (status && ['pending', 'approved', 'rejected', 'removed'].includes(status)) {
    whereParts.push('cer.status = ?');
    params.push(status);
  }

  if (q && String(q).trim()) {
    whereParts.push('(u.name LIKE ? OR u.email LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT
      cer.id,
      cer.course_id,
      cer.student_id,
      cer.status,
      cer.note,
      cer.requested_at,
      cer.reviewed_by,
      cer.reviewed_at,
      cer.review_note,
      u.name AS student_name,
      u.email AS student_email,
      rv.name AS reviewed_by_name
     FROM course_enrollment_requests cer
     JOIN edu_users u ON u.id = cer.student_id
     LEFT JOIN edu_users rv ON rv.id = cer.reviewed_by
     ${whereSql}
     ORDER BY cer.requested_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM course_enrollment_requests cer
     JOIN edu_users u ON u.id = cer.student_id
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function ensureRequestBelongsToCourse({ requestId, courseId }) {
  const rows = await runQuery(
    `SELECT id, course_id, student_id, status
     FROM course_enrollment_requests
     WHERE id = ? AND course_id = ?
     LIMIT 1`,
    [requestId, courseId]
  );

  if (!rows.length) {
    const err = new Error('Enrollment request not found for this course');
    err.status = 404;
    throw err;
  }

  return rows[0];
}

async function reviewEnrollmentRequest({ courseId, requestId, reviewerId, action, reviewNote }) {
  const request = await ensureRequestBelongsToCourse({ requestId, courseId });
  const targetStatus = action === 'approve' ? 'approved' : 'rejected';

  if (request.status !== 'pending') {
    const err = new Error(`Only pending requests can be ${action}d`);
    err.status = 409;
    throw err;
  }

  await runQuery(
    `UPDATE course_enrollment_requests
     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
     WHERE id = ?`,
    [targetStatus, reviewerId, reviewNote || null, requestId]
  );

  let classroomMember = null;
  if (targetStatus === 'approved') {
    const classroomRows = await runQuery('SELECT id FROM classrooms WHERE course_id = ? LIMIT 1', [courseId]);
    const classroomId = classroomRows[0]?.id;

    const activeMember = await runQuery(
      `SELECT id
       FROM classroom_members
       WHERE classroom_id = ? AND user_id = ? AND is_active = 1
       LIMIT 1`,
      [classroomId, request.student_id]
    );

    if (!activeMember.length) {
      const insertResult = await runQuery(
        `INSERT INTO classroom_members
          (classroom_id, user_id, membership_role, source_enrollment_id, is_active)
         VALUES (?, ?, 'student', ?, 1)`,
        [classroomId, request.student_id, requestId]
      );

      const memberRows = await runQuery(
        `SELECT id, classroom_id, user_id, membership_role, joined_at
         FROM classroom_members
         WHERE id = ?
         LIMIT 1`,
        [insertResult.insertId]
      );

      classroomMember = memberRows[0] || null;
    }
  }

  const rows = await runQuery(
    `SELECT id, course_id, student_id, status, reviewed_by, reviewed_at, review_note
     FROM course_enrollment_requests
     WHERE id = ?
     LIMIT 1`,
    [requestId]
  );

  return {
    enrollment: rows[0],
    classroomMember,
  };
}

async function listClassroomMembers({ courseId, page, limit, q }) {
  const classroomRows = await runQuery('SELECT id FROM classrooms WHERE course_id = ? LIMIT 1', [courseId]);
  if (!classroomRows.length) {
    return { data: [], meta: buildPaginatedMeta(page, limit, 0) };
  }

  const classroomId = classroomRows[0].id;
  const offset = (page - 1) * limit;

  const whereParts = ['cm.classroom_id = ?', 'cm.is_active = 1', 'cm.removed_at IS NULL'];
  const params = [classroomId];

  if (q && String(q).trim()) {
    whereParts.push('(u.name LIKE ? OR u.email LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT cm.id, cm.classroom_id, cm.user_id, cm.membership_role, cm.joined_at,
            u.name, u.email, u.role AS account_role
     FROM classroom_members cm
     JOIN edu_users u ON u.id = cm.user_id
     ${whereSql}
     ORDER BY cm.joined_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM classroom_members cm
     JOIN edu_users u ON u.id = cm.user_id
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function addAssistant({ courseId, userId, addedBy }) {
  const userRows = await runQuery('SELECT id, role, name, email FROM edu_users WHERE id = ? LIMIT 1', [userId]);
  if (!userRows.length) {
    const err = new Error('Assistant user not found');
    err.status = 404;
    throw err;
  }

  if (userRows[0].role !== 'assistant') {
    const err = new Error('User role must be assistant');
    err.status = 409;
    throw err;
  }

  await runQuery(
    `INSERT INTO course_staff (course_id, user_id, role, added_by)
     VALUES (?, ?, 'assistant', ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [courseId, userId, addedBy]
  );

  const classroomRows = await runQuery('SELECT id FROM classrooms WHERE course_id = ? LIMIT 1', [courseId]);
  const classroomId = classroomRows[0].id;

  const activeMemberRows = await runQuery(
    `SELECT id
     FROM classroom_members
     WHERE classroom_id = ? AND user_id = ? AND is_active = 1
     LIMIT 1`,
    [classroomId, userId]
  );

  if (!activeMemberRows.length) {
    await runQuery(
      `INSERT INTO classroom_members (classroom_id, user_id, membership_role, source_enrollment_id, is_active)
       VALUES (?, ?, 'assistant', NULL, 1)`,
      [classroomId, userId]
    );
  }

  const rows = await runQuery(
    `SELECT cs.id, cs.course_id, cs.user_id, cs.role, cs.created_at,
            u.name, u.email
     FROM course_staff cs
     JOIN edu_users u ON u.id = cs.user_id
     WHERE cs.course_id = ? AND cs.user_id = ?
     LIMIT 1`,
    [courseId, userId]
  );

  return rows[0];
}

async function removeMember({ courseId, memberId, removedBy }) {
  const classroomRows = await runQuery('SELECT id FROM classrooms WHERE course_id = ? LIMIT 1', [courseId]);
  if (!classroomRows.length) {
    const err = new Error('Classroom not found');
    err.status = 404;
    throw err;
  }

  const classroomId = classroomRows[0].id;

  const memberRows = await runQuery(
    `SELECT id, user_id, membership_role, source_enrollment_id
     FROM classroom_members
     WHERE id = ? AND classroom_id = ? AND is_active = 1 AND removed_at IS NULL
     LIMIT 1`,
    [memberId, classroomId]
  );

  if (!memberRows.length) {
    const err = new Error('Classroom member not found');
    err.status = 404;
    throw err;
  }

  const member = memberRows[0];
  if (member.membership_role === 'teacher') {
    const err = new Error('Teacher cannot be removed from own classroom');
    err.status = 409;
    throw err;
  }

  await runQuery(
    `UPDATE classroom_members
     SET is_active = 0, removed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [memberId]
  );

  if (member.membership_role === 'assistant') {
    await runQuery('DELETE FROM course_staff WHERE course_id = ? AND user_id = ?', [courseId, member.user_id]);
  }

  if (member.source_enrollment_id) {
    await runQuery(
      `UPDATE course_enrollment_requests
       SET status = 'removed', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [removedBy, member.source_enrollment_id]
    );
  }

  return {
    memberId,
    removedAt: new Date().toISOString(),
  };
}

async function getClassroomOverview(courseId) {
  const rows = await runQuery(
    `SELECT
      c.id AS course_id,
      c.title AS course_title,
      c.code AS course_code,
      c.status AS course_status,
      cl.id AS classroom_id,
      cl.visibility,
      (SELECT COUNT(*) FROM classroom_members cm
       WHERE cm.classroom_id = cl.id
         AND cm.is_active = 1
         AND cm.removed_at IS NULL) AS active_members,
      (SELECT COUNT(*) FROM notices n WHERE n.classroom_id = cl.id) AS notice_count,
      (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = cl.id) AS assignment_count,
      (SELECT COUNT(*) FROM exams e WHERE e.classroom_id = cl.id) AS exam_count
     FROM courses c
     JOIN classrooms cl ON cl.course_id = c.id
     WHERE c.id = ?
     LIMIT 1`,
    [courseId]
  );

  return rows[0] || null;
}

async function createNotice({ courseId, classroomId, userId, title, body, isPinned }) {
  const insertResult = await runQuery(
    `INSERT INTO notices (classroom_id, created_by, title, body, is_pinned)
     VALUES (?, ?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), body.trim(), isPinned ? 1 : 0]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, body, is_pinned, created_at, updated_at
     FROM notices
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  await createCourseNotificationFanout({
    courseId,
    actorId: userId,
    type: 'new_notice',
    entityType: 'notice',
    entityId: insertResult.insertId,
    message: `New notice posted: ${title.trim()}`,
  });

  return rows[0];
}

async function listNotices({ classroomId, page, limit, q, isPinned, sortBy, sortOrder }) {
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'updated_at', 'is_pinned'].includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = ['n.classroom_id = ?'];
  const params = [classroomId];

  if (isPinned !== undefined) {
    whereParts.push('n.is_pinned = ?');
    params.push(isPinned ? 1 : 0);
  }

  if (q && String(q).trim()) {
    whereParts.push('(n.title LIKE ? OR n.body LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT n.id, n.classroom_id, n.created_by, n.title, n.body, n.is_pinned, n.created_at, n.updated_at,
            u.name AS created_by_name
     FROM notices n
     JOIN edu_users u ON u.id = n.created_by
     ${whereSql}
     ORDER BY n.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM notices n
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function updateNotice({ classroomId, noticeId, payload }) {
  const updatable = ['title', 'body', 'is_pinned'];
  const fields = [];
  const values = [];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(field === 'is_pinned' ? (payload[field] ? 1 : 0) : payload[field]);
    }
  });

  if (!fields.length) {
    return getNoticeById({ classroomId, noticeId });
  }

  values.push(noticeId, classroomId);

  const result = await runQuery(
    `UPDATE notices
     SET ${fields.join(', ')}
     WHERE id = ? AND classroom_id = ?`,
    values
  );

  if (!result.affectedRows) {
    const err = new Error('Notice not found');
    err.status = 404;
    throw err;
  }

  return getNoticeById({ classroomId, noticeId });
}

async function getNoticeById({ classroomId, noticeId }) {
  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, body, is_pinned, created_at, updated_at
     FROM notices
     WHERE id = ? AND classroom_id = ?
     LIMIT 1`,
    [noticeId, classroomId]
  );

  return rows[0] || null;
}

async function deleteNotice({ classroomId, noticeId }) {
  const result = await runQuery('DELETE FROM notices WHERE id = ? AND classroom_id = ?', [noticeId, classroomId]);
  if (!result.affectedRows) {
    const err = new Error('Notice not found');
    err.status = 404;
    throw err;
  }

  return { deleted: true };
}

async function createModuleItem({ tableName, classroomId, userId, title, instructions, totalMarks }) {
  const safeTable = tableName === 'exams' ? 'exams' : 'assignments';

  const insertResult = await runQuery(
    `INSERT INTO ${safeTable} (classroom_id, created_by, title, instructions, total_marks, status)
     VALUES (?, ?, ?, ?, ?, 'draft')`,
    [classroomId, userId, title.trim(), instructions || null, Number(totalMarks || 0)]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, instructions, total_marks, publish_at, due_at, status, created_at, updated_at
     FROM ${safeTable}
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listModuleItems({ tableName, classroomId, page, limit, status, sortBy, sortOrder }) {
  const safeTable = tableName === 'exams' ? 'exams' : 'assignments';
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'publish_at', 'due_at', 'status'].includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = [`${safeTable}.classroom_id = ?`];
  const params = [classroomId];

  if (status && ['draft', 'published', 'closed'].includes(status)) {
    whereParts.push(`${safeTable}.status = ?`);
    params.push(status);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT ${safeTable}.id, ${safeTable}.classroom_id, ${safeTable}.created_by,
            ${safeTable}.title, ${safeTable}.instructions, ${safeTable}.total_marks,
            ${safeTable}.publish_at, ${safeTable}.due_at, ${safeTable}.status,
            ${safeTable}.created_at, ${safeTable}.updated_at,
            u.name AS created_by_name
     FROM ${safeTable}
     JOIN edu_users u ON u.id = ${safeTable}.created_by
     ${whereSql}
     ORDER BY ${safeTable}.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM ${safeTable}
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function updateModuleItem({ tableName, itemId, classroomId, payload }) {
  const safeTable = tableName === 'exams' ? 'exams' : 'assignments';
  const updatable = ['title', 'instructions', 'total_marks', 'publish_at', 'due_at'];
  const fields = [];
  const values = [];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(payload[field]);
    }
  });

  if (!fields.length) {
    return getModuleItemById({ tableName: safeTable, itemId, classroomId });
  }

  values.push(itemId, classroomId);

  const result = await runQuery(
    `UPDATE ${safeTable}
     SET ${fields.join(', ')}
     WHERE id = ? AND classroom_id = ? AND status = 'draft'`,
    values
  );

  if (!result.affectedRows) {
    const err = new Error('Item not found or not editable (only draft items are editable)');
    err.status = 409;
    throw err;
  }

  return getModuleItemById({ tableName: safeTable, itemId, classroomId });
}

async function getModuleItemById({ tableName, itemId, classroomId }) {
  const safeTable = tableName === 'exams' ? 'exams' : 'assignments';
  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, instructions, total_marks, publish_at, due_at, status, created_at, updated_at
     FROM ${safeTable}
     WHERE id = ? AND classroom_id = ?
     LIMIT 1`,
    [itemId, classroomId]
  );

  return rows[0] || null;
}

async function updateModuleItemStatus({ tableName, itemId, classroomId, status }) {
  const safeTable = tableName === 'exams' ? 'exams' : 'assignments';

  const result = await runQuery(
    `UPDATE ${safeTable}
     SET status = ?,
         publish_at = CASE WHEN ? = 'published' AND publish_at IS NULL THEN NOW() ELSE publish_at END
     WHERE id = ? AND classroom_id = ?`,
    [status, status, itemId, classroomId]
  );

  if (!result.affectedRows) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }

  return getModuleItemById({ tableName: safeTable, itemId, classroomId });
}

async function createModuleSubmission({ tableName, itemId, studentId, content }) {
  const submissionTable = tableName === 'exams' ? 'exam_submissions' : 'assignment_submissions';
  const foreignKeyField = tableName === 'exams' ? 'exam_id' : 'assignment_id';

  const existing = await runQuery(
    `SELECT id FROM ${submissionTable}
     WHERE ${foreignKeyField} = ? AND student_id = ?
     LIMIT 1`,
    [itemId, studentId]
  );

  if (existing.length) {
    const err = new Error('You have already submitted');
    err.status = 409;
    throw err;
  }

  const insertResult = await runQuery(
    `INSERT INTO ${submissionTable} (${foreignKeyField}, student_id, content)
     VALUES (?, ?, ?)`,
    [itemId, studentId, content || null]
  );

  const rows = await runQuery(
    `SELECT * FROM ${submissionTable}
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listModuleSubmissions({ tableName, itemId, page, limit }) {
  const submissionTable = tableName === 'exams' ? 'exam_submissions' : 'assignment_submissions';
  const foreignKeyField = tableName === 'exams' ? 'exam_id' : 'assignment_id';
  const offset = (page - 1) * limit;

  const rows = await runQuery(
    `SELECT s.*, u.name AS student_name, u.email AS student_email
     FROM ${submissionTable} s
     JOIN edu_users u ON u.id = s.student_id
     WHERE s.${foreignKeyField} = ?
     ORDER BY s.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [itemId, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM ${submissionTable}
     WHERE ${foreignKeyField} = ?`,
    [itemId]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function createResource({ classroomId, userId, title, description, fileUrl, fileType, fileSize }) {
  const insertResult = await runQuery(
    `INSERT INTO resources (classroom_id, uploaded_by, title, description, file_url, file_type, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), description || null, fileUrl, fileType || null, fileSize || null]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, uploaded_by, title, description, file_url, file_type, file_size, created_at
     FROM resources
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listResources({ classroomId, page, limit, q, sortBy, sortOrder }) {
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'title', 'file_size'].includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = ['r.classroom_id = ?'];
  const params = [classroomId];

  if (q && String(q).trim()) {
    whereParts.push('(r.title LIKE ? OR r.description LIKE ? OR r.file_type LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT r.id, r.classroom_id, r.uploaded_by, r.title, r.description, r.file_url, r.file_type, r.file_size, r.created_at,
            u.name AS uploaded_by_name
     FROM resources r
     JOIN edu_users u ON u.id = r.uploaded_by
     ${whereSql}
     ORDER BY r.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM resources r
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function deleteResource({ classroomId, resourceId }) {
  const result = await runQuery('DELETE FROM resources WHERE id = ? AND classroom_id = ?', [resourceId, classroomId]);
  if (!result.affectedRows) {
    const err = new Error('Resource not found');
    err.status = 404;
    throw err;
  }

  return { deleted: true };
}

async function createNote({ classroomId, userId, title, body }) {
  const insertResult = await runQuery(
    `INSERT INTO notes (classroom_id, created_by, title, body)
     VALUES (?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), body || null]
  );

  const rows = await runQuery(
    `SELECT n.id, n.classroom_id, n.created_by, n.title, n.body, n.created_at, n.updated_at,
            u.name AS created_by_name
     FROM notes n
     JOIN edu_users u ON u.id = n.created_by
     WHERE n.id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listNotes({ classroomId, page, limit, q, sortBy, sortOrder }) {
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'updated_at', 'title'].includes(sortBy) ? sortBy : 'updated_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = ['n.classroom_id = ?'];
  const params = [classroomId];

  if (q && String(q).trim()) {
    whereParts.push('(n.title LIKE ? OR n.body LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT n.id, n.classroom_id, n.created_by, n.title, n.body, n.created_at, n.updated_at,
            u.name AS created_by_name
     FROM notes n
     JOIN edu_users u ON u.id = n.created_by
     ${whereSql}
     ORDER BY n.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM notes n
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function updateNote({ classroomId, noteId, payload }) {
  const updatable = ['title', 'body'];
  const fields = [];
  const values = [];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(payload[field]);
    }
  });

  if (!fields.length) {
    return getNoteById({ classroomId, noteId });
  }

  values.push(noteId, classroomId);

  const result = await runQuery(
    `UPDATE notes
     SET ${fields.join(', ')}
     WHERE id = ? AND classroom_id = ?`,
    values
  );

  if (!result.affectedRows) {
    const err = new Error('Note not found');
    err.status = 404;
    throw err;
  }

  return getNoteById({ classroomId, noteId });
}

async function getNoteById({ classroomId, noteId }) {
  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, body, created_at, updated_at
     FROM notes
     WHERE id = ? AND classroom_id = ?
     LIMIT 1`,
    [noteId, classroomId]
  );

  return rows[0] || null;
}

async function deleteNote({ classroomId, noteId }) {
  const result = await runQuery('DELETE FROM notes WHERE id = ? AND classroom_id = ?', [noteId, classroomId]);
  if (!result.affectedRows) {
    const err = new Error('Note not found');
    err.status = 404;
    throw err;
  }

  return { deleted: true };
}

async function createDiscussionThread({ classroomId, userId, title, body }) {
  const insertResult = await runQuery(
    `INSERT INTO discussion_threads (classroom_id, created_by, title, body)
     VALUES (?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), body || null]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, body, is_locked, created_at, updated_at
     FROM discussion_threads
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listDiscussionThreads({ classroomId, page, limit, q, sortBy, sortOrder }) {
  const offset = (page - 1) * limit;
  const safeSortBy = ['created_at', 'updated_at', 'title'].includes(sortBy) ? sortBy : 'updated_at';
  const safeSortOrder = String(sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereParts = ['dt.classroom_id = ?'];
  const params = [classroomId];

  if (q && String(q).trim()) {
    whereParts.push('(dt.title LIKE ? OR dt.body LIKE ?)');
    const pattern = `%${String(q).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT dt.id, dt.classroom_id, dt.created_by, dt.title, dt.body, dt.is_locked, dt.created_at, dt.updated_at,
            u.name AS created_by_name,
            (SELECT COUNT(*) FROM discussion_messages dm WHERE dm.thread_id = dt.id) AS message_count
     FROM discussion_threads dt
     JOIN edu_users u ON u.id = dt.created_by
     ${whereSql}
     ORDER BY dt.${safeSortBy} ${safeSortOrder}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM discussion_threads dt
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function getDiscussionThread({ classroomId, threadId }) {
  const rows = await runQuery(
    `SELECT dt.id, dt.classroom_id, dt.created_by, dt.title, dt.body, dt.is_locked, dt.created_at, dt.updated_at,
            u.name AS created_by_name
     FROM discussion_threads dt
     JOIN edu_users u ON u.id = dt.created_by
     WHERE dt.id = ? AND dt.classroom_id = ?
     LIMIT 1`,
    [threadId, classroomId]
  );

  return rows[0] || null;
}

async function updateDiscussionThread({ classroomId, threadId, payload }) {
  const updatable = ['title', 'body', 'is_locked'];
  const fields = [];
  const values = [];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(field === 'is_locked' ? (payload[field] ? 1 : 0) : payload[field]);
    }
  });

  if (!fields.length) {
    return getDiscussionThread({ classroomId, threadId });
  }

  values.push(threadId, classroomId);

  const result = await runQuery(
    `UPDATE discussion_threads
     SET ${fields.join(', ')}
     WHERE id = ? AND classroom_id = ?`,
    values
  );

  if (!result.affectedRows) {
    const err = new Error('Discussion thread not found');
    err.status = 404;
    throw err;
  }

  return getDiscussionThread({ classroomId, threadId });
}

async function deleteDiscussionThread({ classroomId, threadId }) {
  const result = await runQuery('DELETE FROM discussion_threads WHERE id = ? AND classroom_id = ?', [threadId, classroomId]);
  if (!result.affectedRows) {
    const err = new Error('Discussion thread not found');
    err.status = 404;
    throw err;
  }

  return { deleted: true };
}

async function createDiscussionMessage({ threadId, senderId, message, parentMessageId }) {
  const insertResult = await runQuery(
    `INSERT INTO discussion_messages (thread_id, sender_id, message, parent_message_id)
     VALUES (?, ?, ?, ?)`,
    [threadId, senderId, message.trim(), parentMessageId || null]
  );

  const rows = await runQuery(
    `SELECT dm.id, dm.thread_id, dm.sender_id, dm.message, dm.parent_message_id, dm.created_at,
            u.name AS sender_name
     FROM discussion_messages dm
     JOIN edu_users u ON u.id = dm.sender_id
     WHERE dm.id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listDiscussionMessages({ threadId, page, limit }) {
  const offset = (page - 1) * limit;
  const rows = await runQuery(
    `SELECT dm.id, dm.thread_id, dm.sender_id, dm.message, dm.parent_message_id, dm.created_at,
            u.name AS sender_name
     FROM discussion_messages dm
     JOIN edu_users u ON u.id = dm.sender_id
     WHERE dm.thread_id = ?
     ORDER BY dm.created_at ASC
     LIMIT ? OFFSET ?`,
    [threadId, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM discussion_messages
     WHERE thread_id = ?`,
    [threadId]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function createLiveSession({ courseId, classroomId, userId, title, scheduledAt, providerRoomId, meetingId }) {
  const insertResult = await runQuery(
    `INSERT INTO live_class_sessions
      (classroom_id, created_by, title, scheduled_at, status, provider, provider_room_id, meeting_id)
     VALUES (?, ?, ?, ?, 'scheduled', 'internal-webrtc', ?, ?)`,
    [classroomId, userId, title.trim(), scheduledAt || null, providerRoomId, meetingId || null]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, scheduled_at, started_at, ended_at, status, provider, provider_room_id, meeting_id, created_at
     FROM live_class_sessions
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  await createCourseNotificationFanout({
    courseId,
    actorId: userId,
    type: 'live_class_started',
    entityType: 'live_session',
    entityId: insertResult.insertId,
    message: `Live class scheduled: ${title.trim()}`,
  });

  return rows[0];
}

async function listLiveSessions({ classroomId, page, limit, status }) {
  const offset = (page - 1) * limit;
  const whereParts = ['lcs.classroom_id = ?'];
  const params = [classroomId];

  if (status && ['scheduled', 'live', 'ended'].includes(status)) {
    whereParts.push('lcs.status = ?');
    params.push(status);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT lcs.*,
            u.name AS created_by_name
     FROM live_class_sessions lcs
     JOIN edu_users u ON u.id = lcs.created_by
     ${whereSql}
     ORDER BY COALESCE(lcs.scheduled_at, lcs.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM live_class_sessions lcs
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function getLiveSession({ classroomId, sessionId }) {
  const rows = await runQuery(
    `SELECT *
     FROM live_class_sessions
     WHERE id = ? AND classroom_id = ?
     LIMIT 1`,
    [sessionId, classroomId]
  );

  return rows[0] || null;
}

async function markLiveSessionLive({ classroomId, sessionId }) {
  const result = await runQuery(
    `UPDATE live_class_sessions
     SET status = 'live', started_at = COALESCE(started_at, NOW())
     WHERE id = ? AND classroom_id = ?`,
    [sessionId, classroomId]
  );

  if (!result.affectedRows) {
    const err = new Error('Live session not found');
    err.status = 404;
    throw err;
  }

  return getLiveSession({ classroomId, sessionId });
}

async function endLiveSession({ classroomId, sessionId }) {
  const result = await runQuery(
    `UPDATE live_class_sessions
     SET status = 'ended', ended_at = COALESCE(ended_at, NOW())
     WHERE id = ? AND classroom_id = ?`,
    [sessionId, classroomId]
  );

  if (!result.affectedRows) {
    const err = new Error('Live session not found');
    err.status = 404;
    throw err;
  }

  return getLiveSession({ classroomId, sessionId });
}

async function createAttendanceSession({ classroomId, userId, title, sessionDate }) {
  const insertResult = await runQuery(
    `INSERT INTO attendance_sessions (classroom_id, created_by, title, session_date)
     VALUES (?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), sessionDate]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, session_date, created_at
     FROM attendance_sessions
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listAttendanceSessions({ classroomId, page, limit }) {
  const offset = (page - 1) * limit;

  const rows = await runQuery(
    `SELECT asn.id, asn.classroom_id, asn.created_by, asn.title, asn.session_date, asn.created_at,
            u.name AS created_by_name
     FROM attendance_sessions asn
     JOIN edu_users u ON u.id = asn.created_by
     WHERE asn.classroom_id = ?
     ORDER BY asn.session_date DESC, asn.id DESC
     LIMIT ? OFFSET ?`,
    [classroomId, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM attendance_sessions
     WHERE classroom_id = ?`,
    [classroomId]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function markAttendance({ attendanceSessionId, markedBy, records }) {
  await Promise.all(
    records.map((record) =>
      runQuery(
        `INSERT INTO attendance_records (attendance_session_id, student_id, status, marked_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           marked_by = VALUES(marked_by),
           marked_at = CURRENT_TIMESTAMP`,
        [attendanceSessionId, record.studentId, record.status, markedBy]
      )
    )
  );

  const rows = await runQuery(
    `SELECT ar.id, ar.attendance_session_id, ar.student_id, ar.status, ar.marked_by, ar.marked_at,
            u.name AS student_name
     FROM attendance_records ar
     JOIN edu_users u ON u.id = ar.student_id
     WHERE ar.attendance_session_id = ?
     ORDER BY ar.student_id ASC`,
    [attendanceSessionId]
  );

  return rows;
}

async function listAttendanceRecords({ classroomId, studentId, page, limit }) {
  const offset = (page - 1) * limit;

  const rows = await runQuery(
    `SELECT
      ar.id,
      ar.attendance_session_id,
      ar.student_id,
      ar.status,
      ar.marked_by,
      ar.marked_at,
      asn.session_date,
      asn.title AS session_title,
      su.name AS student_name,
      mu.name AS marked_by_name
     FROM attendance_records ar
     JOIN attendance_sessions asn ON asn.id = ar.attendance_session_id
     JOIN edu_users su ON su.id = ar.student_id
     JOIN edu_users mu ON mu.id = ar.marked_by
     WHERE asn.classroom_id = ?
       AND (? IS NULL OR ar.student_id = ?)
     ORDER BY asn.session_date DESC, ar.id DESC
     LIMIT ? OFFSET ?`,
    [classroomId, studentId || null, studentId || null, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM attendance_records ar
     JOIN attendance_sessions asn ON asn.id = ar.attendance_session_id
     WHERE asn.classroom_id = ?
       AND (? IS NULL OR ar.student_id = ?)`,
    [classroomId, studentId || null, studentId || null]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function createGradeItem({ classroomId, userId, title, itemType, maxScore, weightPercent }) {
  const insertResult = await runQuery(
    `INSERT INTO grade_items (classroom_id, created_by, title, item_type, max_score, weight_percent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [classroomId, userId, title.trim(), itemType || 'manual', Number(maxScore || 100), weightPercent || null]
  );

  const rows = await runQuery(
    `SELECT id, classroom_id, created_by, title, item_type, max_score, weight_percent, created_at
     FROM grade_items
     WHERE id = ?
     LIMIT 1`,
    [insertResult.insertId]
  );

  return rows[0];
}

async function listGradeItems({ classroomId, page, limit }) {
  const offset = (page - 1) * limit;

  const rows = await runQuery(
    `SELECT gi.id, gi.classroom_id, gi.created_by, gi.title, gi.item_type, gi.max_score, gi.weight_percent, gi.created_at,
            u.name AS created_by_name
     FROM grade_items gi
     JOIN edu_users u ON u.id = gi.created_by
     WHERE gi.classroom_id = ?
     ORDER BY gi.created_at DESC
     LIMIT ? OFFSET ?`,
    [classroomId, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM grade_items
     WHERE classroom_id = ?`,
    [classroomId]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function upsertGradeEntries({ gradeItemId, gradedBy, entries }) {
  await Promise.all(
    entries.map((entry) =>
      runQuery(
        `INSERT INTO grade_entries (grade_item_id, student_id, score, feedback, graded_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           score = VALUES(score),
           feedback = VALUES(feedback),
           graded_by = VALUES(graded_by),
           graded_at = CURRENT_TIMESTAMP`,
        [gradeItemId, entry.studentId, entry.score, entry.feedback || null, gradedBy]
      )
    )
  );

  const rows = await runQuery(
    `SELECT ge.id, ge.grade_item_id, ge.student_id, ge.score, ge.feedback, ge.graded_by, ge.graded_at,
            u.name AS student_name
     FROM grade_entries ge
     JOIN edu_users u ON u.id = ge.student_id
     WHERE ge.grade_item_id = ?
     ORDER BY ge.student_id ASC`,
    [gradeItemId]
  );

  return rows;
}

async function updateGradeEntry({ entryId, score, feedback, gradedBy }) {
  const result = await runQuery(
    `UPDATE grade_entries
     SET score = ?, feedback = ?, graded_by = ?, graded_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [score, feedback || null, gradedBy, entryId]
  );

  if (!result.affectedRows) {
    const err = new Error('Grade entry not found');
    err.status = 404;
    throw err;
  }

  const rows = await runQuery(
    `SELECT ge.id, ge.grade_item_id, ge.student_id, ge.score, ge.feedback, ge.graded_by, ge.graded_at,
            u.name AS student_name
     FROM grade_entries ge
     JOIN edu_users u ON u.id = ge.student_id
     WHERE ge.id = ?
     LIMIT 1`,
    [entryId]
  );

  return rows[0];
}

async function getStudentGradeView({ classroomId, studentId }) {
  const rows = await runQuery(
    `SELECT
      gi.id AS grade_item_id,
      gi.title,
      gi.item_type,
      gi.max_score,
      gi.weight_percent,
      ge.id AS grade_entry_id,
      ge.score,
      ge.feedback,
      ge.graded_at
     FROM grade_items gi
     LEFT JOIN grade_entries ge
       ON ge.grade_item_id = gi.id
      AND ge.student_id = ?
     WHERE gi.classroom_id = ?
     ORDER BY gi.created_at DESC`,
    [studentId, classroomId]
  );

  return rows;
}

async function createCourseNotificationFanout({ courseId, actorId, type, entityType, entityId, message }) {
  const recipientRows = await runQuery(
    `SELECT DISTINCT cm.user_id
     FROM classrooms cl
     JOIN classroom_members cm ON cm.classroom_id = cl.id
     WHERE cl.course_id = ?
       AND cm.is_active = 1
       AND cm.removed_at IS NULL
       AND cm.user_id <> ?`,
    [courseId, actorId || 0]
  );

  if (!recipientRows.length) return 0;

  await Promise.all(
    recipientRows.map((row) =>
      runQuery(
        `INSERT INTO classroom_notifications
          (recipient_id, actor_id, course_id, type, entity_type, entity_id, message, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [row.user_id, actorId || null, courseId, type, entityType, entityId, message]
      )
    )
  );

  return recipientRows.length;
}

async function createSingleNotification({ recipientId, actorId, courseId, type, entityType, entityId, message }) {
  await runQuery(
    `INSERT INTO classroom_notifications
      (recipient_id, actor_id, course_id, type, entity_type, entity_id, message, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [recipientId, actorId || null, courseId || null, type, entityType, entityId, message]
  );
}

async function listNotifications({ userId, page, limit }) {
  const offset = (page - 1) * limit;

  const rows = await runQuery(
    `SELECT cn.id, cn.recipient_id, cn.actor_id, cn.course_id, cn.type, cn.entity_type, cn.entity_id,
            cn.message, cn.is_read, cn.created_at,
            u.name AS actor_name
     FROM classroom_notifications cn
     LEFT JOIN edu_users u ON u.id = cn.actor_id
     WHERE cn.recipient_id = ?
     ORDER BY cn.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  const totalRows = await runQuery(
    'SELECT COUNT(*) AS total FROM classroom_notifications WHERE recipient_id = ?',
    [userId]
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}

async function getUnreadNotificationCount(userId) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS unreadCount
     FROM classroom_notifications
     WHERE recipient_id = ? AND is_read = 0`,
    [userId]
  );

  return Number(rows[0]?.unreadCount || 0);
}

async function markNotificationRead({ userId, notificationId, isRead }) {
  const result = await runQuery(
    `UPDATE classroom_notifications
     SET is_read = ?
     WHERE id = ? AND recipient_id = ?`,
    [isRead ? 1 : 0, notificationId, userId]
  );

  if (!result.affectedRows) {
    const err = new Error('Notification not found');
    err.status = 404;
    throw err;
  }

  const rows = await runQuery(
    `SELECT id, recipient_id, actor_id, course_id, type, entity_type, entity_id, message, is_read, created_at
     FROM classroom_notifications
     WHERE id = ?
     LIMIT 1`,
    [notificationId]
  );

  return rows[0];
}

async function markAllNotificationsRead({ userId, isRead }) {
  const result = await runQuery(
    `UPDATE classroom_notifications
     SET is_read = ?
     WHERE recipient_id = ?`,
    [isRead ? 1 : 0, userId]
  );

  return {
    affectedRows: result.affectedRows || 0,
  };
}

async function listMyEnrollmentRequests({ studentId, page, limit, status }) {
  const offset = (page - 1) * limit;
  const whereParts = ['cer.student_id = ?'];
  const params = [studentId];

  if (status && ['pending', 'approved', 'rejected', 'removed'].includes(status)) {
    whereParts.push('cer.status = ?');
    params.push(status);
  }

  const whereSql = `WHERE ${whereParts.join(' AND ')}`;

  const rows = await runQuery(
    `SELECT cer.id, cer.course_id, cer.student_id, cer.status, cer.note, cer.requested_at,
            cer.reviewed_by, cer.reviewed_at, cer.review_note,
            c.title AS course_title, c.code AS course_code, c.status AS course_status,
            u.name AS reviewed_by_name
     FROM course_enrollment_requests cer
     JOIN courses c ON c.id = cer.course_id
     LEFT JOIN edu_users u ON u.id = cer.reviewed_by
     ${whereSql}
     ORDER BY cer.requested_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const totalRows = await runQuery(
    `SELECT COUNT(*) AS total
     FROM course_enrollment_requests cer
     ${whereSql}`,
    params
  );

  return {
    data: rows,
    meta: buildPaginatedMeta(page, limit, totalRows[0]?.total || 0),
  };
}
async function getActiveLiveRoom(courseId) {
  const rows = await runQuery(
    `SELECT lcs.id, lcs.classroom_id, lcs.created_by, lcs.title, lcs.status, lcs.provider_room_id, lcs.started_at, c.id AS course_id
     FROM live_class_sessions lcs
     JOIN classrooms cl ON cl.id = lcs.classroom_id
     JOIN courses c ON c.id = cl.course_id
     WHERE c.id = ? AND lcs.status IN ('live', 'scheduled')
     ORDER BY lcs.status ASC, lcs.created_at DESC
     LIMIT 1`,
    [courseId]
  );
  if (!rows.length) return null;
  const room = rows[0];
  return {
    roomId: room.provider_room_id,
    courseId: room.course_id,
    status: room.status === 'live' ? 'live' : 'waiting',
    participantCount: 0,
    startedAt: room.started_at
  };
}

async function activateLiveRoom(courseId, userId, title) {
  const existing = await getActiveLiveRoom(courseId);
  if (existing && existing.status === 'live') {
    return existing;
  }
  
  const clRows = await runQuery(`SELECT id FROM classrooms WHERE course_id = ? LIMIT 1`, [courseId]);
  if (!clRows.length) throw new Error('Classroom not found');
  const classroomId = clRows[0].id;
  
  const roomId = `room-${courseId}-${Date.now()}`;
  await runQuery(
    `INSERT INTO live_class_sessions (classroom_id, created_by, title, status, provider_room_id, started_at)
     VALUES (?, ?, ?, 'live', ?, NOW())`,
    [classroomId, userId, title || 'Live Class', roomId]
  );
  
  return getActiveLiveRoom(courseId);
}

async function createCourseMaterial(courseId, { title, description, type, url, thumbnailUrl, visibility, duration, fileSize }) {
  const insertResult = await runQuery(
    `INSERT INTO course_materials (course_id, title, description, type, url, thumbnail_url, visibility, duration, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [courseId, title, description, type, url, thumbnailUrl || null, visibility || 'enrolled_only', duration || null, fileSize || null]
  );
  
  const rows = await runQuery(`SELECT * FROM course_materials WHERE id = ?`, [insertResult.insertId]);
  return rows[0];
}

async function listCourseMaterials(courseId, typeFilter) {
  let query = `SELECT * FROM course_materials WHERE course_id = ?`;
  const params = [courseId];
  if (typeFilter) {
    query += ` AND type = ?`;
    params.push(typeFilter);
  }
  query += ` ORDER BY created_at DESC`;
  const rows = await runQuery(query, params);
  return rows;
}

async function listPublicMaterials(courseId) {
  const rows = await runQuery(
    `SELECT * FROM course_materials WHERE course_id = ? AND visibility = 'public' ORDER BY created_at DESC`,
    [courseId]
  );
  return rows;
}

async function getCourseGroupChatInfo(courseId) {
  const cRows = await runQuery(`SELECT title FROM courses WHERE id = ? LIMIT 1`, [courseId]);
  if (!cRows.length) throw new Error('Course not found');
  
  const clRows = await runQuery(`SELECT id FROM classrooms WHERE course_id = ? LIMIT 1`, [courseId]);
  let memberCount = 0;
  if (clRows.length) {
    const mRows = await runQuery(
      `SELECT COUNT(*) as count FROM classroom_members WHERE classroom_id = ? AND is_active = 1 AND removed_at IS NULL`,
      [clRows[0].id]
    );
    memberCount = mRows[0].count;
  }
  
  const msgRows = await runQuery(
    `SELECT content FROM classroom_room_messages WHERE course_id = ? ORDER BY created_at DESC LIMIT 1`,
    [courseId]
  );
  
  return {
    id: `course-${courseId}`,
    courseId,
    courseTitle: cRows[0].title,
    memberCount,
    lastMessageText: msgRows.length ? msgRows[0].content : null,
    unreadCount: 0
  };
}

async function getEnrollmentStatus(courseId, studentId) {
  const rows = await runQuery(
    `SELECT status FROM course_enrollment_requests WHERE course_id = ? AND student_id = ? ORDER BY requested_at DESC LIMIT 1`,
    [courseId, studentId]
  );
  return rows.length ? rows[0] : null;
}

module.exports = {
  createCourse,
  listCourses,
  getCourseById,
  updateCourse,
  updateCourseStatus,
  submitEnrollmentRequest,
  listEnrollmentRequests,
  reviewEnrollmentRequest,
  listClassroomMembers,
  addAssistant,
  removeMember,
  getClassroomOverview,
  createNotice,
  listNotices,
  updateNotice,
  deleteNotice,
  createModuleItem,
  listModuleItems,
  getModuleItemById,
  updateModuleItem,
  updateModuleItemStatus,
  createModuleSubmission,
  listModuleSubmissions,
  createNote,
  listNotes,
  updateNote,
  deleteNote,
  createResource,
  listResources,
  deleteResource,
  createDiscussionThread,
  listDiscussionThreads,
  getDiscussionThread,
  updateDiscussionThread,
  deleteDiscussionThread,
  createDiscussionMessage,
  listDiscussionMessages,
  createLiveSession,
  listLiveSessions,
  getLiveSession,
  markLiveSessionLive,
  endLiveSession,
  createAttendanceSession,
  listAttendanceSessions,
  markAttendance,
  listAttendanceRecords,
  createGradeItem,
  listGradeItems,
  upsertGradeEntries,
  updateGradeEntry,
  getStudentGradeView,
  createCourseNotificationFanout,
  createSingleNotification,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  listMyEnrollmentRequests,
  getActiveLiveRoom,
  activateLiveRoom,
  createCourseMaterial,
  listCourseMaterials,
  listPublicMaterials,
  getCourseGroupChatInfo,
  getEnrollmentStatus,
};

