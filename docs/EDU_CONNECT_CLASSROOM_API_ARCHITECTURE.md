# Edu Connect Classroom Backend API Architecture

## Base conventions

- Base path: `/api/classroom`
- Auth: `Authorization: Bearer <JWT>`
- Roles: `teacher`, `student`, `assistant`
- Enrollment states: `pending`, `approved`, `rejected`, `removed`
- Course status: `active`, `archived`
- Notice status: `pinned`, `unpinned`
- Exam/Assignment status: `draft`, `published`, `closed`

---

## 1) Module-by-module endpoint list

## 1.1 Courses

- `POST /api/classroom/courses` (teacher)
- `GET /api/classroom/courses` (public list, auth optional)
- `GET /api/classroom/courses/:courseId` (public basic details)
- `PATCH /api/classroom/courses/:courseId` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/archive` (teacher)
- `PATCH /api/classroom/courses/:courseId/activate` (teacher)

## 1.2 Enrollment requests & enrollments

- `POST /api/classroom/courses/:courseId/enrollment-requests` (student)
- `GET /api/classroom/courses/:courseId/enrollment-requests` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/enrollment-requests/:requestId/approve` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/enrollment-requests/:requestId/reject` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/enrollments` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/enrollments/:enrollmentId/remove` (teacher/assistant)
- `GET /api/classroom/me/enrollments` (student)

## 1.3 Classroom (one per course)

- `GET /api/classroom/courses/:courseId/classroom` (approved members only)
- `GET /api/classroom/courses/:courseId/classroom/members` (approved members)
- `POST /api/classroom/courses/:courseId/classroom/members` (teacher adds assistant)
- `DELETE /api/classroom/courses/:courseId/classroom/members/:memberId` (teacher)

## 1.4 Discussion room

- `POST /api/classroom/courses/:courseId/classroom/discussions` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/discussions` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/discussions/:threadId` (approved members)
- `PATCH /api/classroom/courses/:courseId/classroom/discussions/:threadId` (author or teacher/assistant)
- `DELETE /api/classroom/courses/:courseId/classroom/discussions/:threadId` (author or teacher/assistant)
- `POST /api/classroom/courses/:courseId/classroom/discussions/:threadId/messages` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/discussions/:threadId/messages` (approved members)

## 1.5 Notice room

- `POST /api/classroom/courses/:courseId/classroom/notices` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/notices` (approved members)
- `PATCH /api/classroom/courses/:courseId/classroom/notices/:noticeId` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/classroom/notices/:noticeId/pin` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/classroom/notices/:noticeId/unpin` (teacher/assistant)
- `DELETE /api/classroom/courses/:courseId/classroom/notices/:noticeId` (teacher)

## 1.6 Exam room

- `POST /api/classroom/courses/:courseId/classroom/exams` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/exams` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/exams/:examId` (approved members)
- `PATCH /api/classroom/courses/:courseId/classroom/exams/:examId` (teacher/assistant when `draft`)
- `PATCH /api/classroom/courses/:courseId/classroom/exams/:examId/publish` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/classroom/exams/:examId/close` (teacher/assistant)
- `POST /api/classroom/courses/:courseId/classroom/exams/:examId/submissions` (student, when `published`)
- `GET /api/classroom/courses/:courseId/classroom/exams/:examId/submissions` (teacher/assistant)

## 1.7 Note room

- `POST /api/classroom/courses/:courseId/classroom/notes` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/notes` (approved members)
- `PATCH /api/classroom/courses/:courseId/classroom/notes/:noteId` (teacher/assistant)
- `DELETE /api/classroom/courses/:courseId/classroom/notes/:noteId` (teacher/assistant)

## 1.8 Assignment room

- `POST /api/classroom/courses/:courseId/classroom/assignments` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/assignments` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/assignments/:assignmentId` (approved members)
- `PATCH /api/classroom/courses/:courseId/classroom/assignments/:assignmentId` (teacher/assistant when `draft`)
- `PATCH /api/classroom/courses/:courseId/classroom/assignments/:assignmentId/publish` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/classroom/assignments/:assignmentId/close` (teacher/assistant)
- `POST /api/classroom/courses/:courseId/classroom/assignments/:assignmentId/submissions` (student, when `published`)
- `GET /api/classroom/courses/:courseId/classroom/assignments/:assignmentId/submissions` (teacher/assistant)

## 1.9 Resource/file room

- `POST /api/classroom/courses/:courseId/classroom/resources` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/resources` (approved members)
- `DELETE /api/classroom/courses/:courseId/classroom/resources/:resourceId` (teacher/assistant)

## 1.10 Live video class room (integration)

- `POST /api/classroom/courses/:courseId/classroom/live-sessions` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/live-sessions` (approved members)
- `GET /api/classroom/courses/:courseId/classroom/live-sessions/:sessionId` (approved members)
- `POST /api/classroom/courses/:courseId/classroom/live-sessions/:sessionId/join` (approved members)
- `POST /api/classroom/courses/:courseId/classroom/live-sessions/:sessionId/end` (teacher/assistant)

