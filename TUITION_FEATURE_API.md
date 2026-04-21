# Tuition Connect Feature API Documentation

This feature allows teachers to post tuition opportunities and students to connect with them.

## Base URL
`/api/tuition`

## Authentication
All endpoints require a Bearer Token in the `Authorization` header.
Example: `Authorization: Bearer <your_jwt_token>`

---

## 1. Create a Tuition Post (Teacher Only)
Teachers can create a post detailing the tuition offer.

- **URL:** `/posts`
- **Method:** `POST`
- **Body:**
```json
{
  "subject": "Mathematics",
  "location": "Dhanmondi, Dhaka",
  "tuition_fee": "5000 BDT/Month",
  "details": "Class 9-10, 3 days a week. Focus on Calculus."
}
```
- **Response (201):**
```json
{
  "message": "Tuition post created successfully",
  "postId": 12
}
```

---

## 2. Get All Tuition Posts
Fetches all available tuition posts from all teachers.

- **URL:** `/posts`
- **Method:** `GET`
- **Response (200):**
```json
[
  {
    "id": 1,
    "teacher_id": 5,
    "subject": "Chemistry",
    "location": "Gulshan",
    "tuition_fee": "6000 BDT",
    "details": "Organic chemistry focus",
    "created_at": "2024-03-20T10:00:00Z",
    "teacher_name": "John Doe",
    "teacher_institution": "BUET",
    "profile_pic_url": "https://example.com/pic.jpg"
  }
]
```

---

## 3. Request to Connect (Student Only)
Students can express interest in a tuition post.

- **URL:** `/posts/:id/connect`
- **Method:** `POST`
- **Response (201):**
```json
{
  "message": "Connect request sent successfully"
}
```

---

## 4. Get Received Connect Requests (Teacher Only)
Teachers can see who has requested to connect with their posts.

- **URL:** `/requests/received`
- **Method:** `GET`
- **Response (200):**
```json
[
  {
    "id": 1,
    "post_id": 10,
    "student_id": 8,
    "status": "pending",
    "created_at": "2024-03-21T12:00:00Z",
    "student_name": "Jane Smith",
    "student_email": "jane@example.com",
    "student_institution": "Dhaka College",
    "subject": "Physics"
  }
]
```

---

## 5. Get Sent Connect Requests (Student Only)
Students can see the status of their sent requests.

- **URL:** `/requests/sent`
- **Method:** `GET`
- **Response (200):**
```json
[
  {
    "id": 1,
    "post_id": 10,
    "status": "pending",
    "created_at": "2024-03-21T12:00:00Z",
    "subject": "Physics",
    "location": "Mirpur",
    "tuition_fee": "4000 BDT",
    "teacher_name": "John Doe"
  }
]
```

---

## 6. Handle Connect Request (Teacher Only)
Teachers can approve or reject a student's request.
**Note:** If approved, a DM conversation is automatically created between the teacher and the student.

- **URL:** `/requests/:id`
- **Method:** `PATCH`
- **Body:**
```json
{
  "status": "approved" 
}
```
*(Status can be "approved" or "rejected")*

- **Response (200):**
```json
{
  "message": "Request approved successfully"
}
```

---

## Messaging
Once a request is **approved**, the student and teacher can message each other using the existing DM/Messaging API. The backend ensures a conversation exists upon approval.
