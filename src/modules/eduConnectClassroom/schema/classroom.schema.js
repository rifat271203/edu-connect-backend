const { runQuery, ensureEduSchema } = require('../../../../utils/eduSchema');

let classroomSchemaInitPromise = null;

async function ensureClassroomSchema() {
  if (classroomSchemaInitPromise) return classroomSchemaInitPromise;

  classroomSchemaInitPromise = (async () => {
    await ensureEduSchema();

    await runQuery(`
      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        code VARCHAR(60) NOT NULL,
        description TEXT,
        course_pic_url VARCHAR(600) DEFAULT NULL,
        department VARCHAR(120) DEFAULT NULL,
        status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_courses_code_teacher (teacher_id, code),
        INDEX idx_courses_status_created (status, created_at),
        CONSTRAINT fk_courses_teacher FOREIGN KEY (teacher_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    const coursePicColumnRows = await runQuery(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'courses'
         AND COLUMN_NAME = 'course_pic_url'
       LIMIT 1`
    );

    if (!coursePicColumnRows.length) {
      await runQuery(`
        ALTER TABLE courses
        ADD COLUMN course_pic_url VARCHAR(600) DEFAULT NULL
      `);
    }

    await runQuery(`
      CREATE TABLE IF NOT EXISTS course_staff (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        user_id INT NOT NULL,
        role ENUM('assistant') NOT NULL DEFAULT 'assistant',
        added_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_course_staff (course_id, user_id),
        INDEX idx_course_staff_user (user_id),
        CONSTRAINT fk_course_staff_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        CONSTRAINT fk_course_staff_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_course_staff_added_by FOREIGN KEY (added_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS classrooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        visibility ENUM('private') NOT NULL DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_classrooms_course (course_id),
        CONSTRAINT fk_classrooms_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS course_enrollment_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        student_id INT NOT NULL,
        status ENUM('pending', 'approved', 'rejected', 'removed') NOT NULL DEFAULT 'pending',
        note VARCHAR(500) DEFAULT NULL,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_by INT DEFAULT NULL,
        reviewed_at TIMESTAMP NULL DEFAULT NULL,
        review_note VARCHAR(500) DEFAULT NULL,
        INDEX idx_enrollment_course_status_requested (course_id, status, requested_at),
        INDEX idx_enrollment_student_requested (student_id, requested_at),
        CONSTRAINT fk_enrollment_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        CONSTRAINT fk_enrollment_student FOREIGN KEY (student_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_enrollment_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES edu_users(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS classroom_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        user_id INT NOT NULL,
        membership_role ENUM('teacher', 'assistant', 'student') NOT NULL,
        source_enrollment_id INT DEFAULT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        removed_at TIMESTAMP NULL DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uniq_classroom_member_active (classroom_id, user_id, is_active),
        INDEX idx_classroom_members_active (classroom_id, is_active),
        CONSTRAINT fk_classroom_members_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_classroom_members_user FOREIGN KEY (user_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_classroom_members_enrollment FOREIGN KEY (source_enrollment_id) REFERENCES course_enrollment_requests(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS discussion_threads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_discussion_threads_classroom_created (classroom_id, created_at),
        CONSTRAINT fk_discussion_threads_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_discussion_threads_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS discussion_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        thread_id INT NOT NULL,
        sender_id INT NOT NULL,
        message TEXT NOT NULL,
        parent_message_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_discussion_messages_thread_created (thread_id, created_at),
        CONSTRAINT fk_discussion_messages_thread FOREIGN KEY (thread_id) REFERENCES discussion_threads(id) ON DELETE CASCADE,
        CONSTRAINT fk_discussion_messages_sender FOREIGN KEY (sender_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_discussion_messages_parent FOREIGN KEY (parent_message_id) REFERENCES discussion_messages(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS notices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        is_pinned TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_notices_classroom_pinned_created (classroom_id, is_pinned, created_at),
        CONSTRAINT fk_notices_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_notices_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS exams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        instructions TEXT,
        total_marks DECIMAL(10,2) DEFAULT 0,
        duration_minutes INT DEFAULT NULL,
        publish_at DATETIME DEFAULT NULL,
        due_at DATETIME DEFAULT NULL,
        status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_exams_classroom_status_publish (classroom_id, status, publish_at),
        CONSTRAINT fk_exams_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_exams_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS exam_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        exam_id INT NOT NULL,
        student_id INT NOT NULL,
        content LONGTEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        score DECIMAL(10,2) DEFAULT NULL,
        feedback TEXT,
        UNIQUE KEY uniq_exam_submission (exam_id, student_id),
        INDEX idx_exam_submissions_exam_submitted (exam_id, submitted_at),
        CONSTRAINT fk_exam_submissions_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
        CONSTRAINT fk_exam_submissions_student FOREIGN KEY (student_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        body LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_notes_classroom_created (classroom_id, created_at),
        CONSTRAINT fk_notes_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_notes_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        instructions TEXT,
        total_marks DECIMAL(10,2) DEFAULT 0,
        publish_at DATETIME DEFAULT NULL,
        due_at DATETIME DEFAULT NULL,
        status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_assignments_classroom_status_publish (classroom_id, status, publish_at),
        CONSTRAINT fk_assignments_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_assignments_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        assignment_id INT NOT NULL,
        student_id INT NOT NULL,
        content LONGTEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        score DECIMAL(10,2) DEFAULT NULL,
        feedback TEXT,
        UNIQUE KEY uniq_assignment_submission (assignment_id, student_id),
        INDEX idx_assignment_submissions_assignment_submitted (assignment_id, submitted_at),
        CONSTRAINT fk_assignment_submissions_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
        CONSTRAINT fk_assignment_submissions_student FOREIGN KEY (student_id) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS resources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        uploaded_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        file_url VARCHAR(600) NOT NULL,
        file_type VARCHAR(120) DEFAULT NULL,
        file_size BIGINT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_resources_classroom_created (classroom_id, created_at),
        CONSTRAINT fk_resources_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_resources_uploader FOREIGN KEY (uploaded_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS live_class_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        scheduled_at DATETIME DEFAULT NULL,
        started_at DATETIME DEFAULT NULL,
        ended_at DATETIME DEFAULT NULL,
        status ENUM('scheduled', 'live', 'ended') NOT NULL DEFAULT 'scheduled',
        provider ENUM('internal-webrtc') NOT NULL DEFAULT 'internal-webrtc',
        provider_room_id VARCHAR(80) NOT NULL,
        meeting_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_live_sessions_room_id (provider_room_id),
        INDEX idx_live_sessions_classroom_status (classroom_id, status),
        CONSTRAINT fk_live_sessions_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_live_sessions_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_live_sessions_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        session_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attendance_sessions_classroom_date (classroom_id, session_date),
        CONSTRAINT fk_attendance_sessions_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_attendance_sessions_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        attendance_session_id INT NOT NULL,
        student_id INT NOT NULL,
        status ENUM('present', 'absent', 'late', 'excused') NOT NULL,
        marked_by INT NOT NULL,
        marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_attendance_record (attendance_session_id, student_id),
        INDEX idx_attendance_records_student_marked (student_id, marked_at),
        CONSTRAINT fk_attendance_records_session FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_attendance_records_student FOREIGN KEY (student_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_attendance_records_marker FOREIGN KEY (marked_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS grade_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT NOT NULL,
        created_by INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        item_type ENUM('assignment', 'exam', 'quiz', 'manual') NOT NULL DEFAULT 'manual',
        max_score DECIMAL(10,2) NOT NULL DEFAULT 100,
        weight_percent DECIMAL(5,2) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_grade_items_classroom_created (classroom_id, created_at),
        CONSTRAINT fk_grade_items_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
        CONSTRAINT fk_grade_items_creator FOREIGN KEY (created_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS grade_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grade_item_id INT NOT NULL,
        student_id INT NOT NULL,
        score DECIMAL(10,2) NOT NULL,
        feedback TEXT,
        graded_by INT NOT NULL,
        graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_grade_entry (grade_item_id, student_id),
        INDEX idx_grade_entries_student_graded (student_id, graded_at),
        CONSTRAINT fk_grade_entries_item FOREIGN KEY (grade_item_id) REFERENCES grade_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_grade_entries_student FOREIGN KEY (student_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_grade_entries_grader FOREIGN KEY (graded_by) REFERENCES edu_users(id) ON DELETE CASCADE
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS classroom_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recipient_id INT NOT NULL,
        actor_id INT DEFAULT NULL,
        course_id INT DEFAULT NULL,
        type ENUM(
          'enrollment_request_submitted',
          'enrollment_approved',
          'enrollment_rejected',
          'new_notice',
          'assignment_published',
          'exam_published',
          'live_class_started'
        ) NOT NULL,
        entity_type VARCHAR(80) NOT NULL,
        entity_id INT NOT NULL,
        message VARCHAR(255) NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_classroom_notifications_recipient (recipient_id, is_read, created_at),
        CONSTRAINT fk_classroom_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES edu_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_classroom_notifications_actor FOREIGN KEY (actor_id) REFERENCES edu_users(id) ON DELETE SET NULL,
        CONSTRAINT fk_classroom_notifications_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      )
    `);
  })().catch((error) => {
    classroomSchemaInitPromise = null;
    throw error;
  });

  return classroomSchemaInitPromise;
}

module.exports = {
  ensureClassroomSchema,
};

