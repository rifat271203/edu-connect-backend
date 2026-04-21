# API Documentation

Base URL: `https://your-api-domain.com/api`

## Authentication Endpoints

### POST /auth/teachers/register
Register a new teacher account.

**Request Body:**
```json
{
  "name": "string (max 120 chars)",
  "email": "string (max 190 chars)",
  "password": "string (8-128 chars)",
  "department": "string (optional, max 120 chars)",
  "institution": "string (optional, max 160 chars)"
}
```

**Response (201):**
```json
{
  "message": "teacher registered successfully",
  "token": "jwt_token_string",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "teacher",
    "department": "Computer Science",
    "institution": "University of Example",
    "profile_pic_url": null,
    "is_profile_public": 0,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### POST /auth/students/register
Register a new student account.

**Request Body:**
```json
{
  "name": "string (max 120 chars)",
  "email": "string (max 190 chars)",
  "password": "string (8-128 chars)",
  "department": "string (optional, max 120 chars)",
  "institution": "string (optional, max 160 chars)"
}
```

**Response (201):**
```json
{
  "message": "student registered successfully",
  "token": "jwt_token_string",
  "user": {
    "id": 1,
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "student",
    "department": "Computer Science",
    "institution": "University of Example",
    "profile_pic_url": null,
    "is_profile_public": 0,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### POST /auth/teachers/login
Login as teacher.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "message": "teacher login successful",
  "token": "jwt_token_string",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "teacher",
    "department": "Computer Science",
    "institution": "University of Example",
    "profile_pic_url": null,
    "is_profile_public": 0
  }
}
```

---

### POST /auth/students/login
Login as student.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "message": "student login successful",
  "token": "jwt_token_string",
  "user": {
    "id": 1,
    "name": "Jane Doe",
    "email": "jane@example.com",
    "role": "student",
    "department": "Computer Science",
    "institution": "University of Example",
    "profile_pic_url": null,
    "is_profile_public": 0
  }
}
```

---

### GET /auth/me
Get current user profile. Requires authentication.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "teacher",
    "department": "Computer Science",
    "institution": "University of Example",
    "profile_pic_url": null,
    "is_profile_public": 0,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### PATCH /auth/password
Update password. Requires authentication.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "currentPassword": "string",
  "newPassword": "string (8-128 chars)"
}
```

**Response (200):**
```json
{
  "message": "Password updated successfully"
}
```

---

## Classroom Endpoints

Base URL: `/api/classroom`

### GET /courses
List all available courses.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `page` (optional): page number
- `limit` (optional): items per page

**Response (200):**
```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "id": 1,
        "title": "Introduction to Computer Science",
        "code": "CS101",
        "description": "Basic concepts of programming",
        "status": "active",
        "teacher": {
          "id": 1,
          "name": "John Doe"
        },
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 10,
      "totalPages": 1
    }
  },
  "message": "Courses fetched"
}
```

---

### GET /courses/:courseId
Get course details.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "course": {
      "id": 1,
      "title": "Introduction to Computer Science",
      "code": "CS101",
      "description": "Basic concepts of programming",
      "status": "active",
      "teacher": {
        "id": 1,
        "name": "John Doe"
      },
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Course fetched"
}
```

---

### POST /courses
Create a new course. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "code": "string (required)",
  "description": "string (optional)",
  "status": "active" | "draft"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "course": {
      "id": 1,
      "title": "Introduction to Computer Science",
      "code": "CS101",
      "description": "Basic concepts of programming",
      "status": "active",
      "teacher": {
        "id": 1,
        "name": "John Doe"
      },
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Course created"
}
```

---

### PATCH /courses/:courseId
Update course. Requires teacher/assistant role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (optional)",
  "code": "string (optional)",
  "description": "string (optional)",
  "status": "active" | "draft" | "archived" (optional)
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "course": {
      "id": 1,
      "title": "Introduction to Computer Science",
      "code": "CS101",
      "description": "Basic concepts of programming",
      "status": "active"
    }
  },
  "message": "Course updated"
}
```

---