## 1.11 Attendance tracking

- `POST /api/classroom/courses/:courseId/classroom/attendance/sessions` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/attendance/sessions` (teacher/assistant)
- `POST /api/classroom/courses/:courseId/classroom/attendance/sessions/:sessionId/mark` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/attendance/records` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/attendance/me` (student)

## 1.12 Grades/progress

- `POST /api/classroom/courses/:courseId/classroom/grades/items` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/grades/items` (approved members)
- `POST /api/classroom/courses/:courseId/classroom/grades/items/:gradeItemId/entries` (teacher/assistant)
- `PATCH /api/classroom/courses/:courseId/classroom/grades/entries/:entryId` (teacher/assistant)
- `GET /api/classroom/courses/:courseId/classroom/grades/me` (student)

## 1.13 Notifications

- `GET /api/classroom/notifications` (auth)
- `GET /api/classroom/notifications/unread-count` (auth)
- `PATCH /api/classroom/notifications/:notificationId/read` (auth)
- `PATCH /api/classroom/notifications/read-all` (auth)

---

## 2) Recommended DB tables/entities

Core identity and course:

1. `edu_users`
   - id, name, email, password_hash, role(`teacher|student|assistant`)

2. `courses`
   - id, teacher_id(FK->edu_users), title, code, description, status(`active|archived`), created_at

3. `course_staff`
   - id, course_id, user_id, role(`assistant`), added_by

4. `classrooms`
   - id, course_id(unique), visibility(`private`), created_at

Membership and workflow:

5. `course_enrollment_requests`
   - id, course_id, student_id, status(`pending|approved|rejected|removed`), requested_at, reviewed_by, reviewed_at, review_note

6. `classroom_members`
   - id, classroom_id, user_id, membership_role(`teacher|assistant|student`), source_enrollment_id(nullable), joined_at, removed_at

Content and learning modules:

7. `discussion_threads`
8. `discussion_messages`
9. `notices` (`is_pinned`)
10. `exams` (`status: draft|published|closed`)
11. `exam_submissions`
12. `notes`
13. `assignments` (`status: draft|published|closed`)
14. `assignment_submissions`
15. `resources`
16. `live_class_sessions` (integrates existing room/session system)
17. `attendance_sessions`
18. `attendance_records`
19. `grade_items`
20. `grade_entries`
21. `edu_notifications`

Relationship summary:

- `courses 1:1 classrooms`
- `courses 1:N course_enrollment_requests`
- `approved request -> classroom_members` row
- `classrooms 1:N` for discussions/notices/exams/notes/assignments/resources/live/attendance/grade-items

---

## 3) Access-control rules

## Roles

- Teacher: own course full control (lifecycle, enrollment decisions, all classroom modules)
- Assistant: delegated classroom management (cannot delete course, cannot transfer ownership)
- Student: read course public info, request enrollment, classroom access only after approval

## Authorization matrix

- Course create/update/archive/activate: teacher (assistant update only if added to that course)
- Enrollment approve/reject/remove: teacher/assistant of that course
- Classroom access: only `classroom_members.removed_at IS NULL`
- Discussion post/comment: approved members
- Notice create/pin/unpin: teacher/assistant
- Exam/Assignment publish/close: teacher/assistant
- Grade write operations: teacher/assistant
- Student grade/attendance: self-only

---

## 4) Workflow states and state rules

## Enrollment state transitions

- New request: `pending`
- Teacher/assistant approves: `approved` (also create classroom member)
- Teacher/assistant rejects: `rejected`
- Approved student removed later: `removed` (also set `classroom_members.removed_at`)

Rules:

- Re-apply allowed if latest status is `rejected` or `removed`
- Duplicate pending requests for same course+student disallowed
- Only teacher/assistant can move `pending -> approved/rejected`

## Content status rules

- Notice pin state: `is_pinned = true|false`
- Exam status:
  - `draft`: editable, not visible to students
  - `published`: visible/attemptable by approved students
  - `closed`: no new submissions
- Assignment status mirrors exam status behavior
- Course status:
  - `active`: normal operations
  - `archived`: read-only for students, posting/submission disabled

---

## 5) Pagination, search, sorting recommendations

Paginated endpoints (must):

- Course list, enrollment request list, classroom members, discussions, notices, assignments, exams, resources, notifications, submissions

Use query shape:

- `?page=1&limit=20&sortBy=createdAt&sortOrder=desc`

Searchable endpoints:

- Courses (`q` on title/code)
- Discussions (`q` on title/body)
- Notices (`q` on title/body)
- Resources (`q` on filename/tags)
- Students in enrollment/member lists (`q` on name/email)

Sortable fields examples:

- Courses: `createdAt`, `title`, `code`
- Notices: `isPinned`, `createdAt`
- Assignments/Exams: `status`, `publishAt`, `dueAt`
- Notifications: `createdAt`, `isRead`

