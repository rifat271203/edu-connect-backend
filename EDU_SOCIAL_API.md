# Edu Social Media API Endpoints

Base URL (local): `http://localhost:3001`

All protected endpoints require:

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

Exception:
- `POST /api/social/upload-media` must use `Content-Type: multipart/form-data`

---

## 1) Dedicated Teacher/Student Auth Endpoints

### 1.1 Teacher Register
**POST** `/api/auth/teachers/register`

Request body:
```json
{
  "name": "Ayesha Rahman",
  "email": "ayesha.teacher@school.edu",
  "password": "TeacherPass@123",
  "department": "Chemistry",
  "institution": "Dhaka College"
}
```

### 1.2 Student Register
**POST** `/api/auth/students/register`

Request body:
```json
{
  "name": "Rahim Uddin",
  "email": "rahim.student@school.edu",
  "password": "StudentPass@123",
  "department": "Science",
  "institution": "Dhaka College"
}
```

### 1.3 Teacher Login
**POST** `/api/auth/teachers/login`

Request body:
```json
{
  "email": "ayesha.teacher@school.edu",
  "password": "TeacherPass@123"
}
```

### 1.4 Student Login
**POST** `/api/auth/students/login`

Request body:
```json
{
  "email": "rahim.student@school.edu",
  "password": "StudentPass@123"
}
```

### 1.5 Current Logged-in User
**GET** `/api/auth/me`

No request body.

Response user now also includes:
- `profile_pic_url`

---

## 2) Social Post Endpoints

### 2.0 Upload Image/Video (for frontend)
**POST** `/api/social/upload-media`