### POST /courses/:courseId/enrollment-requests
Submit enrollment request. Requires student role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "message": "string (optional)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "request": {
      "id": 1,
      "courseId": 1,
      "studentId": 2,
      "message": "I'd like to join this course",
      "status": "pending",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": " enrollment request submitted"
}
```

---

### GET /courses/:courseId/enrollment-requests
List enrollment requests. Requires teacher/assistant role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "id": 1,
        "courseId": 1,
        "student": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "message": "I'd like to join",
        "status": "pending",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  },
  "message": "Enrollment requests fetched"
}
```

---

### PATCH /courses/:courseId/enrollment-requests/:requestId/approve
Approve enrollment request. Requires teacher/assistant role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "request": {
      "id": 1,
      "status": "approved"
    }
  },
  "message": "Enrollment request approved"
}
```

---

### PATCH /courses/:courseId/enrollment-requests/:requestId/reject
Reject enrollment request. Requires teacher/assistant role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "request": {
      "id": 1,
      "status": "rejected"
    }
  },
  "message": "Enrollment request rejected"
}
```

---

### GET /me/enrollments
List current user's enrollments. Requires student role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "enrollments": [
      {
        "course": {
          "id": 1,
          "title": "Introduction to Computer Science",
          "code": "CS101"
        },
        "status": "active",
        "enrolledAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  },
  "message": "Enrollments fetched"
}
```

---

## Classroom Room Features

Base URL: `/api/classroom/courses/:courseId/classroom`

### GET /classroom
Get classroom details.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "classroom": {
      "courseId": 1,
      "isActive": true,
      "memberCount": 25,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Classroom fetched"
}
```

---

### GET /classroom/members
List classroom members.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": 1,
        "user": {
          "id": 1,
          "name": "John Doe",
          "email": "john@example.com",
          "profilePicUrl": null
        },
        "role": "teacher",
        "status": "active",
        "joinedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 25,
      "totalPages": 2
    }
  },
  "message": "Members fetched"
}
```

---

### POST /classroom/members
Add assistant to classroom. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "email": "string (required)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "member": {
      "id": 2,
      "userId": 3,
      "role": "assistant"
    }
  },
  "message": "Assistant added"
}
```

---

### DELETE /classroom/members/:memberId
Remove classroom member. Requires teacher/assistant role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "memberId": 2
  },
  "message": "Member removed"
}
```

---

## Messages Endpoints

Base URL: `/api/classroom/courses/:courseId/messages`

### GET /messages
Get chat messages.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `cursor` (optional): pagination cursor
- `limit` (optional): max items (1-50)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": 1,
        "courseId": 1,
        "sender": {
          "id": 1,
          "name": "John Doe",
          "profilePicUrl": null
        },
        "content": "Hello class!",
        "fileUrl": null,
        "fileType": null,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "isDeleted": false
      }
    ],
    "cursor": null,
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 100,
      "totalPages": 2
    }
  },
  "message": "Message history fetched"
}
```

---

### POST /messages
Send a message. Requires classroom member.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Content-Type:** `multipart/form-data`

**Request Body:**
- `content` (optional): text string
- `file` (optional): file upload (max 50MB)

**Response (201):**
```json
{
  "success": true,
  "data": {
    "message": {
      "id": 1,
      "courseId": 1,
      "sender": {
        "id": 1,
        "name": "John Doe",
        "profilePicUrl": null
      },
      "content": "Hello class!",
      "fileUrl": "https://...",
      "fileType": "image/jpeg",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "isDeleted": false
    }
  },
  "message": "Message sent"
}
```

---

### DELETE /messages/:messageId
Delete a message. Requires message owner or teacher.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messageId": 1,
    "courseId": 1
  },
  "message": "Message deleted"
}
```

---

## Notices Endpoints

Base URL: `/api/classroom/courses/:courseId/notices`

### GET /notices
Get notices.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `page` (optional): page number
- `limit` (optional): items per page (1-100)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notices": [
      {
        "id": 1,
        "courseId": 1,
        "author": {
          "id": 1,
          "name": "John Doe",
          "profilePicUrl": null
        },
        "title": "Exam Notice",
        "body": "There will be an exam next week",
        "priority": "medium",
        "pinned": true,
        "attachmentUrl": null,
        "acknowledgements": 15,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  },
  "message": "Notices fetched"
}
```

---