---

## 6) Notification triggers

- Enrollment request submitted -> notify teacher + assistants
- Enrollment approved/rejected -> notify requesting student
- New notice posted -> notify all approved students in course
- New assignment published -> notify approved students
- New exam published -> notify approved students
- Live class started -> notify approved students
- Assignment close reminder / exam close reminder (scheduled)

Notification payload recommended fields:

- `type`, `recipientId`, `actorId`, `courseId`, `entityType`, `entityId`, `message`, `isRead`, `createdAt`

---

## 7) Sample request/response JSON (major endpoints)

### Create course

`POST /api/classroom/courses`

```json
{
  "title": "Organic Chemistry 101",
  "code": "CHEM-101",
  "description": "Core organic chemistry for first year",
  "department": "Chemistry"
}
```

Response:

```json
{
  "message": "Course created",
  "course": {
    "id": 41,
    "title": "Organic Chemistry 101",
    "code": "CHEM-101",
    "status": "active",
    "teacherId": 3
  },
  "classroom": {
    "id": 41,
    "courseId": 41,
    "visibility": "private"
  }
}
```

### Enrollment request

`POST /api/classroom/courses/41/enrollment-requests`

```json
{
  "note": "I want to join this course for semester prep"
}
```

Response:

```json
{
  "message": "Enrollment request submitted",
  "request": {
    "id": 901,
    "courseId": 41,
    "studentId": 20,
    "status": "pending"
  }
}
```

### Approve enrollment request

`PATCH /api/classroom/courses/41/enrollment-requests/901/approve`

```json
{
  "reviewNote": "Approved"
}
```

Response:

```json
{
  "message": "Enrollment approved",
  "enrollment": {
    "id": 901,
    "status": "approved",
    "reviewedBy": 3
  },
  "classroomMember": {
    "id": 450,
    "classroomId": 41,
    "userId": 20,
    "membershipRole": "student"
  }
}
```

### Create notice

`POST /api/classroom/courses/41/classroom/notices`

```json
{
  "title": "Midterm Date",
  "body": "Midterm exam will be held on 10 April",
  "isPinned": true
}
```

Response:

```json
{
  "message": "Notice created",
  "notice": {
    "id": 88,
    "courseId": 41,
    "title": "Midterm Date",
    "isPinned": true,
    "createdBy": 3
  }
}
```

### Publish assignment

`PATCH /api/classroom/courses/41/classroom/assignments/72/publish`

```json
{
  "publishAt": "2026-03-20T09:00:00Z",
  "dueAt": "2026-03-27T18:00:00Z"
}
```

Response:

```json
{
  "message": "Assignment published",
  "assignment": {
    "id": 72,
    "status": "published",
    "publishAt": "2026-03-20T09:00:00.000Z",
    "dueAt": "2026-03-27T18:00:00.000Z"
  }
}
```

### Create live session (integration bridge)

`POST /api/classroom/courses/41/classroom/live-sessions`

```json
{
  "title": "Live Problem Solving",
  "scheduledAt": "2026-03-21T12:00:00Z"
}
```

Response:

```json
{
  "message": "Live session created",
  "liveSession": {
    "id": 55,
    "courseId": 41,
    "title": "Live Problem Solving",
    "provider": "internal-webrtc",
    "providerRoomId": "room_lth4v6_p9a0fe12",
    "status": "scheduled"
  }
}
```

---

## 8) Folder structure suggestion (modular)

```txt
src/
  modules/
    eduConnectClassroom/
      index.js
      routes/
        classroom.routes.js
      controllers/
        classroom.controller.js
      services/
        classroom.service.js
      validations/
        classroom.validation.js
      middlewares/
        access.middleware.js
```

Production expansion path:

- Split `classroom.controller.js` into module controllers (`courses`, `enrollments`, `notices`, etc.)
- Split `classroom.service.js` similarly
- Add `repositories/` for SQL access layer
- Add `events/` for async notifications

---

## 9) Middleware recommendations

- `requireAuth` -> validates JWT and injects `req.user`
- `requireAnyRole(...roles)` -> role gate
- `requireCourseManagementRole` -> teacher or assigned assistant of target course
- `requireApprovedClassroomMember` -> verifies approved member access
- `requireCourseActive` -> blocks mutable operations on archived courses
- `validateRequest` -> schema validation for body/query/params

---

## 10) Implementation priority order (MVP -> advanced)

MVP (Phase 1):

1. Course CRUD + course status (`active/archived`)
2. Enrollment workflow (`pending/approved/rejected/removed`)
3. Classroom member access guard (approved only)
4. Notice room + Discussion room
5. Assignment + Exam with draft/published/closed

Phase 2:

6. Resource room + Note room
7. Attendance sessions/records
8. Grade items/entries + student progress view

Phase 3:

9. Live class integration endpoints + lifecycle hooks
10. Notification fan-out + unread management + scheduled reminders