Headers:
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: multipart/form-data
```

Body (`form-data`):
- `media` (required, file)

Allowed file types:
- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Videos: `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`

Max file size:
- `50 MB`

Success response example:
```json
{
  "message": "Media uploaded",
  "mediaUrl": "http://localhost:3001/uploads/social/1740594600000-123456789.mp4",
  "mediaType": "video",
  "mimeType": "video/mp4",
  "size": 1849223
}
```

Use returned `mediaUrl` in create/update post endpoints.

### 2.1 Create Post
**POST** `/api/social/posts`

Request body:
```json
{
  "content": "আজকের organic chemistry class notes দিলাম।",
  "mediaUrl": "http://localhost:3001/uploads/social/1740594600000-123456789.jpg",
  "privacy": "public"
}
```

### 2.2 Get Feed Posts
**GET** `/api/social/posts?limit=20&offset=0`

No request body.

Avatar contract in feed post object:
- `author_profile_pic_url`

### 2.3 Get Single Post Details (with likes/comments)
**GET** `/api/social/posts/:postId`

No request body.

Avatar contract in this payload:
- `post.author_profile_pic_url`
- `comments[].author_profile_pic_url`
- `likes[].profile_pic_url`

### 2.4 Update Own Post
**PATCH** `/api/social/posts/:postId`

Request body (any one or multiple fields):
```json
{
  "content": "Updated post content",
  "mediaUrl": "http://localhost:3001/uploads/social/1740594600000-123456789.mp4",
  "privacy": "friends"
}
```

### 2.5 Delete Own Post
**DELETE** `/api/social/posts/:postId`

No request body.

---

## 3) Like Endpoints

### 3.1 Like a Post
**POST** `/api/social/posts/:postId/likes`

No request body.

### 3.2 Remove Like from a Post
**DELETE** `/api/social/posts/:postId/likes`

No request body.

---

## 4) Comment Endpoints

### 4.1 Add Comment on Post
**POST** `/api/social/posts/:postId/comments`

Request body:
```json
{
  "commentText": "ধন্যবাদ স্যার, এটা খুব helpful ছিল।",
  "parentCommentId": null
}
```

For reply comment:
```json
{
  "commentText": "I agree with this point.",
  "parentCommentId": 12
}
```

### 4.2 Delete Own Comment
**DELETE** `/api/social/comments/:commentId`

No request body.

---

## 5) Share Endpoints

### 5.1 Share a Post
**POST** `/api/social/posts/:postId/shares`

Request body:
```json
{
  "caption": "সবাই দেখো, এই post টা খুব important."
}
```

### 5.2 Get All Shares
**GET** `/api/social/shares`

No request body.

Avatar contract in share payload:
- `shared_by_profile_pic_url`
- `original_author_profile_pic_url`

---

## 6) Friend Request Endpoints

### 6.1 Send Friend Request
**POST** `/api/social/friend-requests`

Request body:
```json
{
  "receiverId": 7
}
```

### 6.2 Get Incoming/Outgoing Friend Requests
**GET** `/api/social/friend-requests`

No request body.

Avatar contract:
- incoming: `sender_profile_pic_url`
- outgoing: `receiver_profile_pic_url`

### 6.3 Respond to Friend Request (accept/reject)
**PATCH** `/api/social/friend-requests/:requestId/respond`

Request body:
```json
{
  "action": "accepted"
}
```

or

```json
{
  "action": "rejected"
}
```

### 6.4 Cancel Pending Friend Request
**DELETE** `/api/social/friend-requests/:requestId`

No request body.

---

## 7) Friends Endpoints

### 7.1 Get Friend List
**GET** `/api/social/friends`

No request body.

Avatar contract in friend object:
- `profile_pic_url`

### 7.2 Unfriend / Remove Friend
**DELETE** `/api/social/friends/:friendId`

No request body.

---

## 8) Search Endpoints

### 8.1 Search Users and Posts
**GET** `/api/social/search?q=chemistry&role=teacher&limit=20`

Query params:
- `q` (required)
- `role` (optional: `teacher` or `student`)
- `limit` (optional)

No request body.

Avatar contract:
- `users[].profile_pic_url`
- `posts[].author_profile_pic_url`

---

## Notes

- New tables are auto-created on first call through the API routes.
- Dedicated auth for teacher/student is separated via different endpoints.
- Social module supports post create/read/update/delete, likes, comments, shares, friend requests, friendships, and search.

---

## 9) Notification Endpoints

Notifications are auto-created when users perform these actions:
- Like post: `POST /api/social/posts/:postId/likes`
- Comment on post: `POST /api/social/posts/:postId/comments`
- Share post: `POST /api/social/posts/:postId/shares`
- Send friend request: `POST /api/social/friend-requests`

### 9.1 Get Notifications (for logged-in user)
**GET** `/api/social/notifications?limit=20&offset=0`

No request body.

### 9.2 Get Unread Notification Count
**GET** `/api/social/notifications/unread-count`

No request body.

### 9.3 Mark Single Notification as Read
**PATCH** `/api/social/notifications/:notificationId/read`

Request body:
```json
{
  "isRead": true
}
```

### 9.4 Mark All Notifications as Read
**PATCH** `/api/social/notifications/read-all`

Request body:
```json
{
  "isRead": true
}
```

Sample notification object:
```json
{
  "id": 101,
  "recipient_id": 7,
  "actor_id": 3,
  "type": "comment",
  "entity_type": "post",
  "entity_id": 22,
  "message": "Ayesha Rahman commented on your post",
  "is_read": 0,
  "created_at": "2026-02-26T19:50:00.000Z",
  "actor_name": "Ayesha Rahman",
  "actor_role": "teacher"
}
```

---

## 10) Own Profile & Activity Endpoints (Facebook-style own profile)

### 10.1 Upload/Update Own Profile Picture
**POST** `/api/social/me/profile-pic`

Headers:
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: multipart/form-data
```

Body (`form-data`):
- `profilePic` (required, file)

Allowed file types:
- `image/jpeg`, `image/png`, `image/webp`, `image/gif`

Max size:
- `10 MB`

Success response example:
```json
{
  "message": "Profile picture updated",
  "profilePicUrl": "http://localhost:3001/uploads/profiles/1740594600000-987654321.jpg",
  "user": {
    "id": 3,
    "name": "Ayesha Rahman",
    "email": "ayesha.teacher@school.edu",
    "role": "teacher",
    "department": "Chemistry",
    "institution": "Dhaka College",
    "profile_pic_url": "http://localhost:3001/uploads/profiles/1740594600000-987654321.jpg",
    "created_at": "2026-02-20T10:20:00.000Z"
  }
}
```

### 10.2 Get Own Profile (with summary stats)
**GET** `/api/social/me/profile`

No request body.