### POST /notices
Create a notice. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Content-Type:** `multipart/form-data`

**Request Body:**
- `title` (required): string
- `body` (required): string
- `priority` (optional): "low" | "medium" | "high" | "urgent"
- `pinned` (optional): boolean
- `attachment` (optional): file upload (max 25MB)

**Response (201):**
```json
{
  "success": true,
  "data": {
    "notice": {
      "id": 1,
      "courseId": 1,
      "author": 1,
      "title": "Exam Notice",
      "body": "There will be an exam next week",
      "priority": "medium",
      "pinned": false,
      "attachmentUrl": null,
      "acknowledgements": [],
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Notice created"
}
```

---

### PUT /notices/:noticeId
Update a notice. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (optional)",
  "body": "string (optional)",
  "priority": "low|medium|high|urgent (optional)",
  "pinned": boolean (optional),
  "attachmentUrl": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notice": {
      "id": 1,
      "title": "Updated Title",
      "body": "Updated body",
      "priority": "high",
      "pinned": true
    }
  },
  "message": "Notice updated"
}
```

---

### DELETE /notices/:noticeId
Delete a notice. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "noticeId": 1
  },
  "message": "Notice deleted"
}
```

---

### POST /notices/:noticeId/acknowledge
Acknowledge a notice. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "noticeId": 1,
    "userId": 2
  },
  "message": "Notice acknowledged"
}
```

---

### GET /notices/:noticeId/acknowledgements
Get notice acknowledgements. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "acknowledgements": [
      {
        "noticeId": 1,
        "user": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com",
          "profilePicUrl": null
        },
        "acknowledgedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 15,
      "totalPages": 1
    }
  },
  "message": "Acknowledgements fetched"
}
```

---

## Notes Endpoints

Base URL: `/api/classroom/courses/:courseId/notes`

### GET /notes/shared
Get shared notes. Requires classroom member.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notes": [
      {
        "id": 1,
        "courseId": 1,
        "uploadedBy": {
          "id": 1,
          "name": "John Doe",
          "profilePicUrl": null
        },
        "title": "Lecture 1 Notes",
        "description": "Introduction to algorithms",
        "fileUrl": "https://...",
        "fileType": "application/pdf",
        "category": "pdf",
        "downloadCount": 20,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 10,
      "totalPages": 1
    }
  },
  "message": "Shared notes fetched"
}
```

---

### POST /notes/shared
Upload shared note. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Content-Type:** `multipart/form-data`

**Request Body:**
- `title` (required): string
- `description` (optional): string
- `category` (required): "pdf" | "video" | "link" | "doc"
- `file` (optional): file upload
- `fileUrl` (optional): string (if not uploading)

**Response (201):**
```json
{
  "success": true,
  "data": {
    "note": {
      "id": 1,
      "courseId": 1,
      "uploadedBy": 1,
      "title": "Lecture 1 Notes",
      "description": "Introduction to algorithms",
      "fileUrl": "https://...",
      "fileType": "application/pdf",
      "category": "pdf",
      "downloadCount": 0,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Shared note uploaded"
}
```

---

### DELETE /notes/shared/:noteId
Delete shared note. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "noteId": 1
  },
  "message": "Shared note deleted"
}
```

---

### GET /notes/personal
Get personal notes. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "notes": [
      {
        "id": 1,
        "courseId": 1,
        "student": 2,
        "title": "My Notes",
        "content": "These are my notes...",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  },
  "message": "Personal notes fetched"
}
```

---

### POST /notes/personal
Create personal note. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "content": "string (required)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "note": {
      "id": 1,
      "courseId": 1,
      "student": 2,
      "title": "My Notes",
      "content": "These are my notes...",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Personal note created"
}
```

---

### PUT /notes/personal/:noteId
Update personal note. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (optional)",
  "content": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "note": {
      "id": 1,
      "title": "Updated Title",
      "content": "Updated content"
    }
  },
  "message": "Personal note updated"
}
```

---

### DELETE /notes/personal/:noteId
Delete personal note. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "noteId": 1
  },
  "message": "Personal note deleted"
}
```

---

## Exams Endpoints

Base URL: `/api/classroom/courses/:courseId/exams`

### GET /exams
List exams. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "exams": [
      {
        "id": 1,
        "courseId": 1,
        "title": "Midterm Exam",
        "instructions": "Bring your calculator",
        "duration": 60,
        "startTime": "2024-03-01T10:00:00.000Z",
        "endTime": "2024-03-01T12:00:00.000Z",
        "totalMarks": 100,
        "status": "upcoming",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  },
  "message": "Exams fetched"
}
```

---

### POST /exams
Create an exam. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "instructions": "string (optional)",
  "duration": "integer (minutes, required)",
  "startTime": "ISO8601 datetime (required)",
  "endTime": "ISO8601 datetime (required)",
  "totalMarks": "number (required)",
  "questions": [
    {
      "questionText": "string",
      "type": "MCQ" | "short" | "long",
      "options": ["option1", "option2"],
      "correctAnswer": "string",
      "marks": 10
    }
  ]
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "exam": {
      "id": 1,
      "courseId": 1,
      "title": "Midterm Exam",
      "instructions": "Bring your calculator",
      "duration": 60,
      "startTime": "2024-03-01T10:00:00.000Z",
      "endTime": "2024-03-01T12:00:00.000Z",
      "totalMarks": 100,
      "questions": [...],
      "createdBy": 1,
      "status": "published",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Exam created"
}
```

---

### PUT /exams/:examId
Update an exam. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** Same as POST but fields are optional.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "exam": {
      "id": 1,
      "title": "Updated Title"
    }
  },
  "message": "Exam updated"
}
```

---

### DELETE /exams/:examId
Delete an exam. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "examId": 1
  },
  "message": "Exam deleted"
}
```

---

### GET /exams/:examId/submissions
Get exam submissions. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "submissions": [
      {
        "id": 1,
        "examId": 1,
        "student": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "answers": [...],
        "score": 85,
        "totalMarks": 100,
        "startedAt": "2024-03-01T10:05:00.000Z",
        "submittedAt": "2024-03-01T11:00:00.000Z",
        "isGraded": true
      }
    ],
    "pagination": {...}
  },
  "message": "Exam submissions fetched"
}
```

---

### POST /exams/:examId/grade/:submissionId
Grade exam submission. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "answers": [
    {
      "questionId": 1,
      "awardedMarks": 10
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "submissionId": 1,
    "examId": 1,
    "score": 85,
    "totalMarks": 100
  },
  "message": "Submission graded"
}
```

---

### GET /exams/:examId/start
Start an exam. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "exam": {
      "id": 1,
      "courseId": 1,
      "title": "Midterm Exam",
      "instructions": "Bring your calculator",
      "duration": 60,
      "startTime": "2024-03-01T10:00:00.000Z",
      "endTime": "2024-03-01T12:00:00.000Z",
      "totalMarks": 100,
      "questions": [
        {
          "id": 1,
          "questionText": "What is 2+2?",
          "type": "MCQ",
          "options": ["2", "3", "4", "5"],
          "marks": 10
        }
      ]
    }
  },
  "message": "Exam started"
}
```

---

### POST /exams/:examId/submit
Submit exam. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "answers": [
    {
      "questionId": 1,
      "answer": "4"
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "examId": 1,
    "student": 2,
    "score": 100,
    "totalMarks": 100,
    "isGraded": true
  },
  "message": "Exam submitted"
}
```

---

### GET /exams/:examId/result
Get exam result. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "result": {
      "submissionId": 1,
      "examId": 1,
      "student": 2,
      "answers": [...],
      "score": 100,
      "totalMarks": 100,
      "startedAt": "2024-03-01T10:05:00.000Z",
      "submittedAt": "2024-03-01T11:00:00.000Z",
      "isGraded": true
    }
  },
  "message": "Exam result fetched"
}
```

---

## Assignments Endpoints

Base URL: `/api/classroom/courses/:courseId/assignments`

### GET /assignments
List assignments. Requires classroom member.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "assignments": [
      {
        "id": 1,
        "courseId": 1,
        "title": "Homework 1",
        "description": "Complete exercises 1-10",
        "dueDate": "2024-03-15T23:59:59.000Z",
        "totalMarks": 50,
        "attachmentUrl": null,
        "allowLateSubmission": true,
        "createdBy": {
          "id": 1,
          "name": "John Doe"
        },
        "submissionStatus": {
          "totalSubmissions": 20
        } // for teacher
        // or { "submitted": true } for student
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {...}
  },
  "message": "Assignments fetched"
}
```