Response includes:
- `profile`: logged-in user info
- `stats`: `postCount`, `shareCount`, `likeGivenCount`, `commentCount`, `friendCount`

### 10.3 Get Own Activity Feed
**GET** `/api/social/me/activity?limit=20&offset=0`

No request body.

Response includes:
- `activity.posts` (own posts)
- `activity.shares` (own shares)
- `activity.likes` (posts this user liked)
- `activity.comments` (comments this user wrote)

### 10.4 Public User Profile (for other users)
**GET** `/api/social/users/:userId/profile?postLimit=10&postOffset=0`

No request body.

Response includes:
- `profile` (public profile fields including `profile_pic_url`)
- `stats` (`postCount`, `shareCount`, `friendCount`)
- `recentPosts` (respecting privacy + viewer relationship)

Avatar contract in `recentPosts[]`:
- `author_profile_pic_url`

---

## 11) Real-time Meeting API + Socket Signaling (WebRTC Signaling Only)

Server handles only signaling, room auth, and participant persistence.
Actual audio/video media must be handled in frontend WebRTC peers.

### 11.1 Create Meeting (Teacher only)
**POST** `/api/meetings/create`

Headers:
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

Request body:
```json
{
  "title": "Organic Chemistry Live Class"
}
```

Success response:
```json
{
  "roomId": "room_lth4v6_p9a0fe12",
  "meetingId": 12
}
```

### 11.2 Get Meeting by Room ID
**GET** `/api/meetings/:roomId`

Auth: optional

Response:
```json
{
  "meetingId": 12,
  "roomId": "room_lth4v6_p9a0fe12",
  "title": "Organic Chemistry Live Class",
  "hostUserId": 3,
  "hostName": "Ayesha Rahman",
  "hostRole": "teacher",
  "isActive": true,
  "createdAt": "2026-02-27T20:00:00.000Z"
}
```

### 11.3 End Meeting (Host only)
**POST** `/api/meetings/:roomId/end`

Headers:
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

Response:
```json
{
  "message": "Meeting ended successfully",
  "roomId": "room_lth4v6_p9a0fe12",
  "isActive": false
}
```

### 11.4 Socket.IO Signaling Events

Connection URL:
- `http://localhost:3001`

#### Client -> Server: `join-room`
Payload:
```json
{
  "roomId": "room_lth4v6_p9a0fe12",
  "token": "<JWT_TOKEN>"
}
```

Behavior:
- Verifies JWT
- Verifies room exists and active
- Saves participant join in DB
- Emits to joiner: `room-users` (current peers)
- Emits to room peers: `user-joined`

#### Client -> Server: `offer`
Payload:
```json
{
  "roomId": "room_lth4v6_p9a0fe12",
  "toSocketId": "<targetSocketId>",
  "offer": { "type": "offer", "sdp": "..." }
}
```

Forwarded event to target:
- `offer` with `{ fromSocketId, offer, userId, name }`

#### Client -> Server: `answer`
Payload:
```json
{
  "roomId": "room_lth4v6_p9a0fe12",
  "toSocketId": "<targetSocketId>",
  "answer": { "type": "answer", "sdp": "..." }
}
```

Forwarded event to target:
- `answer` with `{ fromSocketId, answer }`

#### Client -> Server: `ice-candidate`
Payload:
```json
{
  "roomId": "room_lth4v6_p9a0fe12",
  "toSocketId": "<targetSocketId>",
  "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
```

Forwarded event to target:
- `ice-candidate` with `{ fromSocketId, candidate }`

#### Client -> Server: `leave-room` (optional)
Behavior:
- Marks participant `left_at` in DB
- Emits `user-left` to room peers

#### Auto behavior: `disconnect`
Behavior:
- Marks participant `left_at` in DB
- Emits `user-left` to room peers

### 11.5 Signaling Test Quick Steps

1. Run backend:
```bash
npm install
npm run dev
```
2. Login from frontend and collect JWT.
3. Create a meeting via `POST /api/meetings/create`.
4. Open 2 browser tabs, connect Socket.IO client in both tabs.
5. Both tabs emit `join-room` with same `roomId` and valid JWTs.
6. Verify events: `room-users`, `user-joined`, then exchange `offer/answer/ice-candidate`.