---

### POST /assignments
Create assignment. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "description": "string (optional)",
  "dueDate": "ISO8601 datetime (required)",
  "totalMarks": "number (required)",
  "attachmentUrl": "string (optional)",
  "allowLateSubmission": boolean (optional)
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "assignment": {
      "id": 1,
      "courseId": 1,
      "title": "Homework 1",
      "dueDate": "2024-03-15T23:59:59.000Z",
      "totalMarks": 50,
      "allowLateSubmission": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  },
  "message": "Assignment created"
}
```

---

### GET /assignments/:assignmentId
Get assignment details. Requires classroom member.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "assignment": {
      "id": 1,
      "title": "Homework 1",
      "description": "Complete exercises 1-10",
      "dueDate": "2024-03-15T23:59:59.000Z",
      "totalMarks": 50,
      "createdBy": {...},
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    "mySubmission": {
      "id": 1,
      "assignmentId": 1,
      "student": 2,
      "fileUrl": "https://...",
      "comment": "My work",
      "submittedAt": "2024-03-10T12:00:00.000Z",
      "isLate": false,
      "score": 45,
      "feedback": "Good work!",
      "gradedAt": "2024-03-16T10:00:00.000Z"
    }
  },
  "message": "Assignment details fetched"
}
```

---

### PUT /assignments/:assignmentId
Update assignment. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** Same fields as POST, all optional.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "assignment": {...}
  },
  "message": "Assignment updated"
}
```

---

### POST /assignments/:assignmentId/submit
Submit assignment. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Content-Type:** `multipart/form-data`

**Request Body:**
- `file` (required): file upload OR
- `fileUrl` (required): string URL to file
- `comment` (optional): string

**Response (201):**
```json
{
  "success": true,
  "data": {
    "submission": {
      "id": 1,
      "assignmentId": 1,
      "student": 2,
      "fileUrl": "https://...",
      "comment": "My work",
      "submittedAt": "2024-03-10T12:00:00.000Z",
      "isLate": false,
      "score": null,
      "feedback": null,
      "gradedAt": null
    }
  },
  "message": "Assignment submitted"
}
```

---

### GET /assignments/:assignmentId/submissions
Get assignment submissions. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "submissions": [
      {
        "id": 1,
        "assignmentId": 1,
        "student": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "fileUrl": "https://...",
        "comment": "My work",
        "submittedAt": "2024-03-10T12:00:00.000Z",
        "isLate": false,
        "score": 45,
        "feedback": "Good work!",
        "gradedAt": "2024-03-16T10:00:00.000Z"
      }
    ],
    "pagination": {...}
  },
  "message": "Assignment submissions fetched"
}
```

---

### PUT /assignments/:assignmentId/grade/:submissionId
Grade assignment submission. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "score": 45,
  "feedback": "Good work!"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "submission": {
      "id": 1,
      "score": 45,
      "feedback": "Good work!",
      "gradedAt": "2024-03-16T10:00:00.000Z"
    }
  },
  "message": "Submission graded"
}
```

---

## Schedule Endpoints

Base URL: `/api/classroom/courses/:courseId/schedule`

### GET /schedule
Get schedule sessions.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": 1,
        "courseId": 1,
        "title": "Lecture 1",
        "description": "Introduction",
        "type": "lecture",
        "startDateTime": "2024-01-15T10:00:00.000Z",
        "endDateTime": "2024-01-15T11:00:00.000Z",
        "meetingLink": "https://...",
        "location": "Room 101",
        "status": "scheduled",
        "isRecurring": false,
        "recurrenceRule": null,
        "createdBy": 1,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {...}
  },
  "message": "Schedule fetched"
}
```

---

### GET /schedule/upcoming
Get upcoming sessions (next 7 days).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessions": [...],
    "pagination": {...}
  },
  "message": "Upcoming sessions fetched"
}
```

---

### GET /schedule/calendar
Get calendar view for a month.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `month` (required): 1-12
- `year` (required): number

**Response (200):**
```json
{
  "success": true,
  "data": {
    "month": 1,
    "year": 2024,
    "key": "2024-01",
    "calendar": {
      "2024-01-15": [
        {
          "id": 1,
          "title": "Lecture 1",
          "type": "lecture",
          "startDateTime": "2024-01-15T10:00:00.000Z",
          "endDateTime": "2024-01-15T11:00:00.000Z"
        }
      ]
    },
    "pagination": {...}
  },
  "message": "Calendar schedule fetched"
}
```

---

### POST /schedule
Create schedule session. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "description": "string (optional)",
  "type": "lecture|lab|tutorial|exam|holiday (required)",
  "startDateTime": "ISO8601 datetime (required)",
  "endDateTime": "ISO8601 datetime (required)",
  "meetingLink": "string (optional)",
  "location": "string (optional)",
  "isRecurring": boolean (optional),
  "recurrenceRule": "string (optional)"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "session": {...}
  },
  "message": "Session created"
}
```

---

### PUT /schedule/:sessionId
Update schedule session. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:** Same fields as POST, all optional.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "session": {...}
  },
  "message": "Session updated"
}
```

---

### DELETE /schedule/:sessionId
Cancel schedule session. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessionId": 1,
    "status": "cancelled"
  },
  "message": "Session cancelled"
}
```

---

## Progress & Attendance Endpoints

Base URL: `/api/classroom/courses/:courseId/progress`

### GET /progress/me
Get current student's progress. Requires enrolled student.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "studentId": 2,
    "courseId": 1,
    "progress": {
      "examScores": {
        "obtained": 85,
        "total": 100,
        "percentage": 85
      },
      "assignmentGrades": {
        "obtained": 45,
        "total": 50,
        "percentage": 90
      },
      "attendance": {
        "presentOrLate": 10,
        "totalSessions": 12,
        "percentage": 83.33
      }
    }
  },
  "message": "Progress fetched"
}
```

---

### GET /progress/students
Get all students' progress. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "student": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com",
          "profilePicUrl": null
        },
        "progress": {...}
      }
    ],
    "pagination": {...}
  },
  "message": "Students progress summary fetched"
}
```

---

### GET /progress/students/:studentId
Get specific student's progress. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "student": {...},
    "progress": {...}
  },
  "message": "Student progress fetched"
}
```

---

### POST /progress/attendance
Mark attendance. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "sessionId": 1,
  "attendances": [
    {
      "student": 2,
      "status": "present" | "absent" | "late"
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sessionId": 1,
    "attendances": [
      {
        "id": 1,
        "courseId": 1,
        "sessionId": 1,
        "student": {
          "id": 2,
          "name": "Jane Doe"
        },
        "status": "present",
        "markedBy": 1,
        "markedAt": "2024-01-15T11:00:00.000Z"
      }
    ]
  },
  "message": "Attendance marked"
}
```

---

### GET /progress/attendance
Get attendance records. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "attendanceRecords": [
      {
        "id": 1,
        "courseId": 1,
        "session": {
          "id": 1,
          "title": "Lecture 1"
        },
        "student": {
          "id": 2,
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "status": "present",
        "markedBy": {
          "id": 1,
          "name": "John Doe"
        },
        "markedAt": "2024-01-15T11:00:00.000Z"
      }
    ],
    "pagination": {...}
  },
  "message": "Attendance records fetched"
}
```

---

## Meeting (Live Session) Endpoints

Base URL: `/api/meetings`

### POST /meetings/create
Create a live meeting. Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (optional, max 255 chars)"
}
```

**Response (201):**
```json
{
  "roomId": "room_xxxxx_xxxxxx",
  "meetingId": 1
}
```

---

### GET /meetings/:roomId
Get meeting details.

**Response (200):**
```json
{
  "id": 1,
  "roomId": "room_xxxxx_xxxxxx",
  "title": "Live Session",
  "hostUserId": 1,
  "hostName": "John Doe",
  "hostRole": "teacher",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

## Social/Feed Endpoints

Base URL: `/api/social`

### GET /feed
Get social feed.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `page` (optional): page number
- `limit` (optional): items per page

**Response (200):**
```json
{
  "success": true,
  "data": {
    "posts": [...],
    "pagination": {...}
  },
  "message": "Feed fetched"
}
```

---

### POST /posts
Create a post.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Content-Type:** `multipart/form-data`

**Request Body:**
- `content` (required): text string
- `media` (optional): file upload

**Response (201):**
```json
{
  "success": true,
  "data": {
    "post": {...}
  },
  "message": "Post created"
}
```

---

### GET /notifications
Get notifications.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {...},
  "message": "Notifications fetched"
}
```

---

### GET /notifications/unread-count
Get unread notification count.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": { "count": 5 },
  "message": "Unread count fetched"
}
```

---

### PATCH /notifications/:notificationId/read
Mark notification as read.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": { "notificationId": 1 },
  "message": "Notification marked read"
}
```

---

### PATCH /notifications/read-all
Mark all notifications as read.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {},
  "message": "All notifications marked read"
}
```

---

## Live Session (WebRTC) Endpoints

Base URL: `/api/v1/sessions`

### POST /sessions
Create a new live session (classroom). Requires teacher role.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "title": "string (required)",
  "scheduledAt": "ISO8601 datetime (optional)"
}
```

**Response (201):**
```json
{
  "roomId": "random_room_id",
  "joinUrl": "https://edu-connect-frontend-three.vercel.app/classroom/random_room_id",
  "title": "Math 101"
}
```

---

### GET /sessions/:roomId
Get session details.

**Response (200):**
```json
{
  "roomId": "random_room_id",
  "title": "Math 101",
  "status": "waiting",
  "participantCount": 0,
  "isRecording": false
}
```

---

### POST /sessions/:roomId/end
End a session. Requires teacher role (session owner only).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response (200):**
```json
{
  "success": true
}
```

---

### GET /sessions/:roomId/chat
Get chat history.

**Response (200):**
```json
{
  "messages": [
    {
      "id": "msg_1",
      "senderId": "2",
      "senderName": "Jane",
      "message": "Hello!",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## WebSocket Events (Real-time)

### Connection
Connect to WebSocket server with JWT token in query parameter:
```
 socket.connect()?token=<jwt_token>
```

### Client → Server Events:

- `join-room`: `{ roomId: string, role: 'teacher' | 'student' }`
- `offer`: `{ to: string, sdp: RTCSessionDescription }`
- `answer`: `{ to: string, sdp: RTCSessionDescription }`
- `ice-candidate`: `{ to: string, candidate: RTCIceCandidate }`
- `hand-raise`: `{ raised: boolean }`
- `send-chat`: `{ message: string }`
- `admit-student`: `{ socketId: string }`
- `mute-participant`: `{ targetId: string }`
- `leave-room`: `{}`
- `end-session`: `{ roomId: string }`
- `get-rtp-capabilities`: `{ roomId: string }` (callback)
- `create-transport`: `{ roomId: string }` (callback)
- `connect-transport`: `{ roomId: string, transportId: string, dtlsParameters: object }` (callback)
- `produce`: `{ roomId: string, transportId: string, kind: 'audio' | 'video', rtpParameters: object }` (callback)
- `consume`: `{ roomId: string, transportId: string, producerId: string, rtpCapabilities: object }` (callback)

### Server → Client Events:

- `peer-joined`: `{ socketId: string, name: string, role: string }`
- `participant-list`: `{ participants: Participant[] }`
- `offer`: `{ from: string, sdp: RTCSessionDescription }`
- `answer`: `{ from: string, sdp: RTCSessionDescription }`
- `ice-candidate`: `{ from: string, candidate: RTCIceCandidate }`
- `hand-raised`: `{ socketId: string, name: string, raised: boolean }`
- `chat-message`: `{ senderId: string, senderName: string, message: string, timestamp: string }`
- `force-mute`: `()`
- `admitted`: `()`
- `session-ended`: `()`
- `error`: `{ code: string, message: string }`

---

## Error Response Format

All errors follow this format:
```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

Common HTTP status codes:
- `400`: Bad Request - Invalid input
- `401`: Unauthorized - Authentication required
- `403`: Forbidden - Insufficient permissions
- `404`: Not Found
- `409`: Conflict
- `500`: Internal Server Error